/**
 * Whole-source retention for chapter adaptation. The film keeps every sentence of
 * the source: each quoted line is spoken verbatim, and each narration sentence is
 * played — acted in the picture, said by the character whose thought or knowledge
 * it is, or, failing both, read by the narrator. Cutting and condensing left clips
 * the audience could not follow; reading every sentence aloud made a narrated
 * comic instead of an animation. The author references each unit by id; text the
 * author spelled out also counts when the spoken stream contains it verbatim.
 */

/** cue: a short action in the same sentence as a quote ("顾观棋拱手见礼，道：“……”"), acted while the line is spoken. */
export type RetentionUnit = Readonly<{ kind: "dialogue" | "narration"; text: string; cue?: true }>;

const SENTENCE_END = /(?<=[。！？!?；;…])/u;
/** A short clause naming who speaks ("林嫣儿说。"): the line beat already shows it. */
const SPEAKER_TAG = /(说|道|问|喊|答|叫|嚷|笑)/u;
const SPEAKER_TAG_MAX_VOICED = 10;
/** A cue this short is a stage direction for the line: writing it verbatim into that line's picture keeps it. */
export const CUE_MAX_VOICED = 16;

export const voicedText = (text: string): string => text.replace(/[\p{P}\p{S}\p{Z}\s]/gu, "");

/** A quoted sound (“砰砰砰”, “咚咚”) is heard as a sound, not spoken as a line; the narration around it still is. */
function isSoundWord(text: string): boolean {
	const voiced = voicedText(text);
	return voiced.length <= 4 && new Set(voiced).size <= 2 && voiced.length > new Set(voiced).size;
}

type Segment = Readonly<{ quoted: boolean; text: string }>;

/**
 * Split a paragraph into quoted and narrated runs. A quote may open in one
 * paragraph and close in a later one, and a second “ inside an open quote is a
 * typo for ” (“抱元守一“), so quote state is carried in and returned.
 */
function segmentParagraph(paragraph: string, openAtStart: boolean): Readonly<{ segments: Segment[]; openAtEnd: boolean }> {
	const segments: Segment[] = [];
	let quoted = openAtStart;
	let bracket = false;
	let run = "";
	const flush = () => { if (run) segments.push({ quoted: quoted || bracket, text: run }); run = ""; };
	for (const char of paragraph) {
		if (char === "【" && !quoted && !bracket) { flush(); bracket = true; continue; }
		if (char === "】" && bracket) { flush(); bracket = false; continue; }
		if (char === "“") { flush(); quoted = !quoted; continue; }
		if (char === "”" && quoted) { flush(); quoted = false; continue; }
		run += char;
	}
	flush();
	return { segments: mergeQuotedTerms(segments), openAtEnd: quoted };
}

/** A quoted name inside a sentence is not speech: “抱元守一” in 以“抱元守一”为心法. */
const TERM_MAX_VOICED = 8;

/**
 * Quotes also mark names and terms. Ch1 split 以“抱元守一”为心法 into a line of
 * dialogue the system voice then spoke aloud. A short quote that a sentence runs
 * straight into and out of, letters on both sides, stays part of that narration.
 */
function mergeQuotedTerms(segments: readonly Segment[]): Segment[] {
	const merged: Segment[] = [];
	for (let index = 0; index < segments.length; index += 1) {
		const segment = segments[index]!;
		const before = merged.at(-1);
		const after = segments[index + 1];
		if (segment.quoted && before && !before.quoted && after && !after.quoted
			&& voicedText(segment.text).length <= TERM_MAX_VOICED && /\p{L}$/u.test(before.text) && /^\p{L}/u.test(after.text)) {
			merged[merged.length - 1] = { quoted: false, text: `${before.text}“${segment.text}”${after.text}` };
			index += 1;
			continue;
		}
		merged.push(segment);
	}
	return merged;
}

function narrationUnits(segment: string, beforeQuote: boolean, afterQuote: boolean): RetentionUnit[] {
	const units: RetentionUnit[] = [];
	const sentences = segment.split(SENTENCE_END).filter((sentence) => voicedText(sentence).length > 0);
	sentences.forEach((sentence, index) => {
		let kept = sentence;
		// "……但她还是硬着头皮，抱拳道：" keeps everything but the clause that introduces the quote.
		if (beforeQuote && index === sentences.length - 1 && /[：:，,]\s*$/u.test(sentence)) {
			kept = sentence.split(/(?<=[，,])/u).slice(0, -1).join("");
		}
		if (afterQuote && index === 0) {
			const clauses = kept.split(/(?<=[，,])/u);
			const first = clauses[0] ?? "";
			if (SPEAKER_TAG.test(first) && voicedText(first).length <= SPEAKER_TAG_MAX_VOICED) kept = clauses.slice(1).join("");
		}
		const voiced = voicedText(kept).length;
		const touchesQuote = (beforeQuote && index === sentences.length - 1) || (afterQuote && index === 0);
		if (voiced >= 2) units.push({ kind: "narration", text: kept.trim(), ...(touchesQuote && voiced <= CUE_MAX_VOICED ? { cue: true as const } : {}) });
	});
	return units;
}

