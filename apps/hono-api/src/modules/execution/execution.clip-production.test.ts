import { describe, expect, it } from "vitest";
import { createWorkflowCollection, resolveWorkflowExecutorPortArtifactContract } from "@tapcanvas/workflow-kernel-protocol";
import {
	CLIP_PRODUCTION_ASSET_INTENTS_ARTIFACT_TYPE,
	CLIP_PRODUCTION_PACKET_COLLECTION_ARTIFACT_TYPE,
	CLIP_PRODUCTION_PACKET_PROTOCOL_VERSION,
	collectClipProductionPackets as collectClipPackets,
	clipProductionPacketSchema,
	validateClipProductionPacket,
} from "../../../../../packages/schemas/clip-production-packet/index.mjs";
import { bindClipProductionPacketAuthoringContract, bindFrozenClipSourceRanges, clipProductionAssetMetadata, clipSegmentPresence, clipTimelineSegments, materializeClipProductionDraft, projectChapterAssetPreviewItems, projectClipProductionAssetItems, projectClipProductionPackets, resolveClipProductionInputModesFromDeliveryContract, verifyClipProductionPacketSourceBinding } from "./execution.clip-production";
import { PublicFlowCreateNodeSchema } from "../flow/flow.public.schemas";
import type { ClipSourceSegment } from "./execution.clip-segmentation";
import { validateWorkflowToolArguments } from "./execution.json-schema-validator";
import { clipProductionBlockingFixture } from "./test-fixtures/clip-production-blocking";
import { globalSequenceFixture } from "./execution.chapter-sequence.fixture";
import { projectChapterSequence } from "./execution.chapter-sequence";

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

