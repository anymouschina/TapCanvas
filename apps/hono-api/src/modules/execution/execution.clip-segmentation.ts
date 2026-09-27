import { createWorkflowCollection, type WorkflowCollectionV1 } from "@tapcanvas/workflow-kernel-protocol";
import {
	CHAPTER_CLIP_SEGMENTATION_ARTIFACT_TYPE,
	CLIP_SOURCE_SEGMENT_PROTOCOL_VERSION,
	chapterClipSegmentationSchema,
	inspectClipSegmentationCoverage,
	type AuthoredChapterClipSegmentation,
	type ClipSegmentationRange,
} from "../../../../../packages/schemas/video-clip-segmentation/index.mjs";
import { freezeWorkflowAuthoritativeSource, resolveWorkflowAuthoritativeSourceLineage } from "./execution.source-lineage";
import type { WorkflowAgentJsonObjectContract } from "./execution.agent-output-contract";
import { validateWorkflowToolArguments } from "./execution.json-schema-validator";
import { parseWorkflowVideoDeliveryDurationPlan } from "./execution.video-workflow-contract";
import { buildWorkflowSourceCoordinates } from "./execution.source-coordinates";

type JsonRecord = Record<string, unknown>;
type FrozenSource = Readonly<{ sourceId: string; sourceFingerprint: string; content: string }>;

export type ClipSegmentationSourceRange = ClipSegmentationRange & Readonly<{
	sourceId: string;
	sourceFingerprint: string;
}>;

export type ClipSegmentationSourceSlice = ClipSegmentationSourceRange & Readonly<{ text: string }>;

export type ClipSourceSegment = Readonly<{
	protocolVersion: typeof CLIP_SOURCE_SEGMENT_PROTOCOL_VERSION;
	clipId: string;
	clipIndex: number;
	sourceId: string;
	sourceFingerprint: string;
	durationSeconds: number;
	sourceRanges: readonly ClipSegmentationSourceRange[];
	sourceSlices: readonly ClipSegmentationSourceSlice[];
}>;

export type ClipSegmentationProjection = Readonly<{
	clipCollection: WorkflowCollectionV1<ClipSourceSegment>;
	sourceReceipt: Readonly<{
		protocolVersion: typeof CLIP_SOURCE_SEGMENT_PROTOCOL_VERSION;
		sourceId: string;
		sourceFingerprint: string;
		clipIds: readonly string[];
		totalDurationSeconds: number;
	}>;
}>;

