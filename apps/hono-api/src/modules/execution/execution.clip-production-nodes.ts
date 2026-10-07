import { createWorkflowCollection, isWorkflowCollection, type WorkflowCollectionV1 } from "@tapcanvas/workflow-kernel-protocol";
import { type ClipProductionPacket, type ClipProductionSpeechEvent } from "../../../../../packages/schemas/clip-production-packet/index.mjs";
import { buildWorkflowVideoEffectV2Identity } from "../task/workflow-video-effect-claim";
import { projectClipProductionAssetItems, type ClipProductionAssetPlanItem, type MaterializedClipAssetIntent } from "./execution.clip-production";
import { workflowImageEffectIdentity } from "./execution.image-runner";
import { buildWorkflowClipSourceSnapshot } from "../task/workflow-clip-source-snapshot";
import {
	renderClipProductionReferenceHeader,
	renderClipProductionReferencePrompt,
	type ClipProductionReferenceBinding,
} from "./execution.clip-production-reference-prompt";

export type ClipProductionMediaItem = Readonly<{
	protocolVersion: "tapcanvas.clip-production-media-item/v1";
	packet: ClipProductionPacket;
	assetItems: readonly ClipProductionAssetPlanItem[];
	imageNodeIds: readonly string[];
	videoNodeId: string;
}>;

export type ClipProductionNodePlan = Readonly<{
	protocolVersion: "tapcanvas.clip-production-node-plan/v1";
	executionId: string;
	workflowKey: string;
	imageNodes: readonly Readonly<{ nodeId: string; assetItem: ClipProductionAssetPlanItem }>[];
	videoNodes: readonly Readonly<{
		nodeId: string;
		clipId: string;
		clipIndex: number;
		sourceSnapshot: Readonly<Record<string, unknown>>;
		prompt: string;
		durationSeconds: number;
		videoInputMode: "image_to_video" | "reference_to_video" | "text_to_video";
		firstFrameImageNodeId: string | null;
		referenceImageNodeIds: readonly string[];
		sourcePrompt: string;
		speechEvents?: readonly ClipProductionSpeechEvent[];
		referenceBindings: readonly ClipProductionReferenceBinding[];
		referenceHeader: string;
	}>[];
}>;

