/**
 * BeatSheet 原文覆盖合同（通用，非个案）。
 *
 * 问题（根治目标）：章节一键成片的 BeatSheet 是「整章唯一事实源」，但宿主此前只校验
 * Agent 自己写的账本自洽（speechLedger ↔ dialogueScript 逐字互推），从不拿 canonical
 * 原文核对。于是同一章原文可以被改写成摘要式对白、并把整章压成极少数 clip，
 * 宿主照样判定合法交付 —— 画布上就出现「一个章节只有 4~5 个视频节点」。
 *
 * 本模块只做确定性、结构性事实校验，不做任何语义判断：
 *   1. 台账来源真实性：speechLedger 里登记的每一条「原文人声」必须逐字出现在 canonical 原文里。
 *      （不是「像原文」，而是原文本身；改写/杜撰的句子不属于 sourceCoveragePlan，
 *        应写进 narrativeAudioPlan 作为新增叙事人声 —— 这正是合同已有的两分法。）
 *   2. 原文人声覆盖：原文中被引号界定的每一段人声都必须被台账覆盖，不允许静默丢弃。
 *      仅在用户没有授权总时长（delivery contract 未冻结 targetDurationSeconds）时生效，
 *      因为那时合同的既定口径是「补 clip、不删台词」。
 *   3. 对白容量估算仅作为非阻塞诊断。语速常量不是供应商协议上限，不能否决作者稿件。
 *
 * 校验失败返回可执行的原因字符串，由运行时沿同一 agents-cli 逻辑任务回灌修订；
 * 本模块不产生用户级 blocked/failed。
 */

import { sha256Hex } from "../asset/book-content-hash";
import { DEFAULT_DIALOGUE_CHARS_PER_SEC, DIALOGUE_PACE_CEILING } from "../task/video-orchestrator.dialogue-capacity";

/** Shared speech-rate estimate for planning and diagnostics, never a provider hard limit. */
export const BEAT_SHEET_SPEECH_MAX_CHARS_PER_SECOND = DIALOGUE_PACE_CEILING;

/**
 * 规划语速（字符/秒）：把"冻结的交付时长"换算成"这个窗口能承载多少字人声"时采用的基准，
 * 直接复用仓库既有的自然念白速率（`DEFAULT_DIALOGUE_CHARS_PER_SEC`，"电视电影自然语速"）。
 *
 * 它只用于**有用户冻结总时长**的窗口：该窗口在自然语速下能承载的字数有限，作者应当据此
 * **选择**要覆盖的源内容，而不是把整章压进窗口（压缩正是"对白太密"的来源）。
 *
 * 反例（已回退）：把它当作整章计划时长的换算基准（522 秒 / 35 个 beat）会让 BeatSheet 产物
 * 增大约 45%，而本次执行的生产片段预算只有 24 个 clip —— 计划 35 个、只生产 24 个，
 * 多出的 11 个 beat 是纯浪费；产物增大后单次生成耗时也越过上游渠道的请求超时
 * （实测 channel #298 在 126 秒返回 504），物理窗口因此反复超时重开。
 */
export const BEAT_SHEET_SPEECH_PLANNING_CHARS_PER_SECOND = DEFAULT_DIALOGUE_CHARS_PER_SEC;

const SPEECH_DELIMITER_PAIRS: ReadonlyArray<readonly [string, string]> = [
	["\u201C", "\u201D"], // “ ”
	["\u300C", "\u300D"], // 「 」
	["\u300E", "\u300F"], // 『 』
];

const OPEN_DELIMITERS = new Set(SPEECH_DELIMITER_PAIRS.map(([open]) => open));
const CLOSE_DELIMITER_BY_OPEN = new Map(SPEECH_DELIMITER_PAIRS);

export type BeatSheetSourceSpeechUnit = Readonly<{
	unitId: string;
	sourceId: string;
	verbatim: string;
	chars: number;
}>;

export type BeatSheetSourceProfile = Readonly<{
	protocolVersion: "tapcanvas.beat-sheet-source-profile/v1";
	sourceIds: readonly string[];
	sourceChars: number;
	sourceSpeechChars: number;
	sourceSpeechUnits: readonly BeatSheetSourceSpeechUnit[];
	minimumPlannedSeconds: number;
	minimumClipCount: number | null;
	speechMaxCharsPerSecond: number;
	/** 自然念白速率：只用于把"冻结的交付时长"换算成该窗口能承载的人声字数。 */
	speechPlanningCharsPerSecond: number;
	sourceSetFingerprint: string;
}>;

type CanonicalSource = Readonly<{ sourceId: string; content: string }>;

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readText(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function readPositiveInteger(value: unknown): number | null {
	return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
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
		sources.push({ sourceId, content });
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
		if (SPEECH_DELIMITER_PAIRS.some(([, close]) => close === char)) continue;
		matchIndexByOriginal[index] = text.length;
		text += char;
	}
	return { text, matchIndexByOriginal };
}

type SpeechSpan = Readonly<{ sourceIndex: number; sourceId: string; verbatim: string; start: number; end: number }>;

