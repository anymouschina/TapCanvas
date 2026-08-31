import { describe, expect, it } from "vitest";

import type { Beat } from "./video-orchestrator.beat-sheet";
import { validateClipDramaticCoverage } from "./video-orchestrator.dramatic-coverage";

const beat: Beat = {
  clipIndex: 3,
  logline: "孟川以退为进，夺回通道控制权",
  startKeyframe: "孟川被拦在通道外",
  endKeyframe: "孟川进入通道，对手失去阻拦位置",
  exitState: "孟川站在通道内侧，对手重心失衡",
  rhythmRole: "爆发",
  arcContract: { arcRole: "continuous", closureMode: "open_motion", arcFunction: "连续推进", sequenceContext: "多段序列中的技术窗口" },
  dramaticChange: {
    objective: "进入通道",
    obstacle: "对手封路",
    stake: "错过救援时机",
    choice: "主动后撤诱使对手前压",
    consequence: "侧向切入夺回通道",
    stateDelta: "通道控制权易手",
    stateTransitions: [
      {
        actionId: "control-channel-3",
        entity: "孟川",
        dimension: "control",
        before: "无法进入通道",
        after: "控制通道内侧",
        causeCausalityIndex: 1,
        persistence: "beat",
      },
    ],
  },
  audienceExperience: {
    pov: "孟川有限视点",
    knowledgeGap: "观众先不知道后撤是诱敌",
    revealOrder: "先退后显露侧切路线",
    intendedQuestion: "他为什么主动让出距离",
  },
  payoff: {
    debtId: "debt-channel",
    lifecycleAction: "resolve",
    eligibleFromClipIndex: 3,
    setupDebt: "此前两次被挡回",
    payoffType: "策略兑现",
    payoffMoment: "对手前压后露出通道",
    visibleConsequence: "孟川切入，对手失位",
    reactionCarrier: "对手脚步急停仍来不及回身",
  },
  emotionTurn: {
    residueIn: "连续受阻后的急迫",
    before: "想正面抢入",
    trigger: "看见对手重心跟随前压",
    suppressionLeak: "呼吸一顿但目光仍锁住通道",
    after: "把急迫压成诱敌耐心",
    actionChange: "由正面强闯改为后撤诱敌再侧切",
    residueOut: "夺路成功但救援时间更少",
  },
  pacingDecision: {
    sourceTreatment: "compress",
    essentialCausality: ["孟川主动后撤", "对手前压后暴露通道"],
    causalProvenance: [
      { evidenceType: "source_fact", sourceMarker: "孟川忽然后退" },
      { evidenceType: "necessary_physical_result", sourceMarker: "通道露出" },
    ],
    handoffToNext: "孟川进入通道继续救援",
  },
  durationBudget: 10,
  characterRoleNames: ["孟川", "守卫"],
  speakerNames: [],
  dialogueScript: [],
  vfxNames: [],
  storyboardImageNodeId: "keyframe-3",
  continuityMode: "editorial_cut",
  assetObjectContracts: [],
};

const shots = [
  { shotNo: 1, action: "孟川主动后撤", durationSeconds: 3 },
  { shotNo: 2, action: "守卫前压，通道暴露", durationSeconds: 3 },
  { shotNo: 3, action: "孟川侧切进入通道", durationSeconds: 4 },
];

function validCoverage(): Record<string, unknown> {
  return {
    stateActions: [{ stateTransitionIndex: 0, shotNos: [2, 3] }],
    audienceRevealShotNos: [2],
    debt: { debtId: "debt-channel", lifecycleAction: "resolve", shotNos: [2, 3] },
    payoffConsequenceShotNos: [3],
    reactionCarrierShotNos: [2, 3],
    emotionActionShotNos: [1, 3],
    causality: [
      { causalityIndex: 0, shotNos: [1] },
      { causalityIndex: 1, shotNos: [2, 3] },
    ],
  };
}

describe("validateClipDramaticCoverage", () => {
  it("accepts an exact, shot-addressable mapping for every frozen dramatic obligation", () => {
    const result = validateClipDramaticCoverage({ coverage: validCoverage(), shots, beat });
    expect(result).toEqual(expect.objectContaining({ ok: true }));
    if (result.ok) {
      expect(result.coverage.stateActions[0]).toEqual({
        actionId: "control-channel-3",
        shotNos: [2, 3],
      });
      expect(result.coverage.causality.map((item) => item.causalityIndex)).toEqual([0, 1]);
    }
  });

  it("rejects a missing state action instead of inferring it from shot prose", () => {
    const coverage = validCoverage();
    coverage.stateActions = [];
    const result = validateClipDramaticCoverage({ coverage, shots, beat });
    expect(result).toEqual(expect.objectContaining({ ok: false }));
    if (!result.ok) expect(result.problems).toContain("dramaticCoverage.stateActions 缺少 stateTransitionIndex 0");
  });

  it("rejects a writer-authored actionId and requires a frozen transition index", () => {
    const coverage = validCoverage();
    coverage.stateActions = [{ actionId: "control-channel-3", shotNos: [2, 3] }];
    const result = validateClipDramaticCoverage({ coverage, shots, beat });
    expect(result).toEqual(expect.objectContaining({ ok: false }));
    if (!result.ok) {
      expect(result.problems).toContain(
        "dramaticCoverage.stateActions[0].stateTransitionIndex 必须是 0..0 的整数",
      );
    }
  });

  it("rejects a rewritten debt identity or lifecycle", () => {
    const coverage = validCoverage();
    coverage.debt = { debtId: "new-debt", lifecycleAction: "plant", shotNos: [2] };
    const result = validateClipDramaticCoverage({ coverage, shots, beat });
    expect(result).toEqual(expect.objectContaining({ ok: false }));
    if (!result.ok) {
      expect(result.problems).toEqual(expect.arrayContaining([
        expect.stringContaining("debtId 必须逐字等于 debt-channel"),
        expect.stringContaining("lifecycleAction 必须逐字等于 resolve"),
      ]));
    }
  });

  it("rejects references to a shot that does not exist", () => {
    const coverage = validCoverage();
    coverage.payoffConsequenceShotNos = [4];
    const result = validateClipDramaticCoverage({ coverage, shots, beat });
    expect(result).toEqual(expect.objectContaining({ ok: false }));
    if (!result.ok) expect(result.problems).toContain(
      "dramaticCoverage.payoffConsequenceShotNos[0] 引用了不存在的 shotNo 4",
    );
  });

  it("rejects an omitted essential-causality index", () => {
    const coverage = validCoverage();
    coverage.causality = [{ causalityIndex: 0, shotNos: [1] }];
    const result = validateClipDramaticCoverage({ coverage, shots, beat });
    expect(result).toEqual(expect.objectContaining({ ok: false }));
    if (!result.ok) expect(result.problems).toContain("dramaticCoverage.causality 缺少 causalityIndex 1");
  });
});
