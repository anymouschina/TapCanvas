import type { VideoRunRow } from "./video-run.repo";

export type FrozenLoopIdentity = {
  revision: string;
  fingerprint: string;
};

export type FrozenLoopExistingRunDecision =
  | { kind: "accept_new" }
  | {
      kind: "return_existing";
      authoringState: string;
      productionState: string;
    }
  | {
      kind: "reject_conflict";
      code: "video_loop_run_identity_conflict" | "video_loop_run_not_authoring";
      message: string;
    };

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function readPersistedFrozenLoopIdentity(
  beatSheetJson: string | null,
): FrozenLoopIdentity | null {
  if (!beatSheetJson) return null;
  try {
    const sheet = readRecord(JSON.parse(beatSheetJson));
    const meta = readRecord(sheet?.meta);
    const revision = typeof meta?.preflightRevision === "string"
      ? meta.preflightRevision.trim()
      : "";
    const fingerprint = typeof meta?.preflightFingerprint === "string"
      ? meta.preflightFingerprint.trim()
      : "";
    return revision && fingerprint ? { revision, fingerprint } : null;
  } catch {
    return null;
  }
}

/**
 * A public loop runId is immutable after its first durable acceptance.
 * Replaying the same frozen reference returns the existing run; presenting a
 * different creative fingerprint under the same runId is an explicit conflict
 * and must use a new runId. A physical continuation may produce a different
 * preflight revision because runtime provenance changed; replaying that
 * revision is safe when the canonical creative fingerprint is identical,
 * because this branch returns the existing run without rewriting its graph.
 */
export function decideFrozenLoopExistingRun(input: {
  existing: Pick<VideoRunRow, "id" | "state" | "authoring_state" | "beat_sheet"> | null;
  requested: FrozenLoopIdentity;
}): FrozenLoopExistingRunDecision {
  if (!input.existing) return { kind: "accept_new" };
  const authoringState = String(input.existing.authoring_state ?? "").trim();
  const persisted = readPersistedFrozenLoopIdentity(input.existing.beat_sheet);
  if (!authoringState || !persisted) {
    return {
      kind: "reject_conflict",
      code: "video_loop_run_not_authoring",
      message:
        `runId「${input.existing.id}」已被非一键成片运行占用；禁止覆盖既有运行事实，请使用新的 runId。`,
    };
  }
  if (persisted.fingerprint !== input.requested.fingerprint) {
    return {
      kind: "reject_conflict",
      code: "video_loop_run_identity_conflict",
      message:
        `runId「${input.existing.id}」已绑定另一份冻结 BeatSheet；运行一经受理不可重写，请为新版本使用新的 runId。`,
    };
  }
  return {
    kind: "return_existing",
    authoringState,
    productionState: input.existing.state,
  };
}

export function buildIdempotentVideoLoopReceipt(input: {
  runId: string;
  requestedMode: string;
  authoringState: string;
  productionState: string;
}): Record<string, unknown> {
  return {
    ok: true,
    mode: input.requestedMode,
    code: "video_loop_already_accepted",
    terminal: false,
    runTerminal: false,
    acceptedAsync: true,
    idempotent: true,
    shouldYield: true,
    turnComplete: true,
    runId: input.runId,
    authoringState: input.authoringState,
    productionState: input.productionState,
    waitingFor: "video_run_evidence",
    message:
      "同一冻结 BeatSheet 已由后台交付图受理；本次为幂等回放，未重写 DAG、未重复派发 writer、未重复提交供应商。",
  };
}
