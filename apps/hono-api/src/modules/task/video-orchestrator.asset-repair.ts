import { randomUUID } from "node:crypto";
import type { AppContext } from "../../types";
import { AppError } from "../../middleware/error";
import { freshReadFlowRow, findFlowNode, persistFlowPatch, readFlowNodes } from "./video-orchestrator.flow-io";
import { classifyCanvasCardForRegistry } from "./material-card-classify";
import { readDurableCanvasImageUrl, syncCanvasCardToMaterial } from "./material-auto-register";
import type { StoryPlan, StoryPlanClip } from "./video-orchestrator.orchestrate";
import {
  advanceAuthoringState,
  ASSET_REPAIR_FRONTIER_CLAIM_LEASE_MS,
  claimAssetRepairFrontierArtifact,
  invalidateArtifactClosure,
  readClaimableAssetRepairFrontierPayload,
  persistInitialAssetRepairFrontierArtifact,
  persistBeatSheetSnapshot,
  stableContentHash,
  releaseAssetRepairFrontierClaim,
  settleClaimedAssetRepairFrontierArtifact,
  touchAssetRepairFrontierClaim,
  type AssetRepairFrontierClaimOwner,
} from "./video-orchestrator.authoring.repo";
import { videoResultArtifactKey } from "./video-orchestrator.authoring-graph";
import { upsertVideoRunAccumClips, getVideoRun } from "./video-run.repo";
import { deriveClipNodeId, buildClipId } from "./video-orchestrator.clip-plan";
import { VIDEO_ORCHESTRATOR_PROTOCOL_VERSION } from "@tapcanvas/video-orchestrator-protocol";
import { listProjectNodeAssetsForOwner } from "../material/material.service";
import { isExplicitlyRejectedAsset } from "./video-orchestrator.asset-availability";
import type { VisualStateFact } from "./video-orchestrator.visual-state-timeline";
import type { VideoFlowNode } from "./video-orchestrator.flow-io";
import { buildVideoAssetRepairProgressCursor } from "./video-orchestrator.asset-repair-frontier";

export const VIDEO_ASSET_REPAIR_VERSION = 3 as const;
const ASSET_REPAIR_CONTINUATION_PROVIDER = "agents_async_continuation";

function resolveAssetRepairFrontierClaimOwner(c: AppContext): AssetRepairFrontierClaimOwner | null {
  const continuationId = c.get("activeAsyncContinuationId")?.trim() ?? "";
  const continuationClaimToken = c.get("activeAsyncContinuationClaimToken")?.trim() ?? "";
  if (continuationId || continuationClaimToken) {
    return continuationId && continuationClaimToken
      ? {
          kind: "continuation",
          executionId: continuationId,
          continuationProvider: ASSET_REPAIR_CONTINUATION_PROVIDER,
          continuationClaimToken,
        }
      : null;
  }
  const requestId = c.get("requestId")?.trim() ?? "";
  return requestId ? { kind: "request", executionId: requestId } : null;
}

export type RepairableAssetKind = "character" | "scene" | "prop" | "ensemble";

export type VideoAssetRepairSourceEvidence = {
  clipIndex: number;
  referenceRole: string;
  identityInvariant: string;
  startState: string;
  spatialRelation: string;
  scale: string;
  driver: string;
  stateChange: string;
  endState: string;
  sourceStartMarker?: string;
  sourceEndMarker?: string;
};

export type VideoAssetRepairRequirement = {
  kind: RepairableAssetKind;
  name: string;
  stateKey?: string;
  stateVersionId?: string;
  stateScopes?: string[];
  visualFacts?: VisualStateFact[];
  referenceRole: string;
  clipIndexes: number[];
  affectedNodeIds: string[];
  sourceEvidence: VideoAssetRepairSourceEvidence[];
};

export type VideoAssetRepairDeclaration = {
  version: typeof VIDEO_ASSET_REPAIR_VERSION;
  runId: string;
  /** Stable execution epoch; progress revisions advance inside this epoch. */
  executionGeneration: string;
  reasonCode: string;
  requiredAssets: VideoAssetRepairRequirement[];
  blockedNodeIds: string[];
  retryKey: string;
  nextActions: string[];
  /**
   * Monotonic execution receipt for the repair subgraph. Older persisted
   * declarations without this projection are normalized to revision 0 when
   * read; every verified binding then advances the revision exactly once.
   */
  progress?: VideoAssetRepairProgress;
};

export type VideoAssetRepairBinding = {
  kind: RepairableAssetKind;
  name: string;
  stateKey?: string;
  stateVersionId?: string;
  nodeId?: string;
  referenceAssetId?: string;
  clipIndexes?: number[];
};

export type VideoAssetRepairProgress = {
  revision: number;
  totalCount: number;
  resolvedBindings: VideoAssetRepairBinding[];
};

export async function persistVideoAssetRepairFrontier(input: {
  runId: string;
  declaration: VideoAssetRepairDeclaration;
  status?: "waiting_external" | "ready" | "failed";
  error?: string | null;
  nowIso: string;
}): Promise<void> {
  if (input.declaration.runId !== input.runId) {
    throw new Error("asset_repair_frontier_run_identity_mismatch");
  }
  await persistInitialAssetRepairFrontierArtifact({
    runId: input.runId,
    declaration: input.declaration,
    nowIso: input.nowIso,
  });
}

/**
 * Asset repair changes the executable reference identity for exactly the clips
 * named by the durable repair declaration. Reopen only those result nodes and
 * their derived concat/delivery closure; provider submissions and independent
 * clip results remain authoritative and must never be paid twice.
 */
export function buildAssetRepairProductionArtifactRoots(
  clipIndexes: readonly number[],
): string[] {
  return [...new Set(clipIndexes)]
    .filter((clipIndex) => Number.isInteger(clipIndex) && clipIndex >= 0)
    .sort((left, right) => left - right)
    .map(videoResultArtifactKey);
}

/**
 * Reconstruct a consumed repair cursor only when every submitted binding is
 * already frozen in the durable executable plan. This covers a process crash
 * after the plan commit but before its failed production artifact was
 * invalidated. It cannot introduce a new identity, reference, or clip scope.
 */
export function buildIdempotentAssetRepairReplayDeclaration(input: {
  runId: string;
  plan: Pick<StoryPlan, "clips">;
  bindings: readonly VideoAssetRepairBinding[];
}): VideoAssetRepairDeclaration | null {
  if (!input.bindings.length) return null;
  const sourceByIdentity = new Map<string, string>();
  const requiredAssets: Array<{
    kind: RepairableAssetKind;
    name: string;
    stateKey?: string;
    stateVersionId?: string;
    referenceRole: string;
    clipIndexes: number[];
    affectedNodeIds: string[];
  }> = [];

  for (const binding of input.bindings) {
    const clipIndexes = binding.clipIndexes ?? [];
    if (!clipIndexes.length) return null;
    const sourceId = binding.nodeId ?? binding.referenceAssetId ?? "";
    if (!sourceId) return null;
    const identityKey = assetRepairIdentityKey(binding);
    const previousSourceId = sourceByIdentity.get(identityKey);
    if (previousSourceId && previousSourceId !== sourceId) return null;
    sourceByIdentity.set(identityKey, sourceId);

    for (const clipIndex of clipIndexes) {
      const clip = input.plan.clips[clipIndex];
      if (!clip) return null;
      const matchingStateAnchors = (clip.visualStateAnchorRequirements ?? []).filter(
        (requirement) =>
          binding.kind === "character" &&
          requirement.characterName === binding.name &&
          requirement.stateKey === binding.stateKey &&
          requirement.stateVersionId === binding.stateVersionId,
      );
      const matchingContracts = (clip.assetObjectContracts ?? []).filter(
        (contract) => contract.kind === binding.kind && contract.name === binding.name,
      );
      if (!matchingContracts.length && !matchingStateAnchors.length) return null;
      const referenceAlreadyFrozen = matchingStateAnchors.some((requirement) =>
        binding.nodeId ? requirement.anchorNodeId === binding.nodeId : false,
      ) || matchingContracts.some((contract) =>
        binding.nodeId
          ? contract.referenceImageNodeIds.includes(binding.nodeId)
          : (contract.referenceAssetIds ?? []).includes(binding.referenceAssetId ?? ""),
      );
      if (!referenceAlreadyFrozen) return null;
    }

    requiredAssets.push({
      kind: binding.kind,
      name: binding.name,
      ...(binding.stateKey ? { stateKey: binding.stateKey } : {}),
      ...(binding.stateVersionId ? { stateVersionId: binding.stateVersionId } : {}),
      referenceRole: "identity",
      clipIndexes,
      affectedNodeIds: binding.nodeId ? [binding.nodeId] : [],
    });
  }

  return buildAssetRepairDeclaration({
    runId: input.runId,
    reasonCode: "asset_repair_idempotent_replay",
    requiredAssets,
  });
}

function assetRepairIdentityKey(
  asset: Pick<VideoAssetRepairBinding, "kind" | "name" | "stateKey" | "stateVersionId">,
): string {
  return [asset.kind, asset.name, asset.stateVersionId ?? "", asset.stateKey ?? ""].join(":");
}

function mergeResolvedAssetBindings(
  previous: readonly VideoAssetRepairBinding[],
  verified: readonly VideoAssetRepairBinding[],
): VideoAssetRepairBinding[] {
  const bindings = new Map<string, VideoAssetRepairBinding>();
  for (const binding of [...previous, ...verified]) {
    bindings.set(assetRepairIdentityKey(binding), binding);
  }
  return [...bindings.values()];
}

/**
 * Advance the repair subgraph after a batch has been structurally verified.
 * This is intentionally identity-based and contains no semantic matching.
 */
