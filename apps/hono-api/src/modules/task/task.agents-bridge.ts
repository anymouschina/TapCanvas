import fs from "node:fs/promises";
import path from "node:path";
import { AppError } from "../../middleware/error";
import { getPrismaClient } from "../../platform/node/prisma";
import { listAssetsForUser, type AssetRow } from "../asset/asset.repo";
import type { AppContext } from "../../types";
import { appendTraceEvent } from "../../trace";
import { writeUserExecutionTrace } from "../memory/memory.service";
import { type PublicChatReferenceImageSlot } from "./chat-system-prompt";
import type { PublicChatPromptContext } from "./chat-prompt.types";
import {
	resolveEffectivePublicChatBookChapterScope,
} from "./public-chat-workflow";
import { buildPublicChatExecutionPlanningDirective } from "./public-chat-execution-planning";
import {
	buildPublicChatExpectedDeliverySummary,
	verifyPublicChatDelivery,
	type PublicChatDeliveryEvidence,
	type PublicChatExpectedDeliveryKind,
	type PublicChatDeliveryVerificationSummary,
	type PublicChatExpectedDeliverySummary,
} from "./public-chat-delivery-verifier";
import { loadPublicChatEnabledModelCatalogSummary } from "../model-catalog/model-catalog.public-chat-summary";
import { getFlowForOwner, listFlowsByOwner } from "../flow/flow.repo";
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
import { buildCanvasCapabilityManifest } from "../ai/tool-schemas";
import {
	loadGenerationContractModule,
	loadImagePromptSpecModule,
	type GenerationContract,
	type ImagePromptSpecV2,
} from "../../platform/node/shared-schema-loader";
import { resolveProjectDataRepoRoot } from "../asset/project-data-root";

const generationContractModule = loadGenerationContractModule();
const imagePromptSpecModule = loadImagePromptSpecModule();
const { parseGenerationContract } = generationContractModule;
const { parseImagePromptSpecV2 } = imagePromptSpecModule;

