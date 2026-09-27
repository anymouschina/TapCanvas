import { describe, expect, it } from "vitest";
import { createWorkflowCollection } from "@tapcanvas/workflow-kernel-protocol";
import { CLIP_PRODUCTION_PACKET_PROTOCOL_VERSION } from "../../../../../packages/schemas/clip-production-packet/index.mjs";
import { projectClipProductionAssetItems, projectClipProductionPackets } from "./execution.clip-production";
import { projectClipProductionPromptPackage } from "./execution.clip-production-project";
import { buildVideoProductionPlan } from "./execution.video-workflow-contract";
import type { ClipSourceSegment } from "./execution.clip-segmentation";
import { clipProductionBlockingFixture } from "./test-fixtures/clip-production-blocking";

const generationSpec = {
	prompt: "角色保持左颊伤痕，雨夜冷光，真实皮肤细节。",
	negativePrompt: "不要伤痕换边、消失或磨皮。",
	modelKey: "gpt-image-2",
	aspectRatio: "16:9",
	size: "2K",
};

function sourceSegment(clipId = "clip-0", clipIndex = 0): ClipSourceSegment {
	return {
		protocolVersion: "tapcanvas.clip-source-segment/v1",
		clipId,
		clipIndex,
		sourceId: "chapter-text",
		sourceFingerprint: "sha256:source",
		durationSeconds: 5,
		sourceRanges: [{ sourceIndex: 0, startOffset: 0, endOffset: 22, sourceId: "chapter-text", sourceFingerprint: "sha256:source" }],
		sourceSlices: [{ sourceIndex: 0, startOffset: 0, endOffset: 22, sourceId: "chapter-text", sourceFingerprint: "sha256:source", text: "原文冻结片段" }],
	};
}

function packet(mode: "image_to_video" | "reference_to_video" = "image_to_video") {
	return {
		protocolVersion: CLIP_PRODUCTION_PACKET_PROTOCOL_VERSION,
		clipId: "clip-0",
		clipIndex: 0,
		durationSeconds: 5,
		videoInputMode: mode,
		firstFrameAsset: mode === "image_to_video" ? { assetId: "character-a", state: "injured-v1" } : null,
		referenceAssets: [{ assetId: "character-a", state: "injured-v1" }],
		sourceRanges: sourceSegment().sourceRanges,
		videoPrompt: "完整且未改写的视频提示词：人物停在门边，手指轻触湿冷门框；镜头缓慢推进并保持左侧负空间。",
		blockingPlan: clipProductionBlockingFixture(),
		clipFacts: { action: { start: "停在门边", movement: "轻触门框", result: "抬眼" }, spatialAnchor: "左侧门框" },
		assetIntents: [{
			assetId: "character-a",
			state: "injured-v1",
			registryObjectId: "character-a",
			displayName: "张羽",
			referenceType: "character",
			referenceAssetBindings: [],
			imageSource: { mode: "generate", generationSpecVersion: "clip-image/v1", generationSpec },
		}],
	};
}

function projections(mode: "image_to_video" | "reference_to_video" = "image_to_video") {
	const segment = sourceSegment();
	const segments = createWorkflowCollection({ collectionId: "segments", producerNodeId: "segmentation", producerPortId: "clip-segments", itemIds: [segment.clipId], values: [segment] });
	const collected = projectClipProductionPackets({ executionId: "exec-1", nodeId: "collector", packets: [packet(mode)], sourceSegmentCollection: segments });
	const assetItems = projectClipProductionAssetItems({ executionId: "exec-1", nodeId: "asset-project", assetIntentCollection: collected.assetIntentCollection });
	const assetItem = assetItems.items[0]!.value;
	const assetBindings = createWorkflowCollection({
		collectionId: "generated-bindings",
		producerNodeId: "image-generate",
		producerPortId: "asset-bindings",
		itemIds: [assetItem.effectAssetId],
		values: [{
			assetPlan: assetItem,
			imageUrl: "https://media.example/character-a-injured.png",
			nodeId: "generated-image-node-0",
			generatedAssetId: "stored-image-asset-0",
		}],
	});
	return { collected, assetItems, assetBindings };
}

const deliveryContract = { protocolVersion: "2", workflowKey: "one-click-production/v1" };

