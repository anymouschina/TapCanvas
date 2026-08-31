import {
	createWorkflowCollection,
	isWorkflowCollection,
	WORKFLOW_AGENT_MAX_OUTPUT_TOKENS_MAX,
	WORKFLOW_AGENT_MAX_OUTPUT_TOKENS_MIN,
	parseWorkflowKnowledgeCandidateSetV1,
	hasWorkflowPluginExecutorRefPrefix,
	type WorkflowInputBindingProvenanceV1,
	type WorkflowKnowledgeCandidateSetV1,
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
	WORKFLOW_STRUCTURED_OUTPUT_SUBMISSION_POLICY,
	type WorkflowAgentJsonArrayContract,
	type WorkflowAgentJsonObjectContract,
	type WorkflowAgentOutputEncoding,
} from "./execution.agent-output-contract";
import {
	resolveWorkflowNodeExecutorRef,
	workflowNodeExecutionFailure,
	workflowNodeWaiting,
} from "./execution.node-runtime";
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
import type { WorkflowPluginRuntimeRegistry } from "./execution.plugin-runtime";
import type { AgentExecutionProvenance } from "../task/agent-execution-provenance";
import {
	isWorkflowProjectImageReady,
	parseWorkflowProjectContext,
	type WorkflowProjectContext,
} from "./execution.project-context";
import { resolveWorkflowAgentModelKey } from "./execution.agent-model-inheritance";
import type { WorkflowResolvedAsset } from "./execution.asset-resolver";
import {
	createWorkflowInputContractRejection,
	WorkflowInputContractError,
} from "./execution.input-contract";
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
	isWorkflowAgentRateLimitError,
	isWorkflowAgentRateLimitFailureCode,
	parseWorkflowAgentPhysicalFailureEvidence,
} from "./execution.agent-backpressure";
import { sha256Hex } from "../asset/book-content-hash";
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

const WORKFLOW_AGENT_KNOWLEDGE_TOOLS = [
	"skill_search",
	"Skill",
	"knowledge_search",
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
	abortSignal?: AbortSignal;
	/**
	 * 系统级共享工作流的交付目标（调用者项目/画布）。有值时 flowId/projectId
	 * 已指向调用者项目，本字段仅作为注入给 agent 的可见事实（提示其工具画布
	 * 范围就是调用者项目，可读取并复用调用者项目资产），不承载语义判断。
	 */
	deliveryScope?: Readonly<{ flowId: string; projectId: string | null; chapterId?: string }> | null;
	projectContext?: WorkflowProjectContext | null;
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
	executionProvenance?: AgentExecutionProvenance;
	executionProvenanceHistory?: AgentExecutionProvenance[];
	promptExampleCandidateSearch?: WorkflowPromptExampleCandidateSearchObservation;
}>;

