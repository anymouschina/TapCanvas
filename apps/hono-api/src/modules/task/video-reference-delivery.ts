import type {
  VideoReferenceImageManifestItem,
  VideoReferencePurpose,
  VideoReferenceImageRole,
} from "./video-reference-manifest";
import {
  readClipContinuityMode,
  type ClipContinuityMode,
} from "./video-orchestrator.continuity-contract";

export type VideoReferenceExpectedNode = {
  nodeId: string;
  expectedImageCount: number;
};

export type VideoReferenceDeliveryContract = {
  version: 1;
  clipIndex: number;
  continuityMode: ClipContinuityMode;
  expectedNodes: VideoReferenceExpectedNode[];
};

export type VideoReferenceManifestEvidenceItem = {
  url: string;
  sourceNodeIds: string[];
  role: VideoReferenceImageRole;
  purposes: VideoReferencePurpose[];
  label: string;
  assetKind?: VideoReferencePurpose;
  assetName?: string;
  referenceRole?: string;
};

export type VideoReferenceDeliveryEvidence = {
  version: 1;
  clipIndex: number;
  continuityMode: ClipContinuityMode;
  declaredNodeIds: string[];
  manifestedNodeIds: string[];
  manifest: VideoReferenceManifestEvidenceItem[];
  verified: true;
};

export type VideoReferenceDeliveryVerification =
  | { ok: true; evidence: VideoReferenceDeliveryEvidence }
  | {
      ok: false;
      code: "video_reference_delivery_contract_invalid" | "video_reference_delivery_mismatch";
      message: string;
      details: Record<string, unknown>;
    };

function trimmed(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function parseVideoReferenceDeliveryContract(
  value: unknown,
): VideoReferenceDeliveryContract | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.version !== 1) return null;
  const clipIndex = Number(record.clipIndex);
  const continuityMode = readClipContinuityMode(record.continuityMode);
  if (!Number.isInteger(clipIndex) || clipIndex < 0 || !continuityMode) return null;
  if (!Array.isArray(record.expectedNodes)) return null;
  const expectedNodes: VideoReferenceExpectedNode[] = [];
  const seen = new Set<string>();
  for (const item of record.expectedNodes) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const expected = item as Record<string, unknown>;
    const nodeId = trimmed(expected.nodeId);
    const expectedImageCount = Number(expected.expectedImageCount);
    if (
      !nodeId ||
      seen.has(nodeId) ||
      !Number.isInteger(expectedImageCount) ||
      expectedImageCount < 1
    ) {
      return null;
    }
    seen.add(nodeId);
    expectedNodes.push({ nodeId, expectedImageCount });
  }
  return {
    version: 1,
    clipIndex,
    continuityMode,
    expectedNodes,
  };
}

/**
 * expectedDelivery → deliveryEvidence → verification 的引用维度。
 * 每个业务节点的图片数量必须与 fresh-read 解析结果完全一致；视频提交不注入项目画风锚。
 */
export function verifyVideoReferenceDelivery(input: {
  contract: unknown;
  manifest: readonly VideoReferenceImageManifestItem[];
}): VideoReferenceDeliveryVerification {
  const contract = parseVideoReferenceDeliveryContract(input.contract);
  if (!contract) {
    return {
      ok: false,
      code: "video_reference_delivery_contract_invalid",
      message: "编排视频缺少合法的引用交付合同，禁止进入付费提交边界",
      details: {},
    };
  }

  const actualCountByNodeId = new Map<string, number>();
  const unattributedBusiness = input.manifest.filter(
    (item) => item.sourceNodeIds.length === 0,
  );
  for (const item of input.manifest) {
    for (const rawSourceNodeId of item.sourceNodeIds) {
      const sourceNodeId = trimmed(rawSourceNodeId);
      if (!sourceNodeId) continue;
      actualCountByNodeId.set(
        sourceNodeId,
        (actualCountByNodeId.get(sourceNodeId) ?? 0) + 1,
      );
    }
  }
  const expectedCountByNodeId = new Map(
    contract.expectedNodes.map((item) => [item.nodeId, item.expectedImageCount]),
  );
  const missingOrChanged = contract.expectedNodes
    .filter((item) => actualCountByNodeId.get(item.nodeId) !== item.expectedImageCount)
    .map((item) => ({
      nodeId: item.nodeId,
      expectedImageCount: item.expectedImageCount,
      actualImageCount: actualCountByNodeId.get(item.nodeId) ?? 0,
    }));
  const unexpectedNodeIds = [...actualCountByNodeId.keys()].filter(
    (nodeId) => !expectedCountByNodeId.has(nodeId),
  );
  if (
    missingOrChanged.length ||
    unexpectedNodeIds.length ||
    unattributedBusiness.length
  ) {
    return {
      ok: false,
      code: "video_reference_delivery_mismatch",
      message:
        "最终 referenceMediaManifest 与冻结的真实节点引用合同不一致，已在上游 POST 前停止；禁止丢图、换图或用无归属 URL 继续",
      details: {
        clipIndex: contract.clipIndex,
        missingOrChanged,
        unexpectedNodeIds,
        unattributed: unattributedBusiness.map((item) => ({
          role: item.role,
          purposes: item.purposes,
          label: item.label,
        })),
      },
    };
  }

  const manifest: VideoReferenceManifestEvidenceItem[] = input.manifest.map((item) => ({
    url: item.url,
    sourceNodeIds: item.sourceNodeIds.map(trimmed).filter(Boolean),
    role: item.role,
    purposes: item.purposes,
    label: item.label,
    ...(item.assetKind ? { assetKind: item.assetKind } : {}),
    ...(item.assetName ? { assetName: item.assetName } : {}),
    ...(item.referenceRole ? { referenceRole: item.referenceRole } : {}),
  }));
  return {
    ok: true,
    evidence: {
      version: 1,
      clipIndex: contract.clipIndex,
      continuityMode: contract.continuityMode,
      declaredNodeIds: contract.expectedNodes.map((item) => item.nodeId),
      manifestedNodeIds: [...actualCountByNodeId.keys()],
      manifest,
      verified: true,
    },
  };
}
