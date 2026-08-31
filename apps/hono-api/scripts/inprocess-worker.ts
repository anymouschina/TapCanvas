/**
 * In-process background worker (root fix ③ / P2).
 *
 * Unlike scripts/credit-finalizer-worker.mjs — which is a BullMQ timer that HTTP-calls
 * back into the api container so all heavy work runs in the api heap — this entry runs
 * the drive loop + finalizer + sweeps IN ITS OWN PROCESS (via runFinalizerTick /
 * runMediaRecoveryTick), with its own Prisma client and its own undici dispatcher. That
 * physically isolates background generation/hosting/concat memory from the user-facing
 * api heap, which is the whole point of the migration.
 *
 * Compose exposes one historical service slot (`credit-finalizer-worker`) and that slot
 * runs this entry only. Keeping the service name lets Compose stop the legacy container
 * before starting this process; there is no second profile that can drive the same DB.
 *
 * Production and Compose run the bundled dist/inprocess-worker.js entry.
 */
import fs from "node:fs";

import * as bullmq from "bullmq";
import IORedis from "ioredis";
import { setGlobalDispatcher, Agent } from "undici";

import { loadLocalEnvFiles } from "../src/platform/node/local-env";
import { createNodeWorkerEnv } from "../src/platform/node/node-env";
import {
  buildInternalContext,
  runAsyncAgentContinuationSweepTick,
  runFinalizerTick,
  runMediaRecoveryTick,
} from "../src/modules/internal/inprocess-tasks";
import {
  QUEUE_NAMES,
} from "../src/modules/task/queues";
import type {
  AsyncAgentContinuationQueueJob,
  ContinuationSettlementQueueJob,
} from "../src/modules/task/async-agent-continuation.queue";
import { runAsyncAgentContinuation } from "../src/modules/task/public-agents-chat";
import type { PublicChatVideoProductionDeadlineJob } from "../src/modules/task/public-chat-video-production-deadline.queue";
import { enforcePublicChatVideoProductionDeadline } from "../src/modules/task/public-chat-video-production-deadline.worker";
import {
  claimQueuedAsyncAgentContinuation,
} from "../src/modules/task/async-agent-continuation";
import { recoverAsyncAgentContinuationRegistration } from "../src/modules/task/async-agent-continuation-registration-recovery";
import { executeContinuationSettlementRecoveryCapsule } from "../src/modules/task/agents-continuation-settlement";
import { enqueueAsyncAgentContinuations } from "../src/modules/task/async-agent-continuation.queue";
import { assertInternalWorkerTickSucceeded } from "../src/modules/internal/internal-worker-diagnostics";
import { installExclusiveRepeatableTick } from "../src/modules/internal/repeatable-tick-ownership";
import { retireRepeatableQueue } from "../src/modules/internal/retired-repeatable-queue";
import {
  createInprocessWorkerHealthState,
  DEFAULT_INPROCESS_WORKER_READY_FILE,
  recordInprocessWorkerHealth,
  type InprocessWorkerHealthLane,
} from "../src/modules/internal/inprocess-worker-health";

// Own undici dispatcher with no header/body timeout — long generation polls must not be
// cut by undici (the AbortController deadlines in callJsonApi are the real limits). This
// is isolated from the api process's dispatcher.
setGlobalDispatcher(new Agent({ headersTimeout: 0, bodyTimeout: 0, connectTimeout: 30_000 }));

const { Queue, Worker } = bullmq;

loadLocalEnvFiles();

