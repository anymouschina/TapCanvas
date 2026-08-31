import type { MaterialAssetDto } from "../material/material.schemas";

const PROJECT_NODE_NON_CONTENT_KEYS = new Set([
	"approvalStatus",
	"canvasRevision",
	"creationStage",
	"expiresAt",
	"processingStatus",
	"productionLayer",
	"signedUrlExpiresAt",
	"status",
	"transcodeStatus",
	"urlExpiresAt",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stableSerialize(value: unknown): string {
	if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
	if (!isRecord(value)) return JSON.stringify(String(value));
	return `{${Object.keys(value)
		.filter((key) => !PROJECT_NODE_NON_CONTENT_KEYS.has(key))
		.sort()
		.map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`)
		.join(",")}}`;
}

/**
 * Stable identity of the bytes and authored asset facts exposed by a material
 * asset. Project-node versions advance with the whole canvas revision, while
 * provider/UI lifecycle fields and workflow production-stage projections may
 * advance or be compacted independently of the reusable media. Those runtime
 * facts are validated separately at consumption time and must not make an
 * unchanged image look like a different asset version.
 */
export function workflowAssetContentFingerprint(asset: MaterialAssetDto): string {
	return stableSerialize({
		kind: asset.kind,
		name: asset.name,
		data: asset.latestVersion?.data ?? null,
	});
}
