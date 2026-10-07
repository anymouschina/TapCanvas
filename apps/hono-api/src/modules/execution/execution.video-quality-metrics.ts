/**
 * Read-only, deterministic measurements for one finished authoring run, so a
 * change to author guidance can be compared before/after on the same chapter.
 * Only countable facts live here. Whether two Clips re-enact the same beat, or
 * whether a line is dramatically right, is a semantic judgement that belongs to
 * an Agent reviewer, not to string matching.
 */

export type VideoQualityClip = Readonly<{ clipIndex: number; videoPrompt: string }>;
export type VideoQualitySpeech = Readonly<{
	textOrigin?: unknown;
	text?: unknown;
	startSeconds?: unknown;
	endSeconds?: unknown;
}>;

export type VideoQualityReport = Readonly<{
	clipCount: number;
	prompt: Readonly<{ minChars: number; maxChars: number; meanChars: number }>;
	/** Host instruction wording found verbatim inside a prompt the video model reads. */
	leakedInstructionClips: readonly number[];
	speech: Readonly<{
		eventCount: number;
		sourceQuoteRatio: number;
		fasterThanComfortable: number;
		maxCharsPerSecond: number;
	}>;
}>;

/** Wording the host uses to instruct authors; finding it in a video prompt means it was copied through. */
const HOST_INSTRUCTION_PHRASES = ["冻结起始", "冻结结束", "冻结画面", "冻结事件", "收束画面必须", "衔接描述", "上一 Clip 已演完", "下一 Clip 将演出", "第一帧就是上一", "最后一帧定格在"] as const;
const COMFORTABLE_CHARS_PER_SECOND = 6;

export function measureVideoQuality(input: Readonly<{
	clips: readonly VideoQualityClip[];
	speechEvents: readonly VideoQualitySpeech[];
}>): VideoQualityReport {
	const clips = [...input.clips].sort((left, right) => left.clipIndex - right.clipIndex);
	const lengths = clips.map((clip) => clip.videoPrompt.length);
	const rates = input.speechEvents.flatMap((event) => {
		const start = Number(event.startSeconds);
		const end = Number(event.endSeconds);
		const chars = typeof event.text === "string" ? Array.from(event.text).length : 0;
		return Number.isFinite(start) && Number.isFinite(end) && end > start && chars > 0 ? [chars / (end - start)] : [];
	});
	const quotes = input.speechEvents.filter((event) => event.textOrigin === "source_quote").length;
	return {
		clipCount: clips.length,
		prompt: {
			minChars: lengths.length ? Math.min(...lengths) : 0,
			maxChars: lengths.length ? Math.max(...lengths) : 0,
			meanChars: lengths.length ? Math.round(lengths.reduce((sum, value) => sum + value, 0) / lengths.length) : 0,
		},
		leakedInstructionClips: clips
			.filter((clip) => HOST_INSTRUCTION_PHRASES.some((phrase) => clip.videoPrompt.includes(phrase)))
			.map((clip) => clip.clipIndex),
		speech: {
			eventCount: input.speechEvents.length,
			sourceQuoteRatio: input.speechEvents.length ? Number((quotes / input.speechEvents.length).toFixed(3)) : 0,
			fasterThanComfortable: rates.filter((rate) => rate > COMFORTABLE_CHARS_PER_SECOND).length,
			maxCharsPerSecond: rates.length ? Number(Math.max(...rates).toFixed(2)) : 0,
		},
	};
}