export function advanceAssetRepairProgress(input: {
  declaration: VideoAssetRepairDeclaration;
  verifiedBindings: readonly VideoAssetRepairBinding[];
}): {
  declaration: VideoAssetRepairDeclaration;
  remainingAssets: VideoAssetRepairRequirement[];
  resolvedBindings: VideoAssetRepairBinding[];
  complete: boolean;
} {
  const verifiedKeys = new Set(input.verifiedBindings.map(assetRepairIdentityKey));
  const remainingAssets = input.declaration.requiredAssets.filter(
    (asset) => !verifiedKeys.has(assetRepairIdentityKey(asset)),
  );
  const previousProgress = input.declaration.progress;
  const resolvedBindings = mergeResolvedAssetBindings(
    previousProgress?.resolvedBindings ?? [],
    input.verifiedBindings,
  );
  const totalCount = Math.max(
    previousProgress?.totalCount ?? 0,
    resolvedBindings.length + remainingAssets.length,
  );
  const progress: VideoAssetRepairProgress = {
    revision: (previousProgress?.revision ?? 0) + 1,
    totalCount,
    resolvedBindings,
  };
  return {
    declaration: {
      ...input.declaration,
      requiredAssets: remainingAssets,
      progress,
    },
    remainingAssets,
    resolvedBindings,
    complete: remainingAssets.length === 0,
  };
}

/** Preserve the monotonic receipt when mutable asset coverage is fresh-read. */
export function carryAssetRepairProgress(input: {
  declaration: VideoAssetRepairDeclaration;
  previous: VideoAssetRepairDeclaration | null;
}): VideoAssetRepairDeclaration {
  const previousProgress = input.previous?.progress;
  if (!previousProgress) return input.declaration;
  const requiredKeys = new Set(
    input.declaration.requiredAssets.map(assetRepairIdentityKey),
  );
  // Fresh coverage is the current executable truth. If a previously resolved
  // identity reappears, its node/reference was deleted, rejected or otherwise
  // invalidated; reopen that identity and remove only its *current* resolved
  // projection. The historical asset/receipt remains persisted elsewhere.
  const resolvedBindings = previousProgress.resolvedBindings.filter(
    (binding) => !requiredKeys.has(assetRepairIdentityKey(binding)),
  );
  const candidateAtCurrentRevision: VideoAssetRepairDeclaration = {
    ...input.declaration,
    executionGeneration: input.previous?.executionGeneration ?? input.declaration.executionGeneration,
    progress: {
      revision: previousProgress.revision,
      totalCount: Math.max(
        previousProgress.totalCount,
        resolvedBindings.length + input.declaration.requiredAssets.length,
      ),
      resolvedBindings,
    },
  };
  const frontierChanged = stableContentHash(candidateAtCurrentRevision) !== stableContentHash(input.previous);
  return frontierChanged
    ? {
        ...candidateAtCurrentRevision,
        progress: {
          ...candidateAtCurrentRevision.progress,
          revision: previousProgress.revision + 1,
        },
      }
    : candidateAtCurrentRevision;
}

/**
 * 统一构造前置身份资产修复合同。
 *
 * 这个合同只描述确定性的资产身份、受影响 clip 与真实节点绑定位置；
 * 不在 Hono 侧生成 prompt，也不判断创作方向。无论缺口来自 authoring
 * 前置准备还是 provider 提交前复核，都交由同一 agents-cli 修复路径消费。
 */
export function buildAssetRepairDeclaration(input: {
  runId: string;
  reasonCode: string;
  requiredAssets: readonly (Omit<VideoAssetRepairRequirement, "sourceEvidence"> & {
    sourceEvidence?: readonly VideoAssetRepairSourceEvidence[];
  })[];
  blockedNodeIds?: readonly string[];
  retryKey?: string;
}): VideoAssetRepairDeclaration {
  const byKey = new Map<string, VideoAssetRepairRequirement>();
  for (const asset of input.requiredAssets) {
    const name = trimmed(asset.name);
    if (!name) continue;
    const stateKey = trimmed(asset.stateKey);
    const stateVersionId = trimmed(asset.stateVersionId);
    if (Boolean(stateKey) !== Boolean(stateVersionId)) {
      throw new AppError("状态资产声明必须同时提供 stateKey 与 stateVersionId", {
        status: 409,
        code: "asset_repair_state_identity_incomplete",
      });
    }
    const key = assetRepairIdentityKey({ kind: asset.kind, name, stateKey, stateVersionId });
    const previous = byKey.get(key);
    if (!previous) {
      byKey.set(key, {
        kind: asset.kind,
        name,
        ...(stateKey ? { stateKey } : {}),
        ...(stateVersionId ? { stateVersionId } : {}),
        ...(asset.stateScopes?.length
          ? { stateScopes: [...new Set(asset.stateScopes.map(trimmed).filter(Boolean))] }
          : {}),
        ...(asset.visualFacts?.length
          ? { visualFacts: normalizeVisualFacts(asset.visualFacts) }
          : {}),
        referenceRole: trimmed(asset.referenceRole) || "identity",
        clipIndexes: readIntegerArray(asset.clipIndexes).sort((a, b) => a - b),
        affectedNodeIds: [...new Set(asset.affectedNodeIds.map(trimmed).filter(Boolean))],
        sourceEvidence: compactIdentitySourceEvidence(asset.sourceEvidence ?? []),
      });
      continue;
    }
    if (
      stateKey &&
      JSON.stringify(previous.visualFacts ?? []) !== JSON.stringify(normalizeVisualFacts(asset.visualFacts ?? []))
    ) {
      throw new AppError("同一状态资产声明的 visualFacts 必须逐字一致", {
        status: 409,
        code: "asset_repair_state_facts_conflict",
      });
    }
    previous.clipIndexes = [...new Set([...previous.clipIndexes, ...readIntegerArray(asset.clipIndexes)])]
      .sort((a, b) => a - b);
    previous.affectedNodeIds = [...new Set([
      ...previous.affectedNodeIds,
      ...asset.affectedNodeIds.map(trimmed).filter(Boolean),
    ])];
    previous.sourceEvidence = compactIdentitySourceEvidence([
      ...previous.sourceEvidence,
      ...(asset.sourceEvidence ?? []),
    ]);
    if (asset.stateScopes?.length) {
      previous.stateScopes = [...new Set([
        ...(previous.stateScopes ?? []),
        ...asset.stateScopes.map(trimmed).filter(Boolean),
      ])];
    }
  }
  const runId = trimmed(input.runId);
  return {
    version: VIDEO_ASSET_REPAIR_VERSION,
    runId,
    executionGeneration: randomUUID(),
    reasonCode: trimmed(input.reasonCode),
    requiredAssets: [...byKey.values()],
    blockedNodeIds: [...new Set((input.blockedNodeIds ?? []).map(trimmed).filter(Boolean))],
    retryKey: trimmed(input.retryKey) || `video-asset-repair:${runId}`,
    nextActions: [
      "agents-cli 只为 requiredAssets 中缺少独立真实图片 URL 的身份卡生成图片；已有 ready 资产不得重复生成。",
      "图片 prompt 只能使用 requiredAssets.sourceEvidence 的冻结事实；sourceEvidence 为空时先读取声明 clip 的当前 BeatSheet/source，禁止自行补年龄、关系、时代、地点或外貌。",
      "requiredAssets 含 stateVersionId/stateKey 时，必须先验真同名基准身份卡，再以该基准卡作为 referenceImageNodeIds 做 image edit；状态图只改变 visualFacts 声明的变量，并把 stateVersionId/stateKey/visualStateFacts 原样写入新节点。",
      "等待 tapcanvas_image_reconcile 返回真实 imageUrl，并确认图片节点声明的 referenceType/roleName/sceneName/propName 与身份一致。",
      "由当前 Workflow IR execution 的资产修复节点回填同一执行族；状态锚 binding 必须原样携带 stateVersionId/stateKey 且只能提交当前画布 nodeId，不得用基态或另一状态替代。根 Agent 不得另起平行视频编排或直接重放媒体动作。",
    ],
    progress: {
      revision: 0,
      totalCount: byKey.size,
      resolvedBindings: [],
    },
  };
}

function trimmed(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readIntegerArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .map((item) => (typeof item === "number" ? item : Number(item)))
    .filter((item) => Number.isInteger(item) && item >= 0))];
}

function normalizeVisualFacts(value: readonly VisualStateFact[]): VisualStateFact[] {
  const facts = new Map<string, string>();
  for (const raw of value) {
    const key = trimmed(raw?.key);
    const factValue = trimmed(raw?.value);
    if (!key || !factValue || facts.has(key)) continue;
    facts.set(key, factValue);
  }
  return [...facts.entries()]
    .map(([key, factValue]) => ({ key, value: factValue }))
    .sort((left, right) => left.key.localeCompare(right.key));
}

function readVisualFacts(value: unknown): VisualStateFact[] {
  if (!Array.isArray(value)) return [];
  return normalizeVisualFacts(value.flatMap((raw) => {
    const record = readRecord(raw);
    const key = trimmed(record?.key);
    const factValue = trimmed(record?.value);
    return key && factValue ? [{ key, value: factValue }] : [];
  }));
}

function visualFactsEqual(left: unknown, right: readonly VisualStateFact[]): boolean {
  return JSON.stringify(readVisualFacts(left)) === JSON.stringify(normalizeVisualFacts(right));
}

export type StateAnchorBaseReferenceVerification =
  | { ok: true; baseNodeId: string; baseImageUrl: string }
  | {
      ok: false;
      code:
        | "asset_repair_state_base_reference_missing"
        | "asset_repair_state_base_reference_invalid";
      referenceImageNodeIds: string[];
    };

