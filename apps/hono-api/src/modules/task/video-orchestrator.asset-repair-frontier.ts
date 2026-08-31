import type { VideoAssetRepairDeclaration } from "./video-orchestrator.asset-repair";

function assetUnitId(asset: {
  kind: string;
  name: string;
  stateVersionId?: string;
  stateKey?: string;
}): string {
  const base = `asset:${asset.kind}:${asset.name}`;
  return asset.stateVersionId && asset.stateKey
    ? `${base}:${asset.stateVersionId}:${asset.stateKey}`
    : base;
}

export const VIDEO_ASSET_REPAIR_SUPPORTING_TOOLS = [
  "tapcanvas_image_generate_to_canvas",
  "tapcanvas_image_reconcile",
] as const;

export function withVideoAssetRepairSupportingTools(value: unknown): Record<string, unknown> {
  const cursor = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return {
    ...cursor,
    allowedSupportingTools: [...VIDEO_ASSET_REPAIR_SUPPORTING_TOOLS],
  };
}

export function buildVideoAssetRepairProgressCursor(
  declaration: VideoAssetRepairDeclaration,
): Record<string, unknown> {
  const progress = declaration.progress ?? {
    revision: 0,
    totalCount: declaration.requiredAssets.length,
    resolvedBindings: [],
  };
  return withVideoAssetRepairSupportingTools({
    version: 1,
    graph: "video_authoring",
    scopeId: `${declaration.runId}:asset_repair`,
    phase: "asset_repair",
    revision: String(progress.revision),
    executionGeneration: declaration.executionGeneration,
    completedUnitIds: progress.resolvedBindings.map(
      assetUnitId,
    ),
    pendingUnitIds: declaration.requiredAssets.map(
      assetUnitId,
    ),
    allowedNextActions: ["repair_assets"],
    requiredReadActions: [],
  });
}
