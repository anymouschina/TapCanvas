import { describe, expect, it } from "vitest";

import {
  buildClipId,
  buildClipPlan,
  buildClipTimingPlan,
  buildRealizedPlanSummary,
  computeClipDurations,
  deriveClipNodeId,
  detectMontageCarpet,
  detectDurationUniformity,
  detectPacingOvershoot,
  extractExplicitClipDurations,
  shouldReanchorClipFirstFrame,
  snapToNearestOption,
} from "./video-orchestrator.clip-plan";

const editorialModes = (count: number): "editorial_cut"[] =>
  Array.from({ length: count }, () => "editorial_cut" as const);

describe("BeatSheet 前的 timing plan 与冻结后的 execution plan", () => {
  it("完整章节预规划可先产生 12 个合法时长槽位，不伪造连续性拓扑", () => {
    const timingPlan = buildClipTimingPlan({
      runId: "chapter-33-v1",
      targetDurationSeconds: 180,
      durationOptions: [5, 10, 15],
      editingStyle: "cut",
    });

    expect(timingPlan).toHaveLength(12);
    expect(timingPlan.every((item) => item.durationSeconds === 15)).toBe(true);
    expect(timingPlan.every((item) => item.continuityTopology === "unresolved")).toBe(true);
    expect(
      timingPlan.every(
        (item) => !Object.prototype.hasOwnProperty.call(item, "expectedPrevClipIndex"),
      ),
    ).toBe(true);
  });

  it("BeatSheet 后的 execution plan 保留 agents 的逐镜模式并标记已解析", () => {
    const executionPlan = buildClipPlan({
      runId: "chapter-33-v1",
      targetDurationSeconds: 30,
      durationOptions: [5, 10, 15],
      explicitDurations: [15, 15],
      continuityModes: ["editorial_cut", "reference_video"],
    });

    expect(executionPlan.map((item) => item.continuityTopology)).toEqual([
      "resolved",
      "resolved",
    ]);
    expect(executionPlan.map((item) => item.continuityMode)).toEqual([
      "editorial_cut",
      "reference_video",
    ]);
    expect(executionPlan.map((item) => item.expectedPrevClipIndex)).toEqual([null, 0]);
  });
});

describe("shouldReanchorClipFirstFrame（2026-07-06 用户禁令后：一律重锚·无视频续写）", () => {
  it("任何语态任何镜位都重锚（含旧 continuous——视频输入续写已禁、段间禁串行）", () => {
    expect(shouldReanchorClipFirstFrame(0, "continuous")).toBe(true);
    expect(shouldReanchorClipFirstFrame(0, "montage")).toBe(true);
    expect(shouldReanchorClipFirstFrame(0, undefined)).toBe(true);
    expect(shouldReanchorClipFirstFrame(1, "montage")).toBe(true);
    expect(shouldReanchorClipFirstFrame(5, "montage")).toBe(true);
    expect(shouldReanchorClipFirstFrame(1, "continuous")).toBe(true);
    expect(shouldReanchorClipFirstFrame(3, "continuous")).toBe(true);
    expect(shouldReanchorClipFirstFrame(1, undefined)).toBe(true);
    expect(shouldReanchorClipFirstFrame(7, "cut")).toBe(true);
  });
});

