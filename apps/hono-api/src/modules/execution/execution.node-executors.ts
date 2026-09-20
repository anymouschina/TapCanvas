import { IMAGE_REFERENCE_ROLES, validateAssetRecord } from "../../../../../packages/schemas/workflow-asset-registry/index.mjs";
import { bindRegisteredAssetReferenceSchema } from "./execution.asset-reference-schema";
import { materializedAssetUses, prepareChapterAssetCollection, bindMaterializedAssetConsumers } from "./execution.chapter-asset-preparation";
import { bindClipDesignSchema } from "../../../../../packages/schemas/video-authoring-stages/schema.mjs";
import { validateClipDesignReferences, assembleDesignedBeatSheet, buildClipDesignInputs, parseChapterBeatPlan, parseChapterAssetPlan, parseClipDesign } from "./execution.video-authoring-stages";
import { mediaDeliveryCoverage, MediaDeliveryCoverageSchema, verifyMediaDeliveryCoverage } from "./execution.media-delivery-coverage";
import { workflowActionFailure } from "./execution.action-failure";
import { blockingBackgroundPlanCollection, blockingBackgroundCollection } from "./execution.blocking-backgrounds";
import { readMediaDeliveryPolicy, type MediaDeliveryPolicy } from "./execution.media-delivery-policy";
import { projectSceneReferenceMetadata } from "../../../../../packages/schemas/scene-reference-contract/index.mjs";
import { ExternalDependencyError } from "../../platform/external-dependency-error";
import { readWithImmediateDependencyRepair, waitForReadOnlyDependency } from "./execution.dependency-wait";
import { executeWithImmediateOutputRepair } from "./execution.immediate-output-repair";
import { projectWorkflowAssetReference } from "./execution.asset-reference-projection";
import { workflowMediaRetryForItem, type AuthorizedWorkflowMediaRetry } from "./execution.media-retry";
import { workflowMediaAdoptionAssetId } from "./execution.media-adoption";
import { workflowProjectImageCandidateInstruction } from "./execution.project-image-candidates";
import { resolveWorkflowProjectImageReferences, type WorkflowReusableAssetReference, type WorkflowReusableAssetRoleFacts } from "./execution.project-image-references";
import { readWorkflowAgentOutputRepair } from "./execution.agent-output-repair";
import { workflowAgentSessionKey } from "./execution.agent-identity";
import { readWorkflowUserIntent, WORKFLOW_USER_INTENT_FIELD } from "./execution.workflow-user-intent";
import { workflowAgentMediaEvidenceTools } from "./execution.agent-evidence-tools";
import {
	createWorkflowCollection,
	isWorkflowCollection,
	WORKFLOW_AGENT_MAX_OUTPUT_TOKENS_MAX,
	WORKFLOW_AGENT_MAX_OUTPUT_TOKENS_MIN,
	parseWorkflowKnowledgeCandidateSetV2,
	hasWorkflowPluginExecutorRefPrefix,
	type WorkflowInputBindingProvenanceV1,
	type WorkflowKnowledgeCandidateSetV2,
	type WorkflowKnowledgeCardV1,
} from "@tapcanvas/workflow-kernel-protocol";
import type { WorkflowItemLineageV1 } from "@tapcanvas/workflow-kernel-protocol";
import type {
	WorkflowNodeExecutionResult,
	WorkflowNodeOutputV1,
	WorkflowNodeSnapshot,
} from "./execution.node-runtime";
import { executeWorkflowNodeByMode } from "./execution.collection-runtime";
import {
	BEAT_SHEET_ARTIFACT_CONTRACT_NAME,
	BEAT_SHEET_ARTIFACT_CONTRACT_VERSION,
	parseWorkflowAgentOutputEncoding,
	parseWorkflowAgentJsonArrayContract,
	parseWorkflowAgentJsonObjectContract,
	applyWorkflowArtifactJsonArrayContract,
	applyWorkflowArtifactJsonObjectContract,
	applyWorkflowAgentArrayItemExactNumberFields,
	applyWorkflowAgentArrayItemExactStringFields,
	applyWorkflowAgentArrayItemExactStringArrayFields,
	resolvePlannedAssetIdsFromPort,
	validateWorkflowAgentOutput,
	WORKFLOW_STRUCTURED_OUTPUT_REPAIRABLE_POLICY,
	type WorkflowAgentJsonArrayContract,
	type WorkflowAgentJsonObjectContract,
	type WorkflowAgentOutputEncoding,
} from "./execution.agent-output-contract";
import {
	deriveBeatSheetSourceProfile,
	validateBeatSheetSourceCoverage,
	diagnoseBeatSheetSpeechCapacity,
} from "./execution.beat-sheet-source-coverage";
import { blockingPlanFields, backgroundPlanSchema, compositionSchema } from "../../../../../packages/schemas/blocking-plan-contract/schema.mjs";
import { clipObjectStateFields } from "../../../../../packages/schemas/clip-reference-selection/index.mjs";
import { sceneReferenceCardSchema } from "../../../../../packages/schemas/scene-reference-contract/index.mjs";
import {
	resolveWorkflowNodeExecutorRef,
	workflowNodeExecutionFailure,
	workflowNodeWaiting,
} from "./execution.node-runtime";
import type { WorkflowMediaProbeEvidence } from "./execution.media-probe";
import {
	isMediaWorkerEnabled,
	probeMediaViaMediaWorker,
} from "../../platform/media-worker/client";
import {
	workflowExternalPollAfter,
	workflowExternalPollAt,
	workflowExternalSignalOnly,
	type WorkflowExternalCheckScheduleV1,
} from "./execution.external-check";
import {
	assertWorkflowVideoProductionPlanReferencePolicy,
	assertWorkflowVideoReferencePolicy,
	buildVideoAssetPlanCollection,
	buildVideoClipContexts,
	buildVideoDeliveryContract,
	buildVideoProductionPlan,
	buildWorkflowPromptPackage,
	freezeWorkflowVideoDurationPlan,
	inspectWorkflowPromptPackageAdmission,
	parseFrozenWorkflowVideoDurationPlan,
	parseAndValidateWorkflowVoicePlan,
	parseWorkflowAssetRole,
	parseWorkflowVoiceCatalog,
	parseWorkflowVoiceManifest,
	parseWorkflowVideoDeliveryDurationPlan,
	projectVideoAssetPlansFromBeatSheet,
	compileWorkflowClipWriterFrozenEnvelope,
	enrichVideoClipContextWithMaterializedAssets,
	resolveVideoAssetRoleAllowlist,
	validateWorkflowClipWriterForContext,
	validateWorkflowAssetPlanProjectReuse,
	WORKFLOW_VIDEO_DURATION_PLAN_TRIGGER_FIELD,
	WORKFLOW_VIDEO_REFERENCE_POLICY,
	type WorkflowCanvasGroupFacts,
	type WorkflowCanvasProjectContextFacts,
	type WorkflowVideoDurationPlan,
	type WorkflowVoiceManifest,
	type WorkflowVoiceCatalog,
	type WorkflowVoicePlan,
} from "./execution.video-workflow-contract";
import type { WorkflowSubworkflowRunRequest, WorkflowSubworkflowRunResult } from "./execution.subworkflow-runner";
import type {
	WorkflowBlockingDiagramRequest,
	WorkflowBlockingDiagramResult,
} from "./execution.blocking-diagram-runner";
import type { WorkflowPluginRuntimeRegistry } from "./execution.plugin-runtime";
import type { AgentExecutionProvenance } from "../task/agent-execution-provenance";
import {
	isWorkflowProjectImageReady,
	parseWorkflowProjectContext,
	type WorkflowProjectContext,
} from "./execution.project-context";
import { parseWorkflowInitiatingAgentExecution, resolveWorkflowAgentModelKey } from "./execution.agent-model-inheritance";
import type { WorkflowResolvedAsset } from "./execution.asset-resolver";
import {
	createWorkflowInputContractRejection,
	WorkflowInputContractError,
} from "./execution.input-contract";
import {
	parseCharacterIdentityBoardSpec,
} from "./execution.character-identity-contract";
import type { WorkflowFilmProjectionRequest } from "./execution.video-delivery-projection";
import {
	parseWorkflowAcceptedTurnSource,
	WORKFLOW_ACCEPTED_TURN_SOURCE_FIELD,
} from "./execution.workflow-source-authority";
import {
	validateAcceptedLaunchBeatPrefix,
} from "./execution.beat-sheet-prefix";
import {
	createWorkflowAgentRateLimitBackpressureEvidence,
	createWorkflowAgentSessionTurnInflightEvidence,
	isWorkflowAgentRateLimitError,
	isWorkflowAgentRateLimitFailureCode,
	isWorkflowAgentSessionTurnInflightError,
	parseWorkflowAgentPhysicalFailureEvidence,
} from "./execution.agent-backpressure";
import { sha256Hex } from "../asset/book-content-hash";
import { resolveWorkflowAuthoritativeSourceLineage } from "./execution.source-lineage";
import { bindWorkflowNodeExecutionResultPorts } from "./execution.output-port-binding";
import {
	parseVideoGenerationContract,
	type VideoGenerationContract,
} from "../task/video-orchestrator.generation-contract";
import {
	parseWorkflowExecutionControl,
	type WorkflowProductionStartDeadlineV2,
} from "./execution.production-start-deadline";

type WorkflowInputPorts = Readonly<Record<string, readonly unknown[]>>;

export type WorkflowAgentReasoningEffort =
	| "none"
	| "minimal"
	| "low"
	| "medium"
	| "high"
	| "xhigh"
	| "max";

export type WorkflowPromptExampleCandidateSearchObservation = Readonly<{
	version: 1;
	status:
		| "not_attempted"
		| "candidate_found"
		| "no_match"
		| "retrieval_failed"
		| "invalid_evidence"
		| "tool_unavailable";
	mediaType: "image" | "video";
	attempted: boolean;
	remoteAttempted: boolean;
	candidateCount: number;
	blocking: false;
	rationale: string;
	toolCallId?: string;
}>;

export type WorkflowKnowledgeCandidateSearchObservation = Readonly<{
	version: 1;
	status:
		| "not_attempted"
		| "candidate_found"
		| "no_match"
		| "retrieval_failed"
		| "invalid_evidence"
		| "tool_unavailable";
	attempted: boolean;
	candidateCount: number;
	blocking: false;
	rationale: string;
	domains: readonly string[];
	candidateSetId?: string;
	toolCallId?: string;
}>;

const WORKFLOW_AGENT_KNOWLEDGE_TOOLS = [
	"skill_search",
	"Skill",
	"knowledge_search",
	"knowledge_candidates_page",
	"knowledge_read",
] as const;

export type WorkflowAgentRunRequest = Readonly<{
	executionId: string;
	executionFamilyId: string;
	nodeId: string;
	ownerId: string;
	flowId: string;
	projectId: string | null;
	workflowKey: string | null;
	instruction: string;
	outputArtifactType: string;
	outputEncoding: WorkflowAgentOutputEncoding;
	jsonArrayContract?: WorkflowAgentJsonArrayContract | null;
	jsonObjectContract?: WorkflowAgentJsonObjectContract | null;
	deliveryRequirement: string;
	modelKey: string;
	maxOutputTokens: number;
	reasoningEffort?: WorkflowAgentReasoningEffort;
	serviceTier?: "default" | "priority";
	inputs: WorkflowInputPorts;
	requiredSkills: readonly string[];
	mountedKnowledgeCardIds: readonly string[];
	disabledSkills: readonly string[];
	disabledKnowledgeCardIds: readonly string[];
	allowedTools: readonly string[];
	promptExampleRetrievalScope?: Readonly<{
		version: 3;
		mediaType: "image" | "video";
		searchPolicy: "agent_discretion" | "required_non_blocking";
		model?: string;
	}>;
	forcedAgentRole: string | null;
	resumeOnly: boolean;
	previousEvidence: Record<string, unknown> | null;
	productionStartDeadline?: WorkflowProductionStartDeadlineV2;
	logicalTaskBudgetRootId?: string;
	abortSignal?: AbortSignal;
	/**
	 * 系统级共享工作流的交付目标（调用者项目/画布）。有值时 flowId/projectId
	 * 已指向调用者项目，本字段仅作为注入给 agent 的可见事实（提示其工具画布
	 * 范围就是调用者项目，可读取并复用调用者项目资产），不承载语义判断。
	 */
	deliveryScope?: Readonly<{ flowId: string; projectId: string | null; chapterId?: string }> | null;
	projectContext?: WorkflowProjectContext | null;
	/** Parent goal for authorship, not this node's terminal output contract. */
	userIntentContract?: Record<string, unknown>;
}>;

export type WorkflowAgentRunResult = Readonly<{
	taskId: string;
	text: string;
	assets: readonly Readonly<{
		type: string;
		url: string;
		assetId: string | null;
	}>[];
	expectedDelivery: unknown;
	deliveryEvidence: unknown;
	deliveryVerification: unknown;
	requestTerminal: unknown;
	/** Structured-output failure evidence emitted by agents-cli when a typed
	 * candidate was seen but could not be accepted. Kept separate from `text`
	 * because typed failures intentionally do not masquerade as user output. */
	structuredOutputFailure?: unknown;
	executionProvenance?: AgentExecutionProvenance;
	executionProvenanceHistory?: AgentExecutionProvenance[];
	promptExampleCandidateSearch?: WorkflowPromptExampleCandidateSearchObservation;
	knowledgeCandidateSearch?: WorkflowKnowledgeCandidateSearchObservation;
	/** Trusted candidate-set receipts retained for snapshot inspection. */
	retrievalCandidateSets?: readonly Record<string, unknown>[];
	/** Exact model-facing request snapshots retained for upstream-context inspection. */
	upstreamRequestContexts?: readonly Record<string, unknown>[];
	/** Author observations, not a task verdict or permission to discard assets. */
	structuredOutputReview?: Readonly<Record<string, unknown>>;
}>;

export type WorkflowNodeExecutorDependencies = Readonly<{
	pluginRuntimeRegistry?: WorkflowPluginRuntimeRegistry;
	runAgent: (request: WorkflowAgentRunRequest) => Promise<WorkflowAgentRunResult>;
	runJavascript: (request: Readonly<{ code: string; input: unknown }>) => Promise<Readonly<{
		output: unknown;
		durationMs: number;
	}>>;
	runImage?: (request: WorkflowImageRunRequest) => Promise<WorkflowImageRunResult>;
	materializeBlockingDiagrams?: (request: WorkflowBlockingDiagramRequest) => Promise<WorkflowBlockingDiagramResult>;
	prepareVideo?: (request: WorkflowVideoRunRequest) => Promise<{ nodeId: string }>;
	runVideo: (request: WorkflowVideoRunRequest) => Promise<WorkflowVideoRunResult>;
	prepareVideoProductionAssets?: (request: Readonly<{
		executionId: string;
		executionFamilyId: string;
		runtimeNodeId: string;
		ownerId: string;
		flowId: string;
		projectId: string | null;
		chapterId?: string | null;
		speakerNames: readonly string[];
		modelKey: string;
		voiceCatalog: WorkflowVoiceCatalog;
		voicePlan: WorkflowVoicePlan;
	}>) => Promise<WorkflowVoiceManifest>;
	readVoicePlanningFacts?: (request: Readonly<{
		executionId: string;
		runtimeNodeId: string;
		ownerId: string;
		flowId: string;
		projectId: string | null;
		chapterId?: string | null;
		speakerNames: readonly string[];
	}>) => Promise<WorkflowVoiceCatalog>;
	runVideoEstimate?: (request: WorkflowVideoEstimateRequest) => Promise<WorkflowVideoEstimateResult>;
	resolveVideoDurationOptions?: (request: Readonly<{
		executionId: string;
		runtimeNodeId: string;
		ownerId: string;
		modelKey: string;
	}>) => Promise<readonly number[]>;
	/**
	 * 解析视频模型的媒体选项（时长/分辨率/画幅，来自 modelCatalog）。用于按次
	 * 注入参数（triggerPayload.resolution/aspectRatio）的确定性校验：目录外参数
	 * 显式失败，不把非法参数漏给供应商。
	 */
	resolveVideoMediaOptions?: (request: Readonly<{
		executionId: string;
		runtimeNodeId: string;
		ownerId: string;
		modelKey: string;
	}>) => Promise<Readonly<{
		durationOptions: readonly number[];
		maxReferenceImages?: number | null;
		resolutionOptions: readonly string[];
		aspectRatioOptions: readonly string[];
	}>>;
	runVideoConcat?: (request: WorkflowVideoConcatRequest) => Promise<WorkflowVideoConcatResult>;
	projectWorkflowFilm?: (request: WorkflowFilmProjectionRequest) => Promise<void>;
	readCanvasGroup?: (request: Readonly<{
		flowId: string;
		ownerId: string;
		groupId: string;
		flowVersionData: unknown;
	}>) => Promise<WorkflowCanvasGroupFacts>;
	/**
	 * 系统级共享工作流（delivery 重定向）读取调用者当前画布内的源组：从调用者
	 * flow 的实时数据解析 groupNode 及其子节点，供 canvas-source 复用调用者
	 * 项目内真实节点（文本 + 已就绪图片/视频）作为源与参考资产。
	 */
	readCanvasGroupFromFlow?: (request: Readonly<{
		flowId: string;
		ownerId: string;
		groupId: string;
		chapterId?: string | null;
	}>) => Promise<WorkflowCanvasGroupFacts>;
	readCanvasProjectContextFromSnapshot?: (request: Readonly<{
		flowVersionData: unknown;
		flowId: string;
		ownerId: string;
		projectContext: WorkflowProjectContext;
		chapterId?: string | null;
		allowNoTextSource?: boolean;
		acceptedTurnSource?: import("./execution.workflow-source-authority").WorkflowAcceptedTurnSource | null;
	}>) => Promise<WorkflowCanvasProjectContextFacts>;
	searchKnowledge?: (request: Readonly<{
		ownerId: string;
		rawUserRequest: string;
		query: string;
		roleScope: string | null;
		domain: string | null;
		strictFilters: boolean;
		limit: number;
	}>) => Promise<WorkflowKnowledgeCandidateSetV2>;
	readKnowledge?: (request: Readonly<{
		candidateSet: WorkflowKnowledgeCandidateSetV2;
		cardId: string;
	}>) => Promise<WorkflowKnowledgeCardV1>;
	invokeTool?: (request: Readonly<{
		executionId: string;
		nodeId: string;
		ownerId: string;
		projectId: string | null;
		flowId: string;
		chapterId?: string | null;
		toolName: string;
		args: Record<string, unknown>;
	}>) => Promise<Readonly<{
		toolName: string;
		content: string;
		data: Record<string, unknown> | null;
		execution: Record<string, unknown> | null;
	}>>;
	runSubworkflow?: (request: WorkflowSubworkflowRunRequest) => Promise<WorkflowSubworkflowRunResult>;
	resolveProjectAsset?: (request: Readonly<{
		ownerId: string;
		projectId: string;
		assetId: string;
		preferredKind: "image" | "video" | "audio";
		projectContext: WorkflowProjectContext;
	}>) => Promise<WorkflowResolvedAsset>;
}>;

export type WorkflowImageReferenceAssetBinding = Readonly<{
	assetId: string;
	role: "layout" | "style" | "identity" | "content";
	strength?: number;
}>;

export type WorkflowImageRunRequest = Readonly<{
	assetIdentity?: Readonly<{ assetId: string; generationSpecVersion: string }>;
	authorizedRetry?: AuthorizedWorkflowMediaRetry;
	executionId: string;
	executionFamilyId: string;
	ownerId: string;
	flowId: string;
	projectId: string | null;
	chapterId?: string | null;
	runtimeNodeId: string;
	itemIndex: number;
	prompt: string;
	negativePrompt: string;
	modelKey: string;
	aspectRatio: string;
	imageSize: string;
	imageQuality?: string;
	referenceAssetBindings: readonly WorkflowImageReferenceAssetBinding[];
	styleReferenceImages?: readonly string[];
	stylePrompt?: string | null;
	styleFingerprint?: string | null;
	assetMetadata?: Readonly<Record<string, unknown>> | null;
	previousEvidence: Record<string, unknown> | null;
	resumeOnly: boolean;
}>;

export type WorkflowImageRunResult =
	| Readonly<{ status: "success"; nodeId: string; taskId: string | null; imageUrl: string; assetId: string | null; reused: boolean }>
	| Readonly<{ status: "waiting_external"; nodeId: string; taskId: string | null; observationFailure?: { observedAt: string; message: string }; reused: boolean }>
	| Readonly<{ status: "failed"; nodeId: string; taskId: string | null; errorMessage: string }>;

export type WorkflowVideoRunRequest = Readonly<{
    mediaDeliveryPolicy?: MediaDeliveryPolicy | null;
	executionId: string;
	executionFamilyId: string;
	ownerId: string;
	flowId: string;
	projectId: string | null;
	chapterId?: string | null;
	runtimeNodeId: string;
	itemIndex: number;
	prompt: string;
	structuredClip: Readonly<Record<string, unknown>> | null;
	modelKey: string;
	durationSeconds: number;
	resolution: string;
	size?: string;
	aspectRatio: string;
	referenceImageNodeIds: readonly string[];
	referenceAssetIds: readonly string[];
	styleReferenceImages?: readonly string[];
	stylePrompt?: string | null;
	styleFingerprint?: string | null;
	estimateIdentity: string | null;
	generationContract?: VideoGenerationContract | null;
	previousEvidence: Record<string, unknown> | null;
	resumeOnly: boolean;
}>;

export type WorkflowVideoRunResult =
	| Readonly<{
		status: "success";
		nodeId: string;
		taskId: string | null;
		providerAcceptedAt?: string;
		videoUrl: string;
		thumbnailUrl: string | null;
		reused: boolean;
		mediaProbeEvidence?: WorkflowMediaProbeEvidence;
	}>
	| Readonly<{ status: "waiting_external"; nodeId: string; taskId: string | null; observationFailure?: { observedAt: string; message: string }; providerAcceptedAt?: string; reused: boolean }>
	| Readonly<{
		status: "failed";
		nodeId: string;
		taskId: string | null;
		providerAcceptedAt?: string;
		errorMessage: string;
		errorCode?: string | null;
		providerRejectedReferenceIds?: readonly string[];
	}>;

export type WorkflowVideoEstimateRequest = Readonly<{
	executionId: string;
	runtimeNodeId: string;
	ownerId: string;
	projectId: string | null;
	modelKey: string;
	resolution: string;
	aspectRatio: string;
	/** Structural count of image references declared by the prompt package. */
	referenceImageCount?: number;
	clips: readonly Readonly<{ itemId: string; durationSeconds: number }>[];
}>;

export type WorkflowVideoEstimateResult = Readonly<{
	estimateIdentity: string;
	modelKey: string;
	resolution: string;
	aspectRatio: string;
	generationContract?: VideoGenerationContract;
	estimatedCredits: number;
	perClip: readonly Readonly<{ itemId: string; durationSeconds: number; credits: number }>[];
}>;

export type WorkflowVideoConcatRequest = Readonly<{
	executionId: string;
	runtimeNodeId: string;
	ownerId: string;
	flowId: string;
	projectId: string | null;
	chapterId?: string | null;
	videoUrls: readonly string[];
	sourceNodeIds: readonly string[];
	aspectRatio: string;
	resolution: string;
	targetDurationSeconds: number | null;
}>;

export type WorkflowVideoConcatResult = Readonly<{
	videoUrl: string;
	assetId: string;
	clipCount: number;
	reusedSingleClip: boolean;
	mediaProbeEvidence?: WorkflowMediaProbeEvidence;
	concatPolicy?: Readonly<{
		joinMode: "hard_cut" | "xfade";
		xfadeSeconds: number;
		colorMatch: boolean;
	}>;
}>;

export type WorkflowNodeExecutionContext = Readonly<{
	executionId: string;
	executionFamilyId: string;
	recoveryOfExecutionId?: string | null;
	ownerId: string;
	flowId: string;
	projectId: string | null;
	workflowKey: string | null;
	node: WorkflowNodeSnapshot;
	inputs: WorkflowInputPorts;
	flowVersionData?: unknown;
	/** Frozen per-execution project context; authoritative for selected assets. */
	projectContext?: WorkflowProjectContext | null;
	flowVersionId?: string;
	runtimeItemIndex?: number;
	resumeOutputRefs?: WorkflowNodeOutputV1;
	resumeOnly?: boolean;
	inputProvenance?: readonly WorkflowInputBindingProvenanceV1[];
	checkpointOutputRefs?: (outputRefs: WorkflowNodeOutputV1) => Promise<void>;
	abortSignal?: AbortSignal;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const WORKFLOW_PROVIDER_STATUS_POLL_MS = 5_000;
const WORKFLOW_MEDIA_READINESS_MAX_POLLS = 120;
/*
 * readiness 关卡一次要探测的是一整批片段，而每次探测都会占用 media-worker 的一个
 * ffmpeg 作业位（MEDIA_WORKER_MAX_FFMPEG）。整批并发会把作业位全部吃满：同一轮里
 * 没有任何探测能提前完成，随后真正的 concat 也要排队等这些作业位。批次按作业位的
 * 一半推进，让一轮探测始终留出并发余量。
 */
const WORKFLOW_MEDIA_PROBE_CONCURRENCY = 2;
const WORKFLOW_AGENT_STATUS_POLL_MS = 5_000;
const WORKFLOW_AGENT_BALANCE_POLL_MS = 60_000;
/** BeatSheet 前 N 个 clip 的确定性生产选择器；同时是 BeatSheet 作者的物理片段预算来源。 */
export const BEAT_SHEET_TAKE_EXECUTOR_REF = "video.beat-sheet.take/v1";

async function probeWorkflowVideoUrls(
	urls: readonly string[],
): Promise<Array<Awaited<ReturnType<typeof probeMediaViaMediaWorker>>>> {
	const results = new Array<Awaited<ReturnType<typeof probeMediaViaMediaWorker>>>(urls.length);
	let cursor = 0;
	const workers = Array.from(
		{ length: Math.min(WORKFLOW_MEDIA_PROBE_CONCURRENCY, urls.length) },
		async () => {
			while (cursor < urls.length) {
				const index = cursor;
				cursor += 1;
				results[index] = await probeMediaViaMediaWorker({ url: urls[index]! });
			}
		},
	);
	await Promise.all(workers);
	return results;
}

function workflowAgentExternalCheckSchedule(input: Readonly<{
	deliveryEvidence: unknown;
	reason: string;
	nowMs?: number;
}>): WorkflowExternalCheckScheduleV1 {
	const evidence = isRecord(input.deliveryEvidence) ? input.deliveryEvidence : null;
	const retryNotBeforeAt = typeof evidence?.retryNotBeforeAt === "string"
		&& Number.isFinite(Date.parse(evidence.retryNotBeforeAt))
		? evidence.retryNotBeforeAt
		: null;
	if (retryNotBeforeAt) return workflowExternalPollAt(retryNotBeforeAt);
	if (input.reason === "provider_balance_required") {
		return workflowExternalPollAfter(WORKFLOW_AGENT_BALANCE_POLL_MS, input.nowMs);
	}
	return workflowExternalPollAfter(WORKFLOW_AGENT_STATUS_POLL_MS, input.nowMs);
}

function projectContextFromFlowData(flowVersionData: unknown): WorkflowProjectContext | null {
	return parseWorkflowProjectContext(isRecord(flowVersionData) ? flowVersionData.workflowProjectContext : undefined);
}

function runtimeProjectContext(context: WorkflowNodeExecutionContext): WorkflowProjectContext | null {
	return context.projectContext ?? projectContextFromFlowData(context.flowVersionData);
}

function runtimeProductionStartDeadline(
	context: WorkflowNodeExecutionContext,
): WorkflowProductionStartDeadlineV2 | null {
	const flowData = isRecord(context.flowVersionData) ? context.flowVersionData : null;
	const control = parseWorkflowExecutionControl(flowData?.workflowExecutionControl);
	if (!control) return null;
	return control.productionStartDeadline.controlledNodeIds.includes(context.node.id)
		? control.productionStartDeadline
		: null;
}

function readString(record: Record<string, unknown>, field: string): string {
	const value = record[field];
	return typeof value === "string" ? value.trim() : "";
}

function firstInput(inputs: WorkflowInputPorts, port: string): unknown {
	return inputs[port]?.[0];
}

/** Collect only explicit upstream provenance handles; no semantic routing occurs. */
function mountedKnowledgeCardsFromInputs(inputs: WorkflowInputPorts): string[] {
	const ids = new Set<string>();
	const visit = (value: unknown, depth: number): void => {
		if (depth > 8 || !value) return;
		if (Array.isArray(value)) {
			value.forEach((item) => visit(item, depth + 1));
			return;
		}
		if (!isRecord(value)) return;
		const provenanceValues: unknown[] = [];
		if (isRecord(value.executionProvenance)) provenanceValues.push(value.executionProvenance);
		const packet = isRecord(value.authoringEvidencePacket) ? value.authoringEvidencePacket : null;
		if (packet && isRecord(packet.dependencyProvenance)) provenanceValues.push(packet.dependencyProvenance);
		if (packet && Array.isArray(packet.dependencyProvenanceHistory)) {
			provenanceValues.push(...packet.dependencyProvenanceHistory);
		}
		for (const provenanceValue of provenanceValues) {
			if (!isRecord(provenanceValue) || !Array.isArray(provenanceValue.loadedKnowledgeSources)) continue;
			for (const source of provenanceValue.loadedKnowledgeSources) {
				if (!isRecord(source)) continue;
				const cardId = typeof source.cardId === "string" ? source.cardId.trim() : "";
				if (cardId) ids.add(cardId);
			}
		}
		for (const nested of Object.values(value)) visit(nested, depth + 1);
	};
	visit(inputs, 0);
	return [...ids];
}

function workflowSnapshotFact(
	context: WorkflowNodeExecutionContext,
	callConfig: Record<string, unknown> | null,
	field: string,
): unknown {
	const directValue = callConfig?.[field];
	if (directValue !== undefined) {
		return directValue;
	}
	// The trigger payload is frozen into the immutable execution snapshot.  A
	// recovery or queue projection may omit the trigger output from the local
	// input map, so read the same server-owned field from that snapshot rather
	// than treating a missing edge projection as a missing user request.
	const seen = new Set<object>();
	const findValue = (value: unknown): unknown => {
		if ((!isRecord(value) && !Array.isArray(value)) || seen.has(value)) return undefined;
		seen.add(value);
		if (isRecord(value) && field in value) return value[field];
		for (const child of Object.values(value)) {
			const found = findValue(child);
			if (found !== undefined) return found;
		}
		return undefined;
	};
	const snapshotValue = findValue(context.flowVersionData);
	if (snapshotValue !== undefined) return snapshotValue;
	return null;
}

function workflowAcceptedTurnSourceInput(context: WorkflowNodeExecutionContext, callConfig: Record<string, unknown> | null): ReturnType<typeof parseWorkflowAcceptedTurnSource> {
	return parseWorkflowAcceptedTurnSource(workflowSnapshotFact(context, callConfig, WORKFLOW_ACCEPTED_TURN_SOURCE_FIELD), context.ownerId);
}

function runtimeAuthoritativeSourceInstruction(
	inputs: WorkflowInputPorts,
	outputArtifactType: string,
): string {
	if (
		outputArtifactType !== "tapcanvas.beat-sheet/v2" &&
		outputArtifactType !== "tapcanvas.launch-beat-sheet/v1"
	) return "";
	for (const values of Object.values(inputs)) {
		for (const value of values) {
			if (!isRecord(value) || !isRecord(value.canvasFacts)) continue;
			const canvasFacts = value.canvasFacts;
			const sources = Array.isArray(canvasFacts.authoritativeSources)
				? canvasFacts.authoritativeSources.filter(isRecord)
				: [];
			if (sources.length === 0) continue;
			const sourceFacts = sources.map((source) => ({
				sourceId: readString(source, "sourceId") || readString(source, "nodeId"),
				kind: source.kind,
				sourceFingerprint: readString(source, "sourceFingerprint")
					|| sha256Hex(readString(source, "content")),
				sourceRevision: source.sourceRevision,
			}));
			if (sourceFacts.some((source) => !source.sourceId)) continue;
			return [
				"运行时权威来源重申（确定性事实，优先级高于本提示中的任何示例、历史内容或模型记忆）：",
				"authoritativeSources.content 保留其来源身份；不能因 canvasFacts.nodes 为空否定该来源。以下只投影 sourceId、sourceFingerprint、kind 与 revision，不重复正文，也不把创作请求自动认定为已有叙事。输出根对象必须逐字回显冻结的 sourceId 与 sourceFingerprint。用户要求、既有内容与可创作部分由 Agent 依据完整父意图、来源事实及 Skill 判断。",
				JSON.stringify(sourceFacts),
			].join("\n");
		}
	}
	return "";
}

function resolveAuthoritativeSourceLineage(
	inputs: WorkflowInputPorts,
): Readonly<{ sourceId: string; sourceFingerprint: string }> {
	for (const values of Object.values(inputs)) {
		for (const value of values) {
			if (!isRecord(value) || !isRecord(value.canvasFacts)) continue;
			const sources = Array.isArray(value.canvasFacts.authoritativeSources)
				? value.canvasFacts.authoritativeSources.filter(isRecord)
				: [];
			if (sources.length === 0) continue;
			return resolveWorkflowAuthoritativeSourceLineage(sources);
		}
	}
	throw new Error("BeatSheet Agent requires non-empty authoritativeSources lineage");
}

function runtimeBeatSheetInstruction(inputs: WorkflowInputPorts): string {
	const beatSheetInput = firstInput(inputs, "beat-sheet");
	if (!isRecord(beatSheetInput)) return "";
	const text = readString(beatSheetInput, "text");
	if (!text) return "";
	return [
		"运行时上游 BeatSheet 位于冻结端口 beat-sheet[0].text（确定性输入，禁止重新发明）。",
		"资产规划必须读取并服从该结构化事实投影中的 castManifest、meta.sourceAssets、beats.characters、beats.continuity、beats.setting 与 beats.assetObjectContracts。不得把角色姓名、职业、武器、场景或参考资产改写成同音字、旧版本或模型常识；已有 referenceAssetIds/meta.sourceAssets 必须优先复用。",
		"若本次 ProjectContext 带有 selectedAssetIds，它们是用户在本次执行边界明确指定的真实参考资产。必须依据 selectedAssetSnapshot 的结构化来源事实把每一个 selectedAssetId 绑定到对应 assetObjectContracts，并在该对象每次出现的合同上逐字写入 referenceAssetIds=[对应 selectedAssetId]；不得遗漏任何已选资产，不得引用清单外资产，也不得因为展示名、内部 role 名或 physicalIdentityKey 不同而另建替代图片。职责判断属于 Agent 的语义责任；无法确定时必须在同一创作链内继续核对 selectedAssetSnapshot，不能把 selectedAssetId 留空后放行资产生成。",
	].join("\n");
}

/**
 * BeatSheet 物理片段预算：同一冻结工作流版本里的 take 节点确定性地只生产
 * BeatSheet 的前 N 个 clip。N 是本次执行真实会提交给供应商的物理片段数量，
 * 属于执行配置事实。这里只读取它，不改变截断语义。
 */
function resolveBeatSheetProductionClipBudget(flowVersionData: unknown): number | null {
	if (!isRecord(flowVersionData) || !Array.isArray(flowVersionData.nodes)) return null;
	let budget: number | null = null;
	for (const node of flowVersionData.nodes) {
		if (!isRecord(node) || !isRecord(node.data)) continue;
		const spec = isRecord(node.data.workflowAtomicSpec) ? node.data.workflowAtomicSpec : null;
		if (!spec || readString(spec, "executorRef") !== BEAT_SHEET_TAKE_EXECUTOR_REF) continue;
		const raw = node.data.workflowBeatSheetTakeCount;
		if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1) continue;
		budget = budget === null ? raw : Math.min(budget, raw);
	}
	return budget;
}

