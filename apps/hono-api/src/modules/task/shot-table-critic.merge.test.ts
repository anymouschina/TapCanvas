import { describe, expect, it } from "vitest";
import {
  buildShotTableTextReviewContract,
  createEmptyShotTable,
  serializeShotTable,
} from "@tapcanvas/shot-table-protocol";

import {
  RUBRIC,
  SHOT_TABLE_CRITIC_MAX_TOKENS,
  buildCriticUserMessage,
  buildTextStoryboardCriticUserMessage,
  deriveScoreFromDims,
  mergeDimsWorst,
  normalizeShotTableCriticVerdict,
  preflightShotTableCritic,
  preflightTextStoryboardCritic,
  SHOT_TABLE_CRITIC_DIMENSIONS,
} from "./shot-table-critic";

const generationContract = {
  videoModel: "doubao-seedance-2-0-260128",
  durationOptions: [5, 10, 15],
  maxDurationSeconds: 15,
  referenceImagePolicy: {
    countUnit: "unique_url" as const,
    maximumTotalImages: 9,
    maximumBusinessImages: 9,
  },
  referenceAudioPolicy: {
    minimumDurationSeconds: 1.8,
    maximumDurationSeconds: 30.2,
  },
};

const structuredClip = (clipIndex: number, durationSeconds = 5) => ({
  clipIndex,
  durationSeconds,
  continuity: "时间连续",
  shots: [{ action: "孟川抬手拨开混沌气流，衣摆随冲击向后扬起", durationSeconds }],
});

describe("shot-table critic output budget", () => {
  it("never requests more than the upstream 4096-token limit", () => {
    expect(SHOT_TABLE_CRITIC_MAX_TOKENS).toBe(4_096);
  });
});

