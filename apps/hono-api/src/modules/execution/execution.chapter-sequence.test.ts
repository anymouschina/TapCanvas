import { describe, expect, it } from "vitest";
import { createWorkflowCollection } from "@tapcanvas/workflow-kernel-protocol";
import { sha256Hex } from "../asset/book-content-hash";
import { bindChapterSequenceAuthoringContract, bindSingleClipChapterSequenceAuthoringContract, projectChapterSequence, projectChapterSequenceCollection } from "./execution.chapter-sequence";
import type { ClipSourceSegment } from "./execution.clip-segmentation";

const content = "张羽🙂说：快走！林薇说：等等。";
const split = content.indexOf("林薇");
const sourceId = "chapter-16";
const sourceFingerprint = sha256Hex(content);
const deliveryContract = { canvasFacts: { authoritativeSources: [{ sourceId, sourceFingerprint, content }] } };

function sourceSegments() {
	const spans = [[0, split], [split, content.length]] as const;
	const values: ClipSourceSegment[] = spans.map(([startOffset, endOffset], clipIndex) => {
		const range = { sourceIndex: 0, startOffset, endOffset, sourceId, sourceFingerprint };
		return {
			protocolVersion: "tapcanvas.clip-source-segment/v1",
			clipId: `${sourceFingerprint}:clip:${clipIndex}`,
			clipIndex,
			sourceId,
			sourceFingerprint,
			durationSeconds: 5,
			sourceRanges: [range],
			sourceSlices: [{ ...range, text: content.slice(startOffset, endOffset) }],
		};
	});
	return createWorkflowCollection({
		collectionId: "execution:clip-source-segments", producerNodeId: "segmentation", producerPortId: "clip-segments",
		values, itemIds: values.map((value) => value.clipId),
	});
}

function sequence() {
	const segments = sourceSegments();
	const speech = [
		{ startOffset: content.indexOf("快走"), endOffset: content.indexOf("快走") + "快走！".length },
		{ startOffset: content.indexOf("等等"), endOffset: content.length },
	];
	return {
		protocolVersion: "tapcanvas.chapter-sequence/v1",
		clips: segments.items.map(({ value }, clipIndex) => ({
			clipId: value.clipId, clipIndex, durationSeconds: value.durationSeconds, sourceRanges: value.sourceRanges,
			startKeyframe: { visual: `起帧 ${clipIndex}`, state: `起始状态 ${clipIndex}` },
			endKeyframe: { visual: `终帧 ${clipIndex}`, state: `结束状态 ${clipIndex}` },
			causalEntry: `进入原因 ${clipIndex}`, irreversibleResult: `确定结果 ${clipIndex}`, handoff: `交接状态 ${clipIndex}`,
			storyEvents: [{ eventId: `story-${clipIndex}`, startSeconds: 0, endSeconds: 5, action: `动作 ${clipIndex}` }],
			speechEvents: [{
				speechEventId: `speech-${clipIndex}`, speaker: clipIndex === 0 ? "张羽" : "林薇", delivery: "现场对白",
				startSeconds: 1, endSeconds: 3,
				sourceRanges: [{ sourceIndex: 0, ...speech[clipIndex], sourceId, sourceFingerprint }],
			}],
		})),
	};
}

function project(candidate: unknown = sequence(), segments: unknown = sourceSegments()) {
	return projectChapterSequence({ executionId: "execution", nodeId: "chapter-sequence-project",
		sequence: candidate, clipSourceSegmentsCollection: segments, deliveryContract });
}