function positiveNumber(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * BeatSheet 作者的物理片段容量事实。
 *
 * 校验边界与创作边界必须是同一份事实：runtime 会拒绝超出供应商允许时长的 beat，
 * 也会拒绝承载不了冻结人声的计划，但作者此前只能从拒绝信息里反推这些算术。这里
 * 把冻结合同里已经存在的确定性事实在唯一首稿前一次性说清，使作者能在合法解空间内
 * 一次规划，而不是靠反复重写试探。它只陈述数量、时长窗口与生产预算，不做语义判断，
 * 也不给出任何创作结论。
 */
function runtimeBeatSheetCapacityInstruction(
	inputs: WorkflowInputPorts,
	flowVersionData: unknown,
	outputArtifactType: string,
): string {
	if (outputArtifactType !== "tapcanvas.beat-sheet/v2") return "";
	const contract = (inputs["delivery-contract"] ?? []).find(
		(value): value is Record<string, unknown> => isRecord(value) && isRecord(value.generationContract),
	);
	if (!contract) return "";
	const generation = isRecord(contract.generationContract) ? contract.generationContract : null;
	const profile = isRecord(contract.sourceProfile) ? contract.sourceProfile : null;
	const durationOptions = generation && Array.isArray(generation.durationOptions)
		? generation.durationOptions
			.filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0)
			.sort((left, right) => left - right)
		: [];
	const maxDurationSeconds = generation ? positiveNumber(generation.maxDurationSeconds) : null;
	const sourceSpeechChars = profile ? positiveNumber(profile.sourceSpeechChars) : null;
	const speechMaxCharsPerSecond = profile ? positiveNumber(profile.speechMaxCharsPerSecond) : null;
	const minimumPlannedSeconds = profile ? positiveNumber(profile.minimumPlannedSeconds) : null;
	const minimumClipCount = profile ? positiveNumber(profile.minimumClipCount) : null;
	const speechPlanningCharsPerSecond = profile ? positiveNumber(profile.speechPlanningCharsPerSecond) : null;
	const targetDurationSeconds = positiveNumber(contract.targetDurationSeconds);
	/*
	 * 交付窗口一旦冻结，本次执行的可达范围就是该窗口，而不是整章。此前整章的下限与生产
	 * 预算照样陈述，于是同一次指令里同时出现"计划总时长必须 ≥ 348 秒 / 24 个 beat"与
	 * "本窗口只能承载约 240 字、只生产前 24 个 clip"——作者必须同时满足两个互斥范围，
	 * 产物只能在"整章"与"窗口"两个固定点之间来回，且两侧都不可提交。
	 * 窗口内的算术全部由窗口自身派生，整章事实只在没有窗口时陈述。
	 */
	const chapterWide = targetDurationSeconds === null;
	const productionClipBudget = chapterWide
		? resolveBeatSheetProductionClipBudget(flowVersionData)
		: maxDurationSeconds === null
			? null
			: Math.max(1, Math.ceil(targetDurationSeconds / maxDurationSeconds));
	const facts: string[] = [];
	if (durationOptions.length > 0) {
		facts.push(`供应商单 clip 允许时长 durationOptions=${JSON.stringify(durationOptions)}${maxDurationSeconds === null ? "" : `，最大 ${String(maxDurationSeconds)} 秒`}；beats[].durationSeconds 只允许取这些值。`);
	}
	if (sourceSpeechChars !== null && speechMaxCharsPerSecond !== null) {
		facts.push(`本章冻结原文人声 ${String(sourceSpeechChars)} 字，物理语速上限 ${String(speechMaxCharsPerSecond)} 字/秒（不得越过的边界，不是规划目标）。`);
	}
		if (minimumPlannedSeconds !== null) {
			facts.push(
				`物理下限：Σbeats[].durationSeconds 低于 ${String(minimumPlannedSeconds)} 秒`
				+ (minimumClipCount === null || maxDurationSeconds === null
					? "时原文人声在任何速率下都念不完。"
					: `（单 clip 最大 ${String(maxDurationSeconds)} 秒时即 ${String(minimumClipCount)} 个 beat）时原文人声在任何速率下都念不完。这只说明"更短不可能"，不构成计划时长。`),
			);
		}
	if (targetDurationSeconds !== null && speechPlanningCharsPerSecond !== null && sourceSpeechChars !== null) {
		const windowSpeechBudget = Math.floor(targetDurationSeconds * speechPlanningCharsPerSecond);
		const coveredRatio = sourceSpeechChars > 0
			? Math.round((windowSpeechBudget / sourceSpeechChars) * 1000) / 10
			: null;
		const windowClipCount = maxDurationSeconds === null ? null : Math.ceil(targetDurationSeconds / maxDurationSeconds);
		facts.push(
			`本次交付范围就是这一个窗口：用户冻结总时长 ${String(targetDurationSeconds)} 秒`
			+ (windowClipCount === null ? "" : `（约 ${String(windowClipCount)} 个 beat）`)
			+ `，Σbeats[].durationSeconds 必须恰好等于 ${String(targetDurationSeconds)} 秒，不要按整章时长规划。该窗口在自然语速下只能承载约 ${String(windowSpeechBudget)} 字人声`
			+ (coveredRatio === null ? "" : `，即原文 ${String(sourceSpeechChars)} 字的约 ${String(coveredRatio)}%`)
			+ `。按此选择要覆盖的源内容并保持自然语速：装不下的内容属于后续窗口，不属于本次交付，也不要在本窗口内压缩或改写原文人声。`,
		);
	}
	if (productionClipBudget !== null) {
		facts.push(chapterWide
			? `本次执行只生产前 ${String(productionClipBudget)} 个 clip：第 ${String(productionClipBudget + 1)} 个及之后的 beat 不会进入成片，完整交付必须在 beats[0..${String(productionClipBudget - 1)}] 内完成覆盖。`
			: `本次执行只生产这 ${String(productionClipBudget)} 个 clip（与窗口时长一致）；不要额外规划不会进入成片的 beat。`);
	}
	if (facts.length === 0) return "";
	return [
		"运行时物理片段容量事实（确定性算术，不是创作判断；提交前逐项自检）：",
		"一个 beat 就是一个供应商物理 clip：beats[clipIndex] 与 blockingPlans[clipIndex] 一一对应，其 durationSeconds 会原样提交给视频模型生成该片段，不能由上层再拆分或合并。",
		...facts,
		"内容需要更长总时长时增加 beat 数量，不要拉长单个 beat：单个 beat 超出供应商允许时长就无法提交给供应商，而增加 beat 只会增加片段数量。",
	].join("\n");
}

/**
 * BeatSheet 的嵌套结构合同清单。
 *
 * 提交边界会按共享 schema 拒绝 compositionContract/backgroundPlan/sceneCard/objectStates
 * 的缺键与越界枚举，但这些要求此前只存在于校验器里：作者要等被拒才知道，于是一份计划在
 * 多个物理窗口间反复补同一个键。这里把共享 schema 自己声明的必填键与枚举直接投影给作者，
 * 与校验器同一事实来源（不复制、不改写），使首次提交就能自检。它只陈述结构，不判断语义。
 */
function runtimeBeatSheetStructuralChecklist(): string {
	const requiredKeys = (schema: unknown): string[] => {
		if (!isRecord(schema) || !Array.isArray(schema.required)) return [];
		return schema.required.filter((key): key is string => typeof key === "string" && key.length > 0);
	};
	const enumValues = (schema: unknown, key: string): readonly string[] => {
		if (!isRecord(schema) || !isRecord(schema.properties)) return [];
		const property = schema.properties[key];
		if (!isRecord(property) || !Array.isArray(property.enum)) return [];
		return property.enum.filter((value): value is string => typeof value === "string");
	};
	const itemEnumValues = (schema: unknown, arrayKey: string, itemKey: string): readonly string[] => {
		if (!isRecord(schema) || !isRecord(schema.properties)) return [];
		const array = schema.properties[arrayKey];
		if (!isRecord(array) || !isRecord(array.items)) return [];
		return enumValues(array.items, itemKey);
	};
	const blockingPlanKeys = [...blockingPlanFields];
	const backgroundPlanKeys = requiredKeys(backgroundPlanSchema);
	const compositionKeys = requiredKeys(compositionSchema);
	const sceneCardKeys = requiredKeys(sceneReferenceCardSchema);
	const sceneCardProperties = isRecord(sceneReferenceCardSchema) && isRecord(sceneReferenceCardSchema.properties)
		? sceneReferenceCardSchema.properties
		: {};
	const sceneLightingKeys = requiredKeys(sceneCardProperties.sceneLightingSpec);
	const lines = [
		"运行时结构合同清单（与提交边界校验同一事实来源；提交前逐项自检）：",
		"objectRegistry 每项必填字段为 [objectId,kind,name,physicalIdentityKey,referenceImageNodeIds,referenceAssetIds,referenceRole,identityInvariant]；forbiddenTransfer/scale 是可省略字段，不是必填占位；若提交则必须是非空字符串，不能用空字符串、null 或数字表示缺省；physicalIdentityKey 仅 character 必填、其它 kind 必须为 null；referenceImageNodeIds 必须是字符串数组；referenceRole 只能是 none/identity/wardrobe/prop/environment/palette/composition/vfx。",
		`objectStates 每项字段恰好为 ${JSON.stringify([...clipObjectStateFields])}；referenceAssetIds/referenceImageNodeIds 必须显式声明本拍的有序选择，空数组表示本拍不使用，registry 引用不会被继承。`,
		`blockingPlans 每项允许字段 ${JSON.stringify(blockingPlanKeys)}；clipIndex 必须等于零基位置；durationSeconds 必须等于同位置 beats[].durationSeconds；characters 必须恰好覆盖该拍 beats[].characters 声明的角色，不多不少。`,
			`blockingPlans[].backgroundPlan 必填键 ${JSON.stringify(backgroundPlanKeys)}；referenceAssetBindings 必须是数组，每项为 {assetId, role}，role 只能取 ${JSON.stringify(["layout", "content", "identity", "style"])}；注意：referenceAssetBindings 里的 assetId 必须是当前项目已存在的真实资产ID，若本场景为新生成的背景底图无前置资产引用，referenceAssetBindings 必须填空数组 []，严禁将自创的临时 scene assetId 填入引用列表。`,
		`blockingPlans[].compositionContract 必填键 ${JSON.stringify(compositionKeys)}；focusKind 只能取 ${JSON.stringify(enumValues(compositionSchema, "focusKind"))}，shotScale 只能取 ${JSON.stringify(enumValues(compositionSchema, "shotScale"))}，environmentVisualWeight 只能取 ${JSON.stringify(enumValues(compositionSchema, "environmentVisualWeight"))}，focalPoint 为归一化 [x,y]；subjects 每项必填键 ${JSON.stringify(requiredKeys((compositionSchema.properties as Record<string, Record<string, unknown>>).subjects?.items))}，其中 visualWeight/depthLayer/centerPlacement 分别只能取 ${JSON.stringify(itemEnumValues(compositionSchema, "subjects", "visualWeight"))}/${JSON.stringify(itemEnumValues(compositionSchema, "subjects", "depthLayer"))}/${JSON.stringify(itemEnumValues(compositionSchema, "subjects", "centerPlacement"))}。`,
			`assetPlans 按对象 kind 分别校验，禁止跨 kind 放键：只有 scene/environment 计划才提交 sceneCard（必填键 ${JSON.stringify(sceneCardKeys)}，其中 sceneProfileVersion="scene-card/v1"、sceneAssetRole="space_anchor"、sceneOccupancy="none"；sceneCard.sceneLightingSpec 必填键 ${JSON.stringify(sceneLightingKeys)} 且 version="scene-lighting/v1"），且 scene 计划不得再提交顶层 prompt/negativePrompt；character 计划必须提交 identityBoardSpec，同时必须提交四视图生图 prompt 与 negativePrompt；其余 kind（prop/vfx/palette/composition/wardrobe）提交 prompt 与 negativePrompt。请特别注意：凡是 objectRegistry 里 kind 为 scene 或 environment 的对象，其对应的 assetPlans 必须完整提供 sceneCard 及其全部必填字段（包含 sceneLightingSpec），漏给 scene 计划提供 sceneCard 会被直接判缺键拒绝。`,
			"assetPlans 每项还必须提供非空的 identityAnchors 与 prohibitedDrift 字符串数组。",
			"参考职责覆盖与已有资产排除（关键硬约束）：仅在 beats[].assetObjectContracts 中出现、referenceRole 不为 none 且没有绑定真实已就绪参考图（referenceAssetIds/referenceImageNodeIds 均为空）的对象（如未绑图的新建场景或未绑图角色），才在 assetPlans 中建立生成计划（通过 objectId 绑定到该对象）。凡是 objectRegistry 中已绑定了真实参考图（referenceAssetIds/referenceImageNodeIds 非空）的既有资产角色或场景，代表已有可用资产，严禁在 assetPlans 中重复创建生成计划！",
		];
	return lines.join("\n");
}

function healBeatSheetExistingAssetPlans(rawText: string): string | null {
	try {
		const parsed = JSON.parse(rawText);
		if (!isRecord(parsed) || !Array.isArray(parsed.objectRegistry) || !Array.isArray(parsed.assetPlans)) {
			return null;
		}
		const existingAssetObjectIds = new Set<string>();
		for (const obj of parsed.objectRegistry) {
			if (isRecord(obj) && typeof obj.objectId === "string") {
				const assetIds = Array.isArray(obj.referenceAssetIds) ? obj.referenceAssetIds : [];
				const nodeIds = Array.isArray(obj.referenceImageNodeIds) ? obj.referenceImageNodeIds : [];
				if (assetIds.length > 0 || nodeIds.length > 0) {
					existingAssetObjectIds.add(obj.objectId);
				}
			}
		}
		if (existingAssetObjectIds.size === 0) return null;
		const originalLength = parsed.assetPlans.length;
		const filteredPlans = parsed.assetPlans.filter((plan: unknown) => {
			if (!isRecord(plan) || typeof plan.objectId !== "string") return true;
			if (!existingAssetObjectIds.has(plan.objectId)) return true;
			const kind = typeof plan.role === "string" ? plan.role.split("://")[0] : "";
			const isScene = kind === "scene" || kind === "environment";
			if (!isScene && (!plan.prompt || typeof plan.prompt !== "string" || !plan.prompt.trim())) {
				return false;
			}
			return true;
		});
		if (filteredPlans.length === originalLength) return null;
		return JSON.stringify({ ...parsed, assetPlans: filteredPlans });
	} catch {
		return null;
	}
}

function applyExpandedSourceToCanvasFacts(
	canvasFacts: unknown,
	expandedSource: unknown,
): unknown {
	if (!isRecord(canvasFacts) || !isRecord(expandedSource)) return canvasFacts;
	const expandedText = readString(expandedSource, "text");
	if (!expandedText) return canvasFacts;
	const sources = Array.isArray(canvasFacts.authoritativeSources)
		? canvasFacts.authoritativeSources.filter(isRecord)
		: [];
	if (sources.length === 0) return canvasFacts;
	const upstreamProvenance = isRecord(expandedSource.executionProvenance)
		? expandedSource.executionProvenance
		: null;
	const upstreamCandidateSets = Array.isArray(expandedSource.retrievalCandidateSets)
		? expandedSource.retrievalCandidateSets.filter(isRecord)
		: [];
	const expandedDraft = {
		content: expandedText,
		sourceFingerprint: sha256Hex(expandedText),
	};
	return {
		...canvasFacts,
		// A generated draft never changes the identity or content of its sources.
		// This applies equally to chapters, uploaded material and chat requests.
		// The author decides how to use the draft against the preserved evidence.
		expandedSourceDraft: expandedDraft,
		sourceProcessing: "optional_text_expansion_non_authoritative",
		...(upstreamProvenance || upstreamCandidateSets.length > 0
			? {
				authoringEvidencePacket: {
					protocolVersion: "tapcanvas.authoring-evidence/v1",
					...(upstreamProvenance ? { dependencyProvenance: upstreamProvenance } : {}),
					...(upstreamCandidateSets.length > 0 ? { retrievalCandidateSets: upstreamCandidateSets } : {}),
				},
			}
			: {}),
	};
}

/**
 * Project images are an execution-bound identity registry. The Agent owns the
 * one-shot semantic decision that maps ready project images to BeatSheet
 * objects; the host only verifies exact IDs, readiness and non-conflicting
 * object bindings. Explicit user selections remain mandatory members of that
 * registry and therefore must all be consumed by the submitted BeatSheet.
 */
export function validateWorkflowBeatSheetProjectAssetBindings(input: Readonly<{
	beatSheetText: string;
	projectContext: WorkflowProjectContext | null;
}>): string | null {
	const projectContext = input.projectContext;
	if (!projectContext) return null;
	const selectedAssetIds = new Set(projectContext.selectedAssetIds);
	const visibleAssetIds = new Set(projectContext.projectAssetIds);
	const readyProjectAssetIds = new Set(projectContext.assetSnapshot
		.filter((asset) => (
			asset.projectId === projectContext.projectId
			&& visibleAssetIds.has(asset.assetId)
			&& isWorkflowProjectImageReady(asset)
		))
		.map((asset) => asset.assetId));
	const unavailableSelectedAssetIds = [...selectedAssetIds].filter((assetId) => !readyProjectAssetIds.has(assetId));
	if (unavailableSelectedAssetIds.length > 0) {
		return `selectedAssetIds contain images outside the frozen ready production set: ${JSON.stringify(unavailableSelectedAssetIds)}`;
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(input.beatSheetText) as unknown;
	} catch {
		return "BeatSheet project-asset bindings cannot be inspected because the artifact is not valid JSON";
	}
	if (!isRecord(parsed) || !Array.isArray(parsed.beats)) {
		return "BeatSheet project-asset bindings require a beats array";
	}
	const referencedSelectedAssetIds = new Set<string>();
	const roleByProjectAssetId = new Map<string, string>();
	for (const [beatIndex, beat] of parsed.beats.entries()) {
		if (!isRecord(beat) || !Array.isArray(beat.assetObjectContracts)) continue;
		for (const [contractIndex, contract] of beat.assetObjectContracts.entries()) {
			if (!isRecord(contract)) continue;
			const kind = readString(contract, "kind");
			const name = kind === "character"
				? readString(contract, "physicalIdentityKey")
				: readString(contract, "name");
			const role = kind && name ? `${kind}://${name}` : `beats[${beatIndex}].assetObjectContracts[${contractIndex}]`;
			let referenceAssetIds: string[];
			try {
				referenceAssetIds = resolveWorkflowProjectImageReferences(contract, projectContext);
			} catch (error: unknown) {
				return `beats[${beatIndex}].assetObjectContracts[${contractIndex}]: ${error instanceof Error ? error.message : String(error)}`;
			}
			for (const assetId of referenceAssetIds) {
				if (!readyProjectAssetIds.has(assetId)) {
					return `beats[${beatIndex}].assetObjectContracts[${contractIndex}].referenceAssetIds contains assetId=${assetId} outside the frozen ready production image set; allowed projectAssetIds=${JSON.stringify([...readyProjectAssetIds])}`;
				}
				const previousRole = roleByProjectAssetId.get(assetId);
				if (previousRole && previousRole !== role) {
					return `project assetId=${assetId} is bound to conflicting roles ${previousRole} and ${role}`;
				}
				roleByProjectAssetId.set(assetId, role);
				if (selectedAssetIds.has(assetId)) referencedSelectedAssetIds.add(assetId);
			}
		}
	}
	const missingSelectedAssetIds = [...selectedAssetIds].filter((assetId) => !referencedSelectedAssetIds.has(assetId));
	if (missingSelectedAssetIds.length > 0) {
		return `BeatSheet omitted explicitly selected assets; bind every missing ID to the matching root objectRegistry[].referenceAssetIds using selectedAssetSnapshot source facts: ${JSON.stringify(missingSelectedAssetIds)}. One object may retain multiple ordered image IDs. Do not write beats[].assetObjectContracts: those fields are derived from objectRegistry and objectStates. Frozen selectedAssetSnapshot=${JSON.stringify(projectContext.assetSnapshot.filter((asset) => selectedAssetIds.has(asset.assetId)).map((asset) => ({
			assetId: asset.assetId, nodeId: asset.nodeId, flowId: asset.flowId,
			canonicalName: asset.canonicalName, kind: asset.kind, referenceType: asset.referenceType, sourceFacts: asset.sourceFacts,
		})))}`;
	}
	return null;
}


function sanitizeWorkflowCallConfig(
	callConfig: Record<string, unknown> | null,
	projectContext: WorkflowProjectContext,
): Record<string, unknown> | null {
	if (!callConfig) return null;
	const selectedAssetIds = callConfig.selectedAssetIds;
	if (!Array.isArray(selectedAssetIds)) return callConfig;
	const readyImageIds = new Set(
		projectContext.assetSnapshot.filter(isWorkflowProjectImageReady).map((asset) => asset.assetId),
	);
	return {
		...callConfig,
		selectedAssetIds: selectedAssetIds.filter(
			(value): value is string => typeof value === "string" && readyImageIds.has(value.trim()),
		),
	};
}

type WorkflowConditionOperator = "equals" | "not_equals" | "exists" | "is_true" | "is_false" | "greater_than" | "less_than";

function resolveJsonPointer(value: unknown, pointer: string): Readonly<{ found: boolean; value: unknown }> {
	if (pointer === "") return { found: true, value };
	if (!pointer.startsWith("/")) throw new Error("Workflow condition JSON Pointer must be empty or start with /");
	let current = value;
	for (const rawSegment of pointer.slice(1).split("/")) {
		const segment = rawSegment.replaceAll("~1", "/").replaceAll("~0", "~");
		if (Array.isArray(current)) {
			const index = Number(segment);
			if (!Number.isInteger(index) || index < 0 || index >= current.length) return { found: false, value: undefined };
			current = current[index];
			continue;
		}
		if (!isRecord(current) || !Object.prototype.hasOwnProperty.call(current, segment)) return { found: false, value: undefined };
		current = current[segment];
	}
	return { found: true, value: current };
}

function structurallyEqual(left: unknown, right: unknown): boolean {
	if (Object.is(left, right)) return true;
	if (Array.isArray(left) && Array.isArray(right)) {
		return left.length === right.length && left.every((value, index) => structurallyEqual(value, right[index]));
	}
	if (!isRecord(left) || !isRecord(right)) return false;
	const leftKeys = Object.keys(left).sort();
	const rightKeys = Object.keys(right).sort();
	return leftKeys.length === rightKeys.length
		&& leftKeys.every((key, index) => key === rightKeys[index] && structurallyEqual(left[key], right[key]));
}