/**
 * A state anchor is an immutable visual version of an existing character, not
 * a second canonical identity. Its provenance must therefore point to a real
 * same-name base card in the current canvas. This verifier is deliberately
 * structural: it never inspects prompt prose or infers identity from labels.
 */
export function verifyStateAnchorBaseReference(input: {
  stateNode: VideoFlowNode;
  flowNodes: readonly VideoFlowNode[];
  characterName: string;
}): StateAnchorBaseReferenceVerification {
  const referenceImageNodeIds = Array.isArray(input.stateNode.data.referenceImageNodeIds)
    ? [...new Set(input.stateNode.data.referenceImageNodeIds.map(trimmed).filter(Boolean))]
    : [];
  if (!referenceImageNodeIds.length) {
    return {
      ok: false,
      code: "asset_repair_state_base_reference_missing",
      referenceImageNodeIds,
    };
  }
  for (const referenceNodeId of referenceImageNodeIds) {
    const candidate = input.flowNodes.find((node) => node.id === referenceNodeId);
    if (!candidate) continue;
    const classification = classifyCanvasCardForRegistry(candidate.data);
    if (
      classification?.kind !== "character" ||
      classification.name !== input.characterName ||
      trimmed(candidate.data.stateKey) ||
      trimmed(candidate.data.stateVersionId)
    ) continue;
    const baseImageUrl = readDurableCanvasImageUrl(candidate.data);
    if (baseImageUrl) {
      return { ok: true, baseNodeId: candidate.id, baseImageUrl };
    }
  }
  return {
    ok: false,
    code: "asset_repair_state_base_reference_invalid",
    referenceImageNodeIds,
  };
}

function readSourceEvidence(value: unknown): VideoAssetRepairSourceEvidence[] {
  if (!Array.isArray(value)) return [];
  const evidence: VideoAssetRepairSourceEvidence[] = [];
  for (const raw of value) {
    const item = readRecord(raw);
    const clipIndex = typeof item?.clipIndex === "number" ? item.clipIndex : Number(item?.clipIndex);
    if (!item || !Number.isInteger(clipIndex) || clipIndex < 0) continue;
    const required = {
      referenceRole: trimmed(item.referenceRole),
      identityInvariant: trimmed(item.identityInvariant),
      startState: trimmed(item.startState),
      spatialRelation: trimmed(item.spatialRelation),
      scale: trimmed(item.scale),
      driver: trimmed(item.driver),
      stateChange: trimmed(item.stateChange),
      endState: trimmed(item.endState),
    };
    if (Object.values(required).some((field) => !field)) continue;
    evidence.push({
      clipIndex,
      ...required,
      ...(trimmed(item.sourceStartMarker) ? { sourceStartMarker: trimmed(item.sourceStartMarker) } : {}),
      ...(trimmed(item.sourceEndMarker) ? { sourceEndMarker: trimmed(item.sourceEndMarker) } : {}),
    });
  }
  return evidence;
}

function dedupeSourceEvidence(
  value: readonly VideoAssetRepairSourceEvidence[],
): VideoAssetRepairSourceEvidence[] {
  const byKey = new Map<string, VideoAssetRepairSourceEvidence>();
  for (const item of readSourceEvidence(value)) {
    const key = JSON.stringify(item);
    if (!byKey.has(key)) byKey.set(key, item);
  }
  return [...byKey.values()].sort((left, right) => left.clipIndex - right.clipIndex);
}

/**
 * Identity cards are static graph nodes. Keep one canonical frozen evidence
 * projection in the repair cursor and leave the complete per-clip history in
 * the BeatSheet. Repeating the same identity across every clip only inflates
 * recovery context and does not create additional executable evidence.
 */
function compactIdentitySourceEvidence(
  value: readonly VideoAssetRepairSourceEvidence[],
): VideoAssetRepairSourceEvidence[] {
  return dedupeSourceEvidence(value).slice(0, 1);
}

function isRepairableKind(value: unknown): value is RepairableAssetKind {
  return value === "character" || value === "scene" || value === "prop" || value === "ensemble";
}

function readIssueNodeIds(details: unknown): string[] {
  const record = readRecord(details);
  const issues = Array.isArray(record?.issues) ? record.issues : [];
  return [...new Set(issues
    .map((issue) => readRecord(issue)?.nodeId)
    .map(trimmed)
    .filter(Boolean))];
}

function readIssueIdentityKeys(details: unknown): Set<string> {
  const record = readRecord(details);
  const issues = Array.isArray(record?.issues) ? record.issues : [];
  const keys = new Set<string>();
  for (const rawIssue of issues) {
    const issue = readRecord(rawIssue);
    if (!issue) continue;
    const expected = readRecord(issue.expected);
    if (expected && isRepairableKind(expected.kind) && trimmed(expected.name)) {
      keys.add(`${expected.kind}:${trimmed(expected.name)}`);
    }
    const identities = Array.isArray(issue.identities) ? issue.identities : [];
    for (const rawIdentity of identities) {
      const identity = readRecord(rawIdentity);
      if (identity && isRepairableKind(identity.kind) && trimmed(identity.name)) {
        keys.add(`${identity.kind}:${trimmed(identity.name)}`);
      }
    }
    if (issue.type === "character_role_unbound" && trimmed(issue.name)) {
      keys.add(`character:${trimmed(issue.name)}`);
    }
  }
  return keys;
}

/**
 * Build the repair contract from frozen structured identities only. Hono never
 * writes a creative prompt here; agents-cli owns the missing image authoring.
 */
export function buildVideoAssetRepairDeclaration(input: {
  runId: string;
  clipIndex: number;
  clip?: StoryPlanClip;
  reasonCode: string;
  details?: unknown;
}): VideoAssetRepairDeclaration {
  const byKey = new Map<string, VideoAssetRepairRequirement>();
  const issueIdentityKeys = readIssueIdentityKeys(input.details);
  const includeAll = issueIdentityKeys.size === 0;
  const add = (
    kind: RepairableAssetKind,
    name: string,
    referenceRole: string,
    nodeIds: string[],
    sourceEvidence: readonly VideoAssetRepairSourceEvidence[] = [],
    state?: {
      stateKey: string;
      stateVersionId: string;
      stateScopes: string[];
      visualFacts: VisualStateFact[];
    },
  ): void => {
    const cleanName = trimmed(name);
    if (!cleanName) return;
    const issueKey = `${kind}:${cleanName}`;
    const key = assetRepairIdentityKey({
      kind,
      name: cleanName,
      stateKey: state?.stateKey,
      stateVersionId: state?.stateVersionId,
    });
    if (!includeAll && !issueIdentityKeys.has(issueKey)) return;
    const previous = byKey.get(key);
    if (previous) {
      previous.clipIndexes = [...new Set([...previous.clipIndexes, input.clipIndex])].sort((a, b) => a - b);
      previous.affectedNodeIds = [...new Set([...previous.affectedNodeIds, ...nodeIds])];
      previous.sourceEvidence = compactIdentitySourceEvidence([
        ...previous.sourceEvidence,
        ...sourceEvidence,
      ]);
      return;
    }
    byKey.set(key, {
      kind,
      name: cleanName,
      ...(state
        ? {
            stateKey: state.stateKey,
            stateVersionId: state.stateVersionId,
            stateScopes: [...state.stateScopes],
            visualFacts: state.visualFacts.map((fact) => ({ ...fact })),
          }
        : {}),
      referenceRole,
      clipIndexes: [input.clipIndex],
      affectedNodeIds: [...new Set(nodeIds)],
      sourceEvidence: compactIdentitySourceEvidence(sourceEvidence),
    });
  };

  const stateAnchors = input.clip?.visualStateAnchorRequirements ?? [];
  const stateCharacters = new Set(stateAnchors.map((requirement) => requirement.characterName));
  for (const contract of input.clip?.assetObjectContracts ?? []) {
    const kind = trimmed(contract.kind);
    if (!isRepairableKind(kind)) continue;
    if (kind === "character" && stateCharacters.has(contract.name)) continue;
    add(kind, contract.name, contract.referenceRole, contract.referenceImageNodeIds, [{
      clipIndex: input.clipIndex,
      referenceRole: contract.referenceRole,
      identityInvariant: contract.identityInvariant ?? "",
      startState: contract.startState ?? "",
      spatialRelation: contract.spatialRelation ?? "",
      scale: contract.scale ?? "",
      driver: contract.driver ?? "",
      stateChange: contract.stateChange ?? "",
      endState: contract.endState ?? "",
      ...(input.clip?.sourceStartMarker ? { sourceStartMarker: input.clip.sourceStartMarker } : {}),
      ...(input.clip?.sourceEndMarker ? { sourceEndMarker: input.clip.sourceEndMarker } : {}),
    }]);
  }
  for (const requirement of stateAnchors) {
    add(
      "character",
      requirement.characterName,
      "character_state",
      requirement.anchorNodeId ? [requirement.anchorNodeId] : [],
      [],
      {
        stateKey: requirement.stateKey,
        stateVersionId: requirement.stateVersionId,
        stateScopes: [...requirement.stateScopes],
        visualFacts: requirement.visualFacts.map((fact) => ({ ...fact })),
      },
    );
  }
  for (const name of input.clip?.characterRoleNames ?? []) {
    if (!stateCharacters.has(name)) add("character", name, "identity", []);
  }
  if (input.clip?.sceneName) add("scene", input.clip.sceneName, "environment", []);
  for (const name of input.clip?.propNames ?? []) add("prop", name, "prop", []);

  const blockedNodeIds = readIssueNodeIds(input.details);
  return buildAssetRepairDeclaration({
    runId: input.runId,
    reasonCode: input.reasonCode,
    requiredAssets: [...byKey.values()],
    blockedNodeIds,
    retryKey: `video-asset-repair:${input.runId}:${input.clipIndex}`,
  });
}

