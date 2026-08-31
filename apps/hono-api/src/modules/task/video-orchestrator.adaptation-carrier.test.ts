import { describe, expect, it } from "vitest";

import {
  buildAdaptationCarrierWarnings,
  carrierHitRatio,
  extractDeclarationBigrams,
} from "./video-orchestrator.adaptation-carrier";

const strategyText = (s: unknown) => JSON.stringify(s);

describe("buildAdaptationCarrierWarnings", () => {
  it("ch15 实案：reversal 揭晓镜不含『捏碎第一枚骨片』内容 → 告警", () => {
    // r2 末段 7s：唯一台词「失算了」，捏碎/第一枚/祖地零命中（2026-07-11 用户看片实证）。
    const clips = Array.from({ length: 9 }, (_, i) => ({
      clipPrompt: `镜${i} 打斗推进`,
    }));
    clips[7] = { clipPrompt: "殿内孟川滑坐，取出后土骨片，感应微弱、并无救援临近迹象。" };
    clips[8] = {
      clipPrompt:
        "殿内孟川滑坐咳血、法力耗竭意识渐模糊，取出后土骨片温热却无援临。\n@孟川（虚弱·自嘲扯嘴角）：「失算了……」",
    };
    const warnings = buildAdaptationCarrierWarnings({
      strategyText: strategyText({
        reversals: [
          {
            plantClipIndex: 7,
            revealClipIndex: 8,
            desc: "镜7-6预埋骨片感应微弱无援→镜8揭晓捏碎第一枚骨片可求援后土本人，绝境中唯一生机，钩住下章",
          },
        ],
      }),
      clips,
    });
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain("reversal 承载疑似落空");
    expect(warnings[0]).toContain("replaceAtIndex:8");
  });

  it("reversal 揭晓镜真含揭晓台词 → 不告警", () => {
    const clips = Array.from({ length: 9 }, (_, i) => ({ clipPrompt: `镜${i}` }));
    clips[8] = {
      clipPrompt:
        "孟川攥紧后土所赠的第一枚骨片。\n@孟川（内心独白VO）：「若真撑不住……也只能捏碎她所赠的第一枚骨片，求援后土本人了。」",
    };
    const warnings = buildAdaptationCarrierWarnings({
      strategyText: strategyText({
        reversals: [
          {
            plantClipIndex: 7,
            revealClipIndex: 8,
            desc: "镜8揭晓捏碎第一枚骨片可求援后土本人",
          },
        ],
      }),
      clips,
    });
    expect(warnings).toEqual([]);
  });

  it("ch12 实案：cuts 声明镜N由VO承载、该镜却无台词行 → 告警", () => {
    const clips = [
      { clipPrompt: "镜0 冷开" },
      { clipPrompt: "镜1 无台词，纯视觉：孟川远眺紫霄宫方向，云海翻涌。" },
      { clipPrompt: "镜2 收尾" },
    ];
    const warnings = buildAdaptationCarrierWarnings({
      strategyText: strategyText({
        cuts: [{ what: "紫霄宫听道内心戏", why: "凝练为镜1旁白VO承载" }],
      }),
      clips,
    });
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain("cuts 承载疑似落空");
  });

  it("cuts 声明镜N由VO承载、镜N（或相邻编号位）有台词行 → 不告警", () => {
    const clips = [
      { clipPrompt: "镜0 冷开" },
      { clipPrompt: '镜1\n@旁白VO（低沉）：「紫霄宫听道，乃是鸿钧亲传。」' },
      { clipPrompt: "镜2 收尾" },
    ];
    const warnings = buildAdaptationCarrierWarnings({
      strategyText: strategyText({
        cuts: [{ what: "听道设定", why: "凝练为镜1旁白VO承载" }],
      }),
      clips,
    });
    expect(warnings).toEqual([]);
  });

  it("hook 在末镜零承载 → 告警；有承载 → 不告警", () => {
    const base = [
      { clipPrompt: "镜0" },
      { clipPrompt: "镜1 蜥蜴逼近石殿，神念探路。" },
    ];
    const hookDecl = "殿外蜥蜴步步逼近踏步声戛然而止，孟川攥紧后土第一枚骨片决意求援，接下一章";
    const missing = buildAdaptationCarrierWarnings({
      strategyText: strategyText({ hook: hookDecl }),
      clips: [...base, { clipPrompt: "镜2 孟川咳血闭眼，画面渐暗。" }],
    });
    expect(missing.length).toBe(1);
    expect(missing[0]).toContain("hook 承载疑似落空");
    const carried = buildAdaptationCarrierWarnings({
      strategyText: strategyText({ hook: hookDecl }),
      clips: [
        ...base,
        {
          clipPrompt:
            "殿外蜥蜴怪人步步逼近，踏步声戛然而止；孟川攥紧后土所赠第一枚骨片，眼中决意已定：捏碎它便可求援后土。",
        },
      ],
    });
    expect(carried).toEqual([]);
  });

  it("revealClipIndex 越界（重切后编号错位）→ 告警", () => {
    const warnings = buildAdaptationCarrierWarnings({
      strategyText: strategyText({
        reversals: [{ plantClipIndex: 7, revealClipIndex: 8, desc: "镜8揭晓捏碎第一枚骨片" }],
      }),
      clips: [{ clipPrompt: "镜0" }, { clipPrompt: "镜1" }],
    });
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain("超出当前分段范围");
  });

  it("无声明/坏 JSON/空 clips → 空数组不炸", () => {
    expect(buildAdaptationCarrierWarnings({ strategyText: null, clips: [{}] })).toEqual([]);
    expect(buildAdaptationCarrierWarnings({ strategyText: "{bad json", clips: [{}] })).toEqual([]);
    expect(buildAdaptationCarrierWarnings({ strategyText: "{}", clips: [] })).toEqual([]);
  });
});

describe("匹配基元", () => {
  it("extractDeclarationBigrams 剔结构噪音词", () => {
    const grams = extractDeclarationBigrams("预埋揭晓捏碎骨片");
    expect(grams).not.toContain("预埋");
    expect(grams).not.toContain("揭晓");
    expect(grams).toContain("捏碎");
  });
  it("carrierHitRatio 对正常承载给高分、对无关文本给低分", () => {
    const decl = "捏碎第一枚骨片求援后土本人";
    expect(carrierHitRatio(decl, "他捏碎了第一枚骨片，向后土本人求援")).toBeGreaterThan(0.6);
    expect(carrierHitRatio(decl, "蜥蜴怪人暴怒咆哮走向石殿")).toBeLessThan(0.2);
  });
});
