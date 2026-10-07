import {
	CHAPTER_SEQUENCE_ARTIFACT_TYPE,
	type AuthoredChapterSequence,
	type ChapterScript,
	type ChapterScriptBeat,
	type ChapterScriptScene,
	type ChapterSequenceAdaptationSpan,
	type ChapterSequenceBoundary,
	type ChapterSequenceScene,
	type ChapterSequenceSourceRange,
	type ChapterSequenceSpeechEvent,
	type ChapterSequenceStoryEvent,
	type ChapterSequenceWindow,
	type StagingPosition,
} from "../../../../../packages/schemas/chapter-sequence/index.mjs";
import type { AuthoredSceneStaging } from "./execution.chapter-script-staging";
import type { ChapterSequenceFrozenSource } from "./execution.chapter-sequence.contract";
import { bindChapterSequenceQuoteRanges } from "./execution.chapter-sequence.source-quotes";
import { validateChapterSequenceFacts } from "./execution.chapter-sequence.validation";
import type { parseWorkflowVideoDeliveryDurationPlan } from "./execution.video-workflow-contract";

const MAX_WINDOWS = 80;
function nonEmpty(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }

export type PlannedChapterScriptBeat = Readonly<{
	sceneIndex: number;
	beatIndex: number;
	beat: ChapterScriptBeat;
	onScreen: readonly string[];
	moves: readonly StagingPosition[];
	staging: readonly StagingPosition[] | null;
}>;

