import { randomUUID } from "node:crypto";
import type { AppContext } from "../../types";
import { AppError } from "../../middleware/error";
import { fetchWithHttpDebugLog } from "../../httpDebugLog";
import {
	requireSufficientTeamCredits,
	settleTeamCreditsOnSuccess,
	releaseTeamCreditsOnFailure,
} from "../team/team.service";
import {
	AgentsLlmProtocolError,
	buildChatCompletionResponse,
	buildResponsesRequestFromChat,
	extractResponsesOutputEnvelope,
	extractResponsesOutputText,
	type ResponsesOutputEnvelope,
	usesResponsesApi,
} from "./agents-llm-protocol";
import {
	serializeShotTable,
	SHOT_TABLE_ANALYSIS_OUTPUT_MODE,
} from "@tapcanvas/shot-table-protocol";
import { requireSelectableVideoAnalysisModel } from "../new-api-models/new-api-video-analysis-model";
import {
	probeMediaViaMediaWorker,
	transcodeProxyViaMediaWorkerStrict,
} from "../../platform/media-worker/client";
import {
	buildVideoUnderstandResponsesRequest,
	type VideoUnderstandOutputMode,
	type VideoUnderstandingTransport,
} from "./agents-video-understand.protocol";
import { createVideoUnderstandingModelInputUrl } from "./agents-video-understand.transport";
import {
	calculateVideoAnalysisDurationQuote,
	validateVideoAnalysisExecutionLimits,
	videoAnalysisPromptByteLength,
	VIDEO_ANALYSIS_EXECUTION_LIMITS,
} from "../billing/video-analysis-upfront-pricing";
import {
	recoverShotTableAnalysisOutput,
	type VideoAnalysisAttemptKind,
} from "./agents-video-understand-structured-output";
import {
	parseVideoSpeechAuditEnvelope,
	VIDEO_SPEECH_AUDIT_OUTPUT_MODE,
} from "./agents-video-speech-audit.protocol";

export function readNewApiRelay(
	c: AppContext,
): { baseUrl: string; token: string } | null {
	const readEnv = (
		key: "NEW_API_INTERNAL_BASE_URL" | "NEW_API_INTERNAL_TOKEN",
	): string => {
		const fromEnv =
			typeof c.env[key] === "string" ? (c.env[key] as string) : "";
		if (fromEnv.trim()) return fromEnv.trim();
		const fromProcess =
			typeof (globalThis as any)?.process?.env?.[key] === "string"
				? String((globalThis as any).process.env[key])
				: "";
		return fromProcess.trim();
	};
	const baseUrl = readEnv("NEW_API_INTERNAL_BASE_URL").replace(/\/+$/, "");
	const token = readEnv("NEW_API_INTERNAL_TOKEN");
	if (!baseUrl || !token) return null;
	return { baseUrl, token };
}

function readTapCanvasUserRelayAuth(c: AppContext): TapCanvasUserRelayAuth | null {
	const authHeader = String(c.req.header("authorization") || "").trim();
	if (!authHeader.toLowerCase().startsWith("bearer ")) return null;
	const accessToken = authHeader.slice("Bearer ".length).trim();
	if (!accessToken) return null;
	const userId = c.get("userId");
	const auth = c.get("auth") as { payload?: { login?: unknown } } | undefined;
	const login = typeof auth?.payload?.login === "string" ? auth.payload.login : undefined;
	return {
		kind: "tapcanvas_user_session",
		accessToken,
		...(typeof userId === "string" && userId.trim() ? { userId: userId.trim() } : {}),
		...(login ? { login } : {}),
	};
}

type NewApiRelay = { baseUrl: string; token: string };

export type CriticApiStyle = "chat" | "responses";

export type CriticResponseFormat =
	| { type: "json_object" }
	| {
			type: "json_schema";
			name: string;
			strict?: boolean;
			schema: Record<string, unknown>;
	  };

type TapCanvasUserRelayAuth = {
	kind: "tapcanvas_user_session";
	accessToken: string;
	userId?: string;
	login?: string;
};

