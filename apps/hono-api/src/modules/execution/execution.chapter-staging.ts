import {
	STAGING_POSTURES,
	type ChapterSequenceClipStaging,
	type StagingLayout,
	type StagingMark,
	type StagingPoint,
	type StagingPosition,
	type StagingPosture,
} from "../../../../../packages/schemas/chapter-sequence/index.mjs";
import { CLIP_STAGING_PROTOCOL, type ClipProductionStagingPlan } from "../../../../../packages/schemas/clip-production-packet/index.mjs";

/**
 * Staging ledger: where everyone is, scene by scene and beat by beat. The chapter
 * author declares each scene's floor plan, the cast's opening positions and every
 * move; the host tracks the state and hands each Clip writer and the video model
 * the same positions. Clip writers used to place people on their own, so one
 * Clip sat a character at the table and the next had her standing by the door.
 */

type JsonRecord = Record<string, unknown>;

function record(value: unknown): value is JsonRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

const AT_VERB: Readonly<Record<StagingPosture, string>> = { stand: "站在", sit: "坐在", kneel: "跪在", crouch: "蹲在", lie: "躺在" };
const SETTLE: Readonly<Record<StagingPosture, string>> = { stand: "", sit: "坐下", kneel: "跪下", crouch: "蹲下", lie: "躺下" };
const CHANGE: Readonly<Record<StagingPosture, string>> = { stand: "站起身", sit: "坐下", kneel: "跪下", crouch: "蹲下", lie: "躺下" };
/** Short posture labels for floor-plan diagrams. */
export const STAGING_POSTURE_LABEL: Readonly<Record<StagingPosture, string>> = { stand: "站", sit: "坐", kneel: "跪", crouch: "蹲", lie: "躺" };

export function isStagingPosture(value: unknown): value is StagingPosture {
	return typeof value === "string" && (STAGING_POSTURES as readonly string[]).includes(value);
}

function validPoint(value: unknown): value is StagingPoint {
	return Array.isArray(value) && value.length === 2
		&& value.every((coordinate) => typeof coordinate === "number" && Number.isFinite(coordinate) && coordinate >= 0 && coordinate <= 1);
}

/** Validate one authored floor plan and index its marks by name. */
export function readStagingLayout(value: unknown, label: string): ReadonlyMap<string, StagingMark> {
	if (!record(value) || !Array.isArray(value.landmarks) || value.landmarks.length === 0
		|| !Array.isArray(value.marks) || value.marks.length === 0) {
		throw new Error(`${label}.layout needs landmarks and marks: the scene's fixed landmarks and the named places people stand or sit on`);
	}
	value.landmarks.forEach((landmark, index) => {
		if (!record(landmark) || typeof landmark.label !== "string" || !landmark.label.trim() || !validPoint(landmark.at)) {
			throw new Error(`${label}.layout.landmarks[${index}] needs a label and an at point [x, y] within 0..1`);
		}
	});
	const marks = new Map<string, StagingMark>();
	value.marks.forEach((mark, index) => {
		if (!record(mark) || typeof mark.mark !== "string" || !mark.mark.trim()
			|| typeof mark.where !== "string" || !mark.where.trim() || !validPoint(mark.at)) {
			throw new Error(`${label}.layout.marks[${index}] needs mark, where and an at point [x, y] within 0..1`);
		}
		const name = mark.mark.trim();
		if (marks.has(name)) throw new Error(`${label}.layout.marks names ${JSON.stringify(name)} twice; give every mark a distinct name`);
		marks.set(name, { mark: name, where: mark.where.trim(), at: mark.at });
	});
	return marks;
}

/** Validate one position against the scene's marks. */
export function readStagingPosition(value: unknown, marks: ReadonlyMap<string, StagingMark>, label: string): StagingPosition {
	if (!record(value) || typeof value.who !== "string" || !value.who.trim()
		|| typeof value.mark !== "string" || !value.mark.trim() || !isStagingPosture(value.posture)) {
		throw new Error(`${label} needs who, mark and posture (${STAGING_POSTURES.join("/")})`);
	}
	const mark = value.mark.trim();
	if (!marks.has(mark)) {
		throw new Error(`${label} puts ${value.who.trim()} on mark ${JSON.stringify(mark)}, which the scene's layout.marks does not declare; `
			+ `use one of ${[...marks.keys()].map((name) => JSON.stringify(name)).join(", ")} or add the mark to layout.marks`);
	}
	return { who: value.who.trim(), mark, posture: value.posture };
}