describe("chapter sequence frozen source contract", () => {
	it("binds one frozen Clip per submission and joins the persisted collection in source order", () => {
		const segments = sourceSegments();
		const bound = bindSingleClipChapterSequenceAuthoringContract({ allowedFields: [] }, segments.items[1]!.value);
		const schema = bound.jsonSchema as Record<string, unknown>;
		const clips = (schema.properties as Record<string, unknown>).clips as Record<string, unknown>;
		const fields = (clips.items as Record<string, unknown>).properties as Record<string, unknown>;
		expect(clips).toMatchObject({ minItems: 1, maxItems: 1 });
		expect(fields.clipIndex).toEqual({ const: 1 });
		expect(fields.clipId).toEqual({ const: segments.items[1]!.itemId });

		const authored = sequence();
		const submissions = createWorkflowCollection({
			collectionId: "execution:chapter-sequence-submissions", producerNodeId: "chapter-sequence-agent",
			producerPortId: "chapter-sequence", itemIds: segments.items.map((item) => item.itemId),
			values: authored.clips.map((clip) => ({ protocolVersion: authored.protocolVersion, clips: [clip] })),
		});
		const projected = projectChapterSequenceCollection({
			executionId: "execution", nodeId: "chapter-sequence-project",
			sequenceCollection: submissions, clipSourceSegmentsCollection: segments, deliveryContract,
		});
		expect(projected.chapterSequence.clips).toHaveLength(2);
		expect(projected.clipCollection.items[1]?.value.speechEvents[0]?.text).toBe("等等。");
	});
	it("binds exact Clip count and IDs without embedding source prose in JSON schema", () => {
		const bound = bindChapterSequenceAuthoringContract({ allowedFields: [] }, sourceSegments(), deliveryContract);
		const schema = bound.jsonSchema as Record<string, unknown>;
		const clips = (schema.properties as Record<string, unknown>).clips as Record<string, unknown>;
		const itemProperties = ((clips.items as Record<string, unknown>).properties as Record<string, unknown>);
		expect(clips.minItems).toBe(2);
		expect(clips.maxItems).toBe(2);
		expect(itemProperties.clipId).toMatchObject({ enum: sourceSegments().items.map((item) => item.itemId) });
		expect(JSON.stringify(schema)).not.toContain(content);
	});

	it("projects verbatim speech and bounded per-Clip continuity with adjacent boundaries", () => {
		const result = project();
		expect(result.chapterSequence.protocolVersion).toBe("tapcanvas.chapter-sequence-bound/v1");
		expect(result.chapterSequence.clips.map((clip) => clip.speechEvents[0]?.text)).toEqual(["快走！", "等等。"]);
		expect(result.clipCollection.items.map((item) => item.itemId)).toEqual(sourceSegments().items.map((item) => item.itemId));
		expect(result.clipCollection.items[0]?.value.previousBoundary).toBeNull();
		expect(result.clipCollection.items[0]?.value.nextBoundary).toMatchObject({
			clipId: sourceSegments().items[1]?.itemId, startKeyframe: { visual: "起帧 1" },
		});
		expect(result.clipCollection.items[1]?.value.previousBoundary).toMatchObject({
			clipId: sourceSegments().items[0]?.itemId, endKeyframe: { visual: "终帧 0" },
		});
		expect(result.clipCollection.items[0]?.lineage).toHaveLength(sourceSegments().items[0]!.lineage.length + 1);
	});

	it("rejects Clip reordering, forged source ranges, and fabricated speech text", () => {
		const reordered = sequence();
		expect(() => project({ ...reordered, clips: [...reordered.clips].reverse() })).toThrow(/identity, duration or UTF-16 ranges/);
		const changedRange = sequence();
		changedRange.clips[0]!.sourceRanges = [{ ...changedRange.clips[0]!.sourceRanges[0]!, endOffset: split - 1 }];
		expect(() => project(changedRange)).toThrow(/identity, duration or UTF-16 ranges/);
		const fabricated = sequence();
		const firstSpeech = fabricated.clips[0]!.speechEvents[0]!;
		fabricated.clips[0]!.speechEvents[0] = { ...firstSpeech, text: "伪造对白" } as typeof firstSpeech;
		expect(() => project(fabricated)).toThrow(/chapter-sequence/);
	});

	it("rejects speech outside its Clip, split surrogate pairs, and timing beyond duration", () => {
		const outside = sequence();
		outside.clips[0]!.speechEvents[0]!.sourceRanges[0]!.startOffset = split;
		outside.clips[0]!.speechEvents[0]!.sourceRanges[0]!.endOffset = split + 2;
		expect(() => project(outside)).toThrow(/outside this frozen Clip/);
		const surrogate = sequence();
		const emoji = content.indexOf("🙂");
		surrogate.clips[0]!.speechEvents[0]!.sourceRanges[0]!.startOffset = emoji + 1;
		surrogate.clips[0]!.speechEvents[0]!.sourceRanges[0]!.endOffset = emoji + 2;
		expect(() => project(surrogate)).toThrow(/outside the frozen UTF-16 source/);
		const overtime = sequence();
		overtime.clips[0]!.storyEvents[0]!.endSeconds = 6;
		expect(() => project(overtime)).toThrow(/inside the frozen Clip duration/);
	});

	it("rejects source collection slices that no longer match delivery-contract text", () => {
		const segments = sourceSegments();
		const first = segments.items[0]!;
		const corrupted = { ...segments, items: [{ ...first, value: { ...first.value,
			sourceSlices: [{ ...first.value.sourceSlices[0]!, text: "假原文" }],
		} }, segments.items[1]!] };
		expect(() => project(sequence(), corrupted)).toThrow(/differs from frozen source/);
	});
});