function extractResponsesText(raw: string): string {
	if (raw.includes("data:")) {
		let accumulated = "";
		for (const line of raw.split(/\r?\n/)) {
			const trimmed = line.trim();
			if (!trimmed.startsWith("data:")) continue;
			const payload = trimmed.slice("data:".length).trim();
			if (!payload || payload === "[DONE]") continue;
			try {
				const event = JSON.parse(payload) as {
					type?: unknown;
					delta?: unknown;
					response?: { output?: Array<{ type?: unknown; content?: Array<{ type?: unknown; text?: unknown }> }> };
				};
				if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
					accumulated += event.delta;
				}
				if (!accumulated && event.type === "response.completed" && event.response) {
					for (const item of event.response.output ?? []) {
						if (item.type !== "message") continue;
						for (const block of item.content ?? []) {
							if (block.type === "output_text" && typeof block.text === "string") accumulated += block.text;
						}
					}
				}
			} catch {
				// 非 JSON SSE 行由上层显式解析失败处理，不制造替代内容。
			}
		}
		if (accumulated.trim()) return accumulated;
	}
	let data: any;
	try {
		data = JSON.parse(raw);
	} catch {
		return raw; // 非标准 JSON（可能是 SSE）→ 原样返回，交上层容错解析
	}
	if (typeof data?.output_text === "string" && data.output_text.trim()) {
		return data.output_text;
	}
	let text = "";
	const output: any[] = Array.isArray(data?.output) ? data.output : [];
	for (const item of output) {
		if (item?.type !== "message") continue;
		const content: any[] = Array.isArray(item?.content) ? item.content : [];
		for (const block of content) {
			if (block?.type === "output_text" && typeof block?.text === "string") {
				text += block.text;
			}
		}
	}
	return text || raw;
}

function extractChatText(raw: string): string {
	try {
		const data = JSON.parse(raw) as {
			choices?: Array<{
				message?: { content?: unknown; reasoning_content?: unknown };
			}>;
		};
		const content = data?.choices?.[0]?.message?.content;
		if (typeof content === "string" && content.trim()) return content;
		// DeepSeek reasoning models can return a complete structured verdict in
		// `reasoning_content` while leaving `content` as an empty string. This is
		// an observed successful ChatCompletion response shape, not a model
		// fallback: keep the same response/model/protocol and expose its only
		// non-empty text channel to the caller's strict schema validator.
		const reasoningContent = data?.choices?.[0]?.message?.reasoning_content;
		if (typeof reasoningContent === "string" && reasoningContent.trim()) {
			return reasoningContent;
		}
	} catch {
		// 非标准 JSON（可能是 SSE）→ 原样返回，交上层容错解析
	}
	return raw;
}

/**
 * 共享的「单轮评审/critic」relay 调用。调用方提供 apiStyle 时必须精确沿用父代理
 * 本轮协议；只有旧的非模型绑定调用未提供时，才按模型能力选择协议。统一返回模型
 * 输出文本（解析失败时返回原始文本，让调用方的 JSON 容错抽取处理）。
 */
