import { normalizeWithMap } from "./video-orchestrator.source-coverage";
import type {
	SourceCoveragePlan,
	SourceCoveragePlanSpan,
} from "./video-orchestrator.source-coverage-plan";

const MIN_NON_EMPTY_SPAN_CHARS = 1;
const TARGET_UNITS_PER_BEAT = 4;
const MAX_UNIT_NORM_CHARS = 180;
const STRUCTURAL_BOUNDARY_RAW_RE = /[\n\r，,。！？!?；;：:]/;

export type SourceUnit = {
	unitId: string;
	startOffset: number;
	endOffset: number;
	text: string;
};

export type SourceCoverageSelection = {
	startUnitId?: string;
	endUnitIds: string[];
	speechLedger: unknown[];
};

export type CompiledSourceCoveragePlan = {
	plan: SourceCoveragePlan;
	units: SourceUnit[];
};

export function buildSourceUnitCatalogReceipt(input: {
	chapterText: string;
	expectedBeatCount: number;
}): { sourceUnitCatalog: SourceUnit[] } {
	return {
		sourceUnitCatalog: buildSourceUnits(input),
	};
}

export function buildSourceUnitFrontierReceipt(input: {
	nextHeaderPatchField: string | null;
	chapterText: string;
	expectedBeatCount: number;
}): { sourceUnitCatalog: SourceUnit[] } | Record<string, never> {
	return input.nextHeaderPatchField === "sourceCoveragePlan"
		? buildSourceUnitCatalogReceipt({
			chapterText: input.chapterText,
			expectedBeatCount: input.expectedBeatCount,
		})
		: {};
}

function sliceRawByNormalizedOffsets(input: {
	chapterText: string;
	map: readonly number[];
	startOffset: number;
	endOffset: number;
}): string {
	if (input.endOffset <= input.startOffset || input.map.length === 0) return "";
	const rawStart = input.map[input.startOffset] ?? input.chapterText.length;
	const rawEndIndex = input.map[input.endOffset - 1];
	const rawEnd = rawEndIndex === undefined ? input.chapterText.length : rawEndIndex + 1;
	return input.chapterText.slice(rawStart, rawEnd);
}

/**
 * Returns normalized offsets immediately after source punctuation/paragraph
 * separators. Punctuation itself is absent from `norm`, so the gap between two
 * mapped source characters is the only deterministic place to recover these
 * author-provided boundaries without interpreting story semantics.
 */
function buildStructuralBoundaryOffsets(input: {
	chapterText: string;
	map: readonly number[];
}): Set<number> {
	const boundaries = new Set<number>();
	for (let endOffset = 1; endOffset < input.map.length; endOffset += 1) {
		const previousRawOffset = input.map[endOffset - 1];
		const nextRawOffset = input.map[endOffset];
		if (previousRawOffset === undefined || nextRawOffset === undefined) continue;
		const rawGap = input.chapterText.slice(previousRawOffset + 1, nextRawOffset);
		if (STRUCTURAL_BOUNDARY_RAW_RE.test(rawGap)) boundaries.add(endOffset);
	}
	boundaries.add(input.map.length);
	return boundaries;
}

function readRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? value as Record<string, unknown>
		: null;
}

function compileSpeechLedger(input: {
	chapterText: string;
	speechLedger: unknown[];
}): SourceCoveragePlan["speechLedger"] {
	const { norm: chapterNorm, map } = normalizeWithMap(input.chapterText);
	let rawCursor = 0;
	let normalizedCursor = 0;
	const seenLineIds = new Set<string>();
	return input.speechLedger.map((value, index) => {
		const record = readRecord(value);
		const lineId = typeof record?.lineId === "string" ? record.lineId.trim() : "";
		const speakerName = typeof record?.speakerName === "string" ? record.speakerName.trim() : "";
		const requestedText = typeof record?.text === "string" ? record.text.trim() : "";
		if (!lineId || !speakerName || !requestedText) {
			throw new Error(`source_speech_ledger_invalid: index=${index}`);
		}
		if (seenLineIds.has(lineId)) {
			throw new Error(`source_speech_line_id_duplicate: ${lineId}`);
		}
		seenLineIds.add(lineId);

		const exactStart = input.chapterText.indexOf(requestedText, rawCursor);
		let canonicalText = requestedText;
		if (exactStart >= 0) {
			rawCursor = exactStart + requestedText.length;
			const consumedNormLength = normalizeWithMap(
				input.chapterText.slice(0, rawCursor),
			).norm.length;
			normalizedCursor = consumedNormLength;
		} else {
			const requestedNorm = normalizeWithMap(requestedText).norm;
			const normalizedStart = requestedNorm
				? chapterNorm.indexOf(requestedNorm, normalizedCursor)
				: -1;
			if (normalizedStart < 0) {
				throw new Error(`source_speech_text_not_found: lineId=${lineId}`);
			}
			const normalizedEnd = normalizedStart + requestedNorm.length;
			const rawStart = map[normalizedStart];
			const rawEndIndex = map[normalizedEnd - 1];
			if (rawStart === undefined || rawEndIndex === undefined) {
				throw new Error(`source_speech_coordinate_invalid: lineId=${lineId}`);
			}
			canonicalText = input.chapterText.slice(rawStart, rawEndIndex + 1).trim();
			rawCursor = rawEndIndex + 1;
			normalizedCursor = normalizedEnd;
		}
		return {
			lineId,
			speakerName,
			text: canonicalText,
			sourceMarker: canonicalText,
		};
	});
}

