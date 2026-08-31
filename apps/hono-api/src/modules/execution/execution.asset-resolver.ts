import type { MaterialAssetDto } from "../material/material.schemas";
import { workflowAssetContentFingerprint } from "./execution.asset-content-fingerprint";
import type { WorkflowProjectContext, WorkflowProjectAssetSnapshot } from "./execution.project-context";

export type WorkflowResolvedAsset = Readonly<{
	assetId: string;
	projectId: string;
	url: string;
	mediaKind: "image" | "video" | "audio";
	mimeType: string | null;
	nodeId: string | null;
	flowId: string | null;
}>;

export class WorkflowAssetResolverError extends Error {
	constructor(
		message: string,
		public readonly code:
			| "workflow_asset_forbidden"
			| "workflow_asset_not_found"
			| "workflow_asset_version_drift"
			| "workflow_asset_deleted"
			| "workflow_asset_transcoding"
			| "workflow_asset_preview_only"
			| "workflow_asset_resource_unavailable",
	) {
		super(message);
		this.name = "WorkflowAssetResolverError";
	}
}

export type WorkflowAssetResolver = Readonly<{
	listProjectAssets: () => Promise<readonly WorkflowProjectAssetSnapshot[]>;
	getAsset: (assetId: string) => Promise<WorkflowProjectAssetSnapshot>;
	searchProjectAssets: (query: string) => Promise<readonly WorkflowProjectAssetSnapshot[]>;
	getCurrentSelection: () => WorkflowProjectContext["selection"];
	resolveAssetResource: (assetId: string, preferredKind?: "image" | "video" | "audio") => Promise<WorkflowResolvedAsset>;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function firstUrl(data: Record<string, unknown>, kind: "image" | "video" | "audio"): string {
	const direct = readString(data[`${kind}Url`]);
	if (direct) return direct;
	const results = data[`${kind}Results`];
	if (!Array.isArray(results)) return "";
	for (const result of results) {
		if (!isRecord(result)) continue;
		const url = readString(result.url) || readString(result[`${kind}Url`]);
		if (url) return url;
	}
	return "";
}

function expiresAt(data: Record<string, unknown>): number | null {
	const raw = data.urlExpiresAt ?? data.expiresAt ?? data.signedUrlExpiresAt;
	if (typeof raw !== "string" && typeof raw !== "number") return null;
	const value = typeof raw === "number" ? raw : Date.parse(raw);
	return Number.isFinite(value) ? value : null;
}

function signedUrlExpiresAt(url: string): number | null {
	try {
		const parsed = new URL(url);
		const absolute = parsed.searchParams.get("Expires") ?? parsed.searchParams.get("expires");
		if (absolute && Number.isFinite(Number(absolute))) return Number(absolute) * 1_000;
		const date = parsed.searchParams.get("X-Amz-Date") ?? parsed.searchParams.get("x-amz-date");
		const seconds = Number(parsed.searchParams.get("X-Amz-Expires") ?? parsed.searchParams.get("x-amz-expires"));
		if (date && /^\d{8}T\d{6}Z$/u.test(date) && Number.isFinite(seconds)) {
			const normalized = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${date.slice(9, 11)}:${date.slice(11, 13)}:${date.slice(13, 15)}Z`;
			return Date.parse(normalized) + seconds * 1_000;
		}
		return null;
	} catch {
		return null;
	}
}

function statusOf(data: Record<string, unknown>): string {
	return readString(data.status) || readString(data.transcodeStatus) || readString(data.processingStatus);
}

export function createWorkflowAssetResolver(input: Readonly<{
	context: WorkflowProjectContext;
	loadVisibleAssets: () => Promise<readonly MaterialAssetDto[]>;
	refreshAsset?: (assetId: string) => Promise<MaterialAssetDto | null>;
	now?: () => Date;
}>): WorkflowAssetResolver {
	const now = input.now ?? (() => new Date());
	const loadAuthorized = async (): Promise<readonly MaterialAssetDto[]> => {
		const assets = await input.loadVisibleAssets();
		const frozenVisibleIds = new Set(input.context.projectAssetIds);
		return assets.filter((asset) => asset.projectId === input.context.projectId && frozenVisibleIds.has(asset.id));
	};
	const requireAsset = async (assetId: string): Promise<MaterialAssetDto> => {
		const normalized = assetId.trim();
		if (!input.context.projectAssetIds.includes(normalized)) {
			throw new WorkflowAssetResolverError(`Asset ${normalized} is not visible in the frozen project context`, "workflow_asset_forbidden");
		}
		const asset = (await loadAuthorized()).find((candidate) => candidate.id === normalized);
		if (!asset) throw new WorkflowAssetResolverError(`Asset ${normalized} no longer exists`, "workflow_asset_not_found");
		const frozen = input.context.assetSnapshot.find((candidate) => candidate.assetId === normalized);
		const versionChanged = !frozen
			|| asset.currentVersion !== frozen.assetVersion
			|| asset.latestVersion?.id !== frozen.assetVersionId;
		const projectedProjectNodeUnchanged = frozen?.origin === "project_node"
			&& frozen.contentFingerprint === workflowAssetContentFingerprint(asset);
		if (!frozen || (versionChanged && !projectedProjectNodeUnchanged)) {
			throw new WorkflowAssetResolverError(
				`Asset ${normalized} changed after the workflow ProjectContext was frozen`,
				"workflow_asset_version_drift",
			);
		}
		return asset;
	};
	return {
		listProjectAssets: async () => [...input.context.assetSnapshot],
		getAsset: async (assetId) => {
			await requireAsset(assetId);
			const frozen = input.context.assetSnapshot.find((candidate) => candidate.assetId === assetId.trim());
			if (!frozen) throw new WorkflowAssetResolverError(`Asset ${assetId} is missing from the frozen snapshot`, "workflow_asset_forbidden");
			return frozen;
		},
		searchProjectAssets: async (query) => {
			const needle = query.trim().toLocaleLowerCase();
			const snapshots = [...input.context.assetSnapshot];
			if (!needle) return snapshots;
			return snapshots.filter((asset) => [asset.name, asset.canonicalName, asset.kind, asset.referenceType ?? "", asset.assetId]
				.some((field) => field.toLocaleLowerCase().includes(needle)));
		},
		getCurrentSelection: () => input.context.selection,
		resolveAssetResource: async (assetId, preferredKind) => {
			let asset = await requireAsset(assetId);
			const frozen = input.context.assetSnapshot.find((candidate) => candidate.assetId === assetId.trim());
			if (frozen?.productionEligible === false || frozen?.assetUsage === "preview_only") {
				throw new WorkflowAssetResolverError(
					`Asset ${assetId} belongs to a story preview series and cannot be used for production`,
					"workflow_asset_preview_only",
				);
			}
			let data = asset.latestVersion?.data;
			if (!data || data.deleted === true || statusOf(data) === "deleted") {
				throw new WorkflowAssetResolverError(`Asset ${assetId} was deleted`, "workflow_asset_deleted");
			}
			const status = statusOf(data);
			const approvalStatus = readString(data.approvalStatus);
			if (status === "failed" || status === "rejected" || approvalStatus === "rejected") {
				throw new WorkflowAssetResolverError(`Asset ${assetId} is not available for production`, "workflow_asset_resource_unavailable");
			}
			if (status === "pending" || status === "processing" || status === "transcoding") {
				throw new WorkflowAssetResolverError(`Asset ${assetId} is still transcoding`, "workflow_asset_transcoding");
			}
			const initialUrl = firstUrl(data, preferredKind ?? "image") || firstUrl(data, "video") || firstUrl(data, "audio");
			const expiry = expiresAt(data) ?? (initialUrl ? signedUrlExpiresAt(initialUrl) : null);
			if (expiry !== null && expiry <= now().getTime() && input.refreshAsset) {
				const refreshed = await input.refreshAsset(assetId);
				if (refreshed?.id === assetId && refreshed.projectId === input.context.projectId) {
					asset = refreshed;
					data = refreshed.latestVersion?.data;
				}
			}
			if (!data) throw new WorkflowAssetResolverError(`Asset ${assetId} has no current version`, "workflow_asset_resource_unavailable");
			const refreshedUrl = firstUrl(data, preferredKind ?? "image") || firstUrl(data, "video") || firstUrl(data, "audio");
			const refreshedExpiry = expiresAt(data) ?? (refreshedUrl ? signedUrlExpiresAt(refreshedUrl) : null);
			if (refreshedExpiry !== null && refreshedExpiry <= now().getTime()) {
				throw new WorkflowAssetResolverError(`Asset ${assetId} still has an expired resource after refresh`, "workflow_asset_resource_unavailable");
			}
			const kinds = preferredKind ? [preferredKind] : (["image", "video", "audio"] as const);
			for (const kind of kinds) {
				const url = firstUrl(data, kind);
				if (!url) continue;
				try {
					const parsed = new URL(url);
					if (parsed.protocol !== "http:" && parsed.protocol !== "https:") continue;
				} catch {
					continue;
				}
				return {
					assetId: asset.id,
					projectId: input.context.projectId,
					url,
					mediaKind: kind,
					mimeType: readString(data.mimeType) || null,
					nodeId: asset.origin?.nodeId ?? null,
					flowId: asset.origin?.flowId ?? null,
				};
			}
			throw new WorkflowAssetResolverError(`Asset ${assetId} has no ready ${preferredKind ?? "media"} resource`, "workflow_asset_resource_unavailable");
		},
	};
}