export async function relayCriticChat(
	relay: NewApiRelay,
	opts: {
		model: string;
		apiStyle?: CriticApiStyle;
		system: string;
		user: string;
		maxTokens?: number;
		temperature?: number;
		timeoutMs?: number;
		responseFormat?: CriticResponseFormat;
	},
): Promise<string> {
	const { model, system, user } = opts;
	const timeoutMs = opts.timeoutMs ?? 60_000;
	const useResponses = opts.apiStyle
		? opts.apiStyle === "responses"
		: usesResponsesApi(model);
	const url = `${relay.baseUrl}${useResponses ? "/v1/responses" : "/v1/chat/completions"}`;
	const body = useResponses
		? {
				model,
				stream: true,
				instructions: system,
				// packyapi 等渠道的 /v1/responses 只认消息数组形式的 input；纯字符串会被上游拒为
				// 400 bad_response_status_code（实测：string→400 / array→200）。务必用 message 数组。
				input: [
					{
						type: "message",
						role: "user",
						content: [{ type: "input_text", text: user }],
					},
				],
				...(opts.responseFormat
					? { text: { format: opts.responseFormat } }
					: {}),
				...(opts.maxTokens ? { max_output_tokens: opts.maxTokens } : {}),
			}
		: {
				model,
				messages: [
					{ role: "system", content: system },
					{ role: "user", content: user },
				],
				temperature: opts.temperature ?? 0.2,
				stream: false,
				...(opts.responseFormat
					? { response_format: opts.responseFormat }
					: {}),
				...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
			};
	const res = await fetch(url, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${relay.token}`,
		},
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(timeoutMs),
	});
	if (!res.ok) {
		throw new Error(
			`relay critic ${model} (${useResponses ? "responses" : "chat"}) failed: ${res.status}`,
		);
	}
	const text = await res.text();
	return useResponses ? extractResponsesText(text) : extractChatText(text);
}

type Reservation = Awaited<ReturnType<typeof requireSufficientTeamCredits>>;

const asRecord = (value: unknown): Record<string, unknown> | null =>
	value && typeof value === "object" && !Array.isArray(value)
		? value as Record<string, unknown>
		: null;

const readVideoUnderstandUpstreamFailure = (
	rawText: string,
	status: number,
): { message: string; diagnostic: unknown } => {
	try {
		const parsed = JSON.parse(rawText) as unknown;
		const root = asRecord(parsed);
		const nestedError = asRecord(root?.error);
		const errorRecord = nestedError ?? root;
		const nestedMessage = typeof errorRecord?.message === "string"
			? errorRecord.message.trim()
			: "";
		const rootMessage = typeof root?.message === "string" ? root.message.trim() : "";
		const diagnostic = errorRecord
			? Object.fromEntries(
					["message", "type", "param", "code", "request_id", "requestId"]
						.flatMap((key) => {
							const value = errorRecord[key];
							return typeof value === "string" || typeof value === "number"
								? [[key, value] as const]
								: [];
						}),
				)
			: { bodyType: Array.isArray(parsed) ? "array" : typeof parsed };
		return {
			message: nestedMessage || rootMessage || `视频分析上游返回 HTTP ${status}`,
			diagnostic,
		};
	} catch {
		return {
			message: `视频分析上游返回 HTTP ${status}，且错误响应不是 JSON`,
			diagnostic: { bodyLength: rawText.length },
		};
	}
};

const VIDEO_ANALYSIS_PRIMARY_TIMEOUT_MS = 3 * 60_000;
const VIDEO_ANALYSIS_REPAIR_TIMEOUT_MS = 2 * 60_000;

const combineAttemptSignal = (
	clientSignal: AbortSignal | null,
	timeoutMs: number,
): AbortSignal => {
	const timeoutSignal = AbortSignal.timeout(timeoutMs);
	return clientSignal ? AbortSignal.any([clientSignal, timeoutSignal]) : timeoutSignal;
};

async function requestVideoUnderstandResponsesAttempt(input: {
	c: AppContext;
	targetUrl: string;
	token: string;
	model: string;
	proxyTaskId: string;
	transport: VideoUnderstandingTransport;
	kind: VideoAnalysisAttemptKind;
	body: Record<string, unknown>;
	clientSignal: AbortSignal | null;
	timeoutMs: number;
}): Promise<ResponsesOutputEnvelope> {
	let upstreamRes: Response;
	try {
		upstreamRes = await fetchWithHttpDebugLog(
			input.c,
			input.targetUrl,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${input.token}`,
				},
				body: JSON.stringify(input.body),
				signal: combineAttemptSignal(input.clientSignal, input.timeoutMs),
			},
			{ tag: `agents-video-understand:${input.proxyTaskId}:${input.kind}` },
		);
	} catch (error: unknown) {
		const cause = error instanceof Error ? error.message : String(error);
		console.error("[agents-video-understand] upstream request failed", {
			proxyTaskId: input.proxyTaskId,
			kind: input.kind,
			model: input.model,
			transport: input.transport,
			cause,
		});
		throw new AppError(`视频分析上游请求失败：${cause}`, {
			status: 502,
			code: "video_analysis_upstream_request_failed",
			details: {
				proxyTaskId: input.proxyTaskId,
				kind: input.kind,
				model: input.model,
				transport: input.transport,
				cause,
			},
		});
	}

	if (!upstreamRes.ok) {
		let errorText: string;
		try {
			errorText = await upstreamRes.text();
		} catch (error: unknown) {
			const cause = error instanceof Error ? error.message : String(error);
			console.error("[agents-video-understand] upstream error body unreadable", {
				proxyTaskId: input.proxyTaskId,
				kind: input.kind,
				model: input.model,
				upstreamStatus: upstreamRes.status,
				transport: input.transport,
				cause,
			});
			throw new AppError("视频分析上游失败，且错误响应体无法读取", {
				status: 502,
				code: "video_analysis_upstream_error_body_unreadable",
				details: {
					proxyTaskId: input.proxyTaskId,
					kind: input.kind,
					model: input.model,
					upstreamStatus: upstreamRes.status,
					transport: input.transport,
					cause,
				},
			});
		}
		const failure = readVideoUnderstandUpstreamFailure(errorText, upstreamRes.status);
		console.error("[agents-video-understand] upstream rejected request", {
			proxyTaskId: input.proxyTaskId,
			kind: input.kind,
			model: input.model,
			upstreamStatus: upstreamRes.status,
			transport: input.transport,
			upstreamError: failure.diagnostic,
		});
		throw new AppError(failure.message, {
			status: 502,
			code: "video_analysis_upstream_rejected",
			details: {
				proxyTaskId: input.proxyTaskId,
				kind: input.kind,
				model: input.model,
				upstreamStatus: upstreamRes.status,
				upstreamError: failure.diagnostic,
				transport: input.transport,
			},
		});
	}

	let responseText: string;
	try {
		responseText = await upstreamRes.text();
	} catch (error: unknown) {
		throw new AppError("视频分析上游成功，但响应体无法读取", {
			status: 502,
			code: "video_analysis_upstream_body_unreadable",
			details: {
				proxyTaskId: input.proxyTaskId,
				kind: input.kind,
				model: input.model,
				transport: input.transport,
				cause: error instanceof Error ? error.message : String(error),
			},
		});
	}
	try {
		return extractResponsesOutputEnvelope(responseText);
	} catch (error: unknown) {
		const cause = error instanceof Error ? error.message : String(error);
		console.error("[agents-video-understand] upstream output extraction failed", {
			proxyTaskId: input.proxyTaskId,
			kind: input.kind,
			model: input.model,
			transport: input.transport,
			cause,
		});
		throw new AppError(`视频分析上游成功，但输出读取失败：${cause}`, {
			status: 502,
			code: "video_analysis_output_text_missing",
			details: {
				proxyTaskId: input.proxyTaskId,
				kind: input.kind,
				model: input.model,
				transport: input.transport,
				cause,
			},
		});
	}
}

