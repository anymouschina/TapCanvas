import type { SpokenScriptLine } from "../task/video-orchestrator.spoken-script";
import type { WorkflowClipAssetObjectContract } from "./execution.video-workflow-continuity";

type JsonRecord = Record<string, unknown>;

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
	return {
		chapterArc: input.chapterArc,
		sequenceControlPlan: input.sequenceControlPlan,
		sequenceTimeline: input.sequenceTimeline,
		executionPolicy: "execute_frozen_beat",
		previous: project(input.clipIndex - 1),
		current: project(input.clipIndex),
		next: project(input.clipIndex + 1),
	};
}
