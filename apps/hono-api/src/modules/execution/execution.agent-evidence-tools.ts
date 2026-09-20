import type { WorkflowProjectContext, WorkflowProjectAssetSnapshot } from "./execution.project-context";

type MediaEvidenceContext = Pick<WorkflowProjectContext, "projectId" | "canvasId" | "projectAssetIds"> & {
	assetSnapshot: readonly Pick<WorkflowProjectAssetSnapshot, "assetId" | "projectId" | "state" | "mediaKind" | "nodeId" | "flowId">[];
};

/** Expose evidence capabilities from frozen facts; never select or analyze media here. */
export function workflowAgentMediaEvidenceTools(
	projectContext: MediaEvidenceContext | null | undefined,
): string[] {
	if (!projectContext) return [];
	const visibleIds = new Set(projectContext.projectAssetIds);
	const readyMedia = projectContext.assetSnapshot.filter((asset) => (
		asset.projectId === projectContext.projectId
		&& visibleIds.has(asset.assetId)
		&& asset.state === "ready"
	));
	const tools: string[] = [];
	if (readyMedia.some((asset) => asset.mediaKind === "image")) {
		tools.push("tapcanvas_image_refs_get", "tapcanvas_analyze_image");
	}
	// Video analysis accepts a node in the authorized canvas, not a material ID.
	if (readyMedia.some((asset) => (
		asset.mediaKind === "video" && asset.nodeId !== null
		&& asset.flowId === projectContext.canvasId
	))) {
		tools.push("tapcanvas_analyze_video");
	}
	return tools;
}