describe("cut 模式：独立完整切镜 → 镜间无依赖 → 可并行", () => {
  it("buildClipPlan(cut)：所有 clip 的 expectedPrevClipIndex 都为 null（无续写依赖、可并行）", () => {
    const plan = buildClipPlan({
      runId: "r1",
      targetDurationSeconds: 20,
      durationOptions: [4, 5, 6],
      explicitDurations: [5, 4, 6, 5],
      editingStyle: "cut",
      continuityModes: editorialModes(4),
    });
    expect(plan).toHaveLength(4);
    expect(plan.every((c) => c.expectedPrevClipIndex === null)).toBe(true);
  });
  it("continuous 也全并发（2026-07-06 用户禁令：段间禁串行，expectedPrevClipIndex 一律 null）", () => {
    const plan = buildClipPlan({
      runId: "r1",
      targetDurationSeconds: 20,
      durationOptions: [4, 5, 6],
      explicitDurations: [5, 4, 6, 5],
      editingStyle: "continuous",
      continuityModes: editorialModes(4),
    });
    expect(plan.every((c) => c.expectedPrevClipIndex === null)).toBe(true);
  });
  it("逐 clip reference_video：只为声明该模式的 clip 建立上一段依赖", () => {
    const plan = buildClipPlan({
      runId: "r1",
      targetDurationSeconds: 20,
      durationOptions: [4, 5, 6],
      explicitDurations: [5, 4, 6, 5],
      editingStyle: "cut",
      continuityModes: [
        "editorial_cut",
        "reference_video",
        "reference_video",
        "reference_video",
      ],
    });
    expect(plan).toHaveLength(4);
    expect(plan[0]!.expectedPrevClipIndex).toBeNull();
    expect(plan[1]!.expectedPrevClipIndex).toBe(0);
    expect(plan[2]!.expectedPrevClipIndex).toBe(1);
    expect(plan[3]!.expectedPrevClipIndex).toBe(2);
  });
  it("editorial_cut 与 bridge_frames 都不制造运行时视频依赖", () => {
    const plan = buildClipPlan({
      runId: "r1",
      targetDurationSeconds: 20,
      durationOptions: [4, 5, 6],
      explicitDurations: [5, 4, 6, 5],
      continuityModes: ["editorial_cut", "bridge_frames", "editorial_cut", "bridge_frames"],
    });
    expect(plan.every((c) => c.expectedPrevClipIndex === null)).toBe(true);
  });
  it("混合 continuityMode 逐段生效：reference_video 串行，其余段并发", () => {
    const plan = buildClipPlan({
      runId: "r1",
      targetDurationSeconds: 25,
      durationOptions: [4, 5, 6],
      explicitDurations: [5, 4, 6, 5, 5],
      continuityModes: [
        "editorial_cut",
        "editorial_cut",
        "reference_video",
        "reference_video",
        "editorial_cut",
      ],
    });
    expect(plan.map((c) => c.expectedPrevClipIndex)).toEqual([null, null, 1, 2, null]);
  });
  it("连续性数量或枚举不合法时显式失败，不使用默认模式", () => {
    expect(() =>
      buildClipPlan({
        runId: "r1",
        targetDurationSeconds: 15,
        durationOptions: [4, 5, 6],
        explicitDurations: [5, 4, 6],
        continuityModes: ["editorial_cut"],
      }),
    ).toThrow("video_continuity_topology_mismatch");
    expect(() =>
      buildClipPlan({
        runId: "r1",
        targetDurationSeconds: 10,
        durationOptions: [4, 5, 6],
        explicitDurations: [5, 5],
        continuityModes: ["editorial_cut", "invalid"],
      }),
    ).toThrow("video_continuity_mode_invalid:clip=1");
  });
});

describe("detectPacingOvershoot（导演给sub-floor时长致总时长暴涨的告警）", () => {
  // 实测复现：seedance 最小档=4，导演 7 镜各 2s → snap 后 7×4=28s，远超 15s 目标。
  it("7 镜×4s=28s vs 目标 15s（floor=4）→ 告警 + 建议镜数", () => {
    const w = detectPacingOvershoot({
      targetDurationSeconds: 15,
      realizedDurations: [4, 4, 4, 4, 4, 4, 4],
      durationOptions: [4, 8, 12],
    });
    expect(w).toBeTruthy();
    expect(w).toContain("28s");
    expect(w).toContain("15s");
    expect(w).toContain("4 镜"); // round(15/4)=4
  });

  it("正常 montage 4×4s=16s vs 15s（仅多 1s 末段补余）→ 不告警", () => {
    expect(
      detectPacingOvershoot({
        targetDurationSeconds: 15,
        realizedDurations: [4, 4, 4, 4],
        durationOptions: [4, 8, 12],
      }),
    ).toBeNull();
  });

  it("恰好等于目标 → 不告警", () => {
    expect(
      detectPacingOvershoot({
        targetDurationSeconds: 20,
        realizedDurations: [5, 5, 5, 5],
        durationOptions: [5, 10, 15],
      }),
    ).toBeNull();
  });

  it("欠时长（undershoot）→ 不告警", () => {
    expect(
      detectPacingOvershoot({
        targetDurationSeconds: 30,
        realizedDurations: [5, 5],
        durationOptions: [5, 10, 15],
      }),
    ).toBeNull();
  });

  it("无档位数据 → 不告警(无依据)", () => {
    expect(
      detectPacingOvershoot({ targetDurationSeconds: 15, realizedDurations: [4, 4], durationOptions: [] }),
    ).toBeNull();
  });
});

