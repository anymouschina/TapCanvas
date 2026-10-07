import { createWorkflowCollection, type WorkflowCollectionV1 } from "@tapcanvas/workflow-kernel-protocol";
import { sha256Hex } from "../asset/book-content-hash";
import { resolveWorkflowAuthoritativeSourceLineage } from "./execution.source-lineage";
import { parseSourceUnitLedger } from "./execution.source-unit-ledger";
import type { WorkflowAgentJsonObjectContract } from "./execution.agent-output-contract";
import { parseWorkflowVideoDeliveryDurationPlan } from "./execution.video-workflow-contract";

export const OPENING_CLIP_ARTIFACT_TYPE = "tapcanvas.opening-clip/v3" as const;
export const OPENING_CLIP_PROMPT_PROTOCOL = "tapcanvas.opening-clip-prompt/v3" as const;
export const ACCEPTED_OPENING_CLIP_PROTOCOL = "tapcanvas.accepted-opening-clip/v3" as const;
export const OPENING_CLIP_PREFIX_PROTOCOL = "tapcanvas.opening-prefix/v3" as const;

type JsonRecord = Record<string, unknown>;
type SourceInput = Readonly<{ sourceId: string; sourceFingerprint: string; content: string }>;
type SourceUnitRef = Readonly<{ unitId: string; endOffset?: number }>;

export type OpeningClipSourceRange = Readonly<{
	sourceIndex: number;
	sourceId: string;
	sourceFingerprint: string;
	startOffset: number;
	endOffset: number;
}>;

export type OpeningClipSourceSlice = OpeningClipSourceRange & Readonly<{ text: string }>;

export type OpeningClipProviderParameters = Readonly<{
	videoModel: string;
	resolution: string;
	aspectRatio: string;
	size?: string;
	durationSeconds: number;
}>;

export type AcceptedOpeningClip = Readonly<{
	protocolVersion: typeof ACCEPTED_OPENING_CLIP_PROTOCOL;
	clipId: string;
	clipIndex: 0;
	sourceId: string;
	sourceFingerprint: string;
	contentHash: string;
	clipPrompt: string;
	sourceRanges: readonly OpeningClipSourceRange[];
	sourceSlices: readonly OpeningClipSourceSlice[];
	provider: OpeningClipProviderParameters;
}>;

export type OpeningClipPromptItem = Readonly<{
	protocolVersion: typeof OPENING_CLIP_PROMPT_PROTOCOL;
	clipId: string;
	clipIndex: 0;
	sourceId: string;
	sourceFingerprint: string;
	contentHash: string;
	prompt: string;
	durationSeconds: number;
	modelKey: string;
	resolution: string;
	aspectRatio: string;
	size?: string;
	sourceRanges: readonly OpeningClipSourceRange[];
	sourceSlices: readonly OpeningClipSourceSlice[];
}>;

export type OpeningClipPrefix = Readonly<{
	protocolVersion: typeof OPENING_CLIP_PREFIX_PROTOCOL;
	acceptedOpeningClip: AcceptedOpeningClip;
	sourceUnitRefs: readonly SourceUnitRef[];
}>;

export type OpeningClipProjection = Readonly<{
	clipPromptCollection: WorkflowCollectionV1<OpeningClipPromptItem>;
	acceptedOpeningClip: AcceptedOpeningClip;
}>;

function isRecord(value: unknown): value is JsonRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readText(value: unknown, field: string): string {
	if (typeof value === "string" && value.trim()) return value;
	throw new Error(`${field} must be a non-empty string`);
}

function parseAgentJson(value: unknown): JsonRecord {
	const candidate = isRecord(value) && typeof value.text === "string" ? value.text : value;
	const parsed: unknown = typeof candidate === "string" ? JSON.parse(candidate) : candidate;
	if (!isRecord(parsed)) throw new Error("opening-clip must be one JSON object");
	return parsed;
}

