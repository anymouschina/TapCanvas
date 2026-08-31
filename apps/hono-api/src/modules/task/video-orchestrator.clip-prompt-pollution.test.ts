import { describe, expect, it } from "vitest";
import {
  detectGenericRolePlaceholders,
  isClipPromptDepolluteEnabled,
  stripPromptPollution,
} from "./video-orchestrator.clip-prompt-pollution";

// project 6aec1e46 实测的真实污染提示词（小T 在 storyPlan 里写的英文通用模板）。
const REAL_POLLUTED_PROMPT =
  "Cut 1 / 4s. Vertical anime cinematic action. In the ruined rain-soaked arena at night, " +
  "the hero fighter stands on screen left in a low-angle entrance shot, coat fluttering in wind and rain, " +
  "blue-white rim backlight outlines the silhouette, wet stone reflects orange sparks. Camera slowly dollies " +
  "from wide to medium, holding a clear readable pose and building pressure. No dialogue, no gore, no text. " +
  "Keep the hero identity, opponent identity, arena environment and high-energy anime cinematic style " +
  "consistent with the reference images.";

const CLEAN_CN_PROMPT =
  "李长安五指收拢碾碎石皮，碎屑簌簌而落，他抬眼盯住甬道尽头；镜头从低位缓推到中景，雨丝斜飘。";

describe("isClipPromptDepolluteEnabled", () => {
  it("缺省 / 空 → 默认 ON", () => {
    expect(isClipPromptDepolluteEnabled({})).toBe(true);
    expect(isClipPromptDepolluteEnabled({ VIDEO_PROMPT_DEPOLLUTE: "" })).toBe(true);
  });
  it("显式关 → OFF", () => {
    for (const v of ["off", "0", "false", "no", "OFF"]) {
      expect(isClipPromptDepolluteEnabled({ VIDEO_PROMPT_DEPOLLUTE: v })).toBe(false);
    }
  });
});

describe("stripPromptPollution（静默清理·非阻塞）", () => {
  it("剥掉真实污染里的冗余英文一致性套话整句 + hype 词", () => {
    const r = stripPromptPollution(REAL_POLLUTED_PROMPT);
    expect(r.changed).toBe(true);
    // 整句 "Keep … consistent with the reference images." 被剥
    expect(r.prompt).not.toMatch(/consistent with the reference images/i);
    expect(r.prompt).not.toMatch(/\bhigh-energy\b/i);
    // 具体画面内容保留（运镜/光线/动作描述不被误删）
    expect(r.prompt).toMatch(/low-angle entrance shot/i);
    expect(r.prompt).toMatch(/rim backlight/i);
    expect(r.prompt).toMatch(/dollies/i);
  });

  it("裸短语 'consistent with the reference images' 也剥", () => {
    const r = stripPromptPollution("a fighter charges, consistent with the reference images.");
    expect(r.prompt).not.toMatch(/consistent with the reference images/i);
    expect(r.prompt).toMatch(/charges/i);
  });

  it("空泛 hype 词被剥、具体内容留", () => {
    const r = stripPromptPollution("epic high-energy battle, 大片感十足，李长安挥刀劈下");
    expect(r.prompt).not.toMatch(/epic|high-energy|大片感/i);
    expect(r.prompt).toMatch(/李长安挥刀劈下/);
  });

  it("不碰通用角色占位词（删了会断句，留给 qa-reviewer）", () => {
    const r = stripPromptPollution("the hero faces the opponent across the arena");
    expect(r.prompt).toMatch(/the hero/i);
    expect(r.prompt).toMatch(/the opponent/i);
  });

  it("干净中文导演提示词 → 零改动（零误伤）", () => {
    const r = stripPromptPollution(CLEAN_CN_PROMPT);
    expect(r.changed).toBe(false);
    expect(r.prompt).toBe(CLEAN_CN_PROMPT);
  });

  it("幂等：清理两次结果一致", () => {
    const once = stripPromptPollution(REAL_POLLUTED_PROMPT).prompt;
    const twice = stripPromptPollution(once);
    expect(twice.changed).toBe(false);
    expect(twice.prompt).toBe(once);
  });

  it("空 prompt 不报错", () => {
    expect(stripPromptPollution("").changed).toBe(false);
    expect(stripPromptPollution("   ").changed).toBe(false);
  });

  it("清理后无悬挂标点碎屑", () => {
    const r = stripPromptPollution(REAL_POLLUTED_PROMPT);
    expect(r.prompt).not.toMatch(/[,，]\s*$/);
    expect(r.prompt).not.toMatch(/,\s*,/);
  });

  it("不改写已有 prompt 中的结构化 @图N 绑定", () => {
    const prompt = "@图2对@图3说：『原文对白』，epic high-energy battle";
    const r = stripPromptPollution(prompt);
    expect(r.prompt).toContain("@图2对@图3说：『原文对白』");
    expect(r.prompt).not.toMatch(/epic|high-energy/i);
  });
});

describe("detectGenericRolePlaceholders（供 qa-reviewer 改写参考·不硬拦）", () => {
  it("检出英文/中文通用档案词", () => {
    expect(detectGenericRolePlaceholders("the hero faces the opponent")).toEqual(
      expect.arrayContaining(["the hero", "the opponent"]),
    );
    expect(detectGenericRolePlaceholders("一个年轻女性，神秘人走来")).toEqual(
      expect.arrayContaining(["年轻女性", "神秘人"]),
    );
  });
  it("具名/具体描述 → 空", () => {
    expect(detectGenericRolePlaceholders(CLEAN_CN_PROMPT)).toEqual([]);
  });
});
