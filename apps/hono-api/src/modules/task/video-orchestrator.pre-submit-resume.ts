import type { AppContext } from "../../types";
import {
  freshReadFlowRow,
  persistFlowPatch,
  readFlowNodes,
  type VideoFlowNode,
} from "./video-orchestrator.flow-io";
import { upsertVideoRunStatusNode } from "./video-orchestrator.status-node";
import {
  loadVerifiedPreSubmitCapacityEvidence,
  type PreSubmitEvidenceDiagnostic,
  type VerifiedPreSubmitEvidence,
} from "./video-orchestrator.pre-submit-evidence";
import {
  getVideoRun,
  resumeFailedVideoRunAfterPreSubmit,
  upsertVideoRunAccumClips,
} from "./video-run.repo";
import {
  isKnownLocalPreUpstreamVideoErrorCode,
  isLegacyLocalPreUpstreamVideoErrorCode,
  readSerializedVideoRunErrorCode,
} from "./video-orchestrator.submit-error";
import {
  invalidateArtifactClosure,
  persistBeatSheetSnapshot,
  listAuthoringArtifacts,
  stableContentHash,
  upsertAuthoringArtifact,
} from "./video-orchestrator.authoring.repo";
import { videoResultArtifactKey } from "./video-orchestrator.authoring-graph";
import {
  rebindExecutableStoryPlanReferences,
  rebindReplanBeatSheetReferences,
  type ReplanReferenceRepairEvidence,
} from "./video-orchestrator.replan-reference";
import { VIDEO_ORCHESTRATOR_PROTOCOL_VERSION } from "@tapcanvas/video-orchestrator-protocol";
import {
  resolveVideoGenerationContract,
  type VideoGenerationContract,
} from "./video-orchestrator.generation-contract";

type ResumeBlocker = {
  code: string;
  nodeId?: string;
  field?: string;
};

export type PreSubmitResumeAssessment = {
  eligible: boolean;
  failedNodes: VideoFlowNode[];
  blockers: ResumeBlocker[];
};

export type VerifiedClipPreSubmitFailureReceipt = {
  artifactKey: string;
  clipIndex: number;
  errorCode: string | null;
};

/**
 * Durable submission intent is the authority for whether a provider request
 * happened. A canvas status may already be blank/queued/submit_retrying when a
 * process dies between recovery writes; the hash-bound receipt remains stable
 * and makes that half-recovered slot safe to reopen without guessing from UI
 * state or error prose.
 */
export function readVerifiedClipPreSubmitFailureReceipts(input: {
  runId: string;
  artifacts: ReadonlyArray<{
    artifact_key: string;
    status: string;
    payload: string | null;
    content_hash: string | null;
  }>;
}): VerifiedClipPreSubmitFailureReceipt[] {
  const receipts: VerifiedClipPreSubmitFailureReceipt[] = [];
  for (const artifact of input.artifacts) {
    const match = /^video-submission:(\d+)$/.exec(artifact.artifact_key);
    if (!match || artifact.status !== "stale" || !artifact.payload || !artifact.content_hash) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(artifact.payload);
    } catch {
      continue;
    }
    const record = readRecord(parsed);
    const clipIndex = Number(record?.clipIndex);
    const artifactClipIndex = Number(match[1]);
    const requestHash = typeof record?.requestHash === "string" ? record.requestHash.trim() : "";
    if (
      record?.kind !== "structured_pre_upstream_rejection" ||
      record.phase !== "pre_upstream" ||
      record.runId !== input.runId ||
      record.providerRequestAttempted !== false ||
      record.providerAccepted !== false ||
      record.verifiedBy !== "hono_video_submission_boundary" ||
      !Number.isInteger(clipIndex) || clipIndex < 0 || clipIndex !== artifactClipIndex ||
      !requestHash || requestHash !== artifact.content_hash
    ) continue;
    receipts.push({
      artifactKey: artifact.artifact_key,
      clipIndex,
      errorCode: typeof record.errorCode === "string" && record.errorCode.trim()
        ? record.errorCode.trim()
        : null,
    });
  }
  return receipts.sort((left, right) => left.clipIndex - right.clipIndex);
}