export function isVideoAssetRepairErrorCode(code: unknown): boolean {
  const value = trimmed(code);
  return value === "clip_reference_asset_identity_unresolved" ||
    value === "clip_reference_asset_identity_mismatch" ||
    value === "clip_reference_asset_ambiguous";
}

export function readVideoAssetRepairDeclaration(data: unknown): VideoAssetRepairDeclaration | null {
  const record = readRecord(data);
  if (record?.assetRepairRequired !== true) return null;
  const repair = readRecord(record.assetRepair);
  if (!repair || repair.version !== VIDEO_ASSET_REPAIR_VERSION) return null;
  const runId = trimmed(repair.runId);
  const executionGeneration = trimmed(repair.executionGeneration);
  const reasonCode = trimmed(repair.reasonCode);
  if (!runId || !executionGeneration || !reasonCode || !Array.isArray(repair.requiredAssets)) return null;
  const requiredAssets: VideoAssetRepairRequirement[] = [];
  for (const raw of repair.requiredAssets) {
    const item = readRecord(raw);
    if (!item || !isRepairableKind(item.kind) || !trimmed(item.name)) return null;
    const stateKey = trimmed(item.stateKey);
    const stateVersionId = trimmed(item.stateVersionId);
    if (Boolean(stateKey) !== Boolean(stateVersionId)) return null;
    const referenceRole = trimmed(item.referenceRole);
    if (!referenceRole || !Array.isArray(item.clipIndexes) || !Array.isArray(item.affectedNodeIds) || !Array.isArray(item.sourceEvidence)) {
      return null;
    }
    const clipIndexes = readIntegerArray(item.clipIndexes);
    if (clipIndexes.length !== item.clipIndexes.length) return null;
    const affectedNodeIds = item.affectedNodeIds.map(trimmed);
    if (affectedNodeIds.some((nodeId) => !nodeId)) return null;
    const sourceEvidence = readSourceEvidence(item.sourceEvidence);
    if (sourceEvidence.length !== item.sourceEvidence.length) return null;
    const stateScopes = item.stateScopes === undefined
      ? undefined
      : Array.isArray(item.stateScopes)
        ? item.stateScopes.map(trimmed)
        : null;
    if (stateScopes === null || stateScopes?.some((scope) => !scope)) return null;
    const visualFacts = item.visualFacts === undefined
      ? undefined
      : Array.isArray(item.visualFacts)
        ? readVisualFacts(item.visualFacts)
        : null;
    if (visualFacts === null || (Array.isArray(item.visualFacts) && visualFacts?.length !== item.visualFacts.length)) return null;
    requiredAssets.push({
      kind: item.kind,
      name: trimmed(item.name),
      ...(stateKey ? { stateKey } : {}),
      ...(stateVersionId ? { stateVersionId } : {}),
      ...(stateScopes ? { stateScopes: [...new Set(stateScopes)] } : {}),
      ...(visualFacts ? { visualFacts } : {}),
      referenceRole,
      clipIndexes,
      affectedNodeIds,
      sourceEvidence,
    });
  }
  if (!requiredAssets.length) return null;
  const progressRecord = readRecord(repair.progress);
  if (!progressRecord || !Array.isArray(progressRecord.resolvedBindings)) return null;
  const resolvedBindings = parseBindings(progressRecord?.resolvedBindings);
  if (resolvedBindings === null) return null;
  const revision = typeof progressRecord.revision === "number" &&
    Number.isInteger(progressRecord.revision) && progressRecord.revision >= 0
    ? progressRecord.revision
    : null;
  const declaredTotal = typeof progressRecord.totalCount === "number" &&
    Number.isInteger(progressRecord.totalCount) && progressRecord.totalCount >= 0
    ? progressRecord.totalCount
    : null;
  if (
    revision === null ||
    declaredTotal === null ||
    declaredTotal < resolvedBindings.length + requiredAssets.length ||
    !Array.isArray(repair.blockedNodeIds) ||
    !Array.isArray(repair.nextActions)
  ) return null;
  const blockedNodeIds = repair.blockedNodeIds.map(trimmed);
  const retryKey = trimmed(repair.retryKey);
  const nextActions = repair.nextActions.map(trimmed);
  if (!retryKey || blockedNodeIds.some((nodeId) => !nodeId) || nextActions.some((action) => !action)) return null;
  return {
    version: VIDEO_ASSET_REPAIR_VERSION,
    runId,
    executionGeneration,
    reasonCode,
    requiredAssets,
    blockedNodeIds,
    retryKey,
    nextActions,
    progress: {
      revision,
      totalCount: declaredTotal,
      resolvedBindings,
    },
  };
}

export async function readVideoAssetRepairFromFlow(input: {
  c: AppContext;
  flowId: string;
  ownerId: string;
  runId?: string;
  chapterId?: string;
}): Promise<VideoAssetRepairDeclaration | null> {
	if (input.runId) {
		const payloadJson = await readClaimableAssetRepairFrontierPayload({
			runId: input.runId,
			nowIso: new Date().toISOString(),
		});
		if (payloadJson) {
			let payload: unknown = null;
			try {
				payload = JSON.parse(payloadJson);
			} catch {
				throw new AppError("服务端补资产前沿无法解析", {
					status: 409,
					code: "asset_repair_frontier_invalid",
				});
			}
			const declaration = readVideoAssetRepairDeclaration({
				assetRepairRequired: true,
				assetRepair: payload,
			});
			if (!declaration || declaration.runId !== input.runId) {
				throw new AppError("服务端补资产前沿身份与 run 不一致", {
					status: 409,
					code: "asset_repair_frontier_invalid",
				});
			}
			return declaration;
		}
		return null;
	}
  const row = await freshReadFlowRow({
    c: input.c,
    flowId: input.flowId,
    requestUserId: input.ownerId,
    devBypass: true,
    ...(input.chapterId ? { chapterId: input.chapterId } : {}),
  });
  for (const node of readFlowNodes(row)) {
    const repair = readVideoAssetRepairDeclaration(node.data);
    if (repair && (!input.runId || repair.runId === input.runId)) return repair;
  }
  return null;
}

export async function persistVideoAssetRepairProgress(input: {
  c: AppContext;
  flowId: string;
  ownerId: string;
  runId: string;
  declaration: VideoAssetRepairDeclaration;
  claimToken: string;
  expectedExecutionGeneration: string;
  expectedRevision: number;
  chapterId?: string;
}): Promise<void> {
  const persisted = await settleClaimedAssetRepairFrontierArtifact({
    runId: input.runId,
    claimToken: input.claimToken,
    expectedExecutionGeneration: input.expectedExecutionGeneration,
    expectedRevision: input.expectedRevision,
    declaration: input.declaration,
    status: "waiting_external",
    nowIso: new Date().toISOString(),
  });
  if (!persisted) {
    throw new AppError("补资产前沿已被另一执行代际推进", {
      status: 409,
      code: "asset_repair_frontier_changed",
    });
  }
  const row = await freshReadFlowRow({
    c: input.c,
    flowId: input.flowId,
    requestUserId: input.ownerId,
    devBypass: true,
    ...(input.chapterId ? { chapterId: input.chapterId } : {}),
  });
  const repairNodes = readFlowNodes(row)
    .filter((node) => readVideoAssetRepairDeclaration(node.data)?.runId === input.runId)
    .map((node) => ({
      id: node.id,
      data: {
        assetRepairRequired: true,
        assetRepair: input.declaration,
      },
    }));
  if (repairNodes.length === 0) {
    throw new AppError("补资产进度无法落到当前 run 的画布状态节点", {
      status: 409,
      code: "asset_repair_progress_node_missing",
    });
  }
  await persistFlowPatch({
    c: input.c,
    row,
    flowId: input.flowId,
    requestUserId: input.ownerId,
    devBypass: true,
    ...(input.chapterId ? { chapterId: input.chapterId } : {}),
    affectedNodeIds: repairNodes.map((node) => node.id),
    patch: { patchNodeData: repairNodes, allowOverwrite: true } as never,
  });
}

export function renewVideoAssetRepairExecutionGeneration(
  declaration: VideoAssetRepairDeclaration,
): VideoAssetRepairDeclaration {
  return { ...declaration, executionGeneration: randomUUID() };
}

function parseBindings(value: unknown): VideoAssetRepairBinding[] | null {
  if (!Array.isArray(value)) return null;
  const out: VideoAssetRepairBinding[] = [];
  for (const raw of value) {
    const item = readRecord(raw);
    if (!item || !isRepairableKind(item.kind)) return null;
    const name = trimmed(item.name);
    const nodeId = trimmed(item.nodeId);
    const referenceAssetId = trimmed(item.referenceAssetId);
    const stateKey = trimmed(item.stateKey);
    const stateVersionId = trimmed(item.stateVersionId);
    if (
      !name ||
      Boolean(nodeId) === Boolean(referenceAssetId) ||
      Boolean(stateKey) !== Boolean(stateVersionId) ||
      (stateKey && !nodeId)
    ) return null;
    const clipIndexes = readIntegerArray(item.clipIndexes);
    if (item.clipIndexes !== undefined && (!Array.isArray(item.clipIndexes) || clipIndexes.length !== item.clipIndexes.length)) {
      return null;
    }
    out.push({
      kind: item.kind,
      name,
      ...(stateKey ? { stateKey } : {}),
      ...(stateVersionId ? { stateVersionId } : {}),
      ...(nodeId ? { nodeId } : { referenceAssetId }),
      ...(clipIndexes.length ? { clipIndexes } : {}),
    });
  }
  return out;
}

