import "reflect-metadata";

// Extend undici's default bodyTimeout from 300s to 30min so long-running AI image calls
// (gpt-image-2, etc.) don't get cut short. AbortController-based timeouts in callJsonApi
// still fire correctly and cancel requests at the configured deadline.
// Configurable via API_UNDICI_TIMEOUT_MS (default 30min = unchanged). Once generation
// no longer blocks api request handlers (submit-and-return cutover), lower this so the
// api stops holding sockets/request contexts for minutes at peak.
import { Agent, setGlobalDispatcher } from "undici";
const undiciTimeoutMs = Number(process.env.API_UNDICI_TIMEOUT_MS) || 30 * 60 * 1000;
// connectTimeout covers TCP + TLS handshake. Some upstream CDN hosts (files.toapis.com
// behind Cloudflare) take 7-15s just for the TLS handshake from the container's egress
// path, so a 10s budget sat inside the jitter band and surfaced as
// "OSS 上传失败：拉取源文件失败" on otherwise-successful generations.
const undiciConnectTimeoutMs =
	Number(process.env.API_UNDICI_CONNECT_TIMEOUT_MS) || 30_000;
setGlobalDispatcher(new Agent({
	bodyTimeout: undiciTimeoutMs,
	headersTimeout: undiciTimeoutMs,
	connectTimeout: undiciConnectTimeoutMs,
}));

import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";

import { AppModule } from "./app.module";
import { createTapCanvasApp } from "./app";
import { loadLocalEnvFiles } from "./platform/node/local-env";
import {
	createNodeWorkerEnv,
} from "./platform/node/node-env";
import { assertObjectStorageStartupReady } from "./platform/node/object-storage-startup";
import { mountHonoToExpress } from "./platform/node/hono-express-adapter";
import { maybeAutostartAgentsBridge } from "./platform/node/agents-bridge-autostart";
import { attachYjsWebsocketServer } from "./modules/realtime/yjs-realtime";
import { attachPresenceWebsocketServer } from "./modules/realtime/presence-ws";
import { attachAsrRealtimeWebsocketServer } from "./modules/asr/asr-realtime-ws";
import { markRuntimeDraining, markRuntimeReady } from "./platform/node/runtime-lifecycle";
import { startFlowVersionRetentionScheduler } from "./modules/flow/flow-version-retention";
import { waitForGracefulShutdown } from "./platform/node/graceful-shutdown";
import { resumePersistedPromptLibraryCrawls } from "./modules/prompt-library/prompt-library.crawler";
import { ensureBootstrapAdmin } from "./modules/auth/bootstrap-admin";
import { syncBuiltInGreetingWorkflow } from "./modules/agents/system-greeting-workflow";