function record(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function required(value: unknown, field: string): string {
	if (typeof value !== "string" || !value.trim()) throw new Error(`${field} must be a non-empty string`);
	return value.trim();
}

function identity(assetId: string, state: string): string {
	return JSON.stringify([assetId, state]);
}

export function projectClipProductionNodePlan(input: Readonly<{
	executionId: string;
	executionFamilyId: string;
	nodeId: string;
	workflowKey: string | null;
	clipProductionCollection: unknown;
	assetIntentCollection: unknown;
	deliveryContract: unknown;
	/** The run's frozen style lock; it opens every Clip prompt. */
	stylePrompt?: string | null;
}>): Readonly<{
	nodePlan: ClipProductionNodePlan;
	mediaItems: WorkflowCollectionV1<ClipProductionMediaItem>;
	preparedNodes: WorkflowCollectionV1<Readonly<{ nodeId: string; clipId: string; promptPersisted: true; videoSubmitted: false }>>;
	promptPackage: Readonly<Record<string, unknown>>;
}> {
	const executionId = required(input.executionId, "executionId");
	const executionFamilyId = required(input.executionFamilyId, "executionFamilyId");
	const workflowKey = required(input.workflowKey, "workflowKey");
	if (!record(input.deliveryContract) || input.deliveryContract.protocolVersion !== "2"
		|| input.deliveryContract.workflowKey !== workflowKey) throw new Error("Node planning requires the matching frozen delivery contract");
	if (!isWorkflowCollection(input.clipProductionCollection) || !isWorkflowCollection(input.assetIntentCollection)) {
		throw new Error("Node planning requires completed Clip packet and deduplicated asset-intent collections");
	}
	const clips = input.clipProductionCollection as WorkflowCollectionV1<ClipProductionPacket>;
	const intents = input.assetIntentCollection as WorkflowCollectionV1<MaterializedClipAssetIntent>;
	if (clips.items.length === 0 || clips.items.length > 80) throw new Error("Node planning requires 1..80 frozen Clips");
	const assetItems = projectClipProductionAssetItems({ executionId, nodeId: input.nodeId, assetIntentCollection: intents });
	const assetByIdentity = new Map<string, { nodeId: string; assetItem: ClipProductionAssetPlanItem }>();
	for (const item of assetItems.items) {
		const assetItem = item.value;
		const key = identity(assetItem.canonicalAssetId, assetItem.state);
		if (assetByIdentity.has(key)) throw new Error(`Asset ${key} has ambiguous generation identity`);
		assetByIdentity.set(key, {
			assetItem,
			nodeId: workflowImageEffectIdentity({
				executionFamilyId,
				runtimeNodeId: input.nodeId,
				assetIdentity: { assetId: assetItem.effectAssetId, generationSpecVersion: assetItem.generationSpecVersion },
			}).canvasNodeId,
		});
	}
	const seenClipIndices = new Set<number>();
	const videoNodes = clips.items.map((item, index) => {
		const packet = item.value;
		if (!record(packet) || packet.protocolVersion !== "tapcanvas.clip-production-packet/v2"
			|| packet.clipId !== item.itemId || !Number.isSafeInteger(packet.clipIndex) || packet.clipIndex < 0
			|| seenClipIndices.has(packet.clipIndex)
			|| (index > 0 && packet.clipIndex <= clips.items[index - 1]!.value.clipIndex)) {
			throw new Error(`Clip ${index} differs from its frozen packet collection identity`);
		}
		seenClipIndices.add(packet.clipIndex);
		const references = packet.referenceAssets.map((reference) => {
			const asset = assetByIdentity.get(identity(reference.assetId, reference.state));
			if (!asset) throw new Error(`Clip ${packet.clipId} has no planned image for ${identity(reference.assetId, reference.state)}`);
			return asset;
		});
		if (packet.videoInputMode !== "text_to_video" && references.length === 0) throw new Error(`Clip ${packet.clipId} requires image references`);
		const firstFrame = packet.firstFrameAsset
			? assetByIdentity.get(identity(packet.firstFrameAsset.assetId, packet.firstFrameAsset.state)) ?? null
			: null;
		if (packet.videoInputMode === "image_to_video" && !firstFrame) throw new Error(`Clip ${packet.clipId} has no planned first frame`);
		if (packet.videoInputMode === "reference_to_video" && firstFrame) throw new Error(`Clip ${packet.clipId} cannot bind a first frame in reference mode`);
		if (packet.videoInputMode !== "image_to_video" && packet.videoInputMode !== "reference_to_video" && packet.videoInputMode !== "text_to_video") {
			throw new Error(`Clip ${packet.clipId} has unsupported video input mode`);
		}
		const referenceBindings: readonly ClipProductionReferenceBinding[] = references.map(({ assetItem, nodeId }) => ({
			nodeId,
			name: assetItem.displayName,
			referenceType: assetItem.referenceType,
		}));
		const plannedReferenceImages = references.map(({ nodeId }) => ({ sourceNodeIds: [nodeId] }));
		const referenceHeader = renderClipProductionReferenceHeader({ bindings: referenceBindings, images: plannedReferenceImages });
		const prompt = renderClipProductionReferencePrompt({ prompt: packet.videoPrompt,
			speechEvents: packet.speechEvents, bindings: referenceBindings, images: plannedReferenceImages,
			stylePrompt: input.stylePrompt });
		return {
			nodeId: buildWorkflowVideoEffectV2Identity({ executionFamilyId, clipId: packet.clipId }).canvasNodeId,
			clipId: packet.clipId,
			clipIndex: packet.clipIndex,
			sourceSnapshot: buildWorkflowClipSourceSnapshot({ clipId: packet.clipId, sourceRanges: packet.sourceRanges, clipFacts: packet.clipFacts }),
			prompt,
			sourcePrompt: packet.videoPrompt,
			...(packet.speechEvents === undefined ? {} : { speechEvents: packet.speechEvents }),
			durationSeconds: packet.durationSeconds,
			videoInputMode: packet.videoInputMode,
			firstFrameImageNodeId: firstFrame?.nodeId ?? null,
			referenceImageNodeIds: references.map((reference) => reference.nodeId),
			referenceBindings,
			referenceHeader,
		};
	});
	const nodePlan: ClipProductionNodePlan = {
		protocolVersion: "tapcanvas.clip-production-node-plan/v1",
		executionId,
		workflowKey,
		imageNodes: [...assetByIdentity.values()],
		videoNodes,
	};
	const mediaValues = clips.items.map((item, index): ClipProductionMediaItem => {
		const planned = videoNodes[index]!;
		const effectIds = new Set(item.value.assetIntents.map((intent) => identity(intent.assetId, intent.state)));
		const referenced = [...assetByIdentity.entries()].filter(([key]) => effectIds.has(key)).map(([, value]) => value.assetItem);
		if (referenced.length !== effectIds.size) throw new Error(`Clip ${item.itemId} asset intents differ from deduplicated assets`);
		return { protocolVersion: "tapcanvas.clip-production-media-item/v1", packet: item.value,
			assetItems: referenced, imageNodeIds: planned.referenceImageNodeIds, videoNodeId: planned.nodeId };
	});
	const mediaItems = createWorkflowCollection({ collectionId: `${executionId}:${input.nodeId}:media-items`,
		producerNodeId: input.nodeId, producerPortId: "media-items", itemIds: clips.items.map((item) => item.itemId),
		values: mediaValues, parentLineage: clips.items.map((item) => item.lineage) });
	const preparedNodes = createWorkflowCollection({ collectionId: `${executionId}:${input.nodeId}:prepared-nodes`,
		producerNodeId: input.nodeId, producerPortId: "prepared-nodes", itemIds: videoNodes.map((video) => video.clipId),
		values: videoNodes.map((video) => ({ nodeId: video.nodeId, clipId: video.clipId, promptPersisted: true as const, videoSubmitted: false as const })),
		parentLineage: clips.items.map((item) => item.lineage) });
	const promptPackage = {
		protocolVersion: "2", artifactType: "tapcanvas.prompt-package/v2", authoringProtocol: "tapcanvas.clip-production-packets/v2",
		executionId, workflowKey,
		clips: clips.items.map((item, index) => ({ itemId: item.itemId, index, clipIndex: item.value.clipIndex,
			prompt: videoNodes[index]!.prompt, sourcePrompt: videoNodes[index]!.sourcePrompt,
			...(input.stylePrompt ? { stylePrompt: input.stylePrompt } : {}),
			...(item.value.speechEvents === undefined ? {} : { speechEvents: item.value.speechEvents }),
			authoringEvidence: {
				sourceDialogueLineIds: item.value.speechEvents?.filter((event) => event.textOrigin === "source_quote")
					.map((event) => event.speechEventId) ?? [],
				spokenLineIds: item.value.speechEvents?.map((event) => event.speechEventId) ?? [],
			},
			referenceBindings: videoNodes[index]!.referenceBindings, referenceHeader: videoNodes[index]!.referenceHeader,
			durationSeconds: item.value.durationSeconds, videoInputMode: item.value.videoInputMode,
			firstFrameAsset: item.value.firstFrameAsset, referenceAssets: item.value.referenceAssets,
			referenceImageNodeIds: videoNodes[index]!.referenceImageNodeIds, referenceAssetIds: [],
			clipFacts: item.value.clipFacts, sourceRanges: item.value.sourceRanges, lineage: item.lineage })),
		planningState: "awaiting_canvas_readback",
		deliveryEvidence: {
			version: 2,
			source: "workflow_prompt_package",
			clipCount: clips.items.length,
			totalDurationSeconds: clips.items.reduce((total, item) => total + item.value.durationSeconds, 0),
			speechEvidenceStatus: clips.items.every((item) => item.value.speechEvents !== undefined)
				? "projected_from_clip_packets"
				: clips.items.every((item) => item.value.speechEvents === undefined)
					? "not_projected_from_clip_packets" : "partially_projected_from_clip_packets",
			sourceSpeechLineCount: clips.items.reduce((total, item) => total
				+ (item.value.speechEvents?.filter((event) => event.textOrigin === "source_quote").length ?? 0), 0),
			narrativeSpeechLineCount: clips.items.reduce((total, item) => total
				+ (item.value.speechEvents?.filter((event) => event.textOrigin === "authored").length ?? 0), 0),
			executableSpeechLineCount: clips.items.reduce((total, item) => total + (item.value.speechEvents?.length ?? 0), 0),
		},
	};
	return { nodePlan, mediaItems, preparedNodes, promptPackage };
}

export function projectClipProductionMediaItem(input: Readonly<{
	executionId: string; nodeId: string; mediaItem: unknown;
}>): Readonly<{
	clipProductionCollection: WorkflowCollectionV1<ClipProductionPacket>;
	assetItems: WorkflowCollectionV1<ClipProductionAssetPlanItem>;
	preparedNodes: WorkflowCollectionV1<Readonly<{ nodeId: string; clipId: string; promptPersisted: true; videoSubmitted: false }>>;
}> {
	if (!record(input.mediaItem) || input.mediaItem.protocolVersion !== "tapcanvas.clip-production-media-item/v1"
		|| !record(input.mediaItem.packet) || !Array.isArray(input.mediaItem.assetItems)
		|| typeof input.mediaItem.videoNodeId !== "string") throw new Error("Clip media projection requires one planned media item");
	const mediaItem = input.mediaItem as ClipProductionMediaItem;
	const packet = mediaItem.packet;
	const assets = mediaItem.assetItems;
	if (assets.some((asset) => asset.protocolVersion !== "tapcanvas.clip-production-asset-item/v1")) {
		throw new Error(`Clip ${packet.clipId} contains a malformed planned asset`);
	}
	const prefix = `${input.executionId}:${input.nodeId}:${packet.clipId}`;
	return {
		clipProductionCollection: createWorkflowCollection({ collectionId: `${prefix}:clip-production`, producerNodeId: input.nodeId,
			producerPortId: "clip-production", itemIds: [packet.clipId], values: [packet] }),
		assetItems: createWorkflowCollection({ collectionId: `${prefix}:asset-items`, producerNodeId: input.nodeId,
			producerPortId: "asset-items", itemIds: assets.map((asset) => asset.effectAssetId), values: assets }),
		preparedNodes: createWorkflowCollection({ collectionId: `${prefix}:prepared-nodes`, producerNodeId: input.nodeId,
			producerPortId: "prepared-nodes", itemIds: [packet.clipId],
			values: [{ nodeId: mediaItem.videoNodeId, clipId: packet.clipId, promptPersisted: true, videoSubmitted: false }] }),
	};
}
