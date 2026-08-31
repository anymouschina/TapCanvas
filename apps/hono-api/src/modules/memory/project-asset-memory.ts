import { createHash } from "node:crypto";
import type { PrismaClient } from "../../types";
import {
	supersedeProjectAssetMemoryEntries,
	writeMemoryEntries,
} from "./memory.repo";

type ProjectAssetMemoryMetadata = {
	kind?: string;
	role?: string;
	status?: string;
	version?: number;
	url?: string;
	thumbnailUrl?: string;
};

function readTextField(record: Record<string, unknown>, key: string): string | undefined {
	const value = record[key];
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readHttpUrl(value: unknown): string | undefined {
	if (typeof value !== "string" || !value.trim()) return undefined;
	try {
		const url = new URL(value.trim());
		return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined;
	} catch {
		return undefined;
	}
}

function readProjectAssetMetadata(data: unknown): ProjectAssetMemoryMetadata {
	if (!data || typeof data !== "object" || Array.isArray(data)) return {};
	const record = data as Record<string, unknown>;
	const kind = readTextField(record, "kind");
	const role = readTextField(record, "role");
	const status = readTextField(record, "status");
	const url = readHttpUrl(record.url);
	const thumbnailUrl = readHttpUrl(record.thumbnailUrl);
	const versionValue = record.version;
	const version = typeof versionValue === "number" && Number.isFinite(versionValue)
		? versionValue
		: undefined;
	return {
		...(kind ? { kind } : {}),
		...(role ? { role } : {}),
		...(status ? { status } : {}),
		...(version !== undefined ? { version } : {}),
		...(url ? { url } : {}),
		...(thumbnailUrl ? { thumbnailUrl } : {}),
	};
}

export type ProjectAssetMemorySyncInput = {
	userId: string;
	projectId: string | null | undefined;
	assetId: string;
	name: string;
	data: unknown;
	updatedAt: string;
};

export type ProjectAssetMemorySyncResult =
	| { status: "skipped"; reason: "project_id_missing" | "asset_id_missing" }
	| { status: "persisted"; entryId: string }
	| { status: "degraded"; error: string };

/**
 * Keep project memory as a compact, versioned index of assets. The asset
 * store remains the source of truth; memory only carries references that an
 * agent can resolve through project/asset tools.
 */
export async function syncProjectAssetMemoryInDb(
	db: PrismaClient,
	input: ProjectAssetMemorySyncInput,
): Promise<ProjectAssetMemorySyncResult> {
	const userId = String(input.userId || "").trim();
	const projectId = String(input.projectId || "").trim();
	const assetId = String(input.assetId || "").trim();
	if (!projectId) return { status: "skipped", reason: "project_id_missing" };
	if (!assetId) return { status: "skipped", reason: "asset_id_missing" };
	const nowIso = new Date().toISOString();
	const updatedAt = String(input.updatedAt || nowIso).trim() || nowIso;
	const metadata = readProjectAssetMetadata(input.data);
	const sourceId = `project-asset:${assetId}:${updatedAt}`;
	const entryId = `project-asset-memory:${createHash("sha256").update(`${userId}:${projectId}:${sourceId}`).digest("hex")}`;
	try {
		await supersedeProjectAssetMemoryEntries(db, {
			userId,
			projectId,
			assetId,
			nowIso,
		});
		await writeMemoryEntries(db, userId, {
			entries: [{
				scopeType: "project",
				scopeId: projectId,
				memoryType: "artifact_ref",
				title: input.name.trim() || assetId,
				summaryText: `项目资产：${input.name.trim() || assetId}`,
				content: {
					kind: "project_asset_ref",
					projectId,
					assetId,
					assetName: input.name.trim() || assetId,
					updatedAt,
					metadata,
				},
				sourceKind: "system_extract",
				sourceId,
				importance: 0.78,
				tags: ["project-asset", "artifact-ref"],
				links: [
					{ targetType: "project", targetId: projectId, relation: "about" },
					{ targetType: "asset", targetId: assetId, relation: "references" },
				],
				status: "active",
			}],
		}, { entryIds: [entryId], idempotent: true });
		return { status: "persisted", entryId };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.warn(`[memory] project asset reference sync degraded asset=${assetId} project=${projectId}: ${message}`);
		return { status: "degraded", error: message };
	}
}