/** Bind explicit ordered content to provider submissions without inventing event timing. */
export function compileChapterScriptSequence(input: Readonly<{
	value: ChapterScript;
	deliveryContract: unknown;
	planned: readonly PlannedChapterScriptBeat[];
	plan: ReturnType<typeof parseWorkflowVideoDeliveryDurationPlan>;
	sources: readonly ChapterSequenceFrozenSource[];
	sceneRanges: readonly (readonly ChapterSequenceSourceRange[])[];
	sceneLedger: readonly AuthoredSceneStaging[];
	adaptation: readonly ChapterSequenceAdaptationSpan[];
	catalog: readonly Readonly<{ id: string; text: string }>[];
}>): AuthoredChapterSequence {
	const { value, planned, plan, deliveryContract, sources, sceneRanges, sceneLedger, adaptation, catalog } = input;
	if (!Array.isArray(value.clips) || value.clips.length === 0 || value.clips.length > MAX_WINDOWS) throw new Error(`chapter script requires 1..${MAX_WINDOWS} explicit provider clips`);
	const clipOrder = new Map<string, number>();
	for (const [index, clip] of value.clips.entries()) {
		if (!nonEmpty(clip.clipId) || clipOrder.has(clip.clipId)) throw new Error(`clips[${index}].clipId must be unique and non-empty`);
		if (!Number.isSafeInteger(clip.durationSeconds) || !plan.durationOptions.includes(clip.durationSeconds)) throw new Error(`clips[${index}].durationSeconds must use one frozen provider duration ${JSON.stringify(plan.durationOptions)}`);
		clipOrder.set(clip.clipId, index);
	}
	let previousClipIndex = -1;
	const storyEvents: ChapterSequenceStoryEvent[] = [];
	const speechEvents: ChapterSequenceSpeechEvent[] = [];
	for (const [eventIndex, item] of planned.entries()) {
		const scene = value.scenes[item.sceneIndex]!;
		const { beat } = item;
		const clipIndex = clipOrder.get(beat.clipId);
		if (clipIndex === undefined) throw new Error(`scenes[${item.sceneIndex}].beats[${item.beatIndex}].clipId names an unknown clip ${beat.clipId}`);
		if (clipIndex < previousClipIndex) throw new Error("beat clip ownership must follow the declared clip order");
		previousClipIndex = clipIndex;
		const eventId = `${scene.sceneId}-b${item.beatIndex + 1}`;
		const visual = beat.kind === "line" ? beat.visual.trim() : beat.text.trim();
		storyEvents.push({ eventId, eventIndex, clipId: beat.clipId, action: item.beatIndex === 0 ? `（${scene.setting}）${visual}` : visual,
			sourceRanges: sceneRanges[item.sceneIndex]!, onScreen: item.onScreen, sceneId: scene.sceneId, performance: beat.performance,
			...(item.moves.length > 0 ? { moves: item.moves } : {}), ...(item.staging ? { staging: item.staging } : {}) });
		if (beat.kind === "line") speechEvents.push({ speechEventId: `${scene.sceneId}-s${item.beatIndex + 1}`, eventIndex, clipId: beat.clipId,
			sceneId: scene.sceneId, scope: "beat", storyEventId: eventId, speaker: beat.speaker.trim(), delivery: beat.delivery.trim(),
			text: beat.text, textOrigin: beat.textOrigin, voice: beat.voice, sourceRanges: [] });
	}
	for (const [sceneIndex, scene] of value.scenes.entries()) {
		const voice = scene.memoryVoice;
		if (!voice) continue;
		const members = storyEvents.filter((event) => event.sceneId === scene.sceneId && event.clipId === voice.clipId);
		if (members.length === 0) throw new Error(`scenes[${sceneIndex}].memoryVoice.clipId must belong to this scene`);
		const unit = voice.unit ? catalog.find((item) => item.id === voice.unit) : undefined;
		if (voice.unit && !unit) throw new Error(`scenes[${sceneIndex}].memoryVoice.unit names an unknown source unit`);
		for (const id of voice.conveys ?? []) if (!catalog.some((item) => item.id === id)) throw new Error(`scenes[${sceneIndex}].memoryVoice.conveys names an unknown source unit ${id}`);
		const text = unit?.text ?? voice.text;
		if (!nonEmpty(voice.speaker) || !nonEmpty(voice.delivery) || !nonEmpty(text) || !["onscreen", "inner", "offscreen", "narration"].includes(voice.voice)) throw new Error(`scenes[${sceneIndex}].memoryVoice requires speaker, voice, delivery and says`);
		speechEvents.push({ speechEventId: `${scene.sceneId}-memory-voice`, eventIndex: members[0]!.eventIndex, clipId: voice.clipId,
			sceneId: scene.sceneId, scope: "scene", speaker: voice.speaker.trim(), delivery: voice.delivery.trim(), text,
			textOrigin: unit ? "source_quote" : voice.textOrigin, voice: voice.voice, sourceRanges: [] });
	}
	speechEvents.sort((left, right) => left.eventIndex - right.eventIndex);
	let clock = 0;
	const boundaries: ChapterSequenceBoundary[] = value.clips.map((clip, index) => {
		const first = storyEvents.find((event) => event.clipId === clip.clipId);
		if (!first) throw new Error(`clips[${index}] must own at least one ordered beat`);
		const scene = value.scenes.find((item) => item.sceneId === first.sceneId)!;
		const previous = index > 0 ? storyEvents.filter((event) => event.clipId === value.clips[index - 1]!.clipId).at(-1) : undefined;
		const previousScene = previous ? value.scenes.find((item) => item.sceneId === previous.sceneId) : undefined;
		const sceneOpens = first.eventId === `${scene.sceneId}-b1`;
		const previousCompletesScene = previous && previousScene && previous.eventId === `${previousScene.sceneId}-b${previousScene.beats.length}`;
		const boundary: ChapterSequenceBoundary = { boundaryId: `boundary-${index}`, timeSeconds: clock,
			keyframe: { visual: scene.setting, state: sceneOpens ? scene.entryState : `接续本场；此前已演：${previous?.action ?? scene.entryState}` },
			causalEntry: sceneOpens ? scene.entryState : `接着演：${first.action}`,
			irreversibleResult: previousCompletesScene ? previousScene.exitState : "", handoff: index === 0 ? "全片开始" : `下一段接着演：${first.action}` };
		clock += clip.durationSeconds;
		return boundary;
	});
	const lastScene = value.scenes.at(-1)!;
	boundaries.push({ boundaryId: `boundary-${value.clips.length}`, timeSeconds: clock, keyframe: { visual: lastScene.setting, state: lastScene.exitState }, causalEntry: lastScene.exitState, irreversibleResult: lastScene.exitState, handoff: "全片结束" });
	const clips: ChapterSequenceWindow[] = value.clips.map((clip, index) => ({ ...clip,
		storyEventIds: storyEvents.filter((event) => event.clipId === clip.clipId).map((event) => event.eventId),
		speechEventIds: speechEvents.filter((event) => event.clipId === clip.clipId).map((event) => event.speechEventId),
		startBoundaryId: `boundary-${index}`, endBoundaryId: `boundary-${index + 1}` }));
	const scenes: ChapterSequenceScene[] = value.scenes.map((scene: ChapterScriptScene, index: number) => ({ sceneId: scene.sceneId, setting: scene.setting,
		entryState: scene.entryState, exitState: scene.exitState, adapts: [...scene.adapts], clipIds: [...new Set(scene.beats.map((beat: ChapterScriptBeat) => beat.clipId))],
		...(sceneLedger[index]!.layout ? { layout: sceneLedger[index]!.layout } : {}),
		...(scene.positions !== undefined || sceneLedger[index]!.positions.size > 0 ? { positions: [...sceneLedger[index]!.positions.values()] } : {}) }));
	const sequence: AuthoredChapterSequence = { protocolVersion: CHAPTER_SEQUENCE_ARTIFACT_TYPE, wholeFilmIntent: value.wholeFilmIntent,
		totalDurationSeconds: clock, adaptation, scenes, storyEvents, speechEvents, boundaries, clips,
		...(value.authoringRecord ? { authoringRecord: value.authoringRecord } : {}) };
	const bound = bindChapterSequenceQuoteRanges(sequence, sources) as AuthoredChapterSequence;
	validateChapterSequenceFacts(bound, deliveryContract, sources);
	return bound;
}