describe("detectMontageCarpet（montage 把连贯叙事碎成均匀最短快切毯·碎而不超时）", () => {
  // 本次故障：选了 montage 又没给 durationSeconds → 6×4s 均匀毯，总时长没超标(overshoot 不触发)、
  // montage 又合法(decision 放行)，两闸都漏，没人提醒"碎切过度"。
  it("montage + 全=minDur(4) + 6 镜 → 告警(含镜数与最小档)", () => {
    const w = detectMontageCarpet({
      editingStyle: "montage",
      realizedDurations: [4, 4, 4, 4, 4, 4],
      durationOptions: [4, 8, 12],
    });
    expect(w).toBeTruthy();
    expect(w).toContain("6 个最短 4s");
    expect(w).toContain("cut");
    expect(w).toContain("durationSeconds");
  });

  it("镜数恰好达阈值(默认4) → 告警；阈值-1(3镜) → null", () => {
    expect(
      detectMontageCarpet({
        editingStyle: "montage",
        realizedDurations: [5, 5, 5, 5],
        durationOptions: [5, 10, 15],
      }),
    ).toBeTruthy();
    expect(
      detectMontageCarpet({
        editingStyle: "montage",
        realizedDurations: [5, 5, 5],
        durationOptions: [5, 10, 15],
      }),
    ).toBeNull();
  });

  it("可调阈值 minClips", () => {
    expect(
      detectMontageCarpet({
        editingStyle: "montage",
        realizedDurations: [5, 5],
        durationOptions: [5, 10, 15],
        minClips: 2,
      }),
    ).toBeTruthy();
  });

  it("montage 但并非全最小档(含长镜) → null（不是均匀碎毯）", () => {
    expect(
      detectMontageCarpet({
        editingStyle: "montage",
        realizedDurations: [4, 4, 8, 4],
        durationOptions: [4, 8, 12],
      }),
    ).toBeNull();
  });

  it("continuous / 默认语态 / 显式时长场景 → 一律 null（只针对 montage 碎毯）", () => {
    expect(
      detectMontageCarpet({
        editingStyle: "continuous",
        realizedDurations: [4, 4, 4, 4],
        durationOptions: [4, 8, 12],
      }),
    ).toBeNull();
    expect(
      detectMontageCarpet({
        realizedDurations: [4, 4, 4, 4],
        durationOptions: [4, 8, 12],
      }),
    ).toBeNull();
  });

  it("无档位数据 → null（无依据）", () => {
    expect(
      detectMontageCarpet({
        editingStyle: "montage",
        realizedDurations: [4, 4, 4, 4],
        durationOptions: [],
      }),
    ).toBeNull();
  });
});

describe("buildRealizedPlanSummary（estimate 恒附·显性化几镜×各多长×语态）", () => {
  it("montage 碎毯：摊开镜数/逐镜时长/总时长/语态标签", () => {
    const s = buildRealizedPlanSummary({
      realizedDurations: [4, 4, 4, 4, 4, 4],
      editingStyle: "montage",
    });
    expect(s).toContain("6 镜");
    expect(s).toContain("[4,4,4,4,4,4]s");
    expect(s).toContain("24s");
    expect(s).toContain("montage");
  });

  it("显式逐镜时长 → 语态标签=显式 durationSeconds", () => {
    const s = buildRealizedPlanSummary({
      realizedDurations: [8, 12],
      explicit: true,
    });
    expect(s).toContain("2 镜");
    expect(s).toContain("20s");
    expect(s).toContain("显式 durationSeconds");
  });

  it("缺省语态 → cut（多镜镜头表·默认）标签", () => {
    const s = buildRealizedPlanSummary({ realizedDurations: [15, 5] });
    expect(s).toContain("cut");
  });
});

describe("extractExplicitClipDurations (全片 all-or-nothing)", () => {
  it("每段都有正 durationSeconds → 返回逐段秒数", () => {
    expect(
      extractExplicitClipDurations([{ durationSeconds: 3 }, { durationSeconds: 5 }]),
    ).toEqual([3, 5]);
  });
  it("有一段缺失 → undefined（回退语态/拉满）", () => {
    expect(extractExplicitClipDurations([{ durationSeconds: 3 }, {}])).toBeUndefined();
  });
  it("含非正值 → undefined", () => {
    expect(
      extractExplicitClipDurations([{ durationSeconds: 3 }, { durationSeconds: 0 }]),
    ).toBeUndefined();
  });
  it("空数组 → undefined", () => {
    expect(extractExplicitClipDurations([])).toBeUndefined();
  });
});