/**
 * Produces a bounded deterministic address space over arbitrary source text.
 * Unit boundaries are structural normalized offsets, never semantic guesses.
 * The model chooses only which unit ends each clip; the runtime owns all exact
 * text coordinates and therefore cannot create a gap by copying punctuation or
 * whitespace differently.
 */
export function buildSourceUnits(input: {
	chapterText: string;
	expectedBeatCount: number;
}): SourceUnit[] {
	if (!Number.isInteger(input.expectedBeatCount) || input.expectedBeatCount < 1) {
		throw new Error("expected_beat_count_invalid");
	}
	const { norm, map } = normalizeWithMap(input.chapterText);
	if (!norm.length) throw new Error("chapter_source_text_empty");
	if (norm.length < input.expectedBeatCount) {
		throw new Error(
			`chapter_source_has_fewer_addressable_characters_than_expected_beats: ` +
			`sourceChars=${norm.length} expectedBeatCount=${input.expectedBeatCount}`,
		);
	}
	const unitSize = Math.max(
		MIN_NON_EMPTY_SPAN_CHARS,
		Math.min(
			MAX_UNIT_NORM_CHARS,
			Math.ceil(norm.length / (input.expectedBeatCount * TARGET_UNITS_PER_BEAT)),
		),
	);
	const boundaryOffsets = buildStructuralBoundaryOffsets({
		chapterText: input.chapterText,
		map,
	});
	// Source units are an address catalog, not delivery spans. Keep every
	// author-provided structural boundary address even when two addresses are
	// close; a clip may select across several units and the compiled span only
	// requires a non-empty structural range. Fixed-width addresses cover punctuation-free
	// passages without replacing the source-authored boundaries.
	for (let offset = unitSize; offset < norm.length; offset += unitSize) {
		boundaryOffsets.add(offset);
	}
	boundaryOffsets.add(norm.length);
	const orderedBoundaries = [...boundaryOffsets]
		.filter((offset) => offset > 0 && offset <= norm.length)
		.sort((left, right) => left - right);
	const units: SourceUnit[] = [];
	let startOffset = 0;
	for (const endOffset of orderedBoundaries) {
		if (endOffset <= startOffset) continue;
		units.push({
			unitId: `source-unit-${String(units.length).padStart(4, "0")}`,
			startOffset,
			endOffset,
			text: sliceRawByNormalizedOffsets({
				chapterText: input.chapterText,
				map,
				startOffset,
				endOffset,
			}),
		});
		startOffset = endOffset;
	}
	return units;
}

export function buildCanonicalSourceCoverageSpan(input: {
	chapterText: string;
	map: readonly number[];
	clipIndex: number;
	startOffset: number;
	endOffset: number;
}): SourceCoveragePlanSpan {
	const spanChars = input.endOffset - input.startOffset;
	if (spanChars < MIN_NON_EMPTY_SPAN_CHARS) {
		throw new Error(
			`source_span_empty: clipIndex=${input.clipIndex} chars=${spanChars}`,
		);
	}
	const markerChars = Math.min(96, Math.floor(spanChars / 2));
	const sourceStartMarker = sliceRawByNormalizedOffsets({
		chapterText: input.chapterText,
		map: input.map,
		startOffset: input.startOffset,
		endOffset: input.startOffset + markerChars,
	}).trim();
	const sourceEndMarker = sliceRawByNormalizedOffsets({
		chapterText: input.chapterText,
		map: input.map,
		startOffset: input.endOffset - markerChars,
		endOffset: input.endOffset,
	}).trim();
	if (!sourceStartMarker || !sourceEndMarker) {
		throw new Error(`source_span_marker_empty: clipIndex=${input.clipIndex}`);
	}
	return {
		clipIndex: input.clipIndex,
		sourceStartMarker,
		sourceEndMarker,
		sourceStartOffset: input.startOffset,
		sourceEndOffset: input.endOffset,
	};
}