async function settleReservation(
	c: AppContext,
	userId: string,
	reservation: Reservation,
	success: boolean,
): Promise<void> {
	if (!reservation) return;
	try {
		if (success) {
			await settleTeamCreditsOnSuccess(c, userId, {
				taskId: reservation.reservationTaskId,
				taskKind: reservation.taskKind,
				amount: reservation.amount,
				vendor: reservation.vendor,
				modelKey: reservation.modelKey ?? null,
				specKey: reservation.specKey ?? null,
			});
		} else {
			await releaseTeamCreditsOnFailure(c, userId, {
				taskId: reservation.reservationTaskId,
				taskKind: reservation.taskKind,
				vendor: reservation.vendor,
				modelKey: reservation.modelKey ?? null,
				specKey: reservation.specKey ?? null,
			});
		}
	} catch (error: unknown) {
		console.error("[agents-llm-proxy] billing reservation settlement failed", {
			reservationTaskId: reservation.reservationTaskId,
			taskKind: reservation.taskKind,
			vendor: reservation.vendor,
			modelKey: reservation.modelKey ?? null,
			specKey: reservation.specKey ?? null,
			success,
			cause: error instanceof Error ? error.message : String(error),
		});
		// Billing diagnostics must be visible, but cannot discard a completed model asset.
	}
}

