import { describe, expect, it } from "vitest";

import {
  DEFAULT_DIALOGUE_CHARS_PER_SEC,
  DIALOGUE_PACE_CEILING,
  buildDialogueCapacityBlockMessage,
  countClipDialogueLines,
  countSpokenLoad,
  extractClipDialogueLoad,
  findDialogueOverflowClips,
  parseDialoguePaceRate,
  resolveClipPaceRate,
  resolveDialogueCharsPerSec,
} from "./video-orchestrator.dialogue-capacity";

const RATE = DEFAULT_DIALOGUE_CHARS_PER_SEC; // 4

describe("countSpokenLoad (口播字当量统计)", () => {
  it("中文逐字算 1", () => {
    expect(countSpokenLoad("你好世界")).toBe(4);
  });

  it("标点/空格不计", () => {
    expect(countSpokenLoad("你好，世界！ 走")).toBe(5);
  });

  it("英文单词/数字串各算 2 字当量", () => {
    expect(countSpokenLoad("go now 3")).toBe(6); // go,now,3 → 3 词 ×2
  });

  it("中英混排相加", () => {
    expect(countSpokenLoad("快跑 run")).toBe(2 + 2); // 2 中文 + 1 词×2
  });
});

describe("extractClipDialogueLoad (只算引号内对白)", () => {
  it("中文弯引号台词计入、动作描写不计", () => {
    const clip = { clipPrompt: "他转身，低声道：“我们走吧，别回头”" };
    // 引号内 = 我们走吧别回头 = 7 字（标点不计）
    expect(extractClipDialogueLoad(clip)).toBe(7);
  });

  it("无引号对白 → 0（不把旁白描写当对白）", () => {
    expect(extractClipDialogueLoad({ clipPrompt: "镜头推近，他冷笑不语" })).toBe(0);
  });

  it("clipPrompt 与 storyboardPrompt 的对白累加", () => {
    const clip = {
      clipPrompt: "“快走”",
      storyboardPrompt: "「危险」",
    };
    expect(extractClipDialogueLoad(clip)).toBe(2 + 2);
  });
});

describe("extractClipDialogueLoad (语义口径：只算真的会被念出来的字)", () => {
  it("有 @角色 结构化台词行时，action 里的引号招式名不计入容量", () => {
    const clip = {
      clipPrompt: "[0-3s] 镜1|中景|他挥出「天雷斩」劈开城门\n@韩立（急）：「快走快走」",
    };
    // 只算台词行 快走快走 = 4；「天雷斩」是招式名不会被念出来
    expect(extractClipDialogueLoad(clip)).toBe(4);
  });

  it("结构化 shots 路径无台词行 → 0（action 引号不当对白）", () => {
    const clip = {
      clipPrompt: "挥出「天雷斩」劈开城门",
      shots: [{ shotNo: 1, action: "挥出「天雷斩」劈开城门", durationSeconds: 3 }],
    };
    expect(extractClipDialogueLoad(clip)).toBe(0);
  });

  it("shots[].dialogue 声明字段里的无说话人引号台词仍计入", () => {
    const clip = {
      shots: [
        { shotNo: 1, action: "追出巷口", durationSeconds: 3, dialogue: "「回来！」" },
      ],
    };
    expect(extractClipDialogueLoad(clip)).toBe(2);
  });

  it("存量自由文本 clip（无 shots 无台词行）维持旧引号口径", () => {
    const clip = { clipPrompt: "他转身，低声道：“我们走吧，别回头”" };
    expect(extractClipDialogueLoad(clip)).toBe(7);
  });
});

describe("countClipDialogueLines (句数同口径)", () => {
  it("有结构化台词行时只数台词行，action 引号不算一句", () => {
    const clip = {
      clipPrompt:
        "[0-3s] 镜1|他挥出「天雷斩」\n@韩立（急）：「快走」\n@墨大夫（沉）：「往东门」",
    };
    expect(countClipDialogueLines(clip)).toBe(2);
  });

  it("结构化 shots 路径无台词 → 0 句", () => {
    const clip = {
      clipPrompt: "挥出「天雷斩」",
      shots: [{ shotNo: 1, action: "挥出「天雷斩」", durationSeconds: 3 }],
    };
    expect(countClipDialogueLines(clip)).toBe(0);
  });
});