function parsePlan(run: { story_plan: string | null }): StoryPlan {
  if (!run.story_plan) throw new AppError("当前 run 缺少 durable executable plan", { status: 409, code: "asset_repair_plan_missing" });
  let raw: unknown;
  try {
    raw = JSON.parse(run.story_plan);
  } catch {
    throw new AppError("当前 run 的 durable executable plan 不是合法 JSON", { status: 409, code: "asset_repair_plan_invalid_json" });
  }
  const record = readRecord(raw);
  if (!record || !Array.isArray(record.clips)) {
    throw new AppError("当前 run 的 durable executable plan 缺少 clips", { status: 409, code: "asset_repair_plan_invalid" });
  }
  const { executablePlanHash, ...hashPayload } = record;
  if (
    record.protocolVersion !== VIDEO_ORCHESTRATOR_PROTOCOL_VERSION ||
    typeof executablePlanHash !== "string" ||
    executablePlanHash !== stableContentHash(hashPayload)
  ) {
    throw new AppError("当前 run 的 durable executable plan 哈希无效", { status: 409, code: "asset_repair_plan_hash_invalid" });
  }
  return record as unknown as StoryPlan;
}

function matchingClipIndexes(clip: StoryPlanClip, binding: VideoAssetRepairBinding, index: number): boolean {
  if (binding.stateKey && binding.stateVersionId) {
    return (clip.visualStateAnchorRequirements ?? []).some(
      (requirement) =>
        requirement.characterName === binding.name &&
        requirement.stateKey === binding.stateKey &&
        requirement.stateVersionId === binding.stateVersionId &&
        (!binding.clipIndexes || binding.clipIndexes.includes(index)),
    );
  }
  if (binding.kind === "character" && (clip.characterRoleNames ?? []).includes(binding.name)) return true;
  if (binding.kind === "scene" && clip.sceneName === binding.name) return true;
  if (binding.kind === "prop" && (clip.propNames ?? []).includes(binding.name)) return true;
  return (clip.assetObjectContracts ?? []).some(
    (contract) => contract.kind === binding.kind && contract.name === binding.name &&
      (!binding.clipIndexes || binding.clipIndexes.includes(index)),
  );
}

/** Replace a frozen plan reference atomically; stale chapter node ids cannot
 * remain beside the selected project asset and leak into provider validation. */
export function applyStoryPlanAssetBindings(input: {
  plan: Pick<StoryPlan, "clips">;
  bindings: readonly VideoAssetRepairBinding[];
}): StoryPlanClip[] {
  return input.plan.clips.map((clip, clipIndex) => {
    const targetBindings = input.bindings.filter((binding) =>
      (!binding.clipIndexes || binding.clipIndexes.includes(clipIndex)) &&
      matchingClipIndexes(clip, binding, clipIndex),
    );
    if (!targetBindings.length) return clip;
    let referenceIds = [...new Set(clip.videoReferenceNodeIds ?? [])];
    const contracts = (clip.assetObjectContracts ?? []).map((contract) => ({
      ...contract,
      referenceImageNodeIds: [...contract.referenceImageNodeIds],
      ...(contract.referenceAssetIds ? { referenceAssetIds: [...contract.referenceAssetIds] } : {}),
    }));
    let stateAnchorRequirements = (clip.visualStateAnchorRequirements ?? []).map((requirement) => ({
      ...requirement,
      stateScopes: [...requirement.stateScopes],
      clipIndexes: [...requirement.clipIndexes],
      visualFacts: requirement.visualFacts.map((fact) => ({ ...fact })),
    }));
    for (const binding of targetBindings) {
      const matching = contracts.filter(
        (contract) => contract.kind === binding.kind && contract.name === binding.name,
      );
      for (const contract of matching) {
        const oldIds = new Set(contract.referenceImageNodeIds);
        referenceIds = referenceIds.filter((id) => !oldIds.has(id));
        if (binding.nodeId) contract.referenceImageNodeIds = [binding.nodeId];
        if (binding.referenceAssetId) {
          contract.referenceImageNodeIds = [];
          contract.referenceAssetIds = [binding.referenceAssetId];
        }
      }
      if (binding.nodeId) referenceIds.push(binding.nodeId);
      if (binding.nodeId && binding.stateKey && binding.stateVersionId) {
        stateAnchorRequirements = stateAnchorRequirements.map((requirement) =>
          requirement.characterName === binding.name &&
          requirement.stateKey === binding.stateKey &&
          requirement.stateVersionId === binding.stateVersionId
            ? { ...requirement, anchorNodeId: binding.nodeId }
            : requirement,
        );
      }
    }
    return {
      ...clip,
      videoReferenceNodeIds: [...new Set(referenceIds)],
      assetObjectContracts: contracts,
      ...(stateAnchorRequirements.length ? { visualStateAnchorRequirements: stateAnchorRequirements } : {}),
    };
  });
}

/**
 * Expand a declared clip repair across sibling clips only when they carry the
 * exact same frozen old reference id for the same structured identity. This
 * avoids one-failure-per-clip recovery without conflating distinct state or
 * location versions that merely share a display name.
 */
export function expandAssetRepairBindingsForFrozenReferences(input: {
  plan: Pick<StoryPlan, "clips">;
  bindings: readonly VideoAssetRepairBinding[];
}): VideoAssetRepairBinding[] {
  return input.bindings.map((binding) => {
    const declaredClipIndexes = binding.clipIndexes ?? [];
    if (!declaredClipIndexes.length) return binding;
    const frozenOldIds = new Set<string>();
    for (const clipIndex of declaredClipIndexes) {
      const clip = input.plan.clips[clipIndex];
      if (binding.stateKey && binding.stateVersionId) {
        for (const requirement of clip?.visualStateAnchorRequirements ?? []) {
          if (
            requirement.characterName === binding.name &&
            requirement.stateKey === binding.stateKey &&
            requirement.stateVersionId === binding.stateVersionId &&
            requirement.anchorNodeId
          ) frozenOldIds.add(requirement.anchorNodeId);
        }
      }
      for (const contract of clip?.assetObjectContracts ?? []) {
        if (contract.kind !== binding.kind || contract.name !== binding.name) continue;
        for (const nodeId of contract.referenceImageNodeIds) frozenOldIds.add(nodeId);
      }
    }
    if (!frozenOldIds.size) return binding;
    const expandedClipIndexes = input.plan.clips.flatMap((clip, clipIndex) => {
      if (binding.stateKey && binding.stateVersionId) {
        const sharesStateVersion = (clip.visualStateAnchorRequirements ?? []).some((requirement) =>
          requirement.characterName === binding.name &&
          requirement.stateKey === binding.stateKey &&
          requirement.stateVersionId === binding.stateVersionId,
        );
        return sharesStateVersion ? [clipIndex] : [];
      }
      const sharesFrozenReference = (clip.assetObjectContracts ?? []).some((contract) =>
        contract.kind === binding.kind &&
        contract.name === binding.name &&
        contract.referenceImageNodeIds.some((nodeId) => frozenOldIds.has(nodeId)),
      );
      return sharesFrozenReference ? [clipIndex] : [];
    });
    return {
      ...binding,
      clipIndexes: [...new Set([...declaredClipIndexes, ...expandedClipIndexes])].sort((a, b) => a - b),
    };
  });
}

