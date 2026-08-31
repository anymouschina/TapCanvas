import { describe, it, expect } from "vitest";
import {
  normalizeForEcho,
  bigramDice,
  findFieldEchoClips,
  buildClipFieldEchoWarning,
} from "./video-orchestrator.clip-field-echo";

const clip = (over: Record<string, unknown>) => over as never;

describe("Echo 检测·字段互抄软告警（吸收 LumenX model_echo·A 路）", () => {
  it("clipPrompt≈storyboardPrompt 且 clipPrompt 无运镜/动作 → 命中", () => {
    const text = "庭院中央，青衫男子负手而立，背后古树枝叶低垂，黄昏暖光斜照";
    const hits = findFieldEchoClips([clip({ clipPrompt: text, storyboardPrompt: text })]);
    expect(hits).toHaveLength(1);
    expect(hits[0].ratio).toBeGreaterThanOrEqual(0.92);
    const msg = buildClipFieldEchoWarning([clip({ clipPrompt: text, storyboardPrompt: text })]);
    expect(msg).toMatch(/clip0/);
    expect(msg).toMatch(/字段互抄/);
  });

  it("同文但 clipPrompt 末尾补运镜+动作 → 不命中（运动条件兜底·防误伤合法首尾帧镜）", () => {
    const sb = "庭院中央，青衫男子负手而立，背后古树枝叶低垂";
    const cp = sb + "。镜头缓推推近，男子转身挥袖、迈步走向门廊";
    expect(findFieldEchoClips([clip({ clipPrompt: cp, storyboardPrompt: sb })])).toHaveLength(0);
  });

  it("两字段语义不同（storyboard 静态构图 / clipPrompt 真运动）→ ratio<0.92 不命中", () => {
    const sb = "全景：荒漠驼队剪影，落日熔金，沙丘起伏";
    const cp = "镜头从地平线快速横移跟拍，骆驼迈步前行、驼铃晃动，沙尘扬起";
    const hits = findFieldEchoClips([clip({ clipPrompt: cp, storyboardPrompt: sb })]);
    expect(hits).toHaveLength(0);
  });

  it("echoReviewed:true → 豁免（不命中）", () => {
    const text = "特写：茶盏静置案上，热气袅袅，光影凝滞";
    expect(
      findFieldEchoClips([clip({ clipPrompt: text, storyboardPrompt: text, echoReviewed: true })]),
    ).toHaveLength(0);
  });

  it("storyboardPrompt 为空 → 不命中（交别的校验，不在本闸误报）", () => {
    const text = "青衫男子负手而立";
    expect(findFieldEchoClips([clip({ clipPrompt: text, storyboardPrompt: "" })])).toHaveLength(0);
  });

  it("bigramDice / normalizeForEcho：标点空白不影响、雷同近 1、不同低分", () => {
    expect(bigramDice("青衫男子负手而立", "青衫男子负手而立")).toBe(1);
    expect(bigramDice("青衫男子，负手而立。", "青衫男子负手而立")).toBeGreaterThanOrEqual(0.92);
    expect(bigramDice("青衫男子负手而立", "镜头快速横移跟拍骆驼前行")).toBeLessThan(0.3);
    expect(normalizeForEcho("青衫，男子。 负手")).toBe("青衫男子负手");
  });

  it("无命中 → buildClipFieldEchoWarning 返回 null", () => {
    const sb = "全景荒漠驼队";
    const cp = "镜头横移跟拍，骆驼迈步前行";
    expect(buildClipFieldEchoWarning([clip({ clipPrompt: cp, storyboardPrompt: sb })])).toBeNull();
  });
});