function sourceRecords(deliveryContract: unknown): readonly SourceInput[] {
	if (!isRecord(deliveryContract) || !isRecord(deliveryContract.canvasFacts)
		|| !Array.isArray(deliveryContract.canvasFacts.authoritativeSources)) {
		throw new Error("opening-clip requires frozen delivery-contract.canvasFacts.authoritativeSources");
	}
	const rawSources = deliveryContract.canvasFacts.authoritativeSources;
	if (rawSources.length === 0 || !rawSources.every(isRecord)) {
		throw new Error("opening-clip requires non-empty frozen authoritative source records");
	}
	return rawSources.map((source, index) => {
		const sourceId = typeof source.sourceId === "string" && source.sourceId.trim()
			? source.sourceId.trim()
			: typeof source.nodeId === "string" ? source.nodeId.trim() : "";
		const content = typeof source.content === "string" ? source.content : "";
		const sourceFingerprint = typeof source.sourceFingerprint === "string" && source.sourceFingerprint.trim()
			? source.sourceFingerprint.trim()
			: sha256Hex(content);
		if (!sourceId || !content.trim() || sourceFingerprint !== sha256Hex(content)) {
			throw new Error(`authoritativeSources[${index}] requires a verified sourceId, fingerprint and content`);
		}
		return { sourceId, sourceFingerprint, content };
	});
}

function lineageFor(sources: readonly SourceInput[]): Readonly<{ sourceId: string; sourceFingerprint: string }> {
	return resolveWorkflowAuthoritativeSourceLineage(sources.map((source) => ({
		sourceId: source.sourceId,
		sourceFingerprint: source.sourceFingerprint,
		content: source.content,
	})));
}

function splitsSurrogatePair(text: string, offset: number): boolean {
	if (offset <= 0 || offset >= text.length) return false;
	const left = text.charCodeAt(offset - 1);
	const right = text.charCodeAt(offset);
	return left >= 0xd800 && left <= 0xdbff && right >= 0xdc00 && right <= 0xdfff;
}

function parseSourceRanges(value: unknown, sources: readonly SourceInput[]): OpeningClipSourceRange[] {
	if (!Array.isArray(value) || value.length === 0 || value.length > sources.length) {
		throw new Error("opening-clip.sourceRanges must be a non-empty ordered source prefix");
	}
	return value.map((rawRange, rangeIndex) => {
		if (!isRecord(rawRange)) throw new Error(`opening-clip.sourceRanges[${rangeIndex}] must be an object`);
		const sourceIndex = rawRange.sourceIndex;
		const startOffset = rawRange.startOffset;
		const endOffset = rawRange.endOffset;
		if (!Number.isSafeInteger(sourceIndex) || Number(sourceIndex) !== rangeIndex) {
			throw new Error("opening-clip.sourceRanges must follow frozen source order without gaps");
		}
		const source = sources[rangeIndex];
		if (!source) throw new Error(`opening-clip.sourceRanges[${rangeIndex}] references an unknown frozen source`);
		if (!Number.isSafeInteger(startOffset) || !Number.isSafeInteger(endOffset)
			|| Number(startOffset) !== 0 || Number(endOffset) <= 0 || Number(endOffset) > source.content.length) {
			throw new Error(`opening-clip.sourceRanges[${rangeIndex}] must be a positive in-bounds UTF-16 prefix range`);
		}
		if (splitsSurrogatePair(source.content, Number(endOffset))) {
			throw new Error(`opening-clip.sourceRanges[${rangeIndex}] must not split a UTF-16 surrogate pair`);
		}
		if (rangeIndex < value.length - 1 && Number(endOffset) !== source.content.length) {
			throw new Error("opening-clip.sourceRanges must cover each preceding source before advancing to the next source");
		}
		return {
			sourceIndex: rangeIndex,
			sourceId: source.sourceId,
			sourceFingerprint: source.sourceFingerprint,
			startOffset: 0,
			endOffset: Number(endOffset),
		};
	});
}

function sourceSlicesFromRanges(
	sources: readonly SourceInput[],
	ranges: readonly OpeningClipSourceRange[],
): readonly OpeningClipSourceSlice[] {
	return ranges.map((range) => {
		const source = sources[range.sourceIndex];
		if (!source) throw new Error(`opening-clip.sourceRanges references missing source ${range.sourceIndex}`);
		return { ...range, text: source.content.slice(range.startOffset, range.endOffset) };
	});
}

function canonicalJson(value: unknown, path = "$"): string {
	if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value) ?? "null";
	if (typeof value === "number") {
		if (!Number.isFinite(value)) throw new Error(`Opening Clip hash input contains a non-finite number at ${path}`);
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) return `[${value.map((item, index) => canonicalJson(item, `${path}[${index}]`)).join(",")}]`;
	if (!isRecord(value)) throw new Error(`Opening Clip hash input must contain JSON values only at ${path} (${typeof value})`);
	return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key], `${path}.${key}`)}`).join(",")}}`;
}

function sameJson(left: unknown, right: unknown): boolean {
	return canonicalJson(left) === canonicalJson(right);
}

