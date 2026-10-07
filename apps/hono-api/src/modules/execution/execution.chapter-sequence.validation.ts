import type {
	AuthoredChapterSequence,
	ChapterSequenceSourceRange,
} from "../../../../../packages/schemas/chapter-sequence/index.mjs";
import { parseWorkflowVideoDeliveryDurationPlan } from "./execution.video-workflow-contract";
import {
	frozenChapterSources,
	parseAuthoredChapterSequence,
	type ChapterSequenceFrozenSource,
} from "./execution.chapter-sequence.contract";

export type ChapterSequencePhysicalWindow = Readonly<{
	startSeconds: number;
	endSeconds: number;
	durationSeconds: number;
}>;

function record(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonicalText(value: unknown): value is string {
	return typeof value === "string" && value.length > 0 && value === value.trim();
}

function splitsSurrogatePair(content: string, offset: number): boolean {
	if (offset <= 0 || offset >= content.length) return false;
	const previous = content.charCodeAt(offset - 1);
	const next = content.charCodeAt(offset);
	return previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff;
}

export function readChapterSequenceSourceRanges(
	value: unknown,
	sources: readonly ChapterSequenceFrozenSource[],
	field: string,
): readonly ChapterSequenceSourceRange[] {
	if (!Array.isArray(value) || value.length === 0) throw new Error(`${field} must contain source provenance ranges`);
	const ranges = value.map((raw, index): ChapterSequenceSourceRange => {
		if (!record(raw) || !Number.isSafeInteger(raw.sourceIndex) || !Number.isSafeInteger(raw.startOffset)
			|| !Number.isSafeInteger(raw.endOffset) || typeof raw.sourceId !== "string"
			|| typeof raw.sourceFingerprint !== "string") {
			throw new Error(`${field}[${index}] must contain integer UTF-16 offsets and frozen source identity`);
		}
		const range = raw as unknown as ChapterSequenceSourceRange;
		const source = sources[range.sourceIndex];
		if (!source || range.sourceId !== source.sourceId || range.sourceFingerprint !== source.sourceFingerprint
			|| range.startOffset < 0 || range.endOffset <= range.startOffset || range.endOffset > source.content.length
			|| splitsSurrogatePair(source.content, range.startOffset) || splitsSurrogatePair(source.content, range.endOffset)) {
			throw new Error(`${field}[${index}] differs from frozen UTF-16 source coordinates`);
		}
		return range;
	});
	return ranges;
}

function assertSpeechSourceRangesAreOrdered(
	ranges: readonly ChapterSequenceSourceRange[],
	field: string,
): void {
	for (let index = 1; index < ranges.length; index += 1) {
		const previous = ranges[index - 1];
		const current = ranges[index];
		if (previous && current && (current.sourceIndex < previous.sourceIndex
			|| (current.sourceIndex === previous.sourceIndex && current.startOffset < previous.endOffset))) {
			throw new Error(`${field} must be ordered and non-overlapping for speech text projection`);
		}
	}
}

function globalSourceRanges(
	sequence: AuthoredChapterSequence,
	sources: readonly ChapterSequenceFrozenSource[],
): readonly ChapterSequenceSourceRange[] {
	return [
		...sequence.storyEvents.flatMap((event, index) => readChapterSequenceSourceRanges(event.sourceRanges, sources, `storyEvents[${index}].sourceRanges`)),
		...sequence.speechEvents.flatMap((event, index) => {
			const field = `speechEvents[${index}].sourceRanges`;
			const ranges = event.sourceRanges.length === 0 && event.textOrigin === "authored"
				? [] : readChapterSequenceSourceRanges(event.sourceRanges, sources, field);
			if (event.textOrigin === "source_quote") {
				assertSpeechSourceRangesAreOrdered(ranges, `chapter-sequence.${field}`);
				const quotedText = ranges.map((range) => sources[range.sourceIndex]!.content.slice(range.startOffset, range.endOffset)).join("");
				if (event.text !== quotedText) {
					throw new Error(`chapter-sequence.speechEvents[${index}].text differs from its source_quote ranges`);
				}
			}
			return ranges;
		}),
	];
}

function windowsFor(sequence: AuthoredChapterSequence): readonly ChapterSequencePhysicalWindow[] {
	let startSeconds = 0;
	return sequence.clips.map((clip) => {
		const window = { startSeconds, endSeconds: startSeconds + clip.durationSeconds, durationSeconds: clip.durationSeconds };
		startSeconds = window.endSeconds;
		return window;
	});
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((value, index) => value === right[index]);
}

function assertTimelineReferences(
	sequence: AuthoredChapterSequence,
	deliveryContract: unknown,
	windows: readonly ChapterSequencePhysicalWindow[],
): void {
	const durationPlan = parseWorkflowVideoDeliveryDurationPlan(deliveryContract);
	const totalDurationSeconds = windows.reduce((total, window) => total + window.durationSeconds, 0);
	if (!Number.isSafeInteger(sequence.totalDurationSeconds) || sequence.totalDurationSeconds <= 0) {
		throw new Error("chapter-sequence totalDurationSeconds must be a positive safe integer");
	}
	if (totalDurationSeconds !== sequence.totalDurationSeconds) {
		throw new Error(`chapter-sequence clip windows total ${totalDurationSeconds} seconds, expected ${sequence.totalDurationSeconds}`);
	}
	if (durationPlan.targetDurationSeconds !== null && totalDurationSeconds !== durationPlan.targetDurationSeconds) {
		throw new Error(`chapter-sequence total duration differs from frozen target: expected=${durationPlan.targetDurationSeconds}:actual=${totalDurationSeconds}`);
	}
	for (const [index, window] of windows.entries()) {
		if (!durationPlan.durationOptions.includes(window.durationSeconds)) {
			throw new Error(`chapter-sequence.clips[${index}].durationSeconds must use one frozen provider duration ${JSON.stringify(durationPlan.durationOptions)}`);
		}
	}
	const topology = durationPlan.providerSubmissionTopology;
	if (topology && (topology.source === "user_clip_count" || topology.source === "user_clip_durations")
		&& windows.length !== topology.expectedClipCount) {
		throw new Error(`chapter-sequence clip count differs from frozen provider topology: expected=${topology.expectedClipCount}:actual=${windows.length}`);
	}
	if (topology?.source === "model_max_duration" && windows.length < topology.expectedClipCount) {
		throw new Error(`chapter-sequence clip count is below the frozen provider minimum: expected-at-least=${topology.expectedClipCount}:actual=${windows.length}`);
	}
	if (topology?.source === "user_clip_durations"
		&& windows.some((window, index) => window.durationSeconds !== topology.minimumClipDurations[index])) {
		throw new Error(`chapter-sequence durations differ from frozen requested windows: expected=${JSON.stringify(topology.minimumClipDurations)}:actual=${JSON.stringify(windows.map((window) => window.durationSeconds))}`);
	}
	if (sequence.boundaries.length !== windows.length + 1) {
		throw new Error(`chapter-sequence requires one shared boundary per physical window edge: expected=${windows.length + 1}:actual=${sequence.boundaries.length}`);
	}
	const boundaryIds = new Set<string>();
	for (const [index, boundary] of sequence.boundaries.entries()) {
		const expectedTime = index === 0 ? 0 : windows[index - 1]?.endSeconds;
		if (!canonicalText(boundary.boundaryId) || boundaryIds.has(boundary.boundaryId)
			|| !Number.isSafeInteger(boundary.timeSeconds) || boundary.timeSeconds !== expectedTime) {
			throw new Error(`chapter-sequence.boundaries[${index}] must identify the exact shared physical window boundary`);
		}
		boundaryIds.add(boundary.boundaryId);
	}
	const clipIds = new Set<string>();
	for (const [index, clip] of sequence.clips.entries()) {
		if (!canonicalText(clip.clipId) || clipIds.has(clip.clipId)) throw new Error(`chapter-sequence.clips[${index}].clipId must be unique and non-empty`);
		clipIds.add(clip.clipId);
	}
	const storyIds = new Set<string>();
	const clipOrder = new Map(sequence.clips.map((clip, index) => [clip.clipId, index]));
	let previousClipIndex = -1;
	for (const [index, event] of sequence.storyEvents.entries()) {
		if (!canonicalText(event.eventId) || storyIds.has(event.eventId)) throw new Error(`chapter-sequence.storyEvents[${index}] has a missing or duplicate eventId`);
		if (event.eventIndex !== index) throw new Error(`chapter-sequence.storyEvents[${index}].eventIndex must preserve ordered event identity`);
		const clipIndex = clipOrder.get(event.clipId);
		if (clipIndex === undefined || clipIndex < previousClipIndex) throw new Error(`chapter-sequence.storyEvents[${index}].clipId must follow declared clip order`);
		previousClipIndex = clipIndex;
		storyIds.add(event.eventId);
	}
	const speechIds = new Set<string>();
	let previousSpeechIndex = -1;
	for (const [index, event] of sequence.speechEvents.entries()) {
		if (!canonicalText(event.speechEventId) || speechIds.has(event.speechEventId)) throw new Error(`chapter-sequence.speechEvents[${index}] has a missing or duplicate speechEventId`);
		if (!Number.isSafeInteger(event.eventIndex) || event.eventIndex < previousSpeechIndex || !clipIds.has(event.clipId)) throw new Error(`chapter-sequence.speechEvents[${index}] must preserve event order and explicit clip ownership`);
		const owner = sequence.storyEvents.find((story) => story.eventIndex === event.eventIndex);
		if (!owner || owner.clipId !== event.clipId || owner.sceneId !== event.sceneId) throw new Error(`chapter-sequence.speechEvents[${index}] must reference an event position in its scene and clip`);
		if (event.scope === "beat" && event.storyEventId !== owner.eventId) throw new Error(`chapter-sequence.speechEvents[${index}].storyEventId must identify its declared beat`);
		if (event.scope === "scene" && event.storyEventId !== undefined) throw new Error(`chapter-sequence.speechEvents[${index}] scene voice must not claim a single beat`);
		previousSpeechIndex = event.eventIndex;
		speechIds.add(event.speechEventId);
	}
	for (const [index, clip] of sequence.clips.entries()) {
		if (clip.startBoundaryId !== sequence.boundaries[index]?.boundaryId || clip.endBoundaryId !== sequence.boundaries[index + 1]?.boundaryId) throw new Error(`chapter-sequence.clips[${index}] must reference adjacent physical submission boundaries`);
		const expectedStory = sequence.storyEvents.filter((event) => event.clipId === clip.clipId).map((event) => event.eventId);
		const expectedSpeech = sequence.speechEvents.filter((event) => event.clipId === clip.clipId).map((event) => event.speechEventId);
		if (expectedStory.length === 0 || !sameStrings(clip.storyEventIds, expectedStory)) throw new Error(`chapter-sequence.clips[${index}].storyEventIds must reference its ordered events exactly once`);
		if (!sameStrings(clip.speechEventIds, expectedSpeech)) throw new Error(`chapter-sequence.clips[${index}].speechEventIds must reference its speech instructions exactly once`);
	}
	for (const [index, scene] of (sequence.scenes ?? []).entries()) {
		const actual = [...new Set(sequence.storyEvents.filter((event) => event.sceneId === scene.sceneId).map((event) => event.clipId))];
		if (actual.length === 0 || !sameStrings(scene.clipIds, actual)) throw new Error(`chapter-sequence.scenes[${index}].clipIds must reference its declared event owners`);
	}
}

/** Validate deterministic source, submission duration and ordered reference facts before physical projection. */
export function validateChapterSequenceFacts(
	sequence: AuthoredChapterSequence,
	deliveryContract: unknown,
	sources: readonly ChapterSequenceFrozenSource[] = frozenChapterSources(deliveryContract),
): Readonly<{ windows: readonly ChapterSequencePhysicalWindow[]; sources: readonly ChapterSequenceFrozenSource[] }> {
	globalSourceRanges(sequence, sources);
	for (const [index, span] of (sequence.adaptation ?? []).entries()) {
		readChapterSequenceSourceRanges(span.sourceRanges, sources, `adaptation[${index}].sourceRanges`);
	}
	const windows = windowsFor(sequence);
	assertTimelineReferences(sequence, deliveryContract, windows);
	return { windows, sources };
}

export function parseAndValidateChapterSequence(
	value: unknown,
	deliveryContract: unknown,
): Readonly<{
	sequence: AuthoredChapterSequence;
	sources: readonly ChapterSequenceFrozenSource[];
	windows: readonly ChapterSequencePhysicalWindow[];
}> {
	const sequence = parseAuthoredChapterSequence(value);
	const { windows, sources } = validateChapterSequenceFacts(sequence, deliveryContract);
	return { sequence, sources, windows };
}