describe("Clip production media projection", () => {
	it("projects explicit item generation settings and persistent image references into the existing package", () => {
		const result = projections();
		const projectedAsset = result.assetItems.items[0]!.value;
		expect(projectedAsset).toMatchObject({
			protocolVersion: "tapcanvas.clip-production-asset-item/v1",
				assetId: projectedAsset.effectAssetId,
				canonicalAssetId: "character-a",
				state: "injured-v1",
				modelKey: "gpt-image-2",
				aspectRatio: "16:9",
				size: "2K",
				prompt: generationSpec.prompt,
				negativePrompt: generationSpec.negativePrompt,
		});
		const promptPackage = projectClipProductionPromptPackage({
			executionId: "exec-1",
			workflowKey: "one-click-production/v1",
			clipProductionCollection: result.collected.clipProductionCollection,
			assetBindings: result.assetBindings,
			deliveryContract,
		});
		const clip = (promptPackage.clips as Record<string, unknown>[])[0]!;
		expect(promptPackage).toMatchObject({ artifactType: "tapcanvas.prompt-package/v2", authoringProtocol: "tapcanvas.clip-production-packets/v1" });
		expect(clip.prompt).toBe(packet().videoPrompt);
		expect(clip.structuredClip).toBeNull();
		expect(clip.clipFacts).toEqual(packet().clipFacts);
		expect(clip.sourceRanges).toEqual(packet().sourceRanges);
		expect(clip.videoInputMode).toBe("image_to_video");
		expect(clip.firstFrameUrl).toBe("https://media.example/character-a-injured.png");
		expect(clip.referenceImageNodeIds).toEqual(["generated-image-node-0"]);
		expect(clip.referenceAssetIds).toEqual(["stored-image-asset-0"]);
		expect(clip.assetBindings).toEqual([]);
	});

	it("keeps distinct effect bindings that reuse one provider image asset", () => {
		const segment = sourceSegment();
		const first = packet("reference_to_video");
		const secondIntent = {
			...first.assetIntents[0]!, assetId: "character-b", state: "base",
			registryObjectId: "character-b", displayName: "同一素材的另一对象引用",
		};
		const expanded = {
			...first,
			referenceAssets: [...first.referenceAssets, { assetId: "character-b", state: "base" }],
			assetIntents: [...first.assetIntents, secondIntent],
		};
		const collected = projectClipProductionPackets({
			executionId: "exec-1", nodeId: "collector", packets: [expanded],
			sourceSegmentCollection: createWorkflowCollection({
				collectionId: "segments", producerNodeId: "segmentation", producerPortId: "clip-segments",
				itemIds: [segment.clipId], values: [segment],
			}),
		});
		const assetItems = projectClipProductionAssetItems({
			executionId: "exec-1", nodeId: "asset-project", assetIntentCollection: collected.assetIntentCollection,
		});
		const assetBindings = createWorkflowCollection({
			collectionId: "bindings", producerNodeId: "image-generate", producerPortId: "asset-bindings",
			itemIds: assetItems.items.map((item) => item.itemId),
			values: assetItems.items.map((item, index) => ({
				assetPlan: item.value, imageUrl: "https://media.example/shared.png",
				nodeId: `effect-image-node-${index}`, generatedAssetId: "shared-provider-asset",
			})),
		});
		const promptPackage = projectClipProductionPromptPackage({
			executionId: "exec-1", workflowKey: "one-click-production/v1",
			clipProductionCollection: collected.clipProductionCollection, assetBindings, deliveryContract,
		});
		const plan = buildVideoProductionPlan({
			executionId: "exec-1", nodeId: "handoff", promptPackage,
			estimate: { estimateIdentity: "estimate-1", modelKey: "video-model", resolution: "720p", aspectRatio: "16:9" },
			generationContract: {
				videoModel: "video-model", durationOptions: [5], maxDurationSeconds: 5,
				referenceAudioPolicy: { minimumDurationSeconds: 0, maximumDurationSeconds: 0 },
				supportsReferenceImages: true, maxReferenceImages: 1,
			},
			assetBindings, voiceManifest: { protocolVersion: "tapcanvas.voice-manifest/v1", entries: [] },
		});
		expect(promptPackage.clips).toHaveLength(1);
		expect((promptPackage.clips as { imageReferences: unknown[] }[])[0]?.imageReferences).toHaveLength(2);
		expect(plan.items[0]?.value).toMatchObject({
			declaredAssetIds: assetItems.items.map((item) => item.itemId),
			referenceImageNodeIds: [], referenceAssetIds: ["shared-provider-asset"],
		});
	});

	it("preserves reference_to_video as a reference-only mode without inventing a first frame", () => {
		const result = projections("reference_to_video");
		const promptPackage = projectClipProductionPromptPackage({
			executionId: "exec-1", workflowKey: "one-click-production/v1",
			clipProductionCollection: result.collected.clipProductionCollection,
			assetBindings: result.assetBindings,
			deliveryContract,
		});
		const clip = (promptPackage.clips as Record<string, unknown>[])[0]!;
		expect(clip.videoInputMode).toBe("reference_to_video");
		expect(clip.firstFrameAsset).toBeNull();
		expect(clip.firstFrameEffectAssetId).toBeNull();
		expect(clip).not.toHaveProperty("firstFrameUrl");
		expect(clip.referenceImageNodeIds).toEqual(["generated-image-node-0"]);
	});

	it("fails before video submission if any generated reference lacks a real persistent URL", () => {
		const result = projections();
		const brokenBindings = createWorkflowCollection({
			collectionId: "broken",
			producerNodeId: "image-generate",
			producerPortId: "asset-bindings",
			itemIds: [result.assetItems.items[0]!.itemId],
			values: [{ assetPlan: result.assetItems.items[0]!.value, imageUrl: "data:image/png;base64,broken", nodeId: "image-node" }],
		});
		expect(() => projectClipProductionPromptPackage({
			executionId: "exec-1", workflowKey: "one-click-production/v1",
			clipProductionCollection: result.collected.clipProductionCollection,
			assetBindings: brokenBindings,
			deliveryContract,
		})).toThrow(/persistent HTTP\(S\) URL/);
	});
});