/** 把已验真的当前画布节点或项目资产 ID 回填到 authoring 的冻结 BeatSheet。 */
export function applyAuthoringAssetBindings(input: {
  beatSheetJson: string | null;
  bindings: readonly VideoAssetRepairBinding[];
}): string {
  if (!input.beatSheetJson) {
    throw new AppError("当前 authoring run 缺少 BeatSheet", { status: 409, code: "asset_repair_beat_sheet_missing" });
  }
  let raw: unknown;
  try {
    raw = JSON.parse(input.beatSheetJson);
  } catch {
    throw new AppError("当前 authoring run 的 BeatSheet 不是合法 JSON", { status: 409, code: "asset_repair_beat_sheet_invalid" });
  }
  const sheet = readRecord(raw);
  const beats = Array.isArray(sheet?.beats) ? sheet.beats : null;
  if (!sheet || !beats) {
    throw new AppError("当前 authoring run 的 BeatSheet 缺少 beats", { status: 409, code: "asset_repair_beat_sheet_invalid" });
  }
  const nextBeats = beats.map((rawBeat) => {
    const beat = readRecord(rawBeat);
    if (!beat) return rawBeat;
    const clipIndex = typeof beat.clipIndex === "number" ? beat.clipIndex : Number(beat.clipIndex);
    const matchedReferenceIds = new Set<string>();
    const replacedReferenceIds = new Set<string>();
    const contracts = Array.isArray(beat.assetObjectContracts)
      ? beat.assetObjectContracts.map((rawContract) => {
          const contract = readRecord(rawContract);
          if (!contract) return rawContract;
          const matching = input.bindings.filter((binding) =>
            binding.kind === contract.kind &&
            binding.name === trimmed(contract.name) &&
            (!binding.clipIndexes || binding.clipIndexes.includes(clipIndex)),
          );
          if (!matching.length) return rawContract;
          const nodeIds = matching
            .map((binding) => binding.nodeId)
            .filter((value): value is string => Boolean(value));
          const assetIds = matching
            .map((binding) => binding.referenceAssetId)
            .filter((value): value is string => Boolean(value));
          if (nodeIds.length || assetIds.length) {
            for (const oldId of Array.isArray(contract.referenceImageNodeIds)
              ? contract.referenceImageNodeIds.map(trimmed).filter(Boolean)
              : []) {
              replacedReferenceIds.add(oldId);
            }
          }
          for (const nodeId of nodeIds) matchedReferenceIds.add(nodeId);
          return {
            ...contract,
            ...(nodeIds.length
              ? { referenceImageNodeIds: [...new Set(nodeIds)] }
              : assetIds.length
                ? { referenceImageNodeIds: [] }
                : {}),
            ...(assetIds.length ? { referenceAssetIds: [...new Set(assetIds)] } : {}),
          };
        })
      : beat.assetObjectContracts;
    const visualStateAnchorRequirements = Array.isArray(beat.visualStateAnchorRequirements)
      ? beat.visualStateAnchorRequirements.map((rawRequirement) => {
          const requirement = readRecord(rawRequirement);
          if (!requirement) return rawRequirement;
          const matching = input.bindings.find((binding) =>
            binding.kind === "character" &&
            binding.name === trimmed(requirement.characterName) &&
            binding.stateKey === trimmed(requirement.stateKey) &&
            binding.stateVersionId === trimmed(requirement.stateVersionId) &&
            (!binding.clipIndexes || binding.clipIndexes.includes(clipIndex)),
          );
          return matching?.nodeId ? { ...requirement, anchorNodeId: matching.nodeId } : rawRequirement;
        })
      : beat.visualStateAnchorRequirements;
    const currentReferenceIds = Array.isArray(beat.videoReferenceNodeIds)
      ? beat.videoReferenceNodeIds.map(trimmed).filter(Boolean)
      : [];
    return {
      ...beat,
      assetObjectContracts: contracts,
      visualStateAnchorRequirements,
      videoReferenceNodeIds: [...new Set([
        ...currentReferenceIds.filter((id) => !replacedReferenceIds.has(id)),
        ...matchedReferenceIds,
      ])],
    };
  });
  const timeline = readRecord(sheet.visualStateTimeline);
  const intervals = Array.isArray(timeline?.intervals)
    ? timeline.intervals.map((rawInterval) => {
        const interval = readRecord(rawInterval);
        if (!interval) return rawInterval;
        const matching = input.bindings.find((binding) =>
          binding.kind === "character" &&
          binding.name === trimmed(interval.characterName) &&
          binding.stateKey === trimmed(interval.stateKey) &&
          binding.stateVersionId === trimmed(interval.stateVersionId),
        );
        return matching?.nodeId ? { ...interval, anchorNodeId: matching.nodeId } : rawInterval;
      })
    : null;
  return JSON.stringify({
    ...sheet,
    beats: nextBeats,
    ...(timeline && intervals
      ? { visualStateTimeline: { ...timeline, intervals } }
      : {}),
  });
}

/**
 * Bind newly generated identity cards to the failed run, preserve all successful
 * clips, and immediately resume the same durable plan. No provider task is
 * recreated until every binding has a real URL and exact structural identity.
 */
