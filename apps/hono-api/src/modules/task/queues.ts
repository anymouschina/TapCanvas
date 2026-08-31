import IORedis, { type RedisOptions } from "ioredis";

/**
 * Shared BullMQ queue substrate for the api→worker migration.
 *
 * The api tier enqueues real-payload jobs here and returns immediately; the
 * worker tiers (poller + media) dequeue and execute in their own processes,
 * isolated from the user-facing api heap. Names are defined ONCE here and
 * imported by both src (enqueue) and the worker scripts (dequeue) so they can
 * never drift.
 *
 * BullMQ v5 rejects ':' in queue names — use hyphens only.
 */
export const QUEUE_NAMES = {
  /** Poll an already-submitted upstream task to completion, then host + persist. */
  taskPoll: "tapcanvas-task-poll",
  /** ffmpeg/chromium/scenedetect media jobs offloaded from the api container. */
  mediaJobs: "tapcanvas-media-jobs",
  /** Provider orchestration only; build commands execute inside Vercel Sandbox. */
  codexRemoteBuild: "tapcanvas-codex-remote-build",
  /** Execute one accepted synchronous image provider call outside the restartable API process. */
  asyncImage: "tapcanvas-async-image",
  /** Resume one durable agents continuation under a bounded worker concurrency. */
  asyncAgentContinuation: "tapcanvas-async-agent-continuation",
  /** Recover one continuation-registration settlement without waiting behind a long agent run. */
  continuationSettlement: "tapcanvas-continuation-settlement",
  /**
   * Enforce the execution-anchored public-chat video provider-acceptance SLA.
   *
   * This queue name is intentionally generation-scoped. The v1 consumer used
   * request acceptance as its authority; allowing it to consume v2 jobs lets a
   * stale worker cancel executions before their immutable execution deadline.
   */
  publicChatVideoProductionDeadline: "tapcanvas-public-chat-video-production-deadline-v2",
} as const satisfies Record<string, string>;

export function assertValidQueueName(name: string): string {
  if (name.includes(":")) {
    throw new Error(
      `BullMQ v5 queue name must not contain ':' — got "${name}" (use hyphens)`,
    );
  }
  if (!name.trim()) throw new Error("queue name must be non-empty");
  return name;
}

/**
 * BullMQ REQUIRES a dedicated ioredis connection with maxRetriesPerRequest:null.
 * getSharedRedis() (maxRetriesPerRequest:2, src/platform/redis-shared.ts) is NOT
 * compatible and must not be reused for queues — hence a separate connection here.
 */
export function resolveQueueConnectionOptions(
  url?: string,
): { url: string; options: RedisOptions } {
  const redisUrl = (url ?? process.env.REDIS_URL ?? "").trim();
  if (!redisUrl) {
    throw new Error("REDIS_URL is required for the BullMQ job queue");
  }
  return {
    url: redisUrl,
    options: { maxRetriesPerRequest: null, enableOfflineQueue: true },
  };
}

export function makeQueueConnection(url?: string): IORedis {
  const { url: redisUrl, options } = resolveQueueConnectionOptions(url);
  return new IORedis(redisUrl, options);
}
