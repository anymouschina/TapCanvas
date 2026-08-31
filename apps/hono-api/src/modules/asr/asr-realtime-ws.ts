import type { Server as HttpServer, IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { randomUUID } from "node:crypto";
import { verifyJwtHS256 } from "../../jwt";
import { validateAuthSession } from "../auth/auth-session.service";
import { attachWebSocketSessionGuard } from "../auth/websocket-session-guard";
import { readWebSocketSessionToken } from "../auth/websocket-auth";
import {
	buildAudioFrame,
	buildFullClientRequestFrame,
	buildSaucRequestPayload,
	parseServerMessage,
} from "./volc-sauc-protocol";

/**
 * 对话框语音输入实时 ASR 代理：浏览器 ↔ /ws/asr/realtime ↔ 火山「豆包流式语音识别」(sauc)。
 *
 * 浏览器侧协议（与 apps/web/src/services/realtimeAsrClient.ts 对齐，移植自 Tanva）：
 *   浏览器→服务端：二进制帧 = 16kHz/16bit/单声道 PCM 块；JSON {type:"end"} = 停止录音。
 *   服务端→浏览器：{type:"ready"} / {type:"transcript", text, isFinal} / {type:"error", message} / {type:"closed"}。
 * isFinal 语义：火山 utterances[].definite=true 的定稿分句逐条下发 isFinal=true，
 * 未定稿部分整体作为 interim（isFinal=false，前端整段替换显示）。
 *
 * 上游鉴权（新版语音控制台单头 X-Api-Key；也支持旧版 AppId+AccessToken 两头）与
 * 协议封包见 volc-sauc-protocol.ts。会话上限 2 分钟，浏览器侧 25s 心跳。
 */

const MAX_SESSION_MS = 2 * 60 * 1000;
const HEARTBEAT_MS = 25 * 1000;
const DEFAULT_ENDPOINT = "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async";
const DEFAULT_RESOURCE_ID = "volc.seedasr.sauc.duration";

// 与 presence-ws/yjs-realtime 保持一致：getJwtSecret 是各实时模块的局部函数。
function getJwtSecret(): string {
	return process.env.JWT_SECRET || "dev-secret";
}

export function parseAsrUpgrade(url: string): { path: "/ws/asr/realtime" } | null {
	if (url !== "/ws/asr/realtime" && !url.startsWith("/ws/asr/realtime?")) return null;
	return { path: "/ws/asr/realtime" };
}

type VolcAsrCredentials =
	| { mode: "api-key"; apiKey: string; resourceId: string }
	| { mode: "app-token"; appId: string; accessToken: string; resourceId: string };

export function resolveVolcAsrCredentials(
	env: Record<string, string | undefined> = process.env,
): VolcAsrCredentials | null {
	const resourceId = (env.VOLC_ASR_RESOURCE_ID || "").trim() || DEFAULT_RESOURCE_ID;
	const appId = (env.VOLC_ASR_APP_ID || "").trim();
	const accessToken = (env.VOLC_ASR_ACCESS_TOKEN || "").trim();
	if (appId && accessToken) return { mode: "app-token", appId, accessToken, resourceId };
	const apiKey = (env.VOLC_ASR_API_KEY || "").trim();
	if (apiKey) return { mode: "api-key", apiKey, resourceId };
	return null;
}

export function buildVolcAsrHeaders(creds: VolcAsrCredentials): Record<string, string> {
	const requestId = randomUUID();
	if (creds.mode === "app-token") {
		return {
			"X-Api-App-Key": creds.appId,
			"X-Api-Access-Key": creds.accessToken,
			"X-Api-Resource-Id": creds.resourceId,
			"X-Api-Connect-Id": requestId,
		};
	}
	return {
		"X-Api-Key": creds.apiKey,
		"X-Api-Resource-Id": creds.resourceId,
		"X-Api-Request-Id": requestId,
	};
}

type BrowserWs = import("ws").WebSocket;

function safeSend(ws: BrowserWs, payload: object): void {
	try {
		if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
	} catch { /* drop */ }
}

function handleAsrConnection(
	browserWs: BrowserWs,
	ctx: { userId: string; sessionId: string },
	WebSocketCtor: typeof import("ws").WebSocket,
): void {
	const creds = resolveVolcAsrCredentials();
	if (!creds) {
		safeSend(browserWs, { type: "error", message: "语音识别服务未配置（缺 VOLC_ASR_API_KEY）" });
		browserWs.close();
		return;
	}

	const endpoint = (process.env.VOLC_ASR_ENDPOINT || "").trim() || DEFAULT_ENDPOINT;
	const upstream = new WebSocketCtor(endpoint, { headers: buildVolcAsrHeaders(creds) });
	const stopSessionGuard = attachWebSocketSessionGuard(browserWs, {
		userId: ctx.userId,
		sessionId: ctx.sessionId,
	});

	let upstreamReady = false;
	let closed = false;
	// 上游握手完成前浏览器已在推 PCM：先攒着，ready 后一次性冲刷。
	const pendingAudio: Buffer[] = [];
	// 已下发 isFinal=true 的定稿分句数（utterances 全量单调增长，按下标增量下发）。
	let emittedFinalCount = 0;

	const cleanup = (notifyClosed: boolean) => {
		if (closed) return;
		closed = true;
		stopSessionGuard();
		clearInterval(heartbeatTimer);
		clearTimeout(sessionTimer);
		if (notifyClosed) safeSend(browserWs, { type: "closed" });
		try { upstream.close(); } catch { /* noop */ }
		try { browserWs.close(); } catch { /* noop */ }
	};

	const heartbeatTimer = setInterval(() => {
		try { browserWs.ping(); } catch { /* noop */ }
	}, HEARTBEAT_MS);
	const sessionTimer = setTimeout(() => {
		safeSend(browserWs, { type: "error", message: "语音输入单次上限 2 分钟，已自动停止" });
		cleanup(true);
	}, MAX_SESSION_MS);

	upstream.on("upgrade", (res: IncomingMessage) => {
		const logId = res.headers["x-tt-logid"];
		if (logId) {
			// eslint-disable-next-line no-console
			console.log(`[asr] volc 握手成功 user=${ctx.userId} X-Tt-Logid=${String(logId)}`);
		}
	});

	upstream.on("open", () => {
		try {
			upstream.send(buildFullClientRequestFrame(buildSaucRequestPayload(ctx.userId)));
			upstreamReady = true;
			for (const chunk of pendingAudio.splice(0)) {
				upstream.send(buildAudioFrame(chunk, false));
			}
			safeSend(browserWs, { type: "ready" });
		} catch {
			safeSend(browserWs, { type: "error", message: "语音识别上游初始化失败" });
			cleanup(true);
		}
	});

	upstream.on("message", (data: Buffer) => {
		const evt = parseServerMessage(Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer));
		if (!evt) return;
		if (evt.kind === "error") {
			// eslint-disable-next-line no-console
			console.warn(`[asr] volc 错误 user=${ctx.userId} code=${evt.code} msg=${evt.message}`);
			safeSend(browserWs, { type: "error", message: `语音识别失败（${evt.code}）` });
			cleanup(true);
			return;
		}
		// 新增的定稿分句逐条下发 final；剩余（全文去掉定稿前缀）作为 interim 整段替换。
		const finals = evt.definiteUtterances;
		for (; emittedFinalCount < finals.length; emittedFinalCount += 1) {
			safeSend(browserWs, { type: "transcript", text: finals[emittedFinalCount], isFinal: true });
		}
		const definitePrefix = finals.join("");
		const interim = evt.text.startsWith(definitePrefix)
			? evt.text.slice(definitePrefix.length)
			: evt.text;
		safeSend(browserWs, { type: "transcript", text: interim, isFinal: false });
		if (evt.isFinalPacket) cleanup(true);
	});

	upstream.on("error", (err: Error) => {
		// eslint-disable-next-line no-console
		console.warn(`[asr] volc 连接异常 user=${ctx.userId}: ${err.message}`);
		safeSend(browserWs, { type: "error", message: "语音识别服务连接失败" });
		cleanup(true);
	});
	upstream.on("close", () => cleanup(true));
	// 上游握手被拒（401/403 等）时 ws 只会 emit error；unexpected-response 提供状态码便于排障。
	upstream.on("unexpected-response", (_req: unknown, res: IncomingMessage) => {
		// eslint-disable-next-line no-console
		console.warn(
			`[asr] volc 握手被拒 user=${ctx.userId} status=${res.statusCode} logid=${String(res.headers["x-tt-logid"] || "")}`,
		);
		safeSend(browserWs, {
			type: "error",
			message:
				res.statusCode === 401 || res.statusCode === 403
					? "语音识别鉴权失败（请检查火山语音控制台 ASR 服务是否开通）"
					: `语音识别服务异常（HTTP ${res.statusCode}）`,
		});
		cleanup(true);
	});

	browserWs.on("message", (data: unknown, isBinary: boolean) => {
		if (closed) return;
		if (isBinary) {
			const pcm = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
			if (!pcm.byteLength) return;
			if (upstreamReady) {
				try { upstream.send(buildAudioFrame(pcm, false)); } catch { /* noop */ }
			} else {
				pendingAudio.push(pcm);
			}
			return;
		}
		let msg: { type?: string };
		try { msg = JSON.parse(String(data)); } catch { return; }
		if (msg?.type === "end" && upstreamReady) {
			// 负包（空音频最后一包）：通知上游出终稿；终稿回包(isFinalPacket)后统一 cleanup。
			try { upstream.send(buildAudioFrame(Buffer.alloc(0), true)); } catch { /* noop */ }
		}
	});
	browserWs.on("close", () => cleanup(false));
	browserWs.on("error", () => cleanup(false));
}

