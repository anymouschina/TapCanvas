import type { ChapterSequenceFrozenSource } from "./execution.chapter-sequence.contract";

/**
 * Speech source ranges are host-owned. Counting UTF-16 offsets by hand was the
 * chapter author's costliest revision loop (every quote mis-located, then
 * re-derived across several long turns), while the host can find a verbatim
 * quote exactly. The author writes the line; the host binds where it came from.
 */

export type ChapterSequenceQuoteRange = Readonly<{
	sourceIndex: number;
	startOffset: number;
	endOffset: number;
	sourceId: string;
	sourceFingerprint: string;
}>;

type QuoteCursor = Readonly<{ sourceIndex: number; offset: number }>;
type IndexedSource = ChapterSequenceFrozenSource & Readonly<{ sourceIndex: number }>;

/**
 * A quote may skip a short narration interjection inside one paragraph ("“A，”他说，“B。”") but never
 * becomes a character collage. A paragraph break ends a turn: joining across it merged whole monologues
 * into one speech event too long to voice in its slot, so each paragraph is its own speech event.
 */
const MAX_FRAGMENTS = 4;
const MAX_NARRATION_GAP = 80;
const MIN_FRAGMENT_LENGTH = 2;
const MAX_START_CANDIDATES = 16;
const PREVIEW_CHARS = 60;

/** What the locator accepts, in contract wording built from the limits it enforces, so authors and reviewers judge quotes the way the host binds them. */
export const SOURCE_QUOTE_JOIN_RULE = `宿主定位 source_quote 时，允许 text 跨过同一段落内夹在台词中间的引号和不超过 ${MAX_NARRATION_GAP} 字的叙述（如“他说”），按原顺序分段匹配，最多 ${MAX_FRAGMENTS} 段；每段须与原文逐字一致，接缝处不增删标点，被跨过的引号和叙述不写进 text。text 不跨越原文的换行分段：不同段落的台词写成不同的发声事件。`;

function record(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function occurrencesOf(content: string, needle: string): number[] {
	const found: number[] = [];
	for (let index = content.indexOf(needle); index >= 0; index = content.indexOf(needle, index + 1)) found.push(index);
	return found;
}

function quoteRange(source: IndexedSource, startOffset: number, endOffset: number): ChapterSequenceQuoteRange {
	return { sourceIndex: source.sourceIndex, startOffset, endOffset, sourceId: source.sourceId, sourceFingerprint: source.sourceFingerprint };
}

/** Prefer the first occurrence at or after the previous quote, so ordered dialogue maps to ordered source. */
function orderedCandidates<T extends Readonly<{ source: IndexedSource; start: number }>>(candidates: readonly T[], cursor: QuoteCursor): T[] {
	const after = candidates.filter(({ source, start }) => source.sourceIndex > cursor.sourceIndex
		|| (source.sourceIndex === cursor.sourceIndex && start >= cursor.offset));
	return [...after, ...candidates.filter((candidate) => !after.includes(candidate))];
}

function extendFragments(text: string, source: IndexedSource, start: number, firstLength: number): Array<[number, number]> | null {
	const fragments: Array<[number, number]> = [[start, start + firstLength]];
	let position = start + firstLength;
	let remaining = text.slice(firstLength);
	while (remaining.length > 0) {
		if (fragments.length >= MAX_FRAGMENTS) return null;
		let next: [number, number] | null = null;
		for (let length = remaining.length; length >= Math.min(MIN_FRAGMENT_LENGTH, remaining.length); length -= 1) {
			const found = source.content.indexOf(remaining.slice(0, length), position);
			if (found >= 0 && found - position <= MAX_NARRATION_GAP && !source.content.slice(position, found).includes("\n")) {
				next = [found, found + length];
				break;
			}
		}
		if (!next) return null;
		fragments.push(next);
		position = next[1];
		remaining = remaining.slice(next[1] - next[0]);
	}
	return fragments;
}

/** Locate verbatim quoted text in the frozen sources: UTF-16 offsets, ordered, non-overlapping. */
export function locateSourceQuote(
	text: string,
	sources: readonly ChapterSequenceFrozenSource[],
	cursor: QuoteCursor = { sourceIndex: 0, offset: 0 },
): Readonly<{ ranges: readonly ChapterSequenceQuoteRange[]; cursor: QuoteCursor }> | null {
	const indexed = sources.map((source, sourceIndex): IndexedSource => ({ ...source, sourceIndex }));
	const contiguous = orderedCandidates(
		indexed.flatMap((source) => occurrencesOf(source.content, text).map((start) => ({ source, start }))),
		cursor,
	);
	const exact = contiguous[0];
	if (exact) {
		const end = exact.start + text.length;
		return { ranges: [quoteRange(exact.source, exact.start, end)], cursor: { sourceIndex: exact.source.sourceIndex, offset: end } };
	}
	let prefixLength = text.length - 1;
	let starts: Array<{ source: IndexedSource; start: number }> = [];
	for (; prefixLength >= MIN_FRAGMENT_LENGTH; prefixLength -= 1) {
		const prefix = text.slice(0, prefixLength);
		starts = indexed.flatMap((source) => occurrencesOf(source.content, prefix).map((start) => ({ source, start })));
		if (starts.length > 0) break;
	}
	for (const { source, start } of orderedCandidates(starts, cursor).slice(0, MAX_START_CANDIDATES)) {
		const fragments = extendFragments(text, source, start, prefixLength);
		if (fragments) {
			return {
				ranges: fragments.map(([from, to]) => quoteRange(source, from, to)),
				cursor: { sourceIndex: source.sourceIndex, offset: fragments[fragments.length - 1]![1] },
			};
		}
	}
	return null;
}

/** Actionable reason when a source_quote line is not a verbatim passage of the frozen source. */
export function describeUnlocatedSourceQuote(text: string): string {
	const preview = text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS)}…` : text;
	return `source_quote text ${JSON.stringify(preview)} is not a verbatim passage of the frozen source. `
		+ "The host locates quoted lines itself: copy the source exactly (same characters and punctuation, without surrounding quotation marks), "
		+ "write each source paragraph as its own speech event (a quote never continues across a line break), split a line that skips long narration, "
		+ "or mark a rewritten line textOrigin=authored.";
}

/**
 * Bind every speech event's source ranges: verbatim quotes are located in
 * dialogue order, authored lines carry none. Throws an actionable error for a
 * quote that is not verbatim, so the author fixes the line instead of offsets.
 */
export function bindChapterSequenceQuoteRanges(sequence: unknown, sources: readonly ChapterSequenceFrozenSource[]): unknown {
	if (!record(sequence) || !Array.isArray(sequence.speechEvents)) return sequence;
	let cursor: QuoteCursor = { sourceIndex: 0, offset: 0 };
	const speechEvents = sequence.speechEvents.map((event, index) => {
		if (!record(event)) return event;
		if (event.textOrigin !== "source_quote") return { ...event, sourceRanges: [] };
		if (typeof event.text !== "string" || event.text.length === 0) {
			throw new Error(`chapter-sequence.speechEvents[${index}].text must be the non-empty quoted line`);
		}
		const located = locateSourceQuote(event.text, sources, cursor);
		if (!located) throw new Error(`chapter-sequence.speechEvents[${index}]: ${describeUnlocatedSourceQuote(event.text)}`);
		cursor = located.cursor;
		return { ...event, sourceRanges: located.ranges };
	});
	return { ...sequence, speechEvents };
}
