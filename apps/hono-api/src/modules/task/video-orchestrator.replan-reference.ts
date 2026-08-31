import {
  classifyCanvasCardForRegistry,
  readDurableCanvasImageUrl,
} from "./material-auto-register";
import type { VideoFlowNode } from "./video-orchestrator.flow-io";
import { isExplicitlyRejectedAsset } from "./video-orchestrator.asset-availability";

export type ReplanReferenceRebinding = {
  oldNodeId: string;
  newNodeId: string;
  kind: string;
  name: string;
  clipIndexes: number[];
};

export type ReplanReferenceBinding = {
  newNodeId: string;
  kind: string;
  name: string;
  clipIndexes: number[];
};

export type ReplanReferenceIssue = {
  nodeId: string;
  kind?: string;
  name?: string;
  clipIndexes: number[];
  reason:
    | "current_identity_missing"
    | "current_identity_ambiguous"
    | "video_reference_not_declared";
};

export type ReplanReferenceRepairEvidence = {
  rebound: ReplanReferenceRebinding[];
  bound: ReplanReferenceBinding[];
  unresolved: ReplanReferenceIssue[];
};

type ReferenceBinding = {
  newNodeId: string;
  kind: string;
  name: string;
  clipIndexes: Set<number>;
};

type IdentityCandidate = {
  nodeId: string;
  kind: string;
  name: string;
};

type CurrentIdentityIndex = {
  byIdentityKey: Map<string, IdentityCandidate[]>;
  byNodeId: Map<string, IdentityCandidate>;
};

