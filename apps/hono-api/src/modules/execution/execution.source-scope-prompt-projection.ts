import { sha256Hex } from "../asset/book-content-hash";
import { resolveWorkflowAuthoritativeSourceLineage } from "./execution.source-lineage";
import { CHAPTER_SEQUENCE_CLIP_ARTIFACT_TYPE } from "../../../../../packages/schemas/chapter-sequence/index.mjs";
import { CLIP_SOURCE_SEGMENT_PROTOCOL_VERSION } from "../../../../../packages/schemas/video-clip-segmentation/index.mjs";

type JsonRecord = Record<string, unknown>;

type FrozenSource = Readonly<{
	sourceIndex: number;
	sourceId: string;
	sourceFingerprint: string;
	content: string;
}>;

type SourceRange = Readonly<{
	sourceIndex: number;
	sourceId: string;
	sourceFingerprint: string;
	startOffset: number;
	endOffset: number;
}>;

type SourceSlice = SourceRange & Readonly<{ text: string }>;

type SourceSet = Readonly<{
	sources: readonly FrozenSource[];
	sourceSetFingerprint: string;
}>;

type LocatedRecord = Readonly<{ port: string; value: JsonRecord }>;

export type FrozenSourceScopePromptProjection = Readonly<{
	inputs: Readonly<Record<string, readonly unknown[]>>;
	status: "projected" | "retained";
	reason: string;
	observedSourceFacts: boolean;
	segmentPort: string | null;
	sequencePort: string | null;
	sourceCount: number;
	removedSourceBodyCount: number;
	removedQuotedUnitCount: number;
	inputCharactersBefore: number;
	inputCharactersAfter: number;
}>;

