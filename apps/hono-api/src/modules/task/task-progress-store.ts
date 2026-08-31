import type { TaskProgressSnapshotDto } from "./task.schemas";

/**
 * Per-user "latest pending snapshot" store for GET /tasks/pending.
 *
 * Two backends:
 *  - Redis (scaling path): a hash per user keyed `taskprogress:{userId}`, with a
 *    refreshed PEXPIRE TTL so idle users self-expire and the data is shared across
 *    api replicas (removes the hidden sticky-session requirement). Used when a
 *    redis client is supplied.
 *  - In-memory fallback (default while api is a singleton): a bounded Map with a
 *    per-snapshot TTL (lazy expiry + opportunistic sweep) and a per-user LRU cap,
 *    so the store can never grow without bound — the root fix for the previous
 *    leak where user entries and non-terminal tasks were pinned forever.
 */

function normalizeVendorKey(vendor?: string): string {
  const v = (vendor || "").trim().toLowerCase();
  if (v === "google") return "gemini";
  return v;
}

export function makeStoredKey(input: {
  vendor?: string;
  nodeId?: string;
  taskId?: string;
}): string {
  const vendor = normalizeVendorKey(input.vendor);
  const nodeId = (input.nodeId || "").trim();
  const taskId = (input.taskId || "").trim();
  return [vendor || "*", nodeId || "*", taskId || "*"].join("|");
}

function isTerminal(status: TaskProgressSnapshotDto["status"]): boolean {
  return status === "succeeded" || status === "failed";
}

function isPending(status: TaskProgressSnapshotDto["status"]): boolean {
  return status === "queued" || status === "running";
}

interface RedisHashLike {
  hset(key: string, field: string, value: string): Promise<unknown>;
  hdel(key: string, field: string): Promise<unknown>;
  hgetall(key: string): Promise<Record<string, string>>;
  pexpire(key: string, ms: number): Promise<unknown>;
}

type StoredEntry = { snapshot: TaskProgressSnapshotDto; ts: number };

export interface TaskProgressStoreOptions {
  redis?: RedisHashLike | null;
  now?: () => number;
  ttlMs?: number;
  maxPerUser?: number;
}

const DEFAULT_TTL_MS = 10 * 60 * 1000; // 10 min
const DEFAULT_MAX_PER_USER = 100;
const SWEEP_INTERVAL_MS = 60 * 1000;

export class TaskProgressStore {
  private readonly redis: RedisHashLike | null;
  private readonly now: () => number;
  private readonly ttlMs: number;
  private readonly maxPerUser: number;
  private readonly mem = new Map<string, Map<string, StoredEntry>>();
  private lastSweepAt = 0;

  constructor(opts: TaskProgressStoreOptions = {}) {
    this.redis = opts.redis ?? null;
    this.now = opts.now ?? Date.now;
    this.ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
    this.maxPerUser = opts.maxPerUser ?? DEFAULT_MAX_PER_USER;
  }

  private redisKey(userId: string): string {
    return `taskprogress:${userId}`;
  }

  async store(userId: string, snapshot: TaskProgressSnapshotDto): Promise<void> {
    if (!userId) return;
    const field = makeStoredKey({
      vendor: snapshot.vendor,
      nodeId: snapshot.nodeId,
      taskId: snapshot.taskId,
    });

    if (this.redis) {
      const key = this.redisKey(userId);
      try {
        if (isTerminal(snapshot.status)) {
          await this.redis.hdel(key, field);
        } else {
          await this.redis.hset(key, field, JSON.stringify(snapshot));
          await this.redis.pexpire(key, this.ttlMs);
        }
      } catch (err) {
        console.warn("[task-progress] redis store failed", err);
      }
      return;
    }

    this.storeInMemory(userId, field, snapshot);
  }

  private storeInMemory(
    userId: string,
    field: string,
    snapshot: TaskProgressSnapshotDto,
  ): void {
    let store = this.mem.get(userId);
    if (isTerminal(snapshot.status)) {
      store?.delete(field);
      if (store && store.size === 0) this.mem.delete(userId);
      return;
    }
    if (!store) {
      store = new Map();
      this.mem.set(userId, store);
    }
    // refresh LRU position by deleting before re-inserting
    store.delete(field);
    store.set(field, { snapshot, ts: this.now() });
    while (store.size > this.maxPerUser) {
      const oldest = store.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      store.delete(oldest);
    }
    this.maybeSweep();
  }

  private maybeSweep(): void {
    const now = this.now();
    if (now - this.lastSweepAt < SWEEP_INTERVAL_MS) return;
    this.lastSweepAt = now;
    for (const [userId, store] of this.mem) {
      for (const [field, entry] of store) {
        if (now - entry.ts > this.ttlMs) store.delete(field);
      }
      if (store.size === 0) this.mem.delete(userId);
    }
  }

  async getPending(
    userId: string,
    vendor?: string,
  ): Promise<TaskProgressSnapshotDto[]> {
    if (!userId) return [];
    const targetVendor = normalizeVendorKey(vendor);
    const filterAndCollect = (
      snapshots: Iterable<TaskProgressSnapshotDto>,
    ): TaskProgressSnapshotDto[] => {
      const result: TaskProgressSnapshotDto[] = [];
      for (const s of snapshots) {
        if (!s || !isPending(s.status)) continue;
        if (targetVendor && normalizeVendorKey(s.vendor) !== targetVendor) continue;
        result.push(s);
      }
      return result;
    };

    if (this.redis) {
      try {
        const raw = await this.redis.hgetall(this.redisKey(userId));
        const snaps: TaskProgressSnapshotDto[] = [];
        for (const value of Object.values(raw || {})) {
          try {
            snaps.push(JSON.parse(value) as TaskProgressSnapshotDto);
          } catch {
            // skip corrupt entry
          }
        }
        return filterAndCollect(snaps);
      } catch (err) {
        console.warn("[task-progress] redis read failed", err);
        return [];
      }
    }

    const store = this.mem.get(userId);
    if (!store) return [];
    const now = this.now();
    const live: TaskProgressSnapshotDto[] = [];
    for (const [field, entry] of store) {
      if (now - entry.ts > this.ttlMs) {
        store.delete(field);
        continue;
      }
      live.push(entry.snapshot);
    }
    if (store.size === 0) this.mem.delete(userId);
    return filterAndCollect(live);
  }
}