export type WorkflowNodeExecutorDependencies = Readonly<{
	pluginRuntimeRegistry?: WorkflowPluginRuntimeRegistry;
	runAgent: (request: WorkflowAgentRunRequest) => Promise<WorkflowAgentRunResult>;
	runJavascript: (request: Readonly<{ code: string; input: unknown }>) => Promise<Readonly<{
		output: unknown;
		durationMs: number;
	}>>;
	runImage?: (request: WorkflowImageRunRequest) => Promise<WorkflowImageRunResult>;
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
	readCanvasProjectContextFromFlow?: (request: Readonly<{
		flowId: string;
		ownerId: string;
		projectContext: WorkflowProjectContext;
		chapterId?: string | null;
	}>) => Promise<WorkflowCanvasProjectContextFacts>;
	searchKnowledge?: (request: Readonly<{
		ownerId: string;
		rawUserRequest: string;
		query: string;
		roleScope: string | null;
		domain: string | null;
		strictFilters: boolean;
		limit: number;
	}>) => Promise<WorkflowKnowledgeCandidateSetV1>;
	readKnowledge?: (request: Readonly<{
		candidateSet: WorkflowKnowledgeCandidateSetV1;
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
	referenceAssetBindings: readonly WorkflowImageReferenceAssetBinding[];
	assetMetadata?: Readonly<Record<string, unknown>> | null;
	previousEvidence: Record<string, unknown> | null;
	resumeOnly: boolean;
}>;

export type WorkflowImageRunResult =
	| Readonly<{ status: "success"; nodeId: string; taskId: string | null; imageUrl: string; assetId: string | null; reused: boolean }>
	| Readonly<{ status: "waiting_external"; nodeId: string; taskId: string; reused: boolean }>
	| Readonly<{ status: "failed"; nodeId: string; taskId: string | null; errorMessage: string }>;

export type WorkflowVideoRunRequest = Readonly<{
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
	aspectRatio: string;
	referenceImageNodeIds: readonly string[];
	referenceAssetIds: readonly string[];
	estimateIdentity: string | null;
	generationContract?: VideoGenerationContract | null;
	previousEvidence: Record<string, unknown> | null;
	resumeOnly: boolean;
}>;

export type WorkflowVideoRunResult =
	| Readonly<{ status: "success"; nodeId: string; taskId: string | null; videoUrl: string; thumbnailUrl: string | null; reused: boolean }>
	| Readonly<{ status: "waiting_external"; nodeId: string; taskId: string; reused: boolean }>
	| Readonly<{
		status: "failed";
		nodeId: string;
		taskId: string | null;
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
const WORKFLOW_AGENT_STATUS_POLL_MS = 5_000;
const WORKFLOW_AGENT_BALANCE_POLL_MS = 60_000;

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
				sourceFingerprint: readString(source, "sourceFingerprint")
					|| sha256Hex(readString(source, "content")),
				sourceRevision: source.sourceRevision,
			}));
			if (sourceFacts.some((source) => !source.sourceId)) continue;
			return [
				"运行时权威来源重申（确定性事实，优先级高于本提示中的任何示例、历史内容或模型记忆）：",
				"上游端口事实中的 authoritativeSources.content 必须逐字作为本节点唯一故事来源。此处只重申其冻结身份，避免在同一模型请求中重复发送整章正文；不得用 canvasFacts.nodes 是否为空否定真源，也不得用任何旧会话、Skill 示例、历史资产计划或常识替代它。不得改名、换人、换武器、换场景、换世界观。输出根对象必须逐字回显运行时冻结的 sourceId 与 sourceFingerprint；输出前必须逐字反查 sourceFidelityAudit 与 beats 的人物、职业、道具、空间、对白、因果和结尾状态：",
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
			const normalized = sources.map((source, index) => {
				const sourceId = readString(source, "sourceId") || readString(source, "nodeId");
				const content = readString(source, "content");
				if (!sourceId || !content) {
					throw new Error(`authoritativeSources[${index}] requires sourceId and content`);
				}
				const sourceFingerprint = readString(source, "sourceFingerprint") || sha256Hex(content);
				if (sourceFingerprint !== sha256Hex(content)) {
					throw new Error(`authoritativeSources[${index}] sourceFingerprint does not match content`);
				}
				return { sourceId, sourceFingerprint };
			});
			if (normalized.length === 1) return normalized[0];
			const sourceSetHash = sha256Hex(JSON.stringify(normalized));
			return {
				sourceId: `source-set:sha256:${sourceSetHash}`,
				sourceFingerprint: sourceSetHash,
			};
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
			const referenceAssetIds = Array.isArray(contract.referenceAssetIds)
				? uniqueStrings(contract.referenceAssetIds.flatMap((value) => (
					typeof value === "string" && value.trim() ? [value.trim()] : []
				)))
				: [];
			if (referenceAssetIds.length > 1) {
				return `beats[${beatIndex}].assetObjectContracts[${contractIndex}].referenceAssetIds must contain at most one exact project asset`;
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
		return `BeatSheet omitted explicitly selected assets; bind every missing ID to the matching assetObjectContracts.referenceAssetIds using selectedAssetSnapshot source facts: ${JSON.stringify(missingSelectedAssetIds)}`;
	}
	return null;
}