function evaluateWorkflowCondition(data: Record<string, unknown>, input: unknown): Readonly<{
	matched: boolean;
	selectedValue: unknown;
	pointer: string;
	operator: WorkflowConditionOperator;
}> {
	const pointer = readString(data, "workflowConditionPointer");
	const operator = readString(data, "workflowConditionOperator");
	const operators = new Set<WorkflowConditionOperator>(["equals", "not_equals", "exists", "is_true", "is_false", "greater_than", "less_than"]);
	if (!operators.has(operator as WorkflowConditionOperator)) throw new Error("Workflow condition requires a supported structural operator");
	const selected = resolveJsonPointer(input, pointer);
	let expected: unknown;
	if (operator === "equals" || operator === "not_equals" || operator === "greater_than" || operator === "less_than") {
		const expectedJson = readString(data, "workflowConditionExpectedJson");
		if (!expectedJson) throw new Error(`Workflow condition operator ${operator} requires expected JSON`);
		try {
			expected = JSON.parse(expectedJson) as unknown;
		} catch (error: unknown) {
			throw new Error(`Workflow condition expected value is invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	let matched: boolean;
	if (operator === "exists") matched = selected.found;
	else if (operator === "is_true") matched = selected.found && selected.value === true;
	else if (operator === "is_false") matched = selected.found && selected.value === false;
	else if (operator === "equals") matched = selected.found && structurallyEqual(selected.value, expected);
	else if (operator === "not_equals") matched = !selected.found || !structurallyEqual(selected.value, expected);
	else {
		if (!selected.found || typeof selected.value !== "number" || typeof expected !== "number" || !Number.isFinite(selected.value) || !Number.isFinite(expected)) {
			throw new Error(`Workflow condition operator ${operator} requires finite numeric values`);
		}
		matched = operator === "greater_than" ? selected.value > expected : selected.value < expected;
	}
	return { matched, selectedValue: selected.value, pointer, operator: operator as WorkflowConditionOperator };
}

function firstDeclaredInput(context: WorkflowNodeExecutionContext): unknown {
	const spec = isRecord(context.node.data.workflowAtomicSpec) ? context.node.data.workflowAtomicSpec : null;
	const inputPorts = spec && Array.isArray(spec.inputPorts) ? spec.inputPorts : [];
	const port = inputPorts.find((value): value is string => typeof value === "string" && value.trim().length > 0);
	return port ? firstInput(context.inputs, port.trim()) : undefined;
}

function stringListFromInput(inputs: WorkflowInputPorts, port: string): string[] {
	return (inputs[port] ?? []).flatMap((value) => {
		if (typeof value === "string" && value.trim()) return [value.trim()];
		if (!Array.isArray(value)) return [];
		return value
			.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
			.map((item) => item.trim());
	});
}

function stringListFromData(data: Record<string, unknown>, field: string): string[] {
	const value = data[field];
	if (!Array.isArray(value)) return [];
	return value
		.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
		.map((item) => item.trim());
}

function uniqueStrings(values: readonly string[]): string[] {
	return Array.from(new Set(values));
}

function primaryOutputPort(data: Record<string, unknown>, fallback: string): string {
	const spec = isRecord(data.workflowAtomicSpec) ? data.workflowAtomicSpec : null;
	const outputPorts = spec && Array.isArray(spec.outputPorts) ? spec.outputPorts : [];
	const first = outputPorts.find((port): port is string => typeof port === "string" && port.trim().length > 0);
	return first?.trim() ?? fallback;
}

/**
 * 系统级共享工作流的媒体交付目标。由 startWorkflowExecution 随执行快照冻结
 * （flowVersionData.workflowDeliveryScope），媒体节点写回调用者当前对话所在
 * 项目画布；缺省返回 null，保持旧行为（写入工作流自身 flow）。
 */
function workflowDeliveryScope(flowVersionData: unknown): Readonly<{
	flowId: string;
	projectId: string | null;
	chapterId?: string;
}> | null {
	if (!isRecord(flowVersionData)) return null;
	const scope = isRecord(flowVersionData.workflowDeliveryScope) ? flowVersionData.workflowDeliveryScope : null;
	if (!scope) return null;
	const flowId = readString(scope, "flowId");
	if (!flowId) return null;
	const projectId = readString(scope, "projectId");
	const chapterId = readString(scope, "chapterId");
	return {
		flowId,
		projectId: projectId || null,
		...(chapterId ? { chapterId } : {}),
	};
}

/**
 * 在输入端口中查找携带 assetPlans 数组（视频 writer 类冻结资产计划）的端口。
 * 只做结构探测，不承载语义判断；用于运行时自动注入资产精确声明合同。
 */
function findAssetPlansPort(inputs: WorkflowInputPorts): string | null {
	for (const [portId, values] of Object.entries(inputs)) {
		const first = values[0];
		if (isRecord(first) && Array.isArray(first.assetPlans) && first.assetPlans.length > 0) {
			return portId;
		}
	}
	return null;
}

function resolveFrozenSingleClipWriterFacts(inputs: WorkflowInputPorts): Readonly<{
	clipId: string;
	clipIndex: number;
	durationSeconds: number;
	characterRoleNames: readonly string[];
	exitState: string;
}> | null {
	const facts: Array<Readonly<{
		clipId: string;
		clipIndex: number;
		durationSeconds: number;
		characterRoleNames: readonly string[];
		exitState: string;
	}>> = [];
	for (const values of Object.values(inputs)) {
		for (const value of values) {
			if (!isRecord(value) || !isRecord(value.beat)) continue;
			const clipId = typeof value.beat.clipId === "string" ? value.beat.clipId.trim() : "";
			const clipIndex = value.clipIndex;
			const durationSeconds = value.beat.durationSeconds;
			if (!Array.isArray(value.beat.characters)) {
				throw new Error("Frozen single-Clip writer facts require a characters array");
			}
			const characterRoleNames = Array.isArray(value.beat.characters)
				? value.beat.characters.map((character) => typeof character === "string" ? character.trim() : "")
				: [];
			const exitState = typeof value.beat.exitState === "string" ? value.beat.exitState.trim() : "";
			if (!clipId || !Number.isInteger(clipIndex) || Number(clipIndex) < 0
				|| typeof durationSeconds !== "number" || !Number.isFinite(durationSeconds) || durationSeconds <= 0
				|| characterRoleNames.some((name) => !name) || !exitState) {
				throw new Error("Frozen single-Clip writer facts require clipId, clipIndex, durationSeconds, an ordered characters array and exitState");
			}
			facts.push({ clipId, clipIndex: Number(clipIndex), durationSeconds, characterRoleNames, exitState });
		}
	}
	if (facts.length === 0) return null;
	const canonical = JSON.stringify(facts[0]);
	if (facts.some((value) => JSON.stringify(value) !== canonical)) {
		throw new Error("Frozen single-Clip context contains conflicting writer facts");
	}
	return facts[0] ?? null;
}

function resolveFrozenClipIds(inputs: WorkflowInputPorts): string[] {
	for (const values of Object.values(inputs)) {
		for (const value of values) {
			let candidate: unknown = value;
			if (isRecord(value) && typeof value.text === "string") {
				try {
					candidate = JSON.parse(value.text) as unknown;
				} catch {
					continue;
				}
			}
			if (!isRecord(candidate) || !Array.isArray(candidate.beats) || candidate.beats.length === 0) continue;
			const clipIds = candidate.beats.map((beat) => isRecord(beat) ? readString(beat, "clipId") : "");
			if (clipIds.some((clipId) => !clipId) || new Set(clipIds).size !== clipIds.length) {
				throw new Error("Frozen BeatSheet contains missing or duplicate clipId values");
			}
			return clipIds;
		}
	}
	throw new Error("Asset planning requires a frozen BeatSheet with non-empty clipId values");
}

/**
 * A BeatSheet referenceAssetIds binding is an Agent-authored, exact asset
 * identity decision.  It must outrank display-name matching: physicalIdentityKey
 * identifies the body across aliases, while a material's canonicalName remains
 * its user-facing name and is not required to equal that internal body key.
 */
function reusableReferencedProjectAssetRoleFacts(
	inputs: WorkflowInputPorts,
	projectContext: WorkflowProjectContext | null,
	allowedRoles: readonly string[],
): WorkflowReusableAssetRoleFacts {
	if (!projectContext || allowedRoles.length === 0) return {};
	const beatSheetInput = firstInput(inputs, "beat-sheet");
	let beatSheet: unknown = beatSheetInput;
	if (isRecord(beatSheetInput) && typeof beatSheetInput.text === "string") {
		try {
			beatSheet = JSON.parse(beatSheetInput.text) as unknown;
		} catch {
			throw new Error("Frozen BeatSheet reference bindings are not valid JSON");
		}
	}
	if (!isRecord(beatSheet) || !Array.isArray(beatSheet.beats)) return {};
	const allowedRoleSet = new Set(allowedRoles);
	const visibleAssetIds = new Set(projectContext.projectAssetIds);
	const readyAssetById = new Map(projectContext.assetSnapshot
		.filter((asset) => (
			visibleAssetIds.has(asset.assetId)
			&& asset.projectId === projectContext.projectId
			&& isWorkflowProjectImageReady(asset)
		))
		.map((asset) => [asset.assetId, asset] as const));
	const facts: Record<string, readonly WorkflowReusableAssetReference[]> = {};
	for (const [beatIndex, beat] of beatSheet.beats.entries()) {
		if (!isRecord(beat) || !Array.isArray(beat.assetObjectContracts)) continue;
		for (const [contractIndex, contract] of beat.assetObjectContracts.entries()) {
			if (!isRecord(contract)) continue;
			const kind = readString(contract, "kind");
			const name = kind === "character"
				? readString(contract, "physicalIdentityKey")
				: readString(contract, "name");
			const role = kind && name ? `${kind}://${name}` : "";
			if (!role || !allowedRoleSet.has(role)) continue;
			const referenceAssetIds = resolveWorkflowProjectImageReferences(contract, projectContext);
			if (referenceAssetIds.length === 0) continue;
			const existingAssets = referenceAssetIds.map((referenceAssetId) => {
				const asset = readyAssetById.get(referenceAssetId);
				if (!asset) throw new Error(`Unresolved frozen asset ${referenceAssetId}`);
				return {
					planAssetId: asset.assetId,
					existingAssetId: asset.assetId,
					existingProjectId: projectContext.projectId,
					...(asset.nodeId ? { existingNodeId: asset.nodeId } : {}),
				};
			});
			// Different clips may choose different views of the same object.
			// Union the reusable inventory here; consumers remain image-specific.
			const previous = facts[role] ?? [];
			facts[role] = [...previous, ...existingAssets.filter((asset) =>
				!previous.some((reference) => reference.existingAssetId === asset.existingAssetId))];
		}
	}
	return facts;
}

/**
 * Promote already materialized image outputs from the same workflow execution
 * into immutable reuse facts for the chapter remainder. The role and plan
 * identity come from the validated upstream asset plan; the URL/node pair comes
 * from the completed media receipt. No name matching or semantic inference is
 * performed here.
 */
function reusableUpstreamAssetRoleFacts(
	inputs: WorkflowInputPorts,
	allowedRoles: readonly string[],
): WorkflowReusableAssetRoleFacts {
	const input = firstInput(inputs, "asset-bindings");
	if (input === undefined || input === null) return {};
	if (!isWorkflowCollection(input)) {
		throw new Error("Upstream reusable asset bindings must be a workflow collection");
	}
	const allowedRoleSet = new Set(allowedRoles);
	const facts: Record<string, readonly WorkflowReusableAssetReference[]> = {};
	const uses = input.items.flatMap(item => {
		if (!isRecord(item.value)) throw new Error("Materialized receipt must be an object");
		const receipt = item.value;
		return materializedAssetUses(receipt.assetPlan).map(assetPlan => ({ value: { ...receipt, assetPlan } }));
	});
	for (const [index, item] of uses.entries()) {
		if (!isRecord(item.value) || !isRecord(item.value.assetPlan)) {
			throw new Error(`Upstream asset binding ${index + 1} requires a validated assetPlan`);
		}
		const role = readString(item.value.assetPlan, "role");
		if (!role || !allowedRoleSet.has(role)) continue;
		const planAssetId = readString(item.value.assetPlan, "assetId");
		const existingNodeId = readString(item.value, "nodeId");
		const existingImageUrl = persistentHttpUrl(readString(item.value, "imageUrl"));
		if (!planAssetId || !existingNodeId || !existingImageUrl) {
			throw new Error(`Upstream asset binding ${index + 1} requires assetId, nodeId and persistent imageUrl`);
		}
		const nextFact: WorkflowReusableAssetReference = {
			planAssetId,
			...(readString(item.value.assetPlan, "existingAssetId") ? {
				existingAssetId: readString(item.value.assetPlan, "existingAssetId"),
				existingProjectId: readString(item.value.assetPlan, "existingProjectId"),
			} : {}),
			existingNodeId,
			existingImageUrl,
		};
		const previous = facts[role] ?? [];
		if (previous.some((reference) => reference.planAssetId === planAssetId)) {
			throw new Error(`Upstream asset role ${role} has duplicate materialized identity ${planAssetId}`);
		}
		facts[role] = [...previous, nextFact];
	}
	return facts;
}

function reusableWorkflowAssetRoleFacts(
	inputs: WorkflowInputPorts,
	projectContext: WorkflowProjectContext | null,
	allowedRoles: readonly string[],
): WorkflowReusableAssetRoleFacts {
	return {
		...reusableUpstreamAssetRoleFacts(inputs, allowedRoles),
		...reusableReferencedProjectAssetRoleFacts(inputs, projectContext, allowedRoles),
	};
}

function knowledgeQuery(inputs: WorkflowInputPorts, data: Record<string, unknown>): string {
	const value = firstInput(inputs, "query");
	if (typeof value === "string" && value.trim()) return value.trim();
	return readString(data, "workflowKnowledgeQuery");
}

function knowledgeCardId(inputs: WorkflowInputPorts, data: Record<string, unknown>): string {
	const value = firstInput(inputs, "card-id");
	if (typeof value === "string" && value.trim()) return value.trim();
	if (isRecord(value)) return readString(value, "cardId");
	return readString(data, "workflowKnowledgeCardId");
}

function knowledgeLimit(data: Record<string, unknown>): number {
	const value = data.workflowKnowledgeLimit;
	if (value === undefined) return 5;
	if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 12) {
		throw new Error("Workflow Knowledge Search limit must be an integer between 1 and 12");
	}
	return Number(value);
}

