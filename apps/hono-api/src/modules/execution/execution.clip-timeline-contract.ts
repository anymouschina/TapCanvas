import { deriveClipTimelineSegments, type ClipTimelineSegment } from "../../../../../packages/schemas/clip-production-packet/timeline.mjs";
import { clipSegmentStaging } from "./execution.chapter-staging";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The Clip writer's view of its own window. The previous side stays whole: it is
 * how the writer enters from the prior state without replaying it. The next side
 * keeps only the state at the cut. The following window's actions, lines and
 * source were supplied as a "do not perform" list, yet flash writers used them to
 * fill their last seconds, so the next Clip played them again (ch1 5→6, 6→7).
 * The frozen chapter-sequence item itself is unchanged.
 */
export function projectClipSequenceForWriter(clipSequence: unknown): unknown {
	if (!isRecord(clipSequence)) return clipSequence;
	const { handoff: _nextHandoff, nextBoundary, globalStartSeconds: _slotStart, globalEndSeconds: _slotEnd, ...own } = clipSequence;
	return {
		...own,
		nextBoundary: isRecord(nextBoundary)
			? { clipId: nextBoundary.clipId, startKeyframe: nextBoundary.startKeyframe }
			: nextBoundary ?? null,
	};
}

/** Ordered frozen facts, independent of the writer's editorial cuts. */
export function clipTimelineSegments(clipSequence: Record<string, unknown>): readonly ClipTimelineSegment[] {
	return deriveClipTimelineSegments({
		storyEvents: Array.isArray(clipSequence.storyEvents) ? clipSequence.storyEvents : [],
		speechEvents: Array.isArray(clipSequence.speechEvents) ? clipSequence.speechEvents : [],
	});
}

export type ClipSegmentPresence = Readonly<{
	onStage: readonly string[];
	entering: readonly string[];
	/** Who leaves the frame during the segment. */
	leaving?: readonly string[];
	/** The segment opens a new scene (a flashback, or the return from one): its opening cast is already there, not entering. */
	sceneChange?: true;
	/** Frozen staging: where everyone is when the segment opens (first segment and new scenes) and the moves it plays. */
	positions?: readonly string[] | null;
	moves?: readonly string[];
}>;

/**
 * Who is present in each ordered story event, from the frozen events' `onScreen` facts:
 * the cast at the segment's first event plus everyone who enters during it, and
 * where they stand when the sequence carries a staging ledger.
 * Null when the frozen sequence carries no presence facts.
 */
export function clipSegmentPresence(clipSequence: Record<string, unknown>, segments: readonly ClipTimelineSegment[]): readonly ClipSegmentPresence[] | null {
	const events = (Array.isArray(clipSequence.storyEvents) ? clipSequence.storyEvents : []).filter(isRecord);
	if (!events.some((event) => Array.isArray(event.onScreen))) return null;
	const byId = new Map(events.map((event) => [String(event.eventId), event]));
	const staging = clipSegmentStaging(clipSequence, segments);
	const names = (event: Record<string, unknown> | undefined) => Array.isArray(event?.onScreen)
		? event!.onScreen.filter((name): name is string => typeof name === "string") : [];
	// A segment is usually one beat, and an entrance beat already lists the newcomer
	// as on screen, so an entrance is whoever the previous segment did not end with.
	// A new scene starts over: ch1 returned from a flashback to the room where everyone
	// was already seated, and the prompt told the model all three walked in again.
	let previous: readonly string[] | null = null;
	let previousScene: unknown;
	return segments.map((segment, index) => {
		const ordered = segment.storyEventIds.map((id) => byId.get(id)).filter((event): event is Record<string, unknown> => event !== undefined)
			.sort((left, right) => Number(left.eventIndex) - Number(right.eventIndex));
		// A sceneId is a dramatic scene, not a place: ch1 split one conversation in one
		// room into two scenes, and the prompt announced a cut "to another scene". The
		// marker only exists so an opening cast is not read as walking in; a new scene
		// that opens with exactly the cast already on stage has nobody to walk in.
		const opening = ordered.length > 0 ? names(ordered[0]) : [];
		const sameCast = previous !== null && opening.length === previous.length && opening.every((name) => previous!.includes(name));
		const sceneChange = previous !== null && ordered.length > 0 && ordered[0]!.sceneId !== undefined && ordered[0]!.sceneId !== previousScene && !sameCast;
		const before: readonly string[] = previous === null || sceneChange ? names(ordered[0]) : previous;
		const onStage = ordered.length > 0 ? names(ordered[0]).filter((name) => before.includes(name)) : [...before];
		const entering = [...new Set(ordered.flatMap(names))].filter((name) => !before.includes(name));
		const after = ordered.length > 0 ? names(ordered[ordered.length - 1]) : before;
		const leaving = [...new Set([...before, ...entering])].filter((name) => !after.includes(name));
		if (ordered.length > 0) {
			previous = after;
			previousScene = ordered[ordered.length - 1]!.sceneId;
		}
		return { onStage, entering, leaving, ...(sceneChange ? { sceneChange: true as const } : {}), ...(staging ? { positions: staging[index]!.positions, moves: staging[index]!.moves } : {}) };
	});
}

/** Bind ordered frozen input facts without prescribing shot count or timing. */
export function bindClipTimelineFacts(
	videoPrompt: Record<string, unknown>,
	clipSequence: Record<string, unknown>,
): void {
	const properties = videoPrompt.properties;
	if (!isRecord(properties) || !isRecord(properties.shots)) {
		throw new Error("Clip production timeline draft schema is missing shots");
	}
	const segments = clipTimelineSegments(clipSequence);
	const presence = clipSegmentPresence(clipSequence, segments);
	const facts = {
		startKeyframe: clipSequence.startKeyframe,
		endKeyframe: clipSequence.endKeyframe,
		previousBoundary: clipSequence.previousBoundary,
		nextBoundary: (projectClipSequenceForWriter(clipSequence) as Record<string, unknown>).nextBoundary,
		storyEvents: clipSequence.storyEvents,
		speechEvents: clipSequence.speechEvents,
		...(presence ? { presenceTimeline: segments.map((segment, index) => ({
			storyEventIds: segment.storyEventIds,
			...presence[index],
		})) } : {}),
	};
	properties.shots.description = [
		"Author ordered descriptive shots. Choose their count and cut points from this Clip's action; the video model adapts timing within the provider request. No per-shot seconds, fixed shot count or padding shots.",
		"Bind storyEventIds for depicted events and speechEventIds for complete lines that begin in each shot. Every story event must be represented in order; an event may span several shots. Every frozen spoken line is bound to exactly one shot and is rendered once without timing or fragmentation. Do not copy speech into action, camera or sound.",
		"The following are ordered frozen input facts, not a required shot list. Previous/next boundaries are context, not extra events assigned to this Clip. Bind presence and staging through their storyEventIds.",
		JSON.stringify(facts),
	].join("\n");
}