type AgentsBridgeChatResponse = {
	id?: string;
	text?: string;
	assets?: Array<{
		type?: string;
		url?: string;
		thumbnailUrl?: string;
	}>;
	trace?: {
		toolCalls?: Array<Record<string, unknown>>;
		output?: Record<string, unknown>;
		summary?: Record<string, unknown>;
		completion?: Record<string, unknown>;
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
	phase?: unknown;
	status?: unknown;
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

type AgentsBridgeStreamEvent =
	| { event: "content"; data: { delta?: string } }
	| { event: "tool"; data: AgentsBridgeStreamToolCall }
	| { event: "todo_list"; data: AgentsBridgeStreamTodoListEvent }
	| { event: "result"; data: { response: AgentsBridgeChatResponse } }
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

type AgentsBridgeStreamObserver = (event: AgentsBridgeStreamEvent) => void | Promise<void>;

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
	assetId?: string;
	assetRefId?: string;
	url: string;
	role: AgentsBridgeAssetRole;
	weight?: number;
	note?: string;
	name?: string;
};

type AgentsBridgeReferenceImageSlot = PublicChatReferenceImageSlot;

type AgentsBridgeChatContextSkill = {
	key: string | null;
	name: string | null;
	content?: string | null;
};

type AgentsBridgeChatContext = {
	currentProjectName: string | null;
	workspaceAction:
		| "chapter_script_generation"
		| "chapter_asset_generation"
		| "shot_video_generation"
		| null;
	skill: AgentsBridgeChatContextSkill | null;
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
};

type AgentsBridgeRemoteToolDefinition = {
	name: string;
	description: string;
	parameters: Record<string, unknown>;
};

const EXECUTION_TRACE_TOOL_CALL_LIMIT = 48;
const EXECUTION_TRACE_ARRAY_LIMIT = 24;
const EXECUTION_TRACE_OBJECT_KEY_LIMIT = 24;
const EXECUTION_TRACE_STRING_LIMIT = 800;
const EXECUTION_TRACE_TEXT_PREVIEW_LIMIT = 2000;

const REMOTE_FLOW_CREATE_NODE_TYPES = ["taskNode", "groupNode"] as const;
const REMOTE_FLOW_TASK_NODE_KINDS = [
	"text",
	"image",
	"imageEdit",
	"video",
	"storyboard",
	"novelDoc",
	"scriptDoc",
	"storyboardScript",
	"cameraRef",
	"workflowInput",
	"workflowOutput",
	"storyboardImage",
	"imageFission",
	"mosaic",
	"composeVideo",
	"audio",
	"subtitle",
] as const;

const REMOTE_FLOW_TASK_NODE_KINDS_WITHOUT_STORYBOARD = REMOTE_FLOW_TASK_NODE_KINDS.filter(
	(kind) => kind !== "storyboard",
);


type BookChapterCharacterMeta = {
	name?: string;
};

type BookChapterNamedEntityMeta = {
	name?: string;
};

type BookChapterPropMeta = {
	name?: string;
	description?: string;
	narrativeImportance?: "critical" | "supporting" | "background";
	visualNeed?: "must_render" | "shared_scene_only" | "mention_only";
	functionTags?: Array<
		| "plot_trigger"
		| "combat"
		| "threat"
		| "identity_marker"
		| "continuity_anchor"
		| "transaction"
		| "environment_clutter"
	>;
	reusableAssetPreferred?: boolean;
	independentlyFramable?: boolean;
};

type BookChapterMeta = {
	chapter?: number;
	characters?: BookChapterCharacterMeta[];
	props?: BookChapterPropMeta[];
	scenes?: BookChapterNamedEntityMeta[];
};

type BookStoryboardChunkMeta = {
	chapter?: number;
	updatedAt?: string;
	tailFrameUrl?: string;
};

type BookRoleCardMeta = {
	cardId?: string;
	roleId?: string;
	roleName?: string;
	imageUrl?: string;
	threeViewImageUrl?: string;
	status?: string;
	confirmationMode?: string | null;
	confirmedAt?: string | null;
	updatedAt?: string;
	createdAt?: string;
	stateDescription?: string;
	stateKey?: string;
	ageDescription?: string;
	stateLabel?: string;
	healthStatus?: string;
	injuryStatus?: string;
	chapter?: number;
	chapterStart?: number;
	chapterEnd?: number;
	chapterSpan?: number[];
};

type BookVisualRefMeta = {
	refId?: string;
	category?: string;
	name?: string;
	imageUrl?: string;
	status?: string;
	confirmationMode?: string | null;
	confirmedAt?: string | null;
	updatedAt?: string;
	createdAt?: string;
	stateDescription?: string;
	stateKey?: string;
	chapter?: number;
	chapterStart?: number;
	chapterEnd?: number;
	chapterSpan?: number[];
};

type BookSemanticAssetMeta = {
	semanticId?: string;
	mediaKind?: string;
	status?: string;
	nodeId?: string;
	nodeKind?: string;
	taskId?: string;
	planId?: string;
	chunkId?: string;
	imageUrl?: string;
	videoUrl?: string;
	thumbnailUrl?: string;
	chapter?: number;
	chapterStart?: number;
	chapterEnd?: number;
	chapterSpan?: number[];
	shotNo?: number;
	stateDescription?: string;
	prompt?: string;
	anchorBindings?: PublicFlowAnchorBinding[];
	productionLayer?: string;
	creationStage?: string;
	approvalStatus?: string;
	confirmationMode?: string | null;
	confirmedAt?: string | null;
	updatedAt?: string;
	createdAt?: string;
};

type BookIndexAssetsMeta = {
	storyboardChunks?: BookStoryboardChunkMeta[];
	roleCards?: BookRoleCardMeta[];
	visualRefs?: BookVisualRefMeta[];
	semanticAssets?: BookSemanticAssetMeta[];
	styleBible?: {
		referenceImages?: string[];
	};
};

type BookIndexMeta = {
	title?: string;
	chapters?: BookChapterMeta[];
	assets?: BookIndexAssetsMeta;
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

type ToolStatusSummary = {
	totalToolCalls: number;
	succeededToolCalls: number;
	failedToolCalls: number;
	deniedToolCalls: number;
	blockedToolCalls: number;
	runMs: number | null;
};

type ToolExecutionIssueSummary = {
	failedToolCalls: number;
	deniedToolCalls: number;
	blockedToolCalls: number;
	coordinationBlockedToolCalls: number;
	actionableBlockedToolCalls: number;
	hasExecutionIssues: boolean;
};

type DiagnosticFlag = {
	code: string;
	severity: "high" | "medium";
	title: string;
	detail: string;
};

type VideoPromptGovernanceSummary = {
	active: boolean;
	sourceHints: string[];
	hasExecutablePrompt: boolean;
	usesDeprecatedVideoPromptField: boolean;
};

type ImagePromptSpecGovernanceSummary = {
	active: boolean;
	sourceHints: string[];
	chapterGroundedTargetCount: number;
	validSpecCount: number;
	missingSpecCount: number;
	invalidSpecCount: number;
	missingReferenceBindingsCount: number;
	missingIdentityConstraintsCount: number;
	missingEnvironmentObjectsCount: number;
	missingCharacterContinuityCount: number;
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

type ChapterGroundedReferenceBindingSummary = {
	active: boolean;
	targetNodeCount: number;
	missingBindingCount: number;
	missingCharacterBindingCount: number;
};

type StoryboardEditorContractSummary = {
	active: boolean;
	sourceHints: string[];
	hasStoryboardNodes: boolean;
	hasStoryboardEditorCells: boolean;
	hasMaterializedStoryboardCellImages: boolean;
	hasTextOnlyStoryboardPayload: boolean;
};

type AgentsTeamExecutionSummary = {
	active: boolean;
	sourceHints: string[];
	hasExecutionEvidence: boolean;
};

type FlowPatchNodeFinalState = {
	id: string;
	kind: string;
	data: Record<string, unknown>;
};

type AgentsRuntimeTraceSummary = {
	profile: "general" | "code" | "unknown";
	registeredToolNames: string[];
	registeredTeamToolNames: string[];
	requiredSkills: string[];
	loadedSkills: string[];
	allowedSubagentTypes: string[];
	requireAgentsTeamExecution: boolean;
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
	source: "todo_list" | "unknown";
	planningRequired: boolean;
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

type AgentsCompletionTraceSummary = {
	source: "deterministic" | "final_self_check" | "unknown";
	terminal: "success" | "explicit_failure" | "blocked" | "unknown";
	allowFinish: boolean;
	failureReason: string | null;
	rationale: string;
	successCriteria: string[];
	missingCriteria: string[];
	requiredActions: string[];
};

type AgentsSemanticTaskSummary = {
	taskGoal: string;
	requestedOutput: string;
	taskKind: string;
	recommendedNextStage: string;
	mustStop: boolean;
	blockingGaps: string[];
	successCriteria: string[];
	deliveryContract?: {
		kind: Exclude<PublicChatExpectedDeliveryKind, "none">;
		minStillCount?: number;
	} | null;
};

type AgentsSemanticExecutionIntentSummary = {
	detected: boolean;
	source: "task_interrogation_json" | "tool_trace_output_json" | "none";
	taskKind: string | null;
	mustStop: boolean;
	requiresExecutionDelivery: boolean;
	reason: string;
};

type BridgeToolCall = {
	toolCallId: string;
	name: string;
	status: "succeeded" | "failed" | "denied" | "blocked" | "";
	pathHint: string;
	errorMessage: string;
	outputPreview: string;
	outputChars: number | null;
	outputHead: string;
	outputTail: string;
	outputJson: Record<string, unknown> | null;
	inputJson: Record<string, unknown> | null;
	requestedAgentType: string;
};

type AgentsBridgeOutputMode = "plan_with_assets" | "plan_only" | "direct_assets" | "text_only";

type AgentsBridgeDecision = {
	executionKind: "plan" | "execute" | "generate" | "answer";
	canvasAction: "create_canvas_workflow" | "write_canvas" | "none";
	assetCount: number;
	projectStateRead: boolean;
	requiresConfirmation: boolean;
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

type AgentsBridgeResponseMeta = {
	requestId?: string;
	sessionId?: string;
	outputMode: AgentsBridgeOutputMode;
	toolEvidence: BridgeToolEvidence;
	expectedDelivery?: PublicChatExpectedDeliverySummary;
	deliveryEvidence?: PublicChatDeliveryEvidence;
	deliveryVerification?: PublicChatDeliveryVerificationSummary;
	promptPipeline: PromptPipelineTraceSummary;
	toolStatusSummary: ToolStatusSummary;
	diagnosticFlags: DiagnosticFlag[];
	canvasPlan: CanvasPlanDiagnostics;
	canvasMutation?: AgentsBridgeCanvasMutation;
	agentDecision: AgentsBridgeDecision;
	completionTrace?: AgentsCompletionTraceSummary;
	semanticExecutionIntent?: AgentsSemanticExecutionIntentSummary;
	planningTrace?: AgentsPlanningTraceSummary;
	todoList?: AgentsTodoListTraceSummary;
	todoEvents?: AgentsTodoEventTraceSummary[];
	turnVerdict: AgentsBridgeTurnVerdict;
};

type PromptPipelineTarget =
	| "general_chat"
	| "text_evidence_context"
	| "visual_generation";

type PromptPipelinePrecheckSnapshot = {
	target: PromptPipelineTarget;
	roleMentionCount: number;
	matchedRoleCardCount: number;
	missingRoleCardCount: number;
	ambiguousRoleCardCount: number;
	chapterRoleCardInjectedCount: number;
	continuityTailFrameFound: boolean;
	autoReferenceImageCount: number;
	generationGateActive: boolean;
	directGenerationReady: boolean;
	generationGateReason: string;
};

type PromptPipelineStageStatus = "not_needed" | "pending" | "completed";

type PromptPipelineStageSummary = {
	status: PromptPipelineStageStatus;
	reason: string;
};

type PromptPipelineTraceSummary = {
	target: PromptPipelineTarget;
	precheck: PromptPipelineStageSummary;
	prerequisiteGeneration: PromptPipelineStageSummary;
	promptGeneration: PromptPipelineStageSummary;
	precheckSnapshot: PromptPipelinePrecheckSnapshot;
};

const HARD_FAILURE_DIAGNOSTIC_CODES = new Set<string>([
	"planning_checklist_missing",
	"planning_checklist_too_short",
	"auto_mode_agents_team_execution_missing",
	"chapter_grounded_visual_anchor_missing",
	"chapter_grounded_character_reference_missing",
	"chapter_grounded_character_state_missing",
	"chapter_grounded_character_three_view_missing",
	"chapter_grounded_scene_prop_reference_missing",
	"image_prompt_spec_v2_missing",
	"image_prompt_spec_v2_invalid",
	"image_prompt_spec_v2_reference_bindings_missing",
	"image_prompt_spec_v2_identity_constraints_missing",
	"image_prompt_spec_v2_environment_objects_missing",
	"image_prompt_spec_v2_character_continuity_missing",
	"storyboard_prompt_only_visual_delivery_missing",
]);

const AGENTS_TEAM_EXECUTION_TOOL_NAMES = new Set<string>([
	"spawn_agent",
	"send_input",
	"resume_agent",
	"mailbox_send",
	"mailbox_read",
	"protocol_request",
	"protocol_read",
	"protocol_respond",
	"protocol_get",
	"agent_workspace_import",
]);

const IMAGE_PROMPT_CONTEXT_KINDS = new Set<string>([
	"image",
	"imageedit",
	"storyboardshot",
	"storyboardimage",
	"novelstoryboard",
]);

const IMAGE_PROMPT_SPEC_NODE_KINDS = new Set<string>([
	"image",
	"imageedit",
	"storyboardshot",
	"storyboardimage",
	"novelstoryboard",
]);

const TEAM_COORDINATION_BLOCKED_MESSAGE_HINTS = [
	"已有 team 子代理尚未结束",
	"等待子代理终态后才能继续",
	"请在下一轮重新发起",
];

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

async function parseAgentsBridgeSseResponse(input: {
	response: Response;
	c: AppContext;
	onEvent?: AgentsBridgeStreamObserver;
}): Promise<AgentsBridgeChatResponse | null> {
	if (!input.response.body) {
		throw new Error("agents_bridge_stream_missing_body");
	}

	const reader = input.response.body.getReader();
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
			case "tool":
				return { event: "tool", data: payload as AgentsBridgeStreamToolCall };
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
			await handleParsedEvent(event);
		}
		return finalResponse;
	} finally {
		reader.releaseLock();
	}
}

function extractCanvasPlanPayload(text: string): string {
	const match = text.match(
		new RegExp(`<${CANVAS_PLAN_TAG_NAME}>([\\s\\S]*?)</${CANVAS_PLAN_TAG_NAME}>`, "i"),
	);
	return match ? String(match[1] || "").trim() : "";
}

function detectCanvasPlanTagName(text: string): string {
	const matches = Array.from(
		text.matchAll(/<\s*\/?\s*([a-z][a-z0-9_]*)\s*>/gi),
	);
	for (const match of matches) {
		const tagName = String(match[1] || "").trim();
		if (!tagName || tagName.toLowerCase() === CANVAS_PLAN_TAG_NAME.toLowerCase()) continue;
		if (tagName.toLowerCase().endsWith("canvas_plan")) {
			return tagName;
		}
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

function valueHasGeneratedAssetUrl(value: unknown, currentKey = ""): boolean {
	if (typeof value === "string") {
		return GENERATED_ASSET_URL_KEYS.has(currentKey) && /^https?:\/\//i.test(value.trim());
	}
	if (Array.isArray(value)) {
		return value.some((item) => valueHasGeneratedAssetUrl(item, currentKey));
	}
	if (!value || typeof value !== "object") return false;
	return Object.entries(value).some(([key, entryValue]) => {
		if (typeof entryValue === "string") {
			return GENERATED_ASSET_URL_KEYS.has(key) && /^https?:\/\//i.test(entryValue.trim());
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
	if (!/^https?:\/\//i.test(directUrlRaw)) return false;
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
		.map((call) => (typeof call.name === "string" ? call.name.trim() : ""))
		.filter(Boolean);
	const uniqueNames = Array.from(new Set(names));
	const hasSuccessfulTool = (name: string): boolean =>
		toolCalls.some((call) => call.name === name && call.status === "succeeded");
	const readProjectState =
		hasSuccessfulTool("tapcanvas_project_flows_list") ||
		hasSuccessfulTool("tapcanvas_canvas_workflow_analyze") ||
		hasSuccessfulTool("tapcanvas_flow_get") ||
		hasSuccessfulTool("tapcanvas_flow_patch");
	const readBookList = hasSuccessfulTool("tapcanvas_books_list");
	const readBookIndex = hasSuccessfulTool("tapcanvas_book_index_get");
	const readChapter = hasSuccessfulTool("tapcanvas_book_chapter_get");
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

function hasSuccessfulRequestedAgentType(
	toolCalls: BridgeToolCall[],
	...agentTypes: string[]
): boolean {
	const expected = new Set(
		agentTypes.map((item) => String(item || "").trim()).filter(Boolean),
	);
	if (expected.size === 0) return false;
	return toolCalls.some((call) => {
		if (call.status !== "succeeded") return false;
		if (expected.has(call.requestedAgentType)) return true;
		const outputAgentType =
			typeof call.outputJson?.agentType === "string"
				? String(call.outputJson.agentType).trim()
				: "";
		return Boolean(outputAgentType) && expected.has(outputAgentType);
	});
}

function resolvePromptPipelineTarget(input: {
	selectedNodeKind: string | null;
	selectedReferenceKind: string | null;
	referenceImageCount: number;
}): PromptPipelineTarget {
	if (
		input.referenceImageCount > 0 ||
		isImagePromptContextKind(input.selectedNodeKind) ||
		isImagePromptContextKind(input.selectedReferenceKind) ||
		normalizeComparableKind(input.selectedReferenceKind) === "composevideo" ||
		normalizeComparableKind(input.selectedReferenceKind) === "video"
	) {
		return "visual_generation";
	}
	return "general_chat";
}

function buildPromptPipelinePrecheckSnapshot(input: {
	target: PromptPipelineTarget;
	mentionRoleInjection: {
		mentions: string[];
		matched: Array<{ roleNameKey: string }>;
		missing: string[];
		ambiguous: string[];
		referenceImages: string[];
	};
	chapterContinuityInjection: {
		tailFrameUrl: string | null;
		roleNameKeys: string[];
		referenceImages: string[];
	};
	generationGate: PublicAgentsGenerationGate;
	mergedReferenceImages: string[];
}): PromptPipelinePrecheckSnapshot {
	return {
		target: input.target,
		roleMentionCount: input.mentionRoleInjection.mentions.length,
		matchedRoleCardCount: input.mentionRoleInjection.matched.length,
		missingRoleCardCount: input.mentionRoleInjection.missing.length,
		ambiguousRoleCardCount: input.mentionRoleInjection.ambiguous.length,
		chapterRoleCardInjectedCount: input.chapterContinuityInjection.roleNameKeys.length,
		continuityTailFrameFound: Boolean(input.chapterContinuityInjection.tailFrameUrl),
		autoReferenceImageCount: input.mergedReferenceImages.length,
		generationGateActive: input.generationGate.active,
		directGenerationReady: input.generationGate.directGenerationReady,
		generationGateReason: input.generationGate.reason,
	};
}

function buildPromptPipelineTraceSummary(input: {
	target: PromptPipelineTarget;
	precheckSnapshot: PromptPipelinePrecheckSnapshot;
	toolEvidence: BridgeToolEvidence;
	toolCalls: BridgeToolCall[];
	text: string;
	assetCount: number;
	canvasPlanDiagnostics: CanvasPlanDiagnostics;
}): PromptPipelineTraceSummary {
	const hasPrecheckEvidence =
		input.toolEvidence.readProjectState ||
		input.toolEvidence.readBookList ||
		input.toolEvidence.readBookIndex ||
		input.toolEvidence.readChapter ||
		input.toolEvidence.readStoryboardPlan ||
		input.toolEvidence.readStoryboardContinuity ||
		input.toolEvidence.readStoryboardSourceBundle ||
		input.toolEvidence.readNodeContextBundle ||
		input.toolEvidence.readVideoReviewBundle ||
		input.toolEvidence.readMaterialAssets;
	const promptGenerationDelivered =
		Boolean(input.text.trim()) ||
		input.assetCount > 0 ||
		input.toolEvidence.wroteCanvas ||
		(input.canvasPlanDiagnostics.parseSuccess === true &&
			input.canvasPlanDiagnostics.nodeCount > 0) ||
		hasSuccessfulRequestedAgentType(
			input.toolCalls,
			"image_prompt_specialist",
			"video_prompt_specialist",
			"pacing_reviewer",
		);
	const prerequisiteNeeded =
		input.target === "visual_generation" &&
		(!input.precheckSnapshot.directGenerationReady ||
			input.precheckSnapshot.matchedRoleCardCount > 0 ||
			input.precheckSnapshot.chapterRoleCardInjectedCount > 0 ||
			input.precheckSnapshot.continuityTailFrameFound);
	const prerequisiteCompleted =
		input.precheckSnapshot.directGenerationReady &&
		(input.precheckSnapshot.matchedRoleCardCount > 0 ||
			input.precheckSnapshot.chapterRoleCardInjectedCount > 0 ||
			input.precheckSnapshot.continuityTailFrameFound ||
			input.precheckSnapshot.autoReferenceImageCount > 0);
	return {
		target: input.target,
		precheck: {
			status:
				input.target === "general_chat"
					? "not_needed"
					: hasPrecheckEvidence
						? "completed"
						: "pending",
			reason:
				input.target === "general_chat"
					? "general_chat_without_project_precheck"
					: hasPrecheckEvidence
						? "project_or_storyboard_evidence_read"
						: "no_runtime_evidence_read",
		},
		prerequisiteGeneration: {
			status: !prerequisiteNeeded
				? "not_needed"
				: prerequisiteCompleted
					? "completed"
					: "pending",
			reason: !prerequisiteNeeded
				? "no_prerequisite_assets_required"
				: prerequisiteCompleted
					? "preflight_assets_or_anchors_available"
					: input.precheckSnapshot.generationGateReason,
		},
		promptGeneration: {
			status: input.target === "general_chat"
				? "not_needed"
				: promptGenerationDelivered
					? "completed"
					: "pending",
			reason: input.target === "general_chat"
				? "general_chat_without_visual_prompt_pipeline"
				: promptGenerationDelivered
					? "prompt_or_canvas_result_delivered"
					: "no_prompt_generation_result",
		},
		precheckSnapshot: input.precheckSnapshot,
	};
}

function buildPromptPipelineRequestSummary(input: {
	target: PromptPipelineTarget;
	precheckSnapshot: PromptPipelinePrecheckSnapshot;
}): PromptPipelineTraceSummary {
	const prerequisiteNeeded =
		input.target === "visual_generation" &&
		(!input.precheckSnapshot.directGenerationReady ||
			input.precheckSnapshot.matchedRoleCardCount > 0 ||
			input.precheckSnapshot.chapterRoleCardInjectedCount > 0 ||
			input.precheckSnapshot.continuityTailFrameFound);
	const prerequisiteCompleted =
		input.precheckSnapshot.directGenerationReady &&
		(input.precheckSnapshot.matchedRoleCardCount > 0 ||
			input.precheckSnapshot.chapterRoleCardInjectedCount > 0 ||
			input.precheckSnapshot.continuityTailFrameFound ||
			input.precheckSnapshot.autoReferenceImageCount > 0);
	return {
		target: input.target,
		precheck: {
			status: input.target === "general_chat" ? "not_needed" : "completed",
			reason:
				input.target === "general_chat"
					? "general_chat_without_project_precheck"
					: "bridge_context_collected",
		},
		prerequisiteGeneration: {
			status: !prerequisiteNeeded
				? "not_needed"
				: prerequisiteCompleted
					? "completed"
					: "pending",
			reason: !prerequisiteNeeded
				? "no_prerequisite_assets_required"
				: prerequisiteCompleted
					? "preflight_assets_or_anchors_available"
					: input.precheckSnapshot.generationGateReason,
		},
		promptGeneration: {
			status: input.target === "general_chat" ? "not_needed" : "pending",
			reason:
				input.target === "general_chat"
					? "general_chat_without_visual_prompt_pipeline"
					: "awaiting_agents_execution",
		},
		precheckSnapshot: input.precheckSnapshot,
	};
}

function normalizeBridgeToolCalls(toolCalls: Array<Record<string, unknown>>): BridgeToolCall[] {
	return toolCalls.map((call) => {
		const toolCallId = typeof call.toolCallId === "string" ? call.toolCallId.trim() : "";
		const name = typeof call.name === "string" ? call.name.trim() : "";
		const status = typeof call.status === "string" ? call.status.trim() : "";
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
		return {
			toolCallId,
			name,
			status:
				status === "succeeded" || status === "failed" || status === "denied" || status === "blocked"
					? status
					: "",
			pathHint,
			errorMessage,
			outputPreview,
			outputChars,
			outputHead,
			outputTail,
			outputJson,
			inputJson,
			requestedAgentType,
		};
	});
}

function truncateExecutionTraceString(value: unknown, maxLength = EXECUTION_TRACE_STRING_LIMIT): string {
	const text = typeof value === "string" ? value.trim() : String(value ?? "").trim();
	if (!text) return "";
	return text.length > maxLength ? `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…` : text;
}

function sanitizeExecutionTraceValue(value: unknown, depth = 0): unknown {
	if (typeof value === "string") {
		return truncateExecutionTraceString(value);
	}
	if (
		typeof value === "number" ||
		typeof value === "boolean" ||
		value === null ||
		typeof value === "undefined"
	) {
		return value ?? null;
	}
	if (depth >= 3) {
		if (Array.isArray(value)) {
			return `[array:${value.length}]`;
		}
		if (value && typeof value === "object") {
			return `[object:${Object.keys(value as Record<string, unknown>).length}]`;
		}
		return truncateExecutionTraceString(value);
	}
	if (Array.isArray(value)) {
		return value
			.slice(0, EXECUTION_TRACE_ARRAY_LIMIT)
			.map((item) => sanitizeExecutionTraceValue(item, depth + 1));
	}
	if (value && typeof value === "object") {
		const out: Record<string, unknown> = {};
		for (const [key, entryValue] of Object.entries(value as Record<string, unknown>).slice(
			0,
			EXECUTION_TRACE_OBJECT_KEY_LIMIT,
		)) {
			out[key] = sanitizeExecutionTraceValue(entryValue, depth + 1);
		}
		return out;
	}
	return truncateExecutionTraceString(value);
}

function buildExecutionTraceToolCallSummary(toolCalls: BridgeToolCall[]): Array<Record<string, unknown>> {
	return toolCalls.slice(0, EXECUTION_TRACE_TOOL_CALL_LIMIT).map((toolCall) => ({
		toolCallId: toolCall.toolCallId,
		name: toolCall.name,
		status: toolCall.status,
		...(toolCall.pathHint ? { pathHint: truncateExecutionTraceString(toolCall.pathHint, 240) } : {}),
		...(toolCall.requestedAgentType
			? { requestedAgentType: truncateExecutionTraceString(toolCall.requestedAgentType, 120) }
			: {}),
		...(toolCall.errorMessage
			? { errorMessage: truncateExecutionTraceString(toolCall.errorMessage, 320) }
			: {}),
		...(toolCall.outputPreview
			? { outputPreview: truncateExecutionTraceString(toolCall.outputPreview, 320) }
			: {}),
		...(typeof toolCall.outputChars === "number" ? { outputChars: toolCall.outputChars } : {}),
		...(toolCall.outputHead ? { outputHead: truncateExecutionTraceString(toolCall.outputHead, 320) } : {}),
		...(toolCall.outputTail ? { outputTail: truncateExecutionTraceString(toolCall.outputTail, 320) } : {}),
		...(toolCall.inputJson ? { input: sanitizeExecutionTraceValue(toolCall.inputJson) } : {}),
		...(toolCall.outputJson ? { outputJson: sanitizeExecutionTraceValue(toolCall.outputJson) } : {}),
	}));
}

function readCanonicalBridgeToolOutputJson(toolCall: BridgeToolCall): Record<string, unknown> | null {
	if (toolCall.outputJson) return toolCall.outputJson;
	// outputPreview is a log surface only; completion / verdict authority must never
	// infer structured tool facts from preview text.
	return null;
}

function isTeamCoordinationBlockedToolCall(toolCall: BridgeToolCall): boolean {
	if (toolCall.status !== "blocked") return false;
	const diagnosticText = [toolCall.errorMessage, toolCall.outputPreview]
		.map((item) => item.trim())
		.filter(Boolean)
		.join("\n");
	if (!diagnosticText) return false;
	return TEAM_COORDINATION_BLOCKED_MESSAGE_HINTS.every((hint) => diagnosticText.includes(hint));
}

function isExecutionPlanningBlockedToolCall(toolCall: BridgeToolCall): boolean {
	if (toolCall.status !== "blocked") return false;
	const diagnosticText = [toolCall.errorMessage, toolCall.outputPreview]
		.map((item) => item.trim())
		.filter(Boolean)
		.join("\n");
	if (!diagnosticText) return false;
	return (
		diagnosticText.includes("Execution planning required before") ||
		diagnosticText.includes("当前回合要求 checklist-first")
	);
}

function summarizeBridgeToolExecutionIssues(input: {
	toolCalls: BridgeToolCall[];
	toolStatusSummary: ToolStatusSummary;
}): ToolExecutionIssueSummary {
	const failedToolCalls =
		typeof input.toolStatusSummary.failedToolCalls === "number" ? input.toolStatusSummary.failedToolCalls : 0;
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
	return {
		failedToolCalls,
		deniedToolCalls,
		blockedToolCalls,
		coordinationBlockedToolCalls,
		actionableBlockedToolCalls,
		hasExecutionIssues:
			failedToolCalls > 0 || deniedToolCalls > 0 || actionableBlockedToolCalls > 0,
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeAgentsRuntimeTraceSummary(value: unknown): AgentsRuntimeTraceSummary | null {
	if (!isRecord(value)) return null;
	const profileRaw = typeof value.profile === "string" ? value.profile.trim() : "";
	const profile =
		profileRaw === "general" || profileRaw === "code" ? profileRaw : "unknown";
	return {
		profile,
		registeredToolNames: readTrimmedStringArray(value.registeredToolNames).slice(0, 256),
		registeredTeamToolNames: readTrimmedStringArray(value.registeredTeamToolNames).slice(0, 64),
		requiredSkills: readTrimmedStringArray(value.requiredSkills).slice(0, 32),
		loadedSkills: readTrimmedStringArray(value.loadedSkills).slice(0, 64),
		allowedSubagentTypes: readTrimmedStringArray(value.allowedSubagentTypes).slice(0, 16),
		requireAgentsTeamExecution: value.requireAgentsTeamExecution === true,
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
	if (!isRecord(value)) return null;
	const sourceRaw = typeof value.source === "string" ? value.source.trim() : "";
	const terminalRaw = typeof value.terminal === "string" ? value.terminal.trim() : "";
	return {
		source:
			sourceRaw === "deterministic" || sourceRaw === "final_self_check"
				? sourceRaw
				: "unknown",
		terminal:
			terminalRaw === "success" ||
			terminalRaw === "explicit_failure" ||
			terminalRaw === "blocked"
				? terminalRaw
				: "unknown",
		allowFinish: value.allowFinish === true,
		failureReason:
			typeof value.failureReason === "string" && value.failureReason.trim()
				? value.failureReason.trim()
				: null,
		rationale: typeof value.rationale === "string" ? value.rationale.trim() : "",
		successCriteria: readTrimmedStringArray(value.successCriteria).slice(0, 16),
		missingCriteria: readTrimmedStringArray(value.missingCriteria).slice(0, 16),
		requiredActions: readTrimmedStringArray(value.requiredActions).slice(0, 16),
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
		source: sourceRaw === "todo_list" ? "todo_list" : "unknown",
		planningRequired: value.planningRequired === true,
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

function tryParseStructuredJsonRecord(text: string): Record<string, unknown> | null {
	const trimmed = text.trim();
	if (!trimmed) return null;
	if (
		(!trimmed.startsWith("{") || !trimmed.endsWith("}")) &&
		(!trimmed.startsWith("[") || !trimmed.endsWith("]"))
	) {
		return null;
	}
	try {
		const parsed = JSON.parse(trimmed) as unknown;
		return isRecord(parsed) ? parsed : null;
	} catch {
		return null;
	}
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
		"mustStop" in record;
	if (!hasTaskInterrogationShape) return null;
	const deliveryContractRaw = asRecord(record.deliveryContract);
	const deliveryContractKind = readTrimmedString(deliveryContractRaw?.kind);
	const normalizedDeliveryContractKind =
		deliveryContractKind === "generic_execution" ||
		deliveryContractKind === "single_baseframe_preproduction" ||
		deliveryContractKind === "chapter_asset_preproduction" ||
		deliveryContractKind === "chapter_multishot_stills" ||
		deliveryContractKind === "video_followup"
			? (deliveryContractKind as Exclude<PublicChatExpectedDeliveryKind, "none">)
			: null;
	const deliveryContractMinStillCountRaw = Number(deliveryContractRaw?.minStillCount);
	const normalizedDeliveryContractMinStillCount =
		Number.isFinite(deliveryContractMinStillCountRaw) && deliveryContractMinStillCountRaw > 0
			? Math.max(1, Math.trunc(deliveryContractMinStillCountRaw))
			: null;
	return {
		taskGoal,
		requestedOutput,
		taskKind,
		recommendedNextStage,
		mustStop: record.mustStop === true,
		blockingGaps,
		successCriteria,
		...(normalizedDeliveryContractKind
			? {
					deliveryContract: {
						kind: normalizedDeliveryContractKind,
						...(normalizedDeliveryContractMinStillCount
							? { minStillCount: normalizedDeliveryContractMinStillCount }
							: {}),
					},
			  }
			: {}),
	};
}

function normalizeAgentsSemanticTaskSummaryFromText(text: string): AgentsSemanticTaskSummary | null {
	const parsed = tryParseStructuredJsonRecord(text);
	if (!parsed) return null;
	return normalizeAgentsSemanticTaskSummaryFromRecord(parsed);
}

function normalizeAgentsSemanticTaskSummaryFromToolCalls(
	toolCalls: BridgeToolCall[],
): AgentsSemanticTaskSummary | null {
	for (const toolCall of toolCalls) {
		if (toolCall.status !== "succeeded") continue;
		const parsed = readCanonicalBridgeToolOutputJson(toolCall);
		if (!parsed) continue;
		const direct = normalizeAgentsSemanticTaskSummaryFromRecord(parsed);
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

function parsePromptPayloadFieldValue(raw: string): unknown {
	const trimmed = raw.trim();
	if (!trimmed) return "";
	if (
		(trimmed.startsWith("{") && trimmed.endsWith("}")) ||
		(trimmed.startsWith("[") && trimmed.endsWith("]"))
	) {
		try {
			return JSON.parse(trimmed) as unknown;
		} catch {
			return trimmed;
		}
	}
	return trimmed;
}

function extractStructuredPromptPayloadFromText(text: string): Record<string, unknown> | null {
	const parsedJson = tryParseStructuredJsonRecord(text);
	if (parsedJson) return parsedJson;
	const fieldNames = [
		"imagePrompt",
		"structuredPrompt",
		"imagePromptSpecV2",
		"prompt",
		"storyBeatPlan",
		"videoPrompt",
	];
	const record: Record<string, unknown> = {};
	const normalizedText = text.replace(/\r/g, "");
	const labelPattern = new RegExp(`^\\s*(${fieldNames.join("|")}):\\s*(.*)$`);
	let activeKey: string | null = null;
	let activeLines: string[] = [];

	const flushActiveField = () => {
		if (!activeKey) return;
		record[activeKey] = parsePromptPayloadFieldValue(activeLines.join("\n"));
		activeKey = null;
		activeLines = [];
	};

	for (const line of normalizedText.split("\n")) {
		const match = line.match(labelPattern);
		if (match) {
			flushActiveField();
			activeKey = String(match[1] || "").trim() || null;
			const initialValue = String(match[2] || "");
			activeLines = initialValue ? [initialValue] : [];
			continue;
		}
		if (activeKey) activeLines.push(line);
	}
	flushActiveField();
	return Object.keys(record).length > 0 ? record : null;
}

function isAgentsTeamExecutionToolCall(toolCall: BridgeToolCall): boolean {
	if (toolCall.status !== "succeeded") return false;
	const normalizedName = toolCall.name.trim().toLowerCase();
	if (!normalizedName) return false;
	if (normalizedName === "task") {
		const outputJson = readCanonicalBridgeToolOutputJson(toolCall);
		const outputAgentType =
			typeof outputJson?.agentType === "string" ? outputJson.agentType.trim() : "";
		return Boolean(toolCall.requestedAgentType.trim() || outputAgentType);
	}
	return AGENTS_TEAM_EXECUTION_TOOL_NAMES.has(normalizedName);
}

function buildAgentsTeamExecutionSummary(input: {
	toolCalls: BridgeToolCall[];
}): AgentsTeamExecutionSummary {
	const summary: AgentsTeamExecutionSummary = {
		active: false,
		sourceHints: [],
		hasExecutionEvidence: false,
	};
	for (const toolCall of input.toolCalls) {
		if (!isAgentsTeamExecutionToolCall(toolCall)) continue;
		summary.active = true;
		summary.hasExecutionEvidence = true;
		const sourceHint = toolCall.name.trim() || "unknown";
		if (!summary.sourceHints.includes(sourceHint)) {
			summary.sourceHints.push(sourceHint);
		}
	}
	return summary;
}

function hasVideoPromptGovernanceShape(record: Record<string, unknown>): boolean {
	return (
		(typeof record.prompt === "string" && record.prompt.trim().length > 0) ||
		(typeof record.videoPrompt === "string" && record.videoPrompt.trim().length > 0) ||
		Array.isArray(record.storyBeatPlan)
	);
}

function isPlaceholderVideoPromptRecord(record: Record<string, unknown>): boolean {
	const status = typeof record.status === "string" ? record.status.trim().toLowerCase() : "";
	return status === "error";
}

function applyVideoPromptGovernanceRecord(
	summary: VideoPromptGovernanceSummary,
	record: Record<string, unknown>,
	sourceHint: string,
): void {
	if (isPlaceholderVideoPromptRecord(record)) return;
	if (!summary.sourceHints.includes(sourceHint)) summary.sourceHints.push(sourceHint);
	const hasExecutablePrompt =
		typeof record.prompt === "string" && record.prompt.trim().length > 0;
	const usesDeprecatedVideoPromptField =
		typeof record.videoPrompt === "string" && record.videoPrompt.trim().length > 0;
	summary.active = true;
	summary.hasExecutablePrompt = summary.hasExecutablePrompt || hasExecutablePrompt;
	summary.usesDeprecatedVideoPromptField =
		summary.usesDeprecatedVideoPromptField || usesDeprecatedVideoPromptField;
}

function buildVideoPromptGovernanceSummary(input: {
	text: string;
	canvasPlanDiagnostics: CanvasPlanDiagnostics;
}): VideoPromptGovernanceSummary {
	const summary: VideoPromptGovernanceSummary = {
		active: false,
		sourceHints: [],
		hasExecutablePrompt: false,
		usesDeprecatedVideoPromptField: false,
	};
	const textPayload = extractStructuredPromptPayloadFromText(input.text);
	if (textPayload && hasVideoPromptGovernanceShape(textPayload)) {
		applyVideoPromptGovernanceRecord(summary, textPayload, "final_text_payload");
	}
	if (input.canvasPlanDiagnostics.parseSuccess && input.canvasPlanDiagnostics.rawPayload) {
		try {
			const parsed = JSON.parse(input.canvasPlanDiagnostics.rawPayload) as unknown;
			if (isRecord(parsed) && Array.isArray(parsed.nodes)) {
				for (const node of parsed.nodes) {
					if (!isRecord(node)) continue;
					const kind = typeof node.kind === "string" ? node.kind.trim() : "";
					if (kind !== "composeVideo" && kind !== "video") continue;
					const config = isRecord(node.config) ? node.config : null;
					if (!config) continue;
					applyVideoPromptGovernanceRecord(summary, config, "canvas_plan_video_node");
				}
			}
		} catch {
			// canvas plan parse errors are already captured elsewhere
		}
	}
	return summary;
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

function isImagePromptContextKind(value: unknown): boolean {
	return IMAGE_PROMPT_CONTEXT_KINDS.has(normalizeComparableKind(value));
}

function isImagePromptSpecNodeKind(kind: string): boolean {
	return IMAGE_PROMPT_SPEC_NODE_KINDS.has(kind);
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

function hasVideoOnlyPayloadSignals(record: Record<string, unknown>): boolean {
	return (
		Array.isArray(record.storyBeatPlan) ||
		(typeof record.videoPrompt === "string" && record.videoPrompt.trim().length > 0)
	);
}

function isLikelyImagePromptTextPayload(input: {
	record: Record<string, unknown>;
	likelyImageContext: boolean;
}): boolean {
	if (
		typeof input.record.imagePrompt === "string" &&
		input.record.imagePrompt.trim().length > 0
	) {
		return true;
	}
	if (Object.prototype.hasOwnProperty.call(input.record, "structuredPrompt")) {
		return true;
	}
	if (Object.prototype.hasOwnProperty.call(input.record, "imagePromptSpecV2")) {
		return true;
	}
	if (!input.likelyImageContext) return false;
	if (hasVideoOnlyPayloadSignals(input.record)) return false;
	return typeof input.record.prompt === "string" && input.record.prompt.trim().length > 0;
}

function readValidImagePromptSpecV2(
	value: unknown,
): { ok: true; value: ImagePromptSpecV2 | null } | { ok: false; error: string } {
	const parsed = parseImagePromptSpecV2(value);
	if (!parsed.ok) return parsed;
	return parsed;
}

function readStructuredPromptField(record: Record<string, unknown>): unknown {
	if (Object.prototype.hasOwnProperty.call(record, "structuredPrompt")) {
		return record.structuredPrompt;
	}
	if (Object.prototype.hasOwnProperty.call(record, "imagePromptSpecV2")) {
		return record.imagePromptSpecV2;
	}
	return undefined;
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

type ImagePromptSpecAnchorSummary = {
	hasReferenceAnchors: boolean;
	hasCharacterAnchors: boolean;
	hasEnvironmentAnchors: boolean;
	characterStateEvidenceCount: number;
};

function summarizeImagePromptSpecAnchors(assetInputs: AgentsBridgeAssetInput[]): ImagePromptSpecAnchorSummary {
	let hasCharacterAnchors = false;
	let hasEnvironmentAnchors = false;
	let characterStateEvidenceCount = 0;
	for (const item of assetInputs) {
		if (item.role === "character") {
			hasCharacterAnchors = true;
			const parsed = parseCharacterContinuityNote(String(item.note || ""));
			if (parsed.age || parsed.state || parsed.stateLabel || parsed.stateKey) {
				characterStateEvidenceCount += 1;
			}
			continue;
		}
		hasEnvironmentAnchors = true;
	}
	return {
		hasReferenceAnchors: assetInputs.length > 0,
		hasCharacterAnchors,
		hasEnvironmentAnchors,
		characterStateEvidenceCount,
	};
}

function readRecordAssetInputs(record: Record<string, unknown>): AgentsBridgeAssetInput[] {
	if (!Array.isArray(record.assetInputs)) return [];
	return normalizeAgentsBridgeAssetInputs(record.assetInputs);
}

function resolveImagePromptSpecAnchorSummary(input: {
	record: Record<string, unknown>;
	sourceHint: string;
	requestAnchorSummary: ImagePromptSpecAnchorSummary;
}): ImagePromptSpecAnchorSummary {
	const localAssetInputs = readRecordAssetInputs(input.record);
	const hasReferenceImages =
		Array.isArray(input.record.referenceImages) &&
		input.record.referenceImages.some((item) => typeof item === "string" && item.trim().length > 0);
	if (localAssetInputs.length === 0 && !hasReferenceImages) {
		return input.sourceHint === "final_text_payload"
			? input.requestAnchorSummary
			: {
				hasReferenceAnchors: false,
				hasCharacterAnchors: false,
				hasEnvironmentAnchors: false,
				characterStateEvidenceCount: 0,
			};
	}
	const localSummary = summarizeImagePromptSpecAnchors(localAssetInputs);
	return {
		hasReferenceAnchors: localSummary.hasReferenceAnchors || hasReferenceImages,
		hasCharacterAnchors: localSummary.hasCharacterAnchors,
		hasEnvironmentAnchors: localSummary.hasEnvironmentAnchors,
		characterStateEvidenceCount: localSummary.characterStateEvidenceCount,
	};
}

function applyImagePromptSpecGovernanceRecord(
	summary: ImagePromptSpecGovernanceSummary,
	record: Record<string, unknown>,
	sourceHint: string,
	requestAnchorSummary: ImagePromptSpecAnchorSummary,
): void {
	summary.active = true;
	summary.chapterGroundedTargetCount += 1;
	if (!summary.sourceHints.includes(sourceHint)) summary.sourceHints.push(sourceHint);
	const structuredPrompt = readStructuredPromptField(record);
	if (typeof structuredPrompt === "undefined") {
		summary.missingSpecCount += 1;
		return;
	}
	const parsed = readValidImagePromptSpecV2(structuredPrompt);
	if (!parsed.ok || !parsed.value) {
		summary.invalidSpecCount += 1;
		return;
	}
	summary.validSpecCount += 1;
	const anchorSummary = resolveImagePromptSpecAnchorSummary({
		record,
		sourceHint,
		requestAnchorSummary,
	});
	if (anchorSummary.hasReferenceAnchors && parsed.value.referenceBindings.length <= 0) {
		summary.missingReferenceBindingsCount += 1;
	}
	if (anchorSummary.hasCharacterAnchors && parsed.value.identityConstraints.length <= 0) {
		summary.missingIdentityConstraintsCount += 1;
	}
	if (anchorSummary.hasEnvironmentAnchors && parsed.value.environmentObjects.length <= 0) {
		summary.missingEnvironmentObjectsCount += 1;
	}
	if (
		anchorSummary.characterStateEvidenceCount > 0 &&
		parsed.value.continuityConstraints.length <= 0
	) {
		summary.missingCharacterContinuityCount += 1;
	}
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

function buildPublicChatDeliveryEvidence(input: {
	assets: Array<{ type: "image" | "video"; url: string; thumbnailUrl?: string }>;
	toolEvidence: BridgeToolEvidence;
	chapterGroundedVisualPreproduction: ChapterGroundedVisualPreproductionSummary;
	toolCalls: BridgeToolCall[];
}): PublicChatDeliveryEvidence {
	const imageAssetCount = input.assets.filter((asset) => asset.type === "image").length;
	const videoAssetCount = input.assets.filter((asset) => asset.type === "video").length;
	const storyboardPlanPersistenceCount = input.toolCalls.filter(
		(toolCall) =>
			toolCall.name === "tapcanvas_book_storyboard_plan_upsert" &&
			toolCall.status === "succeeded",
	).length;
	return {
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
	};
}

function recordHasPersistedReferenceBinding(record: Record<string, unknown>): boolean {
	const hasReferenceImages =
		Array.isArray(record.referenceImages) &&
		record.referenceImages.some((item) => typeof item === "string" && item.trim().length > 0);
	if (hasReferenceImages) return true;
	return (
		Array.isArray(record.assetInputs) &&
		record.assetInputs.some((item) => {
			if (!isRecord(item)) return false;
			return typeof item.url === "string" && item.url.trim().length > 0;
		})
	);
}

function recordHasPersistedCharacterBinding(record: Record<string, unknown>): boolean {
	if (!Array.isArray(record.assetInputs)) return false;
	return record.assetInputs.some((item) => {
		if (!isRecord(item)) return false;
		const role = normalizeComparableKind(item.role);
		const hasUrl = typeof item.url === "string" && item.url.trim().length > 0;
		return hasUrl && role === "character";
	});
}

function buildCreatedEdgeTargetsBySource(input: {
	toolCalls: BridgeToolCall[];
}): Map<string, Set<string>> {
	const targetsBySource = new Map<string, Set<string>>();
	for (const toolCall of input.toolCalls) {
		if (
			toolCall.name !== "tapcanvas_flow_patch" ||
			toolCall.status !== "succeeded" ||
			!toolCall.inputJson
		) {
			continue;
		}
		const createEdges = Array.isArray(toolCall.inputJson.createEdges)
			? toolCall.inputJson.createEdges
			: [];
		for (const edge of createEdges) {
			if (!isRecord(edge)) continue;
			const source = typeof edge.source === "string" ? edge.source.trim() : "";
			const target = typeof edge.target === "string" ? edge.target.trim() : "";
			if (!source || !target) continue;
			const existing = targetsBySource.get(source) || new Set<string>();
			existing.add(target);
			targetsBySource.set(source, existing);
		}
	}
	return targetsBySource;
}

function isRejectedChapterGroundedVisualRecord(record: Record<string, unknown>): boolean {
	return normalizeComparableKind(record.approvalStatus) === "rejected";
}

function collectInBatchAuthoritySourceNodeIds(
	nodeStates: Map<string, FlowPatchNodeFinalState>,
): Set<string> {
	const authorityNodeIds = new Set<string>();
	for (const state of nodeStates.values()) {
		if (!state.kind || !isChapterGroundedVisualNodeKind(state.kind)) continue;
		if (!hasChapterGroundedVisualTraceability(state.data)) continue;
		if (isRejectedChapterGroundedVisualRecord(state.data)) continue;
		if (isVideoLikeNodeKind(state.kind)) continue;
		const authorityStatus = readChapterGroundedAuthorityBaseFrameStatus(state.data);
		if (authorityStatus === "planned" || authorityStatus === "confirmed") {
			authorityNodeIds.add(state.id);
		}
	}
	return authorityNodeIds;
}

function buildChapterGroundedReferenceBindingSummary(input: {
	toolCalls: BridgeToolCall[];
	selectedNodeKind: string | null;
	selectedReference: AgentsBridgeChatContext["selectedReference"];
	referenceImagesCount: number;
	assetInputsCount: number;
}): ChapterGroundedReferenceBindingSummary {
	const summary: ChapterGroundedReferenceBindingSummary = {
		active: false,
		targetNodeCount: 0,
		missingBindingCount: 0,
		missingCharacterBindingCount: 0,
	};
	const hasRuntimeReferenceAnchors =
		input.referenceImagesCount > 0 || input.assetInputsCount > 0;
	const hasExplicitSelectedReference = Boolean(
		input.selectedReference?.nodeId?.trim() ||
			input.selectedReference?.imageUrl?.trim() ||
			input.selectedReference?.authorityBaseFrameNodeId?.trim() ||
			input.selectedReference?.roleName?.trim() ||
			input.selectedReference?.roleCardId?.trim(),
	);
	const requiresReferenceBinding = hasRuntimeReferenceAnchors || hasExplicitSelectedReference;
	if (!requiresReferenceBinding) return summary;
	const requiresCharacterBinding = Boolean(
		input.selectedReference?.roleName?.trim() || input.selectedReference?.roleCardId?.trim(),
	);
	const targetsBySource = buildCreatedEdgeTargetsBySource({
		toolCalls: input.toolCalls,
	});
	const explicitAuthoritySourceNodeIds = [
		input.selectedReference?.nodeId?.trim() || "",
		input.selectedReference?.authorityBaseFrameNodeId?.trim() || "",
	].filter(Boolean);
	const nodeStates = buildFlowPatchNodeFinalStates({
		toolCalls: input.toolCalls,
		selectedNodeKind: input.selectedNodeKind,
	});
	const inBatchAuthoritySourceNodeIds = collectInBatchAuthoritySourceNodeIds(nodeStates);
	const authoritySourceNodeIds = Array.from(
		new Set<string>([...explicitAuthoritySourceNodeIds, ...inBatchAuthoritySourceNodeIds]),
	);
	for (const state of nodeStates.values()) {
		if (!state.kind || !isChapterGroundedVisualNodeKind(state.kind)) continue;
		if (!hasChapterGroundedVisualTraceability(state.data)) continue;
		if (isRejectedChapterGroundedVisualRecord(state.data)) continue;
		summary.active = true;
		summary.targetNodeCount += 1;
		const isInBatchAuthorityNode = inBatchAuthoritySourceNodeIds.has(state.id);
		const linkedByAuthorityEdge = authoritySourceNodeIds.some((sourceNodeId) =>
			sourceNodeId !== state.id && targetsBySource.get(sourceNodeId)?.has(state.id) === true,
		);
		if (
			!recordHasPersistedReferenceBinding(state.data) &&
			!linkedByAuthorityEdge &&
			!isInBatchAuthorityNode
		) {
			summary.missingBindingCount += 1;
		}
		if (
			requiresCharacterBinding &&
			!recordHasPersistedCharacterBinding(state.data) &&
			!linkedByAuthorityEdge
		) {
			summary.missingCharacterBindingCount += 1;
		}
	}
	return summary;
}

function buildImagePromptSpecGovernanceSummary(input: {
	text: string;
	canvasPlanDiagnostics: CanvasPlanDiagnostics;
	toolCalls: BridgeToolCall[];
	chapterGroundedPromptSpecRequired: boolean;
	likelyImageContext: boolean;
	selectedNodeKind: string | null;
	requestAssetInputs: AgentsBridgeAssetInput[];
}): ImagePromptSpecGovernanceSummary {
	const requestAnchorSummary = summarizeImagePromptSpecAnchors(input.requestAssetInputs);
	const summary: ImagePromptSpecGovernanceSummary = {
		active: false,
		sourceHints: [],
		chapterGroundedTargetCount: 0,
		validSpecCount: 0,
		missingSpecCount: 0,
		invalidSpecCount: 0,
		missingReferenceBindingsCount: 0,
		missingIdentityConstraintsCount: 0,
		missingEnvironmentObjectsCount: 0,
		missingCharacterContinuityCount: 0,
	};
	if (!input.chapterGroundedPromptSpecRequired) return summary;

	const textPayload = extractStructuredPromptPayloadFromText(input.text);
	if (
		textPayload &&
		isLikelyImagePromptTextPayload({
			record: textPayload,
			likelyImageContext: input.likelyImageContext,
		})
	) {
		applyImagePromptSpecGovernanceRecord(
			summary,
			textPayload,
			"final_text_payload",
			requestAnchorSummary,
		);
	}

	if (input.canvasPlanDiagnostics.parseSuccess && input.canvasPlanDiagnostics.rawPayload) {
		try {
			const parsed = JSON.parse(input.canvasPlanDiagnostics.rawPayload) as unknown;
			if (isRecord(parsed) && Array.isArray(parsed.nodes)) {
				for (const node of parsed.nodes) {
					if (!isRecord(node)) continue;
					const kind = normalizeComparableKind(node.kind);
					if (!isImagePromptSpecNodeKind(kind)) continue;
					const config = isRecord(node.config) ? node.config : null;
					if (!config || !hasChapterGroundedVisualTraceability(config)) continue;
					applyImagePromptSpecGovernanceRecord(
						summary,
						config,
						"canvas_plan_image_node",
						requestAnchorSummary,
					);
				}
			}
		} catch {
			// canvas plan parse errors are already captured elsewhere
		}
	}

	const nodeStates = buildFlowPatchNodeFinalStates({
		toolCalls: input.toolCalls,
		selectedNodeKind: input.selectedNodeKind,
	});
	for (const state of nodeStates.values()) {
		if (!isImagePromptSpecNodeKind(state.kind) || !hasChapterGroundedVisualTraceability(state.data)) {
			continue;
		}
		applyImagePromptSpecGovernanceRecord(
			summary,
			state.data,
			"flow_patch_final_node_state",
			requestAnchorSummary,
		);
	}

	return summary;
}

function recordHasStoryboardEditorCells(record: Record<string, unknown>): boolean {
	return Array.isArray(record.storyboardEditorCells);
}

function recordHasMaterializedStoryboardCellImages(record: Record<string, unknown>): boolean {
	if (!Array.isArray(record.storyboardEditorCells)) return false;
	return record.storyboardEditorCells.some((cell) => {
		if (!isRecord(cell)) return false;
		return typeof cell.imageUrl === "string" && cell.imageUrl.trim().length > 0;
	});
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

function recordHasStoryboardTextPayload(record: Record<string, unknown>): boolean {
	const stringKeys = [
		"content",
		"prompt",
		"text",
		"storyboard",
		"storyboardTitle",
		"storyboardNotes",
	];
	if (
		stringKeys.some((key) => typeof record[key] === "string" && String(record[key]).trim().length > 0)
	) {
		return true;
	}
	if (readTrimmedStringArray(record.storyboardShotPrompts).length > 0) return true;
	if (!Array.isArray(record.storyboardScenes)) return false;
	return record.storyboardScenes.some((scene) => {
		if (typeof scene === "string") return scene.trim().length > 0;
		if (!isRecord(scene)) return false;
		return Object.values(scene).some(
			(value) => typeof value === "string" && value.trim().length > 0,
		);
	});
}

function applyStoryboardEditorContractRecord(
	summary: StoryboardEditorContractSummary,
	record: Record<string, unknown>,
	sourceHint: string,
): void {
	summary.active = true;
	summary.hasStoryboardNodes = true;
	if (!summary.sourceHints.includes(sourceHint)) summary.sourceHints.push(sourceHint);
	const hasStoryboardEditorCells = recordHasStoryboardEditorCells(record);
	if (hasStoryboardEditorCells) summary.hasStoryboardEditorCells = true;
	if (recordHasMaterializedStoryboardCellImages(record)) {
		summary.hasMaterializedStoryboardCellImages = true;
	}
	if (recordHasStoryboardTextPayload(record) && !hasStoryboardEditorCells) {
		summary.hasTextOnlyStoryboardPayload = true;
	}
}

function buildStoryboardEditorContractSummary(input: {
	toolCalls: BridgeToolCall[];
	canvasPlanDiagnostics: CanvasPlanDiagnostics;
}): StoryboardEditorContractSummary {
	const summary: StoryboardEditorContractSummary = {
		active: false,
		sourceHints: [],
		hasStoryboardNodes: false,
		hasStoryboardEditorCells: false,
		hasMaterializedStoryboardCellImages: false,
		hasTextOnlyStoryboardPayload: false,
	};
	for (const toolCall of input.toolCalls) {
		if (toolCall.name !== "tapcanvas_flow_patch" || !toolCall.inputJson) continue;
		const createNodes = Array.isArray(toolCall.inputJson.createNodes)
			? toolCall.inputJson.createNodes
			: [];
		for (const node of createNodes) {
			if (!isRecord(node)) continue;
			const data = isRecord(node.data) ? node.data : null;
			if (!data) continue;
			const kind = typeof data.kind === "string" ? data.kind.trim().toLowerCase() : "";
			if (kind !== "storyboard") continue;
			applyStoryboardEditorContractRecord(summary, data, "flow_patch_create_node");
		}
		const patchNodeData = Array.isArray(toolCall.inputJson.patchNodeData)
			? toolCall.inputJson.patchNodeData
			: [];
		for (const patch of patchNodeData) {
			if (!isRecord(patch)) continue;
			const data = isRecord(patch.data) ? patch.data : null;
			if (!data) continue;
			const kind = typeof data.kind === "string" ? data.kind.trim().toLowerCase() : "";
			const looksStoryboardPatch =
				kind === "storyboard" ||
				"storyboardEditorCells" in data ||
				"storyboardScenes" in data ||
				"storyboardShotPrompts" in data ||
				"storyboardTitle" in data ||
				"storyboardNotes" in data;
			if (!looksStoryboardPatch) continue;
			applyStoryboardEditorContractRecord(summary, data, "flow_patch_patch_node");
		}
	}
	if (input.canvasPlanDiagnostics.parseSuccess && input.canvasPlanDiagnostics.rawPayload) {
		try {
			const parsed = JSON.parse(input.canvasPlanDiagnostics.rawPayload) as unknown;
			if (isRecord(parsed) && Array.isArray(parsed.nodes)) {
				for (const node of parsed.nodes) {
					if (!isRecord(node)) continue;
					const kind = typeof node.kind === "string" ? node.kind.trim().toLowerCase() : "";
					if (kind !== "storyboard") continue;
					const config = isRecord(node.config) ? node.config : null;
					if (!config) continue;
					applyStoryboardEditorContractRecord(summary, config, "canvas_plan_storyboard_node");
				}
			}
		} catch {
			// canvas plan parse errors are already captured elsewhere
		}
	}
	return summary;
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
			kind === "composevideo"
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

function buildDiagnosticFlags(input: {
	requestKind: string;
	text: string;
	toolEvidence: BridgeToolEvidence;
	canvasPlanDiagnostics: CanvasPlanDiagnostics;
	outputMode: AgentsBridgeOutputMode;
	toolStatusSummary: ToolStatusSummary;
	toolExecutionIssues: ToolExecutionIssueSummary;
	toolCalls: BridgeToolCall[];
	runtimeTrace: AgentsRuntimeTraceSummary | null;
	generationGate: PublicAgentsGenerationGate;
	forceAssetGeneration: boolean;
	semanticExecutionIntent: AgentsSemanticExecutionIntentSummary;
	planningTrace: AgentsPlanningTraceSummary | null;
	todoListTrace: AgentsTodoListTraceSummary | null;
	autoModeAgentsTeamRequired: boolean;
	chapterGroundedPromptSpecRequired: boolean;
	novelSingleVideoEvidenceRequired: boolean;
	autoProgressDetectionRequired: boolean;
	selectedNodeKind: string | null;
	selectedReference: AgentsBridgeChatContext["selectedReference"];
	workspaceAction:
		| "chapter_script_generation"
		| "chapter_asset_generation"
		| "shot_video_generation"
		| null;
	referenceImagesCount: number;
	assetInputsCount: number;
	requestAssetInputs: AgentsBridgeAssetInput[];
	chapterContinuityInjection: ChapterContinuityInjection;
	chapterGroundedVisualPreproduction: ChapterGroundedVisualPreproductionSummary;
}): DiagnosticFlag[] {
	const flags: DiagnosticFlag[] = [];
	const canvasPlanParsed = input.canvasPlanDiagnostics.parseSuccess === true;
	const canvasPlanTagPresent = input.canvasPlanDiagnostics.tagPresent === true;
	const canvasPlanNodeCount =
		typeof input.canvasPlanDiagnostics.nodeCount === "number" ? input.canvasPlanDiagnostics.nodeCount : 0;
	void input.requestKind;
	void input.toolEvidence;
	void input.novelSingleVideoEvidenceRequired;
	void input.autoProgressDetectionRequired;
	const chapterScriptPersistenceAction =
		input.workspaceAction === "chapter_script_generation";
	const chapterGroundedReusableAssetDeliveryRequired =
		input.chapterGroundedPromptSpecRequired &&
		!chapterScriptPersistenceAction;
	if (canvasPlanTagPresent && !canvasPlanParsed) {
		flags.push({
			code: input.canvasPlanDiagnostics.errorCode || "invalid_canvas_plan",
			severity: "medium",
			title: "画布计划无效",
			detail: input.canvasPlanDiagnostics.errorDetail || "tapcanvas_canvas_plan 无法解析或不符合 schema。",
		});
	}
	if (canvasPlanParsed && canvasPlanNodeCount <= 0) {
		flags.push({
			code: "parsed_plan_without_nodes",
			severity: "medium",
			title: "画布计划解析成功但没有节点",
			detail: "这是无效结果，前端无法创建任何节点。",
		});
	}
	if (input.toolExecutionIssues.hasExecutionIssues) {
		flags.push({
			code: "tool_execution_issues",
			severity: "medium",
			title: "存在工具执行异常",
			detail:
				`failed=${input.toolExecutionIssues.failedToolCalls}, ` +
				`denied=${input.toolExecutionIssues.deniedToolCalls}, ` +
				`blocked=${input.toolExecutionIssues.blockedToolCalls}, ` +
				`coordinationBlocked=${input.toolExecutionIssues.coordinationBlockedToolCalls}, ` +
				`actionableBlocked=${input.toolExecutionIssues.actionableBlockedToolCalls}`,
		});
	}
	const truncatedContextSources =
		input.runtimeTrace?.contextDiagnostics?.sources.filter((source) => source.truncated) ?? [];
	if (truncatedContextSources.length > 0) {
		flags.push({
			code: "agents_runtime_context_truncated",
			severity: "medium",
			title: "Agents runtime 上下文已触发预算裁剪",
			detail:
				`以下上下文来源在 agents-cli 内已按 budget 截断：${truncatedContextSources
					.map((source) => `${source.id}(${source.chars}/${source.budgetChars})`)
					.join(", ")}。` +
				"若本轮语义证据不足、遗漏约束或引用事实不完整，应优先检查这些来源是否被裁剪。",
		});
	}
	const runtimeRequiresApprovalCount =
		input.runtimeTrace?.policySummary?.requiresApprovalCount ?? 0;
	if (runtimeRequiresApprovalCount > 0) {
		flags.push({
			code: "agents_runtime_requires_approval",
			severity: "medium",
			title: "Agents runtime 存在待审批动作",
			detail:
				`policy engine 本轮标记了 ${runtimeRequiresApprovalCount} 次 requires_approval。` +
				"这表示部分工具或命令因高风险/远程本地访问约束没有被直接执行，应由上游显式审批后重试。",
		});
	}
	const runtimePolicyDenyCount = input.runtimeTrace?.policySummary?.denyCount ?? 0;
	if (runtimePolicyDenyCount > 0) {
		const deniedSignatures =
			input.runtimeTrace?.policySummary?.uniqueDeniedSignatures.slice(0, 4) ?? [];
		flags.push({
			code: "agents_runtime_policy_denials_present",
			severity: "medium",
			title: "Agents runtime 存在策略拒绝",
			detail:
				`policy engine 本轮明确拒绝了 ${runtimePolicyDenyCount} 次动作。` +
				(deniedSignatures.length > 0
					? ` 拒绝摘要：${deniedSignatures.join(" | ")}`
					: ""),
		});
	}
	const hasChecklistInProgress =
		(input.todoListTrace?.inProgressCount ?? 0) > 0 ||
		(input.todoListTrace?.pendingCount ?? 0) > 0;
	const checklistExecutionGateActive =
		input.semanticExecutionIntent.requiresExecutionDelivery || input.forceAssetGeneration;
	if (checklistExecutionGateActive && hasChecklistInProgress && input.todoListTrace) {
		flags.push({
			code: "todo_checklist_incomplete",
			severity: "medium",
			title: "Checklist 仍有未完成项",
			detail:
				`Todo 清单仍有 pending=${input.todoListTrace.pendingCount}, in_progress=${input.todoListTrace.inProgressCount}。` +
				"执行型回合在关键项未完成时不得判定为 satisfied。",
		});
	}
	const videoPromptGovernance = buildVideoPromptGovernanceSummary({
		text: input.text,
		canvasPlanDiagnostics: input.canvasPlanDiagnostics,
	});
	const imagePromptSpecGovernance = buildImagePromptSpecGovernanceSummary({
		text: input.text,
		canvasPlanDiagnostics: input.canvasPlanDiagnostics,
		toolCalls: input.toolCalls,
		chapterGroundedPromptSpecRequired: input.chapterGroundedPromptSpecRequired,
		likelyImageContext:
			isImagePromptContextKind(input.selectedNodeKind) ||
			isImagePromptContextKind(input.selectedReference?.kind),
		selectedNodeKind: input.selectedNodeKind,
		requestAssetInputs: input.requestAssetInputs,
	});
	const agentsTeamExecution = buildAgentsTeamExecutionSummary({
		toolCalls: input.toolCalls,
	});
	const storyboardEditorContract = buildStoryboardEditorContractSummary({
		toolCalls: input.toolCalls,
		canvasPlanDiagnostics: input.canvasPlanDiagnostics,
	});
	const chapterGroundedVisualPreproduction = input.chapterGroundedVisualPreproduction;
	const chapterGroundedReferenceBinding = buildChapterGroundedReferenceBindingSummary({
		toolCalls: input.toolCalls,
		selectedNodeKind: input.selectedNodeKind,
		selectedReference: input.selectedReference,
		referenceImagesCount: input.referenceImagesCount,
		assetInputsCount: input.assetInputsCount,
	});
	const runtimeTeamToolsAvailable =
		(input.runtimeTrace?.registeredTeamToolNames.length ?? 0) > 0;
	const chapterAssetRepairAction = input.workspaceAction === "chapter_asset_generation";
	const likelyChapterGroundedVisualContext =
		input.chapterGroundedPromptSpecRequired &&
		(isImagePromptContextKind(input.selectedNodeKind) ||
			isImagePromptContextKind(input.selectedReference?.kind) ||
			normalizeComparableKind(input.selectedReference?.kind) === "composevideo" ||
			normalizeComparableKind(input.selectedReference?.kind) === "video");
	if (input.autoModeAgentsTeamRequired && !agentsTeamExecution.hasExecutionEvidence) {
		flags.push({
			code: "auto_mode_agents_team_execution_missing",
			severity: "high",
			title: "AUTO 模式未真实使用 agents-team",
			detail:
				"AUTO 模式要求通过 agents-team 的真实团队工具链完成关键执行；当前 trace 未看到成功的 `spawn_agent` / `send_input` / `resume_agent` / `mailbox_*` / `protocol_*` / `agent_workspace_import` 或兼容旧链路的 `Task` 调用。仅加载 Skill 或正文自述不算完成。",
		});
		if (input.runtimeTrace?.profile === "general") {
			flags.push({
				code: "agents_runtime_general_profile",
				severity: "high",
				title: "Agents runtime 运行在 general profile",
				detail:
					"当前 agents-cli 运行在 general/nocode/chat profile，下发给模型的团队工具不会完整可用，AUTO 模式下无法满足真实 agents-team 执行约束。",
			});
		} else if (input.runtimeTrace && !runtimeTeamToolsAvailable) {
			flags.push({
				code: "agents_runtime_team_tools_missing",
				severity: "high",
				title: "Agents runtime 未暴露团队工具",
				detail:
					"runtime trace 显示当前 /chat 响应没有注册任何团队工具；请检查实际运行进程是否为最新 agents-cli 构建，以及 tool catalog 是否正确注入。",
			});
		}
	}
	if (
		likelyChapterGroundedVisualContext &&
		input.generationGate.active &&
		!input.generationGate.directGenerationReady
	) {
		const limitedToSinglePlannedBaseFrame =
			chapterGroundedVisualPreproduction.active &&
			chapterGroundedVisualPreproduction.visualNodeCount === 1 &&
			chapterGroundedVisualPreproduction.imageLikeNodeCount === 1 &&
			!chapterGroundedVisualPreproduction.hasVideoNodes &&
			!chapterGroundedVisualPreproduction.hasMaterializedVisualOutputs &&
			chapterGroundedVisualPreproduction.hasPlannedAuthorityBaseFrame &&
			!chapterGroundedVisualPreproduction.hasConfirmedAuthorityBaseFrame;
		const attemptedDirectVisualBatch =
			((input.outputMode === "direct_assets" ||
				input.outputMode === "plan_with_assets") &&
				!limitedToSinglePlannedBaseFrame) ||
			input.toolEvidence.generatedAssets ||
			chapterGroundedVisualPreproduction.hasMaterializedVisualOutputs ||
			chapterGroundedVisualPreproduction.hasVideoNodes ||
			chapterGroundedVisualPreproduction.visualNodeCount > 1 ||
			(chapterGroundedVisualPreproduction.active && !limitedToSinglePlannedBaseFrame);
		if (attemptedDirectVisualBatch) {
			flags.push({
				code: "chapter_grounded_visual_anchor_missing",
				severity: "high",
				title: "章节视觉前置锚点缺失",
				detail:
					input.generationGate.reason === "missing_visual_anchors_for_book_context"
						? "当前请求已绑定 book/chapter，但合并后的 referenceImages、assetInputs、selectedReference.imageUrl、章节角色卡与 storyboard tail frame 仍未提供任何稳定视觉锚点。缺锚点时只允许先落单张 authorityBaseFrame.status='planned' 的预生产基底帧；禁止直接批量写入多张静态帧、视频节点或已出图结果。"
						: "当前视觉请求缺少稳定视觉锚点。缺锚点时只允许先落单张 authorityBaseFrame.status='planned' 的预生产基底帧；禁止直接批量写入多张静态帧、视频节点或已出图结果。",
			});
		}
	}
	if (storyboardEditorContract.active && storyboardEditorContract.hasTextOnlyStoryboardPayload) {
		flags.push({
			code: "storyboard_editor_text_only_misuse",
			severity: "medium",
			title: "分镜编辑节点被当成文本容器",
			detail:
				"kind=storyboard 是图片网格编辑器；若本轮只有逐镜头文本而没有镜头图，应使用 storyboardScript/text，或显式提供 storyboardEditorCells 作为空白分镜板。",
		});
	}
	if (
		storyboardEditorContract.active &&
		storyboardEditorContract.hasStoryboardEditorCells &&
		!storyboardEditorContract.hasMaterializedStoryboardCellImages &&
		!input.toolEvidence.generatedAssets &&
		(input.forceAssetGeneration ||
			input.semanticExecutionIntent.requiresExecutionDelivery ||
			input.chapterGroundedPromptSpecRequired)
	) {
		flags.push({
			code: "storyboard_prompt_only_visual_delivery_missing",
			severity: "high",
			title: "分镜仅有提示词，缺少可执行视觉交付",
			detail:
				"检测到 storyboardEditorCells 仅包含 prompt 且没有 imageUrl，同时本轮也没有生成真实资产或创建 image/imageEdit/storyboardImage 等可执行图片节点。该回合不能判定为章节视觉交付完成。",
		});
	}
	if (chapterGroundedReferenceBinding.active && chapterGroundedReferenceBinding.missingBindingCount > 0) {
		flags.push({
			code: "chapter_grounded_reference_binding_missing",
			severity: "high",
			title: "章节视觉节点缺少参考绑定持久化",
			detail:
				`检测到 ${chapterGroundedReferenceBinding.missingBindingCount} 个 chapter-grounded 可视节点没有持久化 referenceImages/assetInputs，且也没有从已确认 authority 节点显式连边。已有锚点时，禁止只在 prompt 里口头声明“参考已有图片”。`,
		});
	}
	if (
		chapterGroundedReferenceBinding.active &&
		chapterGroundedReferenceBinding.missingCharacterBindingCount > 0
	) {
		flags.push({
			code: "chapter_grounded_character_binding_missing",
			severity: "high",
			title: "章节角色绑定丢失",
			detail:
				`检测到 ${chapterGroundedReferenceBinding.missingCharacterBindingCount} 个 chapter-grounded 可视节点没有保留 character 角色绑定。当前已有明确角色卡/角色名时，不允许退回默认人物描述。`,
		});
	}
	if (
		!chapterAssetRepairAction &&
		chapterGroundedReusableAssetDeliveryRequired &&
		input.chapterContinuityInjection.roleNameKeys.length > 0 &&
		input.chapterContinuityInjection.roleReferenceCount <= 0
	) {
		flags.push({
			code: "chapter_grounded_character_reference_missing",
			severity: "high",
			title: "章节角色缺少角色卡锚点",
			detail:
				"当前 chapter-grounded 请求存在重复角色，但项目/书籍作用域下没有任何可执行角色卡资产。角色连续性必须先建立，再继续产出关键帧、分镜或视频。",
		});
	} else if (
		chapterGroundedReusableAssetDeliveryRequired &&
		input.chapterContinuityInjection.missingRoleReferenceNames.length > 0
	) {
		if (chapterAssetRepairAction) {
			// In explicit chapter asset repair flows, missing anchors are the repair target, not a failure symptom.
		} else {
		flags.push({
			code: "chapter_grounded_character_reference_missing",
			severity: "high",
			title: "部分章节角色缺少角色卡锚点",
			detail:
				`以下角色缺少可执行角色卡资产：${input.chapterContinuityInjection.missingRoleReferenceNames.join("、")}。请先补齐对应角色卡，再执行 chapter-grounded 视觉续写。`,
		});
		}
	}
	if (
		!chapterAssetRepairAction &&
		chapterGroundedReusableAssetDeliveryRequired &&
		input.chapterContinuityInjection.roleNameKeys.length > 0 &&
		input.chapterContinuityInjection.stateEvidenceRoleCount <= 0
	) {
		flags.push({
			code: "chapter_grounded_character_state_missing",
			severity: "high",
			title: "章节角色状态锚点缺失",
			detail:
				"当前 chapter-grounded 请求缺少可追溯的角色年龄/状态证据（ageDescription/stateDescription/stateKey）。未建立状态锚点时，禁止继续产出可执行跨章关键帧。",
		});
	} else if (
		chapterGroundedReusableAssetDeliveryRequired &&
		input.chapterContinuityInjection.missingStateRoleNames.length > 0
	) {
		if (chapterAssetRepairAction) {
			// In explicit chapter asset repair flows, missing anchors are the repair target, not a failure symptom.
		} else {
		flags.push({
			code: "chapter_grounded_character_state_missing",
			severity: "high",
			title: "部分角色状态锚点缺失",
			detail:
				`以下角色缺少年龄或状态锚点：${input.chapterContinuityInjection.missingStateRoleNames.join("、")}。请先补齐角色卡状态元数据，再执行章节视觉续写。`,
		});
		}
	}
	if (
		!chapterAssetRepairAction &&
		chapterGroundedReusableAssetDeliveryRequired &&
		input.chapterContinuityInjection.roleNameKeys.length > 0 &&
		input.chapterContinuityInjection.threeViewRoleCount <= 0
	) {
		flags.push({
			code: "chapter_grounded_character_three_view_missing",
			severity: "high",
			title: "章节角色缺少三视图锚点",
			detail:
				"当前 chapter-grounded 请求涉及重复角色，但项目/书籍作用域下没有可执行的角色三视图资产（threeViewImageUrl）。重复主体必须先补齐三视图参考，再继续产出分镜或关键帧。",
		});
	} else if (
		chapterGroundedReusableAssetDeliveryRequired &&
		input.chapterContinuityInjection.missingThreeViewRoleNames.length > 0
	) {
		if (chapterAssetRepairAction) {
			// In explicit chapter asset repair flows, missing anchors are the repair target, not a failure symptom.
		} else {
		flags.push({
			code: "chapter_grounded_character_three_view_missing",
			severity: "high",
			title: "部分角色缺少三视图锚点",
			detail:
				`以下角色缺少三视图资产：${input.chapterContinuityInjection.missingThreeViewRoleNames.join("、")}。请先生成并绑定对应三视图，再执行 chapter-grounded 视觉续写。`,
		});
		}
	}
	if (
		!chapterAssetRepairAction &&
		chapterGroundedReusableAssetDeliveryRequired &&
		input.chapterContinuityInjection.sceneNameKeys.length + input.chapterContinuityInjection.propNameKeys.length > 0 &&
		input.chapterContinuityInjection.scenePropReferenceCount <= 0
	) {
		flags.push({
			code: "chapter_grounded_scene_prop_reference_missing",
			severity: "high",
			title: "章节场景/道具缺少参考锚点",
			detail:
				"当前 chapter-grounded 请求存在章节场景或关键道具，但项目/书籍作用域下没有匹配的 scene_prop 参考资产。场景/道具连续性必须先建立，再继续批量分镜生成。",
		});
	} else if (
		chapterGroundedReusableAssetDeliveryRequired &&
		input.chapterContinuityInjection.missingScenePropNames.length > 0
	) {
		if (chapterAssetRepairAction) {
			// In explicit chapter asset repair flows, missing anchors are the repair target, not a failure symptom.
		} else {
		flags.push({
			code: "chapter_grounded_scene_prop_reference_missing",
			severity: "high",
			title: "部分场景/道具缺少参考锚点",
			detail:
				`以下场景/道具缺少参考资产：${input.chapterContinuityInjection.missingScenePropNames.join("、")}。请先补齐对应 scene_prop 参考图，再执行 chapter-grounded 视觉续写。`,
		});
		}
	}
	if (videoPromptGovernance.active) {
		if (!videoPromptGovernance.hasExecutablePrompt) {
			flags.push({
				code: "video_prompt_core_fields_missing",
				severity: "high",
				title: "视频提示词缺少核心字段",
				detail:
					videoPromptGovernance.usesDeprecatedVideoPromptField
						? "视频节点必须提供 `prompt`；`videoPrompt` 已废弃，不再作为执行字段。"
						: "视频节点必须提供 `prompt`，并把真实会参与生成的镜头、动作、导演意图与约束直接写进 prompt 本体。",
			});
		}
	}
	if (imagePromptSpecGovernance.invalidSpecCount > 0) {
		flags.push({
			code: "image_prompt_spec_v2_invalid",
			severity: "high",
			title: "章节图片结构化提示词非法",
			detail:
				`chapter-grounded 图片结果里检测到 ${imagePromptSpecGovernance.invalidSpecCount} 个无效 structuredPrompt。` +
				" 若提供结构化 JSON，请统一写入 `structuredPrompt`，并显式提供 version=v2、shotIntent、spatialLayout、cameraPlan、lightingPlan 等核心字段。",
		});
	}
	if (imagePromptSpecGovernance.missingSpecCount > 0) {
		flags.push({
			code: "image_prompt_spec_v2_missing",
			severity: "high",
			title: "章节图片缺少结构化提示词",
			detail:
				`chapter-grounded 图片结果里检测到 ${imagePromptSpecGovernance.missingSpecCount} 个目标缺少 structuredPrompt。` +
				" 若结果属于章节图片/关键帧输出，必须同步提供 version=v2 的 structuredPrompt，并包含 shotIntent、spatialLayout、cameraPlan、lightingPlan 等核心字段。",
		});
	}
	if (imagePromptSpecGovernance.missingReferenceBindingsCount > 0) {
		flags.push({
			code: "image_prompt_spec_v2_reference_bindings_missing",
			severity: "high",
			title: "结构化提示词缺少参考绑定",
			detail:
				`检测到 ${imagePromptSpecGovernance.missingReferenceBindingsCount} 个 chapter-grounded structuredPrompt 未显式填写 referenceBindings。已有锚点输入时禁止只在自然语言 prompt 里口头引用。`,
		});
	}
	if (imagePromptSpecGovernance.missingIdentityConstraintsCount > 0) {
		flags.push({
			code: "image_prompt_spec_v2_identity_constraints_missing",
			severity: "high",
			title: "结构化提示词缺少身份锁定",
			detail:
				`检测到 ${imagePromptSpecGovernance.missingIdentityConstraintsCount} 个 chapter-grounded structuredPrompt 未填写 identityConstraints。存在角色绑定时必须显式锁定身份。`,
		});
	}
	if (imagePromptSpecGovernance.missingEnvironmentObjectsCount > 0) {
		flags.push({
			code: "image_prompt_spec_v2_environment_objects_missing",
			severity: "high",
			title: "结构化提示词缺少环境/道具锚点",
			detail:
				`检测到 ${imagePromptSpecGovernance.missingEnvironmentObjectsCount} 个 chapter-grounded structuredPrompt 未填写 environmentObjects。存在场景/道具锚点时必须落结构化字段。`,
		});
	}
	if (imagePromptSpecGovernance.missingCharacterContinuityCount > 0) {
		flags.push({
			code: "image_prompt_spec_v2_character_continuity_missing",
			severity: "high",
			title: "结构化提示词缺少角色连续性约束",
			detail:
				`检测到 ${imagePromptSpecGovernance.missingCharacterContinuityCount} 个 chapter-grounded structuredPrompt 未填写 continuityConstraints。存在角色年龄/状态证据时，必须显式约束跨章状态连续性。`,
		});
	}
	return flags;
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
	const requiresConfirmation =
		(executionKind === "plan" && input.assetCount === 0) ||
		(canvasAction === "create_canvas_workflow" && !input.toolEvidence.generatedAssets);
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
		requiresConfirmation,
		reason: reasonParts.join("; "),
	};
}

function buildAgentsBridgeTurnVerdict(input: {
	text: string;
	assetCount: number;
	toolEvidence: BridgeToolEvidence;
	toolExecutionIssues: ToolExecutionIssueSummary;
	canvasPlanDiagnostics: CanvasPlanDiagnostics;
	diagnosticFlags: DiagnosticFlag[];
	forceAssetGeneration: boolean;
	semanticExecutionIntent: AgentsSemanticExecutionIntentSummary;
	deliveryVerification: PublicChatDeliveryVerificationSummary;
	completionTrace?: AgentsCompletionTraceSummary | null;
}): AgentsBridgeTurnVerdict {
	const failedReasons = new Set<string>();
	const partialReasons = new Set<string>();
	const validCanvasPlan =
		input.canvasPlanDiagnostics.parseSuccess === true &&
		input.canvasPlanDiagnostics.nodeCount > 0;
	const invalidCanvasPlan =
		input.canvasPlanDiagnostics.errorCode === "invalid_canvas_plan_tag_name" ||
		(input.canvasPlanDiagnostics.tagPresent === true &&
			input.canvasPlanDiagnostics.parseSuccess !== true);
	const parsedPlanWithoutNodes =
		input.canvasPlanDiagnostics.parseSuccess === true &&
		input.canvasPlanDiagnostics.nodeCount <= 0;
	const hasExecutionEvidence =
		input.assetCount > 0 || input.toolEvidence.generatedAssets || input.toolEvidence.wroteCanvas;
	const hasDeliveredResult =
		Boolean(input.text.trim()) ||
		input.assetCount > 0 ||
		input.toolEvidence.wroteCanvas ||
		validCanvasPlan;
	const forceAssetGenerationDeferredToCanvasPlan =
		input.forceAssetGeneration &&
		!hasExecutionEvidence &&
		validCanvasPlan &&
		input.canvasPlanDiagnostics.action === "create_canvas_workflow";
	const forceAssetGenerationUnmet =
		input.forceAssetGeneration &&
		!hasExecutionEvidence &&
		!forceAssetGenerationDeferredToCanvasPlan;
	const semanticExecutionDeliveryUnmet =
		input.semanticExecutionIntent.requiresExecutionDelivery &&
		!hasExecutionEvidence &&
		!validCanvasPlan;
	const genericDeliveryFailureRedundant =
		input.deliveryVerification.code === "generic_execution_delivery_missing" &&
		(
			forceAssetGenerationUnmet ||
			forceAssetGenerationDeferredToCanvasPlan ||
			semanticExecutionDeliveryUnmet
		);

	if (input.completionTrace) {
		if (input.completionTrace.allowFinish !== true || input.completionTrace.terminal === "blocked") {
			failedReasons.add("runtime_completion_blocked");
			if (input.completionTrace.failureReason) {
				failedReasons.add(`runtime_completion_reason:${input.completionTrace.failureReason}`);
			}
		} else if (input.completionTrace.terminal === "explicit_failure") {
			failedReasons.add("runtime_completion_explicit_failure");
			if (input.completionTrace.failureReason) {
				failedReasons.add(`runtime_completion_reason:${input.completionTrace.failureReason}`);
			}
		}
	}

	if (invalidCanvasPlan) failedReasons.add("invalid_canvas_plan");
	if (parsedPlanWithoutNodes) failedReasons.add("parsed_plan_without_nodes");
	if (!hasDeliveredResult) failedReasons.add("empty_response_without_execution");
	if (forceAssetGenerationUnmet) failedReasons.add("force_asset_generation_unmet");
	if (semanticExecutionDeliveryUnmet) {
		failedReasons.add("semantic_execution_delivery_unmet");
	}
	if (
		input.deliveryVerification.applicable &&
		input.deliveryVerification.status === "failed" &&
		input.deliveryVerification.code &&
		!genericDeliveryFailureRedundant
	) {
		failedReasons.add(input.deliveryVerification.code);
	}
	if (forceAssetGenerationDeferredToCanvasPlan) {
		partialReasons.add("force_asset_generation_deferred_to_canvas_plan");
	}
	if (input.toolExecutionIssues.hasExecutionIssues) partialReasons.add("tool_execution_issues");
	if (input.diagnosticFlags.length > 0) {
		for (const flag of input.diagnosticFlags) {
			const code = String(flag.code || "").trim();
			if (!code) continue;
			if (HARD_FAILURE_DIAGNOSTIC_CODES.has(code)) {
				failedReasons.add(code);
				continue;
			}
			partialReasons.add(code);
		}
		partialReasons.add("diagnostic_flags_present");
	}

	if (failedReasons.size > 0) {
		return {
			status: "failed",
			reasons: Array.from(failedReasons),
		};
	}

	if (partialReasons.size > 0) {
		return {
			status: "partial",
			reasons: Array.from(partialReasons),
		};
	}

	return {
		status: "satisfied",
		reasons: ["validated_result"],
	};
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
			currentProjectName: null,
			workspaceAction: null,
			skill: null,
			selectedNodeLabel: null,
			selectedNodeKind: null,
			selectedNodeTextPreview: null,
			selectedReference: null,
		};
	}
	const value = raw as Record<string, unknown>;
	const skillRaw = value.skill;
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
		currentProjectName:
			typeof value.currentProjectName === "string"
				? String(value.currentProjectName).trim() || null
				: null,
		workspaceAction:
			value.workspaceAction === "chapter_script_generation" ||
			value.workspaceAction === "chapter_asset_generation" ||
			value.workspaceAction === "shot_video_generation"
				? value.workspaceAction
				: null,
		skill,
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
	};
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

function hasChapterGroundedSelectedReference(
	selectedReference: AgentsBridgeChatContext["selectedReference"],
): boolean {
	if (!selectedReference) return false;
	if (selectedReference.bookId?.trim() && selectedReference.chapterId?.trim()) return true;
	if (typeof selectedReference.shotNo === "number") return true;
	if (selectedReference.hasUpstreamTextEvidence === true) return true;
	const storyboardSelectionContext = selectedReference.storyboardSelectionContext;
	return Boolean(
		storyboardSelectionContext?.sourceBookId &&
			typeof storyboardSelectionContext.materialChapter === "number",
	);
}

function summarizeAssetRoles(assetInputs: AgentsBridgeAssetInput[]): string[] {
	const counts = new Map<AgentsBridgeAssetRole, number>();
	for (const item of assetInputs) {
		const role = item.role;
		counts.set(role, (counts.get(role) || 0) + 1);
	}
	return Array.from(counts.entries()).map(([role, count]) => `${role}:${count}`);
}

function describeReferenceImageRole(
	role: AgentsBridgeAssetRole | null | undefined,
): string | null {
	switch (role) {
		case "target":
			return "目标图";
		case "reference":
			return "参考图";
		case "character":
			return "角色参考";
		case "scene":
			return "场景参考";
		case "prop":
			return "道具参考";
		case "product":
			return "产品参考";
		case "style":
			return "风格参考";
		case "context":
			return "场景参考";
		case "mask":
			return "遮罩参考";
		default:
			return null;
	}
}

function inferReferenceImageSlotLabel(input: {
	role: AgentsBridgeAssetRole | null;
	name: string | null;
	note: string | null;
	selectedReferenceLabel: string | null;
}): string | null {
	if (input.name) return input.name;
	if (input.selectedReferenceLabel) return input.selectedReferenceLabel;
	if (input.note) {
		const trimmedNote = input.note.trim();
		if (trimmedNote.startsWith("storyboard-tail:")) return "上一组尾帧";
		if (trimmedNote.length <= 80) return trimmedNote;
	}
	return describeReferenceImageRole(input.role) || "参考图";
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
			role: describeReferenceImageRole(role),
			label: inferReferenceImageSlotLabel({
				role,
				name,
				note,
				selectedReferenceLabel,
			}),
			note,
		};
	});
}

function summarizeReferenceImageSlotsForTrace(
	slots: AgentsBridgeReferenceImageSlot[],
): string[] {
	return slots.map((slot) => {
		const parts = [slot.slot];
		if (slot.label) parts.push(slot.label);
		if (slot.role) parts.push(`role=${slot.role}`);
		if (slot.note) parts.push(`note=${slot.note}`);
		return parts.join(" | ");
	});
}

type PublicAgentsGenerationGate = {
	active: boolean;
	directGenerationReady: boolean;
	hasVisualAnchors: boolean;
	reason: string;
};

function evaluatePublicAgentsGenerationGate(input: {
	publicAgentsRequest: boolean;
	canvasProjectId: string;
	canvasFlowId: string;
	referenceImages: string[];
	assetInputsCount: number;
	selectedReferenceImageUrl: string;
	bookId: string;
	chapterId: string;
}): PublicAgentsGenerationGate {
	const active = Boolean(
		input.publicAgentsRequest && input.canvasProjectId && input.canvasFlowId,
	);
	if (!active) {
		return {
			active: false,
			directGenerationReady: true,
			hasVisualAnchors:
				input.referenceImages.length > 0 ||
				input.assetInputsCount > 0 ||
				/^https?:\/\//i.test(input.selectedReferenceImageUrl),
			reason: "non_canvas_or_non_public_agents",
		};
	}

	const hasVisualAnchors =
		input.referenceImages.length > 0 ||
		input.assetInputsCount > 0 ||
		/^https?:\/\//i.test(input.selectedReferenceImageUrl);
	if (hasVisualAnchors) {
		return {
			active: true,
			directGenerationReady: true,
			hasVisualAnchors: true,
			reason: "visual_anchors_present",
		};
	}

	const hasBookContext = Boolean(input.bookId && input.chapterId);
	return {
		active: true,
		directGenerationReady: false,
		hasVisualAnchors: false,
		reason: hasBookContext
			? "missing_visual_anchors_for_book_context"
			: "missing_visual_anchors",
	};
}

function shouldSuppressProductIntegrityConstraint(input: {
	bookId: string;
	chapterId: string;
	chatContext: AgentsBridgeChatContext;
	canvasProjectId: string;
	canvasFlowId: string;
}): boolean {
	if (!(input.canvasProjectId && input.canvasFlowId)) return false;
	if (Boolean(input.bookId && input.chapterId)) return true;
	return hasChapterGroundedSelectedReference(input.chatContext.selectedReference);
}

const agentsBridgeQueueState: {
	active: number;
	waiters: Array<() => void>;
} = {
	active: 0,
	waiters: [],
};

const nodeFetchDispatcherCache = new Map<number, unknown>();

function readAgentsBridgeMaxConcurrency(c: AppContext): number {
	const rawFromEnv =
		typeof c.env.AGENTS_BRIDGE_MAX_CONCURRENCY === "string"
			? c.env.AGENTS_BRIDGE_MAX_CONCURRENCY
			: "";
	const rawFromProcess =
		typeof (globalThis as any)?.process?.env?.AGENTS_BRIDGE_MAX_CONCURRENCY === "string"
			? String((globalThis as any).process.env.AGENTS_BRIDGE_MAX_CONCURRENCY)
			: "";
	const raw = rawFromEnv || rawFromProcess;
	const n = Number(raw);
	if (Number.isFinite(n) && n > 0) {
		return Math.max(1, Math.min(6, Math.trunc(n)));
	}
	return 1;
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

async function waitForAgentsBridgeQueueSlot(signal?: AbortSignal): Promise<void> {
	throwIfAbortSignalAborted(signal);
	await new Promise<void>((resolve, reject) => {
		const wake = () => {
			cleanup();
			resolve();
		};
		const onAbort = () => {
			const index = agentsBridgeQueueState.waiters.indexOf(wake);
			if (index >= 0) {
				agentsBridgeQueueState.waiters.splice(index, 1);
			}
			cleanup();
			reject(toAbortError(signal));
		};
		const cleanup = () => {
			signal?.removeEventListener("abort", onAbort);
		};
		agentsBridgeQueueState.waiters.push(wake);
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}

function createTimedAbortController(timeoutMs: number, externalSignal?: AbortSignal) {
	const controller = new AbortController();
	const timeout = setTimeout(() => {
		controller.abort(new Error("agents_bridge_timeout"));
	}, timeoutMs);
	const onAbort = () => {
		controller.abort(toAbortError(externalSignal));
	};
	if (externalSignal?.aborted) {
		onAbort();
	} else {
		externalSignal?.addEventListener("abort", onAbort, { once: true });
	}
	return {
		signal: controller.signal,
		cleanup() {
			clearTimeout(timeout);
			externalSignal?.removeEventListener("abort", onAbort);
		},
	};
}

async function runAgentsBridgeQueued<T>(
	c: AppContext,
	task: () => Promise<T>,
	signal?: AbortSignal,
): Promise<T> {
	const maxConcurrency = readAgentsBridgeMaxConcurrency(c);
	if (agentsBridgeQueueState.active >= maxConcurrency) {
		await waitForAgentsBridgeQueueSlot(signal);
	}
	throwIfAbortSignalAborted(signal);
	agentsBridgeQueueState.active += 1;
	try {
		return await task();
	} finally {
		agentsBridgeQueueState.active = Math.max(0, agentsBridgeQueueState.active - 1);
		const wake = agentsBridgeQueueState.waiters.shift();
		if (wake) wake();
	}
}

function normalizeAgentsBridgeReferenceImages(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	const out: string[] = [];
	const seen = new Set<string>();
	for (const item of value) {
		if (typeof item !== "string") continue;
		const trimmed = item.trim();
		if (!trimmed) continue;
		if (!/^https?:\/\//i.test(trimmed)) continue;
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
		if (!url || !/^https?:\/\//i.test(url) || url.length > 2048) continue;
		const role = normalizeAgentsBridgeAssetRole(obj.role);
		const dedupeKey = `${role}|${url}`;
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
			...(assetId ? { assetId } : {}),
			...(assetRefId ? { assetRefId } : {}),
			url,
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

function normalizeRoleNameKey(value: string): string {
	return String(value || "").trim().toLowerCase();
}

function readTrimmedString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function asRecord(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	return value as Record<string, unknown>;
}

function parsePositiveChapterNumber(value: string): number | null {
	const n = Number(value);
	if (!Number.isFinite(n) || n <= 0) return null;
	return Math.trunc(n);
}

function sanitizePathSegmentForBookIndex(value: string): string {
	return String(value || "").trim().replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
}

function buildLegacyProjectBooksRoot(projectId: string): string {
	return path.join(
		resolveProjectDataRepoRoot(),
		"project-data",
		sanitizePathSegmentForBookIndex(projectId),
		"books",
	);
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
	const candidates = [
		path.join(buildScopedProjectBooksRoot(input.projectId, input.userId), sanitizePathSegmentForBookIndex(input.bookId), "index.json"),
		path.join(buildLegacyProjectBooksRoot(input.projectId), sanitizePathSegmentForBookIndex(input.bookId), "index.json"),
	];
	for (const candidate of candidates) {
		try {
			await fs.access(candidate);
			return candidate;
		} catch {}
	}
	return null;
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
	const indexPath = await resolveReadableBookIndexPath(input);
	if (!indexPath) return null;
	try {
		const raw = await fs.readFile(indexPath, "utf8");
		const parsed = JSON.parse(raw) as unknown;
		if (!parsed || typeof parsed !== "object") return null;
		return parsed as BookIndexMeta;
	} catch {
		return null;
	}
}

async function listProjectBookCandidates(input: {
	userId: string;
	projectId: string;
}): Promise<ProjectBookCandidate[]> {
	const roots = [
		buildScopedProjectBooksRoot(input.projectId, input.userId),
		buildLegacyProjectBooksRoot(input.projectId),
	];
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

function shouldAutoForceProjectBookLocalRead(input: {
	publicAgentsRequest: boolean;
	requestKind: TaskRequestDto["kind"];
	canvasProjectId: string;
	canvasNodeId: string;
	planOnly: boolean;
	hasReferenceImages: boolean;
	hasAssetInputs: boolean;
	selectedReference: AgentsBridgeChatContext["selectedReference"];
	bookId: string;
}): boolean {
	if (!input.publicAgentsRequest) return false;
	if (input.requestKind !== "chat") return false;
	if (!input.canvasProjectId) return false;
	if (!input.bookId) return false;
	if (input.planOnly) return false;
	if (input.canvasNodeId) return false;
	if (input.hasReferenceImages || input.hasAssetInputs) return false;
	if (input.selectedReference?.nodeId) return false;
	if (input.selectedReference?.imageUrl || input.selectedReference?.sourceUrl) return false;
	return true;
}


type EnsureChapterMetadataWindowResult = {
	ok: boolean;
	status: number;
	bodyText: string;
};

const CHAPTER_METADATA_ENSURE_TIMEOUT_MS = 15_000;

async function ensureChapterMetadataWindow(input: {
	c: AppContext;
	projectId: string;
	bookId: string;
	chapter: number;
}): Promise<EnsureChapterMetadataWindowResult> {
	const baseUrl = readTapCanvasApiBaseFromEnv(input.c) || (() => {
		try {
			return new URL(input.c.req.url).origin;
		} catch {
			return "";
		}
	})();
	if (!baseUrl) {
		return { ok: false, status: 0, bodyText: "ensure_window_base_url_missing" };
	}
	const authorization = String(input.c.req.header("authorization") || "").trim();
	const url = `${baseUrl}/assets/books/${encodeURIComponent(input.bookId)}/metadata/ensure-window?projectId=${encodeURIComponent(input.projectId)}`;
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), CHAPTER_METADATA_ENSURE_TIMEOUT_MS);
	try {
		const response = await fetch(url, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				...(authorization ? { authorization } : {}),
			},
			signal: controller.signal,
			body: JSON.stringify({ chapter: input.chapter, windowSize: 8 }),
		});
		const bodyText = await response.text().catch(() => "");
		return { ok: response.ok, status: response.status, bodyText };
	} catch (error) {
		if (error instanceof Error && error.name === "AbortError") {
			return {
				ok: false,
				status: 408,
				bodyText: "chapter_metadata_ensure_timeout",
			};
		}
		return {
			ok: false,
			status: 0,
			bodyText: error instanceof Error ? error.message : String(error || "ensure_window_unknown_error"),
		};
	} finally {
		clearTimeout(timeout);
	}
}

function collectChapterRoleNameKeys(indexData: BookIndexMeta, chapter: number): string[] {
	const chapterMeta = Array.isArray(indexData.chapters)
		? indexData.chapters.find((item) => Math.trunc(Number(item?.chapter || 0)) === chapter) || null
		: null;
	if (!chapterMeta || !Array.isArray(chapterMeta.characters)) return [];
	const out: string[] = [];
	const seen = new Set<string>();
	for (const item of chapterMeta.characters) {
		const roleNameKey = normalizeRoleNameKey(String(item?.name || ""));
		if (!roleNameKey || seen.has(roleNameKey)) continue;
		seen.add(roleNameKey);
		out.push(roleNameKey);
	}
	return out;
}

function selectLatestTailFrameUrl(indexData: BookIndexMeta, chapter: number): string | null {
	const chunks = Array.isArray(indexData.assets?.storyboardChunks) ? indexData.assets.storyboardChunks : [];
	const matched = chunks
		.map((item) => ({
			chapter: Math.trunc(Number(item?.chapter || 0)),
			updatedAt: String(item?.updatedAt || "").trim(),
			tailFrameUrl: String(item?.tailFrameUrl || "").trim(),
		}))
		.filter((item) => item.chapter === chapter && item.tailFrameUrl && /^https?:\/\//i.test(item.tailFrameUrl));
	if (!matched.length) return null;
	matched.sort((left, right) => Date.parse(right.updatedAt || "") - Date.parse(left.updatedAt || ""));
	return matched[0]?.tailFrameUrl || null;
}

async function listProjectRoleReferenceAssets(input: {
	userId: string;
	projectId: string;
}): Promise<ProjectRoleReferenceAsset[]> {
	const rows = await listAssetsForUser(getPrismaClient(), input.userId, {
		projectId: input.projectId,
		kind: "projectRoleCard",
		limit: 200,
	});
	return rows
		.map((row) => parseMentionRoleReferenceAsset(row))
		.filter((item): item is ProjectRoleReferenceAsset => item !== null);
}

function normalizeVisualReferenceNameKey(value: string): string {
	return normalizeSemanticReferenceToken(value);
}

function isVisualReferenceApplicableToChapter(
	asset: Pick<MentionVisualReferenceAsset, "chapter" | "chapterStart" | "chapterEnd" | "chapterSpan">,
	chapter: number | null,
): boolean {
	return getReferenceChapterRelevance(asset, chapter) > 0;
}

function sortVisualReferenceAssets(
	assets: MentionVisualReferenceAsset[],
	chapter: number | null,
): MentionVisualReferenceAsset[] {
	return assets.slice().sort((left, right) => {
		const leftCovered = getReferenceChapterRelevance(left, chapter);
		const rightCovered = getReferenceChapterRelevance(right, chapter);
		if (leftCovered !== rightCovered) return rightCovered - leftCovered;
		return right.updatedAtTs - left.updatedAtTs;
	});
}

function hasSemanticAssetExecutableConfirmation(asset: BookSemanticAssetMeta): boolean {
	const status = String(asset?.status || "").trim().toLowerCase();
	if (status !== "generated") return false;
	const confirmedAt = String(asset?.confirmedAt || "").trim();
	if (confirmedAt) return true;
	const confirmationMode = String(asset?.confirmationMode || "").trim().toLowerCase();
	return confirmationMode === "auto" || confirmationMode === "manual";
}

function readSemanticAssetReferenceImageUrl(asset: BookSemanticAssetMeta): string {
	const imageUrl = String(asset?.imageUrl || "").trim();
	if (/^https?:\/\//i.test(imageUrl)) return imageUrl;
	const thumbnailUrl = String(asset?.thumbnailUrl || "").trim();
	if (/^https?:\/\//i.test(thumbnailUrl)) return thumbnailUrl;
	return "";
}

function parseBookSemanticRoleReferenceAssets(input: {
	indexData: BookIndexMeta;
	chapter: number | null;
}): MentionRoleReferenceAsset[] {
	const semanticAssets = Array.isArray(input.indexData.assets?.semanticAssets)
		? input.indexData.assets.semanticAssets
		: [];
	const out: MentionRoleReferenceAsset[] = [];
	const seen = new Set<string>();
	for (const item of semanticAssets) {
		if (!hasSemanticAssetExecutableConfirmation(item)) continue;
		const semanticId = String(item?.semanticId || "").trim();
		const semanticReferenceImageUrl = readSemanticAssetReferenceImageUrl(item);
		const chapter = normalizePositiveReferenceChapter(item?.chapter);
		const chapterStart = normalizePositiveReferenceChapter(item?.chapterStart);
		const chapterEnd = normalizePositiveReferenceChapter(item?.chapterEnd);
		const chapterSpan = normalizeReferenceChapterSpan(item?.chapterSpan);
		if (
			!isRoleReferenceApplicableToChapter(
				{ chapter, chapterStart, chapterEnd, chapterSpan },
				input.chapter,
			)
		) {
			continue;
		}
		const updatedAtTs = (() => {
			const ts = Date.parse(String(item?.updatedAt || item?.createdAt || ""));
			return Number.isFinite(ts) ? ts : 0;
		})();
		const anchorBindings = Array.isArray(item?.anchorBindings) ? item.anchorBindings : [];
		for (const binding of anchorBindings) {
			if (String(binding?.kind || "").trim().toLowerCase() !== "character") continue;
			const roleName =
				readTrimmedString(binding?.label) ||
				readTrimmedString(binding?.refId) ||
				readTrimmedString(binding?.entityId);
			const roleNameKey = normalizeRoleNameKey(roleName);
			const bindingImageUrl = String(binding?.imageUrl || "").trim();
			const imageUrl =
				semanticReferenceImageUrl ||
				(/^https?:\/\//i.test(bindingImageUrl) ? bindingImageUrl : "");
			if (!roleName || !roleNameKey || !imageUrl) continue;
			const note = readTrimmedString(binding?.note);
			const parsedNote = parseCharacterContinuityNote(note);
			const stateDescription = readTrimmedString(item?.stateDescription) || parsedNote.state || note;
			const stateKey = normalizeRoleNameKey(parsedNote.stateKey || stateDescription);
			const dedupeKey = `${semanticId || imageUrl}:${roleNameKey}:${stateKey || ""}`;
			if (seen.has(dedupeKey)) continue;
			seen.add(dedupeKey);
			out.push({
				assetId: semanticId ? `${semanticId}:${roleNameKey}` : `${roleNameKey}:${String(updatedAtTs)}`,
				cardId: semanticId || `${roleNameKey}:${String(updatedAtTs)}`,
				roleName,
				roleNameKey,
				roleIdKey:
					normalizeRoleNameKey(
						readTrimmedString(binding?.refId) || readTrimmedString(binding?.entityId),
					),
				cardIdKey: normalizeRoleNameKey(semanticId || roleNameKey),
				imageUrl,
				primaryImageUrl: imageUrl,
				threeViewImageUrl: null,
				ageDescription: parsedNote.age,
				stateDescription,
				stateLabel: parsedNote.stateLabel,
				stateKey,
				chapter,
				chapterStart,
				chapterEnd,
				chapterSpan,
				updatedAtTs,
				referenceSource: "semantic_asset",
			});
		}
	}
	return out;
}

function parseBookSemanticVisualReferenceAssets(input: {
	indexData: BookIndexMeta;
	chapter: number | null;
}): MentionVisualReferenceAsset[] {
	const semanticAssets = Array.isArray(input.indexData.assets?.semanticAssets)
		? input.indexData.assets.semanticAssets
		: [];
	const out: MentionVisualReferenceAsset[] = [];
	const seen = new Set<string>();
	for (const item of semanticAssets) {
		if (!hasSemanticAssetExecutableConfirmation(item)) continue;
		const semanticId = String(item?.semanticId || "").trim();
		const semanticReferenceImageUrl = readSemanticAssetReferenceImageUrl(item);
		const chapter = normalizePositiveReferenceChapter(item?.chapter);
		const chapterStart = normalizePositiveReferenceChapter(item?.chapterStart);
		const chapterEnd = normalizePositiveReferenceChapter(item?.chapterEnd);
		const chapterSpan = normalizeReferenceChapterSpan(item?.chapterSpan);
		if (
			!isVisualReferenceApplicableToChapter(
				{ chapter, chapterStart, chapterEnd, chapterSpan },
				input.chapter,
			)
		) {
			continue;
		}
		const updatedAtTs = (() => {
			const ts = Date.parse(String(item?.updatedAt || item?.createdAt || ""));
			return Number.isFinite(ts) ? ts : 0;
		})();
		const anchorBindings = Array.isArray(item?.anchorBindings) ? item.anchorBindings : [];
		for (const binding of anchorBindings) {
			const kind = String(binding?.kind || "").trim().toLowerCase();
			if (kind !== "scene" && kind !== "prop") continue;
			const name =
				readTrimmedString(binding?.label) ||
				readTrimmedString(binding?.refId) ||
				readTrimmedString(binding?.entityId);
			const nameKey = normalizeVisualReferenceNameKey(name);
			const bindingImageUrl = String(binding?.imageUrl || "").trim();
			const imageUrl =
				semanticReferenceImageUrl ||
				(/^https?:\/\//i.test(bindingImageUrl) ? bindingImageUrl : "");
			if (!name || !nameKey || !imageUrl) continue;
			const rawCategory = String(binding?.category || "").trim().toLowerCase();
			const category =
				kind === "prop" && rawCategory === "spell_fx" ? "spell_fx" : "scene_prop";
			const refId =
				readTrimmedString(binding?.refId) ||
				(semanticId ? `${semanticId}:${kind}:${nameKey}` : `${kind}:${nameKey}:${String(updatedAtTs)}`);
			const dedupeKey = `${refId}:${imageUrl}`;
			if (seen.has(dedupeKey)) continue;
			seen.add(dedupeKey);
			out.push({
				refId,
				category,
				name,
				nameKey,
				imageUrl,
				stateDescription:
					readTrimmedString(item?.stateDescription) || readTrimmedString(binding?.note),
				chapter,
				chapterStart,
				chapterEnd,
				chapterSpan,
				updatedAtTs,
				referenceSource: "semantic_asset",
			});
		}
	}
	return out;
}

function isMentionTokenBoundaryChar(char: string): boolean {
	return /[\s,，。；;:：!！?？"'“”‘’()（）\[\]【】{}<>]/.test(char);
}

type PromptMentionToken = {
	raw: string;
	rawDisplay: string;
	mentionKey: string;
	stateKey: string;
	disambiguatorKey: string;
};

function normalizePromptMentionToken(value: string): string {
	return String(value || "")
		.trim()
		.replace(/^@+/, "")
		.replace(/[，。！？、；：,.!?;:)\]】》〉'"`]+$/g, "")
		.toLowerCase();
}

function normalizePromptMentionStateKey(value: string): string {
	return normalizeRoleNameKey(value).replace(/[\s_\-—–/／:：|｜]+/g, "");
}

function splitPromptMentionNameAndState(value: string): {
	namePart: string;
	statePart: string;
} {
	const trimmed = String(value || "").trim();
	if (!trimmed) return { namePart: "", statePart: "" };
	const separators = ["-", "—", "–", "/", "／", ":", "：", "|", "｜"];
	let splitIndex = -1;
	for (const separator of separators) {
		const index = trimmed.lastIndexOf(separator);
		if (index > 0 && index < trimmed.length - 1) {
			splitIndex = Math.max(splitIndex, index);
		}
	}
	if (splitIndex <= 0) return { namePart: trimmed, statePart: "" };
	return {
		namePart: trimmed.slice(0, splitIndex).trim(),
		statePart: trimmed.slice(splitIndex + 1).trim(),
	};
}

function parsePromptMentionToken(rawToken: string): PromptMentionToken | null {
	const cleaned = String(rawToken || "").trim();
	if (!cleaned) return null;
	const normalized = normalizePromptMentionToken(cleaned);
	if (!normalized) return null;
	const [corePart, disambiguatorPart] = normalized.split("#", 2);
	const { namePart, statePart } = splitPromptMentionNameAndState(corePart || "");
	const mentionKey = normalizeRoleNameKey(namePart || "");
	if (!mentionKey) return null;
	return {
		raw: cleaned,
		rawDisplay: cleaned.replace(/^@+/, "@"),
		mentionKey,
		stateKey: normalizePromptMentionStateKey(statePart || ""),
		disambiguatorKey: normalizeRoleNameKey(disambiguatorPart || ""),
	};
}

function extractPromptMentionTokens(prompt: string): PromptMentionToken[] {
	const text = String(prompt || "");
	const out: PromptMentionToken[] = [];
	const seen = new Set<string>();
	for (let index = 0; index < text.length; index += 1) {
		if (text[index] !== "@") continue;
		let end = index + 1;
		while (end < text.length && !isMentionTokenBoundaryChar(text[end] || "")) {
			end += 1;
		}
		const token = parsePromptMentionToken(text.slice(index, end));
		if (!token) continue;
		const dedupeKey = `${token.mentionKey}:${token.stateKey || ""}#${token.disambiguatorKey || ""}`;
		if (seen.has(dedupeKey)) continue;
		seen.add(dedupeKey);
		out.push(token);
	}
	return out;
}

function doesMentionRoleStateMatchQuery(input: {
	queryStateKey: string;
	ageDescription?: string;
	stateDescription?: string;
	stateLabel?: string;
	stateKey?: string;
}): boolean {
	const queryKey = normalizePromptMentionStateKey(input.queryStateKey);
	if (!queryKey) return true;
	const candidates = new Set(
		[
		input.stateKey,
		input.stateLabel,
		input.stateDescription,
		input.ageDescription,
	]
			.map((item) => normalizePromptMentionStateKey(String(item || "")))
			.filter(Boolean),
	);
	if (candidates.size === 0) return false;
	return candidates.has(queryKey);
}

type MentionRoleReferenceAsset = {
	assetId: string;
	cardId: string;
	roleName: string;
	roleNameKey: string;
	roleIdKey: string;
	cardIdKey: string;
	imageUrl: string;
	primaryImageUrl: string | null;
	threeViewImageUrl: string | null;
	ageDescription: string;
	stateDescription: string;
	stateLabel: string;
	stateKey: string;
	chapter?: number;
	chapterStart?: number;
	chapterEnd?: number;
	chapterSpan: number[];
	updatedAtTs: number;
	referenceSource: "role_card" | "semantic_asset";
};

type ProjectRoleReferenceAsset = MentionRoleReferenceAsset;

type MentionVisualReferenceAsset = {
	refId: string;
	category: "scene_prop" | "spell_fx";
	name: string;
	nameKey: string;
	imageUrl: string;
	stateDescription: string;
	chapter?: number;
	chapterStart?: number;
	chapterEnd?: number;
	chapterSpan: number[];
	updatedAtTs: number;
	referenceSource: "visual_ref" | "semantic_asset";
};

type MentionBoundReferenceAsset = {
	assetId: string;
	assetRefId: string;
	assetName: string;
	assetNameKey: string;
	assetIdKey: string;
	assetRefIdKey: string;
	url: string;
	referenceImageUrl: string | null;
	nodeId: string | null;
	source: "flow" | "project_asset";
};

function normalizePositiveReferenceChapter(value: unknown): number | undefined {
	const numeric = Number(value);
	if (!Number.isFinite(numeric) || numeric <= 0) return undefined;
	return Math.trunc(numeric);
}

function normalizeReferenceChapterSpan(value: unknown): number[] {
	if (!Array.isArray(value)) return [];
	return value
		.map((item) => Number(item))
		.filter((item) => Number.isFinite(item) && item > 0)
		.map((item) => Math.trunc(item));
}

function getReferenceChapterRelevance(
	asset: {
		chapter?: number;
		chapterStart?: number;
		chapterEnd?: number;
		chapterSpan: number[];
	},
	chapter: number | null,
): 0 | 1 | 2 | 3 {
	if (chapter === null) return 3;
	if (asset.chapterSpan.length > 0) {
		if (asset.chapterSpan.includes(chapter)) return 3;
		const maxChapter = Math.max(...asset.chapterSpan);
		if (maxChapter < chapter) return 2;
		return 0;
	}
	if (typeof asset.chapter === "number") {
		if (asset.chapter === chapter) return 3;
		return asset.chapter < chapter ? 2 : 0;
	}
	const start = typeof asset.chapterStart === "number" ? asset.chapterStart : undefined;
	const end = typeof asset.chapterEnd === "number" ? asset.chapterEnd : start;
	if (typeof start === "number" && typeof end === "number") {
		if (chapter >= start && chapter <= end) return 3;
		return end < chapter ? 2 : 0;
	}
	if (typeof start === "number") {
		return chapter >= start ? 3 : 0;
	}
	return 1;
}

function isRoleReferenceApplicableToChapter(
	asset: Pick<MentionRoleReferenceAsset, "chapter" | "chapterStart" | "chapterEnd" | "chapterSpan">,
	chapter: number | null,
): boolean {
	return getReferenceChapterRelevance(asset, chapter) > 0;
}

function sortRoleReferenceAssets(assets: MentionRoleReferenceAsset[], chapter: number | null): MentionRoleReferenceAsset[] {
	return assets.slice().sort((left, right) => {
		const leftCovered = getReferenceChapterRelevance(left, chapter);
		const rightCovered = getReferenceChapterRelevance(right, chapter);
		if (leftCovered !== rightCovered) return rightCovered - leftCovered;
		return right.updatedAtTs - left.updatedAtTs;
	});
}

function readRoleAgeDescription(value: Record<string, unknown>): string {
	const direct = readTrimmedString(value.ageDescription);
	if (direct) return direct;
	const age = readTrimmedString(value.age);
	if (age) return age;
	const ageLabel = readTrimmedString(value.ageLabel);
	if (ageLabel) return ageLabel;
	return "";
}

function readRoleStateLabel(value: Record<string, unknown>): string {
	const direct = readTrimmedString(value.stateLabel);
	if (direct) return direct;
	const currentState = readTrimmedString(value.currentState);
	if (currentState) return currentState;
	const healthStatus = readTrimmedString(value.healthStatus);
	if (healthStatus) return healthStatus;
	const injuryStatus = readTrimmedString(value.injuryStatus);
	if (injuryStatus) return injuryStatus;
	return "";
}

function hasRoleAgeOrStateEvidence(asset: MentionRoleReferenceAsset): boolean {
	return Boolean(
		asset.ageDescription ||
			asset.stateDescription ||
			asset.stateLabel ||
			asset.stateKey,
	);
}

function normalizeSemanticReferenceToken(value: string): string {
	return String(value || "")
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9\u4e00-\u9fa5_-]+/g, "_")
		.replace(/_+/g, "_")
		.replace(/^_+|_+$/g, "")
		.slice(0, 80);
}

function buildSemanticRoleReferenceAssetRefId(
	asset: Pick<
		MentionRoleReferenceAsset,
		"roleName" | "roleNameKey" | "roleIdKey" | "stateKey" | "stateLabel"
	>,
): string {
	const base =
		normalizeSemanticReferenceToken(asset.roleIdKey) ||
		normalizeSemanticReferenceToken(asset.roleNameKey) ||
		normalizeSemanticReferenceToken(asset.roleName) ||
		"role";
	const state =
		normalizeSemanticReferenceToken(asset.stateKey) ||
		normalizeSemanticReferenceToken(asset.stateLabel);
	return [base, state].filter(Boolean).join("_").slice(0, 160);
}

function buildSemanticVisualReferenceAssetRefId(input: {
	role: "scene" | "prop" | "reference";
	name: string;
}): string {
	const rolePrefix = normalizeSemanticReferenceToken(input.role) || "reference";
	const nameToken = normalizeSemanticReferenceToken(input.name) || "anchor";
	return `${rolePrefix}_${nameToken}`.slice(0, 160);
}

function buildRoleReferenceNote(prefix: string, asset: MentionRoleReferenceAsset): string {
	const stateLine = String(asset.stateDescription || "").split("\n").map((item) => item.trim()).find(Boolean) || "";
	const parts = [
		prefix,
		asset.threeViewImageUrl
			? "reference=three_view"
			: asset.referenceSource === "semantic_asset"
				? "reference=semantic_asset"
				: "reference=role_card",
	];
	if (asset.ageDescription) parts.push(`age=${asset.ageDescription}`);
	if (asset.stateLabel) parts.push(`stateLabel=${asset.stateLabel}`);
	if (stateLine) parts.push(`state=${stateLine}`);
	if (asset.stateKey) parts.push(`stateKey=${asset.stateKey}`);
	return parts.filter(Boolean).join(" | ");
}

function buildVisualReferenceNote(prefix: string, asset: MentionVisualReferenceAsset): string {
	const parts = [
		prefix,
		`category=${asset.category}`,
		...(asset.referenceSource === "semantic_asset" ? ["reference=semantic_asset"] : []),
	];
	if (asset.stateDescription) parts.push(`state=${asset.stateDescription}`);
	return parts.filter(Boolean).join(" | ");
}

function buildBoundReferenceNote(asset: MentionBoundReferenceAsset): string {
	const parts = [
		asset.nodeId ? `canvas-node:${asset.nodeId}` : null,
		asset.assetName && asset.assetName !== asset.assetRefId ? asset.assetName : null,
	].filter(Boolean);
	return [`@${asset.assetRefId}`, ...parts].join(" · ");
}

function pickMentionBoundReferenceAsset(
	mention: PromptMentionToken,
	candidates: MentionBoundReferenceAsset[],
): MentionBoundReferenceAsset | "missing" | "ambiguous" {
	if (candidates.length === 0) return "missing";
	if (candidates.length === 1) return candidates[0] || "missing";
	const preferred = candidates.filter(
		(item) =>
			item.assetRefIdKey === mention.mentionKey || item.assetIdKey === mention.mentionKey,
	);
	if (preferred.length === 1) return preferred[0] || "missing";
	return "ambiguous";
}

function pickMentionRoleReferenceAsset(
	mention: PromptMentionToken,
	candidates: MentionRoleReferenceAsset[],
): MentionRoleReferenceAsset | "missing" | "ambiguous" {
	if (candidates.length === 0) return "missing";
	const narrowedByState = mention.stateKey
		? candidates.filter((candidate) =>
				doesMentionRoleStateMatchQuery({
					queryStateKey: mention.stateKey,
					ageDescription: candidate.ageDescription,
					stateDescription: candidate.stateDescription,
					stateLabel: candidate.stateLabel,
					stateKey: candidate.stateKey,
				}),
			)
		: candidates;
	if (narrowedByState.length === 0) return "missing";
	if (!mention.disambiguatorKey) return narrowedByState.length === 1 ? narrowedByState[0]! : "ambiguous";
	const matched =
		narrowedByState.find((item) => item.roleIdKey && item.roleIdKey.startsWith(mention.disambiguatorKey)) ||
		narrowedByState.find((item) => item.cardIdKey && item.cardIdKey.startsWith(mention.disambiguatorKey)) ||
		null;
	return matched || "missing";
}

function parseMentionRoleReferenceAsset(row: AssetRow): MentionRoleReferenceAsset | null {
	const rawData = typeof row.data === "string" ? row.data.trim() : "";
	if (!rawData) return null;
	let parsed: unknown = null;
	try {
		parsed = JSON.parse(rawData);
	} catch {
		return null;
	}
	if (!parsed || typeof parsed !== "object") return null;
	const obj = parsed as Record<string, unknown>;
	const kind = String(obj.kind || "").trim();
	if (kind !== "projectRoleCard") return null;
	const roleName = String(obj.roleName || "").trim();
	const roleNameKey = normalizeRoleNameKey(String(obj.roleNameKey || roleName));
	const primaryImageUrlRaw = String(obj.imageUrl || "").trim();
	const primaryImageUrl = /^https?:\/\//i.test(primaryImageUrlRaw) ? primaryImageUrlRaw : null;
	const threeViewImageUrlRaw = String(obj.threeViewImageUrl || "").trim();
	const threeViewImageUrl = /^https?:\/\//i.test(threeViewImageUrlRaw) ? threeViewImageUrlRaw : null;
	const imageUrl = threeViewImageUrl || primaryImageUrl;
	if (!roleName || !roleNameKey || !imageUrl) return null;
	const stateDescription = readTrimmedString(obj.stateDescription);
	const stateKey = normalizeRoleNameKey(readTrimmedString(obj.stateKey));
	const ageDescription = readRoleAgeDescription(obj);
	const stateLabel = readRoleStateLabel(obj);
	return {
		assetId: row.id,
		cardId: String(obj.cardId || row.id || "").trim(),
		roleName,
		roleNameKey,
		roleIdKey: normalizeRoleNameKey(String(obj.roleId || "")),
		cardIdKey: normalizeRoleNameKey(String(obj.cardId || row.id || "")),
		imageUrl,
		primaryImageUrl,
		threeViewImageUrl,
		ageDescription,
		stateDescription,
		stateLabel,
		stateKey,
		chapter: normalizePositiveReferenceChapter(obj.chapter),
		chapterStart: normalizePositiveReferenceChapter(obj.chapterStart),
		chapterEnd: normalizePositiveReferenceChapter(obj.chapterEnd),
		chapterSpan: normalizeReferenceChapterSpan(obj.chapterSpan),
		updatedAtTs: (() => {
			const ts = Date.parse(String(obj.updatedAt || row.updatedAt || row.createdAt || ""));
			return Number.isFinite(ts) ? ts : 0;
		})(),
		referenceSource: "role_card",
	};
}

function parseMentionGenerationAsset(row: AssetRow): MentionBoundReferenceAsset | null {
	const rawData = typeof row.data === "string" ? row.data.trim() : "";
	if (!rawData) return null;
	let parsed: unknown = null;
	try {
		parsed = JSON.parse(rawData);
	} catch {
		return null;
	}
	const obj = asRecord(parsed);
	if (!obj) return null;
	if (readTrimmedString(obj.kind) !== "generation") return null;
	const assetId = readTrimmedString(row.id);
	const assetRefId = (readTrimmedString(obj.assetRefId) || assetId).slice(0, 160);
	const assetRefIdKey = normalizeRoleNameKey(assetRefId);
	const url = readTrimmedString(obj.url);
	if (!assetId || !assetRefIdKey || !url || !/^https?:\/\//i.test(url)) return null;
	const assetName =
		readTrimmedString(obj.assetName) ||
		readTrimmedString(row.name) ||
		assetRefId;
	const thumbnailUrl = readTrimmedString(obj.thumbnailUrl);
	return {
		assetId,
		assetRefId,
		assetName,
		assetNameKey: normalizeRoleNameKey(assetName),
		assetIdKey: normalizeRoleNameKey(assetId),
		assetRefIdKey,
		url,
		referenceImageUrl:
			thumbnailUrl && /^https?:\/\//i.test(thumbnailUrl) ? thumbnailUrl : url,
		nodeId: null,
		source: "project_asset",
	};
}

function collectFlowNodeMentionReferenceAssets(flowData: unknown): MentionBoundReferenceAsset[] {
	const graph = asRecord(flowData);
	const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
	const out: MentionBoundReferenceAsset[] = [];
	for (const rawNode of nodes) {
		const node = asRecord(rawNode);
		if (!node) continue;
		const nodeId = readTrimmedString(node.id) || null;
		const data = asRecord(node.data) || {};
		const nodeLabel = readTrimmedString(data.label) || nodeId || "asset";
		const rootAssetId = readTrimmedString(data.assetId);
		const rootAssetRefId = readTrimmedString(data.assetRefId);
		const pushAsset = (item: unknown) => {
			const record = asRecord(item);
			if (!record) return;
			const url = readTrimmedString(record.url);
			if (!url || !/^https?:\/\//i.test(url)) return;
			const assetId = readTrimmedString(record.assetId) || rootAssetId;
			const assetRefId = (
				readTrimmedString(record.assetRefId) ||
				rootAssetRefId ||
				assetId
			).slice(0, 160);
			const assetRefIdKey = normalizeRoleNameKey(assetRefId);
			if (!assetId || !assetRefIdKey) return;
			const assetName =
				readTrimmedString(record.assetName) ||
				readTrimmedString(record.title) ||
				nodeLabel;
			const thumbnailUrl = readTrimmedString(record.thumbnailUrl);
			out.push({
				assetId,
				assetRefId,
				assetName,
				assetNameKey: normalizeRoleNameKey(assetName),
				assetIdKey: normalizeRoleNameKey(assetId),
				assetRefIdKey,
				url,
				referenceImageUrl:
					thumbnailUrl && /^https?:\/\//i.test(thumbnailUrl) ? thumbnailUrl : url,
				nodeId,
				source: "flow",
			});
		};
		const imageResults = Array.isArray(data.imageResults) ? data.imageResults : [];
		for (const item of imageResults) pushAsset(item);
		const videoResults = Array.isArray(data.videoResults) ? data.videoResults : [];
		for (const item of videoResults) pushAsset(item);
		if (imageResults.length === 0 && videoResults.length === 0) {
			const fallbackUrl = readTrimmedString(data.imageUrl) || readTrimmedString(data.videoUrl);
			if (fallbackUrl) {
				pushAsset({
					url: fallbackUrl,
					thumbnailUrl: readTrimmedString(data.videoThumbnailUrl) || undefined,
					assetId: rootAssetId || undefined,
					assetRefId: rootAssetRefId || undefined,
					assetName: nodeLabel,
					title: nodeLabel,
				});
			}
		}
	}
	return out;
}

function buildBoundReferenceAssetLookup(
	assets: MentionBoundReferenceAsset[],
): Map<string, MentionBoundReferenceAsset[]> {
	const lookup = new Map<string, MentionBoundReferenceAsset[]>();
	for (const item of assets) {
		for (const key of [item.assetRefIdKey, item.assetIdKey, item.assetNameKey]) {
			if (!key) continue;
			const list = lookup.get(key) || [];
			list.push(item);
			lookup.set(key, list);
		}
	}
	return lookup;
}

function parseBookRoleReferenceAssets(input: {
	indexData: BookIndexMeta;
	chapter: number | null;
}): MentionRoleReferenceAsset[] {
	const roleCards = Array.isArray(input.indexData.assets?.roleCards) ? input.indexData.assets.roleCards : [];
	const roleCardAssets = roleCards
		.map((item) => {
			const roleName = String(item?.roleName || "").trim();
			const roleNameKey = normalizeRoleNameKey(roleName);
			const primaryImageUrlRaw = String(item?.imageUrl || "").trim();
			const primaryImageUrl = /^https?:\/\//i.test(primaryImageUrlRaw) ? primaryImageUrlRaw : null;
			const threeViewImageUrlRaw = String(item?.threeViewImageUrl || "").trim();
			const threeViewImageUrl = /^https?:\/\//i.test(threeViewImageUrlRaw) ? threeViewImageUrlRaw : null;
			const imageUrl = threeViewImageUrl || primaryImageUrl;
			const status = String(item?.status || "").trim().toLowerCase();
			const confirmedAt = String(item?.confirmedAt || "").trim();
			if (!roleName || !roleNameKey || !imageUrl || status !== "generated" || !confirmedAt) return null;
			const stateDescription = readTrimmedString(item?.stateDescription);
			const stateKey = normalizeRoleNameKey(readTrimmedString(item?.stateKey));
			const ageDescription = readRoleAgeDescription((item as Record<string, unknown>) || {});
			const stateLabel = readRoleStateLabel((item as Record<string, unknown>) || {});
			const asset: MentionRoleReferenceAsset = {
				assetId: String(item?.cardId || "").trim(),
				cardId: String(item?.cardId || "").trim(),
				roleName,
				roleNameKey,
				roleIdKey: normalizeRoleNameKey(String(item?.roleId || "")),
				cardIdKey: normalizeRoleNameKey(String(item?.cardId || "")),
				imageUrl,
				primaryImageUrl,
				threeViewImageUrl,
				ageDescription,
				stateDescription,
				stateLabel,
				stateKey,
				chapter: normalizePositiveReferenceChapter(item?.chapter),
				chapterStart: normalizePositiveReferenceChapter(item?.chapterStart),
				chapterEnd: normalizePositiveReferenceChapter(item?.chapterEnd),
				chapterSpan: normalizeReferenceChapterSpan(item?.chapterSpan),
				updatedAtTs: (() => {
					const ts = Date.parse(String(item?.updatedAt || item?.createdAt || ""));
					return Number.isFinite(ts) ? ts : 0;
				})(),
				referenceSource: "role_card",
			};
			return isRoleReferenceApplicableToChapter(asset, input.chapter) ? asset : null;
		})
		.filter((item): item is MentionRoleReferenceAsset => item !== null);
	const semanticAssets = parseBookSemanticRoleReferenceAssets(input);
	return [...roleCardAssets, ...semanticAssets];
}

function parseBookVisualReferenceAssets(input: {
	indexData: BookIndexMeta;
	chapter: number | null;
}): MentionVisualReferenceAsset[] {
	const visualRefs = Array.isArray(input.indexData.assets?.visualRefs) ? input.indexData.assets.visualRefs : [];
	const visualReferenceAssets = visualRefs
		.map((item) => {
			const refId = String(item?.refId || "").trim();
			const category = String(item?.category || "").trim().toLowerCase();
			const name = String(item?.name || "").trim();
			const nameKey = normalizeVisualReferenceNameKey(name);
			const imageUrl = String(item?.imageUrl || "").trim();
			const status = String(item?.status || "").trim().toLowerCase();
			const confirmedAt = String(item?.confirmedAt || "").trim();
			if (
				!refId ||
				(category !== "scene_prop" && category !== "spell_fx") ||
				!name ||
				!nameKey ||
				!imageUrl ||
				!/^https?:\/\//i.test(imageUrl) ||
				status !== "generated" ||
				!confirmedAt
			) {
				return null;
			}
			const asset: MentionVisualReferenceAsset = {
				refId,
				category: category as "scene_prop" | "spell_fx",
				name,
				nameKey,
				imageUrl,
				stateDescription: readTrimmedString(item?.stateDescription),
				chapter: normalizePositiveReferenceChapter(item?.chapter),
				chapterStart: normalizePositiveReferenceChapter(item?.chapterStart),
				chapterEnd: normalizePositiveReferenceChapter(item?.chapterEnd),
				chapterSpan: normalizeReferenceChapterSpan(item?.chapterSpan),
				updatedAtTs: (() => {
					const ts = Date.parse(String(item?.updatedAt || item?.createdAt || ""));
					return Number.isFinite(ts) ? ts : 0;
				})(),
				referenceSource: "visual_ref",
			};
			return isVisualReferenceApplicableToChapter(asset, input.chapter) ? asset : null;
		})
		.filter((item): item is MentionVisualReferenceAsset => item !== null);
	const semanticAssets = parseBookSemanticVisualReferenceAssets(input);
	return [...visualReferenceAssets, ...semanticAssets];
}

async function resolveMentionBoundAssetInputs(input: {
	userId: string;
	projectId: string;
	canvasFlowId?: string | null;
	prompt: string;
	existingAssetInputs: AgentsBridgeAssetInput[];
}): Promise<{
	mentions: string[];
	matched: MentionBoundReferenceAsset[];
	missing: string[];
	ambiguous: string[];
	assetInputs: AgentsBridgeAssetInput[];
	referenceImages: string[];
	resolvedMentionKeys: string[];
}> {
	const mentions = extractPromptMentionTokens(input.prompt);
	if (!input.userId || !input.projectId || mentions.length === 0) {
		return {
			mentions: mentions.map((item) => item.rawDisplay),
			matched: [],
			missing: [],
			ambiguous: [],
			assetInputs: [],
			referenceImages: [],
			resolvedMentionKeys: [],
		};
	}
	const assets: MentionBoundReferenceAsset[] = [];
	if (input.canvasFlowId) {
		const flow = await getFlowForOwner(
			getPrismaClient(),
			input.canvasFlowId,
			input.userId,
		);
		if (flow?.data) {
			try {
				assets.push(...collectFlowNodeMentionReferenceAssets(JSON.parse(flow.data)));
			} catch {
				// malformed flow payload should not block mention resolution
			}
		}
	}
	const rows = await listAssetsForUser(getPrismaClient(), input.userId, {
		projectId: input.projectId,
		kind: "generation",
		limit: 200,
	});
	assets.push(
		...rows
			.map((row) => parseMentionGenerationAsset(row))
			.filter((item): item is MentionBoundReferenceAsset => item !== null),
	);
	const lookup = buildBoundReferenceAssetLookup(assets);
	const matched: MentionBoundReferenceAsset[] = [];
	const missing: string[] = [];
	const ambiguous: string[] = [];
	const resolvedMentionKeys: string[] = [];
	for (const mention of mentions) {
		const picked = pickMentionBoundReferenceAsset(
			mention,
			lookup.get(mention.mentionKey) || [],
		);
		if (picked === "missing") {
			missing.push(mention.rawDisplay);
			continue;
		}
		if (picked === "ambiguous") {
			ambiguous.push(mention.rawDisplay);
			continue;
		}
		matched.push(picked);
		resolvedMentionKeys.push(mention.mentionKey);
	}
	const existingKeys = new Set(
		input.existingAssetInputs.map(
			(item) =>
				`${item.role}|${String(item.assetId || "").trim()}|${String(item.assetRefId || "").trim()}|${item.url}`,
		),
	);
	const assetInputs: AgentsBridgeAssetInput[] = [];
	const referenceImages: string[] = [];
	const seenReferenceImages = new Set<string>();
	for (const item of matched) {
		const referenceImageUrl = item.referenceImageUrl || item.url;
		const dedupeKey = `reference|${item.assetId}|${item.assetRefId}|${item.url}`;
		if (!existingKeys.has(dedupeKey)) {
			assetInputs.push({
				assetId: item.assetId,
				assetRefId: item.assetRefId,
				url: item.url,
				role: "reference",
				note: buildBoundReferenceNote(item),
				name: item.assetName,
			});
		}
		if (referenceImageUrl && !seenReferenceImages.has(referenceImageUrl)) {
			seenReferenceImages.add(referenceImageUrl);
			referenceImages.push(referenceImageUrl);
		}
		if (assetInputs.length >= 6 && referenceImages.length >= 6) break;
	}
	return {
		mentions: mentions.map((item) => item.rawDisplay),
		matched,
		missing,
		ambiguous,
		assetInputs,
		referenceImages,
		resolvedMentionKeys,
	};
}

async function resolveMentionRoleAssetInputs(input: {
	userId: string;
	projectId: string;
	bookId?: string;
	chapterId?: string;
	prompt: string;
	existingAssetInputs: AgentsBridgeAssetInput[];
	skipMentionKeys?: string[];
}): Promise<{
	mentions: string[];
	matched: MentionRoleReferenceAsset[];
	missing: string[];
	ambiguous: string[];
	assetInputs: AgentsBridgeAssetInput[];
	referenceImages: string[];
}> {
	const mentions = extractPromptMentionTokens(input.prompt);
	const skipMentionKeys = new Set(
		(input.skipMentionKeys || []).map((item) => normalizeRoleNameKey(item)),
	);
	const pendingMentions = mentions.filter(
		(item) => !skipMentionKeys.has(item.mentionKey),
	);
	if (!input.userId || !input.projectId || pendingMentions.length === 0) {
		return { mentions: pendingMentions.map((item) => item.rawDisplay), matched: [], missing: [], ambiguous: [], assetInputs: [], referenceImages: [] };
	}
	const chapter = input.chapterId ? parsePositiveChapterNumber(input.chapterId) : null;
	let roleAssets: MentionRoleReferenceAsset[] = [];
	if (input.bookId) {
		const indexData = await readBookIndexMeta({
			userId: input.userId,
			projectId: input.projectId,
			bookId: input.bookId,
		});
		if (indexData) {
			roleAssets = parseBookRoleReferenceAssets({ indexData, chapter });
		}
	}
	if (roleAssets.length === 0) {
		const rows = await listAssetsForUser(getPrismaClient(), input.userId, {
			projectId: input.projectId,
			kind: "projectRoleCard",
			limit: 200,
		});
		roleAssets = rows
			.map((row) => parseMentionRoleReferenceAsset(row))
			.filter((item): item is MentionRoleReferenceAsset => item !== null)
			.filter((item) => isRoleReferenceApplicableToChapter(item, chapter));
	}
	const roleAssetMap = new Map<string, MentionRoleReferenceAsset[]>();
	for (const item of roleAssets) {
		const list = roleAssetMap.get(item.roleNameKey) || [];
		list.push(item);
		roleAssetMap.set(item.roleNameKey, list);
	}
	const matched: MentionRoleReferenceAsset[] = [];
	const missing: string[] = [];
	const ambiguous: string[] = [];
	for (const mention of pendingMentions) {
		const picked = pickMentionRoleReferenceAsset(
			mention,
			sortRoleReferenceAssets(roleAssetMap.get(mention.mentionKey) || [], chapter),
		);
		if (picked === "missing") {
			missing.push(mention.rawDisplay);
			continue;
		}
		if (picked === "ambiguous") {
			ambiguous.push(mention.rawDisplay);
			continue;
		}
		matched.push(picked);
	}
	const existingKeys = new Set(
		input.existingAssetInputs.map(
			(item) =>
				`${item.role}|${String(item.assetId || "").trim()}|${String(item.assetRefId || "").trim()}|${item.url}`,
		),
	);
	const assetInputs: AgentsBridgeAssetInput[] = [];
	const referenceImages: string[] = [];
	const seenUrls = new Set<string>();
	for (const item of matched) {
		const dedupeKey = `character|${item.assetId}|${item.imageUrl}`;
		if (!existingKeys.has(dedupeKey)) {
			assetInputs.push({
				assetId: item.assetId,
				assetRefId: buildSemanticRoleReferenceAssetRefId(item),
				url: item.imageUrl,
				role: "character",
				note: buildRoleReferenceNote(`@${item.roleName}`, item),
				name: item.roleName,
			});
		}
		if (!seenUrls.has(item.imageUrl)) {
			seenUrls.add(item.imageUrl);
			referenceImages.push(item.imageUrl);
		}
		if (assetInputs.length >= 4 && referenceImages.length >= 4) break;
	}
	return {
		mentions: pendingMentions.map((item) => item.rawDisplay),
		matched,
		missing,
		ambiguous,
		assetInputs,
		referenceImages,
	};
}


type ChapterContinuityInjection = {
	chapter: number | null;
	roleNameKeys: string[];
	sceneNameKeys: string[];
	propNameKeys: string[];
	tailFrameUrl: string | null;
	assetInputs: AgentsBridgeAssetInput[];
	referenceImages: string[];
	roleReferenceCount: number;
	stateEvidenceRoleCount: number;
	threeViewRoleCount: number;
	missingRoleReferenceNames: string[];
	missingStateRoleNames: string[];
	missingThreeViewRoleNames: string[];
	scenePropReferenceCount: number;
	missingScenePropNames: string[];
	reasons: string[];
};

function buildChapterPreproductionMissingAssetNames(
	input: ChapterContinuityInjection,
): string[] {
	return Array.from(
		new Set<string>([
			...input.missingRoleReferenceNames,
			...input.missingStateRoleNames,
			...input.missingThreeViewRoleNames,
			...input.missingScenePropNames,
		].map((item) => String(item || "").trim()).filter(Boolean)),
	);
}

function resolveChapterPreproductionRequiredAssetCount(
	input: ChapterContinuityInjection,
): number {
	return buildChapterPreproductionMissingAssetNames(input).length;
}

function readBookStyleReferenceImages(indexData: BookIndexMeta | null | undefined): string[] {
	const assets = asRecord(indexData?.assets);
	const styleBible = asRecord(assets?.styleBible);
	const rawItems = Array.isArray(styleBible?.referenceImages) ? styleBible.referenceImages : [];
	const out: string[] = [];
	const seen = new Set<string>();
	for (const item of rawItems) {
		const url = typeof item === "string" ? item.trim() : "";
		if (!url || !/^https?:\/\//i.test(url) || seen.has(url)) continue;
		seen.add(url);
		out.push(url);
		if (out.length >= 4) break;
	}
	return out;
}

async function resolveChapterContinuityAssetInputs(input: {
	c: AppContext;
	userId: string;
	projectId: string;
	bookId: string;
	chapterId: string;
	existingAssetInputs: AgentsBridgeAssetInput[];
	mentionMatchedRoleNameKeys: string[];
}): Promise<ChapterContinuityInjection> {
	const chapter = parsePositiveChapterNumber(input.chapterId);
	if (!input.userId || !input.projectId || !input.bookId || chapter === null) {
			return {
				chapter,
				roleNameKeys: [],
				sceneNameKeys: [],
				propNameKeys: [],
				tailFrameUrl: null,
				assetInputs: [],
				referenceImages: [],
				roleReferenceCount: 0,
				stateEvidenceRoleCount: 0,
				threeViewRoleCount: 0,
				missingRoleReferenceNames: [],
				missingStateRoleNames: [],
				missingThreeViewRoleNames: [],
				scenePropReferenceCount: 0,
			missingScenePropNames: [],
			reasons: ["chapter_context_invalid"],
		};
	}
	const indexData = await readBookIndexMeta({
		userId: input.userId,
		projectId: input.projectId,
		bookId: input.bookId,
	});
	if (!indexData) {
			return {
				chapter,
				roleNameKeys: [],
				sceneNameKeys: [],
				propNameKeys: [],
				tailFrameUrl: null,
				assetInputs: [],
				referenceImages: [],
				roleReferenceCount: 0,
				stateEvidenceRoleCount: 0,
				threeViewRoleCount: 0,
				missingRoleReferenceNames: [],
				missingStateRoleNames: [],
				missingThreeViewRoleNames: [],
				scenePropReferenceCount: 0,
			missingScenePropNames: [],
			reasons: ["book_index_missing"],
		};
	}
	const collectChapterNamedAnchors = (
		items: BookChapterNamedEntityMeta[] | undefined,
	): Array<{ key: string; label: string }> => {
		if (!Array.isArray(items)) return [];
		const out: Array<{ key: string; label: string }> = [];
		const seen = new Set<string>();
		for (const item of items) {
			const label = String(item?.name || "").trim();
			const key = normalizeVisualReferenceNameKey(label);
			if (!label || !key || seen.has(key)) continue;
			seen.add(key);
			out.push({ key, label });
			if (out.length >= 8) break;
		}
		return out;
	};
	const collectChapterRequiredPropAnchors = (
		items: BookChapterPropMeta[] | undefined,
	): Array<{ key: string; label: string }> => {
		if (!Array.isArray(items)) return [];
		const out: Array<{ key: string; label: string }> = [];
		const seen = new Set<string>();
		for (const item of items) {
			const label = String(item?.name || "").trim();
			const key = normalizeVisualReferenceNameKey(label);
			const shouldRequireReference =
				item?.visualNeed === "must_render" || item?.reusableAssetPreferred === true;
			if (!label || !key || !shouldRequireReference || seen.has(key)) continue;
			seen.add(key);
			out.push({ key, label });
			if (out.length >= 8) break;
		}
		return out;
	};
	const reasons: string[] = [];
	let chapterRoleNameKeys = collectChapterRoleNameKeys(indexData, chapter);
	let effectiveIndexData = indexData;
	let currentChapterMeta = Array.isArray(indexData.chapters)
		? indexData.chapters.find((item) => Math.trunc(Number(item?.chapter || 0)) === chapter) || null
		: null;
	let chapterSceneAnchors = collectChapterNamedAnchors(currentChapterMeta?.scenes);
	let chapterPropAnchors = collectChapterRequiredPropAnchors(currentChapterMeta?.props);
	if (
		chapterRoleNameKeys.length === 0 ||
		(chapterSceneAnchors.length === 0 && chapterPropAnchors.length === 0)
	) {
		const ensured = await ensureChapterMetadataWindow({
			c: input.c,
			projectId: input.projectId,
			bookId: input.bookId,
			chapter,
		});
		if (ensured.ok) {
			const reloadedIndexData = await readBookIndexMeta({
				userId: input.userId,
				projectId: input.projectId,
				bookId: input.bookId,
			});
			if (reloadedIndexData) {
				effectiveIndexData = reloadedIndexData;
				chapterRoleNameKeys = collectChapterRoleNameKeys(reloadedIndexData, chapter);
				currentChapterMeta = Array.isArray(reloadedIndexData.chapters)
					? reloadedIndexData.chapters.find((item) => Math.trunc(Number(item?.chapter || 0)) === chapter) || null
					: null;
				chapterSceneAnchors = collectChapterNamedAnchors(currentChapterMeta?.scenes);
				chapterPropAnchors = collectChapterRequiredPropAnchors(currentChapterMeta?.props);
			}
		} else {
			reasons.push(`chapter_metadata_ensure_failed:${ensured.status || 0}`);
		}
	}
	if (chapterRoleNameKeys.length === 0) reasons.push("chapter_role_names_missing");
	let roleAssets = parseBookRoleReferenceAssets({ indexData: effectiveIndexData, chapter });
	if (roleAssets.length === 0) {
		roleAssets = (await listProjectRoleReferenceAssets({ userId: input.userId, projectId: input.projectId }))
			.filter((item) => isRoleReferenceApplicableToChapter(item, chapter));
	}
	const visualReferenceAssets = parseBookVisualReferenceAssets({
		indexData: effectiveIndexData,
		chapter,
	}).filter((item) => item.category === "scene_prop");
	const roleAssetMap = new Map<string, ProjectRoleReferenceAsset[]>();
	for (const item of roleAssets) {
		const list = roleAssetMap.get(item.roleNameKey) || [];
		list.push(item);
		roleAssetMap.set(item.roleNameKey, list);
	}
	const visualRefMap = new Map<string, MentionVisualReferenceAsset[]>();
	for (const item of visualReferenceAssets) {
		const list = visualRefMap.get(item.nameKey) || [];
		list.push(item);
		visualRefMap.set(item.nameKey, list);
	}
	const preferredRoleKeys = input.mentionMatchedRoleNameKeys.length > 0 ? input.mentionMatchedRoleNameKeys : chapterRoleNameKeys;
	const existingKeys = new Set(
		input.existingAssetInputs.map((item) => `${item.role}|${String(item.assetId || "").trim()}|${item.url}`),
	);
	const assetInputs: AgentsBridgeAssetInput[] = [];
	const referenceImages: string[] = [];
	const seenUrls = new Set<string>();
	const styleReferenceImages = readBookStyleReferenceImages(effectiveIndexData);
	const missingRoleReferenceNames: string[] = [];
	const missingStateRoleNames: string[] = [];
	const missingThreeViewRoleNames: string[] = [];
	const missingScenePropNames: string[] = [];
	let roleReferenceCount = 0;
	let stateEvidenceRoleCount = 0;
	let threeViewRoleCount = 0;
	let scenePropReferenceCount = 0;
	for (const roleNameKey of preferredRoleKeys) {
		const foundList = sortRoleReferenceAssets(roleAssetMap.get(roleNameKey) || [], chapter);
		const primaryRoleAsset = foundList[0] || null;
		const stateEvidenceAsset = foundList.find((item) => hasRoleAgeOrStateEvidence(item)) || null;
		const threeViewAsset = foundList.find((item) => Boolean(item.threeViewImageUrl)) || null;
		if (primaryRoleAsset) {
			roleReferenceCount += 1;
			if (threeViewAsset) {
				threeViewRoleCount += 1;
			} else {
				missingThreeViewRoleNames.push(primaryRoleAsset.roleName);
			}
			if (stateEvidenceAsset) {
				stateEvidenceRoleCount += 1;
				} else {
					missingStateRoleNames.push(primaryRoleAsset.roleName);
				}
		} else if (roleNameKey) {
			missingRoleReferenceNames.push(roleNameKey);
		}
		for (const found of foundList) {
			const dedupeKey = `character|${found.assetId}|${found.imageUrl}`;
			if (!existingKeys.has(dedupeKey)) {
				assetInputs.push({
					assetId: found.assetId,
					assetRefId: buildSemanticRoleReferenceAssetRefId(found),
					url: found.imageUrl,
					role: "character",
					note: buildRoleReferenceNote(`chapter-role:${found.roleName}`, found),
					name: found.roleName,
				});
			}
			if (!seenUrls.has(found.imageUrl)) {
				seenUrls.add(found.imageUrl);
				referenceImages.push(found.imageUrl);
			}
			if (assetInputs.length >= 4 && referenceImages.length >= 4) break;
		}
	}
	for (const sceneAnchor of chapterSceneAnchors) {
		const matched = sortVisualReferenceAssets(visualRefMap.get(sceneAnchor.key) || [], chapter)[0] || null;
		if (!matched) {
			missingScenePropNames.push(sceneAnchor.label);
			continue;
		}
		scenePropReferenceCount += 1;
		const dedupeKey = `scene|${matched.refId}|${matched.imageUrl}`;
		if (!existingKeys.has(dedupeKey)) {
			assetInputs.push({
				assetId: matched.refId,
				assetRefId: buildSemanticVisualReferenceAssetRefId({
					role: "scene",
					name: matched.name,
				}),
				url: matched.imageUrl,
				role: "scene",
				note: buildVisualReferenceNote(`chapter-scene:${matched.name}`, matched),
				name: matched.name,
			});
		}
		if (!seenUrls.has(matched.imageUrl)) {
			seenUrls.add(matched.imageUrl);
			referenceImages.push(matched.imageUrl);
		}
	}
	for (const propAnchor of chapterPropAnchors) {
		const matched = sortVisualReferenceAssets(visualRefMap.get(propAnchor.key) || [], chapter)[0] || null;
		if (!matched) {
			missingScenePropNames.push(propAnchor.label);
			continue;
		}
		scenePropReferenceCount += 1;
		const dedupeKey = `prop|${matched.refId}|${matched.imageUrl}`;
		if (!existingKeys.has(dedupeKey)) {
			assetInputs.push({
				assetId: matched.refId,
				assetRefId: buildSemanticVisualReferenceAssetRefId({
					role: "prop",
					name: matched.name,
				}),
				url: matched.imageUrl,
				role: "prop",
				note: buildVisualReferenceNote(`chapter-prop:${matched.name}`, matched),
				name: matched.name,
			});
		}
		if (!seenUrls.has(matched.imageUrl)) {
			seenUrls.add(matched.imageUrl);
			referenceImages.push(matched.imageUrl);
		}
	}
	if (preferredRoleKeys.length > 0 && roleReferenceCount <= 0) {
		reasons.push("chapter_role_reference_missing");
	}
	if (missingRoleReferenceNames.length > 0) {
		reasons.push("chapter_role_reference_partial_missing");
	}
	if (preferredRoleKeys.length > 0 && stateEvidenceRoleCount <= 0) {
		reasons.push("chapter_role_state_evidence_missing");
	}
	if (missingStateRoleNames.length > 0) {
		reasons.push("chapter_role_state_evidence_partial_missing");
	}
	if (preferredRoleKeys.length > 0 && threeViewRoleCount <= 0) {
		reasons.push("chapter_role_three_view_missing");
	}
	if (missingThreeViewRoleNames.length > 0) {
		reasons.push("chapter_role_three_view_partial_missing");
	}
	if (chapterSceneAnchors.length + chapterPropAnchors.length > 0 && scenePropReferenceCount <= 0) {
		reasons.push("chapter_scene_prop_reference_missing");
	}
	if (missingScenePropNames.length > 0) {
		reasons.push("chapter_scene_prop_reference_partial_missing");
	}
	const tailFrameUrl = selectLatestTailFrameUrl(effectiveIndexData, chapter);
	if (!tailFrameUrl) reasons.push("chapter_tail_frame_missing");
	if (tailFrameUrl && !seenUrls.has(tailFrameUrl)) {
		const contextDedupeKey = `context||${tailFrameUrl}`;
		if (!existingKeys.has(contextDedupeKey)) {
			assetInputs.push({
				url: tailFrameUrl,
				role: "context",
				note: `storyboard-tail:chapter-${chapter}`,
				name: `chapter-${chapter}-tail-frame`,
			});
		}
		referenceImages.push(tailFrameUrl);
	}
	for (const styleImageUrl of styleReferenceImages) {
		const styleDedupeKey = `style||${styleImageUrl}`;
		if (!existingKeys.has(styleDedupeKey)) {
			assetInputs.push({
				url: styleImageUrl,
				role: "style",
				note: `style-bible:chapter-${chapter}`,
				name: `chapter-${chapter}-style-anchor`,
			});
		}
		if (!seenUrls.has(styleImageUrl)) {
			seenUrls.add(styleImageUrl);
			referenceImages.push(styleImageUrl);
		}
	}
	return {
		chapter,
		roleNameKeys: preferredRoleKeys.slice(0, 8),
		sceneNameKeys: chapterSceneAnchors.map((item) => item.key).slice(0, 8),
		propNameKeys: chapterPropAnchors.map((item) => item.key).slice(0, 8),
		tailFrameUrl,
		assetInputs,
		referenceImages,
		roleReferenceCount,
		stateEvidenceRoleCount,
		threeViewRoleCount,
		missingRoleReferenceNames: Array.from(new Set(missingRoleReferenceNames)).slice(0, 8),
		missingStateRoleNames: Array.from(new Set(missingStateRoleNames)).slice(0, 8),
		missingThreeViewRoleNames: Array.from(new Set(missingThreeViewRoleNames)).slice(0, 8),
		scenePropReferenceCount,
		missingScenePropNames: Array.from(new Set(missingScenePropNames)).slice(0, 8),
		reasons,
	};
}

function readRequestHeader(c: AppContext, key: string): string {
	const v = c.req.header(key);
	return typeof v === "string" ? v.trim() : "";
}

function resolveEffectiveUserId(c: AppContext, inputUserId: string): string {
	const direct = String(inputUserId || "").trim();
	if (direct) return direct;
	const fromCtxUserId = String((c as any).get?.("userId") || "").trim();
	if (fromCtxUserId) return fromCtxUserId;
	const fromCtxApiKeyOwnerId = String((c as any).get?.("apiKeyOwnerId") || "").trim();
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

type CharacterContinuityNote = {
	age: string;
	state: string;
	stateLabel: string;
	stateKey: string;
};

function parseCharacterContinuityNote(note: string): CharacterContinuityNote {
	const parsed: CharacterContinuityNote = {
		age: "",
		state: "",
		stateLabel: "",
		stateKey: "",
	};
	for (const segment of String(note || "").split("|")) {
		const item = segment.trim();
		if (!item) continue;
		if (item.startsWith("age=")) {
			parsed.age = item.slice("age=".length).trim();
			continue;
		}
		if (item.startsWith("state=")) {
			parsed.state = item.slice("state=".length).trim();
			continue;
		}
		if (item.startsWith("stateLabel=")) {
			parsed.stateLabel = item.slice("stateLabel=".length).trim();
			continue;
		}
		if (item.startsWith("stateKey=")) {
			parsed.stateKey = item.slice("stateKey=".length).trim();
			continue;
		}
	}
	return parsed;
}

function collectCharacterContinuityPromptLines(assetInputs: AgentsBridgeAssetInput[]): string[] {
	const lines: string[] = [];
	const seen = new Set<string>();
	for (const item of assetInputs) {
		if (item.role !== "character") continue;
		const parsed = parseCharacterContinuityNote(String(item.note || ""));
		const roleName = String(item.name || item.assetRefId || item.assetId || item.url || "角色").trim();
		const ageLine = parsed.age ? `- ${roleName} 年龄锚点：${parsed.age}` : "";
		const stateParts = [parsed.stateLabel, parsed.state].filter(Boolean);
		const stateLine =
			stateParts.length > 0
				? `- ${roleName} 状态锚点：${stateParts.join("；")}${
						parsed.stateKey ? `（stateKey=${parsed.stateKey}）` : ""
				  }`
				: "";
		for (const line of [ageLine, stateLine]) {
			if (!line || seen.has(line)) continue;
			seen.add(line);
			lines.push(line);
		}
	}
	return lines;
}

const RUNTIME_REFERENCE_CONTEXT_START_TAG = "<tapcanvas_runtime_reference_context>";
const RUNTIME_REFERENCE_CONTEXT_END_TAG = "</tapcanvas_runtime_reference_context>";

function decoratePromptWithReferenceImages(
	prompt: string,
	referenceImages: string[],
	assetInputs: AgentsBridgeAssetInput[],
	referenceImageSlots: AgentsBridgeReferenceImageSlot[],
	selectedReference: AgentsBridgeChatContext["selectedReference"],
	options?: {
		suppressProductIntegrity?: boolean;
	},
): string {
	const base = typeof prompt === "string" ? prompt : "";
	if (!referenceImages.length && !assetInputs.length) return base;
	if (base.includes(RUNTIME_REFERENCE_CONTEXT_START_TAG)) return base;
	const hasCharacterReference = assetInputs.some((item) => item.role === "character");
	const hasSubjectIntegrityReference = assetInputs.some(
		(item) => item.role === "product" || item.role === "target" || item.role === "reference",
	);
	const hasEnvironmentReference = assetInputs.some(
		(item) => item.role === "scene" || item.role === "prop" || item.role === "context",
	);
	const characterContinuityLines = collectCharacterContinuityPromptLines(assetInputs);
	const suppressProductIntegrity = options?.suppressProductIntegrity === true;
	const blocks: string[] = [];
	if (assetInputs.length) {
		blocks.push(
			"【资产输入】",
			...assetInputs.map((item, idx) => {
				const parts = [
					`#${idx + 1}`,
					`role=${item.role}`,
					`url=${item.url}`,
					item.assetId ? `assetId=${item.assetId}` : "",
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
			"【参考图图位协议】",
			"- 对第三方图片/视频模型，参考图的有效语义是图位顺序，不是字段名 `referenceImages` 本身。",
			...(referenceImageSlots.length > 2
				? [
					"- 当前参考资产超过 2 张时，执行层会先把它们合成为一张带右下角资产 id/名字标记的拼图参考板。",
					"- 这种情况下，最终执行 prompt 不要再逐张写 `图1/图2/图3` 职责分配，而要按资产 id / 名称引用，例如 `@li_changan`、`@night_market`。",
				]
				: [
					"- 参考资产不超过 2 张时，你在最终执行 prompt 里必须显式使用 `图1`、`图2` 这种图位编号来引用这些参考图。",
					"- 若不同参考图承担不同职责，必须按图位写清楚，例如“人物外观严格参考图1，场景与光线延续图2”。",
				]),
			"",
		);
	}
	if (referenceImageSlots.length) {
		blocks.push(
			"【参考图图位清单】",
			...referenceImageSlots.map((slot) => {
				const parts = [slot.slot, `url=${slot.url}`];
				if (slot.role) parts.push(`role=${slot.role}`);
				if (slot.label) parts.push(`label=${slot.label}`);
				if (slot.note) parts.push(`note=${slot.note}`);
				return `- ${parts.join(" | ")}`;
			}),
			"",
		);
	} else {
		blocks.push("【参考图】", ...referenceImages.map((url) => `- ${url}`), "");
	}
	if (hasCharacterReference) {
		blocks.push(
			"【角色参考一致性约束】",
			"- 角色参考图锁定角色身份：脸型、发型、服装主轮廓、配色与可识别特征必须保持一致。",
			"- 允许调整景别、机位、光线与动作，但不得把同一角色改成另一张脸或另一套核心服设。",
			"- 多角色同场时，必须维持各角色之间的体型、站位关系与主次关系，不得串脸。",
			"- 若文字描述与角色参考图冲突，以角色参考图中的身份锚点为准。",
		);
	}
	if (hasSubjectIntegrityReference && !suppressProductIntegrity) {
		blocks.push(
			"【参考主体保真硬约束】",
			"- 参考图中的主体对象必须保持同一对象：外轮廓、比例、结构、关键开孔/按键/接口位置不可改变。",
			"- 保持完整主体，不得裁掉关键部件；禁止只保留局部导致主体信息不完整。",
			"- 保持主材质与颜色一致（允许正常光照变化，不允许改色改材质）。",
			"- 允许改变背景、道具与模特姿态，但主体对象不得被重绘成不同款式。",
			"- 若参考图本身是纯净背景主体图，优先保留主体边界清晰、无形变、无遮挡。",
		);
	} else if (hasEnvironmentReference) {
		blocks.push(
			"【场景与道具连续性约束】",
			"- 场景参考图锁定空间结构、地标、主光方向与环境材质，不得无因跳场景。",
			"- 道具参考图锁定材质、比例、关键结构与摆放关系，不得替换成另一件相似但不同的物件。",
			"- 当角色参考与场景/道具参考同时存在时，必须同时保持人物身份和环境连续性，不能只保留其中一半。",
		);
	} else if (!hasCharacterReference && suppressProductIntegrity) {
		blocks.push(
			"【视觉参考使用约束】",
			"- 当前参考图仅作为视觉锚点与连续性证据，不自动等同于既有图主体替换任务。",
			"- 若任务绑定章节/分镜/视频节点等 project-grounded 创作上下文，应优先服从章节文本、镜头关系与画布目标。",
			"- 仅当用户明确要求复刻/替换既有图主体时，才把版式保留与主体替换视为主目标。",
		);
	}
	if (characterContinuityLines.length > 0) {
		blocks.push(
			"【角色年龄与状态连续性约束】",
			...characterContinuityLines,
			"- 章节续写默认保持状态连续；若需要从“重伤/濒死”转为“恢复/无伤”，必须在 continuityConstraints 明确恢复原因与时间跨度。",
			"",
		);
	}
	const identityLines: string[] = [];
	if (selectedReference?.roleName?.trim()) {
		identityLines.push(`- 当前已明确绑定角色：${selectedReference.roleName.trim()}。最终执行 prompt 不得退回“默认少年/默认人物/未命名角色”。`);
	}
	if (selectedReference?.roleCardId?.trim()) {
		identityLines.push(`- 当前已明确绑定角色卡：${selectedReference.roleCardId.trim()}。若创建执行节点，必须把该角色绑定以 assetInputs(role=character) 或真实连边保留下来。`);
	}
	if (selectedReference?.authorityBaseFrameNodeId?.trim()) {
		identityLines.push(`- 当前已明确权威基底帧节点：${selectedReference.authorityBaseFrameNodeId.trim()}。若没有上游边，必须显式落 referenceImages / assetInputs，不能只靠文字描述“参考已有图片”。`);
	}
	if (selectedReference?.authorityBaseFrameStatus === "confirmed") {
		identityLines.push("- authorityBaseFrame.status=confirmed，后续图片/分镜节点不得使用 generic/default 主体占位。");
	}
	if (identityLines.length > 0) {
		blocks.push("【身份锁定】", ...identityLines, "");
	}
	const runtimeReferenceContext = [
		RUNTIME_REFERENCE_CONTEXT_START_TAG,
		...blocks,
		RUNTIME_REFERENCE_CONTEXT_END_TAG,
	].join("\n");
	return [runtimeReferenceContext, base].filter(Boolean).join("\n\n");
}

function buildChapterAssetRepairDiagnosticContext(input: {
	workspaceAction:
		| "chapter_script_generation"
		| "chapter_asset_generation"
		| "shot_video_generation"
		| null;
	chapterContinuityInjection: ChapterContinuityInjection;
}): Record<string, unknown> {
	if (input.workspaceAction !== "chapter_asset_generation") return {};
	const missingAssetNames = buildChapterPreproductionMissingAssetNames(
		input.chapterContinuityInjection,
	);
	if (missingAssetNames.length <= 0) {
		return {
			chapterAssetRepairRequired: false,
			chapterAssetPreproductionRequiredCount: 0,
		};
	}
	return {
		chapterAssetRepairRequired: true,
		chapterAssetPreproductionRequiredCount: missingAssetNames.length,
		chapterMissingReusableAssets: missingAssetNames,
		chapterMissingRoleReferences:
			input.chapterContinuityInjection.missingRoleReferenceNames,
		chapterMissingRoleStates: input.chapterContinuityInjection.missingStateRoleNames,
		chapterMissingRoleThreeViews:
			input.chapterContinuityInjection.missingThreeViewRoleNames,
		chapterMissingSceneProps: input.chapterContinuityInjection.missingScenePropNames,
	};
}

export function readAgentsBridgeBaseUrl(c: AppContext): string {
	const rawFromEnv =
		typeof c.env.AGENTS_BRIDGE_BASE_URL === "string"
			? c.env.AGENTS_BRIDGE_BASE_URL
			: "";
	const rawFromProcess =
		typeof (globalThis as any)?.process?.env?.AGENTS_BRIDGE_BASE_URL === "string"
			? String((globalThis as any).process.env.AGENTS_BRIDGE_BASE_URL)
			: "";
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
		typeof (globalThis as any)?.process?.env?.TAPCANVAS_API_INTERNAL_BASE === "string"
			? String((globalThis as any).process.env.TAPCANVAS_API_INTERNAL_BASE)
			: "";
	const rawProcessBase =
		typeof (globalThis as any)?.process?.env?.TAPCANVAS_API_BASE_URL === "string"
			? String((globalThis as any).process.env.TAPCANVAS_API_BASE_URL)
			: "";
	const raw = rawInternal || rawBase || rawProcessInternal || rawProcessBase;
	return raw.trim().replace(/\/+$/, "");
}

function buildTapCanvasFlowPatchDescription(input: {
	hideStoryboardEditor: boolean;
}): string {
	const visualKinds = input.hideStoryboardEditor
		? "image / imageEdit / storyboardImage / video / composeVideo"
		: "image / storyboard / video / composeVideo";
	const imageLikeKinds = input.hideStoryboardEditor
		? "image / imageEdit / storyboardImage"
		: "image / storyboard";
	const lines = [
		`Patch the current TapCanvas flow graph in the authorized project/flow scope.`,
		"deleteNodeIds removes existing nodes by id and also removes any connected edges in the same persisted write.",
		"deleteEdgeIds removes existing edges by id without touching nodes.",
		`Create new nodes only with the real frontend node protocol. Supported createNodes object types are ${REMOTE_FLOW_CREATE_NODE_TYPES.join(" / ")} only.`,
		"Asset generation is executed by the web app after runnable nodes are added.",
		`When the current run already carries referenceImageSlots / referenceImages / assetInputs and you create executable ${visualKinds} nodes that must reuse them, persist the real reference inputs into node data or create explicit upstream edges; never rely on prompt wording alone to preserve references.`,
		"If the current turn already binds a role card / authorityBaseFrame / selectedReference, your created node must preserve that identity explicitly and must not fall back to a generic default person.",
		"If createEdges references a node created in the same request, every referenced createNode must declare an explicit stable id first; labels are never valid node ids for edges.",
		"Child nodes that declare parentId must use positions relative to that parent group, not absolute canvas coordinates.",
		"When the same flow_patch batch writes grouped nodes, persisted node order is normalized parent-first and each affected group is compacted after write. Put the group node before its children, and list grouped children in the exact visual order you want preserved.",
		"A blank text node must be a taskNode with data.kind='text', for example {type:'taskNode', position:{x:number,y:number}, data:{kind:'text', label:'', content:'', nodeWidth:220, nodeHeight:120}}.",
		"Do not invent textNode or other unsupported object types.",
		...(!input.hideStoryboardEditor
			? [
				"A taskNode with data.kind='storyboard' is the front-end storyboard editor image grid, not a text container. Only use storyboard when you are providing storyboardEditorCells or the user explicitly asked for an empty storyboard board.",
				"On storyboard nodes, storyboardEditorCells[*].prompt is the execution prompt and storyboardEditorCells[*].imageUrl is the factual asset URL; runtime-only fields such as status / progress / runToken / lastResult are diagnostics only and do not replace board config.",
			  ]
			: []),
		`For chapter-grounded visual production, every created or patched ${imageLikeKinds} / composeVideo / video node in the same flow_patch batch must already carry data.productionLayer / data.creationStage / data.approvalStatus plus complete data.productionMetadata.`,
		"Example: productionMetadata:{chapterGrounded:true,lockedAnchors:{character:['role:a'],scene:['寨楼'],shot:['推窗'],continuity:[],missing:[]},authorityBaseFrame:{status:'planned',source:'chapter_context',reason:'缺少已确认基底帧',nodeId:null}}.",
		"Do not omit chapterGrounded:true and do not plan a follow-up cleanup patch just to add metadata.",
		"When the user explicitly asks to connect / wire / attach a reference node to another node, prefer createEdges with the real source/target node ids instead of only copying URLs into patchNodeData.",
		"Edge handles must be exact frontend handle ids such as out-image / in-image / out-video / in-any.",
		"Handle matrix: text-like nodes such as text / storyboardScript / novelDoc / scriptDoc use source handles out-text / out-text-wide and have no target handles; image-like nodes such as image / imageEdit / storyboardImage use in-image / in-image-wide and out-image / out-image-wide; video-like nodes such as video / composeVideo use in-any / in-any-wide and out-video / out-video-wide.",
		...(!input.hideStoryboardEditor
			? [
				"Storyboard nodes also use in-image / in-image-wide and out-image / out-image-wide; do not use in-any for storyboard nodes.",
			  ]
			: []),
		"Never invent semantic aliases like image / reference / out-any for text nodes.",
		"Example edge: {source:'role-card-node-id', target:'image-node-id', sourceHandle:'out-image', targetHandle:'in-image'}.",
		"appendNodeArrays only appends items into data[key] of an existing node id, never targets the flow root. The item shape is {id:'node-id', key:'arrayField', items:[...]}; items is required.",
		...(!input.hideStoryboardEditor
			? [
				"If you are replacing the whole storyboardEditorCells array, prefer patchNodeData with data.storyboardEditorCells instead of appendNodeArrays.",
			  ]
			: []),
		"patchNodeData only patches data of an existing node.",
	];
	return lines.join(" ");
}

export function buildAgentsBridgeRemoteTools(input: {
	publicAgentsRequest: boolean;
	canvasProjectId: string | null;
	canvasFlowId: string | null;
	hideStoryboardEditor?: boolean;
}): AgentsBridgeRemoteToolDefinition[] {
	if (!input.publicAgentsRequest) return [];
	const projectId = String(input.canvasProjectId || "").trim();
	const flowId = String(input.canvasFlowId || "").trim();
	const hideStoryboardEditor = input.hideStoryboardEditor === true;
	const remoteFlowTaskNodeKinds = hideStoryboardEditor
		? REMOTE_FLOW_TASK_NODE_KINDS_WITHOUT_STORYBOARD
		: REMOTE_FLOW_TASK_NODE_KINDS;
	if (!projectId && !flowId) return [];
	const tools: AgentsBridgeRemoteToolDefinition[] = [];
	if (projectId) {
		tools.push(
			{
				name: "tapcanvas_project_flows_list",
				description:
					"List flows in the current authorized TapCanvas project. Use when the project is known but you need to inspect or choose the most relevant flow.",
				parameters: {
					type: "object",
					properties: {},
					additionalProperties: false,
				},
			},
			{
				name: "tapcanvas_project_context_get",
				description:
					"Read the current authorized project workspace context assembled by hono-api. Use this when you need project-level evidence, context files, or book/chapter-scoped workspace summaries before planning.",
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
				name: "tapcanvas_books_list",
				description:
					"List uploaded books in the current authorized TapCanvas project. Returns bookId, title, chapterCount, and updatedAt.",
				parameters: {
					type: "object",
					properties: {},
					additionalProperties: false,
				},
			},
			{
				name: "tapcanvas_book_index_get",
				description:
					"Read one book index.json in the current authorized TapCanvas project. Use this to inspect chapter metadata, assets.storyboardChunks, and other book-level facts.",
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
				name: "tapcanvas_book_chapter_get",
				description:
					"Read one chapter正文 from a book in the current authorized TapCanvas project. Returns chapter text plus summary, keywords, characters, props, scenes, and locations when available.",
				parameters: {
					type: "object",
					properties: {
						bookId: { type: "string" },
						chapter: { type: "number" },
					},
					required: ["bookId", "chapter"],
					additionalProperties: false,
				},
			},
			{
				name: "tapcanvas_book_storyboard_plan_get",
				description:
					"Read persisted storyboard plan metadata for one chapter from the current authorized TapCanvas book index. Use this to inspect saved storyboardPlans / shotPrompts / storyboardStructured before deciding whether a chapter already has a real saved plan. Do not probe write tools just to test existence.",
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
					"Write chapter storyboard plan metadata into the current authorized TapCanvas book index. Use this to persist storyboardPlans / shotPrompts after generating the current chapter script so the workspace can refresh from real saved data.",
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
						storyboardContent: { type: "string" },
						storyboardStructured: { type: "object", additionalProperties: true },
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
					required: ["bookId", "chapter"],
					additionalProperties: false,
				},
			},
			{
				name: "tapcanvas_storyboard_continuity_get",
				description:
					"Read storyboard continuity evidence for one book chapter chunk in the current authorized TapCanvas project. Returns previous tail frame, chapter chunk history, matched role references, scene/spell references, and continuity constraints derived from current book metadata.",
				parameters: {
					type: "object",
					properties: {
						bookId: { type: "string" },
						chapter: { type: "number" },
						groupSize: { type: "number", enum: [1, 4, 9, 25] },
						chunkIndex: { type: "number" },
						shotPrompts: { type: "array", items: { type: "string" } },
						scenePropRefId: { type: "string" },
						spellFxRefId: { type: "string" },
					},
					required: ["bookId", "chapter", "groupSize", "chunkIndex"],
					additionalProperties: false,
				},
			},
			{
				name: "tapcanvas_pipeline_runs_list",
				description:
					"List agent pipeline runs in the current authorized project. Use this to inspect ongoing or completed agent production runs before deciding next actions.",
				parameters: {
					type: "object",
					properties: {
						limit: { type: "number" },
					},
					additionalProperties: false,
				},
			},
			{
				name: "tapcanvas_pipeline_run_get",
				description:
					"Read one agent pipeline run by runId in the current authorized project scope.",
				parameters: {
					type: "object",
					properties: {
						runId: { type: "string" },
					},
					required: ["runId"],
					additionalProperties: false,
				},
			},
		);
	}
	if (!flowId) return tools;
	tools.push(
		{
			name: "tapcanvas_storyboard_source_bundle_get",
			description:
				"Read a real storyboard source bundle for the current authorized TapCanvas project/flow. Returns project workspace context, the resolved chapter正文 slice, current flow relevant node summaries, and diagnostics.progress/recentShots for locating the next storyboard or single-video step.",
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
				"List workflow executions for the current authorized flow. Use when you need recent execution history before inspecting a specific execution.",
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
				"Read one workflow execution by executionId in the current authorized flow scope.",
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
			name: "tapcanvas_flow_get",
			description:
				`Read the current TapCanvas flow graph in the authorized project/flow scope. Use this first to inspect existing node objects before patching. Current supported createNodes object types are ${REMOTE_FLOW_CREATE_NODE_TYPES.join(" / ")}. For taskNode, read data.kind from existing nodes instead of inventing unsupported node types.`,
			parameters: {
				type: "object",
				properties: {},
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
							"When false, patchNodeData conflicts on existing non-null fields raise an error instead of silently overwriting.",
					},
					deleteNodeIds: {
						type: "array",
						description:
							"Delete existing nodes by their real node ids. Connected edges are removed automatically.",
						items: { type: "string" },
					},
					deleteEdgeIds: {
						type: "array",
						description:
							"Delete existing edges by their real edge ids without deleting nodes.",
						items: { type: "string" },
					},
					createNodes: {
						type: "array",
						description:
							"Create new nodes with the real frontend protocol. Supported object types are taskNode and groupNode only.",
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
											description:
												"General executable/content node. For blank text placeholders, use taskNode with data.kind='text'.",
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
												content: {
													type: "string",
													description:
														"Optional plain text content for text-like task nodes.",
												},
												prompt: { type: "string" },
												structuredPrompt: {
													type: "object",
													description:
														"Optional ImagePromptSpecV2-style JSON mirror of prompt. For chapter-grounded visual nodes with existing references, include referenceBindings and identityConstraints instead of leaving reference reuse implicit.",
												},
												systemPrompt: { type: "string" },
												negativePrompt: { type: "string" },
												roleName: {
													type: "string",
													description:
														"Semantic character binding label for this node. Never synthesize from task ids; use the real recurring subject name such as 方源 / 方正.",
												},
												roleId: {
													type: "string",
													description:
														"Optional stable character graph id aligned with the current book metadata.",
												},
												roleCardId: {
													type: "string",
													description:
														"Optional persisted book/project role card id. Use when the node is bound to an existing role card asset.",
												},
												sourceBookId: {
													type: "string",
													description:
														"Book scope id for chapter-grounded nodes. Required when the node should persist back into chapter assets.",
												},
												materialChapter: {
													type: "number",
													description:
														"Chapter number that this node belongs to. Prefer the real chapter scope instead of burying it only in free text.",
												},
												stateDescription: {
													type: "string",
													description:
														"Character or visual anchor state evidence, e.g. 少年方源，十五岁，神情冷静。 Use this to disambiguate repeated subjects.",
												},
												referenceView: {
													type: "string",
													enum: ["three_view", "role_card"],
													description:
														"When the node itself is a reusable character anchor, mark whether the persisted image is a three-view asset or a generic role-card still.",
												},
												scenePropRefId: {
													type: "string",
													description:
														"Optional persisted scene/prop reference id for reusable environment anchor nodes.",
												},
												scenePropRefName: {
													type: "string",
													description:
														"Human-readable scene/prop anchor name, e.g. 古月寨学堂 / 春秋蝉木盒.",
												},
												visualRefId: {
													type: "string",
													description:
														"Generic reusable visual reference id. Prefer this together with visualRefName/visualRefCategory for scene/prop or spell-fx anchor nodes.",
												},
												visualRefName: {
													type: "string",
													description:
														"Human-readable visual reference name for scene/prop/spell anchor nodes.",
												},
												visualRefCategory: {
													type: "string",
													enum: ["scene_prop", "spell_fx"],
													description:
														"Persisted visual reference category. Use scene_prop for reusable场景/道具锚点.",
												},
												referenceImages: {
													type: "array",
													description:
														hideStoryboardEditor
															? "Executable reference image URLs for image/imageEdit/storyboardImage/video/composeVideo nodes. Use this when the current run already has reference images but there is no upstream canvas edge to carry them. If the turn already binds a confirmed authorityBaseFrame or selected reference image, omitting this field requires an explicit createEdges binding instead."
															: "Executable reference image URLs for image/storyboard/video nodes. Use this when the current run already has reference images but there is no upstream canvas edge to carry them. If the turn already binds a confirmed authorityBaseFrame or selected reference image, omitting this field requires an explicit createEdges binding instead.",
													items: { type: "string" },
												},
												assetInputs: {
													type: "array",
													description:
														"Optional structured visual inputs mirrored from the current chat request. Prefer this when the node must preserve target/reference/character/scene/prop/style roles without inventing local semantics. If the request is character-bound, at least one character role binding is expected unless a real edge carries that role card/reference node. Reusable scene/prop anchors should keep their real semantic role instead of collapsing to a generic reference.",
													items: {
														type: "object",
												properties: {
													assetId: { type: "string" },
													assetRefId: { type: "string" },
													url: { type: "string" },
													role: { type: "string" },
													name: { type: "string" },
															note: { type: "string" },
														},
														required: ["url"],
													},
												},
												firstFrameUrl: {
													type: "string",
													description:
														"Explicit first-frame image URL for video / composeVideo nodes.",
												},
												lastFrameUrl: {
													type: "string",
													description:
														"Explicit last-frame image URL for video / composeVideo nodes.",
												},
												nodeWidth: { type: "number" },
												nodeHeight: { type: "number" },
												productionLayer: {
													type: "string",
													enum: [
														"evidence",
														"constraints",
														"anchors",
														"expansion",
														"execution",
														"results",
													],
												},
												creationStage: {
													type: "string",
													enum: [
														"source_understanding",
														"constraint_definition",
														"world_anchor_lock",
														"character_anchor_lock",
														"shot_anchor_lock",
														"single_variable_expansion",
														"approved_keyframe_selection",
														"video_plan",
														"video_execution",
														"result_persistence",
													],
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
												productionMetadata: {
													type: "object",
													description:
														"Structured chapter-grounded continuity contract. Use on a companion text/storyboardScript node or script patch when locking anchors before bulk visual writes.",
													properties: {
														chapterGrounded: { type: "boolean" },
														lockedAnchors: {
															type: "object",
															properties: {
																character: {
																	type: "array",
																	items: { type: "string" },
																},
																scene: {
																	type: "array",
																	items: { type: "string" },
																},
																shot: {
																	type: "array",
																	items: { type: "string" },
																},
																continuity: {
																	type: "array",
																	items: { type: "string" },
																},
																missing: {
																	type: "array",
																	items: { type: "string" },
																},
															},
															required: [
																"character",
																"scene",
																"shot",
																"continuity",
																"missing",
															],
														},
														authorityBaseFrame: {
															type: "object",
															properties: {
																status: {
																	type: "string",
																	enum: ["planned", "confirmed"],
																},
																source: { type: "string" },
																reason: { type: "string" },
																nodeId: { type: "string" },
															},
															required: ["status", "source", "reason"],
														},
													},
												},
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
																		imageUrl: { type: "string" },
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
											description:
												"Visual grouping container node. Requires style.width and style.height.",
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
						description:
							"Create edges between existing or newly created node ids. Use this when the user explicitly asks to connect or attach nodes, especially for reference-image wiring. Each item must include source and target, and may include sourceHandle/targetHandle when the handle matters. Handle ids must match the real frontend protocol exactly.",
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
						description:
							"Patch data of an existing node id. This never creates nodes and only merges into node.data.",
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
						description:
							"Append items into data[key] of an existing node id. This does not target the flow root object.",
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
	return tools;
}

function isNodeRuntime(): boolean {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const processRef = (globalThis as any)?.process;
	return !!processRef?.versions?.node;
}

function isConnRefusedError(err: unknown): boolean {
	const msg = String((err as any)?.message || "");
	const cause = String((err as any)?.cause?.message || "");
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
	const fromProcess = (globalThis as any)?.process?.env?.AGENTS_BRIDGE_DEBUG_LOG;
	return readBoolEnvFlag(fromProcess);
}

function shouldDropOnHeadersTimeout(c: AppContext, request: TaskRequestDto): boolean {
	const extras = (request as any)?.extras as Record<string, any> | undefined;
	if (typeof extras?.bridgeDropOnTimeout === "boolean") return extras.bridgeDropOnTimeout;
	const fromEnv = readBoolEnvFlag(c.env.AGENTS_BRIDGE_DROP_ON_TIMEOUT);
	if (fromEnv) return true;
	const fromProcess = (globalThis as any)?.process?.env?.AGENTS_BRIDGE_DROP_ON_TIMEOUT;
	if (typeof fromProcess !== "undefined") return readBoolEnvFlag(fromProcess);
	// Default on: timeout-drop avoids whole request failure in long multi-tool runs.
	return true;
}

function isHeadersTimeoutError(err: unknown): boolean {
	const msg = String((err as any)?.message || "");
	const causeMsg = String((err as any)?.cause?.message || "");
	const code = String((err as any)?.code || (err as any)?.cause?.code || "");
	const combined = `${msg}\n${causeMsg}`.toLowerCase();
	return (
		combined.includes("headers timeout") ||
		combined.includes("und_err_headers_timeout") ||
		code === "UND_ERR_HEADERS_TIMEOUT"
	);
}

async function createNodeFetchDispatcher(timeoutMs: number): Promise<unknown | null> {
	if (!isNodeRuntime()) return null;
	const key = Math.max(5_000, Math.floor(timeoutMs));
	if (nodeFetchDispatcherCache.has(key)) {
		return nodeFetchDispatcherCache.get(key) || null;
	}
	try {
		const undici = (await import("undici")) as any;
		if (!undici?.Agent) return null;
		const dispatcher = new undici.Agent({
			headersTimeout: key + 15_000,
			bodyTimeout: key + 15_000,
		});
		nodeFetchDispatcherCache.set(key, dispatcher);
		return dispatcher;
	} catch {
		return null;
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
		const processBase =
			typeof (globalThis as any)?.process?.env?.AGENTS_BRIDGE_BASE_URL === "string"
				? String((globalThis as any).process.env.AGENTS_BRIDGE_BASE_URL).trim()
				: "";
		if (processBase) {
			(c.env as any).AGENTS_BRIDGE_BASE_URL = processBase;
		}
	} catch {
		// best effort: caller will fallback to existing error handling
	}
	return readAgentsBridgeBaseUrl(c);
}

export function readAgentsBridgeToken(c: AppContext): string | null {
	const raw =
		typeof c.env.AGENTS_BRIDGE_TOKEN === "string" ? c.env.AGENTS_BRIDGE_TOKEN : "";
	const trimmed = raw.trim();
	return trimmed ? trimmed : null;
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
	// Default: 10min (agents may call multiple long-running /public/* tasks)
	return 600_000;
}

function readTimeoutFromRequestExtras(request: TaskRequestDto): number | null {
	const extras = (request as any)?.extras as Record<string, any> | undefined;
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

function isPublicAgentsRequest(c: AppContext): boolean {
	return c.get("publicApi") === true;
}

function assertPublicAgentsRequestSafe(
	input: {
		forceLocalResourceViaBash: boolean;
		privilegedLocalAccess: boolean;
		localResourcePaths: string[];
		requiredSkills: string[];
		autoProjectScopedLocalAccess?: boolean;
	},
): void {
	void input;
}

export async function runAgentsBridgeChatTask(
	c: AppContext,
	userId: string,
	request: TaskRequestDto,
	options?: {
		onStreamEvent?: AgentsBridgeStreamObserver;
		abortSignal?: AbortSignal;
	},
): Promise<TaskResultDto> {
	const effectiveUserId = resolveEffectiveUserId(c, userId);
	if (!effectiveUserId) {
		throw new AppError("Unauthorized: missing userId for agents bridge", {
			status: 401,
			code: "unauthorized",
		});
	}

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

	const extras = (request.extras || {}) as Record<string, any>;
	const requestedSystemPrompt =
		typeof extras.systemPrompt === "string" && extras.systemPrompt.trim()
			? extras.systemPrompt.trim()
			: "";
	const chatContext = normalizeAgentsBridgeChatContext(extras.chatContext);
	const canvasProjectId =
		typeof (extras as any)?.canvasProjectId === "string"
			? String((extras as any).canvasProjectId).trim()
			: "";
	const requestedCanvasFlowId =
		typeof (extras as any)?.canvasFlowId === "string"
			? String((extras as any).canvasFlowId).trim()
			: "";
	let canvasFlowId = requestedCanvasFlowId;
	const publicAgentsRequest = isPublicAgentsRequest(c);
	const canvasNodeId =
		typeof (extras as any)?.canvasNodeId === "string"
			? String((extras as any).canvasNodeId).trim()
			: "";
	const requestedSessionKey = typeof extras.sessionKey === "string" ? String(extras.sessionKey).trim() : "";
	if (publicAgentsRequest && canvasProjectId && !canvasFlowId) {
		const candidateFlows = await listFlowsByOwner(c.env.DB, effectiveUserId, canvasProjectId);
		const resolvedFlowId =
			Array.isArray(candidateFlows) && candidateFlows.length > 0 && typeof candidateFlows[0]?.id === "string"
				? candidateFlows[0].id.trim()
				: "";
		if (resolvedFlowId) {
			canvasFlowId = resolvedFlowId;
		}
	}
	const sessionKey = requestedSessionKey;
	const requestedBookId = typeof extras.bookId === "string" ? String(extras.bookId).trim() : "";
	const requestedSelectedReferenceBookId = chatContext.selectedReference?.bookId?.trim() || "";
	const requestedSelectedReferenceChapterId = chatContext.selectedReference?.chapterId?.trim() || "";
	const chapterId =
		(typeof extras.chapterId === "string" ? String(extras.chapterId).trim() : "") ||
		chatContext.selectedReference?.chapterId?.trim() ||
		"";
	const chunkIndex = Number.isFinite(Number(extras.chunkIndex)) ? Math.trunc(Number(extras.chunkIndex)) : null;
	const groupSize = Number.isFinite(Number(extras.groupSize)) ? Math.trunc(Number(extras.groupSize)) : null;
	const shotStart = Number.isFinite(Number(extras.shotStart)) ? Math.trunc(Number(extras.shotStart)) : null;
	const shotEnd = Number.isFinite(Number(extras.shotEnd)) ? Math.trunc(Number(extras.shotEnd)) : null;
	const shotNo = Number.isFinite(Number(extras.shotNo)) ? Math.trunc(Number(extras.shotNo)) : null;
	const diagnosticsLabel =
		typeof extras.diagnosticsLabel === "string" ? String(extras.diagnosticsLabel).trim() : "";
	const planOnly = extras.planOnly === true;
	const forceAssetGeneration = extras.forceAssetGeneration === true;
	const parsedGenerationContract = parseGenerationContract((extras as Record<string, unknown>).generationContract);
	if (!parsedGenerationContract.ok) {
		throw new AppError(`generationContract 无效: ${parsedGenerationContract.error}`, {
			status: 400,
			code: "invalid_generation_contract",
		});
	}
	const generationContract: GenerationContract | null = parsedGenerationContract.value;
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
	if (publicAgentsRequest && canvasProjectId && canvasFlowId) {
		const flow = await getFlowForOwner(c.env.DB, canvasFlowId, effectiveUserId);
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
	const requestedBookRef = requestedBookId || requestedSelectedReferenceBookId;
	const explicitProgressSpecified = Boolean(
		requestedBookId ||
		chapterId ||
		requestedSelectedReferenceBookId ||
		requestedSelectedReferenceChapterId ||
		shotNo !== null ||
		chunkIndex !== null ||
		shotStart !== null ||
		shotEnd !== null ||
		typeof chatContext.selectedReference?.shotNo === "number",
	);
	const projectBookCandidates: Array<{ bookId: string; title: string }> = [];
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
	const novelSingleVideoEvidenceRequired = false;
	const autoProgressDetectionRequired = false;
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
	const autoProjectScopedLocalAccess = false;
	const explicitLocalResourcePathsRaw = Array.isArray(extras.localResourcePaths)
		? extras.localResourcePaths
				.map((x) => String(x || "").trim())
				.filter(Boolean)
				.slice(0, 12)
		: [];
	const implicitBookLocalResourcePath =
		bookId && canvasProjectId
			? (
					await resolveReadableBookDirectoryPath({
						userId: effectiveUserId,
						projectId: canvasProjectId,
						bookId,
					})
			  ) || ""
			: "";
	const autoForceLocalResourceViaBash =
		false &&
		shouldAutoForceProjectBookLocalRead({
			publicAgentsRequest,
			requestKind: request.kind,
			canvasProjectId,
			canvasNodeId,
			planOnly,
			hasReferenceImages:
				Array.isArray(extras.referenceImages) &&
				extras.referenceImages.some((item: unknown) => String(item || "").trim().length > 0),
			hasAssetInputs:
				Array.isArray(extras.assetInputs) &&
				extras.assetInputs.some((item: unknown) => {
					if (!item || typeof item !== "object" || Array.isArray(item)) return false;
					return String((item as { url?: unknown }).url || "").trim().length > 0;
				}),
			selectedReference: effectiveChatContext.selectedReference,
			bookId,
		});
	const forceLocalResourceViaBash =
		Boolean(extras.forceLocalResourceViaBash) ||
		(autoForceLocalResourceViaBash && Boolean(implicitBookLocalResourcePath));
	const privilegedLocalAccess =
		publicAgentsRequest || Boolean(extras.privilegedLocalAccess) || autoProjectScopedLocalAccess;
	const localResourcePathsRaw = [
		...explicitLocalResourcePathsRaw,
		...(forceLocalResourceViaBash && implicitBookLocalResourcePath
			? [implicitBookLocalResourcePath]
			: []),
	].slice(0, 12);
	const localResourcePaths = localResourcePathsRaw
		.map((x) => normalizeLocalResourcePathForAgents(x))
		.filter((x): x is string => Boolean(x));
	if (
		(forceLocalResourceViaBash || privilegedLocalAccess) &&
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
	const requiredSkills = normalizeRequiredSkills(extras.requiredSkills);
	const allowedSubagentTypes = explicitAllowedSubagentTypes;
	const requireAgentsTeamExecution = extras.requireAgentsTeamExecution === true;
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
	if (publicAgentsRequest) {
		assertPublicAgentsRequestSafe({
			forceLocalResourceViaBash,
			privilegedLocalAccess,
			localResourcePaths,
			requiredSkills,
			autoProjectScopedLocalAccess,
		});
	}
	const modelKey = normalizeAgentBridgeModelField(extras.modelKey);
	const modelAlias = normalizeAgentBridgeModelField(extras.modelAlias);
	const referenceImages = normalizeAgentsBridgeReferenceImages(extras.referenceImages);
	const baseAssetInputs = normalizeAgentsBridgeAssetInputs(extras.assetInputs);
	const executionPlanningDirective = buildPublicChatExecutionPlanningDirective({
		publicAgentsRequest,
		requestKind: request.kind,
		planOnly,
		canvasProjectId,
		canvasNodeId,
		bookId,
		chapterId,
		hasReferenceImages: referenceImages.length > 0,
		hasAssetInputs: baseAssetInputs.length > 0,
		selectedReference: effectiveChatContext.selectedReference,
		chapterGroundedScope,
	});
	const selectedReferenceProtocolReferenceImages =
		collectStoryboardSelectionReferenceImageUrls(
			effectiveChatContext.selectedReference?.storyboardSelectionContext,
		);
	const mentionBoundInjection =
		publicAgentsRequest && canvasProjectId
			? await resolveMentionBoundAssetInputs({
				userId: effectiveUserId,
				projectId: canvasProjectId,
				canvasFlowId,
				prompt: request.prompt,
				existingAssetInputs: baseAssetInputs,
			})
			: { mentions: [], matched: [], missing: [], ambiguous: [], assetInputs: [], referenceImages: [], resolvedMentionKeys: [] };
	const mentionRoleInjection =
		publicAgentsRequest && canvasProjectId
			? await resolveMentionRoleAssetInputs({
				userId: effectiveUserId,
				projectId: canvasProjectId,
				bookId,
				chapterId,
				prompt: request.prompt,
				existingAssetInputs: [...baseAssetInputs, ...mentionBoundInjection.assetInputs],
				skipMentionKeys: mentionBoundInjection.resolvedMentionKeys,
			})
			: { mentions: [], matched: [], missing: [], ambiguous: [], assetInputs: [], referenceImages: [] };
	const chapterContinuityInjection =
		publicAgentsRequest && canvasProjectId && bookId && chapterId
			? await resolveChapterContinuityAssetInputs({
				c,
				userId: effectiveUserId,
				projectId: canvasProjectId,
				bookId,
				chapterId,
				existingAssetInputs: [...baseAssetInputs, ...mentionBoundInjection.assetInputs, ...mentionRoleInjection.assetInputs],
				mentionMatchedRoleNameKeys: mentionRoleInjection.matched.map((item) => item.roleNameKey),
			})
				: {
					chapter: null,
					roleNameKeys: [],
					sceneNameKeys: [],
					propNameKeys: [],
					tailFrameUrl: null,
					assetInputs: [],
					referenceImages: [],
					roleReferenceCount: 0,
					stateEvidenceRoleCount: 0,
					threeViewRoleCount: 0,
					missingRoleReferenceNames: [],
					missingStateRoleNames: [],
					missingThreeViewRoleNames: [],
					scenePropReferenceCount: 0,
				missingScenePropNames: [],
				reasons: ["chapter_context_absent"],
			};
	const assetInputs = [
		...baseAssetInputs,
		...mentionBoundInjection.assetInputs,
		...mentionRoleInjection.assetInputs,
		...chapterContinuityInjection.assetInputs,
	];
	const mergedReferenceImages = (() => {
		const out: string[] = [];
		const seen = new Set<string>();
		for (const url of [
			...referenceImages,
			...selectedReferenceProtocolReferenceImages,
			...mentionBoundInjection.referenceImages,
			...mentionRoleInjection.referenceImages,
			...chapterContinuityInjection.referenceImages,
			...assetInputs.map((item) => item.url),
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
		selectedReference: effectiveChatContext.selectedReference,
	});
	const generationGate = evaluatePublicAgentsGenerationGate({
		publicAgentsRequest,
		canvasProjectId,
		canvasFlowId,
		referenceImages: mergedReferenceImages,
		assetInputsCount: assetInputs.length,
		selectedReferenceImageUrl:
			effectiveChatContext.selectedReference?.imageUrl?.trim() || "",
		bookId,
		chapterId,
	});
	const promptPipelineTarget = resolvePromptPipelineTarget({
		selectedNodeKind: effectiveChatContext.selectedNodeKind,
		selectedReferenceKind: effectiveChatContext.selectedReference?.kind || null,
		referenceImageCount: mergedReferenceImages.length,
	});
	const promptPipelinePrecheck = buildPromptPipelinePrecheckSnapshot({
		target: promptPipelineTarget,
		mentionRoleInjection,
		chapterContinuityInjection,
		generationGate,
		mergedReferenceImages,
	});
	const promptPipelineRequestSummary = buildPromptPipelineRequestSummary({
		target: promptPipelineTarget,
		precheckSnapshot: promptPipelinePrecheck,
	});
	const enabledModelCatalogSummaryResult =
		publicAgentsRequest && request.kind === "chat"
			? await loadPublicChatEnabledModelCatalogSummary(c, effectiveUserId)
			: { summary: null, error: null };
	const systemPrompt = requestedSystemPrompt;
	const suppressProductIntegrity = shouldSuppressProductIntegrityConstraint({
		bookId,
		chapterId,
		chatContext: effectiveChatContext,
		canvasProjectId,
		canvasFlowId,
	});
	const prompt = decoratePromptWithReferenceImages(
		request.prompt,
		mergedReferenceImages,
		assetInputs,
		referenceImageSlots,
		effectiveChatContext.selectedReference,
		{ suppressProductIntegrity },
	);
	const finalSystemPrompt = [systemPrompt].filter(Boolean).join("\n\n");
	const finalPrompt = prompt;
	const debugLogEnabled = readAgentsBridgeDebugLog(c);
	const requestedMaxTurns = requiredSkills.length
		? privilegedLocalAccess || forceLocalResourceViaBash
			? 36
			: 18
		: null;
	const allowedTools: string[] | null = null;
	const resourceWhitelist = null;

	const tapcanvasApiBaseUrl = (() => {
		const fromEnv = readTapCanvasApiBaseFromEnv(c);
		if (fromEnv) return fromEnv;
		try {
			const url = new URL(c.req.url);
			return url.origin;
		} catch {
			return "";
		}
	})();
	const useRequestAuth = readBoolEnvFlag(c.env.AGENTS_BRIDGE_USE_REQUEST_AUTH);
	const envTapcanvasApiKey =
		typeof c.env.TAPCANVAS_API_KEY === "string"
			? c.env.TAPCANVAS_API_KEY.trim()
			: "";
	const reqAuthorization = (c.req.header("authorization") || "").trim();
	const reqApiKey = (c.req.header("x-api-key") || "").trim();
	const tapcanvasApiKey = envTapcanvasApiKey || reqApiKey;
	const tapcanvasAuthorization =
		useRequestAuth || !tapcanvasApiKey ? reqAuthorization : "";
	const remoteTools = buildAgentsBridgeRemoteTools({
		publicAgentsRequest,
		canvasProjectId,
		canvasFlowId,
		hideStoryboardEditor: publicAgentsRequest,
	});
	const canvasCapabilityManifest = buildCanvasCapabilityManifest({
		remoteTools,
		hideStoryboardEditor: publicAgentsRequest,
	});
	const remoteToolEndpoint =
		tapcanvasApiBaseUrl && remoteTools.length > 0
			? `${tapcanvasApiBaseUrl}/public/agents/tools/execute`
			: "";
	const token = readAgentsBridgeToken(c);
	const timeoutMs = readTimeoutFromRequestExtras(request) ?? readAgentsBridgeTimeoutMs(c);
	const dropOnHeadersTimeout = shouldDropOnHeadersTimeout(c, request);
	const requestAbort = createTimedAbortController(timeoutMs, options?.abortSignal);
	const runOnce = async (): Promise<Response> => {
		throwIfAbortSignalAborted(requestAbort.signal);
		const dispatcher = await createNodeFetchDispatcher(timeoutMs);
		if (debugLogEnabled) {
			console.info(
				`[agents-bridge.debug] request user=${effectiveUserId} kind=${request.kind} timeoutMs=${timeoutMs} skills=${requiredSkills.length} refImages=${mergedReferenceImages.length} assets=${assetInputs.length} localPaths=${localResourcePaths.length} promptChars=${finalPrompt.length} systemChars=${finalSystemPrompt.length} modelKey=${modelKey || "n/a"} modelAlias=${modelAlias || "n/a"}`,
			);
			if (mentionBoundInjection.mentions.length > 0) {
				console.info(
					`[agents-bridge.debug] mention-asset-injection mentions=${mentionBoundInjection.mentions.join(",") || "n/a"} matched=${mentionBoundInjection.matched.map((item) => item.assetRefId).join(",") || "n/a"} missing=${mentionBoundInjection.missing.join(",") || "n/a"} ambiguous=${mentionBoundInjection.ambiguous.join(",") || "n/a"}`,
				);
			}
			if (mentionRoleInjection.mentions.length > 0) {
				console.info(
					`[agents-bridge.debug] mention-role-injection mentions=${mentionRoleInjection.mentions.join(",") || "n/a"} matched=${mentionRoleInjection.matched.map((item) => item.roleName).join(",") || "n/a"} missing=${mentionRoleInjection.missing.join(",") || "n/a"} ambiguous=${mentionRoleInjection.ambiguous.join(",") || "n/a"}`,
				);
			}
			if (chapterContinuityInjection.chapter !== null) {
				console.info(
					`[agents-bridge.debug] chapter-continuity chapter=${chapterContinuityInjection.chapter} roles=${chapterContinuityInjection.roleNameKeys.join(",") || "n/a"} scenes=${chapterContinuityInjection.sceneNameKeys.join(",") || "n/a"} props=${chapterContinuityInjection.propNameKeys.join(",") || "n/a"} tail=${chapterContinuityInjection.tailFrameUrl || "n/a"} stateEvidenceRoles=${chapterContinuityInjection.stateEvidenceRoleCount} threeViewRoles=${chapterContinuityInjection.threeViewRoleCount} scenePropRefs=${chapterContinuityInjection.scenePropReferenceCount} missingStateRoles=${chapterContinuityInjection.missingStateRoleNames.join(",") || "n/a"} missingThreeViewRoles=${chapterContinuityInjection.missingThreeViewRoleNames.join(",") || "n/a"} missingSceneProps=${chapterContinuityInjection.missingScenePropNames.join(",") || "n/a"} reasons=${chapterContinuityInjection.reasons.join(",") || "n/a"}`,
				);
			}
			console.info(`[agents-bridge.debug] prompt=${truncateForDebugLog(finalPrompt)}`);
			if (finalSystemPrompt) {
				console.info(
					`[agents-bridge.debug] systemPrompt=${truncateForDebugLog(finalSystemPrompt)}`,
				);
			}
		}
		const chapterAssetRepairDiagnosticContext =
			buildChapterAssetRepairDiagnosticContext({
				workspaceAction: effectiveChatContext.workspaceAction,
				chapterContinuityInjection,
			});
		const init: any = {
			method: "POST",
			headers: {
					"Content-Type": "application/json",
					Accept: "text/event-stream, application/json",
					"x-agents-user-id": effectiveUserId,
					...(token ? { Authorization: `Bearer ${token}` } : {}),
				},
				body: JSON.stringify({
					prompt: finalPrompt,
					stream: request.kind === "chat",
					userId: effectiveUserId,
					...(finalSystemPrompt ? { systemPrompt: finalSystemPrompt } : {}),
					...(typeof responseFormat !== "undefined"
						? { responseFormat }
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
					...(generationContract ? { generationContract } : {}),
					...(canvasProjectId ? { tapcanvasProjectId: canvasProjectId } : {}),
					...(canvasFlowId ? { tapcanvasFlowId: canvasFlowId } : {}),
					...(canvasNodeId ? { tapcanvasNodeId: canvasNodeId } : {}),
					...(requiredSkills.length ? { requiredSkills } : {}),
					...(allowedSubagentTypes.length ? { allowedSubagentTypes } : {}),
					...(requireAgentsTeamExecution ? { requireAgentsTeamExecution: true } : {}),
					...(requiredSkills.length
						? {
								maxTurns: requestedMaxTurns,
								compactPrelude: true,
						  }
						: null),
					...(tapcanvasApiBaseUrl ? { tapcanvasApiBaseUrl } : {}),
					...(tapcanvasAuthorization ? { tapcanvasAuthorization } : {}),
					...(tapcanvasApiKey ? { tapcanvasApiKey } : {}),
					...(remoteTools.length ? { remoteTools } : {}),
					...(publicAgentsRequest ? { canvasCapabilityManifest } : {}),
					...(remoteToolEndpoint
						? {
								remoteToolConfig: {
									endpoint: remoteToolEndpoint,
									...(tapcanvasAuthorization ? { authToken: tapcanvasAuthorization } : {}),
									...(tapcanvasApiKey ? { apiKey: tapcanvasApiKey } : {}),
									...(canvasProjectId ? { projectId: canvasProjectId } : {}),
									...(canvasFlowId ? { flowId: canvasFlowId } : {}),
									...(canvasNodeId ? { nodeId: canvasNodeId } : {}),
								},
						  }
						: {}),
					...(forceLocalResourceViaBash ? { forceLocalResourceViaBash: true } : {}),
					...(privilegedLocalAccess ? { privilegedLocalAccess: true } : {}),
					...(localResourcePaths.length ? { localResourcePaths } : {}),
					...(modelKey ? { modelKey } : {}),
					...(modelAlias ? { modelAlias } : {}),
					...(sessionKey ? { sessionId: sessionKey } : {}),
					...(canvasProjectId || canvasNodeId || bookId || chapterId || chunkIndex !== null || groupSize !== null || shotStart !== null || shotEnd !== null || shotNo !== null || diagnosticsLabel || executionPlanningDirective
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
								...(chapterGroundedScope
									? { chapterGroundedStoryboardScope: true }
									: {}),
								...chapterAssetRepairDiagnosticContext,
								...(executionPlanningDirective
									? {
										planningRequired: executionPlanningDirective.planningRequired,
										planningMinimumSteps:
											executionPlanningDirective.planningMinimumSteps,
										planningChecklistFirst:
											executionPlanningDirective.checklistFirst,
										planningReason: executionPlanningDirective.reason,
									}
									: {}),
								promptPipeline: promptPipelineRequestSummary,
								...(diagnosticsLabel ? { label: diagnosticsLabel } : {}),
							},
						}
						: {}),
				}),
				signal: requestAbort.signal,
			};
			if (dispatcher) init.dispatcher = dispatcher;
			const targetUrl = `${baseUrl}/chat`;
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
			} catch (err: any) {
				throwIfAbortSignalAborted(requestAbort.signal);
				const isHeadersTimeout =
					typeof err?.message === "string" &&
					err.message.includes("agents_bridge_headers_timeout_non_retriable");
				if (isHeadersTimeout && dropOnHeadersTimeout) {
					if (debugLogEnabled) {
						console.warn(
							`[agents-bridge.debug] headers-timeout dropped user=${effectiveUserId} kind=${request.kind}`,
						);
					}
					throw new AppError("Agents bridge 请求头超时（任务未完成，已停止本轮执行）", {
						status: 504,
						code: "agents_bridge_headers_timeout_dropped",
						details: {
							baseUrl,
							timeoutMs,
							dropOnHeadersTimeout: true,
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
					} catch {
						// fall through to original wrapped error
					}
				}
				if (!res) {
					const causeMessage =
						typeof err?.cause?.message === "string" ? err.cause.message : undefined;
					throw new AppError("Agents bridge 网络请求失败（无法连接或已超时）", {
						status: 502,
						code: "agents_bridge_fetch_failed",
						details: {
							baseUrl,
							timeoutMs,
							error: {
								name: typeof err?.name === "string" ? err.name : undefined,
								message:
									typeof err?.message === "string" ? err.message : String(err || ""),
								cause: causeMessage,
							},
						},
					});
				}
			}
		}, requestAbort.signal);

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
			throw new AppError("Agents bridge 调用失败", {
				status: 502,
				code: "agents_bridge_failed",
				details: {
					status: response.status,
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
					...(options?.onStreamEvent ? { onEvent: options.onStreamEvent } : {}),
				})
				: await response.json().catch(() => null)
		) as AgentsBridgeChatResponse | null;
		throwIfAbortSignalAborted(requestAbort.signal);
		const text = typeof data?.text === "string" ? data.text : "";
		throwIfAbortSignalAborted(requestAbort.signal);
	const bridgeToolCalls = Array.isArray(data?.trace?.toolCalls)
		? data!.trace!.toolCalls
				.filter((item): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item))
				.slice(0, 200)
		: [];
	const normalizedBridgeToolCalls = normalizeBridgeToolCalls(bridgeToolCalls);
	const assets = Array.isArray(data?.assets)
		? data.assets
				.map((asset) => {
					const rawType = typeof asset?.type === "string" ? asset.type.trim().toLowerCase() : "";
					const type = rawType === "video" ? "video" : rawType === "image" ? "image" : null;
					const url = typeof asset?.url === "string" ? asset.url.trim() : "";
					const thumbnailUrl =
						type === "video" && typeof asset?.thumbnailUrl === "string"
							? asset.thumbnailUrl.trim()
							: "";
					if (!type || !url || !/^https?:\/\//i.test(url)) return null;
					return {
						type,
						url,
						...(thumbnailUrl && /^https?:\/\//i.test(thumbnailUrl)
							? { thumbnailUrl }
							: {}),
					};
				})
				.filter((asset): asset is { type: "image" | "video"; url: string; thumbnailUrl?: string } => !!asset)
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
	const traceRuntime = normalizeAgentsRuntimeTraceSummary(data?.trace?.runtime);
	const traceTodoList = normalizeAgentsTodoListTraceSummary(data?.trace?.todoList);
	const traceTodoEvents = normalizeAgentsTodoEventTraceSummaries(data?.trace?.todoEvents);
	const tracePlanning =
		normalizeAgentsPlanningTraceSummary(data?.trace?.planning) ??
		deriveAgentsPlanningTraceSummaryFromTodo({
			todoList: traceTodoList,
			todoEvents: traceTodoEvents,
		});
	const traceCompletion = normalizeAgentsCompletionTraceSummary(data?.trace?.completion);
	const semanticTaskSummaryFromToolTrace =
		normalizeAgentsSemanticTaskSummaryFromToolCalls(normalizedBridgeToolCalls);
	const semanticTaskSummaryFromText = normalizeAgentsSemanticTaskSummaryFromText(text);
	const semanticTaskSummary = semanticTaskSummaryFromToolTrace ?? semanticTaskSummaryFromText;
	const semanticExecutionIntent = buildAgentsSemanticExecutionIntentSummary({
		taskSummary: semanticTaskSummary,
		source: semanticTaskSummaryFromToolTrace ? "tool_trace_output_json" : "task_interrogation_json",
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
	const promptPipeline = buildPromptPipelineTraceSummary({
		target: promptPipelineTarget,
		precheckSnapshot: promptPipelinePrecheck,
		toolEvidence,
		toolCalls: normalizedBridgeToolCalls,
		text,
		assetCount: assets.length,
		canvasPlanDiagnostics,
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
	const traceScopeType = canvasProjectId
		? "project"
		: chapterId
			? "chapter"
			: bookId
				? "book"
				: sessionKey
					? "session"
					: "user";
		const traceScopeId = canvasProjectId || chapterId || bookId || sessionKey || effectiveUserId;
		const requestId = String((c as any).get?.("requestId") || "").trim();
		const pagePath = readRequestHeader(c, "x-tapcanvas-page-path");
		const referrerPath = readRequestHeader(c, "x-tapcanvas-referrer-path");
		const trimmedText = text.trim();
		const assistantTextPreview = trimmedText
			? truncateExecutionTraceString(trimmedText, EXECUTION_TRACE_TEXT_PREVIEW_LIMIT)
			: "";
		const assistantTextHead = truncateExecutionTraceString(
			readTraceStringField(traceOutput, "head") || trimmedText.slice(0, 1200),
			1200,
		);
		const assistantTextTail = truncateExecutionTraceString(
			readTraceStringField(traceOutput, "tail") ||
				(trimmedText ? trimmedText.slice(Math.max(0, trimmedText.length - 1200)) : ""),
			1200,
		);
		const fallbackSucceededToolCalls = normalizedBridgeToolCalls.filter(
			(call) => call.status === "succeeded",
		).length;
		const fallbackFailedToolCalls = normalizedBridgeToolCalls.filter(
			(call) => call.status === "failed",
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
				readTraceNumberField(traceSummary, "failedToolCalls") ?? fallbackFailedToolCalls,
			deniedToolCalls:
				readTraceNumberField(traceSummary, "deniedToolCalls") ?? fallbackDeniedToolCalls,
			blockedToolCalls:
				readTraceNumberField(traceSummary, "blockedToolCalls") ?? fallbackBlockedToolCalls,
			runMs: readTraceNumberField(traceSummary, "runMs") ?? null,
		};
		const toolExecutionIssues = summarizeBridgeToolExecutionIssues({
			toolCalls: normalizedBridgeToolCalls,
			toolStatusSummary,
		});
		const chapterGroundedVisualPreproduction = buildChapterGroundedVisualPreproductionSummary({
			toolCalls: normalizedBridgeToolCalls,
			selectedNodeKind: effectiveChatContext.selectedNodeKind,
		});
		const chapterAssetPreproductionRequiredCount =
			resolveChapterPreproductionRequiredAssetCount(chapterContinuityInjection);
		const expectedDelivery = buildPublicChatExpectedDeliverySummary({
			taskSummary: semanticTaskSummary,
			requiresExecutionDelivery: semanticExecutionIntent.requiresExecutionDelivery,
			forceAssetGeneration,
			chapterGroundedPromptSpecRequired: chapterGroundedScope,
			chapterAssetPreproductionRequired: chapterAssetPreproductionRequiredCount > 0,
			chapterAssetPreproductionCount: chapterAssetPreproductionRequiredCount,
			selectedNodeKind: effectiveChatContext.selectedNodeKind,
			selectedReferenceKind: effectiveChatContext.selectedReference?.kind ?? null,
			workspaceAction: effectiveChatContext.workspaceAction,
		});
		const deliveryEvidence = buildPublicChatDeliveryEvidence({
			assets,
			toolEvidence,
			chapterGroundedVisualPreproduction,
			toolCalls: normalizedBridgeToolCalls,
		});
		const deliveryVerification = verifyPublicChatDelivery({
			expected: expectedDelivery,
			evidence: deliveryEvidence,
		});
		const diagnosticFlags = buildDiagnosticFlags({
			requestKind: request.kind,
			text,
			toolEvidence,
			canvasPlanDiagnostics,
			outputMode,
			toolStatusSummary,
			toolExecutionIssues,
			toolCalls: normalizedBridgeToolCalls,
			runtimeTrace: traceRuntime,
			generationGate,
			forceAssetGeneration,
			semanticExecutionIntent,
			planningTrace: tracePlanning,
			todoListTrace: traceTodoList,
			autoModeAgentsTeamRequired: Boolean(
				mode === "auto" &&
					requireAgentsTeamExecution &&
					publicAgentsRequest &&
					canvasProjectId &&
					canvasFlowId &&
					!planOnly,
			),
			chapterGroundedPromptSpecRequired: chapterGroundedScope,
			novelSingleVideoEvidenceRequired,
			autoProgressDetectionRequired,
			selectedNodeKind: effectiveChatContext.selectedNodeKind,
			selectedReference: effectiveChatContext.selectedReference,
			workspaceAction: effectiveChatContext.workspaceAction,
			referenceImagesCount: mergedReferenceImages.length,
			assetInputsCount: assetInputs.length,
			requestAssetInputs: assetInputs,
			chapterContinuityInjection,
			chapterGroundedVisualPreproduction,
		});
		const agentDecision = buildAgentsBridgeDecision({
			outputMode,
			assetCount: assets.length,
			toolEvidence,
			canvasPlanDiagnostics,
		});
		const turnVerdict = buildAgentsBridgeTurnVerdict({
			text,
			assetCount: assets.length,
			toolEvidence,
			toolExecutionIssues,
			canvasPlanDiagnostics,
			diagnosticFlags,
			forceAssetGeneration,
			semanticExecutionIntent,
			deliveryVerification,
			completionTrace: traceCompletion,
		});
		const canvasMutation = buildAgentsBridgeCanvasMutationSummary(normalizedBridgeToolCalls);
		const bridgeResponseMeta: AgentsBridgeResponseMeta = {
			...(requestId ? { requestId } : {}),
			...(sessionKey ? { sessionId: sessionKey } : {}),
			outputMode,
			toolEvidence,
			...(expectedDelivery.active ? { expectedDelivery } : {}),
			...(deliveryVerification.applicable ? { deliveryVerification } : {}),
			...(expectedDelivery.active ? { deliveryEvidence } : {}),
			promptPipeline,
			toolStatusSummary,
			diagnosticFlags,
			canvasPlan: canvasPlanDiagnostics,
			...(canvasMutation ? { canvasMutation } : {}),
			agentDecision,
			...(traceCompletion ? { completionTrace: traceCompletion } : {}),
			...(semanticExecutionIntent.detected ? { semanticExecutionIntent } : {}),
			...(tracePlanning ? { planningTrace: tracePlanning } : {}),
			...(traceTodoList ? { todoList: traceTodoList } : {}),
			...(traceTodoEvents.length > 0 ? { todoEvents: traceTodoEvents } : {}),
			turnVerdict,
		};
		const executionTraceToolCalls = buildExecutionTraceToolCallSummary(normalizedBridgeToolCalls);
		const compactResponseTrace: Record<string, unknown> = {
			...(traceOutput
				? {
						output: {
							textChars:
								typeof traceOutput.textChars === "number" && Number.isFinite(traceOutput.textChars)
									? traceOutput.textChars
									: text.length,
							...(assistantTextPreview ? { preview: assistantTextPreview } : {}),
							...(assistantTextHead ? { head: assistantTextHead } : {}),
							...(assistantTextTail ? { tail: assistantTextTail } : {}),
						},
				  }
				: {}),
			...(traceSummary ? { summary: sanitizeExecutionTraceValue(traceSummary) } : {}),
			...(traceCompletion ? { completion: sanitizeExecutionTraceValue(traceCompletion) } : {}),
			...(tracePlanning ? { planning: sanitizeExecutionTraceValue(tracePlanning) } : {}),
			...(traceRuntime ? { runtime: sanitizeExecutionTraceValue(traceRuntime) } : {}),
			...(traceTodoList ? { todoList: sanitizeExecutionTraceValue(traceTodoList) } : {}),
			...(traceTodoEvents.length > 0
				? { todoEvents: sanitizeExecutionTraceValue(traceTodoEvents) }
				: {}),
			...(traceTurns.length > 0
				? {
						turns: traceTurns.slice(0, 8).map((turn) => ({
							turn: typeof turn.turn === "number" ? turn.turn : null,
							textPreview: truncateExecutionTraceString(turn.textPreview, 320),
							textChars:
								typeof turn.textChars === "number" && Number.isFinite(turn.textChars)
									? turn.textChars
									: null,
							toolCallCount:
								typeof turn.toolCallCount === "number" && Number.isFinite(turn.toolCallCount)
									? turn.toolCallCount
									: null,
							toolNames: Array.isArray(turn.toolNames)
								? turn.toolNames
										.filter((name): name is string => typeof name === "string" && !!name.trim())
										.slice(0, 12)
								: [],
							finished: turn.finished === true,
						})),
				  }
				: {}),
		};
		await writeUserExecutionTrace(c, effectiveUserId, {
			scopeType: traceScopeType,
			scopeId: traceScopeId,
			taskId: id,
			requestKind: `agents_bridge:${request.kind}`,
			inputSummary: [
				canvasProjectId ? `project=${canvasProjectId}` : "",
				bookId ? `book=${bookId}` : "",
				chapterId ? `chapter=${chapterId}` : "",
				chunkIndex !== null ? `chunk=${chunkIndex}` : "",
				groupSize !== null ? `groupSize=${groupSize}` : "",
				shotStart !== null && shotEnd !== null ? `shots=${shotStart}-${shotEnd}` : "",
				shotNo !== null ? `shotNo=${shotNo}` : "",
				diagnosticsLabel ? `label=${diagnosticsLabel}` : "",
				`prompt=${String(request.prompt || "").trim().slice(0, 1000)}`,
			]
				.filter(Boolean)
				.join("; "),
			decisionLog: [
				`baseUrl=${baseUrl}`,
				`requiredSkills=${requiredSkills.join(",") || "none"}`,
				`runtimeProfile=${traceRuntime?.profile || "unknown"}`,
				`runtimeRegisteredTools=${traceRuntime?.registeredToolNames.length ?? 0}`,
				`runtimeRegisteredTeamTools=${traceRuntime?.registeredTeamToolNames.join(",") || "none"}`,
				`runtimeLoadedSkills=${traceRuntime?.loadedSkills.join(",") || "none"}`,
				`runtimeAllowedSubagentTypes=${traceRuntime?.allowedSubagentTypes.join(",") || "none"}`,
				`runtimeRequireAgentsTeamExecution=${traceRuntime?.requireAgentsTeamExecution ? "yes" : "no"}`,
				`planning=${tracePlanning ? `${tracePlanning.hasChecklist ? "present" : "missing"}:${Math.max(tracePlanning.latestStepCount, tracePlanning.maxObservedStepCount)}/${tracePlanning.minimumStepCount}:${tracePlanning.checklistComplete ? "complete" : "open"}` : "none"}`,
				`todoList=${traceTodoList ? `${traceTodoList.completedCount}/${traceTodoList.totalCount}` : "none"}`,
				`todoEvents=${traceTodoEvents.length}`,
				`semanticExecutionIntent=${semanticExecutionIntent.detected ? `${semanticExecutionIntent.taskKind || "unknown"}:${semanticExecutionIntent.requiresExecutionDelivery ? "execute" : "non_execute"}` : "none"}`,
				"allowedTools=default",
				`referenceImages=${mergedReferenceImages.length}`,
				`assetInputs=${assetInputs.length}`,
				`bridgeToolCalls=${bridgeToolCalls.length}`,
				`turns=${traceTurns.length}`,
				`toolStatuses=succeeded:${toolStatusSummary.succeededToolCalls},failed:${toolStatusSummary.failedToolCalls},denied:${toolStatusSummary.deniedToolCalls},blocked:${toolStatusSummary.blockedToolCalls}`,
				`toolIssueSummary=failed:${toolExecutionIssues.failedToolCalls},denied:${toolExecutionIssues.deniedToolCalls},blocked:${toolExecutionIssues.blockedToolCalls},coordinationBlocked:${toolExecutionIssues.coordinationBlockedToolCalls},actionableBlocked:${toolExecutionIssues.actionableBlockedToolCalls}`,
				`outputMode=${outputMode}`,
				`promptPipelineTarget=${promptPipeline.target}`,
				`promptPipelinePrecheck=${promptPipeline.precheck.status}:${promptPipeline.precheck.reason}`,
				`promptPipelinePrerequisite=${promptPipeline.prerequisiteGeneration.status}:${promptPipeline.prerequisiteGeneration.reason}`,
				`promptPipelineGeneration=${promptPipeline.promptGeneration.status}:${promptPipeline.promptGeneration.reason}`,
				`canvasPlan=${canvasPlanDiagnostics.parseSuccess ? "parsed" : canvasPlanDiagnostics.tagPresent ? "invalid" : "missing"}`,
				`canvasPlanNodes=${Number(canvasPlanDiagnostics.nodeCount || 0)}`,
				`expectedDelivery=${expectedDelivery.active ? `${expectedDelivery.kind}:${expectedDelivery.reason}` : "none"}`,
				`deliveryVerification=${deliveryVerification.status}:${deliveryVerification.code || "ok"}`,
				`readProjectState=${toolEvidence.readProjectState ? "yes" : "no"}`,
				`readBookIndex=${toolEvidence.readBookIndex ? "yes" : "no"}`,
				`readChapter=${toolEvidence.readChapter ? "yes" : "no"}`,
				`flags=${diagnosticFlags.length}`,
				`turnVerdict=${turnVerdict.status}:${turnVerdict.reasons.join(",")}`,
			],
			toolCalls: executionTraceToolCalls,
			meta: {
				provider: "agents_bridge",
				responseId: id,
				assetCount: assets.length,
				textChars: text.length,
				...(assistantTextPreview ? { assistantTextPreview } : {}),
				...(assistantTextHead ? { assistantTextHead } : {}),
				...(assistantTextTail ? { assistantTextTail } : {}),
				...(requestId ? { requestId } : {}),
				...(pagePath ? { pagePath } : {}),
				...(referrerPath ? { referrerPath } : {}),
				...(canvasProjectId ? { projectId: canvasProjectId } : {}),
				...(canvasFlowId ? { flowId: canvasFlowId } : {}),
				...(bookId ? { bookId } : {}),
				...(chapterId ? { chapterId } : {}),
				...(chunkIndex !== null ? { chunkIndex } : {}),
				...(shotStart !== null ? { shotStart } : {}),
				...(shotEnd !== null ? { shotEnd } : {}),
				...(groupSize !== null ? { groupSize } : {}),
				...(shotNo !== null ? { shotNo } : {}),
				...(diagnosticsLabel ? { label: diagnosticsLabel } : {}),
				...(sessionKey ? { sessionId: sessionKey } : {}),
				...(modelKey ? { modelKey } : {}),
				...(modelAlias ? { modelAlias } : {}),
				...(traceRuntime ? { agentsRuntime: traceRuntime } : {}),
				...(traceCompletion ? { agentsCompletion: traceCompletion } : {}),
				...(tracePlanning ? { agentsPlanning: tracePlanning } : {}),
				agentsTeamExecution: buildAgentsTeamExecutionSummary({
					toolCalls: normalizedBridgeToolCalls,
				}),
				...bridgeResponseMeta,
				requestContext: {
					promptChars: String(request.prompt || "").trim().length,
					requiredSkills,
					loadedSkills: traceRuntime?.loadedSkills ?? [],
					allowedTools: allowedTools ?? [],
					runtimeProfile: traceRuntime?.profile || "unknown",
					runtimeRegisteredToolNames: traceRuntime?.registeredToolNames ?? [],
					runtimeRegisteredTeamToolNames: traceRuntime?.registeredTeamToolNames ?? [],
					runtimeAllowedSubagentTypes: traceRuntime?.allowedSubagentTypes ?? [],
					runtimeRequireAgentsTeamExecution: traceRuntime?.requireAgentsTeamExecution === true,
					runtimeContextTotalChars: traceRuntime?.contextDiagnostics?.totalChars ?? 0,
					runtimeContextTotalBudgetChars: traceRuntime?.contextDiagnostics?.totalBudgetChars ?? 0,
					runtimeContextTruncatedSourceIds:
						traceRuntime?.contextDiagnostics?.sources
							.filter((source) => source.truncated)
							.map((source) => source.id) ?? [],
					runtimePolicySummary: traceRuntime?.policySummary ?? null,
					referenceImages: mergedReferenceImages.length,
					referenceImageSlots: summarizeReferenceImageSlotsForTrace(referenceImageSlots),
					assetInputs: assetInputs.length,
					maxTurns: requestedMaxTurns,
					publicAgentsRequest,
				},
				responseTrace: compactResponseTrace,
			},
			resultSummary: `mode=${outputMode}; verdict=${turnVerdict.status}; delivery=${deliveryVerification.status}:${deliveryVerification.code || "ok"}; assets=${assets.length}; textChars=${text.length}; tools=${bridgeToolCalls.length}; canvasPlanNodes=${Number(canvasPlanDiagnostics.nodeCount || 0)}`,
		});
		return {
			id,
			kind: request.kind,
			status: "succeeded",
			assets,
			raw: {
				provider: "agents_bridge",
				vendor: "agents",
				userId: effectiveUserId,
				text,
				meta: bridgeResponseMeta,
			},
		};
	} finally {
		requestAbort.cleanup();
	}
}