function openingContentHash(input: Readonly<{
	clipId: string;
	sourceId: string;
	sourceFingerprint: string;
	clipPrompt: string;
	sourceRanges: readonly OpeningClipSourceRange[];
	sourceSlices: readonly OpeningClipSourceSlice[];
	provider: OpeningClipProviderParameters;
}>): string {
	return sha256Hex(canonicalJson(input));
}

function providerParameters(deliveryContract: unknown): OpeningClipProviderParameters {
	if (!isRecord(deliveryContract) || deliveryContract.executionScope !== "media_delivery"
		|| !isRecord(deliveryContract.generationContract)) {
		throw new Error("opening-clip requires a frozen media_delivery generation contract");
	}
	const durationPlan = parseWorkflowVideoDeliveryDurationPlan(deliveryContract);
	const generationContract = deliveryContract.generationContract;
	const topology = isRecord(generationContract.providerSubmissionTopology)
		&& Array.isArray(generationContract.providerSubmissionTopology.minimumClipDurations)
		? generationContract.providerSubmissionTopology.minimumClipDurations
		: null;
	const durationSeconds = topology?.[0] ?? (durationPlan.durationOptions.length === 1 ? durationPlan.durationOptions[0] : null);
	if (typeof durationSeconds !== "number" || !Number.isInteger(durationSeconds)
		|| !durationPlan.durationOptions.includes(durationSeconds) || durationSeconds > durationPlan.maxDurationSeconds) {
		throw new Error("Frozen delivery contract must identify one legal opening video duration");
	}
	return {
		videoModel: durationPlan.modelKey,
		resolution: readText(generationContract.resolution, "delivery-contract.generationContract.resolution").trim(),
		aspectRatio: readText(generationContract.aspectRatio, "delivery-contract.generationContract.aspectRatio").trim(),
		...(typeof generationContract.size === "string" && generationContract.size.trim()
			? { size: generationContract.size.trim() }
			: {}),
		durationSeconds,
	};
}

function acceptedClipReceipt(value: unknown): AcceptedOpeningClip {
	if (!isRecord(value) || value.protocolVersion !== ACCEPTED_OPENING_CLIP_PROTOCOL) {
		throw new Error("opening-prefix requires an accepted v3 opening-clip receipt");
	}
	const sourceId = readText(value.sourceId, "accepted-opening-clip.sourceId").trim();
	const sourceFingerprint = readText(value.sourceFingerprint, "accepted-opening-clip.sourceFingerprint").trim();
	const clipId = `${sourceFingerprint}:clip:0`;
	if (!Array.isArray(value.sourceRanges) || value.sourceRanges.length === 0
		|| !Array.isArray(value.sourceSlices) || value.sourceSlices.length !== value.sourceRanges.length) {
		throw new Error("accepted-opening-clip requires matching sourceRanges and sourceSlices");
	}
	const ranges = value.sourceRanges.map((rawRange, index): OpeningClipSourceRange => {
		if (!isRecord(rawRange) || rawRange.sourceIndex !== index || rawRange.startOffset !== 0
			|| !Number.isSafeInteger(rawRange.endOffset) || Number(rawRange.endOffset) <= 0
			|| typeof rawRange.sourceId !== "string" || !rawRange.sourceId.trim()
			|| typeof rawRange.sourceFingerprint !== "string" || !rawRange.sourceFingerprint.trim()) {
			throw new Error(`accepted-opening-clip.sourceRanges[${index}] is invalid`);
		}
		return {
			sourceIndex: index,
			sourceId: rawRange.sourceId,
			sourceFingerprint: rawRange.sourceFingerprint,
			startOffset: 0,
			endOffset: Number(rawRange.endOffset),
		};
	});
	const sourceSlices = value.sourceSlices.map((rawSlice, index): OpeningClipSourceSlice => {
		const range = ranges[index];
		if (!range || !isRecord(rawSlice) || typeof rawSlice.text !== "string") {
			throw new Error(`accepted-opening-clip.sourceSlices[${index}] does not match its UTF-16 range`);
		}
		const { text, ...sliceRange } = rawSlice;
		if (!sameJson(sliceRange, range) || text.length !== range.endOffset) {
			throw new Error(`accepted-opening-clip.sourceSlices[${index}] does not match its UTF-16 range`);
		}
		return { ...range, text };
	});
	if (ranges[0]?.sourceIndex !== 0 || ranges.some((range, index) => index < ranges.length - 1
		&& ranges[index + 1]?.sourceIndex !== range.sourceIndex + 1)) {
		throw new Error("accepted-opening-clip source ranges must form a contiguous source prefix");
	}
	const providerValue = value.provider;
	if (!isRecord(providerValue)) throw new Error("accepted-opening-clip.provider must be an object");
	const durationSeconds = providerValue.durationSeconds;
	if (typeof durationSeconds !== "number" || !Number.isInteger(durationSeconds) || durationSeconds <= 0) {
		throw new Error("accepted-opening-clip.provider.durationSeconds must be a positive integer");
	}
	const provider: OpeningClipProviderParameters = {
		videoModel: readText(providerValue.videoModel, "accepted-opening-clip.provider.videoModel").trim(),
		resolution: readText(providerValue.resolution, "accepted-opening-clip.provider.resolution").trim(),
		aspectRatio: readText(providerValue.aspectRatio, "accepted-opening-clip.provider.aspectRatio").trim(),
		...(typeof providerValue.size === "string" && providerValue.size.trim() ? { size: providerValue.size.trim() } : {}),
		durationSeconds,
	};
	const clipPrompt = readText(value.clipPrompt, "accepted-opening-clip.clipPrompt");
	const contentHash = openingContentHash({
		clipId,
		sourceId,
		sourceFingerprint,
		clipPrompt,
		sourceRanges: ranges,
		sourceSlices,
		provider,
	});
	if (value.clipId !== clipId || value.clipIndex !== 0 || value.contentHash !== contentHash
		|| !sameJson(value.sourceRanges, ranges) || !sameJson(value.sourceSlices, sourceSlices)
		|| !sameJson(value.provider, provider)) {
		throw new Error("accepted-opening-clip receipt content hash or stable identity is invalid");
	}
	return {
		protocolVersion: ACCEPTED_OPENING_CLIP_PROTOCOL,
		clipId,
		clipIndex: 0,
		sourceId,
		sourceFingerprint,
		contentHash,
		clipPrompt,
		sourceRanges: ranges,
		sourceSlices,
		provider,
	};
}

