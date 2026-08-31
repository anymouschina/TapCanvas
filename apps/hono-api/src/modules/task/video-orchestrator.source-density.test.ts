import { describe, it, expect } from "vitest";
import {
  isSourceDensityWarnEnabled,
  resolveSourceDensityCharsPerSec,
  findOverdenseClips,
  buildSourceDensityWarning,
} from "./video-orchestrator.source-density";

const CHAPTER =
  "甲走进大殿，四下无人，烛火摇曳。" +
  "他环顾四周，想起三年前的旧事，心中五味杂陈，脚步渐渐放缓，最终停在祭坛之前，伸手抚过冰冷的石面，指尖沾起一层薄灰，他闭上眼，深吸一口气，转身欲走。" +
  "忽然帘后传来脚步声，乙缓步走出，手按剑柄，冷冷盯着甲。" +
  "丙".repeat(200);

const denseClip = {
  clipPrompt: "x",
  sourceStartMarker: "甲走进大殿，四下无人",
  sourceEndMarker: "他闭上眼，深吸一口气，转身欲走",
};

describe("source-density 剧情密度算术", () => {
  it("默认 ON,off 关闭", () => {
    expect(isSourceDensityWarnEnabled({})).toBe(true);
    expect(isSourceDensityWarnEnabled({ VIDEO_SOURCE_DENSITY_WARN: "off" })).toBe(false);
  });

  it("阈值默认 8,env 可调并夹在 [4,20]", () => {
    expect(resolveSourceDensityCharsPerSec({})).toBe(8);
    expect(resolveSourceDensityCharsPerSec({ VIDEO_SOURCE_DENSITY_CHARS_PER_SEC: "12" })).toBe(12);
    expect(resolveSourceDensityCharsPerSec({ VIDEO_SOURCE_DENSITY_CHARS_PER_SEC: "99" })).toBe(20);
    expect(resolveSourceDensityCharsPerSec({ VIDEO_SOURCE_DENSITY_CHARS_PER_SEC: "abc" })).toBe(8);
  });

  it("原文跨度÷时长超阈值的 clip 被点名", () => {
    const clips = [denseClip] as never[];
    // 该 clip 覆盖约 80+ 实义字,塞 6s → >13 字/秒,超默认阈值 8
    const items = findOverdenseClips(clips, CHAPTER, [6], 8);
    expect(items).toHaveLength(1);
    expect(items[0].index).toBe(0);
    expect(items[0].charsPerSec).toBeGreaterThan(8);
    const warning = buildSourceDensityWarning(clips, CHAPTER, [6], 8);
    expect(warning).toContain("clip0");
    expect(warning).toContain("densityReviewed");
  });

  it("densityReviewed:true 豁免;时长充足不告警", () => {
    const reviewed = [{ ...denseClip, densityReviewed: true }] as never[];
    expect(findOverdenseClips(reviewed, CHAPTER, [6], 8)).toEqual([]);
    const slow = [denseClip] as never[];
    expect(findOverdenseClips(slow, CHAPTER, [15], 8)).toEqual([]);
  });

  it("无原文/无锚点 → null(不误伤)", () => {
    expect(buildSourceDensityWarning([{ clipPrompt: "x" }] as never[], CHAPTER, [6], 8)).toBeNull();
    expect(buildSourceDensityWarning([denseClip] as never[], "", [6], 8)).toBeNull();
  });
});