describe("findDialogueOverflowClips", () => {
  it("全片显式时长 + 对白装得下 → 无超载", () => {
    const plan = {
      clips: [
        { clipPrompt: "他喊：“快跑啊”", durationSeconds: 4 }, // 3 字 ≤ 4×5
        { clipPrompt: "镜头拉远，奔逃", durationSeconds: 4 }, // 无对白
      ],
    };
    expect(findDialogueOverflowClips(plan, RATE)).toEqual([]);
  });

  it("显式时长但镜长装不下对白 → too_short", () => {
    const plan = {
      // 22 字对白，4s 只够念 20 字 → 需 ≥5s
      clips: [
        {
          clipPrompt: "她一字一顿：“这件事到此为止我不想再听任何人提起它了行吗”",
          durationSeconds: 4,
        },
      ],
    };
    const out = findDialogueOverflowClips(plan, RATE);
    expect(out).toHaveLength(1);
    expect(out[0]!.reason).toBe("too_short");
    expect(out[0]!.durationSeconds).toBe(4);
    expect(out[0]!.requiredSeconds).toBeGreaterThanOrEqual(5);
  });

  it("有对白但全片缺显式时长 → missing_duration", () => {
    const plan = {
      clips: [
        { clipPrompt: "他说：“走”" }, // 有对白、无 durationSeconds
        { clipPrompt: "镜头横移" },
      ],
    };
    const out = findDialogueOverflowClips(plan, RATE);
    expect(out).toHaveLength(1);
    expect(out[0]!.reason).toBe("missing_duration");
    expect(out[0]!.index).toBe(0);
  });

  it("dialogueDurationReviewed:true 豁免该镜", () => {
    const plan = {
      clips: [
        {
          clipPrompt: "背景嘟囔：“嘀嘀咕咕嘀嘀咕咕嘀嘀咕咕嘀嘀咕咕嘀嘀咕咕”",
          durationSeconds: 4,
          dialogueDurationReviewed: true,
        },
      ],
    };
    expect(findDialogueOverflowClips(plan, RATE)).toEqual([]);
  });

  it("无对白的片 → 闸门不触发(montage/B-roll 不受影响)", () => {
    const plan = {
      clips: [{ clipPrompt: "城市夜景延时，霓虹流动" }, { clipPrompt: "车流光轨" }],
    };
    expect(findDialogueOverflowClips(plan, RATE)).toEqual([]);
  });
});

describe("buildDialogueCapacityBlockMessage", () => {
  it("装得下 → null（不拦）", () => {
    const plan = {
      clips: [{ clipPrompt: "他喊：“快跑”", durationSeconds: 4 }],
    };
    expect(buildDialogueCapacityBlockMessage(plan, RATE)).toBeNull();
  });

  it("too_short → 文案含字/秒与镜号", () => {
    const plan = {
      clips: [
        {
          clipPrompt: "她一字一顿：“这件事到此为止我不想再听任何人提起它了行吗”",
          durationSeconds: 4,
        },
      ],
    };
    const msg = buildDialogueCapacityBlockMessage(plan, RATE);
    expect(msg).toContain("clip0");
    expect(msg).toContain("字/秒");
    expect(msg).toContain("拒绝起跑");
  });

  it("missing_duration → 提示按字数给显式时长", () => {
    const plan = { clips: [{ clipPrompt: "他说：“我们必须现在就出发不能再等了”" }] };
    const msg = buildDialogueCapacityBlockMessage(plan, RATE);
    expect(msg).toContain("durationSeconds");
  });
});

describe("rate 解析", () => {
  it("rate 默认 4、env 可覆盖、非法回退 4", () => {
    expect(resolveDialogueCharsPerSec({})).toBe(4);
    expect(resolveDialogueCharsPerSec({ VIDEO_DIALOGUE_CHARS_PER_SEC: "6" })).toBe(6);
    expect(resolveDialogueCharsPerSec({ VIDEO_DIALOGUE_CHARS_PER_SEC: "x" })).toBe(4);
  });
});