function acceptedClipFromValue(value: unknown, deliveryContract: unknown): AcceptedOpeningClip {
	const receipt = acceptedClipReceipt(value);
	const sources = sourceRecords(deliveryContract);
	const lineage = lineageFor(sources);
	const ranges = parseSourceRanges(receipt.sourceRanges, sources);
	const sourceSlices = sourceSlicesFromRanges(sources, ranges);
	const provider = providerParameters(deliveryContract);
	if (receipt.clipId !== `${lineage.sourceFingerprint}:clip:0`
		|| receipt.sourceId !== lineage.sourceId || receipt.sourceFingerprint !== lineage.sourceFingerprint
		|| !sameJson(receipt.sourceRanges, ranges) || !sameJson(receipt.sourceSlices, sourceSlices)
		|| !sameJson(receipt.provider, provider)) {
		throw new Error("accepted-opening-clip receipt does not match frozen source, range or provider facts");
	}
	return receipt;
}

/** Bind the minimal authoring contract to the exact frozen source set. */
export function bindOpeningClipAuthoringContract(
	contract: WorkflowAgentJsonObjectContract,
	deliveryContract: unknown,
): WorkflowAgentJsonObjectContract {
	const sources = sourceRecords(deliveryContract);
	const sourceRangeSchema = {
		type: "object",
		properties: {
			sourceIndex: { type: "integer", minimum: 0, maximum: sources.length - 1 },
			startOffset: { type: "integer", minimum: 0 },
			endOffset: { type: "integer", minimum: 1 },
		},
		required: ["sourceIndex", "startOffset", "endOffset"],
		additionalProperties: false,
	};
	return {
		...contract,
		contractName: "tapcanvas.opening-clip-artifact",
		contractVersion: "3",
		requiredStringFields: ["protocolVersion", "clipPrompt"],
		exactStringFields: { ...contract.exactStringFields, protocolVersion: OPENING_CLIP_ARTIFACT_TYPE },
		requiredArrayFields: ["sourceRanges"],
		arrayItemAllowedFields: { ...contract.arrayItemAllowedFields, sourceRanges: ["sourceIndex", "startOffset", "endOffset"] },
		allowedFields: ["protocolVersion", "sourceRanges", "clipPrompt"],
		jsonSchema: {
			type: "object",
			properties: {
				protocolVersion: { type: "string", const: OPENING_CLIP_ARTIFACT_TYPE },
				sourceRanges: { type: "array", minItems: 1, maxItems: sources.length, items: sourceRangeSchema },
				clipPrompt: { type: "string", minLength: 1 },
			},
			required: ["protocolVersion", "sourceRanges", "clipPrompt"],
			additionalProperties: false,
		},
	};
}

