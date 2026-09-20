import { projectCanvasMembership } from "@tapcanvas/workflow-kernel-protocol";
import { AppError } from "../../middleware/error";
import type { AppContext } from "../../types";
import { getPrismaClient } from "../../platform/node/prisma";
import { getFlowForOwner } from "../flow/flow.repo";
import { loadChapterWorkflowSource } from "../chapter/chapter.workflow-source";
import { projectNodeAssetsFromCanvases } from "../material/material.project-node-assets";
import {
	listMaterialAssetsForOwner,
} from "../material/material.service";
import { loadProjectCanvasAssetScopeForOwner } from "../material/material.project-node-assets.service";
import { isDeprecatedCanvasAsset, type CanvasDeprecationScope } from "../material/material.canvas-visibility";
import {
	readCanvasIndexStyleImages,
	readCanvasIndexStyleLock,
	type CanvasIndexStyleLock,
} from "../material/material.repo";
import { getActiveProjectLookBible } from "../material/project-look-bible";
import { getProjectBookStyleFacts } from "../agents/project-context.service";
import {
	buildProjectStyleProvenance,
	styleLockFromProjectLookBible,
	resolveProjectStyleAnchorSources,
} from "../task/authoring-style-provenance";
import type { MaterialAssetDto } from "../material/material.schemas";
import { getAssetByIdForUser } from "../asset/asset.repo";
import {
	extractObjectStorageObjectKey,
	resolveObjectStorageConfig,
} from "../asset/rustfs.client";
import { createWorkflowAssetResolver, type WorkflowAssetResolver } from "./execution.asset-resolver";
import { enrichWorkflowMediaUnderstanding } from "./execution.media-understanding";
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

/**
 * Project Look Bible is the durable, structured source for a project's visual
 * language.  Older projects may not have a canvas-index styleLock yet; in that
 * case the active Look Bible must still become the frozen run-level style lock
 * before any image/video executor is scheduled.  This is a fact projection, not
 * a semantic default: the values below are copied from the already-confirmed
 * Look Bible and are never invented by the API.
 */
export function styleLockFromActiveLookBible(
	active: Awaited<ReturnType<typeof getActiveProjectLookBible>>,
): CanvasIndexStyleLock | null {
	return styleLockFromProjectLookBible(active);
}

/**
 * Project a caller-supplied, already-authored style fact bundle into the
 * run-scoped style lock. This is intentionally a structural projection: the
 * Agent owns the meaning, while the API only copies bounded strings and gives
 * every media node one immutable fingerprint for this execution.
 */