/**
 * A pre-submit rejection is projected both onto the canvas slot and the
 * durable production graph. Resuming only the canvas slot leaves the old
 * `video-result:* = failed` node authoritative, so the next worker closes the
 * run before it can claim a new provider submission. Select the matching
 * result roots structurally by clipIndex; closure invalidation also reopens
 * concat/delivery without touching independent successful clips.
 */
export function buildPreSubmitProductionArtifactRoots(
  failedNodes: readonly VideoFlowNode[],
): string[] {
  const clipIndexes = new Set<number>();
  for (const node of failedNodes) {
    const clipIndex = Number(node.data.clipIndex);
    if (Number.isInteger(clipIndex) && clipIndex >= 0) clipIndexes.add(clipIndex);
  }
  return [...clipIndexes]
    .sort((left, right) => left - right)
    .map(videoResultArtifactKey);
}

export function assessPreNodeCreationResume(input: {
  nodes: readonly VideoFlowNode[];
  runId: string;
  clipsDone: number;
  errorCode: string | null;
  verifiedReceiptCode?: string | null;
}): PreSubmitResumeAssessment {
  const blockers: ResumeBlocker[] = [];
  const runNodes = input.nodes.filter((node) => (
    String(node.data.kind ?? "").trim().toLowerCase() === "video" &&
    String(node.data.clipRunId ?? "").trim() === input.runId
  ));
  const receiptMatches = Boolean(
    input.errorCode && input.verifiedReceiptCode === input.errorCode,
  );
  if (!receiptMatches && !isKnownLocalPreUpstreamVideoErrorCode(input.errorCode)) {
    blockers.push({ code: "run_failure_not_known_pre_upstream" });
  }
  const successfulClipIndexes = new Set<number>();
  for (const node of runNodes) {
    const status = String(node.data.status ?? "").trim().toLowerCase();
    const clipIndex = Number(node.data.clipIndex);
    const hasTaskIdentity = ["taskId", "videoTaskId", "upstreamTaskId", "vendorTaskId"]
      .some((field) => hasNonEmptyString(node.data[field]));
    const hasAsset = hasRealVideoAsset(node.data);
    if (!Number.isInteger(clipIndex) || clipIndex < 0) {
      blockers.push({ code: "run_node_clip_index_invalid", nodeId: node.id });
      continue;
    }
    if (status === "success") {
      if (!hasAsset) {
        blockers.push({ code: "successful_run_node_asset_missing", nodeId: node.id });
        continue;
      }
      if (successfulClipIndexes.has(clipIndex)) {
        blockers.push({ code: "run_node_clip_index_duplicated", nodeId: node.id });
        continue;
      }
      successfulClipIndexes.add(clipIndex);
      continue;
    }
    if (["running", "submitted", "processing"].includes(status)) {
      if (!hasTaskIdentity) {
        blockers.push({ code: "active_run_node_task_identity_missing", nodeId: node.id });
      }
      if (hasAsset) {
        blockers.push({ code: "active_run_node_asset_state_conflict", nodeId: node.id });
      }
      continue;
    }
    if (status === "" || status === "queued") {
      if (hasTaskIdentity || hasAsset) {
        blockers.push({ code: "unsubmitted_run_node_evidence_conflict", nodeId: node.id });
      }
      continue;
    }
    blockers.push({ code: "run_node_state_not_reconcilable", nodeId: node.id, field: status });
  }
  if (input.clipsDone > successfulClipIndexes.size) {
    blockers.push({ code: "run_progress_exceeds_canvas_evidence" });
  }
  return { eligible: blockers.length === 0, failedNodes: [], blockers };
}

function countRunScopedSuccessfulClips(nodes: readonly VideoFlowNode[], runId: string): number {
  const indexes = new Set<number>();
  for (const node of nodes) {
    const data = node.data;
    if (
      String(data.kind ?? "").trim().toLowerCase() !== "video" ||
      String(data.clipRunId ?? "").trim() !== runId ||
      String(data.status ?? "").trim().toLowerCase() !== "success" ||
      !hasRealVideoAsset(data)
    ) continue;
    const clipIndex = Number(data.clipIndex);
    if (Number.isInteger(clipIndex) && clipIndex >= 0) indexes.add(clipIndex);
  }
  return indexes.size;
}

