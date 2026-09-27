import { createWorkflowCollection, isWorkflowCollection, type WorkflowCollectionV1 } from "@tapcanvas/workflow-kernel-protocol";
import {
	BOUND_CHAPTER_SEQUENCE_ARTIFACT_TYPE,
	CHAPTER_SEQUENCE_ARTIFACT_TYPE,
	CHAPTER_SEQUENCE_CLIP_ARTIFACT_TYPE,
	chapterSequenceSchema,
	type AuthoredChapterSequence,
	type BoundChapterSequence,
	type BoundChapterSequenceClip,
	type ChapterSequenceClipItem,
	type ChapterSequenceSourceRange,
} from "../../../../../packages/schemas/chapter-sequence/index.mjs";
import { inspectClipSegmentationCoverage } from "../../../../../packages/schemas/video-clip-segmentation/index.mjs";
import type { ClipSourceSegment } from "./execution.clip-segmentation";
import type { WorkflowAgentJsonObjectContract } from "./execution.agent-output-contract";
import { validateWorkflowToolArguments } from "./execution.json-schema-validator";
import { freezeWorkflowAuthoritativeSource, resolveWorkflowAuthoritativeSourceLineage } from "./execution.source-lineage";

type JsonRecord = Record<string, unknown>;
type FrozenSource = Readonly<{ sourceId: string; sourceFingerprint: string; content: string }>;

function record(value: unknown): value is JsonRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonicalText(value: unknown): value is string {
	return typeof value === "string" && value.length > 0 && value === value.trim();
}

function frozenSources(deliveryContract: unknown): readonly FrozenSource[] {
	if (!record(deliveryContract) || !record(deliveryContract.canvasFacts)
		|| !Array.isArray(deliveryContract.canvasFacts.authoritativeSources)
		|| deliveryContract.canvasFacts.authoritativeSources.length === 0) {
		throw new Error("Chapter sequence requires frozen delivery-contract.canvasFacts.authoritativeSources");
	}
	const sources = deliveryContract.canvasFacts.authoritativeSources.map((raw, index) => {
		if (!record(raw)) throw new Error(`authoritativeSources[${index}] must be a source record`);
		const source = freezeWorkflowAuthoritativeSource(raw);
		if (!canonicalText(source.sourceId) || !canonicalText(source.sourceFingerprint)
			|| typeof source.content !== "string" || !source.content.trim()) {
			throw new Error(`authoritativeSources[${index}] requires sourceId, sourceFingerprint and content`);
		}
		return { sourceId: source.sourceId, sourceFingerprint: source.sourceFingerprint, content: source.content };
	});
	resolveWorkflowAuthoritativeSourceLineage(sources);
	return sources;
}

function sameRange(left: ChapterSequenceSourceRange, right: ChapterSequenceSourceRange): boolean {
	return left.sourceIndex === right.sourceIndex && left.startOffset === right.startOffset
		&& left.endOffset === right.endOffset && left.sourceId === right.sourceId
		&& left.sourceFingerprint === right.sourceFingerprint;
}

function sameRanges(left: readonly ChapterSequenceSourceRange[], right: readonly ChapterSequenceSourceRange[]): boolean {
	return left.length === right.length && left.every((range, index) => {
		const target = right[index];
		return target !== undefined && sameRange(range, target);
	});
}

function splitsSurrogatePair(content: string, offset: number): boolean {
	if (offset <= 0 || offset >= content.length) return false;
	const previous = content.charCodeAt(offset - 1);
	const next = content.charCodeAt(offset);
	return previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff;
}