describe("computeClipDurations (拉满优先、末段补余、数据驱动)", () => {
  it("Seedance 2.5 的 40 秒目标按动态 30 秒上限拆成 30+10，而不是 4×10", () => {
    expect(
      computeClipDurations({
        targetDurationSeconds: 40,
        durationOptions: Array.from({ length: 27 }, (_, index) => index + 4),
      }),
    ).toEqual([30, 10]);
  });

  it("余量小于模型最短档时从上一最大段借时，31 秒精确拆成 27+4", () => {
    expect(
      computeClipDurations({
        targetDurationSeconds: 31,
        durationOptions: Array.from({ length: 27 }, (_, index) => index + 4),
      }),
    ).toEqual([27, 4]);
  });

  it("25s + pixverse(max15, options[5,10,15]) → [15,10]", () => {
    expect(
      computeClipDurations({ targetDurationSeconds: 25, durationOptions: [5, 10, 15] }),
    ).toEqual([15, 10]);
  });

  it("25s + seedance(max10, options[5,10]) → [10,10,5]", () => {
    expect(
      computeClipDurations({ targetDurationSeconds: 25, durationOptions: [5, 10] }),
    ).toEqual([10, 10, 5]);
  });

  it("60s + pixverse(max15) → [15,15,15,15]", () => {
    expect(
      computeClipDurations({ targetDurationSeconds: 60, durationOptions: [5, 10, 15] }),
    ).toEqual([15, 15, 15, 15]);
  });

  it("目标低于模型最短档时显式失败，不向上取整", () => {
    expect(() =>
      computeClipDurations({ targetDurationSeconds: 3, durationOptions: [5, 10, 15] }),
    ).toThrow("video_exact_duration_unsupported:target=3:allowed=5,10,15");
  });

  it("离散档位无法精确组成目标时显式失败，不把 24 秒吸附为 25 秒", () => {
    expect(() =>
      computeClipDurations({ targetDurationSeconds: 24, durationOptions: [5, 10, 15] }),
    ).toThrow("video_exact_duration_unsupported:target=24:allowed=5,10,15");
  });

  it("empty options → 显式失败，禁止编造目标时长档位", () => {
    expect(() =>
      computeClipDurations({ targetDurationSeconds: 12, durationOptions: [] }),
    ).toThrow("video_generation_duration_options_missing");
  });

  it("continuous(默认) 与历史行为逐字等价：20s + seedance(max15) → [15,5]", () => {
    // 时尚大片此前的「慢」根因：默认拉满 = 最少段、最长段 = 节奏最慢。
    expect(
      computeClipDurations({ targetDurationSeconds: 20, durationOptions: [5, 10, 15] }),
    ).toEqual([15, 5]);
    expect(
      computeClipDurations({
        targetDurationSeconds: 20,
        durationOptions: [5, 10, 15],
        editingStyle: "continuous",
      }),
    ).toEqual([15, 5]);
  });
});

describe("computeClipDurations · 节奏旋钮（修复「拆段算法独占节奏」根因）", () => {
  it("montage 语态=切碎优先(单位取最小档)：20s + [5,10,15] → [5,5,5,5] 快切", () => {
    // 时尚大片/MV/广告要的就是这个——镜头最多、单镜最短。
    expect(
      computeClipDurations({
        targetDurationSeconds: 20,
        durationOptions: [5, 10, 15],
        editingStyle: "montage",
      }),
    ).toEqual([5, 5, 5, 5]);
  });

  it("cut 语态=拉满 maxDur（每场景一条≈15s多镜长镜·模型内部切镜）：20s + [5,10,15] → [15,5]", () => {
    // 新模型：一个场景=一条多镜镜头表 clip≈maxDur，模型内部切镜（不再把场景切成 5s 短镜）。
    expect(
      computeClipDurations({
        targetDurationSeconds: 20,
        durationOptions: [5, 10, 15],
        editingStyle: "cut",
      }),
    ).toEqual([15, 5]);
  });

  it("显式分镜时长优先级最高：clips 给了 durationSeconds 就尊重它定段数+每段时长", () => {
    expect(
      computeClipDurations({
        targetDurationSeconds: 20,
        durationOptions: [5, 10, 15],
        explicitDurations: [5, 5, 5, 5],
      }),
    ).toEqual([5, 5, 5, 5]);
  });

  it("显式非法时长直接失败，禁止 [7,8] 静默吸附为 [10,10]", () => {
    expect(() =>
      computeClipDurations({
        targetDurationSeconds: 20,
        durationOptions: [5, 10, 15],
        explicitDurations: [7, 8],
      }),
    ).toThrow("video_generation_explicit_duration_invalid:7,8:allowed=5,10,15");
  });

  it("显式时长压倒 editingStyle：两者都给时以显式为准", () => {
    expect(
      computeClipDurations({
        targetDurationSeconds: 30,
        durationOptions: [5, 10, 15],
        explicitDurations: [10, 10, 10],
        editingStyle: "continuous",
      }),
    ).toEqual([10, 10, 10]);
  });
});