export type VerifiedRunPreSubmitFailureReceipt = {
  version: 1;
  code: string;
  status: number;
  upstreamRequestAttempted: false;
  clipsDone: number;
  recordedAt: string;
};

export function readVerifiedRunPreSubmitFailureReceipt(input: {
  artifacts: ReadonlyArray<{
    artifact_key: string;
    status: string;
    payload: string | null;
    content_hash: string | null;
  }>;
  errorCode: string | null;
  clipsDone: number;
}): VerifiedRunPreSubmitFailureReceipt | null {
  const artifact = input.artifacts.find(
    (item) => item.artifact_key === "production:pre_submit_failure" && item.status === "ready",
  );
  if (!artifact?.payload || !artifact.content_hash) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(artifact.payload);
  } catch {
    return null;
  }
  const record = readRecord(parsed);
  if (!record || stableContentHash(record) !== artifact.content_hash) return null;
  const code = typeof record.code === "string" ? record.code.trim() : "";
  const status = Number(record.status);
  const clipsDone = Number(record.clipsDone);
  const recordedAt = typeof record.recordedAt === "string" ? record.recordedAt.trim() : "";
  if (
    record.version !== 1 ||
    record.upstreamRequestAttempted !== false ||
    !code || code !== input.errorCode ||
    !Number.isInteger(status) || status < 400 || status >= 500 ||
    !Number.isInteger(clipsDone) || clipsDone !== input.clipsDone ||
    !recordedAt
  ) return null;
  return {
    version: 1,
    code,
    status,
    upstreamRequestAttempted: false,
    clipsDone,
    recordedAt,
  };
}

