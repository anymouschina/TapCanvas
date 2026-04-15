import { randomUUID } from "node:crypto";

import {
	getPublicFlowNodeHandles,
	getPublicFlowTaskNodeCoreType,
} from "./flow.node-protocol";
import { collectPublicFlowAnchorBindingImageUrls } from "./flow.anchor-bindings";

type NodeLike = Record<string, unknown> & {
	id?: unknown;
	type?: unknown;
	data?: unknown;
};

type EdgeLike = Record<string, unknown> & {
	id?: unknown;
	source?: unknown;
	target?: unknown;
	sourceHandle?: unknown;
	targetHandle?: unknown;
};

type AutoWireReferenceEdgesInput = {
	nodeById: Map<string, NodeLike>;
	edgeList: unknown[];
	targetNodeIds: Iterable<string>;
};

type AutoWireReferenceEdgesResult = {
	createdEdges: number;
};

type EdgeHandlePair = {
	sourceHandle: "out-image" | "out-video";
	targetHandle: "in-image" | "in-any";
};

function asObject(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	return value as Record<string, unknown>;
}

function readId(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function readRemoteUrl(value: unknown): string {
	if (typeof value !== "string") return "";
	const trimmed = value.trim();
	return /^https?:\/\//i.test(trimmed) ? trimmed : "";
}

function unwrapProxyUrl(value: string): string {
	try {
		const parsed = new URL(value);
		const nested =
			parsed.searchParams.get("url") || parsed.searchParams.get("src") || "";
		if (!nested) return parsed.toString();
		const normalizedPath = parsed.pathname.replace(/\/+$/, "");
		if (
			normalizedPath.endsWith("/assets/proxy-image") ||
			normalizedPath.endsWith("/asset/proxy") ||
			normalizedPath.endsWith("/proxy-image")
		) {
			return unwrapProxyUrl(nested);
		}
		return parsed.toString();
	} catch {
		return value;
	}
}

function normalizeExactUrl(value: unknown): string {
	const remoteUrl = readRemoteUrl(value);
	if (!remoteUrl) return "";
	const unwrapped = unwrapProxyUrl(remoteUrl);
	try {
		const parsed = new URL(unwrapped);
		parsed.hash = "";
		return parsed.toString();
	} catch {
		return unwrapped;
	}
}

function normalizeCanonicalUrl(value: unknown): string {
	const exact = normalizeExactUrl(value);
	if (!exact) return "";
	try {
		const parsed = new URL(exact);
		return `${parsed.origin}${parsed.pathname}`;
	} catch {
		return exact;
	}
}

function collectRequestedReferenceUrls(nodeData: Record<string, unknown>): string[] {
	const result: string[] = [];
	const seen = new Set<string>();
	const push = (value: unknown) => {
		const exact = normalizeExactUrl(value);
		if (!exact || seen.has(exact)) return;
		seen.add(exact);
		result.push(exact);
	};

	const referenceImages = Array.isArray(nodeData.referenceImages)
		? nodeData.referenceImages
		: [];
	for (const item of referenceImages) push(item);
	const roleCardReferenceImages = Array.isArray(nodeData.roleCardReferenceImages)
		? nodeData.roleCardReferenceImages
		: [];
	for (const item of roleCardReferenceImages) push(item);
	for (const item of collectPublicFlowAnchorBindingImageUrls(nodeData.anchorBindings, 12)) {
		push(item);
	}

	const assetInputs = Array.isArray(nodeData.assetInputs) ? nodeData.assetInputs : [];
	for (const item of assetInputs) {
		const record = asObject(item);
		if (!record) continue;
		push(record.url);
	}

	return result;
}

function collectImageUrlsFromList(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	const result: string[] = [];
	for (const item of value) {
		const record = asObject(item);
		if (!record) continue;
		const directUrl = readRemoteUrl(record.url);
		if (directUrl) result.push(directUrl);
		const thumbnailUrl = readRemoteUrl(record.thumbnailUrl);
		if (thumbnailUrl) result.push(thumbnailUrl);
	}
	return result;
}

function collectStoryboardCellUrls(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	const result: string[] = [];
	for (const item of value) {
		const record = asObject(item);
		if (!record) continue;
		const imageUrl = readRemoteUrl(record.imageUrl);
		if (imageUrl) result.push(imageUrl);
	}
	return result;
}

function collectSourceUrls(node: NodeLike): string[] {
	const data = asObject(node.data) || {};
	const candidates = [
		readRemoteUrl(data.imageUrl),
		readRemoteUrl(data.videoThumbnailUrl),
		readRemoteUrl(data.firstFrameUrl),
		readRemoteUrl(data.lastFrameUrl),
		readRemoteUrl(data.veoFirstFrameUrl),
		readRemoteUrl(data.veoLastFrameUrl),
		...collectPublicFlowAnchorBindingImageUrls(data.anchorBindings, 12),
		...collectImageUrlsFromList(data.imageResults),
		...collectImageUrlsFromList(data.videoResults),
		...collectImageUrlsFromList(data.assets),
		...collectImageUrlsFromList(data.outputs),
		...collectStoryboardCellUrls(data.storyboardEditorCells),
	];
	const result: string[] = [];
	const seen = new Set<string>();
	for (const candidate of candidates) {
		const exact = normalizeExactUrl(candidate);
		if (!exact || seen.has(exact)) continue;
		seen.add(exact);
		result.push(exact);
	}
	return result;
}

function resolveEdgeHandlePair(
	sourceNode: NodeLike,
	targetNode: NodeLike,
): EdgeHandlePair | null {
	const sourceHandles = getPublicFlowNodeHandles(sourceNode);
	const targetHandles = getPublicFlowNodeHandles(targetNode);
	if (!sourceHandles || !targetHandles) return null;

	const sourceHandle = sourceHandles.sources.has("out-image")
		? "out-image"
		: sourceHandles.sources.has("out-video")
			? "out-video"
			: null;
	if (!sourceHandle) return null;

	const targetHandle = targetHandles.targets.has("in-image")
		? "in-image"
		: targetHandles.targets.has("in-any")
			? "in-any"
			: null;
	if (!targetHandle) return null;

	return { sourceHandle, targetHandle };
}

function mergeReferenceOrder(
	existing: unknown,
	matchedNodeIds: string[],
): string[] {
	const existingIds = Array.isArray(existing)
		? existing
				.map((item) => readId(item))
				.filter(Boolean)
		: [];
	if (existingIds.length === 0) return matchedNodeIds;

	const seen = new Set(existingIds);
	const appended = matchedNodeIds.filter((nodeId) => !seen.has(nodeId));
	return [...existingIds, ...appended];
}

function isImageLikeCoreType(node: NodeLike): boolean {
	const data = asObject(node.data);
	const kind = typeof data?.kind === "string" ? data.kind : null;
	const coreType = getPublicFlowTaskNodeCoreType(kind);
	return coreType === "image" || coreType === "storyboard" || coreType === "video";
}

function edgePairKey(sourceId: string, targetId: string): string {
	return `${sourceId}\u0000${targetId}`;
}

function filterUniqueNodeIdsExcludingSelf(
	nodeIds: Iterable<string> | undefined,
	targetNodeId: string,
): string[] {
	if (!nodeIds) return [];
	const result = new Set<string>();
	for (const nodeId of nodeIds) {
		const trimmed = readId(nodeId);
		if (!trimmed || trimmed === targetNodeId) continue;
		result.add(trimmed);
	}
	return Array.from(result);
}

export function autoWireReferenceEdges(
	input: AutoWireReferenceEdgesInput,
): AutoWireReferenceEdgesResult {
	const sourceIdsByExactUrl = new Map<string, Set<string>>();
	const sourceIdsByCanonicalUrl = new Map<string, Set<string>>();

	for (const [nodeId, node] of input.nodeById.entries()) {
		if (!isImageLikeCoreType(node)) continue;
		const urls = collectSourceUrls(node);
		if (urls.length === 0) continue;
		for (const exactUrl of urls) {
			const exactSet = sourceIdsByExactUrl.get(exactUrl) || new Set<string>();
			exactSet.add(nodeId);
			sourceIdsByExactUrl.set(exactUrl, exactSet);

			const canonicalUrl = normalizeCanonicalUrl(exactUrl);
			if (!canonicalUrl) continue;
			const canonicalSet =
				sourceIdsByCanonicalUrl.get(canonicalUrl) || new Set<string>();
			canonicalSet.add(nodeId);
			sourceIdsByCanonicalUrl.set(canonicalUrl, canonicalSet);
		}
	}

	const existingEdgePairs = new Set<string>();
	for (const rawEdge of input.edgeList) {
		const edge = asObject(rawEdge) as EdgeLike | null;
		if (!edge) continue;
		const sourceId = readId(edge.source);
		const targetId = readId(edge.target);
		if (!sourceId || !targetId) continue;
		existingEdgePairs.add(edgePairKey(sourceId, targetId));
	}

	let createdEdges = 0;
	for (const rawTargetNodeId of input.targetNodeIds) {
		const targetNodeId = readId(rawTargetNodeId);
		if (!targetNodeId) continue;
		const targetNode = input.nodeById.get(targetNodeId);
		if (!targetNode) continue;

		const targetData = asObject(targetNode.data) || {};
		const requestedUrls = collectRequestedReferenceUrls(targetData);
		if (requestedUrls.length === 0) continue;

		const matchedSourceNodeIds: string[] = [];
		const matchedSourceSet = new Set<string>();

		for (const requestedUrl of requestedUrls) {
			const exactMatches = filterUniqueNodeIdsExcludingSelf(
				sourceIdsByExactUrl.get(requestedUrl),
				targetNodeId,
			);
			let resolvedSourceNodeId =
				exactMatches.length === 1 ? exactMatches[0] || "" : "";
			if (!resolvedSourceNodeId) {
				const canonicalMatches = filterUniqueNodeIdsExcludingSelf(
					sourceIdsByCanonicalUrl.get(normalizeCanonicalUrl(requestedUrl)),
					targetNodeId,
				);
				resolvedSourceNodeId =
					canonicalMatches.length === 1 ? canonicalMatches[0] || "" : "";
			}
			if (!resolvedSourceNodeId || matchedSourceSet.has(resolvedSourceNodeId)) {
				continue;
			}
			matchedSourceSet.add(resolvedSourceNodeId);
			matchedSourceNodeIds.push(resolvedSourceNodeId);
		}

		if (matchedSourceNodeIds.length === 0) continue;

		const nextReferenceOrder = mergeReferenceOrder(
			targetData.upstreamReferenceOrder,
			matchedSourceNodeIds,
		);
		const currentReferenceOrder = Array.isArray(targetData.upstreamReferenceOrder)
			? targetData.upstreamReferenceOrder
					.map((item) => readId(item))
					.filter(Boolean)
			: [];
		const referenceOrderChanged =
			nextReferenceOrder.length !== currentReferenceOrder.length ||
			nextReferenceOrder.some((item, index) => item !== currentReferenceOrder[index]);
		if (referenceOrderChanged) {
			input.nodeById.set(targetNodeId, {
				...targetNode,
				data: {
					...targetData,
					upstreamReferenceOrder: nextReferenceOrder,
				},
			});
		}

		for (const sourceNodeId of matchedSourceNodeIds) {
			if (existingEdgePairs.has(edgePairKey(sourceNodeId, targetNodeId))) continue;
			const sourceNode = input.nodeById.get(sourceNodeId);
			if (!sourceNode) continue;
			const handles = resolveEdgeHandlePair(sourceNode, targetNode);
			if (!handles) continue;
			input.edgeList.push({
				id: `e-${randomUUID()}`,
				source: sourceNodeId,
				target: targetNodeId,
				sourceHandle: handles.sourceHandle,
				targetHandle: handles.targetHandle,
			});
			existingEdgePairs.add(edgePairKey(sourceNodeId, targetNodeId));
			createdEdges += 1;
		}
	}

	return { createdEdges };
}
