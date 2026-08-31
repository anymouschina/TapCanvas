import type { Beat } from "./video-orchestrator.beat-sheet";

export type ShotReference = number[];

export type ClipDramaticCoverage = {
  stateActions: Array<{
    actionId: string;
    shotNos: ShotReference;
  }>;
  audienceRevealShotNos: ShotReference;
  debt: {
    debtId: string;
    lifecycleAction: "plant" | "carry" | "escalate" | "resolve" | "abandon";
    shotNos: ShotReference;
  };
  payoffConsequenceShotNos: ShotReference;
  reactionCarrierShotNos: ShotReference;
  emotionActionShotNos: ShotReference;
  causality: Array<{
    causalityIndex: number;
    shotNos: ShotReference;
  }>;
};

export type DramaticCoverageValidation =
  | { ok: true; coverage: ClipDramaticCoverage }
  | { ok: false; problems: string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readShotNos(input: {
  value: unknown;
  path: string;
  existingShotNos: ReadonlySet<number>;
  problems: string[];
}): number[] {
  if (!Array.isArray(input.value) || input.value.length === 0) {
    input.problems.push(`${input.path} 必须是非空镜号数组`);
    return [];
  }
  const shotNos: number[] = [];
  const seen = new Set<number>();
  input.value.forEach((value, index) => {
    const shotNo = Number(value);
    if (!Number.isInteger(shotNo) || shotNo <= 0) {
      input.problems.push(`${input.path}[${index}] 必须是正整数镜号`);
      return;
    }
    if (!input.existingShotNos.has(shotNo)) {
      input.problems.push(`${input.path}[${index}] 引用了不存在的 shotNo ${shotNo}`);
      return;
    }
    if (seen.has(shotNo)) {
      input.problems.push(`${input.path} 不得重复引用 shotNo ${shotNo}`);
      return;
    }
    seen.add(shotNo);
    shotNos.push(shotNo);
  });
  return shotNos;
}

/**
 * 验证 writer 对冻结戏剧合同的逐镜承载声明。这里只验证引用闭包和一一对应关系，
 * 不根据镜头文案判断语义是否真正兑现；真实兑现仍由成片诊断与用户反馈证明。
 */
export function validateClipDramaticCoverage(input: {
  coverage: unknown;
  shots: unknown;
  beat: Beat;
}): DramaticCoverageValidation {
  const problems: string[] = [];
  const existingShotNos = new Set<number>();
  if (Array.isArray(input.shots)) {
    input.shots.forEach((shot, index) => {
      if (!isRecord(shot)) return;
      const shotNo = shot.shotNo === undefined ? index + 1 : Number(shot.shotNo);
      if (Number.isInteger(shotNo) && shotNo > 0) existingShotNos.add(shotNo);
    });
  }
  if (!isRecord(input.coverage)) {
    return { ok: false, problems: ["dramaticCoverage 必须是对象"] };
  }
  const coverage = input.coverage;
  const readRefs = (value: unknown, path: string): number[] =>
    readShotNos({ value, path, existingShotNos, problems });

  const expectedStateTransitions = input.beat.dramaticChange?.stateTransitions ?? [];
  const stateActions: ClipDramaticCoverage["stateActions"] = [];
  const receivedStateTransitionIndexes: number[] = [];
  if (!Array.isArray(coverage.stateActions)) {
    problems.push("dramaticCoverage.stateActions 必须是数组");
  } else {
    coverage.stateActions.forEach((item, index) => {
      const path = `dramaticCoverage.stateActions[${index}]`;
      if (!isRecord(item)) {
        problems.push(`${path} 必须是对象`);
        return;
      }
      const stateTransitionIndex = Number(item.stateTransitionIndex);
      if (
        !Number.isInteger(stateTransitionIndex) ||
        stateTransitionIndex < 0 ||
        stateTransitionIndex >= expectedStateTransitions.length
      ) {
        problems.push(
          `${path}.stateTransitionIndex 必须是 0..${Math.max(0, expectedStateTransitions.length - 1)} 的整数`,
        );
        return;
      }
      receivedStateTransitionIndexes.push(stateTransitionIndex);
      stateActions.push({
        actionId: expectedStateTransitions[stateTransitionIndex].actionId,
        shotNos: readRefs(item.shotNos, `${path}.shotNos`),
      });
    });
  }
  for (let index = 0; index < expectedStateTransitions.length; index += 1) {
    if (!receivedStateTransitionIndexes.includes(index)) {
      problems.push(`dramaticCoverage.stateActions 缺少 stateTransitionIndex ${index}`);
    }
  }
  if (new Set(receivedStateTransitionIndexes).size !== receivedStateTransitionIndexes.length) {
    problems.push("dramaticCoverage.stateActions.stateTransitionIndex 不得重复");
  }

  const debtRaw = coverage.debt;
  let debt: ClipDramaticCoverage["debt"] = { debtId: "", lifecycleAction: "carry", shotNos: [] };
  if (!isRecord(debtRaw)) {
    problems.push("dramaticCoverage.debt 必须是对象");
  } else {
    const debtId = typeof debtRaw.debtId === "string" ? debtRaw.debtId.trim() : "";
    const lifecycleAction = typeof debtRaw.lifecycleAction === "string" ? debtRaw.lifecycleAction : "";
    const expectedDebt = input.beat.payoff;
    if (!expectedDebt || debtId !== expectedDebt.debtId) {
      problems.push(`dramaticCoverage.debt.debtId 必须逐字等于 ${expectedDebt?.debtId ?? "BeatSheet 债务 ID"}`);
    }
    if (!expectedDebt || lifecycleAction !== expectedDebt.lifecycleAction) {
      problems.push(`dramaticCoverage.debt.lifecycleAction 必须逐字等于 ${expectedDebt?.lifecycleAction ?? "BeatSheet 生命周期动作"}`);
    }
    debt = {
      debtId,
      lifecycleAction: lifecycleAction as ClipDramaticCoverage["debt"]["lifecycleAction"],
      shotNos: readRefs(debtRaw.shotNos, "dramaticCoverage.debt.shotNos"),
    };
  }

  const expectedCausalityCount = input.beat.pacingDecision?.essentialCausality.length ?? 0;
  const causality: ClipDramaticCoverage["causality"] = [];
  const receivedCausalityIndexes: number[] = [];
  if (!Array.isArray(coverage.causality)) {
    problems.push("dramaticCoverage.causality 必须是数组");
  } else {
    coverage.causality.forEach((item, index) => {
      const path = `dramaticCoverage.causality[${index}]`;
      if (!isRecord(item)) {
        problems.push(`${path} 必须是对象`);
        return;
      }
      const causalityIndex = Number(item.causalityIndex);
      if (!Number.isInteger(causalityIndex) || causalityIndex < 0 || causalityIndex >= expectedCausalityCount) {
        problems.push(`${path}.causalityIndex 必须是 0..${Math.max(0, expectedCausalityCount - 1)} 的整数`);
      }
      receivedCausalityIndexes.push(causalityIndex);
      causality.push({ causalityIndex, shotNos: readRefs(item.shotNos, `${path}.shotNos`) });
    });
  }
  for (let index = 0; index < expectedCausalityCount; index += 1) {
    if (!receivedCausalityIndexes.includes(index)) problems.push(`dramaticCoverage.causality 缺少 causalityIndex ${index}`);
  }
  if (new Set(receivedCausalityIndexes).size !== receivedCausalityIndexes.length) {
    problems.push("dramaticCoverage.causality.causalityIndex 不得重复");
  }

  const normalized: ClipDramaticCoverage = {
    stateActions,
    audienceRevealShotNos: readRefs(coverage.audienceRevealShotNos, "dramaticCoverage.audienceRevealShotNos"),
    debt,
    payoffConsequenceShotNos: readRefs(coverage.payoffConsequenceShotNos, "dramaticCoverage.payoffConsequenceShotNos"),
    reactionCarrierShotNos: readRefs(coverage.reactionCarrierShotNos, "dramaticCoverage.reactionCarrierShotNos"),
    emotionActionShotNos: readRefs(coverage.emotionActionShotNos, "dramaticCoverage.emotionActionShotNos"),
    causality,
  };
  return problems.length ? { ok: false, problems } : { ok: true, coverage: normalized };
}