export function styleLockFromTriggerFacts(value: unknown): CanvasIndexStyleLock | null {
	return resolveProjectStyleAnchorSources({
		canvasStyleReferenceImages: [],
		canvasStyleLock: null,
		activeLookBible: null,
		triggerStyleFacts: value,
		bookStyleFacts: null,
	}).styleLock;
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
	const record = readRecord(projectCanvasMembership(parsed));
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

export function selectedGeneratedAssetAsMaterialAsset(
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
	return (await loadWorkflowProjectAssetScope(c, ownerId, projectId)).assets;
}

async function loadWorkflowProjectAssetScope(c: AppContext, ownerId: string, projectId: string): Promise<{
	assets: MaterialAssetDto[];
	deprecation: CanvasDeprecationScope;
}> {
	const [scope, materials] = await Promise.all([
		loadProjectCanvasAssetScopeForOwner(c, ownerId, { projectId }),
		listMaterialAssetsForOwner(c, ownerId, { projectId }),
	]);
	// 画布删除=废弃：设定库副本与 generation 资产行都不销毁，但不得再被召回。
	const excluded = materials.filter((asset) => isDeprecatedCanvasAsset(asset, scope.deprecation));
	if (excluded.length) console.info(JSON.stringify({ event: "workflow_deleted_materials_excluded", projectId,
		assetIds: excluded.map((asset) => asset.id) }));
	return { assets: mergeAssets(scope.assets, materials.filter((asset) => !isDeprecatedCanvasAsset(asset, scope.deprecation)))
		.filter((asset) => asset.projectId === projectId), deprecation: scope.deprecation };
}

export async function enrichRuntimeWorkflowProjectAssets(input: Readonly<{
	visibleAssets: readonly MaterialAssetDto[];
	frozenAssetIds: readonly string[];
	loadFrozenGeneratedAsset: (assetId: string) => Promise<MaterialAssetDto | null>;
	deprecation?: CanvasDeprecationScope;
}>): Promise<MaterialAssetDto[]> {
	const visibleIds = new Set(input.visibleAssets.map((asset) => asset.id));
	const frozenGeneratedAssets = await Promise.all(input.frozenAssetIds.map(async (assetId) => (
		visibleIds.has(assetId) ? null : input.loadFrozenGeneratedAsset(assetId)
	)));
	return mergeAssets(
		input.visibleAssets,
		frozenGeneratedAssets.filter((asset): asset is MaterialAssetDto => asset !== null),
	).filter((asset) => !input.deprecation || !isDeprecatedCanvasAsset(asset, input.deprecation));
}

async function loadRuntimeWorkflowProjectAssets(input: Readonly<{
	c: AppContext;
	ownerId: string;
	context: WorkflowProjectContext;
}>): Promise<MaterialAssetDto[]> {
	const scope = await loadWorkflowProjectAssetScope(
		input.c,
		input.ownerId,
		input.context.projectId,
	);
	return enrichRuntimeWorkflowProjectAssets({
		visibleAssets: scope.assets,
		deprecation: scope.deprecation,
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
	const chapterSource = chapterId
		? await loadChapterWorkflowSource(input.c, input.ownerId, input.projectId, chapterId) : null;
	const canvas = chapterSource
		? { data: JSON.stringify(chapterSource.flow), project_id: chapterSource.chapter.projectId }
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
	const scope = await loadWorkflowProjectAssetScope(input.c, input.ownerId, input.projectId);
	// Derive chapter assets from the exact source snapshot, never a second live
	// canvas read that can race the browser's initial seed save.
	const assets = chapterSource ? [
		...scope.assets.filter((asset) => asset.origin?.flowId !== `chapter:${chapterId}`),
		...projectNodeAssetsFromCanvases([{ projectId: input.projectId, ownerType: "chapter",
			ownerId: chapterId, flowId: `chapter:${chapterId}`, ownerLabel: chapterSource.chapter.title,
			data: chapterSource.flow, canvasRevision: chapterSource.revision,
			createdAt: chapterSource.chapter.createdAt, updatedAt: chapterSource.chapter.updatedAt }]),
	] : scope.assets;
	const selectedAssetIds = readStrings(payload.selectedAssetIds);
	const selectedGeneratedAssets = await Promise.all(selectedAssetIds.map(async (assetId) => {
		if (assets.some((asset) => asset.id === assetId)) return null;
		// 显式选中的资产也必须服从画布删除台账：已废弃的资产不得借 selectedAssetIds 复活。
		const candidate = selectedGeneratedAssetAsMaterialAsset(
			await getAssetByIdForUser(getPrismaClient(), assetId, input.ownerId),
			input.projectId,
		);
		if (!candidate) return null;
		if (isDeprecatedCanvasAsset(candidate, scope.deprecation)) {
			console.info(JSON.stringify({ event: "workflow_deprecated_selected_asset_excluded", projectId: input.projectId,
				assetId, reason: "canvas_node_deleted" }));
			return null;
		}
		return candidate;
	}));
	const enrichedAssets = mergeAssets(assets, selectedGeneratedAssets.filter((asset): asset is MaterialAssetDto => asset !== null))
		.filter((asset) => !isDeprecatedCanvasAsset(asset, scope.deprecation));
	const [canvasStyleReferenceImages, canvasStyleLock, activeLookBible, bookStyleFacts] = await Promise.all([
		readCanvasIndexStyleImages(input.projectId, input.ownerId),
		readCanvasIndexStyleLock(input.projectId, input.ownerId),
		getActiveProjectLookBible({ ownerId: input.ownerId, projectId: input.projectId }),
		getProjectBookStyleFacts({ ownerId: input.ownerId, projectId: input.projectId }),
	]);
	const styleSources = resolveProjectStyleAnchorSources({
		canvasStyleReferenceImages,
		canvasStyleLock,
		activeLookBible,
		triggerStyleFacts: payload.styleFacts,
		bookStyleFacts,
	});
	const styleProvenance = buildProjectStyleProvenance({
		styleReferenceImages: styleSources.styleReferenceImages,
		styleLock: styleSources.styleLock,
	});
	const projectContext = createWorkflowProjectContext({
		projectId: input.projectId,
		// Project-node asset snapshots identify chapter canvases with a canonical
		// `chapter:<id>` identity. Keep that identity in the frozen context while
		// delivery uses the raw chapter id required by chapters.canvas_flow.
		canvasId: chapterId ? `chapter:${chapterId}` : input.canvasId,
		// The server projects chapter authority before freezing both the source
		// node and its asset descriptor, independently of browser initialization.
		sourceNodeId: chapterId
			? `chapter-seed-${chapterId}`
			: readWorkflowCanonicalSourceNodeId(canvas.data),
		principalId: input.ownerId,
		canvasData: canvas.data,
		assets: enrichedAssets,
		visualStyle: {
			referenceImages: styleProvenance.styleReferenceImages,
			styleLock: styleSources.styleLock,
			styleFingerprint: styleProvenance.styleFingerprint,
		},
		selectedAssetIds,
		selectedNodeIds: readStrings(payload.selectedNodeIds),
		activeNodeId: input.activeNodeId ?? null,
		groupId: typeof payload.sourceGroupId === "string" ? payload.sourceGroupId : null,
		assetWrite: true,
		...(input.now ? { now: input.now } : {}),
	});
	const acceptedAssetIds = new Set(projectContext.selectedAssetIds);
	console.info(JSON.stringify({ event: "workflow_asset_selection_frozen", projectId: input.projectId,
		canvasId: input.canvasId, requestedAssetIds: selectedAssetIds,
		selectedAssetIds: projectContext.selectedAssetIds,
		unresolvedAssetIds: selectedAssetIds.filter((id) => !acceptedAssetIds.has(id)),
	}));
	return {
		projectContext: await enrichWorkflowMediaUnderstanding({ c: input.c, ownerId: input.ownerId,
			context: projectContext, resolver: createWorkflowAssetResolver({ context: projectContext,
				loadVisibleAssets: async () => enrichedAssets }) }),
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