function runtimeProjectAssetCandidatesInstruction(
	projectContext: WorkflowProjectContext | null,
	allowedRoles: readonly string[],
): string {
	if (!projectContext || allowedRoles.length === 0) return "";
	const selectedAssetIdSet = new Set(projectContext.selectedAssetIds);
	const candidates = projectContext.assetSnapshot
		.filter((asset) => (
			asset.projectId === projectContext.projectId
			&& projectContext.projectAssetIds.includes(asset.assetId)
			&& asset.mediaKind === "image"
			&& asset.state === "ready"
			&& asset.productionEligible
		))
		.map((asset) => ({
			assetId: asset.assetId,
			canonicalName: asset.canonicalName,
			kind: asset.kind,
			referenceType: asset.referenceType,
			sourceFacts: asset.sourceFacts,
			origin: asset.origin,
			nodeId: asset.nodeId,
			assetUsage: asset.assetUsage,
		}));
	if (candidates.length === 0 && selectedAssetIdSet.size === 0) return "";
	return [
		"运行时当前项目可复用图片资产（确定性身份清单，优先级高于 BeatSheet 中可能过期的历史 assetId）：",
		"只有下面清单中的 assetId 才能作为本项目 existingAssetId。必须在唯一首稿中依据角色肉身、场景空间与 sourceFacts 做语义身份判断；canonicalName、展示名或章节称谓不要求逐字相等。确认同一身份时填写精确 existingAssetId 和 existingProjectId，确认是新身份或不同可见状态时才保留生成计划。禁止仅因名称别名重复生成，也禁止把相似但不同的对象强行复用。BeatSheet 的历史 referenceAssetIds 只有仍出现在本清单中时有效；selectedAssetIds 是用户显式选择事实，必须覆盖，但不排斥同时复用清单中的其它同项目资产。runtime 后续只验证精确 ID 的权限、就绪状态和项目归属，不做语义纠偏。",
		JSON.stringify({
			projectId: projectContext.projectId,
			selectedAssetIds: projectContext.selectedAssetIds,
			candidates: candidates.map((asset) => ({
				assetId: asset.assetId,
				canonicalName: asset.canonicalName,
				kind: asset.kind,
				referenceType: asset.referenceType,
				sourceFacts: asset.sourceFacts,
				origin: asset.origin,
				nodeId: asset.nodeId,
				assetUsage: asset.assetUsage,
				selected: selectedAssetIdSet.has(asset.assetId),
			})),
		}),
	].join("\n");
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
 * Freeze reusable project-image identities by the role declared in the asset
 * plan. This is a structural identity contract, not a semantic asset match:
 * only visible, ready, production-eligible project images are considered, and
 * the current canvas is preferred over older project-level copies. Preview-only
 * and story-preview workflow outputs therefore cannot become authoritative
 * reuse facts.
 */
type ReusableWorkflowAssetRoleFact = Readonly<{
	planAssetId?: string;
	existingAssetId?: string;
	existingProjectId?: string;
	existingNodeId?: string;
	existingImageUrl?: string;
}>;

type ReusableWorkflowAssetRoleFacts = Readonly<Record<string, ReusableWorkflowAssetRoleFact>>;

function reusableProjectAssetRoleFacts(
	projectContext: WorkflowProjectContext | null,
	allowedRoles: readonly string[],
): ReusableWorkflowAssetRoleFacts {
	if (!projectContext || allowedRoles.length === 0) return {};
	const visibleAssetIds = new Set(projectContext.projectAssetIds);
	const allowedRoleSet = new Set(allowedRoles);
	const facts: Record<string, { existingAssetId: string; existingProjectId: string; existingNodeId?: string }> = {};
	const candidates = projectContext.assetSnapshot
		.filter((asset) => (
			visibleAssetIds.has(asset.assetId)
			&& asset.projectId === projectContext.projectId
			&& asset.mediaKind === "image"
			&& asset.state === "ready"
			&& asset.productionEligible
			&& asset.canonicalName
		))
		.sort((left, right) => {
			const leftCurrentCanvas = left.flowId === projectContext.canvasId ? 0 : 1;
			const rightCurrentCanvas = right.flowId === projectContext.canvasId ? 0 : 1;
			if (leftCurrentCanvas !== rightCurrentCanvas) return leftCurrentCanvas - rightCurrentCanvas;
			return right.updatedAt.localeCompare(left.updatedAt);
		});
	for (const asset of candidates) {
		const roleKind = ["character", "scene", "prop", "vfx", "palette", "composition"].includes(asset.kind)
			? asset.kind
			: ["character", "scene", "prop", "vfx", "palette", "composition"].includes(asset.referenceType ?? "")
				? asset.referenceType ?? ""
				: "";
		if (!roleKind) continue;
		const role = `${roleKind}://${asset.canonicalName}`;
		if (!allowedRoleSet.has(role)) continue;
		if (facts[role]) continue;
		facts[role] = {
			existingAssetId: asset.assetId,
			existingProjectId: projectContext.projectId,
			...(asset.nodeId ? { existingNodeId: asset.nodeId } : {}),
		};
	}
	return facts;
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
): ReusableWorkflowAssetRoleFacts {
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
	const facts: Record<string, ReusableWorkflowAssetRoleFact> = {};
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
			const referenceAssetIds = Array.isArray(contract.referenceAssetIds)
				? uniqueStrings(contract.referenceAssetIds.flatMap((value) => (
					typeof value === "string" && value.trim() ? [value.trim()] : []
				)))
				: [];
			if (referenceAssetIds.length > 1) {
				throw new Error(`beats[${beatIndex}].assetObjectContracts[${contractIndex}] has multiple canonical referenceAssetIds`);
			}
			const referenceAssetId = referenceAssetIds[0];
			if (!referenceAssetId) continue;
			const asset = readyAssetById.get(referenceAssetId);
			if (!asset) continue;
			const nextFact: ReusableWorkflowAssetRoleFact = {
				existingAssetId: asset.assetId,
				existingProjectId: projectContext.projectId,
				...(asset.nodeId ? { existingNodeId: asset.nodeId } : {}),
			};
			const previous = facts[role];
			if (previous && JSON.stringify(previous) !== JSON.stringify(nextFact)) {
				throw new Error(`Frozen BeatSheet role ${role} has conflicting exact project asset bindings`);
			}
			facts[role] = nextFact;
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
): ReusableWorkflowAssetRoleFacts {
	const input = firstInput(inputs, "asset-bindings");
	if (input === undefined || input === null) return {};
	if (!isWorkflowCollection(input)) {
		throw new Error("Upstream reusable asset bindings must be a workflow collection");
	}
	const allowedRoleSet = new Set(allowedRoles);
	const facts: Record<string, ReusableWorkflowAssetRoleFact> = {};
	for (const [index, item] of input.items.entries()) {
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
		const nextFact: ReusableWorkflowAssetRoleFact = {
			planAssetId,
			existingNodeId,
			existingImageUrl,
		};
		const previous = facts[role];
		if (previous && JSON.stringify(previous) !== JSON.stringify(nextFact)) {
			throw new Error(`Upstream asset role ${role} has conflicting materialized bindings`);
		}
		facts[role] = nextFact;
	}
	return facts;
}

function reusableWorkflowAssetRoleFacts(
	inputs: WorkflowInputPorts,
	projectContext: WorkflowProjectContext | null,
	allowedRoles: readonly string[],
): ReusableWorkflowAssetRoleFacts {
	return {
		...reusableProjectAssetRoleFacts(projectContext, allowedRoles),
		...reusableReferencedProjectAssetRoleFacts(inputs, projectContext, allowedRoles),
		...reusableUpstreamAssetRoleFacts(inputs, allowedRoles),
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
	if (context.runtimeItemIndex === undefined) return context.resumeOutputRefs.evidence;
	const previousItemRun = context.resumeOutputRefs.itemRuns.find(
		(run) => run.runtimeNodeId === context.node.id,
	);
	return previousItemRun?.evidence ?? null;
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

const WORKFLOW_CLIP_WRITER_MAX_OUTPUT_TOKENS = 8_192;

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
		if (!assetId || (role !== "layout" && role !== "style" && role !== "identity" && role !== "content")) {
			throw new Error(`Workflow image reference binding ${index + 1} has invalid assetId or role`);
		}
		const strength = value.strength;
		if (strength !== undefined && (typeof strength !== "number" || !Number.isFinite(strength) || strength < 0 || strength > 1)) {
			throw new Error(`Workflow image reference binding ${index + 1} strength must be between 0 and 1`);
		}
		return { assetId, role, ...(typeof strength === "number" ? { strength } : {}) };
	});
	if (new Set(bindings.map((binding) => binding.assetId)).size !== bindings.length) {
		throw new Error("Workflow image reference binding asset IDs must be unique");
	}
	return bindings;
}

