import type { SpokenScriptLine } from "../task/video-orchestrator.spoken-script";
import type { WorkflowClipAssetObjectContract } from "./execution.video-workflow-continuity";

type JsonRecord = Record<string, unknown>;

type SequenceContextSource = Readonly<{
	executionId: string;
	nodeId: string;
	path: readonly string[];
	revision?: string;
}>;

export type FrozenSequenceClip = Readonly<{
	beat: JsonRecord;
	spokenScript: readonly SpokenScriptLine[];
	assetObjectContracts: readonly WorkflowClipAssetObjectContract[];
}>;

/**
 * Adjacent writers need the actual frozen events, speech and physical facts,
 * not only a statement that the next clip should continue. Copy those facts
 * without inferring an edit, completing missing prose or importing another
 * writer's uncommitted draft. The global timeline remains compact; only the
 * immediate neighbours carry full authoring facts.
 */
export function buildFrozenSequenceContext(input: Readonly<{
	clipIndex: number;
	chapterArc: JsonRecord;
	sequenceControlPlan: JsonRecord;
	sequenceTimeline: readonly JsonRecord[];
	clips: readonly FrozenSequenceClip[];
	sequenceSource?: SequenceContextSource;
}>): JsonRecord {
	const project = (index: number): JsonRecord | null => {
		if (index < 0 || index >= input.clips.length) return null;
		const clip = input.clips[index];
		const summary = input.sequenceTimeline[index];
		if (!clip || !summary) throw new Error(`Sequence context is missing frozen clip ${index}`);
		return {
			...summary,
			...Object.fromEntries([
				"sourceSpan", "startKeyframe", "endKeyframe", "exitState",
				"characters", "storyEvents", "temporalContext", "sceneState", "continuityLedger",
			].flatMap((field) => Object.prototype.hasOwnProperty.call(clip.beat, field)
				? [[field, clip.beat[field]]]
				: [])),
			spokenScript: clip.spokenScript,
			assetObjectContracts: clip.assetObjectContracts,
		};
	};
	if (!Number.isInteger(input.clipIndex) || input.clipIndex < 0 || input.clipIndex >= input.clips.length) {
		throw new Error("Sequence context requires an existing clipIndex");
	}
	const includedClipIndices = [input.clipIndex - 1, input.clipIndex, input.clipIndex + 1]
		.filter((index) => index >= 0 && index < input.clips.length);
	const adjacentTimeline = input.sequenceTimeline.filter((entry) => {
		const entryClipIndex = entry.clipIndex;
		return typeof entryClipIndex === "number"
			&& Number.isInteger(entryClipIndex)
			&& Math.abs(entryClipIndex - input.clipIndex) <= 1;
	});
	if (adjacentTimeline.length !== includedClipIndices.length) {
		throw new Error("Sequence timeline must contain the current Clip and its adjacent frozen Clips");
	}
	const sourceRead = input.sequenceSource
		? {
			tool: "tapcanvas_execution_node_runs_get",
			args: {
				executionId: input.sequenceSource.executionId,
				nodeId: input.sequenceSource.nodeId,
				view: "content",
				field: "input",
				path: [...input.sequenceSource.path],
				...(input.sequenceSource.revision ? { revision: input.sequenceSource.revision } : {}),
			},
			pagination: { cursor: "offset", next: "nextOffset", consistency: "revision" },
		}
		: null;
	const sequenceContextScope = {
		protocolVersion: "tapcanvas.sequence-context-scope/v1",
		currentClipIndex: input.clipIndex,
		totalClipCount: input.clips.length,
		timeline: {
			scope: "current_and_adjacent",
			includedClipIndices,
			omittedClipCount: input.clips.length - includedClipIndices.length,
		},
		controlPlan: {
			scope: "full_canonical",
			includedSegmentIndices: Array.from({ length: input.clips.length }, (_, index) => index),
			totalSegmentCount: Array.isArray(input.sequenceControlPlan.segments)
				? input.sequenceControlPlan.segments.length
				: input.clips.length,
		},
		readPolicy: "read_parent_beat_sheet_for_non_adjacent_clips",
		...(sourceRead ? { fullSequenceRead: sourceRead } : {}),
	};
	return {
		chapterArc: input.chapterArc,
		// Keep the canonical control plan complete. The prompt-facing runner owns
		// the single current-segment projection by stable clipIndex; shrinking it
		// here would make a second projection lose segments for later Clips.
		sequenceControlPlan: input.sequenceControlPlan,
		sequenceTimeline: adjacentTimeline,
		sequenceContextScope,
		executionPolicy: "execute_frozen_beat",
		previous: project(input.clipIndex - 1),
		current: project(input.clipIndex),
		next: project(input.clipIndex + 1),
	};
}
