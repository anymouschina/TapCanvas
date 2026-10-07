import { createWorkflowCollection, type WorkflowCollectionV1 } from "@tapcanvas/workflow-kernel-protocol";
import {
	BOUND_CHAPTER_SEQUENCE_ARTIFACT_TYPE,
	CHAPTER_SEQUENCE_CLIP_ARTIFACT_TYPE,
	type AuthoredChapterSequence,
	type BoundChapterSequence,
	type BoundChapterSequenceClip,
	type ChapterSequenceClipItem,
	type ChapterSequenceClipStaging,
	type ChapterSequenceNeighborEvent,
	type ChapterSequenceSourceRange,
	type ChapterSequenceWindow,
} from "../../../../../packages/schemas/chapter-sequence/index.mjs";
import { CLIP_SOURCE_SEGMENT_PROTOCOL_VERSION } from "../../../../../packages/schemas/video-clip-segmentation/index.mjs";
import type { ClipSourceSegment, ClipSegmentationSourceRange, ClipSegmentationSourceSlice } from "./execution.clip-segmentation";
import {
	type ChapterSequenceFrozenSource,
} from "./execution.chapter-sequence.contract";
import {
	parseAndValidateChapterSequence,
	type ChapterSequencePhysicalWindow,
} from "./execution.chapter-sequence.validation";
import { resolveWorkflowAuthoritativeSourceLineage } from "./execution.source-lineage";

export { bindChapterScriptAuthoringContract, compileChapterScript } from "./execution.chapter-script";

function sourceRangeKey(range: ChapterSequenceSourceRange): string {
	return `${range.sourceIndex}:${range.startOffset}:${range.endOffset}:${range.sourceId}:${range.sourceFingerprint}`;
}

function sourceSlicesForRanges(
	ranges: readonly ChapterSequenceSourceRange[],
	sources: readonly ChapterSequenceFrozenSource[],
): readonly ClipSegmentationSourceSlice[] {
	return ranges.map((range) => {
		const source = sources[range.sourceIndex];
		if (!source) throw new Error(`chapter-sequence references missing source ${range.sourceIndex}`);
		return { ...range, text: source.content.slice(range.startOffset, range.endOffset) };
	});
}

function segmentRangesForWindow(
	clip: ChapterSequenceWindow,
	sequence: AuthoredChapterSequence,
	sources: readonly ChapterSequenceFrozenSource[],
): readonly ClipSegmentationSourceRange[] {
	const storyById = new Map(sequence.storyEvents.map((event) => [event.eventId, event]));
	const speechById = new Map(sequence.speechEvents.map((event) => [event.speechEventId, event]));
	const ranges = [
		...clip.storyEventIds.flatMap((eventId) => storyById.get(eventId)?.sourceRanges ?? []),
		...clip.speechEventIds.flatMap((eventId) => speechById.get(eventId)?.sourceRanges ?? []),
	];
	const uniqueRanges = new Map(ranges.map((range) => [sourceRangeKey(range), range]));
	return [...uniqueRanges.values()]
		.sort((left, right) => left.sourceIndex - right.sourceIndex || left.startOffset - right.startOffset || left.endOffset - right.endOffset)
		.map((range) => {
			const source = sources[range.sourceIndex];
			if (!source) throw new Error(`chapter-sequence references missing source ${range.sourceIndex}`);
			return { ...range, sourceId: source.sourceId, sourceFingerprint: source.sourceFingerprint };
		});
}

function buildClipSourceSegments(input: Readonly<{
	executionId: string;
	nodeId: string;
	sequence: AuthoredChapterSequence;
	sources: readonly ChapterSequenceFrozenSource[];
	windows: readonly ChapterSequencePhysicalWindow[];
}>): WorkflowCollectionV1<ClipSourceSegment> {
	const lineage = resolveWorkflowAuthoritativeSourceLineage(input.sources);
	const segments = input.sequence.clips.map((clip, clipIndex): ClipSourceSegment => {
		const sourceRanges = segmentRangesForWindow(clip, input.sequence, input.sources);
		const sourceSlices = sourceSlicesForRanges(sourceRanges, input.sources);
		return {
			protocolVersion: CLIP_SOURCE_SEGMENT_PROTOCOL_VERSION,
			clipId: clip.clipId,
			clipIndex,
			sourceId: lineage.sourceId,
			sourceFingerprint: lineage.sourceFingerprint,
			durationSeconds: input.windows[clipIndex]!.durationSeconds,
			sourceRanges,
			sourceSlices,
		};
	});
	return createWorkflowCollection({
		collectionId: `${input.executionId}:${input.nodeId}:clip-segments`,
		producerNodeId: input.nodeId,
		producerPortId: "clip-segments",
		values: segments,
		itemIds: segments.map((segment) => segment.clipId),
	});
}