export function workflowImageAssetMetadata(value: unknown): Readonly<Record<string, unknown>> | null {
	if (!isRecord(value)) return null;
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
			...(parsedRole.kind === "scene" ? { sceneName: parsedRole.name } : {}),
			...(parsedRole.kind === "prop" ? { propName: parsedRole.name } : {}),
		};
	}
	if (readString(value, "referenceType") !== "character") return null;
	const roleName = readString(value, "roleName");
	const characterAssetRole = readString(value, "characterAssetRole");
	const characterProfileVersion = readString(value, "characterProfileVersion");
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
		const text = readString(data, "workflowTextInput") || readString(data, "prompt") || readString(data, "content");
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
		return output({
			node: context.node,
			executorRef,
			ports: { result: javascriptResult.output },
			artifacts: [{ type: "tapcanvas.json/v1", identity: null, value: javascriptResult.output }],
			evidence: { durationMs: javascriptResult.durationMs, isolation: "local-child-process" },
		});
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

	if (executorRef === "video.beat-sheet.take/v1") {
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
			const assetPlans = projectVideoAssetPlansFromBeatSheet(
				firstInput(context.inputs, "beat-sheet"),
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
				acceptedTurnSource = parseWorkflowAcceptedTurnSource(
					callConfig?.[WORKFLOW_ACCEPTED_TURN_SOURCE_FIELD],
					context.ownerId,
				);
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
			if (acceptedTurnSource && !delivery?.chapterId) {
				const sourceFlowId = delivery?.flowId ?? projectContext.canvasId;
				const authoritativeSource = {
					sourceId: acceptedTurnSource.sourceId,
					content: acceptedTurnSource.text,
					sourceFingerprint: acceptedTurnSource.fingerprint,
				};
				const canvasFacts = {
					sourceMode: "public_chat_turn",
					flowId: sourceFlowId,
					sourceId: acceptedTurnSource.sourceId,
					text: acceptedTurnSource.text,
					sourceFingerprint: acceptedTurnSource.fingerprint,
					sourceNodeIds: [],
					nodes: [],
					authoritativeSources: [authoritativeSource],
					...(publicCallConfig && Object.keys(publicCallConfig).length > 0
						? { callConfig: publicCallConfig }
						: {}),
				};
				return output({
					node: context.node,
					executorRef,
					ports: { "canvas-facts": canvasFacts },
					artifacts: [{
						type: "tapcanvas.canvas-facts/v1",
						identity: acceptedTurnSource.sourceId,
						value: canvasFacts,
					}],
					evidence: {
						sourceMode: "public_chat_turn",
						sourceId: acceptedTurnSource.sourceId,
						sourceFingerprint: acceptedTurnSource.fingerprint,
					},
				});
			}
			if (!dependencies.readCanvasProjectContextFromFlow) {
				return {
					ok: false,
					errorCode: "workflow_node_executor_missing",
					errorMessage: "Caller canvas project-context reader dependency is unavailable",
				};
			}
			const sourceFlowId = delivery?.flowId ?? projectContext.canvasId;
			const facts = await dependencies.readCanvasProjectContextFromFlow({
				flowId: sourceFlowId,
				ownerId: context.ownerId,
				projectContext,
				chapterId: delivery?.chapterId ?? null,
			});
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
					sourceNodeIds: facts.sourceNodeIds,
					sourceNodeCount: facts.nodes.length,
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
			const canvasFacts = firstInput(context.inputs, "canvas-facts");
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
			if ((callResolution || callAspectRatio) && dependencies.resolveVideoMediaOptions) {
				const mediaOptions = await dependencies.resolveVideoMediaOptions({
					executionId: context.executionId,
					runtimeNodeId: context.node.id,
					ownerId: context.ownerId,
					modelKey,
				});
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
				executionId: context.executionId,
				workflowKey: context.workflowKey,
				executionScope: data.workflowExecutionScope,
				canvasFacts: firstInput(context.inputs, "canvas-facts"),
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
			const estimate = await dependencies.runVideoEstimate({
				executionId: context.executionId,
				runtimeNodeId: context.node.id,
				ownerId: context.ownerId,
				projectId: delivery?.projectId ?? context.projectId,
				modelKey,
				resolution,
				aspectRatio,
				clips,
			});
			return output({
				node: context.node,
				executorRef,
				ports: { estimate },
				artifacts: [{ type: "tapcanvas.video-estimate/v1", identity: estimate.estimateIdentity, value: estimate }],
				evidence: { estimateIdentity: estimate.estimateIdentity, estimatedCredits: estimate.estimatedCredits },
			});
		} catch (error: unknown) {
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
		const videoUrls = videoAssets.items.map((item) => persistentHttpUrl(item.value));
		if (videoUrls.some((url) => url === null)) {
			return { ok: false, errorCode: "workflow_node_runtime_failed", errorMessage: "Video concat received an item without a persistent HTTP(S) video URL" };
		}
		const aspectRatio = readString(estimate, "aspectRatio");
		const resolution = readString(estimate, "resolution");
		if (!aspectRatio || !resolution) {
			return { ok: false, errorCode: "workflow_node_runtime_failed", errorMessage: "Video concat estimate is missing aspectRatio or resolution" };
		}
		const sourceNodeIds = uniqueStrings(videoAssets.items.flatMap((item) => {
			const value = isRecord(item.value) ? item.value : null;
			const id = value ? readString(value, "nodeId") : "";
			return id ? [id] : [];
		}));
		const perClip = Array.isArray(estimate.perClip) ? estimate.perClip : [];
		const durationValues = perClip.map((item) => isRecord(item) ? item.durationSeconds : null);
		const targetDurationSeconds = durationValues.length > 0
			&& durationValues.every((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0)
			? durationValues.reduce((sum, value) => sum + value, 0)
			: null;
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
				videoUrls: videoUrls.filter((url): url is string => url !== null),
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
					aspectRatio,
					sourceNodeIds,
					...(concatenated.concatPolicy ? { concatPolicy: concatenated.concatPolicy } : {}),
				});
			}
			return output({
				node: context.node,
				executorRef,
				ports: {
					"master-video": {
						videoUrl: concatenated.videoUrl,
						assetId: concatenated.assetId,
						clipCount: concatenated.clipCount,
						targetDurationSeconds,
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
		const planExistingUrl = isRecord(assetPlanInput) ? readString(assetPlanInput, "existingImageUrl") : "";
		const planExistingNodeId = isRecord(assetPlanInput) ? readString(assetPlanInput, "existingNodeId") : "";
		const planExistingAssetId = isRecord(assetPlanInput) ? readString(assetPlanInput, "existingAssetId") : "";
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
				const reuseNodeId = resolved.nodeId || planExistingNodeId || planExistingAssetId;
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
						canvasNodeId: resolved.nodeId,
						providerStatus: "reused",
						reused: true,
						reuseSource: "project_asset_resolver",
						assetId: planExistingAssetId,
						projectId: projectContext.projectId,
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
					reused: true,
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
			referenceAssetBindings,
			assetMetadata: workflowImageAssetMetadata(assetPlanInput),
			previousEvidence: previousItemRun?.evidence ?? (context.resumeOutputRefs?.evidence ?? null),
			resumeOnly: context.resumeOnly === true,
		});
		const evidence = {
			canvasNodeId: result.nodeId,
			taskId: result.taskId,
			providerStatus: result.status,
			...(result.status !== "failed" ? { reused: result.reused } : {}),
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

	if (executorRef === "tapcanvas.video.generate/v1") {
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
		const aspectRatioValue = videoGenerationParameter(context.inputs, data, "aspectRatio", "workflowVideoAspectRatio");
		const referenceImageNodeIdsValue = videoGenerationParameter(context.inputs, data, "referenceImageNodeIds", "workflowVideoReferenceImageNodeIds");
		const referenceAssetIdsValue = videoGenerationParameter(context.inputs, data, "referenceAssetIds", "workflowVideoReferenceAssetIds");
		const estimateIdentityValue = videoGenerationParameter(context.inputs, data, "estimateIdentity", "workflowVideoEstimateIdentity");
		const generationContractValue = videoGenerationParameter(context.inputs, data, "generationContract", "workflowVideoGenerationContract");
		const modelKey = typeof modelKeyValue === "string" ? modelKeyValue.trim() : "";
		const resolution = typeof resolutionValue === "string" ? resolutionValue.trim() : "";
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
		const delivery = workflowDeliveryScope(context.flowVersionData);
		const result = await dependencies.runVideo({
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
			aspectRatio,
			referenceImageNodeIds,
			referenceAssetIds,
			estimateIdentity: estimateIdentity || null,
			generationContract,
			previousEvidence: previousItemRun?.evidence ?? (context.resumeOutputRefs?.evidence ?? null),
			resumeOnly: context.resumeOnly === true,
		});
		const evidence = {
			canvasNodeId: result.nodeId,
			taskId: result.taskId,
			providerStatus: result.status,
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
		return output({
			node: context.node,
			executorRef,
			ports: { [primaryOutputPort(data, "video")]: { videoUrl: result.videoUrl, nodeId: result.nodeId, taskId: result.taskId } },
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
			evidence: { ...evidence, videoUrl: result.videoUrl, thumbnailUrl: result.thumbnailUrl },
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
		let candidateSet: WorkflowKnowledgeCandidateSetV1;
		try {
			candidateSet = parseWorkflowKnowledgeCandidateSetV1(firstInput(context.inputs, "knowledge-candidates"));
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
		let args: Record<string, unknown>;
		try {
			args = toolInvocationArguments(context.inputs, data);
		} catch (error: unknown) {
			return { ok: false, errorCode: "workflow_node_runtime_failed", errorMessage: error instanceof Error ? error.message : String(error) };
		}
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
		const value = result.data ?? { content: result.content };
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
				mediaType: promptExampleMediaType,
				searchPolicy: outputArtifactType === "tapcanvas.clip-prompts/v2"
					? "required_non_blocking" as const
					: "agent_discretion" as const,
			}
			: null;
		const modelKey = resolveWorkflowAgentModelKey({
			flowVersionData: context.flowVersionData,
			configuredModelKey,
		});
		let assetPlanningAllowedRoles: readonly string[] = [];
		let assetPlanningRequiredRoles: readonly string[] = [];
		let assetPlanningReusableFacts: ReusableWorkflowAssetRoleFacts = {};
		let jsonArrayContract = applyWorkflowArtifactJsonArrayContract(
			outputArtifactType,
			parsedJsonArrayContract,
		);
		if (outputEncoding === "json_array" && outputArtifactType === "tapcanvas.asset-plans/v1" && jsonArrayContract) {
			let clipIds: string[];
			let allowedRoles: readonly string[];
			let reusableAssetFacts: ReusableWorkflowAssetRoleFacts;
			try {
				clipIds = resolveFrozenClipIds(context.inputs);
				allowedRoles = resolveVideoAssetRoleAllowlist(firstInput(context.inputs, "beat-sheet"));
				reusableAssetFacts = reusableWorkflowAssetRoleFacts(
					context.inputs,
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
		jsonObjectContract = applyWorkflowArtifactJsonObjectContract(
			outputArtifactType,
			jsonObjectContract,
		);
		if (
			outputEncoding === "json_object" &&
			(outputArtifactType === "tapcanvas.beat-sheet/v2" || outputArtifactType === "tapcanvas.launch-beat-sheet/v1") &&
			jsonObjectContract
		) {
			try {
				const sourceLineage = resolveAuthoritativeSourceLineage(context.inputs);
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
				const writerFacts = resolveFrozenSingleClipWriterFacts(context.inputs);
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
		let reasoningEffort: WorkflowAgentReasoningEffort | undefined;
		try {
			maxOutputTokens = requiredAgentMaxOutputTokens(data);
			reasoningEffort = optionalAgentReasoningEffort(data);
		} catch (error: unknown) {
			return {
				ok: false,
				errorCode: "workflow_node_runtime_failed",
				errorMessage: error instanceof Error ? error.message : String(error),
			};
		}
		if (outputArtifactType === "tapcanvas.clip-prompts/v2") {
			maxOutputTokens = Math.min(maxOutputTokens, WORKFLOW_CLIP_WRITER_MAX_OUTPUT_TOKENS);
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
			if (outputArtifactType === "tapcanvas.beat-sheet/v2" && jsonObjectContract.requiredArrayFields?.includes("beats")) {
				const allowedDurations = allowedProviderClipDurations(context.inputs);
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
				const providerClipFacts = explicitProviderClipFacts(context.inputs);
				if (providerClipFacts) {
					jsonObjectContract = applyWorkflowAgentArrayItemExactNumberFields(
						jsonObjectContract,
						"beats",
						providerClipFacts.durations.map((durationSeconds) => ({ durationSeconds })),
					);
				} else {
					const requestedClipCount = requestedProviderClipCount(context.inputs);
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
				const assetPlansPort = findAssetPlansPort(context.inputs);
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
					expected = resolvePlannedAssetIdsFromPort(context.inputs, exactConfig.expectedAssetPlansFromPort);
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
		const hasPhysicalRetryCheckpoint = parseWorkflowAgentPhysicalFailureEvidence(previousEvidence) !== null;
		if (previousEvidence) {
			const previousDelivery = isRecord(previousEvidence.deliveryEvidence)
				? previousEvidence.deliveryEvidence
				: previousEvidence;
			console.info(JSON.stringify({
				message: "workflow_agent_resume_cursor",
				executionId: context.executionId,
				nodeId: context.node.id,
				contextResumeOnly: context.resumeOnly === true,
				hasPhysicalRetryCheckpoint,
				physicalRetryOrdinal: previousDelivery.physicalRetryOrdinal ?? null,
			}));
		}
		if (isTypedOutput && (context.resumeOnly === true || hasPhysicalRetryCheckpoint)) {
			const failed = output({
				node: context.node,
				executorRef,
				ports: {},
				evidence: {
					executorCompleted: false,
					structuredOutputSubmissionPolicy: WORKFLOW_STRUCTURED_OUTPUT_SUBMISSION_POLICY,
					requestTerminal: {
						version: 1,
						terminal: true,
						status: "failed",
						reason: "structured_submission_window_closed",
					},
					agentExecutionFailure: {
						code: "structured_submission_window_closed",
						phase: "before_structured_submission",
						retryable: false,
					},
				},
			});
			if (!failed.ok) return failed;
			return {
				ok: false,
				errorCode: "workflow_node_runtime_failed",
				errorMessage: `Workflow Agent node ${context.node.id} cannot reopen a typed submission window after its single physical run ended`,
				outputRefs: failed.outputRefs,
			};
		}
		const workflowRequiredSkills = uniqueStrings(
			stringListFromData(data, "workflowRequiredSkills"),
		);
		const workflowKnowledgeTools = workflowRequiredSkills.length > 0
			? WORKFLOW_AGENT_KNOWLEDGE_TOOLS.filter((tool) => tool !== "skill_search")
			: WORKFLOW_AGENT_KNOWLEDGE_TOOLS;
		const singleInferenceTypedAgent = outputArtifactType === "tapcanvas.clip-prompts/v2";
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
				runtimeAuthoritativeSourceInstruction(context.inputs, outputArtifactType),
				outputArtifactType === "tapcanvas.asset-plans/v1"
					? [
						runtimeBeatSheetInstruction(context.inputs),
						runtimeProjectAssetCandidatesInstruction(
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
				inputs: context.inputs,
				// A Workflow Agent's Skill dependencies are part of the frozen node
				// definition, just like its executor, model and output contract. Do not
				// erase them and ask the model to rediscover its own runtime dependency.
				requiredSkills: workflowRequiredSkills,
				mountedKnowledgeCardIds: [],
				disabledSkills: [],
				disabledKnowledgeCardIds: [],
				// Formal Clip writer is a one-inference typed atom. Its required
				// Skills and autoload resources are assembled before inference; no
				// retrieval, Skill read, correction, or other supporting tool is part
				// of the submission window.
				allowedTools: singleInferenceTypedAgent
					? []
					: uniqueStrings([
						...workflowKnowledgeTools,
						...stringListFromData(data, "workflowAllowedTools"),
						...stringListFromInput(context.inputs, "tools"),
						...(promptExampleRetrievalScope ? ["prompt_example_search", "prompt_example_read"] : []),
					]),
				...(!singleInferenceTypedAgent && promptExampleRetrievalScope
					? { promptExampleRetrievalScope }
					: {}),
				forcedAgentRole,
				// Plain-text work may resume an accepted durable turn. Typed nodes are
				// fenced above and never reach this call through a second physical window.
				resumeOnly: context.resumeOnly === true || hasPhysicalRetryCheckpoint,
				previousEvidence,
				...(productionStartDeadline ? { productionStartDeadline } : {}),
				...(agentDelivery ? { deliveryScope: agentDelivery } : {}),
				projectContext: runtimeProjectContext(context),
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
						structuredOutputSubmissionPolicy: WORKFLOW_STRUCTURED_OUTPUT_SUBMISSION_POLICY,
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
				if (isTypedOutput) {
					const failed = output({
						node: context.node,
						executorRef,
						ports: {},
						evidence: {
							executorCompleted: false,
							structuredOutputSubmissionPolicy: WORKFLOW_STRUCTURED_OUTPUT_SUBMISSION_POLICY,
							requestTerminal: {
								version: 1,
								terminal: true,
								status: "failed",
								reason: "llm_http_429",
							},
							agentExecutionFailure: {
								code: "llm_http_429",
								phase: "before_structured_submission",
								retryable: false,
							},
						},
					});
					if (!failed.ok) return failed;
					return {
						ok: false,
						errorCode: "workflow_node_runtime_failed",
						errorMessage: `Workflow Agent node ${context.node.id} was rejected before its single structured submission: llm_http_429`,
						outputRefs: failed.outputRefs,
					};
				}
				// Plain-text Agent work may still use provider backpressure because it
				// has no frozen one-submission data contract.
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
			throw error;
		}
		const clipContext = outputArtifactType === "tapcanvas.clip-prompts/v2"
			? firstInput(context.inputs, "clip-contexts")
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
		if (validatedOutput.ok && outputArtifactType === "tapcanvas.beat-sheet/v2") {
			const launchBeat = firstInput(context.inputs, "beat-sheet");
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
					beatSheetAgentResult: firstInput(context.inputs, "beat-sheet"),
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
		const requestTerminal = parseAgentRequestTerminal(agentResult.requestTerminal);
		const hasRecordedStructuredCandidate = isTypedOutput
			&& agentResult.text.trim().length > 0;
		const finalizeOutputContractFailure = !validatedOutput.ok
			&& (
				hasRecordedStructuredCandidate
				|| requestTerminal?.status === "succeeded"
			);
		const finalizeMissingTypedSubmission = isTypedOutput
			&& !validatedOutput.ok
			&& !finalizeOutputContractFailure;
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
				structuredOutputSubmissionPolicy: WORKFLOW_STRUCTURED_OUTPUT_SUBMISSION_POLICY,
				...(agentResult.executionProvenance
					? { executionProvenance: agentResult.executionProvenance }
					: {}),
				...(agentResult.executionProvenanceHistory?.length
					? { executionProvenanceHistory: agentResult.executionProvenanceHistory }
					: {}),
				...(agentResult.promptExampleCandidateSearch
					? { promptExampleCandidateSearch: agentResult.promptExampleCandidateSearch }
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
		// A non-empty typed candidate is the model's one authorized submission.
		// Once that candidate fails the frozen executable contract, no Agent
		// suspension, rate-limit terminal, delivery receipt or physical retry may
		// downgrade the node into waiting or admit another model budget window.
		if (finalizeOutputContractFailure && !validatedOutput.ok) {
			return {
				ok: false,
				errorCode: "workflow_node_runtime_failed",
				errorMessage: `Workflow Agent node ${context.node.id} violated its ${outputEncoding} output contract: ${validatedOutput.errorMessage}`,
				outputRefs: agentOutput.outputRefs,
			};
		}
		if (finalizeMissingTypedSubmission) {
			return {
				ok: false,
				errorCode: "workflow_node_runtime_failed",
				errorMessage: `Workflow Agent node ${context.node.id} ended before its single structured submission: ${requestTerminal?.reason ?? "structured_submission_missing"}`,
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
		if (requestTerminal.status === "suspended") {
			return workflowNodeWaiting({
					...agentOutput.outputRefs,
					ports: {},
					artifacts: [],
					evidence: {
						...agentOutput.outputRefs.evidence,
						executorCompleted: false,
						continuationReason: requestTerminal.reason,
					},
				}, workflowAgentExternalCheckSchedule({
					deliveryEvidence: normalizedAgentResult.deliveryEvidence,
					reason: requestTerminal.reason,
				}));
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
			return output({
				node: context.node,
				executorRef,
				ports: {
					"delivery-evidence": {
						masterVideo: result,
						promptPackageEvidence,
						promptPackageVerification,
						mediaUrl,
					},
				},
				artifacts: [{ type: expectedArtifactType, identity: context.node.id, value: mediaUrl }],
				evidence: {
					verifiedItems: 1,
					expectedArtifactType,
					mediaUrl,
					promptPackageEvidence,
					promptPackageVerification,
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
	if (executorRef === "tapcanvas.video.generate/v1") {
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
	const result = await executeWorkflowNodeByMode(context, dependencies, executeRegisteredWorkflowNodeOnce);
	return bindWorkflowNodeExecutionResultPorts(context, result);
}
