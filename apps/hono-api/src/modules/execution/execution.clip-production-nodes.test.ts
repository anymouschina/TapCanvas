import { describe, expect, it } from "vitest";
import { createWorkflowCollection } from "@tapcanvas/workflow-kernel-protocol";
import { projectClipProductionPackets } from "./execution.clip-production";
import { projectClipProductionMediaItem, projectClipProductionNodePlan } from "./execution.clip-production-nodes";
import { projectClipProductionPromptPackage } from "./execution.clip-production-project";
import { clipProductionBlockingFixture } from "./test-fixtures/clip-production-blocking";

function source(index: number) {
	return { protocolVersion: "tapcanvas.clip-source-segment/v1", clipId: `clip-${index}`, clipIndex: index,
		sourceId: "chapter", sourceFingerprint: "sha256:chapter", durationSeconds: 5,
		sourceRanges: [{ sourceIndex: 0, startOffset: index * 10, endOffset: index * 10 + 10,
			sourceId: "chapter", sourceFingerprint: "sha256:chapter" }],
		sourceSlices: [{ sourceIndex: 0, startOffset: index * 10, endOffset: index * 10 + 10,
			sourceId: "chapter", sourceFingerprint: "sha256:chapter", text: "原文片段" }] };
}

function packet(index: number) {
	const segment = source(index);
	return { protocolVersion: "tapcanvas.clip-production-packet/v1", clipId: segment.clipId,
		clipIndex: index, durationSeconds: 5, videoInputMode: "image_to_video",
		firstFrameAsset: { assetId: "shared", state: "base" },
		referenceAssets: [{ assetId: "shared", state: "base" }], sourceRanges: segment.sourceRanges,
		videoPrompt: `Clip ${index} 的完整提示词`, blockingPlan: clipProductionBlockingFixture(), clipFacts: { action: { start: "起", movement: "行", result: "止" } },
		assetIntents: [{ assetId: "shared", state: "base", registryObjectId: "character-main",
			displayName: "主角", referenceType: "character", referenceAssetBindings: [],
			imageSource: { mode: "generate", generationSpecVersion: "v1",
				generationSpec: { prompt: "共享资产提示词", negativePrompt: "不要改变身份", modelKey: "image-model",
					aspectRatio: "16:9", size: "2K" } } }] };
}

function plan() {
	const segments = createWorkflowCollection({ collectionId: "segments", producerNodeId: "segments", producerPortId: "clip-segments",
		itemIds: ["clip-0", "clip-1"], values: [source(0), source(1)] });
	const packets = projectClipProductionPackets({ executionId: "execution", nodeId: "collect",
		packets: [packet(0), packet(1)], sourceSegmentCollection: segments });
	return projectClipProductionNodePlan({ executionId: "execution", executionFamilyId: "family", nodeId: "materialize",
		workflowKey: "workflow", clipProductionCollection: packets.clipProductionCollection,
		assetIntentCollection: packets.assetIntentCollection,
		deliveryContract: { protocolVersion: "2", workflowKey: "workflow" } });
}

describe("Clip node planning before media", () => {
	it("creates one video per Clip and one stable shared image without inventing a URL", () => {
		const projected = plan();
		expect(projected.nodePlan.imageNodes).toHaveLength(1);
		expect(projected.nodePlan.videoNodes).toHaveLength(2);
		expect(projected.nodePlan.videoNodes[0]?.sourceSnapshot).toEqual({ clipId: "clip-0",
			sourceRanges: packet(0).sourceRanges, clipFacts: packet(0).clipFacts });
		expect(projected.nodePlan.videoNodes[0]?.referenceImageNodeIds).toEqual(projected.nodePlan.videoNodes[1]?.referenceImageNodeIds);
		expect(projected.mediaItems.items.map((item) => item.itemId)).toEqual(["clip-0", "clip-1"]);
		expect(projected.mediaItems.items[0]?.value.assetItems[0]?.effectAssetId)
			.toBe(projected.mediaItems.items[1]?.value.assetItems[0]?.effectAssetId);
		expect(JSON.stringify(projected.nodePlan)).not.toContain("imageUrl");
		expect(projected.promptPackage).not.toHaveProperty("deliveryVerification");
	});

	it("projects each Clip media item into its own exact packet and shared asset item", () => {
		const projected = plan();
		const mediaItem = projected.mediaItems.items[1]!.value;
		const perClip = projectClipProductionMediaItem({ executionId: "execution", nodeId: "media-project", mediaItem });
		expect(perClip.clipProductionCollection.items.map((item) => item.itemId)).toEqual(["clip-1"]);
		expect(perClip.assetItems.items).toHaveLength(1);
		expect(perClip.preparedNodes.items[0]?.value.nodeId).toBe(projected.nodePlan.videoNodes[1]?.nodeId);
	});

	it("keeps a text-only Clip free of invented image nodes and URL dependencies", () => {
		const segment = source(0);
		const segments = createWorkflowCollection({ collectionId: "text-segments", producerNodeId: "segments", producerPortId: "clip-segments",
			itemIds: [segment.clipId], values: [segment] });
		const textPacket = { ...packet(0), videoInputMode: "text_to_video", firstFrameAsset: null,
			referenceAssets: [], assetIntents: [] };
		const collected = projectClipProductionPackets({ executionId: "execution", nodeId: "collect",
			packets: [textPacket], sourceSegmentCollection: segments });
		const projected = projectClipProductionNodePlan({ executionId: "execution", executionFamilyId: "family", nodeId: "materialize",
			workflowKey: "workflow", clipProductionCollection: collected.clipProductionCollection,
			assetIntentCollection: collected.assetIntentCollection,
			deliveryContract: { protocolVersion: "2", workflowKey: "workflow" } });
		expect(projected.nodePlan.imageNodes).toHaveLength(0);
		expect(projected.nodePlan.videoNodes[0]?.referenceImageNodeIds).toEqual([]);
		const complete = projectClipProductionPromptPackage({ executionId: "execution", workflowKey: "workflow",
			clipProductionCollection: collected.clipProductionCollection,
			assetBindings: createWorkflowCollection({ collectionId: "none", producerNodeId: "image", producerPortId: "asset-bindings",
				itemIds: [], values: [] }),
			deliveryContract: { protocolVersion: "2", workflowKey: "workflow" } });
		expect((complete.clips as Record<string, unknown>[])[0]).toMatchObject({ videoInputMode: "text_to_video",
			referenceImageNodeIds: [], referenceAssetIds: [] });
	});
});