describe("buildClipPlan · 节奏旋钮", () => {
  it("editingStyle:montage → 多段短镜 slot，镜间独立并行（重锚静帧·不接尾帧）", () => {
    const plan = buildClipPlan({
      runId: "run-m",
      targetDurationSeconds: 20,
      durationOptions: [5, 10, 15],
      editingStyle: "montage",
      continuityModes: editorialModes(4),
    });
    expect(plan).toHaveLength(4);
    expect(plan.map((p) => p.durationSeconds)).toEqual([5, 5, 5, 5]);
    expect(plan.every((c) => c.expectedPrevClipIndex === null)).toBe(true);
  });

  it("explicitDurations → clipPlan 段数与显式分镜数一致（导演完全掌控镜头数）", () => {
    const plan = buildClipPlan({
      runId: "run-e",
      targetDurationSeconds: 20,
      durationOptions: [5, 10, 15],
      explicitDurations: [5, 5, 5, 5, 5],
      continuityModes: editorialModes(5),
    });
    expect(plan).toHaveLength(5);
  });
});

describe("snapToNearestOption", () => {
  it("returns first option >= value", () => {
    expect(snapToNearestOption(7, [5, 10, 15])).toBe(10);
    expect(snapToNearestOption(10, [5, 10, 15])).toBe(10);
  });
  it("clamps above max to max", () => {
    expect(snapToNearestOption(20, [5, 10, 15])).toBe(15);
  });
});

describe("clipId / slot derivation (确定性、防 LLM 随机 nodeId)", () => {
  it("same runId+clipIndex → same clipId and slot nodeId", () => {
    const a = buildClipId("run-x", 2);
    const b = buildClipId("run-x", 2);
    expect(a).toBe("run-x:clip:2");
    expect(a).toBe(b);
    expect(deriveClipNodeId(a)).toBe(deriveClipNodeId(b));
    expect(deriveClipNodeId(a)).toMatch(/^vclip-[0-9a-f]{24}$/);
  });

  it("different clipIndex → different slot", () => {
    expect(deriveClipNodeId(buildClipId("run-x", 0))).not.toBe(
      deriveClipNodeId(buildClipId("run-x", 1)),
    );
  });
});

describe("buildClipPlan", () => {
  it("缺省语态 → 默认 cut：每段独立 slot、expectedPrevClipIndex 全 null（并行），时长仍拉满 maxDur", () => {
    const plan = buildClipPlan({
      runId: "run-1",
      targetDurationSeconds: 25,
      durationOptions: [5, 10, 15],
      continuityModes: editorialModes(2),
    });
    expect(plan).toHaveLength(2);
    expect(plan[0]).toMatchObject({
      clipIndex: 0,
      durationSeconds: 15,
      clipId: "run-1:clip:0",
      expectedPrevClipIndex: null,
    });
    expect(plan[1]).toMatchObject({
      clipIndex: 1,
      durationSeconds: 10,
      clipId: "run-1:clip:1",
      expectedPrevClipIndex: null,
    });
    expect(plan[0]!.nodeId).not.toBe(plan[1]!.nodeId);
  });
});

describe("detectDurationUniformity（镜长均匀=单调告警）", () => {
  it("≥6 镜全落同一 2s 窗 → 告警", () => {
    const msg = detectDurationUniformity({ realizedDurations: [10, 10, 11, 10, 12, 11, 10] });
    expect(msg).toContain("均匀");
    expect(msg).toContain("4-6s");
  });
  it("拉开两档不告警;<6 镜不告警;montage 交给 carpet 不告警", () => {
    expect(detectDurationUniformity({ realizedDurations: [4, 12, 5, 10, 6, 15] })).toBeNull();
    expect(detectDurationUniformity({ realizedDurations: [10, 10, 10] })).toBeNull();
    expect(
      detectDurationUniformity({ editingStyle: "montage", realizedDurations: [4, 4, 4, 4, 4, 4] }),
    ).toBeNull();
  });
});
