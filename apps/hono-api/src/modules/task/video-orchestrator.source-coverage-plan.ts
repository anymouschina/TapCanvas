import { normalizeWithMap } from "./video-orchestrator.source-coverage";

export type SourceCoveragePlanSpan = {
	clipIndex: number;
	sourceStartMarker: string;
	sourceEndMarker: string;
	/** Normalized source coordinates authored only by the deterministic runtime. */
	sourceStartOffset: number;
	sourceEndOffset: number;
};

export type SourceSpeechLedgerLine = {
	lineId: string;
	speakerName: string;
	text: string;
	sourceMarker: string;
};

export type SourceCoveragePlan = {
	spans: SourceCoveragePlanSpan[];
	speechLedger: SourceSpeechLedgerLine[];
};

function readRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

export function validateSourceCoveragePlan(input: {
	plan: unknown;
	expectedBeatCount: number;
	deliveryScope: string;
	chapterText: string;
}): { ok: boolean; spans: SourceCoveragePlanSpan[]; speechLedger: SourceSpeechLedgerLine[]; errors: string[] } {
	const errors: string[] = [];
	const plan = readRecord(input.plan);
	const rawSpans = Array.isArray(plan?.spans) ? plan.spans : [];
	const invalidSpanShapes: string[] = [];
	const spans = rawSpans.flatMap((value, index): SourceCoveragePlanSpan[] => {
		const record = readRecord(value);
		const clipIndex = Number(record?.clipIndex);
		const sourceStartMarker = typeof record?.sourceStartMarker === "string"
			? record.sourceStartMarker.trim()
			: "";
		const sourceEndMarker = typeof record?.sourceEndMarker === "string"
			? record.sourceEndMarker.trim()
			: "";
		const sourceStartOffset = Number(record?.sourceStartOffset);
		const sourceEndOffset = Number(record?.sourceEndOffset);
		if (
			!Number.isInteger(clipIndex) || clipIndex < 0 || !sourceStartMarker || !sourceEndMarker ||
			!Number.isInteger(sourceStartOffset) || sourceStartOffset < 0 ||
			!Number.isInteger(sourceEndOffset) || sourceEndOffset <= sourceStartOffset
		) {
			invalidSpanShapes.push(
				`spans[${index}] received fields=${record ? Object.keys(record).sort().join(",") || "none" : "non-object"}`,
			);
			return [];
		}
		return [{
			clipIndex,
			sourceStartMarker,
			sourceEndMarker,
			sourceStartOffset,
			sourceEndOffset,
		}];
	});

	if (!plan || rawSpans.length !== spans.length) {
		errors.push(
			`sourceCoveragePlan.spans[*] 必须包含 runtime 生成的 clipIndex、sourceStartMarker、sourceEndMarker、sourceStartOffset、sourceEndOffset；offset 必须是递增的非负整数${invalidSpanShapes.length > 0 ? `；${invalidSpanShapes.join("；")}` : ""}`,
		);
	}
	if (!Number.isInteger(input.expectedBeatCount) || input.expectedBeatCount < 1) {
		errors.push("expectedBeatCount 必须是正整数");
	} else if (spans.length !== input.expectedBeatCount) {
		errors.push(
			`sourceCoveragePlan.spans 必须与 expectedBeatCount 一一对应（期望 ${input.expectedBeatCount}，收到 ${spans.length}）`,
		);
	}
	const indexes = spans.map((span) => span.clipIndex).sort((left, right) => left - right);
	if (indexes.some((clipIndex, index) => clipIndex !== index)) {
		errors.push("sourceCoveragePlan.spans.clipIndex 必须从 0 连续递增且不得重复");
	}

	const rawSpeechLedger = Array.isArray(plan?.speechLedger) ? plan.speechLedger : null;
	const seenLineIds = new Set<string>();
	const invalidSpeechShapes: string[] = [];
	const speechLedger = (rawSpeechLedger ?? []).flatMap((value, index): SourceSpeechLedgerLine[] => {
		const record = readRecord(value);
		const lineId = typeof record?.lineId === "string" ? record.lineId.trim() : "";
		const speakerName = typeof record?.speakerName === "string" ? record.speakerName.trim() : "";
		const text = typeof record?.text === "string" ? record.text.trim() : "";
		const sourceMarker = typeof record?.sourceMarker === "string" ? record.sourceMarker.trim() : "";
		if (!lineId || !speakerName || !text || !sourceMarker) {
			invalidSpeechShapes.push(
				`speechLedger[${index}] received fields=${record ? Object.keys(record).sort().join(",") || "none" : "non-object"}`,
			);
			return [];
		}
		if (seenLineIds.has(lineId)) {
			invalidSpeechShapes.push(`speechLedger[${index}].lineId=${lineId} 重复`);
			return [];
		}
		seenLineIds.add(lineId);
		return [{ lineId, speakerName, text, sourceMarker }];
	});
	if (!rawSpeechLedger || rawSpeechLedger.length !== speechLedger.length) {
		errors.push(
			"sourceCoveragePlan.speechLedger 必填且必须是数组；每行必须包含章级唯一 lineId、speakerName、逐字 text、sourceMarker；无可发声文本时传 []" +
			(invalidSpeechShapes.length > 0 ? `；${invalidSpeechShapes.join("；")}` : ""),
		);
	}
	if (!input.chapterText.trim()) {
		if (input.deliveryScope === "full_chapter") {
			errors.push("当前章节原文不可用，无法冻结 full_chapter 的逐字 sourceCoveragePlan");
		}
		return { ok: errors.length === 0, spans, speechLedger, errors };
	}

	let speechCursor = 0;
	const normalizedSpeechIntervals: Array<{
		lineId: string;
		startOffset: number;
		endOffset: number;
	}> = [];
	for (const [index, line] of speechLedger.entries()) {
		const markerIndex = input.chapterText.indexOf(line.sourceMarker, speechCursor);
		if (markerIndex < 0) {
			errors.push(
				`sourceCoveragePlan.speechLedger[${index}].sourceMarker 无法按顺序在章节原文逐字定位：${line.sourceMarker}`,
			);
			continue;
		}
		const markerEnd = markerIndex + line.sourceMarker.length;
		const textInsideMarker = line.sourceMarker.includes(line.text);
		if (!textInsideMarker) {
			errors.push(
				`sourceCoveragePlan.speechLedger[${index}].sourceMarker 必须逐字包含该行 text，不能用意译或无关锚点`,
			);
		}
		const normalizedStartOffset = normalizeWithMap(
			input.chapterText.slice(0, markerIndex),
		).norm.length;
		const normalizedEndOffset = normalizeWithMap(
			input.chapterText.slice(0, markerEnd),
		).norm.length;
		normalizedSpeechIntervals.push({
			lineId: line.lineId,
			startOffset: normalizedStartOffset,
			endOffset: normalizedEndOffset,
		});
		speechCursor = markerEnd;
	}

	const ordered = [...spans].sort((left, right) => left.clipIndex - right.clipIndex);
	const { norm: chapterNorm } = normalizeWithMap(input.chapterText);
	for (const [index, span] of ordered.entries()) {
		const previousEnd = index === 0 && input.deliveryScope !== "full_chapter"
			? span.sourceStartOffset
			: index === 0
				? 0
				: ordered[index - 1]!.sourceEndOffset;
		if (span.sourceStartOffset !== previousEnd) {
			errors.push(
				`sourceCoveragePlan runtime offset 不连续：clip=${span.clipIndex} expectedStart=${previousEnd} received=${span.sourceStartOffset}`,
			);
		}
		if (span.sourceEndOffset > chapterNorm.length) {
			errors.push(
				`sourceCoveragePlan runtime offset 越界：clip=${span.clipIndex} end=${span.sourceEndOffset} sourceLength=${chapterNorm.length}`,
			);
			continue;
		}
		const startNorm = normalizeWithMap(span.sourceStartMarker).norm;
		const endNorm = normalizeWithMap(span.sourceEndMarker).norm;
		if (
			!startNorm ||
			chapterNorm.slice(span.sourceStartOffset, span.sourceStartOffset + startNorm.length) !== startNorm
		) {
			errors.push(`sourceCoveragePlan clip=${span.clipIndex} 的 sourceStartMarker 与 runtime offset 原文不一致`);
		}
		if (
			!endNorm ||
			chapterNorm.slice(span.sourceEndOffset - endNorm.length, span.sourceEndOffset) !== endNorm
		) {
			errors.push(`sourceCoveragePlan clip=${span.clipIndex} 的 sourceEndMarker 与 runtime offset 原文不一致`);
		}
	}
	if (
		input.deliveryScope === "full_chapter" &&
		ordered.at(-1)?.sourceEndOffset !== chapterNorm.length
	) {
		errors.push(
			`full_chapter 的 sourceCoveragePlan 必须由 runtime offset 覆盖完整原文：expectedEnd=${chapterNorm.length} received=${ordered.at(-1)?.sourceEndOffset ?? "none"}`,
		);
	}
	for (const span of ordered.slice(0, -1)) {
		const splitSpeech = normalizedSpeechIntervals.find((interval) => (
			span.sourceEndOffset > interval.startOffset &&
			span.sourceEndOffset < interval.endOffset
		));
		if (splitSpeech) {
			errors.push(
				`sourceCoveragePlan clip=${span.clipIndex} 的结束边界 ${span.sourceEndOffset} ` +
				`切断 speechLedger lineId=${splitSpeech.lineId} 的逐字台词区间 ` +
				`[${splitSpeech.startOffset},${splitSpeech.endOffset})；必须移动 clip 边界以完整承载该行台词`,
			);
		}
	}

	return { ok: errors.length === 0, spans: ordered, speechLedger, errors };
}