/** Validate the author output and create a provider-ready prompt item plus an immutable receipt. */
export function projectOpeningClip(input: Readonly<{
	executionId: string;
	nodeId: string;
	openingClip: unknown;
	deliveryContract: unknown;
}>): OpeningClipProjection {
	const parsed = parseAgentJson(input.openingClip);
	const allowedAuthorFields = new Set(["protocolVersion", "sourceRanges", "clipPrompt"]);
	const unsupportedAuthorField = Object.keys(parsed).find((field) => !allowedAuthorFields.has(field));
	if (unsupportedAuthorField) {
		throw new Error(`opening-clip.${unsupportedAuthorField} is not an accepted author field`);
	}
	if (parsed.protocolVersion !== OPENING_CLIP_ARTIFACT_TYPE) {
		throw new Error(`opening-clip.protocolVersion must equal ${OPENING_CLIP_ARTIFACT_TYPE}`);
	}
	const sources = sourceRecords(input.deliveryContract);
	const lineage = lineageFor(sources);
	const clipId = `${lineage.sourceFingerprint}:clip:0`;
	const sourceRanges = parseSourceRanges(parsed.sourceRanges, sources);
	const sourceSlices = sourceSlicesFromRanges(sources, sourceRanges);
	const clipPrompt = readText(parsed.clipPrompt, "opening-clip.clipPrompt");
	const provider = providerParameters(input.deliveryContract);
	const contentHash = openingContentHash({
		clipId,
		sourceId: lineage.sourceId,
		sourceFingerprint: lineage.sourceFingerprint,
		clipPrompt,
		sourceRanges,
		sourceSlices,
		provider,
	});
	const acceptedOpeningClip: AcceptedOpeningClip = {
		protocolVersion: ACCEPTED_OPENING_CLIP_PROTOCOL,
		clipId,
		clipIndex: 0,
		sourceId: lineage.sourceId,
		sourceFingerprint: lineage.sourceFingerprint,
		contentHash,
		clipPrompt,
		sourceRanges,
		sourceSlices,
		provider,
	};
	const promptItem: OpeningClipPromptItem = {
		protocolVersion: OPENING_CLIP_PROMPT_PROTOCOL,
		clipId,
		clipIndex: 0,
		sourceId: lineage.sourceId,
		sourceFingerprint: lineage.sourceFingerprint,
		contentHash,
		prompt: clipPrompt,
		durationSeconds: provider.durationSeconds,
		modelKey: provider.videoModel,
		resolution: provider.resolution,
		aspectRatio: provider.aspectRatio,
		...(provider.size ? { size: provider.size } : {}),
		sourceRanges,
		sourceSlices,
	};
	const clipPromptCollection = createWorkflowCollection({
		collectionId: `${input.executionId}:${input.nodeId}:opening-clip-prompts`,
		producerNodeId: input.nodeId,
		producerPortId: "clip-prompts",
		values: [promptItem],
		itemIds: [clipId],
	});
	return { clipPromptCollection, acceptedOpeningClip };
}

/** Recheck host-bound prompt identity, source slices and provider parameters at submission time. */
export function verifyOpeningClipPromptSubmission(input: Readonly<{
	promptItem: unknown;
	deliveryContract: unknown;
}>): Readonly<{ acceptedOpeningClip: AcceptedOpeningClip; promptItem: OpeningClipPromptItem }> {
	const item = input.promptItem;
	if (!isRecord(item) || item.protocolVersion !== OPENING_CLIP_PROMPT_PROTOCOL) {
		throw new Error("Opening Clip fast submit requires a host-projected opening-clip-prompt/v3 item");
	}
	if (item.clipIndex !== 0) {
		throw new Error("Opening Clip fast submit requires stable clipIndex 0");
	}
	const accepted = acceptedClipFromValue({
		protocolVersion: ACCEPTED_OPENING_CLIP_PROTOCOL,
		clipId: item.clipId,
		clipIndex: item.clipIndex,
		sourceId: item.sourceId,
		sourceFingerprint: item.sourceFingerprint,
		contentHash: item.contentHash,
		clipPrompt: item.prompt,
		sourceRanges: item.sourceRanges,
		sourceSlices: item.sourceSlices,
		provider: {
			videoModel: item.modelKey,
			resolution: item.resolution,
			aspectRatio: item.aspectRatio,
			...(typeof item.size === "string" ? { size: item.size } : {}),
			durationSeconds: item.durationSeconds,
		},
	}, input.deliveryContract);
	const promptItem: OpeningClipPromptItem = {
		protocolVersion: OPENING_CLIP_PROMPT_PROTOCOL,
		clipId: accepted.clipId,
		clipIndex: 0,
		sourceId: accepted.sourceId,
		sourceFingerprint: accepted.sourceFingerprint,
		contentHash: accepted.contentHash,
		prompt: accepted.clipPrompt,
		durationSeconds: accepted.provider.durationSeconds,
		modelKey: accepted.provider.videoModel,
		resolution: accepted.provider.resolution,
		aspectRatio: accepted.provider.aspectRatio,
		...(accepted.provider.size ? { size: accepted.provider.size } : {}),
		sourceRanges: accepted.sourceRanges,
		sourceSlices: accepted.sourceSlices,
	};
	return { acceptedOpeningClip: accepted, promptItem };
}