function timelineDraft(durations: readonly number[] = [2, 2, 1], scene = "药谷入口") {
	return {
		scene,
		shots: durations.map((_countMarker, index) => ({
			storyEventIds: [] as string[], speechEventIds: [] as string[],
			action: `人物动作${index + 1}`,
			camera: "",
			sound: "",
		})),
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
	it("offers a first frame only when an allowed video input mode takes one", () => {
		const chapterAssets = { text: JSON.stringify({
			objectRegistry: [{ objectId: "character-main", kind: "character", name: "张羽",
				imageSource: { mode: "reuse", assetIds: ["project-node:chapter:canvas:node::output::image"] } }],
			backgroundPlans: [{ objectId: "background-main", plan: {} }],
		}) };
		const firstFrameSchema = (modes: Parameters<typeof bindClipProductionPacketAuthoringContract>[2]) =>
			(bindClipProductionPacketAuthoringContract({ allowedFields: [], jsonSchema: {} }, sourceSegment(0),
				modes, "image-model", "16:9", "2K", chapterAssets, "project-1").jsonSchema as {
				properties: Record<string, Record<string, unknown>>;
			}).properties.firstFrameAssetIndex!;
		const referenceOnly = firstFrameSchema(["reference_to_video", "text_to_video"]);
		expect(referenceOnly.type).toBe("null");
		expect(referenceOnly.oneOf).toBeUndefined();
		expect(referenceOnly.description).toContain("referenceAssetIndices");
		const withImage = firstFrameSchema(["image_to_video", "reference_to_video"]);
		expect(withImage.oneOf).toEqual([{ type: "integer", minimum: 0 }, { type: "null" }]);
		expect(withImage.description).toContain("reference_to_video and text_to_video require null");
	});
	it("resolves a reuse draft index from the frozen chapter registry without asking the Agent to copy an opaque ID", () => {
		const assetId = "project-node:chapter:canvas:node::output::image";
		const chapterAssets = { text: JSON.stringify({
			objectRegistry: [{ objectId: "character-main", kind: "character", name: "张羽",
				imageSource: { mode: "reuse", assetIds: [assetId] } }],
			backgroundPlans: [{ objectId: "background-main", plan: {} }],
		}) };
		const bound = bindClipProductionPacketAuthoringContract({ allowedFields: [], jsonSchema: {} }, sourceSegment(0),
			["image_to_video"], "image-model", "16:9", "2K", chapterAssets, "project-1");
		const original = packet(0);
		const { firstFrameAsset: _firstFrameAsset, referenceAssets: _referenceAssets, ...base } = original;
		const draft = { ...base, videoPrompt: timelineDraft(), firstFrameAssetIndex: 0, referenceAssetIndices: [0],
			imageModelKey: "image-model", imageAspectRatio: "16:9", imageSize: "2K",
			blockingPlan: original.blockingPlan,
			assetIntents: [{ registryObjectId: "character-main", imageSource: { mode: "reuse", registryAssetIndex: 0 } }] };
		expect(validateWorkflowToolArguments(bound.jsonSchema!, draft)).toEqual([]);
		const canonical = materializeClipProductionDraft(draft, chapterAssets, "project-1") as ReturnType<typeof packet>;
		expect(canonical.assetIntents[0]?.imageSource).toEqual({
			mode: "reuse", existingAssetId: assetId, existingProjectId: "project-1",
		});
		expect(canonical.firstFrameAsset).toEqual({ assetId: "chapter-object:character-main:reuse:0", state: "chapter-shared:reuse:0" });
		expect(canonical.referenceAssets).toEqual([canonical.firstFrameAsset]);
		expect(canonical.blockingPlan).toHaveProperty("backgroundObjectId", "background-main");
		expect(validateWorkflowToolArguments(clipProductionPacketSchema, canonical)).toEqual([]);
		expect(verifyClipProductionPacketSourceBinding(canonical, sourceSegment(0)).assetIntents[0]?.imageSource)
			.toEqual(canonical.assetIntents[0]?.imageSource);
		const { blockingPlan: _blockingPlan, ...withoutStaging } = draft;
		expect(bound.requiredObjectFields).not.toContain("blockingPlan");
		expect(validateWorkflowToolArguments(bound.jsonSchema!, withoutStaging)).toEqual([]);
		expect(validateWorkflowToolArguments(bound.jsonSchema!, { ...withoutStaging, videoPrompt: timelineDraft([5]) })).toEqual([]);
		const materializedWithoutStaging = materializeClipProductionDraft(withoutStaging, chapterAssets, "project-1");
		expect(materializedWithoutStaging).not.toHaveProperty("blockingPlan");
		expect(validateWorkflowToolArguments(clipProductionPacketSchema, materializedWithoutStaging)).toEqual([]);
		expect(verifyClipProductionPacketSourceBinding(materializedWithoutStaging, sourceSegment(0))).not.toHaveProperty("blockingPlan");
		expect(() => materializeClipProductionDraft({ ...draft, assetIntents: [{ ...draft.assetIntents[0],
			imageSource: { mode: "reuse", registryAssetIndex: 1 } }] }, chapterAssets, "project-1"))
			.toThrow(/outside the frozen selection/);
		expect(() => materializeClipProductionDraft({ ...draft, referenceAssetIndices: [1] }, chapterAssets, "project-1"))
			.toThrow(/outside the frozen assetIntents/);
		const reorderedAssets = { text: JSON.stringify({
			...(JSON.parse(chapterAssets.text) as Record<string, unknown>),
			backgroundPlans: [{ objectId: "background-other", plan: {} }, { objectId: "background-main", plan: {} }],
		}) };
		expect((materializeClipProductionDraft(draft, reorderedAssets, "project-1") as {
			blockingPlan: { backgroundObjectId: string };
		}).blockingPlan.backgroundObjectId)
			.toBe("background-main");
		expect(() => materializeClipProductionDraft({ ...draft,
			blockingPlan: { ...draft.blockingPlan, backgroundObjectId: "background-missing" } }, reorderedAssets, "project-1"))
			.toThrow(/not in frozen chapter plans/);
	});
	it("deduplicates the same chapter image across Clips despite different local descriptions", () => {
		const chapterAssets = { objectRegistry: [{ objectId: "character-main", kind: "character", name: "张羽",
			physicalIdentityKey: "zhangyu-body-v1", imageSource: { mode: "generate", referenceAssetBindings: [],
				plan: { prompt: "章级共享角色卡", negativePrompt: "避免身份漂移", identityAnchors: ["同一人"] } } }],
			backgroundPlans: [{ objectId: "background-main", plan: {} }] };
		const drafts = [0, 1].map((index) => {
			const source = packet(index, { state: `本段局部状态-${index}`, prompt: `本段独立描述-${index}` });
			const { firstFrameAsset: _firstFrameAsset, referenceAssets: _referenceAssets, ...base } = source;
			return { ...base, videoPrompt: timelineDraft([5], `场景-${index}`), imageModelKey: "image-model", imageAspectRatio: "16:9", imageSize: "2K",
				firstFrameAssetIndex: 0, referenceAssetIndices: [0],
				blockingPlan: source.blockingPlan,
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
	it("previews chapter asset images with the exact effect identity Clip pipelines later claim", () => {
		const chapterAssets = { objectRegistry: [
			{ objectId: "character-main", kind: "character", name: "张羽", physicalIdentityKey: "zhangyu-body-v1",
				referenceRole: "identity", imageSource: { mode: "generate", referenceAssetBindings: [],
					plan: { prompt: "章级共享角色卡", negativePrompt: "避免身份漂移", identityAnchors: ["同一人"] } } },
			{ objectId: "prop-old", kind: "prop", name: "旧玉佩", imageSource: { mode: "reuse", assetIds: ["asset-existing"] } },
		], backgroundPlans: [{ objectId: "background-main", plan: {} }] };
		const draft = (() => {
			const source = packet(0, { state: "本段局部状态", prompt: "本段独立描述" });
			const { firstFrameAsset: _firstFrameAsset, referenceAssets: _referenceAssets, ...base } = source;
			return { ...base, videoPrompt: timelineDraft([5], "场景"), imageModelKey: "image-model", imageAspectRatio: "16:9", imageSize: "2K",
				firstFrameAssetIndex: 0, referenceAssetIndices: [0], blockingPlan: source.blockingPlan,
				assetIntents: [{ registryObjectId: "character-main", imageSource: { mode: "generate" } }] };
		})();
		const clipItems = projectClipProductionAssetItems({ executionId: "execution-shared", nodeId: "assets",
			assetIntentCollection: projectClipProductionPackets({ executionId: "execution-shared", nodeId: "collector",
				packets: [materializeClipProductionDraft(draft, chapterAssets, "project-1")],
				sourceSegmentCollection: sourceCollection(1), chapterAssets }).assetIntentCollection });
		const preview = projectChapterAssetPreviewItems({ executionId: "execution-shared", nodeId: "preview",
			chapterAssets, projectId: "project-1", imageModelKey: "image-model", imageAspectRatio: "16:9", imageSize: "2K" });

		// Reuse objects already exist; only generated identities are previewed.
		expect(preview.items.map((item) => item.value.registryObjectId)).toEqual(["character-main"]);
		const clipItem = clipItems.items[0]?.value;
		const previewItem = preview.items[0]?.value;
		expect(previewItem?.effectAssetId).toBe(clipItem?.effectAssetId);
		const { consumerClipIds: _clipConsumers, ...clipContract } = clipItem!;
		const { consumerClipIds: previewConsumers, ...previewContract } = previewItem!;
		expect(previewContract).toEqual(clipContract);
		expect(previewConsumers).toEqual([]);
		expect(clipProductionAssetMetadata(previewItem!)).toEqual(clipProductionAssetMetadata(clipItem!));
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
		}, segment, ["image_to_video"]);
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
		// Source ranges are host-owned provenance: optional for the author, bound after authoring.
		expect(properties.sourceRanges?.const).toBeUndefined();
		expect(schema.required).not.toContain("sourceRanges");
		expect(bound.requiredArrayFields).toEqual(["assetIntents"]);
		expect(properties.videoPrompt).toMatchObject({ type: "object", required: ["scene", "shots"] });
		expect(bound.requiredStringFields).toEqual(["protocolVersion", "clipId"]);
		expect(bound.requiredObjectFields).toContain("videoPrompt");
		expect(bound.exactStringFields).toMatchObject({
			protocolVersion: CLIP_PRODUCTION_PACKET_PROTOCOL_VERSION,
			clipId: segment.clipId,
		});
	});

	it("binds the frozen source ranges after authoring whether the author omitted or miscopied them", () => {
		const segment = sourceSegment(3);
		const { sourceRanges: _omitted, ...authored } = packet(3);
		expect(bindFrozenClipSourceRanges(authored, segment)).toHaveProperty("sourceRanges", segment.sourceRanges);
		const miscopied = { ...authored, sourceRanges: [{ ...segment.sourceRanges[0]!, endOffset: 1 }] };
		expect(bindFrozenClipSourceRanges(miscopied, segment)).toHaveProperty("sourceRanges", segment.sourceRanges);
	});

	it("limits Clip author modes to capabilities explicitly frozen by the delivery contract", () => {
		const deliveryContract = { generationContract: {
			supportsTextToVideo: true,
			supportsReferenceImages: true,
			supportsFirstLastFrame: false,
		} };
		const allowedModes = resolveClipProductionInputModesFromDeliveryContract(deliveryContract);
		const bound = bindClipProductionPacketAuthoringContract(
			{ allowedFields: [], jsonSchema: {} }, sourceSegment(0), allowedModes,
		);
		const schema = bound.jsonSchema as { properties: { videoInputMode: { enum: string[] } } };
		expect(allowedModes).toEqual(["reference_to_video", "text_to_video"]);
		expect(schema.properties.videoInputMode.enum).toEqual(allowedModes);
		expect(validateWorkflowToolArguments(bound.jsonSchema!, { ...packet(0), videoInputMode: "reference_to_video", firstFrameAsset: null, videoPrompt: timelineDraft() })).toEqual([]);
		// The packet validator rejects a first frame outside image_to_video; the schema now says so before authoring.
		expect(validateWorkflowToolArguments(bound.jsonSchema!, { ...packet(0), videoInputMode: "reference_to_video", videoPrompt: timelineDraft() }))
			.toEqual([{ path: "$.firstFrameAsset", message: "$.firstFrameAsset must be null" }]);
		expect(validateWorkflowToolArguments(bound.jsonSchema!, packet(0))).not.toEqual([]);
	});

	it("does not infer text or image input support from missing or false capability facts", () => {
		expect(resolveClipProductionInputModesFromDeliveryContract({ generationContract: {
			supportsTextToVideo: false,
			supportsReferenceImages: false,
			supportsFirstLastFrame: false,
		} })).toEqual([]);
		expect(resolveClipProductionInputModesFromDeliveryContract({ generationContract: {
			supportsReferenceImages: true,
		} })).toEqual(["reference_to_video"]);
		expect(() => bindClipProductionPacketAuthoringContract(
			{ allowedFields: [], jsonSchema: {} }, sourceSegment(0), [],
		)).toThrow("clip-production allowed video input modes must not be empty");
	});

	it("exposes a registered schema accepted by the workflow JSON validator", () => {
		expect(validateWorkflowToolArguments(clipProductionPacketSchema, packet(0))).toEqual([]);
		expect(validateWorkflowToolArguments(clipProductionPacketSchema, { ...packet(0), extra: true })).not.toEqual([]);
		expect(validateWorkflowToolArguments(clipProductionPacketSchema, {
			...packet(0), blockingPlan: { ...clipProductionBlockingFixture(), backgroundObjectId: "" },
		})).not.toEqual([]);
	});

	it("preserves frozen entrances through explicit story references independently of cut count", () => {
		const chapterAssets = { text: JSON.stringify({
			objectRegistry: [{ objectId: "character-main", kind: "character", name: "张羽",
				imageSource: { mode: "reuse", assetIds: ["character-image"] } }],
			backgroundPlans: [{ objectId: "background-main", plan: {} }],
		}) };
		const story = (eventId: string, eventIndex: number, onScreen: string[]) => ({ eventId, eventIndex, action: eventId, sourceRanges: [], onScreen });
		const clipSequence = { protocolVersion: "tapcanvas.chapter-sequence-clip/v2", clipId: "clip-0", clipIndex: 0, durationSeconds: 5,
			speechEvents: [], storyEvents: [story("waits", 0, ["张羽"]), story("enters", 1, ["张羽", "母亲"])] };
		const contract = bindClipProductionPacketAuthoringContract({ allowedFields: [], jsonSchema: {} }, sourceSegment(0),
			["image_to_video"], "image-model", "16:9", "2K", chapterAssets, "project-1", clipSequence);
		const shots = ((contract.jsonSchema as { properties: Record<string, Record<string, Record<string, Record<string, unknown>>>> })
			.properties.videoPrompt!.properties!.shots!) as { description: string };
		const facts = JSON.parse(shots.description.split("\n").at(-1)!) as { presenceTimeline: unknown[] };
		expect(facts.presenceTimeline).toEqual([
			{ storyEventIds: ["waits"], onStage: ["张羽"], entering: [], leaving: [] },
			{ storyEventIds: ["enters"], onStage: ["张羽"], entering: ["母亲"], leaving: [] },
		]);
		const { firstFrameAsset: _firstFrameAsset, referenceAssets: _referenceAssets, ...baseDraft } = packet(0);
		const compiled = materializeClipProductionDraft({ ...baseDraft, videoPrompt: { scene: "", shots: [{ storyEventIds: ["waits"], speechEventIds: [], action: "张羽等待", camera: "", sound: "" }, { storyEventIds: ["enters"], speechEventIds: [], action: "母亲推门进来", camera: "", sound: "" }, { storyEventIds: ["enters"], speechEventIds: [], action: "母亲走到桌边", camera: "", sound: "" }] },
			firstFrameAssetIndex: 0, referenceAssetIndices: [0], imageModelKey: "image-model", imageAspectRatio: "16:9", imageSize: "2K",
			assetIntents: [{ registryObjectId: "character-main", imageSource: { mode: "reuse", registryAssetIndex: 0 } }] },
		chapterAssets, "project-1", clipSequence) as { videoPrompt: string };
		const rows = compiled.videoPrompt.split("\n");
		// Internal presence facts remain available to the author but are never added to provider prose.
		expect(rows).toEqual(["镜头1：张羽等待", "镜头2：母亲推门进来", "镜头3：母亲走到桌边"]);
		expect(compiled.videoPrompt).not.toContain("人物：");
		expect(compiled.videoPrompt).not.toContain("全段没有人");
	});

	it("keeps internal system voice and staging evidence outside the executable provider body", () => {
		const speech = { speechEventId: "internal-speech", speaker: "系统提示音", delivery: "机械音", text: "【评定三星】",
			textOrigin: "authored", voice: "offscreen", eventIndex: 0, clipId: "clip-0", sceneId: "room", scope: "beat", storyEventId: "internal-event", sourceRanges: [] };
		const sequence = { protocolVersion: "tapcanvas.chapter-sequence-clip/v2", clipId: "clip-0", clipIndex: 0, durationSeconds: 5,
			speechEvents: [speech], storyEvents: [{ eventId: "internal-event", eventIndex: 0, sceneId: "room", onScreen: ["顾观棋", "系统提示音"], action: "内部剧情账本", sourceRanges: [], reviewNote: "internal-continuity-review" }] };
		const original = { ...packet(0), clipFacts: { sequenceClipId: "clip-0", provenance: "internal-provenance" },
			videoPrompt: { scene: "酒楼门口", shots: [{ action: "两女迈入雅间，金色面板显示“三星”。", camera: "中景", sound: "脚步声", storyEventIds: ["internal-event"], speechEventIds: ["internal-speech"] }] } };
		const compiled = materializeClipProductionDraft(original, undefined, "", sequence) as { videoPrompt: string; speechEvents: unknown; clipFacts: unknown };
		expect(compiled.videoPrompt).toBe("【酒楼门口】\n镜头1：两女迈入雅间，金色面板显示“三星”。；中景；音效：脚步声；系统提示音画外音（机械音）：“【评定三星】”");
		expect(compiled.speechEvents).toEqual([speech]);
		expect(compiled.clipFacts).toEqual(original.clipFacts);
		expect(compiled.videoPrompt).not.toContain("internal-");
		expect(compiled.videoPrompt).not.toContain("人物：");
		expect(compiled.videoPrompt).not.toContain("不开口");
		expect(compiled.videoPrompt).not.toContain("无画面文字");
	});

	it("preserves cast across ordered story events without inventing gap windows", () => {
		const clipSequence = { storyEvents: [
			{ eventId: "opening", eventIndex: 0, onScreen: ["张羽"] },
			{ eventId: "ending", eventIndex: 1, onScreen: ["张羽"] }], speechEvents: [] };
		const facts = clipTimelineSegments(clipSequence);
		expect(facts).toEqual([{ storyEventIds: ["opening"], speechEventIds: [] }, { storyEventIds: ["ending"], speechEventIds: [] }]);
		expect(clipSegmentPresence(clipSequence, facts)).toEqual(facts.map(() => ({ onStage: ["张羽"], entering: [], leaving: [] })));
	});

	it("treats the cast opening another scene as already there, not as walking in", () => {
		// A flashback cuts back to the room where everyone was already seated.
		const clipSequence = {
			storyEvents: [
				{ eventId: "flashback", sceneId: "flashback", eventIndex: 0, onScreen: ["林嫣儿", "沈清秋"] },
				{ eventId: "room", sceneId: "room", eventIndex: 1, onScreen: ["顾观棋", "林嫣儿", "沈清秋"] },
				{ eventId: "arrival", sceneId: "room", eventIndex: 2, onScreen: ["顾观棋", "林嫣儿", "沈清秋", "小二"] },
			],
			speechEvents: [],
		};
		const facts = clipTimelineSegments(clipSequence);
		expect(clipSegmentPresence(clipSequence, facts)).toEqual([
			{ onStage: ["林嫣儿", "沈清秋"], entering: [], leaving: [] },
			{ onStage: ["顾观棋", "林嫣儿", "沈清秋"], entering: [], leaving: [], sceneChange: true },
			// Within one scene a newcomer still enters.
			{ onStage: ["顾观棋", "林嫣儿", "沈清秋"], entering: ["小二"], leaving: [] },
		]);
	});

	it("does not announce a cut when the next scene opens with the cast already on stage", () => {
		// ch1 Clip 11: scene-8 and scene-9 are two dramatic scenes in the same room.
		const clipSequence = {
			storyEvents: [
				{ eventId: "turn", sceneId: "scene-8-refusal-and-turn", eventIndex: 0, onScreen: ["顾观棋", "林嫣儿", "沈清秋"] },
				{ eventId: "match", sceneId: "scene-9-shen-qingqiu-match", eventIndex: 1, onScreen: ["顾观棋", "林嫣儿", "沈清秋"] },
			],
			speechEvents: [],
		};
		const facts = clipTimelineSegments(clipSequence);
		expect(clipSegmentPresence(clipSequence, facts)?.some((row) => row.sceneChange)).toBe(false);
	});

	it("host-binds the frozen chapter speech track after authoring, including an explicitly empty track", () => {
		const chapterAssets = { text: JSON.stringify({
			objectRegistry: [{ objectId: "character-main", kind: "character", name: "张羽",
				imageSource: { mode: "reuse", assetIds: ["character-image"] } }],
			backgroundPlans: [{ objectId: "background-main", plan: {} }],
		}) };
		const base = packet(0);
		const { firstFrameAsset: _firstFrameAsset, referenceAssets: _referenceAssets, ...baseDraft } = base;
		const draft = { ...baseDraft, videoPrompt: timelineDraft([2, 2, 1]),
			firstFrameAssetIndex: 0, referenceAssetIndices: [0], imageModelKey: "image-model",
			imageAspectRatio: "16:9", imageSize: "2K",
			assetIntents: [{ registryObjectId: "character-main", imageSource: { mode: "reuse", registryAssetIndex: 0 } }],
		};
		const speechEvent = { speechEventId: "speech-1", speaker: "张羽", delivery: "on_screen", text: "我来。",
			textOrigin: "authored", eventIndex: 0, clipId: "clip-0", sceneId: "scene", scope: "scene",
			sourceRanges: [] };
		const clipSequence = { protocolVersion: "tapcanvas.chapter-sequence-clip/v2", clipId: "clip-0", clipIndex: 0,
			durationSeconds: 5, storyEvents: [], speechEvents: [speechEvent] };
		const contract = bindClipProductionPacketAuthoringContract({ allowedFields: [], jsonSchema: {} }, sourceSegment(0),
			["image_to_video"], "image-model", "16:9", "2K", chapterAssets, "project-1", clipSequence);
		const schema = contract.jsonSchema as { properties: Record<string, unknown>; required: string[] };
		expect(schema.properties.speechEvents).toBeUndefined();
		expect(schema.required).not.toContain("speechEvents");
		draft.videoPrompt.shots[0]!.speechEventIds = [speechEvent.speechEventId];
		const bound = materializeClipProductionDraft(draft, chapterAssets, "project-1", clipSequence);
		expect((bound as Record<string, unknown>).speechEvents).toEqual([speechEvent]);
		expect((bound as Record<string, unknown>).videoPrompt).toContain("镜头1：人物动作1；张羽（on_screen）说：“我来。”\n镜头2：人物动作2\n");
		expect(validateClipProductionPacket(bound)).toHaveProperty("speechEvents", [speechEvent]);
		draft.videoPrompt.shots[0]!.speechEventIds = [];
		const emptyTrack = materializeClipProductionDraft(draft, chapterAssets, "project-1", { ...clipSequence, speechEvents: [] });
		expect(emptyTrack).toHaveProperty("speechEvents", []);
	});

	it("preserves selected references without requiring a scene image or completing omitted references", () => {
		const chapterAssets = { text: JSON.stringify({
			objectRegistry: [
				{ objectId: "character-main", kind: "character", name: "张羽", imageSource: { mode: "reuse", assetIds: ["character-image"] } },
				{ objectId: "scene-room", kind: "scene", name: "出租屋", imageSource: { mode: "reuse", assetIds: ["room-image"] } },
			],
			backgroundPlans: [{ objectId: "background-main", plan: {} }],
		}) };
		const { firstFrameAsset: _firstFrameAsset, referenceAssets: _referenceAssets, ...baseDraft } = packet(0);
		const clipSequence = { protocolVersion: "tapcanvas.chapter-sequence-clip/v2", clipId: "clip-0", clipIndex: 0,
			durationSeconds: 5, speechEvents: [] };
		const character = { registryObjectId: "character-main", imageSource: { mode: "reuse", registryAssetIndex: 0 } };
		const room = { registryObjectId: "scene-room", imageSource: { mode: "reuse", registryAssetIndex: 0 } };
		const draft = (assetIntents: unknown[], referenceAssetIndices: number[], clipFacts: typeof baseDraft.clipFacts & { sceneReferenceGap?: string } = baseDraft.clipFacts) => ({ ...baseDraft, clipFacts,
			videoPrompt: timelineDraft([2, 2, 1]), firstFrameAssetIndex: null, referenceAssetIndices, videoInputMode: "reference_to_video",
			imageModelKey: "image-model", imageAspectRatio: "16:9", imageSize: "2K", assetIntents });
		const contract = bindClipProductionPacketAuthoringContract({ allowedFields: [], jsonSchema: {} }, sourceSegment(0),
			["reference_to_video"], "image-model", "16:9", "2K", chapterAssets, "project-1", clipSequence);
		const references = (contract.jsonSchema as { properties: Record<string, { description: string }> }).properties.referenceAssetIndices!;
		expect(references.description).toContain("does not add omitted character or scene references");
		expect(() => materializeClipProductionDraft(draft([character], [0]), chapterAssets, "project-1", clipSequence))
			.not.toThrow();
		// Unselected declared intents stay out of the video reference list.
		const completed = materializeClipProductionDraft(draft([character, room], [0]), chapterAssets, "project-1", clipSequence) as { referenceAssets: unknown[] };
		expect(completed.referenceAssets).toHaveLength(1);
		const bound = materializeClipProductionDraft(draft([character, room], [0, 1]), chapterAssets, "project-1", clipSequence) as { referenceAssets: unknown[] };
		expect(bound.referenceAssets).toHaveLength(2);
		expect(() => materializeClipProductionDraft(draft([character], [0], { ...baseDraft.clipFacts, sceneReferenceGap: "本段在街上，没有对应的场景对象" }),
			chapterAssets, "project-1", clipSequence)).not.toThrow();
	});

	it("leaves character reference selection to the author without a presence gate", () => {
		const chapterAssets = { text: JSON.stringify({
			objectRegistry: [
				{ objectId: "character-a", kind: "character", name: "张羽", imageSource: { mode: "reuse", assetIds: ["a"] } },
				{ objectId: "character-b", kind: "character", name: "母亲", imageSource: { mode: "reuse", assetIds: ["b"] } },
				{ objectId: "scene-room", kind: "scene", name: "出租屋", imageSource: { mode: "reuse", assetIds: ["room"] } },
			],
			backgroundPlans: [{ objectId: "background-main", plan: {} }],
		}) };
		const { firstFrameAsset: _firstFrameAsset, referenceAssets: _referenceAssets, ...baseDraft } = packet(0);
		const clipSequence = { protocolVersion: "tapcanvas.chapter-sequence-clip/v2", clipId: "clip-0", clipIndex: 0, durationSeconds: 5,
			speechEvents: [], storyEvents: [{ eventId: "e1", eventIndex: 0, action: "张羽独坐", sourceRanges: [], onScreen: ["张羽"] }] };
		const intent = (registryObjectId: string) => ({ registryObjectId, imageSource: { mode: "reuse", registryAssetIndex: 0 } });
		const draft = (ids: string[]) => ({ ...baseDraft, videoPrompt: { scene: "", shots: [{ action: "张羽独坐", camera: "", sound: "", storyEventIds: ["e1"], speechEventIds: [] }] }, firstFrameAssetIndex: null,
			referenceAssetIndices: ids.map((_, index) => index), videoInputMode: "reference_to_video",
			imageModelKey: "image-model", imageAspectRatio: "16:9", imageSize: "2K", assetIntents: ids.map(intent) });
		const contract = bindClipProductionPacketAuthoringContract({ allowedFields: [], jsonSchema: {} }, sourceSegment(0),
			["reference_to_video"], "image-model", "16:9", "2K", chapterAssets, "project-1", clipSequence);
		expect((contract.jsonSchema as { properties: Record<string, { description: string }> }).properties.referenceAssetIndices!.description)
			.toContain("exact author-selected reference order");
		// Reference purpose and visible cast are independent author facts.
		expect(() => materializeClipProductionDraft(draft(["character-a", "character-b", "scene-room"]), chapterAssets, "project-1", clipSequence))
			.not.toThrow();
		expect(() => materializeClipProductionDraft(draft(["scene-room"]), chapterAssets, "project-1", clipSequence))
			.not.toThrow();
		expect(() => materializeClipProductionDraft(draft(["character-a", "scene-room"]), chapterAssets, "project-1", clipSequence)).not.toThrow();
	});

	it("compiles descriptive shots while keeping frozen whole speech and source text", () => {
		const authoredText = "  我来，\n现在。 ";
		const speechEvent = { speechEventId: "speech-cross-cut", speaker: "张羽", delivery: "自然接话", text: authoredText,
			textOrigin: "authored" as const, eventIndex: 0, clipId: "clip-0", sceneId: "scene", scope: "scene", sourceRanges: [] };
		const clipSequence = { protocolVersion: "tapcanvas.chapter-sequence-clip/v2", clipId: "clip-0", clipIndex: 0,
			durationSeconds: 5, speechEvents: [speechEvent], storyEvents: [] };
		const source = packet(0);
		const compiled = materializeClipProductionDraft({ ...source, videoPrompt: {
			scene: "药谷入口的石阶被雨打湿",
			shots: [{ storyEventIds: [], speechEventIds: [], action: "张羽跨过门槛", camera: "镜头贴着石阶向前移动", sound: "雨声持续" },
				{ storyEventIds: [], speechEventIds: [speechEvent.speechEventId], action: "张羽在廊下停住，抬头开口", camera: "", sound: "" }, { storyEventIds: [], speechEventIds: [], action: "张羽望向雨幕", camera: "", sound: "" }],
		} }, undefined, "", clipSequence) as ReturnType<typeof packet>;
		expect(compiled.videoPrompt).toBe(
			`【药谷入口的石阶被雨打湿】\n镜头1：张羽跨过门槛；镜头贴着石阶向前移动；音效：雨声持续\n`
			+ `镜头2：张羽在廊下停住，抬头开口；张羽（自然接话）说：“${authoredText}”\n`
			+ `镜头3：张羽望向雨幕`,
		);
		expect((compiled as Record<string, unknown>).speechEvents).toEqual([speechEvent]);
		expect(validateClipProductionPacket(compiled).videoPrompt).toBe(compiled.videoPrompt);
		// Changing shot count does not restart, duplicate or truncate the spoken line.
		for (const durations of [[2, 2, 1], [1, 1, 1, 1, 1]]) {
			const draft = timelineDraft(durations, "");
			draft.shots[0]!.speechEventIds = [speechEvent.speechEventId];
			const edited = materializeClipProductionDraft({ ...source, videoPrompt: draft }, undefined, "", clipSequence) as ReturnType<typeof packet>;
			expect((edited as Record<string, unknown>).speechEvents).toEqual([speechEvent]);
			expect(edited.videoPrompt.split(`张羽（自然接话）说：“${authoredText}”`)).toHaveLength(2);
			expect(edited.videoPrompt.split("\n").filter((line) => /^镜头\d+：/.test(line))).toHaveLength(durations.length);
			// The whole line begins once; model timing owns its continuation across cuts.
			expect(edited.videoPrompt).not.toContain("这句话一直说到");
			expect(edited.videoPrompt).not.toMatch(/台词（|还在继续/);
		}
	});

	it("provides whole frozen facts without imposing their boundaries as required shots", () => {
		const clipSequence = { protocolVersion: "tapcanvas.chapter-sequence-clip/v2", clipId: "clip-0", clipIndex: 0, durationSeconds: 5,
			startKeyframe: { state: "刚进门", visual: "张羽站在门槛" },
			endKeyframe: { state: "作息差距被点破", visual: "面试官前倾、张羽后仰" },
			nextBoundary: { startKeyframe: { state: "作息差距被点破", visual: "面试官前倾、张羽后仰" } },
			storyEvents: [{ eventId: "se-1", eventIndex: 0, action: "面试官点出成绩" }],
			speechEvents: [{ speechEventId: "sp-1", speaker: "面试官", delivery: "平直", text: "成绩不错。",
				textOrigin: "source_quote", eventIndex: 0, clipId: "clip-0", sceneId: "scene", scope: "beat", storyEventId: "se-1", sourceRanges: [] }] };
		const contract = bindClipProductionPacketAuthoringContract({ allowedFields: [], jsonSchema: {} }, sourceSegment(0),
			["image_to_video"], undefined, undefined, undefined, undefined, undefined, clipSequence);
		const shots = ((contract.jsonSchema as { properties: Record<string, { properties: Record<string, Record<string, unknown>> }> })
			.properties.videoPrompt.properties.shots) as Record<string, unknown> & { items: { properties: Record<string, unknown>; required: string[] } };
		expect(shots.minItems).toBe(1);
		expect(shots.maxItems).toBeUndefined();
		expect(shots.items.properties.durationSeconds).toBeUndefined();
		expect(shots.items.required).toEqual(["action", "camera", "sound", "storyEventIds", "speechEventIds"]);
		const plan = String(shots.description);
		const facts = JSON.parse(plan.split("\n").at(-1)!) as Record<string, unknown>;
		expect(facts).toEqual({ startKeyframe: clipSequence.startKeyframe, endKeyframe: clipSequence.endKeyframe,
			nextBoundary: clipSequence.nextBoundary, storyEvents: clipSequence.storyEvents, speechEvents: clipSequence.speechEvents });
		expect(plan).not.toContain("shots[0]");
		expect(validateWorkflowToolArguments(contract.jsonSchema!, { ...packet(0), videoPrompt: timelineDraft([2, 2, 1]),
			clipFacts: { sequenceClipId: clipSequence.clipId } })).toEqual([]);
		expect(validateWorkflowToolArguments(contract.jsonSchema!, { ...packet(0), videoPrompt: timelineDraft([1, 1, 1, 1, 1]),
			clipFacts: { sequenceClipId: clipSequence.clipId } })).toEqual([]);
	});

	it("lists the previous window's frozen events but only the cut state of the next window", () => {
		const keyframe = { state: "简历被丢进废纸篓", visual: "张羽转身走向门口" };
		const clipSequence = { protocolVersion: "tapcanvas.chapter-sequence-clip/v2", clipId: "clip-1", clipIndex: 1, durationSeconds: 5,
			startKeyframe: keyframe, endKeyframe: { state: "瘫坐", visual: "桌前" },
			previousBoundary: { clipId: "clip-0", endKeyframe: keyframe,
				storyEvents: [{ eventId: "se-1", action: "面试官质问作息", eventIndex: 0 }] },
			nextBoundary: { clipId: "clip-2", startKeyframe: { state: "瘫坐", visual: "桌前" },
				storyEvents: [{ eventId: "se-3", action: "收到借贷广告", eventIndex: 2 }] },
			storyEvents: [{ eventId: "se-2", eventIndex: 1, action: "奔波招生摊位" }], speechEvents: [] };
		const contract = bindClipProductionPacketAuthoringContract({ allowedFields: [], jsonSchema: {} }, sourceSegment(1),
			["image_to_video"], undefined, undefined, undefined, undefined, undefined, clipSequence);
		const shots = ((contract.jsonSchema as { properties: Record<string, { properties: Record<string, Record<string, unknown>> }> })
			.properties.videoPrompt.properties.shots) as Record<string, unknown>;
		const plan = String(shots.description);
		const facts = JSON.parse(plan.split("\n").at(-1)!) as Record<string, unknown>;
		expect(facts.previousBoundary).toEqual(clipSequence.previousBoundary);
		// The next window's actions were harvested to fill this Clip's last seconds; keep only the cut state.
		expect(facts.nextBoundary).toEqual({ clipId: "clip-2", startKeyframe: { state: "瘫坐", visual: "桌前" } });
		expect(facts.storyEvents).toEqual(clipSequence.storyEvents);
		expect(facts.startKeyframe).toEqual(keyframe);
		expect(plan).toContain("Previous/next boundaries are context, not extra events assigned to this Clip.");
		const videoPrompt = (contract.jsonSchema as { properties: { videoPrompt: { description: string; properties: { scene: { description: string } } } } })
			.properties.videoPrompt;
		expect(videoPrompt.description).toContain("Numbered 镜头 rows combine action, camera, on-set sound and complete spoken lines with Chinese quotes");
		expect(videoPrompt.properties.scene.description).toContain("rendered once as 【scene】");
		expect(videoPrompt.properties.scene.description).toContain("optional shot.sceneTitle");
	});

	it("binds whole ordered events to the Clip that owns them", () => {
		const clipSequence = { protocolVersion: "tapcanvas.chapter-sequence-clip/v2", clipId: "clip-1", clipIndex: 1, durationSeconds: 5,
			storyEvents: [{ eventId: "se-awards", eventIndex: 2, clipId: "clip-1", action: "看到满墙奖状，以为能凭学霸底子筑基" }],
			speechEvents: [] };
		const contract = bindClipProductionPacketAuthoringContract({ allowedFields: [], jsonSchema: {} }, sourceSegment(1),
			["image_to_video"], undefined, undefined, undefined, undefined, undefined, clipSequence);
		const plan = String(((contract.jsonSchema as { properties: Record<string, { properties: Record<string, Record<string, unknown>> }> })
			.properties.videoPrompt.properties.shots as Record<string, unknown>).description);
		const facts = JSON.parse(plan.split("\n").at(-1)!) as { storyEvents: unknown[] };
		expect(facts.storyEvents).toEqual(clipSequence.storyEvents);
		expect(facts.storyEvents).toHaveLength(1);
		expect(plan).toContain("The following are ordered frozen input facts, not a required shot list.");
		expect(plan).not.toContain("shots[0]");
	});

	it("compiles an empty frozen dialogue track without changing the authored cuts", () => {
		const source = packet(0);
		const clipSequence = { protocolVersion: "tapcanvas.chapter-sequence-clip/v2", clipId: "clip-0", clipIndex: 0,
			durationSeconds: 5, speechEvents: [] };
		const draft = { ...source, videoPrompt: timelineDraft([2, 2, 1], "") };
		const compiled = materializeClipProductionDraft(draft, undefined, "", clipSequence) as ReturnType<typeof packet>;
		expect((compiled as Record<string, unknown>).speechEvents).toEqual([]);
		expect(compiled.videoPrompt).toBe("镜头1：人物动作1\n镜头2：人物动作2\n镜头3：人物动作3");
		expect(compiled.videoPrompt).not.toContain("说：“");
	});

	it("keeps author-selected shot counts independent of provider request duration", () => {
		for (const count of [1, 4, 18]) {
			const draft = { ...packet(0), durationSeconds: 30, videoPrompt: timelineDraft(Array(count).fill(1), "") };
			const compiled = materializeClipProductionDraft(draft, undefined, "") as ReturnType<typeof packet>;
			expect(compiled.durationSeconds).toBe(30);
			expect(compiled.videoPrompt.split("\n").filter((line) => /^镜头\d+：/.test(line))).toHaveLength(count);
			expect(compiled.videoPrompt).not.toMatch(/\d+\s*(?:s|秒)/);
		}
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

	it("accepts overlapping chapter provenance through the frozen Clip packet contract", () => {
		const fixture = globalSequenceFixture();
		const fullRange = fixture.sequence.storyEvents[0]!.sourceRanges[0]!;
		const sequence = {
			...fixture.sequence,
			storyEvents: fixture.sequence.storyEvents.map((event, index) => index === 0
				? { ...event, sourceRanges: [
					{ ...fullRange, startOffset: 10, endOffset: 20 },
					{ ...fullRange, startOffset: 0, endOffset: 15 },
				] }
				: event),
		};
		const chapterProjection = projectChapterSequence({
			executionId: "execution-overlapping-provenance",
			nodeId: "chapter-sequence-project",
			sequence,
			deliveryContract: fixture.deliveryContract,
		});
		const segment = chapterProjection.sourceSegmentsCollection.items[0]!.value;
		const bound = bindClipProductionPacketAuthoringContract({ allowedFields: [] }, segment, ["image_to_video"]);
		const frozenPacket = {
			...packet(0),
			clipId: segment.clipId,
			clipIndex: segment.clipIndex,
			durationSeconds: segment.durationSeconds,
			sourceRanges: segment.sourceRanges,
			clipFacts: { sequenceClipId: segment.clipId, localAction: { start: "进入交锋", result: "继续推进" } },
		};

		expect(segment.sourceRanges.some((range, index) => segment.sourceRanges.some((candidate, candidateIndex) =>
			candidateIndex !== index && candidate.sourceIndex === range.sourceIndex
				&& candidate.startOffset < range.endOffset && range.startOffset < candidate.endOffset))).toBe(true);
		const authoringPacket = { ...frozenPacket, videoPrompt: timelineDraft() };
		expect(validateWorkflowToolArguments(bound.jsonSchema!, authoringPacket)).toEqual([]);
		expect(verifyClipProductionPacketSourceBinding(frozenPacket, segment).sourceRanges).toEqual(segment.sourceRanges);
		const unorderedRanges = [...segment.sourceRanges].reverse();
		const unorderedPacket = { ...frozenPacket, sourceRanges: unorderedRanges };
		expect(validateClipProductionPacket(unorderedPacket).sourceRanges).toEqual(unorderedRanges);
		expect(collectClipPackets([unorderedPacket]).clips[0]?.sourceRanges).toEqual(unorderedRanges);
		expect(validateWorkflowToolArguments(bound.jsonSchema!, unorderedPacket)).not.toEqual([]);
		expect(() => verifyClipProductionPacketSourceBinding(unorderedPacket, segment)).toThrow(/sourceRanges differ/);

		const sourceLength = fixture.deliveryContract.canvasFacts.authoritativeSources[0]!.content.length;
		const outOfBoundsPacket = {
			...frozenPacket,
			sourceRanges: frozenPacket.sourceRanges.map((range, index) => index === 0
				? { ...range, endOffset: sourceLength + 1 }
				: range),
		};
		expect(validateWorkflowToolArguments(bound.jsonSchema!, outOfBoundsPacket)).not.toEqual([]);
		expect(() => verifyClipProductionPacketSourceBinding(outOfBoundsPacket, segment)).toThrow(/sourceRanges differ/);

		const differentSourcePacket = {
			...frozenPacket,
			sourceRanges: frozenPacket.sourceRanges.map((range, index) => index === 0
				? { ...range, sourceId: "different-frozen-source" }
				: range),
		};
		expect(validateWorkflowToolArguments(bound.jsonSchema!, differentSourcePacket)).not.toEqual([]);
		expect(() => verifyClipProductionPacketSourceBinding(differentSourcePacket, segment)).toThrow(/sourceRanges differ/);
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
