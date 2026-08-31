import { getSharedRedis } from "../../platform/redis-shared";

const TASK_POLL_LEASE_TTL_MS = 10 * 60 * 1000;
const TASK_POLL_LEASE_TTL_SECONDS = 10 * 60;
const TASK_POLL_LEASE_PREFIX = "taskpoll:";
const TASK_ASSET_HOSTING_LEASE_PREFIX = "taskasset-hosting:";

type TaskPollLeaseEntry = {
  token: string;
  expiresAt: number;
};

const taskPollLeases = new Map<string, TaskPollLeaseEntry>();
const taskAssetHostingLeases = new Map<string, TaskPollLeaseEntry>();

function buildTaskPollLeaseKey(userId: string, taskId: string): string {
  return `${userId}:${taskId}`;
}

function pruneExpiredLeases(
  leases: Map<string, TaskPollLeaseEntry>,
  nowMs: number,
): void {
  for (const [key, entry] of leases) {
    if (entry.expiresAt <= nowMs) leases.delete(key);
  }
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Redis 覆盖多副本，内存层覆盖无 Redis 的单进程开发环境。 */
async function acquireLease(
  input: {
  userId: string;
  taskId: string;
  nowMs?: number;
  },
  options: {
    leases: Map<string, TaskPollLeaseEntry>;
    prefix: string;
    label: string;
  },
): Promise<string | null> {
  const userId = String(input.userId ?? "").trim();
  const taskId = String(input.taskId ?? "").trim();
  if (!userId || !taskId) return null;
  const nowMs = input.nowMs ?? Date.now();
  const key = buildTaskPollLeaseKey(userId, taskId);
  pruneExpiredLeases(options.leases, nowMs);
  const current = options.leases.get(key);
  if (current && current.expiresAt > nowMs) return null;

  const token = `${process.pid}-${nowMs.toString(36)}-${Math.trunc(Math.random() * 1e9).toString(36)}`;
  const redis = getSharedRedis();
  if (redis) {
    try {
      const acquired = await redis.set(
        `${options.prefix}${key}`,
        token,
        "EX",
        TASK_POLL_LEASE_TTL_SECONDS,
        "NX",
      );
      if (acquired !== "OK") return null;
    } catch (error: unknown) {
      throw new Error(
        `${options.label}_acquire_failed: Redis lease unavailable for task ${taskId}: ${readErrorMessage(error)}`,
      );
    }
  }
  options.leases.set(key, { token, expiresAt: nowMs + TASK_POLL_LEASE_TTL_MS });
  return token;
}

async function releaseLease(
  input: {
  userId: string;
  taskId: string;
  token: string;
  },
  options: {
    leases: Map<string, TaskPollLeaseEntry>;
    prefix: string;
    label: string;
  },
): Promise<void> {
  const userId = String(input.userId ?? "").trim();
  const taskId = String(input.taskId ?? "").trim();
  const token = String(input.token ?? "").trim();
  if (!userId || !taskId || !token) return;
  const key = buildTaskPollLeaseKey(userId, taskId);
  const current = options.leases.get(key);
  if (current?.token === token) options.leases.delete(key);
  const redis = getSharedRedis();
  if (redis) {
    try {
      await redis.eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
        1,
        `${options.prefix}${key}`,
        token,
      );
    } catch (error: unknown) {
      throw new Error(
        `${options.label}_release_failed: Redis lease release unavailable for task ${taskId}: ${readErrorMessage(error)}`,
      );
    }
  }
}

/** 同一上游任务只允许一个请求查询供应商状态；租约不覆盖成品下载或 OSS 托管。 */
export function acquireTaskPollLease(input: {
  userId: string;
  taskId: string;
  nowMs?: number;
}): Promise<string | null> {
  return acquireLease(input, {
    leases: taskPollLeases,
    prefix: TASK_POLL_LEASE_PREFIX,
    label: "task_poll_lease",
  });
}

/** 仅当前 token 的持有者可释放状态查询租约。 */
export function releaseTaskPollLease(input: {
  userId: string;
  taskId: string;
  token: string;
}): Promise<void> {
  return releaseLease(input, {
    leases: taskPollLeases,
    prefix: TASK_POLL_LEASE_PREFIX,
    label: "task_poll_lease",
  });
}

/** 成品托管单独占用租约，避免慢下载阻塞供应商状态轮询。 */
export function acquireTaskAssetHostingLease(input: {
  userId: string;
  taskId: string;
  nowMs?: number;
}): Promise<string | null> {
  return acquireLease(input, {
    leases: taskAssetHostingLeases,
    prefix: TASK_ASSET_HOSTING_LEASE_PREFIX,
    label: "task_asset_hosting_lease",
  });
}

/** 仅当前 token 的持有者可释放成品托管租约。 */
export function releaseTaskAssetHostingLease(input: {
  userId: string;
  taskId: string;
  token: string;
}): Promise<void> {
  return releaseLease(input, {
    leases: taskAssetHostingLeases,
    prefix: TASK_ASSET_HOSTING_LEASE_PREFIX,
    label: "task_asset_hosting_lease",
  });
}
