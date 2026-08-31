import IORedis from "ioredis";

/**
 * Shared lazily-created ioredis singleton for cross-replica coordination
 * (task-progress snapshots, and future cluster-global counters). Reads
 * REDIS_URL from the Node process env; returns null when unset so callers
 * transparently fall back to in-process state (tests / local dev without redis).
 */
let client: IORedis | null = null;
let clientUrl = "";
let unavailableUntil = 0;
let lastErrorLogAt = 0;

const REDIS_CONNECT_TIMEOUT_MS = 500;
const REDIS_COMMAND_TIMEOUT_MS = 750;
const REDIS_UNAVAILABLE_COOLDOWN_MS = 2_000;
const REDIS_ERROR_LOG_THROTTLE_MS = 5_000;

export function getSharedRedis(): IORedis | null {
  const url = String(process.env.REDIS_URL || "").trim();
  if (!url) return null;
  const now = Date.now();
  if (now < unavailableUntil) return null;
  if (client && (client.status === "end" || client.status === "close")) {
    client = null;
    clientUrl = "";
  }
  if (client && clientUrl === url) return client;
  if (client) {
    void client.quit().catch(() => undefined);
    client = null;
  }
  const next = new IORedis(url, {
    connectTimeout: REDIS_CONNECT_TIMEOUT_MS,
    commandTimeout: REDIS_COMMAND_TIMEOUT_MS,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: true,
    retryStrategy: () => null,
  });
  next.on("error", (err: unknown) => {
    const errorAt = Date.now();
    unavailableUntil = Math.max(
      unavailableUntil,
      errorAt + REDIS_UNAVAILABLE_COOLDOWN_MS,
    );
    if (errorAt - lastErrorLogAt >= REDIS_ERROR_LOG_THROTTLE_MS) {
      lastErrorLogAt = errorAt;
      console.error(
        "[redis-shared] unavailable; callers will use their local/durable fallback",
        (err as { message?: string })?.message || err,
      );
    }
  });
  next.on("ready", () => {
    unavailableUntil = 0;
  });
  client = next;
  clientUrl = url;
  return client;
}
