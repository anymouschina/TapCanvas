import { describe, expect, it, vi } from "vitest";

import { TaskProgressStore, makeStoredKey } from "./task-progress-store";
import type { TaskProgressSnapshotDto } from "./task.schemas";

function snap(p: Partial<TaskProgressSnapshotDto>): TaskProgressSnapshotDto {
  return {
    status: "running",
    timestamp: 1,
    ...p,
  } as TaskProgressSnapshotDto;
}

// A minimal in-memory fake of the ioredis hash commands the store uses.
function makeFakeRedis() {
  const hashes = new Map<string, Map<string, string>>();
  const expires = new Map<string, number>();
  return {
    hset: vi.fn(async (key: string, field: string, value: string) => {
      let h = hashes.get(key);
      if (!h) {
        h = new Map();
        hashes.set(key, h);
      }
      h.set(field, value);
      return 1;
    }),
    hdel: vi.fn(async (key: string, field: string) => {
      hashes.get(key)?.delete(field);
      return 1;
    }),
    hgetall: vi.fn(async (key: string) => {
      const h = hashes.get(key);
      if (!h) return {};
      return Object.fromEntries(h.entries());
    }),
    pexpire: vi.fn(async (key: string, ms: number) => {
      expires.set(key, ms);
      return 1;
    }),
    __hashes: hashes,
    __expires: expires,
  };
}

describe("TaskProgressStore (in-memory fallback)", () => {
  it("stores a running snapshot and returns it for the user", async () => {
    const store = new TaskProgressStore({});
    await store.store("u1", snap({ vendor: "gemini", nodeId: "n1", taskId: "t1", status: "running" }));
    const pending = await store.getPending("u1");
    expect(pending).toHaveLength(1);
    expect(pending[0]!.taskId).toBe("t1");
  });

  it("removes the entry when a terminal status arrives", async () => {
    const store = new TaskProgressStore({});
    await store.store("u1", snap({ taskId: "t1", status: "running" }));
    await store.store("u1", snap({ taskId: "t1", status: "succeeded" }));
    expect(await store.getPending("u1")).toHaveLength(0);
  });

  it("returns only queued/running and filters by vendor", async () => {
    const store = new TaskProgressStore({});
    await store.store("u1", snap({ taskId: "t1", vendor: "gemini", status: "running" }));
    await store.store("u1", snap({ taskId: "t2", vendor: "ark", status: "queued" }));
    expect(await store.getPending("u1")).toHaveLength(2);
    const onlyGemini = await store.getPending("u1", "google"); // google -> gemini alias
    expect(onlyGemini).toHaveLength(1);
    expect(onlyGemini[0]!.taskId).toBe("t1");
  });

  it("expires snapshots older than the TTL (no unbounded growth)", async () => {
    let now = 1000;
    const store = new TaskProgressStore({ ttlMs: 500, now: () => now });
    await store.store("u1", snap({ taskId: "t1", status: "running" }));
    now = 1400; // within TTL
    expect(await store.getPending("u1")).toHaveLength(1);
    now = 1600; // past TTL
    expect(await store.getPending("u1")).toHaveLength(0);
  });

  it("caps entries per user (LRU) so a task-spamming user cannot grow unboundedly", async () => {
    const store = new TaskProgressStore({ maxPerUser: 2 });
    await store.store("u1", snap({ taskId: "t1", status: "running" }));
    await store.store("u1", snap({ taskId: "t2", status: "running" }));
    await store.store("u1", snap({ taskId: "t3", status: "running" }));
    const pending = await store.getPending("u1");
    expect(pending).toHaveLength(2);
    // oldest (t1) evicted, newest two retained
    expect(pending.map((p) => p.taskId).sort()).toEqual(["t2", "t3"]);
  });
});

describe("TaskProgressStore (redis backend)", () => {
  it("writes the snapshot to a hash with a refreshed TTL and reads it back", async () => {
    const redis = makeFakeRedis();
    const store = new TaskProgressStore({ redis, ttlMs: 600000 });
    await store.store("u1", snap({ vendor: "gemini", nodeId: "n1", taskId: "t1", status: "running" }));

    const key = "taskprogress:u1";
    expect(redis.hset).toHaveBeenCalledWith(
      key,
      makeStoredKey({ vendor: "gemini", nodeId: "n1", taskId: "t1" }),
      expect.any(String),
    );
    expect(redis.pexpire).toHaveBeenCalledWith(key, 600000);

    const pending = await store.getPending("u1");
    expect(pending).toHaveLength(1);
    expect(pending[0]!.taskId).toBe("t1");
  });

  it("HDELs the field on a terminal status", async () => {
    const redis = makeFakeRedis();
    const store = new TaskProgressStore({ redis });
    await store.store("u1", snap({ taskId: "t1", status: "running" }));
    await store.store("u1", snap({ taskId: "t1", status: "failed" }));
    expect(redis.hdel).toHaveBeenCalledWith(
      "taskprogress:u1",
      makeStoredKey({ taskId: "t1" }),
    );
    expect(await store.getPending("u1")).toHaveLength(0);
  });

  it("falls back to in-memory when a redis read throws (never breaks /tasks/pending)", async () => {
    const redis = makeFakeRedis();
    redis.hgetall.mockRejectedValueOnce(new Error("redis down"));
    const store = new TaskProgressStore({ redis });
    await store.store("u1", snap({ taskId: "t1", status: "running" }));
    // read throws -> resolves to [] rather than rejecting
    await expect(store.getPending("u1")).resolves.toEqual([]);
  });
});
