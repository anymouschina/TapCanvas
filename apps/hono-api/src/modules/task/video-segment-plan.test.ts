import { describe, expect, it } from "vitest";

import {
  ANALYZE_VIDEO_MAX_SEGMENT_SEC,
  DECOMPOSE_MAX_SEGMENT_SEC,
  needsSegmentSplit,
  planVideoSegments,
  sizeAwareMaxSegSec,
  VIDEO_UNDERSTAND_MAX_BYTES,
} from "./video-segment-plan";

const MiB = 1024 * 1024;

describe("sizeAwareMaxSegSec（按大小也切段，治 57MiB 超 50MiB 上限）", () => {
  it("短但高码率超宽幅片(22.72s/57MiB) → 等效段长不超过15s（会触发切段）", () => {
    const eff = sizeAwareMaxSegSec(22.72, 57 * MiB, ANALYZE_VIDEO_MAX_SEGMENT_SEC);
    expect(eff).toBeLessThanOrEqual(ANALYZE_VIDEO_MAX_SEGMENT_SEC);
    expect(eff).toBeGreaterThan(0);
    // 38MiB / (57MiB/22.72s) ≈ 15s
    expect(eff).toBe(Math.floor(VIDEO_UNDERSTAND_MAX_BYTES / ((57 * MiB) / 22.72)));
    // 切出来每段都安全低于 50MiB 硬上限。
    const bytesPerSec = (57 * MiB) / 22.72;
    expect(eff * bytesPerSec).toBeLessThan(50 * MiB);
  });
  it("小文件(<38MiB) → 不被大小压低，维持时长上限", () => {
    expect(sizeAwareMaxSegSec(25, 10 * MiB, ANALYZE_VIDEO_MAX_SEGMENT_SEC)).toBe(ANALYZE_VIDEO_MAX_SEGMENT_SEC);
  });
  it("时长/大小未知 → 退回时长上限（维持原纯时长行为）", () => {
    expect(sizeAwareMaxSegSec(0, 57 * MiB, 30)).toBe(30);
    expect(sizeAwareMaxSegSec(22, 0, 30)).toBe(30);
  });
  it("至少 1s（极端大文件不返回 0/负）", () => {
    expect(sizeAwareMaxSegSec(10, 5000 * MiB, 30)).toBeGreaterThanOrEqual(1);
  });
});

describe("planVideoSegments（长视频切段·A视频理解15s/B复刻120s 共享）", () => {
  it("≤段长 → 单段不切（等价原行为）", () => {
    expect(planVideoSegments(15, 15)).toEqual([{ index: 0, startSec: 0, endSec: 15 }]);
    expect(planVideoSegments(12.5, 15)).toEqual([{ index: 0, startSec: 0, endSec: 12.5 }]);
  });

  it("271s @15s（实测那条 4.5 分钟片）→ 切成 18 段、最后一段并入(末段 1s<2.25s 阈值)", () => {
    const segs = planVideoSegments(271, ANALYZE_VIDEO_MAX_SEGMENT_SEC);
    // 0..255 共 17 整段 + [255,270] + 尾 [270,271] 1s 并入 → 末段 [255,271]
    expect(segs.length).toBe(18);
    expect(segs[0]).toEqual({ index: 0, startSec: 0, endSec: 15 });
    expect(segs[segs.length - 1]).toEqual({ index: 17, startSec: 255, endSec: 271 });
    // 连续无缝、覆盖全长
    for (let i = 1; i < segs.length; i += 1) expect(segs[i]!.startSec).toBe(segs[i - 1]!.endSec);
  });

  it("45s @15s → 整 3 段，无碎尾", () => {
    expect(planVideoSegments(45, 15)).toEqual([
      { index: 0, startSec: 0, endSec: 15 },
      { index: 1, startSec: 15, endSec: 30 },
      { index: 2, startSec: 30, endSec: 45 },
    ]);
  });

  it("B 复刻 300s @120s → 切成 [0,120][120,240][240,300]", () => {
    const segs = planVideoSegments(300, DECOMPOSE_MAX_SEGMENT_SEC);
    expect(segs.map((s) => [s.startSec, s.endSec])).toEqual([[0, 120], [120, 240], [240, 300]]);
  });

  it("时长未知/非法 → 空", () => {
    expect(planVideoSegments(0, 30)).toEqual([]);
    expect(planVideoSegments(Number.NaN, 30)).toEqual([]);
    expect(planVideoSegments(60, 0)).toEqual([]);
  });

  it("needsSegmentSplit：>段长才切；未知不切", () => {
    expect(needsSegmentSplit(31, 30)).toBe(true);
    expect(needsSegmentSplit(30, 30)).toBe(false);
    expect(needsSegmentSplit(0, 30)).toBe(false);
  });
});