export async function attachAsrRealtimeWebsocketServer(httpServer: HttpServer): Promise<void> {
	const wsMod = await import("ws");
	const WebSocketServer = wsMod.WebSocketServer;
	const wss = new WebSocketServer({ noServer: true });

	wss.on("connection", (ws: BrowserWs, _req: IncomingMessage, ctx: { userId: string; sessionId: string }) => {
		handleAsrConnection(ws, ctx, wsMod.WebSocket);
	});

	httpServer.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
		const parsed = parseAsrUpgrade(req.url || "");
		if (!parsed) return;
		const sessionToken = readWebSocketSessionToken(req);
		if (!sessionToken) {
			socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
			socket.destroy();
			return;
		}
		void verifyJwtHS256<{ sub?: string; sid?: string }>(sessionToken, getJwtSecret())
			.then(async (payload) => {
				if (!payload?.sub) {
					socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
					socket.destroy();
					return;
				}
				const session = await validateAuthSession(String(payload.sub), payload.sid);
				if (!session.valid) {
					socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
					socket.destroy();
					return;
				}
				wss.handleUpgrade(req, socket, head, (ws) => {
					wss.emit("connection", ws, req, { userId: String(payload.sub), sessionId: session.id });
				});
			})
			.catch(() => socket.destroy());
	});

	// eslint-disable-next-line no-console
	console.log("[asr] 实时语音识别 WS 已挂载于 /ws/asr/realtime（火山豆包流式 ASR 代理）");
}
