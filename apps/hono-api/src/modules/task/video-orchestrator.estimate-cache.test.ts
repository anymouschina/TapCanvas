import { describe, expect, it, beforeEach } from "vitest";
import {
  cacheEstimatePlan,
  loadEstimatePlan,
  __clearEstimatePlanCache,
} from "./video-orchestrator.estimate-cache";

describe("estimate 计划缓存（根治 start 重吐巨型 storyPlan 截断 livelock）", () => {
  beforeEach(() => __clearEstimatePlanCache());

  it("缓存后按 runId 取回原计划", () => {
    const plan = { runId: "r1", clips: [{ clipPrompt: "x".repeat(3000) }] };
    cacheEstimatePlan("r1", plan);
    expect(loadEstimatePlan("r1")).toBe(plan);
  });

  it("未缓存的 runId 返回 null（start 据此优雅退化提示重发）", () => {
    expect(loadEstimatePlan("nope")).toBeNull();
  });

  it("超 TTL(30min) 过期返回 null 并清除", () => {
    const t0 = 1_000_000;
    cacheEstimatePlan("r2", { runId: "r2" }, t0);
    expect(loadEstimatePlan("r2", t0 + 29 * 60_000)).not.toBeNull(); // 29min 内仍在
    expect(loadEstimatePlan("r2", t0 + 31 * 60_000)).toBeNull(); // 31min 过期
  });

  it("空 runId / 空 plan 不缓存", () => {
    cacheEstimatePlan("", { runId: "x" });
    cacheEstimatePlan("r3", null);
    expect(loadEstimatePlan("")).toBeNull();
    expect(loadEstimatePlan("r3")).toBeNull();
  });

  it("同 runId 覆盖为最新计划（estimate 改了重估）", () => {
    cacheEstimatePlan("r4", { runId: "r4", v: 1 });
    cacheEstimatePlan("r4", { runId: "r4", v: 2 });
    expect((loadEstimatePlan("r4") as { v: number }).v).toBe(2);
  });
});
