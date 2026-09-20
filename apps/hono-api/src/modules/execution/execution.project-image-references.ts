import { isWorkflowProjectImageReady, type WorkflowProjectContext } from "./execution.project-context";

export function frozenReadyProjectImages(context: WorkflowProjectContext) {
  const visible = new Set(context.projectAssetIds);
  return context.assetSnapshot.filter(asset => asset.projectId === context.projectId
    && visible.has(asset.assetId) && isWorkflowProjectImageReady(asset));
}

/** Resolve only explicit handles in the frozen scope; never match display names. */
export function resolveWorkflowProjectImageReferences(
	contract: Readonly<Record<string, unknown>>,
	context: WorkflowProjectContext,
): string[] {
	const readIds = (value: unknown, field: string): string[] => {
		if (value === undefined) return [];
		if (!Array.isArray(value) || value.some((id) => typeof id !== "string" || !id.trim())) {
			throw new Error(`${field} must be an array of non-empty IDs`);
		}
		return value.map((id: string) => id.trim());
	};
	const ready = frozenReadyProjectImages(context);
	const byId = new Map(ready.map((asset) => [asset.assetId, asset]));
	const ids = readIds(contract.referenceAssetIds, "referenceAssetIds");
	for (const id of ids) {
		if (!byId.has(id)) {
			// The isolated author receives this correction without the original
			// conversation. Include exact frozen handles so it can repair an ID
			// without guessing aliases, dropping images, or issuing a new task.
			throw new Error(`assetId=${id} outside the frozen ready production image set; frozen reference handles=${JSON.stringify(ready.map((asset) => ({
				assetId: asset.assetId, nodeId: asset.nodeId, flowId: asset.flowId,
			})))}; preserve selectedAssetIds=${JSON.stringify(context.selectedAssetIds)}; current canvasId=${context.canvasId}`);
		}
	}
	for (const nodeId of readIds(contract.referenceImageNodeIds, "referenceImageNodeIds")) {
		const matches = ready.filter((asset) => asset.flowId === context.canvasId && asset.nodeId === nodeId);
		if (matches.length !== 1) {
			throw new Error(`referenceImageNodeIds nodeId=${nodeId} requires exactly one ready image in canvasId=${context.canvasId}; found ${matches.length}`);
		}
		ids.push(matches[0]!.assetId);
	}
	return [...new Set(ids)];
}

export type WorkflowReusableAssetReference = Readonly<{
	planAssetId?: string;
	existingAssetId?: string;
	existingProjectId?: string;
	existingNodeId?: string;
	existingImageUrl?: string;
}>;

export type WorkflowReusableAssetRoleFacts = Readonly<Record<string, readonly WorkflowReusableAssetReference[]>>;