/** 「顾观棋坐在茶桌北侧的主位」 */
export function describeStagingPosition(position: StagingPosition, marks: ReadonlyMap<string, StagingMark>): string {
	const where = marks.get(position.mark)?.where ?? position.mark;
	return `${position.who}${AT_VERB[position.posture]}${where}`;
}

/** One authored move as the audience sees it, relative to where the person was before; null when nothing changes. */
export function describeStagingMove(
	before: StagingPosition | undefined,
	after: StagingPosition,
	marks: ReadonlyMap<string, StagingMark>,
): string | null {
	const where = marks.get(after.mark)?.where ?? after.mark;
	if (!before) return `${after.who}进入画面，${AT_VERB[after.posture]}${where}`;
	if (before.mark !== after.mark) return `${after.who}走到${where}${SETTLE[after.posture]}`;
	if (before.posture !== after.posture) return `${after.who}在${where}${CHANGE[after.posture]}`;
	return null;
}

export function stagingMarks(layout: StagingLayout): ReadonlyMap<string, StagingMark> {
	return new Map(layout.marks.map((mark) => [mark.mark, mark]));
}

// ---------------------------------------------------------------- Clip segments

type ClipStagingEvent = Readonly<{
	eventId: string;
	eventIndex: number;
	sceneId: string | null;
	moves: readonly StagingPosition[];
	staging: readonly StagingPosition[] | null;
}>;

/** Read the frozen staging a Clip plays in; null for timelines compiled without a staging ledger. */
export function readClipStaging(clipSequence: unknown): ChapterSequenceClipStaging | null {
	if (!record(clipSequence) || !record(clipSequence.staging)) return null;
	const staging = clipSequence.staging;
	if (!Array.isArray(staging.scenes) || staging.scenes.length === 0 || !Array.isArray(staging.opening)) return null;
	return staging as unknown as ChapterSequenceClipStaging;
}

function clipStagingEvents(clipSequence: JsonRecord): readonly ClipStagingEvent[] {
	const events = (Array.isArray(clipSequence.storyEvents) ? clipSequence.storyEvents : []).filter(record)
		.map((event) => ({
			eventId: String(event.eventId),
			eventIndex: Number(event.eventIndex),
			sceneId: typeof event.sceneId === "string" ? event.sceneId : null,
			moves: Array.isArray(event.moves) ? event.moves as StagingPosition[] : [],
			staging: Array.isArray(event.staging) ? event.staging as StagingPosition[] : null,
		}))
		.sort((left, right) => left.eventIndex - right.eventIndex);
	const staging = readClipStaging(clipSequence);
	if (!staging) return events;
	const staged = new Set(staging.scenes.map((scene) => scene.sceneId));
	const firstSceneId = events.find((event) => event.sceneId !== null && staged.has(event.sceneId))?.sceneId ?? staging.scenes[0]!.sceneId;
	return events.map((event) => {
		// Memory montages are not staged: their events keep their moves as authored.
		if (event.sceneId !== null && !staged.has(event.sceneId)) return event;
		const initial = sceneOpening(staging, firstSceneId, event.sceneId ?? firstSceneId);
		let before = new Map(initial.map((position) => [position.who, position]));
		for (const completed of events) if (completed !== event && completed.sceneId === event.sceneId
			&& completed.eventIndex < event.eventIndex && completed.staging) {
			before = new Map(completed.staging.map((position) => [position.who, position]));
		}
		return { ...event, moves: event.moves.filter((move) => {
			const from = before.get(move.who);
			return !from || from.mark !== move.mark || from.posture !== move.posture;
		}) };
	});
}

