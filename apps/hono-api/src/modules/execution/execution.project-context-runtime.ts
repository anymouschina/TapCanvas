import { AppError } from "../../middleware/error";
import type { AppContext } from "../../types";
import { getPrismaClient } from "../../platform/node/prisma";
import { getFlowForOwner } from "../flow/flow.repo";
import { loadChapterCanvasAsFlowRow } from "../task/agents-tool-bridge.chapter-canvas-write";
import {
	listMaterialAssetsForOwner,
	listProjectNodeAssetsForOwner,
} from "../material/material.service";
import type { MaterialAssetDto } from "../material/material.schemas";
import { getAssetByIdForUser } from "../asset/asset.repo";
import {
	extractObjectStorageObjectKey,
	resolveObjectStorageConfig,
} from "../asset/rustfs.client";
import { createWorkflowAssetResolver, type WorkflowAssetResolver } from "./execution.asset-resolver";
import {
	createWorkflowCallerCanvasSnapshot,
	createWorkflowProjectContext,
	type WorkflowCallerCanvasSnapshot,
	type WorkflowProjectContext,
} from "./execution.project-context";

function readStrings(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return [...new Set(value.flatMap((item) => typeof item === "string" && item.trim() ? [item.trim()] : []))];
}

function readRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? value as Record<string, unknown>
		: null;
}