function isRecord(value: unknown): value is JsonRecord {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readText(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function isSafeInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value);
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function identityKey(sourceId: string, sourceFingerprint: string): string {
	return `${sourceId}\u0000${sourceFingerprint}`;
}

function rangeKey(range: SourceRange): string {
	return `${range.sourceIndex}:${range.startOffset}:${range.endOffset}:${range.sourceId}:${range.sourceFingerprint}`;
}

function sameRange(left: SourceRange, right: SourceRange): boolean {
	return rangeKey(left) === rangeKey(right);
}

function splitsSurrogatePair(content: string, offset: number): boolean {
	if (offset <= 0 || offset >= content.length) return false;
	const left = content.charCodeAt(offset - 1);
	const right = content.charCodeAt(offset);
	return left >= 0xd800 && left <= 0xdbff && right >= 0xdc00 && right <= 0xdfff;
}

function readSourceRange(value: unknown): SourceRange | null {
	if (!isRecord(value)) return null;
	const sourceIndex = value.sourceIndex;
	const startOffset = value.startOffset;
	const endOffset = value.endOffset;
	const sourceId = readText(value.sourceId);
	const sourceFingerprint = readText(value.sourceFingerprint);
	if (!isSafeInteger(sourceIndex) || sourceIndex < 0
		|| !isSafeInteger(startOffset) || startOffset < 0
		|| !isSafeInteger(endOffset) || endOffset <= startOffset
		|| !sourceId || !sourceFingerprint) return null;
	return { sourceIndex, startOffset, endOffset, sourceId, sourceFingerprint };
}

function readSourceSlice(value: unknown): SourceSlice | null {
	if (!isRecord(value) || typeof value.text !== "string") return null;
	const range = readSourceRange(value);
	if (!range || value.text.length !== range.endOffset - range.startOffset) return null;
	return { ...range, text: value.text };
}

function sourceSetFingerprint(sources: readonly FrozenSource[]): string {
	return sha256Hex(sources.map((source) => `${source.sourceId}\u0000${source.content}`).join("\u0001"));
}

function parseSourceSet(value: unknown): SourceSet | null {
	if (!Array.isArray(value) || value.length === 0) return null;
	const sources: FrozenSource[] = [];
	const identities = new Set<string>();
	for (const [sourceIndex, raw] of value.entries()) {
		if (!isRecord(raw)) return null;
		const sourceId = readText(raw.sourceId) || readText(raw.nodeId);
		const sourceFingerprint = readText(raw.sourceFingerprint);
		const content = typeof raw.content === "string" ? raw.content : "";
		if (!sourceId || !sourceFingerprint || !content.trim() || sha256Hex(content) !== sourceFingerprint) return null;
		const key = identityKey(sourceId, sourceFingerprint);
		if (identities.has(key)) return null;
		identities.add(key);
		sources.push({ sourceIndex, sourceId, sourceFingerprint, content });
	}
	return { sources, sourceSetFingerprint: sourceSetFingerprint(sources) };
}

function collectRecords(inputs: Readonly<Record<string, readonly unknown[]>>): LocatedRecord[] {
	const records: LocatedRecord[] = [];
	const visit = (port: string, value: unknown, depth: number): void => {
		if (depth > 16) return;
		if (Array.isArray(value)) {
			for (const child of value) visit(port, child, depth + 1);
			return;
		}
		if (!isRecord(value)) return;
		records.push({ port, value });
		for (const child of Object.values(value)) visit(port, child, depth + 1);
	};
	for (const [port, values] of Object.entries(inputs)) visit(port, values, 0);
	return records;
}

function readRanges(value: unknown): SourceRange[] | null {
	if (!Array.isArray(value) || value.length === 0) return null;
	const ranges: SourceRange[] = [];
	for (const item of value) {
		const range = readSourceRange(item);
		if (!range) return null;
		ranges.push(range);
	}
	return ranges;
}

function readScopeCandidate(
	located: LocatedRecord,
): Readonly<{
	port: string;
	value: JsonRecord;
	clipId: string;
	clipIndex: number;
	durationSeconds: number;
	ranges: readonly SourceRange[];
	slices: readonly SourceSlice[];
}> | null {
	const value = located.value;
	if (value.protocolVersion !== CLIP_SOURCE_SEGMENT_PROTOCOL_VERSION) return null;
	const clipId = readText(value.clipId);
	const clipIndex = value.clipIndex;
	const durationSeconds = value.durationSeconds;
	const ranges = readRanges(value.sourceRanges);
	if (!clipId || !isSafeInteger(clipIndex) || clipIndex < 0
		|| !isSafeInteger(durationSeconds) || durationSeconds <= 0
		|| !ranges || !Array.isArray(value.sourceSlices) || value.sourceSlices.length !== ranges.length) return null;
	const slices: SourceSlice[] = [];
	for (const [index, rawSlice] of value.sourceSlices.entries()) {
		const slice = readSourceSlice(rawSlice);
		const range = ranges[index];
		if (!slice || !range || !sameRange(slice, range)) return null;
		slices.push(slice);
	}
	return { port: located.port, value, clipId, clipIndex, durationSeconds, ranges, slices };
}

function exactRanges(left: readonly SourceRange[], right: readonly SourceRange[]): boolean {
	return left.length === right.length && left.every((range, index) => {
		const other = right[index];
		return other !== undefined && sameRange(range, other);
	});
}

function collectSourceSets(records: readonly LocatedRecord[]): SourceSet[] {
	const found = new Map<string, SourceSet>();
	for (const { value } of records) {
		const canvasFacts = isRecord(value.canvasFacts) ? value.canvasFacts : null;
		const rawSources = canvasFacts && Array.isArray(canvasFacts.authoritativeSources)
			? canvasFacts.authoritativeSources
			: Array.isArray(value.authoritativeSources) ? value.authoritativeSources : null;
		if (!rawSources) continue;
		const parsed = parseSourceSet(rawSources);
		if (parsed) found.set(parsed.sourceSetFingerprint, parsed);
	}
	return [...found.values()];
}

function matchesScopeSourceSet(
	scope: ReturnType<typeof readScopeCandidate>,
	sourceSet: SourceSet,
): boolean {
	if (!scope) return false;
	const claimedSourceId = readText(scope.value.sourceId);
	const claimedSourceFingerprint = readText(scope.value.sourceFingerprint);
	if (!claimedSourceId || !claimedSourceFingerprint) return false;
	let lineage: Readonly<{ sourceId: string; sourceFingerprint: string }>;
	try {
		lineage = resolveWorkflowAuthoritativeSourceLineage(sourceSet.sources.map((source) => ({
			sourceId: source.sourceId,
			sourceFingerprint: source.sourceFingerprint,
			content: source.content,
		})));
	} catch {
		return false;
	}
	if (lineage.sourceId !== claimedSourceId || lineage.sourceFingerprint !== claimedSourceFingerprint) return false;
	for (const [index, range] of scope.ranges.entries()) {
		const source = sourceSet.sources[range.sourceIndex];
		const slice = scope.slices[index];
		if (!source || !slice
			|| source.sourceId !== range.sourceId
			|| source.sourceFingerprint !== range.sourceFingerprint
			|| range.endOffset > source.content.length
			|| splitsSurrogatePair(source.content, range.startOffset)
			|| splitsSurrogatePair(source.content, range.endOffset)
			|| source.content.slice(range.startOffset, range.endOffset) !== slice.text) return false;
	}
	return true;
}

function profileMatchesSourceSet(value: unknown, sourceSet: SourceSet): value is JsonRecord {
	if (!isRecord(value) || value.protocolVersion !== "tapcanvas.beat-sheet-source-profile/v2") return false;
	const sourceIds = value.sourceIds;
	const units = value.sourceQuotedUnits;
	if (!Array.isArray(sourceIds) || !Array.isArray(units)
		|| sourceIds.length !== sourceSet.sources.length
		|| !sourceIds.every((sourceId, index) => sourceId === sourceSet.sources[index]?.sourceId)
		|| value.sourceSetFingerprint !== sourceSet.sourceSetFingerprint) return false;
	const knownSourceIds = new Set(sourceIds.filter((sourceId): sourceId is string => typeof sourceId === "string"));
	const unitIds = new Set<string>();
	for (const rawUnit of units) {
		if (!isRecord(rawUnit)) return false;
		const unitId = readText(rawUnit.unitId);
		const sourceId = readText(rawUnit.sourceId);
		if (!unitId || unitIds.has(unitId) || !knownSourceIds.has(sourceId)
			|| typeof rawUnit.verbatim !== "string"
			|| !isSafeInteger(rawUnit.chars) || rawUnit.chars < 0) return false;
		unitIds.add(unitId);
	}
	return true;
}

function rangeCoveredByScope(range: SourceRange, scopeRanges: readonly SourceRange[]): boolean {
	return scopeRanges.some((candidate) => candidate.sourceIndex === range.sourceIndex
		&& candidate.sourceId === range.sourceId
		&& candidate.sourceFingerprint === range.sourceFingerprint
		&& candidate.startOffset <= range.startOffset
		&& candidate.endOffset >= range.endOffset);
}

function readSequenceSpeechEvents(
	sequence: JsonRecord,
	scope: ReturnType<typeof readScopeCandidate>,
	sourceSet: SourceSet,
): readonly JsonRecord[] | null {
	if (!scope || sequence.protocolVersion !== CHAPTER_SEQUENCE_CLIP_ARTIFACT_TYPE
		|| sequence.clipId !== scope.clipId
		|| sequence.clipIndex !== scope.clipIndex
		|| sequence.durationSeconds !== scope.durationSeconds) return null;
	const sequenceRanges = readRanges(sequence.sourceRanges);
	if (!sequenceRanges || !exactRanges(scope.ranges, sequenceRanges) || !Array.isArray(sequence.speechEvents)) return null;
	const events: JsonRecord[] = [];
	const ids = new Set<string>();
	for (const rawEvent of sequence.speechEvents) {
		if (!isRecord(rawEvent)) return null;
		const speechEventId = readText(rawEvent.speechEventId);
		const speaker = readText(rawEvent.speaker);
		const delivery = readText(rawEvent.delivery);
		const text = typeof rawEvent.text === "string" ? rawEvent.text : "";
		const textOrigin = rawEvent.textOrigin;
		const startSeconds = rawEvent.startSeconds;
		const endSeconds = rawEvent.endSeconds;
		const ranges = Array.isArray(rawEvent.sourceRanges)
			? rawEvent.sourceRanges.map(readSourceRange)
			: null;
		if (!speechEventId || ids.has(speechEventId) || !speaker || !delivery || !text.trim()
			|| (textOrigin !== "authored" && textOrigin !== "source_quote")
			|| !isFiniteNumber(startSeconds) || !isFiniteNumber(endSeconds)
			|| startSeconds < 0 || endSeconds <= startSeconds || endSeconds > scope.durationSeconds
			|| !ranges || ranges.some((range) => range === null)) return null;
		ids.add(speechEventId);
		const validRanges = ranges.filter((range): range is SourceRange => range !== null);
		for (const range of validRanges) {
			const source = sourceSet.sources[range.sourceIndex];
			if (!source || source.sourceId !== range.sourceId || source.sourceFingerprint !== range.sourceFingerprint
				|| !rangeCoveredByScope(range, scope.ranges)
				|| splitsSurrogatePair(source.content, range.startOffset)
				|| splitsSurrogatePair(source.content, range.endOffset)) return null;
		}
		if (textOrigin === "source_quote") {
			if (validRanges.length === 0) return null;
			for (let index = 1; index < validRanges.length; index += 1) {
				const previous = validRanges[index - 1];
				const current = validRanges[index];
				if (!previous || !current || current.sourceIndex < previous.sourceIndex
					|| (current.sourceIndex === previous.sourceIndex && current.startOffset < previous.endOffset)) return null;
			}
			const quotedText = validRanges.map((range) => sourceSet.sources[range.sourceIndex]!.content
				.slice(range.startOffset, range.endOffset)).join("");
			if (quotedText !== text) return null;
		}
		events.push(rawEvent);
	}
	return events;
}

function promptCharacterCount(inputs: Readonly<Record<string, readonly unknown[]>>): number {
	return JSON.stringify(inputs).length;
}

function retainedResult(
	inputs: Readonly<Record<string, readonly unknown[]>>,
	reason: string,
	observedSourceFacts: boolean,
	beforeCharacters: number,
	segmentPort: string | null = null,
	sequencePort: string | null = null,
	sourceCount = 0,
): FrozenSourceScopePromptProjection {
	return {
		inputs,
		status: "retained",
		reason,
		observedSourceFacts,
		segmentPort,
		sequencePort,
		sourceCount,
		removedSourceBodyCount: 0,
		removedQuotedUnitCount: 0,
		inputCharactersBefore: beforeCharacters,
		inputCharactersAfter: beforeCharacters,
	};
}

/**
 * Removes duplicate full-source text from model-facing inputs only after an
 * exact frozen range/slice match and a structurally valid typed sequence for
 * the same scoped item. The caller retains the original inputs for validation.
 */
export function projectFrozenSourceScopePromptInputs(
	inputs: Readonly<Record<string, readonly unknown[]>>,
): FrozenSourceScopePromptProjection {
	const beforeCharacters = promptCharacterCount(inputs);
	const records = collectRecords(inputs);
	const scopeCandidates = records.flatMap((located) => {
		const scope = readScopeCandidate(located);
		return scope ? [scope] : [];
	});
	const observedSourceFacts = records.some(({ value }) => (
		value.protocolVersion === CLIP_SOURCE_SEGMENT_PROTOCOL_VERSION
		|| Array.isArray(value.authoritativeSources)
		|| (isRecord(value.canvasFacts) && Array.isArray(value.canvasFacts.authoritativeSources))
		|| isRecord(value.sourceProfile)
	));
	if (scopeCandidates.length !== 1) {
		return retainedResult(inputs, scopeCandidates.length === 0 ? "frozen_source_scope_not_found" : "frozen_source_scope_ambiguous",
			observedSourceFacts || scopeCandidates.length > 0, beforeCharacters);
	}
	const scope = scopeCandidates[0];
	if (!scope) return retainedResult(inputs, "frozen_source_scope_not_found", observedSourceFacts, beforeCharacters);
	const sourceSets = collectSourceSets(records).filter((candidate) => matchesScopeSourceSet(scope, candidate));
	if (sourceSets.length !== 1) {
		return retainedResult(inputs, sourceSets.length === 0 ? "frozen_source_identity_unverified" : "frozen_source_set_ambiguous",
			true, beforeCharacters, scope.port, null);
	}
	const canonicalSet = sourceSets[0];
	if (!canonicalSet) return retainedResult(inputs, "frozen_source_identity_unverified", true, beforeCharacters, scope.port);
	const matchingSequences = records.filter(({ value }) => value.protocolVersion === CHAPTER_SEQUENCE_CLIP_ARTIFACT_TYPE
		&& value.clipId === scope.clipId && value.clipIndex === scope.clipIndex);
	if (matchingSequences.length !== 1) {
		return retainedResult(inputs, matchingSequences.length === 0 ? "matching_speech_scope_not_found" : "matching_speech_scope_ambiguous",
			true, beforeCharacters, scope.port);
	}
	const sequenceLocated = matchingSequences[0];
	const sequence = sequenceLocated?.value;
	const speechEvents = sequence ? readSequenceSpeechEvents(sequence, scope, canonicalSet) : null;
	if (!sequence || !speechEvents) {
		return retainedResult(inputs, "matching_speech_scope_incomplete_or_mismatched", true, beforeCharacters,
			scope.port, sequenceLocated?.port ?? null, canonicalSet.sources.length);
	}
	const scopeSourceKeys = new Set(scope.ranges.map((range) => identityKey(range.sourceId, range.sourceFingerprint)));
	const sourceProfiles = records.flatMap(({ value }) => isRecord(value.sourceProfile) ? [value.sourceProfile] : []);
	if (sourceProfiles.some((profile) => !profileMatchesSourceSet(profile, canonicalSet))) {
		return retainedResult(inputs, "source_profile_does_not_match_frozen_source", true, beforeCharacters,
			scope.port, sequenceLocated?.port ?? null, canonicalSet.sources.length);
	}
	const projectProfile = sourceProfiles.length > 0 && canonicalSet.sources.every((source) => (
		scopeSourceKeys.has(identityKey(source.sourceId, source.sourceFingerprint))
	));
	const scopedSourceKeys = scopeSourceKeys;
	let removedSourceBodyCount = 0;
	let removedQuotedUnitCount = 0;
	const transformed = Object.fromEntries(Object.entries(inputs).map(([port, values]) => [port,
		values.map((value) => transformPromptValue(value, canonicalSet, scopedSourceKeys, projectProfile,
			scope.ranges, sequenceLocated?.port ?? "", scope.clipId,
			() => { removedSourceBodyCount += 1; }, (count) => { removedQuotedUnitCount += count; })),
	]));
	const afterCharacters = promptCharacterCount(transformed);
	if (removedSourceBodyCount === 0 && removedQuotedUnitCount === 0) {
		return retainedResult(inputs, "no_duplicate_source_facts", true, beforeCharacters,
			scope.port, sequenceLocated?.port ?? null, canonicalSet.sources.length);
	}
	if (afterCharacters >= beforeCharacters) {
		return retainedResult(inputs, "projection_would_not_reduce_prompt_context", true, beforeCharacters,
			scope.port, sequenceLocated?.port ?? null, canonicalSet.sources.length);
	}
	return {
		inputs: transformed,
		status: "projected",
		reason: "frozen_source_scope_and_sequence_verified",
		observedSourceFacts: true,
		segmentPort: scope.port,
		sequencePort: sequenceLocated?.port ?? null,
		sourceCount: canonicalSet.sources.length,
		removedSourceBodyCount,
		removedQuotedUnitCount,
		inputCharactersBefore: beforeCharacters,
		inputCharactersAfter: afterCharacters,
	};
}

function transformPromptValue(
	value: unknown,
	sourceSet: SourceSet,
	scopedSourceKeys: ReadonlySet<string>,
	projectProfile: boolean,
	scopeRanges: readonly SourceRange[],
	sequencePort: string,
	clipId: string,
	onSourceBodyRemoved: () => void,
	onQuotedUnitsRemoved: (count: number) => void,
): unknown {
	if (Array.isArray(value)) return value.map((child) => transformPromptValue(child, sourceSet, scopedSourceKeys,
		projectProfile, scopeRanges, sequencePort, clipId, onSourceBodyRemoved, onQuotedUnitsRemoved));
	if (!isRecord(value)) return value;
	const output: JsonRecord = {};
	for (const [key, child] of Object.entries(value)) {
		if (key === "authoritativeSources" && Array.isArray(child)) {
			const localSourceSet = parseSourceSet(child);
			if (localSourceSet?.sourceSetFingerprint === sourceSet.sourceSetFingerprint) {
				output[key] = child.map((rawSource) => {
					if (!isRecord(rawSource)) return rawSource;
					const sourceId = readText(rawSource.sourceId) || readText(rawSource.nodeId);
					const sourceFingerprint = readText(rawSource.sourceFingerprint);
					const content = typeof rawSource.content === "string" ? rawSource.content : "";
					if (!scopedSourceKeys.has(identityKey(sourceId, sourceFingerprint)) || !content) return rawSource;
					const { content: _content, ...sourceFacts } = rawSource;
					onSourceBodyRemoved();
					return {
						...sourceFacts,
						contentReference: {
							sourceId,
							sourceFingerprint,
							fullSourceCharacters: content.length,
							scopedRanges: scopeRanges.filter((range) => range.sourceId === sourceId
								&& range.sourceFingerprint === sourceFingerprint),
						},
					};
				});
				continue;
			}
		}
		if (key === "sourceProfile" && projectProfile && isRecord(child)
			&& child.sourceSetFingerprint === sourceSet.sourceSetFingerprint
			&& Array.isArray(child.sourceQuotedUnits)) {
			const { sourceQuotedUnits, ...profileStats } = child;
			const units = sourceQuotedUnits.filter(isRecord);
			const verbatimCharacters = units.reduce((sum, unit) => sum
				+ (typeof unit.verbatim === "string" ? unit.verbatim.length : 0), 0);
			onQuotedUnitsRemoved(units.length);
			output[key] = {
				...profileStats,
				sourceQuotedUnitsSummary: {
					unitCount: units.length,
					verbatimCharacters,
					sourceSetFingerprint: sourceSet.sourceSetFingerprint,
					structuredScopePort: sequencePort,
					clipId,
				},
			};
			continue;
		}
		output[key] = transformPromptValue(child, sourceSet, scopedSourceKeys, projectProfile,
			scopeRanges, sequencePort, clipId, onSourceBodyRemoved, onQuotedUnitsRemoved);
	}
	return output;
}