/** Opening positions come from declared scene facts and completed preceding events, never interpolation. */
function clipStaging(sequence: AuthoredChapterSequence, storyEventIds: readonly string[]): ChapterSequenceClipStaging | undefined {
	const scenes = new Map((sequence.scenes ?? []).map((scene) => [scene.sceneId, scene]));
	const events = storyEventIds.map((id) => sequence.storyEvents.find((event) => event.eventId === id)!);
	const staged = events.filter((event) => event?.sceneId && scenes.get(event.sceneId)?.layout && scenes.get(event.sceneId)?.positions);
	const first = staged[0];
	if (!first?.sceneId) return undefined;
	const scene = scenes.get(first.sceneId)!;
	let known = new Map(scene.positions!.map((position) => [position.who, position]));
	for (const event of sequence.storyEvents) {
		if (event.eventIndex >= first.eventIndex) break;
		if (event.sceneId === first.sceneId && event.staging) known = new Map(event.staging.map((position) => [position.who, position]));
	}
	const ids = [...new Set(staged.map((event) => event.sceneId!))];
	return { scenes: ids.map((id) => { const item = scenes.get(id)!; return { sceneId: id, setting: item.setting, layout: item.layout!, positions: item.positions! }; }), opening: [...known.values()] };
}

function projectBoundClips(input: Readonly<{
	sequence: AuthoredChapterSequence;
	sources: readonly ChapterSequenceFrozenSource[];
	windows: readonly ChapterSequencePhysicalWindow[];
	segments: WorkflowCollectionV1<ClipSourceSegment>;
}>): readonly BoundChapterSequenceClip[] {
	const boundaryById = new Map(input.sequence.boundaries.map((boundary) => [boundary.boundaryId, boundary]));
	const storyById = new Map(input.sequence.storyEvents.map((event) => [event.eventId, event]));
	const speechById = new Map(input.sequence.speechEvents.map((event) => [event.speechEventId, event]));
	return input.sequence.clips.map((clip, clipIndex) => {
		const window = input.windows[clipIndex];
		const segment = input.segments.items[clipIndex]?.value;
		const startBoundary = boundaryById.get(clip.startBoundaryId);
		const endBoundary = boundaryById.get(clip.endBoundaryId);
		if (!window || !segment || !startBoundary || !endBoundary) {
			throw new Error(`chapter-sequence.clips[${clipIndex}] cannot resolve its physical window, source provenance or shared boundaries`);
		}
		const storyEvents = clip.storyEventIds.map((eventId) => {
			const event = storyById.get(eventId);
			if (!event) throw new Error(`chapter-sequence.clips[${clipIndex}] references unknown story event ${eventId}`);
			return event;
		});
		const speechEvents = clip.speechEventIds.map((eventId) => {
			const event = speechById.get(eventId);
			if (!event) throw new Error(`chapter-sequence.clips[${clipIndex}] references unknown speech event ${eventId}`);
			return event;
		});
		const staging = clipStaging(input.sequence, clip.storyEventIds);
		return {
			clipId: segment.clipId,
			clipIndex,
			durationSeconds: window.durationSeconds,
			sourceRanges: segment.sourceRanges,
			wholeFilmIntent: input.sequence.wholeFilmIntent,
			globalStartSeconds: window.startSeconds,
			globalEndSeconds: window.endSeconds,
			startBoundaryId: startBoundary.boundaryId,
			endBoundaryId: endBoundary.boundaryId,
			startKeyframe: startBoundary.keyframe,
			endKeyframe: endBoundary.keyframe,
			causalEntry: startBoundary.causalEntry,
			irreversibleResult: endBoundary.irreversibleResult,
			handoff: endBoundary.handoff,
			storyEvents,
			speechEvents,
			...(staging ? { staging } : {}),
		};
	});
}

function neighborEvents(
	neighbor: BoundChapterSequenceClip,
): readonly ChapterSequenceNeighborEvent[] {
	return neighbor.storyEvents.map((event) => ({
		eventId: event.eventId,
		action: event.action,
		eventIndex: event.eventIndex,
	}));
}