function sourceSegments(value: unknown, sources: readonly FrozenSource[]): WorkflowCollectionV1<ClipSourceSegment> {
	if (!isWorkflowCollection(value) || value.items.length === 0 || value.items.length > 80) {
		throw new Error("Chapter sequence requires a non-empty frozen Clip source collection");
	}
	const lineage = resolveWorkflowAuthoritativeSourceLineage(sources);
	const clips: ClipSourceSegment[] = value.items.map((item, index) => {
		const raw = item.value;
		if (!record(raw) || raw.protocolVersion !== "tapcanvas.clip-source-segment/v1"
			|| !canonicalText(raw.clipId) || raw.clipId !== item.itemId
			|| raw.clipIndex !== index || !Number.isSafeInteger(raw.durationSeconds)
			|| Number(raw.durationSeconds) <= 0 || raw.sourceId !== lineage.sourceId
			|| raw.sourceFingerprint !== lineage.sourceFingerprint
			|| !Array.isArray(raw.sourceRanges) || !Array.isArray(raw.sourceSlices)
			|| raw.sourceRanges.length === 0 || raw.sourceRanges.length !== raw.sourceSlices.length) {
			throw new Error(`clip-source-segments[${index}] has invalid frozen identity, duration or ranges`);
		}
		const ranges = raw.sourceRanges as readonly ChapterSequenceSourceRange[];
		for (const [rangeIndex, range] of ranges.entries()) {
			const source = sources[range.sourceIndex];
			const slice = raw.sourceSlices[rangeIndex];
			if (!record(range) || !source || !record(slice)
				|| range.sourceId !== source.sourceId || range.sourceFingerprint !== source.sourceFingerprint
				|| !Number.isSafeInteger(range.startOffset) || !Number.isSafeInteger(range.endOffset)
				|| range.startOffset < 0 || range.endOffset <= range.startOffset || range.endOffset > source.content.length
				|| splitsSurrogatePair(source.content, range.startOffset)
				|| splitsSurrogatePair(source.content, range.endOffset)
				|| !sameRange(range, slice as ChapterSequenceSourceRange)
				|| slice.text !== source.content.slice(range.startOffset, range.endOffset)) {
				throw new Error(`clip-source-segments[${index}].sourceRanges[${rangeIndex}] differs from frozen source`);
			}
		}
		return raw as unknown as ClipSourceSegment;
	});
	const issue = inspectClipSegmentationCoverage(clips, sources.map((source) => source.content));
	if (issue) throw new Error(`clip-source-segments source coverage: ${issue}`);
	return value as WorkflowCollectionV1<ClipSourceSegment>;
}

function parseSequence(value: unknown): AuthoredChapterSequence {
	const candidate = record(value) && typeof value.text === "string" ? value.text : value;
	let parsed: unknown;
	try {
		parsed = typeof candidate === "string" ? JSON.parse(candidate) : candidate;
	} catch {
		throw new Error("chapter-sequence must be one valid JSON object");
	}
	const issues = validateWorkflowToolArguments(chapterSequenceSchema, parsed);
	if (issues.length > 0) throw new Error(`chapter-sequence: ${issues.map((issue) => issue.message).join(" | ")}`);
	return parsed as AuthoredChapterSequence;
}

function assertTimedEvent(event: Readonly<{ startSeconds: number; endSeconds: number }>, duration: number, field: string): void {
	if (!Number.isFinite(event.startSeconds) || !Number.isFinite(event.endSeconds)
		|| event.startSeconds < 0 || event.endSeconds <= event.startSeconds || event.endSeconds > duration) {
		throw new Error(`${field} must have a positive interval inside the frozen Clip duration`);
	}
}

function projectSpeechText(
	ranges: readonly ChapterSequenceSourceRange[],
	clipRanges: readonly ChapterSequenceSourceRange[],
	sources: readonly FrozenSource[],
	field: string,
): string {
	let previous: ChapterSequenceSourceRange | null = null;
	return ranges.map((range, index) => {
		const source = sources[range.sourceIndex];
		if (!source || range.sourceId !== source.sourceId || range.sourceFingerprint !== source.sourceFingerprint
			|| !Number.isSafeInteger(range.startOffset) || !Number.isSafeInteger(range.endOffset)
			|| range.startOffset < 0 || range.endOffset <= range.startOffset || range.endOffset > source.content.length
			|| splitsSurrogatePair(source.content, range.startOffset)
			|| splitsSurrogatePair(source.content, range.endOffset)) {
			throw new Error(`${field}.sourceRanges[${index}] is outside the frozen UTF-16 source`);
		}
		if (!clipRanges.some((clipRange) => clipRange.sourceIndex === range.sourceIndex
			&& clipRange.sourceId === range.sourceId && clipRange.sourceFingerprint === range.sourceFingerprint
			&& clipRange.startOffset <= range.startOffset && range.endOffset <= clipRange.endOffset)) {
			throw new Error(`${field}.sourceRanges[${index}] is outside this frozen Clip`);
		}
		if (previous && (range.sourceIndex < previous.sourceIndex
			|| (range.sourceIndex === previous.sourceIndex && range.startOffset < previous.endOffset))) {
			throw new Error(`${field}.sourceRanges must be ordered and non-overlapping`);
		}
		previous = range;
		return source.content.slice(range.startOffset, range.endOffset);
	}).join("");
}

