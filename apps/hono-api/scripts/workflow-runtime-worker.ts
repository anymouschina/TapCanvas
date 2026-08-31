import fs from "node:fs";

import { Agent, setGlobalDispatcher } from "undici";

import { loadLocalEnvFiles } from "../src/platform/node/local-env";
import {
	createNodeWorkerEnv,
	restorePersistedWorkflowState,
} from "../src/platform/node/node-env";
import { assertWorkflowRuntimeStartupReady } from "../src/platform/node/workflow-runtime-startup";
import { acquireWorkflowRuntimeOwnership } from "../src/platform/node/workflow-runtime-ownership";
import {
	handleWorkflowNodeJob,
	startPersistedWorkflowNodeReconciler,
} from "../src/modules/execution/execution.queue";
import { startLocalWorkflowScheduleScanner } from "../src/modules/execution/execution.schedule-runtime";
import { createRedisWorkflowNodeQueueConsumer } from "../src/modules/execution/execution.redis-queue";
import type { WorkerEnv } from "../src/types";
import { startWorkflowRuntimeControlServer } from "../src/platform/node/workflow-runtime-remote";

setGlobalDispatcher(new Agent({
	headersTimeout: 0,
	bodyTimeout: 0,
	connectTimeout: 30_000,
}));

loadLocalEnvFiles();

export const DEFAULT_WORKFLOW_RUNTIME_READY_FILE = "/tmp/tapcanvas-workflow-runtime-ready.json";

function readConcurrency(): number {
	const configured = Number(process.env.WORKFLOW_NODE_WORKER_CONCURRENCY ?? 8);
	if (!Number.isFinite(configured)) return 8;
	return Math.max(1, Math.min(32, Math.floor(configured)));
}

function writeReadyFile(filePath: string, startedAt: string): void {
	const nextPath = `${filePath}.next`;
	fs.writeFileSync(nextPath, JSON.stringify({
		version: 1,
		pid: process.pid,
		startedAt,
		heartbeatAt: new Date().toISOString(),
	}), { encoding: "utf8", mode: 0o600 });
	fs.renameSync(nextPath, filePath);
}

async function main(): Promise<void> {
	const redisUrl = String(process.env.REDIS_URL ?? "").trim();
	if (!redisUrl) throw new Error("Workflow runtime worker requires REDIS_URL");
	const readyFile = String(
		process.env.WORKFLOW_RUNTIME_READY_FILE ?? DEFAULT_WORKFLOW_RUNTIME_READY_FILE,
	).trim() || DEFAULT_WORKFLOW_RUNTIME_READY_FILE;
	fs.rmSync(readyFile, { force: true });

	const env = await createNodeWorkerEnv() as WorkerEnv & Readonly<{
		WORKFLOW_NODE_QUEUE_CLOSE?: () => Promise<void>;
	}>;
	if (!env.EXECUTION_DO) throw new Error("Workflow runtime worker requires local EXECUTION_DO");
	const startupFacts = assertWorkflowRuntimeStartupReady(env);
	const ownership = await acquireWorkflowRuntimeOwnership();
	try {
		await restorePersistedWorkflowState(env);
		ownership.assertOwned();
	} catch (error) {
		await ownership.release().catch(() => undefined);
		throw error;
	}

	const concurrency = readConcurrency();
	const controlServer = await startWorkflowRuntimeControlServer({
		namespace: env.EXECUTION_DO,
		token: String(process.env.INTERNAL_WORKER_TOKEN ?? ""),
		port: Number(process.env.WORKFLOW_RUNTIME_PORT ?? 8790),
	});
	const consumer = createRedisWorkflowNodeQueueConsumer({
		redisUrl,
		concurrency,
		dispatch: (job) => handleWorkflowNodeJob(env, job),
		onFailure: ({ job, error }) => {
			console.error("[workflow-node-worker] job failed", {
				executionId: job.executionId,
				nodeId: job.nodeId,
				nodeRunId: job.nodeRunId,
				attempt: job.attempt,
				phase: job.phase ?? "execute",
				error: error instanceof Error ? error.message : String(error),
			});
		},
	});
	const stopScheduleScanner = startLocalWorkflowScheduleScanner(env);
	const stopNodeReconciler = startPersistedWorkflowNodeReconciler(env);
	const startedAt = new Date().toISOString();
	writeReadyFile(readyFile, startedAt);
	const heartbeatTimer = setInterval(() => {
		writeReadyFile(readyFile, startedAt);
	}, 10_000);
	heartbeatTimer.unref?.();
	console.log("[workflow-runtime-worker] started", {
		concurrency,
		controlOrigin: controlServer.origin,
		...startupFacts,
	});

	let stopping = false;
	const stop = async (reason: string): Promise<void> => {
		if (stopping) return;
		stopping = true;
		console.log(`[workflow-runtime-worker] ${reason}; draining`);
		clearInterval(heartbeatTimer);
		fs.rmSync(readyFile, { force: true });
		stopScheduleScanner();
		stopNodeReconciler();
		await consumer.close();
		await controlServer.close();
		await env.WORKFLOW_NODE_QUEUE_CLOSE?.();
		await ownership.release();
	};

	void ownership.lost.then(async (loss) => {
		console.error("[workflow-runtime-worker] ownership lost", loss);
		await stop(loss.code).catch((error: unknown) => {
			console.error("[workflow-runtime-worker] ownership-loss shutdown failed", error);
		});
		process.exit(1);
	});
	process.once("SIGTERM", () => {
		void stop("SIGTERM").then(() => process.exit(0));
	});
	process.once("SIGINT", () => {
		void stop("SIGINT").then(() => process.exit(0));
	});
}

main().catch((error: unknown) => {
	console.error("[workflow-runtime-worker] fatal", error instanceof Error ? error.message : String(error));
	process.exit(1);
});
