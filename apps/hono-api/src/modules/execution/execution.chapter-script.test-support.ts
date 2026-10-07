import { compileChapterScript as compileAuthoredScript } from "./execution.chapter-script";
import { retentionCatalog } from "./execution.chapter-retention";
import { frozenChapterSources } from "./execution.chapter-sequence.contract";

/**
 * Fixtures written before beats carried a performance mode: lines are dialogue,
 * other beats atmosphere. Tests about performance routing set the field themselves.
 * Fixtures written before scenes named their place each stand in a place of their
 * own, so every scene still states its own floor plan; continuity tests set place.
 */
export function withPerformance<T>(input: T): T {
	if (typeof input !== "object" || input === null || !Array.isArray((input as { scenes?: unknown }).scenes)) return input;
	const script = input as unknown as { scenes: { beats?: unknown }[] };
	return {
		...script,
		scenes: script.scenes.map((scene) => !Array.isArray(scene?.beats) ? scene : {
			...scene,
			place: (scene as { place?: unknown; sceneId?: unknown }).place ?? `place-${String((scene as { sceneId?: unknown }).sceneId)}`,
			beats: (scene.beats as Record<string, unknown>[]).map((beat) => beat && typeof beat === "object" && beat.performance === undefined
				? { ...beat, performance: beat.kind === "line" ? "dialogue" : "atmosphere" } : beat),
		}),
	} as unknown as T;
}

/**
 * Fixtures are written in the internal line/action beat shape; the author writes a
 * picture and, when someone is heard, a speech. Translate so every test drives the
 * real author-facing intake.
 */
export function toAuthoredScript<T>(input: T, deliveryContract?: unknown): unknown {
	// A quoted source line is now always said by its number; find it in the delivery's catalog.
	const catalog = deliveryContract === undefined ? [] : retentionCatalog(frozenChapterSources(deliveryContract));
	const unitOf = (text: unknown) => typeof text === "string"
		? catalog.find((unit) => unit.text.replace(/[\s“”"「」]/gu, "") === text.replace(/[\s“”"「」]/gu, ""))?.id
		: undefined;
	if (typeof input !== "object" || input === null || !Array.isArray((input as { scenes?: unknown }).scenes)) return input;
	const { protocolVersion: _protocolVersion, ...script } = input as unknown as Record<string, unknown> & { scenes: Record<string, unknown>[] };
	// Everyone the fixture names anywhere: the roster, each scene's cast and each entrance.
	const names = [...new Set([
		...(Array.isArray(script.characters) ? script.characters as unknown[] : []),
		...(script.scenes as Record<string, unknown>[]).flatMap((scene) => [
			...(Array.isArray(scene?.cast) ? scene.cast as unknown[] : []),
			...(Array.isArray(scene?.beats) ? (scene.beats as Record<string, unknown>[]).flatMap((beat) => Array.isArray(beat?.enters) ? beat.enters as unknown[] : []) : []),
		]),
	].filter((name): name is string => typeof name === "string" && name.trim().length > 0))];
	return {
		...script,
		scenes: (script.scenes as Record<string, unknown>[]).map((scene) => !Array.isArray(scene?.beats) ? scene : {
			...scene,
			beats: (scene.beats as Record<string, unknown>[]).map((beat) => {
				if (!beat || typeof beat !== "object" || "picture" in beat) return beat;
				const { kind, text, visual, speaker, voice, delivery, textOrigin, unit, speechDurationSeconds: _speechDurationSeconds, durationSeconds: _durationSeconds, conveys, ...rest } = beat;
				// Fixtures name who the picture shows in its text; the author declares them as visible.
				const shown = (picture: unknown) => typeof picture === "string" ? names.filter((name) => picture.includes(name)) : [];
				const declared = "visible" in rest ? {} : { visible: shown(kind === "line" ? visual : text) };
				if (kind !== "line") return { ...rest, ...declared, picture: text };
				return {
					...rest,
					...declared,
					picture: visual,
					speech: {
						speaker, voice, delivery,
						says: unit ?? (textOrigin === "source_quote" ? unitOf(text) ?? text : text),
						...(conveys === undefined ? {} : { conveys }),
					},
				};
			}),
		}),
	};
}

export function compileChapterScript(input: unknown, deliveryContract: unknown): ReturnType<typeof compileAuthoredScript> {
	return compileAuthoredScript(toAuthoredScript(withPerformance(input), deliveryContract), deliveryContract);
}