export async function handleAgentsLlmVideoUnderstand(
	c: AppContext,
): Promise<Response> {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);

	const relay = readNewApiRelay(c);
	if (!relay) {
		throw new AppError(
			"NEW_API_INTERNAL_BASE_URL / NEW_API_INTERNAL_TOKEN 未配置",
			{ status: 500, code: "new_api_not_configured" },
		);
	}
	let body: {
		model?: unknown;
		videoUrl?: unknown;
		userPrompt?: unknown;
		fps?: unknown;
		outputMode?: unknown;
	};
	try {
		body = (await c.req.json()) as typeof body;
	} catch {
		return c.json({ error: "Invalid JSON body" }, 400);
	}

	const rawVideoUrl = typeof body.videoUrl === "string" ? body.videoUrl.trim() : "";
	const userPrompt = typeof body.userPrompt === "string" ? body.userPrompt.trim() : "";
	const fps = typeof body.fps === "number" && Number.isFinite(body.fps) ? body.fps : NaN;
	const outputMode = body.outputMode;

	if (!rawVideoUrl) return c.json({ error: "videoUrl is required" }, 400);
	let parsedVideoUrl: URL;
	try {
		parsedVideoUrl = new URL(rawVideoUrl);
	} catch {
		return c.json({ error: "videoUrl must be an absolute http/https URL" }, 400);
	}
	if (parsedVideoUrl.protocol !== "http:" && parsedVideoUrl.protocol !== "https:") {
		return c.json({ error: "videoUrl must use http or https" }, 400);
	}
	const videoUrl = parsedVideoUrl.toString();
	if (
		!Number.isFinite(fps)
		|| fps < VIDEO_ANALYSIS_EXECUTION_LIMITS.minFps
		|| fps > VIDEO_ANALYSIS_EXECUTION_LIMITS.maxFps
	) {
		return c.json({
			error: `fps must be a finite number between ${VIDEO_ANALYSIS_EXECUTION_LIMITS.minFps} and ${VIDEO_ANALYSIS_EXECUTION_LIMITS.maxFps}`,
		}, 400);
	}
	const promptBytes = videoAnalysisPromptByteLength(userPrompt);
	if (promptBytes > VIDEO_ANALYSIS_EXECUTION_LIMITS.maxPromptBytes) {
		throw new AppError(
			`视频分析补充要求最多 ${VIDEO_ANALYSIS_EXECUTION_LIMITS.maxPromptBytes} 字节`,
			{
				status: 400,
				code: "video_analysis_prompt_limit_exceeded",
				details: {
					promptBytes,
					maxPromptBytes: VIDEO_ANALYSIS_EXECUTION_LIMITS.maxPromptBytes,
				},
			},
		);
	}
	if (
		outputMode !== "free-text" &&
		outputMode !== SHOT_TABLE_ANALYSIS_OUTPUT_MODE &&
		outputMode !== VIDEO_SPEECH_AUDIT_OUTPUT_MODE
	) {
		return c.json({ error: "outputMode must be free-text, shot-table-v1, or speech-audit-v1" }, 400);
	}
	const selectedModel = await requireSelectableVideoAnalysisModel(c, body.model);
	const model = selectedModel.requestModelKey;
	const upfrontPricing = selectedModel.videoAnalysisPricing;
	if (!upfrontPricing?.enabled || upfrontPricing.mode !== "duration_metered") {
		throw new AppError("视频分析模型缺少可执行的按时长价格", {
			status: 500,
			code: "video_analysis_upfront_pricing_missing",
			details: { model },
		});
	}
	const validatedOutputMode = outputMode as VideoUnderstandOutputMode;

	let reservation: Reservation = null;
	const proxyTaskId = randomUUID();
	let transport: VideoUnderstandingTransport;
	let modelInputUrl: string;
	try {
		const proxy = await transcodeProxyViaMediaWorkerStrict({ videoUrl });
		const mediaProbe = await probeMediaViaMediaWorker({ videoR2Key: proxy.key });
		const durationSeconds = Number(mediaProbe?.durationSeconds ?? 0);
		if (!mediaProbe || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
			throw new Error("media-worker 未返回可用于前置计价校验的有效视频时长");
		}
		modelInputUrl = await createVideoUnderstandingModelInputUrl({
			env: c.env,
			objectKey: proxy.key,
		});
		transport = {
			type: "media-worker-understanding-proxy-v1",
			url: proxy.url,
			sizeBytes: proxy.sizeBytes,
			durationSeconds,
		};
		const quote = calculateVideoAnalysisDurationQuote({
			modelKey: model,
			durationSeconds,
			creditsPerCny: upfrontPricing.creditsPerCny,
		});
		if (!quote) throw new Error(`模型 ${model} 没有按时长计价配置`);
		reservation = await requireSufficientTeamCredits(c, userId, {
			required: quote.creditsCharged,
			taskKind: "video_understanding",
			vendor: "new_api",
			modelKey: model,
			specKey: upfrontPricing.specKey,
		});
		if (reservation) reservation.reservationTaskId = proxyTaskId;
		console.info("[agents-video-understand] understanding proxy ready", {
			proxyTaskId,
			model,
			proxyUrl: transport.url,
			proxySizeBytes: transport.sizeBytes,
			durationSeconds: transport.durationSeconds,
			upfrontCredits: reservation?.amount ?? 0,
			billingSpecKey: upfrontPricing.specKey,
		});
	} catch (error: unknown) {
		await settleReservation(c, userId, reservation, false);
		const cause = error instanceof Error ? error.message : String(error);
		console.error("[agents-video-understand] understanding proxy failed", {
			proxyTaskId,
			model,
			cause,
		});
		throw new AppError(`视频理解预处理失败：${cause}`, {
			status: 502,
			code: "video_analysis_proxy_failed",
			details: { proxyTaskId, model, cause },
		});
	}

	const targetUrl = `${relay.baseUrl}/v1/responses`;
	const clientSignal = (c.req.raw.signal as AbortSignal | undefined) ?? null;

	const requestBody = buildVideoUnderstandResponsesRequest({
		model,
		videoUrl: modelInputUrl,
		fps,
		userPrompt,
		outputMode: validatedOutputMode,
		verifiedDurationSeconds: transport.durationSeconds,
	});
	const serializedRequestBody = JSON.stringify(requestBody);
	const limitViolation = validateVideoAnalysisExecutionLimits({
		durationSeconds: transport.durationSeconds,
		videoSizeBytes: transport.sizeBytes,
		fps,
		userPrompt,
		requestBody: serializedRequestBody,
	});
	if (limitViolation) {
		await settleReservation(c, userId, reservation, false);
		console.error("[agents-video-understand] fixed-price envelope rejected", {
			proxyTaskId,
			model,
			upfrontCredits: reservation?.amount ?? 0,
			billingSpecKey: upfrontPricing.specKey,
			violation: limitViolation,
		});
		throw new AppError(limitViolation.message, {
			status: limitViolation.code === "video_analysis_duration_invalid" ? 502 : 400,
			code: limitViolation.code,
			details: {
				...limitViolation.details,
				billingSpecKey: upfrontPricing.specKey,
			},
		});
	}

	let primaryEnvelope: ResponsesOutputEnvelope;
	try {
		primaryEnvelope = await requestVideoUnderstandResponsesAttempt({
			c,
			targetUrl,
			token: relay.token,
			model,
			proxyTaskId,
			transport,
			kind: "primary",
			body: requestBody,
			clientSignal,
			timeoutMs: VIDEO_ANALYSIS_PRIMARY_TIMEOUT_MS,
		});
	} catch (error: unknown) {
		await settleReservation(c, userId, reservation, false);
		throw error;
	}

	if (validatedOutputMode === SHOT_TABLE_ANALYSIS_OUTPUT_MODE) {
		try {
			const recovered = await recoverShotTableAnalysisOutput({
				proxyTaskId,
				model,
				primary: primaryEnvelope,
				expectedDurationSeconds: transport.durationSeconds,
				sendRepair: async (request) => requestVideoUnderstandResponsesAttempt({
					c,
					targetUrl,
					token: relay.token,
					model,
					proxyTaskId,
					transport,
					kind: request.kind,
					body: request.body,
					clientSignal,
					timeoutMs: VIDEO_ANALYSIS_REPAIR_TIMEOUT_MS,
				}),
			});
			await settleReservation(c, userId, reservation, true);
			console.info("[agents-video-understand] structured shot table completed", {
				proxyTaskId,
				model,
				transport,
				rowCount: recovered.table.rows.length,
				repaired: recovered.execution.repaired,
				repairKind: recovered.execution.repairKind,
				responseIds: recovered.execution.attempts.map((attempt) => attempt.responseId),
				chargedCredits: reservation?.amount ?? 0,
				billingSpecKey: upfrontPricing.specKey,
			});
			return c.json({
				table: recovered.table,
				text: serializeShotTable(recovered.table),
				model,
				outputMode: validatedOutputMode,
				transport,
				analysisExecution: recovered.execution,
			});
		} catch (error: unknown) {
			await settleReservation(c, userId, reservation, false);
			console.error("[agents-video-understand] structured shot table recovery failed", {
				proxyTaskId,
				model,
				transport,
				code: error instanceof AppError ? error.code : "internal_error",
				cause: error instanceof Error ? error.message : String(error),
				details: error instanceof AppError ? error.details : undefined,
			});
			throw error;
		}
	}

	if (validatedOutputMode === VIDEO_SPEECH_AUDIT_OUTPUT_MODE) {
		try {
			const speechAudit = parseVideoSpeechAuditEnvelope({
				envelope: primaryEnvelope,
				expectedModel: model,
			});
			await settleReservation(c, userId, reservation, true);
			console.info("[agents-video-understand] structured speech audit completed", {
				proxyTaskId,
				model,
				transport,
				utteranceCount: speechAudit.transcript.utterances.length,
				responseId: speechAudit.execution.responseId,
				chargedCredits: reservation?.amount ?? 0,
				billingSpecKey: upfrontPricing.specKey,
			});
			return c.json({
				transcript: speechAudit.transcript,
				model,
				outputMode: validatedOutputMode,
				transport,
				analysisExecution: speechAudit.execution,
			});
		} catch (error: unknown) {
			await settleReservation(c, userId, reservation, false);
			console.error("[agents-video-understand] structured speech audit failed", {
				proxyTaskId,
				model,
				transport,
				code: error instanceof AppError ? error.code : "internal_error",
				cause: error instanceof Error ? error.message : String(error),
				details: error instanceof AppError ? error.details : undefined,
			});
			throw error;
		}
	}

	await settleReservation(c, userId, reservation, true);
	return c.json({
		text: primaryEnvelope.text.trim(),
		model,
		outputMode: validatedOutputMode,
		transport,
	});
}