function sourceLineSpans(sourceIndex: number, content: string): readonly Readonly<{
	sourceLineId: string;
	startOffset: number;
	endOffset: number;
	text: string;
}>[] {
	const spans: { sourceLineId: string; startOffset: number; endOffset: number; text: string }[] = [];
	let cursor = 0;
	let lineIndex = 0;
	while (cursor < content.length) {
		let lineEnd = cursor;
		while (lineEnd < content.length && content[lineEnd] !== "\n" && content[lineEnd] !== "\r") lineEnd += 1;
		const rawLine = content.slice(cursor, lineEnd);
		const text = rawLine.trim();
		if (text) {
			const leadingWhitespace = rawLine.length - rawLine.trimStart().length;
			const startOffset = cursor + leadingWhitespace;
			spans.push({ sourceLineId: `source-${sourceIndex}:source-line-${String(lineIndex + 1)}`,
				startOffset, endOffset: startOffset + text.length, text });
		}
		if (content[lineEnd] === "\r" && content[lineEnd + 1] === "\n") cursor = lineEnd + 2;
		else if (lineEnd < content.length) cursor = lineEnd + 1;
		else cursor = lineEnd;
		lineIndex += 1;
	}
	return spans;
}

function sourceRangePrefixUnitRefs(
	sources: readonly SourceInput[],
	ranges: readonly OpeningClipSourceRange[],
	ledgerValue: unknown,
): readonly SourceUnitRef[] {
	const ledger = parseSourceUnitLedger(ledgerValue);
	const lineage = lineageFor(sources);
	if (ledger.sourceId !== lineage.sourceId || ledger.sourceFingerprint !== lineage.sourceFingerprint) {
		throw new Error("opening-prefix source ledger identity must equal the frozen opening source set");
	}
	const unitsByLine = new Map<string, typeof ledger.units[number][]>();
	for (const unit of ledger.units) {
		const list = unitsByLine.get(unit.sourceLineId) ?? [];
		list.push(unit);
		unitsByLine.set(unit.sourceLineId, list);
	}
	const refs: { unitId: string; endOffset?: number }[] = [];
	let stopped = false;
	for (const range of ranges) {
		const source = sources[range.sourceIndex];
		if (!source) throw new Error("opening-prefix source range references an unknown frozen source");
		for (const span of sourceLineSpans(range.sourceIndex, source.content)) {
			const includedEnd = Math.min(span.endOffset, range.endOffset);
			if (includedEnd <= span.startOffset) continue;
			const lineUnits = unitsByLine.get(span.sourceLineId) ?? [];
			if (lineUnits.length === 0 || lineUnits.map((unit) => unit.text).join("") !== span.text) {
				throw new Error(`opening-prefix source ledger does not reconstruct frozen source line ${span.sourceLineId}`);
			}
			const lineIncludedEnd = includedEnd - span.startOffset;
			let lineCursor = 0;
			for (const unit of lineUnits) {
				if (lineCursor >= lineIncludedEnd) break;
				const endOffset = Math.min(unit.text.length, lineIncludedEnd - lineCursor);
				refs.push(endOffset === unit.text.length ? { unitId: unit.unitId } : { unitId: unit.unitId, endOffset });
				lineCursor += unit.text.length;
			}
			if (lineIncludedEnd < span.text.length) stopped = true;
		}
		if (stopped || range.endOffset < source.content.length) break;
	}
	if (refs.length === 0) throw new Error("opening-prefix sourceRanges must include at least one canonical source-unit range");
	return refs;
}

