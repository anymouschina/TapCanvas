import { describe, expect, it } from "vitest";
import {
  DEFAULT_MIN_SOURCE_MARKER_CHARS,
  createMarkerLocator,
  normalizeWithMap,
  suggestSourceMarkerCandidates,
} from "./video-orchestrator.source-coverage";

// 贴近 ch1197 的形状：长短句混排 + 面板数值行（v19 就是错引了面板行导致跨拍定位失败）。
const TEXT = [
  "苏晓站在小木屋门前，夜风很凉。",
  "阵营声望：-58600点。世界之源；0%（无法获取）。",
  "他摊开手掌，一枚拳头大小的火焰核心浮在掌心上方。",
  "好。",
  "远处庇护城的公共火炬连成一线，暖光压在青灰的雪面上。",
].join("\n");

describe("锚点候选提取", () => {
  it("候选逐字抄回去必然能被定位（拒因不再是死路）", () => {
    const locate = createMarkerLocator(TEXT);
    const candidates = suggestSourceMarkerCandidates({ chapterText: TEXT });
    expect(candidates.length).toBeGreaterThan(0);
    for (const candidate of candidates) {
      expect(locate(candidate), `候选无法定位：${candidate}`).not.toBeNull();
    }
  });

  it("候选一律满足最小实义字符数（不会给出又被长度闸拒的候选）", () => {
    for (const candidate of suggestSourceMarkerCandidates({ chapterText: TEXT })) {
      expect(normalizeWithMap(candidate).norm.length).toBeGreaterThanOrEqual(DEFAULT_MIN_SOURCE_MARKER_CHARS);
    }
  });

  it("过短句被排除（「好。」不会进候选）", () => {
    expect(suggestSourceMarkerCandidates({ chapterText: TEXT }).some((t) => t.includes("好"))).toBe(false);
  });

  it("限定跨度时候选严格落在跨度内——这是本次根治的要点", () => {
    // 模拟 v19 的病灶：本拍跨度只覆盖开头两句，规划层却引了末句的火炬描写。
    const locate = createMarkerLocator(TEXT);
    const start = locate("苏晓站在小木屋门前");
    const end = locate("一枚拳头大小的火焰核心");
    expect(start).not.toBeNull();
    expect(end).not.toBeNull();
    const candidates = suggestSourceMarkerCandidates({
      chapterText: TEXT,
      fromNorm: start!.start,
      toNorm: end!.end,
    });
    expect(candidates.length).toBeGreaterThan(0);
    // 跨度外的内容绝不能出现在候选里，否则等于把规划层再推回跨拍引用。
    expect(candidates.some((t) => t.includes("公共火炬"))).toBe(false);
    for (const candidate of candidates) {
      const hit = locate(candidate);
      expect(hit).not.toBeNull();
      expect(hit!.start).toBeGreaterThanOrEqual(start!.start);
      expect(hit!.end).toBeLessThanOrEqual(end!.end);
    }
  });

  it("空/空白原文不炸，返回空清单（拒因退回原样，不影响主校验）", () => {
    expect(suggestSourceMarkerCandidates({ chapterText: "" })).toEqual([]);
    expect(suggestSourceMarkerCandidates({ chapterText: "   \n  " })).toEqual([]);
  });
});
