import type { MaterialAssetDto, MaterialKind } from "./material.schemas";

type ProjectNodeOwnerType = "project" | "chapter" | "shot";

export const PROJECT_NODE_ASSET_ID_PREFIX = "project-node:";

export type ProjectNodeAssetCanvas = {
	projectId: string;
	ownerType: ProjectNodeOwnerType;
	ownerId: string;
	ownerLabel?: string;
	flowId: string;
	data: unknown;
	canvasRevision: number;
	createdAt: string;
	updatedAt: string;
};

type CanvasNodeRecord = {
	id: string;
	type: string;
	data: Record<string, unknown>;
};

const MATERIAL_KINDS = new Set<MaterialKind>([
	"character",
	"scene",
	"prop",
	"style",
	"text",
	"ensemble",
	"pose",
	"voice",
]);

function readRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function readText(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function readHttpUrl(value: unknown): string {
	const text = readText(value);
	if (!text) return "";
	try {
		const parsed = new URL(text);
		return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : "";
	} catch {
		return "";
	}
}

function readResultUrls(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	const urls: string[] = [];
	for (const item of value) {
		const record = readRecord(item);
		if (!record) continue;
		const url = readHttpUrl(record.url) || readHttpUrl(record.imageUrl) || readHttpUrl(record.videoUrl);
		if (url && !urls.includes(url)) urls.push(url);
	}
	return urls;
}

function readCanvasNodes(value: unknown): CanvasNodeRecord[] {
	let parsed: unknown = value;
	if (typeof value === "string") {
		try {
			parsed = JSON.parse(value) as unknown;
		} catch {
			return [];
		}
	}
	const root = readRecord(parsed);
	if (!root || !Array.isArray(root.nodes)) return [];
	const nodes: CanvasNodeRecord[] = [];
	for (const rawNode of root.nodes) {
		const node = readRecord(rawNode);
		const id = readText(node?.id);
		if (!node || !id) continue;
		nodes.push({
			id,
			type: readText(node.type),
			data: readRecord(node.data) ?? {},
		});
	}
	return nodes;
}

function resolveMaterialKind(data: Record<string, unknown>): MaterialKind {
	const explicit = readText(data.materialKind);
	if (MATERIAL_KINDS.has(explicit as MaterialKind)) return explicit as MaterialKind;
	const referenceType = readText(data.referenceType);
	if (MATERIAL_KINDS.has(referenceType as MaterialKind)) return referenceType as MaterialKind;
	if (readText(data.roleName) || readText(data.characterName)) return "character";
	if (readText(data.sceneName)) return "scene";
	if (readText(data.propName)) return "prop";
	if (readText(data.audioType) === "voice_card" || readText(data.voiceCharacter)) return "voice";
	return "text";
}

function resolveNodeName(node: CanvasNodeRecord): string {
	for (const value of [
		node.data.roleName,
		node.data.characterName,
		node.data.sceneName,
		node.data.propName,
		node.data.label,
		node.data.title,
		node.data.name,
	]) {
		const text = readText(value);
		if (text) return text;
	}
	return `节点 ${node.id}`;
}

function buildProjectedData(node: CanvasNodeRecord, canvas: ProjectNodeAssetCanvas): Record<string, unknown> {
	const imageResults = readResultUrls(node.data.imageResults);
	const videoResults = readResultUrls(node.data.videoResults);
	const imageUrl =
		readHttpUrl(node.data.imageUrl) ||
		imageResults[0] ||
		readHttpUrl(node.data.firstFrameUrl) ||
		readHttpUrl(node.data.lastFrameUrl);
	const videoUrl = readHttpUrl(node.data.videoUrl) || videoResults[0];
	const audioUrl = readHttpUrl(node.data.audioUrl);
	const copiedFields: Record<string, unknown> = {};
	for (const key of [
		"materialKind",
		"materialProjectId",
		"referenceType",
		"roleName",
		"characterName",
		"sceneName",
		"propName",
		"stateKey",
		"stateDescription",
		"styleLockId",
		"styleFingerprint",
		"styleSource",
		"styleReferenceImages",
		"threeViewImageUrl",
		"voiceId",
		"voiceCharacter",
		"sourceMaterialAssetId",
		"sourceMaterialAssetVersionId",
		"sourceMaterialAssetVersion",
		"sourceProjectId",
		"sourceProjectNodeId",
		"sourceProjectOwnerType",
		"sourceProjectOwnerId",
		"approvalStatus",
		"status",
		"transcodeStatus",
		"processingStatus",
		"deleted",
		"expiresAt",
		"urlExpiresAt",
		"signedUrlExpiresAt",
		"mimeType",
		"productionLayer",
		"creationStage",
		"assetUsage",
		"assetPurpose",
		"productionEligible",
		"previewSeriesId",
		"previewBoardIndex",
		"previewBoardCount",
		"previewShotCount",
		"sourceChapterRevision",
		"sourceHash",
	] as const) {
		const value = node.data[key];
		if (value !== undefined && value !== null) copiedFields[key] = value;
	}
	return {
		source: "project_node",
		nodeId: node.id,
		nodeType: node.type || null,
		ownerType: canvas.ownerType,
		ownerId: canvas.ownerId,
		...(canvas.ownerLabel ? { ownerLabel: canvas.ownerLabel } : {}),
		flowId: canvas.flowId,
		canvasRevision: canvas.canvasRevision,
		...(canvas.ownerType === "chapter" ? { sourceChapterId: canvas.ownerId } : {}),
		...copiedFields,
		...(imageUrl ? { imageUrl } : {}),
		...(videoUrl ? { videoUrl } : {}),
		...(audioUrl ? { audioUrl } : {}),
		...(imageResults.length ? { imageResults: imageResults.map((url) => ({ url })) } : {}),
		...(videoResults.length ? { videoResults: videoResults.map((url) => ({ url })) } : {}),
	};
}

/**
 * Project material library is a read projection of durable project/chapter/shot nodes.
 * It never copies media, creates a second asset identity, or decides whether the node is usable.
 */
export function projectNodeAssetsFromCanvases(
	canvases: readonly ProjectNodeAssetCanvas[],
	input?: { kind?: MaterialKind },
): MaterialAssetDto[] {
	const assets: MaterialAssetDto[] = [];
	for (const canvas of canvases) {
		for (const node of readCanvasNodes(canvas.data)) {
			const kind = resolveMaterialKind(node.data);
			if (input?.kind && kind !== input.kind) continue;
			const id = `${PROJECT_NODE_ASSET_ID_PREFIX}${canvas.ownerType}:${canvas.ownerId}:${node.id}`;
			const versionId = `${id}:revision:${Math.max(0, canvas.canvasRevision)}`;
			assets.push({
				id,
				projectId: canvas.projectId,
				teamId: null,
				folderId: null,
				scope: "project",
				kind,
				name: resolveNodeName(node),
				favorite: false,
				currentVersion: Math.max(1, canvas.canvasRevision + 1),
				latestVersion: {
					id: versionId,
					assetId: id,
					projectId: canvas.projectId,
					version: Math.max(1, canvas.canvasRevision + 1),
					data: buildProjectedData(node, canvas),
					note: null,
					createdAt: canvas.updatedAt,
				},
				createdAt: canvas.createdAt,
				updatedAt: canvas.updatedAt,
				origin: {
					type: "project_node",
					ownerType: canvas.ownerType,
					ownerId: canvas.ownerId,
					...(canvas.ownerLabel ? { ownerLabel: canvas.ownerLabel } : {}),
					flowId: canvas.flowId,
					nodeId: node.id,
				},
			});
		}
	}
	return assets.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}
