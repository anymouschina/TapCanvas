import { Worker } from "bullmq";
import IORedis from "ioredis";
import { Agent, setGlobalDispatcher } from "undici";

import { loadLocalEnvFiles } from "../src/platform/node/local-env";
import { getPrismaClient } from "../src/platform/node/prisma";
import type { WorkerEnv } from "../src/types";
import type { AsyncImageQueueJob } from "../src/modules/task/async-image.queue";
import {
	markAsyncImageQueueJobFailed,
	processAsyncImageTask,
	sweepAsyncImageDispatches,
} from "../src/modules/task/async-image.processor";
import { QUEUE_NAMES } from "../src/modules/task/queues";
import { assertTaskPersistenceIntegrity } from "../src/modules/task/task-persistence-integrity";

setGlobalDispatcher(new Agent({ headersTimeout: 0, bodyTimeout: 0, connectTimeout: 30_000 }));

const ASYNC_IMAGE_DISPATCH_SWEEP_INTERVAL_MS = 10_000;

function createAsyncImageWorkerEnv(): WorkerEnv {
	if (!String(process.env.DATABASE_URL ?? "").trim()) {
		throw new Error("DATABASE_URL is required for the async image worker");
	}
	if (!String(process.env.INTERNAL_WORKER_TOKEN ?? "").trim()) {
		throw new Error("INTERNAL_WORKER_TOKEN is required for the async image worker");
	}
	return {
		...process.env,
		DB: getPrismaClient(),
		JWT_SECRET: String(process.env.JWT_SECRET ?? "dev-secret"),
	} as unknown as WorkerEnv;
}

async function main(): Promise<void> {
	loadLocalEnvFiles();
	const env = createAsyncImageWorkerEnv();
	await env.DB.$queryRaw`SELECT 1`;
	await assertTaskPersistenceIntegrity(env.DB);
	const redisUrl = String(process.env.REDIS_URL ?? "redis://127.0.0.1:6379").trim();
	const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
	const worker = new Worker<AsyncImageQueueJob>(
		QUEUE_NAMES.asyncImage,
		async (job) => {
			if (job.name !== "async-image") throw new Error(`unknown async image job: ${job.name}`);
			await processAsyncImageTask(env, job.data);
			console.log("[async-image-worker] job completed", JSON.stringify({ taskId: job.data.taskId }));
		},
		{ connection, concurrency: 2, maxStalledCount: 0 },
	);

	worker.on("failed", (job, error) => {
		console.error("[async-image-worker] job failed", {
			taskId: job?.data.taskId ?? null,
			message: error.message,
		});
		if (job) {
			void markAsyncImageQueueJobFailed(env, job.data, error).catch((markError: unknown) => {
				console.error(
					"[async-image-worker] failed to persist terminal failure",
					markError instanceof Error ? markError.message : String(markError),
				);
			});
		}
	});
	worker.on("error", (error) => console.error("[async-image-worker] worker error", error.message));

	let sweepRunning = false;
	const runSweep = async (): Promise<void> => {
		if (sweepRunning) return;
		sweepRunning = true;
		try {
			const result = await sweepAsyncImageDispatches({ env });
			if (result.scanned > 0 || result.recoveredClaims > 0 || result.failed > 0 || result.invalid > 0) {
				console.log("[async-image-worker] durable dispatch sweep", JSON.stringify(result));
			}
		} catch (error: unknown) {
			console.error(
				"[async-image-worker] durable dispatch sweep failed",
				error instanceof Error ? error.message : String(error),
			);
		} finally {
			sweepRunning = false;
		}
	};
	await runSweep();
	const sweepTimer = setInterval(() => void runSweep(), ASYNC_IMAGE_DISPATCH_SWEEP_INTERVAL_MS);
	console.log("[async-image-worker] started", JSON.stringify({ queues: [QUEUE_NAMES.asyncImage] }));

	let shutdownStarted = false;
	const shutdown = async (signal: string): Promise<void> => {
		if (shutdownStarted) return;
		shutdownStarted = true;
		console.log(`[async-image-worker] ${signal} -> shutting down`);
		clearInterval(sweepTimer);
		let exitCode = 0;
		try {
			await worker.close();
			await connection.quit();
		} catch (error: unknown) {
			exitCode = 1;
			console.error(
				"[async-image-worker] shutdown failed",
				error instanceof Error ? error.message : String(error),
			);
		}
		process.exit(exitCode);
	};
	process.once("SIGTERM", () => void shutdown("SIGTERM"));
	process.once("SIGINT", () => void shutdown("SIGINT"));
}

void main().catch((error: unknown) => {
	console.error("[async-image-worker] fatal", error instanceof Error ? error.message : String(error));
	process.exit(1);
});