describe("shot-table critic deterministic preflight", () => {
  it("在语义 critic 前使用 generationContract 拒绝超时最终稿并返回绝对 clipIndex", () => {
    const result = preflightShotTableCritic({
      clips: [structuredClip(7, 16)],
      filmBible: { directorTone: "神话史诗", visualBible: "冷紫青金" },
      generationContract,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.result.preflightFailed).toBe(true);
    expect(result.result.affectedClipIndexes).toEqual([7]);
    expect(result.result.perModel).toEqual([]);
    expect(result.result.issues.join("\n")).toContain("上限 15s");
  });

  it("结构通过后由最终 clips 确定性渲染受审文本", () => {
    const result = preflightShotTableCritic({
      clips: [structuredClip(4)],
      filmBible: { directorTone: "神话史诗", visualBible: "冷紫青金" },
      generationContract,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.clipIndexes).toEqual([4]);
    expect(result.shotTable).toContain("clipIndex=4");
    expect(result.shotTable).toContain("孟川抬手拨开混沌气流");
  });

  it("缺失或非法 clipIndex 显式失败，禁止按局部数组下标回退", () => {
    expect(() =>
      preflightShotTableCritic({
        clips: [{ ...structuredClip(0), clipIndex: undefined }],
        filmBible: { directorTone: "神话史诗", visualBible: "冷紫青金" },
        generationContract,
      }),
    ).toThrow("critic 每条 clips[].clipIndex 都必须显式提供非负整数");
  });
});

describe("text-storyboard critic deterministic preflight", () => {
  it("审的是最终共享协议文本，并从真实 shotId 构造 0-based 审查索引", () => {
    const table = createEmptyShotTable();
    const reviewContract = buildShotTableTextReviewContract("video_evidence", table.columns);
    const result = preflightTextStoryboardCritic({
      shotTable: serializeShotTable(table),
      reviewContract,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.reviewContract).toEqual(reviewContract);
    expect(result.shotIndexes).toEqual([0]);
  });

  it("表结构不符合宿主合同会返回可修订 verdict，而不是伪装成 critic 上游故障", () => {
    const table = createEmptyShotTable();
    const reviewContract = buildShotTableTextReviewContract("script", table.columns);
    const result = preflightTextStoryboardCritic({
      shotTable: "【镜头总览】\n总镜数：1",
      reviewContract,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.result).toMatchObject({
      pass: false,
      preflightFailed: true,
      mergedDims: { structure: "missing" },
    });
  });

  it("将来源、硬合同和最终表全文放进同一独立审查消息", () => {
    const table = createEmptyShotTable();
    const reviewContract = buildShotTableTextReviewContract("script", table.columns);
    const message = buildTextStoryboardCriticUserMessage({
      shotTable: serializeShotTable(table),
      sourceMaterial: "第一场：门内传来脚步声。",
      reviewContract,
    });

    expect(message).toContain("来源材料（忠实度真相源）")
    expect(message).toContain("第一场：门内传来脚步声。")
    expect(message).toContain('"reviewMode":"text_storyboard"')
    expect(message).toContain("待审最终文本分镜表")
  });
});

describe("shot-table critic response contract", () => {
  const completeDims = Object.fromEntries(
    SHOT_TABLE_CRITIC_DIMENSIONS.map((dimension) => [dimension, "ok"]),
  );
  const verdict = {
    pass: true,
    score: 100,
    dims: completeDims,
    issues: [],
    topFixes: [],
    affectedClipIndexes: [],
  };

  it("完整固定维度集合才接受", () => {
    expect(normalizeShotTableCriticVerdict(verdict)).not.toBeNull();
    const { signalPurity: _removed, ...incompleteDims } = completeDims;
    expect(
      normalizeShotTableCriticVerdict({ ...verdict, dims: incompleteDims }),
    ).toBeNull();
  });

  it("额外维度和非法档值都拒绝，禁止残缺 JSON 被推导成高分", () => {
    expect(
      normalizeShotTableCriticVerdict({
        ...verdict,
        dims: { ...completeDims, inventedDimension: "ok" },
      }),
    ).toBeNull();
    expect(
      normalizeShotTableCriticVerdict({
        ...verdict,
        dims: { ...completeDims, blocking: "great" },
      }),
    ).toBeNull();
  });
});

describe("deriveScoreFromDims（2026-07-10 总分改确定性推导·去 LLM 自报分锚定）", () => {
  it("全 ok = 100；每 weak −3、每 missing −8", () => {
    expect(deriveScoreFromDims({ a: "ok", b: "ok" })).toBe(100);
    expect(deriveScoreFromDims({ a: "weak", b: "ok" })).toBe(97);
    expect(deriveScoreFromDims({ a: "missing", b: "weak" })).toBe(89);
  });
  it("钳到 0，不出负分", () => {
    const dims: Record<string, string> = {};
    for (let i = 0; i < 20; i += 1) dims[`d${i}`] = "missing";
    expect(deriveScoreFromDims(dims)).toBe(0);
  });
  it("非法档值不扣分", () => {
    expect(deriveScoreFromDims({ a: "garbage", b: "ok" })).toBe(100);
  });
  it("golden 入库线 95 = 零 missing 且至多 1 个 weak", () => {
    expect(deriveScoreFromDims({ a: "weak" })).toBeGreaterThanOrEqual(95);
    expect(deriveScoreFromDims({ a: "weak", b: "weak" })).toBeLessThan(95);
    expect(deriveScoreFromDims({ a: "missing" })).toBeLessThan(95);
  });
});

describe("mergeDimsWorst（跨模型最差档合并 missing>weak>ok）", () => {
  it("同维取最严：一个模型 ok 另一个 missing → missing", () => {
    expect(
      mergeDimsWorst([
        { focalAngle: "ok", movement: "ok" },
        { focalAngle: "missing", movement: "weak" },
      ]),
    ).toEqual({ focalAngle: "missing", movement: "weak" });
  });

  it("weak 不被 ok 覆盖、被 missing 覆盖", () => {
    expect(mergeDimsWorst([{ blocking: "weak" }, { blocking: "ok" }])).toEqual({ blocking: "weak" });
    expect(mergeDimsWorst([{ blocking: "weak" }, { blocking: "missing" }])).toEqual({
      blocking: "missing",
    });
  });

  it("忽略非法档值", () => {
    expect(mergeDimsWorst([{ focalAngle: "garbage" }, { focalAngle: "ok" }])).toEqual({
      focalAngle: "ok",
    });
  });

  it("空输入 → 空对象", () => {
    expect(mergeDimsWorst([])).toEqual({});
    expect(mergeDimsWorst([{}, {}])).toEqual({});
  });

  it("并集所有维度", () => {
    expect(mergeDimsWorst([{ focalAngle: "ok" }, { movement: "missing" }])).toEqual({
      focalAngle: "ok",
      movement: "missing",
    });
  });
});

describe("第23维「表演活人感 aliveness」（2026-07-04 用户定调）", () => {
  it("rubric 含第23维定义与 dims 模板键", () => {
    expect(RUBRIC).toContain("aliveness");
    expect(RUBRIC).toContain("表演活人感");
    expect(RUBRIC).toContain('"aliveness":"ok|weak|missing"');
    // 标签词判 weak；群像木桩判 weak；全片无微反应层判 missing
    expect(RUBRIC).toContain("禁标签词");
    expect(RUBRIC).toContain("表演：");
  });
});

describe("戏剧导演与容量维度（人物因果/POV/权力知识/信号纯度）", () => {
  it("rubric 不把字符长度当作质量门禁", () => {
    expect(RUBRIC).not.toContain("八段结构完整度");
    expect(RUBRIC).toContain("不设置字符上限或下限作为质量评分规则");
    expect(RUBRIC).not.toContain("5000是硬上限不是质量目标");
  });

  it("rubric 与输出模板包含五个通用维度", () => {
    for (const dim of [
      "characterCausality",
      "directingCoherence",
      "subjectivePOV",
      "powerKnowledgeShift",
      "signalPurity",
    ]) {
      expect(RUBRIC).toContain(dim);
      expect(RUBRIC).toContain(`"${dim}":"ok|weak|missing"`);
    }
  });
});

describe("第22维「情境合理性 plausibility」（2026-07-04 手术室头骨穿帮实证）", () => {
  it("rubric 含第22维定义与 dims 模板键", () => {
    expect(RUBRIC).toContain("plausibility");
    expect(RUBRIC).toContain("情境合理性");
    expect(RUBRIC).toContain('"plausibility":"ok|weak|missing"');
    // 高危实体直给判 weak；整镜依赖该实体正确渲染判 missing；替代拍法四招
    expect(RUBRIC).toContain("穿帮：");
    expect(RUBRIC).toContain("POV 视点");
  });
});

describe("固定忠实原文的 video critic", () => {
  it("不再以删戏、并戏或自造钩子作为评分维度", () => {
    expect(RUBRIC).not.toContain("adaptationCourage");
    expect(RUBRIC).not.toContain("改编胆量");
    expect(RUBRIC).not.toContain("空表=只是没删");
  });

  it("buildCriticUserMessage 只注入真实生成合同和待审镜头表", () => {
    const msg = buildCriticUserMessage({
      shotTable: "【镜1】…",
      generationContract,
      brief: "志怪夜戏",
    });
    expect(msg).toContain("题材/风格简述：志怪夜戏");
    expect(msg).not.toContain("adaptationStrategy");
    expect(msg).toContain("待审镜头表：\n【镜1】…");
  });
});

describe("sd2Fit 维度(2026-07-08)", () => {
  it("RUBRIC 声明 sd2Fit 维度与三子判", () => {
    expect(RUBRIC).toContain("sd2Fit");
    expect(RUBRIC).toContain("背对");
    expect(RUBRIC).toContain("多地点");
  });
  it("输出 JSON 模板含 sd2Fit 键", () => {
    expect(RUBRIC).toContain('"sd2Fit":"ok|weak|missing"');
  });
  it("mergeDimsWorst 对 sd2Fit 取最严(missing>weak>ok)", () => {
    const merged = mergeDimsWorst([{ sd2Fit: "weak" }, { sd2Fit: "missing" }]);
    expect(merged.sd2Fit).toBe("missing");
  });
  it("第10维碎镜条款澄清:单条内逐秒时间轴描述≠碎镜", () => {
    expect(RUBRIC).toContain("单条内");
    expect(RUBRIC).toContain("逐秒");
  });
});

describe("RUBRIC 只做通用事实审查", () => {
  it("不在 Hono 固化战斗、技能或动作奇观方法论", () => {
    expect(RUBRIC).toContain("不在 Hono 中按题材加载或固化战斗、技能、变身、动作奇观等创作方法");
    expect(RUBRIC).not.toContain("武戏/技能镜三-lens");
    expect(RUBRIC).not.toContain("skillSpec");
    expect(RUBRIC).not.toContain("hitFeedback");
    expect(RUBRIC).not.toContain("transformBodyChange");
    expect(RUBRIC).not.toContain("tacticalExchange");
  });
});

describe("RUBRIC 镜头可选松绑口径（2026-07-08）", () => {
  it("景别/运镜标注为可选、缺失判 ok 而非 missing", () => {
    expect(RUBRIC).toContain("focalAngle·锦上添花");
    expect(RUBRIC).toContain("movement·锦上添花");
    expect(RUBRIC).toContain("缺失一律判 ok");
    expect(RUBRIC).toContain("缺失判 ok");
  });

  it("无真实首尾帧资产时只审文字起终态锚，不强迫 writer 补分镜图", () => {
    expect(RUBRIC).toContain("没有帧资产本身不扣分");
    expect(RUBRIC).toContain("文字起终态锚");
    expect(RUBRIC).toContain("禁止把新增外部图片资产当成镜头表 writer 可执行的修订项");
    expect(RUBRIC).not.toContain("督促小T 补齐分镜板绑定");
  });

  it("blocking 与运镜只按真实镜头事实审查，不做题材分支", () => {
    expect(RUBRIC).toContain("dims.blocking");
    expect(RUBRIC).toContain("不按题材关键词决定");
    expect(RUBRIC).toContain("不得根据题材要求额外运镜");
  });
});
