/** Frozen source quote addresses and author-declared speech provenance.
 * Quote delimiters describe typography only; they never classify a span as speech.
 */
import { sha256Hex } from "../asset/book-content-hash";
import { DIALOGUE_PACE_CEILING } from "../task/video-orchestrator.dialogue-capacity";

/** Planning observation for author-declared speech, never a provider hard limit. */
export const BEAT_SHEET_SPEECH_MAX_CHARS_PER_SECOND = DIALOGUE_PACE_CEILING;

const QUOTE_DELIMITER_PAIRS: ReadonlyArray<readonly [string, string]> = [
	["\u201C", "\u201D"], // “ ”
	["\u300C", "\u300D"], // 「 」
	["\u300E", "\u300F"], // 『 』
];

const OPEN_DELIMITERS = new Set(QUOTE_DELIMITER_PAIRS.map(([open]) => open));
const CLOSE_DELIMITER_BY_OPEN = new Map(QUOTE_DELIMITER_PAIRS);

export type BeatSheetSourceQuotedUnit = Readonly<{
	unitId: string;
	sourceId: string;
	/** Index in the original frozen authoritativeSources array, before filtering. */
	sourceIndex: number;
	/** Exact UTF-16 half-open range in the unmodified frozen source. */
	startOffset: number;
	endOffset: number;
	verbatim: string;
	chars: number;
}>;

export type BeatSheetSourceProfile = Readonly<{
	protocolVersion: "tapcanvas.beat-sheet-source-profile/v2";
	sourceIds: readonly string[];
	sourceChars: number;
	sourceQuotedChars: number;
	sourceQuotedUnits: readonly BeatSheetSourceQuotedUnit[];
	sourceSetFingerprint: string;
}>;