function sourceSlicePrefixUnitRefs(
	acceptedOpeningClip: AcceptedOpeningClip,
	ledgerValue: unknown,
): readonly SourceUnitRef[] {
	const ledger = parseSourceUnitLedger(ledgerValue);
	if (ledger.sourceId !== acceptedOpeningClip.sourceId || ledger.sourceFingerprint !== acceptedOpeningClip.sourceFingerprint) {
		throw new Error("opening-prefix source ledger identity must equal the accepted opening source set");
	}
	const unitsByLine = new Map<string, typeof ledger.units[number][]>();
	for (const unit of ledger.units) {
		const list = unitsByLine.get(unit.sourceLineId) ?? [];
		list.push(unit);
		unitsByLine.set(unit.sourceLineId, list);
	}
	const refs: { unitId: string; endOffset?: number }[] = [];
	for (const sourceSlice of acceptedOpeningClip.sourceSlices) {
		for (const span of sourceLineSpans(sourceSlice.sourceIndex, sourceSlice.text)) {
			const lineUnits = unitsByLine.get(span.sourceLineId) ?? [];
			const lineText = lineUnits.map((unit) => unit.text).join("");
			if (lineUnits.length === 0 || !lineText.startsWith(span.text)) {
				throw new Error(`opening-prefix source ledger does not reconstruct accepted source range at ${span.sourceLineId}`);
			}
			let lineCursor = 0;
			for (const unit of lineUnits) {
				if (lineCursor >= span.text.length) break;
				const endOffset = Math.min(unit.text.length, span.text.length - lineCursor);
				refs.push(endOffset === unit.text.length ? { unitId: unit.unitId } : { unitId: unit.unitId, endOffset });
				lineCursor += unit.text.length;
			}
		}
	}
	if (refs.length === 0) throw new Error("opening-prefix sourceRanges must include at least one canonical source-unit range");
	return refs;
}

/** Bind raw frozen-source UTF-16 ranges to the later-arriving canonical ledger. */
export function bindOpeningClipPrefixToSourceLedger(input: Readonly<{
	acceptedOpeningClip: unknown;
	deliveryContract: unknown;
	sourceLedger: unknown;
}>): OpeningClipPrefix {
	const acceptedOpeningClip = acceptedClipFromValue(input.acceptedOpeningClip, input.deliveryContract);
	const sourceUnitRefs = sourceRangePrefixUnitRefs(
		sourceRecords(input.deliveryContract),
		acceptedOpeningClip.sourceRanges,
		input.sourceLedger,
	);
	return { protocolVersion: OPENING_CLIP_PREFIX_PROTOCOL, acceptedOpeningClip, sourceUnitRefs };
}

function normalizedSourceUnitRefs(value: readonly unknown[], unitLengths: ReadonlyMap<string, number>): string {
	return canonicalJson(value.map((rawRef) => {
		if (!isRecord(rawRef) || typeof rawRef.unitId !== "string") return rawRef;
		const endOffset = rawRef.endOffset === undefined ? unitLengths.get(rawRef.unitId) : rawRef.endOffset;
		return { unitId: rawRef.unitId, endOffset };
	}));
}

