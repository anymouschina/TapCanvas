import type { MaterialAssetDto } from "../material/material.schemas";
import { workflowAssetContentFingerprint } from "./execution.asset-content-fingerprint";

export const WORKFLOW_PROJECT_CONTEXT_VERSION = 3 as const;

export type WorkflowCallerCanvasSnapshot = Readonly<{
	nodes: readonly unknown[];
	edges: readonly unknown[];
	viewport?: Readonly<{
		x: number;
		y: number;
		zoom: number;
	}>;
}>;

export type WorkflowProjectAssetSnapshot = Readonly<{
	assetId: string;
	assetVersion: number;
	assetVersionId: string;
	/** Stable content identity for projected project-node assets. */
	contentFingerprint: string;
	projectId: string;
	name: string;
	canonicalName: string;
	kind: string;
	referenceType: string | null;
	approvalStatus: string | null;
	origin: "project_node" | "material";
	flowId: string | null;
	nodeId: string | null;
	mediaKind: "image" | "video" | "audio" | "text" | "unknown";
	state: "ready" | "transcoding" | "deleted" | "unavailable";
	assetUsage: "production" | "preview_only" | null;
	assetPurpose: "story_preview" | null;
	productionEligible: boolean;
	productionExclusionReason: "legacy_untyped_workflow_image" | null;
	/**
	 * Compact, source-preserving metadata for every visible asset. This is copied
	 * from the persisted payload without semantic reinterpretation so the Agent
	 * can compare ready project-image identities in its one-shot planning phase.
	 */
	sourceFacts: Readonly<{
		referenceType: string | null;
		roleName: string | null;
		physicalIdentityKey: string | null;
		characterAssetRole: string | null;
		characterProfileVersion: string | null;
		identityAnchors: readonly string[];
		prohibitedDrift: readonly string[];
		sourceNodeId: string | null;
		workflowExecutionId: string | null;
		taskId: string | null;
		prompt: string | null;
	}>;
	updatedAt: string;
}>;

export type WorkflowProjectContext = Readonly<{
	version: typeof WORKFLOW_PROJECT_CONTEXT_VERSION;
	projectId: string;
	canvasId: string;
	/** Canonical story source for this canvas scope; null for a free-form project canvas. */
	sourceNodeId: string | null;
	selectedAssetIds: readonly string[];
	projectAssetIds: readonly string[];
	timeline: Readonly<{
		clips: readonly Readonly<{
			nodeId: string;
			assetId: string | null;
			durationSeconds: number | null;
			startSeconds: number | null;
		}>[];
	}>;
	selection: Readonly<{
		nodeIds: readonly string[];
		assetIds: readonly string[];
		activeNodeId: string | null;
		groupId: string | null;
	}>;
	permissions: Readonly<{
		principalId: string;
		projectRead: true;
		canvasRead: true;
		assetRead: true;
		assetWrite: boolean;
	}>;
	assetSnapshot: readonly WorkflowProjectAssetSnapshot[];
	capturedAt: string;
}>;

/**
 * Only a ready, production-eligible image can be used as a visual workflow
 * reference.  Text nodes and planned/draft image nodes remain visible to the
 * server-side snapshot for diagnostics, but never become selected visual
 * inputs or reusable image identities.
 */
