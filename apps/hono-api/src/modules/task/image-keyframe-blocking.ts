import { AppError } from "../../middleware/error";
import {
	doesCompositionImageUrlCarryHash,
	parseKeyframeCompositionContract,
	renderKeyframeCompositionFacts,
	type KeyframeCompositionContract,
} from "./keyframe-composition-contract";

type CanvasNode = {
	id?: unknown;
	data?: unknown;
};

export type KeyframeBlockingReference = {
	nodeId: string;
	imageUrl: string;
	compositionContract: KeyframeCompositionContract;
	compositionContractHash: string;
	compositionFacts: string;
};

function readRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function readTrimmedString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function readUniqueStrings(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return [
		...new Set(value.map((item) => readTrimmedString(item)).filter(Boolean)),
	];
}

function isHttpUrl(value: string): boolean {
	try {
		const parsed = new URL(value);
		return parsed.protocol === "http:" || parsed.protocol === "https:";
	} catch {
		return false;
	}
}

function isBeatKeyframe(nodeData: Record<string, unknown>): boolean {
	return (
		readTrimmedString(nodeData.productionLayer).toLowerCase() === "keyframe" ||
		readTrimmedString(nodeData.creationStage).toLowerCase() === "beat_keyframe"
	);
}

/**
 * Resolves the deterministic composition reference for a chapter keyframe.
 * Only keyframes explicitly classified by agents as spatially dependent cannot
 * be sent to an image model until the declared blocking node exists and covers
 * the same canonical character/scene anchors. Character count alone is not a
 * semantic proxy for whether this clip needs precise blocking.
 */
export function resolveKeyframeBlockingReference(input: {
	nodeData: Record<string, unknown>;
	nodes: CanvasNode[];
}): KeyframeBlockingReference | null {
	if (!isBeatKeyframe(input.nodeData)) return null;
	const productionMetadata = readRecord(input.nodeData.productionMetadata);
	const lockedAnchors = readRecord(productionMetadata?.lockedAnchors);
	const characterAnchors = readUniqueStrings(lockedAnchors?.character);
	const spatialBlocking = productionMetadata?.spatialBlocking === true;
	if (!spatialBlocking) return null;

	const blockingFrameNodeId = readTrimmedString(productionMetadata?.blockingFrameNodeId);
	if (!blockingFrameNodeId) {
		throw new AppError("空间调度关键帧必须先绑定真实站位图", {
			status: 409,
			code: "keyframe_blocking_reference_required",
			details: { characterAnchors, spatialBlocking },
			terminal: false,
		});
	}
	const blockingNode = input.nodes.find(
		(node) => readTrimmedString(node.id) === blockingFrameNodeId,
	);
	if (!blockingNode) {
		throw new AppError("关键帧声明的站位图不存在于当前授权画布", {
			status: 409,
			code: "keyframe_blocking_node_missing",
			details: { blockingFrameNodeId },
			terminal: false,
		});
	}
	const blockingData = readRecord(blockingNode.data) ?? {};
	const referenceType = readTrimmedString(blockingData.referenceType).toLowerCase();
	const productionLayer = readTrimmedString(blockingData.productionLayer).toLowerCase();
	if (referenceType !== "blocking" && productionLayer !== "blocking_diagram") {
		throw new AppError("关键帧绑定节点不是合法站位图", {
			status: 409,
			code: "keyframe_blocking_node_type_invalid",
			details: { blockingFrameNodeId, referenceType, productionLayer },
			terminal: false,
		});
	}
	const imageUrl = readTrimmedString(blockingData.imageUrl);
	if (!isHttpUrl(imageUrl)) {
		throw new AppError("关键帧绑定的站位图缺少真实 imageUrl", {
			status: 409,
			code: "keyframe_blocking_image_url_missing",
			details: { blockingFrameNodeId },
			terminal: false,
		});
	}

	const blockingMetadata = readRecord(blockingData.productionMetadata);
	const blockingAnchors = readRecord(blockingMetadata?.lockedAnchors);
	const blockingCharacters = readUniqueStrings(blockingAnchors?.character);
	const missingCharacters = characterAnchors.filter(
		(character) => !blockingCharacters.includes(character),
	);
	if (missingCharacters.length > 0) {
		throw new AppError("站位图没有覆盖关键帧中的全部角色", {
			status: 409,
			code: "keyframe_blocking_character_coverage_missing",
			details: { blockingFrameNodeId, missingCharacters, blockingCharacters },
			terminal: false,
		});
	}

	const keyframeScenes = readUniqueStrings(lockedAnchors?.scene);
	const blockingSceneName = readTrimmedString(blockingData.sceneName);
	if (
		keyframeScenes.length > 0 &&
		(!blockingSceneName || !keyframeScenes.includes(blockingSceneName))
	) {
		throw new AppError("站位图场景与关键帧场景锚不一致", {
			status: 409,
			code: "keyframe_blocking_scene_mismatch",
			details: { blockingFrameNodeId, blockingSceneName, keyframeScenes },
			terminal: false,
		});
	}

	const parsedBlockingContract = parseKeyframeCompositionContract(
		blockingMetadata?.compositionContract,
	);
	if (!parsedBlockingContract.ok) {
		throw new AppError("站位图缺少有效关键帧构图合同", {
			status: 409,
			code: "keyframe_blocking_composition_contract_invalid",
			details: { blockingFrameNodeId, issues: parsedBlockingContract.issues },
			terminal: false,
		});
	}
	const blockingContractHash = readTrimmedString(blockingMetadata?.compositionContractHash);
	if (blockingContractHash !== parsedBlockingContract.hash) {
		throw new AppError("站位图构图合同 hash 与合同正文不一致", {
			status: 409,
			code: "keyframe_blocking_composition_hash_mismatch",
			details: {
				blockingFrameNodeId,
				expected: parsedBlockingContract.hash,
				received: blockingContractHash,
			},
			terminal: false,
		});
	}
	if (!doesCompositionImageUrlCarryHash(imageUrl, blockingContractHash)) {
		throw new AppError("站位图 URL 无法证明由当前构图合同渲染", {
			status: 409,
			code: "keyframe_blocking_composition_provenance_missing",
			details: { blockingFrameNodeId, compositionContractHash: blockingContractHash },
			terminal: false,
		});
	}

	const parsedKeyframeContract = parseKeyframeCompositionContract(
		productionMetadata?.compositionContract,
	);
	if (!parsedKeyframeContract.ok) {
		throw new AppError("空间调度关键帧必须携带与站位图相同的构图合同", {
			status: 409,
			code: "keyframe_composition_contract_invalid",
			details: { blockingFrameNodeId, issues: parsedKeyframeContract.issues },
			terminal: false,
		});
	}
	const keyframeContractHash = readTrimmedString(productionMetadata?.compositionContractHash);
	if (
		keyframeContractHash !== parsedKeyframeContract.hash ||
		keyframeContractHash !== blockingContractHash
	) {
		throw new AppError("关键帧与站位图的构图合同不一致", {
			status: 409,
			code: "keyframe_composition_contract_mismatch",
			details: {
				blockingFrameNodeId,
				blockingContractHash,
				keyframeContractHash,
				parsedKeyframeContractHash: parsedKeyframeContract.hash,
			},
			terminal: false,
		});
	}

	return {
		nodeId: blockingFrameNodeId,
		imageUrl,
		compositionContract: parsedBlockingContract.contract,
		compositionContractHash: blockingContractHash,
		compositionFacts: renderKeyframeCompositionFacts(parsedBlockingContract.contract),
	};
}
