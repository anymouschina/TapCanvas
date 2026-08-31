import { describe, expect, it } from "vitest";

import { reconcileShotDurations } from "./video-orchestrator.shot-duration-reconciliation";

describe("reconcileShotDurations", () => {
  it("reserves enough time for frozen dialogue and preserves the exact clip duration", () => {
    const result = reconcileShotDurations({
      dialoguePaceRate: 4,
      clip: {
        durationSeconds: 25,
        shots: [
          { shotNo: 1, action: "建立空间", durationSeconds: 15.5 },
          { shotNo: 2, action: "说出台词", dialogue: "一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十一二三四五六七八九", durationSeconds: 3 },
          { shotNo: 3, action: "回应", dialogue: "一二三四五六七八九十一二三", durationSeconds: 2.5 },
          { shotNo: 4, action: "收束", durationSeconds: 4 },
        ],
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const shots = result.clip.shots as Array<Record<string, unknown>>;
    expect(shots.reduce((sum, shot) => sum + Number(shot.durationSeconds), 0)).toBe(25);
    expect(Number(shots[1]?.durationSeconds)).toBeGreaterThanOrEqual(12.5);
    expect(Number(shots[2]?.durationSeconds)).toBeGreaterThanOrEqual(3.5);
    expect(result.evidence?.changedShotIndexes).toContain(1);
  });

  it("scales an overlong shot table to the frozen total without changing creative fields", () => {
    const result = reconcileShotDurations({
      dialoguePaceRate: 4,
      clip: {
        durationSeconds: 18,
        shots: [
          { shotNo: 1, action: "动作甲", framing: "近景", durationSeconds: 8 },
          { shotNo: 2, action: "动作乙", framing: "特写", durationSeconds: 10 },
          { shotNo: 3, action: "动作丙", framing: "全景", durationSeconds: 8 },
        ],
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const shots = result.clip.shots as Array<Record<string, unknown>>;
    expect(shots.reduce((sum, shot) => sum + Number(shot.durationSeconds), 0)).toBe(18);
    expect(shots.map((shot) => shot.action)).toEqual(["动作甲", "动作乙", "动作丙"]);
    expect(shots.map((shot) => shot.framing)).toEqual(["近景", "特写", "全景"]);
  });

  it("reports a real mathematical conflict when dialogue minimums exceed the clip", () => {
    const result = reconcileShotDurations({
      dialoguePaceRate: 4,
      clip: {
        durationSeconds: 5,
        shots: [
          { shotNo: 1, action: "说话", dialogue: "一二三四五六七八九十一二三四五六七八九十一二三四", durationSeconds: 5 },
        ],
      },
    });

    expect(result).toEqual({ ok: false, reason: "dialogue_capacity_exceeds_clip_duration" });
  });

  it("does not invent a half-second minimum for non-dialogue shots", () => {
    const result = reconcileShotDurations({
      dialoguePaceRate: 4,
      clip: {
        durationSeconds: 18,
        shots: [
          { shotNo: 1, action: "完整说话", dialogue: "一".repeat(70), durationSeconds: 17.5 },
          { shotNo: 2, action: "反应甲", durationSeconds: 3 },
          { shotNo: 3, action: "反应乙", durationSeconds: 3 },
          { shotNo: 4, action: "收束", durationSeconds: 2.5 },
        ],
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const shots = result.clip.shots as Array<Record<string, unknown>>;
    expect(shots.reduce((sum, shot) => sum + Number(shot.durationSeconds), 0)).toBe(18);
    expect(Number(shots[0]?.durationSeconds)).toBeGreaterThanOrEqual(17.5);
    expect(shots.slice(1).every((shot) => Number(shot.durationSeconds) > 0)).toBe(true);
  });

  it("is idempotent once durations satisfy the structural contract", () => {
    const clip = {
      durationSeconds: 10,
      shots: [
        { shotNo: 1, action: "说话", dialogue: "一二三四", durationSeconds: 2 },
        { shotNo: 2, action: "反应", durationSeconds: 8 },
      ],
    };
    const first = reconcileShotDurations({ clip, dialoguePaceRate: 4 });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = reconcileShotDurations({ clip: first.clip, dialoguePaceRate: 4 });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.evidence).toBeNull();
    expect(second.clip).toEqual(first.clip);
  });
});
