import { describe, expect, it } from "vitest";
import { createWorkflowCollection } from "@tapcanvas/workflow-kernel-protocol";
import { projectClipProductionPackets } from "./execution.clip-production";
import { projectClipProductionMediaItem, projectClipProductionNodePlan } from "./execution.clip-production-nodes";
import { projectClipProductionPromptPackage } from "./execution.clip-production-project";
import { renderClipProductionReferencePrompt } from "./execution.clip-production-reference-prompt";
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
	return { protocolVersion: "tapcanvas.clip-production-packet/v2", clipId: segment.clipId,
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
		expect(projected.nodePlan.videoNodes[0]).toMatchObject({
			sourcePrompt: packet(0).videoPrompt,
			referenceBindings: [{ nodeId: projected.nodePlan.imageNodes[0]?.nodeId, name: "主角", referenceType: "character" }],
			referenceHeader: "参考：图1=主角。",
			prompt: `参考：图1=主角。\n${packet(0).videoPrompt}`,
		});
		expect((projected.promptPackage.clips as Record<string, unknown>[])[0]).toMatchObject({
			sourcePrompt: packet(0).videoPrompt,
			referenceHeader: "参考：图1=主角。",
			prompt: `参考：图1=主角。\n${packet(0).videoPrompt}`,
		});
		expect(projected.mediaItems.items.map((item) => item.itemId)).toEqual(["clip-0", "clip-1"]);
		expect(projected.mediaItems.items[0]?.value.assetItems[0]?.effectAssetId)
			.toBe(projected.mediaItems.items[1]?.value.assetItems[0]?.effectAssetId);
		expect(JSON.stringify(projected.nodePlan)).not.toContain("imageUrl");
		expect(projected.promptPackage).not.toHaveProperty("deliveryVerification");
	});

	it("preserves a non-zero chapter Clip index when materializing one per-Clip pipeline item", () => {
		const segment = source(1);
		const sourceSegments = createWorkflowCollection({ collectionId: "single-segment", producerNodeId: "segments",
			producerPortId: "clip-segments", itemIds: [segment.clipId], values: [segment] });
		const collected = projectClipProductionPackets({ executionId: "execution", nodeId: "collect",
			packets: [packet(1)], sourceSegmentCollection: sourceSegments });
		const projected = projectClipProductionNodePlan({ executionId: "execution", executionFamilyId: "family",
			nodeId: "materialize", workflowKey: "workflow", clipProductionCollection: collected.clipProductionCollection,
			assetIntentCollection: collected.assetIntentCollection,
			deliveryContract: { protocolVersion: "2", workflowKey: "workflow" } });

		expect(projected.nodePlan.videoNodes).toHaveLength(1);
		expect(projected.nodePlan.videoNodes[0]).toMatchObject({ clipId: "clip-1", clipIndex: 1 });
		expect(projected.mediaItems.items.map((item) => item.itemId)).toEqual(["clip-1"]);
		expect((projected.promptPackage.clips as Record<string, unknown>[])[0]).toMatchObject({
			itemId: "clip-1", index: 0, clipIndex: 1,
		});
	});

	it("includes the host-bound chapter speech track in both the prepared node and node prompt package", () => {
		const segment = source(0);
		const speechEvents = [{ speechEventId: "speech-1", speaker: "阿乔", delivery: "on_screen", text: "  我来。\n",
			textOrigin: "authored" as const, eventIndex: 0, clipId: "clip-0", sceneId: "scene", scope: "scene" as const, sourceRanges: [] }];
		const segments = createWorkflowCollection({ collectionId: "speech-segments", producerNodeId: "segments",
			producerPortId: "clip-segments", itemIds: [segment.clipId], values: [segment] });
		const collected = projectClipProductionPackets({ executionId: "execution", nodeId: "collect",
			packets: [{ ...packet(0), speechEvents }], sourceSegmentCollection: segments });
		const projected = projectClipProductionNodePlan({ executionId: "execution", executionFamilyId: "family",
			nodeId: "materialize", workflowKey: "workflow", clipProductionCollection: collected.clipProductionCollection,
			assetIntentCollection: collected.assetIntentCollection,
			deliveryContract: { protocolVersion: "2", workflowKey: "workflow" } });
		const video = projected.nodePlan.videoNodes[0]!;
		const expectedPrompt = renderClipProductionReferencePrompt({ prompt: packet(0).videoPrompt, speechEvents,
			bindings: video.referenceBindings, images: [{ sourceNodeIds: video.referenceImageNodeIds[0]
				? [video.referenceImageNodeIds[0]] : [] }] });
		expect(video.speechEvents).toEqual(speechEvents);
		expect(video.prompt).toBe(expectedPrompt);
		expect((projected.promptPackage.clips as Record<string, unknown>[])[0]).toMatchObject({
			prompt: expectedPrompt,
			speechEvents,
			authoringEvidence: { sourceDialogueLineIds: [], spokenLineIds: ["speech-1"] },
		});
		expect(projected.promptPackage.deliveryEvidence).toMatchObject({
			speechEvidenceStatus: "projected_from_clip_packets", narrativeSpeechLineCount: 1,
			sourceSpeechLineCount: 0, executableSpeechLineCount: 1,
		});
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