export async function repairVideoRunAssets(input: {
  c: AppContext;
  requestUserId: string;
  flowId: string;
  chapterId?: string;
  bodyArgs: unknown;
}): Promise<Record<string, unknown>> {
  const args = readRecord(input.bodyArgs) ?? {};
  const runId = trimmed(args.runId);
  if (!runId) return { ok: false, mode: "repair_assets", code: "asset_repair_run_id_required", terminal: false };
  const requestedExecutionGeneration = trimmed(args.executionGeneration);
  const requestedProgressRevision = typeof args.progressRevision === "number" &&
    Number.isInteger(args.progressRevision) && args.progressRevision >= 0
    ? args.progressRevision
    : null;
  if (!requestedExecutionGeneration || requestedProgressRevision === null) {
    return {
      ok: false,
      mode: "repair_assets",
      code: "asset_repair_frontier_fence_required",
      runId,
      terminal: false,
      message: "repair_assets 必须逐字携带当前 progressCursor.executionGeneration 与 progress revision。",
    };
  }
  const run = await getVideoRun(runId);
  if (!run || run.owner_id !== input.requestUserId || run.flow_id !== input.flowId || (input.chapterId && run.chapter_id !== input.chapterId)) {
    return { ok: false, mode: "repair_assets", code: "asset_repair_run_scope_mismatch", runId, terminal: false };
  }
  const authoringAssetRepair = run.state === "collecting" && run.authoring_state === "asset_repair_required";
  if (!authoringAssetRepair && run.state !== "failed" && run.state !== "cancelled") {
    return { ok: false, mode: "repair_assets", code: "asset_repair_run_not_failed", runId, state: run.state, terminal: false };
  }
  let bindings = parseBindings(args.assetBindings);
  if (bindings === null) {
	return {
		ok: false,
		mode: "repair_assets",
		code: "asset_repair_bindings_invalid",
		runId,
		terminal: false,
		message: "assetBindings 含无法验真的结构字段；整批未消费，禁止静默丢弃坏项后继续。",
	};
  }
  if (!bindings.length) {
    return {
      ok: false,
      mode: "repair_assets",
      code: "asset_repair_bindings_required",
      runId,
      terminal: false,
      message: "assetBindings 每项必须二选一包含当前章节真实图片 nodeId，或 agents 已从当前项目资产列表选定的 referenceAssetId。",
    };
  }

  const plan = authoringAssetRepair ? null : parsePlan(run);
  let repairDeclaration = await readVideoAssetRepairFromFlow({
    c: input.c,
    flowId: input.flowId,
    ownerId: input.requestUserId,
    runId,
    ...(input.chapterId ? { chapterId: input.chapterId } : {}),
  });
  if (!repairDeclaration) {
    return {
      ok: false,
      mode: "repair_assets",
      code: "asset_repair_declaration_missing",
      runId,
      terminal: false,
      message: "当前画布没有该 run 的结构化补图声明；禁止猜测缺失身份或按图序重绑。",
    };
  }
  if (
    repairDeclaration.executionGeneration !== requestedExecutionGeneration ||
    (repairDeclaration.progress?.revision ?? 0) !== requestedProgressRevision
  ) {
    return {
      ok: false,
      mode: "repair_assets",
      code: "asset_repair_frontier_changed",
      runId,
      terminal: false,
      expectedExecutionGeneration: repairDeclaration.executionGeneration,
      expectedProgressRevision: repairDeclaration.progress?.revision ?? 0,
      message: "补资产前沿已由另一物理执行推进；本批未消费，请只使用最新 v3 前沿。",
    };
  }
  const repairClaimOwner = resolveAssetRepairFrontierClaimOwner(input.c);
  if (!repairClaimOwner) {
    return {
      ok: false,
      mode: "repair_assets",
      code: "asset_repair_execution_owner_missing",
      runId,
      terminal: false,
      message: "服务端没有当前物理执行身份；本批未认领前沿、未产生副作用。",
    };
  }
  const repairClaim = await claimAssetRepairFrontierArtifact({
    runId,
    expectedExecutionGeneration: requestedExecutionGeneration,
    expectedRevision: requestedProgressRevision,
    owner: repairClaimOwner,
    nowIso: new Date().toISOString(),
  });
  if (!repairClaim) {
    return {
      ok: false,
      mode: "repair_assets",
      code: "asset_repair_frontier_claim_conflict",
      runId,
      terminal: false,
      message: "当前补资产前沿已由另一执行者认领或推进；本批未产生副作用。",
    };
  }
  const repairClaimToken = repairClaim.claimToken;
  let repairClaimSettled = false;
  let repairClaimLostError: Error | null = null;
  let repairClaimHeartbeatInFlight = false;
  const assertRepairClaimActive = (): void => {
    if (repairClaimLostError) throw repairClaimLostError;
  };
  const repairClaimHeartbeat = setInterval(() => {
    if (repairClaimHeartbeatInFlight || repairClaimLostError || repairClaimSettled) return;
    repairClaimHeartbeatInFlight = true;
    void touchAssetRepairFrontierClaim({
      runId,
      claimToken: repairClaimToken,
      nowIso: new Date().toISOString(),
    }).then((touched) => {
      if (!touched) repairClaimLostError = new Error("asset_repair_frontier_claim_lease_lost");
    }).catch((error: unknown) => {
      repairClaimLostError = new Error(
        `asset_repair_frontier_claim_heartbeat_failed:${error instanceof Error ? error.message : String(error)}`,
      );
    }).finally(() => {
      repairClaimHeartbeatInFlight = false;
    });
  }, Math.max(5_000, Math.floor(ASSET_REPAIR_FRONTIER_CLAIM_LEASE_MS / 3)));
  try {

  let claimedPayload: unknown = null;
  try {
    claimedPayload = JSON.parse(repairClaim.payload);
  } catch {
    throw new AppError("服务端补资产前沿无法解析", {
      status: 409,
      code: "asset_repair_frontier_invalid",
    });
  }
  const claimedDeclaration = readVideoAssetRepairDeclaration({
    assetRepairRequired: true,
    assetRepair: claimedPayload,
  });
  if (
    !claimedDeclaration ||
    claimedDeclaration.runId !== runId ||
    claimedDeclaration.executionGeneration !== requestedExecutionGeneration ||
    (claimedDeclaration.progress?.revision ?? 0) !== requestedProgressRevision
  ) {
    throw new AppError("补资产前沿在认领时已改变", {
      status: 409,
      code: "asset_repair_frontier_changed",
    });
  }
  repairDeclaration = claimedDeclaration;
  const row = await freshReadFlowRow({
    c: input.c,
    flowId: input.flowId,
    requestUserId: input.requestUserId,
    devBypass: true,
    ...(input.chapterId ? { chapterId: input.chapterId } : {}),
  });
  const requirementByIdentity = new Map(
    repairDeclaration.requiredAssets.map((requirement) => [assetRepairIdentityKey(requirement), requirement] as const),
  );
  bindings = bindings.map((binding) => {
    const requirement = requirementByIdentity.get(assetRepairIdentityKey(binding));
    return requirement
      ? { ...binding, clipIndexes: [...requirement.clipIndexes] }
      : binding;
  });
  if (plan) bindings = expandAssetRepairBindingsForFrozenReferences({ plan, bindings });
  const boundNodeIds = new Map<string, string>();
  const boundIdentityNodeIds = new Map<string, string>();
  const canvasPatch: Array<{ id: string; data: Record<string, unknown> }> = [];
  const syncResults: Array<Record<string, unknown>> = [];
  const flowNodes = readFlowNodes(row);
  const requiredIdentityKeys = new Set(repairDeclaration.requiredAssets.map(assetRepairIdentityKey));
  const referenceAssetBindings = bindings.filter(
    (binding): binding is VideoAssetRepairBinding & { referenceAssetId: string } =>
      Boolean(binding.referenceAssetId),
  );
  const projectAssets = referenceAssetBindings.length > 0 && run.project_id
    ? await listProjectNodeAssetsForOwner(input.c, input.requestUserId, { projectId: run.project_id })
    : [];
  const validatedCanvasBindings: Array<{
    binding: VideoAssetRepairBinding;
    node: VideoFlowNode;
    imageUrl: string;
    declaredRequirement: VideoAssetRepairRequirement;
  }> = [];

  for (const binding of bindings) {
    assertRepairClaimActive();
    const identity = assetRepairIdentityKey(binding);
    if (!requiredIdentityKeys.has(identity)) {
      return {
        ok: false,
        mode: "repair_assets",
        code: "asset_repair_binding_not_declared",
        runId,
        binding: {
          kind: binding.kind,
          name: binding.name,
          ...(binding.stateKey ? { stateKey: binding.stateKey } : {}),
          ...(binding.stateVersionId ? { stateVersionId: binding.stateVersionId } : {}),
          ...(binding.nodeId ? { nodeId: binding.nodeId } : {}),
          ...(binding.referenceAssetId ? { referenceAssetId: binding.referenceAssetId } : {}),
        },
        terminal: false,
        message: "assetBindings 包含当前 repair declaration 未声明的身份；禁止把额外节点写入 durable plan。",
      };
    }
    const declaredRequirement = repairDeclaration.requiredAssets.find(
      (requirement) => assetRepairIdentityKey(requirement) === identity,
    );
    if (!declaredRequirement) {
      return {
        ok: false,
        mode: "repair_assets",
        code: "asset_repair_binding_not_declared",
        runId,
        terminal: false,
      };
    }
    if (binding.referenceAssetId) {
      if (binding.stateKey || binding.stateVersionId) {
        return {
          ok: false,
          mode: "repair_assets",
          code: "asset_repair_state_anchor_requires_canvas_node",
          runId,
          stateKey: binding.stateKey,
          stateVersionId: binding.stateVersionId,
          terminal: false,
        };
      }
      const asset = projectAssets.find((candidate) => candidate.id === binding.referenceAssetId);
      const assetData = readRecord(asset?.latestVersion?.data);
      const imageUrl = assetData ? readDurableCanvasImageUrl(assetData) : "";
      if (!asset || asset.kind !== binding.kind) {
        return {
          ok: false,
          mode: "repair_assets",
          code: "asset_repair_project_asset_scope_mismatch",
          runId,
          referenceAssetId: binding.referenceAssetId,
          terminal: false,
        };
      }
      if (!assetData || isExplicitlyRejectedAsset(assetData) || !imageUrl) {
        return {
          ok: false,
          mode: "repair_assets",
          code: "asset_repair_project_asset_unavailable",
          runId,
          referenceAssetId: binding.referenceAssetId,
          terminal: false,
        };
      }
      syncResults.push({
        referenceAssetId: binding.referenceAssetId,
        kind: binding.kind,
        name: binding.name,
        sourceName: asset.name,
        status: "project_asset_selected",
      });
      continue;
    }
    const nodeId = binding.nodeId;
    if (!nodeId) continue;
    const node = findFlowNode(row, nodeId);
    if (!node) return { ok: false, mode: "repair_assets", code: "asset_repair_canvas_node_missing", runId, nodeId, terminal: false };
    const imageUrl = readDurableCanvasImageUrl(node.data);
    if (!imageUrl) return { ok: false, mode: "repair_assets", code: "asset_repair_image_url_missing", runId, nodeId, terminal: false };
    const classification = classifyCanvasCardForRegistry(node.data);
    if (!classification || classification.kind !== binding.kind || classification.name !== binding.name) {
      return {
        ok: false,
        mode: "repair_assets",
        code: "asset_repair_identity_mismatch",
        runId,
        nodeId,
        expected: { kind: binding.kind, name: binding.name },
        actual: classification,
        terminal: false,
      };
    }
    if (binding.stateKey && binding.stateVersionId) {
      const nodeData = readRecord(node.data) ?? {};
      if (
        trimmed(nodeData.stateKey) !== binding.stateKey ||
        trimmed(nodeData.stateVersionId) !== binding.stateVersionId
      ) {
        return {
          ok: false,
          mode: "repair_assets",
          code: "asset_repair_state_identity_mismatch",
          runId,
          nodeId,
          expected: {
            stateKey: binding.stateKey,
            stateVersionId: binding.stateVersionId,
          },
          actual: {
            stateKey: trimmed(nodeData.stateKey),
            stateVersionId: trimmed(nodeData.stateVersionId),
          },
          terminal: false,
        };
      }
      if (!visualFactsEqual(nodeData.visualStateFacts, declaredRequirement.visualFacts ?? [])) {
        return {
          ok: false,
          mode: "repair_assets",
          code: "asset_repair_state_visual_facts_mismatch",
          runId,
          nodeId,
          expectedVisualFacts: declaredRequirement.visualFacts ?? [],
          actualVisualFacts: readVisualFacts(nodeData.visualStateFacts),
          terminal: false,
        };
      }
      const baseReference = verifyStateAnchorBaseReference({
        stateNode: node,
        flowNodes,
        characterName: binding.name,
      });
      if (!baseReference.ok) {
        return {
          ok: false,
          mode: "repair_assets",
          code: baseReference.code,
          runId,
          nodeId,
          stateKey: binding.stateKey,
          stateVersionId: binding.stateVersionId,
          referenceImageNodeIds: baseReference.referenceImageNodeIds,
          terminal: false,
          message: "状态锚必须由当前画布中同名、有真实图片且不带状态版本的基础角色卡编辑生成。",
        };
      }
    }
    const previousIdentity = boundNodeIds.get(nodeId);
    if (previousIdentity && previousIdentity !== identity) {
      return { ok: false, mode: "repair_assets", code: "asset_repair_node_ambiguous", runId, nodeId, terminal: false };
    }
    const previousNodeId = boundIdentityNodeIds.get(identity);
    if (previousNodeId && previousNodeId !== nodeId) {
      return {
        ok: false,
        mode: "repair_assets",
        code: "asset_repair_identity_ambiguous",
        runId,
        kind: binding.kind,
        name: binding.name,
        nodeIds: [previousNodeId, nodeId],
        terminal: false,
      };
    }
    boundNodeIds.set(nodeId, identity);
    boundIdentityNodeIds.set(identity, nodeId);
    if (binding.stateKey && binding.stateVersionId) {
      const baseReference = verifyStateAnchorBaseReference({
        stateNode: node,
        flowNodes,
        characterName: binding.name,
      });
      if (!baseReference.ok) {
        throw new AppError("状态锚基础引用在同一事务内失效", {
          status: 409,
          code: baseReference.code,
        });
      }
      syncResults.push({
        nodeId,
        kind: binding.kind,
        name: binding.name,
        stateKey: binding.stateKey,
        stateVersionId: binding.stateVersionId,
        baseNodeId: baseReference.baseNodeId,
        status: "state_anchor_canvas_authoritative",
      });
      continue;
    }
    validatedCanvasBindings.push({ binding, node, imageUrl, declaredRequirement });
  }

  // All structural identity/state/reference checks above must pass before the
  // first material or canvas mutation. A bad item later in the batch therefore
  // cannot leave earlier identities partially registered.
  for (const validated of validatedCanvasBindings) {
    assertRepairClaimActive();
    const { binding, node, imageUrl, declaredRequirement } = validated;
    const nodeId = binding.nodeId!;
    const sync = await syncCanvasCardToMaterial({
      c: input.c,
      userId: input.requestUserId,
      projectId: run.project_id ?? row.project_id ?? "",
      imageUrl,
      nodeData: node.data,
      nodeId,
      binding: { kind: binding.kind, name: binding.name },
    });
    assertRepairClaimActive();
    if (!sync.synced && sync.reason !== "canonical_points_to_other_image" && sync.reason !== "image_already_bound_to_other_identity") {
      return { ok: false, mode: "repair_assets", code: "asset_repair_material_sync_failed", runId, nodeId, reason: sync.reason, terminal: false };
    }
    syncResults.push({ nodeId, kind: binding.kind, name: binding.name, status: sync.synced ? "synced" : "canvas_authoritative", ...(sync.assetId ? { assetId: sync.assetId } : {}), ...(sync.reason ? { reason: sync.reason } : {}) });
    if (sync.synced && sync.assetId) {
      canvasPatch.push({
        id: nodeId,
        data: {
          referenceType: binding.kind,
          ...(binding.kind === "character" ? { roleName: binding.name } : {}),
          ...(binding.kind === "scene" ? { sceneName: binding.name } : {}),
          ...(binding.kind === "prop" ? { propName: binding.name, materialIdentity: { mode: "base", canonicalName: binding.name } } : {}),
          ...(binding.kind === "ensemble" ? { ensembleTitle: binding.name } : {}),
          ...(binding.stateKey && binding.stateVersionId
            ? {
                stateKey: binding.stateKey,
                stateVersionId: binding.stateVersionId,
                visualStateFacts: (declaredRequirement.visualFacts ?? []).map((fact) => ({ ...fact })),
              }
            : {}),
          materialAssetId: sync.assetId,
          materialRegisteredImageUrl: imageUrl,
        },
      });
    }
  }
  assertRepairClaimActive();
  if (canvasPatch.length) {
    const latest = await freshReadFlowRow({ c: input.c, flowId: input.flowId, requestUserId: input.requestUserId, devBypass: true, ...(input.chapterId ? { chapterId: input.chapterId } : {}) });
    await persistFlowPatch({ c: input.c, row: latest, flowId: input.flowId, requestUserId: input.requestUserId, devBypass: true, ...(input.chapterId ? { chapterId: input.chapterId } : {}), affectedNodeIds: canvasPatch.map((item) => item.id), patch: { patchNodeData: canvasPatch, allowOverwrite: true } as never });
    assertRepairClaimActive();
  }

  const nextClips = plan ? applyStoryPlanAssetBindings({ plan, bindings }) : null;

  // Persist the BeatSheet first whenever this run owns one. It is the
  // reconstruction authority used by workers after deploy/recovery; updating
  // only the executable plan would let a later projection resurrect stale
  // chapter node ids.
  if (authoringAssetRepair || run.beat_sheet) {
    assertRepairClaimActive();
    const updatedBeatSheet = applyAuthoringAssetBindings({
      beatSheetJson: run.beat_sheet,
      bindings,
    });
    const persisted = await persistBeatSheetSnapshot({
      runId,
      expectedBeatSheetJson: run.beat_sheet ?? "",
      beatSheetJson: updatedBeatSheet,
      nowIso: new Date().toISOString(),
    });
    if (!persisted) {
      throw new AppError("已验真资产未能原子回填 authoring BeatSheet", { status: 409, code: "asset_repair_beat_sheet_persist_failed" });
    }
    assertRepairClaimActive();
  }

  // Persist every verified identity immediately. The former all-or-nothing
  // contract discarded valid partial work and forced the model to reconstruct
  // the full batch on every physical run. BeatSheet/plan mutation is the
  // durable source of truth; the flow declaration below is its compact
  // execution frontier.
  if (!authoringAssetRepair) {
    assertRepairClaimActive();
    const planPayload = { ...plan, clips: nextClips } as unknown as Record<string, unknown>;
    delete planPayload.executablePlanHash;
    const updatedPlan = { ...planPayload, protocolVersion: VIDEO_ORCHESTRATOR_PROTOCOL_VERSION, executablePlanHash: stableContentHash(planPayload) };
    const persisted = await upsertVideoRunAccumClips({
      runId,
      ownerId: input.requestUserId,
      projectId: run.project_id,
      flowId: run.flow_id,
      chapterId: run.chapter_id,
      storyPlanJson: JSON.stringify(updatedPlan),
      nowIso: new Date().toISOString(),
      allowTerminalReplacement: true,
    });
    if (!persisted) throw new AppError("已验真资产未能原子回填 durable video plan", { status: 409, code: "asset_repair_plan_persist_failed" });
    assertRepairClaimActive();
  }

  const progress = advanceAssetRepairProgress({
    declaration: repairDeclaration,
    verifiedBindings: bindings,
  });
  if (!progress.complete) {
    assertRepairClaimActive();
    await persistVideoAssetRepairProgress({
      c: input.c,
      flowId: input.flowId,
      ownerId: input.requestUserId,
      runId,
      declaration: progress.declaration,
      claimToken: repairClaimToken,
      expectedExecutionGeneration: repairDeclaration.executionGeneration,
      expectedRevision: repairDeclaration.progress?.revision ?? 0,
      ...(input.chapterId ? { chapterId: input.chapterId } : {}),
    });
    repairClaimSettled = true;
    return {
      ok: true,
      mode: "repair_assets",
      code: "asset_repair_progress_saved",
      runId,
      terminal: false,
      runTerminal: false,
      lifecycleOutcome: "waiting_external",
      goalOutcome: "unsatisfied",
      assetRepairRequired: true,
      assetRepair: progress.declaration,
      progressCursor: buildVideoAssetRepairProgressCursor(progress.declaration),
      acceptedBindings: bindings,
      materialSync: syncResults,
      progress: progress.declaration.progress,
      remainingAssets: progress.remainingAssets,
      nextAction: "repair_remaining_assets",
      message: `已持久化 ${bindings.length} 项真实资产证据；同一 run 只剩 ${progress.remainingAssets.length} 项，后续不得重新处理已完成项。`,
    };
  }
  // Clear only the pre-submit repair markers for this run. Existing successful
  // media nodes are untouched; start will reset failed submit fields and reuse
  // their real assets without creating another provider task.
  const latestAfterPlan = await freshReadFlowRow({
    c: input.c,
    flowId: input.flowId,
    requestUserId: input.requestUserId,
    devBypass: true,
    ...(input.chapterId ? { chapterId: input.chapterId } : {}),
  });
  assertRepairClaimActive();
  const repairNodes = readFlowNodes(latestAfterPlan)
    .filter((node) => {
      const data = node.data ?? {};
      const isVideoRepair = trimmed(data.kind).toLowerCase() === "video" &&
        trimmed(data.clipRunId) === runId &&
        data.assetRepairRequired === true;
      const isAuthoringRepair = authoringAssetRepair &&
        node.id === "video-run-status" &&
        trimmed(data.runId) === runId &&
        data.assetRepairRequired === true;
      return isVideoRepair || isAuthoringRepair;
    })
    .map((node) => ({
      id: node.id,
      data: authoringAssetRepair
        ? { assetRepairRequired: false, assetRepair: null }
        : {
            assetRepairRequired: false,
            assetRepair: null,
            clipSubmitError: "",
            clipSubmitErrorCode: "",
            clipSubmitPhase: "",
          },
    }));
  if (repairNodes.length > 0) {
    await persistFlowPatch({
      c: input.c,
      row: latestAfterPlan,
      flowId: input.flowId,
      requestUserId: input.requestUserId,
      devBypass: true,
      ...(input.chapterId ? { chapterId: input.chapterId } : {}),
      affectedNodeIds: repairNodes.map((node) => node.id),
      patch: { patchNodeData: repairNodes, allowOverwrite: true } as never,
    });
    assertRepairClaimActive();
  }

  const repair = await readVideoAssetRepairFromFlow({ c: input.c, flowId: input.flowId, ownerId: input.requestUserId, runId, ...(input.chapterId ? { chapterId: input.chapterId } : {}) });
  const repairedClipIndexes = [...new Set(bindings.flatMap((binding) => binding.clipIndexes ?? (
    plan ? plan.clips.map((_, index) => index) : repairDeclaration.requiredAssets.flatMap((asset) => asset.clipIndexes)
  )))].sort((a, b) => a - b);
  const productionArtifactRoots = authoringAssetRepair
    ? []
    : buildAssetRepairProductionArtifactRoots(repairedClipIndexes);
  const invalidatedArtifactKeys = productionArtifactRoots.length > 0
    ? await invalidateArtifactClosure({
        runId,
        rootKeys: productionArtifactRoots,
        nowIso: new Date().toISOString(),
      })
    : [];
  assertRepairClaimActive();
  // The frontier becomes terminal only after every recoverable projection and
  // artifact invalidation has committed. A crash before this point leaves the
  // exact claim reclaimable; retry replays idempotent projections and can still
  // finish the same generation instead of stranding a ready DB row with stale
  // canvas markers.
  const frontierCompleted = await settleClaimedAssetRepairFrontierArtifact({
    runId,
    claimToken: repairClaimToken,
    expectedExecutionGeneration: repairDeclaration.executionGeneration,
    expectedRevision: repairDeclaration.progress?.revision ?? 0,
    declaration: progress.declaration,
    status: "ready",
    ...(authoringAssetRepair
      ? {
          advanceAuthoringFrom: "asset_repair_required" as const,
          advanceAuthoringTo: "beats_committed" as const,
        }
      : {}),
    nowIso: new Date().toISOString(),
  });
  if (!frontierCompleted) {
    throw new AppError("补资产完成前沿或 run 状态已被另一执行代际推进", {
      status: 409,
      code: "asset_repair_frontier_changed",
    });
  }
  repairClaimSettled = true;
  return {
    ok: true,
    mode: "repair_assets",
    runId,
    assetRepairResolved: true,
    repairedClipIndexes,
    invalidatedArtifactKeys,
    idempotentReplay: false,
    assetBindings: bindings,
    materialSync: syncResults,
    ...(repair ? { previousRepair: repair } : {}),
    nextAction: authoringAssetRepair ? "continue_authoring" : "start_same_run",
    ...(authoringAssetRepair ? { authoringAssetRepairResolved: true } : {}),
    message: authoringAssetRepair
      ? "独立身份图已验真并回填同一 BeatSheet；接下来继续原 authoring run 派 writer，不重提 BeatSheet、不重复扣费。"
      : "独立身份图已验真并同步；同一 durable plan 已回填，接下来只复用成功片段并继续未完成镜头，不重复原已受理任务。",
  };
  } finally {
    clearInterval(repairClaimHeartbeat);
    if (!repairClaimSettled) {
      try {
        await releaseAssetRepairFrontierClaim({
          runId,
          claimToken: repairClaimToken,
          nowIso: new Date().toISOString(),
        });
      } catch (error) {
        console.error("[video-asset-repair] failed to release frontier claim", {
          runId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}

export function deriveRepairClipNodeId(runId: string, clipIndex: number): string {
  return deriveClipNodeId(buildClipId(runId, clipIndex));
}