/** Compare the model-authored first allocation without synthesizing or replacing its semantic beat. */
export function spliceOpeningClipPlanPrefix(input: Readonly<{
	openingPrefix: unknown;
	chapterPlan: unknown;
	sourceLedger: unknown;
}>): Readonly<{ chapterPlan: JsonRecord; conflict: string | null }> {
	if (!isRecord(input.openingPrefix) || input.openingPrefix.protocolVersion !== OPENING_CLIP_PREFIX_PROTOCOL
		|| !isRecord(input.chapterPlan) || !Array.isArray(input.chapterPlan.beats) || input.chapterPlan.beats.length === 0) {
		return { chapterPlan: {}, conflict: "Opening Clip prefix splice requires a bound prefix and a non-empty full chapter plan" };
	}
	const firstPlanBeat = input.chapterPlan.beats[0];
	if (!isRecord(firstPlanBeat) || !Array.isArray(firstPlanBeat.sourceUnitRefs)
		|| !Array.isArray(input.openingPrefix.sourceUnitRefs)) {
		return { chapterPlan: {}, conflict: "Opening Clip prefix splice requires sourceUnitRefs on the full plan and opening prefix" };
	}
	let accepted: AcceptedOpeningClip;
	try {
		accepted = acceptedClipReceipt(input.openingPrefix.acceptedOpeningClip);
	} catch (error: unknown) {
		return { chapterPlan: {}, conflict: error instanceof Error ? error.message : String(error) };
	}
	if (input.chapterPlan.sourceId !== accepted.sourceId || input.chapterPlan.sourceFingerprint !== accepted.sourceFingerprint) {
		return { chapterPlan: {}, conflict: "Full chapter plan source identity does not match the accepted opening source" };
	}
	const ledger = parseSourceUnitLedger(input.sourceLedger);
	const unitLengths = new Map(ledger.units.map((unit) => [unit.unitId, unit.text.length]));
	const canonicalRefs = sourceSlicePrefixUnitRefs(accepted, input.sourceLedger);
	if (normalizedSourceUnitRefs(firstPlanBeat.sourceUnitRefs, unitLengths)
		!== normalizedSourceUnitRefs(input.openingPrefix.sourceUnitRefs, unitLengths)
		|| normalizedSourceUnitRefs(input.openingPrefix.sourceUnitRefs, unitLengths)
		!== normalizedSourceUnitRefs(canonicalRefs, unitLengths)) {
		return { chapterPlan: {}, conflict: "Full chapter first-beat sourceUnitRefs do not equal the frozen opening UTF-16 prefix allocation" };
	}
	return { chapterPlan: input.chapterPlan, conflict: null };
}

/** Preserve an already generated opening video while binding it to the full authored Clip 0. */
export function mergeOpeningClipPrefix(input: Readonly<{
	openingPrefix: unknown;
	fullBeatSheet: unknown;
	sourceLedger: unknown;
}>): Readonly<{ conflict: Readonly<{ code: string; message: string }> | null; firstBeatHash: string | null }> {
	if (!isRecord(input.openingPrefix) || !isRecord(input.fullBeatSheet)) {
		return { conflict: { code: "opening_clip_prefix_shape_mismatch", message: "Prefix merge requires opening prefix and full BeatSheet objects" }, firstBeatHash: null };
	}
	let accepted: AcceptedOpeningClip;
	try {
		accepted = acceptedClipReceipt(input.openingPrefix.acceptedOpeningClip);
	} catch (error: unknown) {
		return { conflict: { code: "opening_clip_prefix_shape_mismatch", message: error instanceof Error ? error.message : String(error) }, firstBeatHash: null };
	}
	const beats = Array.isArray(input.fullBeatSheet.beats) ? input.fullBeatSheet.beats : [];
	const firstBeat = beats[0];
	if (!isRecord(firstBeat)) {
		return { conflict: { code: "opening_clip_prefix_missing", message: "Full BeatSheet does not contain its first Beat" }, firstBeatHash: null };
	}
	if (input.fullBeatSheet.sourceId !== accepted.sourceId || input.fullBeatSheet.sourceFingerprint !== accepted.sourceFingerprint
		|| firstBeat.clipId !== accepted.clipId || firstBeat.clipIndex !== 0) {
		return { conflict: { code: "opening_clip_prefix_identity_conflict", message: "Full BeatSheet Clip 0 identity does not match the accepted opening Clip" }, firstBeatHash: null };
	}
	if (!Array.isArray(firstBeat.sourceUnitRefs) || !Array.isArray(input.openingPrefix.sourceUnitRefs)) {
		return { conflict: { code: "opening_clip_prefix_source_allocation_missing", message: "Full BeatSheet Clip 0 must preserve the accepted source range allocation" }, firstBeatHash: null };
	}
	const ledger = parseSourceUnitLedger(input.sourceLedger);
	const unitLengths = new Map(ledger.units.map((unit) => [unit.unitId, unit.text.length]));
	const firstBeatHash = sha256Hex(canonicalJson(firstBeat));
	if (normalizedSourceUnitRefs(firstBeat.sourceUnitRefs, unitLengths)
		!== normalizedSourceUnitRefs(input.openingPrefix.sourceUnitRefs, unitLengths)
		|| normalizedSourceUnitRefs(input.openingPrefix.sourceUnitRefs, unitLengths)
		!== normalizedSourceUnitRefs(sourceSlicePrefixUnitRefs(accepted, input.sourceLedger), unitLengths)) {
		return {
			conflict: {
				code: "opening_clip_prefix_source_allocation_conflict",
				message: "Full BeatSheet Clip 0 changed the accepted opening source range allocation; both immutable artifacts were retained",
			},
			firstBeatHash,
		};
	}
	return { conflict: null, firstBeatHash };
}
