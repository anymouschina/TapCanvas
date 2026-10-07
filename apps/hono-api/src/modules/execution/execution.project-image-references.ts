import { isWorkflowProjectImageReady, type WorkflowProjectContext } from "./execution.project-context";

export function frozenReadyProjectImages(context: WorkflowProjectContext) {
	const visible = new Set(context.projectAssetIds);
	return context.assetSnapshot.filter(asset => asset.projectId === context.projectId
		&& visible.has(asset.assetId)
		&& isWorkflowProjectImageReady(asset)
		&& typeof asset.sourceFacts.mediaIdentityKey === "string"
		&& asset.sourceFacts.mediaIdentityKey.trim().length > 0);
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
			// Keep this action's exact failure evidence. Discovery remains an
			// on-demand read and never expands the entire permission catalog here.
			throw new Error(`assetId=${id} outside the frozen ready production image set; use frozenAssetMatch (tapcanvas_workflow_execution_inspect view=asset_match) to obtain exact allowed asset IDs when that read capability is available; preserve selectedAssetIds=${JSON.stringify(context.selectedAssetIds)}; current canvasId=${context.canvasId}`);
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