export function isWorkflowProjectImageReady(
	asset: Pick<WorkflowProjectAssetSnapshot, "mediaKind" | "state" | "productionEligible">,
): boolean {
	return asset.mediaKind === "image" && asset.state === "ready" && asset.productionEligible;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function uniqueStrings(values: readonly unknown[]): string[] {
	return [...new Set(values.flatMap((value) => {
		const text = readString(value);
		return text ? [text] : [];
	}))];
}

function assetMediaState(asset: MaterialAssetDto): Pick<WorkflowProjectAssetSnapshot, "mediaKind" | "state"> {
	const data = asset.latestVersion?.data;
	if (!data) return { mediaKind: "unknown", state: "deleted" };
	const status = readString(data.status) || readString(data.transcodeStatus) || readString(data.processingStatus);
	const approvalStatus = readString(data.approvalStatus);
	const unavailable = data.deleted === true
		|| status === "deleted"
		|| status === "rejected"
		|| status === "failed"
		|| approvalStatus === "rejected";
	if (unavailable) return { mediaKind: "unknown", state: status === "deleted" || data.deleted === true ? "deleted" : "unavailable" };
	const pending = status === "pending" || status === "processing" || status === "transcoding";
	const mediaKind = readString(data.videoUrl) || Array.isArray(data.videoResults)
		? "video"
		: readString(data.imageUrl) || Array.isArray(data.imageResults)
			? "image"
			: readString(data.audioUrl)
				? "audio"
				: asset.kind === "text" ? "text" : "unknown";
	return { mediaKind, state: pending ? "transcoding" : "ready" };
}

export function projectAssetSnapshot(asset: MaterialAssetDto): WorkflowProjectAssetSnapshot {
	const media = assetMediaState(asset);
	const data = asset.latestVersion?.data ?? {};
	const sourceFacts = {
		referenceType: readString(data.referenceType) || null,
		roleName: readString(data.canonicalName) || readString(data.roleName) || readString(data.characterName) || readString(data.sceneName) || readString(data.propName) || null,
		physicalIdentityKey: readString(data.physicalIdentityKey) || null,
		characterAssetRole: readString(data.characterAssetRole) || null,
		characterProfileVersion: readString(data.characterProfileVersion) || null,
		identityAnchors: uniqueStrings(Array.isArray(data.identityAnchors) ? data.identityAnchors : []),
		prohibitedDrift: uniqueStrings(Array.isArray(data.prohibitedDrift) ? data.prohibitedDrift : []),
		sourceNodeId: readString(data.nodeId) || asset.origin?.nodeId || null,
		workflowExecutionId: readString(data.workflowExecutionId) || null,
		taskId: readString(data.taskId) || null,
		prompt: readString(data.prompt) || null,
	} as const;
	const canonicalName = readString(data.canonicalName)
		|| readString(data.roleName)
		|| readString(data.characterName)
		|| readString(data.sceneName)
		|| readString(data.propName)
		|| asset.name.trim();
	return {
		assetId: asset.id,
		assetVersion: asset.currentVersion,
		assetVersionId: asset.latestVersion?.id ?? "",
		contentFingerprint: workflowAssetContentFingerprint(asset),
		projectId: asset.projectId,
		name: asset.name,
		canonicalName,
		kind: asset.kind,
		referenceType: readString(data.referenceType) || null,
		approvalStatus: readString(data.approvalStatus) || null,
		origin: asset.origin?.type === "project_node" ? "project_node" : "material",
		flowId: asset.origin?.flowId ?? null,
		nodeId: asset.origin?.nodeId ?? null,
		mediaKind: media.mediaKind,
		state: media.state,
		assetUsage: readString(data.assetUsage) === "preview_only"
			? "preview_only"
			: readString(data.assetUsage) === "production" ? "production" : null,
		assetPurpose: readString(data.assetPurpose) === "story_preview" ? "story_preview" : null,
		productionEligible:
			readString(data.assetUsage) !== "preview_only"
			&& readString(data.assetPurpose) !== "story_preview"
			&& data.productionEligible !== false,
		productionExclusionReason: null,
		sourceFacts,
		updatedAt: asset.updatedAt,
	};
}

function parseCanvasRoot(canvasData: unknown): Record<string, unknown> {
	if (typeof canvasData !== "string") return isRecord(canvasData) ? canvasData : {};
	try {
		const parsed = JSON.parse(canvasData) as unknown;
		return isRecord(parsed) ? parsed : {};
	} catch {
		return {};
	}
}

export function createWorkflowCallerCanvasSnapshot(canvasData: unknown): WorkflowCallerCanvasSnapshot {
	const root = parseCanvasRoot(canvasData);
	if (!Array.isArray(root.nodes) || !Array.isArray(root.edges)) {
		throw new Error("Caller canvas snapshot must contain nodes and edges arrays");
	}
	const viewport = isRecord(root.viewport)
		&& typeof root.viewport.x === "number"
		&& Number.isFinite(root.viewport.x)
		&& typeof root.viewport.y === "number"
		&& Number.isFinite(root.viewport.y)
		&& typeof root.viewport.zoom === "number"
		&& Number.isFinite(root.viewport.zoom)
		&& root.viewport.zoom > 0
		? {
			x: root.viewport.x,
			y: root.viewport.y,
			zoom: root.viewport.zoom,
		}
		: undefined;
	return {
		nodes: root.nodes,
		edges: root.edges,
		...(viewport ? { viewport } : {}),
	};
}

export function parseWorkflowCallerCanvasSnapshot(value: unknown): WorkflowCallerCanvasSnapshot | null {
	try {
		return createWorkflowCallerCanvasSnapshot(value);
	} catch {
		return null;
	}
}

function stableHttpResourceIdentity(value: unknown): string | null {
	const candidate = readString(value);
	if (!candidate) return null;
	try {
		const url = new URL(candidate);
		if (url.protocol !== "http:" && url.protocol !== "https:") return null;
		return `${url.protocol}//${url.host}${url.pathname}`;
	} catch {
		return null;
	}
}

function rejectedCanvasResourceIdentities(canvasData: unknown): ReadonlySet<string> {
	const root = parseCanvasRoot(canvasData);
	if (!Array.isArray(root.nodes)) return new Set();
	return new Set(root.nodes.flatMap((rawNode) => {
		if (!isRecord(rawNode) || !isRecord(rawNode.data)) return [];
		const urls = rawNode.data.providerRejectedUrls;
		if (!Array.isArray(urls)) return [];
		return urls.flatMap((url) => {
			const identity = stableHttpResourceIdentity(url);
			return identity ? [identity] : [];
		});
	}));
}

function rejectedCanvasReferenceIds(canvasData: unknown): ReadonlySet<string> {
	const root = parseCanvasRoot(canvasData);
	if (!Array.isArray(root.nodes)) return new Set();
	return new Set(root.nodes.flatMap((rawNode) => {
		if (!isRecord(rawNode) || !isRecord(rawNode.data)) return [];
		const ids = rawNode.data.providerRejectedReferenceIds;
		if (!Array.isArray(ids)) return [];
		return ids.flatMap((id) => {
			const normalized = readString(id);
			return normalized ? [normalized] : [];
		});
	}));
}

function assetImageResourceIdentities(asset: MaterialAssetDto): ReadonlySet<string> {
	const data = asset.latestVersion?.data;
	if (!data) return new Set();
	const resultUrls = Array.isArray(data.imageResults)
		? data.imageResults.flatMap((result) => isRecord(result) ? [result.url] : [])
		: [];
	return new Set([data.imageUrl, data.sourceUrl, ...resultUrls].flatMap((value) => {
		const identity = stableHttpResourceIdentity(value);
		return identity ? [identity] : [];
	}));
}

function applyProviderRejectionEvidence(
	asset: MaterialAssetDto,
	snapshot: WorkflowProjectAssetSnapshot,
	rejectedResourceIdentities: ReadonlySet<string>,
	rejectedReferenceIds: ReadonlySet<string>,
): WorkflowProjectAssetSnapshot {
	const rejected = rejectedReferenceIds.has(asset.id) || [...assetImageResourceIdentities(asset)]
		.some((identity) => rejectedResourceIdentities.has(identity));
	if (!rejected) return snapshot;
	return {
		...snapshot,
		approvalStatus: "rejected",
		state: "unavailable",
		productionEligible: false,
	};
}

function timelineClips(canvasData: unknown): WorkflowProjectContext["timeline"]["clips"] {
	const root = parseCanvasRoot(canvasData);
	if (!Array.isArray(root.nodes)) return [];
	return root.nodes.flatMap((rawNode) => {
		if (!isRecord(rawNode)) return [];
		const nodeId = readString(rawNode.id);
		const data = isRecord(rawNode.data) ? rawNode.data : {};
		const nodeKind = readString(data.kind) || readString(rawNode.type);
		const hasVideo = Boolean(readString(data.videoUrl)) || Array.isArray(data.videoResults);
		if (!nodeId || (!hasVideo && nodeKind !== "video" && nodeKind !== "composeVideo")) return [];
		const duration = Number(data.durationSeconds ?? data.duration);
		const start = Number(data.startSeconds ?? data.startTime);
		return [{
			nodeId,
			assetId: readString(data.assetId) || readString(data.sourceMaterialAssetId) || null,
			durationSeconds: Number.isFinite(duration) && duration >= 0 ? duration : null,
			startSeconds: Number.isFinite(start) && start >= 0 ? start : null,
		}];
	});
}

export function createWorkflowProjectContext(input: Readonly<{
	projectId: string;
	canvasId: string;
	sourceNodeId?: string | null;
	principalId: string;
	canvasData: unknown;
	assets: readonly MaterialAssetDto[];
	selectedAssetIds?: readonly string[];
	selectedNodeIds?: readonly string[];
	activeNodeId?: string | null;
	groupId?: string | null;
	assetWrite?: boolean;
	now?: Date;
}>): WorkflowProjectContext {
	const visibleAssets = input.assets.filter((asset) => asset.projectId === input.projectId);
	const rejectedResourceIdentities = rejectedCanvasResourceIdentities(input.canvasData);
	const rejectedReferenceIds = rejectedCanvasReferenceIds(input.canvasData);
	const initialSnapshot = visibleAssets.map((asset) => applyProviderRejectionEvidence(
		asset,
		projectAssetSnapshot(asset),
		rejectedResourceIdentities,
		rejectedReferenceIds,
	));
	const readyImageIds = new Set(
		initialSnapshot.filter(isWorkflowProjectImageReady).map((asset) => asset.assetId),
	);
	// selectedAssetIds is the visual input contract for a media workflow.  A
	// visible text/draft node is not a usable image reference and must not leak
	// into the frozen selection that Agents receive.
	const selectedAssetIds = uniqueStrings(input.selectedAssetIds ?? []).filter((assetId) => readyImageIds.has(assetId));
	const selectedAssetIdSet = new Set(selectedAssetIds);
	// Pre-contract workflow generations used to persist only an image URL and a
	// display label.  They remain immutable history, but an unselected image with
	// no object identity must not silently re-enter a later production run.  An
	// explicit user selection keeps it available so the Agent can bind it from
	// its sourceFacts; this is a production-candidate retirement, not deletion.
	const snapshot = initialSnapshot.map((asset): WorkflowProjectAssetSnapshot => (
		asset.origin === "material"
		&& asset.kind === "text"
		&& asset.mediaKind === "image"
		&& asset.referenceType === null
		&& asset.sourceFacts.workflowExecutionId !== null
		&& !selectedAssetIdSet.has(asset.assetId)
			? {
				...asset,
				productionEligible: false,
				productionExclusionReason: "legacy_untyped_workflow_image",
			}
			: asset
	));
	const selectedNodeIds = uniqueStrings([
		...(input.selectedNodeIds ?? []),
		...(input.activeNodeId ? [input.activeNodeId] : []),
	]);
	return {
		version: WORKFLOW_PROJECT_CONTEXT_VERSION,
		projectId: input.projectId,
		canvasId: input.canvasId,
		sourceNodeId: input.sourceNodeId?.trim() || null,
		selectedAssetIds,
		projectAssetIds: snapshot.map((asset) => asset.assetId),
		timeline: { clips: timelineClips(input.canvasData) },
		selection: {
			nodeIds: selectedNodeIds,
			assetIds: selectedAssetIds,
			activeNodeId: input.activeNodeId?.trim() || null,
			groupId: input.groupId?.trim() || null,
		},
		permissions: {
			principalId: input.principalId,
			projectRead: true,
			canvasRead: true,
			assetRead: true,
			assetWrite: input.assetWrite !== false,
		},
		assetSnapshot: snapshot,
		capturedAt: (input.now ?? new Date()).toISOString(),
	};
}

export function parseWorkflowProjectContext(value: unknown): WorkflowProjectContext | null {
	if (!isRecord(value) || value.version !== WORKFLOW_PROJECT_CONTEXT_VERSION) return null;
	if (!readString(value.projectId) || !readString(value.canvasId) || (value.sourceNodeId !== null && !readString(value.sourceNodeId)) || !isRecord(value.permissions)) return null;
	if (!Array.isArray(value.projectAssetIds) || !Array.isArray(value.selectedAssetIds) || !Array.isArray(value.assetSnapshot)) return null;
	return value as WorkflowProjectContext;
}
