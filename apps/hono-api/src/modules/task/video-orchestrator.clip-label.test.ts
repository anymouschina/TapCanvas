import { describe, expect, it } from "vitest";
import { buildClipNodeLabel } from "./video-orchestrator.orchestrate";

describe("buildClipNodeLabel（视频节点语义化命名）", () => {
  it("优先用小T 显式 title", () => {
    expect(buildClipNodeLabel({ title: "破晓惊变" }, 0, 11)).toBe("镜1·破晓惊变");
  });

  it("无 title 时从 clipPrompt 的 logline 行抽", () => {
    const clip = { clipPrompt: "导演基调：冷峻\nlogline：金逢春惊觉城破\n@图1=金逢春" };
    expect(buildClipNodeLabel(clip, 1, 11)).toBe("镜2·金逢春惊觉城破");
  });

  it("无 logline 时取首行剥前缀", () => {
    const clip = { clipPrompt: "段3 静城粥香\n镜1|全景|..." };
    expect(buildClipNodeLabel(clip, 2, 11)).toBe("镜3·静城粥香");
  });

  it("空 clip 退到 镜N/总数", () => {
    expect(buildClipNodeLabel({}, 3, 11)).toBe("镜4/11");
    expect(buildClipNodeLabel(null, 10, 11)).toBe("镜11/11");
  });

  it("超 16 字截断加省略号", () => {
    const long = "一二三四五六七八九十一二三四五六七八九十";
    expect(buildClipNodeLabel({ title: long }, 0, 5)).toBe(`镜1·${long.slice(0, 16)}…`);
  });

  // 【回归·2026-07-08 duel-shuang-guiqi-v1】replaceAtIndex 的 clip 丢了 title 只留结构化
  // logline 字段；label 却从渲染后 clipPrompt 抽首行，撞上「【导演基调】…」被 filmBible 污染。
  it("无 title 但有结构化 logline 字段时用 logline（不落到 clipPrompt 首行）", () => {
    const clip = {
      logline: "破庙夜女忍霜突袭妖刀武者鬼骑",
      clipPrompt: "【导演基调】日漫动作番剧的凌厉刀戟美学\n【logline】破庙夜女忍霜突袭妖刀武者鬼骑\n【镜头表】...",
    };
    expect(buildClipNodeLabel(clip, 0, 1)).toBe("镜1·破庙夜女忍霜突袭妖刀武者鬼骑");
  });

  it("只有渲染后 clipPrompt（【导演基调】开头）时跳过圣经段、取【logline】", () => {
    const clip = {
      clipPrompt: "【导演基调】日漫动作番剧的凌厉刀戟美学\n【logline】破庙夜女忍霜突袭鬼骑\n【镜头表】镜1|大全景|...",
    };
    expect(buildClipNodeLabel(clip, 0, 1)).toBe("镜1·破庙夜女忍霜突袭鬼骑");
  });

  it("渲染后 clipPrompt 无 logline 段时也不把「【导演基调】…」当 beat", () => {
    const clip = { clipPrompt: "【导演基调】日漫动作番剧的凌厉刀戟美学\n【镜头表】镜1|大全景|..." };
    // 无可用 beat → 退到 镜N/总数，绝不产出被污染的「【导演基调】…」label。
    expect(buildClipNodeLabel(clip, 0, 1)).toBe("镜1/1");
  });
});