/** 提取原文中被引号界定的人声段落（纯排版界定，不做语义识别）。 */
function extractSpeechSpans(sources: readonly CanonicalSource[]): SpeechSpan[] {
	const spans: SpeechSpan[] = [];
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

/**
 * 由冻结的 delivery contract 派生原文人声容量事实。宿主与 Agent 共用同一份事实，
 * 避免「Agent 自己估时长、宿主事后才发现压成摘要」。
 */
export function deriveBeatSheetSourceProfile(
	deliveryContract: unknown,
	options?: Readonly<{ maxDurationSeconds?: number | null }>,
): BeatSheetSourceProfile | null {
	const sources = readCanonicalSources(deliveryContract);
	if (sources.length === 0) return null;
	const matchSpaces = sources.map((source) => buildMatchSpace(source.content));
	const spans = extractSpeechSpans(sources);
	const units: BeatSheetSourceSpeechUnit[] = [];
	let sourceSpeechChars = 0;
	for (const [index, span] of spans.entries()) {
		const matchSpace = matchSpaces[span.sourceIndex];
		const range = toMatchRange(matchSpace, span.start, span.end);
		if (!range) continue;
		const chars = range.end - range.start;
		if (chars <= 0) continue;
		sourceSpeechChars += chars;
		units.push({
			unitId: `source-speech-${String(index + 1).padStart(3, "0")}`,
			sourceId: span.sourceId,
			verbatim: span.verbatim,
			chars,
		});
	}
	const minimumPlannedSeconds = Math.ceil(sourceSpeechChars / BEAT_SHEET_SPEECH_MAX_CHARS_PER_SECOND);
	const maxDurationSeconds = readPositiveInteger(options?.maxDurationSeconds);
	const minimumClipCount = maxDurationSeconds && minimumPlannedSeconds > 0
		? Math.ceil(minimumPlannedSeconds / maxDurationSeconds)
		: null;
	const sourceChars = matchSpaces.reduce((total, space) => total + space.text.length, 0);
	return {
		protocolVersion: "tapcanvas.beat-sheet-source-profile/v1",
		sourceIds: sources.map((source) => source.sourceId),
		sourceChars,
		sourceSpeechChars,
		sourceSpeechUnits: units,
		minimumPlannedSeconds,
		minimumClipCount,
		speechMaxCharsPerSecond: BEAT_SHEET_SPEECH_MAX_CHARS_PER_SECOND,
		speechPlanningCharsPerSecond: BEAT_SHEET_SPEECH_PLANNING_CHARS_PER_SECOND,
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
	const sourceOffsetBySourceIndex: number[] = [];
	let offset = 0;
	for (const space of matchSpaces) {
		sourceOffsetBySourceIndex.push(offset);
		offset += space.text.length + 1;
	}

	// 1) 来源真实性：台账里的「原文人声」必须逐字来自 canonical 原文（按序出现）。
	const covered = new Uint8Array(concatenated.length);
	let cursor = 0;
	for (const [index, line] of lines.entries()) {
		const normalized = buildMatchSpace(line.text).text;
		if (!normalized) continue;
		const found = concatenated.indexOf(normalized, cursor);
		if (found < 0) {
			return `sourceCoveragePlan.speechLedger[${index}] must preserve verbatim canonical source speech; "${truncate(line.text)}" does not appear verbatim in the authoritative source (rewritten or invented source dialogue belongs in narrativeAudioPlan, not in the source speech ledger)`;
		}
		covered.fill(1, found, found + normalized.length);
		cursor = found + normalized.length;
	}

	const targetDurationSeconds = isRecord(input.deliveryContract)
		? readPositiveInteger(input.deliveryContract.targetDurationSeconds)
		: null;
	// 用户显式授权了总时长 → 允许按该时长取舍内容，只保留来源真实性校验。
	if (targetDurationSeconds !== null) return null;

	// 2) 原文人声覆盖：不允许静默丢弃原文人声。
	const missing: string[] = [];
	for (const span of extractSpeechSpans(sources)) {
		const sourceIndex = span.sourceIndex;
		const matchSpace = matchSpaces[sourceIndex];
		const range = toMatchRange(matchSpace, span.start, span.end);
		if (!range) continue;
		const base = sourceOffsetBySourceIndex[sourceIndex];
		let uncovered = 0;
		for (let index = range.start; index < range.end; index += 1) {
			if (covered[base + index] !== 1) uncovered += 1;
		}
		if (uncovered > 0) missing.push(`"${truncate(span.verbatim)}" (${uncovered} chars)`);
	}
	if (missing.length > 0) {
		return `sourceCoveragePlan.speechLedger does not cover the canonical source's speech; ${missing.length} source speech span(s) are unaccounted for, e.g. ${missing.slice(0, 3).join("; ")}. Full-chapter delivery with no user-authorized total duration must preserve every source speech span verbatim instead of summarising the chapter`;
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
	const profile = deriveBeatSheetSourceProfile(input.deliveryContract);
	if (!profile) return null;
	const declaredSpeechChars = lines.reduce((total, line) => total + buildMatchSpace(line.text).text.length, 0);
	const requiredSeconds = Math.ceil(
		Math.max(profile.sourceSpeechChars, declaredSpeechChars) / profile.speechMaxCharsPerSecond,
	);
	const plannedSeconds = plannedDurationSeconds(beatSheet);
	if (plannedSeconds + 1e-6 < requiredSeconds) {
		return `BeatSheet plans ${plannedSeconds}s but the canonical source carries ${profile.sourceSpeechChars} chars of speech, estimated speech duration is ${requiredSeconds}s at the diagnostic rate ${profile.speechMaxCharsPerSecond} chars/second. This estimate is non-blocking and is not a provider limit; the author should review dialogue allocation`;
	}
	return null;
}