export type ClipSegmentStaging = Readonly<{
	/** Everyone's place when the segment opens; set on the first segment and wherever a new scene begins. */
	positions: readonly string[] | null;
	/** Moves that start in this segment, in story order. */
	moves: readonly string[];
}>;

/** Declared preceding events establish positions without inventing movement timestamps. */
function confirmedPositionsBefore(opening: readonly StagingPosition[], events: readonly ClipStagingEvent[], eventIndex: number): ReadonlyMap<string, StagingPosition> {
	let state = new Map(opening.map((position) => [position.who, position]));
	for (const event of events) {
		if (event.eventIndex >= eventIndex) break;
		if (event.staging) state = new Map(event.staging.map((position) => [position.who, position]));
		else for (const move of event.moves) state.set(move.who, move);
	}
	return state;
}

function sceneOpening(staging: ChapterSequenceClipStaging, firstSceneId: string, sceneId: string): readonly StagingPosition[] {
	return sceneId === firstSceneId ? staging.opening : staging.scenes.find((scene) => scene.sceneId === sceneId)!.positions;
}

/** Each shot explicitly identifies its ordered story facts; the model owns their timing. */
export function clipSegmentStaging(clipSequence: unknown, segments: readonly Readonly<{ storyEventIds: readonly string[] }>[]): readonly ClipSegmentStaging[] | null {
	const staging = readClipStaging(clipSequence);
	if (!staging || !record(clipSequence)) return null;
	const scenes = new Map(staging.scenes.map((scene) => [scene.sceneId, { ...scene, marks: stagingMarks(scene.layout) }]));
	const events = clipStagingEvents(clipSequence);
	const firstSceneId = events.find((event) => event.sceneId !== null && scenes.has(event.sceneId))?.sceneId ?? staging.scenes[0]!.sceneId;
	let previousSceneId: string | null = null;
	return segments.map((segment, index) => {
		const selected = segment.storyEventIds.map((id) => events.find((event) => event.eventId === id)).filter((event): event is ClipStagingEvent => event !== undefined);
		const first = selected[0];
		const sceneId = first?.sceneId;
		if (!sceneId || !scenes.has(sceneId)) { previousSceneId = sceneId ?? null; return { positions: null, moves: [] }; }
		const marks = scenes.get(sceneId)!.marks;
		const opening = sceneOpening(staging, firstSceneId, sceneId);
		const state = new Map(confirmedPositionsBefore(opening, events.filter((event) => event.sceneId === sceneId), first.eventIndex));
		const positions = index === 0 || sceneId !== previousSceneId ? [...state.values()].map((position) => describeStagingPosition(position, marks)) : null;
		const moves = selected.flatMap((event) => event.moves.map((move) => {
			const eventMarks = event.sceneId ? scenes.get(event.sceneId)?.marks : undefined;
			const description = describeStagingMove(state.get(move.who), move, eventMarks ?? marks);
			state.set(move.who, move);
			return description;
		}).filter((value): value is string => value !== null));
		previousSceneId = sceneId;
		return { positions, moves };
	});
}

// ---------------------------------------------------------------- packet blocking plan

export type ClipStagingCharacter = ClipProductionStagingPlan["stages"][number]["characters"][number];
export type ClipStagingStage = ClipProductionStagingPlan["stages"][number];
/** Host-derived packet blockingPlan: the frozen floor plan and who goes where in this Clip. */
export type ClipStagingPlan = ClipProductionStagingPlan;