/** Freeze the exact chapter item identities in the JSON tool contract. */
export function bindChapterSequenceAuthoringContract(
	contract: WorkflowAgentJsonObjectContract,
	clipSourceSegmentsCollection: unknown,
	deliveryContract: unknown,
): WorkflowAgentJsonObjectContract {
	const sources = frozenSources(deliveryContract);
	const segments = sourceSegments(clipSourceSegmentsCollection, sources);
	const schema = structuredClone(chapterSequenceSchema) as JsonRecord;
	const properties = schema.properties as JsonRecord;
	const clips = properties.clips as JsonRecord;
	clips.minItems = segments.items.length;
	clips.maxItems = segments.items.length;
	const clipItem = clips.items as JsonRecord;
	const clipProperties = clipItem.properties as JsonRecord;
	clipProperties.clipId = { type: "string", enum: segments.items.map((item) => item.itemId) };
	clipProperties.clipIndex = { type: "integer", minimum: 0, maximum: segments.items.length - 1 };
	clipProperties.durationSeconds = { type: "integer", enum: [...new Set(segments.items.map((item) => item.value.durationSeconds))] };
	return {
		...contract,
		jsonSchema: schema,
		contractName: "tapcanvas.chapter-sequence",
		contractVersion: "1",
		requiredStringFields: ["protocolVersion"],
		exactStringFields: { ...contract.exactStringFields, protocolVersion: CHAPTER_SEQUENCE_ARTIFACT_TYPE },
		requiredArrayFields: ["clips"],
		expectedArrayLengths: { ...contract.expectedArrayLengths, clips: segments.items.length },
		allowedFields: ["protocolVersion", "clips"],
	};
}

/** Bind one model submission to one frozen Clip, keeping chapter-wide JSON small. */
export function bindSingleClipChapterSequenceAuthoringContract(
	contract: WorkflowAgentJsonObjectContract,
	clipSegment: unknown,
): WorkflowAgentJsonObjectContract {
	if (!record(clipSegment) || !canonicalText(clipSegment.clipId)
		|| typeof clipSegment.clipIndex !== "number" || !Number.isSafeInteger(clipSegment.clipIndex) || clipSegment.clipIndex < 0
		|| typeof clipSegment.durationSeconds !== "number" || !Number.isSafeInteger(clipSegment.durationSeconds) || clipSegment.durationSeconds < 1
		|| !Array.isArray(clipSegment.sourceRanges) || clipSegment.sourceRanges.length === 0) {
		throw new Error("Chapter sequence Agent requires one frozen Clip segment");
	}
	const schema = structuredClone(chapterSequenceSchema) as JsonRecord;
	const properties = schema.properties as JsonRecord;
	const clips = properties.clips as JsonRecord;
	clips.minItems = 1;
	clips.maxItems = 1;
	const clipItem = clips.items as JsonRecord;
	const clipProperties = clipItem.properties as JsonRecord;
	clipProperties.clipId = { const: clipSegment.clipId };
	clipProperties.clipIndex = { const: clipSegment.clipIndex };
	clipProperties.durationSeconds = { const: clipSegment.durationSeconds };
	clipProperties.sourceRanges = { const: clipSegment.sourceRanges };
	return {
		...contract,
		jsonSchema: schema,
		contractName: "tapcanvas.chapter-sequence",
		contractVersion: "1",
		requiredStringFields: ["protocolVersion"],
		exactStringFields: { ...contract.exactStringFields, protocolVersion: CHAPTER_SEQUENCE_ARTIFACT_TYPE },
		requiredArrayFields: ["clips"],
		expectedArrayLengths: { ...contract.expectedArrayLengths, clips: 1 },
		allowedFields: ["protocolVersion", "clips"],
	};
}