/** Compile an agent-authored semantic partition into a canonical gap-free plan. */
export function compileSourceCoverageSelection(input: {
	selection: unknown;
	chapterText: string;
	expectedBeatCount: number;
	deliveryScope: string;
}): CompiledSourceCoveragePlan {
	const selection = readRecord(input.selection);
	const startUnitId = typeof selection?.startUnitId === "string"
		? selection.startUnitId.trim()
		: "";
	const endUnitIds = Array.isArray(selection?.endUnitIds)
		? selection.endUnitIds.map((value) => typeof value === "string" ? value.trim() : "")
		: [];
	const speechLedgerInput = Array.isArray(selection?.speechLedger)
		? structuredClone(selection.speechLedger)
		: null;
	if (endUnitIds.length !== input.expectedBeatCount || endUnitIds.some((unitId) => !unitId)) {
		throw new Error(
			`source_end_unit_count_mismatch: expected=${input.expectedBeatCount} received=${endUnitIds.length}`,
		);
	}
	if (!speechLedgerInput) throw new Error("source_speech_ledger_required");

	const units = buildSourceUnits({
		chapterText: input.chapterText,
		expectedBeatCount: input.expectedBeatCount,
	});
	if (input.deliveryScope !== "full_chapter" && input.deliveryScope !== "bounded_duration") {
		throw new Error(`source_delivery_scope_invalid: ${input.deliveryScope || "<missing>"}`);
	}
	const unitIndexById = new Map(units.map((unit, index) => [unit.unitId, index]));
	if (input.deliveryScope === "full_chapter" && startUnitId) {
		throw new Error("full_chapter_start_unit_must_be_omitted");
	}
	if (input.deliveryScope === "bounded_duration" && !startUnitId) {
		throw new Error("bounded_duration_start_unit_required");
	}
	const startUnitIndex = input.deliveryScope === "bounded_duration"
		? unitIndexById.get(startUnitId) ?? -1
		: 0;
	if (startUnitIndex < 0) throw new Error(`source_start_unit_unknown: ${startUnitId}`);
	const selectedIndexes = endUnitIds.map((unitId) => unitIndexById.get(unitId) ?? -1);
	if (selectedIndexes.some((index) => index < 0)) {
		const unknown = endUnitIds.filter((unitId) => !unitIndexById.has(unitId));
		throw new Error(`source_end_unit_unknown: ${JSON.stringify(unknown)}`);
	}
	if (selectedIndexes.some((index, position) => position > 0 && index <= selectedIndexes[position - 1]!)) {
		throw new Error("source_end_units_must_increase_without_duplicates");
	}
	if (selectedIndexes[0]! < startUnitIndex) {
		throw new Error("source_end_unit_precedes_start_unit");
	}
	if (input.deliveryScope === "full_chapter" && selectedIndexes.at(-1) !== units.length - 1) {
		throw new Error(
			`full_chapter_last_source_unit_required: expected=${units.at(-1)?.unitId ?? "<none>"} ` +
			`received=${endUnitIds.at(-1) ?? "<none>"}`,
		);
	}

	const { map } = normalizeWithMap(input.chapterText);
	const speechLedger = compileSpeechLedger({
		chapterText: input.chapterText,
		speechLedger: speechLedgerInput,
	});
	let startOffset = units[startUnitIndex]!.startOffset;
	const spans = selectedIndexes.map((unitIndex, clipIndex) => {
		const endOffset = units[unitIndex]!.endOffset;
		const span = buildCanonicalSourceCoverageSpan({
			chapterText: input.chapterText,
			map,
			clipIndex,
			startOffset,
			endOffset,
		});
		startOffset = endOffset;
		return span;
	});
	return {
		units,
		plan: {
			spans,
			speechLedger,
		},
	};
}