type CanonicalSource = Readonly<{ sourceId: string; content: string; sourceIndex: number }>;

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readText(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

/** Canonical 原文集合：与 delivery contract 冻结的 authoritativeSources 同一份事实。 */
function readCanonicalSources(deliveryContract: unknown): CanonicalSource[] {
	if (!isRecord(deliveryContract)) return [];
	const canvasFacts = isRecord(deliveryContract.canvasFacts) ? deliveryContract.canvasFacts : null;
	const rawSources = canvasFacts && Array.isArray(canvasFacts.authoritativeSources)
		? canvasFacts.authoritativeSources
		: [];
	const sources: CanonicalSource[] = [];
	for (const [index, raw] of rawSources.entries()) {
		if (!isRecord(raw)) continue;
		const content = typeof raw.content === "string" ? raw.content : "";
		if (!content.trim()) continue;
		const sourceId = readText(raw.sourceId) || readText(raw.nodeId) || `source-${index}`;
		sources.push({ sourceId, content, sourceIndex: index });
	}
	return sources;
}

type MatchSpace = Readonly<{
	/** 去掉空白与引号界定符后的正文，用于逐字比对（保留原始坐标映射）。 */
	text: string;
	/** matchIndexByOriginal[i] = 原文下标 i 在 text 中的位置，被跳过的字符为 -1。 */
	matchIndexByOriginal: Int32Array;
}>;

function buildMatchSpace(content: string): MatchSpace {
	const matchIndexByOriginal = new Int32Array(content.length).fill(-1);
	let text = "";
	for (let index = 0; index < content.length; index += 1) {
		const char = content[index];
		if (char.trim().length === 0) continue;
		if (OPEN_DELIMITERS.has(char)) continue;
		if (QUOTE_DELIMITER_PAIRS.some(([, close]) => close === char)) continue;
		matchIndexByOriginal[index] = text.length;
		text += char;
	}
	return { text, matchIndexByOriginal };
}

type QuotedSpan = Readonly<{ sourceIndex: number; sourceId: string; verbatim: string; start: number; end: number }>;

/** 提取原文中被引号界定的片段；包含对白、消息、拟声等，不判断其声音类型。 */
function extractQuotedSpans(sources: readonly CanonicalSource[]): QuotedSpan[] {
	const spans: QuotedSpan[] = [];
	for (const [sourceIndex, source] of sources.entries()) {
		const content = source.content;
		let cursor = 0;
		while (cursor < content.length) {
			const open = content[cursor];
			const close = CLOSE_DELIMITER_BY_OPEN.get(open);
			if (!close) {
				cursor += 1;
				continue;
			}
			const closeIndex = content.indexOf(close, cursor + 1);
			if (closeIndex < 0) break;
			const verbatim = content.slice(cursor + 1, closeIndex);
			if (verbatim.trim()) {
				spans.push({ sourceIndex, sourceId: source.sourceId, verbatim, start: cursor + 1, end: closeIndex });
			}
			cursor = closeIndex + 1;
		}
	}
	return spans;
}

function toMatchRange(matchSpace: MatchSpace, start: number, end: number): Readonly<{ start: number; end: number }> | null {
	let matchStart = -1;
	let matchEnd = -1;
	for (let index = start; index < end; index += 1) {
		const mapped = matchSpace.matchIndexByOriginal[index];
		if (mapped < 0) continue;
		if (matchStart < 0) matchStart = mapped;
		matchEnd = mapped + 1;
	}
	return matchStart < 0 ? null : { start: matchStart, end: matchEnd };
}

function truncate(value: string, limit = 40): string {
	return value.length <= limit ? value : `${value.slice(0, limit)}…`;
}

/** Extract exact quoted source addresses without speech or duration classification. */
export function deriveBeatSheetSourceProfile(deliveryContract: unknown): BeatSheetSourceProfile | null {
	const sources = readCanonicalSources(deliveryContract);
	if (sources.length === 0) return null;
	const matchSpaces = sources.map((source) => buildMatchSpace(source.content));
	const spans = extractQuotedSpans(sources);
	const units: BeatSheetSourceQuotedUnit[] = [];
	let sourceQuotedChars = 0;
	for (const [index, span] of spans.entries()) {
		const matchSpace = matchSpaces[span.sourceIndex];
		const range = toMatchRange(matchSpace, span.start, span.end);
		if (!range) continue;
		const chars = range.end - range.start;
		if (chars <= 0) continue;
		sourceQuotedChars += chars;
		units.push({
			unitId: `source-quote-${String(index + 1).padStart(3, "0")}`,
			sourceId: span.sourceId,
			sourceIndex: sources[span.sourceIndex]!.sourceIndex,
			startOffset: span.start,
			endOffset: span.end,
			verbatim: span.verbatim,
			chars,
		});
	}
	const sourceChars = matchSpaces.reduce((total, space) => total + space.text.length, 0);
	return {
		protocolVersion: "tapcanvas.beat-sheet-source-profile/v2",
		sourceIds: sources.map((source) => source.sourceId),
		sourceChars,
		sourceQuotedChars,
		sourceQuotedUnits: units,
		sourceSetFingerprint: sha256Hex(sources.map((source) => `${source.sourceId}\u0000${source.content}`).join("\u0001")),
	};
}

function readLedgerLines(beatSheet: Record<string, unknown>): Array<{ text: string }> {
	const coveragePlan = isRecord(beatSheet.sourceCoveragePlan) ? beatSheet.sourceCoveragePlan : null;
	const ledger = coveragePlan && Array.isArray(coveragePlan.speechLedger) ? coveragePlan.speechLedger : [];
	const lines: Array<{ text: string }> = [];
	for (const raw of ledger) {
		if (!isRecord(raw)) continue;
		const text = typeof raw.text === "string" ? raw.text : "";
		if (text.trim()) lines.push({ text });
	}
	return lines;
}

function plannedDurationSeconds(beatSheet: Record<string, unknown>): number {
	const beats = Array.isArray(beatSheet.beats) ? beatSheet.beats : [];
	let total = 0;
	for (const raw of beats) {
		if (!isRecord(raw)) continue;
		const duration = raw.durationSeconds;
		if (typeof duration === "number" && Number.isFinite(duration) && duration > 0) total += duration;
	}
	return total;
}

/**
 * 对照 canonical 原文校验 BeatSheet 人声台账。返回 null 表示通过；
 * 否则返回确定的、可执行的拒绝原因（由运行时回灌同一逻辑任务修订）。
 */
export function validateBeatSheetSourceCoverage(input: Readonly<{
	beatSheetText: string;
	deliveryContract: unknown;
}>): string | null {
	const sources = readCanonicalSources(input.deliveryContract);
	if (sources.length === 0) return null;
	let beatSheet: unknown;
	try {
		beatSheet = JSON.parse(input.beatSheetText);
	} catch {
		// 结构解析失败已由上游合同校验负责，这里不重复报错。
		return null;
	}
	if (!isRecord(beatSheet)) return null;
	const lines = readLedgerLines(beatSheet);
	if (lines.length === 0) return null;

	const matchSpaces = sources.map((source) => buildMatchSpace(source.content));
	const concatenated = matchSpaces.map((space) => space.text).join("\n");
	// Validate provenance of speech chosen by the author, not every quoted span.
	let cursor = 0;
	for (const [index, line] of lines.entries()) {
		const normalized = buildMatchSpace(line.text).text;
		if (!normalized) continue;
		const found = concatenated.indexOf(normalized, cursor);
		if (found < 0) {
			return `sourceCoveragePlan.speechLedger[${index}] must preserve verbatim canonical source speech; "${truncate(line.text)}" does not appear verbatim in the authoritative source (rewritten or invented source dialogue belongs in narrativeAudioPlan, not in the source speech ledger)`;
		}
		cursor = found + normalized.length;
	}

	return null;
}

/** Speech-rate estimates describe pacing concerns; they do not reject executable artifacts. */
export function diagnoseBeatSheetSpeechCapacity(input: Readonly<{
  beatSheetText: string;
  deliveryContract: unknown;
}>): string | null {
  let beatSheet: unknown;
  try { beatSheet = JSON.parse(input.beatSheetText); } catch { return null; }
  if (!isRecord(beatSheet)) return null;
  const lines = readLedgerLines(beatSheet);
  if (lines.length === 0) return null;
	const declaredSpeechChars = lines.reduce((total, line) => total + buildMatchSpace(line.text).text.length, 0);
	const requiredSeconds = Math.ceil(
		declaredSpeechChars / BEAT_SHEET_SPEECH_MAX_CHARS_PER_SECOND,
	);
	const plannedSeconds = plannedDurationSeconds(beatSheet);
	if (plannedSeconds + 1e-6 < requiredSeconds) {
		return `BeatSheet plans ${plannedSeconds}s but the author-declared speech ledger carries ${declaredSpeechChars} chars of speech, estimated speech duration is ${requiredSeconds}s at the diagnostic rate ${BEAT_SHEET_SPEECH_MAX_CHARS_PER_SECOND} chars/second. This estimate is non-blocking and is not a provider limit; the author should review dialogue allocation`;
	}
	return null;
}
