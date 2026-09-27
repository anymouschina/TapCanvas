import { describe, expect, it } from "vitest";
import { createWorkflowCollection, resolveWorkflowExecutorPortArtifactContract } from "@tapcanvas/workflow-kernel-protocol";
import {
	CLIP_PRODUCTION_ASSET_INTENTS_ARTIFACT_TYPE,
	CLIP_PRODUCTION_PACKET_COLLECTION_ARTIFACT_TYPE,
	CLIP_PRODUCTION_PACKET_PROTOCOL_VERSION,
	clipProductionPacketSchema,
} from "../../../../../packages/schemas/clip-production-packet/index.mjs";
import { bindClipProductionPacketAuthoringContract, clipProductionAssetMetadata, materializeClipProductionDraft, projectClipProductionPackets, verifyClipProductionPacketSourceBinding } from "./execution.clip-production";
import { PublicFlowCreateNodeSchema } from "../flow/flow.public.schemas";
import type { ClipSourceSegment } from "./execution.clip-segmentation";
import { validateWorkflowToolArguments } from "./execution.json-schema-validator";
import { clipProductionBlockingFixture } from "./test-fixtures/clip-production-blocking";

const generationSpec = {
	prompt: "保留角色的确切身份锚点与受伤状态",
	negativePrompt: "避免伤痕换边或消失",
	modelKey: "image-model",
	aspectRatio: "16:9",
	size: "2K",
};

function sourceSegment(clipIndex: number): ClipSourceSegment {
	return {
		protocolVersion: "tapcanvas.clip-source-segment/v1",
		clipId: `clip-${clipIndex}`,
		clipIndex,
		sourceId: "chapter-text",
		sourceFingerprint: "sha256:source",
		durationSeconds: 5,
		sourceRanges: [{ sourceIndex: 0, startOffset: clipIndex * 20, endOffset: clipIndex * 20 + 20, sourceId: "chapter-text", sourceFingerprint: "sha256:source" }],
		sourceSlices: [{ sourceIndex: 0, startOffset: clipIndex * 20, endOffset: clipIndex * 20 + 20, sourceId: "chapter-text", sourceFingerprint: "sha256:source", text: `原文片段${clipIndex}` }],
	};
}

function packet(clipIndex: number, options: Readonly<{ state?: string; prompt?: string; generationSpec?: Record<string, unknown> }> = {}) {
	const segment = sourceSegment(clipIndex);
	return {
		protocolVersion: CLIP_PRODUCTION_PACKET_PROTOCOL_VERSION,
		clipId: segment.clipId,
		clipIndex,
		durationSeconds: segment.durationSeconds,
		videoInputMode: "image_to_video",
		firstFrameAsset: { assetId: "character-main", state: options.state ?? "injured-left-cheek-v1" },
		referenceAssets: [{ assetId: "character-main", state: options.state ?? "injured-left-cheek-v1" }],
		sourceRanges: segment.sourceRanges,
		videoPrompt: `完整视频提示词 ${clipIndex}：人物动作、空间锚点与镜头连续运动。`,
		blockingPlan: clipProductionBlockingFixture(),
		clipFacts: { localAction: { start: "站在门边", movement: "向前一步", result: "停在门内" } },
		assetIntents: [{
			assetId: "character-main",
			state: options.state ?? "injured-left-cheek-v1",
			registryObjectId: "character-main",
			displayName: "张羽",
			referenceType: "character",
			referenceAssetBindings: [],
			imageSource: { mode: "generate", generationSpecVersion: "image-spec-v3",
				generationSpec: options.generationSpec ?? generationSpec },
		}],
	};
}

function sourceCollection(count: number) {
	const values = Array.from({ length: count }, (_, index) => sourceSegment(index));
	return createWorkflowCollection({
		collectionId: "execution-1:segments",
		producerNodeId: "segmentation",
		producerPortId: "clip-segments",
		values,
		itemIds: values.map((value) => value.clipId),
	});
}

