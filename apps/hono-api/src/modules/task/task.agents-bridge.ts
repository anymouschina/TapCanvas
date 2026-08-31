import fs from "node:fs/promises";
import path from "node:path";
import { DIRECTOR_POSE_LABELS, DIRECTOR_PROP_LABELS } from "./director-capture.shared";
import { resolvePositiveIntEnv, CONCURRENCY_DEFAULTS } from "./concurrency-limits";
import {
	AgentsBridgeAdmissionScheduler,
	type AgentsBridgeAdmissionPriority,
} from "./agents-bridge-admission";
import { createAgentsBridgeRequestDeadlineController } from "./agents-bridge-request-deadline";
import { AppError } from "../../middleware/error";
import { normalizeRetrievalContextV1 } from "../execution/execution.retrieval-context";
import type { AppContext } from "../../types";
import { appendTraceEvent } from "../../trace";
import type {
	AgentCanonicalPersistenceHealthV1,
	AgentCompletionTraceV1,
	AgentContinuationTicketV1,
	AgentLogicalTaskStateV1,
	AgentPhysicalRunExitV1,
	AgentPerformanceSnapshotV1,
	AgentRequestTerminalV1,
	AgentRunOutcomeV1,
	AgentRuntimeObservabilityV1,
} from "@tapcanvas/agent-observability";
import {
	createHonoAgentTraceContext,
	resolveAgentTraceCapturePolicy,
} from "../agents/agent-observability.context";
import { normalizeAgentRuntimeObservability } from "../agents/agent-observability.schemas";
import { normalizeAgentPerformanceSnapshot } from "../agents/agent-performance-snapshot";
import {
	buildAgentObservabilitySpans,
	buildFailedHonoAgentObservability,
} from "../agents/agent-observability.spans";
import { persistBuiltAgentObservability } from "../agents/agent-observability.service";
import { redactHttpImageUrls } from "./agents-image-url-privacy";
import { buildPublicChatSystemPrompt } from "./chat-system-prompt";
import { loadPublicChatEnabledModelCatalogSummary } from "../model-catalog/model-catalog.public-chat-summary";
import { buildPhysicalContinuationLeaseTakeover } from "./agents-bridge-continuation-lease";
import { buildAgentsBridgeSessionAffinityHeader } from "./agents-bridge-session-affinity";
import type { PublicChatPromptContext, PublicChatReferenceImageSlot } from "./chat-prompt.types";
import {
	resolveEffectivePublicChatBookChapterScope,
} from "./public-chat-workflow";
import {
	buildPublicChatExpectedDeliverySummary,
	isPublicChatDeliveryEnvelopeStructurallyConsistent,
	normalizePublicChatDurableTerminalDelivery,
	normalizePublicChatDeliveryEvidence,
	normalizePublicChatDeliveryVerification,
	normalizePublicChatSemanticDeliveryContract,
	type PublicChatDeliveryEvidence,
	type PublicChatDurableTerminalDelivery,
	type PublicChatSemanticDeliveryContract,
	type PublicChatDeliveryVerificationSummary,
	type PublicChatExpectedDeliverySummary,
} from "./public-chat-delivery-verifier";
import {
	projectPublicChatLogicalTaskState,
	projectWorkflowActionLogicalTaskState,
} from "./public-chat-logical-task-state";
import { collectPublicChatToolDeliveryArtifacts } from "./public-chat-tool-asset-evidence";
import {
	collectPublicChatHostAsyncDeliveryArtifacts,
	collectPublicChatHostExecutionHandoffEvidence,
	type PublicChatHostExecutionHandoffEvidenceV1,
} from "./public-chat-host-async-evidence";
import {
	summarizeAgentsBridgeLlmTermination,
	type AgentsBridgeLlmTerminationSummary,
} from "./agents-bridge-llm-termination";
import {
	parseAgentExecutionProvenance,
	type AgentExecutionProvenance,
} from "./agent-execution-provenance";
import { getFlowForOwner, listFlowsByOwner } from "../flow/flow.repo";
import {
	PUBLIC_FLOW_AUTHORITY_BASE_FRAME_STATUSES,
	PUBLIC_FLOW_ADMIN_WORKFLOW_TASK_NODE_KINDS,
	PUBLIC_FLOW_CREATION_STAGES,
	PUBLIC_FLOW_PRODUCTION_LAYERS,
} from "../flow/flow.public.schemas";
import { isAdminRequest } from "../team/team.service";
import {
	CANVAS_PLAN_TAG_NAME,
	canvasPlanSchema,
	type ChatCanvasPlan,
} from "../apiKey/canvasPlanProtocol";
import {
	normalizePublicFlowAnchorBindings,
	type PublicFlowAnchorBinding,
} from "../flow/flow.anchor-bindings";
import {
	collectStoryboardSelectionReferenceImageUrls,
	normalizeStoryboardSelectionContext,
	type StoryboardSelectionContext,
} from "../storyboard/storyboardSelectionProtocol";
import type { TaskRequestDto, TaskResultDto } from "./task.schemas";
import { createSseEventParser } from "../../utils/sse";
import type { SseEventMessage } from "../../utils/sse";
import {
	characterIdentityBoardSpecToolSchema,
	propFunctionSpecToolSchema,
	propIdentityBoardSpecToolSchema,
	sceneLightingSpecToolSchema,
} from "../ai/tool-schemas";
import {
	loadGenerationContractModule,
	type GenerationContract,
} from "../../platform/node/shared-schema-loader";
import { resolveProjectDataRepoRoot } from "../asset/project-data-root";
import { BookIndexStoreError, readBookIndex } from "../asset/book-index-store";
import {
	resolveChatSkillReferences,
	type ChatSkillReferenceSource,
} from "./chat-skill-references";
import {
	getBuiltInCapabilityAvailability,
	listDisabledSkillKeys,
	listReplacedSkillKeys,
	listEquippedWorkflowCapabilities,
} from "../agents/capability-bay.service";
import { resolveProjectWorkspaceContextDir } from "../agents/project-context.service";
import {
	assetObjectContractSchema,
	beatSheetDraftBeatPatchSchema,
	beatSheetDraftBeatSchema,
	beatSheetDraftHeaderPatchSchema,
	beatSheetDraftHeaderSchema,
} from "./video-orchestrator.tool-schema";
import {
	parseDurableProgressCursor,
	type DurableProgressCursorV1,
} from "./durable-progress-cursor";
import { MAX_IMAGE_REFERENCE_INSPECTION_ITEMS } from "./agents-tool-bridge.image-reference-contract";
import {
	HostCanvasContextSchema,
	HostCapabilityManifestSchema,
	buildHostFlowPatchTool,
	buildHostTool,
	renderHostManifestPrompt,
	type HostCanvasContext,
	type HostCapabilityManifest,
} from "./host-canvas-protocol";
import { applyAgentExecutionToolPolicy } from "./agents-bridge-tool-policy";
import {
	readToolOperationExecution,
	readToolSchemaOperationIndex,
	type ToolOperationExecution,
} from "./agents-tool-schema-projection";
import { buildTrustedInternalExecutionApiKey } from "./agents-bridge-continuation-auth";
import { buildInternalApiKey } from "../apiKey/internal-api-key";
import { buildShotTableCriticRemoteTool } from "./agents-bridge-shot-critic-tool";
import { filterRejectedSelectedReferenceMedia } from "./agents-bridge-reference-media";
import { buildGenerationPrefsContextBlock, parseUserGenerationPrefs } from "../auth/generation-prefs";
import { getPrismaClient } from "../../platform/node/prisma";
import {
	listBuiltInSmallTCapabilities,
	measureRemoteToolCatalogIndex,
	measureRemoteToolSurface,
	readRemoteToolCapabilityRegistryEntry,
	readRemoteToolSurfaceMetadata,
	resolveAgentsBridgeRemoteToolSurface,
	type AgentsBridgeRemoteToolCatalogEntry,
	type AgentsBridgeRemoteToolSurfaceResolution,
} from "./agents-bridge-remote-tool-surface";
import {
	STORY_PREVIEW_MAX_BOARDS,
	STORY_PREVIEW_ORCHESTRATOR_TOOL,
	storyPreviewPutBoardMode,
} from "./story-preview-orchestrator";

const generationContractModule = loadGenerationContractModule();
const { parseGenerationContract } = generationContractModule;

const replanReplacementBeatPropertyNames = new Set([
	"logline",
	"durationBudget",
	"dialogueScript",
]);
const replanReplacementBeatSchema = {
	type: "object",
	additionalProperties: false,
	properties: Object.fromEntries(
		Object.entries(beatSheetDraftBeatSchema.properties ?? {})
			.filter(([propertyName]) => replanReplacementBeatPropertyNames.has(propertyName)),
	),
	required: [...replanReplacementBeatPropertyNames],
};

async function loadUserGenerationPrefsContext(userId: string): Promise<string | null> {
	const normalizedUserId = userId.trim();
	if (!normalizedUserId) return null;
	try {
		const user = await getPrismaClient().users.findUnique({
			where: { id: normalizedUserId },
			select: { generation_prefs: true },
		});
		return buildGenerationPrefsContextBlock(parseUserGenerationPrefs(user?.generation_prefs ?? null));
	} catch (error) {
		console.error(
			`[agents-bridge.generation-prefs] read failed user=${normalizedUserId} reason=${
				error instanceof Error ? error.message : String(error)
			}`,
		);
		throw new AppError("读取用户生成偏好失败，未继续本轮对话", {
			status: 503,
			code: "generation_preferences_unavailable",
		});
	}
}

type AgentsBridgeChatResponse = {
	id?: string;
	text?: string;
	pendingUserInput?: Record<string, unknown>;
	assets?: Array<{
		type?: string;
		url?: string;
		thumbnailUrl?: string;
		title?: string;
		fileName?: string;
		mimeType?: string;
		assetId?: string;
	}>;
	trace?: {
		toolCalls?: Array<Record<string, unknown>>;
		output?: Record<string, unknown>;
		summary?: Record<string, unknown>;
		completion?: Record<string, unknown>;
		runOutcome?: Record<string, unknown>;
		planning?: Record<string, unknown>;
		turns?: Array<Record<string, unknown>>;
		runtime?: Record<string, unknown>;
		todoList?: Record<string, unknown>;
		todoEvents?: Array<Record<string, unknown>>;
	};
};

type AgentsBridgeStreamToolCall = {
	toolCallId?: unknown;
	toolName?: unknown;
	transportToolName?: unknown;
	phase?: unknown;
	status?: unknown;
	severity?: unknown;
	input?: unknown;
	outputPreview?: unknown;
	startedAt?: unknown;
	finishedAt?: unknown;
	durationMs?: unknown;
	errorMessage?: unknown;
};

type AgentsBridgeStreamTodoListEvent = {
	threadId?: unknown;
	turnId?: unknown;
	sourceToolCallId?: unknown;
	items?: unknown;
	totalCount?: unknown;
	completedCount?: unknown;
	inProgressCount?: unknown;
};

export type AgentsBridgeStreamEvent =
	| { event: "content"; data: { delta?: string } }
	| { event: "block"; data: Record<string, unknown> }
	| { event: "suggestions"; data: Record<string, unknown> }
	| { event: "tool"; data: AgentsBridgeStreamToolCall }
	| { event: "skill"; data: Record<string, unknown> }
	| { event: "todo_list"; data: AgentsBridgeStreamTodoListEvent }
	| { event: "result"; data: { response: AgentsBridgeChatResponse } }
	| { event: "agent_role"; data: Record<string, unknown> }
	| { event: "status-update"; data: Record<string, unknown> }
	| { event: "artifact-update"; data: Record<string, unknown> }
	| { event: "error"; data: { message?: string; code?: string; details?: unknown } }
	| { event: "done"; data: { reason?: string } }
	| {
			event:
				| "thread.started"
				| "turn.started"
				| "item.started"
				| "item.updated"
				| "item.completed"
				| "turn.completed";
			data: Record<string, unknown>;
	  };

export type AgentsBridgeStreamObserver = (event: AgentsBridgeStreamEvent) => void | Promise<void>;

type AgentsBridgeAssetRole =
	| "target"
	| "reference"
	| "character"
	| "scene"
	| "prop"
	| "product"
	| "style"
	| "context"
	| "mask";

type AgentsBridgeAssetInput = {
	nodeId?: string;
	assetId?: string;
	assetRefId?: string;
	url: string;
	mediaType: "image" | "video";
	role: AgentsBridgeAssetRole;
	weight?: number;
	note?: string;
	name?: string;
};

type AgentsBridgeReferenceImageSlot = PublicChatReferenceImageSlot;

export function assertHostGenerationModeSupported(
	manifest: HostCapabilityManifest | null,
): "host" {
	const generationMode = manifest?.generationMode ?? "host";
	if (manifest && generationMode !== "host") {
		throw new AppError(`Host generation mode is not implemented: ${generationMode}`, {
			status: 400,
			code: "host_generation_mode_not_implemented",
			details: { generationMode },
		});
	}
	return "host";
}

type AgentsBridgeChatContextSkill = {
	id: string | null;
	source: ChatSkillReferenceSource | null;
	key: string | null;
	name: string | null;
};

type AgentsBridgeRoleSkillAssignment = {
	roleId: string;
	roleName: string;
	source: "system" | "custom";
	skillId: string | null;
	skillKey: string | null;
	skillName: string | null;
	fileName: string | null;
	content: string | null;
};

type AgentsBridgeChapterDirectorPersona = {
	personaId: string;
	personaName: string;
	source: "catalog" | "custom";
	prompt: string | null;
};

type AgentsBridgeChapterStyleOverride = {
	styleId: string | null;
	styleName: string | null;
	stylePrompt: string | null;
	category: string | null;
	referenceImageCount: number;
};

type AgentsBridgeGenerationProposal = {
	version: 1;
	proposalId: string;
	kind: "image" | "video" | "audio" | "prompt";
	title: string;
	prompt: string;
	model?: string;
	parameters: Array<{ label: string; value: string }>;
	action: string | null;
	nodeId: string | null;
};

type AgentsBridgeChapterCanvasIntent =
	| "extract_roles"
	| "expand_video_script"
	| "generate_shot_placeholders"
	| "generate_scene_references"
	| "generate_video_nodes"
	| "generate_group_storyboard";

type AgentsBridgeChatContext = {
	requestedWorkflowExecutionVariant: "full_video" | "first_video" | null;
	generationProposal: AgentsBridgeGenerationProposal | null;
	currentProjectName: string | null;
	workspaceAction:
		| "chapter_script_generation"
		| "chapter_asset_generation"
		| "shot_video_generation"
		| null;
	skill: AgentsBridgeChatContextSkill | null;
	roleSkillAssignments: AgentsBridgeRoleSkillAssignment[];
	chapterDirectorPersona: AgentsBridgeChapterDirectorPersona | null;
	chapterStyleOverride: AgentsBridgeChapterStyleOverride | null;
	selectedNodeLabel: string | null;
	selectedNodeKind: string | null;
	selectedNodeTextPreview: string | null;
	selectedReference: {
		nodeId: string | null;
		label: string | null;
		kind: string | null;
		anchorBindings?: PublicFlowAnchorBinding[];
		roleName?: string | null;
		roleCardId?: string | null;
		imageUrl: string | null;
		sourceUrl: string | null;
		bookId: string | null;
		chapterId: string | null;
		shotNo: number | null;
		productionLayer: string | null;
		creationStage: string | null;
		approvalStatus: string | null;
		authorityBaseFrameNodeId?: string | null;
		authorityBaseFrameStatus?: "planned" | "confirmed" | null;
		hasUpstreamTextEvidence: boolean;
		hasDownstreamComposeVideo: boolean;
		storyboardSelectionContext: StoryboardSelectionContext | null;
	} | null;
	chapterCanvasReference: {
		version: 1;
		scopeKey: string;
		nodeCount: number;
		edgeCount: number;
		summary: string | null;
		selectedNodeId: string | null;
	} | null;
	chatMode: "creative" | null;
	creativePhase: "prep" | "writing" | null;
	canvasSummary: string | null;
};

type AgentsBridgeRemoteToolDefinition = {
	name: string;
	description: string;
	parameters: Record<string, unknown>;
	execution?: import("../ai/tool-schemas").ToolExecutionSemantics;
};

const REMOTE_FLOW_CREATE_NODE_TYPES = ["taskNode", "groupNode"] as const;
const REMOTE_FLOW_TASK_NODE_KINDS = [
	"text",
	"image",
	"imageEdit",
	"video",
	"storyboard",
	"videoAnalysis",
	"shotTable",
	"novelDoc",
	"scriptDoc",
	"storyboardScript",
	"cameraRef",
	"workflowInput",
	"workflowOutput",
	"storyboardImage",
	"imageFission",
	"composeVideo",
	"audio",
	"subtitle",
] as const;

const REMOTE_FLOW_TASK_NODE_KINDS_WITHOUT_STORYBOARD = REMOTE_FLOW_TASK_NODE_KINDS.filter(
	(kind) => kind !== "storyboard",
);


type BookIndexMeta = {
	title?: string;
};

type ProjectBookCandidate = {
	bookId: string;
	title: string | null;
};

type ResolvedProjectBookRef = {
	requestedRef: string;
	bookId: string;
	title: string | null;
	matchedBy: "book_id" | "title" | "sole_project_book";
};

type CanvasPlanDiagnostics = {
	tagPresent: boolean;
	normalized: false;
	parseSuccess: boolean;
	error: string;
	errorCode: string;
	errorDetail: string;
	schemaIssues: string[];
	detectedTagName: string;
	nodeCount: number;
	edgeCount: number;
	nodeKinds: string[];
	hasAssetUrls: boolean;
	action: string;
	summary: string;
	reason: string;
	rawPayload: string;
};

type BridgeToolEvidence = {
	toolNames: string[];
	readProjectState: boolean;
	readBookList: boolean;
	readBookIndex: boolean;
	readChapter: boolean;
	readStoryboardPlan: boolean;
	readStoryboardContinuity: boolean;
	readStoryboardSourceBundle: boolean;
	readNodeContextBundle: boolean;
	readVideoReviewBundle: boolean;
	readMaterialAssets: boolean;
	generatedAssets: boolean;
	wroteCanvas: boolean;
};

export type ToolStatusSummary = {
	totalToolCalls: number;
	succeededToolCalls: number;
	failedToolCalls: number;
	deniedToolCalls: number;
	blockedToolCalls: number;
	warningToolCalls?: number;
	runMs: number | null;
};

export type ToolExecutionIssueSummary = {
	/** 全回合观测到的历史问题计数，保留给 trace/诊断，绝不因后续成功而抹除。 */
	failedToolCalls: number;
	deniedToolCalls: number;
	blockedToolCalls: number;
	warningToolCalls: number;
	coordinationBlockedToolCalls: number;
	actionableBlockedToolCalls: number;
	/** 被同一逻辑工具后续成功调用明确替代的、可重试早期尝试数量。 */
	retryRecoveredToolCalls: number;
	/** 排除协调门禁与已成功重试后，仍未解决的执行问题数量。 */
	unresolvedToolCalls: number;
	/** 是否所有可执行历史问题都已由同一逻辑工具的后续成功重试解决。 */
	recoveredBySuccessfulRetry: boolean;
	/** 是否由同一回合、同一 delivery contract 的真实事实证据覆盖了早期问题。 */
	recoveredByDeliveryEvidence: boolean;
	/** 历史上确实发生过执行问题；与 hasExecutionIssues（未解决）刻意分离。 */
	hasHistoricalExecutionIssues: boolean;
	/** 仅表示交付收口时仍未被真实证据覆盖的执行问题。 */
	hasExecutionIssues: boolean;
};

type DiagnosticFlag = {
	code: string;
	severity: "high" | "medium";
	title: string;
	detail: string;
};

type ChapterGroundedVisualPreproductionSummary = {
	active: boolean;
	visualNodeCount: number;
	imageLikeNodeCount: number;
	preproductionImageLikeNodeCount: number;
	reusablePreproductionImageLikeNodeCount: number;
	hasVideoNodes: boolean;
	hasMaterializedVisualOutputs: boolean;
	hasPlannedAuthorityBaseFrame: boolean;
	hasConfirmedAuthorityBaseFrame: boolean;
	materializedStoryboardStillCount: number;
};

export type AgentsContinuationTicketV1 = AgentContinuationTicketV1;
export type AgentsPhysicalRunExitV1 = AgentPhysicalRunExitV1;

export type AgentsBridgeAdmissionReceiptV1 = {
	version: 1;
	acceptance: "accepted" | "unknown";
	publicTurnId: string;
	sessionId: string;
	turnState: string | null;
	activeTurn: boolean | null;
	reconciledAt: string;
};

export function buildAgentsBridgeTurnIdentity(
	publicTurnId: string,
	requestId: string,
): Readonly<{ publicTurnId: string; logicalTaskId: string }> {
	const stableTurnId = publicTurnId.trim() || requestId.trim();
	if (!stableTurnId) {
		throw new Error("Agents bridge turn identity is missing");
	}
	return {
		publicTurnId: stableTurnId,
		logicalTaskId: stableTurnId,
	};
}

type FlowPatchNodeFinalState = {
	id: string;
	kind: string;
	data: Record<string, unknown>;
};

type AgentsRuntimeTraceSummary = {
	profile: "general" | "code" | "unknown";
	terminalAuthority?: "user_delivery" | "workflow_action";
	registeredToolNames: string[];
	registeredTeamToolNames: string[];
	requiredSkills: string[];
	loadedSkills: string[];
	allowedSubagentTypes: string[];
	requireAgentsTeamExecution: boolean;
	inputProgressionGate?: {
		status: "completed";
		model: "deepseek-v4-flash";
		decision: "allow" | "deny";
		reasonCode: string;
		reason: string;
	};
	physicalRunExit?: AgentsPhysicalRunExitV1;
	terminalDelivery?: PublicChatDurableTerminalDelivery;
	admissionReceipt?: AgentsBridgeAdmissionReceiptV1;
	executionProvenance?: AgentExecutionProvenance;
	promptExampleCandidateSearch?: {
		version: 1;
		status: "not_attempted" | "candidate_found" | "no_match" | "retrieval_failed" | "invalid_evidence" | "tool_unavailable";
		mediaType: "image" | "video";
		attempted: boolean;
		remoteAttempted: boolean;
		candidateCount: number;
		blocking: false;
		rationale: string;
		toolCallId?: string;
	};
	userIntentContract?: Record<string, unknown>;
	retrievalCandidateSets?: Record<string, unknown>[];
	suspension?: {
		reasonCode: string;
		physicalRunId: string;
		progressRevision: number;
	};
		deliveryReport?: {
			required: boolean;
			present: boolean;
			satisfiedByAsyncSubmission: boolean;
		remoteActionCount: number;
		lastRemoteActionSeq: number | null;
		lastReportSeq: number | null;
	};
	contextDiagnostics?: {
		totalChars: number;
		totalBudgetChars: number;
		sources: Array<{
			id: string;
			kind: string;
			summary: string;
			chars: number;
			budgetChars: number;
			truncated: boolean;
		}>;
	};
	capabilitySnapshot?: {
		providers: Array<{
			kind: string;
			name: string;
			toolNames: string[];
			toolCount: number;
		}>;
		exposedToolNames: string[];
		exposedTeamToolNames: string[];
	};
	policySummary?: {
		totalDecisions: number;
		allowCount: number;
		denyCount: number;
		requiresApprovalCount: number;
		uniqueDeniedSignatures: string[];
	};
	performanceSnapshot?: AgentPerformanceSnapshotV1;
	observability?: AgentRuntimeObservabilityV1;
};

type AgentsTodoListItemSummary = {
	text: string;
	completed: boolean;
	status: "pending" | "in_progress" | "completed";
};

type AgentsTodoListTraceSummary = {
	sourceToolCallId: string;
	items: AgentsTodoListItemSummary[];
	totalCount: number;
	completedCount: number;
	inProgressCount: number;
	pendingCount: number;
};

type AgentsTodoEventTraceSummary = AgentsTodoListTraceSummary & {
	atMs: number | null;
	startedAt: string | null;
	finishedAt: string | null;
	durationMs: number | null;
};

type AgentsPlanningTraceSummary = {
	source: "goal" | "todo_list" | "unknown";
	planningRequired: boolean;
	hasGoal: boolean;
	goalStatus: string | null;
	goalObjective: string | null;
	minimumStepCount: number;
	hasChecklist: boolean;
	latestStepCount: number;
	maxObservedStepCount: number;
	completedCount: number;
	inProgressCount: number;
	pendingCount: number;
	meetsMinimumStepCount: boolean;
	checklistComplete: boolean;
};

type AgentsCompletionTraceSummary = AgentCompletionTraceV1;
type AgentsBridgeRunOutcome = AgentRunOutcomeV1;

export type AgentsSemanticTaskSummary = {
	taskGoal: string;
	requestedOutput: string;
	taskKind: string;
	recommendedNextStage: string;
	mustStop: boolean;
	requiresExecutionDelivery: boolean;
	blockingGaps: string[];
	successCriteria: string[];
	deliveryContract?: PublicChatSemanticDeliveryContract | null;
	deliveryEvidence?: PublicChatDeliveryEvidence["items"];
	deliveryVerification?: PublicChatDeliveryVerificationSummary;
};

type AgentsSemanticExecutionIntentSummary = {
	detected: boolean;
	source:
		| "task_interrogation_json"
		| "tool_trace_output_json"
		| "runtime_user_intent_contract"
		| "none";
	taskKind: string | null;
	mustStop: boolean;
	requiresExecutionDelivery: boolean;
	reason: string;
};

export type BridgeToolCall = {
	toolCallId: string;
	seq: number | null;
	atMs: number | null;
	logicalToolName?: string;
	name: string;
	status: "succeeded" | "failed" | "denied" | "blocked" | "";
	severity?: "warning" | "error" | "";
	pathHint: string;
	errorMessage: string;
	outputPreview: string;
	outputChars: number | null;
	outputHead: string;
	outputTail: string;
	outputJson: Record<string, unknown> | null;
	inputJson: Record<string, unknown> | null;
	requestedAgentType: string;
	startedAt: string;
	finishedAt: string;
	durationMs: number | null;
};

type AgentsBridgeOutputMode = "plan_with_assets" | "plan_only" | "direct_assets" | "text_only";

/**
 * An empty interactive canvas does not need the full hot tool payload on the
 * first model turn. Keep the authenticated catalog available so agents can
 * discover an exact operation when the request actually needs one, while
 * avoiding a 20k+ token prompt for ordinary text conversations.
 *
 * This is deliberately based only on explicit, structural execution facts;
 * it does not inspect or classify the user's wording.
 */
export function shouldDeferPublicChatDirectTools(input: {
	publicAgentsRequest: boolean;
	requestKind: "chat" | "prompt_refine";
	hostManifestPresent: boolean;
	canvasNodeId: string;
	assetInputCount: number;
	referenceImageCount: number;
	forceAssetGeneration: boolean;
	hasGenerationContract: boolean;
	hasChapterContext: boolean;
	hasForcedAgentRole: boolean;
	requiredSkillCount: number;
	hasExplicitToolPolicy?: boolean;
}): boolean {
	return input.publicAgentsRequest
		&& !input.hostManifestPresent
		&& input.requestKind === "chat"
		&& !input.canvasNodeId.trim()
		&& input.assetInputCount === 0
		&& input.referenceImageCount === 0
		&& !input.forceAssetGeneration
		&& !input.hasGenerationContract
		&& !input.hasChapterContext
		&& !input.hasForcedAgentRole
		&& input.requiredSkillCount === 0
		&& !input.hasExplicitToolPolicy;
}

type AgentsBridgeDecision = {
	executionKind: "plan" | "execute" | "generate" | "answer";
	canvasAction: "create_canvas_workflow" | "write_canvas" | "none";
	assetCount: number;
	projectStateRead: boolean;
	reason: string;
};

type AgentsBridgeCanvasMutation = {
	deletedNodeIds: string[];
	deletedEdgeIds: string[];
	createdNodeIds: string[];
	patchedNodeIds: string[];
	executableNodeIds: string[];
};

type AgentsBridgeTurnVerdictStatus = "satisfied" | "partial" | "failed";

type AgentsBridgeTurnVerdict = {
	status: AgentsBridgeTurnVerdictStatus;
	reasons: string[];
};

type AgentsBridgeRequestTerminal = AgentRequestTerminalV1;

export type DurableTaskReferenceV1 = {
	version: 1;
	toolName: string;
	mode: string | null;
	runId: string | null;
	taskId: string | null;
	draftRevision: string | null;
	beatRevision: string | null;
	preflightRevision: string | null;
	preflightFingerprint: string | null;
	clipIndex: number | null;
	progressCursor?: DurableProgressCursorV1 | null;
	acceptedAsync: boolean;
};

export type DurableProgressClaimV1 = {
	key: string;
	fingerprint: string;
	kind: "durable_action" | "delivery" | "task_state";
	toolName: string;
	toolCallId: string;
	observedAt: string;
	revision: number;
};

export type DurableActionRecoveryFactV1 = {
	version: 1;
	toolName: string;
	mode: string | null;
	status: "failed" | "blocked" | "denied" | "warning";
	code: string | null;
	message: string;
	runId: string | null;
	draftRevision: string | null;
	/** Exact failed action input, only for server-declared same-chain repair. */
	retryInput?: Record<string, unknown>;
};

type AgentsBridgeResponseMeta = {
	traceId: string;
	/** 本轮实际传入 agents-cli 的唯一模型选择器；公开响应据此保留可追溯模型事实。 */
	modelKey?: string;
	modelAlias?: string;
	requestId?: string;
	sessionId?: string;
	outputMode: AgentsBridgeOutputMode;
	toolEvidence: BridgeToolEvidence;
	expectedDelivery?: PublicChatExpectedDeliverySummary;
	deliveryEvidence?: PublicChatDeliveryEvidence;
	deliveryVerification?: PublicChatDeliveryVerificationSummary;
	llmTermination?: AgentsBridgeLlmTerminationSummary;
	toolStatusSummary: ToolStatusSummary;
	/** 历史工具问题及其是否被同回合真实交付证据纠正。 */
	toolExecutionIssues: ToolExecutionIssueSummary;
	diagnosticFlags: DiagnosticFlag[];
	canvasPlan: CanvasPlanDiagnostics;
	canvasMutation?: AgentsBridgeCanvasMutation;
	agentDecision: AgentsBridgeDecision;
	completionTrace?: AgentsCompletionTraceSummary;
	runOutcome: AgentsBridgeRunOutcome;
	logicalTaskState: AgentLogicalTaskStateV1;
	semanticExecutionIntent?: AgentsSemanticExecutionIntentSummary;
	planningTrace?: AgentsPlanningTraceSummary;
	todoList?: AgentsTodoListTraceSummary;
	todoEvents?: AgentsTodoEventTraceSummary[];
	turnVerdict: AgentsBridgeTurnVerdict;
	requestTerminal: AgentsBridgeRequestTerminal;
	hostExecutionHandoff?: PublicChatHostExecutionHandoffEvidenceV1;
	durableTaskReferences?: DurableTaskReferenceV1[];
	actionRecoveryFacts?: DurableActionRecoveryFactV1[];
	runtime?: AgentsRuntimeTraceSummary;
	executionProvenance?: AgentExecutionProvenance;
	observability: {
		canonicalPersistence: AgentCanonicalPersistenceHealthV1;
	};
};

const TEAM_COORDINATION_BLOCKED_CODES = new Set([
	"team_subagents_pending",
	"team_coordination_pending",
]);
const EXECUTION_PLANNING_BLOCKED_CODES = new Set([
	"execution_planning_required",
	"execution_checklist_required",
]);

function readTraceStringField(
	value: Record<string, unknown> | null | undefined,
	key: string,
): string {
	if (!value) return "";
	const raw = value[key];
	return typeof raw === "string" ? raw.trim() : "";
}

function readTraceNumberField(
	value: Record<string, unknown> | null | undefined,
	key: string,
): number | null {
	if (!value) return null;
	const raw = value[key];
	if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
	return raw;
}

function readTraceBooleanField(
	value: Record<string, unknown> | null | undefined,
	key: string,
): boolean | null {
	if (!value) return null;
	const raw = value[key];
	return typeof raw === "boolean" ? raw : null;
}

export async function parseAgentsBridgeSseResponse(input: {
	response: Response;
	c: AppContext;
	onEvent?: AgentsBridgeStreamObserver;
	// The public chat interrupt path aborts the request controller while the
	// bridge can still be waiting on the next SSE chunk. Cancel the reader as
	// soon as that signal fires so the awaiting read cannot keep the turn alive.
	abortSignal?: AbortSignal;
	// Called only after a named, valid runtime event is parsed. Transport heartbeat
	// comments prove the socket is alive but do not prove the agent made progress.
	onActivity?: () => void;
}): Promise<AgentsBridgeChatResponse> {
	if (!input.response.body) {
		throw new AppError("Agents bridge 流响应缺少正文", {
			status: 502,
			code: "agents_bridge_stream_missing_body",
		});
	}

	const reader = input.response.body.getReader();
	const onAbort = () => {
		void reader.cancel(toAbortError(input.abortSignal)).catch(() => undefined);
	};
	if (input.abortSignal?.aborted) {
		onAbort();
	} else {
		input.abortSignal?.addEventListener("abort", onAbort, { once: true });
	}
	const decoder = new TextDecoder();
	const parser = createSseEventParser();
	let finalResponse: AgentsBridgeChatResponse | null = null;

	const appendTodoTraceEvent = (toolCallRaw: AgentsBridgeStreamToolCall) => {
		const toolName =
			typeof toolCallRaw?.toolName === "string" ? toolCallRaw.toolName.trim() : "";
		const phase =
			typeof toolCallRaw?.phase === "string" ? toolCallRaw.phase.trim().toLowerCase() : "";
		if (toolName !== "TodoWrite" || phase !== "completed") return;
		const outputPreview =
			typeof toolCallRaw?.outputPreview === "string"
				? toolCallRaw.outputPreview.trim()
				: "";
		const todoText = outputPreview;
		if (!todoText) return;
		appendTraceEvent(input.c, "public:agent:todo_write", {
			toolName,
			text: todoText,
		});
	};

	const parseRecordPayload = (payloadText: string): Record<string, unknown> => {
		const payload = JSON.parse(payloadText) as unknown;
		if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
			throw new Error("sse_payload_not_object");
		}
		return payload as Record<string, unknown>;
	};

	const parseNamedSseEvent = (rawEvent: SseEventMessage): AgentsBridgeStreamEvent => {
		const payloadText = rawEvent.data.trim();
		const payload = parseRecordPayload(payloadText);
		switch (rawEvent.event) {
			case "content":
				return { event: "content", data: payload };
			case "block":
				// content-block 协议（agents-cli 发射、web 前端消费）：本层只做透传，
				// 不解读 op/block 结构，交给前端 reconcileBlocks 处理。
				return { event: "block", data: payload };
			case "suggestions":
				// suggest_replies 产出的可点击后续建议，透传给前端渲染成 chips。
				return { event: "suggestions", data: payload };
			case "agent_role":
				// 团队角色子 agent 活动（分镜师/生成师/剪辑师/后期 working）：透传给前端展示。
				return { event: "agent_role", data: payload };
			case "tool":
				return { event: "tool", data: payload as AgentsBridgeStreamToolCall };
			case "skill":
				return { event: "skill", data: payload };
			case "todo_list":
				return { event: "todo_list", data: payload as AgentsBridgeStreamTodoListEvent };
			case "result": {
				const response =
					"response" in payload &&
					payload.response &&
					typeof payload.response === "object" &&
					!Array.isArray(payload.response)
						? (payload.response as AgentsBridgeChatResponse)
						: null;
				if (!response) {
					throw new Error("result_event_missing_response");
				}
				return { event: "result", data: { response } };
			}
			case "error":
				return { event: "error", data: payload };
			case "done":
				return { event: "done", data: payload };
			case "status-update":
				return { event: "status-update", data: payload };
			case "artifact-update":
				return { event: "artifact-update", data: payload };
			case "thread.started":
			case "turn.started":
			case "item.started":
			case "item.updated":
			case "item.completed":
			case "turn.completed":
				return { event: rawEvent.event, data: payload };
			default:
				throw new Error(`unexpected_sse_event:${rawEvent.event || "message"}`);
		}
	};

	const handleParsedEvent = async (event: AgentsBridgeStreamEvent): Promise<void> => {
		await input.onEvent?.(event);
		if (event.event === "tool") {
			appendTodoTraceEvent(event.data);
			return;
		}
		if (event.event === "result") {
			finalResponse = event.data.response;
			return;
		}
		if (event.event === "error") {
			const message =
				typeof event.data.message === "string" && event.data.message.trim()
					? event.data.message.trim()
					: "agents_bridge_stream_failed";
			const code =
				typeof event.data.code === "string" && event.data.code.trim()
					? event.data.code.trim()
					: "agents_bridge_stream_failed";
			throw new AppError(message, {
				status: 502,
				code,
				details: event.data.details,
			});
		}
	};

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			const events = parser.push(decoder.decode(value, { stream: true }));
			for (const rawEvent of events) {
				const payloadText = rawEvent.data.trim();
				if (!payloadText) continue;
				let event: AgentsBridgeStreamEvent;
				try {
					event = parseNamedSseEvent(rawEvent);
				} catch (error) {
					throw new AppError("Agents bridge 流事件解析失败", {
						status: 502,
						code: "agents_bridge_stream_invalid_event",
						details: {
							reason: error instanceof Error ? error.message : "unknown_parse_error",
							payloadPreview: payloadText.slice(0, 500),
						},
					});
				}
				// Only a valid named runtime event advances the idle deadline. SSE comment
				// heartbeats are intentionally excluded so a live socket cannot mask a
				// stalled model continuation forever.
				input.onActivity?.();
				await handleParsedEvent(event);
			}
		}
		for (const rawEvent of parser.finish()) {
			const payloadText = rawEvent.data.trim();
			if (!payloadText) continue;
			let event: AgentsBridgeStreamEvent;
			try {
				event = parseNamedSseEvent(rawEvent);
			} catch (error) {
				throw new AppError("Agents bridge 流事件解析失败", {
					status: 502,
					code: "agents_bridge_stream_invalid_event",
					details: {
						reason: error instanceof Error ? error.message : "unknown_parse_error",
						payloadPreview: payloadText.slice(0, 500),
					},
				});
			}
			input.onActivity?.();
			await handleParsedEvent(event);
		}
		throwIfAbortSignalAborted(input.abortSignal);
		if (!finalResponse) {
			throw new AppError("Agents bridge 流在返回终态结果前结束", {
				status: 502,
				code: "agents_bridge_stream_interrupted",
				details: { resultReceived: false, transportEndedCleanly: true },
			});
		}
		return finalResponse;
	} catch (error: unknown) {
		throwIfAbortSignalAborted(input.abortSignal);
		if (error instanceof AppError) throw error;
		if (finalResponse) return finalResponse;
		throw new AppError("Agents bridge 流在返回终态结果前中断", {
			status: 502,
			code: "agents_bridge_stream_interrupted",
			details: {
				resultReceived: finalResponse !== null,
				cause: {
					name: error instanceof Error ? error.name : "UnknownError",
					message: error instanceof Error ? error.message : String(error),
				},
			},
		});
	} finally {
		input.abortSignal?.removeEventListener("abort", onAbort);
		reader.releaseLock();
	}
}

function extractCanvasPlanPayload(text: string): string {
	const normalizedText = text.toLowerCase();
	const openTag = `<${CANVAS_PLAN_TAG_NAME.toLowerCase()}>`;
	const closeTag = `</${CANVAS_PLAN_TAG_NAME.toLowerCase()}>`;
	const contentStart = normalizedText.indexOf(openTag);
	if (contentStart < 0) return "";
	const payloadStart = contentStart + openTag.length;
	const contentEnd = normalizedText.indexOf(closeTag, payloadStart);
	if (contentEnd < 0) return "";
	return text.slice(payloadStart, contentEnd).trim();
}

function isAsciiLetter(value: string): boolean {
	if (value.length !== 1) return false;
	const code = value.toLowerCase().charCodeAt(0);
	return code >= 97 && code <= 122;
}

function isSimpleProtocolTagName(value: string): boolean {
	if (!value || !isAsciiLetter(value[0] || "")) return false;
	for (const character of value) {
		if (isAsciiLetter(character) || character === "_") continue;
		const code = character.charCodeAt(0);
		if (code < 48 || code > 57) return false;
	}
	return true;
}

function normalizeSimpleProtocolTag(raw: string): string {
	const trimmed = raw.trim();
	const withoutClosingMarker = trimmed.startsWith("/")
		? trimmed.slice(1).trim()
		: trimmed;
	return isSimpleProtocolTagName(withoutClosingMarker)
		? withoutClosingMarker
		: "";
}

function detectCanvasPlanTagName(text: string): string {
	let cursor = 0;
	while (cursor < text.length) {
		const tagStart = text.indexOf("<", cursor);
		if (tagStart < 0) return "";
		const tagEnd = text.indexOf(">", tagStart + 1);
		if (tagEnd < 0) return "";
		const tagName = normalizeSimpleProtocolTag(text.slice(tagStart + 1, tagEnd));
		const normalizedTagName = tagName.toLowerCase();
		if (
			normalizedTagName
			&& normalizedTagName !== CANVAS_PLAN_TAG_NAME.toLowerCase()
			&& normalizedTagName.endsWith("canvas_plan")
		) {
			return tagName;
		}
		cursor = tagEnd + 1;
	}
	return "";
}

function collectCanvasPlanNodeKinds(plan: ChatCanvasPlan): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const node of plan.nodes) {
		const kind = typeof node.kind === "string" ? node.kind.trim() : "";
		if (!kind || seen.has(kind)) continue;
		seen.add(kind);
		out.push(kind);
	}
	return out;
}

const GENERATED_ASSET_URL_KEYS = new Set([
	"url",
	"imageUrl",
	"videoUrl",
	"audioUrl",
	"thumbnailUrl",
	"assetUrl",
]);

const GENERATED_ASSET_RESULT_KEYS = new Set([
	"imageResults",
	"videoResults",
	"audioResults",
	"results",
	"assets",
	"outputs",
]);

function isHttpAssetUrl(value: string): boolean {
	try {
		const parsed = new URL(value);
		return (parsed.protocol === "http:" || parsed.protocol === "https:") && Boolean(parsed.hostname);
	} catch {
		return false;
	}
}

function valueHasGeneratedAssetUrl(value: unknown, currentKey = ""): boolean {
	if (typeof value === "string") {
		return GENERATED_ASSET_URL_KEYS.has(currentKey) && isHttpAssetUrl(value.trim());
	}
	if (Array.isArray(value)) {
		return value.some((item) => valueHasGeneratedAssetUrl(item, currentKey));
	}
	if (!value || typeof value !== "object") return false;
	return Object.entries(value).some(([key, entryValue]) => {
		if (typeof entryValue === "string") {
			return GENERATED_ASSET_URL_KEYS.has(key) && isHttpAssetUrl(entryValue.trim());
		}
		if (GENERATED_ASSET_RESULT_KEYS.has(key)) {
			return valueHasGeneratedAssetUrl(entryValue, "url");
		}
		return valueHasGeneratedAssetUrl(entryValue, key);
	});
}

function nodeConfigHasGeneratedAssetUrl(node: ChatCanvasPlan["nodes"][number]): boolean {
	const config = node.config ?? {};
	if (valueHasGeneratedAssetUrl(config)) return true;
	if (!config || typeof config !== "object") return false;
	const record = config as Record<string, unknown>;
	const kind = typeof node.kind === "string" ? node.kind.trim() : "";
	const directUrlKey =
		kind === "composeVideo" || kind === "video"
			? "videoUrl"
			: kind === "audio"
				? "audioUrl"
				: "imageUrl";
	const directUrlRaw = typeof record[directUrlKey] === "string" ? record[directUrlKey].trim() : "";
	if (!isHttpAssetUrl(directUrlRaw)) return false;
	const sourceUrl = typeof record.sourceUrl === "string" ? record.sourceUrl.trim() : "";
	if (sourceUrl && sourceUrl === directUrlRaw) return false;
	const referenceImages = Array.isArray(record.referenceImages)
		? record.referenceImages
				.map((item) => (typeof item === "string" ? item.trim() : ""))
				.filter(Boolean)
		: [];
	if (referenceImages.includes(directUrlRaw)) return false;
	const status = typeof record.status === "string" ? record.status.trim().toLowerCase() : "";
	return status === "success";
}

function buildCanvasPlanDiagnostics(text: string): CanvasPlanDiagnostics {
	const rawPayload = extractCanvasPlanPayload(text);
	const detectedTagName = rawPayload ? CANVAS_PLAN_TAG_NAME : detectCanvasPlanTagName(text);
	if (!rawPayload) {
		const errorCode = detectedTagName ? "invalid_canvas_plan_tag_name" : "";
		const errorDetail = detectedTagName
			? `unexpected tag <${detectedTagName}>; expected <${CANVAS_PLAN_TAG_NAME}>`
			: "";
		return {
			tagPresent: false,
			normalized: false,
			parseSuccess: false,
			error: errorCode,
			errorCode,
			errorDetail,
			schemaIssues: [],
			detectedTagName,
			nodeCount: 0,
			edgeCount: 0,
			nodeKinds: [],
			hasAssetUrls: false,
			action: "",
			summary: "",
			reason: "",
			rawPayload: "",
		};
	}
	const parsedJsonResult = (() => {
		try {
			return { ok: true as const, value: JSON.parse(rawPayload) as unknown, errorDetail: "" };
		} catch (error) {
			return {
				ok: false as const,
				value: null,
				errorDetail: (error as Error).message || "unknown_json_parse_error",
			};
		}
	})();
	const parsedJson = parsedJsonResult.ok ? parsedJsonResult.value : null;
	const parsedPlan = canvasPlanSchema.safeParse(parsedJson);
	const plan = parsedPlan.success ? parsedPlan.data : null;
	const schemaIssues = parsedPlan.success
		? []
		: parsedPlan.error.issues.map((issue) => {
				const pathLabel = issue.path.length > 0 ? issue.path.join(".") : "<root>";
				return `${pathLabel}: ${issue.message}`;
			});
	const nodeKinds = plan ? collectCanvasPlanNodeKinds(plan) : [];
	const hasAssetUrls = plan ? plan.nodes.some((node) => nodeConfigHasGeneratedAssetUrl(node)) : false;
	const errorCode = !rawPayload
		? ""
		: !parsedJsonResult.ok
			? "invalid_canvas_plan_json"
			: parsedPlan.success
				? ""
				: "invalid_canvas_plan_schema";
	const errorDetail = !rawPayload
		? ""
		: !parsedJsonResult.ok
			? parsedJsonResult.errorDetail
			: parsedPlan.success
				? ""
				: schemaIssues.join("; ");
	return {
		tagPresent: Boolean(rawPayload),
		normalized: false,
		parseSuccess: parsedPlan.success,
		error: errorCode,
		errorCode,
		errorDetail,
		schemaIssues,
		detectedTagName,
		nodeCount: plan ? plan.nodes.length : 0,
		edgeCount: plan && Array.isArray(plan.edges) ? plan.edges.length : 0,
		nodeKinds,
		hasAssetUrls,
		action: plan?.action ?? "",
		summary: plan?.summary ?? "",
		reason: plan?.reason ?? "",
		rawPayload,
	};
}

function summarizeBridgeToolEvidence(toolCalls: BridgeToolCall[]): BridgeToolEvidence {
	const names = toolCalls
		.map(resolveBridgeLogicalToolName)
		.filter(Boolean);
	const uniqueNames = Array.from(new Set(names));
	const hasSuccessfulTool = (name: string): boolean =>
		toolCalls.some((call) => resolveBridgeLogicalToolName(call) === name && call.status === "succeeded");
	const readProjectState =
		hasSuccessfulTool("tapcanvas_project_flows_list") ||
		hasSuccessfulTool("tapcanvas_project_context_get") ||
		hasSuccessfulTool("tapcanvas_project_chapters_list") ||
		hasSuccessfulTool("tapcanvas_project_chapter_get") ||
		hasSuccessfulTool("tapcanvas_canvas_workflow_analyze") ||
		hasSuccessfulTool("tapcanvas_flow_get") ||
		hasSuccessfulTool("tapcanvas_flow_patch");
	const readBookList = hasSuccessfulTool("tapcanvas_books_list");
	const readBookIndex = hasSuccessfulTool("tapcanvas_book_index_get");
	const readChapter =
		hasSuccessfulTool("tapcanvas_book_chapter_get") ||
		hasSuccessfulTool("tapcanvas_project_chapter_get");
	const readStoryboardPlan = hasSuccessfulTool("tapcanvas_book_storyboard_plan_get");
	const readStoryboardContinuity = hasSuccessfulTool("tapcanvas_storyboard_continuity_get");
	const readStoryboardSourceBundle = hasSuccessfulTool("tapcanvas_storyboard_source_bundle_get");
	const readNodeContextBundle = hasSuccessfulTool("tapcanvas_node_context_bundle_get");
	const readVideoReviewBundle = hasSuccessfulTool("tapcanvas_video_review_bundle_get");
	const readMaterialAssets =
		hasSuccessfulTool("tapcanvas_material_assets_list") ||
		hasSuccessfulTool("tapcanvas_material_asset_versions") ||
		hasSuccessfulTool("tapcanvas_material_impacted_shots");
	const generatedAssets =
		hasSuccessfulTool("tapcanvas_draw") ||
		hasSuccessfulTool("tapcanvas_draw_batch") ||
		hasSuccessfulTool("tapcanvas_video") ||
		hasSuccessfulTool("tapcanvas_run_task") ||
		hasSuccessfulTool("tapcanvas_task_result") ||
		hasSuccessfulTool("tapcanvas_image_generate_to_canvas") ||
		hasSuccessfulTool("tapcanvas_video_generate_to_canvas");
	const wroteCanvas =
		hasSuccessfulTool("tapcanvas_flow_patch") ||
		hasSuccessfulTool("tapcanvas_image_generate_to_canvas") ||
		hasSuccessfulTool("tapcanvas_video_generate_to_canvas");
	return {
		toolNames: uniqueNames,
		readProjectState,
		readBookList,
		readBookIndex,
		readChapter,
		readStoryboardPlan,
		readStoryboardContinuity,
		readStoryboardSourceBundle,
		readNodeContextBundle,
		readVideoReviewBundle,
		readMaterialAssets,
		generatedAssets,
		wroteCanvas,
	};
}

function normalizeBridgeToolCalls(toolCalls: Array<Record<string, unknown>>): BridgeToolCall[] {
	return toolCalls.map((call) => {
		const toolCallId = typeof call.toolCallId === "string" ? call.toolCallId.trim() : "";
		const seq = typeof call.seq === "number" && Number.isFinite(call.seq) ? Math.max(0, Math.trunc(call.seq)) : null;
		const atMs = typeof call.atMs === "number" && Number.isFinite(call.atMs) ? Math.max(0, Math.trunc(call.atMs)) : null;
		const logicalToolName = typeof call.logicalToolName === "string" ? call.logicalToolName.trim() : "";
		const name = typeof call.name === "string" ? call.name.trim() : "";
		const status = typeof call.status === "string" ? call.status.trim() : "";
		const severity = typeof call.severity === "string" ? call.severity.trim().toLowerCase() : "";
		const pathHint = typeof call.pathHint === "string" ? call.pathHint.trim() : "";
		const errorMessage =
			typeof call.errorMessage === "string"
				? call.errorMessage.trim()
				: typeof call.outputPreview === "string"
					? call.outputPreview.trim()
					: "";
		const outputPreview = typeof call.outputPreview === "string" ? call.outputPreview.trim() : "";
		const outputChars =
			typeof call.outputChars === "number" && Number.isFinite(call.outputChars)
				? Math.max(0, Math.trunc(call.outputChars))
				: null;
		const outputHead = typeof call.outputHead === "string" ? call.outputHead.trim() : "";
		const outputTail = typeof call.outputTail === "string" ? call.outputTail.trim() : "";
		const outputJson =
			call.outputJson && typeof call.outputJson === "object" && !Array.isArray(call.outputJson)
				? (call.outputJson as Record<string, unknown>)
				: null;
		const inputJson =
			call.input && typeof call.input === "object" && !Array.isArray(call.input)
				? (call.input as Record<string, unknown>)
				: null;
		const requestedAgentType =
			typeof inputJson?.agent_type === "string"
				? String(inputJson.agent_type).trim()
				: "";
		const startedAt = typeof call.startedAt === "string" ? call.startedAt.trim() : "";
		const finishedAt = typeof call.finishedAt === "string" ? call.finishedAt.trim() : "";
		const durationMs = typeof call.durationMs === "number" && Number.isFinite(call.durationMs)
			? Math.max(0, Math.trunc(call.durationMs))
			: null;
		return {
			toolCallId,
			seq,
			atMs,
			logicalToolName,
			name,
			status:
				status === "succeeded" || status === "failed" || status === "denied" || status === "blocked"
					? status
					: "",
			severity: severity === "warning" || severity === "error" ? severity : "",
			pathHint,
			errorMessage,
			outputPreview,
			outputChars,
			outputHead,
			outputTail,
			outputJson,
			inputJson,
			requestedAgentType,
			startedAt,
			finishedAt,
			durationMs,
		};
	});
}

function readReceiptRecord(output: Record<string, unknown> | null): Record<string, unknown> | null {
	if (!output) return null;
	const data = isRecord(output.data) ? output.data : null;
	return data ?? output;
}

function readReceiptString(
	primary: Record<string, unknown> | null,
	fallback: Record<string, unknown> | null,
	key: string,
): string | null {
	const first = typeof primary?.[key] === "string" ? String(primary[key]).trim() : "";
	if (first) return first;
	const second = typeof fallback?.[key] === "string" ? String(fallback[key]).trim() : "";
	return second || null;
}

/**
 * Projects only stable protocol receipts into physical-run continuation state.
 * Prompt text and creative payloads are deliberately excluded: the next
 * process receives task identity/fencing facts without replaying large tool
 * arguments or being allowed to invent a new run id.
 */
export function collectDurableTaskReferences(
	toolCalls: BridgeToolCall[],
): DurableTaskReferenceV1[] {
	const references: DurableTaskReferenceV1[] = [];
	const seen = new Set<string>();
	for (const call of toolCalls) {
		const knownCallStatus =
			call.status === "succeeded" ||
			call.status === "failed" ||
			call.status === "blocked" ||
			call.status === "denied";
		if (!knownCallStatus) continue;
		const output = readReceiptRecord(call.outputJson);
		const wrappedArgs = isRecord(call.inputJson?.args) ? call.inputJson.args : null;
		const input = wrappedArgs ?? call.inputJson;
		const runId = readReceiptString(output, input, "runId");
		const taskId = readReceiptString(output, input, "taskId");
		const draftRevision = readReceiptString(output, input, "draftRevision");
		const beatRevision = readReceiptString(output, input, "beatRevision");
		const preflightRevision = readReceiptString(output, input, "preflightRevision");
		const preflightFingerprint = readReceiptString(output, input, "preflightFingerprint");
		const progressCursor =
			parseDurableProgressCursor(output?.progressCursor) ??
			parseDurableProgressCursor(call.outputJson?.progressCursor);
		const rejected =
			call.status !== "succeeded" ||
			call.outputJson?.ok === false ||
			call.outputJson?.success === false ||
			output?.ok === false ||
			output?.success === false;
		// A deterministic rejection can carry a server-authored repair frontier.
		// Preserve that cursor as scheduling evidence without turning the failed
		// action into success. Ordinary failures remain excluded.
		if (rejected && !progressCursor) continue;
		if (!runId && !taskId && !progressCursor) continue;
		if (
			!draftRevision && !beatRevision && !preflightRevision && !preflightFingerprint &&
			output?.acceptedAsync !== true && !progressCursor
		) continue;
		const mode = readReceiptString(output, input, "mode");
		const clipIndexRaw = output?.clipIndex ?? input?.clipIndex;
		const clipIndex = typeof clipIndexRaw === "number" && Number.isInteger(clipIndexRaw) && clipIndexRaw >= 0
			? clipIndexRaw
			: null;
		const toolName = resolveBridgeLogicalToolName(call);
		const reference: DurableTaskReferenceV1 = {
			version: 1,
			toolName,
			mode,
			runId,
			taskId,
			draftRevision,
			beatRevision,
			preflightRevision,
			preflightFingerprint,
			clipIndex,
			...(progressCursor ? { progressCursor } : {}),
			acceptedAsync: output?.acceptedAsync === true,
		};
		const identity = JSON.stringify(reference);
		if (seen.has(identity)) continue;
		seen.add(identity);
		references.push(reference);
	}
	return references.slice(-32);
}

/**
 * Preserve the latest unresolved deterministic action failure per declared
 * tool operation. A physical-run continuation can then repair the exact
 * protocol boundary instead of rediscovering schemas and source material.
 * Only structured tool fields participate; prompt text and creative content
 * are never inspected.
 */
export function collectDurableActionRecoveryFacts(
	toolCalls: BridgeToolCall[],
): DurableActionRecoveryFactV1[] {
	const factsByOperation = new Map<string, DurableActionRecoveryFactV1>();
	for (const call of toolCalls) {
		const output = readReceiptRecord(call.outputJson);
		const wrappedArgs = isRecord(call.inputJson?.args) ? call.inputJson.args : null;
		const input = wrappedArgs ?? call.inputJson;
		const toolName = resolveBridgeLogicalToolName(call);
		const mode = readReceiptString(output, input, "mode");
		const operationKey = `${toolName}\u0000${mode ?? "default"}`;
		const outputRejected = output?.ok === false || output?.success === false;
		const failed = call.status === "failed" || call.status === "blocked" || call.status === "denied" || outputRejected;
		if (!failed) {
			factsByOperation.delete(operationKey);
			continue;
		}
		const rawMessage = readReceiptString(output, null, "message") ?? call.errorMessage ?? call.outputPreview;
		const message = rawMessage.trim().slice(0, 2_000);
		if (!message) continue;
		const code = readReceiptString(output, null, "code");
		const details = isRecord(output?.details) ? output.details : null;
		const serializedRetryInput = details?.retryableInCurrentAgentChain === true && isRecord(input)
			? JSON.stringify(input)
			: "";
		const retryInput = serializedRetryInput.length > 0 && serializedRetryInput.length <= 512_000
			? JSON.parse(serializedRetryInput) as Record<string, unknown>
			: null;
		factsByOperation.set(operationKey, {
			version: 1,
			toolName,
			mode,
			status: call.status === "blocked"
				? "blocked"
				: call.status === "denied"
					? "denied"
					: call.status === "failed" && call.severity !== "warning"
						? "failed"
						: "warning",
			code,
			message,
			runId: readReceiptString(output, input, "runId"),
			draftRevision: readReceiptString(output, input, "draftRevision"),
			...(retryInput ? { retryInput } : {}),
		});
	}
	return [...factsByOperation.values()].slice(-16);
}

function readCanonicalBridgeToolOutputJson(toolCall: BridgeToolCall): Record<string, unknown> | null {
	if (toolCall.outputJson) return toolCall.outputJson;
	// outputPreview is a log surface only; completion / verdict authority must never
	// infer structured tool facts from preview text.
	return null;
}

function isTeamCoordinationBlockedToolCall(toolCall: BridgeToolCall): boolean {
	if (toolCall.status !== "blocked") return false;
	const output = readCanonicalBridgeToolOutputJson(toolCall);
	const code = typeof output?.code === "string" ? output.code.trim() : "";
	return TEAM_COORDINATION_BLOCKED_CODES.has(code);
}

function isExecutionPlanningBlockedToolCall(toolCall: BridgeToolCall): boolean {
	if (toolCall.status !== "blocked") return false;
	const output = readCanonicalBridgeToolOutputJson(toolCall);
	const code = typeof output?.code === "string" ? output.code.trim() : "";
	return EXECUTION_PLANNING_BLOCKED_CODES.has(code);
}

function resolveBridgeLogicalToolName(toolCall: BridgeToolCall): string {
	return toolCall.logicalToolName || toolCall.name;
}

function isExplicitlyRetryableFailedToolCall(toolCall: BridgeToolCall): boolean {
	if (toolCall.status !== "failed") return false;
	const output = readCanonicalBridgeToolOutputJson(toolCall);
	return output?.terminal === false || output?.retryable === true;
}

function isRecoveredByLaterSuccessfulRetry(
	toolCalls: BridgeToolCall[],
	issueIndex: number,
): boolean {
	const issue = toolCalls[issueIndex];
	if (!issue) return false;
	const retryableAttempt =
		issue.status === "blocked" || isExplicitlyRetryableFailedToolCall(issue);
	if (!retryableAttempt) return false;
	const logicalName = resolveBridgeLogicalToolName(issue);
	if (!logicalName) return false;
	return toolCalls.slice(issueIndex + 1).some(
		(toolCall) =>
			toolCall.status === "succeeded" &&
			resolveBridgeLogicalToolName(toolCall) === logicalName,
	);
}

export function summarizeBridgeToolExecutionIssues(input: {
	toolCalls: BridgeToolCall[];
	toolStatusSummary: ToolStatusSummary;
	deliveryVerification: PublicChatDeliveryVerificationSummary | null;
	deliveryEvidence: PublicChatDeliveryEvidence;
}): ToolExecutionIssueSummary {
	const failedToolCalls =
		typeof input.toolStatusSummary.failedToolCalls === "number" ? input.toolStatusSummary.failedToolCalls : 0;
	const warningToolCalls =
		typeof input.toolStatusSummary.warningToolCalls === "number" ? input.toolStatusSummary.warningToolCalls : 0;
	const effectiveFailedToolCalls = Math.max(failedToolCalls - warningToolCalls, 0);
	const deniedToolCalls =
		typeof input.toolStatusSummary.deniedToolCalls === "number" ? input.toolStatusSummary.deniedToolCalls : 0;
	const observedBlockedToolCalls = input.toolCalls.filter((toolCall) => toolCall.status === "blocked");
	const blockedToolCalls =
		typeof input.toolStatusSummary.blockedToolCalls === "number"
			? input.toolStatusSummary.blockedToolCalls
			: observedBlockedToolCalls.length;
	const coordinationBlockedToolCalls = observedBlockedToolCalls.filter(
		(toolCall) =>
			isTeamCoordinationBlockedToolCall(toolCall) ||
			isExecutionPlanningBlockedToolCall(toolCall),
	).length;
	const actionableBlockedToolCalls = Math.max(
		blockedToolCalls - coordinationBlockedToolCalls,
		observedBlockedToolCalls.length - coordinationBlockedToolCalls,
		0,
	);
	const observedFailedToolCalls = input.toolCalls.filter(
		(toolCall) => toolCall.status === "failed" && toolCall.severity !== "warning",
	).length;
	const observedWarningToolCalls = input.toolCalls.filter(
		(toolCall) => toolCall.severity === "warning",
	).length;
	const observedDeniedToolCalls = input.toolCalls.filter(
		(toolCall) => toolCall.status === "denied",
	).length;
	const observedActionableBlockedToolCalls = observedBlockedToolCalls.length - coordinationBlockedToolCalls;
	const actionableIssueIndexes = input.toolCalls.flatMap((toolCall, index) => {
		if (toolCall.severity === "warning") return [];
		if (toolCall.status === "failed" || toolCall.status === "denied") return [index];
		if (
			toolCall.status === "blocked" &&
			!isTeamCoordinationBlockedToolCall(toolCall) &&
			!isExecutionPlanningBlockedToolCall(toolCall)
		) {
			return [index];
		}
		return [];
	});
	const retryRecoveredToolCalls = actionableIssueIndexes.filter((index) =>
		isRecoveredByLaterSuccessfulRetry(input.toolCalls, index),
	).length;
	const unobservedIssueCount =
		Math.max(effectiveFailedToolCalls - observedFailedToolCalls, 0) +
		Math.max(deniedToolCalls - observedDeniedToolCalls, 0) +
		Math.max(actionableBlockedToolCalls - observedActionableBlockedToolCalls, 0);
	const unresolvedToolCalls = Math.max(
		actionableIssueIndexes.length - retryRecoveredToolCalls + unobservedIssueCount,
		0,
	);
	const hasHistoricalExecutionIssues =
		effectiveFailedToolCalls > 0 || deniedToolCalls > 0 || actionableBlockedToolCalls > 0;
	const recoveredBySuccessfulRetry =
		hasHistoricalExecutionIssues &&
		retryRecoveredToolCalls > 0 &&
		unresolvedToolCalls === 0;
	// 只有可复核的交付验收已满足，且存在真实资产/画布写入/异步提交事实时，才可认定早期
	// 工具问题已经在本回合被后续动作纠正。子代理 completed、普通文本或单次 wait 均不构成恢复证据。
	const recoveredByDeliveryEvidence =
		hasHistoricalExecutionIssues &&
		input.deliveryVerification?.status === "satisfied" &&
		(input.deliveryEvidence.items.length > 0 ||
			input.deliveryEvidence.artifacts.length > 0 ||
			input.deliveryEvidence.assetCount > 0 ||
			input.deliveryEvidence.wroteCanvas ||
			input.deliveryEvidence.generatedAssets);
	return {
		failedToolCalls: effectiveFailedToolCalls,
		warningToolCalls: Math.max(warningToolCalls, observedWarningToolCalls),
		deniedToolCalls,
		blockedToolCalls,
		coordinationBlockedToolCalls,
		actionableBlockedToolCalls,
		retryRecoveredToolCalls,
		unresolvedToolCalls,
		recoveredBySuccessfulRetry,
		recoveredByDeliveryEvidence,
		hasHistoricalExecutionIssues,
		hasExecutionIssues:
			hasHistoricalExecutionIssues &&
			unresolvedToolCalls > 0 &&
			!recoveredByDeliveryEvidence,
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readRequiredProtocolString(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function normalizeAgentsPhysicalRunExitV1(value: unknown): AgentsPhysicalRunExitV1 | null {
	if (!isRecord(value) || value.version !== 1) return null;
	const kind = value.kind;
	const logicalTaskId = readRequiredProtocolString(value.logicalTaskId);
	const taskNodeId = readRequiredProtocolString(value.taskNodeId);
	const reasonCode = readRequiredProtocolString(value.reasonCode);
	const exitedAt = readRequiredProtocolString(value.exitedAt);
	const taskRevision = typeof value.taskRevision === "number" && Number.isInteger(value.taskRevision) && value.taskRevision >= 0
		? value.taskRevision
		: null;
	if (!logicalTaskId || !taskNodeId || !reasonCode || !exitedAt || taskRevision === null) return null;
	if (
		kind !== "logical_terminal" &&
		kind !== "needs_input" &&
		kind !== "waiting_external" &&
		kind !== "handoff" &&
		kind !== "replan"
	) return null;
	const taskStatus = value.taskStatus;
	const statusMatchesKind =
		(kind === "logical_terminal" && (taskStatus === "satisfied" || taskStatus === "failed" || taskStatus === "canceled")) ||
		(kind === "needs_input" && taskStatus === "needs_input") ||
		(kind === "waiting_external" && taskStatus === "waiting_for_evidence") ||
		(kind === "handoff" && taskStatus === "repair_required") ||
		(kind === "replan" && taskStatus === "replan_required");
	if (!statusMatchesKind) return null;

	let continuationTicket: AgentsContinuationTicketV1 | null = null;
	if (kind === "waiting_external" || kind === "handoff" || kind === "replan") {
		const ticket = isRecord(value.continuationTicket) ? value.continuationTicket : null;
		const ticketId = readRequiredProtocolString(ticket?.ticketId);
		const issuedAt = readRequiredProtocolString(ticket?.issuedAt);
		if (
			ticket?.version !== 1 ||
			!ticketId ||
			!issuedAt ||
			ticket.logicalTaskId !== logicalTaskId ||
			ticket.taskNodeId !== taskNodeId ||
			ticket.taskRevision !== taskRevision ||
			ticket.reasonCode !== reasonCode
		) return null;
		const resumeFromStatus = ticket.resumeFromStatus;
		const nextTrigger = ticket.nextTrigger;
		if (
			(kind === "handoff" && (resumeFromStatus !== "repair_required" || nextTrigger !== "durable_resume")) ||
			(kind === "replan" && (resumeFromStatus !== "replan_required" || nextTrigger !== "durable_resume")) ||
			(kind === "waiting_external" && (resumeFromStatus !== "waiting_for_evidence" || nextTrigger !== "external_evidence"))
		) return null;
		continuationTicket = {
			version: 1,
			ticketId,
			logicalTaskId,
			taskNodeId,
			taskRevision,
			resumeFromStatus: kind === "handoff"
				? "repair_required"
				: kind === "replan"
					? "replan_required"
					: "waiting_for_evidence",
			nextTrigger: kind === "waiting_external" ? "external_evidence" : "durable_resume",
			reasonCode,
			issuedAt,
		};
	} else if (value.continuationTicket !== null) {
		return null;
	}
	const base = {
		version: 1,
		logicalTaskId,
		taskNodeId,
		taskRevision,
		reasonCode,
		exitedAt,
	} as const;
	if (kind === "logical_terminal") {
		if (taskStatus !== "satisfied" && taskStatus !== "failed" && taskStatus !== "canceled") return null;
		return { ...base, kind, taskStatus, continuationTicket: null };
	}
	if (kind === "needs_input") {
		if (taskStatus !== "needs_input") return null;
		return { ...base, kind, taskStatus, continuationTicket: null };
	}
	if (!continuationTicket) return null;
	if (kind === "waiting_external") {
		if (taskStatus !== "waiting_for_evidence") return null;
		return { ...base, kind, taskStatus, continuationTicket };
	}
	if (kind === "handoff") {
		if (taskStatus !== "repair_required") return null;
		return { ...base, kind, taskStatus, continuationTicket };
	}
	if (taskStatus !== "replan_required") return null;
	return { ...base, kind: "replan", taskStatus, continuationTicket };
}

export function normalizeAgentsBridgeAdmissionReceiptV1(value: unknown): AgentsBridgeAdmissionReceiptV1 | null {
	if (!isRecord(value) || value.version !== 1) return null;
	const acceptance = value.acceptance === "accepted" || value.acceptance === "unknown"
		? value.acceptance
		: null;
	const publicTurnId = readRequiredProtocolString(value.publicTurnId);
	const sessionId = readRequiredProtocolString(value.sessionId);
	const reconciledAt = readRequiredProtocolString(value.reconciledAt);
	const turnState = value.turnState === null
		? null
		: readRequiredProtocolString(value.turnState);
	const activeTurn = typeof value.activeTurn === "boolean" ? value.activeTurn : null;
	if (!acceptance || !publicTurnId || !sessionId || !reconciledAt) return null;
	if (acceptance === "accepted" && (!turnState || activeTurn === null)) return null;
	return {
		version: 1,
		acceptance,
		publicTurnId,
		sessionId,
		turnState,
		activeTurn,
		reconciledAt,
	};
}

export function normalizeAgentsRuntimeTraceSummary(value: unknown): AgentsRuntimeTraceSummary | null {
	if (!isRecord(value)) return null;
	const profileRaw = typeof value.profile === "string" ? value.profile.trim() : "";
	const profile =
		profileRaw === "general" || profileRaw === "code" ? profileRaw : "unknown";
	const terminalAuthority = value.terminalAuthority === "user_delivery" || value.terminalAuthority === "workflow_action"
		? value.terminalAuthority
		: null;
	const executionProvenance = parseAgentExecutionProvenance(value.executionProvenance);
	const promptExampleSearchRecord = isRecord(value.promptExampleCandidateSearch)
		? value.promptExampleCandidateSearch
		: null;
	const promptExampleSearchStatus = typeof promptExampleSearchRecord?.status === "string"
		&& new Set([
			"not_attempted",
			"candidate_found",
			"no_match",
			"retrieval_failed",
			"invalid_evidence",
			"tool_unavailable",
		]).has(promptExampleSearchRecord.status)
		? promptExampleSearchRecord.status as NonNullable<AgentsRuntimeTraceSummary["promptExampleCandidateSearch"]>["status"]
		: null;
	const promptExampleCandidateSearch = promptExampleSearchRecord?.version === 1
		&& promptExampleSearchStatus
		&& (promptExampleSearchRecord.mediaType === "image" || promptExampleSearchRecord.mediaType === "video")
		&& typeof promptExampleSearchRecord.attempted === "boolean"
		&& typeof promptExampleSearchRecord.remoteAttempted === "boolean"
		&& typeof promptExampleSearchRecord.candidateCount === "number"
		&& Number.isInteger(promptExampleSearchRecord.candidateCount)
		&& promptExampleSearchRecord.candidateCount >= 0
		&& promptExampleSearchRecord.blocking === false
		&& typeof promptExampleSearchRecord.rationale === "string"
		&& promptExampleSearchRecord.rationale.trim()
		? {
			version: 1 as const,
			status: promptExampleSearchStatus,
			mediaType: promptExampleSearchRecord.mediaType,
			attempted: promptExampleSearchRecord.attempted,
			remoteAttempted: promptExampleSearchRecord.remoteAttempted,
			candidateCount: promptExampleSearchRecord.candidateCount,
			blocking: false as const,
			rationale: promptExampleSearchRecord.rationale.trim(),
			...(typeof promptExampleSearchRecord.toolCallId === "string" && promptExampleSearchRecord.toolCallId.trim()
				? { toolCallId: promptExampleSearchRecord.toolCallId.trim() }
				: {}),
		}
		: null;
	const observability = normalizeAgentRuntimeObservability(value.observability);
	const performanceSnapshot = normalizeAgentPerformanceSnapshot(value.performanceSnapshot);
	const physicalRunExit = normalizeAgentsPhysicalRunExitV1(value.physicalRunExit);
	const terminalDelivery = normalizePublicChatDurableTerminalDelivery(value.terminalDelivery);
	const admissionReceipt = normalizeAgentsBridgeAdmissionReceiptV1(value.admissionReceipt);
	const userIntentContract = isRecord(value.userIntentContract)
		? value.userIntentContract
		: null;
	const retrievalCandidateSets = Array.isArray(value.retrievalCandidateSets)
		? value.retrievalCandidateSets
			.filter((item): item is Record<string, unknown> => isRecord(item))
			.filter((item) => JSON.stringify(item).length <= 128_000)
			.slice(-8)
		: [];
	const inputProgressionGateRecord = isRecord(value.inputProgressionGate)
		? value.inputProgressionGate
		: null;
	const inputProgressionGateReasonCode =
		typeof inputProgressionGateRecord?.reasonCode === "string"
			? inputProgressionGateRecord.reasonCode.trim()
			: "";
	const inputProgressionGateReason =
		typeof inputProgressionGateRecord?.reason === "string"
			? inputProgressionGateRecord.reason.trim()
			: "";
	const inputProgressionGate =
		inputProgressionGateRecord?.status === "completed" &&
		inputProgressionGateRecord.model === "deepseek-v4-flash" &&
		(inputProgressionGateRecord.decision === "allow" ||
			inputProgressionGateRecord.decision === "deny") &&
		inputProgressionGateReasonCode &&
		inputProgressionGateReason
			? {
				status: "completed" as const,
				model: "deepseek-v4-flash" as const,
				decision:
					inputProgressionGateRecord.decision === "allow"
						? ("allow" as const)
						: ("deny" as const),
				reasonCode: inputProgressionGateReasonCode,
				reason: inputProgressionGateReason,
			}
			: null;
	const suspensionRecord = isRecord(value.suspension) ? value.suspension : null;
	const suspensionPhysicalRunId =
		typeof suspensionRecord?.physicalRunId === "string"
			? suspensionRecord.physicalRunId.trim()
			: "";
	const suspensionProgressRevision =
		typeof suspensionRecord?.progressRevision === "number" &&
		Number.isInteger(suspensionRecord.progressRevision) &&
		suspensionRecord.progressRevision >= 0
			? suspensionRecord.progressRevision
			: null;
	const suspensionReasonCode =
		typeof suspensionRecord?.reasonCode === "string"
			? suspensionRecord.reasonCode.trim()
			: "";
	const suspension =
		suspensionReasonCode &&
		suspensionPhysicalRunId &&
		suspensionProgressRevision !== null
			? {
				reasonCode: suspensionReasonCode,
				physicalRunId: suspensionPhysicalRunId,
				progressRevision: suspensionProgressRevision,
			}
			: null;
	return {
		profile,
		...(terminalAuthority ? { terminalAuthority } : {}),
		registeredToolNames: readTrimmedStringArray(value.registeredToolNames).slice(0, 256),
		registeredTeamToolNames: readTrimmedStringArray(value.registeredTeamToolNames).slice(0, 64),
		requiredSkills: readTrimmedStringArray(value.requiredSkills).slice(0, 32),
		loadedSkills: readTrimmedStringArray(value.loadedSkills).slice(0, 64),
		allowedSubagentTypes: readTrimmedStringArray(value.allowedSubagentTypes).slice(0, 16),
		requireAgentsTeamExecution: value.requireAgentsTeamExecution === true,
		...(inputProgressionGate ? { inputProgressionGate } : {}),
		...(physicalRunExit ? { physicalRunExit } : {}),
		...(terminalDelivery ? { terminalDelivery } : {}),
		...(admissionReceipt ? { admissionReceipt } : {}),
		...(executionProvenance ? { executionProvenance } : {}),
		...(promptExampleCandidateSearch ? { promptExampleCandidateSearch } : {}),
		...(userIntentContract ? { userIntentContract } : {}),
		...(retrievalCandidateSets.length > 0 ? { retrievalCandidateSets } : {}),
		...(suspension ? { suspension } : {}),
		...(observability ? { observability } : {}),
		...(performanceSnapshot ? { performanceSnapshot } : {}),
		...(isRecord(value.deliveryReport)
			? {
					deliveryReport: {
						required: value.deliveryReport.required === true,
						present: value.deliveryReport.present === true,
						satisfiedByAsyncSubmission:
							value.deliveryReport.satisfiedByAsyncSubmission === true,
						remoteActionCount:
							typeof value.deliveryReport.remoteActionCount === "number"
								? value.deliveryReport.remoteActionCount
								: 0,
						lastRemoteActionSeq:
							typeof value.deliveryReport.lastRemoteActionSeq === "number"
								? value.deliveryReport.lastRemoteActionSeq
								: null,
						lastReportSeq:
							typeof value.deliveryReport.lastReportSeq === "number"
								? value.deliveryReport.lastReportSeq
								: null,
					},
			  }
			: {}),
		...(isRecord(value.contextDiagnostics)
			? {
					contextDiagnostics: {
						totalChars:
							typeof value.contextDiagnostics.totalChars === "number"
								? value.contextDiagnostics.totalChars
								: 0,
						totalBudgetChars:
							typeof value.contextDiagnostics.totalBudgetChars === "number"
								? value.contextDiagnostics.totalBudgetChars
								: 0,
						sources: Array.isArray(value.contextDiagnostics.sources)
							? value.contextDiagnostics.sources
									.filter(isRecord)
									.map((item) => ({
										id: typeof item.id === "string" ? item.id : "",
										kind: typeof item.kind === "string" ? item.kind : "",
										summary: typeof item.summary === "string" ? item.summary : "",
										chars: typeof item.chars === "number" ? item.chars : 0,
										budgetChars: typeof item.budgetChars === "number" ? item.budgetChars : 0,
										truncated: item.truncated === true,
									}))
									.filter((item) => item.id && item.kind)
									.slice(0, 16)
							: [],
					},
			  }
			: {}),
		...(isRecord(value.capabilitySnapshot)
			? {
					capabilitySnapshot: {
						providers: Array.isArray(value.capabilitySnapshot.providers)
							? value.capabilitySnapshot.providers
									.filter(isRecord)
									.map((item) => ({
										kind: typeof item.kind === "string" ? item.kind : "",
										name: typeof item.name === "string" ? item.name : "",
										toolNames: readTrimmedStringArray(item.toolNames).slice(0, 128),
										toolCount: typeof item.toolCount === "number" ? item.toolCount : 0,
									}))
									.filter((item) => item.kind && item.name)
									.slice(0, 12)
							: [],
						exposedToolNames: readTrimmedStringArray(value.capabilitySnapshot.exposedToolNames).slice(0, 256),
						exposedTeamToolNames: readTrimmedStringArray(value.capabilitySnapshot.exposedTeamToolNames).slice(0, 64),
					},
			  }
			: {}),
		...(isRecord(value.policySummary)
			? {
					policySummary: {
						totalDecisions:
							typeof value.policySummary.totalDecisions === "number"
								? value.policySummary.totalDecisions
								: 0,
						allowCount:
							typeof value.policySummary.allowCount === "number"
								? value.policySummary.allowCount
								: 0,
						denyCount:
							typeof value.policySummary.denyCount === "number"
								? value.policySummary.denyCount
								: 0,
						requiresApprovalCount:
							typeof value.policySummary.requiresApprovalCount === "number"
								? value.policySummary.requiresApprovalCount
								: 0,
						uniqueDeniedSignatures: readTrimmedStringArray(
							value.policySummary.uniqueDeniedSignatures,
						).slice(0, 32),
					},
			  }
			: {}),
	};
}

function normalizeAgentsTodoListTraceSummary(value: unknown): AgentsTodoListTraceSummary | null {
	if (!isRecord(value)) return null;
	const sourceToolCallId =
		typeof value.sourceToolCallId === "string" ? value.sourceToolCallId.trim() : "";
	const rawItems = Array.isArray(value.items) ? value.items : [];
	const items: AgentsTodoListItemSummary[] = [];
	for (const entry of rawItems) {
		if (!isRecord(entry)) continue;
		const text = typeof entry.text === "string" ? entry.text.trim() : "";
		if (!text) continue;
		const statusRaw = typeof entry.status === "string" ? entry.status.trim() : "";
		const status: AgentsTodoListItemSummary["status"] =
			statusRaw === "completed" || statusRaw === "in_progress" || statusRaw === "pending"
				? statusRaw
				: entry.completed === true
					? "completed"
					: "pending";
		items.push({
			text,
			completed: status === "completed",
			status,
		});
		if (items.length >= 20) break;
	}
	if (!sourceToolCallId || items.length <= 0) return null;
	const completedCount = items.filter((item) => item.status === "completed").length;
	const inProgressCount = items.filter((item) => item.status === "in_progress").length;
	const pendingCount = Math.max(items.length - completedCount - inProgressCount, 0);
	return {
		sourceToolCallId,
		items,
		totalCount: items.length,
		completedCount,
		inProgressCount,
		pendingCount,
	};
}

function normalizeAgentsTodoEventTraceSummaries(value: unknown): AgentsTodoEventTraceSummary[] {
	if (!Array.isArray(value)) return [];
	const out: AgentsTodoEventTraceSummary[] = [];
	for (const entry of value) {
		const todoList = normalizeAgentsTodoListTraceSummary(entry);
		if (!todoList) continue;
		const atMs = isRecord(entry) && typeof entry.atMs === "number" && Number.isFinite(entry.atMs)
			? Math.max(0, Math.trunc(entry.atMs))
			: null;
		const startedAt =
			isRecord(entry) && typeof entry.startedAt === "string" && entry.startedAt.trim()
				? entry.startedAt.trim()
				: null;
		const finishedAt =
			isRecord(entry) && typeof entry.finishedAt === "string" && entry.finishedAt.trim()
				? entry.finishedAt.trim()
				: null;
		const durationMs =
			isRecord(entry) && typeof entry.durationMs === "number" && Number.isFinite(entry.durationMs)
				? Math.max(0, Math.trunc(entry.durationMs))
				: null;
		out.push({
			...todoList,
			atMs,
			startedAt,
			finishedAt,
			durationMs,
		});
		if (out.length >= 32) break;
	}
	return out;
}

function normalizeAgentsCompletionTraceSummary(value: unknown): AgentsCompletionTraceSummary | null {
	if (!isRecord(value) || value.version !== 1) return null;
	const sourceRaw = typeof value.source === "string" ? value.source.trim() : "";
	const terminalRaw = typeof value.terminal === "string" ? value.terminal.trim() : "";
	if (
		sourceRaw !== "runtime" &&
		sourceRaw !== "task_completion_priority" &&
		sourceRaw !== "terminal_delivery_verifier" &&
		sourceRaw !== "async_submission" &&
		sourceRaw !== "deterministic"
	) return null;
	if (terminalRaw !== "success" && terminalRaw !== "failure" && terminalRaw !== "suspended") {
		return null;
	}
	if (typeof value.allowFinish !== "boolean") return null;
	if (value.failureReason !== null && typeof value.failureReason !== "string") return null;
	if (typeof value.rationale !== "string" || !value.rationale.trim()) return null;
	const readContractStringArray = (input: unknown): string[] | null => {
		if (!Array.isArray(input)) return null;
		const out: string[] = [];
		for (const item of input) {
			if (typeof item !== "string" || !item.trim()) return null;
			out.push(item.trim());
		}
		return out;
	};
	const successCriteria = readContractStringArray(value.successCriteria);
	const missingCriteria = readContractStringArray(value.missingCriteria);
	const requiredActions = readContractStringArray(value.requiredActions);
	if (!successCriteria || !missingCriteria || !requiredActions) return null;
	const retryCount = value.retryCount;
	if (
		retryCount !== undefined &&
		(typeof retryCount !== "number" || !Number.isInteger(retryCount) || retryCount < 0)
	) return null;
	if (value.recoveredAfterRetry !== undefined && typeof value.recoveredAfterRetry !== "boolean") return null;
	return {
		version: 1,
		source: sourceRaw,
		terminal: terminalRaw,
		allowFinish: value.allowFinish,
		failureReason:
			typeof value.failureReason === "string" && value.failureReason.trim()
				? value.failureReason.trim()
				: null,
		rationale: value.rationale.trim(),
		successCriteria: successCriteria.slice(0, 16),
		missingCriteria: missingCriteria.slice(0, 16),
		requiredActions: requiredActions.slice(0, 16),
		...(typeof retryCount === "number" ? { retryCount } : {}),
		...(typeof value.recoveredAfterRetry === "boolean"
			? { recoveredAfterRetry: value.recoveredAfterRetry }
			: {}),
	};
}

function normalizeAgentsBridgeRunOutcome(value: unknown): AgentsBridgeRunOutcome | null {
	if (!isRecord(value) || value.version !== 1 || value.terminal !== true) return null;
	const status = value.status;
	if (
		status !== "succeeded" &&
		status !== "failed" &&
		status !== "needs_input" &&
		status !== "suspended"
	) return null;
	const reason = typeof value.reason === "string" ? value.reason.trim() : "";
	if (!reason) return null;
	return { version: 1, terminal: true, status, reason };
}

/**
 * PhysicalRunExitV1 is the TaskStore-backed authority. AgentRunOutcomeV1 is a
 * transport projection of that exit and must never be allowed to override it.
 */
export function projectAgentsBridgeRunOutcomeFromPhysicalExit(
	exit: AgentsPhysicalRunExitV1,
): AgentsBridgeRunOutcome {
	if (exit.kind === "logical_terminal") {
		return {
			version: 1,
			terminal: true,
			status: exit.taskStatus === "satisfied" ? "succeeded" : "failed",
			reason: exit.reasonCode,
		};
	}
	if (exit.kind === "needs_input") {
		return {
			version: 1,
			terminal: true,
			status: "needs_input",
			reason: exit.reasonCode,
		};
	}
	return {
		version: 1,
		terminal: true,
		status: "suspended",
		reason: exit.reasonCode,
	};
}

function normalizeAgentsPlanningTraceSummary(value: unknown): AgentsPlanningTraceSummary | null {
	if (!isRecord(value)) return null;
	const sourceRaw = typeof value.source === "string" ? value.source.trim() : "";
	const readCount = (input: unknown, fallback = 0): number => {
		const num = typeof input === "number" ? input : Number(input);
		if (!Number.isFinite(num)) return fallback;
		return Math.max(0, Math.trunc(num));
	};
	return {
		source:
			sourceRaw === "goal" || sourceRaw === "todo_list"
				? sourceRaw
				: "unknown",
		planningRequired: value.planningRequired === true,
		hasGoal: value.hasGoal === true,
		goalStatus:
			typeof value.goalStatus === "string" && value.goalStatus.trim()
				? value.goalStatus.trim()
				: null,
		goalObjective:
			typeof value.goalObjective === "string" && value.goalObjective.trim()
				? value.goalObjective.trim()
				: null,
		minimumStepCount: Math.max(2, readCount(value.minimumStepCount, 2)),
		hasChecklist: value.hasChecklist === true,
		latestStepCount: readCount(value.latestStepCount),
		maxObservedStepCount: readCount(value.maxObservedStepCount),
		completedCount: readCount(value.completedCount),
		inProgressCount: readCount(value.inProgressCount),
		pendingCount: readCount(value.pendingCount),
		meetsMinimumStepCount: value.meetsMinimumStepCount === true,
		checklistComplete: value.checklistComplete === true,
	};
}

function deriveAgentsPlanningTraceSummaryFromTodo(input: {
	todoList: AgentsTodoListTraceSummary | null;
	todoEvents: AgentsTodoEventTraceSummary[];
}): AgentsPlanningTraceSummary | null {
	const todoList = input.todoList;
	const maxObservedStepCount = input.todoEvents.reduce(
		(max, item) => Math.max(max, item.totalCount),
		0,
	);
	const latestStepCount = todoList?.totalCount ?? 0;
	const hasChecklist = latestStepCount > 0 || maxObservedStepCount > 0;
	if (!hasChecklist) return null;
	const completedCount = todoList?.completedCount ?? 0;
	const inProgressCount = todoList?.inProgressCount ?? 0;
	const pendingCount =
		todoList?.pendingCount ??
		Math.max(latestStepCount - completedCount - inProgressCount, 0);
	return {
		source: "todo_list",
		planningRequired: false,
		hasGoal: false,
		goalStatus: null,
		goalObjective: null,
		minimumStepCount: 2,
		hasChecklist: true,
		latestStepCount,
		maxObservedStepCount,
		completedCount,
		inProgressCount,
		pendingCount,
		meetsMinimumStepCount: Math.max(latestStepCount, maxObservedStepCount) >= 2,
		checklistComplete: pendingCount <= 0 && inProgressCount <= 0,
	};
}

function readTrimmedStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value
		.map((item) => String(item || "").trim())
		.filter(Boolean);
}

function normalizeAgentsSemanticTaskSummaryFromRecord(
	record: Record<string, unknown>,
): AgentsSemanticTaskSummary | null {
	const taskGoal = readTrimmedString(record.taskGoal);
	const requestedOutput = readTrimmedString(record.requestedOutput);
	const taskKind = readTrimmedString(record.taskKind);
	const recommendedNextStage = readTrimmedString(record.recommendedNextStage);
	const blockingGaps = readTrimmedStringArray(record.blockingGaps).slice(0, 16);
	const successCriteria = readTrimmedStringArray(record.successCriteria).slice(0, 32);
	const hasTaskInterrogationShape =
		Boolean(taskGoal) &&
		Boolean(requestedOutput) &&
		Boolean(taskKind) &&
		Boolean(recommendedNextStage) &&
		Array.isArray(record.blockingGaps) &&
		Array.isArray(record.successCriteria) &&
		"mustStop" in record &&
		typeof record.requiresExecutionDelivery === "boolean";
	if (!hasTaskInterrogationShape) return null;
	const normalizedDeliveryContract = normalizePublicChatSemanticDeliveryContract(
		record.deliveryContract,
	);
	const normalizedDeliveryEvidence = record.deliveryEvidence === undefined
		? null
		: normalizePublicChatDeliveryEvidence(record.deliveryEvidence);
	const normalizedDeliveryVerification = record.deliveryVerification === undefined
		? null
		: normalizePublicChatDeliveryVerification(record.deliveryVerification);
	if (
		"deliveryContract" in record &&
		record.deliveryContract !== undefined &&
		record.deliveryContract !== null &&
		!normalizedDeliveryContract
	) {
		return null;
	}
	if (
		(record.deliveryEvidence !== undefined || record.deliveryVerification !== undefined) &&
		(!normalizedDeliveryEvidence || !normalizedDeliveryVerification)
	) {
		return null;
	}
	if (
		normalizedDeliveryVerification &&
		normalizedDeliveryEvidence &&
		!normalizedDeliveryVerification.criteria.every((criterion) =>
			criterion.evidenceIds.every((evidenceId) =>
				normalizedDeliveryEvidence.some((evidence) => evidence.evidenceId === evidenceId),
			),
		)
	) {
		return null;
	}
	return {
		taskGoal,
		requestedOutput,
		taskKind,
		recommendedNextStage,
		mustStop: record.mustStop === true,
		requiresExecutionDelivery: record.requiresExecutionDelivery === true,
		blockingGaps,
		successCriteria,
		...(normalizedDeliveryContract
			? {
					deliveryContract: normalizedDeliveryContract,
			  }
			: {}),
		...(normalizedDeliveryEvidence ? { deliveryEvidence: normalizedDeliveryEvidence } : {}),
		...(normalizedDeliveryVerification
			? { deliveryVerification: normalizedDeliveryVerification }
			: {}),
	};
}

export function normalizeAgentsSemanticTaskSummaryFromToolCalls(
	toolCalls: BridgeToolCall[],
): AgentsSemanticTaskSummary | null {
	for (let index = toolCalls.length - 1; index >= 0; index -= 1) {
		const toolCall = toolCalls[index];
		if (toolCall.status !== "succeeded") continue;
		const parsed = readCanonicalBridgeToolOutputJson(toolCall);
		if (!parsed) continue;
		const direct = normalizeAgentsSemanticTaskSummaryFromRecord(parsed);
		if (toolCall.name === "report_delivery") {
			// The latest successful report is authoritative. A malformed latest
			// contract must fail visibly; falling through to an older valid report
			// would silently restore superseded delivery semantics.
			return direct;
		}
		if (direct) return direct;
		const nestedCandidates = [
			asRecord(parsed.result),
			asRecord(parsed.output),
			asRecord(parsed.summary),
			asRecord(parsed.semanticTask),
			asRecord(parsed.semantic_summary),
			asRecord(parsed.taskSummary),
			asRecord(parsed.task_summary),
		].filter((item): item is Record<string, unknown> => Boolean(item));
		for (const candidate of nestedCandidates) {
			const normalized = normalizeAgentsSemanticTaskSummaryFromRecord(candidate);
			if (normalized) return normalized;
		}
	}
	return null;
}

/**
 * Projects the root agent's already-frozen UserIntentContract into the generic
 * delivery verifier contract. This performs structural copying only: it does
 * not inspect user prose, labels, keywords, or choose a workflow.
 */
export function normalizeAgentsSemanticTaskSummaryFromRuntimeIntentContract(
	value: unknown,
): AgentsSemanticTaskSummary | null {
	if (!isRecord(value) || value.version !== 2) return null;
	const contractHash = readTrimmedString(value.contractHash);
	const delivery = isRecord(value.delivery) ? value.delivery : null;
	const deliveryMode = readTrimmedString(delivery?.mode);
	const mediaType = delivery?.mediaType === null ||
			delivery?.mediaType === "image" ||
			delivery?.mediaType === "video" ||
			delivery?.mediaType === "audio"
		? delivery.mediaType
		: undefined;
	const kind = readTrimmedString(delivery?.kind);
	const requestedOutput = readTrimmedString(delivery?.output);
	const unresolved = readTrimmedStringArray(value.unresolved);
	if (
		!contractHash ||
		!delivery ||
		mediaType === undefined ||
		!kind ||
		!requestedOutput ||
		(deliveryMode !== "response" && deliveryMode !== "state_change" && deliveryMode !== "async_artifact") ||
		unresolved.length > 0 ||
		(mediaType !== null && deliveryMode !== "async_artifact")
	) {
		return null;
	}
	const successCriteria = Array.isArray(value.must)
		? value.must
			.map((item) => isRecord(item) ? readTrimmedString(item.statement) : "")
			.filter(Boolean)
			.slice(0, 32)
		: [];
	if (successCriteria.length === 0) return null;
	const deliveryContract = normalizePublicChatSemanticDeliveryContract({
		...delivery,
		kind,
	});
	if (!deliveryContract) return null;
	return {
		taskGoal: requestedOutput,
		requestedOutput,
		taskKind: kind,
		recommendedNextStage: "execute_frozen_user_intent_contract",
		mustStop: false,
		requiresExecutionDelivery: deliveryMode !== "response",
		blockingGaps: [],
		successCriteria,
		deliveryContract,
	};
}

function buildAgentsSemanticExecutionIntentSummary(
	input: {
		taskSummary: AgentsSemanticTaskSummary | null;
		source: AgentsSemanticExecutionIntentSummary["source"];
	},
): AgentsSemanticExecutionIntentSummary {
	const { taskSummary, source } = input;
	if (!taskSummary) {
		return {
			detected: false,
			source: "none",
			taskKind: null,
			mustStop: false,
			requiresExecutionDelivery: false,
			reason: "no_structured_semantic_task_summary",
		};
	}
	const requiresExecutionDelivery =
		taskSummary.requiresExecutionDelivery === true &&
		taskSummary.mustStop !== true &&
		taskSummary.blockingGaps.length === 0 &&
		Boolean(taskSummary.recommendedNextStage);
	return {
		detected: true,
		source,
		taskKind: taskSummary.taskKind,
		mustStop: taskSummary.mustStop,
		requiresExecutionDelivery,
		reason: requiresExecutionDelivery
			? "agents_marked_next_stage_as_executable_delivery"
			: "agents_marked_task_as_stop_or_blocked",
	};
}

function normalizeComparableKind(value: unknown): string {
	return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function sanitizeStoryboardEditorKindForAgents(value: string | null | undefined): string | null {
	const normalized = normalizeComparableKind(value);
	if (!normalized) return null;
	return normalized === "storyboard" ? "image" : normalized;
}

function sanitizeSelectedReferenceForAgents(
	selectedReference: PublicChatPromptContext["selectedReference"],
): PublicChatPromptContext["selectedReference"] {
	if (!selectedReference) return null;
	return {
		...selectedReference,
		kind: sanitizeStoryboardEditorKindForAgents(selectedReference.kind),
	};
}

function isChapterGroundedVisualNodeKind(kind: string): boolean {
	return (
		kind === "image" ||
		kind === "imageedit" ||
		kind === "storyboard" ||
		kind === "storyboardimage" ||
		kind === "storyboardshot" ||
		kind === "novelstoryboard" ||
		kind === "composevideo" ||
		kind === "video"
	);
}

function isVideoLikeNodeKind(kind: string): boolean {
	return kind === "video" || kind === "composevideo";
}

function hasChapterGroundedVisualTraceability(record: Record<string, unknown>): boolean {
	const productionMetadata = isRecord(record.productionMetadata)
		? record.productionMetadata
		: null;
	if (productionMetadata?.chapterGrounded === true) return true;
	const sourceBookId =
		typeof record.sourceBookId === "string"
			? record.sourceBookId.trim()
			: typeof record.bookId === "string"
				? record.bookId.trim()
				: "";
	const hasNumericChapter =
		(typeof record.materialChapter === "number" && Number.isFinite(record.materialChapter)) ||
		(typeof record.chapter === "number" && Number.isFinite(record.chapter));
	const hasChapterId =
		typeof record.chapterId === "string" && record.chapterId.trim().length > 0;
	return Boolean(sourceBookId && (hasNumericChapter || hasChapterId));
}

function readFlowPatchNodeFinalStateId(value: unknown, fallback: string): string {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function mergeFlowPatchNodeFinalStateData(
	existing: Record<string, unknown> | null,
	patch: Record<string, unknown>,
	kind: string,
): Record<string, unknown> {
	const next: Record<string, unknown> = {
		...(existing ?? {}),
		...patch,
	};
	if (kind && typeof next.kind !== "string") next.kind = kind;
	return next;
}

function buildFlowPatchNodeFinalStates(input: {
	toolCalls: BridgeToolCall[];
	selectedNodeKind: string | null;
}): Map<string, FlowPatchNodeFinalState> {
	const states = new Map<string, FlowPatchNodeFinalState>();
	const selectedNodeKind = normalizeComparableKind(input.selectedNodeKind);
	for (const toolCall of input.toolCalls) {
		if (toolCall.name !== "tapcanvas_flow_patch" || toolCall.status !== "succeeded" || !toolCall.inputJson) {
			continue;
		}
		const createNodes = Array.isArray(toolCall.inputJson.createNodes)
			? toolCall.inputJson.createNodes
			: [];
		createNodes.forEach((node, index) => {
			if (!isRecord(node)) return;
			const data = isRecord(node.data) ? node.data : null;
			if (!data) return;
			const nodeId = readFlowPatchNodeFinalStateId(
				node.id,
				`${toolCall.toolCallId}:create:${index}`,
			);
			const previous = states.get(nodeId);
			const explicitKind = normalizeComparableKind(data.kind);
			const kind = explicitKind || previous?.kind || "";
			states.set(nodeId, {
				id: nodeId,
				kind,
				data: mergeFlowPatchNodeFinalStateData(previous?.data ?? null, data, kind),
			});
		});
		const patchNodeData = Array.isArray(toolCall.inputJson.patchNodeData)
			? toolCall.inputJson.patchNodeData
			: [];
		patchNodeData.forEach((patch, index) => {
			if (!isRecord(patch)) return;
			const data = isRecord(patch.data) ? patch.data : null;
			if (!data) return;
			const nodeId = readFlowPatchNodeFinalStateId(
				patch.id,
				`${toolCall.toolCallId}:patch:${index}`,
			);
			const previous = states.get(nodeId);
			const explicitKind = normalizeComparableKind(data.kind);
			const kind = explicitKind || previous?.kind || selectedNodeKind;
			states.set(nodeId, {
				id: nodeId,
				kind,
				data: mergeFlowPatchNodeFinalStateData(previous?.data ?? null, data, kind),
			});
		});
	}
	return states;
}

function readChapterGroundedAuthorityBaseFrameStatus(
	record: Record<string, unknown>,
): "planned" | "confirmed" | null {
	const productionMetadata = isRecord(record.productionMetadata)
		? record.productionMetadata
		: null;
	if (!productionMetadata || productionMetadata.chapterGrounded !== true) return null;
	const authorityBaseFrame = isRecord(productionMetadata.authorityBaseFrame)
		? productionMetadata.authorityBaseFrame
		: null;
	if (!authorityBaseFrame) return null;
	const status = normalizeComparableKind(authorityBaseFrame.status);
	if (status === "planned" || status === "confirmed") return status;
	return null;
}

function recordHasMaterializedVisualOutput(record: Record<string, unknown>): boolean {
	const imageUrl = typeof record.imageUrl === "string" ? record.imageUrl.trim() : "";
	if (imageUrl) return true;
	const videoUrl = typeof record.videoUrl === "string" ? record.videoUrl.trim() : "";
	if (videoUrl) return true;
	if (Array.isArray(record.videoResults) && record.videoResults.length > 0) return true;
	if (Array.isArray(record.storyboardEditorCells)) {
		for (const cell of record.storyboardEditorCells) {
			if (!isRecord(cell)) continue;
			if (typeof cell.imageUrl === "string" && cell.imageUrl.trim()) return true;
		}
	}
	return false;
}

function applyChapterGroundedVisualPreproductionRecord(
	summary: ChapterGroundedVisualPreproductionSummary,
	record: Record<string, unknown>,
	kind: string,
): void {
	summary.active = true;
	summary.visualNodeCount += 1;
	if (!isVideoLikeNodeKind(kind)) {
		summary.imageLikeNodeCount += 1;
		const productionLayer = normalizeComparableKind(record.productionLayer);
		if (productionLayer === "preproduction") {
			summary.preproductionImageLikeNodeCount += 1;
		}
		if (isReusablePreproductionImageLikeNode(record, kind)) {
			summary.reusablePreproductionImageLikeNodeCount += 1;
		}
	}
	if (isVideoLikeNodeKind(kind)) summary.hasVideoNodes = true;
	if (recordHasMaterializedVisualOutput(record)) {
		summary.hasMaterializedVisualOutputs = true;
	}
	const authorityBaseFrameStatus = readChapterGroundedAuthorityBaseFrameStatus(record);
	if (authorityBaseFrameStatus === "planned") {
		summary.hasPlannedAuthorityBaseFrame = true;
	}
	if (authorityBaseFrameStatus === "confirmed") {
		summary.hasConfirmedAuthorityBaseFrame = true;
	}
	if (kind === "storyboard") {
		summary.materializedStoryboardStillCount += countMaterializedStoryboardCellImages(record);
	}
}

function isReusablePreproductionImageLikeNode(
	record: Record<string, unknown>,
	kind: string,
): boolean {
	if (isVideoLikeNodeKind(kind)) return false;
	const productionLayer = normalizeComparableKind(record.productionLayer);
	const creationStage = normalizeComparableKind(record.creationStage);
	return (
		productionLayer === "preproduction" ||
		productionLayer === "anchors" ||
		creationStage === "authority_base_frame" ||
		creationStage === "shot_anchor_lock"
	);
}

function buildChapterGroundedVisualPreproductionSummary(input: {
	toolCalls: BridgeToolCall[];
	selectedNodeKind: string | null;
}): ChapterGroundedVisualPreproductionSummary {
	const summary: ChapterGroundedVisualPreproductionSummary = {
		active: false,
		visualNodeCount: 0,
		imageLikeNodeCount: 0,
		preproductionImageLikeNodeCount: 0,
		reusablePreproductionImageLikeNodeCount: 0,
		hasVideoNodes: false,
		hasMaterializedVisualOutputs: false,
		hasPlannedAuthorityBaseFrame: false,
		hasConfirmedAuthorityBaseFrame: false,
		materializedStoryboardStillCount: 0,
	};
	const nodeStates = buildFlowPatchNodeFinalStates({
		toolCalls: input.toolCalls,
		selectedNodeKind: input.selectedNodeKind,
	});
	for (const state of nodeStates.values()) {
		if (!hasChapterGroundedVisualTraceability(state.data)) continue;
		if (!state.kind || !isChapterGroundedVisualNodeKind(state.kind)) continue;
		applyChapterGroundedVisualPreproductionRecord(summary, state.data, state.kind);
	}
	return summary;
}

function readVideoTargetDurationSeconds(
	value: Record<string, unknown> | null,
	depth = 0,
): number | null {
	if (!value) return null;
	const candidates = [
		value.targetDurationSeconds,
		asRecord(value.storyPlan)?.targetDurationSeconds,
		asRecord(asRecord(value.beatSheet)?.meta)?.targetDurationSeconds,
		asRecord(value.plan)?.targetDurationSeconds,
	];
	for (const candidate of candidates) {
		const durationSeconds = Number(candidate);
		if (Number.isFinite(durationSeconds) && durationSeconds > 0) {
			return durationSeconds;
		}
	}
	if (depth >= 3) return null;
	for (const key of ["data", "result", "response"] as const) {
		const nested = asRecord(value[key]);
		const durationSeconds = readVideoTargetDurationSeconds(nested, depth + 1);
		if (durationSeconds) return durationSeconds;
	}
	return null;
}

export function collectVideoTargetDurationEvidence(input: {
	toolCalls: BridgeToolCall[];
	artifacts: PublicChatDeliveryEvidence["artifacts"];
}): number[] {
	const videoDeliveryToolCallIds = new Set(
		input.artifacts
			.filter((artifact) => artifact.assetType === "video")
			.map((artifact) => artifact.toolCallId),
	);
	const durations = new Set<number>();
	for (const toolCall of input.toolCalls) {
		if (
			toolCall.status !== "succeeded" ||
			toolCall.name !== "tapcanvas_equipped_workflow_run" ||
			!videoDeliveryToolCallIds.has(toolCall.toolCallId)
		) {
			continue;
		}
		const durationSeconds =
			readVideoTargetDurationSeconds(toolCall.inputJson) ??
			readVideoTargetDurationSeconds(toolCall.outputJson);
		if (durationSeconds) durations.add(durationSeconds);
	}
	return [...durations];
}

function buildPublicChatDeliveryEvidence(input: {
	canonicalItems: PublicChatDeliveryEvidence["items"];
	assets: Array<{
		type: "image" | "video" | "audio" | "file";
		url: string;
		thumbnailUrl?: string;
		fileName?: string;
		mimeType?: string;
	}>;
	toolEvidence: BridgeToolEvidence;
	chapterGroundedVisualPreproduction: ChapterGroundedVisualPreproductionSummary;
	toolCalls: BridgeToolCall[];
	hostManifest: HostCapabilityManifest | null;
	hostCanvasContext: HostCanvasContext | null;
}): PublicChatDeliveryEvidence {
	const artifacts: PublicChatDeliveryEvidence["artifacts"] =
		collectPublicChatToolDeliveryArtifacts(input.toolCalls).concat(
			collectPublicChatHostAsyncDeliveryArtifacts({
				manifest: input.hostManifest,
				canvasContext: input.hostCanvasContext,
				toolCalls: input.toolCalls,
			}),
		);
	const imageAssetCount = input.assets.filter((asset) => asset.type === "image").length;
	const videoAssetCount = input.assets.filter((asset) => asset.type === "video").length;
	const storyboardPlanPersistenceCount = input.toolCalls.filter(
		(toolCall) =>
			toolCall.name === "tapcanvas_book_storyboard_plan_upsert" &&
			toolCall.status === "succeeded",
	).length;
	const videoTargetDurationSeconds = collectVideoTargetDurationEvidence({
		toolCalls: input.toolCalls,
		artifacts,
	});
	return {
		version: 2,
		items: input.canonicalItems,
		artifacts,
		assetCount: input.assets.length,
		imageAssetCount,
		videoAssetCount,
		wroteCanvas: input.toolEvidence.wroteCanvas,
		generatedAssets: input.toolEvidence.generatedAssets,
		imageLikeNodeCount: input.chapterGroundedVisualPreproduction.imageLikeNodeCount,
		preproductionImageLikeNodeCount:
			input.chapterGroundedVisualPreproduction.preproductionImageLikeNodeCount,
		reusablePreproductionImageLikeNodeCount:
			input.chapterGroundedVisualPreproduction
				.reusablePreproductionImageLikeNodeCount,
		materializedStoryboardStillCount:
			input.chapterGroundedVisualPreproduction.materializedStoryboardStillCount,
		hasVideoNodes: input.chapterGroundedVisualPreproduction.hasVideoNodes,
		hasMaterializedVisualOutputs:
			input.chapterGroundedVisualPreproduction.hasMaterializedVisualOutputs,
		hasPlannedAuthorityBaseFrame:
			input.chapterGroundedVisualPreproduction.hasPlannedAuthorityBaseFrame,
		hasConfirmedAuthorityBaseFrame:
			input.chapterGroundedVisualPreproduction.hasConfirmedAuthorityBaseFrame,
		storyboardPlanPersistenceCount,
		...(videoTargetDurationSeconds.length > 0 ? { videoTargetDurationSeconds } : {}),
  };
}

export function hasMaterializedPublicDeliveryEvidence(
	evidence: PublicChatDeliveryEvidence,
): boolean {
	return evidence.items.length > 0 ||
		evidence.artifacts.length > 0 ||
		evidence.assetCount > 0 ||
		evidence.wroteCanvas ||
		evidence.generatedAssets ||
		evidence.materializedStoryboardStillCount > 0 ||
		evidence.storyboardPlanPersistenceCount > 0;
}

function countMaterializedStoryboardCellImages(record: Record<string, unknown>): number {
	if (!Array.isArray(record.storyboardEditorCells)) return 0;
	let count = 0;
	for (const cell of record.storyboardEditorCells) {
		if (!isRecord(cell)) continue;
		if (typeof cell.imageUrl !== "string" || cell.imageUrl.trim().length <= 0) continue;
		count += 1;
	}
	return count;
}

function buildAgentsBridgeCanvasMutationSummary(
	toolCalls: BridgeToolCall[],
): AgentsBridgeCanvasMutation | null {
	const deletedNodeIds: string[] = [];
	const deletedEdgeIds: string[] = [];
	const createdNodeIds: string[] = [];
	const patchedNodeIds: string[] = [];
	const executableNodeIds: string[] = [];
	const seenDeletedNodeIds = new Set<string>();
	const seenDeletedEdgeIds = new Set<string>();
	const seenCreatedNodeIds = new Set<string>();
	const seenPatchedNodeIds = new Set<string>();
	const seenExecutableNodeIds = new Set<string>();
	const appendDeletedNodeId = (value: unknown) => {
		const nodeId = typeof value === "string" ? value.trim() : "";
		if (!nodeId || seenDeletedNodeIds.has(nodeId)) return;
		seenDeletedNodeIds.add(nodeId);
		deletedNodeIds.push(nodeId);
	};
	const appendDeletedEdgeId = (value: unknown) => {
		const edgeId = typeof value === "string" ? value.trim() : "";
		if (!edgeId || seenDeletedEdgeIds.has(edgeId)) return;
		seenDeletedEdgeIds.add(edgeId);
		deletedEdgeIds.push(edgeId);
	};
	const appendCreatedNodeId = (value: unknown) => {
		const nodeId = typeof value === "string" ? value.trim() : "";
		if (!nodeId || seenCreatedNodeIds.has(nodeId)) return;
		seenCreatedNodeIds.add(nodeId);
		createdNodeIds.push(nodeId);
	};
	const appendPatchedNodeId = (value: unknown) => {
		const nodeId = typeof value === "string" ? value.trim() : "";
		if (!nodeId || seenPatchedNodeIds.has(nodeId)) return;
		seenPatchedNodeIds.add(nodeId);
		patchedNodeIds.push(nodeId);
	};
	const appendExecutableNodeId = (value: unknown) => {
		const nodeId = typeof value === "string" ? value.trim() : "";
		if (!nodeId || seenExecutableNodeIds.has(nodeId)) return;
		seenExecutableNodeIds.add(nodeId);
		executableNodeIds.push(nodeId);
	};
	const looksExecutableNodeKind = (value: unknown): boolean => {
		const kind = typeof value === "string" ? value.trim().toLowerCase() : "";
		return (
			kind === "image" ||
			kind === "imageedit" ||
			kind === "storyboard" ||
			kind === "storyboardimage" ||
			kind === "video" ||
			kind === "composevideo" ||
			kind === "audio"
		);
	};

	for (const toolCall of toolCalls) {
		if (toolCall.status !== "succeeded") continue;
		if (toolCall.name !== "tapcanvas_flow_patch" || !toolCall.inputJson) continue;
		const deleteNodeIds = Array.isArray(toolCall.inputJson.deleteNodeIds)
			? toolCall.inputJson.deleteNodeIds
			: [];
		for (const nodeId of deleteNodeIds) {
			appendDeletedNodeId(nodeId);
		}
		const deleteEdgeIds = Array.isArray(toolCall.inputJson.deleteEdgeIds)
			? toolCall.inputJson.deleteEdgeIds
			: [];
		for (const edgeId of deleteEdgeIds) {
			appendDeletedEdgeId(edgeId);
		}
		const createNodes = Array.isArray(toolCall.inputJson.createNodes)
			? toolCall.inputJson.createNodes
			: [];
		for (const node of createNodes) {
			if (!isRecord(node)) continue;
			appendCreatedNodeId(node.id);
			const data = isRecord(node.data) ? node.data : null;
			if (!data || !looksExecutableNodeKind(data.kind)) continue;
			appendExecutableNodeId(node.id);
		}
		const patchNodeData = Array.isArray(toolCall.inputJson.patchNodeData)
			? toolCall.inputJson.patchNodeData
			: [];
		for (const patch of patchNodeData) {
			if (!isRecord(patch)) continue;
			appendPatchedNodeId(patch.id);
			const data = isRecord(patch.data) ? patch.data : null;
			if (!data || !looksExecutableNodeKind(data.kind)) continue;
			appendExecutableNodeId(patch.id);
		}
	}

	if (
		!deletedNodeIds.length &&
		!deletedEdgeIds.length &&
		!createdNodeIds.length &&
		!patchedNodeIds.length &&
		!executableNodeIds.length
	) {
		return null;
	}

	return {
		deletedNodeIds,
		deletedEdgeIds,
		createdNodeIds,
		patchedNodeIds,
		executableNodeIds,
	};
}

function classifyBridgeOutputMode(input: {
	assetCount: number;
	canvasPlanParsed: boolean;
	canvasPlanHasAssetUrls: boolean;
	wroteCanvas: boolean;
}): AgentsBridgeOutputMode {
	if (input.canvasPlanParsed && input.canvasPlanHasAssetUrls) return "plan_with_assets";
	if (input.canvasPlanParsed) return "plan_only";
	if (input.wroteCanvas) return "direct_assets";
	if (input.assetCount > 0) return "direct_assets";
	return "text_only";
}

function decorateCanvasPlanDiagnosticsForOutputMode(input: {
	outputMode: AgentsBridgeOutputMode;
	canvasPlanDiagnostics: CanvasPlanDiagnostics;
}): CanvasPlanDiagnostics {
	if (input.outputMode !== "text_only") return input.canvasPlanDiagnostics;
	if (input.canvasPlanDiagnostics.tagPresent) return input.canvasPlanDiagnostics;
	if (input.canvasPlanDiagnostics.errorCode === "invalid_canvas_plan_tag_name") {
		return input.canvasPlanDiagnostics;
	}
	return {
		...input.canvasPlanDiagnostics,
		summary: "plain_text_answer_without_canvas_plan",
		reason: "not_applicable_text_only",
	};
}

function buildAgentsBridgeDecision(input: {
	outputMode: AgentsBridgeOutputMode;
	assetCount: number;
	toolEvidence: BridgeToolEvidence;
	canvasPlanDiagnostics: CanvasPlanDiagnostics;
}): AgentsBridgeDecision {
	const executionKind =
		input.toolEvidence.wroteCanvas
			? "execute"
			: input.outputMode === "plan_only" || input.outputMode === "plan_with_assets"
			? input.outputMode === "plan_with_assets"
				? "generate"
				: "plan"
			: input.outputMode === "direct_assets"
				? "generate"
				: "answer";
	const canvasAction =
		input.toolEvidence.wroteCanvas
			? "write_canvas"
			: input.canvasPlanDiagnostics.parseSuccess &&
			  input.canvasPlanDiagnostics.action === "create_canvas_workflow"
			? "create_canvas_workflow"
			: "none";
	const reasonParts = [
		`mode=${input.outputMode}`,
		`projectStateRead=${input.toolEvidence.readProjectState ? "yes" : "no"}`,
		`assetCount=${input.assetCount}`,
		canvasAction === "write_canvas"
			? "canvas_write_done"
			: canvasAction === "create_canvas_workflow"
				? "canvas_plan_ready"
				: "no_canvas_plan",
	];
	return {
		executionKind,
		canvasAction,
		assetCount: input.assetCount,
		projectStateRead: input.toolEvidence.readProjectState,
		reason: reasonParts.join("; "),
	};
}

export function resolveAgentsBridgeRequestTerminal(input: {
	runOutcome: AgentsBridgeRunOutcome;
	pendingUserInput: boolean;
}): AgentsBridgeRequestTerminal {
	if (input.pendingUserInput) {
		if (input.runOutcome.status !== "needs_input") {
			return {
				version: 1,
				terminal: true,
				status: "failed",
				reason: "agent_run_outcome_user_input_mismatch",
			};
		}
		return {
			version: 1,
			terminal: true,
			status: "needs_input",
			reason: input.runOutcome.reason,
		};
	}
	if (input.runOutcome.status === "needs_input") {
		return {
			version: 1,
			terminal: true,
			status: "failed",
			reason: "agent_run_outcome_user_input_evidence_missing",
		};
	}
	if (input.runOutcome.status === "failed") {
		return {
			version: 1,
			terminal: true,
			status: "failed",
			reason: input.runOutcome.reason,
		};
	}
	if (input.runOutcome.status === "suspended") {
		return {
			version: 1,
			terminal: true,
			status: "suspended",
			reason: input.runOutcome.reason,
		};
	}
	return {
		version: 1,
		terminal: true,
		status: "succeeded",
		reason: input.runOutcome.reason,
	};
}

export function buildAgentsBridgeTurnVerdict(
	requestTerminal: AgentsBridgeRequestTerminal,
): AgentsBridgeTurnVerdict {
	if (requestTerminal.status === "succeeded") {
		return { status: "satisfied", reasons: [requestTerminal.reason] };
	}
	if (requestTerminal.status === "needs_input" || requestTerminal.status === "suspended") {
		return { status: "partial", reasons: [requestTerminal.reason] };
	}
	return { status: "failed", reasons: [requestTerminal.reason] };
}

/**
 * TaskResult.status describes the logical work represented by this bridge
 * result. A physical-window suspension or user-input handoff is still running;
 * callers must not promote it to a completed pipeline/task merely because the
 * HTTP request returned successfully.
 */
export function resolveAgentsBridgeTaskResultStatus(
	logicalTaskState: AgentLogicalTaskStateV1,
): TaskResultDto["status"] {
	if (logicalTaskState.status === "succeeded") return "succeeded";
	if (logicalTaskState.status === "failed" || logicalTaskState.status === "cancelled") return "failed";
	return "running";
}

function pickFirstAnchorBindingByKind(
	bindings: PublicFlowAnchorBinding[],
	kind: PublicFlowAnchorBinding["kind"],
): PublicFlowAnchorBinding | null {
	for (const binding of bindings) {
		if (binding.kind === kind) return binding;
	}
	return null;
}

function readSelectedReferenceRoleName(
	selectedReferenceRaw: Record<string, unknown>,
	anchorBindings: PublicFlowAnchorBinding[],
): string | null {
	if (typeof selectedReferenceRaw.roleName === "string") {
		return String(selectedReferenceRaw.roleName).trim() || null;
	}
	return pickFirstAnchorBindingByKind(anchorBindings, "character")?.label || null;
}

function readSelectedReferenceRoleCardId(
	selectedReferenceRaw: Record<string, unknown>,
	anchorBindings: PublicFlowAnchorBinding[],
): string | null {
	if (typeof selectedReferenceRaw.roleCardId === "string") {
		return String(selectedReferenceRaw.roleCardId).trim() || null;
	}
	return pickFirstAnchorBindingByKind(anchorBindings, "character")?.refId || null;
}

function normalizeAgentsBridgeChatContext(raw: unknown): AgentsBridgeChatContext {
	if (!raw || typeof raw !== "object") {
		return {
			requestedWorkflowExecutionVariant: null,
			generationProposal: null,
			currentProjectName: null,
			workspaceAction: null,
			skill: null,
			roleSkillAssignments: [],
			chapterDirectorPersona: null,
			chapterStyleOverride: null,
			selectedNodeLabel: null,
			selectedNodeKind: null,
			selectedNodeTextPreview: null,
			selectedReference: null,
			chapterCanvasReference: null,
			chatMode: null,
			creativePhase: null,
			canvasSummary: null,
		};
	}
	const value = raw as Record<string, unknown>;
	const generationProposalRaw = value.generationProposal;
	let generationProposal: AgentsBridgeGenerationProposal | null = null;
	if (generationProposalRaw !== undefined && generationProposalRaw !== null) {
		if (!generationProposalRaw || typeof generationProposalRaw !== "object" || Array.isArray(generationProposalRaw)) {
			throw new AppError("chatContext.generationProposal 必须是结构化对象", { status: 400, code: "invalid_generation_proposal" });
		}
		const proposal = generationProposalRaw as Record<string, unknown>;
		const proposalId = typeof proposal.proposalId === "string" ? proposal.proposalId.trim() : "";
		const title = typeof proposal.title === "string" ? proposal.title.trim() : "";
		const prompt = typeof proposal.prompt === "string" ? proposal.prompt.trim() : "";
		const kind = proposal.kind === "image" || proposal.kind === "video" || proposal.kind === "audio" || proposal.kind === "prompt" ? proposal.kind : null;
		if (proposal.version !== 1 || !proposalId || !title || !prompt || !kind) {
			throw new AppError("chatContext.generationProposal 缺少有效提案事实", { status: 400, code: "invalid_generation_proposal" });
		}
		const parametersRaw = Array.isArray(proposal.parameters) ? proposal.parameters : [];
		const parameters = parametersRaw.slice(0, 32).flatMap((item) => {
			if (!item || typeof item !== "object" || Array.isArray(item)) return [];
			const record = item as Record<string, unknown>;
			const label = typeof record.label === "string" ? record.label.trim() : "";
			const value = typeof record.value === "string" ? record.value.trim() : "";
			return label && value ? [{ label, value }] : [];
		});
		generationProposal = {
			version: 1,
			proposalId,
			kind,
			title,
			prompt,
			...(typeof proposal.model === "string" && proposal.model.trim() ? { model: proposal.model.trim() } : {}),
			parameters,
			action: typeof proposal.action === "string" && proposal.action.trim() ? proposal.action.trim() : null,
			nodeId: typeof proposal.nodeId === "string" && proposal.nodeId.trim() ? proposal.nodeId.trim() : null,
		};
	}
	const skillRaw = value.skill;
	const roleSkillAssignments = normalizeAgentsBridgeRoleSkillAssignments(value.roleSkillAssignments);
	const chapterDirectorPersona = normalizeAgentsBridgeChapterDirectorPersona(value.chapterDirectorPersona);
	const chapterStyleOverride = normalizeAgentsBridgeChapterStyleOverride(value.chapterStyleOverride);
	const selectedReferenceRaw = value.selectedReference;
	const normalizedAnchorBindings =
		selectedReferenceRaw && typeof selectedReferenceRaw === "object"
			? normalizePublicFlowAnchorBindings(
					(selectedReferenceRaw as Record<string, unknown>).anchorBindings,
			  )
			: [];
	const normalizedStoryboardSelectionContext = normalizeStoryboardSelectionContext(
		selectedReferenceRaw && typeof selectedReferenceRaw === "object"
			? (selectedReferenceRaw as Record<string, unknown>).storyboardSelectionContext
			: null,
	);
	const skill =
		skillRaw && typeof skillRaw === "object"
			? {
					id:
						typeof (skillRaw as Record<string, unknown>).id === "string"
							? String((skillRaw as Record<string, unknown>).id).trim() || null
							: null,
					source:
						(skillRaw as Record<string, unknown>).source === "system" ||
						(skillRaw as Record<string, unknown>).source === "user" ||
						(skillRaw as Record<string, unknown>).source === "marketplace"
							? ((skillRaw as Record<string, unknown>).source as ChatSkillReferenceSource)
							: null,
					key:
						typeof (skillRaw as Record<string, unknown>).key === "string"
							? String((skillRaw as Record<string, unknown>).key).trim() || null
							: null,
					name:
						typeof (skillRaw as Record<string, unknown>).name === "string"
							? String((skillRaw as Record<string, unknown>).name).trim() || null
							: null,
			  }
			: null;
	return {
		requestedWorkflowExecutionVariant:
			value.requestedWorkflowExecutionVariant === "full_video" ||
			value.requestedWorkflowExecutionVariant === "first_video"
				? value.requestedWorkflowExecutionVariant
				: null,
		generationProposal,
		currentProjectName:
			typeof value.currentProjectName === "string"
				? String(value.currentProjectName).trim() || null
				: null,
		chatMode: value.chatMode === "creative" ? "creative" : null,
		creativePhase:
			value.creativePhase === "prep" ? "prep" : value.creativePhase === "writing" ? "writing" : null,
		workspaceAction:
			value.workspaceAction === "chapter_script_generation" ||
			value.workspaceAction === "chapter_asset_generation" ||
			value.workspaceAction === "shot_video_generation"
				? value.workspaceAction
				: null,
		skill,
		roleSkillAssignments,
		chapterDirectorPersona,
		chapterStyleOverride,
		selectedNodeLabel:
			typeof value.selectedNodeLabel === "string"
				? String(value.selectedNodeLabel).trim() || null
				: null,
		selectedNodeKind:
			typeof value.selectedNodeKind === "string"
				? String(value.selectedNodeKind).trim() || null
				: null,
		selectedNodeTextPreview:
			typeof value.selectedNodeTextPreview === "string"
				? String(value.selectedNodeTextPreview).trim() || null
				: null,
		selectedReference:
			selectedReferenceRaw && typeof selectedReferenceRaw === "object"
				? {
						nodeId:
							typeof (selectedReferenceRaw as Record<string, unknown>).nodeId === "string"
								? String((selectedReferenceRaw as Record<string, unknown>).nodeId).trim() || null
								: null,
						label:
							typeof (selectedReferenceRaw as Record<string, unknown>).label === "string"
								? String((selectedReferenceRaw as Record<string, unknown>).label).trim() || null
								: null,
						kind:
							typeof (selectedReferenceRaw as Record<string, unknown>).kind === "string"
								? String((selectedReferenceRaw as Record<string, unknown>).kind).trim() || null
								: null,
						...(normalizedAnchorBindings.length
							? { anchorBindings: normalizedAnchorBindings }
							: {}),
						roleName: readSelectedReferenceRoleName(
							selectedReferenceRaw as Record<string, unknown>,
							normalizedAnchorBindings,
						),
						roleCardId: readSelectedReferenceRoleCardId(
							selectedReferenceRaw as Record<string, unknown>,
							normalizedAnchorBindings,
						),
						imageUrl:
							typeof (selectedReferenceRaw as Record<string, unknown>).imageUrl === "string"
								? String((selectedReferenceRaw as Record<string, unknown>).imageUrl).trim() || null
								: normalizedStoryboardSelectionContext?.imageUrl || null,
						sourceUrl:
							typeof (selectedReferenceRaw as Record<string, unknown>).sourceUrl === "string"
								? String((selectedReferenceRaw as Record<string, unknown>).sourceUrl).trim() || null
								: null,
						bookId:
							typeof (selectedReferenceRaw as Record<string, unknown>).bookId === "string"
								? String((selectedReferenceRaw as Record<string, unknown>).bookId).trim() || null
								: normalizedStoryboardSelectionContext?.sourceBookId || null,
						chapterId:
							typeof (selectedReferenceRaw as Record<string, unknown>).chapterId === "string"
								? String((selectedReferenceRaw as Record<string, unknown>).chapterId).trim() || null
								: typeof normalizedStoryboardSelectionContext?.materialChapter === "number"
									? String(normalizedStoryboardSelectionContext.materialChapter)
									: null,
						shotNo:
							Number.isFinite(Number((selectedReferenceRaw as Record<string, unknown>).shotNo))
								? Math.trunc(Number((selectedReferenceRaw as Record<string, unknown>).shotNo))
								: normalizedStoryboardSelectionContext?.shotNo ?? null,
						productionLayer:
							typeof (selectedReferenceRaw as Record<string, unknown>).productionLayer === "string"
								? String((selectedReferenceRaw as Record<string, unknown>).productionLayer).trim() || null
								: null,
						creationStage:
							typeof (selectedReferenceRaw as Record<string, unknown>).creationStage === "string"
								? String((selectedReferenceRaw as Record<string, unknown>).creationStage).trim() || null
								: null,
						approvalStatus:
							typeof (selectedReferenceRaw as Record<string, unknown>).approvalStatus === "string"
								? String((selectedReferenceRaw as Record<string, unknown>).approvalStatus).trim() || null
								: null,
						authorityBaseFrameNodeId:
							typeof (selectedReferenceRaw as Record<string, unknown>).authorityBaseFrameNodeId === "string"
								? String((selectedReferenceRaw as Record<string, unknown>).authorityBaseFrameNodeId).trim() || null
								: null,
						authorityBaseFrameStatus:
							(selectedReferenceRaw as Record<string, unknown>).authorityBaseFrameStatus === "planned" ||
							(selectedReferenceRaw as Record<string, unknown>).authorityBaseFrameStatus === "confirmed"
								? (selectedReferenceRaw as Record<string, unknown>).authorityBaseFrameStatus as "planned" | "confirmed"
								: null,
						hasUpstreamTextEvidence:
							(selectedReferenceRaw as Record<string, unknown>).hasUpstreamTextEvidence === true,
						hasDownstreamComposeVideo:
							(selectedReferenceRaw as Record<string, unknown>).hasDownstreamComposeVideo === true,
						storyboardSelectionContext: normalizedStoryboardSelectionContext,
				  }
				: null,
		chapterCanvasReference: normalizeChapterCanvasReference(value.chapterCanvasReference),
		canvasSummary:
			typeof value.canvasSummary === "string" && value.canvasSummary.trim()
				? truncateMiddleText(value.canvasSummary.trim(), 700)
				: null,
	};
}

function normalizeAgentsBridgeChapterDirectorPersona(raw: unknown): AgentsBridgeChapterDirectorPersona | null {
	if (typeof raw === "undefined" || raw === null) return null;
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		throw new AppError("chatContext.chapterDirectorPersona 必须是结构化对象", {
			status: 400,
			code: "invalid_chapter_director_persona",
		});
	}
	const value = raw as Record<string, unknown>;
	const personaId = typeof value.personaId === "string" ? value.personaId.trim() : "";
	if (!personaId) {
		throw new AppError("chatContext.chapterDirectorPersona 缺少 personaId", {
			status: 400,
			code: "invalid_chapter_director_persona",
		});
	}
	return {
		personaId,
		personaName: typeof value.personaName === "string" ? value.personaName.trim() : "",
		source: value.source === "custom" ? "custom" : "catalog",
		prompt: typeof value.prompt === "string" && value.prompt.trim() ? value.prompt.trim() : null,
	};
}

function normalizeAgentsBridgeChapterStyleOverride(raw: unknown): AgentsBridgeChapterStyleOverride | null {
	if (typeof raw === "undefined" || raw === null) return null;
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		throw new AppError("chatContext.chapterStyleOverride 必须是结构化对象", {
			status: 400,
			code: "invalid_chapter_style_override",
		});
	}
	const value = raw as Record<string, unknown>;
	const styleId = typeof value.styleId === "string" ? value.styleId.trim() || null : null;
	const styleName = typeof value.styleName === "string" ? value.styleName.trim() || null : null;
	const stylePrompt = typeof value.stylePrompt === "string" ? value.stylePrompt.trim() || null : null;
	const category = typeof value.category === "string" ? value.category.trim() || null : null;
	const referenceImageCount = Number(value.referenceImageCount);
	if (
		!Number.isInteger(referenceImageCount) ||
		referenceImageCount < 0 ||
		referenceImageCount > 16
	) {
		throw new AppError("chatContext.chapterStyleOverride 的参考图数量无效", {
			status: 400,
			code: "invalid_chapter_style_reference_count",
		});
	}
	if (!styleId && !styleName && !stylePrompt && !category && referenceImageCount === 0) return null;
	return { styleId, styleName, stylePrompt, category, referenceImageCount };
}

function normalizeAgentsBridgeRoleSkillAssignments(raw: unknown): AgentsBridgeRoleSkillAssignment[] {
	if (typeof raw === "undefined" || raw === null) return [];
	if (!Array.isArray(raw)) {
		throw new AppError("chatContext.roleSkillAssignments 必须是数组", {
			status: 400,
			code: "invalid_role_skill_assignments",
		});
	}
	if (raw.length > 16) {
		throw new AppError("chatContext.roleSkillAssignments 超出角色配置上限", {
			status: 400,
			code: "role_skill_assignments_limit_exceeded",
			details: { max: 16, actual: raw.length },
		});
	}
	return raw.map((item, index) => {
		if (!item || typeof item !== "object" || Array.isArray(item)) {
			throw new AppError(`chatContext.roleSkillAssignments[${index}] 必须是结构化对象`, {
				status: 400,
				code: "invalid_role_skill_assignment",
			});
		}
		const assignment = item as Record<string, unknown>;
		const roleId = typeof assignment.roleId === "string" ? assignment.roleId.trim() : "";
		const roleName = typeof assignment.roleName === "string" ? assignment.roleName.trim() : "";
		const source = assignment.source === "system" || assignment.source === "custom" ? assignment.source : null;
		const skillId = typeof assignment.skillId === "string" ? assignment.skillId.trim() || null : null;
		const skillKey = typeof assignment.skillKey === "string" ? assignment.skillKey.trim() || null : null;
		const skillName = typeof assignment.skillName === "string" ? assignment.skillName.trim() || null : null;
		const fileName = typeof assignment.fileName === "string" ? assignment.fileName.trim() || null : null;
		const content = typeof assignment.content === "string" ? assignment.content : null;
		if (!roleId || !roleName || !source) {
			throw new AppError(`chatContext.roleSkillAssignments[${index}] 缺少角色或来源`, {
				status: 400,
				code: "invalid_role_skill_assignment",
			});
		}
		if (source === "system" && !skillId && !skillKey) {
			throw new AppError(`chatContext.roleSkillAssignments[${index}] 缺少系统 Skill 标识`, {
				status: 400,
				code: "invalid_system_role_skill_assignment",
			});
		}
		if (source === "custom" && !content?.trim()) {
			throw new AppError(`chatContext.roleSkillAssignments[${index}] 缺少自定义 Skill 文本`, {
				status: 400,
				code: "invalid_custom_role_skill_assignment",
			});
		}
		return {
			roleId,
			roleName,
			source,
			skillId,
			skillKey,
			skillName,
			fileName,
			content: source === "custom" ? content : null,
		};
	});
}

function normalizeChapterCanvasReference(raw: unknown): AgentsBridgeChatContext["chapterCanvasReference"] {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
	const record = raw as Record<string, unknown>;
	if (record.version !== 1) return null;
	const scopeKey = typeof record.scopeKey === "string" ? record.scopeKey.trim() : "";
	if (!scopeKey) return null;
	const declaredNodeCount = Number(record.nodeCount);
	const declaredEdgeCount = Number(record.edgeCount);
	if (!Number.isInteger(declaredNodeCount) || declaredNodeCount < 0) return null;
	if (!Number.isInteger(declaredEdgeCount) || declaredEdgeCount < 0) return null;
	return {
		version: 1,
		scopeKey: scopeKey.slice(0, 240),
		nodeCount: declaredNodeCount,
		edgeCount: declaredEdgeCount,
		summary: typeof record.summary === "string" && record.summary.trim()
			? truncateMiddleText(record.summary.trim(), 700)
			: null,
		selectedNodeId: typeof record.selectedNodeId === "string" && record.selectedNodeId.trim()
			? record.selectedNodeId.trim()
			: null,
	};
}

/** token/字符预算内的中间截断：保留头尾、砍中间（对标 codex truncate_middle，比 slice(0,N) 不丢尾部信息）。 */
function truncateMiddleText(text: string, maxChars: number): string {
	const s = String(text ?? "");
	if (s.length <= maxChars) return s;
	const keep = Math.max(0, maxChars - 3);
	const head = Math.ceil(keep * 0.6);
	const tail = keep - head;
	return `${s.slice(0, head)}…${tail > 0 ? s.slice(s.length - tail) : ""}`;
}

// 注入的画布上下文用标记包裹（对标 codex <external_*>）：让模型一眼认出这是"注入的只读画布快照"、
// 不必复述；同时内容不变时整块前缀稳定，利于 prompt 缓存命中（= 未变化的快照天然不重复计费）。
function buildChapterCanvasReferenceBlock(reference: AgentsBridgeChatContext["chapterCanvasReference"]): string | null {
	if (!reference) return null;
	return [
		"<canvas_reference readonly version=\"1\">",
		`scopeKey: ${reference.scopeKey}`,
		`nodeCount: ${reference.nodeCount}`,
		`edgeCount: ${reference.edgeCount}`,
		...(reference.selectedNodeId ? [`selectedNodeId: ${reference.selectedNodeId}`] : []),
		...(reference.summary ? [`summary: ${reference.summary}`] : []),
		"节点正文与资产事实未内联；只有当前任务确实需要时才用 tapcanvas_flow_get / tapcanvas_flow_search 按需读取。",
		"</canvas_reference>",
	].join("\n");
}

function normalizeComparableString(value: string | null | undefined): string {
	return String(value || "").trim().toLowerCase();
}

function isDirectVideoSceneAnchorReference(
	selectedReference: AgentsBridgeChatContext["selectedReference"],
): boolean {
	if (!selectedReference) return false;
	const kind = normalizeComparableString(selectedReference.kind);
	const productionLayer = normalizeComparableString(selectedReference.productionLayer);
	const creationStage = normalizeComparableString(selectedReference.creationStage);
	if (kind === "storyboardshot") return true;
	if (productionLayer === "anchors") return true;
	if (
		kind === "image" &&
		selectedReference.hasUpstreamTextEvidence &&
		selectedReference.hasDownstreamComposeVideo
	) {
		return true;
	}
	return (
		creationStage === "shot_anchor_lock" ||
		creationStage === "approved_keyframe_selection"
	);
}

function buildReferenceImageSlots(input: {
	referenceImages: string[];
	assetInputs: AgentsBridgeAssetInput[];
	selectedReference: AgentsBridgeChatContext["selectedReference"];
}): AgentsBridgeReferenceImageSlot[] {
	if (!input.referenceImages.length) return [];
	const assetInputByUrl = new Map<string, AgentsBridgeAssetInput>();
	for (const item of input.assetInputs) {
		const url = String(item.url || "").trim();
		if (!url || assetInputByUrl.has(url)) continue;
		assetInputByUrl.set(url, item);
	}
	return input.referenceImages.map((url, index) => {
		const matchedAsset = assetInputByUrl.get(url) || null;
		const matchedSelectedReference =
			input.selectedReference?.imageUrl?.trim() === url ? input.selectedReference : null;
		const role = matchedAsset?.role || null;
		const name =
			typeof matchedAsset?.name === "string" && matchedAsset.name.trim()
				? matchedAsset.name.trim()
				: null;
		const note =
			typeof matchedAsset?.note === "string" && matchedAsset.note.trim()
				? matchedAsset.note.trim()
				: null;
		const selectedReferenceLabel =
			typeof matchedSelectedReference?.label === "string" &&
			matchedSelectedReference.label.trim()
				? matchedSelectedReference.label.trim()
				: null;
		return {
			slot: `图${index + 1}`,
			url,
			referenceId:
				matchedAsset?.nodeId
					? `node:${matchedAsset.nodeId}`
					: matchedAsset?.assetRefId
						? `asset-ref:${matchedAsset.assetRefId}`
						: matchedAsset?.assetId
							? `asset:${matchedAsset.assetId}`
							: null,
			nodeId: matchedAsset?.nodeId || null,
			assetId: matchedAsset?.assetId || null,
			assetRefId: matchedAsset?.assetRefId || null,
			role,
			label: name || selectedReferenceLabel,
			note,
		};
	});
}

const agentsBridgeAdmissionScheduler = new AgentsBridgeAdmissionScheduler();

const nodeFetchDispatcherCache = new Map<number, unknown>();

// All three gates now fall back to FINITE defaults (was 999999 = fail-open, which
// let the existing 429 admission path never fire). With these finite, peak load is
// shed with 429 instead of accepted until the process OOMs. Override via env.
function readAgentsBridgeMaxConcurrency(c: AppContext): number {
	const rawFromEnv =
		typeof c.env.AGENTS_BRIDGE_MAX_CONCURRENCY === "string"
			? c.env.AGENTS_BRIDGE_MAX_CONCURRENCY
			: "";
	const rawFromProcess =
		readNodeProcessEnv("AGENTS_BRIDGE_MAX_CONCURRENCY");
	return resolvePositiveIntEnv(
		rawFromEnv || rawFromProcess,
		CONCURRENCY_DEFAULTS.bridgeMaxConcurrency,
	);
}

function readAgentsBridgeMaxQueueDepth(): number {
	return resolvePositiveIntEnv(
		readNodeProcessEnv("AGENTS_BRIDGE_MAX_QUEUE_DEPTH"),
		CONCURRENCY_DEFAULTS.bridgeMaxQueueDepth,
		{ allowZero: true },
	);
}

function readAgentsBridgeMaxPerUser(): number {
	return resolvePositiveIntEnv(
		readNodeProcessEnv("AGENTS_BRIDGE_MAX_PER_USER"),
		CONCURRENCY_DEFAULTS.bridgeMaxPerUser,
	);
}

function toAbortError(signal?: AbortSignal): Error {
	const reason = signal?.reason;
	if (reason instanceof Error) return reason;
	const text = typeof reason === "string" ? reason.trim() : "";
	return new Error(text || "agents_bridge_request_aborted");
}

function throwIfAbortSignalAborted(signal?: AbortSignal): void {
	if (!signal?.aborted) return;
	throw toAbortError(signal);
}

function readAgentsBridgeAdmissionTimeoutMs(c: AppContext): number {
	const raw =
		typeof c.env.AGENTS_BRIDGE_ADMISSION_TIMEOUT_MS === "string"
			? c.env.AGENTS_BRIDGE_ADMISSION_TIMEOUT_MS
			: "";
	const parsed = Number(raw);
	if (Number.isFinite(parsed) && parsed > 0) {
		return Math.max(5_000, Math.min(120_000, Math.floor(parsed)));
	}
	// Admission covers bridge-side prelude plus the inherited-model input gate.
	// The gate has a bounded 60s wall clock; keep explicit transport headroom so
	// a slower parent model can return its real verdict instead of being mislabeled
	// as an admission failure by this outer request.
	return 90_000;
}

async function runAgentsBridgeQueued<T>(
	c: AppContext,
	task: () => Promise<T>,
	options: Readonly<{
		signal?: AbortSignal;
		userId?: string;
		priority?: AgentsBridgeAdmissionPriority;
	}> = {},
): Promise<T> {
	return agentsBridgeAdmissionScheduler.run({
		...(options.userId ? { userId: options.userId } : {}),
		...(options.priority ? { priority: options.priority } : {}),
		limits: {
			maxConcurrency: readAgentsBridgeMaxConcurrency(c),
			maxQueueDepth: readAgentsBridgeMaxQueueDepth(),
			maxPerUser: readAgentsBridgeMaxPerUser(),
		},
		...(options.signal ? { signal: options.signal } : {}),
		task,
	});
}

function normalizeAgentsBridgeReferenceImages(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	const out: string[] = [];
	const seen = new Set<string>();
	for (const item of value) {
		if (typeof item !== "string") continue;
		const trimmed = item.trim();
		if (!trimmed) continue;
		if (!isHttpAssetUrl(trimmed)) continue;
		if (trimmed.length > 2048) continue;
		if (seen.has(trimmed)) continue;
		seen.add(trimmed);
		out.push(trimmed);
	}
	return out;
}

function normalizeAgentsBridgeAssetRole(value: unknown): AgentsBridgeAssetRole {
	const role = typeof value === "string" ? value.trim().toLowerCase() : "";
	switch (role) {
		case "target":
		case "reference":
		case "character":
		case "scene":
		case "prop":
		case "product":
		case "style":
		case "context":
		case "mask":
			return role;
		default:
			return "reference";
	}
}

function normalizeAgentsBridgeAssetInputs(value: unknown): AgentsBridgeAssetInput[] {
	if (!Array.isArray(value)) return [];
	const out: AgentsBridgeAssetInput[] = [];
	const seen = new Set<string>();
	for (const item of value) {
		if (!item || typeof item !== "object") continue;
		const obj = item as Record<string, unknown>;
		const url = typeof obj.url === "string" ? obj.url.trim() : "";
		if (!url || !isHttpAssetUrl(url) || url.length > 2048) continue;
		const role = normalizeAgentsBridgeAssetRole(obj.role);
		const mediaType = obj.mediaType === "video" ? "video" : "image";
		const nodeId =
			typeof obj.nodeId === "string" && obj.nodeId.trim()
				? obj.nodeId.trim().slice(0, 160)
				: "";
		const dedupeKey = `${mediaType}|${role}|${nodeId}|${url}`;
		if (seen.has(dedupeKey)) continue;
		seen.add(dedupeKey);
		const assetId =
			typeof obj.assetId === "string" && obj.assetId.trim()
				? obj.assetId.trim().slice(0, 120)
				: "";
		const assetRefId =
			typeof obj.assetRefId === "string" && obj.assetRefId.trim()
				? obj.assetRefId.trim().slice(0, 160)
				: "";
		const note =
			typeof obj.note === "string" && obj.note.trim()
				? obj.note.trim().slice(0, 500)
				: "";
		const name =
			typeof obj.name === "string" && obj.name.trim()
				? obj.name.trim().slice(0, 160)
				: "";
		const weightRaw = Number(obj.weight);
		const weight =
			Number.isFinite(weightRaw) && weightRaw >= 0 && weightRaw <= 1
				? weightRaw
				: undefined;
		out.push({
			...(nodeId ? { nodeId } : {}),
			...(assetId ? { assetId } : {}),
			...(assetRefId ? { assetRefId } : {}),
			url,
			mediaType,
			role,
			...(typeof weight === "number" ? { weight } : {}),
			...(note ? { note } : {}),
			...(name ? { name } : {}),
		});
		if (out.length >= 12) break;
	}
	return out;
}

function normalizeRequiredSkills(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	const out: string[] = [];
	const seen = new Set<string>();
	for (const item of value) {
		const name = String(item || "").trim();
		if (!name) continue;
		if (name.length > 120) continue;
		if (seen.has(name)) continue;
		seen.add(name);
		out.push(name);
		if (out.length >= 8) break;
	}
	return out;
}

function normalizeAgentBridgeModelField(value: unknown): string | null {
	const text = typeof value === "string" ? value.trim() : "";
	if (!text) return null;
	return text.slice(0, 200);
}

function readTrimmedString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function asRecord(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	return value as Record<string, unknown>;
}

function sanitizePathSegmentForBookIndex(value: string): string {
	return String(value || "").trim().replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
}

function buildScopedProjectBooksRoot(projectId: string, userId: string): string {
	return path.join(
		resolveProjectDataRepoRoot(),
		"project-data",
		"users",
		sanitizePathSegmentForBookIndex(userId),
		"projects",
		sanitizePathSegmentForBookIndex(projectId),
		"books",
	);
}

async function resolveReadableBookIndexPath(input: {
	userId: string;
	projectId: string;
	bookId: string;
}): Promise<string | null> {
	const indexPath = path.join(
		buildScopedProjectBooksRoot(input.projectId, input.userId),
		sanitizePathSegmentForBookIndex(input.bookId),
		"index.json",
	);
	try {
		await readBookIndex(indexPath);
		return indexPath;
	} catch (error) {
		if (error instanceof BookIndexStoreError && error.code === "book_index_not_found") return null;
		if (error instanceof BookIndexStoreError) {
			throw new AppError(error.message, {
				status: 500,
				code: error.code,
				details: error.details,
			});
		}
		throw error;
	}
}

async function resolveReadableBookDirectoryPath(input: {
	userId: string;
	projectId: string;
	bookId: string;
}): Promise<string | null> {
	const indexPath = await resolveReadableBookIndexPath(input);
	return indexPath ? path.dirname(indexPath) : null;
}

async function readBookIndexMeta(input: {
	userId: string;
	projectId: string;
	bookId: string;
}): Promise<BookIndexMeta | null> {
	const indexPath = path.join(
		buildScopedProjectBooksRoot(input.projectId, input.userId),
		sanitizePathSegmentForBookIndex(input.bookId),
		"index.json",
	);
	try {
		return (await readBookIndex(indexPath)) as BookIndexMeta;
	} catch (error) {
		if (error instanceof BookIndexStoreError && error.code === "book_index_not_found") return null;
		if (error instanceof BookIndexStoreError) {
			throw new AppError(error.message, {
				status: 500,
				code: error.code,
				details: error.details,
			});
		}
		throw error;
	}
}

async function listProjectBookCandidates(input: {
	userId: string;
	projectId: string;
}): Promise<ProjectBookCandidate[]> {
	const roots = [buildScopedProjectBooksRoot(input.projectId, input.userId)];
	const out: ProjectBookCandidate[] = [];
	const seen = new Set<string>();
	for (const root of roots) {
		let entries: Array<{ name: string; isDirectory: () => boolean }> = [];
		try {
			entries = await fs.readdir(root, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			const bookId = String(entry.name || "").trim();
			if (!bookId || seen.has(bookId)) continue;
			const indexData = await readBookIndexMeta({
				userId: input.userId,
				projectId: input.projectId,
				bookId,
			});
			seen.add(bookId);
			out.push({
				bookId,
				title:
					typeof indexData?.title === "string" && indexData.title.trim()
						? indexData.title.trim()
						: null,
			});
		}
	}
	return out;
}

async function resolveProjectBookReference(input: {
	userId: string;
	projectId: string;
	requestedRef: string;
}): Promise<ResolvedProjectBookRef | null> {
	const requestedRef = String(input.requestedRef || "").trim();
	if (!requestedRef) return null;
	const directIndex = await readBookIndexMeta({
		userId: input.userId,
		projectId: input.projectId,
		bookId: requestedRef,
	});
	if (directIndex) {
		return {
			requestedRef,
			bookId: requestedRef,
			title:
				typeof directIndex.title === "string" && directIndex.title.trim()
					? directIndex.title.trim()
					: null,
			matchedBy: "book_id",
		};
	}
	const candidates = await listProjectBookCandidates({
		userId: input.userId,
		projectId: input.projectId,
	});
	const exactTitleMatches = candidates.filter(
		(candidate) => candidate.title && candidate.title === requestedRef,
	);
	if (exactTitleMatches.length === 1) {
		const matched = exactTitleMatches[0]!;
		return {
			requestedRef,
			bookId: matched.bookId,
			title: matched.title,
			matchedBy: "title",
		};
	}
	if (exactTitleMatches.length > 1) {
		throw new AppError("书籍引用不唯一：同项目下存在多个同名书籍，无法确定 bookId", {
			status: 409,
			code: "project_book_ref_ambiguous",
			details: {
				projectId: input.projectId,
				requestedRef,
				matches: exactTitleMatches.map((item) => ({
					bookId: item.bookId,
					title: item.title,
				})),
			},
		});
	}
	return null;
}

function readRequestHeader(c: AppContext, key: string): string {
	const v = c.req.header(key);
	return typeof v === "string" ? v.trim() : "";
}

export function resolveEffectiveUserId(c: AppContext, inputUserId: string): string {
	const direct = String(inputUserId || "").trim();
	if (direct) return direct;
	const fromCtxUserId = String(c.get("userId") || "").trim();
	if (fromCtxUserId) return fromCtxUserId;
	const fromCtxApiKeyOwnerId = String(c.get("apiKeyOwnerId") || "").trim();
	if (fromCtxApiKeyOwnerId) return fromCtxApiKeyOwnerId;
	const fromHeader =
		readRequestHeader(c, "x-agents-user-id") ||
		readRequestHeader(c, "x-user-id") ||
		readRequestHeader(c, "x-api-key-owner-id");
	return fromHeader;
}

function sanitizePathSegmentForAgents(raw: string): string {
	return String(raw || "")
		.trim()
		.replace(/[^a-zA-Z0-9._-]/g, "_")
		.slice(0, 120);
}

function normalizeLocalResourcePathForAgents(value: string): string | null {
	const raw = String(value || "").trim();
	if (!raw) return null;
	return raw.replace(/\\/g, "/").replace(/\/{2,}/g, "/");
}

const RUNTIME_REFERENCE_CONTEXT_START_TAG = "<tapcanvas_runtime_reference_context>";
const RUNTIME_REFERENCE_CONTEXT_END_TAG = "</tapcanvas_runtime_reference_context>";

function decoratePromptWithReferenceImages(
	prompt: string,
	referenceImages: string[],
	assetInputs: AgentsBridgeAssetInput[],
	referenceImageSlots: AgentsBridgeReferenceImageSlot[],
	selectedReference: AgentsBridgeChatContext["selectedReference"],
): string {
	const rawBase = typeof prompt === "string" ? prompt : "";
	const identityByUrl = new Map<string, string>();
	for (const [index, item] of assetInputs.entries()) {
		const url = String(item.url || "").trim();
		if (!url || identityByUrl.has(url)) continue;
		const parts = [`媒体引用#${index + 1}`, `mediaType=${item.mediaType}`];
		if (item.name) parts.push(`name=${item.name}`);
		if (item.nodeId) parts.push(`nodeId=${item.nodeId}`);
		if (item.assetId) parts.push(`assetId=${item.assetId}`);
		if (item.assetRefId) parts.push(`assetRefId=${item.assetRefId}`);
		identityByUrl.set(url, `[${parts.join(" | ")}]`);
	}
	const base = redactHttpImageUrls(
		rawBase,
		(url) =>
			identityByUrl.get(url) ||
			"[图片引用已隐藏；调用方未提供可验证的节点或资产 ID]",
	);
	const selectedReferenceParts = selectedReference
		? [
				selectedReference.nodeId ? `nodeId=${selectedReference.nodeId}` : "",
				selectedReference.label ? `label=${selectedReference.label}` : "",
				selectedReference.kind ? `kind=${selectedReference.kind}` : "",
				selectedReference.roleName ? `roleName=${selectedReference.roleName}` : "",
				selectedReference.roleCardId ? `roleCardId=${selectedReference.roleCardId}` : "",
				selectedReference.bookId ? `bookId=${selectedReference.bookId}` : "",
				selectedReference.chapterId ? `chapterId=${selectedReference.chapterId}` : "",
				typeof selectedReference.shotNo === "number"
					? `shotNo=${selectedReference.shotNo}`
					: "",
				selectedReference.productionLayer
					? `productionLayer=${selectedReference.productionLayer}`
					: "",
				selectedReference.creationStage
					? `creationStage=${selectedReference.creationStage}`
					: "",
				selectedReference.approvalStatus
					? `approvalStatus=${selectedReference.approvalStatus}`
					: "",
				selectedReference.authorityBaseFrameNodeId
					? `authorityBaseFrameNodeId=${selectedReference.authorityBaseFrameNodeId}`
					: "",
				selectedReference.authorityBaseFrameStatus
					? `authorityBaseFrameStatus=${selectedReference.authorityBaseFrameStatus}`
					: "",
		  ].filter(Boolean)
		: [];
	const anchorBindingLines = (selectedReference?.anchorBindings || []).map(
		(binding, index) => {
			const parts = [
				`#${index + 1}`,
				`kind=${binding.kind}`,
				binding.refId ? `refId=${binding.refId}` : "",
				binding.entityId ? `entityId=${binding.entityId}` : "",
				binding.label ? `label=${binding.label}` : "",
				binding.sourceBookId ? `sourceBookId=${binding.sourceBookId}` : "",
				binding.sourceNodeId ? `sourceNodeId=${binding.sourceNodeId}` : "",
				binding.assetId ? `assetId=${binding.assetId}` : "",
				binding.assetRefId ? `assetRefId=${binding.assetRefId}` : "",
				binding.referenceView ? `referenceView=${binding.referenceView}` : "",
				binding.category ? `category=${binding.category}` : "",
				binding.note ? `note=${binding.note}` : "",
			].filter(Boolean);
			return `- ${parts.join(" | ")}`;
		},
	);
	if (
		!referenceImages.length &&
		!assetInputs.length &&
		selectedReferenceParts.length === 0 &&
		anchorBindingLines.length === 0
	) {
		return base;
	}
	if (base.includes(RUNTIME_REFERENCE_CONTEXT_START_TAG)) return base;
	const blocks: string[] = [
		"【引用事实边界】",
		"- 媒体存储 URL 已脱敏；以下仅列调用方显式提供的身份事实。不得伪造节点、资产或 URL。",
		"",
	];
	if (assetInputs.length) {
		blocks.push(
			"【媒体资产输入】",
			...assetInputs.map((item, idx) => {
				const parts = [
					`#${idx + 1}`,
					`mediaType=${item.mediaType}`,
					`role=${item.role}`,
					item.nodeId ? `nodeId=${item.nodeId}` : "",
					item.assetId ? `assetId=${item.assetId}` : "",
					item.assetRefId ? `assetRefId=${item.assetRefId}` : "",
					typeof item.weight === "number" ? `weight=${item.weight}` : "",
					item.name ? `name=${item.name}` : "",
					item.note ? `note=${item.note}` : "",
				].filter(Boolean);
				return `- ${parts.join(" | ")}`;
			}),
			"",
		);
	}
	if (referenceImageSlots.length) {
		blocks.push(
			"【参考图位】",
			...referenceImageSlots.map((slot) => {
				const parts = [slot.slot];
				if (slot.referenceId) parts.push(`referenceId=${slot.referenceId}`);
				if (slot.nodeId) parts.push(`nodeId=${slot.nodeId}`);
				if (slot.assetId) parts.push(`assetId=${slot.assetId}`);
				if (slot.assetRefId) parts.push(`assetRefId=${slot.assetRefId}`);
				if (slot.role) parts.push(`role=${slot.role}`);
				if (slot.label) parts.push(`label=${slot.label}`);
				if (slot.note) parts.push(`note=${slot.note}`);
				return `- ${parts.join(" | ")}`;
			}),
			"",
		);
	} else if (referenceImages.length) {
		blocks.push(
			"【参考图】",
			`- 已绑定 ${referenceImages.length} 张内部图片资产；存储 URL 不向主模型公开。`,
			"",
		);
	}
	if (selectedReferenceParts.length > 0) {
		blocks.push("【已选引用】", `- ${selectedReferenceParts.join(" | ")}`, "");
	}
	if (anchorBindingLines.length > 0) {
		blocks.push("【锚点绑定】", ...anchorBindingLines, "");
	}
	const runtimeReferenceContext = [
		RUNTIME_REFERENCE_CONTEXT_START_TAG,
		...blocks,
		RUNTIME_REFERENCE_CONTEXT_END_TAG,
	].join("\n");
	return [runtimeReferenceContext, base].filter(Boolean).join("\n\n");
}

export function readAgentsBridgeBaseUrl(c: AppContext): string {
	const rawFromEnv =
		typeof c.env.AGENTS_BRIDGE_BASE_URL === "string"
			? c.env.AGENTS_BRIDGE_BASE_URL
			: "";
	const rawFromProcess =
		readNodeProcessEnv("AGENTS_BRIDGE_BASE_URL");
	const raw = rawFromEnv || rawFromProcess;
	return raw.trim().replace(/\/+$/, "");
}

export function readTapCanvasApiBaseFromEnv(c: AppContext): string {
	const rawInternal =
		typeof c.env.TAPCANVAS_API_INTERNAL_BASE === "string"
			? c.env.TAPCANVAS_API_INTERNAL_BASE
			: "";
	const rawBase =
		typeof c.env.TAPCANVAS_API_BASE_URL === "string"
			? c.env.TAPCANVAS_API_BASE_URL
			: "";
	const rawProcessInternal =
		readNodeProcessEnv("TAPCANVAS_API_INTERNAL_BASE");
	const rawProcessBase =
		readNodeProcessEnv("TAPCANVAS_API_BASE_URL");
	const raw = rawInternal || rawBase || rawProcessInternal || rawProcessBase;
	if (!raw.trim()) {
		console.error(JSON.stringify({
			message: "agents_remote_tool_callback_base_unavailable",
			requestUrl: c.req.url,
			nodeRuntime: isNodeRuntime(),
			contextInternalBasePresent: Boolean(rawInternal),
			contextBaseUrlPresent: Boolean(rawBase),
			processInternalBasePresent: Boolean(rawProcessInternal),
			processBaseUrlPresent: Boolean(rawProcessBase),
		}));
	}
	return raw.trim().replace(/\/+$/, "");
}

export function assertAgentsRemoteToolCallbackBase(input: {
	baseUrl: string;
	remoteToolCount: number;
}): void {
	if (input.remoteToolCount <= 0 || input.baseUrl.trim()) return;
	throw new AppError(
		"Agents 远程工具回调地址未配置：必须显式设置 TAPCANVAS_API_INTERNAL_BASE 或 TAPCANVAS_API_BASE_URL。",
		{
			status: 503,
			code: "agents_remote_tool_callback_base_missing",
			details: {
				requiredEnv: [
					"TAPCANVAS_API_INTERNAL_BASE",
					"TAPCANVAS_API_BASE_URL",
				],
			},
		},
	);
}

function buildTapCanvasFlowPatchDescription(input: {
	hideStoryboardEditor: boolean;
}): string {
	const imageLikeKinds = input.hideStoryboardEditor
		? "image / imageEdit / storyboardImage"
		: "image / storyboard";
	return [
		"Patch flow nodes/edges/data/arrays.",
		`createNodes: ${REMOTE_FLOW_CREATE_NODE_TYPES.join(" / ")}. 分镜表 / shot table requires data.kind='shotTable' plus valid data.shotTable; content/prompt/Markdown cannot replace it. storyboardScript is text only.`,
		"Use real IDs/handles. Child positions are parent-relative.",
		"Bind media by node/asset IDs or edges; never persist media URLs in prompts/data.",
		`Chapter ${imageLikeKinds} / video / composeVideo needs productionLayer, creationStage, approvalStatus and productionMetadata.`,
		"Preserve spatialBlocking provenance.",
		"patchNodeData merges; appendNodeArrays appends; replacing non-null data needs allowOverwrite=true.",
		"Returns stats/IDs only.",
	].join(" ");
}

const shotTableNodeDataSchema = {
	type: "object",
	description:
		"Required for kind='shotTable': {version:1,overview:Record<string,string>,columns:Array<{key,label,scope:'shot'|'timeline'}>,rows:Array<{id,shotId,values:Record<string,string>}>}. Markdown cannot replace it.",
} as const;

function compactRemoteTools(
	tools: AgentsBridgeRemoteToolDefinition[],
): Array<{ name: string; description: string; parameters?: Record<string, unknown>; execution?: import("../ai/tool-schemas").ToolExecutionSemantics }> {
	return tools.map(({ name, description, parameters, execution }) => ({
		name,
		description,
		...(parameters ? { parameters: parameters as Record<string, unknown> } : {}),
		...(execution ? { execution } : {}),
	}));
}

export function compactRemoteToolCatalog(
	tools: Array<AgentsBridgeRemoteToolCatalogEntry<AgentsBridgeRemoteToolDefinition>>,
): Array<
	AgentsBridgeRemoteToolCatalogEntry<{
		name: string;
		description: string;
		execution?: import("../ai/tool-schemas").ToolExecutionSemantics;
		parameters?: Record<string, unknown>;
	}> & {
		operationExecutions?: Array<{
			selector: { field: string; value: string };
			execution: ToolOperationExecution;
		}>;
	}
> {
	const compactDescription = (description: string, capability: string): string => {
		// The model only receives the generic schema-loader/call tools. The cold
		// catalog remains an authorization index, but it must retain enough of the
		// real tool contract to distinguish image generation from image inspection
		// before asking for the exact schema. Full parameters are still fetched only
		// after the model selects one exact name.
		const normalized = description.trim();
		const preview = normalized.length > 280
			? `${normalized.slice(0, 280)}…`
			: normalized;
		return `${preview || "Authorized catalog tool"} [capability=${capability}]`;
	};
	return tools.map(
		({ name, description: _description, parameters, execution, requiredScope, capability }) => {
			const operationIndex = parameters
				? readToolSchemaOperationIndex(parameters as Record<string, unknown>)
				: null;
			const operationExecutions = operationIndex
				? operationIndex.values.flatMap((value) => {
					const operationExecution = readToolOperationExecution({
						parameters: parameters as Record<string, unknown>,
						selector: { field: operationIndex.field, value },
					}) ?? execution ?? null;
					return operationExecution
						? [{
							selector: { field: operationIndex.field, value },
							execution: operationExecution,
						}]
						: [];
				})
				: [];
			return {
				name,
				description: compactDescription(_description, capability),
				// Catalog schemas are fetched only when the agent asks for this exact
				// tool. Keeping the name/description/scope contract here preserves
				// authorization while avoiding the full parameter tree on every chat
				// request.
				schemaDeferred: true,
				descriptionDeferred: true,
				...(execution ? { execution } : {}),
				...(operationExecutions.length > 0 ? { operationExecutions } : {}),
				requiredScope,
				capability,
			};
		},
	);
}

function buildRemoteToolSchemas(
	tools: AgentsBridgeRemoteToolDefinition[],
): Record<string, Record<string, unknown>> {
	const out: Record<string, Record<string, unknown>> = {};
	for (const tool of tools) {
		if (tool.parameters) out[tool.name] = tool.parameters as Record<string, unknown>;
	}
	return out;
}

export function normalizeChapterCanvasIntent(value: unknown): AgentsBridgeChapterCanvasIntent | null {
	const raw = typeof value === "string" ? value.trim() : "";
	if (
		raw === "extract_roles" ||
		raw === "expand_video_script" ||
		raw === "generate_shot_placeholders" ||
		raw === "generate_scene_references" ||
		raw === "generate_video_nodes" ||
		raw === "generate_group_storyboard"
	) {
		return raw;
	}
	return null;
}

function attachRemoteToolExecutionSemantics(
	tool: AgentsBridgeRemoteToolDefinition,
): AgentsBridgeRemoteToolDefinition {
	return {
		...tool,
		execution: readRemoteToolCapabilityRegistryEntry(tool.name).execution,
	};
}

export type AgentsBridgeRemoteToolsInput = {
	publicAgentsRequest: boolean;
	canvasProjectId: string | null;
	canvasFlowId: string | null;
	canvasNodeId?: string | null;
	bookId?: string | null;
	chapterId?: string | null;
	executionId?: string | null;
	hideStoryboardEditor?: boolean;
	adminWorkflowAccess?: boolean;
	/**
	 * Machine-owned continuation of an already accepted workflow family. This
	 * exposes only the family resume protocol; it never re-enables the admin
	 * start surface or permits a second equipped-workflow submission.
	 */
	workflowRecoveryAccess?: boolean;
	disabledBuiltInCapabilities?: readonly string[];
	enabledVideoModelKeys?: readonly string[];
	enabledImageModelKeys?: readonly string[];
	equippedWorkflows?: readonly Readonly<{
		attachmentId: string;
		name: string;
		summary: string;
		invocation?: Readonly<{
			sourceMode: "inline_text" | "canvas_group" | "project_context" | "none";
			requiredTriggerPayloadFields: readonly string[];
			executionVariant?: "full_video" | "first_video";
		}>;
		primaryForCapabilities?: readonly Readonly<{
			capabilityId: string;
			name: string;
			description: string;
		}>[];
	}>[];
};

export function filterEquippedWorkflowsByExecutionVariant<
	T extends Readonly<{
		descriptor: Readonly<{ invocation?: Readonly<{ executionVariant?: "full_video" | "first_video" }> }>;
		primaryForCapabilities?: readonly Readonly<{ capabilityId: string }>[];
	}>,
>(
	workflows: readonly T[],
	requestedVariant: "full_video" | "first_video" | null,
): T[] {
	if (requestedVariant) {
		return workflows.filter(
			(workflow) => workflow.descriptor.invocation?.executionVariant === requestedVariant,
		);
	}
	return workflows.filter((workflow) => (
		workflow.descriptor.invocation?.executionVariant === undefined ||
		(workflow.primaryForCapabilities?.length ?? 0) > 0
	));
}

export type AgentsPrimaryCapabilityRoute = Readonly<{
	capabilityId: string;
	toolName: "tapcanvas_equipped_workflow_run";
	attachmentId: string;
}>;

type EquippedWorkflowVideoCapability = Readonly<{
	invocation?: Readonly<{
		requiredTriggerPayloadFields: readonly string[];
	}>;
}>;

/**
 * The pinned workflow descriptor derives this requirement from its actual
 * executor graph. Its canonical model must be selected from the live catalog
 * before admission; the workflow runtime never guesses or silently falls back
 * to an account-wide default.
 */
export function equippedWorkflowRequiresVideoModel(
	workflow: EquippedWorkflowVideoCapability,
): boolean {
	return (workflow.invocation?.requiredTriggerPayloadFields ?? [])
		.some((field) => field.trim() === "videoModelKey");
}

export function equippedWorkflowRequiresImageModel(
	workflow: EquippedWorkflowVideoCapability,
): boolean {
	return (workflow.invocation?.requiredTriggerPayloadFields ?? [])
		.some((field) => field.trim() === "imageModelKey");
}

function equippedWorkflowRequiredTriggerFields(
	workflow: NonNullable<AgentsBridgeRemoteToolsInput["equippedWorkflows"]>[number],
): string[] {
	return [...new Set([
		...(workflow.invocation?.requiredTriggerPayloadFields ?? []),
	])];
}


function buildEquippedWorkflowSchemaBranch(
	workflow: NonNullable<AgentsBridgeRemoteToolsInput["equippedWorkflows"]>[number],
	requiresAttachmentSelection: boolean,
): Record<string, unknown> {
	const triggerRequired = equippedWorkflowRequiredTriggerFields(workflow);
	return {
		type: "object",
		properties: {
			...(requiresAttachmentSelection
				? { attachmentId: { type: "string", const: workflow.attachmentId } }
				: {}),
			...(triggerRequired.length > 0
				? {
					triggerPayload: {
						type: "object",
						required: triggerRequired,
					},
				}
				: {}),
		},
		required: [
			...(requiresAttachmentSelection ? ["attachmentId"] : []),
			...(triggerRequired.length > 0 ? ["triggerPayload"] : []),
		],
	};
}

const NON_REPLACEABLE_BUILT_IN_CAPABILITY_IDS = new Set(
	listBuiltInSmallTCapabilities()
		.filter((capability) => capability.replaceable === false)
		.map((capability) => capability.id),
);

const listReplaceablePrimaryCapabilities = (
	capabilities: NonNullable<
		NonNullable<AgentsBridgeRemoteToolsInput["equippedWorkflows"]>[number]["primaryForCapabilities"]
	>,
) => capabilities.filter(
	(capability) => !NON_REPLACEABLE_BUILT_IN_CAPABILITY_IDS.has(capability.capabilityId.trim()),
);

/**
 * Projects confirmed capability-bay replacement decisions into a compact
 * runtime route. This reads persisted machine facts only; workflow names and
 * user prompt text never participate in route selection.
 */
export function buildEquippedWorkflowPrimaryCapabilityRoutes(
	equippedWorkflows: AgentsBridgeRemoteToolsInput["equippedWorkflows"],
): AgentsPrimaryCapabilityRoute[] {
	if (!equippedWorkflows) return [];
	const routes = new Map<string, AgentsPrimaryCapabilityRoute>();
	for (const workflow of equippedWorkflows) {
		const attachmentId = workflow.attachmentId.trim();
		if (!attachmentId) continue;
		for (const capability of listReplaceablePrimaryCapabilities(workflow.primaryForCapabilities ?? [])) {
			const capabilityId = capability.capabilityId.trim();
			if (!capabilityId) continue;
			routes.set(`${capabilityId}\u0000${attachmentId}`, {
				capabilityId,
				toolName: "tapcanvas_equipped_workflow_run",
				attachmentId,
			});
		}
	}
	return Array.from(routes.values()).sort((left, right) =>
		left.capabilityId.localeCompare(right.capabilityId) ||
		left.attachmentId.localeCompare(right.attachmentId),
	);
}

function buildWorkflowResumeParameters(): Record<string, unknown> {
	const sourceExecutionId = { type: "string", minLength: 1 } as const;
	const branch = (
		propertyName: "providerBalanceRestored" | "cancellationRevoked" | "agentModelCutover" | "definitionCutover" | null,
		propertySchema?: Record<string, unknown>,
	): Record<string, unknown> => ({
		type: "object",
		properties: {
			sourceExecutionId,
			...(propertyName && propertySchema ? { [propertyName]: propertySchema } : {}),
		},
		required: ["sourceExecutionId", ...(propertyName ? [propertyName] : [])],
		additionalProperties: false,
	});
	return {
		type: "object",
		oneOf: [
			branch(null),
			branch("providerBalanceRestored", {
				type: "boolean",
				const: true,
				description: "Set only after the user explicitly confirms that the same provider/channel balance has been restored. Keeps the frozen model and API style unchanged.",
			}),
			branch("cancellationRevoked", {
				type: "boolean",
				const: true,
				description: "Set only after the user explicitly revokes the latest cancellation and asks to continue that same logical workflow family.",
			}),
			branch("agentModelCutover", {
				type: "object",
				properties: {
					targetModelKey: { type: "string", minLength: 1 },
					apiStyle: { type: "string", enum: ["chat", "responses"] },
				},
				required: ["targetModelKey", "apiStyle"],
				additionalProperties: false,
			}),
			branch("definitionCutover", {
				type: "object",
				properties: { mode: { type: "string", const: "current_flow" } },
				required: ["mode"],
				additionalProperties: false,
				description: "Use only after explicit user authorization to apply the already-persisted current workflow configuration to this same failed family. Topology and invocation facts remain frozen.",
			}),
		],
	};
}

function buildEquippedWorkflowRunTool(
	equippedWorkflows: AgentsBridgeRemoteToolsInput["equippedWorkflows"],
	enabledVideoModelKeysInput: readonly string[] | undefined,
	enabledImageModelKeysInput: readonly string[] | undefined,
): AgentsBridgeRemoteToolDefinition | null {
	if (!equippedWorkflows || equippedWorkflows.length === 0) return null;
	const commonRequiredTriggerFields = equippedWorkflows.length > 0
		? equippedWorkflows.reduce<string[] | null>((common, workflow) => {
			const fields = equippedWorkflowRequiredTriggerFields(workflow);
			if (common === null) return [...fields];
			return common.filter((field) => fields.includes(field));
		}, null) ?? []
		: [];
	const enabledVideoModelKeys = [...new Set((enabledVideoModelKeysInput ?? [])
		.map((modelKey) => modelKey.trim())
		.filter(Boolean))].sort();
	const enabledImageModelKeys = [...new Set((enabledImageModelKeysInput ?? [])
		.map((modelKey) => modelKey.trim())
		.filter(Boolean))].sort();
	const requiresAttachmentSelection = equippedWorkflows.length > 1;
	return {
		name: "tapcanvas_equipped_workflow_run",
				description: [
			requiresAttachmentSelection
				? "Run one workflow that the current user explicitly equipped in 小T 能力舱. Select only from the attachment IDs declared in this tool schema; the server pins the saved workflow version and trigger. idempotencyKey is mandatory."
				: "Run the only workflow currently equipped for this scope in 小T 能力舱. The server binds its exact attachment ID from persisted capability facts; do not submit attachmentId. The server pins the saved workflow version and trigger. idempotencyKey is mandatory.",
			...equippedWorkflows.map((item) => {
				const primaryFor = listReplaceablePrimaryCapabilities(item.primaryForCapabilities ?? []);
				const invocation = item.invocation;
				const requiredTriggerFields = equippedWorkflowRequiredTriggerFields(item);
				return [
					`- ${item.attachmentId}: ${item.name}${item.summary ? ` — ${item.summary}` : ""}`,
					invocation || requiredTriggerFields.length > 0
						? `  本工作流的真实输入契约：sourceMode=${invocation?.sourceMode ?? "none"}${invocation?.executionVariant ? `；videoVariant=${invocation.executionVariant}` : ""}；${requiredTriggerFields.length > 0 ? `triggerPayload 必须提供 ${requiredTriggerFields.join("、")}。` : "无需额外 triggerPayload 字段。"}`
						: "",
					primaryFor.length > 0
						? `  用户已确认该工作流是这些能力的主路径替代：${primaryFor.map((capability) => `${capability.capabilityId}（${capability.name}）`).join("、")}。`
						: "",
				].filter(Boolean).join("\n");
			}),
			"每次调用都会真实启动或幂等认领一个持久工作流执行，不存在 schema-only、dry-run 或 preflight 模式。本工具已携带本轮精确参数结构，不得在调用前再调用 tapcanvas_get_tool_schema，也不得以测试性 idempotencyKey 调用本工具。每个逻辑任务只调用一次，并在所有物理续跑中复用同一个稳定 idempotencyKey；受理后只能观察已返回的 execution，不得更换 key 创建替代执行。",
			"一键成片只使用当前已装配的 Workflow IR 作为端到端主动作。底层媒体工具只由工作流节点消费，不得从根代理建立平行生产链。attachment 的 requiredTriggerPayloadFields 是按次必须提供字段的唯一结构来源；未列出的模型与规格由已装配 Workflow IR 的权威配置提供。videoModelKey、videoResolution、videoAspectRatio 与 imageModelKey、imageAspectRatio、imageSize 是从本轮实时 enabled catalog 选择的执行事实；UserIntentContract 已冻结的用户规格是这些事实必须满足的约束，不得把账号偏好、历史 run 或静态默认值冒充用户选择。",
			"服务端会在每次调用时动态冻结当前 ProjectContext（项目、画布、选择、时间线、权限和可见资产 ID 快照）。必须遵守所选 attachment 上方声明的真实输入契约：inline_text 提供 source，canvas_group 提供 sourceGroupId；standalone 公开画布聊天调用 project_context 时省略来源字段，服务端以本轮不可变 accepted user turn 作为唯一来源；章节或非聊天调用 project_context 才读取当前选择或唯一就绪文本来源。triggerPayload 只携带 requiredTriggerPayloadFields、选择范围，以及用户明确冻结的 targetDurationSeconds、requestedClipCount、requestedClipDurationsSeconds。只有用户明确指定物理 clip 数量时才传 requestedClipCount；同时明确每段时长时，还必须把有序时长原样传入 requestedClipDurationsSeconds，数组长度必须等于 requestedClipCount、总和必须等于 targetDurationSeconds。不得从题材或总时长推断这些用户规格；运行规格只按 requiredTriggerPayloadFields 从实时目录选择。资产全链路只传 asset_id + project_id；不要传临时 URL，执行节点会通过 Asset Resolver 在消费时解析并校验权限/状态。",
		].join("\n"),
		parameters: {
			type: "object",
			oneOf: equippedWorkflows.map((workflow) =>
				buildEquippedWorkflowSchemaBranch(workflow, requiresAttachmentSelection)),
			properties: {
				...(requiresAttachmentSelection
					? {
						attachmentId: {
							type: "string",
							enum: equippedWorkflows.map((item) => item.attachmentId),
						},
					}
					: {}),
				idempotencyKey: { type: "string", minLength: 1 },
				triggerPayload: {
					type: "object",
					description: "按次触发参数。source 与 sourceGroupId 不可互换；必须遵守所选 attachment 的真实输入契约。",
					properties: {
						source: { type: "string", description: "仅供 sourceMode=inline_text 的工作流使用：本次故事事实与叙事节拍。不得在这里把剧情阶段数量写成物理视频 clip 拓扑；物理 clip 由工作流按实时模型能力冻结。" },
						sourceGroupId: { type: "string", description: "调用者当前画布内的源组 id；绑定调用者项目已选节点（文本 + 已就绪图片/视频）作为本次源与参考资产，供工作流复用。" },
						selectedAssetIds: { type: "array", items: { type: "string" }, description: "当前明确选中的稳定资产 ID；服务端会过滤掉无权限或跨项目 ID。" },
						selectedNodeIds: { type: "array", items: { type: "string" }, description: "当前多选的画布节点 ID。" },
						targetDurationSeconds: { type: "number", description: "目标成片总时长（秒）；仅声明总量，不声明 clip 分段。" },
						requestedClipCount: { type: "number", minimum: 1, description: "用户明确指定的物理 clip 数量；未明确指定时必须省略。" },
						requestedClipDurationsSeconds: { type: "array", minItems: 1, maxItems: 64, items: { type: "number", minimum: 1 }, description: "用户明确指定的逐物理 clip 有序时长（秒）；未逐段指定时必须省略。长度必须等于 requestedClipCount，总和必须等于 targetDurationSeconds。" },
						videoModelKey: {
							type: "string",
							minLength: 1,
							...(enabledVideoModelKeys.length > 0 ? { enum: enabledVideoModelKeys } : {}),
							description: "必须逐字复制本字段 enum 中的当前 enabledVideoModels canonical modelKey；用户显式选择优先，账号生成偏好只有仍出现在 enum 中时才可使用。服务端据其实时 durationOptions 冻结物理 clip 拓扑；禁止猜测、展示名、过期偏好或默认模型。",
						},
						imageModelKey: {
							type: "string",
							minLength: 1,
							...(enabledImageModelKeys.length > 0 ? { enum: enabledImageModelKeys } : {}),
							description: "必须逐字复制本字段 enum 中的当前 enabledImageModels canonical modelKey；禁止使用展示名、过期偏好或默认模型。",
						},
						imageSize: { type: "string", minLength: 1, description: "图片模型实时目录支持的精确尺寸档位，例如 2K；禁止默认。" },
						imageAspectRatio: { type: "string", minLength: 1, description: "图片模型实时目录支持的精确画幅比例；只配置图片节点，不表示用户指定了成片画幅。" },
						videoResolution: { type: "string", minLength: 1, description: "视频模型实时目录支持的精确分辨率；若用户冻结了分辨率，必须逐字满足该约束。" },
						videoAspectRatio: { type: "string", minLength: 1, description: "视频模型实时目录支持的精确画幅比例；若用户冻结了画幅，必须逐字满足该约束。" },
					},
					...(commonRequiredTriggerFields.length > 0 ? { required: commonRequiredTriggerFields } : {}),
					additionalProperties: false,
				},
			},
			required: [
				...(requiresAttachmentSelection ? ["attachmentId"] : []),
				"idempotencyKey",
				...(commonRequiredTriggerFields.length > 0 ? ["triggerPayload"] : []),
			],
			additionalProperties: false,
		},
	};
}

function buildAgentsBridgeRemoteToolCatalog(
	input: AgentsBridgeRemoteToolsInput,
): AgentsBridgeRemoteToolDefinition[] {
	if (!input.publicAgentsRequest) return [];
	const projectId = String(input.canvasProjectId || "").trim();
	const flowId = String(input.canvasFlowId || "").trim();
	const inChapterScope = String(input.chapterId || "").trim().length > 0;
	const hideStoryboardEditor = input.hideStoryboardEditor === true;
	const baseRemoteFlowTaskNodeKinds = hideStoryboardEditor
		? REMOTE_FLOW_TASK_NODE_KINDS_WITHOUT_STORYBOARD
		: REMOTE_FLOW_TASK_NODE_KINDS;
	const remoteFlowTaskNodeKinds = input.adminWorkflowAccess === true
		? [...baseRemoteFlowTaskNodeKinds, ...PUBLIC_FLOW_ADMIN_WORKFLOW_TASK_NODE_KINDS]
		: baseRemoteFlowTaskNodeKinds;
	const keyframeCompositionContractDef = {
		type: "object",
		description:
			"Agent-authored composition facts; Hono validates structure/provenance without inferring prompt semantics.",
		properties: {
			narrativeTask: {
				type: "string",
				description: "本镜主要视觉叙事任务。",
			},
			focusKind: {
				type: "string",
				enum: ["environment", "character", "relationship", "object", "event"],
			},
			focusTargetNames: {
				type: "array",
				items: { type: "string" },
				description: "具名的第一视觉注意对象。",
			},
			focalPoint: {
				type: "array",
				items: { type: "number" },
				minItems: 2,
				maxItems: 2,
				description: "归一化主焦点 [x,y]。",
			},
			shotScale: {
				type: "string",
				enum: ["establishing", "wide", "full", "medium", "close", "detail"],
			},
			environmentVisualWeight: {
				type: "string",
				enum: ["primary", "secondary", "context"],
			},
			subjects: {
				type: "array",
				minItems: 1,
				items: {
					type: "object",
					properties: {
						name: { type: "string" },
						visualWeight: {
							type: "string",
							enum: ["primary", "secondary", "context"],
						},
						depthLayer: {
							type: "string",
							enum: ["foreground", "midground", "background"],
						},
						centerPlacement: {
							type: "string",
							enum: ["required", "allowed", "forbidden"],
						},
						maxFrameHeightRatio: {
							type: "number",
							description: "角色最大画高占比 [0.05,1]。",
						},
					},
					required: [
						"name",
						"visualWeight",
						"depthLayer",
						"centerPlacement",
						"maxFrameHeightRatio",
					],
					additionalProperties: false,
				},
			},
		},
		required: [
			"narrativeTask",
			"focusKind",
			"focusTargetNames",
			"focalPoint",
			"shotScale",
			"environmentVisualWeight",
			"subjects",
		],
		additionalProperties: false,
	} as const;
	const chapterGroundedProductionMetadataDef = {
		type: "object",
		description:
			"Optional chapter provenance; ordinary images may omit it.",
		properties: {
			chapterGrounded: { type: "boolean", const: true },
			blockingFrameNodeId: {
				type: "string",
				description: "Existing blocking-diagram node ID; required when spatialBlocking=true.",
			},
			spatialBlocking: {
				type: "boolean",
				description: "Declares that exact spatial staging evidence is required.",
			},
			compositionContract: keyframeCompositionContractDef,
			compositionContractHash: {
				type: "string",
				description: "Exact blocking-tool sha256; required with spatialBlocking=true.",
			},
			lockedAnchors: {
				type: "object",
				properties: {
					character: { type: "array", items: { type: "string" } },
					scene: { type: "array", items: { type: "string" } },
					shot: { type: "array", items: { type: "string" } },
					continuity: { type: "array", items: { type: "string" } },
					missing: { type: "array", items: { type: "string" } },
				},
				required: ["character", "scene", "shot", "continuity", "missing"],
			},
			authorityBaseFrame: {
				type: "object",
				properties: {
					status: {
						type: "string",
						enum: [...PUBLIC_FLOW_AUTHORITY_BASE_FRAME_STATUSES],
					},
					source: { type: "string" },
					reason: { type: "string" },
					nodeId: {
						anyOf: [{ type: "string" }, { type: "null" }],
					},
				},
				required: ["status", "source", "reason"],
			},
		},
		required: ["chapterGrounded", "lockedAnchors", "authorityBaseFrame"],
		additionalProperties: false,
	} as const;
	const storyPreviewReferenceDef = {
		type: "object",
		additionalProperties: false,
		properties: {
			nodeId: { type: "string", minLength: 1 },
			assetId: { type: "string", minLength: 1 },
			role: { type: "string", enum: ["identity", "layout", "content", "style"] },
			entityKind: { type: "string", enum: ["character", "scene", "prop", "vfx", "content"] },
			entityName: { type: "string", minLength: 1 },
		},
		required: ["role", "entityKind", "entityName"],
		oneOf: [{ required: ["nodeId"] }, { required: ["assetId"] }],
	} as const;
	const storyPreviewContractDef = {
		type: "object",
		description:
			"持久化的章节视觉合同。预览整段故事时必须显式使用 previewScope='full_story'，省略 previewWindow，由服务端确定性展开为 0-storyDurationSeconds。只有用户明确指定局部预览起止或预览时长时才使用 previewScope='user_window' 并提交 previewWindow。小T必须先保存合同，不需要用户额外说‘冻结’；章节预览生成时服务端会从章节唯一真源注入本合同与 requiredReferences。",
		additionalProperties: false,
		properties: {
			schemaVersion: { type: "string", const: "story-preview-contract/v1" },
			storyDurationSeconds: { type: "number", exclusiveMinimum: 0, maximum: 3600 },
			previewScope: {
				type: "string",
				enum: ["full_story", "user_window"],
				description: "必须显式声明：full_story 覆盖完整故事；user_window 只在用户明确要求局部预览时使用。",
			},
			previewWindow: {
				type: "object",
				description: "仅 previewScope='user_window' 时提交；full_story 时省略，防止模型自行裁短。",
				additionalProperties: false,
				properties: {
					startSeconds: { type: "number", minimum: 0 },
					endSeconds: { type: "number", exclusiveMinimum: 0 },
				},
				required: ["startSeconds", "endSeconds"],
			},
			frameIntervalSeconds: { type: "number", exclusiveMinimum: 0 },
			requiredReferences: {
				type: "array",
				minItems: 1,
				maxItems: 32,
				items: storyPreviewReferenceDef,
			},
		},
		required: [
			"schemaVersion",
			"storyDurationSeconds",
			"previewScope",
			"frameIntervalSeconds",
			"requiredReferences",
		],
		allOf: [{
			if: { properties: { previewScope: { const: "user_window" } } },
			then: { required: ["previewWindow"] },
		}],
	} as const;
	const storyPointDef = {
		type: "object",
		description:
			"Story time point. sequence is a caller-authored monotonic ordinal inside one chapter; use 0 for chapter entry. validUntil is exclusive.",
		properties: {
			chapter: { type: "number" },
			sequence: { type: "number" },
			label: { type: "string" },
		},
		required: ["chapter", "sequence"],
		additionalProperties: false,
	} as const;
	const storyFactSubjectDef = {
		type: "object",
		properties: {
			kind: {
				type: "string",
				description: "Structural subject kind chosen by the agent, such as character, relationship, prop, mystery, event, or world_rule.",
			},
			key: {
				type: "string",
				description: "Stable canonical key used for exact filtering; semantic identity is decided by the agent, not Hono.",
			},
			name: { type: "string", description: "Human-readable subject name." },
		},
		required: ["kind", "key", "name"],
		additionalProperties: false,
	} as const;
	const storyFactValueDef = {
		oneOf: [
			{ type: "string" },
			{ type: "number" },
			{ type: "boolean" },
			{ type: "null" },
			{ type: "array", items: {} },
			{ type: "object", additionalProperties: true },
		],
		description: "Bounded JSON value. Store the fact itself, not a prose chapter summary.",
	} as const;
	const storyFactSourceSelectorDef = {
		oneOf: [
			{
				type: "object",
				properties: {
					kind: { type: "string", const: "chapter_canvas_node" },
					chapterId: { type: "string" },
					nodeId: { type: "string" },
					field: { type: "string" },
				},
				required: ["kind", "chapterId", "nodeId", "field"],
				additionalProperties: false,
			},
			{
				type: "object",
				properties: {
					kind: { type: "string", const: "book_chapter" },
					chapter: { type: "number" },
				},
				required: ["kind", "chapter"],
				additionalProperties: false,
			},
			{
				type: "object",
				properties: {
					kind: { type: "string", const: "creative_brief" },
				},
				required: ["kind"],
				additionalProperties: false,
			},
		],
		description:
			"A persisted source that Hono can fresh-read and hash. Chat text, an unsaved draft, planned metadata, or an agent claim is not accepted as source evidence.",
	} as const;
	const storyFactDisclosureDef = {
		oneOf: [
			{
				type: "object",
				properties: {
					mode: { type: "string", const: "immediate" },
					revealAt: { type: "null" },
				},
				required: ["mode", "revealAt"],
				additionalProperties: false,
			},
			{
				type: "object",
				properties: {
					mode: { type: "string", const: "gated" },
					revealAt: storyPointDef,
				},
				required: ["mode", "revealAt"],
				additionalProperties: false,
			},
		],
		description:
			"Audience disclosure authority. immediate means the fact may be asserted whenever it is active; gated means every audience-facing channel must keep it opaque before revealAt. validFrom is world truth time and must not be used as reveal time.",
	} as const;
	const storyFactOperationDef = {
		oneOf: [
			{
				type: "object",
				properties: {
					type: { type: "string", const: "add" },
					factId: { type: "string" },
					subject: storyFactSubjectDef,
					predicate: { type: "string" },
					value: storyFactValueDef,
					status: { type: "string", enum: ["confirmed", "inferred", "draft_choice"] },
					validFrom: storyPointDef,
					disclosure: storyFactDisclosureDef,
				},
				required: ["type", "factId", "subject", "predicate", "value", "status", "validFrom", "disclosure"],
				additionalProperties: false,
			},
			{
				type: "object",
				properties: {
					type: { type: "string", const: "close" },
					factId: { type: "string" },
					validUntil: storyPointDef,
				},
				required: ["type", "factId", "validUntil"],
				additionalProperties: false,
			},
			{
				type: "object",
				properties: {
					type: { type: "string", const: "set_status" },
					factId: { type: "string" },
					expectedStatus: { type: "string", enum: ["confirmed", "inferred", "draft_choice"] },
					status: { type: "string", enum: ["confirmed", "inferred", "draft_choice"] },
				},
				required: ["type", "factId", "expectedStatus", "status"],
				additionalProperties: false,
			},
			{
				type: "object",
				properties: {
					type: { type: "string", const: "set_disclosure" },
					factId: { type: "string" },
					expectedDisclosure: storyFactDisclosureDef,
					disclosure: storyFactDisclosureDef,
				},
				required: ["type", "factId", "expectedDisclosure", "disclosure"],
				additionalProperties: false,
			},
		],
	} as const;
	const equippedWorkflowRunTool = buildEquippedWorkflowRunTool(
		input.equippedWorkflows,
		input.enabledVideoModelKeys,
		input.enabledImageModelKeys,
	);
	if (!projectId && !flowId) {
		return [
			buildShotTableCriticRemoteTool(),
			...(equippedWorkflowRunTool ? [equippedWorkflowRunTool] : []),
		].map(attachRemoteToolExecutionSemantics);
	}
	const tools: AgentsBridgeRemoteToolDefinition[] = [buildShotTableCriticRemoteTool()];
	if (projectId) {
		tools.push(
			{
				name: "tapcanvas_project_flows_list",
				description:
					"List flows in the current authorized TapCanvas project with their identifiers and persisted metadata.",
				parameters: {
					type: "object",
					properties: {},
					additionalProperties: false,
				},
			},
			{
				name: "tapcanvas_project_context_get",
				description:
					"Read authorized project workspace evidence in every project or chapter session, including the versioned CREATIVE_BRIEF.md cross-chapter narrative source and optional book/chapter-scoped context summaries assembled by hono-api.",
				parameters: {
					type: "object",
					properties: {
						bookId: { type: "string" },
						chapter: { type: "number" },
						refresh: { type: "boolean" },
					},
					additionalProperties: false,
				},
			},
			{
				name: "tapcanvas_story_facts_get",
				description:
					"Read the current book's schema-v2 temporal story-fact ledger. projection is required: authoring returns full truth; audience_safe requires at and replaces unrevealed facts with opaque factId/category/status/revealAt guards. Paginated pages report a revision; mixed revisions are not one consistent snapshot. Hono applies structural time/disclosure projection only and does not infer prose semantics.",
				parameters: {
					type: "object",
					properties: {
						bookId: { type: "string" },
						projection: {
							type: "string",
							enum: ["authoring", "audience_safe"],
							description:
								"Choose full authoring truth or an audience-safe projection. No default is applied.",
						},
						at: storyPointDef,
						statuses: {
							type: "array",
							items: { type: "string", enum: ["confirmed", "inferred", "draft_choice"] },
						},
						subjectKeys: {
							type: "array",
							items: { type: "string" },
							description: "Optional exact canonical-key filter; this is not fuzzy semantic search.",
						},
						includeClosed: { type: "boolean" },
						includeCommits: { type: "boolean" },
						offset: {
							type: "number",
							minimum: 0,
							maximum: 20000,
							description: "Zero-based exact pagination offset over the filtered fact list.",
						},
						limit: { type: "number", minimum: 1, maximum: 1000 },
					},
					required: ["bookId", "projection"],
					additionalProperties: false,
				},
			},
			{
				name: "tapcanvas_story_facts_commit",
				description:
					"CAS-commit an incremental schema-v2 story-fact change against expectedRevision and a stable commitId. Hono fresh-reads and hashes the persisted source, validates structure/time/status/disclosure transitions, and atomically writes story-facts.json. A successful ledger commit with a failed STORY_STATE.md projection returns partialSuccess=true and preserves the commit.",
				parameters: {
					type: "object",
					properties: {
						bookId: { type: "string" },
						commitId: {
							type: "string",
							description: "Stable idempotency key for this exact source+operations request.",
						},
						expectedRevision: { type: "number" },
						source: storyFactSourceSelectorDef,
						operations: {
							type: "array",
							minItems: 1,
							maxItems: 100,
							items: storyFactOperationDef,
						},
						note: {
							type: "string",
							description: "Short audit note about why this exact fact delta is being committed.",
						},
					},
					required: ["bookId", "commitId", "expectedRevision", "source", "operations"],
					additionalProperties: false,
				},
			},
			{
				name: "tapcanvas_project_chapters_list",
				description:
					"List every persisted chapter row in the current authorized TapCanvas project, including manually created chapters and chapters linked to uploaded books. This is a metadata-only authoritative chapter catalog and never returns chapter summary or narrative text; call tapcanvas_project_chapter_get with the selected chapterId before any task that depends on chapter content. An empty uploaded-books list does not imply that this list is empty.",
				parameters: {
					type: "object",
					properties: {},
					additionalProperties: false,
				},
			},
			{
				name: "tapcanvas_project_creative_brief_update",
				description:
					"Replace the current project's versioned CREATIVE_BRIEF.md after reading tapcanvas_project_context_get. This is the canonical cross-chapter narrative source for manually created or imported projects: it may contain the user-approved world rules, story/character bible, series outline, unresolved threads, and chapter-level plan. The write preserves version history and must contain the complete intended document, not a partial patch.",
				parameters: {
					type: "object",
					properties: {
						content: {
							type: "string",
							minLength: 1,
							maxLength: 200000,
							description: "Complete Markdown content for the new CREATIVE_BRIEF.md version.",
						},
					},
					required: ["content"],
					additionalProperties: false,
				},
			},
			{
				name: "tapcanvas_project_chapter_get",
				description:
					"Read one persisted project chapter by chapter row id. Returns chapter metadata (including the manually entered summary) plus its independent chapter-canvas revision and nodes. Without nodeIds, canvas nodes are slim; pass nodeIds and fields to read selected text or prompt fields.",
				parameters: {
					type: "object",
					properties: {
						chapterId: { type: "string", minLength: 1 },
						nodeIds: {
							type: "array",
							items: { type: "string", minLength: 1 },
							maxItems: 50,
						},
						fields: {
							type: "array",
							items: { type: "string", minLength: 1 },
							maxItems: 50,
						},
						limit: { type: "number", minimum: 0, maximum: 200 },
						offset: { type: "number", minimum: 0 },
					},
					required: ["chapterId"],
					additionalProperties: false,
				},
			},
			{
				name: "tapcanvas_project_chapter_update",
				description:
					"Atomically replace the canonical title and/or narrative of one chapter after reading it with tapcanvas_project_chapter_get. This single CAS write updates both chapter metadata and the locked chapter-seed node, increments canvasRevision, broadcasts the new source, and returns sourceHash. Use this instead of tapcanvas_node_text_edit for chapter story changes. When the user states a total duration, clip duration, preview window, or required character/scene/prop assets, also submit the complete storyPreviewContract in this same CAS write; that is the automatic freeze and does not require the user to say ‘冻结’. Story preview defaults to the complete story: if the user did not explicitly request a shorter preview range, submit previewScope='full_story' and omit previewWindow. Only explicit user ranges use previewScope='user_window'. Later story_preview generation must fresh-read the chapter but must NOT copy this immutable contract into image-node arguments; the image service always injects the current chapter truth and ignores stale chat copies.",
				parameters: {
					type: "object",
					properties: {
						chapterId: { type: "string", minLength: 1 },
						expectedCanvasRevision: {
							type: "integer",
							minimum: 0,
							description: "Exact revision returned by the preceding chapter read.",
						},
						title: { type: "string", minLength: 1 },
						summary: {
							type: "string",
							minLength: 1,
							description: "Complete intended chapter narrative, not a patch or synopsis fragment.",
						},
						storyPreviewContract: storyPreviewContractDef,
					},
					required: ["chapterId", "expectedCanvasRevision"],
					anyOf: [
						{ required: ["title"] },
						{ required: ["summary"] },
						{ required: ["storyPreviewContract"] },
					],
					additionalProperties: false,
				},
			},
			{
				name: "tapcanvas_books_list",
				description:
					"List uploaded books in the current authorized TapCanvas project. Returns bookId, title, chapterCount, and updatedAt. An empty list only means there are no uploaded books; it says nothing about manually created project chapters, which must be read with tapcanvas_project_chapters_list.",
				parameters: {
					type: "object",
					properties: {},
					additionalProperties: false,
				},
			},
			{
				name: "tapcanvas_book_index_get",
				description:
					"Read one authorized book index, including chapter metadata, assets.storyboardChunks, and other persisted book-level facts.",
				parameters: {
					type: "object",
					properties: {
						bookId: { type: "string" },
					},
					required: ["bookId"],
					additionalProperties: false,
				},
			},
			{
				name: "tapcanvas_book_evidence_search",
				description:
					"Search the authorized book's persisted raw.md for lexical evidence. Each hit returns an exact quote, book/project/chapter scope, sourceTextSha256, offsets, and hashes. An empty results array means no lexical match was found.",
				parameters: {
					type: "object",
					properties: {
						bookId: { type: "string" },
						query: {
							type: "string",
							minLength: 1,
							maxLength: 500,
							description: "Agent-selected words or phrases to locate in the persisted book source.",
						},
						chapterStart: {
							type: "number",
							minimum: 1,
							description: "Optional inclusive first chapter for this evidence search.",
						},
						chapterEnd: {
							type: "number",
							minimum: 1,
							description: "Optional inclusive last chapter; must be >= chapterStart.",
						},
						limit: {
							type: "number",
							minimum: 1,
							maximum: 20,
						},
					},
					required: ["bookId", "query"],
					additionalProperties: false,
				},
			},
			{
				name: "tapcanvas_book_style_confirm",
				description:
					"Create or explicitly update the authorized book's structured Style Bible. Supplied template and directives replace prior styleBible values; history outside styleBible and project styleImages are preserved.",
				parameters: {
					type: "object",
					properties: {
						bookId: { type: "string" },
						styleName: { type: "string" },
						styleLocked: { type: "boolean" },
						confirmed: { type: "boolean" },
						confirmMainCharacterCards: { type: "boolean" },
						visualDirectives: { type: "array", items: { type: "string" } },
						negativeDirectives: { type: "array", items: { type: "string" } },
						consistencyRules: { type: "array", items: { type: "string" } },
						referenceImageNodeIds: {
							type: "array",
							items: { type: "string" },
							description: "当前授权画布中的项目画风图片节点 ID。真实 URL 仅由服务端解析。",
						},
						referenceAssetIds: {
							type: "array",
							items: { type: "string" },
							description: "项目画风上传资产、素材资产或素材具体版本 ID。",
						},
					},
					required: [
						"bookId",
						"styleName",
						"visualDirectives",
						"negativeDirectives",
						"consistencyRules",
					],
					additionalProperties: false,
				},
			},
				{
				name: "tapcanvas_book_chapter_get",
					description:
						"Read one chapter from an authorized book. Default contentMode=task_context selects only the requested chapter while preserving its complete正文 plus bookTitle, chapterCount, adjacent chapter title/summary, summary, keywords, characters, props, scenes, and locations. Use contentMode=full as an explicit full-source declaration; both modes are lossless. Use book_evidence_search only when a targeted evidence lookup is actually preferable. Accepts chapter number or a parseable chapterId.",
					parameters: {
						type: "object",
						properties: {
							bookId: { type: "string" },
							chapter: { type: "number", description: "章节序号(如 273)。也可改用 chapterId。" },
							chapterId: {
								type: "string",
								description:
									"章节完整 id(如 book-<bookId>-ch273)；提供时自动解析出章节序号，可替代 chapter。",
							},
							contentMode: {
								type: "string",
								enum: ["task_context", "full"],
								description: "默认 task_context：只选择当前章节，但返回完整原文；full 也是无损完整原文模式。",
							},
						},
					required: ["bookId"],
					additionalProperties: false,
				},
			},
			{
				name: "tapcanvas_book_chapter_summary_set",
				description:
					"Persist a chapter summary into the book index and, when chapterId is supplied, the chapters table. Accepts chapter number or chapterId; summary is limited to 800 characters.",
				parameters: {
					type: "object",
					properties: {
						bookId: { type: "string" },
						chapter: { type: "number", description: "章节序号(如 11)。也可改用 chapterId。" },
						chapterId: {
							type: "string",
							description: "章节完整 id(如 book-<bookId>-ch11)；提供时自动解析序号并同步 chapters 表。",
						},
						summary: {
							type: "string",
							description: "本章摘要，最多 800 字。",
						},
					},
					required: ["bookId", "summary"],
					additionalProperties: false,
				},
			},
			{
				name: "tapcanvas_book_worldbible_confirm",
				description:
					"Mark the authorized book's four world-bible artifacts as user-confirmed. Requires explicit user confirmation and four non-empty text nodes with exact data.bookBibleType values: world, roster, redlines, ip_safe. Labels are display-only and never establish artifact identity.",
				parameters: {
					type: "object",
					properties: {
						bookId: { type: "string" },
					},
					required: ["bookId"],
					additionalProperties: false,
				},
			},
			{
				name: "tapcanvas_book_storyboard_plan_get",
				description:
					"Read persisted storyboardPlans, shotPrompts, and storyboardStructured metadata for one authorized book chapter.",
				parameters: {
					type: "object",
					properties: {
						bookId: { type: "string" },
						chapter: { type: "number" },
						taskId: { type: "string" },
						planId: { type: "string" },
					},
					required: ["bookId", "chapter"],
					additionalProperties: false,
				},
			},
			{
				name: "tapcanvas_book_storyboard_plan_upsert",
				description:
					"Write one validated storyboard-director/v1.2 chapter plan into the current authorized TapCanvas book index. storyboardStructured must be the exact complete artifact. The server derives a canonical SHA-256 identity directly from that artifact, derives prompts from the same artifact, and rejects any supplied shotPrompts that do not match exactly.",
				parameters: {
					type: "object",
					properties: {
						bookId: { type: "string" },
						taskId: { type: "string" },
						planId: { type: "string" },
						chapter: { type: "number" },
						taskTitle: { type: "string" },
						mode: { type: "string", enum: ["single", "full"] },
						groupSize: { type: "number", enum: [1, 4, 9, 25] },
						storyboardStructured: {
							type: "object",
									properties: {
										schemaVersion: { type: "string", const: "storyboard-director/v1.2" },
										storyFactsContext: { type: "object" },
										shots: { type: "array", minItems: 1, maxItems: 128, items: { type: "object" } },
									},
									required: ["schemaVersion", "storyFactsContext", "shots"],
							additionalProperties: true,
						},
						shotPrompts: { type: "array", items: { type: "string" } },
						runId: { type: "string" },
						outputAssetId: { type: "string" },
						overwriteMode: { type: "string", enum: ["merge", "replace"] },
						resetChapterChunks: { type: "boolean" },
						nextChunkIndexByGroup: {
							type: "object",
							properties: {
								"1": { type: "number" },
								"4": { type: "number" },
								"9": { type: "number" },
								"25": { type: "number" },
							},
							additionalProperties: false,
						},
					},
					required: ["bookId", "chapter", "storyboardStructured"],
					additionalProperties: false,
				},
			},
			{
				name: "tapcanvas_storyboard_continuity_get",
				description:
					"Read deterministic continuity evidence for one exact authorized book chapter chunk. Requires bookId, taskId, chapter, groupSize, and zero-based chunkIndex; chunkIndex>0 also requires the exact direct previousChunkId. The server performs exact-name asset lookup and never guesses predecessors, scans prompt text, aliases names, or falls back to unrelated assets.",
				parameters: {
					type: "object",
					properties: {
						bookId: { type: "string" },
						taskId: { type: "string" },
						chapter: { type: "number" },
						groupSize: { type: "number", enum: [1, 4, 9, 25] },
						chunkIndex: { type: "number" },
						previousChunkId: { type: "string" },
						requiredRoleNames: { type: "array", items: { type: "string" } },
						scenePropRefId: { type: "string" },
						spellFxRefId: { type: "string" },
					},
					required: ["bookId", "taskId", "chapter", "groupSize", "chunkIndex"],
					additionalProperties: false,
				},
			},
			{
				name: "tapcanvas_material_assets_list",
				description:
					"List the authorized project's durable project/chapter/shot nodes as assets, newest-updated first. Visual kinds return only real production-ready image assets by default; set includeDrafts=true when you explicitly need metadata-only text/draft nodes. Returns original node provenance, media readiness, state, version, and sourceChapterId without storage URLs. Exact node, chapter, and state filters are supported.",
				parameters: {
					type: "object",
					properties: {
						kind: { type: "string", enum: ["character", "scene", "prop", "style", "text", "ensemble", "pose", "voice"] },
						scope: { type: "string", enum: ["project", "owner", "all"] },
						name: {
							type: "string",
							description: "Exact asset name to look up (trimmed). Takes precedence over nameContains.",
						},
						nameContains: {
							type: "string",
							description: "Substring match on asset name (fuzzy fallback when the exact name misses, e.g. alias/nickname).",
						},
						nodeId: {
							type: "string",
							description: "Exact original canvas node ID.",
						},
						sourceChapterId: {
							type: "string",
							description: "Exact source chapter ID. Returns only nodes persisted in that chapter.",
						},
						stateKey: {
							type: "string",
							description: "Exact durable asset state key. Never substitutes another state.",
						},
						includeDrafts: {
							type: "boolean",
							description: "Include visual nodes without a real image URL. Default false; use only for explicit metadata inspection, never as a video reference.",
						},
						limit: {
							type: "number",
							description: "Page size. Default 40, maximum 100.",
						},
						offset: {
							type: "number",
							description: "Zero-based page offset. Use nextOffset from the previous response.",
						},
					},
					additionalProperties: false,
				},
			},
			{
				name: "tapcanvas_material_assets_sync",
				description:
					"Persist exact current-canvas character, scene, prop, ensemble, and pose node bindings as durable project materials. Every binding is ownership-checked against the authorized canvas; missing nodes fail explicitly and existing generated assets are preserved.",
				parameters: {
					type: "object",
					properties: {
						bindings: {
							type: "array",
							minItems: 1,
							items: {
								type: "object",
								properties: {
									nodeId: { type: "string" },
									kind: {
										type: "string",
										enum: ["character", "scene", "prop", "ensemble", "pose"],
									},
									name: { type: "string" },
									materialIdentity: {
										type: "object",
										additionalProperties: true,
									},
								},
								required: ["nodeId", "kind", "name"],
								additionalProperties: false,
							},
						},
					},
					required: ["bindings"],
					additionalProperties: false,
				},
			},
			{
				name: "tapcanvas_material_asset_versions_get",
				description:
					"Read version history for one current-project material asset. Each item returns versionId/version, hasImage/hasThreeViewImage, state and audit facts without storage URLs. For 回基态, select the exact base versionId and pass it through referenceAssetIds; the paid execution boundary resolves that version to its real image.",
				parameters: {
					type: "object",
					properties: {
						assetId: { type: "string" },
						kind: { type: "string", enum: ["character", "scene", "prop", "style", "text", "ensemble", "pose", "voice"] },
						name: { type: "string" },
						limit: { type: "number" },
					},
					additionalProperties: false,
				},
			},
			{
				name: "tapcanvas_material_asset_version_create",
				description:
					"Append one verified image version to an existing current-project material asset. Pass exact assetId, exact expectedName and sourceNodeId for an image node on the authorized canvas. The server resolves that node ID to the real image internally, rejects cross-project/name mismatches, and never returns the storage URL. Existing versions are never overwritten.",
				parameters: {
					type: "object",
					properties: {
						assetId: { type: "string" },
						expectedName: { type: "string" },
						stateKey: { type: "string" },
						stateDescription: { type: "string" },
						sourceNodeId: { type: "string" },
					},
					required: ["assetId", "expectedName", "sourceNodeId"],
					additionalProperties: false,
				},
			},
			{
				name: "tapcanvas_material_asset_delete",
				description:
					"Delete one incorrectly created material asset from the current authorized project. This is a destructive repair tool: pass the exact assetId and exact expectedName. The server re-lists the current project's assets, verifies both id ownership and the name byte-for-byte, then deletes only that one asset. Cross-project deletion and name mismatches fail explicitly.",
				parameters: {
					type: "object",
					properties: {
						assetId: { type: "string" },
						expectedName: { type: "string" },
					},
					required: ["assetId", "expectedName"],
					additionalProperties: false,
				},
			},
			{
				name: "tapcanvas_get_style_reference",
				description:
					"Read the authorized project's global style reference, styleLock, and cinematicCamera facts without returning storage URLs.",
				parameters: { type: "object", properties: {}, additionalProperties: false },
			},
			{
				name: "tapcanvas_set_style_reference",
				description:
					"Set the project's GLOBAL style reference only when the project has no style yet. In a chapter session, an existing non-empty style is immutable: reuse it; replacing or clearing it fails with chapter_style_reference_overwrite_forbidden. Project-wide replacement belongs to the explicit project settings surface, never chapter production. A repeated identical value is an idempotent no-op.",
				parameters: {
					type: "object",
					properties: {
						nodeIds: { type: "array", items: { type: "string" }, maxItems: 8 },
						assetIds: { type: "array", items: { type: "string" }, maxItems: 8 },
					},
					additionalProperties: false,
				},
			},
			{
				name: "tapcanvas_project_look_bible_get",
				description:
					"Read the current authorized project's active Project Look Bible version and structured text projections. Returns no image URLs and does not modify the project.",
				parameters: { type: "object", properties: {}, additionalProperties: false },
			},
			{
				name: "tapcanvas_project_look_bible_confirm",
				description:
					"Activate a new immutable Project Look Bible version compiled from a user-authored text document. sourceNodeId must identify a real kind=text, productionLayer=anchors, semanticKind=projectLookBible node on the current authorized canvas. The server fresh-reads the node, stores a versioned project asset, and marks that node approved. Existing versions and generated media are preserved.",
				parameters: {
					type: "object",
					properties: {
						sourceNodeId: { type: "string", minLength: 1 },
						lookBible: {
							type: "object",
							properties: {
								schemaVersion: { type: "string", enum: ["project-look-bible/v1"] },
								name: { type: "string" },
								summary: { type: "string" },
								globalCore: {
									type: "object",
									properties: {
										styleName: { type: "string" },
										summary: { type: "string" },
										visualDirectives: { type: "array", items: { type: "string" } },
										negativeDirectives: { type: "array", items: { type: "string" } },
										consistencyRules: { type: "array", items: { type: "string" } },
										characterPrompt: { type: "string" },
										imagePrompt: { type: "string" },
										videoPrompt: { type: "string" },
									},
									required: [
										"styleName", "summary", "visualDirectives", "negativeDirectives",
										"consistencyRules", "characterPrompt", "imagePrompt", "videoPrompt",
									],
									additionalProperties: false,
								},
								sections: {
									type: "array",
									maxItems: 16,
									items: {
										type: "object",
										properties: {
											id: { type: "string" },
											name: { type: "string" },
											dimension: { type: "string", description: "Open semantic dimension chosen by the agent, for example lighting, era, tone, material, or camera texture. Do not route by a local enum." },
											applicability: { type: "string" },
											directives: { type: "array", items: { type: "string" } },
											imagePrompt: { type: "string" },
											videoPrompt: { type: "string" },
										},
										required: ["id", "name", "dimension", "applicability", "directives", "imagePrompt", "videoPrompt"],
										additionalProperties: false,
									},
								},
								contentExclusions: { type: "array", items: { type: "string" } },
							},
							required: ["schemaVersion", "name", "summary", "globalCore", "sections", "contentExclusions"],
							additionalProperties: false,
						},
					},
					required: ["sourceNodeId", "lookBible"],
					additionalProperties: false,
				},
			},
			{
				name: "tapcanvas_storyboard_anchor_candidates",
				description:
					"List authorized project storyboard anchor candidates as assetId/kind/name/label/description descriptors without image URLs; projectHasAnchorAssets reports whether reusable anchors exist.",
				parameters: {
					type: "object",
					properties: {
						limit: { type: "number" },
						scope: { type: "string", enum: ["project", "owner"] },
					},
					additionalProperties: false,
				},
			},
			{
				name: "tapcanvas_pipeline_runs_list",
				description:
					"List authenticated agent pipeline runs for the current authorized project, newest first, with their durable status and resumable execution evidence.",
				parameters: {
					type: "object",
					properties: { limit: { type: "number", minimum: 1, maximum: 100 } },
					additionalProperties: false,
				},
			},
			{
				name: "tapcanvas_pipeline_run_get",
				description:
					"Read one authenticated legacy pipeline run by runId within the current user's authorized project scope. 一键成片 Workflow IR 执行必须使用 tapcanvas_execution_get / tapcanvas_execution_node_runs_get 跟踪，不得把 workflow-execution identity 传给本工具。",
				parameters: {
					type: "object",
					properties: { runId: { type: "string" } },
					required: ["runId"],
					additionalProperties: false,
				},
			},
		);
	}
	// Project canvases are addressed by flowId, while chapter canvases are
	// addressed by chapterId and persist their graph in chapters.canvas_flow.
	// Requiring a project-root flowId here strips every flow-capable business
	// tool from a valid chapter chat request, including video orchestration.
	tools.push(
		{
			name: "tapcanvas_storyboard_source_bundle_get",
			description:
				"Read an authorized project-flow storyboard source bundle. Returns project context, the resolved chapter正文 slice, relevant flow-node summaries, and progress/recent-shot diagnostics for the supplied bookId.",
			parameters: {
				type: "object",
				properties: {
					bookId: { type: "string" },
					chapter: { type: "number" },
					refresh: { type: "boolean" },
				},
				required: ["bookId"],
				additionalProperties: false,
			},
		},
		{
			name: "tapcanvas_node_context_bundle_get",
			description:
				"Read a real node context bundle for one node in the current authorized TapCanvas project/flow. Returns the current node data, adjacent upstream/downstream nodes, recent execution/node-run/event evidence for this node, and related diagnostics. If remoteToolConfig already includes canvasNodeId, nodeId may be omitted.",
			parameters: {
				type: "object",
				properties: {
					nodeId: { type: "string" },
				},
				additionalProperties: false,
			},
		},
		{
			name: "tapcanvas_video_review_bundle_get",
			description:
				"Read a real video review bundle for one video/composeVideo node in the current authorized TapCanvas project/flow. Returns prompt, storyBeatPlan, videoUrl/videoResults, plus the full node context bundle. If remoteToolConfig already includes canvasNodeId, nodeId may be omitted.",
			parameters: {
				type: "object",
				properties: {
					nodeId: { type: "string" },
				},
				additionalProperties: false,
			},
		},
		{
			name: "tapcanvas_executions_list",
			description:
				"List workflow executions for the current authorized flow, bounded by limit.",
			parameters: {
				type: "object",
				properties: {
					limit: { type: "number" },
				},
				additionalProperties: false,
			},
		},
		{
			name: "tapcanvas_execution_get",
			description:
				"Read a compact status summary for one workflow execution in the current authorized flow scope. Heavy ProjectContext, asset snapshots, and user input stay server-side; use bounded node/family/attempt inspection tools for additional evidence.",
			parameters: {
				type: "object",
				properties: {
					executionId: { type: "string" },
				},
				required: ["executionId"],
				additionalProperties: false,
			},
		},
		{
			name: "tapcanvas_execution_node_runs_get",
			description:
				"List node runs for one workflow execution by executionId in the current authorized flow scope.",
			parameters: {
				type: "object",
				properties: {
					executionId: { type: "string" },
				},
				required: ["executionId"],
				additionalProperties: false,
			},
		},
		{
			name: "tapcanvas_execution_events_list",
			description:
				"List execution events for one workflow execution by executionId. Supports afterSeq and limit for incremental inspection.",
			parameters: {
				type: "object",
				properties: {
					executionId: { type: "string" },
					afterSeq: { type: "number" },
					limit: { type: "number" },
				},
				required: ["executionId"],
				additionalProperties: false,
			},
		},
		{
			name: "tapcanvas_workflow_execution_inspect",
			description:
				"Inspect one durable workflow execution in the current authorized flow. view=family returns the paginated recovery/execution family and aggregate facts; view=attempts returns paginated immutable node-attempt evidence, including frozen execution semantics and provider receipts. Follow nextCursor until null when complete evidence is required.",
			parameters: {
				type: "object",
				properties: {
					executionId: { type: "string", minLength: 1 },
					view: { type: "string", enum: ["family", "attempts"] },
					cursor: { type: "string", minLength: 1 },
					limit: { type: "number", minimum: 1, maximum: 200 },
				},
				required: ["executionId", "view"],
				additionalProperties: false,
			},
		},
		...(equippedWorkflowRunTool ? [equippedWorkflowRunTool] : []),
		...(input.adminWorkflowAccess === true || input.workflowRecoveryAccess === true ? [{
			name: "tapcanvas_workflow_resume",
			description:
				"Continue the latest physical execution inside the same durable workflow family. For an ordinary failed execution, pass only sourceExecutionId. If the user explicitly authorizes an already-persisted workflow configuration repair for that same failed task, pass definitionCutover={mode:'current_flow'}; the server accepts current node configuration only when node/edge/executor/port topology is unchanged and keeps frozen invocation facts and prior receipts. If the latest member is canceled and the user explicitly says that cancellation was accidental or explicitly asks to continue that canceled task, pass cancellationRevoked=true. When inspection proves the sole active execution is suspended by provider_balance_required and the user explicitly confirms that the same provider balance has been restored, pass providerBalanceRestored=true; this preserves the frozen model and API style. If the user instead explicitly selected the initiating Agent's current model, pass agentModelCutover with that exact model and API style. These recovery modes are mutually exclusive. Recovery preserves completed ancestors and receipts and creates one idempotent member in the same family. Never infer authorization, cancellation revocation or restored balance, and never perform an automatic model fallback.",
			parameters: buildWorkflowResumeParameters(),
		}, ...(input.adminWorkflowAccess === true ? [{
			name: "tapcanvas_workflow_run",
			description:
				"Start one persisted admin workflow from an explicit trigger node. idempotencyKey is required so retries resolve to the same durable execution instead of creating duplicate Agent work.",
			parameters: {
				type: "object",
				properties: {
					triggerNodeId: { type: "string", minLength: 1 },
					idempotencyKey: { type: "string", minLength: 1 },
					concurrency: { type: "number", minimum: 1, maximum: 8 },
					trigger: { type: "string", enum: ["manual", "api", "schedule", "agent"] },
					replayFromExecutionId: { type: "string", minLength: 1 },
					startFromNodeId: { type: "string", minLength: 1 },
					triggerPayload: {
						type: "object",
						description: "按次触发参数：媒体执行规格使用 videoModelKey / videoResolution / videoAspectRatio 与 imageModelKey / imageAspectRatio / imageSize；clip 数量与逐段时长只传用户明确指定的结构事实，逐段时长的长度必须等于数量、总和必须等于目标总时长；跨项目调用时产物写回调用者画布并可复用调用者项目资产。",
						properties: {
							source: { type: "string", description: "本次源文本；替换工作流默认 inline 源。" },
							sourceGroupId: { type: "string", description: "调用者当前画布内的源组 id；绑定调用者项目已选节点（文本 + 已就绪图片/视频）作为本次源与参考资产。" },
							targetDurationSeconds: { type: "number", description: "目标总时长（秒）。" },
							requestedClipCount: { type: "number", minimum: 1, description: "用户明确指定的物理 clip 数量；未明确指定时必须省略。" },
							requestedClipDurationsSeconds: { type: "array", minItems: 1, maxItems: 64, items: { type: "number", minimum: 1 }, description: "用户明确指定的逐物理 clip 有序时长（秒）；未逐段指定时必须省略。长度必须等于 requestedClipCount，总和必须等于 targetDurationSeconds。" },
							videoModelKey: { type: "string", description: "视频模型 key。" },
							videoResolution: { type: "string", description: "视频模型实时目录支持的精确分辨率。" },
							videoAspectRatio: { type: "string", description: "视频模型实时目录支持的精确画幅比例。" },
							imageModelKey: { type: "string", description: "图片模型 key。" },
							imageAspectRatio: { type: "string", description: "图片模型实时目录支持的精确画幅比例。" },
							imageSize: { type: "string", description: "图片模型实时目录支持的精确尺寸。" },
						},
						additionalProperties: false,
					},
				},
				required: ["triggerNodeId", "idempotencyKey"],
				additionalProperties: false,
			},
		}, {
			name: "tapcanvas_prompt_library_sync",
			description:
				"Administrator-only executor for an editable PromptSyncProtocolV1 produced by upstream workflow nodes. It validates HTTPS origin/robots/discovery/path boundaries, fairly selects a bounded daily batch, preserves source prompt text, deduplicates by source URL and canonical prompt hash, archives every image/video to TapCanvas R2, and refreshes separate image/video market-validated vector roots. Add sources by editing the upstream protocol node; use a trusted isolated JavaScript detail parser only when neither built-in structural adapter applies.",
			parameters: {
				type: "object",
				properties: {
					protocol: {
						type: "object",
						properties: {
							protocolVersion: { type: "string", const: "tapcanvas.prompt-sync/v1" },
							batch: {
								type: "object",
								properties: {
									maxItems: { type: "number", minimum: 1, maximum: 50 },
									strategy: { type: "string", const: "round_robin" },
								},
								required: ["maxItems", "strategy"],
								additionalProperties: false,
							},
							sources: {
								type: "array",
								minItems: 1,
								maxItems: 10,
								items: {
									type: "object",
									properties: {
										id: { type: "string", minLength: 1, maxLength: 80 },
										displayName: { type: "string", minLength: 1, maxLength: 120 },
										origin: { type: "string", minLength: 1 },
										robotsUrl: { type: "string", minLength: 1 },
										discoveryUrls: { type: "array", minItems: 1, maxItems: 4, items: { type: "string", minLength: 1 } },
										detailPathPrefix: { type: "string", minLength: 1, maxLength: 240 },
										detailParser: {
											type: "object",
											description: "Either {kind:'builtin', adapter:'youmind-next-flight-v1'|'opennana-jsonld-flight-v1'} or {kind:'javascript', code:'return ParsedPromptSource'}. JavaScript runs in the trusted administrator child-process sandbox with no environment variables.",
										},
									},
									required: ["id", "displayName", "origin", "robotsUrl", "discoveryUrls", "detailPathPrefix", "detailParser"],
									additionalProperties: false,
								},
							},
						},
						required: ["protocolVersion", "batch", "sources"],
						additionalProperties: false,
					},
					idempotencyKey: { type: "string", minLength: 1, maxLength: 128 },
				},
				required: ["protocol", "idempotencyKey"],
				additionalProperties: false,
			},
		}] : [])] : []),
		{
			name: "tapcanvas_image_refs_get",
				description:
					"Resolve authorized current-flow image node IDs and current-project asset IDs into name, ID, readiness, and media-type descriptors without storage URLs. Read-only inspection is server-batched and does not change paid model reference limits; paid execution resolves real URLs from the same IDs.",
				parameters: {
					type: "object",
					properties: {
						nodeIds: {
							type: "array",
							items: { type: "string" },
							maxItems: MAX_IMAGE_REFERENCE_INSPECTION_ITEMS,
							description: `Current authorized flow image node IDs. Combined nodeIds + assetIds maximum: ${MAX_IMAGE_REFERENCE_INSPECTION_ITEMS}.`,
						},
						assetIds: {
							type: "array",
							items: { type: "string" },
							maxItems: MAX_IMAGE_REFERENCE_INSPECTION_ITEMS,
							description: `Uploaded asset IDs, material asset IDs, or exact material version IDs. Combined nodeIds + assetIds maximum: ${MAX_IMAGE_REFERENCE_INSPECTION_ITEMS}.`,
						},
					},
					additionalProperties: false,
				},
		},
		{
			name: "tapcanvas_flow_get",
			description:
				"Read the authorized flow graph. Without nodeIds it returns filtered node summaries; any nodeIds read defaults to bounded lifecycle/asset facts so stale prompts, shot tables, and textResults history stay out of the model context. Pass fields explicitly when semantic fields are required. Image storage URLs are removed and represented by ID-based mediaReferences. For a request that only asks what is on the current canvas, one flow_get without nodeIds is the complete read path; do not query the material library or execution history unless the user explicitly asks for those separate facts.",
			parameters: {
				type: "object",
				properties: {
					nodeIds: {
						type: "array",
						description:
							"可选。传 node id 后默认只返回有界生命周期/资产事实，并为已就绪图片附 mediaReferences；需要 prompt、镜头表或其他语义字段时请显式传 fields；不传则返回精简摘要。",
						items: { type: "string" },
					},
					fields: {
						type: "array",
						description:
							"可选，仅配合 nodeIds 生效：只返回 data 里的这些字段(恒含 kind/label/productionLayer)，省 token。例如 [\"prompt\"] 只取镜头表。",
						items: { type: "string" },
					},
					kind: { type: "string", description: "可选过滤(无 nodeIds 时)：只要该 kind 的节点，如 image/video/text/storyboardimage。" },
					productionLayer: { type: "string", description: "可选过滤：只要该 productionLayer 的节点，如 anchors/design_board/expansion。" },
					status: { type: "string", description: "可选过滤：只要该 status 的节点；特殊值 \"empty\"=资产节点但未出图/片。" },
					hasMedia: { type: "boolean", description: "可选过滤：true=只要已出图/片的，false=只要未出的。" },
					q: { type: "string", description: "可选过滤：子串模糊匹配 label+prompt+镜头表+角色名+场景描述(大小写无关)。" },
					limit: { type: "number", description: "可选分页(无 nodeIds 时)：最多返回多少个 slim 节点(默认全返；上限 200)。" },
					offset: { type: "number", description: "可选分页：跳过前 N 个(配 limit 翻页)。" },
				},
				additionalProperties: false,
			},
		},
		{
			name: "tapcanvas_flow_search",
			description:
				"Search authorized flow nodes by content, kind, productionLayer, status, or media readiness. Returns lightweight id/label/kind/productionLayer/status/hasMedia matches plus matched/shown counts, without large data fields.",
			parameters: {
				type: "object",
				properties: {
					q: { type: "string", description: "子串模糊：对 label+prompt+镜头表+角色名+场景描述 做大小写无关 includes 匹配。" },
					kind: { type: "string", description: "节点 kind 精确(大小写无关)，如 image/video/text/storyboardimage。" },
					productionLayer: { type: "string", description: "productionLayer 精确，如 anchors/design_board/expansion。" },
					status: { type: "string", description: "status 精确；特殊值 \"empty\"=资产节点但未出图/片(无 media 且非 success)。" },
					hasMedia: { type: "boolean", description: "有无媒体(已出图/片)。" },
					limit: { type: "number", description: "最多返回多少命中(默认 30，上限 100)。" },
					offset: { type: "number", description: "跳过前 N 个命中(翻页)。" },
				},
				additionalProperties: false,
			},
		},
		{
			name: "tapcanvas_node_text_edit",
			description:
				"Apply ordered anchored find/replace edits to one text field on an authorized chapter-canvas node. Each find must occur exactly once; zero matches return not_found, multiple matches return ambiguous, and failed edits do not roll back successful edits.",
			parameters: {
				type: "object",
				properties: {
					nodeId: { type: "string", description: "目标节点 id。" },
					field: { type: "string", description: "要改的 data 文本字段，默认 'prompt'(也可 'videoPrompt' 等)。" },
					edits: {
						type: "array",
						description: "锚定替换列表，按序应用。每项 {find, replace}：find=要被替换的【唯一】原文片段(逐字)、replace=新内容。",
						items: {
							type: "object",
							properties: {
								find: { type: "string", description: "当前文本里【恰好出现一次】的原文片段(逐字、含标点)。" },
								replace: { type: "string", description: "替换成的新内容(可为空=删除该片段)。" },
							},
							required: ["find", "replace"],
							additionalProperties: false,
						},
					},
				},
				required: ["nodeId", "edits"],
				additionalProperties: false,
			},
		},
		{
			name: "tapcanvas_flow_patch",
			description: buildTapCanvasFlowPatchDescription({ hideStoryboardEditor }),
			parameters: {
				type: "object",
				properties: {
					allowOverwrite: {
						type: "boolean",
						description:
							"true permits intentional replacement of existing non-null node.data fields; otherwise conflicts fail.",
					},
					deleteNodeIds: {
						type: "array",
						description: "Real node IDs; connected edges are removed too.",
						items: { type: "string" },
					},
					deleteEdgeIds: {
						type: "array",
						description: "Real edge IDs; nodes are preserved.",
						items: { type: "string" },
					},
					createNodes: {
						type: "array",
						description: "Create taskNode or groupNode objects.",
						items: {
							oneOf: [
								{
									type: "object",
									additionalProperties: true,
									properties: {
										id: { type: "string" },
										type: {
											type: "string",
											enum: ["taskNode"],
											description: "Executable/content node; blank text uses data.kind='text'.",
										},
										position: {
											type: "object",
											properties: {
												x: { type: "number" },
												y: { type: "number" },
											},
											required: ["x", "y"],
										},
										parentId: { type: "string" },
										selected: { type: "boolean" },
										data: {
											type: "object",
											properties: {
												kind: {
													type: "string",
													enum: [...remoteFlowTaskNodeKinds],
													description:
														"Supported taskNode logical kinds. Reuse only one of these values; do not invent new kinds.",
												},
												label: { type: "string" },
												bookBibleType: {
													type: "string",
													enum: ["world", "roster", "redlines", "ip_safe"],
													description:
														"Explicit identity for a book-level bible text artifact. Required when creating one of the four world-bible artifacts; labels are not parsed.",
												},
												shotTable: {
													...shotTableNodeDataSchema,
												},
											content: {
												type: "string",
											},
												prompt: { type: "string" },
											structuredPrompt: {
												type: "object",
												description:
													"Optional structured mirror of prompt and reference bindings.",
												},
												systemPrompt: { type: "string" },
												negativePrompt: { type: "string" },
											roleName: {
												type: "string",
												description: "Explicit character binding label.",
												},
											sceneName: {
												type: "string",
												description: "Explicit scene identity label.",
											},
											propName: {
												type: "string",
												description: "Explicit prop identity label.",
											},
											referenceType: {
												type: "string",
												enum: ["character", "scene", "prop", "ensemble", "pose", "blocking"],
												description:
													"Explicit reusable asset category. Labels alone never establish identity.",
											},
											roleId: {
												type: "string",
											},
											roleCardId: {
												type: "string",
											},
											sourceBookId: {
												type: "string",
												description: "Book scope ID for chapter-grounded nodes.",
												},
											materialChapter: {
												type: "number",
												description: "Owning chapter number.",
												},
											stateDescription: {
												type: "string",
											},
											referenceView: {
												type: "string",
												enum: ["three_view", "role_card"],
											},
											scenePropRefId: {
												type: "string",
											},
											scenePropRefName: {
												type: "string",
											},
											visualRefId: {
												type: "string",
											},
											visualRefName: {
												type: "string",
											},
											visualRefCategory: {
												type: "string",
												enum: ["scene_prop", "spell_fx"],
											},
											referenceImageNodeIds: {
												type: "array",
												description:
													hideStoryboardEditor
														? "Authorized image-node IDs; paid execution resolves URLs."
														: "Authorized image/storyboard-node IDs; paid execution resolves URLs.",
													items: { type: "string" },
												},
											referenceAssetIds: {
												type: "array",
												description: "Uploaded/material asset or exact version IDs.",
													items: { type: "string" },
												},
											videoModel: {
												type: "string",
												},
											durationSeconds: {
												type: "number",
												description: "Enabled model durationOptions value in seconds.",
												},
											videoResolution: {
												type: "string",
												description: "Enabled model resolutionOptions value.",
												},
											orientation: {
												type: "string",
												enum: ["landscape", "portrait"],
											},
											imageModel: {
												type: "string",
												},
											audioType: {
												type: "string",
												enum: ["speech", "music"],
											},
											audioModel: {
												type: "string",
											},
											aspect: {
												type: "string",
												description: "Image/video aspect ratio.",
												},
												nodeWidth: { type: "number" },
												nodeHeight: { type: "number" },
												productionLayer: {
													type: "string",
													enum: [...PUBLIC_FLOW_PRODUCTION_LAYERS],
												},
												creationStage: {
													type: "string",
													enum: [...PUBLIC_FLOW_CREATION_STAGES],
												},
												approvalStatus: {
													type: "string",
													enum: ["needs_confirmation", "approved", "rejected"],
												},
												...(hideStoryboardEditor
													? {}
													: {
															storyboardEditorGrid: {
																type: "string",
																enum: ["2x2", "3x2", "3x3", "5x5"],
															},
															storyboardEditorAspect: {
																type: "string",
																enum: ["1:1", "4:3", "16:9", "9:16"],
															},
															storyboardEditorEditMode: { type: "boolean" },
															storyboardEditorCollapsed: { type: "boolean" },
														}),
												...(inChapterScope
													? { productionMetadata: chapterGroundedProductionMetadataDef }
													: {}),
												...(hideStoryboardEditor
													? {}
													: {
															storyboardEditorCells: {
																type: "array",
																items: {
																	type: "object",
																	additionalProperties: true,
																	properties: {
																		id: { type: "string" },
																		label: { type: "string" },
																		prompt: { type: "string" },
																		sourceKind: { type: "string" },
																		sourceNodeId: { type: "string" },
																		sourceIndex: { type: "number" },
																		shotNo: { type: "number" },
																		aspect: { type: "string" },
																		bookId: { type: "string" },
																		chapterId: { type: "string" },
																	},
																},
															},
														}),
											},
											required: ["kind"],
										},
									},
									required: ["type", "position", "data"],
								},
								{
									type: "object",
									additionalProperties: true,
									properties: {
										id: { type: "string" },
										type: {
											type: "string",
											enum: ["groupNode"],
											description: "Grouping container; style width/height are required.",
										},
										position: {
											type: "object",
											properties: {
												x: { type: "number" },
												y: { type: "number" },
											},
											required: ["x", "y"],
										},
										parentId: { type: "string" },
										selected: { type: "boolean" },
										data: {
											type: "object",
											properties: {
												label: { type: "string" },
												isGroup: { type: "boolean" },
												groupKind: { type: "string" },
											},
										},
										style: {
											type: "object",
											properties: {
												width: { type: "number" },
												height: { type: "number" },
											},
											required: ["width", "height"],
										},
									},
									required: ["type", "position", "data", "style"],
								},
							],
						},
					},
					createEdges: {
						type: "array",
						description: "Create edges by real source/target IDs and optional frontend handle IDs.",
						items: {
							type: "object",
							additionalProperties: true,
							properties: {
								id: { type: "string" },
								source: { type: "string" },
								target: { type: "string" },
								sourceHandle: { type: "string" },
								targetHandle: { type: "string" },
								type: { type: "string" },
								label: { type: "string" },
								data: { type: "object" },
							},
							required: ["source", "target"],
						},
					},
					patchNodeData: {
						type: "array",
						description: "Merge data into existing node IDs; never creates nodes.",
						items: {
							type: "object",
							properties: {
								id: { type: "string" },
								data: { type: "object" },
							},
							required: ["id", "data"],
						},
					},
					appendNodeArrays: {
						type: "array",
						description: "Append items to an existing node's data[key], not the flow root.",
						items: {
							type: "object",
							properties: {
								id: { type: "string" },
								key: { type: "string" },
								items: { type: "array", items: { type: "object" } },
							},
							required: ["id", "key", "items"],
						},
					},
				},
				additionalProperties: false,
			},
		},
	);

	const sharedNodeDef = {
		type: "object",
		additionalProperties: true,
		properties: {
			id: { type: "string", description: "Optional stable node id; auto-generated if omitted." },
			type: { type: "string", enum: ["taskNode"], description: "Must be \"taskNode\"." },
			position: {
				type: "object",
				properties: { x: { type: "number" }, y: { type: "number" } },
				required: ["x", "y"],
			},
			parentId: { type: "string" },
			data: {
				type: "object",
				properties: {
					kind: { type: "string" },
					label: { type: "string" },
					prompt: { type: "string", description: "Required — the generation prompt." },
					negativePrompt: { type: "string" },
					systemPrompt: { type: "string" },
					structuredPrompt: { type: "object" },
				},
				required: ["kind", "prompt"],
			},
		},
		required: ["type", "data"],
	} as const;

	// 视频生成专用节点 schema：显式文档化视频特有的 data 字段，否则模型 get_tool_schema 只看到
	// 通用的 kind/label/prompt（sharedNodeDef），看不见 videoModel/durationSeconds/reference ids/
	// sourceVideoUrl/sourcePrevTaskId —— 实测导致：①跨镜续写从不传 sourceVideoUrl/
	// sourcePrevTaskId（"看不见即不填"）②参考图只剩 hono 自动注入的 1 张组内图 ③有时漏设 videoModel
	// 落到 text_to_video 无默认模型报错。运行时 generate-video-to-canvas.ts 本就读这些字段，只是没文档化。
	// 注：首帧 firstFrameUrl 已停用（2026-06-26），故事板/关键帧一律走引用 ID 作剧情参考。
	const videoNodeDef = {
		...sharedNodeDef,
		properties: {
			...sharedNodeDef.properties,
			data: {
				type: "object",
				additionalProperties: true,
				properties: {
					...sharedNodeDef.properties.data.properties,
					kind: { type: "string", description: "video | composeVideo" },
					label: { type: "string" },
					prompt: {
						type: "string",
						description:
							"Required — executable video-generation prompt for this node. Creative method and shot construction belong to the loaded agents-cli Skill; this schema only transports the final prompt string.",
					},
					negativePrompt: { type: "string" },
					videoModel: {
						type: "string",
						description:
							"REQUIRED. COPY the exact modelKey the user/plan chose from the enabledVideoModels context — do NOT default to or copy any literal shown here (e.g. pixverse-v6 vs doubao-seedance-2-0-260128 route to completely different upstream channels). Omitting it routes to text-to-video with no default model and HARD-FAILS (model_not_configured). If the group node has data.videoModel pinned, that pin overrides this field at the tool layer — keep them consistent. The official seedance-2-0 channel supports real-person inputs directly — there is NO -face model anymore; never emit doubao-seedance-2.0-face or any -face variant. Keep the SAME model across all shots of one film.",
					},
					durationSeconds: {
						type: "number",
						description:
							"Per-clip duration in seconds. DEFAULT to the selected model's maxDuration from enabledVideoModels (longest supported clip) unless this is a remainder/last clip. Must be one of the model's durationOptions.",
					},
					videoResolution: { type: "string", description: "e.g. 720p / 1080p — one of the model's resolutionOptions." },
					aspect: { type: "string", description: "e.g. 9:16 / 16:9. The group's pinned videoAspect is enforced at the tool layer regardless." },
					referenceImageNodeIds: {
						type: "array",
						items: { type: "string" },
						description:
							"Canvas image node IDs for cross-shot consistency. Resolve/verify with tapcanvas_image_refs_get; never copy image URLs.",
					},
					referenceAssetIds: {
						type: "array",
						items: { type: "string" },
						description:
							"Uploaded image asset IDs, material asset IDs, or exact material version IDs for cross-shot consistency.",
					},
					// 首帧 firstFrameUrl 已停用（2026-06-26 用户拍板「不再使用此功能」）：故事板/关键帧一律走
					// referenceImages 作剧情参考，不再当字面首帧。镜间连贯靠 referenceImages 状态接力 +
					// （continuous 逃生口由服务端 orchestrator 自行处理尾帧续写），小T 不再手动设 firstFrameUrl。
					sourceVideoUrl: {
						type: "string",
						description:
							"⛔续写禁用（2026-07-06 用户拍板：视频输入只有「复刻/v2v」好用、「续写」不好用）——普通分镜续写绝不要传上一镜成片；镜间承接只靠提示词里的退出态状态接力（各镜并发独立、可换机位视角）。本字段仅限复刻/v2v 场景：导演台灰模 v2v 重构、动作迁移（videoReferType=feature）、底片重绘（videoReferType=base）。",
					},
					sourcePrevTaskId: {
						type: "string",
						description:
							"⛔续写禁用（同 sourceVideoUrl）——普通分镜不要设置。仅 pixverse 复刻/延展特殊场景与 sourceVideoUrl 配套使用。",
					},
				},
				required: ["kind", "prompt"],
			},
		},
	} as const;

	// 图片生成专用节点 schema：显式文档化引用 ID；真实 URL 只在服务端付费边界解析。
	// 否则模型 get_tool_schema 只看到 sharedNodeDef 的 kind/label/prompt，看不见参考图字段→「看不见即不填」→
	// 用户说"基于这张户型图出效果图"时，模型必须保留真实节点/资产身份而不是复制 URL。
	const imageNodeDataProperties = {
		...sharedNodeDef.properties.data.properties,
		kind: {
			type: "string",
			enum: ["image", "imageEdit", "storyboardImage"],
			description: "Exact image node kind; do not invent aliases.",
		},
		label: { type: "string" },
		prompt: { type: "string", description: "Required — the generation prompt." },
		negativePrompt: { type: "string" },
		systemPrompt: { type: "string" },
		structuredPrompt: { type: "object" },
		imageModel: {
			type: "string",
			description: "Exact executionCatalog.models[].modelKey.",
		},
		aspect: {
			type: "string",
			description: "Exact supported imageOptions.aspectRatioOptions value.",
		},
		imageSize: {
			type: "string",
			description: "Exact supported imageOptions.imageSizeOptions[].value.",
		},
		characterAssetRole: {
			type: "string",
			enum: ["identity_anchor", "state_variant"],
			description:
				"角色图片资产职责。identity_anchor 是 character-card/v3 的 canonical 身份卡；state_variant 是由精确身份资产 ID 派生的状态卡。该语义只由 agents-cli tapcanvas-character-card 决定。",
		},
		characterProfileVersion: {
			type: "string",
			enum: ["character-card/v3"],
			description:
				"新角色卡唯一结构版本。旧 character-bible/v2、role-card 与 role-portrait 生成入口已删除。",
		},
		identityBoardSpec: characterIdentityBoardSpecToolSchema,
		identityAnchors: {
			type: "array",
			items: { type: "string" },
			description:
				"由 tapcanvas-character-card 从角色事实编译的可见身份事实；不得由协议层随机补齐。",
		},
		prohibitedDrift: {
			type: "array",
			items: { type: "string" },
			description:
				"仅基于已确认角色事实的禁止偏移项；不得使用模板禁词或固定人脸负向词代替人物设计。",
		},
		propAssetRole: {
			type: "string",
			enum: ["identity_anchor", "state_variant"],
			description:
				"道具图片资产职责。identity_anchor 是 prop-card/v1 canonical 基态；state_variant 必须绑定精确 canonicalAssetId 并只写状态差量。语义只由 agents-cli tapcanvas-prop-card 决定。",
		},
		propProfileVersion: {
			type: "string",
			enum: ["prop-card/v1"],
			description: "新道具卡唯一结构版本。",
		},
		propBoardSpec: propIdentityBoardSpecToolSchema,
		propAnchors: {
			type: "array",
			items: { type: "string" },
			description:
				"由 tapcanvas-prop-card 编译的可见且跨镜稳定的道具身份事实。",
		},
		prohibitedPropDrift: {
			type: "array",
			items: { type: "string" },
			description:
				"仅基于已确认道具事实的不可偏移项；不得使用模板禁词替代物理设计。",
		},
		propFunctionSpec: propFunctionSpecToolSchema,
		sceneAssetRole: {
			type: "string",
			enum: ["space_anchor", "lighting_variant", "state_variant"],
			description:
				"场景图片资产职责。space_anchor 锁定 canonical 空间；lighting_variant 只改变可证明光相；state_variant 只改变可见场景状态。语义只由 agents-cli tapcanvas-scene-card 决定。",
		},
		sceneProfileVersion: {
			type: "string",
			enum: ["scene-card/v1"],
			description:
				"新场景卡唯一结构版本；旧固定场景 prompt、兼容/借鉴模板与 URL 物化路径已删除。",
		},
		sceneAnchors: {
			type: "array",
			items: { type: "string" },
			description:
				"由 tapcanvas-scene-card 编译的可见空间身份事实，如拓扑、尺度、入口、固定地标、主材质与长期使用痕迹。",
		},
		prohibitedSceneDrift: {
			type: "array",
			items: { type: "string" },
			description:
				"仅基于已确认场景事实的不可偏移项；不得使用模板禁词替代空间设计。",
		},
		sceneLightingSpec: sceneLightingSpecToolSchema,
		waitForResult: {
			type: "boolean",
			enum: [false],
			description:
				"Agent image generation is async-only. Omit this field or set false. Once accepted, the tool persists running+taskId and returns; use tapcanvas_image_reconcile to collect the same task. true is rejected before paid submission.",
		},
		referenceImageNodeIds: {
			type: "array",
			items: { type: "string" },
			description:
				"图生图/参考图的当前画布图片节点 ID（最多 16 项）。先用 flow_get/flow_search 找节点 ID，并可用 tapcanvas_image_refs_get 验证；禁止复制图片 URL。",
		},
		referenceAssetIds: {
			type: "array",
			items: { type: "string" },
			description: "上传图片资产 ID、素材资产 ID或素材具体版本 ID（最多 16 项）。项目全局画风由服务端自动注入。",
		},
		referenceAssetBindings: {
			type: "array",
			maxItems: 16,
			description:
				"Role-aware uploaded/material image bindings. Use this instead of referenceAssetIds when layout/structure and style inputs must remain distinct. layout/content/identity become composition references; style becomes a role='style' asset input. Each assetId may appear once.",
			items: {
				type: "object",
				additionalProperties: false,
				properties: {
					assetId: { type: "string" },
					role: {
						type: "string",
						enum: ["layout", "style", "identity", "content"],
					},
					strength: {
						type: "number",
						minimum: 0,
						maximum: 1,
						description:
							"Requested influence persisted as provenance and forwarded as asset weight where supported; unsupported providers still receive the role-separated ordered references.",
					},
				},
				required: ["assetId", "role"],
			},
		},
		seed: {
			type: "integer",
			description:
				"Optional explicit image seed forwarded to providers that support it. Omit it for a fresh random variant; use nodes[] to submit up to eight independent variants in one batch.",
		},
		styleLockId: {
			type: "string",
			description: "当前项目 styleLock.styleId；服务端会按真实项目画风再次确定性回写。",
		},
		styleFingerprint: {
			type: "string",
			description: "当前项目画风事实的确定性 sha256 指纹；用于禁止复用旧画风或无 provenance 资产。",
		},
		styleSource: {
			type: "string",
			enum: ["project_style_reference"],
		},
		referenceType: {
			type: "string",
			enum: ["character", "scene", "prop", "ensemble", "pose", "blocking"],
			description:
				"Structured asset category. Reusable character/scene/prop cards must set this together with roleName/sceneName/propName; label is display text and never establishes identity. It never gates image generation.",
		},
		roleName: {
			type: "string",
			description: "Exact character identity when referenceType='character'.",
		},
		sceneName: {
			type: "string",
			description: "Exact scene identity when referenceType='scene'.",
		},
		propName: {
			type: "string",
			description: "Exact prop identity when referenceType='prop'.",
		},
		materialIdentity: {
			type: "object",
			description:
				"Optional prop registry metadata. base={mode:'base',canonicalName}; state={mode:'state',canonicalName,canonicalAssetId,stateKey,stateDescription}. Omit it when no canonical prop-state linkage is needed; image generation never requires it.",
			properties: {
				mode: { type: "string", enum: ["base", "state"] },
				canonicalName: { type: "string" },
				canonicalAssetId: { type: "string" },
				stateKey: { type: "string" },
				stateDescription: { type: "string" },
			},
			required: ["mode", "canonicalName"],
			additionalProperties: false,
		},
		stateKey: { type: "string" },
		stateVersionId: {
			type: "string",
			description: "Exact immutable state-version identity from visualStateTimeline for a character state anchor.",
		},
		stateDescription: { type: "string" },
		visualStateFacts: {
			type: "array",
			description: "Character state anchors only: frozen key/value facts copied exactly from assetRepair.requiredAssets.visualFacts.",
			items: {
				type: "object",
				additionalProperties: false,
				properties: {
					key: { type: "string" },
					value: { type: "string" },
				},
				required: ["key", "value"],
			},
		},
		...(inChapterScope ? { productionMetadata: chapterGroundedProductionMetadataDef } : {}),
		// Explicit clip handoff metadata. These fields are optional for standalone
		// images and are the only deterministic bridge from a generated keyframe
		// to a video clip.
		clipRunId: {
			type: "string",
			description:
				"Optional exact video run id for a clip-scoped keyframe. Copy the same runId used by the video plan; never derive it from a label.",
		},
		clipIndex: {
			type: "integer",
			minimum: 0,
			description:
				"Optional zero-based clip slot for a clip-scoped keyframe. It must match the target video plan slot exactly.",
		},
		storyboardScope: {
			type: "string",
			enum: ["clip"],
			description:
				"Set to clip only when this image is an explicit keyframe for one video clip; omit for standalone images or master boards.",
		},
		storyboardFrameCount: {
			type: "integer",
			minimum: 1,
			maximum: 3,
			description:
				"Optional number of visual states carried by this clip keyframe, from 1 to 3. It must agree with the video clip's storyboardFrameCount.",
		},
		productionLayer: {
			type: "string",
			description:
				"Optional production layer. For a multi-state clip storyboard use design_board together with storyboardScope=clip.",
		},
		creationStage: {
			type: "string",
			description:
				"Set to beat_keyframe when this image is the generated keyframe asset for a video clip.",
		},
		assetUsage: {
			type: "string",
			enum: ["production", "preview_only"],
			description:
				"Asset eligibility for ordinary images. Chapter story-preview boards are created only by tapcanvas_story_preview_orchestrate and are not authored through this schema.",
		},
		sourceChapterRevision: {
			type: "integer",
			minimum: 0,
			description: "Chapter canvas revision returned by tapcanvas_project_chapter_update for the narrative visualized by this preview.",
		},
		sourceHash: {
			type: "string",
			description: "Authoritative source hash returned by tapcanvas_project_chapter_update.",
		},
	} as const;
	const imageNodeDataDef = {
		type: "object",
		description:
			"Image generation data. productionMetadata is optional provenance for chapter-grounded work and is never a generation gate.",
		additionalProperties: true,
		properties: imageNodeDataProperties,
		required: ["kind", "prompt"],
		...(inChapterScope
			? {
				allOf: [{
					if: {
						properties: { assetUsage: { const: "preview_only" } },
						required: ["assetUsage"],
					},
					then: { not: { required: ["productionMetadata"] } },
					else: { required: ["productionMetadata"] },
				}],
			}
			: {}),
		...(inChapterScope ? {} : { not: { required: ["productionMetadata"] } }),
	} as const;
	const imageNodeDef = {
		...sharedNodeDef,
		properties: {
			...sharedNodeDef.properties,
			data: imageNodeDataDef,
		},
	} as const;
	const batchImageNodeDef = {
		...imageNodeDef,
		properties: {
			...imageNodeDef.properties,
			data: {
				...imageNodeDataDef,
				properties: {
					...imageNodeDataDef.properties,
					waitForResult: {
						type: "boolean",
						enum: [false],
						description:
							"Batch calls are async-only. Omit this field or set false; reconcile the persisted taskId instead of holding one HTTP request open for the whole batch.",
					},
				},
			},
		},
	} as const;
	const basicImageNodeDef = {
		type: "object",
		additionalProperties: false,
		properties: {
			id: sharedNodeDef.properties.id,
			type: sharedNodeDef.properties.type,
			position: sharedNodeDef.properties.position,
			parentId: sharedNodeDef.properties.parentId,
			data: {
				type: "object",
				additionalProperties: false,
				properties: {
					kind: imageNodeDataProperties.kind,
					label: imageNodeDataProperties.label,
					prompt: imageNodeDataProperties.prompt,
					negativePrompt: imageNodeDataProperties.negativePrompt,
					systemPrompt: imageNodeDataProperties.systemPrompt,
					imageModel: imageNodeDataProperties.imageModel,
					aspect: imageNodeDataProperties.aspect,
					imageSize: imageNodeDataProperties.imageSize,
					waitForResult: imageNodeDataProperties.waitForResult,
					referenceImageNodeIds: imageNodeDataProperties.referenceImageNodeIds,
					referenceAssetIds: imageNodeDataProperties.referenceAssetIds,
					referenceAssetBindings: imageNodeDataProperties.referenceAssetBindings,
					seed: imageNodeDataProperties.seed,
				},
				required: ["kind", "prompt"],
			},
		},
		required: ["type", "data"],
	} as const;
	const imageGenerateExecution = {
		sideEffect: "paid_generation",
		retrySafety: "unsafe",
		executionMode: "exclusive",
		idempotencyKeyField: null,
		resultLookupSupported: true,
	} as const;
	const compactStoryPreviewBoardDef = {
		type: "object",
		additionalProperties: false,
		description:
			"专用剧情预览编排器的逐板创作字段。节点结构、精确时间码、板数、章节原文、冻结引用、revision/hash、稳定 seriesId 与最终生图提示词均由服务端从当前章节唯一真源展开。",
		properties: {
			openingState: {
				type: "string",
				maxLength: 600,
				description: "本板第一格的起始可见状态；后续每格起始由服务端继承上一格结束，跨板也会继承上一板终态。",
			},
			cells: {
				type: "array",
				minItems: 1,
				maxItems: 9,
				description: "严格按时间顺序提交；不要写 cellIndex/timeRange/合同。每格必须用 subjectRefIds 声明实际可见的冻结引用 ID。格数必须等于服务端时间轴要求。",
				items: {
					type: "object",
					additionalProperties: false,
					properties: {
						frame: { type: "string", maxLength: 600, description: "本秒代表帧：人物姿态、持物、相对位置和构图落点。" },
						mid: { type: "string", maxLength: 600, description: "0.5秒承接动作；写清重心、肢体、武器与视线如何连续移动。" },
						end: { type: "string", maxLength: 600, description: "本秒结束时可直接交给下一秒继承的完整状态。" },
						camera: { type: "string", maxLength: 400, description: "景别、机位、观察方向、焦点与连续路径。" },
						feedback: { type: "string", maxLength: 400, description: "接触、受力、反作用；未接触时写压力或惯性变化。" },
						environment: { type: "string", maxLength: 400, description: "光、尘、雾、地面或背景相对上一秒的可见变化。" },
						subjectRefIds: {
							type: "array",
							minItems: 1,
							maxItems: 32,
							uniqueItems: true,
							items: { type: "string" },
							description: "本格实际可见的精确冻结引用 ID；不得根据名称猜测或加入未声明引用。",
						},
					},
					required: ["frame", "mid", "end", "camera", "feedback", "environment", "subjectRefIds"],
				},
			},
		},
		required: ["boardIndex"],
	} as const;

	tools.push(
		...(inChapterScope ? [{
			name: STORY_PREVIEW_ORCHESTRATOR_TOOL,
			description: [
				"Durable chapter story-preview workflow. Use this as the only route for requests to preview the agreed story as real nine-grid images.",
				"Call mode=begin once. The server computes every board, reuses already submitted boards, and returns a progressCursor whose only allowedNextAction is the first missing put_board_N node.",
					"Each put_board_N operation has a server-projected schema that locks the exact board and exact cell count. The runtime checkpoints every accepted board and automatically exposes only the next node. Never loop over tapcanvas_image_generate_to_canvas yourself.",
					"The dynamic schema includes complete canonical source sections for this exact time window plus frozen reference options. Every cell must declare exact subjectRefIds; the server validates IDs and timing without guessing identities from prose.",
					"Malformed structural content retries only the same put_board_N node. Source fidelity is the agent's same-chain authoring and self-check responsibility. Running/success boards are idempotently reused and never resubmitted for payment.",
			].join(" "),
			parameters: {
				type: "object",
				description: "Deterministic story-preview graph; operation schemas are loaded one durable frontier node at a time.",
				properties: {
					mode: {
						type: "string",
						enum: [
							"begin",
							"status",
							...Array.from({ length: STORY_PREVIEW_MAX_BOARDS }, (_, index) => storyPreviewPutBoardMode(index)),
						],
					},
					openingState: compactStoryPreviewBoardDef.properties.openingState,
					cells: compactStoryPreviewBoardDef.properties.cells,
				},
				oneOf: [
					{
						properties: { mode: { type: "string", const: "begin" } },
						required: ["mode"],
						xExecution: {
							sideEffect: "none",
							retrySafety: "safe",
							executionMode: "parallel_safe",
							idempotencyKeyField: null,
							resultLookupSupported: true,
						},
					},
					{
						properties: { mode: { type: "string", const: "status" } },
						required: ["mode"],
						xExecution: {
							sideEffect: "none",
							retrySafety: "safe",
							executionMode: "parallel_safe",
							idempotencyKeyField: null,
							resultLookupSupported: true,
						},
					},
					...Array.from({ length: STORY_PREVIEW_MAX_BOARDS }, (_, boardIndex) => ({
						properties: {
							mode: { type: "string", const: storyPreviewPutBoardMode(boardIndex) },
						},
						required: ["mode", "openingState", "cells"],
						xExecution: {
							sideEffect: "paid_generation",
							retrySafety: "safe",
							executionMode: "exclusive",
							idempotencyKeyField: null,
							resultLookupSupported: true,
						},
					})),
				],
			},
		}] : []),
		{
			name: "tapcanvas_asset_add_to_canvas",
			description:
				"Resolve one uploaded/material image asset ID and create a real previewable image node in the current canvas. Use this after tapcanvas assets upload when the source image itself must be visible and reusable on the workflow. The server persists the private storage URL inside the node, while the model only sends and receives IDs. referenceRole explicitly separates layout/structure, style, identity, and content inputs; it is provenance for later referenceAssetBindings and is never inferred from labels or prompts.",
			parameters: {
				type: "object",
				additionalProperties: false,
				properties: {
					assetId: { type: "string", description: "Exact uploaded/material image asset ID." },
					referenceRole: {
						type: "string",
						enum: ["layout", "style", "identity", "content"],
						description: "Explicit downstream responsibility of this source image.",
					},
					referenceStrength: {
						type: "number",
						minimum: 0,
						maximum: 1,
						description: "Optional provenance weight requested by the workflow; provider support is model-specific.",
					},
					node: {
						type: "object",
						additionalProperties: true,
						properties: {
							id: { type: "string", description: "Optional stable node ID." },
							type: { type: "string", enum: ["taskNode"] },
							position: {
								type: "object",
								properties: { x: { type: "number" }, y: { type: "number" } },
								required: ["x", "y"],
							},
							parentId: { type: "string" },
							data: {
								type: "object",
								additionalProperties: true,
								properties: {
									kind: { type: "string", enum: ["image"] },
									label: { type: "string" },
									nodeWidth: { type: "number" },
									nodeHeight: { type: "number" },
									productionLayer: { type: "string", enum: [...PUBLIC_FLOW_PRODUCTION_LAYERS] },
									creationStage: { type: "string", enum: [...PUBLIC_FLOW_CREATION_STAGES] },
								},
								required: ["kind"],
							},
						},
						required: ["type", "position", "data"],
					},
				},
				required: ["assetId", "referenceRole", "node"],
			},
		},
		{
			name: "tapcanvas_image_generate_to_canvas",
			description:
					"Generate an image from a prompt and create a new image node in the current flow. data.kind must be one of: image / imageEdit / storyboardImage. " +
				"章节剧情预览已由 tapcanvas_story_preview_orchestrate 接管板数、顺序、精确格数、checkpoint、幂等与同链纠错。用户要求完整剧情预览/九宫格预演时必须使用专用工具，本通用生图工具不接受 previewBoard。 " +
				"For chapter beat keyframes (productionLayer='keyframe' or creationStage='beat_keyframe'), productionMetadata.spatialBlocking=true declares that the current clip truly depends on precise blocking and therefore requires productionMetadata.blockingFrameNodeId plus the exact compositionContract/compositionContractHash returned by tapcanvas_render_blocking_diagram. Character count alone never triggers this semantic decision. The id must resolve to a real blocking_diagram image on the authorized canvas, cover the same canonical characters and scene, carry the same contract/hash and hash-bearing image provenance, and is injected as the first composition reference. The verified contract facts are appended to the paid image request without locally reinterpreting narrative semantics. The whole batch is rejected before any paid submission when any evidence is missing. " +
				"Clip handoff: when this image is intended for one video clip, also set clipRunId, clipIndex, storyboardScope='clip', creationStage='beat_keyframe', and (for a multi-state image) storyboardFrameCount. The exact run/index metadata is persisted with the image node; commit_beats/add_clips uses it to fill the matching storyboardImageNodeId. Do not expect labels, prompts, node positions, or nearby edges to establish video consumption. If the target run or clip is not known, leave these fields out and treat the image as standalone. " +
						"【持久异步硬合同·勿当失败】所有 agent 生图在供应商受理后立即返回 status:'running' 并持久化 nodeId/taskId。用 tapcanvas_image_reconcile 对账同一任务直到 status:success；禁止 waitForResult:true，禁止因 running 重复提交。主模型只依据 nodeId/taskId/status，不接收图片存储 URL。 " +
					"PREFER THIS whenever the user wants to SEE any visual (reference/concept/style/placeholder/mood image): it renders the image to the canvas AND the chat panel. Do NOT use add_node to create an empty placeholder node and ask the user to refresh — this tool does the generation + render. " +
				"图生图：先用 flow_get/flow_search 找真实图片节点 ID，必要时用 tapcanvas_image_refs_get 验证，再写入 data.referenceImageNodeIds；普通素材卡/版本写入 data.referenceAssetIds。需要严格区分布局/风格/身份/内容职责时改用 data.referenceAssetBindings。省略 seed 会产生新随机变体，多个独立变体用 nodes[] 批量提交。项目全局画风由服务端自动注入。禁止把图片 URL 写进 prompt 或参数。",
			parameters: {
				type: "object",
				properties: {
					node: {
						...imageNodeDef,
						description:
							"单图 Node spec. data.kind: image | imageEdit | storyboardImage. data.prompt is required. 基于已有图时提交 referenceImageNodeIds/referenceAssetIds。多张独立图请改用 nodes 并发。",
					},
					nodes: {
						type: "array",
						maxItems: 8,
						items: batchImageNodeDef,
						description:
							"批量并发且仅异步：多张相互独立的图（角色卡/场景卡/故事板等无依赖图）一次性并发提交（服务端并发≤8张），每张先持久化 running+taskId，再由 tapcanvas_image_reconcile 或后台 sweep 收图。与 node 二选一；data.waitForResult 必须省略或为 false，禁止把整批付费任务绑定到长 HTTP 等待。",
					},
				},
				required: [],
				additionalProperties: false,
				oneOf: [
					{
						properties: {
							operation: { type: "string", const: "generate" },
							node: basicImageNodeDef,
						},
						required: ["operation", "node"],
						xExecution: imageGenerateExecution,
					},
					{
						properties: {
							operation: { type: "string", const: "generate_advanced" },
						},
						required: ["operation"],
						xOptionalProperties: ["node", "nodes"],
						xExecution: imageGenerateExecution,
					},
				],
			},
		},
		{
			name: "tapcanvas_video_generate_to_canvas",
			description:
				"Generate a video from a prompt and create a video node in the current flow. data.kind must be composeVideo or video. Once the upstream task is accepted, the tool persists a running node with the real taskId and immediately returns {nodeId,taskId,status:'running'}; it never blocks the agent connection until rendering completes. tapcanvas_video_reconcile and the background recovery worker write success+videoUrl or failed back to that same node. A running response means accepted, not failed, and must never be resubmitted as a new paid task. " +
				"ORCHESTRATION(多段成片): data.clipRunId(稳定 run id)+data.clipIndex(0起) additionally select a DETERMINISTIC slot(runId:clip:index). Same clipRunId+clipIndex returns the existing running/success node, never creates -rerun and never repeats billing. clipIndex>0 requires the previous segment readiness facts or returns 409 previous_clip_not_ready.",
			parameters: {
				type: "object",
				properties: {
					node: {
						...videoNodeDef,
						description:
							"Node spec for the video to generate. data.kind: composeVideo | video. data.prompt is required. Use referenceImageNodeIds/referenceAssetIds for image consistency; never pass image URLs. Reuse the same videoModel across shots.",
					},
				},
				required: ["node"],
				additionalProperties: false,
			},
		},
		{
			name: "tapcanvas_video_extract_last_frame",
			description:
				"抽取视频尾帧、托管并登记为当前项目可复用的图片资产，供下一镜作首帧参考实现链式衔接。给 videoUrl 直接使用；给 nodeId 时从当前 flow 节点的 data.videoUrl 取。返回图片资产名称、reference descriptor 与 referenceAssetIds；不返回图片存储 URL。后续生图/视频把 referenceAssetIds 原样传入，服务端只在付费提交前解析真实 URL。",
			parameters: {
				type: "object",
				properties: {
					videoUrl: {
						type: "string",
						description:
							"Direct URL of the video to extract the last frame from. Takes precedence over nodeId.",
					},
					nodeId: {
						type: "string",
						description:
							"Id of a video node in the current flow; the tool reads its data.videoUrl when videoUrl is not provided.",
					},
				},
				additionalProperties: false,
			},
		},
		{
			name: "tapcanvas_video_extract_frames",
			description:
				"按 agents 明确给出的时间戳从参考视频抽取关键帧，上传并登记为当前项目可复用的图片资产。适用于角色身份参考、服装/造型与场景证据；工具只执行时间戳抽帧，不替 agent 猜角色或猜时间。给 videoUrl 直接使用；给 nodeId 时从当前 flow 视频节点取。返回 frame time、assetId、referenceId，不返回图片存储 URL。抽取结果默认就是原片 identity_evidence，可通过 tapcanvas_asset_add_to_canvas 直接落到画布并用于续写；只有用户明确要求规范化 character-card/v3 / identity-board/v3 时，才把已核验的 referenceAssetIds 传给角色卡/生图工具。",
			parameters: {
				type: "object",
				properties: {
					videoUrl: { type: "string", description: "待抽帧视频公网 URL（优先于 nodeId）。" },
					nodeId: { type: "string", description: "当前 flow 视频节点 id；videoUrl 未提供时从节点解析。" },
					times: {
						type: "array",
						items: { type: "number", minimum: 0 },
						minItems: 1,
						maxItems: 24,
						description: "agents 选定的原片时间戳（秒），去重后按升序抽取。",
					},
					roleName: { type: "string", description: "可选：用户已确认的角色名，用于资产命名与身份参考元数据。" },
				},
				additionalProperties: false,
			},
		},
		{
			name: "tapcanvas_video_concat",
			description:
				"S7 拼接：把【已生成】的多段视频按顺序拼成一条完整成片，返回永久 URL 与 concatPolicy。默认是 hard_cut：不重叠画面/声音、不缩短段落时间轴、不自动平均调色。只有导演合同明确需要叠化时，才同时提交正数 xfadeSeconds，并为第 1 段之后的每个 clips[i] 逐缝提交合法 transition；缺任一转场或探测无法执行会显式失败，不会静默改 hard_cut/fade。逐段内切继续用 clips:[{url|nodeId,inSec,outSec}]；成片节奏来自已冻结剪辑决定，不由拼接器二次猜测。",
			parameters: {
				type: "object",
				properties: {
					clips: {
						type: "array",
						items: {
							type: "object",
							properties: {
								url: { type: "string", description: "该段源视频 URL（与 nodeId 二选一）。" },
								nodeId: {
									type: "string",
									description: "该段源视频节点 id（从当前 flow 取 data.videoUrl）。",
								},
								inSec: {
									type: "number",
									description: "可选：源素材内起点秒（省略=从头）。",
								},
								outSec: {
									type: "number",
									description: "可选：源素材内终点秒（省略=到尾）；与 inSec 差至少 0.1s。",
								},
								transition: {
									type: "string",
									description:
										"可选但受严格合同约束：进入本段的 ffmpeg xfade 转场；第 0 段禁止填写。使用时必须同时给正数 xfadeSeconds，且第 1 段之后每个接缝都要显式填写。",
								},
							},
							additionalProperties: false,
						},
						description:
							"富形态拼接段（按播放顺序，至少 2 段）：每段可指定源区间 [inSec, outSec) 做逐段内切；同一 url/nodeId 可重复出现取不同区间（亚秒冲击簇/打击帧的拼法）。提供时优先于 clipUrls/nodeIds。",
					},
					clipUrls: {
						type: "array",
						items: { type: "string" },
						description: "按播放顺序排列的视频 URL 列表（至少 2 个）。与 nodeIds 二选一，优先使用。",
					},
					nodeIds: {
						type: "array",
						items: { type: "string" },
						description:
							"按播放顺序排列的视频节点 id 列表；从当前 flow 节点的 data.videoUrl 解析。clipUrls 未提供时使用。",
					},
					aspect: {
						type: "string",
						description:
							"成片目标比例（如 9:16 / 16:9 / 1:1），钉死输出朝向与尺寸，竖屏不会被加横向黑边。应传本次编排统一的 videoAspect；省略则取首片真实尺寸。",
					},
					fileName: {
						type: "string",
						description: "可选：成片文件名（如 final-20s.mp4）。",
					},
					xfadeSeconds: {
						type: "number",
						description:
							"可选：显式叠化秒数，范围 0..1.2。省略或 0=hard_cut；正数=每个接缝必须有 clips[i].transition。",
					},
					colorMatch: {
						type: "boolean",
						description:
							"可选：是否执行全片平均 YUV 校正。默认 false；只有导演明确要求统一跨段曝光/色偏且不破坏剧情光色时才设 true。探测失败会显式失败。",
					},
				},
				additionalProperties: false,
			},
		},
		{
			name: "tapcanvas_voice_card_dub",
			description:
				"【配音卡 → 视频节点 手工配音】给一个视频节点额外合成并 mux 人声：解析 videoUrl + 台词（clipPrompt 引号内对白）+ 指定配音卡（audioType=voice_card，锁定角色音色）→ 豆包 TTS → ffmpeg mux，返回 { videoUrl(配音成片), audioUrl(语音), voiceId, character, dialogue, durationSec }。编排器自动创建的 typed voice_reference/reference_only 连线只表示“该片段用了哪张音色卡”，绝不作为本工具的隐式配音输入，也绝不参与混音；手工配音应显式传 voiceCardNodeId。只有用户确实要执行额外 mux 时，才可使用普通可执行音频边作为省略 voiceCardNodeId 的绑定。拿到 videoUrl 后用 flow_patch 回写到该视频节点的 data.videoUrl。",
			parameters: {
				type: "object",
				properties: {
					videoNodeId: {
						type: "string",
						description: "要配音的视频节点 id（从当前 flow 解析其 videoUrl + 台词 + 绑定的配音卡）。",
					},
					voiceCardNodeId: {
						type: "string",
						description:
							"建议必传：显式指定配音卡节点 id。省略时只读取普通可执行直连边；voice_reference/reference_only 血缘边不会触发手工配音。",
					},
					dialogue: {
						type: "string",
						description:
							"可选：显式台词文本；省略时读视频节点 data.dialogue，再回退 clipPrompt/prompt 引号内对白。",
					},
					videoUrl: {
						type: "string",
						description: "可选：显式视频 URL；省略时从视频节点 data.videoUrl / videoResults 解析。",
					},
				},
				required: ["videoNodeId"],
				additionalProperties: false,
			},
		},
		{
			name: "tapcanvas_hyperframes_render",
			description:
				"剪辑师包装层渲染（HTML→MP4）：把你写的单文件 HyperFrames composition（题卡/动态字幕/片头片尾/motion graphics 短片段）服务端 headless Chromium 逐帧渲染成 mp4，托管对象存储后返回 { videoUrl, key, bytes, durationSec }。【边界】只做包装层短片段（建议 ≤15s）——整片组装仍走 tapcanvas_video_concat（ffmpeg，无重编码损耗）；简单字幕/xfade 转场也优先 ffmpeg 路径，本工具用于 ffmpeg drawtext 做不到的动态排版/动画题卡。生成式画面（角色/场景）禁用本工具拼凑，走生图/生视频管线。composition 写法：根元素必须带 data-composition-id + data-width/data-height + data-duration；定时元素加 class=\"clip\" + data-start/data-duration（秒）；CSS keyframes 动画可被逐帧 seek；中文字体用系统 Noto Sans CJK（font-family:'Noto Sans CJK SC',sans-serif）。远程素材（图/视频/音频）必须列进 assets 参数由服务端预下载，HTML 里以 ./assets/<name> 相对路径引用——禁直接写远程 URL（容器出网受限会渲染挂起）。渲出的片段 URL 用 flow_patch 落画布节点或交 video_concat 合回主片。",
			parameters: {
				type: "object",
				properties: {
					html: {
						type: "string",
						description:
							"完整单文件 composition HTML（含内联 <style>/<script>）。根元素带 data-composition-id/data-width/data-height/data-duration；引用素材一律 ./assets/<name>。",
					},
					assets: {
						type: "array",
						description:
							"远程素材清单（≤24 个，总量 ≤200MB）。服务端预下载到项目 assets/ 目录；name 只允许字母数字._-（单层文件名，如 bg.png、clip1.mp4）。",
						items: {
							type: "object",
							properties: {
								name: {
									type: "string",
									description: "落盘文件名（HTML 里以 ./assets/<name> 引用）。",
								},
								url: { type: "string", description: "素材的 http(s) URL。" },
							},
							required: ["name", "url"],
							additionalProperties: false,
						},
					},
					fps: {
						type: "number",
						description: "帧率（12-60，默认 30）。",
					},
					quality: {
						type: "string",
						enum: ["draft", "standard", "high"],
						description: "渲染质量（默认 standard；draft 用于快速预览自检）。",
					},
				},
				required: ["html"],
				additionalProperties: false,
			},
		},
		{
			name: "tapcanvas_annotate_shot",
			description:
				"在一张底图上【确定性精确】叠加导演运镜标注（轨迹箭头 path / 机位取景框 frame / 文字 label），服务端 canvas 按归一化坐标 [0,1] 合成、上传对象存储、返回新图 { imageUrl }。**用于在场景/关键帧图上画出镜头运镜示意（push-in/环绕/摇移/whip-pan 等）作导演分镜沟通文档**——不走 gpt-image-2（那是生成式脑补、不照坐标走、烧额度），本工具按你给的精确坐标毫秒级精确画、可复现。注意：带箭头标注的图是【导演文档】，别当 referenceImages 喂 seedance/pixverse（箭头会被渲进视频画面）。拿到 imageUrl 后用 flow_patch 建节点。",
			parameters: {
				type: "object",
				properties: {
					sourceImageUrl: {
						type: "string",
						description: "底图公网 URL。与 sourceNodeId 二选一，优先使用。",
					},
					sourceNodeId: {
						type: "string",
						description:
							"底图所在 flow 节点 id（从 data.imageUrl 解析）。sourceImageUrl 未给时使用。",
					},
					annotations: {
						type: "array",
						description: "标注数组（≥1）。所有坐标一律归一化 [0,1]，与图实际尺寸解耦。",
						items: {
							type: "object",
							properties: {
								type: {
									type: "string",
									enum: ["path", "frame", "label"],
									description:
										"path=运镜轨迹折线(末点带箭头) | frame=机位取景框图标 | label=文字标签",
								},
								points: {
									type: "array",
									items: { type: "array", items: { type: "number" } },
									description:
										"【path 必填】运镜路径点 [[x,y],...]（归一化，≥2 个）；箭头默认开在最后一点，方向=最后一段。",
								},
								at: {
									type: "array",
									items: { type: "number" },
									description: "【frame/label 必填】位置 [x,y]（归一化）。",
								},
								text: {
									type: "string",
									description: "【label 必填】文字（如 PUSH-IN / DOLLY-IN / ORBIT）。",
								},
								color: {
									type: "string",
									description: "颜色 hex(#ffd34d) 或色名(white)；默认 path 白、label 黄。",
								},
								width: { type: "number", description: "path 线宽相对值，默认 5。" },
								size: { type: "number", description: "frame 大小（归一化），默认 0.06。" },
								arrowHead: {
									type: "boolean",
									description: "path 是否在末点画箭头，默认 true。",
								},
								fontSize: {
									type: "number",
									description: "label 字号（归一化高度），默认 0.035。",
								},
							},
							additionalProperties: false,
						},
					},
				},
				required: ["annotations"],
				additionalProperties: false,
			},
		},
		{
			name: "tapcanvas_render_blocking_diagram",
			description:
				"【确定性·俯视站位图(blocking diagram)渲染】把结构化站位数据与 KeyframeCompositionContract 渲染成一张**从正上方看的平面调度示意图**：角色站位/朝向/走位、场景地标、机位/视锥/轴线，以及本镜叙事焦点、环境权重、每个角色的视觉权重/景深层/居中政策/最大画高。服务端按归一化坐标 [0,1] 精确绘制并返回 { imageUrl, compositionContract, compositionContractHash }；图片对象 key 携带同一 hash，供关键帧付费前与 commit_beats 追溯。" +
				"**它是 3D 导演台(capture_director_scene)的轻量常驻版**——不依赖浏览器在线，任何镜随时出一张准确调度图。用途三合一：①作分镜交付文档的「人物站位」列；②作该镜 generate_storyboard / 视频生成的 role=context 一致性参考(锁谁在画左/画右/面朝谁)；③作 clipPrompt 里轴线/银幕方向措辞的真源。**为什么不用 gpt-image-2 画：站位图的价值是空间真值，生成式脑补会把位置画乱、轴线画反，等于把防漂锚画成噪声。**" +
				"坐标系：原点左上、x 向右(=银幕左右)、y 向下(=纵深/上下)。先由 agents 判断当前 clip 是否真实依赖精确空间调度，并为该镜给出完整 compositionContract；Hono 不从 prompt 推断焦点。拿到结果后用 flow_patch 新建 image 节点，写 data.productionLayer='blocking_diagram'、data.sceneName、data.productionMetadata.lockedAnchors.character，并把返回的 compositionContract/compositionContractHash 逐字持久化到 data.productionMetadata。关键帧 productionMetadata 必须携带同一合同/hash，并与 beat 共用精确 blockingFrameNodeId。旧站位图、后补字段、只有节点连线或 prompt 声称已使用都不能作为新合同证据。" +
				"**⭐户型底图两步法(2026-07-06 用户拍板·默认必走)**：①本场景若还没有「俯视底图」节点——先用场景卡图生图转一张俯视平面示意图(prompt 如「根据此场景图绘制俯视平面示意图/top-down floor plan，简洁线稿+色块，标注主要地物名称，无人物」，label「俯视底图｜<场景名>」+ data.sceneName='<场景名>' 出生申报，每场景一张全章复用)；②本工具带 backgroundImageUrl=该底图 URL——符号层(站位/走位/机位/轴线)会叠画在户型底图上，landmarks 坐标与底图地物对齐。这样调度图不再是抽象白纸，模型能把站位映射进真实场景几何。",
			parameters: {
				type: "object",
				properties: {
					title: { type: "string", description: "图标题(默认「俯视站位图」)。" },
					backgroundImageUrl: {
						type: "string",
						description:
							"户型底图 URL(本场景的「俯视平面示意图」，由场景卡图生图而来；每场景一张全章复用)。给了则符号层叠画其上(自动压一层半透明纸色保可读)；下载、类型或解码失败会显式终止，禁止自动回落纸感底。",
					},
					compositionContract: keyframeCompositionContractDef,
					durationSeconds: {
						type: "number",
						description: "本镜时长(秒)，渲进标题如「(本镜时长: 2s)」。",
					},
					width: { type: "number", description: "输出像素宽(320–2048，默认 800)。" },
					height: { type: "number", description: "输出像素高(240–2048，默认 600)。" },
					characters: {
						type: "array",
						description: "角色站位(≥1)。",
						items: {
							type: "object",
							properties: {
								name: { type: "string", description: "角色名(标签)。" },
								at: {
									type: "array",
									items: { type: "number" },
									description: "站位中心 [x,y](归一化)。",
								},
								facingTo: {
									type: "array",
									items: { type: "number" },
									description: "朝向：看向的点 [x,y](归一化，优先；如对手/门的位置)。",
								},
								facingDeg: {
									type: "number",
									description: "朝向角度(度，0=右,90=下,180=左,270=上)；facingTo 未给时用。",
								},
								moveTo: {
									type: "array",
									items: { type: "number" },
									description: "走位终点 [x,y](归一化)，画虚线箭头表示该镜内位移。",
								},
								color: { type: "string", description: "标记颜色 hex/色名，默认蓝。" },
							},
							required: ["name", "at"],
							additionalProperties: false,
						},
					},
					landmarks: {
						type: "array",
						description: "场景地标(墙/门/区域文字)。",
						items: {
							type: "object",
							properties: {
								kind: {
									type: "string",
									enum: ["wall", "door", "area"],
									description: "wall=墙线 | door=门(带摆动弧) | area=区域文字(如 楼道/房间)",
								},
								from: { type: "array", items: { type: "number" }, description: "【wall】起点 [x,y]。" },
								to: { type: "array", items: { type: "number" }, description: "【wall】终点 [x,y]。" },
								at: { type: "array", items: { type: "number" }, description: "【door/area】位置 [x,y]。" },
								orient: {
									type: "string",
									enum: ["h", "v"],
									description: "【door】门洞朝向：h=水平/v=竖直。",
								},
								lengthN: { type: "number", description: "【door】门洞长度(归一化，默认 0.12)。" },
								swing: {
									type: "string",
									enum: ["in", "out", "none"],
									description: "【door】开门方向(默认 in)。",
								},
								label: { type: "string", description: "地标文字(如 302门 / 楼道)。" },
							},
							required: ["kind"],
							additionalProperties: false,
						},
					},
					camera: {
						type: "object",
						description: "机位(可选)：三角图标 + 视锥扇形。",
						properties: {
							at: { type: "array", items: { type: "number" }, description: "机位位置 [x,y]。" },
							lookAt: { type: "array", items: { type: "number" }, description: "机位看向的点 [x,y](优先)。" },
							facingDeg: { type: "number", description: "机位朝向角度(度)；lookAt 未给时用。" },
							fovDeg: { type: "number", description: "视场角(度，默认 50)。" },
							label: { type: "string", description: "机位标签(默认「机位」)。" },
						},
						required: ["at"],
						additionalProperties: false,
					},
					axisLine: {
						type: "object",
						description: "180° 轴线(红虚线)。缺省时恰有 2 个角色则自动取两者连线。",
						properties: {
							from: { type: "array", items: { type: "number" }, description: "轴线起点 [x,y]。" },
							to: { type: "array", items: { type: "number" }, description: "轴线终点 [x,y]。" },
						},
						required: ["from", "to"],
						additionalProperties: false,
					},
				},
				required: ["characters", "compositionContract"],
				additionalProperties: false,
			},
		},
		{
			name: "tapcanvas_video_reconcile",
			description:
				"S6 视频精确回收：必须传入 video_generate_to_canvas 返回的 nodeId 与 taskId，只查询并回写这一条视频任务。已完成就原位写回 success+videoUrl 并结算积分，失败就原位写 failed 并退积分，仍在跑则保持不变。返回 {reconciled,failed,stillRunning,postersBackfilled,posterBackfillFailed,details}。禁止用其他节点或任务 ID 猜测调用，禁止因 running 重提付费任务；跨 flow 的批量孤儿恢复只由后台 recovery worker 承担。",
			parameters: {
				type: "object",
				properties: {
					nodeId: {
						type: "string",
						description: "video_generate_to_canvas 返回的真实画布视频节点 ID。",
					},
					taskId: {
						type: "string",
						description: "同一次提交返回并已持久化到该节点的真实供应商任务 ID。",
					},
				},
				required: ["nodeId", "taskId"],
				additionalProperties: false,
			},
		},
		{
			name: "tapcanvas_image_reconcile",
			description:
				"图片回收（2026-07-16 起自带服务端等待窗）：扫当前 flow 内 status=running/queued 的图片节点(image/imageEdit/storyboardImage)，查上游任务，已完成的回写 success+imageUrl、失败标 error。**还有在跑的任务时服务端内部每 5s 复查、默认最长等 45s（waitSeconds 可调 0~120），收齐或超时才返回**——所以【调一次通常就收齐了，⛔禁止旧式 8~10 连发轮询刷屏】（1K 资产图 30-60s 出图，一次调用覆盖全程；超时未齐再补一次即可）。返回 { reconciled, failed, stillRunning, details }。image_generate_to_canvas 默认提交即返 status:running——拿到 running 不是失败。",
			parameters: {
				type: "object",
				properties: {
					waitSeconds: {
						type: "number",
						description: "还有在跑任务时服务端最长等待秒数（0~120，默认 45）。0=立即返回（旧行为）。",
					},
				},
				additionalProperties: false,
			},
		},
			{
				name: "tapcanvas_analyze_image",
				description:
					"图片理解(vision)：固定使用 gpt-5.6-luna 看懂一张真实图片资产并返回文字描述与无 URL 引用描述。只接受当前 flow 的 nodeId，或当前用户/项目的 assetId（含素材具体版本 ID）；服务端在受控执行边界解析真实 URL，主模型不得读取、复制或回显存储 URL。公开 /public/vision 接口另行支持直接传入 http(s) imageUrl。模型不可用或 ID 无法解析时显式失败，不自动降级。",
				parameters: {
					type: "object",
					properties: {
						nodeId: {
							type: "string",
							description: "当前授权 flow 内具有真实图片资产的节点 ID。与 assetId 二选一。",
						},
						assetId: {
							type: "string",
							description: "上传图片资产 ID、素材资产 ID，或素材具体版本 ID。与 nodeId 二选一。",
						},
					prompt: {
						type: "string",
						description: "可选：理解问题/侧重点（如「这是什么产品、颜色材质、卖点」）。省略用默认锚定卡问法。",
					},
					},
					oneOf: [{ required: ["nodeId"] }, { required: ["assetId"] }],
					additionalProperties: false,
			},
		},
		{
			name: "tapcanvas_analyze_video",
			description:
				"只读视频理解：固定使用 doubao-seed-2-0-lite-260428 真实观看一段视频并返回分析文本与可核验 provenance。给 videoUrl 直接用；给 nodeId 从当前 flow 节点的 data.videoUrl 取。真实成片学习还要原样传 status 中的 dramaticCoverage，返回 dramaticCoverageHash 证明模型实际收到该合同。生成后的分析不会删除、覆盖或自动返工已有资产。返回 { text, videoUrl, model, fps, promptHash, analysisHash, segmentCount, analyzedAt, dramaticCoverageHash? }。",
			parameters: {
				type: "object",
				properties: {
					videoUrl: {
						type: "string",
						description: "要理解的视频公网 URL。优先于 nodeId。",
					},
					nodeId: {
						type: "string",
						description: "当前 flow 内视频节点 id；videoUrl 未提供时从其 data.videoUrl 解析。",
					},
					prompt: {
						type: "string",
						description: "可选：评估问题/侧重点。省略用默认 QA 问法(真实感/动态/一致/失真/口播)。",
					},
					dramaticCoverage: {
						type: "array",
						minItems: 1,
						description:
							"真实成片学习时必填：从同 run status.executionProvenance.clips 原样提取的 [{clipIndex,dramaticCoverage}]。工具会把事实交给视频理解模型并返回 dramaticCoverageHash；普通视频理解可省略。",
						items: {
							type: "object",
							additionalProperties: false,
							required: ["clipIndex", "dramaticCoverage"],
							properties: {
								clipIndex: { type: "integer", minimum: 0 },
								dramaticCoverage: { type: "object", additionalProperties: true },
							},
						},
					},
				},
				additionalProperties: false,
			},
		},
		{
			name: "tapcanvas_decompose_video",
			description:
				"视频镜头分解(复刻/二改前置)：把一条参考片自动拆成 ShotTable —— ffprobe 取时长/比例/帧率 → PySceneDetect 切镜头边界(不可用时固定窗口降级) → 每镜抽首/中/尾三关键帧上托管(TOS) → 每镜喂 vision 产出 9 维镜头语言(景别/机位/运镜/焦段/主体/动作/场景/光线/构图)。返回 { shotTable:{version,sourceVideoUrl,totalDurationSec,aspectRatio,fps,mode,detectMethod,shotCount,cuts:[{index,startSec,endSec,durationSec,keyFrames:[{timeSec,url,role}],caption{9维},replicateMode}]} }。复刻视频时先调它吃透原片(分镜真相源)，再据 cuts 逐镜复刻/换主体；ShotTable 仅驻对话上下文(不落库)。给 sourceUrl 直接用；给 nodeId 从当前 flow 视频节点 data.videoUrl 取。",
			parameters: {
				type: "object",
				properties: {
					sourceUrl: {
						type: "string",
						description: "参考视频公网 URL（优先于 nodeId）。",
					},
					nodeId: {
						type: "string",
						description:
							"当前 flow 内视频节点 id；sourceUrl 未提供时从其 data.videoUrl 解析。",
					},
					mode: {
						type: "string",
						enum: ["exact", "swap"],
						description:
							"复刻基调：exact=逐镜精确复刻(默认)，帧锁原片；swap=换主体/换货保留镜头语言。写入 ShotTable.mode 及每个 cut.replicateMode，后续可逐镜覆盖。",
					},
				},
				additionalProperties: false,
			},
		},
		{
			name: "tapcanvas_distill_director_breakdown",
			description:
				"导演拆解(复刻=学习闭环·理解层 ①)：对一条参考片做一次视频理解，产出结构化 DirectorBreakdown：整片 logline、叙事结构、节奏语态、视觉母题、signatureShot，以及逐镜景别、机位、运镜、焦段、主体、动作、场景、光线、构图、剪辑关系与导演意图。ffprobe 补精确总时长、比例和帧率。cast 与 locations 只提供事实清单；需要一致性资产时，角色统一交给 tapcanvas-character-card 生成 character-card/v3，场景与物理打光统一交给 tapcanvas-scene-card 生成 scene-card/v1 + scene-lighting/v1，再以结构化 nodeId/referenceAssetId 绑定。Hono 不提供角色/场景提示词模板、名称查库或 URL 物化旁路。本工具只理解、不抽帧、不复用原片像素；原片仅作对比基准。长片自动切段理解再合并。sourceUrl 优先；否则从当前 flow 的 nodeId 解析视频。",
			parameters: {
				type: "object",
				properties: {
					sourceUrl: {
						type: "string",
						description: "参考视频公网 URL（优先于 nodeId）。",
					},
					nodeId: {
						type: "string",
						description:
							"当前 flow 内视频节点 id；sourceUrl 未提供时从其 data.videoUrl 解析。",
					},
					writeToCanvas: {
						type: "boolean",
						description:
							"可选：true 且在章节画布会话时，把拆解产物写成画布「拆片卡」text 节点（prompt=人读 markdown 拆片报告、data.directorBreakdown=结构化 JSON 真值），返回 data.canvasNodeId——拆片成为可连边引用的一等画布资产（下游 video 节点作剧情参考）。复刻/对标工作流建议开启；纯问答式拆解可省略。",
					},
				},
				additionalProperties: false,
			},
		},
		{
			name: "tapcanvas_video_compare",
			description:
				"视频对比QA(复刻=学习闭环 ④)：把【复刻成片】与【原片】各自的导演拆解卡逐维 diff 打分——衡量复刻片对原片导演意图的还原度(叙事/节奏/机位运镜/构图/主体一致性/总体)，列出偏离点 + 可定位到镜号的改进建议。这是「测试&提升」的反馈信号：据 scorecard 决定是否改某镜 StoryPlan 重生。返回 { scorecard:{dims:{narrative,pacing,camera,composition,consistency,overall}各{score:0-100,note},diffs:[],suggestions:[]}, originalBreakdown, replicaBreakdown }。复刻片必给 replicaUrl 或 replicaNodeId；原片基准优先传①已产出的 originalBreakdown(省一次原片理解)，没有则传 originalUrl 现拆。",
			parameters: {
				type: "object",
				properties: {
					replicaUrl: {
						type: "string",
						description: "复刻成片公网 URL（优先于 replicaNodeId）。",
					},
					replicaNodeId: {
						type: "string",
						description: "复刻成片节点 id；replicaUrl 未提供时从其 data.videoUrl 解析。",
					},
					originalUrl: {
						type: "string",
						description: "原片公网 URL（作对比基准；与 originalBreakdown 二选一）。",
					},
					originalBreakdown: {
						type: "object",
						description: "①distill 已产出的原片导演拆解卡(优先；省一次原片理解)。",
					},
				},
				additionalProperties: false,
			},
		},
		{
			name: "tapcanvas_fetch_video_from_url",
			description:
				"抓取视频并转存托管(TOS)，返回 { ok, videoUrl:<TOS直链mp4>, sourcePage, title?, durationSec? }。公开抖音作品 URL 走唯一的 Douyin SSR 路径：解析公开分享页的结构化作品数据，校验精确作品 ID、公开状态、ByteDance 媒体域名、响应类型与字节边界；该路径失败时原地返回阶段化 agents_tool_fetch_video_douyin_* 错误，不回退到 yt-dlp。其他观看页使用 yt-dlp 抓取最佳视频流并由 ffmpeg 合并音视频；非零退出统一返回 agents_tool_fetch_video_ytdlp_failed 与有界 stderr 诊断，不根据错误文案猜测 DRM、会员或站点类型。用途：把 web_search 得到的观看页落成 decompose_video / analyze_video 可读取的稳定 TOS 视频 URL。版权合规由用户负责。",
			parameters: {
				type: "object",
				properties: {
					pageUrl: {
						type: "string",
						description:
							"视频播放/观看页 URL。公开抖音作品使用专用 SSR 解析；B站、YouTube、官方站等其他页面使用 yt-dlp 抓取并转存 TOS。",
					},
				},
				required: ["pageUrl"],
				additionalProperties: false,
			},
		},
		{
			name: "tapcanvas_capture_director_scene",
			description:
				"组装一个导演台 3D 场景并直接渲染出一张机位占位图（参考图）。在空 3D 空间按三维坐标摆放素体角色、家具道具与单个机位，浏览器离屏渲染后返回 TOS 图 URL，可直接作为出图/故事板的空间构图参考。强烈建议为每个角色设 posePresetId 指定贴合剧情的姿势——缺省是无表演信息的 T-pose 素体。" +
				`可用姿势预设（id中文名）——${DIRECTOR_POSE_LABELS}。` +
				`可用道具（id中文名）——${DIRECTOR_PROP_LABELS}。` +
				"【摆位规范】家具道具为真实米制尺寸、底面落地，禁止放大成墙（uniformScale≤3）、禁止摆在镜头与人物之间；机位 lookAt 指向角色群中点、确保每个具名角色都在画面内——服务端会做视锥+遮挡构图校验，角色出画或被道具完全遮挡会直接拒绝并告知修法。" +
				"【先建空间再拍镜头】若该场景已有 720° 全景图（isPanoramic 节点），把其 imageUrl 传 scene.skybox 作天空盒——人物/机位摆进真实环境，blocking 帧自带空间方位；无全景图才用 prop-* 空舞台摆场。" +
				"仅在用户浏览器在线的交互会话可用。重试用同一 requestId（幂等命中），同场景再出一张须换新 requestId。",
			parameters: {
				type: "object",
				additionalProperties: false,
				properties: {
					id: { type: "string", description: "导演台节点稳定 ID（create-if-absent）。格式 agent-<intent>-<batchUlid>-director" },
					requestId: { type: "string", description: "本次出图的确定性 ID，作幂等域；重试沿用、重出换新" },
					scene: {
						type: "object",
						additionalProperties: false,
						properties: {
							characters: {
								type: "array",
								items: {
									type: "object",
									additionalProperties: false,
									properties: {
										id: { type: "string" },
										name: { type: "string" },
										modelId: { type: "string", description: "素体：male|female|broad|muscular|slim|teen|child|chibi（或 prop-* 道具、或 http(s) GLB URL）" },
										position: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 },
										rotation: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 },
										uniformScale: { type: "number" },
										colorHex: { type: "string" },
										// 注意：枚举/详细说明放工具 description（schema 体积超 defer 阈值会被剥成
										// 无结构占位，实证导致模型把参数序列化成字符串）。合法 id 由服务端 zod
										// enum(DIRECTOR_POSE_IDS) 严校验，传错会回吐全表。
										posePresetId: { type: "string", description: "姿势预设 id（强烈建议设定，缺省=T-pose；完整 id 列表见本工具 description）" },
										pose: {
											type: "object",
											additionalProperties: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 },
											description: "进阶：逐关节欧拉弧度 {spine|neck|shoulderL|elbowL|shoulderR|elbowR|hipL|kneeL|hipR|kneeR:[x,y,z]}，优先于 posePresetId",
										},
									},
									required: ["id", "name", "modelId", "position"],
								},
							},
							camera: {
								type: "object",
								additionalProperties: false,
								properties: {
									position: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 },
									lookAtMode: { type: "string", description: "'manual' 或某个 character.id" },
									lookAt: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 },
									fovDeg: { type: "number" },
								},
								required: ["position"],
							},
							aspect: { type: "string", enum: ["auto", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"] },
							// 详细用法见本工具 description「先建空间再拍镜头」段（inline 说明会撑爆 defer 阈值，故精简）。
							skybox: {
								type: "string",
								description: "可选：全景背景图 URL。2:1 等距全景直接作天空盒；非 2:1 普通图前端自适应转环幕穹顶（接缝/极点已优化），也可用",
							},
							skyboxYaw: { type: "number", description: "可选：全景背景水平旋转(度 0..360)，转背景取景不动机位" },
							skyboxPitch: { type: "number", description: "可选：全景地平线俯仰校准(度 -45..45)，用于让背景地面与导演网格对齐" },
						},
						required: ["characters", "camera"],
					},
				},
				required: ["id", "requestId", "scene"],
			},
		},
		{
			name: "tapcanvas_render_director_clip",
			description:
				"组装一个导演台 3D 场景 + 关键帧动画，浏览器离屏渲一段 clay 灰模 mp4 样片，产出一个 video 节点（data.sourceVideoUrl 已就绪，可直接作 seedance 视频参考 v2v 重构成电影级成片）。用于需精确控制运镜/物体运动时机的镜头（推轨/环绕/直升机视角/复杂走位）——3D 灰模确定性钉死运动轨迹，真实感全交 seedance，勿对灰模本身做画质要求。" +
				"【animation 格式】cameras 为 {相机id: {position:[{t,value:[x,y,z]}], lookAt:[{t,value:[x,y,z]}], fovDeg:[{t,value:[度]}]}}（相机 id 用 capture-cam）；characters 为 {角色id: {position:[{t,value:[x,y,z]}], rotation:[{t,value:[x,y,z]}]}}（角色 id 须与 scene.characters[].id 一致）。每条轨道是 [{t,value}] 关键帧数组，t 为秒、value 为数字数组；单关键帧=全程常量，区间内线性插值。durationSeconds 建议 3~5、fps 建议 24。" +
				"【护栏】animation 及其内部轨道必须是真 JSON 对象/数组，禁止序列化成字符串传入。" +
				"【骨骼动画 motionClip】animation.characters 每个角色可加 motionClip 让其做连续骨骼动作(优先于静态 posePresetId、自动循环填满时长)：idle/walk/run/agree(点头)/headShake(摇头)/sad_pose/sneak_pose/wave(挥手)；另可加 motionSpeed(默认1)。要让人物在样片里真动起来务必设 motionClip,否则只是定格姿势。**库里没有的动作(跳舞/挥拳/坐下/任意编排)先调 tapcanvas_director_define_motion 编出来(PoseClip 关键帧)再用其 id 当 motionClip;严禁传不存在的名(如凭空 dance)——会静默失败、人不动。**" +
				"【混合分层动作 motion】(覆盖 motionClip，优先级更高)animation.characters[id].motion={durationSeconds:秒,poseTrack?:[{t:秒,pose:{关节:[x,y,z]弧度}}],poseMask?:关节数组(缺省:有locomotion=上半身spine/neck/shoulderL/elbowL/shoulderR/elbowR,否则全身),locomotion?:{clip:'walk'|'run'|'idle',path?:{waypoints:[[x,z]地面坐标(米),...],mode:'linear'|'curve',closed?:bool},speed?:腿部循环速率倍率(默认1,只调腿动作快慢,不改行进距离;行进距离由path长度÷durationSeconds决定)}}。上半身poseTrack叠在baked腿动作之上；根节点沿path匀速行进、朝向自动跟切线。关节名:spine neck shoulderL elbowL shoulderR elbowR hipL kneeL hipR kneeR。" +
				"【相机环绕 cameraOrbit】想要镜头运动(对 v2v 是最强运动线索)就设 animation.cameraOrbit:{center:[x,y,z]默认[0,0,0], radius默认6, height默认1.6, degrees默认360(整圈,180=半弧), startDeg默认0, fovDeg默认40, lookAtHeight默认1.3}。每帧算精确圆周比手摆 cameras 关键帧更平滑;设了 cameraOrbit 就不必再写 cameras 轨道。角色可同时保持 motionClip 动作。" +
				`角色姿势预设 posePresetId 取值同 tapcanvas_capture_director_scene（${DIRECTOR_POSE_LABELS}）。camera.lookAtMode='manual' 或某 character.id；scene.skybox 可传 720° 等距全景图 URL 作天空盒（同 capture 工具）。仅在用户浏览器在线的交互会话可用；重试用同一 requestId（幂等），重渲换新 requestId。`,
			parameters: {
				type: "object",
				additionalProperties: false,
				properties: {
					id: { type: "string", description: "导演台节点稳定 ID（create-if-absent）" },
					requestId: { type: "string", description: "幂等域 ID；重试沿用、重渲换新" },
					scene: {
						type: "object",
						additionalProperties: false,
						properties: {
							characters: {
								type: "array",
								items: {
									type: "object",
									additionalProperties: false,
									properties: {
										id: { type: "string" },
										name: { type: "string" },
										modelId: { type: "string", description: "素体 male|female|broad|muscular|slim|teen|child|chibi 或 prop-* 或 GLB URL" },
										position: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 },
										rotation: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 },
										uniformScale: { type: "number" },
										colorHex: { type: "string" },
										posePresetId: { type: "string" },
									},
									required: ["id", "name", "modelId", "position"],
								},
							},
							camera: {
								type: "object",
								additionalProperties: false,
								properties: {
									position: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 },
									lookAtMode: { type: "string" },
									lookAt: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 },
									fovDeg: { type: "number" },
								},
								required: ["position"],
							},
							aspect: { type: "string", enum: ["auto", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"] },
							skybox: { type: "string" },
							skyboxYaw: { type: "number" },
							skyboxPitch: { type: "number" },
						},
						required: ["characters", "camera"],
					},
					animation: {
						type: "object",
						additionalProperties: false,
						properties: {
							durationSeconds: { type: "number" },
							fps: { type: "number" },
							cameras: { type: "object", additionalProperties: true },
							characters: { type: "object", additionalProperties: true },
							cameraOrbit: { type: "object", additionalProperties: true },
						},
						required: ["durationSeconds", "fps"],
					},
				},
				required: ["id", "requestId", "scene", "animation"],
			},
		},
		{
			name: "tapcanvas_director_define_motion",
			description:
				"定义一段可复用的自定义骨骼动画（PoseClip），存入导演台节点 data.scene.customMotions（同 id 替换、否则追加）。" +
				"后续在 tapcanvas_render_director_clip 的 animation.characters.<角色id>.motionClip 填该 motion.id，角色就会在样片里做这段自定义动作（优先于 posePresetId、自动循环填满时长）；若传 characterId 则同步把该角色的 motionClip 设为该 id。" +
				"【关节空间·规范·弧度】joints = spine|neck|shoulderL|elbowL|shoulderR|elbowR|hipL|kneeL|hipR|kneeR；" +
				"pose 值为 [x,y,z] 欧拉弧度(XYZ顺序，与 capture 工具逐关节 pose 字段完全相同)：spine/neck x+前倾 y+左转 z+右倾；shoulderL z+抬 x-前摆；shoulderR z-抬；elbowL y-弯；elbowR y+弯；hipL/R x-前抬腿；kneeL/R x+弯曲。" +
				"【例·招手2帧 durationSeconds:1,loop:true】keyframes:[{t:0,pose:{shoulderR:[0,0,-1.22],elbowR:[0,0.79,0]}},{t:0.5,pose:{shoulderR:[0,0,-1.22],elbowR:[0,1.40,0]}}]",
			parameters: {
				type: "object",
				additionalProperties: false,
				properties: {
					id: { type: "string", description: "导演台节点 id" },
					characterId: { type: "string", description: "可选:把动作直接挂到该角色(设其 motionClip)" },
					motion: {
						type: "object",
						additionalProperties: false,
						properties: {
							id: { type: "string" },
							name: { type: "string" },
							durationSeconds: { type: "number" },
							loop: { type: "boolean" },
							keyframes: { type: "array", items: { type: "object", additionalProperties: true } },
						},
						required: ["id", "name", "durationSeconds", "keyframes"],
					},
				},
				required: ["id", "motion"],
			},
		},
		{
			name: "tapcanvas_director_set_character_motion",
			description:
				"把混合分层动作（CharacterMotion）直接写入导演台场景中指定角色的 motion 字段（覆盖原值，优先级高于 motionClip/posePresetId）。" +
				"适用于 AI 实时编排角色行走路径、骨骼 pose 轨迹等，写入后用户可在动画 tab 直接看到并调整。" +
				"【motion 字段说明】durationSeconds(必填,秒,>0)；" +
				"poseTrack?:[{t:秒,pose:{关节:[x,y,z]弧度}}] 关节名同 tapcanvas_director_define_motion；" +
				"poseMask?:关节名数组(缺省:有locomotion=上半身,否则全身)；" +
				"locomotion?:{clip:'walk'|'run'|'idle',path?:{waypoints:[[x,z]地面坐标(米),...],mode:'linear'|'curve',closed?:bool},speed?:腿部循环速率倍率(默认1)}。" +
				"上半身 poseTrack 叠在 baked 腿动作之上；根节点沿 path 匀速行进、朝向自动跟切线。",
			parameters: {
				type: "object",
				additionalProperties: false,
				properties: {
					id: { type: "string", description: "导演台节点 id" },
					characterId: { type: "string", description: "要设置动作的角色 id（scene.characters[].id）" },
					motion: {
						type: "object",
						additionalProperties: false,
						description: "CharacterMotion：混合分层动作描述",
						properties: {
							durationSeconds: { type: "number", description: "动作总时长（秒），必须 > 0" },
							poseTrack: {
								type: "array",
								description: "骨骼关键帧序列",
								items: {
									type: "object",
									additionalProperties: true,
									properties: {
										t: { type: "number", description: "时间点（秒）" },
										pose: { type: "object", additionalProperties: true, description: "关节 → [x,y,z] 弧度映射" },
									},
									required: ["t", "pose"],
								},
							},
							poseMask: {
								type: "array",
								items: { type: "string" },
								description: "只更新哪些关节；缺省：有 locomotion 时=上半身，否则=全身",
							},
							locomotion: {
								type: "object",
								additionalProperties: false,
								description: "腿部位移动作",
								properties: {
									clip: { type: "string", enum: ["walk", "run", "idle"], description: "基础步态循环" },
									path: {
										type: "object",
										additionalProperties: false,
										description: "行走路径",
										properties: {
											waypoints: {
												type: "array",
												items: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 },
												description: "地面坐标序列 [[x,z],...]（米）",
											},
											mode: { type: "string", enum: ["linear", "curve"], description: "路径插值方式" },
											closed: { type: "boolean", description: "是否闭合成循环路径" },
										},
										required: ["waypoints", "mode"],
									},
									speed: { type: "number", description: "腿部动画循环速率倍率（默认 1）" },
								},
								required: ["clip"],
							},
						},
						required: ["durationSeconds"],
					},
				},
				required: ["id", "characterId", "motion"],
			},
		},
		{
			name: "tapcanvas_master_storyboard_split",
			description:
				"大故事板·确定性结构拆板：读取一个已存在的母板节点（taskNode + storyboardImage + productionLayer=master_board），按 masterShotTable.segments 在同一真实画布原子创建 N 个小故事板占位、N 个视频占位、1 个 composeVideo 节点及派生边。节点和边 id 由显式 runId 稳定生成；重复调用只复用结构身份完全一致的节点，id 冲突会显式失败。videoModel 必须来自当前 enabledVideoModels，且每段 durationSeconds 必须匹配该模型实时 durationOptions。此工具不调用模型、不计费、不生成 prompt、不产出媒体，也不代表视频交付完成；成功后主 agent 必须继续调用 image/video prompt specialists，逐节点生成真实资产并完成合成与交付验证。没有 parentGroupId 且母板不在组内时，会创建一个明确标记为 master_storyboard_split 的稳定组。任何缺字段、目录不一致、表结构错误或覆盖冲突都会原样返回 ok:false，禁止本地修补、数字强转或模型默认值。",
			parameters: {
				type: "object",
				properties: {
					masterBoardNodeId: {
						type: "string",
						description: "画布上母板节点的 id（storyboardImage，productionLayer=master_board，data.masterShotTable 必须存在且合法）。",
					},
					runId: {
						type: "string",
						description: "本次拆板的稳定 runId，作小板/视频/成片节点 id 前缀以保证幂等；同一母板重复拆板用同一 runId 不会重复建节点。",
					},
					videoModel: {
						type: "string",
						description: "必填：从当前 enabledVideoModels 复制的精确 modelKey；服务端会读取实时 catalog 验证，不提供默认模型。",
					},
					aspect: {
						type: "string",
						description: "可选：视频宽高比（如 16:9 / 9:16）。不传则从母板节点 data.aspectRatio / data.videoAspect 派生。",
					},
					parentGroupId: {
						type: "string",
						description: "可选：组节点 id，让小板/视频/成片落进同一组。不传则从母板节点 parentId 派生。",
					},
					masterShotTable: {
						type: "object",
						description: "可选：直接提交完整结构化镜头表；未传时只读取母板 data.masterShotTable。形状：{title,globalStyleAnchor,characterLocks:[],sceneLocks:[],segments:[{segmentIndex:从0连续递增,beatName,durationSeconds:必须属于所选模型 durationOptions,shots:[{shotNo,景别,构图,运镜,动作,光效,台词,音效}](1-6镜)}]}。服务端不做字符串转数字、不补空字段；若母板已有不同表，不会覆盖，须先用显式 flow_patch 解决冲突。",
						additionalProperties: true,
					},
				},
				required: ["masterBoardNodeId", "runId", "videoModel"],
				additionalProperties: false,
			},
		},
	);

	return tools.map(attachRemoteToolExecutionSemantics);
}

export function inspectAgentsBridgeRemoteToolSurface(
	input: AgentsBridgeRemoteToolsInput,
): AgentsBridgeRemoteToolSurfaceResolution<AgentsBridgeRemoteToolDefinition> {
	return resolveAgentsBridgeRemoteToolSurface({
		scope: {
			publicAgentsRequest: input.publicAgentsRequest,
			projectId: input.canvasProjectId,
			flowId: input.canvasFlowId,
			bookId: input.bookId,
			chapterId: input.chapterId,
			nodeId: input.canvasNodeId,
			executionId: input.executionId,
		},
		tools: buildAgentsBridgeRemoteToolCatalog(input),
		disabledCapabilities: input.disabledBuiltInCapabilities,
	});
}

export function buildAgentsBridgeRemoteTools(
	input: AgentsBridgeRemoteToolsInput,
): AgentsBridgeRemoteToolDefinition[] {
	return inspectAgentsBridgeRemoteToolSurface(input).tools;
}

/**
 * A project-only chat request may arrive before the Web canvas store has
 * published its current flow id. The agent bridge must not turn that transient
 * transport omission into a false "image generation is unavailable" result.
 * Resolving a flow is safe only when the authenticated project has exactly one
 * owner-visible flow; multiple flows remain an explicit scope gap rather than
 * being guessed from recency or a label.
 */
export function resolveUniqueProjectCanvasFlowId(flowIds: readonly string[]): string | null {
	const normalized = flowIds
		.map((flowId) => flowId.trim())
		.filter((flowId, index, values) => flowId.length > 0 && values.indexOf(flowId) === index);
	return normalized.length === 1 ? normalized[0] : null;
}

function isNodeRuntime(): boolean {
	const processRef = (globalThis as {
		process?: { versions?: { node?: unknown }; env?: Record<string, string | undefined> };
	}).process;
	return !!processRef?.versions?.node;
}

function readNodeProcessEnv(key: string): string {
	const processRef = (globalThis as {
		process?: { env?: Record<string, string | undefined> };
	}).process;
	const value = processRef?.env?.[key];
	return typeof value === "string" ? value : "";
}

function isConnRefusedError(err: unknown): boolean {
	const errorRecord = isRecord(err) ? err : null;
	const causeRecord = isRecord(errorRecord?.cause) ? errorRecord.cause : null;
	const msg = String(errorRecord?.message || "");
	const cause = String(causeRecord?.message || "");
	const combined = `${msg}\n${cause}`.toLowerCase();
	return combined.includes("econnrefused") || combined.includes("connect refused");
}

function readBoolEnvFlag(value: unknown): boolean {
	const v = String(value ?? "")
		.trim()
		.toLowerCase();
	return v === "1" || v === "true" || v === "yes" || v === "on";
}

function readAgentsBridgeDebugLog(c: AppContext): boolean {
	const fromEnv = readBoolEnvFlag(c.env.AGENTS_BRIDGE_DEBUG_LOG);
	if (fromEnv) return true;
	const fromProcess = (globalThis as {
		process?: { env?: Record<string, string | undefined> };
	}).process?.env?.AGENTS_BRIDGE_DEBUG_LOG;
	return readBoolEnvFlag(fromProcess);
}

function isHeadersTimeoutError(err: unknown): boolean {
	const errorRecord = isRecord(err) ? err : null;
	const causeRecord = isRecord(errorRecord?.cause) ? errorRecord.cause : null;
	const msg = String(errorRecord?.message || "");
	const causeMsg = String(causeRecord?.message || "");
	const code = String(errorRecord?.code || causeRecord?.code || "");
	const combined = `${msg}\n${causeMsg}`.toLowerCase();
	return (
		combined.includes("headers timeout") ||
		combined.includes("und_err_headers_timeout") ||
		code === "UND_ERR_HEADERS_TIMEOUT"
	);
}

type AgentsBridgeAdmissionReconciliation = Readonly<{
	receipt: AgentsBridgeAdmissionReceiptV1;
	finalResponse: string | null;
}>;

export function classifyAgentsBridgeAdmissionStatus(input: Readonly<{
	payload: unknown;
	publicTurnId: string;
	sessionId: string;
	reconciledAt?: string;
}>): AgentsBridgeAdmissionReconciliation {
	const root = isRecord(input.payload) ? input.payload : null;
	const turn = isRecord(root?.turn) ? root.turn : null;
	const observedTurnId = typeof turn?.turnId === "string" ? turn.turnId.trim() : "";
	const turnState = typeof turn?.state === "string" && turn.state.trim()
		? turn.state.trim()
		: null;
	const activeTurn = typeof root?.activeTurn === "boolean" ? root.activeTurn : null;
	const accepted = observedTurnId === input.publicTurnId && turnState !== null && activeTurn !== null;
	return {
		receipt: {
			version: 1,
			acceptance: accepted ? "accepted" : "unknown",
			publicTurnId: input.publicTurnId,
			sessionId: input.sessionId,
			turnState: accepted ? turnState : null,
			activeTurn: accepted ? activeTurn : null,
			reconciledAt: input.reconciledAt ?? new Date().toISOString(),
		},
		finalResponse:
			accepted && typeof turn?.finalResponse === "string" && turn.finalResponse.trim()
				? turn.finalResponse.trim()
				: null,
	};
}

async function reconcileAgentsBridgeAdmission(input: Readonly<{
	baseUrl: string;
	token: string;
	userId: string;
	sessionId: string;
	publicTurnId: string;
}>): Promise<AgentsBridgeAdmissionReconciliation> {
	if (!input.sessionId) {
		return classifyAgentsBridgeAdmissionStatus({
			payload: null,
			publicTurnId: input.publicTurnId,
			sessionId: "<missing>",
		});
	}
	const controller = new AbortController();
	const timeoutHandle = setTimeout(() => controller.abort(), 10_000);
	try {
		const response = await fetch(`${input.baseUrl}/chat/status`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				...buildAgentsBridgeSessionAffinityHeader({
					userId: input.userId,
					sessionId: input.sessionId,
				}),
				...(input.token ? { Authorization: `Bearer ${input.token}` } : {}),
			},
			body: JSON.stringify({ userId: input.userId, sessionId: input.sessionId }),
			signal: controller.signal,
		});
		const payload: unknown = await response.json().catch(() => null);
		return classifyAgentsBridgeAdmissionStatus({
			payload: response.ok ? payload : null,
			publicTurnId: input.publicTurnId,
			sessionId: input.sessionId,
		});
	} catch {
		return classifyAgentsBridgeAdmissionStatus({
			payload: null,
			publicTurnId: input.publicTurnId,
			sessionId: input.sessionId,
		});
	} finally {
		clearTimeout(timeoutHandle);
	}
}

function buildAcceptedPendingAgentsBridgeResponse(
	reconciliation: AgentsBridgeAdmissionReconciliation,
): Response {
	const reasonCode = "agents_bridge_request_accepted_pending";
	const response: AgentsBridgeChatResponse = {
		id: `agents_reconciled_${reconciliation.receipt.publicTurnId}`,
		text: "",
		trace: {
			toolCalls: [],
			turns: [],
			output: { textChars: 0, preview: "", head: "", tail: "" },
			summary: {
				totalToolCalls: 0,
				succeededToolCalls: 0,
				failedToolCalls: 0,
				deniedToolCalls: 0,
				blockedToolCalls: 0,
				runMs: 0,
			},
			completion: {
				version: 1,
				source: "deterministic",
				terminal: "suspended",
				allowFinish: true,
				failureReason: null,
				rationale: "agents-cli 已受理同一 public turn；当前 HTTP 响应头结果未知，等待 durable status 的后续证据。",
				successCriteria: [],
				missingCriteria: ["同一 publicTurnId 的逻辑终态与交付证据"],
				requiredActions: ["仅对账同一 publicTurnId 的 durable status，禁止重放 /chat"],
			},
			runOutcome: {
				version: 1,
				terminal: true,
				status: "suspended",
				reason: reasonCode,
			},
			runtime: {
				profile: "unknown",
				registeredToolNames: [],
				registeredTeamToolNames: [],
				requiredSkills: [],
				loadedSkills: [],
				allowedSubagentTypes: [],
				requireAgentsTeamExecution: false,
				admissionReceipt: reconciliation.receipt,
			},
		},
	};
	return new Response(JSON.stringify(response), {
		status: 202,
		headers: { "Content-Type": "application/json" },
	});
}

async function createNodeFetchDispatcher(timeoutMs: number): Promise<unknown | null> {
	if (!isNodeRuntime()) return null;
	const key = Math.max(5_000, Math.floor(timeoutMs));
	if (nodeFetchDispatcherCache.has(key)) {
		return nodeFetchDispatcherCache.get(key) || null;
	}
	try {
		const { Agent } = await import("undici");
		const dispatcher = new Agent({
			headersTimeout: key + 15_000,
			bodyTimeout: key + 15_000,
		});
		nodeFetchDispatcherCache.set(key, dispatcher);
		return dispatcher;
	} catch (error) {
		throw new AppError("Agents bridge HTTP dispatcher 初始化失败", {
			status: 500,
			code: "agents_bridge_dispatcher_init_failed",
			details: {
				message: error instanceof Error ? error.message : String(error),
			},
		});
	}
}

function truncateForDebugLog(input: unknown, maxChars = 1200): string {
	const text = String(input ?? "");
	if (!text) return "";
	return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
}

export async function maybeStartAgentsBridgeOnDemand(c: AppContext): Promise<string> {
	if (!isNodeRuntime()) return readAgentsBridgeBaseUrl(c);
	try {
		const mod = await import("../../platform/node/agents-bridge-autostart");
		if (typeof mod?.maybeAutostartAgentsBridge === "function") {
			await mod.maybeAutostartAgentsBridge();
		}
		const processBase = readNodeProcessEnv("AGENTS_BRIDGE_BASE_URL").trim();
		if (processBase) {
			c.env.AGENTS_BRIDGE_BASE_URL = processBase;
		}
	} catch (error) {
		throw new AppError("Agents bridge 本地启动失败", {
			status: 503,
			code: "agents_bridge_autostart_failed",
			details: {
				message: error instanceof Error ? error.message : String(error),
			},
		});
	}
	return readAgentsBridgeBaseUrl(c);
}

export function readAgentsBridgeToken(c: AppContext): string | null {
	const raw =
		typeof c.env.AGENTS_BRIDGE_TOKEN === "string" ? c.env.AGENTS_BRIDGE_TOKEN : "";
	const trimmed = raw.trim();
	return trimmed ? trimmed : null;
}

export type AgentsBridgeQueuedMessageReceipt = {
	accepted: true;
	queueId: string;
	mode: "steering" | "follow_up";
	sessionId: string;
	activeTurn: boolean;
};

export function parseAgentsBridgeQueuedMessageReceipt(
	payload: unknown,
	input: { mode: "steering" | "follow_up"; sessionId: string },
): AgentsBridgeQueuedMessageReceipt {
	if (!payload || typeof payload !== "object") {
		throw new AppError("Agents queue response is not an object", {
			status: 502,
			code: "agents_bridge_queue_invalid_response",
		});
	}
	const receipt = payload as Record<string, unknown>;
	const queueId = typeof receipt.queueId === "string" ? receipt.queueId.trim() : "";
	if (receipt.accepted !== true || !queueId) {
		throw new AppError("Agents queue response is missing an accepted durable queueId", {
			status: 502,
			code: "agents_bridge_queue_invalid_response",
		});
	}
	return {
		accepted: true,
		queueId,
		mode: input.mode,
		sessionId: input.sessionId,
		activeTurn: receipt.activeTurn === true,
	};
}

export async function enqueueAgentsBridgeMessage(
	c: AppContext,
	userId: string,
	input: {
		sessionId: string;
		prompt: string;
		queueMode: "steering" | "follow_up";
		modelKey?: string;
		modelAlias?: string;
		generationProposal?: AgentsBridgeGenerationProposal;
	},
): Promise<AgentsBridgeQueuedMessageReceipt> {
	const effectiveUserId = resolveEffectiveUserId(c, userId);
	if (!effectiveUserId) {
		throw new AppError("Unauthorized: missing userId for agents bridge", {
			status: 401,
			code: "unauthorized",
		});
	}
	let baseUrl = readAgentsBridgeBaseUrl(c);
	if (!baseUrl) baseUrl = await maybeStartAgentsBridgeOnDemand(c);
	if (!baseUrl) {
		throw new AppError("Agents bridge 未配置（缺少 AGENTS_BRIDGE_BASE_URL）", {
			status: 400,
			code: "agents_bridge_not_configured",
		});
	}
	const token = readAgentsBridgeToken(c);
	const response = await fetch(`${baseUrl}/chat`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			...buildAgentsBridgeSessionAffinityHeader({
				userId: effectiveUserId,
				sessionId: input.sessionId,
			}),
			...(token ? { Authorization: `Bearer ${token}` } : {}),
		},
		body: JSON.stringify({
			userId: effectiveUserId,
			sessionId: input.sessionId,
			prompt: input.prompt,
			queueMode: input.queueMode,
			...(input.modelKey ? { modelKey: input.modelKey } : {}),
			...(input.modelAlias ? { modelAlias: input.modelAlias } : {}),
			...(input.generationProposal ? { generationProposal: input.generationProposal } : {}),
		}),
	});
	const payload: unknown = await response.json().catch(() => null);
	if (!response.ok) {
		const errorValue =
			payload && typeof payload === "object" && "error" in payload
				? (payload as { error?: unknown }).error
				: null;
		const message =
			typeof errorValue === "string"
				? errorValue
				: errorValue && typeof errorValue === "object" && "message" in errorValue
					? String((errorValue as { message?: unknown }).message || "")
					: "";
		throw new AppError(message || `Agents queue request failed: ${response.status}`, {
			status: response.status,
			code: "agents_bridge_queue_failed",
		});
	}
	return parseAgentsBridgeQueuedMessageReceipt(payload, {
		mode: input.queueMode,
		sessionId: input.sessionId,
	});
}

function normalizeModelProtocolFamily(model: string | null | undefined): string {
	return String(model || "").trim().toLowerCase().split("[", 1)[0];
}

function deriveOverrideApiStyle(model: string | null | undefined): "responses" | "chat" {
	const normalized = normalizeModelProtocolFamily(model);
	if (normalized.startsWith("gpt-")) return "responses";
	return "chat";
}

function resolveUserLlmProxyOverride(input: {
	tapcanvasApiBaseUrl: string;
	tapcanvasApiKey: string;
}): { apiKey: string; apiBaseUrl: string } | null {
	const apiBaseUrl = input.tapcanvasApiBaseUrl.trim().replace(/\/+$/, "");
	const apiKey = input.tapcanvasApiKey.trim();
	if (!apiBaseUrl || !apiKey) return null;
	return {
		apiKey,
		apiBaseUrl: `${apiBaseUrl}/agents/llm/v1`,
	};
}

export function readAgentsBridgeTimeoutMs(c: AppContext): number {
	const raw =
		typeof c.env.AGENTS_BRIDGE_TIMEOUT_MS === "string"
			? c.env.AGENTS_BRIDGE_TIMEOUT_MS
			: "";
	const n = Number(raw);
	if (Number.isFinite(n) && n > 0) {
		// Clamp: 5s ~ 30min
		return Math.max(5_000, Math.min(1_800_000, Math.floor(n)));
	}
	// Complete-film tools can spend up to 25 minutes obtaining terminal delivery evidence.
	// The bridge owns a slightly larger 30-minute ceiling for the final agent self-check/response.
	return 1_800_000;
}

function readTimeoutFromRequestExtras(request: TaskRequestDto): number | null {
	const extras = isRecord(request.extras) ? request.extras : null;
	const raw = extras?.bridgeTimeoutMs;
	const n = Number(raw);
	if (!Number.isFinite(n) || n <= 0) return null;
	return Math.max(5_000, Math.min(1_800_000, Math.floor(n)));
}

async function readResponseTextSafe(res: Response, limit = 4096): Promise<string> {
	try {
		const text = await res.text();
		return text.length > limit ? `${text.slice(0, limit)}…` : text;
	} catch {
		return "";
	}
}

export function isAgentsBridgeEnabled(c: AppContext): boolean {
	return !!readAgentsBridgeBaseUrl(c);
}

/**
 * Build the MemoryCore identity at the authenticated request boundary.
 *
 * `userId` is never a deployment default: it is the effective authenticated
 * user for this request. `activeTeamId` wins over the local single-team
 * default, so one API process can safely serve multiple teams.
 */
export function buildMemoryCoreRequestIdentity(input: {
	activeTeamId: string;
	configuredTeamId: string;
	agentId: string;
	effectiveUserId: string;
	sessionId: string;
	taskId: string;
}): {
	teamId: string;
	agentId: string;
	userId: string;
	sessionId: string;
	taskId: string;
} {
	return {
		teamId: input.activeTeamId || input.configuredTeamId,
		agentId: input.agentId,
		userId: input.effectiveUserId,
		sessionId: input.sessionId,
		taskId: input.taskId,
	};
}

function isPublicAgentsRequest(c: AppContext): boolean {
	return c.get("publicApi") === true;
}

export function assertPublicAgentsRequestSafe(
	input: {
		forceLocalResourceViaBash: boolean;
		privilegedLocalAccess: boolean;
		localResourcePaths: string[];
		autoProjectScopedLocalAccess?: boolean;
		/** Internal authorization fact; never accepted from a public request body. */
		trustedDesktopWorkspaceAccess?: boolean;
	},
): void {
	if (input.trustedDesktopWorkspaceAccess === true) return;
	if (
		input.forceLocalResourceViaBash ||
		input.privilegedLocalAccess ||
		input.autoProjectScopedLocalAccess === true ||
		input.localResourcePaths.length > 0
	) {
		throw new AppError("Public agents request cannot access local workspace resources", {
			status: 403,
			code: "public_agents_local_resource_access_forbidden",
			details: {
				forceLocalResourceViaBash: input.forceLocalResourceViaBash,
				privilegedLocalAccess: input.privilegedLocalAccess,
				autoProjectScopedLocalAccess: input.autoProjectScopedLocalAccess === true,
				localResourcePathCount: input.localResourcePaths.length,
			},
		});
	}
}

type AgentsBridgePendingUserInput = {
	status: "needs_input";
	requestId: string;
	questions: Array<{
		id: string;
		header: string;
		question: string;
		options: Array<{
			label: string;
			description?: string;
			imageUrl?: string;
			thumbnailUrl?: string;
		}>;
	}>;
};

// 一般性的 request_user_input 仍需随 /chat 结果透传，用于确实缺少的用户事实、范围或权限。
// 明确的视频生成请求不会再用该通道做 estimate 后的第二次确认。
function normalizeAgentsBridgePendingUserInput(raw: unknown): AgentsBridgePendingUserInput | null {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
	const record = raw as Record<string, unknown>;
	if (record.status !== "needs_input") return null;
	const requestId = typeof record.requestId === "string" ? record.requestId.trim() : "";
	if (!requestId) return null;
	const questions = (Array.isArray(record.questions) ? record.questions : [])
		.map((item) => {
			if (!item || typeof item !== "object" || Array.isArray(item)) return null;
			const q = item as Record<string, unknown>;
			const id = typeof q.id === "string" ? q.id.trim() : "";
			const question = typeof q.question === "string" ? q.question.trim() : "";
			if (!id || !question) return null;
			const header = typeof q.header === "string" ? q.header.trim() : "";
			const options = (Array.isArray(q.options) ? q.options : [])
				.map((opt) => {
					if (!opt || typeof opt !== "object" || Array.isArray(opt)) return null;
					const o = opt as Record<string, unknown>;
					const label = typeof o.label === "string" ? o.label.trim() : "";
					if (!label) return null;
					const description =
						typeof o.description === "string" && o.description.trim() ? o.description.trim() : "";
					const imageUrl = typeof o.imageUrl === "string" && o.imageUrl.trim() ? o.imageUrl.trim() : "";
					const thumbnailUrl =
						typeof o.thumbnailUrl === "string" && o.thumbnailUrl.trim() ? o.thumbnailUrl.trim() : "";
					return {
						label,
						...(description ? { description } : {}),
						...(imageUrl ? { imageUrl } : {}),
						...(thumbnailUrl ? { thumbnailUrl } : {}),
					};
				})
				.filter((opt): opt is NonNullable<typeof opt> => !!opt)
				.slice(0, 12);
			return { id, header, question, options };
		})
		.filter((item): item is NonNullable<typeof item> => !!item)
		.slice(0, 3);
	if (questions.length === 0) return null;
	return { status: "needs_input", requestId, questions };
}

export async function runAgentsBridgeChatTask(
	c: AppContext,
	userId: string,
	request: TaskRequestDto,
	options?: {
		onStreamEvent?: AgentsBridgeStreamObserver;
		abortSignal?: AbortSignal;
		/** Internal-only: durable continuation of an originally authenticated /public/chat turn. */
		trustedPublicContinuation?: true;
		/** Internal-only: authorize this worker-owned physical run as its authenticated user. */
		trustedInternalExecution?: true;
		/** Internal-only: allowlisted Tanva packaged desktop may execute inside the agents workspace. */
		trustedDesktopWorkspaceAccess?: true;
		/** Internal-only: the workflow Agent node executes as the selected role without a delegation hop. */
		directForcedAgentExecution?: true;
		/** Internal-only: machine-owned effect fence for a durable continuation. */
		deniedRemoteTools?: readonly string[];
	},
): Promise<TaskResultDto> {
	const bridgePreludeStartedAt = Date.now();
	const observabilityStartedAt = new Date().toISOString();
	const requestId = String(c.get("requestId") || "").trim() || `request_${crypto.randomUUID()}`;
	const baseEffectiveUserId = resolveEffectiveUserId(c, userId);
	const extras = isRecord(request.extras) ? request.extras : {};
	// 宿主终端用户隔离：facade 传 extras.hostUserId（Tanva 当前登录用户 id）时，把它拼进
	// effectiveUserId 成 `owner:hostUser` 复合串。agents-cli 把整个 userId 当子空间目录名 +
	// session_key 前缀（sanitizeKey/resolveSessionStoreDir/userMemoryRoot/userSkillsDir），
	// 于是记忆/自建 skill/learned_profile 自动按宿主终端用户分叉，agents-cli 零改动；知识卡与
	// 内置 skill 仍全局共享。无 hostUserId（TapCanvas 原生请求）时保持原行为不变。
	const hostUserIdRaw =
		typeof extras.hostUserId === "string"
			? extras.hostUserId.trim()
			: "";
	const effectiveUserId =
		baseEffectiveUserId && hostUserIdRaw
			? `${baseEffectiveUserId}:${sanitizePathSegmentForAgents(hostUserIdRaw)}`
			: baseEffectiveUserId;
	if (!effectiveUserId) {
		throw new AppError("Unauthorized: missing userId for agents bridge", {
			status: 401,
			code: "unauthorized",
		});
	}
	const activeTeamId = String(c.get("activeTeamId") || "").trim();
	// Local single-team deployments may not receive X-Team-Id from every host
	// surface. Keep the Memory Hub scope stable in that case; when no explicit
	// deployment scope is configured, retain the authenticated active team.
	const configuredMemoryCoreTeamId = readNodeProcessEnv("AGENTS_MEMORY_CORE_TEAM_ID").trim();
	const configuredMemoryCoreAgentId = readNodeProcessEnv("AGENTS_MEMORY_CORE_AGENT_ID").trim();
	const memoryCoreAgentId = configuredMemoryCoreAgentId || (
		(options?.trustedInternalExecution === true || options?.directForcedAgentExecution === true) &&
		typeof extras.memoryCoreAgentId === "string"
			? extras.memoryCoreAgentId.trim()
			: ""
	);

	let baseUrl = readAgentsBridgeBaseUrl(c);
	if (!baseUrl) {
		baseUrl = await maybeStartAgentsBridgeOnDemand(c);
	}
	if (!baseUrl) {
		throw new AppError("Agents bridge 未配置（缺少 AGENTS_BRIDGE_BASE_URL）", {
			status: 400,
			code: "agents_bridge_not_configured",
		});
	}

	if (request.kind !== "chat" && request.kind !== "prompt_refine") {
		throw new AppError("Agents bridge 仅支持 chat/prompt_refine", {
			status: 400,
			code: "invalid_task_kind",
			details: { vendor: "agents", kind: request.kind },
		});
	}

	const requestedSystemPrompt =
		typeof extras.systemPrompt === "string" && extras.systemPrompt.trim()
			? extras.systemPrompt.trim()
			: "";
	let chatContext = normalizeAgentsBridgeChatContext(extras.chatContext);
	const canvasProjectId =
		typeof extras.canvasProjectId === "string"
			? extras.canvasProjectId.trim()
			: "";
	const requestedCanvasFlowId =
		typeof extras.canvasFlowId === "string"
			? extras.canvasFlowId.trim()
			: "";
	let canvasFlowId = requestedCanvasFlowId;
	const publicAgentsRequest = isPublicAgentsRequest(c) || options?.trustedPublicContinuation === true;
	const selectedSkillReferenceInput = chatContext.skill?.id && chatContext.skill.source
		? { id: chatContext.skill.id, source: chatContext.skill.source }
		: null;
	const canvasNodeId =
		typeof extras.canvasNodeId === "string"
			? extras.canvasNodeId.trim()
			: "";
	const requestedSessionKey = typeof extras.sessionKey === "string" ? String(extras.sessionKey).trim() : "";
	const clientPendingId = typeof extras.clientPendingId === "string"
		? extras.clientPendingId.trim().slice(0, 160)
		: "";
	// publicTurnId is the logical task identity minted by the public chat ingress.
	// requestId only identifies this physical Hono request. The initial request and
	// every continuation must forward the same logical id, otherwise agents-cli
	// persists a checkpoint under requestId while recovery queries publicTurnId.
	const publicTurnId = publicAgentsRequest && typeof extras.publicTurnId === "string"
		? extras.publicTurnId.trim().slice(0, 200)
		: "";
	// 宿主模式：三方画布宿主经 facade 显式传入 capability/context。
	// 缺省字段保持 TapCanvas 原生模式；显式传入却不符合协议时必须当场 400，禁止静默回退。
	const hostManifestRaw = (extras as Record<string, unknown>).hostCapabilityManifest;
	const hostManifestParsed =
		typeof hostManifestRaw === "undefined"
			? null
			: HostCapabilityManifestSchema.safeParse(hostManifestRaw);
	if (hostManifestParsed && !hostManifestParsed.success) {
		throw new AppError("hostCapabilityManifest 无效", {
			status: 400,
			code: "invalid_host_capability_manifest",
			details: { issues: hostManifestParsed.error.issues },
		});
	}
	const hostManifest: HostCapabilityManifest | null = hostManifestParsed?.success
		? hostManifestParsed.data
		: null;
	const hostContextRaw = (extras as Record<string, unknown>).hostCanvasContext;
	const hostContextParsed =
		typeof hostContextRaw === "undefined"
			? null
			: HostCanvasContextSchema.safeParse(hostContextRaw);
	if (hostContextParsed && !hostContextParsed.success) {
		throw new AppError("hostCanvasContext 无效", {
			status: 400,
			code: "invalid_host_canvas_context",
			details: { issues: hostContextParsed.error.issues },
		});
	}
	if (hostContextParsed?.success && !hostManifest) {
		throw new AppError("hostCanvasContext 需要 hostCapabilityManifest", {
			status: 400,
			code: "host_canvas_context_without_manifest",
		});
	}
	const hostCanvasContext = hostContextParsed?.success ? hostContextParsed.data : undefined;
		// 计费会话 id（hono 自有）：透传给 agents-cli → new-api 作 x-tapcanvas-conversation-id，
		// 供 hono 事后回查这一轮真实 quota 结算积分（见 public-agents-chat 的 chat-billing 接入）。
		const billingConversationId = typeof extras.billingConversationId === "string"
			? extras.billingConversationId.trim()
			: "";
	const sessionKey = requestedSessionKey;
	const agentTraceContext = createHonoAgentTraceContext({
		requestId,
		threadId: sessionKey || null,
		capturePolicy: resolveAgentTraceCapturePolicy(c.env.AGENT_TRACE_CAPTURE_POLICY),
		startedAt: observabilityStartedAt,
		incomingTraceparent: readRequestHeader(c, "traceparent"),
	});
	// Keep the upstream runtime session and observability thread as one normalized fact.
	// Do not rely on JSON serialization of an optional/nullable property here: agents-cli
	// validates this contract before it can start the actual agent turn.
	const upstreamObservabilityContext = {
		...agentTraceContext.agentsInput,
		threadId: sessionKey || null,
	};
	const requestedBookId = typeof extras.bookId === "string" ? String(extras.bookId).trim() : "";
	const requestedSelectedReferenceBookId = chatContext.selectedReference?.bookId?.trim() || "";
	const chapterId =
		(typeof extras.chapterId === "string" ? String(extras.chapterId).trim() : "") ||
		chatContext.selectedReference?.chapterId?.trim() ||
		"";
	if (publicAgentsRequest && canvasProjectId && !canvasFlowId && !chapterId) {
		const projectFlows = await listFlowsByOwner(c.env.DB, effectiveUserId, canvasProjectId);
		const resolvedFlowId = resolveUniqueProjectCanvasFlowId(projectFlows.map((flow) => flow.id));
		if (resolvedFlowId) {
			canvasFlowId = resolvedFlowId;
			console.info(
				`[agents-bridge.scope] resolved unique project canvas projectId=${canvasProjectId} flowId=${canvasFlowId}`,
			);
		} else if (projectFlows.length > 1) {
			console.info(
				`[agents-bridge.scope] project canvas flow unresolved projectId=${canvasProjectId} candidates=${projectFlows.length}`,
			);
		}
	}
	const chunkIndex = Number.isFinite(Number(extras.chunkIndex)) ? Math.trunc(Number(extras.chunkIndex)) : null;
	const groupSize = Number.isFinite(Number(extras.groupSize)) ? Math.trunc(Number(extras.groupSize)) : null;
	const shotStart = Number.isFinite(Number(extras.shotStart)) ? Math.trunc(Number(extras.shotStart)) : null;
	const shotEnd = Number.isFinite(Number(extras.shotEnd)) ? Math.trunc(Number(extras.shotEnd)) : null;
	const shotNo = Number.isFinite(Number(extras.shotNo)) ? Math.trunc(Number(extras.shotNo)) : null;
	const diagnosticsLabel =
		typeof extras.diagnosticsLabel === "string" ? String(extras.diagnosticsLabel).trim() : "";
	const forceAssetGeneration = extras.forceAssetGeneration === true;
	const parsedGenerationContract = parseGenerationContract((extras as Record<string, unknown>).generationContract);
	if (!parsedGenerationContract.ok) {
		throw new AppError(`generationContract 无效: ${parsedGenerationContract.error}`, {
			status: 400,
			code: "invalid_generation_contract",
		});
	}
	const generationContract: GenerationContract | null = parsedGenerationContract.value;
	const continuationUserIntentContract = asRecord(extras.userIntentContract);
	if (typeof extras.userIntentContract !== "undefined" && !continuationUserIntentContract) {
		throw new AppError("userIntentContract 必须是结构化对象", {
			status: 400,
			code: "agents_user_intent_contract_invalid",
		});
	}
	const retrievalContext = (options?.directForcedAgentExecution === true || options?.trustedPublicContinuation === true)
		? normalizeRetrievalContextV1(extras.retrievalContext)
		: null;
	if (
		(options?.directForcedAgentExecution === true || options?.trustedPublicContinuation === true)
		&& typeof extras.retrievalContext !== "undefined"
		&& !retrievalContext
	) {
		throw new AppError("retrievalContext 必须符合 retrieval-context/v1", {
			status: 400,
			code: "agents_retrieval_context_invalid",
		});
	}
	const continuationTaskReferences = Array.isArray(extras.durableTaskReferences)
		? extras.durableTaskReferences.filter((item): item is Record<string, unknown> => isRecord(item)).slice(0, 32)
		: [];
	const continuationRetrievalCandidateSets = Array.isArray(extras.retrievalCandidateSets)
		? extras.retrievalCandidateSets
			.filter((item): item is Record<string, unknown> => isRecord(item))
			.filter((item) => JSON.stringify(item).length <= 128_000)
			.slice(-8)
		: [];
	const continuationActionRecoveryFacts = Array.isArray(extras.actionRecoveryFacts)
		? extras.actionRecoveryFacts
			.filter((item): item is Record<string, unknown> => isRecord(item))
			.filter((item) => JSON.stringify(item).length <= 512_000)
			.slice(-16)
		: [];
	const continuationMaterializedArtifacts = Array.isArray(extras.trustedMaterializedArtifacts)
		? extras.trustedMaterializedArtifacts
			.filter((item): item is Record<string, unknown> => isRecord(item))
			.filter((item) => JSON.stringify(item).length <= 16_000)
			.slice(-64)
		: [];
	if (
		typeof extras.trustedMaterializedArtifacts !== "undefined" &&
		(!Array.isArray(extras.trustedMaterializedArtifacts) ||
		continuationMaterializedArtifacts.length !== extras.trustedMaterializedArtifacts.length)
	) {
		throw new AppError("trustedMaterializedArtifacts 必须是有界结构化数组", {
			status: 400,
			code: "agents_materialized_artifacts_invalid",
		});
	}
	if (
		options?.trustedPublicContinuation !== true &&
		(
			continuationUserIntentContract !== null ||
			extras.userIntentContractLocked === true ||
			continuationTaskReferences.length > 0
			|| continuationRetrievalCandidateSets.length > 0
			|| continuationActionRecoveryFacts.length > 0
			|| continuationMaterializedArtifacts.length > 0
		)
	) {
		throw new AppError("Continuation state may only be injected by the trusted continuation runner", {
			status: 403,
			code: "agents_continuation_state_forbidden",
		});
	}
	// 用户对一般 request_user_input 卡的已点选答案（前端 echo）——透传给 agents-cli
	// 作 seedAnsweredUserInput，保持跨回合事实连续性。
	const requestUserInputResponse =
		(extras as Record<string, unknown>).requestUserInputResponse &&
		typeof (extras as Record<string, unknown>).requestUserInputResponse === "object"
			? ((extras as Record<string, unknown>).requestUserInputResponse as Record<string, unknown>)
			: null;
	const mode =
		typeof (extras as Record<string, unknown>).mode === "string" &&
		String((extras as Record<string, unknown>).mode).trim().toLowerCase() === "auto"
			? "auto"
			: "chat";
	const responseFormat =
		typeof (extras as Record<string, unknown>).responseFormat !== "undefined"
			? (extras as Record<string, unknown>).responseFormat
			: typeof (extras as Record<string, unknown>).response_format !== "undefined"
				? (extras as Record<string, unknown>).response_format
				: undefined;
	const outputContract = options?.directForcedAgentExecution === true &&
		typeof (extras as Record<string, unknown>).outputContract !== "undefined"
		? (extras as Record<string, unknown>).outputContract
		: undefined;
	const continuationExecutionContractRecord = isRecord(
		(extras as Record<string, unknown>).continuationExecutionContract,
	)
		? (extras as Record<string, unknown>).continuationExecutionContract as Record<string, unknown>
		: null;
	const maxOutputTokensRaw = options?.directForcedAgentExecution === true
		? (extras as Record<string, unknown>).maxOutputTokens
		: undefined;
	const maxOutputTokens = typeof maxOutputTokensRaw === "number"
		&& Number.isInteger(maxOutputTokensRaw)
		&& maxOutputTokensRaw >= 128
		&& maxOutputTokensRaw <= 32_768
		? maxOutputTokensRaw
		: undefined;
	if (options?.directForcedAgentExecution === true && maxOutputTokensRaw !== undefined && maxOutputTokens === undefined) {
		throw new AppError("maxOutputTokens 必须是 128–32768 之间的整数", {
			status: 400,
			code: "agents_max_output_tokens_invalid",
		});
	}
	const reasoningEffortRaw = options?.directForcedAgentExecution === true
		? (extras as Record<string, unknown>).reasoningEffort
			?? continuationExecutionContractRecord?.reasoningEffort
		: undefined;
	const reasoningEffort = reasoningEffortRaw === "none"
		|| reasoningEffortRaw === "minimal"
		|| reasoningEffortRaw === "low"
		|| reasoningEffortRaw === "medium"
		|| reasoningEffortRaw === "high"
		|| reasoningEffortRaw === "xhigh"
		|| reasoningEffortRaw === "max"
		? reasoningEffortRaw
		: undefined;
	if (
		options?.directForcedAgentExecution === true
		&& reasoningEffortRaw !== undefined
		&& reasoningEffort === undefined
	) {
		throw new AppError("reasoningEffort 必须是 none/minimal/low/medium/high/xhigh/max 之一", {
			status: 400,
			code: "agents_reasoning_effort_invalid",
		});
	}
	const workflowPhysicalAttemptDeadlineAtRaw = options?.directForcedAgentExecution === true
		? (extras as Record<string, unknown>).workflowPhysicalAttemptDeadlineAt
			?? continuationExecutionContractRecord?.workflowPhysicalAttemptDeadlineAt
		: undefined;
	const workflowPhysicalAttemptDeadlineAt = typeof workflowPhysicalAttemptDeadlineAtRaw === "string"
		&& workflowPhysicalAttemptDeadlineAtRaw.trim()
		&& Number.isFinite(Date.parse(workflowPhysicalAttemptDeadlineAtRaw))
		? workflowPhysicalAttemptDeadlineAtRaw.trim()
		: undefined;
	if (
		options?.directForcedAgentExecution === true
		&& workflowPhysicalAttemptDeadlineAtRaw !== undefined
		&& workflowPhysicalAttemptDeadlineAt === undefined
	) {
		throw new AppError("workflowPhysicalAttemptDeadlineAt 必须是有效的绝对时间", {
			status: 400,
			code: "agents_workflow_physical_attempt_deadline_invalid",
		});
	}
	const skillReferencesPromise = publicAgentsRequest
		? resolveChatSkillReferences(
				c,
				effectiveUserId,
				selectedSkillReferenceInput,
		  )
		: Promise.resolve({
				selected: null,
				availableExternalSkills: [],
		  });
	const flowReadPromise = publicAgentsRequest && canvasProjectId && canvasFlowId
		? getFlowForOwner(c.env.DB, canvasFlowId, effectiveUserId)
		: Promise.resolve(null);
	const userGenerationPrefsPromise = publicAgentsRequest
		? loadUserGenerationPrefsContext(baseEffectiveUserId)
		: Promise.resolve(null);
	const enabledModelCatalogPromise = publicAgentsRequest
		? loadPublicChatEnabledModelCatalogSummary(c, baseEffectiveUserId)
		: Promise.resolve({ summary: null, error: null });
	const chapterBookScopePromise = publicAgentsRequest && canvasProjectId && chapterId
		? c.env.DB.chapters.findFirst({
				where: { id: chapterId, project_id: canvasProjectId },
				select: { source_book_id: true },
		  })
		: Promise.resolve(null);
	const equippedWorkflowsPromise = publicAgentsRequest && !hostManifest
		? listEquippedWorkflowCapabilities(c, baseEffectiveUserId, {
				requiredExecutionVariant: chatContext.requestedWorkflowExecutionVariant,
		  })
		: Promise.resolve([]);
	const disabledSkillsPromise = publicAgentsRequest
		? listDisabledSkillKeys(c, baseEffectiveUserId)
		: Promise.resolve([]);
	const replacedSkillsPromise = publicAgentsRequest
		? listReplacedSkillKeys(c, baseEffectiveUserId)
		: Promise.resolve([]);
	const builtInCapabilityAvailabilityPromise = publicAgentsRequest
		? getBuiltInCapabilityAvailability(c, baseEffectiveUserId)
		: Promise.resolve({ systemDisabledKeys: [], userDisabledKeys: [], disabledKeys: [] });
	const [
		skillReferences,
		flow,
		userGenerationPrefsBlock,
		enabledModelCatalog,
		chapterBookScope,
		equippedWorkflowAttachments,
		accountDisabledSkills,
		accountReplacedSkills,
		builtInCapabilityAvailability,
	] =
		await Promise.all([
			skillReferencesPromise,
			flowReadPromise,
			userGenerationPrefsPromise,
			enabledModelCatalogPromise,
			chapterBookScopePromise,
			equippedWorkflowsPromise,
			disabledSkillsPromise,
			replacedSkillsPromise,
			builtInCapabilityAvailabilityPromise,
		]);
	const workflowDisabledSkills = options?.directForcedAgentExecution === true
		? readTrimmedStringArray(extras.disabledSkills).slice(0, 256)
		: [];
	const disabledSkills = [...new Set([...accountDisabledSkills, ...workflowDisabledSkills])];
	const disabledKnowledgeCardIds = options?.directForcedAgentExecution === true
		? readTrimmedStringArray(extras.disabledKnowledgeCardIds).slice(0, 256)
		: [];
	const mountedKnowledgeCardIds = options?.directForcedAgentExecution === true
		? readTrimmedStringArray(extras.mountedKnowledgeCardIds).slice(0, 64)
		: [];
	const rawPromptExampleRetrievalScope = options?.directForcedAgentExecution === true
		&& extras.promptExampleRetrievalScope
		&& typeof extras.promptExampleRetrievalScope === "object"
		&& !Array.isArray(extras.promptExampleRetrievalScope)
		? extras.promptExampleRetrievalScope as Record<string, unknown>
		: null;
	const promptExampleRetrievalScope = rawPromptExampleRetrievalScope
		&& rawPromptExampleRetrievalScope.version === 3
		&& (rawPromptExampleRetrievalScope.mediaType === "image" || rawPromptExampleRetrievalScope.mediaType === "video")
		&& (rawPromptExampleRetrievalScope.searchPolicy === "agent_discretion" || rawPromptExampleRetrievalScope.searchPolicy === "required_non_blocking")
		&& (rawPromptExampleRetrievalScope.model === undefined || typeof rawPromptExampleRetrievalScope.model === "string")
		&& Object.keys(rawPromptExampleRetrievalScope).every((key) => new Set(["version", "mediaType", "searchPolicy", "model"]).has(key))
		? {
				version: 3 as const,
				mediaType: rawPromptExampleRetrievalScope.mediaType,
				searchPolicy: rawPromptExampleRetrievalScope.searchPolicy,
				...(typeof rawPromptExampleRetrievalScope.model === "string" && rawPromptExampleRetrievalScope.model.trim()
					? { model: rawPromptExampleRetrievalScope.model.trim() }
					: {}),
			}
		: null;
	if (rawPromptExampleRetrievalScope && !promptExampleRetrievalScope) {
		throw new AppError("设计资产提示词案例检索范围无效", {
			status: 400,
			code: "prompt_example_retrieval_scope_invalid",
		});
	}
	if (
		skillReferences.selected?.source === "system" &&
		disabledSkills.includes(skillReferences.selected.key)
	) {
		throw new AppError("所选 Skill 已由当前用户在小T能力舱停用", {
			status: 409,
			code: "selected_skill_disabled_by_user",
			details: { skillKey: skillReferences.selected.key },
		});
	}
	if (publicAgentsRequest) {
		chatContext = { ...chatContext, skill: skillReferences.selected };
	}
	if (publicAgentsRequest && canvasProjectId && canvasFlowId) {
		if (!flow || flow.project_id !== canvasProjectId) {
			throw new AppError("Flow not found", {
				status: 404,
				code: "flow_not_found",
				details: {
					canvasProjectId,
					canvasFlowId,
					userId: effectiveUserId,
				},
			});
		}
	}
	if (publicAgentsRequest && canvasProjectId && chapterId && !chapterBookScope) {
		throw new AppError("Chapter not found in current project", {
			status: 404,
			code: "project_chapter_not_found",
			details: { canvasProjectId, chapterId, userId: effectiveUserId },
		});
	}
	const chapterSourceBookId = typeof chapterBookScope?.source_book_id === "string"
		? chapterBookScope.source_book_id.trim()
		: "";
	const requestedBookRef =
		requestedBookId || requestedSelectedReferenceBookId || chapterSourceBookId;
	const resolvedBookRef =
		publicAgentsRequest && canvasProjectId && requestedBookRef
			? await resolveProjectBookReference({
					userId: effectiveUserId,
					projectId: canvasProjectId,
					requestedRef: requestedBookRef,
			  })
			: null;
	if (publicAgentsRequest && canvasProjectId && requestedBookRef && !resolvedBookRef) {
		throw new AppError("Book not found in current project", {
			status: 404,
			code: "project_book_not_found",
			details: {
				canvasProjectId,
				requestedRef: requestedBookRef,
				userId: effectiveUserId,
			},
		});
	}
	const bookId = resolvedBookRef?.bookId || requestedBookId;
	if (chapterSourceBookId && bookId && chapterSourceBookId !== bookId) {
		throw new AppError("Chapter source book does not match the requested book", {
			status: 409,
			code: "chapter_book_scope_mismatch",
			details: { chapterId, chapterSourceBookId, requestedBookId: bookId },
		});
	}
	const effectiveChatContext: AgentsBridgeChatContext =
		resolvedBookRef && chatContext.selectedReference
			? {
					...chatContext,
					selectedReference: {
						...chatContext.selectedReference,
						bookId: resolvedBookRef.bookId,
					},
			  }
			: chatContext;
	const eligibleEquippedWorkflowAttachments = filterEquippedWorkflowsByExecutionVariant(
		equippedWorkflowAttachments,
		effectiveChatContext.requestedWorkflowExecutionVariant,
	);
	const autoProjectScopedLocalAccess = false;
	const trustedDesktopWorkspaceAccess = options?.trustedDesktopWorkspaceAccess === true;
	const forceLocalResourceViaBash =
		trustedDesktopWorkspaceAccess || extras.forceLocalResourceViaBash === true;
	const projectContextResourcePath =
		forceLocalResourceViaBash && publicAgentsRequest && canvasProjectId
			? resolveProjectWorkspaceContextDir(canvasProjectId, effectiveUserId)
			: "";
	const explicitLocalResourcePathsRaw =
		forceLocalResourceViaBash && Array.isArray(extras.localResourcePaths)
		? extras.localResourcePaths
				.map((x) => String(x || "").trim())
				.filter(Boolean)
				.slice(0, 12)
		: [];
	const implicitBookLocalResourcePath =
		forceLocalResourceViaBash && bookId && canvasProjectId
			? (
					await resolveReadableBookDirectoryPath({
						userId: effectiveUserId,
						projectId: canvasProjectId,
						bookId,
					})
			  ) || ""
			: "";
	const privilegedLocalAccess =
		trustedDesktopWorkspaceAccess ||
		(forceLocalResourceViaBash && extras.privilegedLocalAccess === true);
	const localResourcePathsRaw = forceLocalResourceViaBash
		? Array.from(new Set([
				...explicitLocalResourcePathsRaw,
				...(projectContextResourcePath ? [projectContextResourcePath] : []),
				...(implicitBookLocalResourcePath ? [implicitBookLocalResourcePath] : []),
		  ])).slice(0, 12)
		: [];
	const localResourcePaths = localResourcePathsRaw
		.map((x) => normalizeLocalResourcePathForAgents(x))
		.filter((x): x is string => Boolean(x));
	if (
		forceLocalResourceViaBash &&
		localResourcePathsRaw.length > 0 &&
		localResourcePaths.length !== localResourcePathsRaw.length
	) {
		throw new AppError("本地资源路径无效：路径不能为空", {
			status: 400,
			code: "invalid_local_resource_paths",
			details: {
				raw: localResourcePathsRaw,
				normalized: localResourcePaths,
			},
		});
	}
	const explicitAllowedSubagentTypes = Array.isArray(extras.allowedSubagentTypes)
		? extras.allowedSubagentTypes
				.map((item) => String(item || "").trim())
				.filter(Boolean)
				.slice(0, 12)
			: [];
	const forcedAgentRole =
		typeof extras.forcedAgentRole === "string"
			? extras.forcedAgentRole.trim().slice(0, 64)
			: "";
	if (options?.directForcedAgentExecution === true && !forcedAgentRole) {
		throw new AppError("工作流直接 Agent 执行缺少 forcedAgentRole", {
			status: 400,
			code: "workflow_direct_agent_role_required",
		});
	}
	const chapterCanvasIntent = normalizeChapterCanvasIntent(extras.intent);
	const chapterIntentSourceNodeId =
		typeof extras.chapterIntentSourceNodeId === "string"
			? extras.chapterIntentSourceNodeId.trim()
			: "";
	const chapterContext = asRecord(extras.chapterContext);
	if (typeof extras.chapterContext !== "undefined" && !chapterContext) {
		throw new AppError("chapterContext 必须是结构化对象", {
			status: 400,
			code: "agents_chapter_context_invalid",
		});
	}
	const chapterIntentGenerationConfig = asRecord(extras.chapterIntentGenerationConfig);
	const chapterIntentVariantParams = asRecord(extras.chapterIntentVariantParams);
	const chapterIntentStyleGuide = asRecord(extras.chapterIntentStyleGuide);
	const explicitRequiredSkills = normalizeRequiredSkills(extras.requiredSkills);
	// 委派能力只由调用方显式事实开启；空角色列表不再被解释为“允许全部”。
	const allowedSubagentTypes = explicitAllowedSubagentTypes;
	const requireAgentsTeamExecution = extras.requireAgentsTeamExecution === true;
	const allowAgentsDelegation =
		requireAgentsTeamExecution || allowedSubagentTypes.length > 0;
	const chapterGroundedScope =
		resolveEffectivePublicChatBookChapterScope({
			mode,
			canvasProjectId: canvasProjectId || null,
			canvasFlowId: canvasFlowId || null,
			canvasNodeId: canvasNodeId || null,
			bookId: bookId || null,
			chapterId: chapterId || null,
			chatContext: effectiveChatContext,
		}) !== null;
	// Required skills are structural declarations from the caller or a frozen
	// workflow node. Hono must not infer them from user prose; semantic skill
	// selection belongs to agents-cli and its progressively disclosed catalog.
	const requiredSkills = normalizeRequiredSkills(explicitRequiredSkills);
	// A capability-bay `replaced` row hides a skill as a competing top-level
	// route, but it must not disable that same skill when the current product
	// route names it as a required dependency. Direct Workflow execution is a
	// separate, already-authorized runtime surface: its frozen dependencies are
	// mounted for this execution only even if the same Skill is disabled as a
	// top-level chat capability. The account setting itself is never mutated.
	const replacedSkillSet = new Set(accountReplacedSkills);
	const requiredSkillSet = new Set(requiredSkills);
	const runtimeDisabledSkills = disabledSkills.filter(
		(skill) => !(
			requiredSkillSet.has(skill)
			&& (replacedSkillSet.has(skill) || options?.directForcedAgentExecution === true)
		),
	);
	if (publicAgentsRequest) {
		assertPublicAgentsRequestSafe({
			forceLocalResourceViaBash,
			privilegedLocalAccess,
			localResourcePaths,
			autoProjectScopedLocalAccess,
			trustedDesktopWorkspaceAccess,
		});
	}
	const modelKey = normalizeAgentBridgeModelField(extras.modelKey);
	const modelAlias = normalizeAgentBridgeModelField(extras.modelAlias);
	const callerReferenceImages = normalizeAgentsBridgeReferenceImages(extras.referenceImages);
	const callerAssetInputs = normalizeAgentsBridgeAssetInputs(extras.assetInputs);
	const callerSelectedReferenceProtocolImages =
		collectStoryboardSelectionReferenceImageUrls(
			effectiveChatContext.selectedReference?.storyboardSelectionContext,
		);
	// Hono only forwards caller-provided structured media facts. Prompt mentions,
	// project assets and chapter continuity are resolved by agents through tools.
	// An explicitly rejected selected node remains factual context, but its bytes
	// cannot be forwarded as a model reference. This is a lifecycle-state filter,
	// not a local judgment of visual or semantic quality.
	const filteredReferenceMedia = filterRejectedSelectedReferenceMedia({
		referenceImages: callerReferenceImages,
		assetInputs: callerAssetInputs,
		selectedReferenceProtocolImages: callerSelectedReferenceProtocolImages,
		selectedReference: effectiveChatContext.selectedReference,
	});
	const referenceImages = filteredReferenceMedia.referenceImages;
	const assetInputs = filteredReferenceMedia.assetInputs;
	const selectedReferenceProtocolReferenceImages =
		filteredReferenceMedia.selectedReferenceProtocolImages;
	const mediaSafeSelectedReference: AgentsBridgeChatContext["selectedReference"] =
		filteredReferenceMedia.selectedReferenceRejected && effectiveChatContext.selectedReference
		? {
				...effectiveChatContext.selectedReference,
				imageUrl: null,
				sourceUrl: null,
				storyboardSelectionContext: null,
			}
		: effectiveChatContext.selectedReference;
	const mergedReferenceImages = (() => {
		const out: string[] = [];
		const seen = new Set<string>();
		for (const url of [
			...referenceImages,
			...selectedReferenceProtocolReferenceImages,
			...assetInputs.filter((item) => item.mediaType === "image").map((item) => item.url),
		]) {
			const trimmed = String(url || "").trim();
			if (!trimmed || seen.has(trimmed)) continue;
			seen.add(trimmed);
			out.push(trimmed);
		}
		return out;
	})();
	const referenceImageSlots = buildReferenceImageSlots({
		referenceImages: mergedReferenceImages,
		assetInputs,
		selectedReference: mediaSafeSelectedReference,
	});
	const selectedPromptSkill =
		effectiveChatContext.skill?.id && effectiveChatContext.skill.source
			? {
					id: effectiveChatContext.skill.id,
					source: effectiveChatContext.skill.source,
					key: effectiveChatContext.skill.key,
					name: effectiveChatContext.skill.name,
			  }
			: null;
	const factualContextPrompt = await buildPublicChatSystemPrompt({
		chatContext: {
			generationProposal: effectiveChatContext.generationProposal,
			currentProjectName: effectiveChatContext.currentProjectName,
			chatMode: effectiveChatContext.chatMode,
			creativePhase: effectiveChatContext.creativePhase,
			currentBookId: bookId || null,
			currentChapterId: chapterId || null,
			skill: selectedPromptSkill,
			referenceImageCount: mergedReferenceImages.length,
			referenceImageSlots,
			assetRoleSummary: [...new Set(assetInputs.map((asset) => asset.role))],
			hasTargetImage: assetInputs.some((asset) => asset.role === "target"),
			hasSelectedNode: Boolean(canvasNodeId || mediaSafeSelectedReference?.nodeId),
			...(publicAgentsRequest
				? {
					enabledModelCatalogSummary: enabledModelCatalog.summary,
					enabledModelCatalogSummaryError: enabledModelCatalog.error,
				}
				: {}),
			selectedNodeId: canvasNodeId || mediaSafeSelectedReference?.nodeId || null,
			selectedNodeLabel: effectiveChatContext.selectedNodeLabel,
			selectedNodeKind: effectiveChatContext.selectedNodeKind,
			selectedNodeTextPreview: effectiveChatContext.selectedNodeTextPreview,
			selectedReference: mediaSafeSelectedReference,
		},
		canvasProjectId: canvasProjectId || null,
		canvasFlowId: canvasFlowId || null,
		planOnly: request.kind === "prompt_refine",
		forceAssetGeneration,
	});
	const systemPrompt = requestedSystemPrompt;
	const prompt = decoratePromptWithReferenceImages(
		request.prompt,
		mergedReferenceImages,
		assetInputs,
		referenceImageSlots,
		mediaSafeSelectedReference,
	);
	const finalSystemPrompt = systemPrompt || "";
	// Direct Workflow Agent nodes already carry frozen upstream port facts and
	// their own typed delivery contract. Injecting the chat UI's chapter canvas
	// snapshot creates a second, much larger input source and can exhaust the
	// physical context budget before the first model action. Keep the snapshot for
	// interactive chat only; workflow nodes use their immutable port projection.
	const canvasReferenceBlock = options?.directForcedAgentExecution === true
		? null
		: buildChapterCanvasReferenceBlock(effectiveChatContext.chapterCanvasReference);
	const contextBlocks = [canvasReferenceBlock].filter((b): b is string => Boolean(b));
	const finalPrompt = contextBlocks.length ? `${contextBlocks.join("\n\n")}\n\n${prompt}` : prompt;
	const debugLogEnabled = readAgentsBridgeDebugLog(c);
	const requiredSkillCalls = skillReferences.selected
		? [skillReferences.selected.key]
		: [];
	const resourceWhitelist = null;

	const tapcanvasApiBaseUrl = readTapCanvasApiBaseFromEnv(c);
	const useRequestAuth = readBoolEnvFlag(c.env.AGENTS_BRIDGE_USE_REQUEST_AUTH);
	const envTapcanvasApiKey =
		typeof c.env.TAPCANVAS_API_KEY === "string"
			? c.env.TAPCANVAS_API_KEY.trim()
			: "";
	const reqAuthorization = (c.req.header("authorization") || "").trim();
	const reqApiKey = (c.req.header("x-api-key") || "").trim();
	const internalWorkerToken = String(c.env.INTERNAL_WORKER_TOKEN || "").trim();
	const browserSessionDelegationApiKey =
		!reqAuthorization && !reqApiKey && internalWorkerToken
			? buildInternalApiKey({
					internalWorkerToken,
					// effectiveUserId may be `tapcanvasOwner:hostUser` in Tanva host mode.
					// That composite id is an agents workspace/session partition, not a row in
					// TapCanvas' users table. Server-to-server credentials must always be
					// minted for the authenticated TapCanvas owner or every continuation-side
					// present_file/upload callback is rejected as an unknown user.
					userId: baseEffectiveUserId,
					apiKeyId: null,
			  }) ?? ""
			: "";
	const trustedInternalApiKey = buildTrustedInternalExecutionApiKey({
		trustedInternalExecution: options?.trustedInternalExecution === true,
		internalWorkerToken,
		userId: baseEffectiveUserId,
		apiKeyId: c.get("apiKeyId") ?? null,
	});
	if (options?.trustedInternalExecution === true && !trustedInternalApiKey) {
		throw new AppError("可信内部执行缺少用户委托授权", {
			status: 500,
			code: "trusted_internal_execution_auth_unavailable",
		});
	}
	const tapcanvasApiKey =
		trustedInternalApiKey || browserSessionDelegationApiKey || reqApiKey || envTapcanvasApiKey;
	const tapcanvasAuthorization =
		trustedInternalApiKey
			? ""
			: useRequestAuth || !tapcanvasApiKey
				? reqAuthorization
				: "";
	const requiredExternalSkillCalls =
		skillReferences.selected && skillReferences.selected.source !== "system"
			? requiredSkillCalls
			: [];
	const externalSkillAuthorization = internalWorkerToken ? "" : reqAuthorization;
	const externalSkillApiKey = internalWorkerToken
		? buildInternalApiKey({
				internalWorkerToken,
				userId: baseEffectiveUserId,
				apiKeyId: c.get("apiKeyId") ?? null,
		  }) ?? ""
		: reqApiKey;
	const externalSkillResolverConfig =
		tapcanvasApiBaseUrl && (externalSkillAuthorization || externalSkillApiKey)
			? {
					endpoint: `${tapcanvasApiBaseUrl}/agents/user-context-assets`,
					...(externalSkillAuthorization ? { authToken: externalSkillAuthorization } : {}),
					...(externalSkillApiKey ? { apiKey: externalSkillApiKey } : {}),
			  }
			: null;
	if (requiredExternalSkillCalls.length > 0 && !externalSkillResolverConfig) {
		throw new AppError("所选用户 Skill 无法按需读取：缺少可信 API 地址或当前用户凭证", {
			status: 500,
			code: "external_skill_resolver_unavailable",
			details: { selectedSkillId: skillReferences.selected?.id ?? null },
		});
	}
	if (
		skillReferences.selected?.source === "marketplace" &&
		!internalWorkerToken
	) {
		throw new AppError("所选商城 Skill 无法安全读取：缺少内部服务凭证", {
			status: 500,
			code: "marketplace_skill_internal_resolver_unavailable",
			details: { selectedSkillId: skillReferences.selected.id },
		});
	}
	// 生成模式：host（默认）暴露低层 flow_patch，以及 manifest 显式声明的高层 host_tool；
	// 两者都只把命令交给宿主执行，不在 TapCanvas 数据库落画布结果。
	// managed/both 尚无真实工具与计费实现，声明它们必须显式失败，不能静默退成 host。
	assertHostGenerationModeSupported(hostManifest);
	// 宿主模式：远程工具面仅由宿主 manifest 驱动，不暴露 TapCanvas 自身的 tapcanvas_* 工具集。
	const tapcanvasRemoteToolSurface = hostManifest
		? null
		: inspectAgentsBridgeRemoteToolSurface({
				publicAgentsRequest,
				canvasProjectId,
				canvasFlowId,
				canvasNodeId,
				bookId,
				chapterId,
				hideStoryboardEditor: publicAgentsRequest,
				adminWorkflowAccess: isAdminRequest(c),
				workflowRecoveryAccess:
					options?.trustedPublicContinuation === true &&
					continuationTaskReferences.some((reference) =>
						reference.acceptedAsync === true &&
						typeof reference.runId === "string" &&
						reference.runId.trim().length > 0 &&
						(reference.toolName === "tapcanvas_workflow_run" ||
							reference.toolName === "tapcanvas_equipped_workflow_run"),
					),
				disabledBuiltInCapabilities: builtInCapabilityAvailability.disabledKeys,
				enabledVideoModelKeys: enabledModelCatalog.summary?.videoModels.map((model) => model.modelKey) ?? [],
				enabledImageModelKeys: enabledModelCatalog.summary?.imageModels.map((model) => model.modelKey) ?? [],
				equippedWorkflows: eligibleEquippedWorkflowAttachments.map((attachment) => ({
					attachmentId: attachment.id,
					name: attachment.descriptor.name,
					summary: attachment.descriptor.summary,
					invocation: attachment.descriptor.invocation,
					primaryForCapabilities: attachment.primaryForCapabilities,
				})),
			  });
	const baseAvailableRemoteTools = hostManifest
		? [
				buildHostFlowPatchTool(hostManifest),
				...(hostManifest.hostTools?.length ? [buildHostTool(hostManifest)] : []),
		  ]
		: tapcanvasRemoteToolSurface?.tools ?? [];
	const baseAvailableRemoteToolCatalog = tapcanvasRemoteToolSurface?.catalog ?? [];
	// Story preview remains in the deferred catalog as a durable multi-operation
	// graph. Promoting the generic image tool to the hot surface would hand board
	// sequencing and variable-length JSON back to the root model, defeating the
	// exact per-board frontier projected by tapcanvas_story_preview_orchestrate.
	const availableRemoteTools = baseAvailableRemoteTools;
	const availableRemoteToolCatalog = baseAvailableRemoteToolCatalog;
	if (readAgentsBridgeDebugLog(c)) {
		console.log(
			`[agents-bridge.debug] remote-surface direct=${availableRemoteTools.length} ` +
				`catalog=${availableRemoteToolCatalog.length} ` +
				`equippedWorkflow=${availableRemoteTools.some((tool) => tool.name === "tapcanvas_equipped_workflow_run") ? "direct" : availableRemoteToolCatalog.some((tool) => tool.name === "tapcanvas_equipped_workflow_run") ? "catalog" : "absent"}`,
		);
	}
	const resolvedToolPolicy = applyAgentExecutionToolPolicy({
		policy: extras.executionToolPolicy,
		remoteTools: availableRemoteTools,
		...(options?.deniedRemoteTools ? { deniedRemoteTools: options.deniedRemoteTools } : {}),
		...(tapcanvasRemoteToolSurface
			? {
					remoteCatalogTools: availableRemoteToolCatalog,
					optionalDirectTools: tapcanvasRemoteToolSurface.explicitCapabilityTools,
			  }
			: {}),
	});
	const deferPublicChatDirectTools = shouldDeferPublicChatDirectTools({
		publicAgentsRequest,
		requestKind: request.kind,
		hostManifestPresent: Boolean(hostManifest),
		canvasNodeId,
		assetInputCount: assetInputs.length,
		referenceImageCount: mergedReferenceImages.length,
		forceAssetGeneration,
		hasGenerationContract: Boolean(generationContract),
		// A chapter route is already a concrete production scope even when the
		// optional prose chapterContext block is absent. Treating it as an empty
		// chat would drop dynamic equipped-workflow tools from the direct surface
		// without adding them to the deferred catalog.
		hasChapterContext: Boolean(chapterContext || chapterId),
		hasForcedAgentRole: Boolean(forcedAgentRole),
		requiredSkillCount: requiredSkills.length,
		hasExplicitToolPolicy: Boolean(extras.executionToolPolicy),
	});
	// Equipped workflows are user-visible semantic capabilities, not generic cold
	// operations. Keep their complete descriptor and exact invocation schema on
	// the hot surface even for an otherwise context-free public chat. Deferring
	// this definition truncates the workflow summary before Harness can decide
	// whether it applies, which makes an all_users built-in effectively invisible.
	const hasEquippedWorkflowTool = resolvedToolPolicy.remoteTools.some(
		(tool) => tool.name === "tapcanvas_equipped_workflow_run",
	);
	const remoteTools = deferPublicChatDirectTools
		? resolvedToolPolicy.remoteTools.filter((tool) =>
			tool.name === "tapcanvas_equipped_workflow_run"
			|| (hasEquippedWorkflowTool && tool.name === "tapcanvas_workflow_execution_inspect"))
			.map((tool) => tool.name === "tapcanvas_workflow_execution_inspect"
				? {
					...tool,
					description:
						"Inspect the first page of one accepted durable workflow execution. Copy executionId and view=family exactly from the equipped-workflow receipt inspection.familyArgs. This exact schema is already loaded: call this tool directly, omit cursor and limit, and do not call tapcanvas_get_tool_schema first. A successful terminal response includes workflowOutputs from authored workflow.output/v1 boundaries; return their user-facing output exactly.",
					parameters: {
						type: "object",
						properties: {
							executionId: { type: "string", minLength: 1 },
							view: { type: "string", const: "family" },
						},
						required: ["executionId", "view"],
						additionalProperties: false,
					},
				}
				: tool)
		: resolvedToolPolicy.remoteTools;
	// Deferring the hot surface is a representation change, not an authorization
	// change. Every authenticated direct definition must remain discoverable in
	// the cold catalog; otherwise an ordinary public chat silently loses core
	// read/mutation capabilities such as flow_get/flow_patch. The exact schema is
	// still loaded by name on demand, so this does not restore the large first-turn
	// schema payload or introduce a second execution path.
	const remoteToolCatalog = deferPublicChatDirectTools && tapcanvasRemoteToolSurface
		? [
			...resolvedToolPolicy.remoteTools
				.filter((tool) => !remoteTools.some((directTool) => directTool.name === tool.name))
				.map((tool) => {
				const metadata = readRemoteToolSurfaceMetadata(tool.name);
				return {
					...tool,
					requiredScope: metadata.requiredScope,
					capability: metadata.capability,
				};
				}),
			...resolvedToolPolicy.remoteToolCatalog,
		  ]
		: resolvedToolPolicy.remoteToolCatalog;
	const allowedTools = resolvedToolPolicy.allowedTools;
	const resolvedDirectMeasurement = measureRemoteToolSurface(remoteTools);
	const resolvedCatalogIndexMeasurement = measureRemoteToolCatalogIndex(remoteToolCatalog);
	const resolvedVisibleToolNames = new Set([
		...remoteTools.map((tool) => tool.name),
		...remoteToolCatalog.map((tool) => tool.name),
	]);
	const primaryCapabilityRoutes = resolvedVisibleToolNames.has("tapcanvas_equipped_workflow_run")
		? buildEquippedWorkflowPrimaryCapabilityRoutes(
			eligibleEquippedWorkflowAttachments.map((attachment) => ({
				attachmentId: attachment.id,
				name: attachment.descriptor.name,
				summary: attachment.descriptor.summary,
				invocation: attachment.descriptor.invocation,
				primaryForCapabilities: attachment.primaryForCapabilities,
			})),
		)
		: [];
	const equippedWorkflowCapabilities = resolvedVisibleToolNames.has("tapcanvas_equipped_workflow_run")
		? eligibleEquippedWorkflowAttachments.map((attachment) => ({
				attachmentId: attachment.id,
				name: attachment.descriptor.name,
				summary: attachment.descriptor.summary,
				invocation: attachment.descriptor.invocation,
				primaryForCapabilities: attachment.primaryForCapabilities,
			}))
		: [];
	const resolvedHiddenToolCount = tapcanvasRemoteToolSurface
		? Math.max(
				0,
				tapcanvasRemoteToolSurface.before.visibleToolCount - resolvedVisibleToolNames.size,
			)
		: 0;
	console.info(
		`[agents-bridge.tool-surface] requestId=${requestId} ` +
			`mode=${hostManifest ? "host" : publicAgentsRequest ? "tapcanvas_public" : "local_code"} ` +
			`policy=${resolvedToolPolicy.mode} ` +
			`scopes=${hostManifest ? "host" : tapcanvasRemoteToolSurface?.satisfiedScopes.join(",") || "none"} ` +
			`direct=${resolvedDirectMeasurement.visibleToolCount} ` +
			`directDefinitionChars=${resolvedDirectMeasurement.descriptionChars + resolvedDirectMeasurement.schemaChars} ` +
			`deferred=${deferPublicChatDirectTools ? "true" : "false"} ` +
			`catalog=${resolvedCatalogIndexMeasurement.visibleToolCount} ` +
			`catalogNameChars=${resolvedCatalogIndexMeasurement.nameChars} ` +
			`catalogEnumJsonChars=${resolvedCatalogIndexMeasurement.enumJsonChars} ` +
			`duplicatedWrapperEnumChars=${resolvedCatalogIndexMeasurement.duplicatedWrapperEnumChars} ` +
			`hidden=${resolvedHiddenToolCount}`,
	);
	if (readAgentsBridgeDebugLog(c)) {
		console.log(
			`[agents-bridge.debug] remote-surface-resolved direct=${remoteTools.length} ` +
				`catalog=${remoteToolCatalog.length} ` +
				`deferred=${deferPublicChatDirectTools ? "true" : "false"} ` +
				`equippedWorkflow=${remoteTools.some((tool) => tool.name === "tapcanvas_equipped_workflow_run") ? "direct" : remoteToolCatalog.some((tool) => tool.name === "tapcanvas_equipped_workflow_run") ? "catalog" : "absent"}`,
		);
	}
	assertAgentsRemoteToolCallbackBase({
		baseUrl: tapcanvasApiBaseUrl,
		remoteToolCount: remoteTools.length + remoteToolCatalog.length,
	});
	// 宿主模式下工具执行回调打到 no-op 端点：真实画布写入由宿主前端消费聊天流里的 tool_calls 完成，
	// hono-api 不落 TapCanvas 库。
	const remoteToolEndpoint =
		tapcanvasApiBaseUrl && remoteTools.length + remoteToolCatalog.length > 0
			? hostManifest
				? `${tapcanvasApiBaseUrl}/public/agents/tools/host-execute`
				: `${tapcanvasApiBaseUrl}/public/agents/tools/execute`
			: "";
	const toolSurfaceConfig = hostManifest
		? {
				mode: "host" as const,
				hostUi: [...(hostManifest.ui ?? [])],
				allowDelegation: false,
				// Tanva host_ui supports media/artifact cards. This must stay enabled so
				// document Skills can publish their real PPTX/XLSX via present_file.
				allowsExternalMedia: true,
			}
		: publicAgentsRequest
			? {
					mode: "tapcanvas_public" as const,
					hostUi: [],
					allowDelegation: allowAgentsDelegation,
					allowsExternalMedia: true,
				}
			: {
					mode: "local_code" as const,
					hostUi: [],
					allowDelegation: allowAgentsDelegation,
					allowsExternalMedia: true,
				};
	const compactPrelude =
		(toolSurfaceConfig.mode === "host" ||
			toolSurfaceConfig.mode === "tapcanvas_public") &&
		!toolSurfaceConfig.allowDelegation;
	const token = readAgentsBridgeToken(c);
	const userLlmProxyOverride = resolveUserLlmProxyOverride({
		tapcanvasApiBaseUrl,
		tapcanvasApiKey,
	});
	const effectiveFinalSystemPrompt = [
		hostManifest ? renderHostManifestPrompt(hostManifest, hostCanvasContext) : null,
		finalSystemPrompt,
		factualContextPrompt,
		userGenerationPrefsBlock,
		effectiveChatContext.canvasSummary
			? `<canvas_overview readonly>${effectiveChatContext.canvasSummary}</canvas_overview>`
			: null,
	].filter(Boolean).join("\n\n");
	const timeoutMs = readTimeoutFromRequestExtras(request) ?? readAgentsBridgeTimeoutMs(c);
	const admissionTimeoutMs = readAgentsBridgeAdmissionTimeoutMs(c);
	const requestAbort = createAgentsBridgeRequestDeadlineController({
		idleTimeoutMs: timeoutMs,
		admissionTimeoutMs,
		...(workflowPhysicalAttemptDeadlineAt
			? { absoluteDeadlineAt: workflowPhysicalAttemptDeadlineAt }
			: {}),
		...(options?.abortSignal ? { externalSignal: options.abortSignal } : {}),
	});
	const bridgePreludeDurationMs = Math.max(0, Date.now() - bridgePreludeStartedAt);
	const runOnce = async (): Promise<Response> => {
		throwIfAbortSignalAborted(requestAbort.signal);
		const dispatcher = await createNodeFetchDispatcher(timeoutMs);
	if (debugLogEnabled) {
		const remoteToolPayloadChars = JSON.stringify({
			remoteTools: compactRemoteTools(remoteTools),
			remoteToolCatalog: compactRemoteToolCatalog(remoteToolCatalog),
		}).length;
		const canvasReferenceNodeCount = effectiveChatContext.chapterCanvasReference?.nodeCount ?? 0;
		console.info(
			`[agents-bridge.debug] request user=${effectiveUserId} kind=${request.kind} timeoutMs=${timeoutMs} skills=${requiredSkills.length} roleSkills=${effectiveChatContext.roleSkillAssignments.length} externalSkills=${skillReferences.availableExternalSkills.length} requiredSkillCalls=${requiredSkillCalls.length} refImages=${mergedReferenceImages.length} assets=${assetInputs.length} localPaths=${localResourcePaths.length} promptChars=${finalPrompt.length} systemChars=${effectiveFinalSystemPrompt.length} modelKey=${modelKey || "n/a"} modelAlias=${modelAlias || "n/a"}`,
		);
		console.info(
			`[agents-bridge.context] canvasNodes=${canvasReferenceNodeCount} canvasReferenceChars=${canvasReferenceBlock?.length ?? 0} remoteToolPayloadChars=${remoteToolPayloadChars} chapterContext=${chapterContext ? "present" : "absent"}`,
		);
			console.info(
				`[agents-bridge.trace] requestId=${requestId} clientPendingId=${clientPendingId || "n/a"} sessionKeyPresent=${sessionKey.length > 0} sessionKeyChars=${sessionKey.length} observabilityThreadIdKind=${upstreamObservabilityContext.threadId === null ? "null" : "string"} observabilityThreadIdChars=${upstreamObservabilityContext.threadId?.length ?? 0}`,
			);
			console.info(`[agents-bridge.debug] prompt=${truncateForDebugLog(finalPrompt)}`);
			if (effectiveFinalSystemPrompt) {
				console.info(
					`[agents-bridge.debug] systemPrompt=${truncateForDebugLog(effectiveFinalSystemPrompt)}`,
				);
			}
		}
		// Retrieval Sandbox binds candidate receipts to logicalTaskId. The public
		// turn and logical task are one durable identity, never two parallel ids.
		const bridgeTurnIdentity = buildAgentsBridgeTurnIdentity(publicTurnId, requestId);
		const physicalContinuationLeaseTakeover = buildPhysicalContinuationLeaseTakeover({
			trustedPublicContinuation: options?.trustedPublicContinuation === true,
			logicalTaskId: bridgeTurnIdentity.logicalTaskId,
		});
		const init: RequestInit & { dispatcher?: unknown } = {
			method: "POST",
			headers: {
					"Content-Type": "application/json",
					Accept: "text/event-stream, application/json",
					"x-agents-user-id": effectiveUserId,
					...buildAgentsBridgeSessionAffinityHeader({
						userId: effectiveUserId,
						sessionId: sessionKey,
					}),
					traceparent: agentTraceContext.traceparent,
					...(billingConversationId ? { "x-tapcanvas-conversation-id": billingConversationId } : {}),
					...(token ? { Authorization: `Bearer ${token}` } : {}),
				},
				body: JSON.stringify({
					prompt: finalPrompt,
					stream: request.kind === "chat",
					userId: effectiveUserId,
					sessionId: sessionKey,
					memoryCoreIdentity: {
						...buildMemoryCoreRequestIdentity({
							activeTeamId,
							configuredTeamId: configuredMemoryCoreTeamId,
							agentId: memoryCoreAgentId,
							effectiveUserId,
							sessionId: sessionKey,
							taskId: requestId,
						}),
					},
					...bridgeTurnIdentity,
					...(physicalContinuationLeaseTakeover
						? { physicalContinuationLeaseTakeover }
						: {}),
					...(clientPendingId ? { clientPendingId } : {}),
					turnDisplayText:
						typeof extras.displayPrompt === "string" && extras.displayPrompt.trim()
							? extras.displayPrompt.trim()
							: request.prompt,
					suppressUserTurnProjection: extras.suppressUserTurnProjection === true,
					...(extras.resetSession === true && options?.trustedPublicContinuation !== true
						? { resetSession: true }
						: {}),
					observabilityContext: upstreamObservabilityContext,
					...(userLlmProxyOverride ? {
						overrideApiKey: userLlmProxyOverride.apiKey,
						overrideApiBaseUrl: userLlmProxyOverride.apiBaseUrl,
						overrideApiStyle: deriveOverrideApiStyle(modelAlias ?? modelKey),
					} : {}),
					...(effectiveFinalSystemPrompt ? { systemPrompt: effectiveFinalSystemPrompt } : {}),
					...(typeof responseFormat !== "undefined"
						? { responseFormat }
						: {}),
					...(typeof outputContract !== "undefined"
						? { outputContract }
						: {}),
					...(typeof maxOutputTokens === "number"
						? { maxOutputTokens }
						: {}),
					...(reasoningEffort ? { reasoningEffort } : {}),
					...(workflowPhysicalAttemptDeadlineAt
						? { workflowPhysicalAttemptDeadlineAt }
						: {}),
					...(allowedTools ? { allowedTools } : {}),
					...(resourceWhitelist ? { resourceWhitelist } : {}),
					...(mergedReferenceImages.length
						? { referenceImages: mergedReferenceImages }
						: {}),
					...(referenceImageSlots.length
						? { referenceImageSlots }
						: {}),
					...(assetInputs.length ? { assetInputs } : {}),
					...(skillReferences.availableExternalSkills.length
						? { externalSkills: skillReferences.availableExternalSkills }
						: {}),
					...(requiredSkillCalls.length ? { requiredSkillCalls } : {}),
					...(externalSkillResolverConfig ? { externalSkillResolverConfig } : {}),
					...(generationContract ? { generationContract } : {}),
					...(continuationUserIntentContract
						? { userIntentContract: continuationUserIntentContract }
						: {}),
					...(extras.userIntentContractLocked === true
						? { userIntentContractLocked: true }
						: {}),
					...(continuationTaskReferences.length > 0
						? { durableTaskReferences: continuationTaskReferences }
						: {}),
					...(continuationRetrievalCandidateSets.length > 0
						? { retrievalCandidateSets: continuationRetrievalCandidateSets }
						: {}),
					...(continuationActionRecoveryFacts.length > 0
						? { actionRecoveryFacts: continuationActionRecoveryFacts }
						: {}),
					...(continuationMaterializedArtifacts.length > 0
						? { trustedMaterializedArtifacts: continuationMaterializedArtifacts }
						: {}),
					...(requestUserInputResponse ? { requestUserInputResponse } : {}),
					...(requiredSkills.length ? { requiredSkills } : {}),
					...(runtimeDisabledSkills.length ? { disabledSkills: runtimeDisabledSkills } : {}),
					...(mountedKnowledgeCardIds.length ? { mountedKnowledgeCardIds } : {}),
					...(disabledKnowledgeCardIds.length ? { disabledKnowledgeCardIds } : {}),
					...(promptExampleRetrievalScope ? { promptExampleRetrievalScope } : {}),
					...((options?.directForcedAgentExecution === true || options?.trustedPublicContinuation === true)
						&& typeof extras.retrievalUserRequest === "string"
						&& extras.retrievalUserRequest.trim()
						? { retrievalUserRequest: extras.retrievalUserRequest.trim() }
						: {}),
					...(retrievalContext ? { retrievalContext } : {}),
					...(effectiveChatContext.roleSkillAssignments.length
						? { roleSkillAssignments: effectiveChatContext.roleSkillAssignments }
						: {}),
					...(effectiveChatContext.chapterDirectorPersona
						? { chapterDirectorPersona: effectiveChatContext.chapterDirectorPersona }
						: {}),
					...(effectiveChatContext.chapterStyleOverride
						? { chapterStyleOverride: effectiveChatContext.chapterStyleOverride }
						: {}),
					...(allowedSubagentTypes.length ? { allowedSubagentTypes } : {}),
					...(forcedAgentRole ? { forcedAgentRole } : {}),
					...(options?.directForcedAgentExecution === true
						? { executeForcedAgentDirectly: true }
						: {}),
					...(requireAgentsTeamExecution ? { requireAgentsTeamExecution: true } : {}),
					...(compactPrelude ? { compactPrelude: true } : {}),
					// 宿主命令必须以原始、可执行参数进入可信 Hono 投影层。
					// 非宿主模式继续保持默认脱敏；宿主模式只暴露 manifest 驱动的
					// flow_patch / host_tool，OpenAI facade 会分别做结构校验后再下发。
					...(hostManifest && remoteTools.some((tool) => tool.name === "flow_patch")
						? { includeFullToolInput: true }
						: {}),
					// 每轮显式替换 direct 与 authorized-deferred 两层能力面；空数组也必须发送，
					// 防止 agents-cli 会话继承或 union 上一轮的工具。
					remoteTools: compactRemoteTools(remoteTools),
					remoteToolCatalog: compactRemoteToolCatalog(remoteToolCatalog),
					...(primaryCapabilityRoutes.length > 0
						? { primaryCapabilityRoutes }
						: {}),
					...(equippedWorkflowCapabilities.length > 0
						? { equippedWorkflowCapabilities }
						: {}),
					toolSurfaceConfig,
					remoteToolConfig: remoteToolEndpoint
						? {
									endpoint: remoteToolEndpoint,
									fileUploadEndpoint: `${tapcanvasApiBaseUrl}/public/oss/upload`,
									...(tapcanvasAuthorization ? { authToken: tapcanvasAuthorization } : {}),
									...(tapcanvasApiKey ? { apiKey: tapcanvasApiKey } : {}),
									...(canvasProjectId ? { projectId: canvasProjectId } : {}),
									...(canvasFlowId ? { flowId: canvasFlowId } : {}),
									...(canvasNodeId ? { nodeId: canvasNodeId } : {}),
									...(bookId ? { bookId } : {}),
									...(chapterId ? { chapterId } : {}),
									...(publicTurnId ? { publicTurnId } : {}),
									...(effectiveChatContext.requestedWorkflowExecutionVariant
										? { requestedWorkflowExecutionVariant: effectiveChatContext.requestedWorkflowExecutionVariant }
										: {}),
								}
						: {},
					...(forceLocalResourceViaBash ? { forceLocalResourceViaBash: true } : {}),
					...(privilegedLocalAccess ? { privilegedLocalAccess: true } : {}),
					...(localResourcePaths.length ? { localResourcePaths } : {}),
					...(modelKey ? { modelKey } : {}),
					...(modelAlias ? { modelAlias } : {}),
					...(canvasProjectId || canvasNodeId || bookId || chapterId || chunkIndex !== null || groupSize !== null || shotStart !== null || shotEnd !== null || shotNo !== null || diagnosticsLabel || chapterCanvasIntent || chapterContext
						? {
							diagnosticContext: {
								source: "agents_bridge",
								requestKind: request.kind,
								...(canvasProjectId ? { projectId: canvasProjectId } : {}),
								...(canvasFlowId ? { flowId: canvasFlowId } : {}),
								...(canvasNodeId ? { nodeId: canvasNodeId } : {}),
								...(bookId ? { bookId } : {}),
								...(chapterId ? { chapterId } : {}),
								...(chunkIndex !== null ? { chunkIndex } : {}),
								...(groupSize !== null ? { groupSize } : {}),
								...(shotStart !== null ? { shotStart } : {}),
								...(shotEnd !== null ? { shotEnd } : {}),
								...(shotNo !== null ? { shotNo } : {}),
								...(effectiveChatContext.selectedNodeKind
									? {
										selectedNodeKind: sanitizeStoryboardEditorKindForAgents(
											effectiveChatContext.selectedNodeKind,
										),
									  }
									: {}),
								...(effectiveChatContext.workspaceAction
									? { workspaceAction: effectiveChatContext.workspaceAction }
									: {}),
								...(chapterCanvasIntent ? { intent: chapterCanvasIntent } : {}),
								...(chapterIntentSourceNodeId
									? { chapterIntentSourceNodeId }
									: {}),
								...(chapterContext ? { chapterContext } : {}),
								...(chapterIntentGenerationConfig
									? { chapterIntentGenerationConfig }
									: {}),
								...(chapterIntentVariantParams
									? { chapterIntentVariantParams }
									: {}),
								...(chapterIntentStyleGuide
									? { chapterIntentStyleGuide }
									: {}),
								...(chapterGroundedScope
									? { chapterGroundedStoryboardScope: true }
									: {}),
								...(diagnosticsLabel ? { label: diagnosticsLabel } : {}),
							},
						}
						: {}),
				}),
				signal: requestAbort.signal,
			};
			if (dispatcher) init.dispatcher = dispatcher;
			const targetUrl = `${baseUrl}/chat`;
			console.info(
				JSON.stringify({
					message: "agents_bridge_performance",
					requestId,
					preludeMs: bridgePreludeDurationMs,
					dispatchReadyMs: Math.max(0, Date.now() - bridgePreludeStartedAt),
				}),
			);
		if (isNodeRuntime()) {
			try {
				return await fetch(targetUrl, init);
			} catch (err) {
				// /chat is non-idempotent (it may trigger tool side effects).
				// Never replay on header-timeout; otherwise one user request can
				// execute twice and duplicate generation tasks.
				if (isHeadersTimeoutError(err)) {
					throw new Error(
						"agents_bridge_headers_timeout_non_retriable",
					);
				}
				throw err;
			}
		}
		return await fetch(targetUrl, init);
	};

	try {
		let res: Response | null = null;
		await runAgentsBridgeQueued(c, async () => {
			try {
				res = await runOnce();
			} catch (err: unknown) {
				throwIfAbortSignalAborted(requestAbort.signal);
				const errorRecord = isRecord(err) ? err : null;
				const causeRecord = isRecord(errorRecord?.cause) ? errorRecord.cause : null;
				const isHeadersTimeout =
					typeof errorRecord?.message === "string" &&
					errorRecord.message.includes("agents_bridge_headers_timeout_non_retriable");
				if (isHeadersTimeout) {
					const reconciliationPublicTurnId = publicTurnId || requestId;
					const reconciliation = await reconcileAgentsBridgeAdmission({
						baseUrl,
						token: token ?? "",
						userId: effectiveUserId,
						sessionId: sessionKey,
						publicTurnId: reconciliationPublicTurnId,
					});
					if (debugLogEnabled) {
						console.warn(
							`[agents-bridge.debug] headers-timeout reconciled user=${effectiveUserId} kind=${request.kind} acceptance=${reconciliation.receipt.acceptance}`,
						);
					}
					if (reconciliation.receipt.acceptance === "accepted") {
						res = buildAcceptedPendingAgentsBridgeResponse(reconciliation);
						return;
					}
					throw new AppError("Agents bridge 请求头超时；上游是否受理仍未知，必须对账同一 publicTurnId", {
						status: 504,
						code: "agents_bridge_acceptance_unknown",
						details: {
							baseUrl,
							timeoutMs,
							acceptance: "unknown",
							publicTurnId: reconciliationPublicTurnId,
							sessionId: sessionKey || null,
							recovery: {
								kind: "status_reconcile",
								referenceId: reconciliationPublicTurnId,
							},
						},
					});
				}
				if (isConnRefusedError(err)) {
					try {
						const recoveredBase = await maybeStartAgentsBridgeOnDemand(c);
						if (recoveredBase) {
							baseUrl = recoveredBase;
							res = await runOnce();
						} else {
							throw err;
						}
					} catch (recoveryError) {
						if (recoveryError instanceof AppError) throw recoveryError;
						throw new AppError("Agents bridge 恢复启动失败", {
							status: 503,
							code: "agents_bridge_recovery_failed",
							details: {
								message: recoveryError instanceof Error
									? recoveryError.message
									: String(recoveryError),
							},
						});
					}
				}
				if (!res) {
					const causeMessage =
						typeof causeRecord?.message === "string" ? causeRecord.message : undefined;
					throw new AppError("Agents bridge 网络请求失败（无法连接或已超时）", {
						status: 502,
						code: "agents_bridge_fetch_failed",
						details: {
							baseUrl,
							timeoutMs,
							error: {
								name: typeof errorRecord?.name === "string" ? errorRecord.name : undefined,
								message:
									typeof errorRecord?.message === "string"
										? errorRecord.message
										: String(err || ""),
								cause: causeMessage,
							},
						},
					});
				}
			}
		}, {
			signal: requestAbort.signal,
			...(effectiveUserId ? { userId: effectiveUserId } : {}),
			priority: workflowPhysicalAttemptDeadlineAt ? "production_deadline" : "standard",
		});

			if (!res) {
				throw new AppError("Agents bridge 网络请求失败（无法连接或已超时）", {
					status: 502,
					code: "agents_bridge_fetch_failed",
				details: { baseUrl, timeoutMs, error: { name: "UnknownError" } },
			});
		}

		const response: Response = res;
		throwIfAbortSignalAborted(requestAbort.signal);

		if (!response.ok) {
			const body = await readResponseTextSafe(response);
			if (debugLogEnabled) {
				console.warn(
					`[agents-bridge.debug] response failed status=${response.status} body=${truncateForDebugLog(body)}`,
				);
			}
			let payload: Record<string, unknown> | null = null;
			try {
				payload = asRecord(body ? JSON.parse(body) : null);
			} catch {
				payload = null;
			}
			const nestedError = asRecord(payload?.error);
			const upstreamMessage =
				(typeof payload?.message === "string" && payload.message.trim()
					? payload.message.trim()
					: null)
				?? (typeof payload?.error === "string" && payload.error.trim()
					? payload.error.trim()
					: null)
				?? (typeof nestedError?.message === "string" && nestedError.message.trim()
					? nestedError.message.trim()
					: null);
			const upstreamCode =
				typeof payload?.code === "string" && payload.code.trim()
					? payload.code.trim()
					: "agents_bridge_failed";
			throw new AppError(upstreamMessage ?? "Agents bridge 调用失败", {
				status: response.status,
				code: upstreamCode,
				terminal: payload?.terminal === true,
				details: payload?.details ?? {
					upstreamStatus: response.status,
					body: body || null,
				},
			});
		}

		const responseContentType = String(response.headers.get("content-type") || "").toLowerCase();
		const data = (
			responseContentType.includes("text/event-stream")
				? await parseAgentsBridgeSseResponse({
					response,
					c,
					abortSignal: requestAbort.signal,
					onActivity: requestAbort.confirmAdmission,
					...(options?.onStreamEvent ? { onEvent: options.onStreamEvent } : {}),
				})
				: await response.json().catch(() => null)
		) as AgentsBridgeChatResponse | null;
		throwIfAbortSignalAborted(requestAbort.signal);
		const text = typeof data?.text === "string" ? data.text.trim() : "";
		throwIfAbortSignalAborted(requestAbort.signal);
		const pendingUserInput = normalizeAgentsBridgePendingUserInput(data?.pendingUserInput);
		const bridgeToolCalls = Array.isArray(data?.trace?.toolCalls)
			? data!.trace!.toolCalls
				.filter((item): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item))
				.slice(0, 200)
			: [];
	const normalizedBridgeToolCalls = normalizeBridgeToolCalls(bridgeToolCalls);
	const durableTaskReferences = collectDurableTaskReferences(normalizedBridgeToolCalls);
	const actionRecoveryFacts = collectDurableActionRecoveryFacts(normalizedBridgeToolCalls);
	const assets = Array.isArray(data?.assets)
		? data.assets
				.map((asset) => {
					const rawType = typeof asset?.type === "string" ? asset.type.trim().toLowerCase() : "";
					if (rawType !== "video" && rawType !== "image" && rawType !== "audio" && rawType !== "file") {
						throw new Error(`agents bridge 返回了不支持的资产类型：${rawType || "missing"}`);
					}
					const type: "image" | "video" | "audio" | "file" = rawType;
					const url = typeof asset?.url === "string" ? asset.url.trim() : "";
					const thumbnailUrl =
						type === "video" && typeof asset?.thumbnailUrl === "string"
							? asset.thumbnailUrl.trim()
							: "";
					const fileName = type === "file" && typeof asset?.fileName === "string"
						? asset.fileName.trim()
						: "";
					const mimeType = type === "file" && typeof asset?.mimeType === "string"
						? asset.mimeType.trim()
						: "";
					const assetName = type === "file" && typeof asset?.title === "string"
						? asset.title.trim()
						: "";
					const assetId = type === "file" && typeof asset?.assetId === "string"
						? asset.assetId.trim()
						: "";
					if (!url || !isHttpAssetUrl(url)) {
						throw new Error("agents bridge 返回了无效的资产 URL");
					}
					return {
						type,
						url,
						...(thumbnailUrl && isHttpAssetUrl(thumbnailUrl)
							? { thumbnailUrl }
							: {}),
						...(fileName ? { fileName } : {}),
						...(mimeType ? { mimeType } : {}),
						...(assetName ? { assetName } : {}),
						...(assetId ? { assetId } : {}),
					};
				})
				.slice(0, 24)
		: [];
	const traceOutput =
		data?.trace?.output && typeof data.trace.output === "object" && !Array.isArray(data.trace.output)
			? data.trace.output
			: null;
	const traceSummary =
		data?.trace?.summary && typeof data.trace.summary === "object" && !Array.isArray(data.trace.summary)
			? data.trace.summary
			: null;
	const traceTurns = Array.isArray(data?.trace?.turns)
		? data.trace.turns
				.filter((item): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item))
				.slice(0, 24)
		: [];
	const llmTermination = summarizeAgentsBridgeLlmTermination(traceTurns);
	const rawTraceRuntime = isRecord(data?.trace?.runtime) ? data.trace.runtime : null;
	const traceRuntime = normalizeAgentsRuntimeTraceSummary(rawTraceRuntime);
	const traceTodoList = normalizeAgentsTodoListTraceSummary(data?.trace?.todoList);
	const traceTodoEvents = normalizeAgentsTodoEventTraceSummaries(data?.trace?.todoEvents);
	const tracePlanning =
		normalizeAgentsPlanningTraceSummary(data?.trace?.planning) ??
		deriveAgentsPlanningTraceSummaryFromTodo({
			todoList: traceTodoList,
			todoEvents: traceTodoEvents,
		});
	const traceCompletion = normalizeAgentsCompletionTraceSummary(data?.trace?.completion);
	const reportedTraceRunOutcome = normalizeAgentsBridgeRunOutcome(data?.trace?.runOutcome);
	if (!traceRuntime?.physicalRunExit) {
		throw new AppError("Agents bridge 返回的物理退出合同无效", {
			status: 502,
			code: "agents_bridge_physical_run_exit_protocol_invalid",
		});
	}
	const expectedTerminalAuthority = options?.directForcedAgentExecution === true
		? "workflow_action"
		: "user_delivery";
	if (traceRuntime.terminalAuthority !== expectedTerminalAuthority) {
		throw new AppError("Agents bridge 返回的终态裁决权合同无效", {
			status: 502,
			code: "agents_bridge_terminal_authority_protocol_invalid",
			details: {
				expected: expectedTerminalAuthority,
				actual: traceRuntime.terminalAuthority,
			},
		});
	}
	const authoritativeRunOutcome = projectAgentsBridgeRunOutcomeFromPhysicalExit(
		traceRuntime.physicalRunExit,
	);
	const terminalDeliveryWasReported = rawTraceRuntime?.terminalDelivery !== undefined;
	if (terminalDeliveryWasReported && !traceRuntime?.terminalDelivery) {
		throw new AppError("Agents bridge 返回的持久交付终态合同无效", {
			status: 502,
			code: "agents_bridge_terminal_delivery_protocol_invalid",
		});
	}
	const traceRunOutcome = authoritativeRunOutcome;
	const runOutcomeProtocolDrift = Boolean(
		authoritativeRunOutcome && reportedTraceRunOutcome && (
			authoritativeRunOutcome.status !== reportedTraceRunOutcome.status ||
			authoritativeRunOutcome.reason !== reportedTraceRunOutcome.reason
		),
	);
	if (!traceCompletion || !reportedTraceRunOutcome || !traceRunOutcome) {
		throw new AppError("Agents bridge 返回的任务完成合同无效", {
			status: 502,
			code: "agents_bridge_completion_protocol_invalid",
			details: {
				requiredContract: "completion@1 + runOutcome@1",
				completionPresent: Boolean(traceCompletion),
				runOutcomePresent: Boolean(reportedTraceRunOutcome),
			},
		});
	}
	const durableTerminalDelivery = traceRuntime.terminalDelivery ?? null;
	if (durableTerminalDelivery && traceRunOutcome.status !== "succeeded") {
		throw new AppError("Agents bridge 的持久交付终态与执行出口不一致", {
			status: 502,
			code: "agents_bridge_terminal_delivery_outcome_mismatch",
			details: {
				durableStatus: durableTerminalDelivery.requestTerminal.status,
				runOutcomeStatus: traceRunOutcome.status,
			},
		});
	}
	const semanticTaskSummaryFromToolTrace =
		normalizeAgentsSemanticTaskSummaryFromToolCalls(normalizedBridgeToolCalls);
	const semanticTaskSummaryFromRuntimeIntent =
		normalizeAgentsSemanticTaskSummaryFromRuntimeIntentContract(
			traceRuntime?.userIntentContract,
		);
	const semanticTaskSummaryFromDurableTerminal = durableTerminalDelivery
		? normalizeAgentsSemanticTaskSummaryFromRuntimeIntentContract(
			durableTerminalDelivery.expectedDelivery,
		)
		: null;
	const durableTerminalTaskSummary = durableTerminalDelivery && semanticTaskSummaryFromDurableTerminal
		? {
				...semanticTaskSummaryFromDurableTerminal,
				deliveryEvidence: durableTerminalDelivery.deliveryEvidence,
				deliveryVerification: durableTerminalDelivery.deliveryVerification,
		  }
		: null;
	const semanticTaskSummary =
		durableTerminalTaskSummary ??
		semanticTaskSummaryFromToolTrace ??
		semanticTaskSummaryFromRuntimeIntent;
	const semanticTaskSummarySource: PublicChatExpectedDeliverySummary["source"] =
		durableTerminalTaskSummary
			? "agents_cli_user_intent_contract"
			: semanticTaskSummaryFromToolTrace
			? "agents_cli_tool_trace"
			: semanticTaskSummaryFromRuntimeIntent
				? "agents_cli_user_intent_contract"
				: "none";
	if (
		semanticTaskSummaryFromToolTrace?.deliveryEvidence &&
		semanticTaskSummaryFromToolTrace.deliveryVerification &&
		!isPublicChatDeliveryEnvelopeStructurallyConsistent({
			evidence: semanticTaskSummaryFromToolTrace.deliveryEvidence,
			verification: semanticTaskSummaryFromToolTrace.deliveryVerification,
			expectedContractHash: readTrimmedString(traceRuntime?.userIntentContract?.contractHash),
		})
	) {
		throw new AppError("Agents bridge 返回的交付信封引用不一致", {
			status: 502,
			code: "agents_bridge_delivery_envelope_inconsistent",
			details: {
				contractHash: semanticTaskSummaryFromToolTrace.deliveryVerification.contractHash,
				runtimeContractHash: readTrimmedString(traceRuntime?.userIntentContract?.contractHash),
			},
		});
	}
	const semanticExecutionIntent = buildAgentsSemanticExecutionIntentSummary({
		taskSummary: semanticTaskSummary,
		source: durableTerminalTaskSummary
			? "runtime_user_intent_contract"
			: semanticTaskSummaryFromToolTrace
			? "tool_trace_output_json"
			: semanticTaskSummaryFromRuntimeIntent
				? "runtime_user_intent_contract"
				: "none",
	});
	const canvasPlanDiagnosticsRaw = buildCanvasPlanDiagnostics(text);
	const toolEvidence = summarizeBridgeToolEvidence(normalizedBridgeToolCalls);
	const outputMode = classifyBridgeOutputMode({
		assetCount: assets.length,
		canvasPlanParsed: Boolean(canvasPlanDiagnosticsRaw.parseSuccess),
		canvasPlanHasAssetUrls: Boolean(canvasPlanDiagnosticsRaw.hasAssetUrls),
		wroteCanvas: toolEvidence.wroteCanvas,
	});
	const canvasPlanDiagnostics = decorateCanvasPlanDiagnosticsForOutputMode({
		outputMode,
		canvasPlanDiagnostics: canvasPlanDiagnosticsRaw,
	});
	if (debugLogEnabled) {
		console.info(
			`[agents-bridge.debug] response ok user=${effectiveUserId} kind=${request.kind} textChars=${text.length} assets=${assets.length}`,
		);
		console.info(`[agents-bridge.debug] responseText=${truncateForDebugLog(text)}`);
	}
	const id =
		typeof data?.id === "string" && data.id.trim()
			? data.id.trim()
			: `task_${crypto.randomUUID()}`;
		const fallbackSucceededToolCalls = normalizedBridgeToolCalls.filter(
			(call) => call.status === "succeeded",
		).length;
		const fallbackFailedToolCalls = normalizedBridgeToolCalls.filter(
			(call) => call.status === "failed" && call.severity !== "warning",
		).length;
		const fallbackWarningToolCalls = normalizedBridgeToolCalls.filter(
			(call) => call.severity === "warning",
		).length;
		const fallbackDeniedToolCalls = normalizedBridgeToolCalls.filter(
			(call) => call.status === "denied",
		).length;
		const fallbackBlockedToolCalls = normalizedBridgeToolCalls.filter(
			(call) => call.status === "blocked",
		).length;
		const toolStatusSummary: ToolStatusSummary = {
			totalToolCalls:
				readTraceNumberField(traceSummary, "totalToolCalls") ?? normalizedBridgeToolCalls.length,
			succeededToolCalls:
				readTraceNumberField(traceSummary, "succeededToolCalls") ?? fallbackSucceededToolCalls,
			failedToolCalls:
				Math.max(
					(readTraceNumberField(traceSummary, "failedToolCalls") ?? fallbackFailedToolCalls) -
					(readTraceNumberField(traceSummary, "warningToolCalls") ?? fallbackWarningToolCalls),
					0,
				),
			deniedToolCalls:
				readTraceNumberField(traceSummary, "deniedToolCalls") ?? fallbackDeniedToolCalls,
			blockedToolCalls:
				readTraceNumberField(traceSummary, "blockedToolCalls") ?? fallbackBlockedToolCalls,
			warningToolCalls:
				readTraceNumberField(traceSummary, "warningToolCalls") ?? fallbackWarningToolCalls,
			runMs: readTraceNumberField(traceSummary, "runMs") ?? null,
		};
		const chapterGroundedVisualPreproduction = buildChapterGroundedVisualPreproductionSummary({
			toolCalls: normalizedBridgeToolCalls,
			selectedNodeKind: effectiveChatContext.selectedNodeKind,
		});
		const expectedDelivery = buildPublicChatExpectedDeliverySummary({
			taskSummary: semanticTaskSummary,
			source: semanticTaskSummarySource,
		});
		const deliveryEvidence = buildPublicChatDeliveryEvidence({
			canonicalItems: semanticTaskSummary?.deliveryEvidence ?? [],
			assets,
			toolEvidence,
			chapterGroundedVisualPreproduction,
			toolCalls: normalizedBridgeToolCalls,
			hostManifest: hostManifest ?? null,
			hostCanvasContext: hostCanvasContext ?? null,
		});
		const deliveryVerification = semanticTaskSummary?.deliveryVerification ?? null;
		const publicDeliveryEvidence = hasMaterializedPublicDeliveryEvidence(deliveryEvidence)
			? deliveryEvidence
			: null;
		const publicDeliveryVerification = publicDeliveryEvidence
			? deliveryVerification
			: null;
		const toolExecutionIssues = summarizeBridgeToolExecutionIssues({
			toolCalls: normalizedBridgeToolCalls,
			toolStatusSummary,
			deliveryVerification,
			deliveryEvidence,
		});
		// Hono does not run a parallel semantic, creative, or delivery-verification
		// pass. The canonical envelope above was verified inside agents-cli; Hono only
		// projects it and adds deterministic host execution facts for UI/continuation.
		const diagnosticFlags: DiagnosticFlag[] = runOutcomeProtocolDrift
			? [{
				code: "agent_run_outcome_physical_exit_mismatch",
				severity: "high",
				title: "Agent 物理退出投影不一致",
				detail:
					"已按 TaskStore-backed PhysicalRunExitV1 投影本轮状态；较弱的 runOutcome 未获准覆盖权威任务出口。",
			}]
			: [];
		const agentDecision = buildAgentsBridgeDecision({
			outputMode,
			assetCount: assets.length,
			toolEvidence,
			canvasPlanDiagnostics,
		});
		const projectedRequestTerminal = resolveAgentsBridgeRequestTerminal({
			runOutcome: traceRunOutcome,
			pendingUserInput: Boolean(pendingUserInput),
		});
		const requestTerminal = durableTerminalDelivery?.requestTerminal ?? projectedRequestTerminal;
		const logicalTaskState = (() => {
			try {
				return traceRuntime.terminalAuthority === "workflow_action"
					? projectWorkflowActionLogicalTaskState({
							exit: traceRuntime.physicalRunExit,
							expectedLogicalTaskId: publicTurnId || requestId,
					  })
					: projectPublicChatLogicalTaskState({
							exit: traceRuntime.physicalRunExit,
							expectedLogicalTaskId: publicTurnId || requestId,
							deliveryVerified: durableTerminalDelivery !== null,
					  });
			} catch (error: unknown) {
				throw new AppError("Agents bridge 的逻辑任务状态无法提交", {
					status: 502,
					code: "agents_bridge_logical_task_state_invalid",
					details: error instanceof Error ? error.message : String(error),
				});
			}
		})();
		const hostExecutionHandoff = collectPublicChatHostExecutionHandoffEvidence({
			manifest: hostManifest ?? null,
			toolCalls: normalizedBridgeToolCalls,
		});
		const turnVerdict = buildAgentsBridgeTurnVerdict(requestTerminal);
		const canvasMutation = buildAgentsBridgeCanvasMutationSummary(normalizedBridgeToolCalls);
		const observabilityFinishedAt = new Date().toISOString();
		let canonicalPersistence: AgentCanonicalPersistenceHealthV1 = {
			status: "degraded",
			spanCount: 0,
			evaluationCount: 0,
			errorCode: "agents_runtime_observability_missing",
		};
		if (traceRuntime?.observability) {
			try {
				const workflowKey =
					typeof extras.workflowKey === "string" && extras.workflowKey.trim()
						? extras.workflowKey.trim()
						: `agents_bridge.${request.kind}`;
				const builtObservability = buildAgentObservabilitySpans({
					traceContext: agentTraceContext,
					runtime: traceRuntime.observability,
					requestFinishedAt: observabilityFinishedAt,
					scope: {
						projectId: canvasProjectId || null,
						bookId: bookId || null,
						chapterId: chapterId || null,
						flowId: canvasFlowId || null,
						nodeId: canvasNodeId || null,
						label: diagnosticsLabel || null,
						workflowKey,
					},
					modelKey: modelKey || modelAlias || null,
					toolCalls: normalizedBridgeToolCalls,
					assets,
					expectedDelivery,
					deliveryEvidence,
					deliveryVerification,
					turnVerdict,
					requestTerminal,
					performanceSnapshot: traceRuntime.performanceSnapshot ?? null,
				});
				canonicalPersistence = await persistBuiltAgentObservability(
					c,
					effectiveUserId,
					builtObservability,
				);
			} catch (error: unknown) {
				canonicalPersistence = {
					status: "degraded",
					spanCount: 0,
					evaluationCount: 0,
					errorCode: "canonical_span_build_failed",
				};
				console.error(
					`[agent-observability] span build degraded trace=${agentTraceContext.traceId} reason=${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}
		const bridgeResponseMeta: AgentsBridgeResponseMeta = {
			traceId: agentTraceContext.traceId,
			...(modelKey ? { modelKey } : {}),
			...(modelAlias ? { modelAlias } : {}),
			...(requestId ? { requestId } : {}),
			...(sessionKey ? { sessionId: sessionKey } : {}),
			outputMode,
			toolEvidence,
			...(expectedDelivery.active ? { expectedDelivery } : {}),
			...(publicDeliveryVerification ? { deliveryVerification: publicDeliveryVerification } : {}),
			// Accepted async receipts are internal lifecycle evidence even before an
			// asset URL exists. The public projection still requires materialization,
			// while the durable continuation registrar must retain the exact run/task
			// identity so the suspended logical turn has an owner.
			...(deliveryEvidence.artifacts.length > 0 || publicDeliveryEvidence
				? { deliveryEvidence }
				: {}),
			...(traceTurns.length > 0 ? { llmTermination } : {}),
			toolStatusSummary,
			toolExecutionIssues,
			diagnosticFlags,
			canvasPlan: canvasPlanDiagnostics,
			...(canvasMutation ? { canvasMutation } : {}),
			agentDecision,
			...(traceCompletion ? { completionTrace: traceCompletion } : {}),
			runOutcome: traceRunOutcome,
			logicalTaskState,
			...(semanticExecutionIntent.detected ? { semanticExecutionIntent } : {}),
			...(tracePlanning ? { planningTrace: tracePlanning } : {}),
			...(traceTodoList ? { todoList: traceTodoList } : {}),
			...(traceTodoEvents.length > 0 ? { todoEvents: traceTodoEvents } : {}),
			turnVerdict,
			requestTerminal,
			...(hostExecutionHandoff ? { hostExecutionHandoff } : {}),
			...(durableTaskReferences.length > 0 ? { durableTaskReferences } : {}),
			...(actionRecoveryFacts.length > 0 ? { actionRecoveryFacts } : {}),
			...(traceRuntime ? { runtime: traceRuntime } : {}),
			...(traceRuntime?.executionProvenance
				? { executionProvenance: traceRuntime.executionProvenance }
				: {}),
			observability: {
				canonicalPersistence,
			},
		};
		return {
			id,
			kind: request.kind,
			status: resolveAgentsBridgeTaskResultStatus(logicalTaskState),
			assets,
			raw: {
				provider: "agents_bridge",
				vendor: "agents",
				userId: effectiveUserId,
				text,
				...(pendingUserInput ? { pendingUserInput } : {}),
				meta: bridgeResponseMeta,
			},
		};
	} catch (error: unknown) {
		const errorRecord = error && typeof error === "object" && !Array.isArray(error)
			? error as Record<string, unknown>
			: null;
		const bridgeErrorCode =
			typeof errorRecord?.code === "string" && errorRecord.code.trim()
				? errorRecord.code.trim().slice(0, 160)
				: "agents_bridge_unhandled_failure";
		const failureObservability = buildFailedHonoAgentObservability({
			traceContext: agentTraceContext,
			requestFinishedAt: new Date().toISOString(),
			scope: {
				projectId: canvasProjectId || null,
				bookId: bookId || null,
				chapterId: chapterId || null,
				flowId: canvasFlowId || null,
				nodeId: canvasNodeId || null,
				label: diagnosticsLabel || null,
				workflowKey: typeof extras.workflowKey === "string" && extras.workflowKey.trim()
					? extras.workflowKey.trim()
					: `agents_bridge.${request.kind}`,
			},
			modelKey: modelKey || modelAlias || null,
			errorCode: bridgeErrorCode,
		});
		await persistBuiltAgentObservability(c, effectiveUserId, failureObservability);
		throw error;
	} finally {
		requestAbort.cleanup();
	}
}