function readIntEnv(name: string, fallback: number): number {
  const raw = String(process.env[name] ?? "").trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

const redisUrl = String(process.env.REDIS_URL ?? "redis://127.0.0.1:6379").trim();
const finalizerQueueName = "tapcanvas-inprocess-finalizer";
const mediaRecoveryQueueName = "tapcanvas-inprocess-media-recovery";
const asyncContinuationSweepQueueName = "tapcanvas-inprocess-async-continuation-sweep";
const retiredRepeatableQueueNames = [
  "tapcanvas-video-run-driver",
  "tapcanvas-credit-finalizer",
] as const;
const finalizerEveryMs = Math.max(5_000, readIntEnv("INPROCESS_FINALIZER_EVERY_MS", 60_000));
const mediaRecoveryEveryMs = Math.max(5_000, readIntEnv("INPROCESS_MEDIA_RECOVERY_EVERY_MS", 60_000));
const asyncContinuationSweepEveryMs = Math.max(
  2_000,
  readIntEnv("INPROCESS_ASYNC_CONTINUATION_SWEEP_EVERY_MS", 5_000),
);
const asyncContinuationConcurrency = Math.max(
  1,
  Math.min(4, readIntEnv("ASYNC_AGENT_CONTINUATION_CONCURRENCY", 2)),
);
const configuredReadyFilePath = String(
  process.env.INPROCESS_WORKER_READY_FILE ?? DEFAULT_INPROCESS_WORKER_READY_FILE,
).trim();
const readyFilePath = configuredReadyFilePath || DEFAULT_INPROCESS_WORKER_READY_FILE;
let healthState = createInprocessWorkerHealthState(process.pid);

function recordWorkerHealth(lane: InprocessWorkerHealthLane): void {
  const nowIso = new Date().toISOString();
  healthState = recordInprocessWorkerHealth(healthState, lane, nowIso);
  const nextPath = `${readyFilePath}.next`;
  fs.writeFileSync(nextPath, JSON.stringify(healthState), { encoding: "utf8", mode: 0o600 });
  fs.renameSync(nextPath, readyFilePath);
}

async function main(): Promise<void> {
  fs.rmSync(readyFilePath, { force: true });
  const env = await createNodeWorkerEnv();

  // Dedicated BullMQ connection (maxRetriesPerRequest MUST be null for BullMQ).
  const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
  connection.on("error", (error) => {
    console.error("[inprocess-worker] redis connection error", error);
  });

  const finalizerQueue = new Queue<Record<string, never>, void, string>(finalizerQueueName, { connection });
  const mediaRecoveryQueue = new Queue<Record<string, never>, void, string>(mediaRecoveryQueueName, { connection });
  const asyncContinuationSweepQueue = new Queue<Record<string, never>, void, string>(
    asyncContinuationSweepQueueName,
    { connection },
  );
  const retiredRepeatableQueues = retiredRepeatableQueueNames.map((queueName) => ({
    queueName,
    queue: new Queue<Record<string, never>, void, string>(queueName, { connection }),
  }));
  const asyncAgentContinuationQueue = new Queue<AsyncAgentContinuationQueueJob>(
    QUEUE_NAMES.asyncAgentContinuation,
    { connection },
  );
  const continuationSettlementQueue = new Queue<ContinuationSettlementQueueJob>(
    QUEUE_NAMES.continuationSettlement,
    { connection },
  );

  // Hard-cut retired timer namespaces before registering current consumers. Their
  // business evidence already lives in PostgreSQL; retaining hundreds of thousands
  // of completed 5-second tick hashes only inflates Redis persistence and can make
  // the current workflow-runtime lease miss its renewal deadline.
  const retiredQueueResults = await Promise.all(retiredRepeatableQueues.map(({ queueName, queue }) => (
    retireRepeatableQueue({ queueName, queue })
  )));
  console.log("[inprocess-worker] retired queue cleanup", JSON.stringify(retiredQueueResults));

  // BullMQ repeat metadata survives containers, so normalize each current dedicated
  // queue to exactly one schedule before registering consumers.
  await Promise.all([
    installExclusiveRepeatableTick({
      queue: finalizerQueue,
      name: "tick",
      everyMs: finalizerEveryMs,
      jobId: "inprocess-finalizer",
    }),
    installExclusiveRepeatableTick({
      queue: mediaRecoveryQueue,
      name: "tick",
      everyMs: mediaRecoveryEveryMs,
      jobId: "inprocess-media-recovery",
    }),
    installExclusiveRepeatableTick({
      queue: asyncContinuationSweepQueue,
      name: "tick",
      everyMs: asyncContinuationSweepEveryMs,
      jobId: "inprocess-async-continuation-sweep",
    }),
  ]);

  const finalizerWorker = new Worker<Record<string, never>, void, string>(
    finalizerQueueName,
    async (job) => {
      if (job.name !== "tick") throw new Error(`unknown finalizer job: ${job.name}`);
      const out = await runFinalizerTick(env);
      console.log("[inprocess-worker] finalizer tick", JSON.stringify(out).slice(0, 1000));
      assertInternalWorkerTickSucceeded("finalizer", out);
      recordWorkerHealth("finalizer");
    },
    { connection, concurrency: 1 },
  );
  const mediaRecoveryWorker = new Worker<Record<string, never>, void, string>(
    mediaRecoveryQueueName,
    async (job) => {
      if (job.name !== "tick") throw new Error(`unknown media recovery job: ${job.name}`);
      const out = await runMediaRecoveryTick(env);
      console.log("[inprocess-worker] media recovery tick", JSON.stringify(out).slice(0, 1000));
      assertInternalWorkerTickSucceeded("media recovery", out);
      recordWorkerHealth("media_recovery");
    },
    { connection, concurrency: 1 },
  );
  const asyncContinuationSweepWorker = new Worker<Record<string, never>, void, string>(
    asyncContinuationSweepQueueName,
    async (job) => {
      if (job.name !== "tick") throw new Error(`unknown async continuation sweep job: ${job.name}`);
      const out = await runAsyncAgentContinuationSweepTick(env);
      console.log("[inprocess-worker] async continuation sweep tick", JSON.stringify(out).slice(0, 1000));
      assertInternalWorkerTickSucceeded("async continuation sweep", out);
      recordWorkerHealth("continuation_sweep");
    },
    { connection, concurrency: 1 },
  );
  const asyncAgentContinuationWorker = new Worker<AsyncAgentContinuationQueueJob>(
    QUEUE_NAMES.asyncAgentContinuation,
    async (job) => {
      const c = buildInternalContext(env);
      if (job.name !== "resume") throw new Error(`unknown async continuation job: ${job.name}`);
      const continuation = await claimQueuedAsyncAgentContinuation({
        c,
        expected: job.data.continuation,
      });
      if (!continuation) return;
      await runAsyncAgentContinuation(c, continuation);
      recordWorkerHealth("continuation");
    },
    {
      connection,
      concurrency: asyncContinuationConcurrency,
      // BullMQ transport replay must never execute the same durable claim token
      // twice. The task-status lease owns recovery and mints a fresh token.
      maxStalledCount: 0,
    },
  );
  const continuationSettlementWorker = new Worker<ContinuationSettlementQueueJob>(
    QUEUE_NAMES.continuationSettlement,
    async (job) => {
      if (job.name !== "recover-settlement") {
        throw new Error(`unknown continuation settlement job: ${job.name}`);
      }
      const c = buildInternalContext(env);
      const outcome = await executeContinuationSettlementRecoveryCapsule({
        c,
        record: job.data.record,
        execute: async (capsule) => {
          await recoverAsyncAgentContinuationRegistration({
            c,
            continuation: capsule.continuation,
            enqueue: enqueueAsyncAgentContinuations,
          });
        },
      });
      console.log("[inprocess-worker] continuation settlement", JSON.stringify({
        effectId: job.data.record.effectId,
        publicTurnId: job.data.record.publicTurnId,
        outcome,
      }));
      recordWorkerHealth("continuation_settlement");
    },
    { connection, concurrency: 1, maxStalledCount: 0 },
  );
  const videoProductionDeadlineWorker = new Worker<PublicChatVideoProductionDeadlineJob>(
    QUEUE_NAMES.publicChatVideoProductionDeadline,
    async (job) => {
      if (job.name !== "enforce") {
        throw new Error(`unknown video production deadline job: ${job.name}`);
      }
      const outcome = await enforcePublicChatVideoProductionDeadline(
        buildInternalContext(env),
        job.data,
      );
      console.log("[inprocess-worker] video production deadline", JSON.stringify(outcome));
      recordWorkerHealth("video_production_deadline");
    },
    { connection, concurrency: 2, maxStalledCount: 0 },
  );
  for (const w of [
    finalizerWorker,
    mediaRecoveryWorker,
    asyncContinuationSweepWorker,
    asyncAgentContinuationWorker,
    continuationSettlementWorker,
    videoProductionDeadlineWorker,
  ]) {
    w.on("failed", (_job, err) => console.error("[inprocess-worker] job failed", err?.message || err));
    w.on("error", (err) => console.error("[inprocess-worker] worker error", err));
  }

  await Promise.all([
    finalizerWorker.waitUntilReady(),
    mediaRecoveryWorker.waitUntilReady(),
    asyncContinuationSweepWorker.waitUntilReady(),
    asyncAgentContinuationWorker.waitUntilReady(),
    continuationSettlementWorker.waitUntilReady(),
    videoProductionDeadlineWorker.waitUntilReady(),
  ]);
  recordWorkerHealth("startup");
  console.log("[inprocess-worker] started (Workflow IR workers + media recovery + finalizer)");

  let shutdownStarted = false;
  const shutdown = async (sig: string): Promise<void> => {
    if (shutdownStarted) return;
    shutdownStarted = true;
    fs.rmSync(readyFilePath, { force: true });
    console.log(`[inprocess-worker] ${sig} → shutting down`);
    let exitCode = 0;
    try {
      const workers = [
        finalizerWorker,
        mediaRecoveryWorker,
        asyncContinuationSweepWorker,
        asyncAgentContinuationWorker,
        continuationSettlementWorker,
        videoProductionDeadlineWorker,
      ];
      await Promise.all(workers.map((worker) => worker.pause(true)));
      await Promise.all(workers.map((worker) => worker.close()));
      await Promise.all([
        finalizerQueue.close(),
        mediaRecoveryQueue.close(),
        asyncContinuationSweepQueue.close(),
        asyncAgentContinuationQueue.close(),
        continuationSettlementQueue.close(),
        ...retiredRepeatableQueues.map(({ queue }) => queue.close()),
      ]);
      await connection.quit();
    } catch (err) {
      console.error("[inprocess-worker] shutdown error", err);
      exitCode = 1;
    }
    process.exit(exitCode);
  };
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
}

void main().catch((err) => {
  fs.rmSync(readyFilePath, { force: true });
  console.error("[inprocess-worker] fatal", err);
  process.exit(1);
});
