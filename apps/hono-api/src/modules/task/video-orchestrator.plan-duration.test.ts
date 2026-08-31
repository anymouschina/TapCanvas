import { describe, expect, it } from "vitest";

import { deriveStoredPlanTargetDurationSeconds } from "./video-orchestrator.plan-duration";

describe("deriveStoredPlanTargetDurationSeconds", () => {
  it("优先保留持久计划已冻结的正总时长", () => {
    expect(deriveStoredPlanTargetDurationSeconds({
      targetDurationSeconds: 42,
      clips: [{ durationSeconds: 5 }],
    })).toBe(42);
  });

  it("缓存过期后从每个冻结 clip 的真实时长精确恢复", () => {
    expect(deriveStoredPlanTargetDurationSeconds({
      clips: [
        { durationSeconds: 15 },
        { durationSeconds: 10 },
        { durationSeconds: 5 },
      ],
    })).toBe(30);
  });

  it("clip 未声明总时长时只按完整 shots 时长求和", () => {
    expect(deriveStoredPlanTargetDurationSeconds({
      clips: [
        { shots: [{ durationSeconds: 2 }, { durationSeconds: 3 }] },
        { shots: [{ durationSeconds: 4 }] },
      ],
    })).toBe(9);
  });

  it("任一 clip 缺确定性时长时显式返回 null，不做默认或部分求和", () => {
    expect(deriveStoredPlanTargetDurationSeconds({
      clips: [{ durationSeconds: 5 }, { shots: [{ action: "缺时长" }] }],
    })).toBeNull();
    expect(deriveStoredPlanTargetDurationSeconds({ clips: [] })).toBeNull();
  });
});