export async function handleAgentsLlmChatCompletions(
	c: AppContext,
	options?: { executionClass?: "primary_proxy" | "auxiliary" },
): Promise<Response> {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);

	const relay = readNewApiRelay(c);
	if (!relay) {
		throw new AppError(
			"NEW_API_INTERNAL_BASE_URL / NEW_API_INTERNAL_TOKEN 未配置",
			{ status: 500, code: "new_api_not_configured" },
		);
	}

	let body: Record<string, unknown>;
	try {
		body = (await c.req.json()) as Record<string, unknown>;
	} catch {
		return c.json({ error: "Invalid JSON body" }, 400);
	}

	const executionClass = options?.executionClass ?? "primary_proxy";
	if (executionClass === "auxiliary") {
		if (body.auxiliaryPurpose !== "conversation_title") {
			return c.json({
				error: {
					code: "agents_auxiliary_purpose_invalid",
					message: "辅助 LLM 请求必须声明受支持的 auxiliaryPurpose",
				},
			}, 400);
		}
		if (body.stream === true) {
			return c.json({
				error: {
					code: "agents_auxiliary_stream_forbidden",
					message: "辅助元数据请求不得占用流式主对话传输",
				},
			}, 400);
		}
		if (typeof body.tools !== "undefined" || typeof body.tool_choice !== "undefined") {
			return c.json({
				error: {
					code: "agents_auxiliary_tools_forbidden",
					message: "辅助元数据请求不得调用工具或进入生产执行面",
				},
			}, 400);
		}
		// auxiliaryPurpose is a TapCanvas lifecycle marker, not a provider field.
		// Strip it before relay so the silent metadata process remains physically
		// separate from /public/chat turns and cannot acquire their ownership.
		body = { ...body };
		delete body.auxiliaryPurpose;
	}

	const model = typeof body.model === "string" ? body.model.trim() : "";
	const isStream = body.stream === true;
	const useResponses = usesResponsesApi(model);
	if (useResponses && isStream) {
		return c.json(
			{
				error: {
					code: "responses_chat_stream_not_supported",
					message:
						"GPT/Codex models require the native Responses streaming protocol; this internal Chat-shaped proxy only converts non-stream text requests",
				},
			},
			400,
		);
	}

	let upstreamBody: Record<string, unknown> = body;
	if (useResponses) {
		try {
			upstreamBody = buildResponsesRequestFromChat(body);
		} catch (error) {
			if (!(error instanceof AgentsLlmProtocolError)) throw error;
			return c.json(
				{
					error: {
						code: "chat_to_responses_request_invalid",
						message: error.message,
					},
				},
				400,
			);
		}
	}

	// AI 对话不在 Hono 侧做余额预检或冻结；直接交给上游真实额度策略处理。
	const reservation: Reservation = null;

	// 保留稳定的代理任务 ID，供传输日志和真实上游错误关联。
	const proxyTaskId = randomUUID();

	const targetUrl = `${relay.baseUrl}${useResponses ? "/v1/responses" : "/v1/chat/completions"}`;

	// Propagate client disconnect signal + hard fallback timeout so hono-api
	// never hangs indefinitely when new-api stalls or doesn't respond.
	const clientSignal = (c.req.raw.signal as AbortSignal | undefined) ?? null;
	// GPT Responses and native streams can legitimately take several minutes.
	const hardTimeout = AbortSignal.timeout(
		executionClass === "auxiliary"
			? 15_000
			: useResponses || isStream
				? 15 * 60_000
				: 90_000,
	);
	const fetchSignal = clientSignal
		? AbortSignal.any([clientSignal, hardTimeout])
		: hardTimeout;

	let upstreamRes: Response;
	try {
		upstreamRes = await fetchWithHttpDebugLog(
			c,
			targetUrl,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${relay.token}`,
					Accept: useResponses || isStream ? "text/event-stream" : "application/json",
				},
				body: JSON.stringify(upstreamBody),
				signal: fetchSignal,
			},
			{ tag: executionClass === "auxiliary" ? "agents-llm-auxiliary" : "agents-llm-proxy" },
		);
	} catch (err) {
		await settleReservation(c, userId, reservation, false);
		throw err;
	}

	if (!upstreamRes.ok) {
		await settleReservation(c, userId, reservation, false);
		const errorText = await upstreamRes.text().catch(() => "upstream error");
		return new Response(errorText, {
			status: upstreamRes.status,
			headers: {
				"Content-Type":
					upstreamRes.headers.get("Content-Type") ?? "application/json",
			},
		});
	}

	if (!isStream || !upstreamRes.body) {
		const responseText = await upstreamRes.text();
		if (useResponses) {
			let text: string;
			try {
				text = extractResponsesOutputText(responseText);
			} catch (error) {
				await settleReservation(c, userId, reservation, false);
				console.error("[agents-llm-proxy] Responses-to-Chat parse failed", {
					model,
					error: error instanceof Error ? error.message : String(error),
					responseChars: responseText.length,
				});
				throw new AppError("Responses 上游未返回可解析的文本结果", {
					status: 502,
					code: "responses_chat_response_invalid",
				});
			}
			await settleReservation(c, userId, reservation, true);
			return c.json(buildChatCompletionResponse(model, text));
		}
		await settleReservation(c, userId, reservation, true);
		return new Response(responseText, {
			status: upstreamRes.status,
			headers: {
				"Content-Type":
					upstreamRes.headers.get("Content-Type") ?? "application/json",
			},
		});
	}

	// Streaming: pipe through; settle credits when stream ends.
	const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
	const writer = writable.getWriter();
	const reader = upstreamRes.body.getReader();

	(async () => {
		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				await writer.write(value);
			}
			await writer.close();
			await settleReservation(c, userId, reservation, true);
		} catch {
			try {
				await writer.abort();
			} catch {
				// ignore
			}
			await settleReservation(c, userId, reservation, false);
		}
	})();

	return new Response(readable, {
		status: 200,
		headers: {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			Connection: "keep-alive",
		},
	});
}

export async function handleAgentsLlmResponses(c: AppContext): Promise<Response> {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);

	const relay = readNewApiRelay(c);
	if (!relay) {
		throw new AppError(
			"NEW_API_INTERNAL_BASE_URL / NEW_API_INTERNAL_TOKEN 未配置",
			{ status: 500, code: "new_api_not_configured" },
		);
	}

	let body: Record<string, unknown>;
	try {
		body = (await c.req.json()) as Record<string, unknown>;
	} catch {
		return c.json({ error: "Invalid JSON body" }, 400);
	}
	const model = typeof body.model === "string" ? body.model.trim() : "";
	if (!model) {
		return c.json({ error: { code: "model_required", message: "model is required" } }, 400);
	}

	const clientSignal = (c.req.raw.signal as AbortSignal | undefined) ?? null;
	const hardTimeout = AbortSignal.timeout(15 * 60_000);
	const signal = clientSignal
		? AbortSignal.any([clientSignal, hardTimeout])
		: hardTimeout;
	const upstream = await fetchWithHttpDebugLog(
		c,
		`${relay.baseUrl}/v1/responses`,
		{
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${relay.token}`,
				Accept: body.stream === true ? "text/event-stream" : "application/json",
			},
			body: JSON.stringify(body),
			signal,
		},
		{ tag: "agents-llm-responses-proxy" },
	);

	return new Response(upstream.body, {
		status: upstream.status,
		headers: {
			"Content-Type": upstream.headers.get("Content-Type") ??
				(body.stream === true ? "text/event-stream" : "application/json"),
			"Cache-Control": upstream.headers.get("Cache-Control") ?? "no-cache",
		},
	});
}