export function readWorkflowCanonicalSourceNodeId(canvasData: unknown): string | null {
	let parsed = canvasData;
	if (typeof canvasData === "string") {
		try {
			parsed = JSON.parse(canvasData) as unknown;
		} catch (error: unknown) {
			throw new Error(`Canvas data is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	const record = readRecord(parsed);
	const nodes = Array.isArray(record?.nodes) ? record.nodes : [];
	const canonicalIds = nodes.flatMap((candidate) => {
		const node = readRecord(candidate);
		const data = readRecord(node?.data);
		const id = typeof node?.id === "string" ? node.id.trim() : "";
		return id && data?.workflowCanonicalSource === true ? [id] : [];
	});
	if (canonicalIds.length > 1) {
		throw new Error(`Canvas declares multiple workflow canonical source nodes: ${canonicalIds.join(", ")}`);
	}
	return canonicalIds[0] ?? null;
}

function mergeAssets(...collections: readonly (readonly MaterialAssetDto[])[]): MaterialAssetDto[] {
	const byId = new Map<string, MaterialAssetDto>();
	for (const collection of collections) {
		for (const asset of collection) byId.set(asset.id, asset);
	}
	return [...byId.values()];
}

function selectedGeneratedAssetAsMaterialAsset(
	row: Awaited<ReturnType<typeof getAssetByIdForUser>>,
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

function refreshInternalAssetUrls(asset: MaterialAssetDto, env: AppContext["env"]): MaterialAssetDto {
	const data = asset.latestVersion?.data;
	if (!data) return asset;
	let storage: ReturnType<typeof resolveObjectStorageConfig>;
	try {
		storage = resolveObjectStorageConfig(env);
	} catch {
		return asset;
	}
	if (!storage?.publicBase) return asset;
	const publicBase = storage.publicBase.replace(/\/+$/u, "");
	let rewritten = false;
	const visit = (value: unknown): unknown => {
		if (typeof value === "string") {
			const key = extractObjectStorageObjectKey(storage, value);
			if (!key) return value;
			const stableUrl = `${publicBase}/${key}`;
			if (stableUrl !== value) rewritten = true;
			return stableUrl;
		}
		if (Array.isArray(value)) return value.map(visit);
		if (!value || typeof value !== "object") return value;
		return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, visit(entry)]));
	};
	const refreshedData = visit(data) as Record<string, unknown>;
	if (!rewritten) return asset;
	delete refreshedData.urlExpiresAt;
	delete refreshedData.expiresAt;
	delete refreshedData.signedUrlExpiresAt;
	return {
		...asset,
		latestVersion: asset.latestVersion
			? { ...asset.latestVersion, data: refreshedData }
			: asset.latestVersion,
	};
}

export async function loadVisibleWorkflowProjectAssets(
	c: AppContext,
	ownerId: string,
	projectId: string,
): Promise<MaterialAssetDto[]> {
	const [projectNodes, materials] = await Promise.all([
		listProjectNodeAssetsForOwner(c, ownerId, { projectId }),
		listMaterialAssetsForOwner(c, ownerId, { projectId }),
	]);
	return mergeAssets(projectNodes, materials).filter((asset) => asset.projectId === projectId);
}

export async function enrichRuntimeWorkflowProjectAssets(input: Readonly<{
	visibleAssets: readonly MaterialAssetDto[];
	frozenAssetIds: readonly string[];
	loadFrozenGeneratedAsset: (assetId: string) => Promise<MaterialAssetDto | null>;
}>): Promise<MaterialAssetDto[]> {
	const visibleIds = new Set(input.visibleAssets.map((asset) => asset.id));
	const frozenGeneratedAssets = await Promise.all(input.frozenAssetIds.map(async (assetId) => (
		visibleIds.has(assetId) ? null : input.loadFrozenGeneratedAsset(assetId)
	)));
	return mergeAssets(
		input.visibleAssets,
		frozenGeneratedAssets.filter((asset): asset is MaterialAssetDto => asset !== null),
	);
}

async function loadRuntimeWorkflowProjectAssets(input: Readonly<{
	c: AppContext;
	ownerId: string;
	context: WorkflowProjectContext;
}>): Promise<MaterialAssetDto[]> {
	const visibleAssets = await loadVisibleWorkflowProjectAssets(
		input.c,
		input.ownerId,
		input.context.projectId,
	);
	return enrichRuntimeWorkflowProjectAssets({
		visibleAssets,
		frozenAssetIds: input.context.projectAssetIds,
		loadFrozenGeneratedAsset: async (assetId) => selectedGeneratedAssetAsMaterialAsset(
			await getAssetByIdForUser(getPrismaClient(), assetId, input.ownerId),
			input.context.projectId,
		),
	});
}

export async function buildWorkflowProjectContextForRun(input: Readonly<{
	c: AppContext;
	ownerId: string;
	projectId: string;
	canvasId: string;
	chapterId?: string | null;
	activeNodeId?: string | null;
	triggerPayload?: Record<string, unknown>;
	now?: Date;
}>): Promise<Readonly<{
	projectContext: WorkflowProjectContext;
	callerCanvasSnapshot: WorkflowCallerCanvasSnapshot;
}>> {
	const chapterId = input.chapterId?.trim() || "";
	const canvas = chapterId
		? await loadChapterCanvasAsFlowRow(input.c, input.ownerId, chapterId, input.projectId)
		: await getFlowForOwner(input.c.env.DB, input.canvasId, input.ownerId);
	if (!canvas || canvas.project_id !== input.projectId) {
		throw new AppError("Caller canvas is not available in the requested project", {
			status: 404,
			code: "workflow_project_context_canvas_not_found",
			details: {
				projectId: input.projectId,
				canvasId: input.canvasId,
				...(chapterId ? { chapterId } : {}),
			},
		});
	}
	const payload = input.triggerPayload ?? {};
	const assets = await loadVisibleWorkflowProjectAssets(input.c, input.ownerId, input.projectId);
	const selectedAssetIds = readStrings(payload.selectedAssetIds);
	const selectedGeneratedAssets = await Promise.all(selectedAssetIds.map(async (assetId) => {
		if (assets.some((asset) => asset.id === assetId)) return null;
		return selectedGeneratedAssetAsMaterialAsset(
			await getAssetByIdForUser(getPrismaClient(), assetId, input.ownerId),
			input.projectId,
		);
	}));
	const enrichedAssets = mergeAssets(assets, selectedGeneratedAssets.filter((asset): asset is MaterialAssetDto => asset !== null));
	const projectContext = createWorkflowProjectContext({
		projectId: input.projectId,
		// Project-node asset snapshots identify chapter canvases with a canonical
		// `chapter:<id>` identity. Keep that identity in the frozen context while
		// delivery uses the raw chapter id required by chapters.canvas_flow.
		canvasId: chapterId ? `chapter:${chapterId}` : input.canvasId,
		// ChapterService always maintains this locked canonical seed node as the
		// chapter's single narrative source. Derived script/look-bible text nodes
		// remain visible project assets, but cannot replace the chapter source by
		// accident when a workflow is launched without a canvas selection.
		sourceNodeId: chapterId
			? `chapter-seed-${chapterId}`
			: readWorkflowCanonicalSourceNodeId(canvas.data),
		principalId: input.ownerId,
		canvasData: canvas.data,
		assets: enrichedAssets,
		selectedAssetIds,
		selectedNodeIds: readStrings(payload.selectedNodeIds),
		activeNodeId: input.activeNodeId ?? null,
		groupId: typeof payload.sourceGroupId === "string" ? payload.sourceGroupId : null,
		assetWrite: true,
		...(input.now ? { now: input.now } : {}),
	});
	return {
		projectContext,
		callerCanvasSnapshot: createWorkflowCallerCanvasSnapshot(canvas.data),
	};
}

export function createRuntimeWorkflowAssetResolver(input: Readonly<{
	c: AppContext;
	ownerId: string;
	context: WorkflowProjectContext;
}>): WorkflowAssetResolver {
	// The context-build boundary can freeze explicitly selected generation-table
	// assets that are not projected by the material/project-node listings. Rebuild
	// the same authorized projection at execution time so an existingAssetId does
	// not become an artificial "not found" after it was accepted into the snapshot.
	const load = () => loadRuntimeWorkflowProjectAssets(input);
	return createWorkflowAssetResolver({
		context: input.context,
		loadVisibleAssets: load,
		refreshAsset: async (assetId) => {
			const asset = (await load()).find((candidate) => candidate.id === assetId) ?? null;
			return asset ? refreshInternalAssetUrls(asset, input.c.env) : null;
		},
	});
}