/** The dialogue and narration a source text must keep, dropping only speaker tags beside quotes. */
export function retentionUnits(text: string): RetentionUnit[] {
	const units: RetentionUnit[] = [];
	let open = false;
	for (const paragraph of text.split(/\r?\n/u)) {
		const { segments, openAtEnd } = segmentParagraph(paragraph, open);
		segments.forEach((segment, index) => {
			if (segment.quoted) {
				if (voicedText(segment.text).length >= 2 && !isSoundWord(segment.text)) units.push({ kind: "dialogue", text: segment.text.trim() });
				return;
			}
			units.push(...narrationUnits(segment.text, segments[index + 1]?.quoted === true, segments[index - 1]?.quoted === true));
		});
		open = openAtEnd;
	}
	return units;
}

/**
 * Units the beats do not keep, in source order. Narration counts only when spoken:
 * a viewer never reads the picture description. A cue may instead be acted in the
 * picture of a line (its visual), because it happens while that line is spoken.
 */
export function missingRetentionUnits(
	spans: readonly Readonly<{ spanId: string; text: string }>[],
	spokenTexts: readonly string[],
	lineVisuals: readonly string[] = [],
): readonly (RetentionUnit & Readonly<{ spanId: string }>)[] {
	const stream = voicedText(spokenTexts.join(""));
	const shown = lineVisuals.map(voicedText);
	const kept = (unit: RetentionUnit) => stream.includes(voicedText(unit.text))
		|| (unit.cue === true && shown.some((visual) => visual.includes(voicedText(unit.text))));
	return spans.flatMap((span) => retentionUnits(span.text)
		.filter((unit) => !kept(unit))
		.map((unit) => ({ ...unit, spanId: span.spanId })));
}

/** A retention unit with the stable id the author references instead of copying the text. */
export type CatalogUnit = RetentionUnit & Readonly<{ id: string }>;

/** Number every unit across the frozen sources in order: U1, U2, … */
export function retentionCatalog(sources: readonly Readonly<{ content: string }>[]): readonly CatalogUnit[] {
	return sources.flatMap((source) => retentionUnits(source.content)).map((unit, index) => ({ ...unit, id: `U${index + 1}` }));
}

/** The catalog as the author reads it: one numbered sentence per line. */
/**
 * The host counts characters and seconds; a model does not count Chinese reliably.
 * With rates, each unit states its voiced length and the minimum time the host will
 * check — said aloud for dialogue, acted in one beat for narration — in the exact
 * measure the host applies, so the author copies a number instead of estimating it.
 */
export function renderRetentionCatalog(
	catalog: readonly CatalogUnit[],
	rates?: Readonly<{ spokenCharsPerSecond: number; shownCharsPerSecond: number }>,
): string {
	const atLeast = (chars: number, perSecond: number) => Math.ceil((chars / perSecond) * 10) / 10;
	return catalog.map((unit) => {
		const kind = unit.kind === "dialogue" ? "对白" : "叙述";
		if (!rates) return `${unit.id}｜${kind}｜${unit.text}`;
		const chars = voicedText(unit.text).length;
		const floor = unit.kind === "dialogue"
			? `说完至少 ${atLeast(chars, rates.spokenCharsPerSecond)}s`
			: `一拍演完至少 ${atLeast(chars, rates.shownCharsPerSecond)}s`;
		return `${unit.id}｜${kind}｜${chars}字，${floor}｜${unit.text}`;
	}).join("\n");
}

/**
 * Catalog units the script does not keep. A unit is kept when a line references
 * it (unit), a beat acts it (shows) or a line says it in a character's words
 * (conveys); text the author spelled out is
 * also accepted when it contains the unit verbatim in the spoken stream, or a cue
 * verbatim in a line's picture.
 */
export function missingCatalogUnits(
	catalog: readonly CatalogUnit[],
	referenced: ReadonlySet<string>,
	spokenTexts: readonly string[],
	lineVisuals: readonly string[],
): readonly CatalogUnit[] {
	const stream = voicedText(spokenTexts.join(""));
	const shown = lineVisuals.map(voicedText);
	return catalog.filter((unit) => !referenced.has(unit.id)
		&& !stream.includes(voicedText(unit.text))
		&& !(unit.cue === true && shown.some((visual) => visual.includes(voicedText(unit.text)))));
}