function isRecord(value: unknown): value is JsonRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmpty(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function frozenSources(deliveryContract: unknown): readonly FrozenSource[] {
	if (!isRecord(deliveryContract) || !isRecord(deliveryContract.canvasFacts)
		|| !Array.isArray(deliveryContract.canvasFacts.authoritativeSources)) {
		throw new Error("Clip segmentation requires frozen delivery-contract.canvasFacts.authoritativeSources");
	}
	const rawSources = deliveryContract.canvasFacts.authoritativeSources;
	if (rawSources.length === 0 || !rawSources.every(isRecord)) {
		throw new Error("Clip segmentation requires non-empty frozen authoritative source records");
	}
	const sources = rawSources.map((raw, index) => {
		const source = freezeWorkflowAuthoritativeSource(raw);
		const sourceId = nonEmpty(source.sourceId);
		const sourceFingerprint = nonEmpty(source.sourceFingerprint);
		const content = typeof source.content === "string" ? source.content : "";
		if (!sourceId || !sourceFingerprint || !content.trim()) {
			throw new Error(`authoritativeSources[${index}] requires canonical sourceId, sourceFingerprint and content`);
		}
		return { sourceId, sourceFingerprint, content };
	});
	// The same canonical lineage helper used by the current BeatSheet/source
	// evidence contract verifies each frozen fingerprint and source-set identity.
	resolveWorkflowAuthoritativeSourceLineage(sources);
	return sources;
}

function readSegmentation(value: unknown): AuthoredChapterClipSegmentation {
	const candidate = isRecord(value) && typeof value.text === "string" ? value.text : value;
	const parsed: unknown = typeof candidate === "string" ? JSON.parse(candidate) : candidate;
	if (!isRecord(parsed)) throw new Error("chapter-clip-segmentation must be one JSON object");
	return parsed as AuthoredChapterClipSegmentation;
}

function providerDurationFacts(deliveryContract: unknown) {
	const durationPlan = parseWorkflowVideoDeliveryDurationPlan(deliveryContract);
	const generationContract = isRecord(deliveryContract) && isRecord(deliveryContract.generationContract)
		? deliveryContract.generationContract
		: null;
	const topology = durationPlan.providerSubmissionTopology;
	return { durationPlan, topology, generationContract };
}

/** Bind the minimal range-only author output to frozen source bounds and provider durations. */
export function bindClipSegmentationAuthoringContract(
	contract: WorkflowAgentJsonObjectContract,
	deliveryContract: unknown,
): WorkflowAgentJsonObjectContract {
	const sources = frozenSources(deliveryContract);
	const { durationPlan, topology } = providerDurationFacts(deliveryContract);
	const maximumSourceLength = Math.max(...sources.map((source) => source.content.length));
	const schema = structuredClone(chapterClipSegmentationSchema) as JsonRecord;
	const coordinateDirectory = sources.map((source, sourceIndex) => {
		const coordinates = buildWorkflowSourceCoordinates(source.content);
		return {
			sourceIndex,
			sourceId: source.sourceId,
			startOffset: coordinates.startOffset,
			endOffset: coordinates.endOffset,
			utf16Length: coordinates.utf16Length,
			forbiddenSurrogateOffsets: coordinates.forbiddenSurrogateOffsets,
		};
	});
	schema.description = [
		"来源坐标采用原始 content 的 UTF-16 左闭右开区间，包含标题、空白及原始换行；不得按字数估计、去换行或重算文本。",
		"冻结输入 authoritativeSources[].sourceCoordinates.lines 按原文行序列出 [startOffset,endOffset]，列名见 lineColumns；以下目录绑定每个 sourceIndex 的精确末端。行只是排版坐标，不是要求按行分 Clip，分段由作者依据完整原文决定。",
		"sourceProfile.sourceChars/sourceSpeechChars 等是时长估计统计，绝不是原文坐标。每个来源必须按顺序完整消费到此处声明的 endOffset；下一段从上一段 endOffset 继续，不能停在末端之前或切开 forbiddenSurrogateOffsets。",
		JSON.stringify({ coordinateSystem: "utf16", interval: "start_inclusive_end_exclusive", sources: coordinateDirectory }),
	].join("\n");
	const schemaProperties = schema.properties as JsonRecord;
	const clips = schemaProperties.clips as JsonRecord;
	const clipItems = clips.items as JsonRecord;
	const clipProperties = clipItems.properties as JsonRecord;
	clipProperties.durationSeconds = { type: "integer", enum: [...durationPlan.durationOptions] };
	const sourceRanges = clipProperties.sourceRanges as JsonRecord;
	const sourceRangeItems = sourceRanges.items as JsonRecord;
	const sourceRangeProperties = sourceRangeItems.properties as JsonRecord;
	sourceRangeProperties.sourceIndex = { type: "integer", enum: sources.map((_source, index) => index) };
	sourceRangeProperties.startOffset = { type: "integer", minimum: 0, maximum: maximumSourceLength, description: "原始来源 UTF-16 起点；首段为 0，后段精确沿用上段终点。参照根 schema 的逐来源坐标目录。" };
	sourceRangeProperties.endOffset = { type: "integer", minimum: 1, maximum: maximumSourceLength, description: "原始来源 UTF-16 终点（不包含）；完成该来源的最后一个范围必须等于根 schema 所列该 sourceIndex 的精确 endOffset。" };
	sourceRanges.maxItems = sources.length;

	const expectedArrayLengths = { ...contract.expectedArrayLengths };
	if (topology && (topology.source === "user_clip_count" || topology.source === "user_clip_durations")) {
		expectedArrayLengths.clips = topology.expectedClipCount;
	}
	const arrayItemExactNumberFields = { ...contract.arrayItemExactNumberFields };
	if (topology?.source === "user_clip_durations") {
		arrayItemExactNumberFields.clips = topology.minimumClipDurations.map((durationSeconds) => ({ durationSeconds }));
	}
	return {
		...contract,
		jsonSchema: schema,
		contractName: "tapcanvas.chapter-clip-segmentation",
		contractVersion: "1",
		requiredStringFields: ["protocolVersion"],
		exactStringFields: {
			...contract.exactStringFields,
			protocolVersion: CHAPTER_CLIP_SEGMENTATION_ARTIFACT_TYPE,
		},
		requiredArrayFields: ["clips"],
		expectedArrayLengths,
		arrayItemAllowedFields: { ...contract.arrayItemAllowedFields, clips: ["durationSeconds", "sourceRanges"] },
		arrayItemNumberAllowedValues: {
			...contract.arrayItemNumberAllowedValues,
			clips: { durationSeconds: [...durationPlan.durationOptions] },
		},
		arrayItemExactNumberFields,
		allowedFields: ["protocolVersion", "clips"],
	};
}

function parseValidatedSegmentation(
	value: unknown,
	deliveryContract: unknown,
): Readonly<{ segmentation: AuthoredChapterClipSegmentation; sources: readonly FrozenSource[]; sourceId: string; sourceFingerprint: string }> {
	const segmentation = readSegmentation(value);
	const contract = bindClipSegmentationAuthoringContract({ allowedFields: [] }, deliveryContract);
	const issues = validateWorkflowToolArguments(contract.jsonSchema ?? {}, segmentation);
	if (issues.length > 0) {
		throw new Error(`chapter-clip-segmentation: ${issues.map((issue) => issue.message).join(" | ")}`);
	}
	const sources = frozenSources(deliveryContract);
	const coverageIssue = inspectClipSegmentationCoverage(segmentation.clips, sources.map((source) => source.content));
	if (coverageIssue) throw new Error(`chapter-clip-segmentation source coverage: ${coverageIssue}`);
	const lineage = resolveWorkflowAuthoritativeSourceLineage(sources);
	const { durationPlan, topology } = providerDurationFacts(deliveryContract);
	const durations = segmentation.clips.map((clip, index) => {
		if (!durationPlan.durationOptions.includes(clip.durationSeconds)) {
			throw new Error(`clips[${index}].durationSeconds must use one frozen provider duration ${JSON.stringify(durationPlan.durationOptions)}`);
		}
		return clip.durationSeconds;
	});
	if (topology && (topology.source === "user_clip_count" || topology.source === "user_clip_durations")
		&& durations.length !== topology.expectedClipCount) {
		throw new Error(`Clip segmentation must preserve the frozen provider clip count: expected=${topology.expectedClipCount}:actual=${durations.length}`);
	}
	if (topology?.source === "user_clip_durations"
		&& durations.some((duration, index) => duration !== topology.minimumClipDurations[index])) {
		throw new Error(`Clip segmentation must preserve frozen requested clip durations: expected=${JSON.stringify(topology.minimumClipDurations)}:actual=${JSON.stringify(durations)}`);
	}
	const totalDurationSeconds = durations.reduce((total, duration) => total + duration, 0);
	if (durationPlan.targetDurationSeconds !== null && totalDurationSeconds !== durationPlan.targetDurationSeconds) {
		throw new Error(`Complete clip segmentation duration must equal the frozen target: expected=${durationPlan.targetDurationSeconds}:actual=${totalDurationSeconds}`);
	}
	return { segmentation, sources, ...lineage };
}

/** Reconstruct each Clip's exact source text; no semantic parsing or rewriting occurs here. */
export function projectClipSegmentation(input: Readonly<{
	executionId: string;
	nodeId: string;
	segmentation: unknown;
	deliveryContract: unknown;
}>): ClipSegmentationProjection {
	const projected = parseValidatedSegmentation(input.segmentation, input.deliveryContract);
	const clips = projected.segmentation.clips.map((clip, clipIndex): ClipSourceSegment => {
		const clipId = `${projected.sourceFingerprint}:clip:${clipIndex}`;
		const sourceRanges = clip.sourceRanges.map((range): ClipSegmentationSourceRange => {
			const source = projected.sources[range.sourceIndex];
			if (!source) throw new Error(`clips[${clipIndex}] references missing frozen source ${range.sourceIndex}`);
			return { ...range, sourceId: source.sourceId, sourceFingerprint: source.sourceFingerprint };
		});
		const sourceSlices = sourceRanges.map((range): ClipSegmentationSourceSlice => {
			const source = projected.sources[range.sourceIndex];
			if (!source) throw new Error(`clips[${clipIndex}] references missing frozen source ${range.sourceIndex}`);
			return { ...range, text: source.content.slice(range.startOffset, range.endOffset) };
		});
		return {
			protocolVersion: CLIP_SOURCE_SEGMENT_PROTOCOL_VERSION,
			clipId,
			clipIndex,
			sourceId: projected.sourceId,
			sourceFingerprint: projected.sourceFingerprint,
			durationSeconds: clip.durationSeconds,
			sourceRanges,
			sourceSlices,
		};
	});
	const clipIds = clips.map((clip) => clip.clipId);
	const totalDurationSeconds = clips.reduce((total, clip) => total + clip.durationSeconds, 0);
	return {
		clipCollection: createWorkflowCollection({
			collectionId: `${input.executionId}:${input.nodeId}:clip-segments`,
			producerNodeId: input.nodeId,
			producerPortId: "clip-segments",
			values: clips,
			itemIds: clipIds,
		}),
		sourceReceipt: {
			protocolVersion: CLIP_SOURCE_SEGMENT_PROTOCOL_VERSION,
			sourceId: projected.sourceId,
			sourceFingerprint: projected.sourceFingerprint,
			clipIds,
			totalDurationSeconds,
		},
	};
}
