import {
  buildBeatSheetRepairActions,
  type BeatSheetRepairAction,
  type BeatSheetRepairTargets,
} from "./video-orchestrator.repair-targets";

export type BeatSheetCommitRepairDescriptor = {
  code: "source_coverage_plan_invalid" | "source_speech_ledger_mismatch";
  message: string;
  issues: string[];
  targets: BeatSheetRepairTargets;
  actions: BeatSheetRepairAction[];
};

function normalizeIssues(issues: readonly string[]): string[] {
  return Array.from(new Set(issues.map((issue) => issue.trim()).filter(Boolean)));
}

/**
 * Source coverage is owned by the chapter header. This helper only maps the
 * deterministic validator surface to its durable graph address; it does not
 * interpret source prose or author a repair.
 */
export function buildSourceCoverageCommitRepair(
  issues: readonly string[],
): BeatSheetCommitRepairDescriptor {
  const normalized = normalizeIssues(issues);
  const targets: BeatSheetRepairTargets = {
    header: true,
    clipIndexes: [],
    continuityClipIndexes: [],
  };
  return {
    code: "source_coverage_plan_invalid",
    message: `sourceCoveragePlan 需要同链修订：${normalized.join("；")}`,
    issues: normalized.map((issue) => `sourceCoveragePlan: ${issue}`),
    targets,
    actions: buildBeatSheetRepairActions(targets),
  };
}

/**
 * A speech-conservation mismatch compares two independently authored graph
 * surfaces: the header ledger and per-beat dialogue scripts. The runtime must
 * expose both address spaces and let the agent inspect the source before it
 * chooses which semantic value to change. It must never guess that the header
 * or a beat is authoritative from story text.
 */
export function buildSpeechLedgerCommitRepair(input: {
  issues: readonly string[];
  expectedBeatCount: number;
}): BeatSheetCommitRepairDescriptor {
  const normalized = normalizeIssues(input.issues);
  const clipIndexes = Array.from(
    { length: Math.max(0, Math.trunc(input.expectedBeatCount)) },
    (_, clipIndex) => clipIndex,
  );
  const targets: BeatSheetRepairTargets = {
    header: true,
    clipIndexes,
    continuityClipIndexes: [],
  };
  return {
    code: "source_speech_ledger_mismatch",
    message: `章级发声台账与逐拍对白未守恒，需要读取原文后在同一 draft 修订：${normalized.join("；")}`,
    issues: [
      ...normalized.map((issue) => `sourceCoveragePlan.speechLedger: ${issue}`),
      ...clipIndexes.map((clipIndex) => (
        `beats[${clipIndex}].dialogueScript: 与章级 speechLedger 共同参与守恒，等待 agent 基于原文裁决修订 owner`
      )),
    ],
    targets,
    actions: buildBeatSheetRepairActions(targets),
  };
}