type BeatDialogueLine = Pick<SourceSpeechLedgerLine, "lineId" | "speakerName" | "text"> & {
	delivery: "on_screen" | "off_screen" | "voice_over";
};

function readDialogueLine(value: unknown): BeatDialogueLine | null {
	const record = readRecord(value);
	const lineId = typeof record?.lineId === "string" ? record.lineId.trim() : "";
	const speakerName = typeof record?.speakerName === "string" ? record.speakerName.trim() : "";
	const text = typeof record?.text === "string" ? record.text.trim() : "";
	const delivery = record?.delivery;
	if (
		!lineId || !speakerName || !text ||
		(delivery !== "on_screen" && delivery !== "off_screen" && delivery !== "voice_over")
	) return null;
	return { lineId, speakerName, text, delivery };
}

/**
 * Deterministic conservation check over an agents-authored semantic ledger.
 * It compares only structured fields and never tries to decide whether source
 * prose is dialogue, action, narration, or visual description.
 */
export function validateSpeechLedgerAgainstBeats(input: {
	speechLedger: readonly SourceSpeechLedgerLine[];
	beats: unknown;
	deliveryScope: string;
}): string[] {
	if (input.deliveryScope !== "full_chapter" && input.deliveryScope !== "bounded_duration") return [];
	const scopeLabel = input.deliveryScope;
	if (!Array.isArray(input.beats)) return [`${scopeLabel} 发声台账回拼失败：beats 必须是数组`];
	const actual = input.beats.flatMap((beat, beatIndex) => {
		const record = readRecord(beat);
		if (!Array.isArray(record?.dialogueScript)) return [];
		return record.dialogueScript.flatMap((line, lineIndex) => {
			const parsed = readDialogueLine(line);
			return parsed ? [parsed] : [{
				lineId: `invalid:${beatIndex}:${lineIndex}`,
				speakerName: "",
				text: "",
				delivery: "voice_over" as const,
			}];
		});
	});
	const errors: string[] = [];
	if (actual.length !== input.speechLedger.length) {
		errors.push(
			`${scopeLabel} 发声台账回拼数量不一致：speechLedger=${input.speechLedger.length} dialogueScript=${actual.length}`,
		);
	}
	const total = Math.max(actual.length, input.speechLedger.length);
	for (let index = 0; index < total; index += 1) {
		const expected = input.speechLedger[index];
		const received = actual[index];
		if (!expected || !received) continue;
		for (const field of ["lineId", "speakerName", "text"] as const) {
			if (received[field] !== expected[field]) {
				errors.push(
					`${scopeLabel} 发声台账回拼在第 ${index + 1} 行 ${field} 不一致：期望=${JSON.stringify(expected[field])} 收到=${JSON.stringify(received[field])}`,
				);
			}
		}
	}
	return errors;
}

export function compileBeatCoverageSpan(input: {
	beat: Record<string, unknown>;
	spans: readonly SourceCoveragePlanSpan[];
}):
	| { ok: true; beat: Record<string, unknown> }
	| { ok: false; error: string } {
	const clipIndex = Number(input.beat.clipIndex);
	const span = input.spans.find((candidate) => candidate.clipIndex === clipIndex);
	if (!span) {
		return {
			ok: false,
			error: `beat.clipIndex=${String(input.beat.clipIndex)} 不在已冻结 sourceCoveragePlan 中`,
		};
	}
	return {
		ok: true,
		beat: {
			...input.beat,
			sourceStartMarker: span.sourceStartMarker,
			sourceEndMarker: span.sourceEndMarker,
		},
	};
}
