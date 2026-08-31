import { randomUUID } from "node:crypto";
import { Worker } from "bullmq";
import { loadLocalEnvFiles } from "../src/platform/node/local-env";
import { createNodeWorkerEnv } from "../src/platform/node/node-env";
import {
	makeQueueConnection,
	QUEUE_NAMES,
} from "../src/modules/task/queues";
import type { CodexRemoteBuildJobData } from "../src/modules/codex/codex-remote-build-queue";
import { executeCodexRemoteBuildJob } from "../src/modules/codex/codex-remote-build-processor";
import {
	assertCodexRemoteBuilderConfigured,
	codexRemoteBuilderEnvironmentFromProcess,
} from "../src/modules/codex/codex-remote-builder-config";
import {
	assertCodexRemoteBuilderReady,
	clearCodexRemoteBuilderHeartbeat,
	CODEX_REMOTE_BUILDER_HEARTBEAT_INTERVAL_MS,
	publishCodexRemoteBuilderHeartbeat,
} from "../src/modules/codex/codex-remote-builder-readiness";

async function runHealthcheck(): Promise<void> {
	loadLocalEnvFiles();
	const env = codexRemoteBuilderEnvironmentFromProcess();
	assertCodexRemoteBuilderConfigured(env);
	const connection = makeQueueConnection(env.REDIS_URL);
	try {
		await assertCodexRemoteBuilderReady({ redis: connection, env });
	} finally {
		await connection.quit();
	}
}

async function runWorker(): Promise<void> {
	loadLocalEnvFiles();
	const env = await createNodeWorkerEnv();
	assertCodexRemoteBuilderConfigured(env);
	const connection = makeQueueConnection(env.REDIS_URL);
	const worker = new Worker<CodexRemoteBuildJobData>(
		QUEUE_NAMES.codexRemoteBuild,
		async (job) => executeCodexRemoteBuildJob(job.data, env),
		{
			connection,
			autorun: false,
			concurrency: 1,
			limiter: { max: 1, duration: 1_000 },
		},
	);
	const instanceId = randomUUID();
	const startedAtMs = Date.now();
	let heartbeatTimer: NodeJS.Timeout | null = null;
	let heartbeatRefreshRunning = false;
	let pausedForHeartbeatFailure = false;
	let closing = false;

	worker.on("completed", (job) => {
		console.log(
			"[codex-remote-builder] completed",
			JSON.stringify({ jobId: job.id, taskId: job.data.taskId }),
		);
	});
	worker.on("failed", (job, error) => {
		console.error(
			"[codex-remote-builder] failed",
			JSON.stringify({
				jobId: job?.id ?? null,
				taskId: job?.data.taskId ?? null,
				error: error.message,
			}),
		);
	});
	worker.on("error", (error) => {
		console.error("[codex-remote-builder] worker error", error.message);
	});

	const refreshHeartbeat = async (): Promise<void> => {
		if (closing || heartbeatRefreshRunning) return;
		heartbeatRefreshRunning = true;
		try {
			await publishCodexRemoteBuilderHeartbeat({
				redis: connection,
				env,
				instanceId,
				startedAtMs,
			});
			if (pausedForHeartbeatFailure) {
				await worker.resume();
				pausedForHeartbeatFailure = false;
				console.log(
					"[codex-remote-builder] heartbeat recovered; queue consumption resumed",
				);
			}
		} catch (error: unknown) {
			console.error(
				"[codex-remote-builder] heartbeat publish failed",
				error instanceof Error ? error.message : String(error),
			);
			if (!pausedForHeartbeatFailure) {
				try {
					await worker.pause(true);
					pausedForHeartbeatFailure = true;
					console.error(
						"[codex-remote-builder] queue consumption paused until heartbeat recovers",
					);
				} catch (pauseError: unknown) {
					console.error(
						"[codex-remote-builder] failed to pause after heartbeat loss",
						pauseError instanceof Error
							? pauseError.message
							: String(pauseError),
					);
				}
			}
		} finally {
			heartbeatRefreshRunning = false;
		}
	};

	const shutdown = async (signal: string): Promise<void> => {
		if (closing) return;
		closing = true;
		if (heartbeatTimer) clearInterval(heartbeatTimer);
		console.log(`[codex-remote-builder] ${signal} → shutting down`);
		try {
			await clearCodexRemoteBuilderHeartbeat({
				redis: connection,
				env,
				instanceId,
			});
		} catch (error: unknown) {
			console.error(
				"[codex-remote-builder] heartbeat cleanup failed; TTL expiry remains active",
				error instanceof Error ? error.message : String(error),
			);
		}
		await worker.close();
		await connection.quit();
	};

	try {
		await worker.waitUntilReady();
		await publishCodexRemoteBuilderHeartbeat({
			redis: connection,
			env,
			instanceId,
			startedAtMs,
		});
	} catch (error: unknown) {
		await worker.close(true).catch(() => undefined);
		connection.disconnect();
		throw error;
	}

	void worker.run().catch((error: unknown) => {
		if (closing) return;
		console.error(
			"[codex-remote-builder] run loop failed",
			error instanceof Error ? error.message : String(error),
		);
		void shutdown("worker error").finally(() => process.exit(1));
	});
	heartbeatTimer = setInterval(() => {
		void refreshHeartbeat();
	}, CODEX_REMOTE_BUILDER_HEARTBEAT_INTERVAL_MS);
	heartbeatTimer.unref();
	process.once("SIGINT", () => {
		void shutdown("SIGINT").finally(() => process.exit(0));
	});
	process.once("SIGTERM", () => {
		void shutdown("SIGTERM").finally(() => process.exit(0));
	});
	console.log(
		"[codex-remote-builder] started",
		JSON.stringify({
			queue: QUEUE_NAMES.codexRemoteBuild,
			concurrency: 1,
			instanceId,
		}),
	);
}

const healthcheckRequested = process.argv.slice(2).includes("--healthcheck");
void (healthcheckRequested ? runHealthcheck() : runWorker()).catch(
	(error: unknown) => {
		console.error(
			healthcheckRequested
				? "[codex-remote-builder] healthcheck failed"
				: "[codex-remote-builder] startup failed",
			error instanceof Error ? error.message : String(error),
		);
		process.exit(1);
	},
);
