import { beforeEach, describe, it, expect, vi } from "vitest";

const {
  acquireProductionRunLease,
  findLatestProductionEffect,
  releaseProductionRunLease,
  renewProductionRunLease,
  resetLeaseStore,
} = vi.hoisted(() => {
  const leases = new Map<string, string>();
  let tokenSequence = 0;
  return {
    findLatestProductionEffect: vi.fn(),
    acquireProductionRunLease: vi.fn(async (leaseKey: string) => {
      if (leases.has(leaseKey)) return null;
      const token = `lease-${++tokenSequence}`;
      leases.set(leaseKey, token);
      return token;
    }),
    renewProductionRunLease: vi.fn(async (leaseKey: string, token: string) => (
      leases.get(leaseKey) === token
    )),
    releaseProductionRunLease: vi.fn(async (leaseKey: string, token: string) => {
      if (leases.get(leaseKey) !== token) return false;
      leases.delete(leaseKey);
      return true;
    }),
    resetLeaseStore: () => {
      leases.clear();
      tokenSequence = 0;
    },
  };
});

vi.mock("./production-effect-ledger", () => ({ findLatestProductionEffect }));
vi.mock("./production-run-lease", () => ({
  acquireProductionRunLease,
  renewProductionRunLease,
  releaseProductionRunLease,
  PRODUCTION_RUN_LEASE_RENEW_INTERVAL_MS: 60_000,
}));

import {
  getClipInflightTask,
  acquireRunDriveLock,
  renewRunDriveLock,
  releaseRunDriveLock,
} from "./video-orchestrator.clip-inflight";

beforeEach(() => {
  resetLeaseStore();
  acquireProductionRunLease.mockClear();
  renewProductionRunLease.mockClear();
  releaseProductionRunLease.mockClear();
  findLatestProductionEffect.mockReset();
  findLatestProductionEffect.mockResolvedValue(null);
});

describe("clip 在飞 Effect Ledger 投影", () => {
  it("只返回 accepted/uncertain 的持久 provider task", async () => {
    findLatestProductionEffect.mockResolvedValue({
      providerTaskId: "task_abc",
      status: "accepted",
    });
    expect(await getClipInflightTask("run-t1", 3)).toBe("task_abc");
    expect(findLatestProductionEffect).toHaveBeenCalledWith({
      runId: "run-t1",
      effectKey: "video-clip:3",
    });
  });

  it("materialized/failed effect 不再投影为在飞任务", async () => {
    findLatestProductionEffect.mockResolvedValue({
      providerTaskId: "task_done",
      status: "materialized",
    });
    expect(await getClipInflightTask("run-t1", 3)).toBeNull();
  });

  it("非法入参不查询账本", async () => {
    expect(await getClipInflightTask("", 0)).toBeNull();
    expect(await getClipInflightTask("run-t2", -1)).toBeNull();
    expect(findLatestProductionEffect).not.toHaveBeenCalled();
  });
});

describe("run 级驱动互斥锁（根治双开·2026-07-10 用户令「不能一个场景补一次」）", () => {
  it("同 runId 第二个获取者拿不到锁；释放后可再获取", async () => {
    const t1 = await acquireRunDriveLock("run-lock-a");
    expect(t1).toBeTruthy();
    const t2 = await acquireRunDriveLock("run-lock-a");
    expect(t2).toBeNull();
    await releaseRunDriveLock("run-lock-a", t1 as string);
    const t3 = await acquireRunDriveLock("run-lock-a");
    expect(t3).toBeTruthy();
    await releaseRunDriveLock("run-lock-a", t3 as string);
  });
  it("不同 runId 互不影响", async () => {
    const a = await acquireRunDriveLock("run-lock-b");
    const b = await acquireRunDriveLock("run-lock-c");
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    await releaseRunDriveLock("run-lock-b", a as string);
    await releaseRunDriveLock("run-lock-c", b as string);
  });
  it("token 不符不释放（防误删他人新锁）", async () => {
    const a = await acquireRunDriveLock("run-lock-d");
    expect(a).toBeTruthy();
    await releaseRunDriveLock("run-lock-d", "wrong-token");
    expect(await acquireRunDriveLock("run-lock-d")).toBeNull(); // 仍被原持有者占着
    await releaseRunDriveLock("run-lock-d", a as string);
  });
  it("只有当前 PostgreSQL lease token 可续租", async () => {
    const token = await acquireRunDriveLock("run-lock-renew");
    expect(token).toBeTruthy();
    expect(await renewRunDriveLock("run-lock-renew", "wrong-token")).toBe(false);
    expect(await renewRunDriveLock("run-lock-renew", token as string)).toBe(true);
    expect(await acquireRunDriveLock("run-lock-renew")).toBeNull();
    await releaseRunDriveLock("run-lock-renew", token as string);
  });
  it("持久租约存储失败时显式向上抛出", async () => {
    acquireProductionRunLease.mockRejectedValueOnce(new Error("postgres unavailable"));
    await expect(acquireRunDriveLock("run-lock-db-error")).rejects.toThrow("postgres unavailable");
  });
  it("空 runId 拿不到锁", async () => {
    expect(await acquireRunDriveLock("")).toBeNull();
  });
});