function makeClipItems(
	clips: readonly BoundChapterSequenceClip[],
	segments: WorkflowCollectionV1<ClipSourceSegment>,
): readonly ChapterSequenceClipItem[] {
	return clips.map((clip, index): ChapterSequenceClipItem => {
		const previous = clips[index - 1];
		const next = clips[index + 1];
		const previousSegment = segments.items[index - 1]?.value;
		const nextSegment = segments.items[index + 1]?.value;
		return {
			...clip,
			protocolVersion: CHAPTER_SEQUENCE_CLIP_ARTIFACT_TYPE,
			previousBoundary: previous ? {
				clipId: previous.clipId,
				endKeyframe: previous.endKeyframe,
				irreversibleResult: previous.irreversibleResult,
				handoff: previous.handoff,
				sourceSlices: previousSegment?.sourceSlices ?? [],
				// Events crossing the edge are already part of this Clip's own events.
				storyEvents: neighborEvents(previous),
			} : null,
			nextBoundary: next ? {
				clipId: next.clipId,
				startKeyframe: next.startKeyframe,
				causalEntry: next.causalEntry,
				sourceSlices: nextSegment?.sourceSlices ?? [],
				storyEvents: neighborEvents(next),
			} : null,
		};
	});
}

/** Project one full-film authoring artifact into existing per-Clip execution contracts. */
export function projectChapterSequence(input: Readonly<{
	executionId: string;
	nodeId: string;
	sequence: unknown;
	deliveryContract: unknown;
}>): Readonly<{
	chapterSequence: BoundChapterSequence;
	clipCollection: WorkflowCollectionV1<ChapterSequenceClipItem>;
	sourceSegmentsCollection: WorkflowCollectionV1<ClipSourceSegment>;
	sourceReceipt: Readonly<{
		protocolVersion: typeof CLIP_SOURCE_SEGMENT_PROTOCOL_VERSION;
		sourceId: string;
		sourceFingerprint: string;
		clipIds: readonly string[];
		totalDurationSeconds: number;
	}>;
}> {
	const { sequence, sources, windows } = parseAndValidateChapterSequence(input.sequence, input.deliveryContract);
	for (const sourceId of sequence.authoringRecord?.sourceIds ?? []) {
		if (!sources.some((source) => source.sourceId === sourceId)) {
			throw new Error(`chapter-sequence authoringRecord.sourceIds contains a source outside the frozen delivery contract: ${sourceId}`);
		}
	}
	const lineage = resolveWorkflowAuthoritativeSourceLineage(sources);
	const sourceSegmentsCollection = buildClipSourceSegments({ ...input, sequence, sources, windows });
	const boundClips = projectBoundClips({ sequence, sources, windows, segments: sourceSegmentsCollection });
	const clipItems = makeClipItems(boundClips, sourceSegmentsCollection);
	const chapterSequence: BoundChapterSequence = {
		protocolVersion: BOUND_CHAPTER_SEQUENCE_ARTIFACT_TYPE,
		wholeFilmIntent: sequence.wholeFilmIntent,
		totalDurationSeconds: sequence.totalDurationSeconds,
		...(sequence.adaptation ? { adaptation: sequence.adaptation } : {}),
		...(sequence.scenes ? { scenes: sequence.scenes } : {}),
		storyEvents: sequence.storyEvents,
		speechEvents: sequence.speechEvents,
		boundaries: sequence.boundaries,
		clips: boundClips,
		...(sequence.authoringRecord ? { authoringRecord: sequence.authoringRecord } : {}),
	};
	return {
		chapterSequence,
		clipCollection: createWorkflowCollection({
			collectionId: `${input.executionId}:${input.nodeId}:chapter-sequence-clips`,
			producerNodeId: input.nodeId,
			producerPortId: "clip-sequences",
			values: clipItems,
			itemIds: clipItems.map((item) => item.clipId),
			parentLineage: sourceSegmentsCollection.items.map((item) => item.lineage),
		}),
		sourceSegmentsCollection,
		sourceReceipt: {
			protocolVersion: CLIP_SOURCE_SEGMENT_PROTOCOL_VERSION,
			sourceId: lineage.sourceId,
			sourceFingerprint: lineage.sourceFingerprint,
			clipIds: sourceSegmentsCollection.items.map((item) => item.itemId),
			totalDurationSeconds: sequence.totalDurationSeconds,
		},
	};
}