/** Join independently persisted one-Clip submissions in frozen source order. */
export function projectChapterSequenceCollection(input: Readonly<{
	executionId: string;
	nodeId: string;
	sequenceCollection: unknown;
	clipSourceSegmentsCollection: unknown;
	deliveryContract: unknown;
}>): ReturnType<typeof projectChapterSequence> {
	if (!isWorkflowCollection(input.sequenceCollection)) {
		throw new Error("chapter-sequence requires a collection of one-Clip submissions");
	}
	const authoredClips = input.sequenceCollection.items.map((item, index) => {
		const authored = parseSequence(item.value);
		const clip = authored.clips[0];
		if (authored.clips.length !== 1 || !clip || clip.clipId !== item.itemId) {
			throw new Error(`chapter-sequence item ${index} must submit exactly its frozen Clip`);
		}
		return clip;
	});
	return projectChapterSequence({
		executionId: input.executionId,
		nodeId: input.nodeId,
		sequence: { protocolVersion: CHAPTER_SEQUENCE_ARTIFACT_TYPE, clips: authoredClips },
		clipSourceSegmentsCollection: input.clipSourceSegmentsCollection,
		deliveryContract: input.deliveryContract,
	});
}

/** Verify authored continuity against frozen Clip/source facts; project speech verbatim from UTF-16 ranges. */
export function projectChapterSequence(input: Readonly<{
	executionId: string;
	nodeId: string;
	sequence: unknown;
	clipSourceSegmentsCollection: unknown;
	deliveryContract: unknown;
}>): Readonly<{
	chapterSequence: BoundChapterSequence;
	clipCollection: WorkflowCollectionV1<ChapterSequenceClipItem>;
}> {
	const sources = frozenSources(input.deliveryContract);
	const segments = sourceSegments(input.clipSourceSegmentsCollection, sources);
	const authored = parseSequence(input.sequence);
	if (authored.clips.length !== segments.items.length) {
		throw new Error(`chapter-sequence Clip count differs from frozen segmentation: expected=${segments.items.length}:actual=${authored.clips.length}`);
	}
	const boundClips = authored.clips.map((clip, index): BoundChapterSequenceClip => {
		const segment = segments.items[index]?.value;
		if (!segment || clip.clipId !== segment.clipId || clip.clipIndex !== segment.clipIndex
			|| clip.durationSeconds !== segment.durationSeconds || !sameRanges(clip.sourceRanges, segment.sourceRanges)) {
			throw new Error(`chapter-sequence.clips[${index}] identity, duration or UTF-16 ranges differ from frozen Clip`);
		}
		const storyIds = new Set<string>();
		clip.storyEvents.forEach((event, eventIndex) => {
			assertTimedEvent(event, segment.durationSeconds, `clips[${index}].storyEvents[${eventIndex}]`);
			if (storyIds.has(event.eventId)) throw new Error(`clips[${index}] duplicates story event ${event.eventId}`);
			storyIds.add(event.eventId);
		});
		const speechIds = new Set<string>();
		const speechEvents = clip.speechEvents.map((event, eventIndex) => {
			const field = `clips[${index}].speechEvents[${eventIndex}]`;
			assertTimedEvent(event, segment.durationSeconds, field);
			if (speechIds.has(event.speechEventId)) throw new Error(`clips[${index}] duplicates speech event ${event.speechEventId}`);
			speechIds.add(event.speechEventId);
			return { ...event, text: projectSpeechText(event.sourceRanges, segment.sourceRanges, sources, field) };
		});
		return { ...clip, sourceRanges: segment.sourceRanges, speechEvents };
	});
	const items = boundClips.map((clip, index): ChapterSequenceClipItem => {
		const previous = boundClips[index - 1];
		const next = boundClips[index + 1];
		return {
			...clip,
			protocolVersion: CHAPTER_SEQUENCE_CLIP_ARTIFACT_TYPE,
			previousBoundary: previous ? {
				clipId: previous.clipId, endKeyframe: previous.endKeyframe,
				irreversibleResult: previous.irreversibleResult, handoff: previous.handoff,
			} : null,
			nextBoundary: next ? {
				clipId: next.clipId, startKeyframe: next.startKeyframe, causalEntry: next.causalEntry,
			} : null,
		};
	});
	return {
		chapterSequence: { protocolVersion: BOUND_CHAPTER_SEQUENCE_ARTIFACT_TYPE, clips: boundClips },
		clipCollection: createWorkflowCollection({
			collectionId: `${input.executionId}:${input.nodeId}:chapter-sequence-clips`,
			producerNodeId: input.nodeId,
			producerPortId: "chapter-sequence-clips",
			values: items,
			itemIds: items.map((item) => item.clipId),
			parentLineage: segments.items.map((item) => item.lineage),
		}),
	};
}