function readTrimmed(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readClipIndex(beat: Record<string, unknown>, fallback: number): number {
  const value = Number(beat.clipIndex);
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

function identityKey(kind: string, name: string): string {
  return `${kind}\u0000${name}`;
}

function readNodeData(node: VideoFlowNode): Record<string, unknown> {
  return node.data && typeof node.data === "object" && !Array.isArray(node.data)
    ? node.data
    : {};
}

function collectCurrentIdentityCandidates(
  nodes: readonly VideoFlowNode[],
): CurrentIdentityIndex {
  const byIdentityKey = new Map<string, IdentityCandidate[]>();
  const byNodeId = new Map<string, IdentityCandidate>();
  for (const node of nodes) {
    const data = readNodeData(node);
    if (isExplicitlyRejectedAsset(data)) continue;
    if (!readDurableCanvasImageUrl(data)) continue;
    const classification = classifyCanvasCardForRegistry(data);
    if (!classification) continue;
    const candidate = {
      nodeId: node.id,
      kind: classification.kind,
      name: classification.name,
    };
    const key = identityKey(candidate.kind, candidate.name);
    const entries = byIdentityKey.get(key) ?? [];
    entries.push(candidate);
    byIdentityKey.set(key, entries);
    byNodeId.set(node.id, candidate);
  }
  return { byIdentityKey, byNodeId };
}

function replaceNodeIds(value: unknown, replacements: Map<string, ReferenceBinding>): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((rawNodeId) => {
    const nodeId = readTrimmed(rawNodeId);
    return replacements.get(nodeId)?.newNodeId ?? rawNodeId;
  });
}

function appendIssue(
  issues: Map<string, ReplanReferenceIssue>,
  issue: ReplanReferenceIssue,
): void {
  const key = `${issue.reason}\u0000${issue.nodeId}\u0000${issue.kind ?? ""}\u0000${issue.name ?? ""}`;
  const existing = issues.get(key);
  if (!existing) {
    issues.set(key, { ...issue, clipIndexes: [...new Set(issue.clipIndexes)] });
    return;
  }
  existing.clipIndexes = [...new Set([...existing.clipIndexes, ...issue.clipIndexes])].sort(
    (left, right) => left - right,
  );
}

/**
 * Replan 只允许修复“节点身份已声明、当前画布存在唯一真实同身份图片”的引用漂移。
 *
 * 这不是按自然语言意图猜资产：BeatSheet 已冻结的 kind/name 是唯一匹配合同，当前
 * 画布的节点必须同时通过现有卡片分类器和 durable image URL 检查。无法唯一匹配时保留
 * 显式问题，调用方在提交前终止，避免把错误拖到付费视频阶段才暴露。
 */
export function rebindReplanBeatSheetReferences(input: {
  beatSheet: Record<string, unknown>;
  currentNodes: readonly VideoFlowNode[];
}): {
  beatSheet: Record<string, unknown>;
  evidence: ReplanReferenceRepairEvidence;
} {
  const currentNodeIds = new Set(input.currentNodes.map((node) => node.id));
  const currentIdentities = collectCurrentIdentityCandidates(input.currentNodes);
  const replacements = new Map<string, ReferenceBinding>();
  const bindings = new Map<string, ReferenceBinding>();
  const issues = new Map<string, ReplanReferenceIssue>();
  const beats = Array.isArray(input.beatSheet.beats) ? input.beatSheet.beats : [];

  beats.forEach((rawBeat, beatArrayIndex) => {
    const beat = readRecord(rawBeat);
    if (!beat) return;
    const clipIndex = readClipIndex(beat, beatArrayIndex);
    const contracts = Array.isArray(beat.assetObjectContracts)
      ? beat.assetObjectContracts
      : [];

    for (const rawContract of contracts) {
      const contract = readRecord(rawContract);
      if (!contract) continue;
      const kind = readTrimmed(contract.kind);
      const name = readTrimmed(contract.name);
      const referenceNodeIds = Array.isArray(contract.referenceImageNodeIds)
        ? contract.referenceImageNodeIds
            .map(readTrimmed)
            .filter(Boolean)
        : [];
      if (!kind || !name) continue;
      if (referenceNodeIds.length === 0) {
        const matchingCandidates = currentIdentities.byIdentityKey.get(identityKey(kind, name)) ?? [];
        if (matchingCandidates.length === 1) {
          const candidate = matchingCandidates[0];
          contract.referenceImageNodeIds = [candidate.nodeId];
          const bindingKey = identityKey(kind, name);
          const existing = bindings.get(bindingKey);
          if (existing) {
            existing.clipIndexes.add(clipIndex);
          } else {
            bindings.set(bindingKey, {
              newNodeId: candidate.nodeId,
              kind,
              name,
              clipIndexes: new Set([clipIndex]),
            });
          }
        }
        continue;
      }
      for (const oldNodeId of referenceNodeIds) {
        const existing = replacements.get(oldNodeId);
        const currentIdentity = currentIdentities.byNodeId.get(oldNodeId);
        const currentIdentityMatches =
          currentIdentity?.kind === kind && currentIdentity.name === name;
        if (currentIdentityMatches) {
          if (
            existing &&
            (existing.kind !== kind || existing.name !== name || existing.newNodeId !== oldNodeId)
          ) {
            replacements.delete(oldNodeId);
            appendIssue(issues, {
              nodeId: oldNodeId,
              kind,
              name,
              clipIndexes: [clipIndex],
              reason: "current_identity_ambiguous",
            });
          }
          continue;
        }
        const matchingCandidates =
          currentIdentities.byIdentityKey.get(identityKey(kind, name)) ?? [];
        if (matchingCandidates.length !== 1) {
          appendIssue(issues, {
            nodeId: oldNodeId,
            kind,
            name,
            clipIndexes: [clipIndex],
            reason:
              matchingCandidates.length === 0
                ? "current_identity_missing"
                : "current_identity_ambiguous",
          });
          continue;
        }
        const candidate = matchingCandidates[0];
        if (
          existing &&
          (existing.newNodeId !== candidate.nodeId ||
            existing.kind !== kind ||
            existing.name !== name)
        ) {
          replacements.delete(oldNodeId);
          appendIssue(issues, {
            nodeId: oldNodeId,
            kind,
            name,
            clipIndexes: [clipIndex],
            reason: "current_identity_ambiguous",
          });
          continue;
        }
        if (existing) {
          existing.clipIndexes.add(clipIndex);
        } else {
          replacements.set(oldNodeId, {
            newNodeId: candidate.nodeId,
            kind,
            name,
            clipIndexes: new Set([clipIndex]),
          });
        }
      }
    }

    const videoReferenceNodeIds = Array.isArray(beat.videoReferenceNodeIds)
      ? beat.videoReferenceNodeIds.map(readTrimmed).filter(Boolean)
      : [];
    for (const nodeId of videoReferenceNodeIds) {
      if (currentNodeIds.has(nodeId) || replacements.has(nodeId)) continue;
      appendIssue(issues, {
        nodeId,
        clipIndexes: [clipIndex],
        reason: "video_reference_not_declared",
      });
    }

    if (Array.isArray(beat.videoReferenceNodeIds)) {
      beat.videoReferenceNodeIds = [
        ...new Set([
          ...(replaceNodeIds(beat.videoReferenceNodeIds, replacements) as unknown[])
            .map(readTrimmed)
            .filter(Boolean),
          ...[...bindings.values()]
            .filter((binding) => binding.clipIndexes.has(clipIndex))
            .map((binding) => binding.newNodeId),
        ]),
      ];
    }
    if (Array.isArray(beat.assetObjectContracts)) {
      beat.assetObjectContracts = beat.assetObjectContracts.map((rawContract) => {
        const contract = readRecord(rawContract);
        if (!contract || !Array.isArray(contract.referenceImageNodeIds)) return rawContract;
        return {
          ...contract,
          referenceImageNodeIds: replaceNodeIds(contract.referenceImageNodeIds, replacements),
        };
      });
    }
  });

  const rebound = [...replacements.entries()]
    .map(([oldNodeId, binding]) => ({
      oldNodeId,
      newNodeId: binding.newNodeId,
      kind: binding.kind,
      name: binding.name,
      clipIndexes: [...binding.clipIndexes].sort((left, right) => left - right),
    }))
    .sort((left, right) => left.oldNodeId.localeCompare(right.oldNodeId));
  const bound = [...bindings.values()]
    .map((binding) => ({
      newNodeId: binding.newNodeId,
      kind: binding.kind,
      name: binding.name,
      clipIndexes: [...binding.clipIndexes].sort((left, right) => left - right),
    }))
    .sort((left, right) => {
      const kindOrder = left.kind.localeCompare(right.kind);
      return kindOrder || left.name.localeCompare(right.name);
    });
  const unresolved = [...issues.values()].sort((left, right) => {
    const nodeOrder = left.nodeId.localeCompare(right.nodeId);
    return nodeOrder || left.reason.localeCompare(right.reason);
  });
  const evidence: ReplanReferenceRepairEvidence = { rebound, bound, unresolved };

  if (rebound.length > 0 || bound.length > 0) {
    const currentMeta = readRecord(input.beatSheet.meta) ?? {};
    input.beatSheet.meta = {
      ...currentMeta,
      referenceRepairEvidence: evidence,
    };
  }
  return { beatSheet: input.beatSheet, evidence };
}

/**
 * executable story plan 与 BeatSheet 共享同一套结构化资产身份合同，只是节点数组键为 clips。
 * 恢复路径必须复用同一重绑定算法，避免修好 BeatSheet 却继续执行旧 story_plan。
 */
export function rebindExecutableStoryPlanReferences(input: {
  storyPlan: Record<string, unknown>;
  currentNodes: readonly VideoFlowNode[];
}): {
  storyPlan: Record<string, unknown>;
  evidence: ReplanReferenceRepairEvidence;
} {
  const projection: Record<string, unknown> = {
    beats: Array.isArray(input.storyPlan.clips) ? input.storyPlan.clips : [],
  };
  const rebound = rebindReplanBeatSheetReferences({
    beatSheet: projection,
    currentNodes: input.currentNodes,
  });
  return {
    storyPlan: {
      ...input.storyPlan,
      clips: Array.isArray(rebound.beatSheet.beats) ? rebound.beatSheet.beats : [],
      ...(rebound.evidence.rebound.length > 0 || rebound.evidence.bound.length > 0
        ? { referenceRepairEvidence: rebound.evidence }
        : {}),
    },
    evidence: rebound.evidence,
  };
}
