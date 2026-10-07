import type { AssetRow } from "../asset/asset.repo";
import type { MaterialAssetDto } from "../material/material.schemas";
import { isDeprecatedCanvasAsset, type CanvasDeprecationScope } from "../material/material.canvas-visibility";
import { assertWorkflowAssetResourcesCurrent } from "./execution.asset-resolver";
import { WorkflowReplayInvocationError } from "./execution.replay-invocation";

export function selectedGeneratedAssetAsMaterialAsset(
	row: AssetRow | null,
	projectId: string,
): MaterialAssetDto | null {
	if (!row || row.project_id !== projectId || typeof row.data !== "string") return null;
	let data: Record<string, unknown>;
	try {
		const parsed = JSON.parse(row.data) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
		data = parsed as Record<string, unknown>;
	} catch {
		return null;
	}
	const mediaType = typeof data.type === "string" ? data.type.trim() : "";
	if (mediaType !== "image") return null;
	const generatedUrl = typeof data.url === "string" ? data.url.trim() : "";
	if (!generatedUrl) return null;
	const normalizedData: Record<string, unknown> = {
		...data,
		imageUrl: typeof data.imageUrl === "string" && data.imageUrl.trim() ? data.imageUrl : generatedUrl,
		imageResults: Array.isArray(data.imageResults) ? data.imageResults : [{ url: generatedUrl }],
	};
	const roleType = typeof data.referenceType === "string" ? data.referenceType.trim() : "";
	const kind = roleType === "character" || roleType === "scene" || roleType === "prop" ? roleType : "text";
	return {
		id: row.id,
		projectId,
		teamId: null,
		folderId: null,
		scope: "project",
		kind,
		name: row.name,
		favorite: false,
		currentVersion: 1,
		latestVersion: {
			id: `${row.id}:generation`,
			assetId: row.id,
			projectId,
			version: 1,
			data: normalizedData,
			note: null,
			createdAt: row.created_at,
		},
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

/** Exact IDs are two explicit identity sources, never names, content matches, or substituted handles. */
export async function resolveExplicitWorkflowAssets(input: Readonly<{
	ownerId: string;
	projectId: string;
	assetIds: readonly string[];
	candidates: readonly MaterialAssetDto[];
	deprecation: CanvasDeprecationScope;
	loadGeneratedAsset: (assetId: string, ownerId: string) => Promise<AssetRow | null>;
	now?: Date;
}>): Promise<MaterialAssetDto[]> {
	return Promise.all([...new Set(input.assetIds)].map(async (assetId) => {
		const candidates = input.candidates.filter(asset => asset.id === assetId);
		const row = await input.loadGeneratedAsset(assetId, input.ownerId);
		if (candidates.some(asset => asset.projectId !== input.projectId)
			|| (row && (row.id !== assetId || row.owner_id !== input.ownerId || row.project_id !== input.projectId))) {
			throw new WorkflowReplayInvocationError(`workflow_replay_asset_forbidden:${assetId}`);
		}
		const generated = selectedGeneratedAssetAsMaterialAsset(row, input.projectId);
		if (row && !generated) throw new WorkflowReplayInvocationError(`workflow_replay_asset_invalid:${assetId}`);
		const matches = [...candidates, ...(generated ? [generated] : [])];
		if (matches.length > 1) throw new WorkflowReplayInvocationError(`workflow_replay_asset_identity_conflict:${assetId}`);
		const asset = matches[0];
		if (!asset) throw new WorkflowReplayInvocationError(`workflow_replay_asset_not_visible:${assetId}`);
		if (isDeprecatedCanvasAsset(asset, input.deprecation)) {
			throw new WorkflowReplayInvocationError(`workflow_replay_asset_deprecated:${assetId}`);
		}
		try { assertWorkflowAssetResourcesCurrent(asset, input.now ?? new Date()); }
		catch (error: unknown) {
			const reason = error instanceof Error ? error.message : "Invalid asset resource";
			throw new WorkflowReplayInvocationError(`workflow_replay_asset_resource_unavailable:${assetId}: ${reason}`);
		}
		return asset;
	}));
}
