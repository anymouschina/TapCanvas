import { isWorkflowProjectImageReady, type WorkflowProjectContext } from "./execution.project-context";

/** Selection is a user constraint, not a visibility or media-type classifier. */
export function workflowProjectImageCandidates(context: WorkflowProjectContext) {
  const visible = new Set(context.projectAssetIds);
  const selected = new Set(context.selectedAssetIds);
  return context.assetSnapshot.filter((asset) => asset.projectId === context.projectId
    && visible.has(asset.assetId) && isWorkflowProjectImageReady(asset)).map((asset) => ({
    assetId: asset.assetId,
    name: asset.name,
    canonicalName: asset.canonicalName,
    kind: asset.kind,
    mediaKind: asset.mediaKind,
    state: asset.state,
    productionEligible: asset.productionEligible,
    referenceType: asset.referenceType,
    approvalStatus: asset.approvalStatus,
    origin: asset.origin,
    flowId: asset.flowId,
    nodeId: asset.nodeId,
    sourceFacts: asset.sourceFacts,
    selected: selected.has(asset.assetId),
    analysisEvidence: (context.mediaUnderstanding ?? []).filter((item) => item.referenceId === asset.assetId),
    analysisDiagnostics: (context.mediaUnderstandingDiagnostics ?? []).filter((item) => item.referenceId === asset.assetId),
    updatedAt: asset.updatedAt,
  }));
}

export function workflowProjectImageCandidateInstruction(context: WorkflowProjectContext | null, allowedRoles: readonly string[]): string {
  if (!context || allowedRoles.length === 0) return "";
  return [
    "当前冻结作用域内可引用的图片身份目录；详情通过 frozenAssetRead 按精确 assetIds 读取；selected 仅表示显式选择，mediaKind 表示真实媒体类型。existingAssetId 必须属于此许可集合，existingProjectId 必须等于当前 projectId。",
    JSON.stringify({ projectId: context.projectId, canvasId: context.canvasId,
      selectedAssetIds: context.selectedAssetIds, candidates: workflowProjectImageCatalog(context) }),
  ].join("\n");
}

/** Complete identity directory; details remain available in the frozen snapshot. */
export function workflowProjectImageCatalog(context: WorkflowProjectContext) {
  return workflowProjectImageCandidates(context).map((asset) => ({
    assetId: asset.assetId,
    name: asset.name,
    canonicalName: asset.canonicalName,
    kind: asset.kind,
    mediaKind: asset.mediaKind,
    selected: asset.selected,
    physicalIdentityKey: asset.sourceFacts.physicalIdentityKey,
  }));
}

/** Exact IDs only: no semantic filtering, live enrichment, or partial success. */
export function readWorkflowProjectImageFacts(context: WorkflowProjectContext, assetIds: readonly string[]) {
  if (assetIds.length === 0 || new Set(assetIds).size !== assetIds.length) {
    throw new Error("workflow_asset_read_ids_invalid");
  }
  const candidates = new Map(workflowProjectImageCandidates(context).map((asset) => [asset.assetId, asset]));
  return assetIds.map((assetId) => {
    const asset = candidates.get(assetId);
    if (!asset) throw new Error("workflow_asset_not_in_frozen_catalog");
    return asset;
  });
}