/** One stage per scene the Clip plays: opening positions, entrances, final positions and exits. */
export function clipStagingPlan(clipSequence: unknown): ClipStagingPlan | null {
	const staging = readClipStaging(clipSequence);
	if (!staging || !record(clipSequence)) return null;
	const events = clipStagingEvents(clipSequence);
	const stagedIds = new Set(staging.scenes.map((scene) => scene.sceneId));
	const eventScenes = [...new Set(events.map((event) => event.sceneId).filter((id): id is string => id !== null && stagedIds.has(id)))];
	const sceneOrder = eventScenes.length > 0 ? eventScenes : [staging.scenes[0]!.sceneId];
	const diagnostics: { sceneId: string; reason: "missing_floor_plan" | "unknown_mark"; mark?: string; who?: string }[] = [];
	const stages = sceneOrder.flatMap((sceneId, sceneIndex): ClipStagingStage[] => {
		const scene = staging.scenes.find((candidate) => candidate.sceneId === sceneId);
		if (!scene?.layout || !Array.isArray(scene.layout.landmarks) || !Array.isArray(scene.layout.marks)) {
			diagnostics.push({ sceneId, reason: "missing_floor_plan" });
			return [];
		}
		const marks = stagingMarks(scene.layout);
		const opening = sceneIndex === 0 ? staging.opening : scene.positions;
		const sceneEvents = events.filter((event) => event.sceneId === sceneId);
		const drawable = (position: StagingPosition): boolean => {
			if (marks.has(position.mark)) return true;
			diagnostics.push({ sceneId, reason: "unknown_mark", who: position.who, mark: position.mark });
			return false;
		};
		const unresolved = new Set<string>();
		const start = new Map(opening.filter(drawable).map((position) => [position.who, position]));
		const origins = new Map(start);
		const first = new Map<string, StagingPosition>();
		let state = new Map(start);
		const exited = new Set<string>();
		const transitions: NonNullable<ClipProductionStagingPlan["stages"][number]["transitions"]>[number][] = [];
		const point = (mark: string): StagingPoint => marks.get(mark)!.at;
		for (const event of sceneEvents) {
			for (const move of event.moves) {
				if (!drawable(move)) {
					state.delete(move.who);
					unresolved.add(move.who);
					continue;
				}
				const declaredFrom = state.get(move.who) ?? null;
				const from = declaredFrom && drawable(declaredFrom) ? declaredFrom : null;
				if (!origins.has(move.who) && !first.has(move.who)) first.set(move.who, move);
				transitions.push({ eventId: event.eventId, name: move.who,
					from: from ? { mark: from.mark, posture: from.posture, at: point(from.mark) } : null,
					to: { mark: move.mark, posture: move.posture, at: point(move.mark) },
					eventIndex: event.eventIndex });
			}
			if (event.staging) {
				const after = new Map(event.staging.filter((position) => {
					if (drawable(position)) return true;
					unresolved.add(position.who);
					return false;
				}).map((position) => [position.who, position]));
				const beforeExit = new Set(state.keys());
				for (const who of beforeExit) if (!after.has(who) && !unresolved.has(who)) exited.add(who);
				state = after;
			}
		}
		const names = [...new Set([...origins.keys(), ...first.keys()])];
		const characters = names.map((name): ClipStagingCharacter => {
			const opened = origins.get(name) ?? first.get(name)!;
			const final = state.get(name);
			const moved = final !== undefined && (final.mark !== opened.mark || final.posture !== opened.posture);
			return {
				name, mark: opened.mark, posture: opened.posture, at: point(opened.mark),
				endMark: moved ? final!.mark : null,
				endPosture: moved ? final!.posture : null,
				moveTo: moved && final!.mark !== opened.mark ? point(final!.mark) : null,
				enters: !origins.has(name),
				exits: exited.has(name),
				...(unresolved.has(name) ? { positionStatus: "origin_only" as const } : {}),
				...(!origins.has(name) ? { positionStatus: "target_only" as const } : {}),
			};
		});
		return [{ sceneId, setting: scene.setting, landmarks: scene.layout.landmarks, marks: scene.layout.marks, characters,
			...(transitions.length ? { transitions } : {}) }];
	});
	if (diagnostics.length > 0) console.warn(JSON.stringify({
		event: "chapter_staging_projection_diagnostic",
		clipId: typeof clipSequence.clipId === "string" ? clipSequence.clipId : null,
		diagnostics,
	}));
	return stages.length > 0 ? { protocol: CLIP_STAGING_PROTOCOL, stages } : null;
}

// ---------------------------------------------------------------- diagrams

const CHARACTER_COLORS = ["#1f6feb", "#c0392b", "#14804a", "#9a6700", "#8250df", "#bf3989", "#0a7ea4", "#57606a"];