export type PreSubmitReferenceRepair = {
  beatSheetJson: string;
  storyPlanJson: string;
  beatSheetChanged: boolean;
  storyPlanChanged: boolean;
  evidence: {
    beatSheet: ReplanReferenceRepairEvidence;
    storyPlan: ReplanReferenceRepairEvidence;
  };
};

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parseJsonRecord(raw: string, code: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${code}_invalid_json`);
  }
  const record = readRecord(parsed);
  if (!record) throw new Error(`${code}_invalid`);
  return record;
}

/**
 * 只修复 frozen kind/name 已能在当前画布唯一证明的节点身份漂移。
 * 这里不选择素材、不生成内容；任何缺失或歧义都会作为 unresolved 原地返回。
 */
export function buildPreSubmitReferenceRepair(input: {
  beatSheetJson: string;
  storyPlanJson: string;
  currentNodes: readonly VideoFlowNode[];
  generationContract?: VideoGenerationContract;
}): PreSubmitReferenceRepair {
  const beatSheet = parseJsonRecord(input.beatSheetJson, "pre_submit_beat_sheet");
  if (beatSheet.version !== 2 || !Array.isArray(beatSheet.beats)) {
    throw new Error("pre_submit_beat_sheet_contract_invalid");
  }
  const storyPlan = parseJsonRecord(input.storyPlanJson, "pre_submit_story_plan");
  if (!Array.isArray(storyPlan.clips)) throw new Error("pre_submit_story_plan_clips_missing");
  const { executablePlanHash, ...storyPlanHashPayload } = storyPlan;
  if (
    storyPlan.protocolVersion !== VIDEO_ORCHESTRATOR_PROTOCOL_VERSION ||
    typeof executablePlanHash !== "string" ||
    executablePlanHash !== stableContentHash(storyPlanHashPayload)
  ) {
    throw new Error("pre_submit_story_plan_hash_invalid");
  }
  if (input.generationContract) {
    const beatSheetMeta = readRecord(beatSheet.meta) ?? {};
    beatSheet.meta = {
      ...beatSheetMeta,
      videoModel: input.generationContract.videoModel,
      generationContract: input.generationContract,
    };
    const planModel = typeof storyPlan.videoModel === "string" ? storyPlan.videoModel.trim() : "";
    if (planModel && planModel !== input.generationContract.videoModel) {
      throw new Error("pre_submit_story_plan_model_mismatch");
    }
    storyPlan.videoModel = input.generationContract.videoModel;
    storyPlan.generationContract = input.generationContract;
  }

  const reboundBeatSheet = rebindReplanBeatSheetReferences({
    beatSheet,
    currentNodes: input.currentNodes,
  });
  const reboundStoryPlan = rebindExecutableStoryPlanReferences({
    storyPlan,
    currentNodes: input.currentNodes,
  });
  const repairedBeatSheetJson = JSON.stringify(reboundBeatSheet.beatSheet);
  const repairedPlanPayload = { ...reboundStoryPlan.storyPlan };
  delete repairedPlanPayload.executablePlanHash;
  const repairedStoryPlanJson = JSON.stringify({
    ...repairedPlanPayload,
    executablePlanHash: stableContentHash(repairedPlanPayload),
  });
  return {
    beatSheetJson: repairedBeatSheetJson,
    storyPlanJson: repairedStoryPlanJson,
    beatSheetChanged: repairedBeatSheetJson !== input.beatSheetJson,
    storyPlanChanged: repairedStoryPlanJson !== input.storyPlanJson,
    evidence: {
      beatSheet: reboundBeatSheet.evidence,
      storyPlan: reboundStoryPlan.evidence,
    },
  };
}

function hasNonEmptyString(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function hasRealVideoAsset(data: Record<string, unknown>): boolean {
  if (hasNonEmptyString(data.videoUrl)) return true;
  if (!Array.isArray(data.videoResults)) return false;
  return data.videoResults.some((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return false;
    return hasNonEmptyString((item as Record<string, unknown>).url);
  });
}

export function assessPreSubmitResume(
  nodes: VideoFlowNode[],
  runId: string,
  externallyVerifiedNodeIds: ReadonlySet<string> = new Set(),
  verifiedPreSubmitClipIndexes: ReadonlySet<number> = new Set(),
): PreSubmitResumeAssessment {
  const failedNodes = nodes.filter((node) => {
    const data = node.data;
    const clipIndex = Number(data.clipIndex);
    return (
      String(data.kind ?? "").trim().toLowerCase() === "video" &&
      String(data.clipRunId ?? "").trim() === runId &&
      (
        String(data.status ?? "").trim().toLowerCase() === "submit_failed" ||
        (Number.isInteger(clipIndex) && verifiedPreSubmitClipIndexes.has(clipIndex))
      )
    );
  });
  const blockers: ResumeBlocker[] = [];
  if (failedNodes.length === 0) blockers.push({ code: "submit_failed_nodes_missing" });

  for (const node of failedNodes) {
    const externallyVerified = externallyVerifiedNodeIds.has(node.id);
    const locallyVerifiedLegacyPreSubmit = isLegacyLocalPreUpstreamVideoErrorCode(
      node.data.clipSubmitErrorCode,
    );
    const verifiedPreSubmit = externallyVerified || locallyVerifiedLegacyPreSubmit;
    const phase = String(node.data.clipSubmitPhase ?? "").trim().toLowerCase();
    if (phase && phase !== "pre_upstream" && !verifiedPreSubmit) {
      blockers.push({ code: "submission_phase_not_pre_upstream", nodeId: node.id, field: phase });
    }
    for (const field of ["taskId", "videoTaskId", "upstreamTaskId", "vendorTaskId"] as const) {
      if (hasNonEmptyString(node.data[field])) {
        blockers.push({ code: "upstream_task_identity_present", nodeId: node.id, field });
      }
    }
    if (node.data.upstreamSubmitUncertain === true && !verifiedPreSubmit) {
      blockers.push({ code: "upstream_submission_uncertain", nodeId: node.id });
    }
    if (hasRealVideoAsset(node.data)) {
      blockers.push({ code: "video_asset_already_present", nodeId: node.id });
    }
  }
  return { eligible: blockers.length === 0, failedNodes, blockers };
}

export function hasPreNodeCreationResumeAuthority(input: {
  errorCode: string | null;
  hasVerifiedRunReceipt: boolean;
}): boolean {
  return input.hasVerifiedRunReceipt ||
    isKnownLocalPreUpstreamVideoErrorCode(input.errorCode);
}

export async function orchestrateVideoResumePreSubmit(input: {
  c: AppContext;
  requestUserId: string;
  flowId: string;
  chapterId?: string;
  bodyArgs: unknown;
}): Promise<Record<string, unknown>> {
  const args =
    typeof input.bodyArgs === "object" && input.bodyArgs !== null && !Array.isArray(input.bodyArgs)
      ? input.bodyArgs as Record<string, unknown>
      : {};
  const runId = String(args.runId ?? "").trim();
  if (!runId) {
    return { ok: false, terminal: false, mode: "resume_pre_submit", code: "runId_required" };
  }
  const run = await getVideoRun(runId);
  if (!run || run.owner_id !== input.requestUserId) {
    return {
      ok: false,
      terminal: false,
      mode: "resume_pre_submit",
      code: "video_run_not_found",
      runId,
    };
  }
  if (run.state !== "failed" || run.authoring_state !== "authoring_done") {
    return {
      ok: false,
      terminal: false,
      mode: "resume_pre_submit",
      code: "run_not_resumable",
      runId,
      state: run.state,
      authoringState: run.authoring_state,
    };
  }
  if (input.chapterId && run.chapter_id !== input.chapterId) {
    return { ok: false, mode: "resume_pre_submit", code: "run_scope_mismatch", runId };
  }

  const row = await freshReadFlowRow({
    c: input.c,
    flowId: input.flowId,
    requestUserId: input.requestUserId,
    devBypass: true,
    ...(input.chapterId ? { chapterId: input.chapterId } : {}),
  });
  const flowNodes = readFlowNodes(row);
  const authoringArtifacts = await listAuthoringArtifacts(runId);
  const verifiedClipReceipts = readVerifiedClipPreSubmitFailureReceipts({
    runId,
    artifacts: authoringArtifacts,
  });
  const verifiedReceiptClipIndexes = new Set(
    verifiedClipReceipts.map((receipt) => receipt.clipIndex),
  );
  const receiptVerifiedNodeIds = new Set(
    flowNodes.flatMap((node) => {
      const clipIndex = Number(node.data.clipIndex);
      return (
        String(node.data.kind ?? "").trim().toLowerCase() === "video" &&
        String(node.data.clipRunId ?? "").trim() === runId &&
        Number.isInteger(clipIndex) && verifiedReceiptClipIndexes.has(clipIndex)
      ) ? [node.id] : [];
    }),
  );
  const runFailureCode = readSerializedVideoRunErrorCode(run.error_message);
  const verifiedRunReceipt = readVerifiedRunPreSubmitFailureReceipt({
    artifacts: authoringArtifacts,
    errorCode: runFailureCode,
    clipsDone: run.clips_done,
  });
  const initialAssessment = assessPreSubmitResume(
    flowNodes,
    runId,
    receiptVerifiedNodeIds,
    verifiedReceiptClipIndexes,
  );
  let verifiedEvidence: VerifiedPreSubmitEvidence[] = [];
  let evidenceDiagnostics: PreSubmitEvidenceDiagnostic[] = [];
  let assessment = initialAssessment;
  if (!initialAssessment.eligible && initialAssessment.failedNodes.length > 0) {
    const evidenceAssessment = await loadVerifiedPreSubmitCapacityEvidence({
      run,
      failedNodes: initialAssessment.failedNodes,
      flowNodes,
    });
    verifiedEvidence = evidenceAssessment.verified;
    evidenceDiagnostics = evidenceAssessment.diagnostics;
    assessment = assessPreSubmitResume(
      flowNodes,
      runId,
      new Set([
        ...receiptVerifiedNodeIds,
        ...verifiedEvidence.map((evidence) => evidence.nodeId),
      ]),
      verifiedReceiptClipIndexes,
    );
  }
  if (!assessment.eligible && initialAssessment.failedNodes.length === 0) {
    assessment = assessPreNodeCreationResume({
      nodes: flowNodes,
      runId,
      clipsDone: run.clips_done,
      errorCode: runFailureCode,
      verifiedReceiptCode: verifiedRunReceipt?.code,
    });
  }
  if (!assessment.eligible) {
    return {
      ok: false,
      mode: "resume_pre_submit",
      code: "pre_submit_resume_evidence_insufficient",
      runId,
      blockers: assessment.blockers,
      evidenceDiagnostics,
    };
  }

  if (!run.beat_sheet || !run.story_plan) {
    return {
      ok: false,
      mode: "resume_pre_submit",
      code: "pre_submit_reference_repair_source_missing",
      runId,
    };
  }
  let referenceRepair: PreSubmitReferenceRepair;
  try {
    const storyPlanRecord = parseJsonRecord(run.story_plan, "pre_submit_story_plan");
    const frozenVideoModel = typeof storyPlanRecord.videoModel === "string"
      ? storyPlanRecord.videoModel.trim()
      : "";
    if (!frozenVideoModel) throw new Error("pre_submit_story_plan_model_missing");
    const generationContract = await resolveVideoGenerationContract({
      c: input.c,
      videoModel: frozenVideoModel,
    });
    referenceRepair = buildPreSubmitReferenceRepair({
      beatSheetJson: run.beat_sheet,
      storyPlanJson: run.story_plan,
      currentNodes: flowNodes,
      generationContract,
    });
  } catch (error) {
    return {
      ok: false,
      mode: "resume_pre_submit",
      code: "pre_submit_reference_repair_invalid",
      runId,
      message: String((error as Error).message || error),
    };
  }
  const unresolved = [
    ...referenceRepair.evidence.beatSheet.unresolved,
    ...referenceRepair.evidence.storyPlan.unresolved,
  ];
  if (unresolved.length > 0) {
    return {
      ok: false,
      mode: "resume_pre_submit",
      code: "pre_submit_reference_rebinding_unresolved",
      runId,
      referenceRepairEvidence: referenceRepair.evidence,
    };
  }
  if (
    assessment.failedNodes.length === 0 &&
    !hasPreNodeCreationResumeAuthority({
      errorCode: runFailureCode,
      hasVerifiedRunReceipt: verifiedRunReceipt !== null,
    }) &&
    !referenceRepair.beatSheetChanged &&
    !referenceRepair.storyPlanChanged
  ) {
    return {
      ok: false,
      mode: "resume_pre_submit",
      code: "pre_submit_reference_repair_no_delta",
      runId,
    };
  }
  const repairAt = new Date().toISOString();
  if (referenceRepair.beatSheetChanged) {
    const persisted = await persistBeatSheetSnapshot({
      runId,
      expectedBeatSheetJson: run.beat_sheet,
      beatSheetJson: referenceRepair.beatSheetJson,
      nowIso: repairAt,
    });
    if (!persisted) {
      return { ok: false, mode: "resume_pre_submit", code: "pre_submit_beat_sheet_repair_cas_failed", runId };
    }
    run.beat_sheet = referenceRepair.beatSheetJson;
  }
  if (referenceRepair.storyPlanChanged) {
    const persisted = await upsertVideoRunAccumClips({
      runId,
      ownerId: run.owner_id,
      projectId: run.project_id,
      flowId: run.flow_id,
      chapterId: run.chapter_id,
      storyPlanJson: referenceRepair.storyPlanJson,
      nowIso: repairAt,
      allowTerminalReplacement: true,
    });
    if (!persisted) {
      return { ok: false, mode: "resume_pre_submit", code: "pre_submit_story_plan_repair_cas_failed", runId };
    }
    run.story_plan = referenceRepair.storyPlanJson;
  }
  if (referenceRepair.beatSheetChanged || referenceRepair.storyPlanChanged) {
    await upsertAuthoringArtifact({
      runId,
      artifactKey: "pre_submit_reference_repair",
      contentHash: stableContentHash(referenceRepair.evidence),
      derivedFrom: ["beat_sheet", "story_plan", "current_canvas"],
      status: "ready",
      payload: JSON.stringify({ repairedAt: repairAt, ...referenceRepair.evidence }),
      nowIso: repairAt,
    });
  }

  const verifiedEvidenceByNodeId = new Map(
    verifiedEvidence.map((evidence) => [evidence.nodeId, evidence]),
  );
  const verifiedAt = new Date().toISOString();
  const resets = assessment.failedNodes.map((node) => ({
    id: node.id,
    data: {
      status: "",
      taskId: "",
      videoTaskId: "",
      clipSubmitAttempts: 0,
      clipSubmitError: "",
      clipSubmitErrorCode: "",
      clipSubmitPhase: "",
      upstreamSubmitUncertain: false,
      referenceAudioUrls: [],
      ...(verifiedEvidenceByNodeId.has(node.id)
        ? {
            clipSubmitRecoveryEvidence: {
              kind: "structured_pre_upstream_rejection",
              ...verifiedEvidenceByNodeId.get(node.id),
              verifiedAt,
            },
          }
        : {}),
      ...(isLegacyLocalPreUpstreamVideoErrorCode(node.data.clipSubmitErrorCode)
        ? {
            clipSubmitRecoveryEvidence: {
              kind: "legacy_local_pre_upstream_error_code",
              code: String(node.data.clipSubmitErrorCode).trim(),
              verifiedAt,
            },
          }
        : {}),
    },
  }));
  const productionArtifactRoots = buildPreSubmitProductionArtifactRoots(
    assessment.failedNodes,
  );
  const invalidatedArtifactKeys = productionArtifactRoots.length > 0
    ? await invalidateArtifactClosure({
        runId,
        rootKeys: productionArtifactRoots,
        nowIso: verifiedAt,
      })
    : [];
  await persistFlowPatch({
    c: input.c,
    row,
    flowId: input.flowId,
    requestUserId: input.requestUserId,
    devBypass: true,
    ...(input.chapterId ? { chapterId: input.chapterId } : {}),
    patch: { patchNodeData: resets, allowOverwrite: true },
    affectedNodeIds: resets.map((reset) => reset.id),
  });
  const resumed = await resumeFailedVideoRunAfterPreSubmit({
    runId,
    ownerId: input.requestUserId,
    flowId: run.flow_id,
    chapterId: run.chapter_id,
    clipsDone: Math.max(
      run.clips_done,
      countRunScopedSuccessfulClips(flowNodes, runId),
    ),
    nowIso: new Date().toISOString(),
  });
  if (!resumed) {
    return {
      ok: false,
      mode: "resume_pre_submit",
      code: "run_resume_cas_failed",
      runId,
      resetNodeIds: resets.map((reset) => reset.id),
      invalidatedArtifactKeys,
    };
  }

  const statusProjection = await upsertVideoRunStatusNode({
    c: input.c,
    runId,
    runCreatedAt: resumed.created_at,
    ownerId: resumed.owner_id,
    flowId: resumed.flow_id,
    chapterId: resumed.chapter_id,
    authoringState: resumed.authoring_state,
    productionState: resumed.state,
    statusLine: `已基于上游提交前失败证据恢复同一 run，并在当前请求内继续同步生产；当前完成 ${resumed.clips_done}/${resumed.total_clips} 段（${resumed.state}）。`,
  });
  return {
    ok: true,
    mode: "resume_pre_submit",
    runId,
    state: resumed.state,
    authoringState: resumed.authoring_state,
    clipsDone: resumed.clips_done,
    totalClips: resumed.total_clips,
    resetNodeIds: resets.map((reset) => reset.id),
    invalidatedArtifactKeys,
    verifiedEvidence,
    verifiedClipPreSubmitFailureReceipts: verifiedClipReceipts,
    verifiedRunPreSubmitFailureReceipt: verifiedRunReceipt,
    referenceRepairEvidence: referenceRepair.evidence,
    statusProjection,
  };
}