function toolInvocationArguments(inputs: WorkflowInputPorts, data: Record<string, unknown>): Record<string, unknown> {
	const inputValue = firstInput(inputs, "arguments");
	if (isRecord(inputValue)) return inputValue;
	const configured = readString(data, "workflowToolInvocationArgs");
	if (!configured) return {};
	let parsed: unknown;
	try {
		parsed = JSON.parse(configured) as unknown;
	} catch (error: unknown) {
		throw new Error(`Workflow Tool Invocation arguments are not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (!isRecord(parsed)) throw new Error("Workflow Tool Invocation arguments must be a JSON object");
	return parsed;
}

function workflowToolInvocationDeliveryMetadata(
	inputs: WorkflowInputPorts,
): Readonly<{ deliveryEvidence?: unknown; deliveryVerification?: unknown }> {
	const inputValue = firstInput(inputs, "arguments");
	if (!isRecord(inputValue)) return {};
	return {
		...(inputValue.deliveryEvidence !== undefined ? { deliveryEvidence: inputValue.deliveryEvidence } : {}),
		...(inputValue.deliveryVerification !== undefined ? { deliveryVerification: inputValue.deliveryVerification } : {}),
	};
}

function stripWorkflowToolInvocationDeliveryMetadata(args: Record<string, unknown>): Record<string, unknown> {
	const { deliveryEvidence: _deliveryEvidence, deliveryVerification: _deliveryVerification, ...toolArgs } = args;
	return toolArgs;
}

function output(input: Readonly<{
	node: WorkflowNodeSnapshot;
	executorRef: string;
	ports: Record<string, unknown>;
	artifacts?: WorkflowNodeOutputV1["artifacts"];
	evidence?: Record<string, unknown>;
	completed?: boolean;
}>): Extract<WorkflowNodeExecutionResult, { ok: true }> {
	return {
		ok: true,
		outputRefs: {
			protocolVersion: "1",
			executorRef: input.executorRef,
			nodeId: input.node.id,
			executionMode: "once",
			ports: input.ports,
			artifacts: input.artifacts ?? [],
			evidence: {
				executorCompleted: input.completed ?? true,
				...input.evidence,
			},
			itemRuns: [],
		},
	};
}

async function executeWorkflowPluginNode(
	context: WorkflowNodeExecutionContext,
	dependencies: WorkflowNodeExecutorDependencies,
	executorRef: string,
): Promise<WorkflowNodeExecutionResult> {
	const registry = dependencies.pluginRuntimeRegistry;
	if (!registry) {
		return {
			ok: false,
			errorCode: "workflow_node_executor_missing",
			errorMessage: `Workflow plugin executor registry is not configured (nodeId=${context.node.id})`,
		};
	}
	try {
		const result = await registry.execute({
			executorRef,
			executionId: context.executionId,
			nodeId: context.node.id,
			ownerId: context.ownerId,
			flowId: context.flowId,
			projectId: context.projectId,
			portInputs: context.inputs,
			config: context.node.data.workflowPluginConfig,
			previousEvidence: context.resumeOutputRefs?.evidence ?? null,
			...(context.abortSignal ? { abortSignal: context.abortSignal } : {}),
		});
		const evidence: Record<string, unknown> = {
			pluginExecutionStatus: result.status,
			pluginIdentity: {
				pluginId: result.executorRef.pluginId,
				pluginVersion: result.executorRef.pluginVersion,
				nodeType: result.executorRef.nodeType,
				nodeVersion: result.executorRef.nodeVersion,
				capabilityId: result.executorRef.capabilityId,
				capabilityVersion: result.executorRef.capabilityVersion,
			},
			pluginIdempotencyKey: result.idempotencyKey,
			pluginProviderReceipt: result.providerReceipt,
			pluginOwnerEvidence: result.evidence,
		};
		if (result.status === "unknown_outcome") evidence.pluginUnknownOutcomeReason = result.reason;
		if (result.status === "settled") {
			return output({
				node: context.node,
				executorRef,
				ports: { ...result.output },
				evidence,
			});
		}
		const pending = output({ node: context.node, executorRef, ports: {}, evidence }).outputRefs;
		return workflowNodeWaiting({
				...pending,
				evidence: { ...pending.evidence, executorCompleted: false },
			}, workflowExternalPollAfter(WORKFLOW_PROVIDER_STATUS_POLL_MS));
	} catch (error: unknown) {
		return {
			ok: false,
			errorCode: "workflow_node_runtime_failed",
			errorMessage: `Workflow plugin node ${context.node.id} failed: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

function valueAtConfiguredPath(value: unknown, path: string): unknown {
	if (!path) return value;
	let current = value;
	for (const segment of path.split(".")) {
		const normalizedSegment = segment.trim();
		if (!normalizedSegment) {
			throw new Error("Workflow collection path contains an empty segment");
		}
		if (Array.isArray(current)) {
			const index = Number(normalizedSegment);
			if (!Number.isInteger(index) || index < 0 || index >= current.length) {
				throw new Error(`Workflow collection path index ${normalizedSegment} does not exist`);
			}
			current = current[index];
			continue;
		}
		if (!isRecord(current) || !Object.prototype.hasOwnProperty.call(current, normalizedSegment)) {
			throw new Error(`Workflow collection path field ${normalizedSegment} does not exist`);
		}
		current = current[normalizedSegment];
	}
	return current;
}

function collectionSourceValue(data: Record<string, unknown>, rawInput: unknown): unknown {
	const path = readString(data, "workflowCollectionPath");
	const parseJson = data.workflowCollectionParseJson === true;
	const selected = valueAtConfiguredPath(rawInput, path);
	if (!parseJson) return selected;
	if (typeof selected !== "string") {
		throw new Error("Workflow collection JSON parsing requires the configured value to be a string");
	}
	try {
		return JSON.parse(selected) as unknown;
	} catch (error: unknown) {
		throw new Error(`Workflow collection input is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
	}
}

function collectionItemIds(values: readonly unknown[], itemIdField: string): readonly string[] | undefined {
	if (!itemIdField) return undefined;
	return values.map((value, index) => {
		if (!isRecord(value)) {
			throw new Error(`Workflow collection item ${index + 1} must be an object when itemIdField is configured`);
		}
		const itemId = value[itemIdField];
		if (typeof itemId !== "string" || !itemId.trim()) {
			throw new Error(`Workflow collection item ${index + 1} has no non-empty string field ${itemIdField}`);
		}
		return itemId.trim();
	});
}

function collectionSplitPayload(input: Readonly<{
	data: Record<string, unknown>;
	rawInput: unknown;
}>): Readonly<{
	values: readonly unknown[];
	itemIds?: readonly string[];
	parentLineage?: readonly (readonly WorkflowItemLineageV1[])[];
}> {
	const itemIdField = readString(input.data, "workflowCollectionItemIdField");
	if (!isWorkflowCollection(input.rawInput)) {
		const selected = collectionSourceValue(input.data, input.rawInput);
		if (!Array.isArray(selected)) {
			throw new Error("Workflow collection split requires an array at the configured path");
		}
		const itemIds = collectionItemIds(selected, itemIdField);
		return { values: selected, ...(itemIds ? { itemIds } : {}) };
	}

	const flattened = input.rawInput.items.flatMap((sourceItem) => {
		const selected = collectionSourceValue(input.data, sourceItem.value);
		if (!Array.isArray(selected)) {
			throw new Error(
				`Workflow collection split source item ${sourceItem.itemId} requires an array at the configured path`,
			);
		}
		return selected.map((value) => ({ value, lineage: sourceItem.lineage }));
	});
	const values = flattened.map((item) => item.value);
	const itemIds = collectionItemIds(values, itemIdField);
	return {
		values,
		...(itemIds ? { itemIds } : {}),
		parentLineage: flattened.map((item) => item.lineage),
	};
}

function parseDeliveryVerification(value: unknown): { status: string } | null {
	if (!isRecord(value)) return null;
	return typeof value.status === "string" ? { status: value.status } : null;
}

type FlowPatchDeliveryReceipt = Readonly<{
	targetNodeId: string;
	contentLength: number;
	updatedAt: string | null;
}>;

/**
 * Verify a flow-patch write from the persisted read-back receipt.  This is a
 * structural delivery check: it proves that the configured node was patched
 * and now has non-empty text.  It intentionally does not score or judge the
 * text itself.
 */
function verifyFlowPatchDeliveryReceipt(
	result: unknown,
	targetNodeId: string,
): FlowPatchDeliveryReceipt | null {
	if (!isRecord(result) || result.ok !== true) return null;
	const snapshots = result.patchedNodeSnapshots;
	if (!Array.isArray(snapshots)) return null;
	const target = snapshots.find((snapshot) => (
		isRecord(snapshot) && snapshot.id === targetNodeId
	));
	if (!isRecord(target) || !isRecord(target.data)) return null;
	const content = typeof target.data.content === "string" ? target.data.content.trim() : "";
	if (!content) return null;
	const updatedAt = typeof result.updatedAt === "string" && result.updatedAt.trim()
		? result.updatedAt.trim()
		: null;
	return {
		targetNodeId,
		contentLength: content.length,
		updatedAt,
	};
}

type WorkflowAgentTerminalStatus = "succeeded" | "suspended" | "needs_input" | "failed";

function parseAgentRequestTerminal(value: unknown): Readonly<{
	status: WorkflowAgentTerminalStatus;
	reason: string;
}> | null {
	if (!isRecord(value)) return null;
	const rawStatus = typeof value.status === "string" ? value.status.trim() : "";
	if (
		rawStatus !== "succeeded"
		&& rawStatus !== "suspended"
		&& rawStatus !== "needs_input"
		&& rawStatus !== "failed"
	) return null;
	return {
		status: rawStatus,
		reason: typeof value.reason === "string" && value.reason.trim()
			? value.reason.trim()
			: "agents_cli_request_terminal_reason_missing",
	};
}

function projectWorkflowAtomicDelivery(input: Readonly<{
	taskId: string;
	instruction: string;
	outputArtifactType: string;
	outputEncoding: WorkflowAgentOutputEncoding;
	deliveryRequirement: string;
	validatedText: string;
	terminalReason: string;
}>): Readonly<{
	expectedDelivery: Readonly<Record<string, unknown>>;
	deliveryEvidence: Readonly<Record<string, unknown>>;
	deliveryVerification: Readonly<Record<string, unknown>>;
}> {
	const deliveryEvidence = {
		version: 1,
		source: "workflow_atomic_output_contract",
		taskId: input.taskId,
		outputArtifactType: input.outputArtifactType,
		outputEncoding: input.outputEncoding,
		outputCharacterCount: input.validatedText.length,
		agentsTerminalReason: input.terminalReason,
	};
	return {
		expectedDelivery: {
			version: 1,
			taskGoal: input.instruction,
			requestedOutput: input.outputArtifactType,
			successCriteria: [input.deliveryRequirement],
			requiresExecutionDelivery: false,
		},
		deliveryEvidence,
		deliveryVerification: {
			version: 2,
			status: "satisfied",
			verifiedBy: "workflow_atomic_output_contract",
			evidence: deliveryEvidence,
		},
	};
}

function previousAgentEvidence(context: WorkflowNodeExecutionContext): Record<string, unknown> | null {
	if (!context.resumeOutputRefs) return null;
	if (context.resumeOutputRefs.nodeId === context.node.id) return context.resumeOutputRefs.evidence;
	const previousItemRun = context.resumeOutputRefs.itemRuns.find(
		(run) => run.runtimeNodeId === context.node.id,
	);
	return previousItemRun?.evidence ?? null;
}

function typedAgentResultSuspensionIsContinuable(
	deliveryEvidence: unknown,
	requestTerminal: ReturnType<typeof parseAgentRequestTerminal>,
): boolean {
	if (requestTerminal?.status !== "suspended" || !isRecord(deliveryEvidence)) return false;
	if (deliveryEvidence.retryablePhysicalFailure === true) return true;
	if (isRecord(deliveryEvidence.recoveryCheckpoint)) return true;
	return deliveryEvidence.source === "agents_cli_durable_turn_status"
		&& (deliveryEvidence.state === "running"
			|| deliveryEvidence.state === "suspended"
			|| deliveryEvidence.state === "unknown");
}

function explicitProviderClipFacts(inputs: WorkflowInputPorts): Readonly<{
	count: number;
	durations: readonly number[];
}> | null {
	for (const value of inputs["delivery-contract"] ?? []) {
		try {
			const plan = parseWorkflowVideoDeliveryDurationPlan(value);
			const topology = plan.providerSubmissionTopology;
			if (!topology) return null;
			return { count: topology.expectedClipCount, durations: topology.minimumClipDurations };
		} catch {
			continue;
		}
	}
	return null;
}

function requestedProviderClipCount(inputs: WorkflowInputPorts): number | null {
	for (const value of inputs["delivery-contract"] ?? []) {
		if (!isRecord(value) || !isRecord(value.generationContract)) continue;
		const requestedClipCount = value.generationContract.requestedClipCount;
		if (
			typeof requestedClipCount === "number"
			&& Number.isInteger(requestedClipCount)
			&& requestedClipCount > 0
		) return requestedClipCount;
	}
	return null;
}

function allowedProviderClipDurations(inputs: WorkflowInputPorts): readonly number[] | null {
	for (const value of inputs["delivery-contract"] ?? []) {
		try {
			return parseWorkflowVideoDeliveryDurationPlan(value).durationOptions;
		} catch {
			continue;
		}
	}
	return null;
}

function workflowAgentOutputContractFailure(error: unknown): string | null {
	if (!isRecord(error) || error.code !== "structured_output_invalid") return null;
	if (error instanceof Error && error.message.trim()) return error.message.trim();
	const message = typeof error.message === "string" ? error.message.trim() : "";
	return message || "Workflow Agent structured output is not executable";
}

function persistentHttpUrl(value: unknown): string | null {
	const candidate = typeof value === "string"
		? value.trim()
		: isRecord(value) && typeof value.videoUrl === "string"
			? value.videoUrl.trim()
			: isRecord(value) && typeof value.imageUrl === "string"
				? value.imageUrl.trim()
			: "";
	if (!candidate) return null;
	try {
		const parsed = new URL(candidate);
		return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
	} catch {
		return null;
	}
}

function requiredPositiveInteger(data: Record<string, unknown>, field: string): number {
	const raw = data[field];
	const value = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() ? Number(raw) : Number.NaN;
	if (!Number.isInteger(value) || value <= 0) throw new Error(`${field} must be a positive integer`);
	return value;
}

function requiredAgentMaxOutputTokens(data: Record<string, unknown>): number {
	const value = requiredPositiveInteger(data, "workflowAgentMaxOutputTokens");
	if (value < WORKFLOW_AGENT_MAX_OUTPUT_TOKENS_MIN || value > WORKFLOW_AGENT_MAX_OUTPUT_TOKENS_MAX) {
		throw new Error(
			`workflowAgentMaxOutputTokens must be between ${WORKFLOW_AGENT_MAX_OUTPUT_TOKENS_MIN} and ${WORKFLOW_AGENT_MAX_OUTPUT_TOKENS_MAX}`,
		);
	}
	return value;
}

function optionalAgentReasoningEffort(
	data: Record<string, unknown>,
): WorkflowAgentReasoningEffort | undefined {
	const raw = data.workflowAgentReasoningEffort;
	if (raw === undefined) return undefined;
	if (
		raw === "none"
		|| raw === "minimal"
		|| raw === "low"
		|| raw === "medium"
		|| raw === "high"
		|| raw === "xhigh"
		|| raw === "max"
	) return raw;
	throw new Error(
		"workflowAgentReasoningEffort must be none/minimal/low/medium/high/xhigh/max",
	);
}

function videoPrompt(inputs: WorkflowInputPorts): string {
	const value = firstInput(inputs, "prompt") ?? firstInput(inputs, "production-plan");
	if (typeof value === "string" && value.trim()) return value.trim();
	if (isRecord(value) && typeof value.prompt === "string" && value.prompt.trim()) return value.prompt.trim();
	if (isRecord(value) && typeof value.text === "string" && value.text.trim()) return value.text.trim();
	throw new Error("Video generation requires a non-empty prompt string or Agent result text");
}

function videoGenerationParameter(
	inputs: WorkflowInputPorts,
	data: Record<string, unknown>,
	inputField: string,
	dataField: string,
): unknown {
	const productionPlan = firstInput(inputs, "production-plan");
	return isRecord(productionPlan) && Object.prototype.hasOwnProperty.call(productionPlan, inputField)
		? productionPlan[inputField]
		: data[dataField];
}

function imagePromptPackage(inputs: WorkflowInputPorts): Readonly<{ prompt: string; negativePrompt: string }> {
	const value = firstInput(inputs, "prompt-package") ?? firstInput(inputs, "asset-items");
	if (isRecord(value) && (Object.prototype.hasOwnProperty.call(value, "prompt") || Object.prototype.hasOwnProperty.call(value, "negativePrompt"))) {
		const prompt = readString(value, "prompt");
		const negativePrompt = readString(value, "negativePrompt");
		if (!prompt || !negativePrompt) throw new Error("Image prompt package requires non-empty prompt and negativePrompt fields");
		const identityAnchors = Array.isArray(value.identityAnchors)
			? uniqueStrings(value.identityAnchors.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0))
			: [];
		const prohibitedDrift = Array.isArray(value.prohibitedDrift)
			? uniqueStrings(value.prohibitedDrift.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0))
			: [];
		const isCharacterIdentityAnchor =
			readString(value, "referenceType") === "character"
			&& readString(value, "characterAssetRole") === "identity_anchor"
			&& readString(value, "characterProfileVersion") === "character-card/v3";
		if (isCharacterIdentityAnchor && (identityAnchors.length === 0 || prohibitedDrift.length === 0)) {
			throw new Error("Character identity anchor image requires non-empty identityAnchors and prohibitedDrift");
		}

		return { prompt, negativePrompt };
	}
	const raw = typeof value === "string"
		? value
		: isRecord(value) && typeof value.text === "string"
			? value.text
			: "";
	if (!raw.trim()) throw new Error("Image generation requires an Agent JSON prompt package");
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (error: unknown) {
		throw new Error(`Image prompt package is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (!isRecord(parsed)) throw new Error("Image prompt package must be a JSON object");
	const prompt = readString(parsed, "prompt");
	const negativePrompt = readString(parsed, "negativePrompt");
	if (!prompt || !negativePrompt) throw new Error("Image prompt package requires non-empty prompt and negativePrompt fields");
	const unexpectedField = Object.keys(parsed).find((field) => field !== "prompt" && field !== "negativePrompt");
	if (unexpectedField) throw new Error(`Image prompt package contains unexpected field ${unexpectedField}`);
	return { prompt, negativePrompt };
}

function imageReferenceAssetBindings(data: Record<string, unknown>): readonly WorkflowImageReferenceAssetBinding[] {
	const raw = data.workflowImageReferenceAssetBindings;
	if (!Array.isArray(raw)) throw new Error("Workflow image node requires an explicit reference asset binding array");
	const bindings = raw.map((value, index): WorkflowImageReferenceAssetBinding => {
		if (!isRecord(value)) throw new Error(`Workflow image reference binding ${index + 1} must be an object`);
		const assetId = readString(value, "assetId");
		const role = readString(value, "role");
		if (!assetId || !IMAGE_REFERENCE_ROLES.includes(role as typeof IMAGE_REFERENCE_ROLES[number])) {
			throw new Error(`Workflow image reference binding ${index + 1} has invalid assetId or role`);
		}
		const strength = value.strength;
		if (strength !== undefined && (typeof strength !== "number" || !Number.isFinite(strength) || strength < 0 || strength > 1)) {
			throw new Error(`Workflow image reference binding ${index + 1} strength must be between 0 and 1`);
		}
		return { assetId, role: role as typeof IMAGE_REFERENCE_ROLES[number], ...(typeof strength === "number" ? { strength } : {}) };
	});
	if (new Set(bindings.map((binding) => binding.assetId)).size !== bindings.length) {
		throw new Error("Workflow image reference binding asset IDs must be unique");
	}
	return bindings;
}

export function workflowImageAssetMetadata(value: unknown): Readonly<Record<string, unknown>> | null {
	if (!isRecord(value)) return null;
	if (value.assetPurpose === "blocking_background") {
		const displayName = readString(value, "displayName");
		const sourcePlanAssetId = readString(value, "assetId");
		if (!displayName || !sourcePlanAssetId) throw new Error("Background asset requires its authored name and plan identity");
		return { referenceType: "scene", assetPurpose: "blocking_background",
			displayName, canonicalName: displayName, sceneName: displayName, sourcePlanAssetId };
	}
	const role = readString(value, "role");
	if (!role) return null;
	const parsedRole = parseWorkflowAssetRole(role, "Workflow image asset plan role");
	const displayName = readString(value, "displayName");
	if (!displayName) throw new Error("Workflow image asset plan requires a frozen displayName");
	if (parsedRole.kind !== "character") {
		return {
			referenceType: parsedRole.kind,
			canonicalName: parsedRole.name,
			displayName,
			...(parsedRole.kind === "scene" ? { ...projectSceneReferenceMetadata(value), sceneName: parsedRole.name } : {}),
			...(parsedRole.kind === "prop" ? { propName: parsedRole.name } : {}),
		};
	}
	if (readString(value, "referenceType") !== "character") return null;
	const roleName = readString(value, "roleName");
	const characterAssetRole = readString(value, "characterAssetRole");
	const characterProfileVersion = readString(value, "characterProfileVersion");
	const identityBoardSpec = parseCharacterIdentityBoardSpec(
		value.identityBoardSpec,
		"Workflow image asset plan identityBoardSpec",
	);
	const identityAnchors = Array.isArray(value.identityAnchors)
		? uniqueStrings(value.identityAnchors.flatMap((entry) => typeof entry === "string" && entry.trim() ? [entry.trim()] : []))
		: [];
	const prohibitedDrift = Array.isArray(value.prohibitedDrift)
		? uniqueStrings(value.prohibitedDrift.flatMap((entry) => typeof entry === "string" && entry.trim() ? [entry.trim()] : []))
		: [];
	if (
		!roleName
		|| characterAssetRole !== "identity_anchor"
		|| characterProfileVersion !== "character-card/v3"
		|| identityAnchors.length === 0
		|| prohibitedDrift.length === 0
	) {
		throw new Error("Workflow character image requires a normalized character-card/v3 identity contract");
	}
	return {
		referenceType: "character",
		canonicalName: parsedRole.name,
		displayName,
		roleName,
		physicalIdentityKey: parsedRole.name,
		characterAssetRole: "identity_anchor",
		characterProfileVersion: "character-card/v3",
		...(identityBoardSpec ? { identityBoardSpec } : {}),
		identityAnchors,
		prohibitedDrift,
	};
}

async function executeRegisteredWorkflowNodeOnce(
	context: WorkflowNodeExecutionContext,
	dependencies: WorkflowNodeExecutorDependencies,
): Promise<WorkflowNodeExecutionResult> {
	const unsupported = workflowNodeExecutionFailure(context.node);
	if (unsupported) return unsupported;
	const executorRef = resolveWorkflowNodeExecutorRef(context.node);
	if (!executorRef) {
		return {
			ok: false,
			errorCode: "workflow_node_executor_missing",
			errorMessage: `Workflow node ${context.node.id} has no executorRef`,
		};
	}
	const data = context.node.data;
	if (hasWorkflowPluginExecutorRefPrefix(executorRef)) {
		return executeWorkflowPluginNode(context, dependencies, executorRef);
	}

	if (executorRef === "workflow.trigger/v1") {
		const configuredPayload = data.workflowTriggerPayload;
		return output({
			node: context.node,
			executorRef,
			ports: {
				trigger: configuredPayload === undefined || configuredPayload === null ? {
					executionId: context.executionId,
					triggerNodeId: context.node.id,
					occurredAt: new Date().toISOString(),
				} : configuredPayload,
			},
		});
	}

	if (executorRef === "workflow.input.text/v1") {
		const trigger = firstInput(context.inputs, "trigger");
		const triggerSource = isRecord(trigger) ? readString(trigger, "source") : "";
		const text = readString(data, "workflowTextInput") || readString(data, "prompt") || readString(data, "content") || triggerSource;
		if (!text) {
			return {
				ok: false,
				errorCode: "workflow_node_runtime_failed",
				errorMessage: `Workflow text input node ${context.node.id} has no text`,
			};
		}
		return output({
			node: context.node,
			executorRef,
			ports: { text },
			artifacts: [{ type: "tapcanvas.text/v1", identity: null, value: text }],
		});
	}

	if (executorRef === "workflow.input/v1") {
		const facts = readString(data, "workflowInputDescription");
		return output({ node: context.node, executorRef, ports: { "input-facts": facts } });
	}

	if (executorRef === "workflow.script.javascript/v1") {
		const code = readString(data, "workflowJavascriptCode");
		if (!code) {
			return { ok: false, errorCode: "workflow_node_runtime_failed", errorMessage: `Workflow JavaScript node ${context.node.id} has no code` };
		}
		const javascriptResult = await dependencies.runJavascript({
			code,
			input: firstInput(context.inputs, "input"),
		});
		const rawInput = firstInput(context.inputs, "input");
		const deliveryMetadata = isRecord(rawInput)
			? {
				...(rawInput.deliveryEvidence !== undefined ? { deliveryEvidence: rawInput.deliveryEvidence } : {}),
				...(rawInput.deliveryVerification !== undefined ? { deliveryVerification: rawInput.deliveryVerification } : {}),
			}
			: {};
		const outputValue = Object.keys(deliveryMetadata).length > 0 && isRecord(javascriptResult.output)
			? { ...javascriptResult.output, ...deliveryMetadata }
			: javascriptResult.output;
		return output({
			node: context.node,
			executorRef,
			ports: { result: outputValue },
			artifacts: [{ type: "tapcanvas.json/v1", identity: null, value: outputValue }],
			evidence: { durationMs: javascriptResult.durationMs, isolation: "local-child-process" },
		});
	}

	if (executorRef === "video.clip-design-inputs/v1" || executorRef === "video.beat-sheet.assemble/v1") {
		try {
			const plan = parseChapterBeatPlan(firstInput(context.inputs, "chapter-plan"));
			const assets = parseChapterAssetPlan(firstInput(context.inputs, "chapter-assets"));
			if (executorRef === "video.clip-design-inputs/v1") {
				const values = buildClipDesignInputs(plan, assets);
				const collection = createWorkflowCollection({ collectionId: `${context.executionId}:${context.node.id}:clips`,
					producerNodeId: context.node.id, producerPortId: "clip-design-inputs", values,
					itemIds: values.map(value => `${plan.sourceFingerprint}:clip:${value.clipIndex}`) });
				return output({ node: context.node, executorRef, ports: { "clip-design-inputs": collection },
					artifacts: [{ type: "tapcanvas.clip-design-inputs/v1", identity: collection.collectionId, value: collection }],
					evidence: { itemCount: values.length } });
			}
			const collection = firstInput(context.inputs, "clip-designs");
			if (!isWorkflowCollection(collection)) throw new Error("clip-designs must be a persisted workflow collection");
			const designed = assembleDesignedBeatSheet(plan, assets, collection.items.map(item => parseClipDesign(item.value)));
			const contract = applyWorkflowArtifactJsonObjectContract("tapcanvas.beat-sheet/v2", {
				contractName: BEAT_SHEET_ARTIFACT_CONTRACT_NAME,
				contractVersion: BEAT_SHEET_ARTIFACT_CONTRACT_VERSION,
				requiredStringFields: ["protocolVersion", "sourceId", "sourceFingerprint"],
				requiredArrayFields: ["beats", "objectRegistry", "assetPlans", "blockingPlans"],
				allowedFields: Object.keys(designed),
			});
			const checked = validateWorkflowAgentOutput({ rawText: JSON.stringify(designed), encoding: "json_object",
				artifactType: "tapcanvas.beat-sheet/v2", jsonObjectContract: contract });
			if (!checked.ok) throw new Error(`assembled BeatSheet: ${checked.errorMessage}`);
			const artifact = { text: checked.text };
			return output({ node: context.node, executorRef, ports: { "beat-sheet": artifact },
				artifacts: [{ type: "tapcanvas.beat-sheet/v2", identity: null, value: checked.text }],
				evidence: { itemCount: collection.items.length, assembly: "identity_join" } });
		} catch (error: unknown) {
			return { ok: false, errorCode: "workflow_node_runtime_failed", errorMessage: error instanceof Error ? error.message : String(error) };
		}
	}

	if (executorRef === "workflow.collection.split/v1") {
		let splitPayload: ReturnType<typeof collectionSplitPayload>;
		try {
			splitPayload = collectionSplitPayload({
				data,
				rawInput: firstDeclaredInput(context),
			});
		} catch (error: unknown) {
			return {
				ok: false,
				errorCode: "workflow_node_runtime_failed",
				errorMessage: error instanceof Error ? error.message : String(error),
			};
		}
		const outputPort = primaryOutputPort(data, "items");
		const collection = createWorkflowCollection({
			collectionId: `${context.executionId}:${context.node.id}:items`,
			producerNodeId: context.node.id,
			producerPortId: outputPort,
			values: splitPayload.values,
			...(splitPayload.itemIds ? { itemIds: splitPayload.itemIds } : {}),
			...(splitPayload.parentLineage ? { parentLineage: splitPayload.parentLineage } : {}),
		});
		return output({
			node: context.node,
			executorRef,
			ports: { [outputPort]: collection },
			artifacts: [{ type: "tapcanvas.workflow-collection/v1", identity: collection.collectionId, value: collection }],
			evidence: { itemCount: collection.items.length },
		});
	}

	if (executorRef === "workflow.collection.take/v1") {
		const rawCount = data.workflowCollectionTakeCount;
		if (!Number.isInteger(rawCount) || Number(rawCount) < 1 || Number(rawCount) > 1_000) {
			return {
				ok: false,
				errorCode: "workflow_node_runtime_failed",
				errorMessage: `Workflow collection take node ${context.node.id} requires workflowCollectionTakeCount between 1 and 1000`,
			};
		}
		const inputCollection = firstDeclaredInput(context);
		if (!isWorkflowCollection(inputCollection)) {
			return {
				ok: false,
				errorCode: "workflow_node_runtime_failed",
				errorMessage: `Workflow collection take node ${context.node.id} requires a workflow collection on items`,
			};
		}
		const selectedItems = inputCollection.items.slice(0, Number(rawCount));
		const outputPort = primaryOutputPort(data, "items");
		const collection = createWorkflowCollection({
			collectionId: `${context.executionId}:${context.node.id}:${outputPort}`,
			producerNodeId: context.node.id,
			producerPortId: outputPort,
			values: selectedItems.map((item) => item.value),
			itemIds: selectedItems.map((item) => item.itemId),
			parentLineage: selectedItems.map((item) => item.lineage),
		});
		return output({
			node: context.node,
			executorRef,
			ports: { [outputPort]: collection },
			artifacts: [{ type: "tapcanvas.workflow-collection/v1", identity: collection.collectionId, value: collection }],
			evidence: {
				sourceCollectionId: inputCollection.collectionId,
				sourceItemCount: inputCollection.items.length,
				selectedItemCount: collection.items.length,
				requestedItemCount: Number(rawCount),
			},
		});
	}

	if (executorRef === "workflow.collection.drop/v1") {
		const rawCount = data.workflowCollectionDropCount;
		if (!Number.isInteger(rawCount) || Number(rawCount) < 1 || Number(rawCount) > 1_000) {
			return {
				ok: false,
				errorCode: "workflow_node_runtime_failed",
				errorMessage: `Workflow collection drop node ${context.node.id} requires workflowCollectionDropCount between 1 and 1000`,
			};
		}
		const inputCollection = firstDeclaredInput(context);
		if (!isWorkflowCollection(inputCollection)) {
			return {
				ok: false,
				errorCode: "workflow_node_runtime_failed",
				errorMessage: `Workflow collection drop node ${context.node.id} requires a workflow collection on items`,
			};
		}
		const selectedItems = inputCollection.items.slice(Number(rawCount));
		const outputPort = primaryOutputPort(data, "items");
		const collection = createWorkflowCollection({
			collectionId: `${context.executionId}:${context.node.id}:${outputPort}`,
			producerNodeId: context.node.id,
			producerPortId: outputPort,
			values: selectedItems.map((item) => item.value),
			itemIds: selectedItems.map((item) => item.itemId),
			parentLineage: selectedItems.map((item) => item.lineage),
		});
		return output({
			node: context.node,
			executorRef,
			ports: { [outputPort]: collection },
			artifacts: [{ type: "tapcanvas.workflow-collection/v1", identity: collection.collectionId, value: collection }],
			evidence: {
				sourceCollectionId: inputCollection.collectionId,
				sourceItemCount: inputCollection.items.length,
				droppedItemCount: inputCollection.items.length - collection.items.length,
				remainingItemCount: collection.items.length,
				requestedDropCount: Number(rawCount),
			},
		});
	}

	if (executorRef === "workflow.collection.concat/v1") {
		const inputCollections = Object.values(context.inputs).flat();
		if (inputCollections.length === 0 || inputCollections.some((value) => !isWorkflowCollection(value))) {
			return {
				ok: false,
				errorCode: "workflow_node_runtime_failed",
				errorMessage: `Workflow collection concat node ${context.node.id} requires one or more workflow collections on items`,
			};
		}
		const collections = inputCollections.filter(isWorkflowCollection);
		const sourceItems = collections.flatMap((collection) => collection.items);
		const duplicateItemId = sourceItems.find((item, index) => (
			sourceItems.findIndex((candidate) => candidate.itemId === item.itemId) !== index
		));
		if (duplicateItemId) {
			return {
				ok: false,
				errorCode: "workflow_node_runtime_failed",
				errorMessage: `Workflow collection concat node ${context.node.id} received duplicate itemId ${duplicateItemId.itemId}`,
			};
		}
		const outputPort = primaryOutputPort(data, "items");
		const collection = createWorkflowCollection({
			collectionId: `${context.executionId}:${context.node.id}:${outputPort}`,
			producerNodeId: context.node.id,
			producerPortId: outputPort,
			values: sourceItems.map((item) => item.value),
			itemIds: sourceItems.map((item) => item.itemId),
			parentLineage: sourceItems.map((item) => item.lineage),
		});
		return output({
			node: context.node,
			executorRef,
			ports: { [outputPort]: collection },
			artifacts: [{ type: "tapcanvas.workflow-collection/v1", identity: collection.collectionId, value: collection }],
			evidence: {
				sourceCollectionIds: collections.map((value) => value.collectionId),
				sourceItemCounts: collections.map((value) => value.items.length),
				itemCount: collection.items.length,
			},
		});
	}

	if (executorRef === "workflow.collection.empty/v1") {
		const outputPort = primaryOutputPort(data, "items");
		const collection = createWorkflowCollection({
			collectionId: `${context.executionId}:${context.node.id}:${outputPort}`,
			producerNodeId: context.node.id,
			producerPortId: outputPort,
			values: [],
		});
		return output({
			node: context.node,
			executorRef,
			ports: { [outputPort]: collection },
			artifacts: [{ type: "tapcanvas.workflow-collection/v1", identity: collection.collectionId, value: collection }],
			evidence: { itemCount: 0 },
		});
	}

	if (executorRef === BEAT_SHEET_TAKE_EXECUTOR_REF) {
		const rawCount = data.workflowBeatSheetTakeCount;
		if (!Number.isInteger(rawCount) || Number(rawCount) < 1 || Number(rawCount) > 1_000) {
			return {
				ok: false,
				errorCode: "workflow_node_runtime_failed",
				errorMessage: `Video BeatSheet take node ${context.node.id} requires workflowBeatSheetTakeCount between 1 and 1000`,
			};
		}
		const source = firstInput(context.inputs, "beat-sheet");
		const sourceText = typeof source === "string"
			? source.trim()
			: isRecord(source)
				? readString(source, "text")
				: "";
		if (!sourceText) {
			return {
				ok: false,
				errorCode: "workflow_node_runtime_failed",
				errorMessage: `Video BeatSheet take node ${context.node.id} requires a non-empty BeatSheet text payload`,
			};
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(sourceText);
		} catch (error: unknown) {
			return {
				ok: false,
				errorCode: "workflow_node_runtime_failed",
				errorMessage: `Video BeatSheet take node ${context.node.id} received invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
			};
		}
		if (!isRecord(parsed) || !Array.isArray(parsed.beats) || parsed.beats.length === 0) {
			return {
				ok: false,
				errorCode: "workflow_node_runtime_failed",
				errorMessage: `Video BeatSheet take node ${context.node.id} requires a non-empty beats array`,
			};
		}
		const selectedBeats = parsed.beats.slice(0, Number(rawCount));
		const selectedClipIndexes = new Set(selectedBeats.flatMap((beat) => {
			if (!isRecord(beat)) return [];
			return Number.isInteger(beat.clipIndex) ? [Number(beat.clipIndex)] : [];
		}));
		const sourceCoveragePlan = isRecord(parsed.sourceCoveragePlan)
			? parsed.sourceCoveragePlan
			: null;
		const speechLedger = Array.isArray(sourceCoveragePlan?.speechLedger)
			? sourceCoveragePlan.speechLedger.filter((line) => (
				isRecord(line)
				&& Number.isInteger(line.clipIndex)
				&& selectedClipIndexes.has(Number(line.clipIndex))
			))
			: null;
		const selectedBeatSheet = {
			...parsed,
			...(sourceCoveragePlan && speechLedger
				? { sourceCoveragePlan: { ...sourceCoveragePlan, speechLedger } }
				: {}),
			beats: selectedBeats,
		};
		const projectedValue = {
			...(isRecord(source) && typeof source.taskId === "string" ? { sourceTaskId: source.taskId } : {}),
			text: JSON.stringify(selectedBeatSheet),
			assets: isRecord(source) && Array.isArray(source.assets) ? source.assets : [],
			// Keep the upstream author's retrieval receipts attached to the immutable
			// BeatSheet projection.  The take node is a structural prefix operation;
			// it must not turn a successfully read Skill/knowledge body into an
			// untraceable, empty Clip-writer context.
			...(isRecord(source) && isRecord(source.executionProvenance)
				? { executionProvenance: source.executionProvenance }
				: {}),
			...(isRecord(source) && Array.isArray(source.executionProvenanceHistory)
				? { executionProvenanceHistory: source.executionProvenanceHistory }
				: {}),
			...(isRecord(source) && isRecord(source.knowledgeCandidateSearch)
				? { knowledgeCandidateSearch: source.knowledgeCandidateSearch }
				: {}),
			...(isRecord(source) && isRecord(source.promptExampleCandidateSearch)
				? { promptExampleCandidateSearch: source.promptExampleCandidateSearch }
				: {}),
			...(isRecord(source) && Array.isArray(source.retrievalCandidateSets)
				? { retrievalCandidateSets: source.retrievalCandidateSets }
				: {}),
			beatSheetProjection: {
				protocolVersion: "tapcanvas.beat-sheet-projection/v1",
				selection: "prefix",
				requestedBeatCount: Number(rawCount),
				selectedBeatCount: selectedBeats.length,
				sourceBeatCount: parsed.beats.length,
			},
		};
		const outputPort = primaryOutputPort(data, "beat-sheet");
		return output({
			node: context.node,
			executorRef,
			ports: { [outputPort]: projectedValue },
			artifacts: [{
				type: "tapcanvas.beat-sheet-slice/v1",
				identity: `${context.executionId}:${context.node.id}:${outputPort}`,
				value: projectedValue,
			}],
			evidence: {
				sourceBeatCount: parsed.beats.length,
				selectedBeatCount: selectedBeats.length,
				requestedBeatCount: Number(rawCount),
			},
		});
	}

    if (executorRef === "tapcanvas.chapter-backgrounds.split/v1") {
        try {
            const assets = parseChapterAssetPlan(firstInput(context.inputs, "chapter-assets"));
            const collection = blockingBackgroundPlanCollection(assets.backgroundPlans.map(item => item.plan), context.executionId, context.node.id);
            return output({ node: context.node, executorRef, ports: { "asset-items": collection }, artifacts: [{ type: "tapcanvas.asset-plan-items/v2", identity: collection.collectionId, value: collection }], evidence: { backgroundCount: collection.items.length } });
        } catch (error: unknown) { return workflowActionFailure(context.node, executorRef, error); }
    }

	if (executorRef === "tapcanvas.blocking-backgrounds.split/v1") {
		try {
			const collection = blockingBackgroundCollection(firstInput(context.inputs, "beat-sheet"), context.executionId, context.node.id);
			return output({ node: context.node, executorRef, ports: { "asset-items": collection }, artifacts: [{ type: "tapcanvas.asset-plan-items/v2", identity: collection.collectionId, value: collection }], evidence: { backgroundCount: collection.items.length } });
		} catch (error: unknown) {
			return workflowActionFailure(context.node, executorRef, error);
		}
	}

	if (executorRef === "tapcanvas.blocking-diagrams.materialize/v1") {
		if (!dependencies.materializeBlockingDiagrams) {
			return {
				ok: false,
				errorCode: "workflow_node_executor_missing",
				errorMessage: "Workflow blocking diagram materializer dependency is unavailable",
			};
		}
		const delivery = workflowDeliveryScope(context.flowVersionData);
		try {
			const result = await dependencies.materializeBlockingDiagrams({
				executionId: context.executionId,
				executionFamilyId: context.executionFamilyId,
				runtimeNodeId: context.node.id,
				ownerId: context.ownerId,
				flowId: delivery?.flowId ?? context.flowId,
				projectId: delivery?.projectId ?? context.projectId,
				chapterId: delivery?.chapterId ?? null,
				beatSheetArtifact: firstInput(context.inputs, "beat-sheet"),
				backgroundBindings: firstInput(context.inputs, "background-bindings"),
			});
			return output({
				node: context.node,
				executorRef,
				ports: { [primaryOutputPort(data, "beat-sheet")]: result.beatSheetArtifact },
				artifacts: [{
					type: "tapcanvas.beat-sheet/v2",
					identity: `${context.executionId}:${context.node.id}:beat-sheet`,
					value: result.beatSheetArtifact,
				}],
				evidence: {
					blockingDiagramCount: result.bindings.length,
					blockingDiagramNodeIds: result.bindings.map((binding) => binding.nodeId),
					reusedBlockingDiagramCount: result.bindings.filter((binding) => binding.reused).length,
				},
			});
		} catch (error: unknown) {
			return workflowActionFailure(context.node, executorRef, error);
		}
	}

	if (executorRef === "video.chapter-assets.prepare/v1") {
		try {
			const projectContext = runtimeProjectContext(context);
			if (!projectContext) throw new Error("Chapter asset preparation requires frozen project context");
			const collection = prepareChapterAssetCollection({
				assets: parseChapterAssetPlan(firstInput(context.inputs, "chapter-assets")),
				projectContext, executionId: context.executionId, nodeId: context.node.id,
			});
			return output({ node: context.node, executorRef, ports: { "asset-items": collection },
				artifacts: [{ type: "tapcanvas.asset-plan-items/v2", identity: collection.collectionId, value: collection }],
				evidence: { itemCount: collection.items.length, consumerBinding: "deferred_until_design" } });
		} catch (error: unknown) { return workflowActionFailure(context.node, executorRef, error); }
	}
	if (executorRef === "video.asset-consumers.bind/v1") {
		try {
			const collection = bindMaterializedAssetConsumers(firstInput(context.inputs, "asset-bindings"), firstInput(context.inputs, "asset-items"));
			return output({ node: context.node, executorRef, ports: { "asset-bindings": collection },
				artifacts: [{ type: "tapcanvas.asset-bindings/v1", identity: collection.collectionId, value: collection }],
				evidence: { itemCount: collection.items.length, binding: "exact_asset_identity" } });
		} catch (error: unknown) { return workflowActionFailure(context.node, executorRef, error); }
	}

	if (executorRef === "video.asset-plans.split/v1") {
		try {
			const collection = buildVideoAssetPlanCollection({
				executionId: context.executionId,
				nodeId: context.node.id,
				beatSheetAgentResult: firstInput(context.inputs, "beat-sheet"),
				assetAgentResult: firstInput(context.inputs, "asset-plans"),
				reusableAssetFacts: reusableWorkflowAssetRoleFacts(
					context.inputs,
					runtimeProjectContext(context),
					resolveVideoAssetRoleAllowlist(firstInput(context.inputs, "beat-sheet")),
				),
			});
			return output({
				node: context.node,
				executorRef,
				ports: { "asset-items": collection },
				artifacts: [{ type: "tapcanvas.asset-plan-items/v2", identity: collection.collectionId, value: collection }],
				evidence: {
					itemCount: collection.items.length,
					reusedItemCount: collection.items.filter((item) => isRecord(item.value) && Boolean(readString(item.value, "existingAssetId"))).length,
					generatedPlanItemCount: collection.items.filter((item) => !isRecord(item.value) || !readString(item.value, "existingAssetId")).length,
					consumerContractValidated: true,
				},
			});
		} catch (error: unknown) {
			return {
				ok: false,
				errorCode: "workflow_node_runtime_failed",
				errorMessage: error instanceof Error ? error.message : String(error),
			};
		}
	}

	if (executorRef === "video.asset-plans.project/v1") {
		try {
			const beatSheet = firstInput(context.inputs, "beat-sheet");
			const assetPlans = projectVideoAssetPlansFromBeatSheet(
				beatSheet,
				Object.keys(reusableWorkflowAssetRoleFacts(context.inputs, runtimeProjectContext(context), resolveVideoAssetRoleAllowlist(beatSheet))),
			);
			return output({
				node: context.node,
				executorRef,
				ports: { "asset-plans": assetPlans },
				artifacts: [{
					type: "tapcanvas.asset-plans/v1",
					identity: `${context.executionId}:${context.node.id}:asset-plans`,
					value: assetPlans,
				}],
				evidence: {
					projectedFromBeatSheet: true,
					creativeAgentCalls: 0,
				},
			});
		} catch (error: unknown) {
			return {
				ok: false,
				errorCode: "workflow_node_runtime_failed",
				errorMessage: error instanceof Error ? error.message : String(error),
			};
		}
	}

	if (executorRef === "tapcanvas.canvas.group.read/v1") {
		const sourceMode = readString(data, "workflowSourceMode") || "canvas_group";
		// 按次触发载荷：系统级共享工作流由小T在 triggerPayload 里注入本次源文本与
		// 目标参数；canvas-source 只做结构性读取，不承载语义判断。
		const triggerPayload = firstInput(context.inputs, "trigger");
		const callConfig = isRecord(triggerPayload) ? triggerPayload : null;
		const callSource = callConfig && typeof callConfig.source === "string"
			? callConfig.source.trim()
			: "";
		// 系统级交付（调用者在工作流项目之外）不允许回落到模板内嵌来源：
		// inline_text 必须显式提供本次源文本；canvas_group 必须显式绑定调用者
		// 当前画布内的组（triggerPayload.sourceGroupId），读取调用者项目真实
		// 节点（文本 + 已就绪图片/视频）作为源与参考资产，避免把管理员模板
		// 项目里的内容静默暴露给其他调用者。
		const delivery = workflowDeliveryScope(context.flowVersionData);
		if (delivery) {
			if (sourceMode === "inline_text" && !callSource) {
				return {
					ok: false,
					errorCode: "workflow_node_runtime_failed",
					errorMessage: "System-level workflow invocation requires triggerPayload.source; refusing to reuse the template inline source for another caller",
				};
			}
		}
		if (sourceMode === "inline_text") {
			const text = callSource || readString(data, "workflowSourceText");
			if (!text) {
				return { ok: false, errorCode: "workflow_node_runtime_failed", errorMessage: "Inline video workflow source text is empty" };
			}
			const canvasFacts: Record<string, unknown> = { sourceMode, text };
			if (callConfig) canvasFacts.callConfig = callConfig;
			return output({
				node: context.node,
				executorRef,
				ports: { "canvas-facts": canvasFacts },
				artifacts: [{ type: "tapcanvas.canvas-facts/v1", identity: context.node.id, value: canvasFacts }],
			});
		}
		if (sourceMode === "project_context") {
			const projectContext = runtimeProjectContext(context);
			if (!projectContext) {
				return {
					ok: false,
					errorCode: "workflow_project_context_required",
					errorMessage: "Project-context workflow source requires the frozen caller ProjectContext",
				};
			}
			let acceptedTurnSource: ReturnType<typeof parseWorkflowAcceptedTurnSource>;
			try {
				acceptedTurnSource = workflowAcceptedTurnSourceInput(context, callConfig);
				console.info("[workflow-source] accepted turn source resolution", {
					executionId: context.executionId,
					nodeId: context.node.id,
					callConfigKeys: callConfig ? Object.keys(callConfig) : [],
					accepted: Boolean(acceptedTurnSource),
				});
			} catch (error: unknown) {
				return {
					ok: false,
					errorCode: "workflow_node_runtime_failed",
					errorMessage: error instanceof Error ? error.message : String(error),
				};
			}
			const publicCallConfig = sanitizeWorkflowCallConfig(
				callConfig
					? Object.fromEntries(Object.entries(callConfig).filter(
						([field]) => field !== WORKFLOW_ACCEPTED_TURN_SOURCE_FIELD,
					))
					: null,
				projectContext,
			);
			if (!dependencies.readCanvasProjectContextFromSnapshot) {
				return {
					ok: false,
					errorCode: "workflow_node_executor_missing",
					errorMessage: "Caller canvas project-context reader dependency is unavailable",
				};
			}
			const sourceFlowId = delivery?.flowId ?? projectContext.canvasId;
			const facts = await dependencies.readCanvasProjectContextFromSnapshot({
				flowVersionData: context.flowVersionData,
				flowId: sourceFlowId,
				ownerId: context.ownerId,
				projectContext,
				chapterId: delivery?.chapterId ?? null,
				allowNoTextSource: Boolean(acceptedTurnSource),
				acceptedTurnSource,
			});
			let referenceVideoAnalyses: readonly Record<string, unknown>[] = [];
			if (facts.referenceVideoNodeIds && facts.referenceVideoNodeIds.length > 0) {
				if (!dependencies.invokeTool) {
					return {
						ok: false,
						errorCode: "workflow_node_executor_missing",
						errorMessage: "Reference video analysis requires the TapCanvas tool bridge",
					};
				}
				const analysisPrompt =
					"请逐秒拆解这段参考视频，输出可执行的复刻事实：镜头边界与景别、主体身份与位置、动作因果和受力、场景背景与空间关系、运镜、光线材质、剪辑/蒙太奇节奏、逐字对白与声音事件。只记录视频中确实出现的内容，不补写未观察到的剧情。";
				const analysisResults: Record<string, unknown>[] = [];
				for (const videoNodeId of facts.referenceVideoNodeIds) {
					const result = await dependencies.invokeTool({
						executionId: context.executionId,
						nodeId: context.node.id,
						ownerId: context.ownerId,
						projectId: delivery?.projectId ?? context.projectId,
						flowId: sourceFlowId,
						chapterId: delivery?.chapterId ?? null,
						toolName: "tapcanvas_analyze_video",
						args: { nodeId: videoNodeId, fps: 5, prompt: analysisPrompt },
					});
					const data = result.data ?? {};
					const text = typeof data.text === "string" && data.text.trim()
						? data.text.trim()
						: result.content.trim();
					if (!text) {
						return {
							ok: false,
							errorCode: "workflow_node_runtime_failed",
							errorMessage: `Reference video analysis returned no text for node ${videoNodeId}`,
						};
					}
					analysisResults.push({
						nodeId: videoNodeId,
						text,
						...(typeof data.model === "string" ? { model: data.model } : {}),
						...(typeof data.fps === "number" ? { fps: data.fps } : {}),
						...(typeof data.analysisHash === "string" ? { analysisHash: data.analysisHash } : {}),
						...(typeof data.promptHash === "string" ? { promptHash: data.promptHash } : {}),
						...(typeof data.segmentCount === "number" ? { segmentCount: data.segmentCount } : {}),
					});
				}
				referenceVideoAnalyses = analysisResults;
			}
			const userRequest = acceptedTurnSource
				? {
					kind: "public_chat_turn" as const,
					requestId: acceptedTurnSource.sourceId,
					content: acceptedTurnSource.text,
					requestFingerprint: acceptedTurnSource.fingerprint,
				}
				: null;
			const canvasFacts = {
				...facts,
				...(referenceVideoAnalyses.length > 0 ? { referenceVideoAnalyses } : {}),
				...(userRequest ? { userRequest } : {}),
				...(publicCallConfig && Object.keys(publicCallConfig).length > 0
					? { callConfig: publicCallConfig }
					: {}),
			};
			return output({
				node: context.node,
				executorRef,
				ports: { "canvas-facts": canvasFacts },
				artifacts: [{ type: "tapcanvas.canvas-facts/v1", identity: `${sourceFlowId}:project-context`, value: canvasFacts }],
				evidence: {
					sourceMode,
					sourceFlowId,
					sourceReadBoundary: "acceptance_snapshot",
					sourceNodeIds: facts.sourceNodeIds,
					sourceNodeCount: facts.nodes.length,
					selectedNodeFactCount: facts.selectedNodeFacts?.length ?? 0,
					missingSelectedNodeIds: facts.missingSelectedNodeIds ?? [],
				},
			});
		}
		if (sourceMode !== "canvas_group") {
			return { ok: false, errorCode: "workflow_node_runtime_failed", errorMessage: `Unsupported video workflow source mode ${sourceMode}` };
		}
		// 系统级交付：源组绑定在调用者当前画布（delivery.flowId），groupId 必须来自
		// 本次 triggerPayload.sourceGroupId（小T依据调用者画布真实组绑定），禁止回落到
		// 模板节点静态 sourceGroupId（那是工作流项目内的组）。
		if (delivery) {
			const callerGroupId = callConfig && typeof callConfig.sourceGroupId === "string"
				? callConfig.sourceGroupId.trim()
				: "";
			if (!callerGroupId) {
				return {
					ok: false,
					errorCode: "workflow_node_runtime_failed",
					errorMessage: "System-level workflow canvas_group invocation requires triggerPayload.sourceGroupId bound to a group in the caller canvas",
				};
			}
			if (!dependencies.readCanvasGroupFromFlow) {
				return { ok: false, errorCode: "workflow_node_executor_missing", errorMessage: "Caller canvas group reader dependency is unavailable" };
			}
			const facts = await dependencies.readCanvasGroupFromFlow({
				flowId: delivery.flowId,
				ownerId: context.ownerId,
				groupId: callerGroupId,
				chapterId: delivery.chapterId,
			});
			const canvasFacts = callConfig ? { ...facts, callConfig } : facts;
			return output({
				node: context.node,
				executorRef,
				ports: { "canvas-facts": canvasFacts },
				artifacts: [{ type: "tapcanvas.canvas-facts/v1", identity: callerGroupId, value: canvasFacts }],
				evidence: { sourceGroupId: callerGroupId, sourceChildCount: facts.children.length, sourceFlowId: delivery.flowId },
			});
		}
		const groupId = readString(data, "sourceGroupId");
		if (!groupId) {
			return { ok: false, errorCode: "workflow_node_runtime_failed", errorMessage: "Video workflow source requires a bound canvas group" };
		}
		if (!dependencies.readCanvasGroup) {
			return { ok: false, errorCode: "workflow_node_executor_missing", errorMessage: "Canvas group reader dependency is unavailable" };
		}
		const facts = await dependencies.readCanvasGroup({
			flowId: context.flowId,
			ownerId: context.ownerId,
			groupId,
			flowVersionData: context.flowVersionData,
		});
		const canvasFacts = callConfig ? { ...facts, callConfig } : facts;
		return output({
			node: context.node,
			executorRef,
			ports: { "canvas-facts": canvasFacts },
			artifacts: [{ type: "tapcanvas.canvas-facts/v1", identity: groupId, value: canvasFacts }],
			evidence: { sourceGroupId: groupId, sourceChildCount: facts.children.length },
		});
	}

	if (executorRef === "agents.delivery.contract/v2") {
		try {
			// 按次触发参数覆盖：canvas-source 把 triggerPayload 透传为 canvasFacts.callConfig，
			// 本节点据此冻结本次的显式目标时长与视频模型。
			// 未显式指定总时长时，只冻结模型的合法单 Clip 窗口，
			// 由 BeatSheet Agent 根据完整来源自主决定 Clip 数与总时长。
			const rawCanvasFacts = firstInput(context.inputs, "canvas-facts");
			const canvasFacts = applyExpandedSourceToCanvasFacts(
				rawCanvasFacts,
				firstInput(context.inputs, "expanded-source"),
			);
			const callConfig = isRecord(canvasFacts) && isRecord(canvasFacts.callConfig)
				? canvasFacts.callConfig
				: null;
			const callDuration = callConfig && typeof callConfig.targetDurationSeconds === "number"
				? callConfig.targetDurationSeconds
				: undefined;
			const callModelKey = callConfig && typeof callConfig.videoModelKey === "string"
				? callConfig.videoModelKey.trim()
				: "";
			const targetDurationSeconds = Number.isInteger(callDuration) && (callDuration as number) > 0
				? callDuration as number
				: null;
			const rawRequestedClipCount = callConfig?.requestedClipCount;
			const requestedClipCount = rawRequestedClipCount === undefined
				? null
				: typeof rawRequestedClipCount === "number"
					&& Number.isInteger(rawRequestedClipCount)
					&& rawRequestedClipCount > 0
						? rawRequestedClipCount
						: null;
			if (rawRequestedClipCount !== undefined && requestedClipCount === null) {
				throw new Error("requestedClipCount must be a positive integer");
			}
			const rawRequestedClipDurations = callConfig?.requestedClipDurationsSeconds;
			const requestedClipDurations = rawRequestedClipDurations === undefined
				? null
				: Array.isArray(rawRequestedClipDurations)
					&& rawRequestedClipDurations.length > 0
					&& rawRequestedClipDurations.length <= 64
					&& rawRequestedClipDurations.every((duration) => (
						typeof duration === "number" && Number.isInteger(duration) && duration > 0
					))
						? rawRequestedClipDurations as number[]
						: null;
			if (rawRequestedClipDurations !== undefined && requestedClipDurations === null) {
				throw new Error("requestedClipDurationsSeconds must contain 1..64 positive integers");
			}
			if (requestedClipDurations) {
				if (targetDurationSeconds === null) {
					throw new Error("requestedClipDurationsSeconds requires targetDurationSeconds");
				}
				if (requestedClipCount === null) {
					throw new Error("requestedClipDurationsSeconds requires requestedClipCount");
				}
				if (requestedClipDurations.length !== requestedClipCount) {
					throw new Error("requestedClipDurationsSeconds length must equal requestedClipCount");
				}
				const requestedTotal = requestedClipDurations.reduce((total, duration) => total + duration, 0);
				if (requestedTotal !== targetDurationSeconds) {
					throw new Error("requestedClipDurationsSeconds must sum to targetDurationSeconds");
				}
			}
			const modelKey = callModelKey || readString(data, "workflowVideoModelKey");
			if (!modelKey) throw new Error("Video delivery contract requires an explicit enabled video model");
			const frozenPlanValue = callConfig?.[WORKFLOW_VIDEO_DURATION_PLAN_TRIGGER_FIELD];
			const admittedDurationPlan = parseFrozenWorkflowVideoDurationPlan(frozenPlanValue);
			if (frozenPlanValue !== undefined && !admittedDurationPlan) {
				throw new Error("Workflow trigger contains an invalid frozen video duration plan");
			}
			if (
				admittedDurationPlan
				&& (
					targetDurationSeconds === null
					|| admittedDurationPlan.targetDurationSeconds !== targetDurationSeconds
					|| admittedDurationPlan.modelKey !== modelKey
				)
			) {
				throw new Error("Workflow trigger video duration plan does not match the requested duration/model");
			}
			if (admittedDurationPlan && requestedClipDurations) {
				const admittedDurations = admittedDurationPlan.providerSubmissionTopology?.minimumClipDurations ?? [];
				if (
					admittedDurations.length !== requestedClipDurations.length
					|| admittedDurations.some((duration, index) => duration !== requestedClipDurations[index])
				) {
					throw new Error("Workflow trigger video duration plan does not preserve requestedClipDurationsSeconds");
				}
			}
			let durationPlan: WorkflowVideoDurationPlan | null = admittedDurationPlan;
			if (!durationPlan) {
				if (!dependencies.resolveVideoDurationOptions) {
					throw new Error("Video model duration catalog resolver is unavailable");
				}
				const durationOptions = await dependencies.resolveVideoDurationOptions({
						executionId: context.executionId,
						runtimeNodeId: context.node.id,
						ownerId: context.ownerId,
						modelKey,
					});
				durationPlan = targetDurationSeconds === null
					? {
						targetDurationSeconds: null,
						modelKey,
						durationOptions,
						maxDurationSeconds: Math.max(...durationOptions),
					}
					: freezeWorkflowVideoDurationPlan({
						targetDurationSeconds,
						modelKey,
						durationOptions,
						...(requestedClipDurations ? { explicitDurations: requestedClipDurations } : {}),
					});
			}
			// 按次注入参数（triggerPayload.resolution/aspectRatio）的目录校验：
			// 目录外参数显式失败，避免把非法参数漏给供应商后再收到晦涩报错。
			const callResolution = callConfig && typeof callConfig.resolution === "string"
				? callConfig.resolution.trim()
				: "";
			const callAspectRatio = callConfig && typeof callConfig.aspectRatio === "string"
				? callConfig.aspectRatio.trim()
				: "";
			if (dependencies.resolveVideoMediaOptions) {
				const mediaOptions = await dependencies.resolveVideoMediaOptions({
					executionId: context.executionId,
					runtimeNodeId: context.node.id,
					ownerId: context.ownerId,
					modelKey,
				});
				durationPlan = { ...durationPlan, maxReferenceImages: mediaOptions.maxReferenceImages ?? null };
				if (callResolution && !mediaOptions.resolutionOptions.includes(callResolution)) {
					throw new Error(
						`Video model ${modelKey} does not support resolution ${callResolution}; supported: ${mediaOptions.resolutionOptions.join("/")}`,
					);
				}
				if (callAspectRatio && !mediaOptions.aspectRatioOptions.includes(callAspectRatio)) {
					throw new Error(
						`Video model ${modelKey} does not support aspectRatio ${callAspectRatio}; supported: ${mediaOptions.aspectRatioOptions.join("/")}`,
					);
				}
			}
			const contract = buildVideoDeliveryContract({
        onlyVideoNodes: callConfig?.onlyVideoNodes === true,
				executionId: context.executionId,
				workflowKey: context.workflowKey,
				executionScope: data.workflowExecutionScope,
				canvasFacts,
				durationPlan,
				requestedClipCount,
			});
			return output({
				node: context.node,
				executorRef,
				ports: { "delivery-contract": contract },
				artifacts: [{ type: "tapcanvas.delivery-contract/v2", identity: context.executionId, value: contract }],
			});
		} catch (error: unknown) {
			return { ok: false, errorCode: "workflow_node_runtime_failed", errorMessage: error instanceof Error ? error.message : String(error) };
		}
	}


	if (executorRef === "video.clip-contexts/v1") {
		try {
			const collection = buildVideoClipContexts({
				executionId: context.executionId,
				nodeId: context.node.id,
				deliveryContract: firstInput(context.inputs, "delivery-contract"),
				beatSheetAgentResult: firstInput(context.inputs, "beat-sheet"),
			});
			return output({
				node: context.node,
				executorRef,
				ports: { "clip-contexts": collection },
				artifacts: [{ type: "tapcanvas.clip-contracts/v1", identity: collection.collectionId, value: collection }],
				evidence: { itemCount: collection.items.length },
			});
		} catch (error: unknown) {
			if (error instanceof WorkflowInputContractError) {
				try {
					const inputContractRejection = createWorkflowInputContractRejection({
						consumerNodeId: context.node.id,
						inputBindings: context.inputProvenance ?? [],
						error,
					});
					return {
						ok: false,
						errorCode: "workflow_node_runtime_failed",
						errorMessage: error.message,
						outputRefs: output({
							node: context.node,
							executorRef,
							ports: {},
							completed: false,
							evidence: { inputContractRejection },
						}).outputRefs,
					};
				} catch (provenanceError: unknown) {
					return {
						ok: false,
						errorCode: "workflow_node_runtime_failed",
						errorMessage: `${error.message}; ${provenanceError instanceof Error ? provenanceError.message : String(provenanceError)}`,
					};
				}
			}
			return { ok: false, errorCode: "workflow_node_runtime_failed", errorMessage: error instanceof Error ? error.message : String(error) };
		}
	}

	if (executorRef === "video.prompt-package.persist/v1") {
		try {
			const promptPackage = buildWorkflowPromptPackage({
				executionId: context.executionId,
				workflowKey: context.workflowKey,
				clipPromptCollection: firstInput(context.inputs, "clip-prompts"),
				clipContextCollection: firstInput(context.inputs, "clip-contexts"),
				...(context.inputs["asset-items"]?.length
					? { assetPlanCollection: firstInput(context.inputs, "asset-items") }
					: {}),
			});
			return output({
				node: context.node,
				executorRef,
				ports: { "prompt-package": promptPackage },
				artifacts: [{ type: promptPackage.artifactType, identity: context.executionId, value: promptPackage }],
				evidence: {
					deliveryEvidence: promptPackage.deliveryEvidence,
					qualityAssessment: promptPackage.qualityAssessment,
					deliveryVerification: promptPackage.deliveryVerification,
				},
			});
		} catch (error: unknown) {
			return { ok: false, errorCode: "workflow_node_runtime_failed", errorMessage: error instanceof Error ? error.message : String(error) };
		}
	}

	if (executorRef === "video.estimate/v1") {
		const promptPackage = firstInput(context.inputs, "prompt-package");
		const modelKey = readString(data, "workflowVideoModelKey");
		const resolution = readString(data, "workflowVideoResolution");
		const aspectRatio = readString(data, "workflowVideoAspectRatio");
		if (!isRecord(promptPackage) || !Array.isArray(promptPackage.clips)) {
			return { ok: false, errorCode: "workflow_node_runtime_failed", errorMessage: "Video estimate requires a persisted prompt package" };
		}
		if (!modelKey || !resolution || !aspectRatio) {
			return { ok: false, errorCode: "workflow_node_runtime_failed", errorMessage: "Video estimate requires an explicit live-catalog model, resolution and aspect ratio" };
		}
		if (!dependencies.runVideoEstimate) {
			return { ok: false, errorCode: "workflow_node_executor_missing", errorMessage: "Workflow video estimate runner dependency is unavailable" };
		}
		const delivery = workflowDeliveryScope(context.flowVersionData);
		try {
			const clips = promptPackage.clips.map((value, index) => {
				if (!isRecord(value)) throw new Error(`Prompt package clip ${index + 1} must be an object`);
				const itemId = readString(value, "itemId");
				const durationSeconds = value.durationSeconds;
				if (!itemId || typeof durationSeconds !== "number" || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
					throw new Error(`Prompt package clip ${index + 1} requires itemId and positive durationSeconds`);
				}
				return { itemId, durationSeconds };
			});
			const referenceImageCount = promptPackage.clips.reduce((total, value) => {
				if (!isRecord(value)) return total;
				const structuredClip = isRecord(value.structuredClip) ? value.structuredClip : null;
				const contracts = structuredClip && Array.isArray(structuredClip.assetObjectContracts)
					? structuredClip.assetObjectContracts
					: [];
				return total + contracts.reduce((contractTotal, contractValue) => {
					if (!isRecord(contractValue)) return contractTotal;
					const nodeIds = Array.isArray(contractValue.referenceImageNodeIds)
						? contractValue.referenceImageNodeIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
						: [];
					const assetIds = Array.isArray(contractValue.referenceAssetIds)
						? contractValue.referenceAssetIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
						: [];
					return contractTotal + new Set([...nodeIds, ...assetIds]).size;
				}, 0);
			}, 0);
			const estimateRequest: WorkflowVideoEstimateRequest = {
				executionId: context.executionId,
				runtimeNodeId: context.node.id,
				ownerId: context.ownerId,
				projectId: delivery?.projectId ?? context.projectId,
				modelKey,
				resolution,
				aspectRatio,
				referenceImageCount,
				clips,
			};
			const runEstimate = dependencies.runVideoEstimate;
			const { value: estimate, repairEvidence } = await readWithImmediateDependencyRepair({
				read: () => runEstimate(estimateRequest),
				previousEvidence: context.resumeOutputRefs?.evidence ?? null,
			});
			return output({
				node: context.node,
				executorRef,
				ports: { estimate },
				artifacts: [{ type: "tapcanvas.video-estimate/v1", identity: estimate.estimateIdentity, value: estimate }],
				evidence: { estimateIdentity: estimate.estimateIdentity, estimatedCredits: estimate.estimatedCredits, ...repairEvidence },
			});
		} catch (error: unknown) {
			if (error instanceof ExternalDependencyError) {
				return waitForReadOnlyDependency({
					error,
					previousEvidence: context.resumeOutputRefs?.evidence ?? null,
					output: output({ node: context.node, executorRef, ports: {}, completed: false }).outputRefs,
				});
			}
			return { ok: false, errorCode: "workflow_node_runtime_failed", errorMessage: error instanceof Error ? error.message : String(error) };
		}
	}

	if (executorRef === "video.voice-catalog/v1") {
		const promptPackage = firstInput(context.inputs, "prompt-package");
		if (!isRecord(promptPackage) || !Array.isArray(promptPackage.clips)) {
			return { ok: false, errorCode: "workflow_node_runtime_failed", errorMessage: "Voice catalog requires a persisted prompt package" };
		}
		if (!dependencies.readVoicePlanningFacts) {
			return { ok: false, errorCode: "workflow_node_executor_missing", errorMessage: "Workflow voice catalog dependency is unavailable" };
		}
		const speakerNames = uniqueStrings(promptPackage.clips.flatMap((clip) => {
			if (!isRecord(clip) || !isRecord(clip.structuredClip) || !Array.isArray(clip.structuredClip.speakerBindings)) return [];
			return clip.structuredClip.speakerBindings.flatMap((binding) => (
				isRecord(binding) && readString(binding, "name") ? [readString(binding, "name")] : []
			));
		}));
		const delivery = workflowDeliveryScope(context.flowVersionData);
		try {
			const voiceCatalog = await dependencies.readVoicePlanningFacts({
				executionId: context.executionId,
				runtimeNodeId: context.node.id,
				ownerId: context.ownerId,
				flowId: delivery?.flowId ?? context.flowId,
				projectId: delivery?.projectId ?? context.projectId,
				chapterId: delivery?.chapterId ?? null,
				speakerNames,
			});
			return output({
				node: context.node,
				executorRef,
				ports: { "voice-catalog": voiceCatalog },
				artifacts: [{ type: "tapcanvas.voice-catalog/v1", identity: context.executionFamilyId, value: voiceCatalog }],
				evidence: { speakerCount: speakerNames.length, existingBindingCount: voiceCatalog.existingBindings.length, catalogCount: voiceCatalog.catalog.length },
			});
		} catch (error: unknown) {
			return { ok: false, errorCode: "workflow_node_runtime_failed", errorMessage: error instanceof Error ? error.message : String(error) };
		}
	}

	if (executorRef === "video.voice-manifest.empty/v1") {
		const voiceManifest = {
			protocolVersion: "tapcanvas.voice-manifest/v1" as const,
			entries: [],
		};
		return output({
			node: context.node,
			executorRef,
			ports: { "voice-manifest": voiceManifest },
			artifacts: [{ type: "tapcanvas.voice-manifest/v1", identity: `${context.executionId}:${context.node.id}:native-audio`, value: voiceManifest }],
			evidence: { speakerCount: 0, nativeAudioOnly: true },
		});
	}

	if (executorRef === "video.production.handoff/v1") {
		try {
			const promptPackage = firstInput(context.inputs, "prompt-package");
			const estimate = firstInput(context.inputs, "estimate");
			if (!isRecord(promptPackage) || !Array.isArray(promptPackage.clips) || !isRecord(estimate)) {
				throw new Error("Production handoff requires a prompt package and estimate");
			}
			const configuredReferenceAudioPolicy = context.node.data.workflowReferenceAudioPolicy;
			if (
				configuredReferenceAudioPolicy !== undefined &&
				configuredReferenceAudioPolicy !== "required" &&
				configuredReferenceAudioPolicy !== "optional"
			) {
				throw new Error("Production handoff workflowReferenceAudioPolicy must be required or optional");
			}
			const voiceManifest = parseWorkflowVoiceManifest(firstInput(context.inputs, "voice-manifest"));
			const productionPlan = buildVideoProductionPlan({
				executionId: context.executionId,
				nodeId: context.node.id,
				promptPackage,
				estimate,
				generationContract: context.node.data.workflowVideoGenerationContract,
				assetBindings: firstInput(context.inputs, "asset-bindings"),
				voiceManifest,
				referenceAudioPolicy: configuredReferenceAudioPolicy ?? "required",
			});
			return output({
				node: context.node,
				executorRef,
				ports: { "production-plan": productionPlan },
				artifacts: [{ type: "tapcanvas.production-plan/v1", identity: productionPlan.collectionId, value: productionPlan }],
				evidence: { itemCount: productionPlan.items.length, voiceManifest },
			});
		} catch (error: unknown) {
			return { ok: false, errorCode: "workflow_node_runtime_failed", errorMessage: error instanceof Error ? error.message : String(error) };
		}
	}

	if (executorRef === "video.voice-manifest.materialize/v1") {
		try {
			const configuredVoiceMode = context.node.data.workflowVoiceMode;
			if (
				configuredVoiceMode !== undefined &&
				configuredVoiceMode !== "provider_native" &&
				configuredVoiceMode !== "reference_manifest"
			) {
				throw new Error("Voice manifest workflowVoiceMode must be provider_native or reference_manifest");
			}
			const voiceCatalog = parseWorkflowVoiceCatalog(firstInput(context.inputs, "voice-catalog"));
			const voicePlan = parseAndValidateWorkflowVoicePlan({
				voicePlan: firstInput(context.inputs, "voice-plan"),
				voiceCatalog,
			});
			const estimate = firstInput(context.inputs, "estimate");
			if (!isRecord(estimate) || !readString(estimate, "modelKey")) {
				throw new Error("Voice manifest materialization requires the frozen video estimate");
			}
			if (configuredVoiceMode === "provider_native") {
				const voiceManifest = {
					protocolVersion: "tapcanvas.voice-manifest/v1" as const,
					entries: [],
				};
				return output({
					node: context.node,
					executorRef,
					ports: { "voice-manifest": voiceManifest },
					artifacts: [{ type: "tapcanvas.voice-manifest/v1", identity: `${context.executionFamilyId}:provider-native`, value: voiceManifest }],
					evidence: { speakerCount: voiceCatalog.speakers.length, entryCount: 0, audioUrls: [], nativeAudioOnly: true },
				});
			}
			if (!dependencies.prepareVideoProductionAssets) {
				return { ok: false, errorCode: "workflow_node_executor_missing", errorMessage: "Workflow voice manifest materializer is unavailable" };
			}
			const delivery = workflowDeliveryScope(context.flowVersionData);
			const voiceManifest = await dependencies.prepareVideoProductionAssets({
				executionId: context.executionId,
				executionFamilyId: context.executionFamilyId,
				runtimeNodeId: context.node.id,
				ownerId: context.ownerId,
				flowId: delivery?.flowId ?? context.flowId,
				projectId: delivery?.projectId ?? context.projectId,
				chapterId: delivery?.chapterId ?? null,
				speakerNames: voiceCatalog.speakers,
				modelKey: readString(estimate, "modelKey"),
				voiceCatalog,
				voicePlan,
			});
			return output({
				node: context.node,
				executorRef,
				ports: { "voice-manifest": voiceManifest },
				artifacts: [{ type: "tapcanvas.voice-manifest/v1", identity: context.executionFamilyId, value: voiceManifest }],
				evidence: { entryCount: voiceManifest.entries.length, audioUrls: voiceManifest.entries.map((entry) => entry.audioUrl) },
			});
		} catch (error: unknown) {
			return { ok: false, errorCode: "workflow_node_runtime_failed", errorMessage: error instanceof Error ? error.message : String(error) };
		}
	}

	if (executorRef === "video.concat/v1") {
		const videoAssets = firstInput(context.inputs, "video-assets");
		const estimate = firstInput(context.inputs, "estimate");
		const promptPackage = firstInput(context.inputs, "prompt-package");
		if (!isWorkflowCollection(videoAssets) || !isRecord(estimate) || !isRecord(promptPackage)) {
			return { ok: false, errorCode: "workflow_node_runtime_failed", errorMessage: "Video concat requires collected video assets, the frozen estimate and its verified prompt package" };
		}
		const perClip = Array.isArray(estimate.perClip) ? estimate.perClip : [];
        const frozenItems = perClip.map(item => {
            if (!isRecord(item) || typeof item.itemId !== "string" || typeof item.durationSeconds !== "number") {
                throw new Error("Video concat requires frozen item identities and durations");
            }
            return { itemId: item.itemId, durationSeconds: item.durationSeconds };
        });
        const coverage = mediaDeliveryCoverage(frozenItems, videoAssets.items.map(item => item.itemId),
            readMediaDeliveryPolicy(data) !== null);
        const targetDurationSeconds = coverage.deliveredDurationSeconds;
        const deliveredById = new Map(videoAssets.items.map(item => [item.itemId, item]));
        const orderedItems = coverage.completedItemIds.map(id => deliveredById.get(id)!);
		const promptPackageEvidence = isRecord(promptPackage.deliveryEvidence)
			? promptPackage.deliveryEvidence
			: null;
		const promptPackageVerification = isRecord(promptPackage.deliveryVerification)
			? promptPackage.deliveryVerification
			: null;
		const promptPackageAdmission = inspectWorkflowPromptPackageAdmission(promptPackage);
		if (!promptPackageAdmission.structurallyValid) {
			return {
				ok: false,
				errorCode: "workflow_node_runtime_failed",
				errorMessage: `Video concat requires structurally valid prompt package provenance: ${promptPackageAdmission.issues.join("; ")}`,
			};
		}
		const videoUrls = orderedItems.map((item) => persistentHttpUrl(item.value));
		if (videoUrls.some((url) => url === null)) {
			return { ok: false, errorCode: "workflow_node_runtime_failed", errorMessage: "Video concat received an item without a persistent HTTP(S) video URL" };
		}
		const persistentVideoUrls = videoUrls.filter((url): url is string => url !== null);
		const mediaWorkerEnabled = isMediaWorkerEnabled();
		if (mediaWorkerEnabled) {
			const mediaProbeResults = await probeWorkflowVideoUrls(persistentVideoUrls);
			const previousMediaReadinessPolls = typeof context.resumeOutputRefs?.evidence.mediaReadinessPolls === "number"
				&& Number.isInteger(context.resumeOutputRefs.evidence.mediaReadinessPolls)
				&& context.resumeOutputRefs.evidence.mediaReadinessPolls >= 0
				? context.resumeOutputRefs.evidence.mediaReadinessPolls
				: 0;
			if (mediaProbeResults.some((probe) => probe === null)) {
				const mediaReadinessPolls = previousMediaReadinessPolls + 1;
				if (mediaReadinessPolls >= WORKFLOW_MEDIA_READINESS_MAX_POLLS) {
					return {
						ok: false,
						errorCode: "workflow_node_runtime_failed",
						errorMessage: `Video concat inputs stayed undecodable after ${WORKFLOW_MEDIA_READINESS_MAX_POLLS} readiness polls`,
						outputRefs: output({
							node: context.node,
							executorRef,
							ports: {},
							evidence: {
								executorCompleted: false,
								mediaReadiness: "failed",
								mediaReadinessPolls,
							},
						}).outputRefs,
					};
				}
				console.warn("[workflow-video-readiness] waiting before concat", {
					executionId: context.executionId,
					nodeId: context.node.id,
					clipCount: videoUrls.length,
					mediaReadinessPolls,
				});
				const pending = output({
					node: context.node,
					executorRef,
					ports: {},
					evidence: {
						executorCompleted: false,
						mediaReadiness: "waiting",
						mediaReadinessPolls,
					},
				});
				if (!pending.ok) return pending;
				return workflowNodeWaiting(
					pending.outputRefs,
					workflowExternalPollAfter(WORKFLOW_PROVIDER_STATUS_POLL_MS),
				);
			}
		}
		const styleFingerprints = uniqueStrings(orderedItems.flatMap((item) => {
			if (!isRecord(item.value)) return [];
			const fingerprint = readString(item.value, "styleFingerprint");
			return fingerprint ? [fingerprint] : [];
		}));
		if (styleFingerprints.length > 1) {
			return {
				ok: false,
				errorCode: "workflow_node_runtime_failed",
				errorMessage: `Video concat received clips with conflicting project style fingerprints: ${JSON.stringify(styleFingerprints)}`,
			};
		}
		const expectedStyleFingerprint = runtimeProjectContext(context)?.visualStyle?.styleFingerprint ?? null;
		if (expectedStyleFingerprint) {
			const unboundStyleClip = orderedItems.some((item) => (
				!isRecord(item.value) || readString(item.value, "styleFingerprint") !== expectedStyleFingerprint
			));
			if (unboundStyleClip) {
				return {
					ok: false,
					errorCode: "workflow_node_runtime_failed",
					errorMessage: `Video concat requires every clip to carry the frozen project style fingerprint ${expectedStyleFingerprint}`,
				};
			}
		}
		const aspectRatio = readString(estimate, "aspectRatio");
		const resolution = readString(estimate, "resolution");
		if (!aspectRatio || !resolution) {
			return { ok: false, errorCode: "workflow_node_runtime_failed", errorMessage: "Video concat estimate is missing aspectRatio or resolution" };
		}
		const sourceNodeIds = uniqueStrings(orderedItems.flatMap((item) => {
			const value = isRecord(item.value) ? item.value : null;
			const id = value ? readString(value, "nodeId") : "";
			return id ? [id] : [];
		}));

		if (!dependencies.runVideoConcat) {
			return { ok: false, errorCode: "workflow_node_executor_missing", errorMessage: "Workflow video concat runner dependency is unavailable" };
		}
		const delivery = workflowDeliveryScope(context.flowVersionData);
		try {
			const concatenated = await dependencies.runVideoConcat({
				executionId: context.executionId,
				runtimeNodeId: context.node.id,
				ownerId: context.ownerId,
				flowId: delivery?.flowId ?? context.flowId,
				projectId: context.projectId,
				chapterId: delivery?.chapterId ?? null,
				videoUrls: persistentVideoUrls,
				sourceNodeIds,
				aspectRatio,
				resolution,
				targetDurationSeconds,
			});
			if (dependencies.projectWorkflowFilm) {
				await dependencies.projectWorkflowFilm({
					executionId: context.executionId,
					runtimeNodeId: context.node.id,
					ownerId: context.ownerId,
					flowId: delivery?.flowId ?? context.flowId,
					chapterId: delivery?.chapterId ?? null,
					videoUrl: concatenated.videoUrl,
					assetId: concatenated.assetId,
					clipCount: concatenated.clipCount,
					targetDurationSeconds,
					deliveryCoverage: coverage,
					aspectRatio,
					sourceNodeIds,
					...(concatenated.concatPolicy ? { concatPolicy: concatenated.concatPolicy } : {}),
					...(concatenated.mediaProbeEvidence ? { mediaProbeEvidence: concatenated.mediaProbeEvidence } : {}),
				});
			}
			return output({
				node: context.node,
				executorRef,
				ports: {
					"master-video": {
						deliveryCoverage: coverage,
						videoUrl: concatenated.videoUrl,
						assetId: concatenated.assetId,
						clipCount: concatenated.clipCount,
						targetDurationSeconds,
						mediaProbeEvidence: concatenated.mediaProbeEvidence ?? null,
						promptPackageEvidence,
						promptPackageVerification,
					},
				},
				artifacts: [{
					type: "tapcanvas.master-video/v1",
					identity: context.executionId,
					value: concatenated.videoUrl,
					media: {
						protocolVersion: "workflow.media-asset/v1",
						kind: "video",
						url: concatenated.videoUrl,
				mimeType: null,
					},
				}],
				evidence: concatenated,
			});
		} catch (error: unknown) {
			return { ok: false, errorCode: "workflow_node_runtime_failed", errorMessage: error instanceof Error ? error.message : String(error) };
		}
	}

	if (executorRef === "tapcanvas.image.generate/v1") {
		let referenceAssetBindings: readonly WorkflowImageReferenceAssetBinding[];
		try {
			referenceAssetBindings = imageReferenceAssetBindings(data);
			const item = firstInput(context.inputs, "asset-items");
			if (isRecord(item) && item.referenceAssetBindings !== undefined) {
				if (!Array.isArray(item.referenceAssetBindings)) throw new Error("Image item referenceAssetBindings must be an array");
				referenceAssetBindings = imageReferenceAssetBindings({ workflowImageReferenceAssetBindings: [...referenceAssetBindings, ...item.referenceAssetBindings] });
			}
		} catch (error: unknown) {
			return { ok: false, errorCode: "workflow_node_runtime_failed", errorMessage: error instanceof Error ? error.message : String(error) };
		}
		const modelKey = readString(data, "workflowImageModelKey");
		const aspectRatio = readString(data, "workflowImageAspectRatio");
		const imageSize = readString(data, "workflowImageSize");
		if (!modelKey || !aspectRatio || !imageSize) {
			return {
				ok: false,
				errorCode: "workflow_node_runtime_failed",
				errorMessage: `Workflow image node ${context.node.id} requires an explicit live-catalog model, aspect ratio and image size`,
			};
		}
		const delivery = workflowDeliveryScope(context.flowVersionData);
		// 调用者项目资产复用：asset-coverage 在计划里声明 existingImageUrl /
		// existingNodeId（指向调用者画布真实已就绪节点）时，本节点直接产出复用
		// 绑定（跳过生成），binding 引用调用者画布中的源节点作为视频参考图。
		const assetPlanInput = firstInput(context.inputs, "asset-items");
		const assetRecord = isRecord(assetPlanInput) && assetPlanInput.asset !== undefined
			? validateAssetRecord(assetPlanInput.asset) : null;
		const planExistingUrl = isRecord(assetPlanInput) ? readString(assetPlanInput, "existingImageUrl") : "";
		const planExistingNodeId = isRecord(assetPlanInput) ? readString(assetPlanInput, "existingNodeId") : "";
		const adoptedAssetId = workflowMediaAdoptionAssetId(context.flowVersionData, context.node.id);
		const planExistingAssetId = adoptedAssetId ?? (isRecord(assetPlanInput) ? readString(assetPlanInput, "existingAssetId") : "");
		const planExistingProjectId = isRecord(assetPlanInput) ? readString(assetPlanInput, "existingProjectId") : "";
		const projectContext = runtimeProjectContext(context);
		if (planExistingAssetId && (projectContext || !planExistingUrl)) {
			if (!projectContext || !dependencies.resolveProjectAsset) {
				return {
					ok: false,
					errorCode: "workflow_asset_resource_unavailable",
					errorMessage: `Workflow image node ${context.node.id} cannot resolve ${planExistingAssetId} without ProjectContext`,
				};
			}
			if (planExistingProjectId && planExistingProjectId !== projectContext.projectId) {
				return {
					ok: false,
					errorCode: "workflow_asset_forbidden",
					errorMessage: `Asset ${planExistingAssetId} belongs to a different project context`,
				};
			}
			try {
				const resolved = await dependencies.resolveProjectAsset({
					ownerId: context.ownerId,
					projectId: projectContext.projectId,
					assetId: planExistingAssetId,
					preferredKind: "image",
					projectContext,
				});
				// Material-library assets do not necessarily originate from a canvas node. The
				// stable asset id remains a valid lineage identity in that case.
				const projection = delivery ? await projectWorkflowAssetReference({
					executionId: context.executionId, executionFamilyId: context.executionFamilyId,
					runtimeNodeId: context.node.id, ownerId: context.ownerId,
					projectId: projectContext.projectId, flowId: delivery.flowId, chapterId: delivery.chapterId,
					assetId: planExistingAssetId, itemIndex: context.runtimeItemIndex ?? 0,
					...(isRecord(assetPlanInput) && readString(assetPlanInput, "role") ? {
						assetMetadata: {
							label: readString(assetPlanInput, "displayName"),
							displayName: readString(assetPlanInput, "displayName"),
							referenceType: parseWorkflowAssetRole(readString(assetPlanInput, "role"), "Reused asset role").kind,
							workflowObjectId: readString(assetPlanInput, "objectId"),
						},
					} : {}),
					invokeTool: dependencies.invokeTool,
				}) : null;
				const reuseNodeId = projection?.status === "success" ? projection.nodeId : resolved.nodeId || planExistingNodeId || planExistingAssetId;
				return output({
					node: context.node,
					executorRef,
					ports: {
						[primaryOutputPort(data, "image")]: {
							assetPlan: assetPlanInput,
							imageUrl: resolved.url,
							generatedAssetId: planExistingAssetId,
							nodeId: reuseNodeId,
							taskId: null,
						},
					},
					artifacts: [{
						type: "tapcanvas.image/v1",
						identity: planExistingAssetId,
						value: resolved.url,
						media: { protocolVersion: "workflow.media-asset/v1", kind: "image", url: resolved.url, mimeType: resolved.mimeType },
					}],
					evidence: {
						canvasNodeId: reuseNodeId,
						...(projection ? { assetReferenceProjection: projection } : {}),
						providerStatus: "reused",
						assetOrigin: "existing_asset",
						reuseSource: adoptedAssetId ? "explicit_media_adoption" : "project_asset_resolver",
						...(adoptedAssetId ? { adoptedAssetId } : {}),
						assetId: planExistingAssetId,
						projectId: projectContext.projectId,
						...(resolved.styleFingerprint ? { sourceStyleFingerprint: resolved.styleFingerprint } : {}),
						...(projectContext.visualStyle?.styleFingerprint
							? { targetStyleFingerprint: projectContext.visualStyle.styleFingerprint }
							: {}),
						...(resolved.styleFingerprint && projectContext.visualStyle?.styleFingerprint
							? { styleTransformRequired: resolved.styleFingerprint !== projectContext.visualStyle.styleFingerprint }
							: {}),
					},
				});
			} catch (error: unknown) {
				const code = isRecord(error) && typeof error.code === "string" ? error.code : "workflow_asset_resource_unavailable";
				return {
					ok: false,
					errorCode: code as "workflow_asset_resource_unavailable",
					errorMessage: error instanceof Error ? error.message : String(error),
				};
			}
		}
		if (planExistingUrl) {
			const reuseUrl = persistentHttpUrl(planExistingUrl);
			if (!reuseUrl) {
				return {
					ok: false,
					errorCode: "workflow_node_runtime_failed",
					errorMessage: `Workflow image node ${context.node.id} reuse declaration has a non-persistent existingImageUrl`,
				};
			}
			if (!planExistingNodeId) {
				return {
					ok: false,
					errorCode: "workflow_node_runtime_failed",
					errorMessage: `Workflow image node ${context.node.id} reuse declaration requires existingNodeId`,
				};
			}
			const reuseIdentity = planExistingAssetId || planExistingNodeId;
			return output({
				node: context.node,
				executorRef,
				ports: {
					[primaryOutputPort(data, "image")]: {
						assetPlan: assetPlanInput,
						imageUrl: reuseUrl,
						generatedAssetId: planExistingAssetId || null,
						nodeId: planExistingNodeId,
						taskId: null,
					},
				},
				artifacts: [{
					type: "tapcanvas.image/v1",
					identity: reuseIdentity,
					value: reuseUrl,
					media: {
						protocolVersion: "workflow.media-asset/v1",
						kind: "image",
						url: reuseUrl,
						mimeType: null,
					},
				}],
				evidence: {
					canvasNodeId: planExistingNodeId,
					providerStatus: "reused",
					assetOrigin: "existing_asset",
					reuseSource: "caller_asset",
					imageUrl: reuseUrl,
					assetId: planExistingAssetId || null,
				},
			});
		}
		let promptPackage: ReturnType<typeof imagePromptPackage>;
		try {
			promptPackage = imagePromptPackage(context.inputs);
		} catch (error: unknown) {
			return { ok: false, errorCode: "workflow_node_runtime_failed", errorMessage: error instanceof Error ? error.message : String(error) };
		}
		if (!dependencies.runImage) {
			return { ok: false, errorCode: "workflow_node_executor_missing", errorMessage: "Workflow image runner dependency is unavailable" };
		}
		const previousItemRun = context.resumeOutputRefs?.itemRuns.find((run) => run.runtimeNodeId === context.node.id) ?? null;
		const result = await dependencies.runImage({
			...(assetRecord?.source.mode === "generate" ? { assetIdentity: {
				assetId: assetRecord.assetId, generationSpecVersion: assetRecord.source.generationSpecVersion,
			} } : {}),
			authorizedRetry: workflowMediaRetryForItem(context.flowVersionData, context.node.id),
			executionId: context.executionId,
			executionFamilyId: context.executionFamilyId,
			ownerId: context.ownerId,
			flowId: delivery?.flowId ?? context.flowId,
			projectId: delivery?.projectId ?? context.projectId,
			chapterId: delivery?.chapterId ?? null,
			runtimeNodeId: context.node.id,
			itemIndex: context.runtimeItemIndex ?? 0,
			prompt: promptPackage.prompt,
			negativePrompt: promptPackage.negativePrompt,
			modelKey,
			aspectRatio,
			imageSize,
			imageQuality: readString(data, "workflowImageQuality"),
			referenceAssetBindings,
			assetMetadata: workflowImageAssetMetadata(assetPlanInput),
			styleReferenceImages: projectContext?.visualStyle?.referenceImages,
			stylePrompt: projectContext?.visualStyle?.styleLock?.stylePrompt ?? null,
			styleFingerprint: projectContext?.visualStyle?.styleFingerprint ?? null,
			previousEvidence: previousItemRun?.evidence ?? (context.resumeOutputRefs?.evidence ?? null),
			resumeOnly: context.resumeOnly === true,
		});
		const evidence = {
			canvasNodeId: result.nodeId,
			taskId: result.taskId,
			providerStatus: result.status === "waiting_external" && !result.taskId ? "submitting" : result.status === "waiting_external" && result.observationFailure ? "unknown" : result.status,
			...(result.status === "waiting_external" && result.observationFailure ? { observationFailure: result.observationFailure } : {}),
			assetOrigin: "workflow_generation",
			...(result.status !== "failed" ? { taskReceiptReused: result.reused } : {}),
		};
		if (result.status === "waiting_external") {
			const pending = output({ node: context.node, executorRef, ports: {}, evidence: { ...evidence, executorCompleted: false } });
			if (!pending.ok) return pending;
			return workflowNodeWaiting(
				pending.outputRefs,
				workflowExternalPollAfter(WORKFLOW_PROVIDER_STATUS_POLL_MS),
			);
		}
		if (result.status === "failed") {
			return { ok: false, errorCode: "workflow_node_runtime_failed", errorMessage: result.errorMessage, outputRefs: output({ node: context.node, executorRef, ports: {}, evidence }).outputRefs };
		}
		return output({
			node: context.node,
			executorRef,
			ports: {
				[primaryOutputPort(data, "image")]: {
					assetPlan: firstInput(context.inputs, "asset-items") ?? null,
					imageUrl: result.imageUrl,
					generatedAssetId: result.assetId,
					nodeId: result.nodeId,
					taskId: result.taskId,
				},
			},
			artifacts: [{
				type: "tapcanvas.image/v1",
				identity: result.assetId ?? result.nodeId,
				value: result.imageUrl,
				media: {
					protocolVersion: "workflow.media-asset/v1",
					kind: "image",
					url: result.imageUrl,
					mimeType: null,
				},
			}],
			evidence: { ...evidence, imageUrl: result.imageUrl, assetId: result.assetId },
		});
	}

	if (executorRef === "tapcanvas.video.generate/v1" || executorRef === "tapcanvas.video.prepare/v1") {
		let prompt: string;
		let structuredClip: Readonly<Record<string, unknown>> | null = null;
		let durationSeconds: number;
		const productionPlan = firstInput(context.inputs, "production-plan");
		try {
			if (isRecord(productionPlan)) {
				if (data.workflowVideoReferencePolicy !== WORKFLOW_VIDEO_REFERENCE_POLICY) {
					throw new Error(`Workflow video node ${context.node.id} requires video references to be explicitly forbidden`);
				}
				assertWorkflowVideoReferencePolicy(productionPlan, "production-plan");
			}
			prompt = videoPrompt(context.inputs);
			const structuredClipValue = videoGenerationParameter(context.inputs, data, "structuredClip", "workflowVideoStructuredClip");
			if (isRecord(structuredClipValue) && Array.isArray(structuredClipValue.shots) && structuredClipValue.shots.length > 0) {
				structuredClip = structuredClipValue;
			} else if (isRecord(productionPlan)) {
				throw new Error("Workflow video generation requires the compiled structured Clip source");
			}
			durationSeconds = requiredPositiveInteger({
				value: videoGenerationParameter(context.inputs, data, "durationSeconds", "workflowVideoDurationSeconds"),
			}, "value");
		} catch (error: unknown) {
			return { ok: false, errorCode: "workflow_node_runtime_failed", errorMessage: error instanceof Error ? error.message : String(error) };
		}
		const modelKeyValue = videoGenerationParameter(context.inputs, data, "modelKey", "workflowVideoModelKey");
		const resolutionValue = videoGenerationParameter(context.inputs, data, "resolution", "workflowVideoResolution");
		const sizeValue = videoGenerationParameter(context.inputs, data, "size", "workflowVideoSize");
		const aspectRatioValue = videoGenerationParameter(context.inputs, data, "aspectRatio", "workflowVideoAspectRatio");
		const referenceImageNodeIdsValue = videoGenerationParameter(context.inputs, data, "referenceImageNodeIds", "workflowVideoReferenceImageNodeIds");
		const referenceAssetIdsValue = videoGenerationParameter(context.inputs, data, "referenceAssetIds", "workflowVideoReferenceAssetIds");
		const estimateIdentityValue = videoGenerationParameter(context.inputs, data, "estimateIdentity", "workflowVideoEstimateIdentity");
		const generationContractValue = videoGenerationParameter(context.inputs, data, "generationContract", "workflowVideoGenerationContract");
		const modelKey = typeof modelKeyValue === "string" ? modelKeyValue.trim() : "";
		const resolution = typeof resolutionValue === "string" ? resolutionValue.trim() : "";
		const size = typeof sizeValue === "string" ? sizeValue.trim() : "";
		const aspectRatio = typeof aspectRatioValue === "string" ? aspectRatioValue.trim() : "";
		const referenceImageNodeIds = Array.isArray(referenceImageNodeIdsValue)
			? [...new Set(referenceImageNodeIdsValue.flatMap((value) => typeof value === "string" && value.trim() ? [value.trim()] : []))]
			: [];
		const referenceAssetIds = Array.isArray(referenceAssetIdsValue)
			? [...new Set(referenceAssetIdsValue.flatMap((value) => typeof value === "string" && value.trim() ? [value.trim()] : []))]
			: [];
		const estimateIdentity = typeof estimateIdentityValue === "string" ? estimateIdentityValue.trim() : "";
		const generationContract = generationContractValue === undefined
			? null
			: parseVideoGenerationContract(generationContractValue);
		if (generationContractValue !== undefined && !generationContract) {
			return {
				ok: false,
				errorCode: "workflow_node_runtime_failed",
				errorMessage: `Workflow video node ${context.node.id} has an invalid frozen generation contract`,
			};
		}
		if (generationContract && generationContract.videoModel !== modelKey) {
			return {
				ok: false,
				errorCode: "workflow_node_runtime_failed",
				errorMessage: `Workflow video node ${context.node.id} generation contract model does not match ${modelKey}`,
			};
		}
		if (!modelKey || !resolution || !aspectRatio || (isRecord(productionPlan) && !estimateIdentity)) {
			return {
				ok: false,
				errorCode: "workflow_node_runtime_failed",
				errorMessage: `Workflow video node ${context.node.id} requires an explicit live-catalog model, duration, resolution and aspect ratio; production-plan inputs also require a frozen estimate identity`,
			};
		}
		const previousItemRun = context.resumeOutputRefs?.itemRuns.find((run) => run.runtimeNodeId === context.node.id) ?? null;
		const projectContext = runtimeProjectContext(context);
		const delivery = workflowDeliveryScope(context.flowVersionData);
		const videoRequest: WorkflowVideoRunRequest = {
            mediaDeliveryPolicy: readMediaDeliveryPolicy(data),
			executionId: context.executionId,
			executionFamilyId: context.executionFamilyId,
			ownerId: context.ownerId,
			flowId: delivery?.flowId ?? context.flowId,
			projectId: delivery?.projectId ?? context.projectId,
			chapterId: delivery?.chapterId ?? null,
			runtimeNodeId: context.node.id,
			itemIndex: context.runtimeItemIndex ?? 0,
			prompt,
			structuredClip,
			modelKey,
			durationSeconds,
				resolution,
				size,
				aspectRatio,
			referenceImageNodeIds,
			referenceAssetIds,
			styleReferenceImages: projectContext?.visualStyle?.referenceImages,
			stylePrompt: projectContext?.visualStyle?.styleLock?.stylePrompt ?? null,
			styleFingerprint: projectContext?.visualStyle?.styleFingerprint ?? null,
			estimateIdentity: estimateIdentity || null,
			generationContract,
			previousEvidence: previousItemRun?.evidence ?? (context.resumeOutputRefs?.evidence ?? null),
			resumeOnly: context.resumeOnly === true,
		};

    if (executorRef === "tapcanvas.video.prepare/v1") {
      if (!dependencies.prepareVideo) throw new Error("Video node preparation executor is unavailable");
      const prepared = await dependencies.prepareVideo(videoRequest);
      return output({ node: context.node, executorRef, ports: { "prepared-nodes": prepared }, artifacts: [{ type: "tapcanvas.video-node/v1", identity: prepared.nodeId, value: prepared }], evidence: { canvasNodeId: prepared.nodeId, promptPersisted: true, videoSubmitted: false } });
    }
    const result = await dependencies.runVideo(videoRequest);
		const evidence = {
			canvasNodeId: result.nodeId,
			taskId: result.taskId,
			providerStatus: result.status === "waiting_external" && result.observationFailure ? "unknown" : result.status,
			...(result.status === "waiting_external" && result.observationFailure ? { observationFailure: result.observationFailure } : {}),
			...(result.providerAcceptedAt ? { providerAcceptedAt: result.providerAcceptedAt } : {}),
			...(result.status !== "failed" ? { reused: result.reused } : {}),
			...(result.status === "failed" && result.errorCode
				? { providerErrorCode: result.errorCode }
				: {}),
			...(result.status === "failed" && result.providerRejectedReferenceIds?.length
				? { providerRejectedReferenceIds: [...result.providerRejectedReferenceIds] }
				: {}),
		};
		if (result.status === "waiting_external") {
			const pending = output({ node: context.node, executorRef, ports: {}, evidence: { ...evidence, executorCompleted: false } });
			if (!pending.ok) return pending;
			return workflowNodeWaiting(
				pending.outputRefs,
				workflowExternalPollAfter(WORKFLOW_PROVIDER_STATUS_POLL_MS),
			);
		}
		if (result.status === "failed") {
			return { ok: false, errorCode: "workflow_node_runtime_failed", errorMessage: result.errorMessage, outputRefs: output({ node: context.node, executorRef, ports: {}, evidence }).outputRefs };
		}
		const mediaWorkerEnabled = isMediaWorkerEnabled();
		const mediaProbe = mediaWorkerEnabled
			? await probeMediaViaMediaWorker({ url: result.videoUrl })
			: null;
		const previousMediaReadinessPolls = typeof previousItemRun?.evidence.mediaReadinessPolls === "number"
			&& Number.isInteger(previousItemRun.evidence.mediaReadinessPolls)
			&& previousItemRun.evidence.mediaReadinessPolls >= 0
			? previousItemRun.evidence.mediaReadinessPolls
			: 0;
		if (mediaWorkerEnabled && !mediaProbe) {
			const mediaReadinessPolls = previousMediaReadinessPolls + 1;
			if (mediaReadinessPolls >= WORKFLOW_MEDIA_READINESS_MAX_POLLS) {
				return {
					ok: false,
					errorCode: "workflow_node_runtime_failed",
					errorMessage: `Workflow video node ${context.node.id} media stayed undecodable after ${WORKFLOW_MEDIA_READINESS_MAX_POLLS} readiness polls`,
					outputRefs: output({
						node: context.node,
						executorRef,
						ports: {},
						evidence: {
							...evidence,
							executorCompleted: false,
							mediaReadiness: "failed",
							mediaReadinessPolls,
						},
					}).outputRefs,
				};
			}
			console.warn("[workflow-video-readiness] waiting for decodable provider media", {
				executionId: context.executionId,
				nodeId: context.node.id,
				taskId: result.taskId,
				videoUrl: result.videoUrl,
				mediaReadinessPolls,
			});
			const pending = output({
				node: context.node,
				executorRef,
				ports: {},
				evidence: {
					...evidence,
					executorCompleted: false,
					mediaReadiness: "waiting",
					mediaReadinessPolls,
				},
			});
			if (!pending.ok) return pending;
			return workflowNodeWaiting(
				pending.outputRefs,
				workflowExternalPollAfter(WORKFLOW_PROVIDER_STATUS_POLL_MS),
			);
		}
		return output({
			node: context.node,
			executorRef,
			ports: {
				[primaryOutputPort(data, "video")]: {
                    durationSeconds,
                    clipIndex: context.runtimeItemIndex ?? 0,
					videoUrl: result.videoUrl,
					nodeId: result.nodeId,
					taskId: result.taskId,
					...(projectContext?.visualStyle?.styleFingerprint
						? { styleFingerprint: projectContext.visualStyle.styleFingerprint }
						: {}),
				},
			},
			artifacts: [{
				type: "tapcanvas.video/v1",
				identity: result.nodeId,
				value: result.videoUrl,
				media: {
					protocolVersion: "workflow.media-asset/v1",
					kind: "video",
					url: result.videoUrl,
				mimeType: null,
					durationSeconds,
				},
			}],
			evidence: { ...evidence, videoUrl: result.videoUrl, thumbnailUrl: result.thumbnailUrl, mediaReadiness: "ready" },
		});
	}

	if (executorRef === "agents.skill.require/v1") {
		const skillId = readString(data, "workflowSkillId");
		if (!skillId) {
			return { ok: false, errorCode: "workflow_node_runtime_failed", errorMessage: `Workflow Skill node ${context.node.id} has no skill identity` };
		}
		return output({ node: context.node, executorRef, ports: { skills: [skillId] } });
	}

	if (executorRef === "agents.knowledge.search/v1") {
		if (!dependencies.searchKnowledge) {
			return { ok: false, errorCode: "workflow_node_runtime_failed", errorMessage: "Workflow Knowledge Search executor is unavailable" };
		}
		const query = knowledgeQuery(context.inputs, data);
		if (!query) {
			return { ok: false, errorCode: "workflow_node_runtime_failed", errorMessage: `Workflow Knowledge Search node ${context.node.id} requires a query` };
		}
		let limit: number;
		try {
			limit = knowledgeLimit(data);
		} catch (error: unknown) {
			return { ok: false, errorCode: "workflow_node_runtime_failed", errorMessage: error instanceof Error ? error.message : String(error) };
		}
		const roleScope = readString(data, "workflowKnowledgeRoleScope");
		const validRoles = new Set(["director", "storyboard", "generation", "editor", "post", "qa"]);
		if (roleScope && !validRoles.has(roleScope)) {
			return { ok: false, errorCode: "workflow_node_runtime_failed", errorMessage: `Workflow Knowledge Search node ${context.node.id} has an invalid role scope` };
		}
		const candidateSet = await dependencies.searchKnowledge({
			ownerId: context.ownerId,
			rawUserRequest: query,
			query,
			roleScope: roleScope || null,
			domain: readString(data, "workflowKnowledgeDomain") || null,
			strictFilters: data.workflowKnowledgeStrictFilters === true,
			limit,
		});
		return output({
			node: context.node,
			executorRef,
			ports: { "knowledge-candidates": candidateSet },
			artifacts: [{
				type: candidateSet.protocolVersion,
				identity: candidateSet.candidateSetId,
				value: candidateSet,
			}],
			evidence: {
				candidateSetId: candidateSet.candidateSetId,
				requestHash: candidateSet.requestHash,
				candidateCount: candidateSet.candidates.length,
				abstained: candidateSet.abstained,
				retrievalMode: candidateSet.retrievalMode,
			},
		});
	}

	if (executorRef === "agents.knowledge.read/v1") {
		if (!dependencies.readKnowledge) {
			return { ok: false, errorCode: "workflow_node_runtime_failed", errorMessage: "Workflow Knowledge Read executor is unavailable" };
		}
		const cardId = knowledgeCardId(context.inputs, data);
		if (!cardId) {
			return { ok: false, errorCode: "workflow_node_runtime_failed", errorMessage: `Workflow Knowledge Read node ${context.node.id} requires a card-id input` };
		}
		let candidateSet: WorkflowKnowledgeCandidateSetV2;
		try {
			candidateSet = parseWorkflowKnowledgeCandidateSetV2(firstInput(context.inputs, "knowledge-candidates"));
		} catch (error: unknown) {
			return { ok: false, errorCode: "workflow_node_runtime_failed", errorMessage: error instanceof Error ? error.message : String(error) };
		}
		const card = await dependencies.readKnowledge({ candidateSet, cardId });
		return output({
			node: context.node,
			executorRef,
			ports: { "knowledge-evidence": card },
			artifacts: [{ type: card.protocolVersion, identity: card.cardId, value: card }],
			evidence: {
				candidateSetId: card.candidateSetId,
				requestHash: card.requestHash,
				cardId: card.cardId,
			},
		});
	}

	if (executorRef === "agents.tool.allow/v1") {
		const toolId = readString(data, "workflowToolId");
		if (!toolId) {
			return { ok: false, errorCode: "workflow_node_runtime_failed", errorMessage: `Workflow tool node ${context.node.id} has no tool identity` };
		}
		return output({ node: context.node, executorRef, ports: { tools: [toolId] } });
	}

	if (executorRef === "agents.tool.invoke/v1") {
		if (!dependencies.invokeTool) {
			return { ok: false, errorCode: "workflow_node_runtime_failed", errorMessage: "Workflow Tool Invocation executor is unavailable" };
		}
		const toolName = readString(data, "workflowToolInvocationName");
		if (!toolName) {
			return { ok: false, errorCode: "workflow_node_runtime_failed", errorMessage: `Workflow Tool Invocation node ${context.node.id} has no exact tool identity` };
		}
		let configuredArgs: Record<string, unknown>;
		try {
			configuredArgs = toolInvocationArguments(context.inputs, data);
		} catch (error: unknown) {
			return { ok: false, errorCode: "workflow_node_runtime_failed", errorMessage: error instanceof Error ? error.message : String(error) };
		}
		const deliveryMetadata = workflowToolInvocationDeliveryMetadata(context.inputs);
		const args = stripWorkflowToolInvocationDeliveryMetadata(configuredArgs);
		const toolDelivery = workflowDeliveryScope(context.flowVersionData);
		const result = await dependencies.invokeTool({
			executionId: context.executionId,
			nodeId: context.node.id,
			ownerId: context.ownerId,
			projectId: toolDelivery?.projectId ?? context.projectId,
			flowId: toolDelivery?.flowId ?? context.flowId,
			chapterId: toolDelivery?.chapterId ?? null,
			toolName,
			args,
		});
		const rawValue = result.data ?? { content: result.content };
		const value = Object.keys(deliveryMetadata).length > 0 && isRecord(rawValue)
			? { ...rawValue, ...deliveryMetadata }
			: rawValue;
		return output({
			node: context.node,
			executorRef,
			ports: { result: value },
			artifacts: [{ type: "workflow.tool-result/v1", identity: `${context.executionId}:${context.node.id}`, value }],
			evidence: { toolName, execution: result.execution, completed: true },
		});
	}

	if (executorRef === "workflow.human.approval/v1") {
		const prompt = readString(data, "workflowHumanPrompt");
		if (!prompt) {
			return { ok: false, errorCode: "workflow_node_runtime_failed", errorMessage: `Workflow Human Approval node ${context.node.id} requires a prompt` };
		}
		const response = context.resumeOutputRefs?.evidence.humanResponse;
		if (response !== "approved" && response !== "rejected") {
			const pending = output({
				node: context.node,
				executorRef,
				ports: {},
				evidence: {
					executorCompleted: false,
					humanRequest: {
						requestId: `${context.executionId}:${context.node.id}`,
						prompt,
						responseType: "approval",
					},
				},
			});
			if (!pending.ok) return pending;
			return workflowNodeWaiting(pending.outputRefs, workflowExternalSignalOnly());
		}
		const decision = {
			protocolVersion: "workflow.human-decision/v1" as const,
			status: response,
			approved: response === "approved",
			respondedAt: context.resumeOutputRefs?.evidence.humanRespondedAt ?? null,
			respondedBy: context.resumeOutputRefs?.evidence.humanRespondedBy ?? null,
		};
		return output({
			node: context.node,
			executorRef,
			ports: { decision },
			artifacts: [{ type: "workflow.human-decision/v1", identity: `${context.executionId}:${context.node.id}`, value: decision }],
			evidence: { executorCompleted: true, humanResponse: response },
		});
	}

	if (executorRef === "workflow.control.condition/v1") {
		let condition: ReturnType<typeof evaluateWorkflowCondition>;
		try {
			condition = evaluateWorkflowCondition(data, firstInput(context.inputs, "value"));
		} catch (error: unknown) {
			return { ok: false, errorCode: "workflow_node_runtime_failed", errorMessage: error instanceof Error ? error.message : String(error) };
		}
		const selectedPort = condition.matched ? "matched" : "unmatched";
		const decision = {
			protocolVersion: "workflow.condition-decision/v1" as const,
			matched: condition.matched,
			pointer: condition.pointer,
			operator: condition.operator,
			selectedValue: condition.selectedValue,
		};
		return output({
			node: context.node,
			executorRef,
			ports: { [selectedPort]: decision },
			artifacts: [{ type: "workflow.condition-decision/v1", identity: `${context.executionId}:${context.node.id}`, value: decision }],
			evidence: { selectedOutputPort: selectedPort, matched: condition.matched },
		});
	}

	if (executorRef === "workflow.control.terminal/v1") {
		const outcome = readString(data, "workflowTerminalOutcome");
		const message = readString(data, "workflowTerminalMessage");
		if ((outcome !== "succeeded" && outcome !== "failed") || !message) {
			return { ok: false, errorCode: "workflow_node_runtime_failed", errorMessage: `Workflow Terminal node ${context.node.id} requires an explicit outcome and message` };
		}
		const receipt = {
			protocolVersion: "workflow.terminal-receipt/v1" as const,
			outcome,
			message,
			value: firstInput(context.inputs, "input"),
		};
		const terminalOutput = output({
			node: context.node,
			executorRef,
			ports: outcome === "succeeded" ? { result: receipt } : {},
			artifacts: [{ type: "workflow.terminal-receipt/v1", identity: `${context.executionId}:${context.node.id}`, value: receipt }],
			evidence: { terminalOutcome: outcome, terminalMessage: message },
		});
		if (outcome === "failed") {
			return {
				ok: false,
				errorCode: "workflow_explicit_failure_terminal",
				errorMessage: message,
				...(terminalOutput.ok ? { outputRefs: terminalOutput.outputRefs } : {}),
			};
		}
		return terminalOutput;
	}

	if (executorRef === "workflow.subworkflow.run/v1") {
		if (!dependencies.runSubworkflow || !context.flowVersionId) {
			return { ok: false, errorCode: "workflow_node_runtime_failed", errorMessage: "Workflow Subworkflow executor is unavailable or missing the immutable parent version identity" };
		}
		const targetFlowId = readString(data, "workflowSubflowFlowId");
		const targetFlowVersionId = readString(data, "workflowSubflowVersionId");
		const triggerNodeId = readString(data, "workflowSubflowTriggerNodeId");
		if (!targetFlowId || !targetFlowVersionId || !triggerNodeId) {
			return { ok: false, errorCode: "workflow_node_runtime_failed", errorMessage: `Workflow Subworkflow node ${context.node.id} requires target flow, immutable version, and trigger node identities` };
		}
		const rawAncestry = isRecord(context.flowVersionData) && Array.isArray(context.flowVersionData.workflowExecutionAncestry)
			? context.flowVersionData.workflowExecutionAncestry
			: [];
		const ancestry = rawAncestry.flatMap((value) => typeof value === "string" && value.trim() ? [value.trim()] : []);
		const childExecutionId = typeof context.resumeOutputRefs?.evidence.childExecutionId === "string"
			? context.resumeOutputRefs.evidence.childExecutionId.trim() || null
			: null;
		const result = await dependencies.runSubworkflow({
			parentExecutionId: context.executionId,
			parentNodeId: context.node.id,
			parentFlowVersionId: context.flowVersionId,
			ancestry,
			ownerId: context.ownerId,
			targetFlowId,
			targetFlowVersionId,
			triggerNodeId,
			input: firstInput(context.inputs, "input"),
			childExecutionId,
		});
		if (result.status === "waiting_external") {
			const pending = output({
				node: context.node,
				executorRef,
				ports: {},
				evidence: {
					executorCompleted: false,
					childExecutionId: result.childExecutionId,
					childFlowVersionId: result.childFlowVersionId,
					targetFlowVersionId,
				},
			});
			if (!pending.ok) return pending;
			return workflowNodeWaiting(
				pending.outputRefs,
				workflowExternalPollAfter(WORKFLOW_PROVIDER_STATUS_POLL_MS),
			);
		}
		if (result.status === "failed") {
			return { ok: false, errorCode: "workflow_subworkflow_failed", errorMessage: result.errorMessage };
		}
		const receipt = {
			childExecutionId: result.childExecutionId,
			childFlowVersionId: result.childFlowVersionId,
			targetFlowVersionId,
			nodeRuns: result.nodeRuns,
		};
		return output({
			node: context.node,
			executorRef,
			ports: { result: receipt },
			artifacts: [{ type: "workflow.subworkflow-receipt/v1", identity: result.childExecutionId, value: receipt }],
			evidence: { executorCompleted: true, childExecutionId: result.childExecutionId, childFlowVersionId: result.childFlowVersionId, targetFlowVersionId },
		});
	}

	if (executorRef === "workflow.control.join/v1") {
		return output({ node: context.node, executorRef, ports: { [primaryOutputPort(data, "joined")]: firstDeclaredInput(context) } });
	}

	if (executorRef === "workflow.artifact.contract/v1") {
		const artifactType = readString(data, "workflowOutputArtifactType");
		if (!artifactType) {
			return { ok: false, errorCode: "workflow_node_runtime_failed", errorMessage: `Workflow artifact node ${context.node.id} has no artifact type` };
		}
		const value = firstInput(context.inputs, "input");
		return output({
			node: context.node,
			executorRef,
			ports: { artifact: value },
			artifacts: [{ type: artifactType, identity: null, value }],
		});
	}

	if (executorRef === "agents.logical-task/v2") {
		const instruction = readString(data, "workflowInstruction");
		const outputArtifactType = readString(data, "workflowAgentOutputArtifactType");
		const outputEncoding = parseWorkflowAgentOutputEncoding(
			readString(data, "workflowAgentOutputEncoding"),
		);
		const isTypedOutput = outputEncoding !== "plain_text";
		const activeJsonArrayContract = outputEncoding === "json_array"
			? data.workflowAgentJsonArrayContract
			: undefined;
		const parsedJsonArrayContract = activeJsonArrayContract === undefined
			? null
			: parseWorkflowAgentJsonArrayContract(activeJsonArrayContract);
		const activeJsonObjectContract = outputEncoding === "json_object"
			? data.workflowAgentJsonObjectContract
			: undefined;
		let jsonObjectContract = activeJsonObjectContract === undefined
			? null
			: parseWorkflowAgentJsonObjectContract(activeJsonObjectContract);
		const agentDeliveryRequirement = readString(data, "workflowAgentDeliveryRequirement");
		const forcedAgentRole = readString(data, "workflowAgentDefinitionId");
		const configuredModelKey = readString(data, "workflowAgentModelKey");
		const promptExampleMediaType = readString(data, "workflowPromptExampleMediaType");
		if (promptExampleMediaType && promptExampleMediaType !== "image" && promptExampleMediaType !== "video") {
			return {
				ok: false,
				errorCode: "workflow_node_runtime_failed",
				errorMessage: `Workflow Agent node ${context.node.id} has invalid workflowPromptExampleMediaType`,
			};
		}
		const promptExampleRetrievalScope = promptExampleMediaType === "image" || promptExampleMediaType === "video"
			? {
				version: 3 as const,
				mediaType: promptExampleMediaType as "image" | "video",
				searchPolicy: outputArtifactType === "tapcanvas.clip-prompts/v2"
					? "required_non_blocking" as const
					: "agent_discretion" as const,
			}
			: null;
		const modelKey = resolveWorkflowAgentModelKey({
			flowVersionData: context.flowVersionData,
			configuredModelKey,
		});
		// Clip authoring is the first consumer that needs both the frozen semantic
		// contract and the materialized image branch. Join them before constructing
		// the Agent request so exact asset declarations, provider mapping and audit
		// evidence all see the same clip-scoped facts.
		const workflowInputs: WorkflowInputPorts = (() => {
			if (outputArtifactType !== "tapcanvas.clip-prompts/v2" || !context.inputs["asset-bindings"]?.length) {
				return context.inputs;
			}
			const clipContext = firstInput(context.inputs, "clip-contexts");
			const materializedAssets = firstInput(context.inputs, "asset-bindings");
			if (clipContext === undefined || materializedAssets === undefined) return context.inputs;
			const enriched = enrichVideoClipContextWithMaterializedAssets({
				contextItem: clipContext,
				materializedAssetCollection: materializedAssets,
			});
			return { ...context.inputs, "clip-contexts": [enriched] };
		})();
		const inputs = workflowInputs;
		let assetPlanningAllowedRoles: readonly string[] = [];
		let assetPlanningRequiredRoles: readonly string[] = [];
		let assetPlanningReusableFacts: WorkflowReusableAssetRoleFacts = {};
		let jsonArrayContract = applyWorkflowArtifactJsonArrayContract(
			outputArtifactType,
			parsedJsonArrayContract,
		);
		if (outputEncoding === "json_array" && outputArtifactType === "tapcanvas.asset-plans/v1" && jsonArrayContract) {
			let clipIds: string[];
			let allowedRoles: readonly string[];
			let reusableAssetFacts: WorkflowReusableAssetRoleFacts;
			try {
				clipIds = resolveFrozenClipIds(inputs);
				allowedRoles = resolveVideoAssetRoleAllowlist(firstInput(inputs, "beat-sheet"));
				reusableAssetFacts = reusableWorkflowAssetRoleFacts(
					inputs,
					runtimeProjectContext(context),
					allowedRoles,
				);
				assetPlanningReusableFacts = reusableAssetFacts;
				assetPlanningRequiredRoles = allowedRoles;
				assetPlanningAllowedRoles = allowedRoles.filter((role) => !reusableAssetFacts[role]);
			} catch (error: unknown) {
				return {
					ok: false,
					errorCode: "workflow_node_runtime_failed",
					errorMessage: error instanceof Error ? error.message : String(error),
				};
			}
			const itemStringAllowedValues: Record<string, readonly string[]> = {
				...jsonArrayContract.itemStringAllowedValues,
			};
			if (assetPlanningAllowedRoles.length > 0) {
				itemStringAllowedValues.role = assetPlanningAllowedRoles;
			} else {
				delete itemStringAllowedValues.role;
			}
			const characterIdentityFacts = Object.fromEntries(assetPlanningAllowedRoles.flatMap((role) => {
				const separatorIndex = role.indexOf("://");
				const kind = separatorIndex > 0 ? role.slice(0, separatorIndex) : "";
				const roleName = separatorIndex > 0 ? role.slice(separatorIndex + 3).trim() : "";
				return kind === "character" && roleName
					? [[role, {
						referenceType: "character",
						roleName,
						characterAssetRole: "identity_anchor",
						characterProfileVersion: "character-card/v3",
					}] as const]
					: [];
			}));
			const characterIdentityArrayFields = Object.fromEntries(
				Object.keys(characterIdentityFacts).map((role) => [role, ["identityAnchors", "prohibitedDrift"]]),
			);
			const characterIdentityContractFields = [
				"referenceType",
				"roleName",
				"characterAssetRole",
				"characterProfileVersion",
				"identityBoardSpec",
				"sceneCard",
				"identityAnchors",
				"prohibitedDrift",
			] as const;
			jsonArrayContract = {
				...jsonArrayContract,
				minimumArrayLength: assetPlanningAllowedRoles.length === 0 ? 0 : 1,
				...(Object.keys(itemStringAllowedValues).length > 0
					? { itemStringAllowedValues }
					: { itemStringAllowedValues: undefined }),
				itemStringArrayAllowedValues: {
					...jsonArrayContract.itemStringArrayAllowedValues,
					consumerClipIds: clipIds,
				},
				...(Object.keys(characterIdentityFacts).length > 0
					? {
						itemExactStringFieldsByIdentity: {
							identityField: "role",
							values: characterIdentityFacts,
						},
						itemRequiredNonEmptyArrayFieldsByIdentity: {
							identityField: "role",
							values: characterIdentityArrayFields,
						},
						...(jsonArrayContract.itemAllowedFields
							? {
								itemAllowedFields: [...new Set([
									...jsonArrayContract.itemAllowedFields,
									...characterIdentityContractFields,
								])],
							}
							: {}),
					}
					: {}),
			};
		}
        if (outputArtifactType === "tapcanvas.clip-design/v1" && jsonObjectContract) {
            const item = firstInput(inputs, "clip-design-inputs");
            if (!isRecord(item) || !isRecord(item.beat) || !Array.isArray(item.objectRegistry) || !Array.isArray(item.backgroundPlans) || !Array.isArray(item.speechLedger)) {
                throw new Error("Clip design requires one declared clip-design-inputs item");
            }
            const speechLineIds = item.speechLedger.map((entry: unknown) => isRecord(entry) ? entry.lineId : null);
            const objectIds = item.objectRegistry.map((entry: unknown) => isRecord(entry) ? entry.objectId : null);
            const backgroundObjectIds = item.backgroundPlans.map((entry: unknown) => isRecord(entry) ? entry.objectId : null);
            if (typeof item.clipIndex !== "number" || typeof item.beat.durationSeconds !== "number" || speechLineIds.some(id => typeof id !== "string") || objectIds.some(id => typeof id !== "string") || backgroundObjectIds.some(id => typeof id !== "string")) {
                throw new Error("Clip design input has invalid frozen identity or duration");
            }
            jsonObjectContract = { ...jsonObjectContract, jsonSchema: bindClipDesignSchema({
                clipIndex: item.clipIndex, durationSeconds: item.beat.durationSeconds, speechLineIds: speechLineIds as string[], objectIds: objectIds as string[], backgroundObjectIds: backgroundObjectIds as string[],
            }) };
        }
        const referenceContext = runtimeProjectContext(context);
        if (jsonObjectContract?.jsonSchema && referenceContext) {
            jsonObjectContract = { ...jsonObjectContract,
                jsonSchema: bindRegisteredAssetReferenceSchema(jsonObjectContract.jsonSchema, referenceContext),
            };
        }
		jsonObjectContract = applyWorkflowArtifactJsonObjectContract(
			outputArtifactType,
			jsonObjectContract,
		);
		if (
			outputEncoding === "json_object" &&
			(outputArtifactType === "tapcanvas.beat-sheet/v2" || outputArtifactType === "tapcanvas.launch-beat-sheet/v1" || outputArtifactType === "tapcanvas.chapter-beat-plan/v1") &&
			jsonObjectContract
		) {
			try {
				const sourceLineage = resolveAuthoritativeSourceLineage(inputs);
				jsonObjectContract = {
					...jsonObjectContract,
					requiredStringFields: [...new Set([
						...(jsonObjectContract.requiredStringFields ?? []),
						"sourceId",
						"sourceFingerprint",
					])],
					exactStringFields: {
						...jsonObjectContract.exactStringFields,
						...sourceLineage,
					},
                    ...(jsonObjectContract.jsonSchema ? { jsonSchema: {
                        ...jsonObjectContract.jsonSchema,
                        properties: {
                            ...(isRecord(jsonObjectContract.jsonSchema.properties) ? jsonObjectContract.jsonSchema.properties : {}),
                            sourceId: { type: "string", const: sourceLineage.sourceId },
                            sourceFingerprint: { type: "string", const: sourceLineage.sourceFingerprint },
                        },
                    } } : {}),
					allowedFields: [...new Set([
						...jsonObjectContract.allowedFields,
						"sourceId",
						"sourceFingerprint",
					])],
				};
			} catch (error: unknown) {
				return {
					ok: false,
					errorCode: "workflow_node_runtime_failed",
					errorMessage: error instanceof Error ? error.message : String(error),
				};
			}
		}
		if (
			outputEncoding === "json_object"
			&& outputArtifactType === "tapcanvas.clip-prompts/v2"
			&& jsonObjectContract?.requiredArrayFields?.includes("clips")
		) {
			try {
					const writerFacts = resolveFrozenSingleClipWriterFacts(inputs);
				if (writerFacts === null) {
					throw new Error("Clip prompt Agent requires frozen single-Clip writer facts");
				}
				jsonObjectContract = applyWorkflowAgentArrayItemExactNumberFields(
					jsonObjectContract,
					"clips",
					[{ clipIndex: writerFacts.clipIndex, durationSeconds: writerFacts.durationSeconds }],
				);
				jsonObjectContract = applyWorkflowAgentArrayItemExactStringFields(
					jsonObjectContract,
					"clips",
					[{ clipId: writerFacts.clipId, exitState: writerFacts.exitState }],
				);
				jsonObjectContract = applyWorkflowAgentArrayItemExactStringArrayFields(
					jsonObjectContract,
					"clips",
					[{ characterRoleNames: writerFacts.characterRoleNames }],
				);
			} catch (error: unknown) {
				return {
					ok: false,
					errorCode: "workflow_node_runtime_failed",
					errorMessage: error instanceof Error ? error.message : String(error),
				};
			}
		}
		let maxOutputTokens: number;
		const initiatingExecution = parseWorkflowInitiatingAgentExecution(context.flowVersionData);
		let reasoningEffort: WorkflowAgentReasoningEffort | undefined;
		try {
			maxOutputTokens = requiredAgentMaxOutputTokens(data);
			reasoningEffort = initiatingExecution
				? initiatingExecution.reasoningEffort
				: optionalAgentReasoningEffort(data);
		} catch (error: unknown) {
			return {
				ok: false,
				errorCode: "workflow_node_runtime_failed",
				errorMessage: error instanceof Error ? error.message : String(error),
			};
		}
		if (!instruction || !outputArtifactType || !outputEncoding || !agentDeliveryRequirement || !forcedAgentRole || !modelKey) {
			return {
				ok: false,
				errorCode: "workflow_node_runtime_failed",
				errorMessage: `Workflow Agent node ${context.node.id} requires an explicit agent identity, a resolved inherited or explicit enabled model identity, instruction, output artifact type, output encoding and its own delivery requirement`,
			};
		}
		if (activeJsonArrayContract !== undefined && !parsedJsonArrayContract) {
			return {
				ok: false,
				errorCode: "workflow_node_runtime_failed",
				errorMessage: `Workflow Agent node ${context.node.id} has an invalid json_array structural contract`,
			};
		}
		if (outputEncoding === "json_object" && !jsonObjectContract) {
			return {
				ok: false,
				errorCode: "workflow_node_runtime_failed",
				errorMessage: `Workflow Agent node ${context.node.id} requires a valid json_object structural contract`,
			};
		}
		// 资产精确声明合同：把配置形态（expectedAssetPlansFromPort）解析为本次
		// 冻结的 expected 身份集合同时进入首稿提示与输出校验，使模型在唯一
		// 一次提交前看到完整可执行边界。
		if (
			outputEncoding === "json_object"
			&& jsonObjectContract
		) {
            if (outputArtifactType === "tapcanvas.chapter-beat-plan/v1" && jsonObjectContract.jsonSchema) {
                const allowedDurations = allowedProviderClipDurations(inputs);
                if (!allowedDurations) throw new Error("Chapter planning requires live provider duration options from delivery-contract");
                const schema = jsonObjectContract.jsonSchema;
                const properties = isRecord(schema.properties) ? schema.properties : {};
                const beats = isRecord(properties.beats) ? properties.beats : {};
                const items = isRecord(beats.items) ? beats.items : {};
                jsonObjectContract = { ...jsonObjectContract, jsonSchema: { ...schema, properties: { ...properties,
                    beats: { ...beats, items: { ...items, properties: {
                        ...(isRecord(items.properties) ? items.properties : {}),
                        durationSeconds: { type: "number", enum: allowedDurations },
                    } } },
                } } };
            }
			if (outputArtifactType === "tapcanvas.beat-sheet/v2" && jsonObjectContract.requiredArrayFields?.includes("beats")) {
					const allowedDurations = allowedProviderClipDurations(inputs);
				if (!allowedDurations) {
					throw new Error("BeatSheet Agent requires live provider duration options from delivery-contract");
				}
				jsonObjectContract = {
					...jsonObjectContract,
					arrayItemNumberAllowedValues: {
						...jsonObjectContract.arrayItemNumberAllowedValues,
						beats: {
							...jsonObjectContract.arrayItemNumberAllowedValues?.beats,
							durationSeconds: allowedDurations,
						},
					},
				};
					const providerClipFacts = explicitProviderClipFacts(inputs);
				if (providerClipFacts) {
					jsonObjectContract = applyWorkflowAgentArrayItemExactNumberFields(
						jsonObjectContract,
						"beats",
						providerClipFacts.durations.map((durationSeconds) => ({ durationSeconds })),
					);
				} else {
						const requestedClipCount = requestedProviderClipCount(inputs);
					if (requestedClipCount !== null) {
						jsonObjectContract = {
							...jsonObjectContract,
							expectedArrayLengths: {
								...jsonObjectContract.expectedArrayLengths,
								beats: requestedClipCount,
							},
						};
					}
				}
			}
			// 运行时自动注入（不依赖工作流版本配置）：凡输出合同为「单顶层数组」
			// 形态且输入端口携带 assetPlans 的 Agent 节点（视频 writer 类），都强制
			// 资产精确声明在首稿 item 合同内完成。旧保存的工作流可能缺
			// itemExactAssetIds 配置，运行时从冻结输入补足这一确定性执行合同。
			if (
				!jsonObjectContract.itemExactAssetIds
				&& jsonObjectContract.requiredArrayFields?.length === 1
				&& (jsonObjectContract.requiredStringFields?.length ?? 0) === 0
				&& (jsonObjectContract.requiredNumberFields?.length ?? 0) === 0
				&& (jsonObjectContract.requiredObjectFields?.length ?? 0) === 0
			) {
				const assetPlansPort = findAssetPlansPort(inputs);
				if (assetPlansPort) {
					jsonObjectContract = {
						...jsonObjectContract,
						itemExactAssetIds: {
							declarationPaths: ["assetObjectContracts"],
							expectedAssetPlansFromPort: assetPlansPort,
						},
					};
				}
			}
			const exactConfig = jsonObjectContract.itemExactAssetIds
				&& "expectedAssetPlansFromPort" in jsonObjectContract.itemExactAssetIds
				? jsonObjectContract.itemExactAssetIds
				: null;
			if (exactConfig) {
				let expected: string[];
				try {
					expected = resolvePlannedAssetIdsFromPort(inputs, exactConfig.expectedAssetPlansFromPort);
				} catch (error: unknown) {
					return {
						ok: false,
						errorCode: "workflow_node_runtime_failed",
						errorMessage: `Workflow Agent node ${context.node.id} exact asset contract is misconfigured: ${error instanceof Error ? error.message : String(error)}`,
					};
				}
				jsonObjectContract = {
					...jsonObjectContract,
					itemExactAssetIds: {
						declarationPaths: exactConfig.declarationPaths,
						expected,
					},
				};
			}
		}
		const previousEvidence = previousAgentEvidence(context);
		const previousDeliveryEvidence = isRecord(previousEvidence?.deliveryEvidence)
			? previousEvidence.deliveryEvidence : null;
		// Recovery reuses artifacts, not another execution's durable session.
		// Keep the old receipt/candidate for audit and repair, but admit a fresh
		// turn when its exact session identity belongs to the recovery source.
		const inheritedAgentSession = context.recoveryOfExecutionId != null
			&& typeof previousDeliveryEvidence?.sessionKey === "string"
			&& previousDeliveryEvidence.sessionKey !== workflowAgentSessionKey({
				executionId: context.executionId, nodeId: context.node.id, physicalRetryOrdinal: null,
			});
		const outputRepair = readWorkflowAgentOutputRepair(previousEvidence);
		const physicalRetryFailure = parseWorkflowAgentPhysicalFailureEvidence(previousEvidence);
		const hasPhysicalRetryCheckpoint = !inheritedAgentSession && physicalRetryFailure !== null;
		if (previousEvidence) {
			const previousDelivery = isRecord(previousEvidence.deliveryEvidence)
				? previousEvidence.deliveryEvidence
				: previousEvidence;
			console.info(JSON.stringify({
				message: "workflow_agent_resume_cursor",
				executionId: context.executionId,
				nodeId: context.node.id,
				contextResumeOnly: context.resumeOnly === true,
				inheritedAgentSession,
				hasPhysicalRetryCheckpoint,
				physicalRetryOrdinal: previousDelivery.physicalRetryOrdinal ?? null,
			}));
		}
		// A physical run ending does not terminate its logical delivery task.
		// The durable runner consumes the checkpoint under the recovery family fence.
		const workflowRequiredSkills = uniqueStrings(
			stringListFromData(data, "workflowRequiredSkills"),
		);
		// Frozen requiredSkills are preloaded dependencies, not a closed discovery
		// scope. Keep skill_search available so every workflow can discover newly
		// added or task-specific Skills in the same authoring chain.
		const workflowKnowledgeTools = WORKFLOW_AGENT_KNOWLEDGE_TOOLS;
		// Output encoding is not a permission policy. Preserve the frozen IR's
		// explicit tools for JSON and text alike. Actual media facts expose only
		// understanding capabilities; generation still requires an explicit grant.
		const agentAllowedTools = uniqueStrings([
			...workflowKnowledgeTools,
			...(runtimeProjectContext(context) ? ["tapcanvas_workflow_execution_inspect"] : []),
			...workflowAgentMediaEvidenceTools(runtimeProjectContext(context)),
			...stringListFromData(data, "workflowAllowedTools"),
			...stringListFromInput(inputs, "tools"),
			...(promptExampleRetrievalScope ? ["prompt_example_search", "prompt_example_read"] : []),
		]);
		let agentResult: WorkflowAgentRunResult;
		try {
			// 系统级共享工作流（delivery 重定向到调用者项目）：agent 节点以调用者
			// 项目/画布为工具作用域执行，使 beat-sheet / asset-coverage / clip-writer
			// 能读取并复用调用者项目内的真实资产（画布图片/视频节点、素材库）。
			// 工作流定义（instruction/合同）仍来自模板，交付仍写回 delivery flow。
			const agentDelivery = workflowDeliveryScope(context.flowVersionData);
			const productionStartDeadline = runtimeProductionStartDeadline(context);
			const runtimeInstruction = [
				instruction,
				runtimeAuthoritativeSourceInstruction(inputs, outputArtifactType),
				runtimeBeatSheetCapacityInstruction(inputs, context.flowVersionData, outputArtifactType),
				outputArtifactType === "tapcanvas.beat-sheet/v2" ? runtimeBeatSheetStructuralChecklist() : "",
				outputArtifactType === "tapcanvas.asset-plans/v1"
					? [
						runtimeBeatSheetInstruction(inputs),
						workflowProjectImageCandidateInstruction(
						runtimeProjectContext(context),
						assetPlanningAllowedRoles,
					),
					].filter((value) => value.trim().length > 0).join("\n\n")
					: "",
			].filter((value) => value.trim().length > 0).join("\n\n");
			const structurallyEmptyAssetPlan = outputArtifactType === "tapcanvas.asset-plans/v1"
				&& assetPlanningAllowedRoles.length === 0;
			if (structurallyEmptyAssetPlan) {
				const taskId = `${context.executionFamilyId}:${context.node.id}:empty-asset-plan`;
				const terminalReason = assetPlanningRequiredRoles.length === 0
					? "frozen_asset_reference_set_empty"
					: "all_frozen_asset_references_reused";
				agentResult = {
					taskId,
					text: "[]",
					assets: [],
					...projectWorkflowAtomicDelivery({
						taskId,
						instruction: runtimeInstruction,
						outputArtifactType,
						outputEncoding,
						deliveryRequirement: agentDeliveryRequirement,
						validatedText: "[]",
						terminalReason,
					}),
					requestTerminal: {
						version: 1,
						terminal: true,
						status: "succeeded",
						reason: terminalReason,
					},
				};
			} else agentResult = await dependencies.runAgent({
				executionId: context.executionId,
				executionFamilyId: context.executionFamilyId,
				nodeId: context.node.id,
				ownerId: context.ownerId,
				flowId: agentDelivery?.flowId ?? context.flowId,
				projectId: agentDelivery?.projectId ?? context.projectId,
				workflowKey: context.workflowKey,
				instruction: runtimeInstruction,
				outputArtifactType,
				outputEncoding,
				jsonArrayContract,
				jsonObjectContract,
				deliveryRequirement: agentDeliveryRequirement,
				modelKey,
				maxOutputTokens,
				...(reasoningEffort ? { reasoningEffort } : {}),
				...(initiatingExecution?.serviceTier ? { serviceTier: initiatingExecution.serviceTier } : {}),
				inputs,
				// A Workflow Agent's Skill dependencies are part of the frozen node
				// definition, just like its executor, model and output contract. Do not
				// erase them and ask the model to rediscover its own runtime dependency.
				requiredSkills: workflowRequiredSkills,
				mountedKnowledgeCardIds: mountedKnowledgeCardsFromInputs(inputs),
				disabledSkills: [],
				disabledKnowledgeCardIds: [],
				allowedTools: agentAllowedTools,
				...(promptExampleRetrievalScope
					? { promptExampleRetrievalScope }
					: {}),
				forcedAgentRole,
				// Plain-text work may resume an accepted durable turn. Typed nodes are
				// fenced above and never reach this call through a second physical window.
				resumeOnly: !inheritedAgentSession && (context.resumeOnly === true || hasPhysicalRetryCheckpoint),
				previousEvidence,
				...(productionStartDeadline ? { productionStartDeadline } : {}),
				// The caller's public turn is provenance, not the execution owner.
				// All resumed members share the durable workflow family's budget.
				logicalTaskBudgetRootId: context.executionFamilyId,
				...(agentDelivery ? { deliveryScope: agentDelivery } : {}),
				projectContext: runtimeProjectContext(context),
				// Read the immutable execution snapshot even when this node only
				// receives a sliced collection item and has no trigger edge.
				userIntentContract: readWorkflowUserIntent(
					workflowSnapshotFact(context, null, WORKFLOW_USER_INTENT_FIELD), context.ownerId,
				)?.contract,
				// Internal workflow Agents consume the typed upstream ports plus the
				// node-specific compact runtime instructions above. Do not serialize the
				// entire frozen ProjectContext into every Agent prompt. The Agent runner
				// projects only compact facts; BeatSheet authoring additionally receives
				// the complete ready project-image identity registry so semantic reuse is
				// frozen once before deterministic asset fan-out.
				...(context.abortSignal ? { abortSignal: context.abortSignal } : {}),
			});
		} catch (error: unknown) {
			const outputContractFailure = workflowAgentOutputContractFailure(error);
			if (outputContractFailure) {
				const recorded = output({
					node: context.node,
					executorRef,
					ports: {},
					evidence: {
						executorCompleted: false,
						structuredOutputSubmissionPolicy: WORKFLOW_STRUCTURED_OUTPUT_REPAIRABLE_POLICY,
						outputContractFailure: {
							code: "structured_output_invalid",
							message: outputContractFailure,
							rawOutputRecorded: "agents_cli_trace",
						},
					},
				});
				if (!recorded.ok) return recorded;
				return {
					ok: false,
					errorCode: "workflow_node_runtime_failed",
					errorMessage: outputContractFailure,
					outputRefs: recorded.outputRefs,
				};
			}
			if (isWorkflowAgentRateLimitError(error)) {
				const pending = output({
					node: context.node,
					executorRef,
					ports: {},
					evidence: {
						executorCompleted: false,
						deliveryEvidence: createWorkflowAgentRateLimitBackpressureEvidence(
							previousAgentEvidence(context),
							Date.now(),
							`${context.executionFamilyId}:${context.node.id}`,
						),
					},
				});
				if (!pending.ok) return pending;
				return workflowNodeWaiting(
					pending.outputRefs,
					workflowAgentExternalCheckSchedule({
						deliveryEvidence: pending.outputRefs.evidence.deliveryEvidence,
						reason: "workflow_agent_rate_limit_backpressure",
					}),
				);
			}
				if (isWorkflowAgentSessionTurnInflightError(error)) {
					// Our own dispatch paths can race for one session: the bridge keeps
					// the owning turn and rejects the newcomer with a structural
					// not_started receipt. No model or tool action ran, so wait for
					// ownership instead of terminalising the node or spending the
					// physical retry budget on a local scheduling conflict.
					const busy = output({
						node: context.node,
						executorRef,
						ports: {},
						evidence: {
							executorCompleted: false,
							deliveryEvidence: createWorkflowAgentSessionTurnInflightEvidence(
								previousAgentEvidence(context),
								error,
							),
						},
					});
					if (!busy.ok) return busy;
					return workflowNodeWaiting(
						busy.outputRefs,
						workflowAgentExternalCheckSchedule({
							deliveryEvidence: busy.outputRefs.evidence.deliveryEvidence,
							reason: "workflow_agent_session_turn_inflight",
						}),
					);
				}
				throw error;
			}
		// A Workflow Agent physical window may end in a machine-issued suspended
		// state while agents-cli is still continuing the same logical task.  The
		// transport projection can contain the human-facing suspension notice in
		// `text`; that text is lifecycle evidence, never the typed artifact.  Read
		// the terminal envelope before any artifact compiler/parser so a suspended
		// window cannot be misclassified as malformed JSON.
		const requestTerminal = parseAgentRequestTerminal(agentResult.requestTerminal);
		if (requestTerminal?.status === "suspended") {
			const suspendedOutput = output({
				node: context.node,
				executorRef,
				ports: { [primaryOutputPort(data, "result")]: agentResult },
				artifacts: agentResult.assets.map((asset) => ({
					type: `tapcanvas.${asset.type}/v1`,
					identity: asset.assetId,
					value: asset.url,
				})),
				evidence: {
					taskId: agentResult.taskId,
					outputEncoding,
					outputArtifactType,
					structuredOutputSubmissionPolicy: WORKFLOW_STRUCTURED_OUTPUT_REPAIRABLE_POLICY,
					executorCompleted: false,
					deliveryEvidence: agentResult.deliveryEvidence,
					deliveryVerification: agentResult.deliveryVerification,
					requestTerminal: agentResult.requestTerminal,
					continuationReason: requestTerminal.reason,
					...(outputRepair ? { outputRepair } : {}),
					...(agentResult.executionProvenance
						? { executionProvenance: agentResult.executionProvenance }
						: {}),
					...(agentResult.executionProvenanceHistory?.length
						? { executionProvenanceHistory: agentResult.executionProvenanceHistory }
						: {}),
					...(agentResult.upstreamRequestContexts?.length
						? { upstreamRequestContexts: agentResult.upstreamRequestContexts }
						: {}),
					...(agentResult.structuredOutputReview
						? { structuredOutputReview: agentResult.structuredOutputReview }
						: {}),
				},
			});
			if (!suspendedOutput.ok) return suspendedOutput;
			return workflowNodeWaiting({
				...suspendedOutput.outputRefs,
				ports: {},
				artifacts: [],
				evidence: {
					...suspendedOutput.outputRefs.evidence,
					executorCompleted: false,
				},
			}, workflowAgentExternalCheckSchedule({
				deliveryEvidence: agentResult.deliveryEvidence,
				reason: requestTerminal.reason,
			}));
		}
		const clipContext = outputArtifactType === "tapcanvas.clip-prompts/v2"
			? firstInput(inputs, "clip-contexts")
			: null;
		const frozenContextWriterCompilation = outputArtifactType === "tapcanvas.clip-prompts/v2"
			? compileWorkflowClipWriterFrozenEnvelope({
				text: agentResult.text,
				contextItem: clipContext,
			})
			: null;
		const frozenContextWriterText = frozenContextWriterCompilation?.ok
			? frozenContextWriterCompilation.text
			: null;
		let validatedOutput = outputArtifactType === "tapcanvas.clip-prompts/v2"
			&& frozenContextWriterCompilation
			&& !frozenContextWriterCompilation.ok
			? {
				ok: false as const,
				errorMessage: frozenContextWriterCompilation.errorMessage,
			}
			: validateWorkflowAgentOutput({
				encoding: outputEncoding,
				artifactType: outputArtifactType,
				rawText: frozenContextWriterText ?? agentResult.text,
				jsonArrayContract,
				jsonObjectContract,
			});
		if (validatedOutput.ok && outputArtifactType === "tapcanvas.clip-design/v1") {
			try {
				const item = firstInput(inputs, "clip-design-inputs");
				if (!isRecord(item) || !Array.isArray(item.objectRegistry) || !item.objectRegistry.every(isRecord)) {
					throw new Error("Clip design requires its frozen object registry");
				}
				validateClipDesignReferences(parseClipDesign({ text: validatedOutput.text }), item.objectRegistry);
			} catch (error: unknown) {
				validatedOutput = { ok: false, errorMessage: error instanceof Error ? error.message : String(error) };
			}
		}
		if (validatedOutput.ok && outputArtifactType === "tapcanvas.asset-plans/v1") {
			const reuseError = validateWorkflowAssetPlanProjectReuse({
				assetAgentResult: { text: validatedOutput.text },
				projectContext: runtimeProjectContext(context),
			});
			if (reuseError) {
				validatedOutput = {
					ok: false,
					errorMessage: `Workflow Agent asset reuse contract violated: ${reuseError}`,
				};
			}
		}
		if (validatedOutput.ok && outputArtifactType === "tapcanvas.voice-plan/v1") {
			try {
				const voiceCatalog = parseWorkflowVoiceCatalog(firstInput(context.inputs, "voice-catalog"));
				parseAndValidateWorkflowVoicePlan({ voicePlan: { text: validatedOutput.text }, voiceCatalog });
			} catch (error: unknown) {
				validatedOutput = {
					ok: false,
					errorMessage: `Workflow voice plan contract violated: ${error instanceof Error ? error.message : String(error)}`,
				};
			}
		}
		const isBeatSheetArtifact = outputArtifactType === "tapcanvas.beat-sheet/v2"
			|| outputArtifactType === "tapcanvas.launch-beat-sheet/v1";
		if (validatedOutput.ok && isBeatSheetArtifact) {
			const launchBeat = firstInput(inputs, "beat-sheet");
			if (launchBeat !== undefined) {
				const launchPrefixError = validateAcceptedLaunchBeatPrefix({
					launchBeat,
					fullBeatSheetText: validatedOutput.text,
				});
				if (launchPrefixError) {
					validatedOutput = {
						ok: false,
						errorMessage: `Workflow BeatSheet launch-prefix contract violated: ${launchPrefixError}`,
					};
				}
			}
			if (validatedOutput.ok) {
				const selectedAssetBindingError = validateWorkflowBeatSheetProjectAssetBindings({
					beatSheetText: validatedOutput.text,
					projectContext: runtimeProjectContext(context),
				});
				if (selectedAssetBindingError) {
					validatedOutput = {
						ok: false,
						errorMessage: `Workflow BeatSheet project-asset contract violated: ${selectedAssetBindingError}`,
					};
				}
			}
			// 原文覆盖合同：BeatSheet 是整章唯一事实源，其人声台账必须逐字来自 canonical 原文、
			// 覆盖原文人声。来源事实错误在同一逻辑任务内回灌修订，
			// 而不是让「整章被压成几个 clip」的摘要当作合法交付流到画布。
			if (validatedOutput.ok) {
				const sourceCoverageError = validateBeatSheetSourceCoverage({
					beatSheetText: validatedOutput.text,
					deliveryContract: firstInput(inputs, "delivery-contract"),
				});
				if (sourceCoverageError) {
					validatedOutput = {
						ok: false,
						errorMessage: `Workflow BeatSheet source-coverage contract violated: ${sourceCoverageError}`,
					};
				}
			}
		}
		if (validatedOutput.ok && isBeatSheetArtifact) {
			const capacityObservation = diagnoseBeatSheetSpeechCapacity({
				beatSheetText: validatedOutput.text,
				deliveryContract: firstInput(inputs, "delivery-contract"),
			});
			if (capacityObservation) {
				validatedOutput = { ...validatedOutput, diagnostics: [
					...(validatedOutput.diagnostics ?? []),
					{ code: "model_authored_consistency", message: capacityObservation },
				] };
			}
		}
		if (validatedOutput.ok && isBeatSheetArtifact
			&& jsonObjectContract?.requiredArrayFields?.includes("assetPlans")) {
			try {
				const beatSheet = { text: validatedOutput.text };
				/*
				 * 交付文本是剥掉 objectRegistry 的紧凑投影，而计划的角色必须从章级注册表编译
				 * （现行合同要求计划用 objectId 命名对象）。这里把作者原始候选里的注册表显式
				 * 传给投影；缺了它任何按合同写对的计划都无法编译出角色，作者永远过不了这一关。
				 */
				const authoringObjectRegistry = ((): readonly unknown[] => {
					try {
						const parsed = JSON.parse(agentResult.text) as unknown;
						return isRecord(parsed) && Array.isArray(parsed.objectRegistry) ? parsed.objectRegistry : [];
					} catch {
						return [];
					}
				})();
				const reuse = reusableWorkflowAssetRoleFacts(
					{ ...inputs, "beat-sheet": [beatSheet] }, runtimeProjectContext(context), resolveVideoAssetRoleAllowlist(beatSheet),
				);
				const plans = projectVideoAssetPlansFromBeatSheet(beatSheet, Object.keys(reuse), authoringObjectRegistry);
				buildVideoAssetPlanCollection({ executionId: context.executionId, nodeId: context.node.id,
					beatSheetAgentResult: beatSheet, assetAgentResult: plans, reusableAssetFacts: reuse });
			} catch (error: unknown) {
				validatedOutput = { ok: false, errorMessage: `Workflow asset planning contract: ${error instanceof Error ? error.message : String(error)}` };
			}
		}
		if (validatedOutput.ok && outputArtifactType === "tapcanvas.asset-plans/v1") {
			try {
				// Validate the Agent artifact against the same frozen BeatSheet/object
				// identity contract used by the deterministic fan-out node. Keeping one
				// authority here records canonical-name drift at the producing node
				// instead of letting an invalid executable artifact advance downstream.
				buildVideoAssetPlanCollection({
					executionId: context.executionId,
					nodeId: context.node.id,
					beatSheetAgentResult: firstInput(inputs, "beat-sheet"),
					assetAgentResult: { text: validatedOutput.text },
					reusableAssetFacts: assetPlanningReusableFacts,
				});
			} catch (error: unknown) {
				validatedOutput = {
					ok: false,
					errorMessage: `Workflow Agent asset plan continuity contract violated: ${error instanceof Error ? error.message : String(error)}`,
				};
			}
		}
		if (validatedOutput.ok && outputArtifactType === "tapcanvas.clip-prompts/v2") {
			const clipWriterItemId = isRecord(clipContext) && isRecord(clipContext.beat)
				? readString(clipContext.beat, "clipId")
				: "";
			let writerSpeechError = validateWorkflowClipWriterForContext({
				text: validatedOutput.text,
				itemId: clipWriterItemId,
				contextItem: clipContext,
			});
			if (writerSpeechError) {
				validatedOutput = {
					ok: false,
					errorMessage: `Workflow Clip writer speech-event contract violated: ${writerSpeechError}`,
				};
			}
		}
		const hasRecordedStructuredCandidate = isTypedOutput
			&& agentResult.text.trim().length > 0;
		const finalizeOutputContractFailure = !validatedOutput.ok
			&& (
				hasRecordedStructuredCandidate
				|| requestTerminal?.status === "succeeded"
			);
		const typedRateLimitRetryableResult = isTypedOutput
			&& !hasRecordedStructuredCandidate
			&& requestTerminal?.status === "failed"
			&& isWorkflowAgentRateLimitFailureCode(requestTerminal.reason);
		const finalizeMissingTypedSubmission = isTypedOutput
			&& !validatedOutput.ok
			&& !finalizeOutputContractFailure
			// An infrastructure/provider suspension may end the current physical
			// window before a candidate exists. Keep the node waiting only when the
			// result carries machine-issued continuation/retry evidence; an arbitrary
			// suspended terminal still follows the typed failure path.
			&& !typedRateLimitRetryableResult
			&& !typedAgentResultSuspensionIsContinuable(agentResult.deliveryEvidence, requestTerminal);
		const finalizeTypedFailure = finalizeOutputContractFailure || finalizeMissingTypedSubmission;
		if (validatedOutput.ok && validatedOutput.diagnostics?.length) {
			console.warn(JSON.stringify({
				event: "workflow_agent_output_diagnostics",
				executionFamilyId: context.executionFamilyId,
				nodeId: context.node.id,
				artifactType: outputArtifactType,
				diagnostics: validatedOutput.diagnostics,
			}));
		}
		const atomicDelivery = requestTerminal?.status === "succeeded"
			&& validatedOutput.ok
			&& (agentResult.deliveryVerification === null || agentResult.deliveryVerification === undefined)
			? projectWorkflowAtomicDelivery({
				taskId: agentResult.taskId,
				instruction,
				outputArtifactType,
				outputEncoding,
				deliveryRequirement: agentDeliveryRequirement,
				validatedText: validatedOutput.text,
				terminalReason: requestTerminal.reason,
			})
			: null;
		const normalizedAgentResult = validatedOutput.ok
			? {
				...agentResult,
				text: validatedOutput.text,
				...(atomicDelivery ?? {}),
			}
			: agentResult;
		const agentOutput = output({
			node: context.node,
			executorRef,
			ports: { [primaryOutputPort(data, "result")]: normalizedAgentResult },
			artifacts: [
				...(validatedOutput.ok
					? [{ type: outputArtifactType, identity: agentResult.taskId, value: validatedOutput.text }]
					: []),
				...agentResult.assets.map((asset) => ({
					type: `tapcanvas.${asset.type}/v1`,
					identity: asset.assetId,
					value: asset.url,
				})),
			],
			evidence: {
				taskId: agentResult.taskId,
				outputEncoding,
				outputArtifactType,
				structuredOutputSubmissionPolicy: WORKFLOW_STRUCTURED_OUTPUT_REPAIRABLE_POLICY,
				deliveryEvidence: agentResult.deliveryEvidence,
				...(outputRepair ? { outputRepair } : {}),
				...(agentResult.executionProvenance
					? { executionProvenance: agentResult.executionProvenance }
					: {}),
				...(agentResult.executionProvenanceHistory?.length
					? { executionProvenanceHistory: agentResult.executionProvenanceHistory }
					: {}),
				...(agentResult.promptExampleCandidateSearch
					? { promptExampleCandidateSearch: agentResult.promptExampleCandidateSearch }
					: {}),
				...(agentResult.knowledgeCandidateSearch
					? { knowledgeCandidateSearch: agentResult.knowledgeCandidateSearch }
					: {}),
				...(agentResult.retrievalCandidateSets?.length
					? { retrievalCandidateSets: agentResult.retrievalCandidateSets }
					: {}),
				...(agentResult.upstreamRequestContexts?.length
					? { upstreamRequestContexts: agentResult.upstreamRequestContexts }
					: {}),
				...(agentResult.structuredOutputReview
					? { structuredOutputReview: agentResult.structuredOutputReview }
					: {}),
				...(agentResult.structuredOutputFailure
					? { structuredOutputFailure: agentResult.structuredOutputFailure }
					: {}),
				...(finalizeTypedFailure
					? {
						executorCompleted: false,
						requestTerminal: {
							version: 1,
							terminal: true,
							status: "failed",
							reason: finalizeOutputContractFailure
								? "structured_output_invalid"
								: requestTerminal?.reason ?? "structured_submission_missing",
						},
					}
					: {
						deliveryEvidence: normalizedAgentResult.deliveryEvidence,
						deliveryVerification: normalizedAgentResult.deliveryVerification,
						requestTerminal: agentResult.requestTerminal,
					}),
				...(validatedOutput.ok && validatedOutput.diagnostics?.length
					? { outputDiagnostics: validatedOutput.diagnostics }
					: {}),
				...(finalizeOutputContractFailure && !validatedOutput.ok
					? {
						outputContractFailure: {
							code: "structured_output_invalid",
							message: validatedOutput.errorMessage,
							rawOutputRecorded: hasRecordedStructuredCandidate,
						},
					}
					: {}),
				...(finalizeMissingTypedSubmission
					? {
						agentExecutionFailure: {
							code: requestTerminal?.reason ?? "structured_submission_missing",
							phase: "before_structured_submission",
							retryable: false,
						},

					}
					: {}),
			},
		});
		// A rejected candidate retains both its exact physical cursor and verifier
		// evidence so the same logical node repairs it instead of replaying history.
		if (finalizeOutputContractFailure && !validatedOutput.ok) {
			console.warn(JSON.stringify({
				message: "workflow_agent_output_rejected",
				executionId: context.executionId,
				nodeId: context.node.id,
				taskId: agentResult.taskId,
				error: validatedOutput.errorMessage,
			}));
			return workflowNodeWaiting(
			{
				...agentOutput.outputRefs,
				ports: {},
				evidence: {
					...agentOutput.outputRefs.evidence,
					executorCompleted: false,
					continuationReason: "structured_output_repair_required",
					outputRepair: {
						version: 1,
						sourceTurnId: agentResult.taskId,
						candidate: agentResult.text,
						error: validatedOutput.errorMessage,
					},
				},
			},
			workflowAgentExternalCheckSchedule({
				deliveryEvidence: agentResult.deliveryEvidence,
				reason: "structured_output_repair_required",
			}),
		);
		}
		if (finalizeMissingTypedSubmission) {
			return {
				ok: false,
				errorCode: "workflow_node_runtime_failed",
					errorMessage: `Workflow Agent node ${context.node.id} ended before its single structured submission: ${requestTerminal?.reason ?? "structured_submission_missing"}${isRecord(agentResult.structuredOutputFailure) && typeof agentResult.structuredOutputFailure.rationale === "string" ? ` (${agentResult.structuredOutputFailure.rationale})` : ""}`,
				outputRefs: agentOutput.outputRefs,
			};
		}
		if (!requestTerminal) {
			return {
				ok: false,
				errorCode: "workflow_node_runtime_failed",
				errorMessage: `Workflow Agent node ${context.node.id} returned no valid agents-cli request terminal state`,
				outputRefs: agentOutput.outputRefs,
			};
		}
		if (requestTerminal.status === "needs_input") {
			return {
				ok: false,
				errorCode: "workflow_node_runtime_failed",
				errorMessage: `Workflow Agent node ${context.node.id} requires user input: ${requestTerminal.reason}`,
				outputRefs: agentOutput.outputRefs,
			};
		}
		if (requestTerminal.status === "failed") {
			if (isWorkflowAgentRateLimitFailureCode(requestTerminal.reason)) {
				const previousDeliveryEvidence = previousEvidence && isRecord(previousEvidence.deliveryEvidence)
					? previousEvidence.deliveryEvidence
					: previousEvidence;
				const currentDeliveryEvidence = isRecord(agentResult.deliveryEvidence)
					? agentResult.deliveryEvidence
					: null;
				const pending = output({
					node: context.node,
					executorRef,
					ports: {},
					evidence: {
						executorCompleted: false,
						deliveryEvidence: createWorkflowAgentRateLimitBackpressureEvidence(
							{
								deliveryEvidence: {
									...(previousDeliveryEvidence ?? {}),
									...(currentDeliveryEvidence ?? {}),
								},
							},
							Date.now(),
							`${context.executionFamilyId}:${context.node.id}`,
						),
					},
				});
				if (!pending.ok) return pending;
				return workflowNodeWaiting(
					pending.outputRefs,
					workflowAgentExternalCheckSchedule({
						deliveryEvidence: pending.outputRefs.evidence.deliveryEvidence,
						reason: "workflow_agent_rate_limit_backpressure",
					}),
				);
			}
			return {
				ok: false,
				errorCode: "workflow_node_runtime_failed",
				errorMessage: `Workflow Agent node ${context.node.id} failed: ${requestTerminal.reason}`,
				outputRefs: agentOutput.outputRefs,
			};
		}
		if (!validatedOutput.ok) {
			const structuredFailureMessage = `Workflow Agent node ${context.node.id} violated its ${outputEncoding} output contract: ${validatedOutput.errorMessage}`;
			return {
				ok: false,
				errorCode: "workflow_node_runtime_failed",
				errorMessage: structuredFailureMessage,
				outputRefs: agentOutput.outputRefs,
			};
		}
		const verification = parseDeliveryVerification(normalizedAgentResult.deliveryVerification);
		if (verification?.status !== "satisfied") {
			return {
				ok: false,
				errorCode: "workflow_node_runtime_failed",
				errorMessage: `Workflow Agent node ${context.node.id} did not satisfy its local delivery contract`,
				outputRefs: agentOutput.outputRefs,
			};
		}
		return agentOutput;
	}

	if (executorRef === "agents.delivery.verify/v2") {
		const result = firstInput(context.inputs, "master-video")
			?? firstInput(context.inputs, "result")
			?? firstDeclaredInput(context);
		const expectedArtifactType = readString(data, "workflowDeliveryArtifactType");
		const expectsPersistentMedia = expectedArtifactType === "tapcanvas.image/v1"
			|| expectedArtifactType === "tapcanvas.video/v1"
			|| expectedArtifactType === "tapcanvas.master-video/v1";
		if (isWorkflowCollection(result)) {
			if (expectsPersistentMedia) {
				const invalidItems = result.items.filter((item) => persistentHttpUrl(item.value) === null);
				if (invalidItems.length > 0) {
					return {
						ok: false,
						errorCode: "workflow_node_runtime_failed",
						errorMessage: `Workflow delivery node ${context.node.id} received ${invalidItems.length}/${result.items.length} media items without persistent HTTP(S) URLs`,
					};
				}
				return output({
					node: context.node,
					executorRef,
					ports: { "delivery-evidence": result },
					artifacts: result.items.map((item) => ({ type: expectedArtifactType, identity: item.itemId, value: persistentHttpUrl(item.value) })),
					evidence: { verifiedItems: result.items.length, sourceCollectionId: result.collectionId, expectedArtifactType },
				});
			}
			const invalidItems = result.items.filter((item) => {
				const verification = isRecord(item.value) ? parseDeliveryVerification(item.value.deliveryVerification) : null;
				return verification?.status !== "satisfied";
			});
			if (invalidItems.length > 0) {
				return {
					ok: false,
					errorCode: "workflow_node_runtime_failed",
					errorMessage: `Workflow delivery node ${context.node.id} received ${invalidItems.length}/${result.items.length} items without satisfied agents-cli delivery verification`,
				};
			}
			return output({
				node: context.node,
				executorRef,
				ports: {
					"delivery-evidence": createWorkflowCollection({
						collectionId: `${context.executionId}:${context.node.id}:delivery-evidence`,
						producerNodeId: context.node.id,
						producerPortId: "delivery-evidence",
						values: result.items.map((item) => ({
							requirement: readString(data, "workflowDeliveryRequirement"),
							evidence: isRecord(item.value) ? item.value.deliveryEvidence ?? null : null,
							verification: isRecord(item.value) ? item.value.deliveryVerification ?? null : null,
						})),
						itemIds: result.items.map((item) => item.itemId),
						parentLineage: result.items.map((item) => item.lineage),
					}),
				},
				evidence: { verifiedItems: result.items.length, sourceCollectionId: result.collectionId },
			});
		}
		if (expectsPersistentMedia) {
			const mediaUrl = persistentHttpUrl(result);
			if (!mediaUrl) {
				return {
					ok: false,
					errorCode: "workflow_node_runtime_failed",
					errorMessage: `Workflow delivery node ${context.node.id} did not receive a persistent HTTP(S) media URL`,
				};
			}
			const coverageVerification = isRecord(result) && result.deliveryCoverage !== undefined
				? verifyMediaDeliveryCoverage(MediaDeliveryCoverageSchema.parse(result.deliveryCoverage))
				: null;
			const promptPackage = firstInput(context.inputs, "prompt-package");
			const promptPackageEvidence = isRecord(promptPackage) && isRecord(promptPackage.deliveryEvidence)
				? promptPackage.deliveryEvidence
				: isRecord(result) && isRecord(result.promptPackageEvidence)
					? result.promptPackageEvidence
					: null;
			const promptPackageVerification = isRecord(promptPackage) && isRecord(promptPackage.deliveryVerification)
				? promptPackage.deliveryVerification
				: isRecord(result) && isRecord(result.promptPackageVerification)
					? result.promptPackageVerification
					: null;
			const delivered = output({
				node: context.node,
				executorRef,
				ports: {
					"delivery-evidence": {
						masterVideo: result,
						...coverageVerification,
						promptPackageEvidence,
						promptPackageVerification,
						mediaUrl,
					},
				},
				artifacts: [{ type: expectedArtifactType, identity: context.node.id, value: mediaUrl }],
				evidence: {
					...coverageVerification,
					verifiedItems: 1,
					expectedArtifactType,
					mediaUrl,
					promptPackageEvidence,
					promptPackageVerification,
				},
			});
			if (coverageVerification?.deliveryVerification.status === "unsatisfied") {
				return {
					ok: false,
					errorCode: "workflow_delivery_coverage_unsatisfied",
					errorMessage: `Frozen delivery items are missing: ${coverageVerification.deliveryVerification.missingItemIds.join(", ")}`,
					outputRefs: delivered.outputRefs,
				};
			}
			return delivered;
		}
		const flowPatchTargetNodeId = readString(data, "workflowDeliveryTargetNodeId");
		if (flowPatchTargetNodeId) {
			const receipt = verifyFlowPatchDeliveryReceipt(result, flowPatchTargetNodeId);
			if (!receipt) {
				return {
					ok: false,
					errorCode: "workflow_node_runtime_failed",
					errorMessage: `Workflow delivery node ${context.node.id} did not receive a persisted flow patch receipt for target node ${flowPatchTargetNodeId}`,
				};
			}
			return output({
				node: context.node,
				executorRef,
				ports: {
					"delivery-evidence": {
						requirement: readString(data, "workflowDeliveryRequirement"),
						flowPatch: receipt,
					},
				},
				evidence: {
					verifiedItems: 1,
					flowPatchTargetNodeId,
					flowPatchContentLength: receipt.contentLength,
					flowPatchUpdatedAt: receipt.updatedAt,
				},
			});
		}
		const deliveryVerification = isRecord(result) ? result.deliveryVerification : null;
		const verification = parseDeliveryVerification(deliveryVerification);
		if (verification?.status !== "satisfied") {
			return {
				ok: false,
				errorCode: "workflow_node_runtime_failed",
				errorMessage: `Workflow delivery node ${context.node.id} did not receive satisfied agents-cli delivery verification`,
			};
		}
		return output({
			node: context.node,
			executorRef,
			ports: {
				"delivery-evidence": {
					requirement: readString(data, "workflowDeliveryRequirement"),
					evidence: isRecord(result) ? result.deliveryEvidence : null,
					verification: deliveryVerification,
				},
			},
			evidence: { deliveryVerification },
		});
	}

	if (executorRef === "workflow.output/v1") {
		return output({ node: context.node, executorRef, ports: { output: context.inputs } });
	}

	return {
		ok: false,
		errorCode: "workflow_node_executor_missing",
		errorMessage: `Workflow executor ${executorRef} is not registered`,
	};
}

export async function executeRegisteredWorkflowNode(
	context: WorkflowNodeExecutionContext,
	dependencies: WorkflowNodeExecutorDependencies,
): Promise<WorkflowNodeExecutionResult> {
	const executorRef = resolveWorkflowNodeExecutorRef(context.node);
	if (executorRef === "tapcanvas.video.generate/v1" || executorRef === "tapcanvas.video.prepare/v1") {
		const productionPlan = firstInput(context.inputs, "production-plan");
		if (isWorkflowCollection(productionPlan)) {
			try {
				if (context.node.data.workflowVideoReferencePolicy !== WORKFLOW_VIDEO_REFERENCE_POLICY) {
					throw new Error(`Workflow video node ${context.node.id} requires video references to be explicitly forbidden`);
				}
				assertWorkflowVideoProductionPlanReferencePolicy(productionPlan, "production-plan");
			} catch (error: unknown) {
				return {
					ok: false,
					errorCode: "workflow_node_runtime_failed",
					errorMessage: error instanceof Error ? error.message : String(error),
				};
			}
		}
	}
	const result = await executeWorkflowNodeByMode(context, dependencies, (itemContext, itemDependencies) =>
		executeWithImmediateOutputRepair(itemContext, itemDependencies, executeRegisteredWorkflowNodeOnce));
	return bindWorkflowNodeExecutionResultPorts(context, result);
}