describe("per-clip dialoguePaceRate numeric contract", () => {
  // 20 字当量对白（一二三四五六七八九十 ×2 = 20）。duration/paceRate 可调。
  const mk = (paceRate?: number, durationSeconds = 4) => ({
    clips: [
      {
        clipPrompt: "方源沉声：「一二三四五六七八九十一二三四五六七八九十」",
        durationSeconds,
        ...(paceRate != null ? { dialoguePaceRate: paceRate } : {}),
      } as never,
    ],
  });

  it("resolveClipPaceRate：自报值优先、物理上限封顶、缺省回退", () => {
    expect(resolveClipPaceRate({ dialoguePaceRate: 3 } as never, 4)).toBe(3);
    expect(resolveClipPaceRate({ dialoguePaceRate: 99 } as never, 4)).toBe(DIALOGUE_PACE_CEILING);
    expect(resolveClipPaceRate({} as never, 4)).toBe(4);
    expect(resolveClipPaceRate({ dialoguePaceRate: 0 } as never, 4)).toBe(4);
  });

  it("默认 4 字/秒：20字 需 5s——给 4s 拦、给 5s 放行", () => {
    const blocked = findDialogueOverflowClips(mk(undefined, 4), RATE);
    expect(blocked).toHaveLength(1);
    expect(blocked[0].paceRate).toBe(4);
    expect(blocked[0].requiredSeconds).toBe(5);
    expect(findDialogueOverflowClips(mk(undefined, 5), RATE)).toHaveLength(0);
  });

  it("凝重慢速 3 字/秒：4s 被拦、需≥7s（慢速→闸更严）", () => {
    const o = findDialogueOverflowClips(mk(3, 4), RATE);
    expect(o).toHaveLength(1);
    expect(o[0].reason).toBe("too_short");
    expect(o[0].paceRate).toBe(3);
    expect(o[0].requiredSeconds).toBe(7);
  });

  it("激动快速 5 字/秒：20字/4s 放行（20 ≤ 4×5，快速→闸更宽）", () => {
    expect(findDialogueOverflowClips(mk(5, 4), RATE)).toHaveLength(0);
  });

  it("瞎报 99 被封顶到 6：4s 放行（20 ≤ 4×6），不超物理极限", () => {
    expect(findDialogueOverflowClips(mk(99, 4), RATE)).toHaveLength(0);
    expect(resolveClipPaceRate(mk(99).clips[0], RATE)).toBe(DIALOGUE_PACE_CEILING);
  });
});

describe("parseDialoguePaceRate numeric protocol", () => {
  it("only accepts positive numeric facts", () => {
    expect(parseDialoguePaceRate(4.5)).toBe(4.5);
    expect(parseDialoguePaceRate("5")).toBeNull();
    expect(parseDialoguePaceRate("5.5字/秒")).toBeNull();
  });
  it("does not infer numeric pace from semantic descriptions", () => {
    expect(parseDialoguePaceRate("偏快·街头痞子快嘴档")).toBeNull();
    expect(parseDialoguePaceRate("急喊档")).toBeNull();
    expect(parseDialoguePaceRate("偏快")).toBeNull();
    expect(parseDialoguePaceRate("凝重哀伤")).toBeNull();
    expect(parseDialoguePaceRate("日常对话")).toBeNull();
  });
  it("解析不出 → null（调用方回退默认）", () => {
    expect(parseDialoguePaceRate("")).toBeNull();
    expect(parseDialoguePaceRate(undefined)).toBeNull();
    expect(parseDialoguePaceRate("莫名其妙的档")).toBeNull();
  });
  it("resolveClipPaceRate rejects descriptions and caps numeric facts at 6", () => {
    expect(resolveClipPaceRate({ dialoguePaceRate: "急喊嘶吼" } as never, 4)).toBe(4);
    expect(resolveClipPaceRate({ dialoguePaceRate: 9 } as never, 4)).toBe(6);
    expect(resolveClipPaceRate({ dialoguePaceRate: "偏快·街头痞子快嘴档" } as never, 4)).toBe(4);
    expect(resolveClipPaceRate({} as never, 4)).toBe(4);
  });
});