async function bootstrap() {
	loadLocalEnvFiles();
	// A short second health read prevents a restarting API from adopting the old
	// API process's bridge child during its shutdown race.
	await maybeAutostartAgentsBridge({ stabilityWindowMs: 750 });

	const app = await NestFactory.create<NestExpressApplication>(AppModule, {
		// Let Hono parse request bodies (avoid Express bodyParser consuming the stream).
		bodyParser: false,
	});

	const honoApp = await createTapCanvasApp();
	const env = await createNodeWorkerEnv();
	const bootstrapAdminId = await ensureBootstrapAdmin(env.DB);
	await syncBuiltInGreetingWorkflow(env.DB, bootstrapAdminId);
	const assetHosting = assertObjectStorageStartupReady(env);
	// Credentials are intentionally excluded from this startup diagnostic.
	console.log("[api] asset hosting startup", assetHosting);

	const express = app.getHttpAdapter().getInstance();
	mountHonoToExpress(express, honoApp, env);

	const portRaw = Number(process.env.PORT || 8788);
	const port = Number.isFinite(portRaw) ? portRaw : 8788;
	await app.listen(port, "0.0.0.0");
	// 画布 Yjs 实时层：仅在 CANVAS_YJS_WS=on 时挂载到底层 http.Server 的 upgrade 事件
	await attachYjsWebsocketServer(app.getHttpServer());
	// 画布协作光标 presence 实时层（默认 ON，CANVAS_PRESENCE_WS=off 可回滚）：挂到同一底层 http.Server upgrade
	await attachPresenceWebsocketServer(app.getHttpServer());
	// 对话框语音输入实时 ASR（火山豆包流式识别代理，凭证缺失时仅在连接时报错不阻断启动）
	await attachAsrRealtimeWebsocketServer(app.getHttpServer());
	markRuntimeReady();
	const stopFlowVersionRetentionScheduler = startFlowVersionRetentionScheduler();
	void resumePersistedPromptLibraryCrawls(env)
		.then((count) => {
			if (count > 0) console.log(`[prompt-library] resumed ${count} persisted crawl run(s)`);
		})
		.catch((error: unknown) => console.error("[prompt-library] persisted crawl recovery failed", error));
	const shutdownCleanups: Array<() => void> = [];
	// 画布 SSE 跨进程中继已内建在 canvas-sse.manager：REDIS_URL 存在即自动
	// publish/subscribe（首个 SSE 连接建立时惰性订阅），无需在此单独启动。
	// eslint-disable-next-line no-console
	console.log(`[api] listening on http://localhost:${port}`);

	// 内存周期日志：每 60s 采样一次，用于诊断内存飙升根因。
	// 观察 heapUsed 趋势；如持续增长未回落说明存在泄漏。
	if (process.env.NODE_ENV !== "test") {
		const memTimer = setInterval(() => {
			const m = process.memoryUsage();
			const mb = (b: number) => Math.round(b / 1024 / 1024);
			// eslint-disable-next-line no-console
			console.log(
				`[mem] rss=${mb(m.rss)}MB heap=${mb(m.heapUsed)}/${mb(m.heapTotal)}MB ext=${mb(m.external)}MB`,
			);
		}, 60_000);
		memTimer.unref?.();
		shutdownCleanups.push(() => clearInterval(memTimer));
	}

	// 社区热度定时校准：浏览量等不触发写时重算，每小时纠正一次漂移。
	if (process.env.NODE_ENV !== "test") {
		const { recomputeRecentHotScores } = await import(
			"./modules/community/community.service"
		);
		const timer = setInterval(() => {
			void recomputeRecentHotScores().catch(() => {});
		}, 3_600_000);
		timer.unref?.();
		shutdownCleanups.push(() => clearInterval(timer));
	}

	// 悬挂冻结清理：AI 对话计费的 reserve 若因异常未结算/解冻，会把用户积分卡在冻结。每小时扫一次，
	// 释放超过 30 分钟仍无 deduct/release 的 agents_chat 冻结(30min 远超 10min 的回合上限)；启动后
	// 先延迟 60s 扫一次，清掉重启前的残留。
	if (process.env.NODE_ENV !== "test") {
		const { sweepDanglingChatReservations } = await import(
			"./modules/billing/chat-billing"
		);
		const sweepDangling = () =>
			void sweepDanglingChatReservations(env.DB)
				.then((r) => {
					if (r.released > 0) {
						// eslint-disable-next-line no-console
						console.log(`[chat-billing-sweep] released ${r.released}/${r.scanned} dangling agents_chat reservations`);
					}
				})
				.catch((e) => console.error("[chat-billing-sweep] failed", e));
		const sweepTimer = setInterval(sweepDangling, 3_600_000);
		sweepTimer.unref?.();
		const initialSweep = setTimeout(sweepDangling, 60_000);
		initialSweep.unref?.();
		shutdownCleanups.push(() => {
			clearInterval(sweepTimer);
			clearTimeout(initialSweep);
		});
	}

	let shutdownStarted = false;
	const shutdown = (signal: "SIGTERM" | "SIGINT"): void => {
		if (shutdownStarted) return;
		shutdownStarted = true;
		stopFlowVersionRetentionScheduler();
		for (const cleanup of shutdownCleanups) cleanup();
		markRuntimeDraining(signal);
		console.log(`[api] ${signal} received; readiness disabled and server draining`);
		void waitForGracefulShutdown(async () => {
			await app.close();
			const closeWorkflowQueue = (env as Readonly<{
				WORKFLOW_NODE_QUEUE_CLOSE?: () => Promise<void>;
			}>).WORKFLOW_NODE_QUEUE_CLOSE;
			await closeWorkflowQueue?.();
		}, 10_000)
			.then((outcome) => {
				if (outcome === "deadline_exceeded") {
					console.error("[api] graceful shutdown deadline exceeded; forcing process exit");
					process.exit(1);
					return;
				}
				console.log("[api] server closed");
				process.exit(0);
			})
			.catch((error: unknown) => {
				console.error("[api] graceful shutdown failed", error);
				process.exit(1);
			});
	};
	process.once("SIGTERM", () => shutdown("SIGTERM"));
	process.once("SIGINT", () => shutdown("SIGINT"));
}

void bootstrap();