describe("Clip production structural projection", () => {
	it("keeps authored asset purpose in the workflow namespace accepted by canvas nodes", () => {
		const metadata = clipProductionAssetMetadata({ registryObjectId: "character-main", displayName: "张羽",
			referenceType: "character", assetPurpose: "本段人物身份与受伤状态参考" });
		expect(metadata.workflowAssetPurpose).toBe("本段人物身份与受伤状态参考");
		expect(PublicFlowCreateNodeSchema.safeParse({ id: "image-1", type: "taskNode",
			position: { x: 0, y: 0 }, data: { ...metadata, kind: "image", label: "张羽" } }).success).toBe(true);
	});
	it("resolves a reuse draft index from the frozen chapter registry without asking the Agent to copy an opaque ID", () => {
		const assetId = "project-node:chapter:canvas:node::output::image";
		const chapterAssets = { text: JSON.stringify({
			objectRegistry: [{ objectId: "character-main", kind: "character", name: "张羽",
				imageSource: { mode: "reuse", assetIds: [assetId] } }],
			backgroundPlans: [{ objectId: "background-main", plan: {} }],
		}) };
		const bound = bindClipProductionPacketAuthoringContract({ allowedFields: [], jsonSchema: {} }, sourceSegment(0),
			undefined, "image-model", "16:9", "2K", chapterAssets, "project-1");
		const original = packet(0);
		const { firstFrameAsset: _firstFrameAsset, referenceAssets: _referenceAssets, ...base } = original;
		const { backgroundObjectId: _backgroundObjectId, ...blockingPlan } = original.blockingPlan;
		const draft = { ...base, firstFrameAssetIndex: 0, referenceAssetIndices: [0],
			imageModelKey: "image-model", imageAspectRatio: "16:9", imageSize: "2K",
			blockingPlan: { ...blockingPlan, backgroundPlanIndex: 0 },
			assetIntents: [{ registryObjectId: "character-main", imageSource: { mode: "reuse", registryAssetIndex: 0 } }] };
		expect(validateWorkflowToolArguments(bound.jsonSchema!, draft)).toEqual([]);
		const canonical = materializeClipProductionDraft(draft, chapterAssets, "project-1") as ReturnType<typeof packet>;
		expect(canonical.assetIntents[0]?.imageSource).toEqual({
			mode: "reuse", existingAssetId: assetId, existingProjectId: "project-1",
		});
		expect(canonical.firstFrameAsset).toEqual({ assetId: "chapter-object:character-main:reuse:0", state: "chapter-shared:reuse:0" });
		expect(canonical.referenceAssets).toEqual([canonical.firstFrameAsset]);
		expect(canonical.blockingPlan.backgroundObjectId).toBe("background-main");
		expect(validateWorkflowToolArguments(clipProductionPacketSchema, canonical)).toEqual([]);
		expect(verifyClipProductionPacketSourceBinding(canonical, sourceSegment(0)).assetIntents[0]?.imageSource)
			.toEqual(canonical.assetIntents[0]?.imageSource);
		expect(() => materializeClipProductionDraft({ ...draft, assetIntents: [{ ...draft.assetIntents[0],
			imageSource: { mode: "reuse", registryAssetIndex: 1 } }] }, chapterAssets, "project-1"))
			.toThrow(/outside the frozen selection/);
		expect(() => materializeClipProductionDraft({ ...draft, referenceAssetIndices: [1] }, chapterAssets, "project-1"))
			.toThrow(/outside the frozen assetIntents/);
	});
	it("deduplicates the same chapter image across Clips despite different local descriptions", () => {
		const chapterAssets = { objectRegistry: [{ objectId: "character-main", kind: "character", name: "张羽",
			physicalIdentityKey: "zhangyu-body-v1", imageSource: { mode: "generate", referenceAssetBindings: [],
				plan: { prompt: "章级共享角色卡", negativePrompt: "避免身份漂移", identityAnchors: ["同一人"] } } }],
			backgroundPlans: [{ objectId: "background-main", plan: {} }] };
		const drafts = [0, 1].map((index) => {
			const source = packet(index, { state: `本段局部状态-${index}`, prompt: `本段独立描述-${index}` });
			const { firstFrameAsset: _firstFrameAsset, referenceAssets: _referenceAssets, ...base } = source;
			const { backgroundObjectId: _backgroundObjectId, ...blockingPlan } = source.blockingPlan;
			return { ...base, imageModelKey: "image-model", imageAspectRatio: "16:9", imageSize: "2K",
				firstFrameAssetIndex: 0, referenceAssetIndices: [0],
				blockingPlan: { ...blockingPlan, backgroundPlanIndex: 0 },
				assetIntents: [{ registryObjectId: "character-main", imageSource: { mode: "generate" } }] };
		});
		const packets = drafts.map((draft) => materializeClipProductionDraft(draft, chapterAssets, "project-1"));
		const projection = projectClipProductionPackets({ executionId: "execution-shared", nodeId: "collector",
			packets, sourceSegmentCollection: sourceCollection(2), chapterAssets });
		expect(projection.assetIntentCollection.items).toHaveLength(1);
		expect(projection.assetIntentCollection.items[0]?.value.consumerClipIds).toEqual(["clip-0", "clip-1"]);
		expect(projection.assetIntentCollection.items[0]?.value.imageSource).toEqual({ mode: "generate",
			generationSpecVersion: "chapter-object-plan/v1", generationSpec: {
				prompt: "章级共享角色卡", negativePrompt: "避免身份漂移", modelKey: "image-model", aspectRatio: "16:9", size: "2K",
			} });
	});
	it("registers packet, source, and collection artifact ports", () => {
		expect(resolveWorkflowExecutorPortArtifactContract("video.clip-production.collect/v1")).toEqual({
			inputArtifactTypes: {
				packets: [CLIP_PRODUCTION_PACKET_PROTOCOL_VERSION],
				"clip-segments": ["tapcanvas.clip-source-segments/v1"],
				"chapter-assets": ["tapcanvas.chapter-asset-plan/v3"],
			},
			outputArtifactTypes: {
				"clip-production": [CLIP_PRODUCTION_PACKET_COLLECTION_ARTIFACT_TYPE],
				"asset-intents": [CLIP_PRODUCTION_ASSET_INTENTS_ARTIFACT_TYPE],
			},
		});
	});

	it("binds exact Clip identity, duration, and source ranges into the repairable author contract", () => {
		const segment = sourceSegment(3);
		const bound = bindClipProductionPacketAuthoringContract({
			allowedFields: ["stale-field"],
			jsonSchema: { type: "object", properties: { stale: { type: "string" } } },
		}, segment);
		const schema = bound.jsonSchema as Record<string, unknown>;
		const properties = schema.properties as Record<string, Record<string, unknown>>;
		expect(bound.allowedFields).toEqual([
			"protocolVersion", "clipId", "clipIndex", "durationSeconds", "videoInputMode",
			"firstFrameAsset", "referenceAssets", "sourceRanges",
			"videoPrompt", "blockingPlan", "clipFacts", "assetIntents",
		]);
		expect(properties.clipId).toMatchObject({ const: segment.clipId });
		expect(properties.clipIndex).toMatchObject({ const: segment.clipIndex });
		expect(properties.durationSeconds).toMatchObject({ const: segment.durationSeconds });
		expect(properties.sourceRanges?.const).toEqual(segment.sourceRanges);
		expect(bound.exactStringFields).toMatchObject({
			protocolVersion: CLIP_PRODUCTION_PACKET_PROTOCOL_VERSION,
			clipId: segment.clipId,
		});
	});

	it("exposes a registered schema accepted by the workflow JSON validator", () => {
		expect(validateWorkflowToolArguments(clipProductionPacketSchema, packet(0))).toEqual([]);
		expect(validateWorkflowToolArguments(clipProductionPacketSchema, { ...packet(0), extra: true })).not.toEqual([]);
		expect(validateWorkflowToolArguments(clipProductionPacketSchema, {
			...packet(0), blockingPlan: { ...clipProductionBlockingFixture(), backgroundObjectId: "" },
		})).not.toEqual([]);
	});

	it("preserves the exact prompt and source contract, then merges consumers by canonical asset state", () => {
		const sourceSegments = sourceCollection(2);
		const projection = projectClipProductionPackets({
			executionId: "execution-1",
			nodeId: "clip-production-collector",
			packets: [packet(1), packet(0)],
			sourceSegmentCollection: sourceSegments,
		});

		expect(projection.clipProductionCollection.collectionId).toBe("execution-1:clip-production-collector:clip-production");
		expect(projection.clipProductionCollection.items.map((item) => item.itemId)).toEqual(["clip-0", "clip-1"]);
		expect(projection.clipProductionCollection.items[0]?.value.videoPrompt).toBe(packet(0).videoPrompt);
		expect(projection.clipProductionCollection.items[0]?.value.sourceRanges).toEqual(sourceSegment(0).sourceRanges);
		expect(projection.clipProductionCollection.items[0]?.lineage).toHaveLength(sourceSegments.items[0]!.lineage.length + 1);
		expect(projection.assetIntentCollection.items).toHaveLength(1);
		expect(projection.assetIntentCollection.items[0]?.value.consumerClipIds).toEqual(["clip-0", "clip-1"]);
		expect(projection.assetIntentCollection.items[0]?.lineage).toHaveLength(sourceSegments.items[0]!.lineage.length + 1 + sourceSegments.items[1]!.lineage.length);
	});

	it("includes canonical state and complete generation facts in the stable image effect identity", () => {
		const sourceSegments = sourceCollection(2);
		const same = projectClipProductionPackets({
			executionId: "execution-1", nodeId: "collector", packets: [packet(1), packet(0)], sourceSegmentCollection: sourceSegments,
		}).assetIntentCollection.items[0]?.itemId;
		const otherState = projectClipProductionPackets({
			executionId: "execution-2", nodeId: "collector", packets: [packet(0, { state: "clean-face-v1" })], sourceSegmentCollection: sourceCollection(1),
		}).assetIntentCollection.items[0]?.itemId;
		const otherSpec = projectClipProductionPackets({
			executionId: "execution-3", nodeId: "collector", packets: [packet(0, { generationSpec: { ...generationSpec, prompt: "规格版本内容变化" } })], sourceSegmentCollection: sourceCollection(1),
		}).assetIntentCollection.items[0]?.itemId;

		expect(same).toMatch(/^clip-production-image-effect:/);
		expect(otherState).not.toBe(same);
		expect(otherSpec).not.toBe(same);
	});

	it("rejects any packet identity, duration, or source-range drift from frozen segmentation", () => {
		const sourceSegments = sourceCollection(1);
		const valid = packet(0);
		expect(() => projectClipProductionPackets({
			executionId: "execution-1", nodeId: "collector", packets: [{ ...valid, durationSeconds: 10 }], sourceSegmentCollection: sourceSegments,
		})).toThrow(/identity or duration differs/);
		expect(() => projectClipProductionPackets({
			executionId: "execution-1", nodeId: "collector", packets: [{ ...valid, sourceRanges: [{ ...valid.sourceRanges[0]!, endOffset: 19 }] }], sourceSegmentCollection: sourceSegments,
		})).toThrow(/sourceRanges differ/);
	});

	it("accepts the workflow limit of 80 Clips with stable source and asset collections", () => {
		const count = 80;
		const projection = projectClipProductionPackets({
			executionId: "execution-80",
			nodeId: "collector",
			packets: Array.from({ length: count }, (_, index) => packet(index)),
			sourceSegmentCollection: sourceCollection(count),
		});
		expect(projection.clipProductionCollection.items).toHaveLength(80);
		expect(projection.assetIntentCollection.items[0]?.value.consumerClipIds).toHaveLength(80);
	});
});