/** A diagram point states its evidence role; an origin or target is not an inferred current position. */
export function stagingCharacterDiagramFacts(
	character: ClipStagingCharacter,
	_transitions: NonNullable<ClipProductionStagingPlan["stages"][number]["transitions"]> = [],
): Readonly<{ name: string; at: [number, number]; moveTo?: [number, number] }> {
	const position = character.positionStatus === "origin_only" ? "已知起点·持续走位·当前位置未确认"
		: character.positionStatus === "target_only" ? "目标位置·当前位置未确认" : STAGING_POSTURE_LABEL[character.posture];
	const tags = [position, character.enters ? "入场" : "", character.exits ? "离场" : ""].filter(Boolean).join("·");
	return { name: `${character.name}（${tags}）`, at: [character.at[0], character.at[1]],
		...(character.moveTo ? { moveTo: [character.moveTo[0], character.moveTo[1]] as [number, number] } : {}) };
}

/** Doors and windows sit on the nearest edge of the plan; the border is the room's outline. */
function edgeOrientation(at: StagingPoint): "h" | "v" {
	return Math.min(at[1], 1 - at[1]) <= Math.min(at[0], 1 - at[0]) ? "h" : "v";
}

function diagramLandmarks(landmarks: StagingLayout["landmarks"]): JsonRecord[] {
	return landmarks.map((landmark) => {
		if (landmark.kind === "door") {
			return { kind: "door", at: [...landmark.at], orient: edgeOrientation(landmark.at), lengthN: 0.12, swing: "in", label: landmark.label };
		}
		if (landmark.kind === "window") {
			const half = 0.07;
			const [x, y] = landmark.at;
			const clamp = (value: number) => Math.min(1, Math.max(0, value));
			const [from, to] = edgeOrientation(landmark.at) === "h"
				? [[clamp(x - half), y], [clamp(x + half), y]] : [[x, clamp(y - half)], [x, clamp(y + half)]];
			return { kind: "wall", from, to, label: landmark.label };
		}
		return { kind: "area", at: [...landmark.at], label: landmark.label };
	});
}

/** People sharing one mark are spread sideways so every marker and label stays readable. */
function spreadShared(points: readonly StagingPoint[]): StagingPoint[] {
	const groups = new Map<string, number[]>();
	points.forEach((point, index) => {
		const key = point.join(",");
		groups.set(key, [...(groups.get(key) ?? []), index]);
	});
	const spread = points.map((point) => [...point] as [number, number]);
	for (const indexes of groups.values()) {
		if (indexes.length < 2) continue;
		indexes.forEach((pointIndex, order) => {
			const offset = (order - (indexes.length - 1) / 2) * 0.07;
			spread[pointIndex]![0] = Math.min(0.98, Math.max(0.02, spread[pointIndex]![0] + offset));
		});
	}
	return spread;
}

/** Renderer arguments for one scene's 拓扑图: landmarks and named marks, nobody on stage. */
export function topologyDiagramArgs(stage: Pick<ClipStagingStage, "setting" | "landmarks" | "marks">, title: string): JsonRecord {
	return {
		title,
		width: 1280,
		height: 720,
		landmarks: [
			...diagramLandmarks(stage.landmarks),
			...stage.marks.map((mark) => ({ kind: "area", at: [...mark.at], label: `◎${mark.mark}` })),
		],
		characters: [],
	};
}

/** Renderer arguments for one Clip's 站位图: opening positions, entrances, moves and exits. */
export function stagingDiagramArgs(stage: ClipStagingStage, title: string): JsonRecord {
	const points = spreadShared(stage.characters.map((character) => character.at));
	return {
		title,
		width: 1280,
		height: 720,
		landmarks: diagramLandmarks(stage.landmarks),
		characters: stage.characters.map((character, index) => {
			const facts = stagingCharacterDiagramFacts(character, stage.transitions);
			return {
				...facts,
				at: points[index],
				color: CHARACTER_COLORS[index % CHARACTER_COLORS.length],
			};
		}),
	};
}
