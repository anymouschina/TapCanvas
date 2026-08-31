import { z } from "@hono/zod-openapi";
import { CHAPTER_CANVAS_INTENTS } from "@tapcanvas/chapter-canvas-intents";
import { PUBLIC_CHAT_SESSION_KEY_MAX_LENGTH } from "./public-chat-session.constants";
import { storyboardSelectionContextSchema } from "../storyboard/storyboardSelectionProtocol";
import {
	PUBLIC_FLOW_ANCHOR_BINDING_KINDS,
	PUBLIC_FLOW_ANCHOR_REFERENCE_VIEWS,
} from "../flow/flow.anchor-bindings";
import { FLOW_NODE_ID_MAX_LENGTH } from "../flow/flow-node-id.constants";
import { TaskKindSchema, TaskRequestSchema, TaskResultSchema } from "../task/task.schemas";
import { AgentExecutionProvenanceSchema } from "../task/agent-execution-provenance";
import { loadGenerationContractModule } from "../../platform/node/shared-schema-loader";

const generationContractModule = loadGenerationContractModule();
const {
	GENERATION_CONTRACT_VERSION,
	GENERATION_CONTRACT_MAX_LIST_ITEMS,
	GENERATION_CONTRACT_MAX_TEXT_LENGTH,
	GENERATION_CONTRACT_MAX_ID_LENGTH,
} = generationContractModule;

const PUBLIC_CHAT_ASSET_ROLES = [
	"target",
	"reference",
	"character",
	"scene",
	"prop",
	"product",
	"style",
	"context",
	"mask",
] as const;

const PUBLIC_CHAT_MAX_VIDEO_DURATION_SECONDS = 180;

// Workflow-projected canvas identities are compositional (workflow/node/item/
// execution/output) and can legitimately exceed a UUID-sized UI identifier.
// Keep one protocol bound for both the direct canvas anchor and its selected
// reference projection so the same real node cannot pass one field and fail
// the other.
export const PUBLIC_CHAT_CANVAS_NODE_ID_MAX_LENGTH = FLOW_NODE_ID_MAX_LENGTH;

const PublicChatDiagnosticFlagSchema = z.object({
	code: z.string(),
	severity: z.enum(["high", "medium"]),
	title: z.string(),
	detail: z.string(),
});

const PublicChatCanvasPlanTraceSchema = z.object({
	tagPresent: z.boolean(),
	normalized: z.boolean(),
	parseSuccess: z.boolean(),
	error: z.string(),
	errorCode: z.string(),
	errorDetail: z.string(),
	schemaIssues: z.array(z.string()),
	detectedTagName: z.string(),
	nodeCount: z.number().int().min(0),
	edgeCount: z.number().int().min(0),
	nodeKinds: z.array(z.string()),
	hasAssetUrls: z.boolean(),
	action: z.string(),
	summary: z.string(),
	reason: z.string(),
	rawPayload: z.string(),
});

const PublicChatAgentDecisionSchema = z.object({
	executionKind: z.enum(["plan", "execute", "generate", "answer"]),
	canvasAction: z.enum(["create_canvas_workflow", "write_canvas", "none"]),
	assetCount: z.number().int().min(0),
	projectStateRead: z.boolean(),
	reason: z.string().min(1).max(500),
});

const PublicChatTurnVerdictSchema = z.object({
	status: z.enum(["satisfied", "partial", "failed"]),
	reasons: z.array(z.string().min(1)).min(1),
});

const PublicChatLegacyRequestTerminalSchema = z.object({
	version: z.literal(1),
	terminal: z.literal(true),
	status: z.enum(["succeeded", "failed", "needs_input", "suspended"]),
	reason: z.string().min(1),
});

const PublicChatContinuationTicketSchema = z.object({
	version: z.literal(1),
	ticketId: z.string().min(1),
	logicalTaskId: z.string().min(1),
	taskNodeId: z.string().min(1),
	taskRevision: z.number().int().min(0),
	resumeFromStatus: z.enum(["repair_required", "replan_required", "waiting_for_evidence"]),
	nextTrigger: z.enum(["durable_resume", "external_evidence"]),
	reasonCode: z.string().min(1),
	issuedAt: z.string().min(1),
});

export const PublicChatLogicalTaskStateSchema = z.object({
	version: z.literal(1),
	logicalTaskId: z.string().min(1),
	status: z.enum(["active", "waiting_input", "waiting_external", "succeeded", "failed", "cancelled"]),
	reasonCode: z.string().min(1),
	physicalRunStatus: z.enum(["running", "completed", "handed_off", "interrupted"]),
	deliveryStatus: z.enum(["pending", "satisfied", "unsatisfied"]),
	taskNodeId: z.string().min(1),
	taskRevision: z.number().int().min(0),
	updatedAt: z.string().min(1),
	continuationTicket: PublicChatContinuationTicketSchema.nullable(),
});

const PublicChatExpectedDeliverySchema = z.object({
	active: z.boolean(),
	kind: z.string().min(1).max(160),
	source: z.enum(["none", "agents_cli_tool_trace", "agents_cli_user_intent_contract"]),
	reason: z.string().min(1),
	taskGoal: z.string().min(1).optional(),
	requestedOutput: z.string().min(1).optional(),
	successCriteria: z.array(z.string().min(1)).max(32).optional(),
	deliveryContract: z.object({ kind: z.string().min(1).max(160) }).passthrough().optional(),
	contractHash: z.string().min(1).max(128).optional(),
});

const PublicChatDeliveryArtifactSchema = z.object({
	toolCallId: z.string().min(1),
	toolName: z.string().min(1),
	assetType: z.enum(["image", "video", "audio", "workflow"]),
	deliveryState: z.enum(["materialized", "accepted_async"]),
	nodeId: z.string().nullable(),
	taskId: z.string().nullable(),
	runId: z.string().nullable(),
	runProtocol: z.enum(["video_run", "workflow_execution_family"]).optional(),
	clipIndex: z.number().int().min(0).nullable(),
	assetUrl: z.string().nullable(),
	completionBoundary: z.literal("submission").optional(),
});

const PublicChatCanonicalDeliveryEvidenceItemSchema = z.object({
	evidenceId: z.string().min(1).max(160),
	kind: z.enum(["final_response", "tool_call", "artifact", "persisted_state", "source"]),
	sourceRef: z.string().min(1).max(500),
	requirementIds: z.array(z.string().min(1).max(240)).max(64),
	artifactClass: z.string().min(1).max(160).optional(),
	mediaType: z.enum(["image", "video", "audio"]).nullable().optional(),
	attributes: z.record(
		z.string().min(1).max(120),
		z.union([z.string().max(1_000), z.number(), z.boolean(), z.null()]),
	),
}).superRefine((evidence, context) => {
	if (evidence.kind === "artifact" && evidence.mediaType === undefined) {
		context.addIssue({
			code: z.ZodIssueCode.custom,
			path: ["mediaType"],
			message: "artifact evidence requires authoritative mediaType or null",
		});
	}
	if (evidence.kind !== "artifact" && evidence.mediaType !== undefined) {
		context.addIssue({
			code: z.ZodIssueCode.custom,
			path: ["mediaType"],
			message: "non-artifact evidence cannot declare mediaType",
		});
	}
});

const PublicChatDeliveryEvidenceSchema = z.object({
	version: z.literal(2),
	items: z.array(PublicChatCanonicalDeliveryEvidenceItemSchema).max(128),
	artifacts: z.array(PublicChatDeliveryArtifactSchema).max(200),
	assetCount: z.number().int().min(0),
	imageAssetCount: z.number().int().min(0),
	videoAssetCount: z.number().int().min(0),
	wroteCanvas: z.boolean(),
	generatedAssets: z.boolean(),
	imageLikeNodeCount: z.number().int().min(0),
	preproductionImageLikeNodeCount: z.number().int().min(0),
	reusablePreproductionImageLikeNodeCount: z.number().int().min(0),
	materializedStoryboardStillCount: z.number().int().min(0),
	hasVideoNodes: z.boolean(),
	hasMaterializedVisualOutputs: z.boolean(),
	hasPlannedAuthorityBaseFrame: z.boolean(),
	hasConfirmedAuthorityBaseFrame: z.boolean(),
	storyboardPlanPersistenceCount: z.number().int().min(0),
});

const PublicChatDeliveryVerificationSchema = z.object({
	version: z.literal(2),
	contractHash: z.string().min(1).max(128),
	status: z.enum(["satisfied", "unsatisfied"]),
	criteria: z.array(z.object({
		requirementId: z.string().min(1).max(120),
		status: z.enum(["satisfied", "avoided", "applied", "conflict", "unresolved"]),
		evidenceIds: z.array(z.string().min(1).max(160)).max(128),
		reason: z.string().min(1).max(600),
	})).max(128),
	verifiedAt: z.string().min(1).max(80),
});

const PublicChatTodoListItemSchema = z.object({
	text: z.string().min(1),
	completed: z.boolean(),
	status: z.enum(["pending", "in_progress", "completed"]),
});

const PublicChatTodoListTraceSchema = z.object({
	sourceToolCallId: z.string().min(1),
	items: z.array(PublicChatTodoListItemSchema).min(1).max(20),
	totalCount: z.number().int().min(1),
	completedCount: z.number().int().min(0),
	inProgressCount: z.number().int().min(0),
	pendingCount: z.number().int().min(0),
});

const PublicChatTodoEventTraceSchema = PublicChatTodoListTraceSchema.extend({
	atMs: z.number().int().min(0).nullable(),
	startedAt: z.string().nullable(),
	finishedAt: z.string().nullable(),
	durationMs: z.number().int().min(0).nullable(),
});

const PublicChatRuntimeContextDiagnosticsSchema = z.object({
	totalChars: z.number().int().min(0),
	totalBudgetChars: z.number().int().min(0),
	sources: z.array(
		z.object({
			id: z.string().min(1),
			kind: z.string().min(1),
			summary: z.string().min(1),
			chars: z.number().int().min(0),
			budgetChars: z.number().int().min(0),
			truncated: z.boolean(),
		}),
	).max(16),
});

const PublicChatRuntimeCapabilitySnapshotSchema = z.object({
	providers: z.array(
		z.object({
			kind: z.string().min(1),
			name: z.string().min(1),
			toolNames: z.array(z.string()).max(128),
			toolCount: z.number().int().min(0),
		}),
	).max(12),
	exposedToolNames: z.array(z.string()).max(256),
	exposedTeamToolNames: z.array(z.string()).max(64),
});

const PublicChatRuntimePolicySummarySchema = z.object({
	totalDecisions: z.number().int().min(0),
	allowCount: z.number().int().min(0),
	denyCount: z.number().int().min(0),
	requiresApprovalCount: z.number().int().min(0),
	uniqueDeniedSignatures: z.array(z.string()).max(32),
});

const nullableNonNegativeInteger = z.number().int().min(0).nullable();

const PublicChatAgentPerformanceSnapshotSchema = z.object({
	version: z.literal(1),
	wallTimeMs: z.number().int().min(0),
	timeToFirstTextMs: nullableNonNegativeInteger,
	timeToFirstToolMs: nullableNonNegativeInteger,
	model: z.object({
		turnCount: z.number().int().min(0),
		durationMs: z.number().int().min(0),
		wallTimeShare: z.number().min(0),
		inputTokens: z.number().int().min(0),
		outputTokens: z.number().int().min(0),
		totalTokens: z.number().int().min(0),
		cacheReadInputTokens: z.number().int().min(0),
		cacheCreationInputTokens: z.number().int().min(0),
	}),
	tools: z.object({
		callCount: z.number().int().min(0),
		durationMs: z.number().int().min(0),
		wallTimeShare: z.number().min(0),
		schemaDiscoveryCount: z.number().int().min(0),
		blockedCount: z.number().int().min(0),
		failedCount: z.number().int().min(0),
	}),
	context: z.object({
		budgetTokens: nullableNonNegativeInteger,
		thresholdTokens: nullableNonNegativeInteger,
		totalTokens: nullableNonNegativeInteger,
		peakTotalTokens: nullableNonNegativeInteger,
		systemTokens: nullableNonNegativeInteger,
		messageTokens: nullableNonNegativeInteger,
		toolTokens: nullableNonNegativeInteger,
		overBudget: z.boolean().nullable(),
	}),
	toolSurface: z.object({
		modelVisibleCount: nullableNonNegativeInteger,
		sentSchemaChars: nullableNonNegativeInteger,
		modelVisibleDefinitionChars: nullableNonNegativeInteger,
		initialSentSchemaChars: nullableNonNegativeInteger,
		maxSentSchemaChars: nullableNonNegativeInteger,
		initialModelVisibleDefinitionChars: nullableNonNegativeInteger,
		maxModelVisibleDefinitionChars: nullableNonNegativeInteger,
		catalogRemoteCount: nullableNonNegativeInteger,
		authorizedRemoteDefinitionChars: nullableNonNegativeInteger,
		catalogNameChars: nullableNonNegativeInteger,
		duplicatedWrapperEnumChars: nullableNonNegativeInteger,
	}),
	progress: z.object({
		revision: z.number().int().min(0),
		durableClaimCount: z.number().int().min(0),
		progressSincePhysicalRunStart: z.number().int().min(0),
		suspended: z.boolean(),
		suspensionBudgetKind: z.string().min(1).nullable(),
		suspensionLimit: nullableNonNegativeInteger,
		suspensionObserved: nullableNonNegativeInteger,
		suspensionUsageTokens: nullableNonNegativeInteger,
		projectedInputTokens: nullableNonNegativeInteger,
		projectedMinimumOutputTokens: nullableNonNegativeInteger,
		projectedTotalTokens: nullableNonNegativeInteger,
	}),
});

const PublicChatRuntimeTraceSchema = z.object({
	profile: z.enum(["general", "code", "unknown"]),
	registeredToolNames: z.array(z.string()).max(256),
	registeredTeamToolNames: z.array(z.string()).max(64),
	requiredSkills: z.array(z.string()).max(32),
	loadedSkills: z.array(z.string()).max(64),
	allowedSubagentTypes: z.array(z.string()).max(16),
	requireAgentsTeamExecution: z.boolean(),
	inputProgressionGate: z
		.object({
			status: z.literal("completed"),
			model: z.literal("deepseek-v4-flash"),
			decision: z.enum(["allow", "deny"]),
			reasonCode: z.string().trim().min(1),
			reason: z.string().trim().min(1),
		})
		.optional(),
	contextDiagnostics: PublicChatRuntimeContextDiagnosticsSchema.optional(),
	capabilitySnapshot: PublicChatRuntimeCapabilitySnapshotSchema.optional(),
	policySummary: PublicChatRuntimePolicySummarySchema.optional(),
	performanceSnapshot: PublicChatAgentPerformanceSnapshotSchema.optional(),
	canvasCapabilities: z
		.object({
			version: z.string().nullable(),
			localCanvasToolNames: z.array(z.string()).max(128),
			remoteToolNames: z.array(z.string()).max(128),
			nodeKinds: z.array(z.string()).max(128),
		})
		.optional(),
});

const publicChatGenerationContractTextSchema = z.string().trim().min(1).max(GENERATION_CONTRACT_MAX_TEXT_LENGTH);

export const PublicChatGenerationContractSchema = z
	.object({
		version: z.literal(GENERATION_CONTRACT_VERSION),
		lockedAnchors: z
			.array(publicChatGenerationContractTextSchema)
			.max(GENERATION_CONTRACT_MAX_LIST_ITEMS),
		editableVariable: publicChatGenerationContractTextSchema.nullable(),
		forbiddenChanges: z
			.array(publicChatGenerationContractTextSchema)
			.max(GENERATION_CONTRACT_MAX_LIST_ITEMS),
		approvedKeyframeId: z.string().trim().min(1).max(GENERATION_CONTRACT_MAX_ID_LENGTH).nullable(),
	})
	.strict();

export const PublicChatContinuationRegistrationSchema = z.object({
	status: z.enum([
		"not_required",
		"external_handoff",
		"reconcile_pending",
		"invalid",
		"registered",
	]),
	reason: z.string().min(1),
	effectOwner: z.enum([
		"host_execution",
		"continuation_settlement",
		"workflow_execution",
	]).optional(),
	ticketId: z.string().min(1).optional(),
	host: z.string().min(1).optional(),
	commandCount: z.number().int().positive().optional(),
	runNodeCount: z.number().int().positive().optional(),
	details: z.string().min(1).optional(),
});

const PublicChatTraceSchema = z.object({
	requestId: z.string().optional(),
	sessionId: z.string().optional(),
	outputMode: z.enum(["plan_with_assets", "plan_only", "direct_assets", "text_only"]).optional(),
	traceProjection: z.object({
		status: z.enum(["complete", "failed"]),
		code: z.string().min(1).nullable(),
		issues: z.array(z.object({
			path: z.string(),
			message: z.string().min(1),
		})).max(8),
	}).optional(),
	toolEvidence: z.object({
		toolNames: z.array(z.string()),
		readProjectState: z.boolean(),
		readBookList: z.boolean(),
		readBookIndex: z.boolean(),
		readChapter: z.boolean(),
		readStoryboardPlan: z.boolean(),
		readStoryboardContinuity: z.boolean(),
		readStoryboardSourceBundle: z.boolean(),
		readNodeContextBundle: z.boolean(),
		readVideoReviewBundle: z.boolean(),
		readMaterialAssets: z.boolean(),
		generatedAssets: z.boolean(),
		wroteCanvas: z.boolean(),
	}).optional(),
	toolStatusSummary: z.object({
		totalToolCalls: z.number().int().min(0),
		succeededToolCalls: z.number().int().min(0),
		failedToolCalls: z.number().int().min(0),
		deniedToolCalls: z.number().int().min(0),
		blockedToolCalls: z.number().int().min(0),
		runMs: z.number().nullable(),
	}).optional(),
	canvasMutation: z
		.object({
			deletedNodeIds: z.array(z.string()),
			deletedEdgeIds: z.array(z.string()),
			createdNodeIds: z.array(z.string()),
			patchedNodeIds: z.array(z.string()),
			executableNodeIds: z.array(z.string()),
		})
		.optional(),
	diagnosticFlags: z.array(PublicChatDiagnosticFlagSchema).optional(),
	canvasPlan: PublicChatCanvasPlanTraceSchema.optional(),
	todoList: PublicChatTodoListTraceSchema.optional(),
	todoEvents: z.array(PublicChatTodoEventTraceSchema).max(32).optional(),
	runtime: PublicChatRuntimeTraceSchema.optional(),
	executionProvenance: AgentExecutionProvenanceSchema.optional(),
	turnVerdict: PublicChatTurnVerdictSchema.optional(),
	/** Legacy diagnostic only. Lifecycle authority is logicalTaskState. */
	requestTerminal: PublicChatLegacyRequestTerminalSchema.optional(),
	logicalTaskState: PublicChatLogicalTaskStateSchema,
	continuationRegistration: PublicChatContinuationRegistrationSchema.optional(),
	expectedDelivery: PublicChatExpectedDeliverySchema.optional(),
	deliveryEvidence: PublicChatDeliveryEvidenceSchema.optional(),
	deliveryVerification: PublicChatDeliveryVerificationSchema.optional(),
});

export const ApiKeySchema = z.object({
	id: z.string(),
	label: z.string(),
	keyPrefix: z.string(),
	allowedOrigins: z.array(z.string()),
	enabled: z.boolean(),
	scopes: z.array(z.enum(["public:read", "public:write", "agent:execute"])),
	expiresAt: z.string().nullable(),
	revokedAt: z.string().nullable(),
	rotatedFromId: z.string().nullable(),
	// 计费归属团队 id（null = 回落 key 拥有者解析出的团队，维持现状）。
	billingTeamId: z.string().nullable(),
	// 展示用（列表带出归属名 + 余额；无则前端只显 id / 「默认」）。
	billingTeamName: z.string().nullable().optional(),
	billingAvailableCredits: z.number().nullable().optional(),
	lastUsedAt: z.string().nullable().optional(),
	createdAt: z.string(),
	updatedAt: z.string(),
});

export type ApiKeyDto = z.infer<typeof ApiKeySchema>;

export const CreateApiKeyRequestSchema = z.object({
	label: z.string().min(1).max(80),
	allowedOrigins: z.array(z.string()).default([]),
	enabled: z.boolean().optional(),
	scopes: z.array(z.enum(["public:read", "public:write", "agent:execute"]))
		.min(1)
		.default(["public:read"]),
	expiresAt: z.string().datetime().nullable().optional(),
	// 可选：计费归属团队/账户 id（含个人 sentinel "personal" 或 personal_<uid>）。
	// null/缺省 = 不指定，回落现状。分配给谁就扣谁的积分（服务端会校验成员）。
	billingTeamId: z.string().nullish(),
});

export const CreateApiKeyResponseSchema = z.object({
	key: z.string(),
	apiKey: ApiKeySchema,
});

export const UpdateApiKeyRequestSchema = z.object({
	label: z.string().min(1).max(80).optional(),
	allowedOrigins: z.array(z.string()).optional(),
	enabled: z.boolean().optional(),
	scopes: z.array(z.enum(["public:read", "public:write", "agent:execute"])).min(1).optional(),
	expiresAt: z.string().datetime().nullable().optional(),
	// 传 null 清除归属（回落现状）；缺省则保持不变。
	billingTeamId: z.string().nullish(),
});

export const ApiKeyBillingOptionSchema = z.object({
	teamId: z.string(),
	name: z.string(),
	isPersonal: z.boolean(),
	availableCredits: z.number(),
});

export const ApiKeyBillingOptionsResponseSchema = z.object({
	options: z.array(ApiKeyBillingOptionSchema),
});

export type ApiKeyBillingOptionDto = z.infer<typeof ApiKeyBillingOptionSchema>;

const AgentsChatRequestSchemaBase = z.object({
	vendor: z.string().optional().openapi({
		description:
			"兼容旧字段；当前公共任务链路固定请求 new-api，聊天能力由 agents bridge 自主处理。",
		example: "newapi",
	}),
	vendorCandidates: z.array(z.string()).optional().openapi({
		description: "兼容旧字段；公共任务链路会忽略，不再做多渠道候选重试。",
		example: ["newapi"],
	}),
	prompt: z.string().min(1).optional(),
	clientPendingId: z.string().trim().min(1).max(160).optional().openapi({
		description:
			"调用方在提交前生成的稳定 turn 幂等键。普通 chat 必填；相同用户、session 与 clientPendingId 永远映射到同一个 public turn，重放只能对账，不能创建第二次执行。queueMode 控制消息不使用此字段。",
		example: "m_ai_pending_1786157917837",
	}),
	displayPrompt: z.string().min(1).max(2000).optional().openapi({
		description:
			"可选：用户侧展示/持久化用的当前轮文案。若 prompt 为系统生成的隐式提示，可用该字段保留用户真实触发语义。",
		example: "基于「镜头 12」继续",
	}),
	modelKey: z.string().optional(),
	modelAlias: z.string().optional(),
	systemPrompt: z.string().max(16_000).optional(),
	temperature: z.number().min(0).max(2).optional(),
	model: z.string().optional().openapi({
		description:
			"OpenAI responses 兼容字段：模型别名/模型名。服务端会按 model catalog 映射到对应 vendor。",
		example: "gemini-2.5-pro",
	}),
	input: z.union([z.string(), z.array(z.unknown())]).optional().openapi({
		description:
			"OpenAI responses 兼容字段：支持字符串或消息数组。若传入该字段，服务端会自动提取用户文本与参考图。",
		example: "你好，帮我总结这段文案。",
	}),
	instructions: z.string().max(16_000).optional().openapi({
		description:
			"OpenAI responses 兼容字段：系统提示词。会映射到 systemPrompt。",
		example: "请用中文回答。",
	}),
	max_output_tokens: z.number().int().min(1).optional(),
	tool_choice: z.unknown().optional(),
	tools: z.array(z.unknown()).optional(),
	stream: z.boolean().optional(),
	response_format: z.unknown().optional(),
	mode: z.enum(["chat", "auto"]).optional().openapi({
		description:
			"对话模式（默认 chat）；auto 表示统一的最高质量 agents 执行模式，只负责执行强度与完成态要求，不负责本地业务意图分流。具体创作场景语义必须由 skill 选择或 agents 语义决策触发，不能由本地 route 注入。",
		example: "auto",
	}),
	requiredSkills: z
		.array(z.string().trim().min(1).max(120))
		.min(1)
		.max(8)
		.optional()
		.openapi({
			description:
				"调用方额外明确要求 agents-cli 在本轮预读并执行的内部工作流 Skill key。chatContext.skill 是独立的用户本轮引用：系统、个人与商城来源都由 Hono 权威解析为 requiredSkillCalls，并且只有 agents-cli 真实调用 Skill 工具时才按需读取正文。",
				example: ["tapcanvas-storyboard-expert"],
		}),
	promptExampleRetrievalScope: z.object({
		version: z.literal(3),
		mediaType: z.enum(["image", "video"]),
		searchPolicy: z.enum(["agent_discretion", "required_non_blocking"]),
		model: z.string().trim().min(1).max(120).optional(),
	}).strict().optional().openapi({
		description: "设计资产提示词作者的检索范围：约束媒体案例源，并显式声明是否必须在首次创作前尝试一次候选检索。它不规定候选数量或正文读取数；零命中、未读取或检索失败均记录诊断后继续。",
		example: { version: 3, mediaType: "video", searchPolicy: "required_non_blocking" },
	}),
	mountedKnowledgeCardIds: z
		.array(z.string().trim().min(1).max(200))
		.max(64)
		.optional()
		.openapi({
			description: "工作流 Agent 节点由用户显式挂载的知识卡 ID。仅授权本轮直接读取这些卡片，不等同于已读取证据。",
		}),
	executionToolPolicy: z
		.object({
			mode: z.literal("restricted"),
			allowedTools: z
				.array(z.string().trim().min(1).max(120))
				.max(32)
				.superRefine((tools, ctx) => {
					if (new Set(tools).size !== tools.length) {
						ctx.addIssue({
							code: z.ZodIssueCode.custom,
							message: "allowedTools 禁止重复工具名",
						})
					}
				}),
		})
		.strict()
		.optional()
		.openapi({
			description:
				"可选的 Agents 执行工具硬约束。restricted 只会收窄本轮工具面，未知工具原地失败；不会扩大公共 Agents 原有权限。",
			example: {
				mode: "restricted",
				allowedTools: ["read_file", "tapcanvas_shot_table_critic"],
			},
		}),
	sessionKey: z.string().min(1).max(PUBLIC_CHAT_SESSION_KEY_MAX_LENGTH).optional().openapi({
		description:
			"会话键（建议前端稳定传递）。服务端按 userId + sessionKey 隔离并持久化聊天历史，用于跨轮记忆。",
		example: "canvas-main:default",
	}),
	resetSession: z.boolean().optional().openapi({
		description:
			"覆盖当前项目/Flow/章节的唯一会话源。只允许作为下一次用户回合的显式控制事实，服务端会在 agents 读取历史前清理旧投影。",
		example: true,
	}),
	queueMode: z.enum(["steering", "follow_up"]).optional().openapi({
		description:
			"运行中消息投递方式：steering 在当前 agent 的下一个 LLM 边界注入纠偏；follow_up 持久化排队并在当前任务完成后续做。必须同时提供 sessionKey。",
		example: "steering",
	}),
	canvasProjectId: z.string().min(1).max(120).optional().openapi({
		description: "可选：当前画布项目 ID（用于 agents-cli 在对话中定位“当前项目”）。",
		example: "13b29494-8a2e-4cca-8172-8c778642be8f",
	}),
	canvasFlowId: z.string().min(1).max(120).optional().openapi({
		description: "可选：当前 Flow ID（用于 agents-cli 在对话中定位“当前画布/工作流”）。",
		example: "96bb2e49-fb93-4fd6-b64b-22777a7b185e",
	}),
	canvasNodeId: z.string().min(1).max(PUBLIC_CHAT_CANVAS_NODE_ID_MAX_LENGTH).optional().openapi({
		description: "可选：当前用户选中的节点 ID（用于 agents-cli 直接读取当前节点证据包）。",
		example: "96a6e963-0eaa-47cf-ab9f-15c79491424f",
	}),
	chatContext: z
		.object({
			requestedWorkflowExecutionVariant: z.enum(["full_video", "first_video"]).optional(),
			generationProposal: z
				.object({
					version: z.literal(1),
					proposalId: z.string().trim().min(1).max(240),
					kind: z.enum(["image", "video", "audio", "prompt"]),
					title: z.string().trim().min(1).max(240),
					prompt: z.string().trim().min(1).max(20_000),
					model: z.string().trim().min(1).max(200).optional(),
					parameters: z
						.array(z.object({ label: z.string().trim().min(1).max(120), value: z.string().trim().min(1).max(2_000) }).strict())
						.max(32)
						.optional(),
					action: z.string().trim().min(1).max(2_000).optional(),
					nodeId: z.string().trim().min(1).max(PUBLIC_CHAT_CANVAS_NODE_ID_MAX_LENGTH).optional(),
				})
				.strict()
				.optional(),
			currentProjectName: z.string().min(1).max(200).optional(),
			workspaceAction: z
				.enum(["chapter_script_generation", "chapter_asset_generation", "shot_video_generation"])
				.optional(),
			skill: z
				.object({
					id: z.string().min(1).max(160),
					source: z.enum(["system", "user", "marketplace"]),
				})
				.strict()
				.optional(),
			selectedNodeLabel: z.string().min(1).max(200).optional(),
			selectedNodeKind: z.string().min(1).max(120).optional(),
			selectedNodeTextPreview: z.string().min(1).max(2000).optional(),
			selectedReference: z
				.object({
					nodeId: z.string().min(1).max(PUBLIC_CHAT_CANVAS_NODE_ID_MAX_LENGTH).optional(),
					label: z.string().min(1).max(200).optional(),
					kind: z.string().min(1).max(120).optional(),
					anchorBindings: z
						.array(
							z.object({
								kind: z.enum(PUBLIC_FLOW_ANCHOR_BINDING_KINDS),
								refId: z.string().min(1).max(160).optional(),
								entityId: z.string().min(1).max(160).optional(),
								label: z.string().min(1).max(200).optional(),
								sourceBookId: z.string().min(1).max(120).optional(),
								sourceNodeId: z.string().min(1).max(120).optional(),
								assetId: z.string().min(1).max(120).optional(),
								assetRefId: z.string().min(1).max(160).optional(),
								imageUrl: z.string().min(1).max(2048).optional(),
								referenceView: z.enum(PUBLIC_FLOW_ANCHOR_REFERENCE_VIEWS).optional(),
								category: z.string().min(1).max(120).optional(),
								note: z.string().min(1).max(500).optional(),
							}),
						)
						.max(24)
						.optional(),
					imageUrl: z.string().min(1).max(2048).optional(),
					sourceUrl: z.string().min(1).max(2048).optional(),
					bookId: z.string().min(1).max(120).optional(),
					chapterId: z.string().min(1).max(120).optional(),
					shotNo: z.number().int().min(1).optional(),
					productionLayer: z.string().min(1).max(120).optional(),
					creationStage: z.string().min(1).max(120).optional(),
					approvalStatus: z.string().min(1).max(120).optional(),
					hasUpstreamTextEvidence: z.boolean().optional(),
					hasDownstreamComposeVideo: z.boolean().optional(),
					storyboardSelectionContext: storyboardSelectionContextSchema.optional(),
				})
				.optional(),
			chapterCanvasReference: z
				.object({
					version: z.literal(1),
					scopeKey: z.string().min(1).max(240),
					nodeCount: z.number().int().min(0),
					edgeCount: z.number().int().min(0),
					summary: z.string().min(1).max(700).optional(),
					selectedNodeId: z.string().min(1).max(PUBLIC_CHAT_CANVAS_NODE_ID_MAX_LENGTH).optional(),
				})
				.optional(),
			chatMode: z.literal("creative").optional(),
			creativePhase: z.enum(["prep", "writing"]).optional(),
		})
		.optional()
		.openapi({
			description:
				"前端传给 agents bridge 的结构化对话上下文。用于后端统一构建 system prompt，避免前端自行拼接整段 prompt。",
		}),
	generationContract: PublicChatGenerationContractSchema.optional().openapi({
		description:
			"薄执行合同：用于把当前已锁定的连续性锚点、唯一可编辑变量、禁止漂移项和已确认关键帧状态，从 /public/agents/chat 显式传给 agents bridge 与 agents-cli。",
	}),
	userIntentContract: z.never().optional().openapi({
		type: "null",
		not: {},
		description:
			"保留字段；公开请求禁止提交。持久物理续跑只允许由服务端可信 continuation 通道注入。",
	}),
	userIntentContractLocked: z.never().optional().openapi({
		type: "null",
		not: {},
		description: "保留字段；公开请求禁止提交，只允许服务端可信 continuation 通道注入。",
	}),
	bookId: z.string().min(1).max(120).optional().openapi({
		description: "可选：当前书籍 ID（用于按用户/书籍维度召回业务记忆）。",
		example: "book_demo_01",
	}),
	chapterId: z.string().min(1).max(120).optional().openapi({
		description: "可选：当前章节 ID（用于章节连续性与分镜记忆召回）。",
		example: "chapter_03",
	}),
	requestUserInputResponse: z
		.object({
			requestId: z.string().min(1).max(200),
			answers: z
				.array(
					z.object({
						id: z.string().min(1).max(200),
						value: z.string().min(1).max(2000),
						optionLabel: z.string().min(1).max(500).optional(),
						optionIndex: z.number().int().min(0).optional(),
					}),
				)
				.min(1)
				.max(8),
			summary: z.string().max(1000).optional(),
		})
		.optional()
		.openapi({
			description:
				"可选：用户对上一轮一般 request_user_input 卡的已点选答案（前端 echo）。透传给 agents-cli 作 seedAnsweredUserInput，保持跨回合事实连续性；不用于视频 estimate/start 二次确认。",
		}),
	requestedImageCount: z.number().int().min(1).max(15).optional().openapi({
		description:
			"期望产图数量（主要用于 mode=auto 的回填与兜底出图目标张数）。",
		example: 1,
	}),
	aspectRatio: z.string().max(20).optional().openapi({
		description:
			"期望画幅比例（例如 1:1 / 4:3 / 3:4 / 16:9 / 9:16）。用于 auto 兜底出图。",
		example: "9:16",
	}),
	videoResolution: z.string().max(20).optional().openapi({
		description:
			"调用方显式冻结的视频生成分辨率（例如 480p / 720p / 1080p）；agents 必须写入生成合同并用实时模型目录验证。",
		example: "480p",
	}),
	targetDurationSeconds: z.number().int().min(1).max(PUBLIC_CHAT_MAX_VIDEO_DURATION_SECONDS).optional().openapi({
		description: "调用方显式冻结的最终成片目标总时长（秒），上限 180 秒。",
		example: 15,
	}),
	maxVideoDurationSeconds: z.number().int().min(1).max(PUBLIC_CHAT_MAX_VIDEO_DURATION_SECONDS).optional().openapi({
		description: "调用方执行面的最终成片时长硬上限（秒），上限 180 秒。",
		example: 180,
	}),
	referenceImages: z.array(z.string()).optional().openapi({
		description:
			"参考图片 URL 列表（用于 chat/auto 模式；建议按需提供，不限制数量）。",
		example: ["https://example.com/reference.png"],
	}),
	assetInputs: z
		.array(
			z
				.object({
					nodeId: z.string().min(1).max(FLOW_NODE_ID_MAX_LENGTH).optional(),
					assetId: z.string().min(1).max(120).optional(),
					assetRefId: z.string().min(1).max(160).optional(),
					url: z.string().min(1).max(2048).optional(),
					mediaType: z.enum(["image", "video"]).optional(),
					role: z.enum(PUBLIC_CHAT_ASSET_ROLES).optional().openapi({
						description:
							"资产角色：target=被改造目标；reference/character/scene/prop/product/style/context/mask=辅助参考。",
						example: "reference",
					}),
					weight: z.number().min(0).max(1).optional().openapi({
						description: "该资产参考权重，0-1。",
						example: 0.8,
					}),
					note: z.string().max(500).optional().openapi({
						description: "该资产的补充说明（简短）。",
						example: "保留角色发型和服饰轮廓",
					}),
					name: z.string().min(1).max(200).optional().openapi({
						description: "该资产的稳定命名引用，可供 agents 以 @name 语义使用。",
						example: "女主角色卡",
					}),
				})
				.refine((v) => Boolean((v.nodeId || "").trim() || (v.assetId || "").trim() || (v.url || "").trim()), {
					message: "assetInputs 每项至少提供 nodeId、assetId 或 url",
					path: ["assetId"],
				}),
		)
		.optional()
		.openapi({
			description:
				"多资产输入契约（推荐）。用于把目标图/参考图/角色图等结构化传给 agents-cli，不再写死“仅两图”或固定张数上限。",
		}),
	disableQualityReview: z.boolean().optional().openapi({
		description:
			"是否禁用候选图质检/排序流程（默认 true）。开启后会强制走“直接生成”路径，不做逐张候选评审。",
		example: true,
	}),
	debug: z.boolean().optional().openapi({
		description:
			"是否回显调试日志（默认 false）。开启后响应会附带 debugLogs/debug，便于定位自动生成链路问题。",
		example: true,
	}),
	planOnly: z.boolean().optional().openapi({
		description:
			"仅输出规划偏好。对 agents 专用聊天入口这不是本地硬拦截；bridge 仍会保留执行工具，由 agents 基于真实意图与证据自主决定是否只返回规划或直接执行。",
		example: true,
	}),
	forceAssetGeneration: z.boolean().optional().openapi({
		description:
			"强制本轮优先尝试真实资产生成/生成节点落地，而不是只给提示词或抽象建议。若证据或权限不足导致无法生成，应显式失败并返回缺口。",
		example: true,
	}),
	forcedAgentRole: z.string().min(1).max(64).optional().openapi({
		description:
			"智能团手动指派：用户在对话面板花名册中手动选定本轮由哪个子 agent 干活（如 storyboard-director/generation-artist/film-editor/post-producer）。小T 收到后应优先委派该角色、不要自行改派。",
		example: "storyboard-director",
	}),
	allowedSubagentTypes: z.array(z.string().trim().min(1).max(64)).max(12).optional().openapi({
		description: "多 Agent 工作流显式允许委派的 agent type 集合；空集合不代表允许全部。",
		example: ["writer", "video-prompt-writer"],
	}),
	requireAgentsTeamExecution: z.boolean().optional().openapi({
		description: "要求本轮产生真实 agents-team 执行证据，禁止主 Agent 单独完成后直接声明成功。",
		example: true,
	}),
	intent: z
		.enum(CHAPTER_CANVAS_INTENTS)
			.optional()
			.openapi({
				description:
					"可选：章节画布 intent 名称。该值只作为结构化事实进入统一 agents chat，由 agents-cli 自主选择 Skill 与工具；Hono 不再维护平行 intent 路由。",
		}),
	chapterIntentSourceNodeId: z
		.string()
		.min(1)
		.max(200)
			.optional()
			.openapi({
				description:
					"章节画布请求的触发节点 ID（通常是 chapter-seed-<chapterId>），作为统一 agents chat 的结构化事实。",
		}),
	chapterContext: z
		.object({
			projectId: z.string().min(1).max(200),
			bookId: z.string().min(1).max(200).nullable(),
			chapterId: z.string().max(200),
			flowSnapshot: z.object({
				nodes: z.array(
					z.object({
						id: z.string().min(1),
						kind: z.string().min(1),
						preset: z.string().min(1).optional(),
						data: z.record(z.unknown()),
					}),
				),
				edges: z.array(
					z.object({
						id: z.string().min(1),
						source: z.string().min(1),
						target: z.string().min(1),
						sourceHandle: z.string().optional(),
						targetHandle: z.string().optional(),
					}),
				),
			}),
		})
			.optional()
			.openapi({
				description:
					"章节画布请求的上下文快照。intent 存在时必填，并通过统一 agents chat 传递。",
		}),
	chapterIntentGenerationConfig: z
		.object({
			imageModel: z.string().min(1).max(200).optional(),
			imageSize: z.string().min(1).max(40).optional(),
		})
		.optional()
		.openapi({
			description:
				"intent 模式下的结构化生成配置。用于把用户选择的模型/尺寸作为事实传给 agents-cli，不通过自由文本 hint 解析。",
		}),
	chapterIntentVariantParams: z.record(z.unknown()).optional().openapi({
		description:
			"intent 模式下的显式变体参数。仅表达用户在 UI 中选择的确定性模式，不用于语义意图推断。",
	}),
	chapterIntentStyleGuide: z
		.object({
			styleName: z.string().max(200).optional(),
			referenceImages: z.array(z.string().max(2000)).max(8).optional(),
		})
		.optional()
		.openapi({
			description:
				"intent 模式下的画风参考图。当没有 bookId 时，由前端传入当前激活的 activeStyleBible，供服务端用作 globalStyleGuide fallback。",
		}),
});

export const AgentsChatRequestSchema = AgentsChatRequestSchemaBase
	.refine(
		(v) =>
			(typeof v.prompt === "string" && v.prompt.trim().length > 0) ||
			(typeof v.input === "string" && v.input.trim().length > 0) ||
			(Array.isArray(v.input) && v.input.length > 0),
		{
			message: "prompt 或 input 至少提供一个",
			path: ["prompt"],
		},
	)
	.superRefine((value, ctx) => {
		if (value.queueMode && !value.sessionKey) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["sessionKey"],
				message: "sessionKey is required when queueMode is set",
			});
		}
		if (value.resetSession === true && !value.sessionKey) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["sessionKey"],
				message: "sessionKey is required when resetSession is set",
			});
		}
		if (value.resetSession === true && value.queueMode) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["resetSession"],
				message: "resetSession cannot be combined with queueMode",
			});
		}
		if (value.intent && !value.chapterContext) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["chapterContext"],
				message: "chapterContext is required when intent is set",
			});
		}
	});

export type AgentsChatRequestDto = z.infer<typeof AgentsChatRequestSchema>;

export const AgentsChatResponseSchema = z.object({
	id: z.string(),
	vendor: z.string(),
	modelKey: z.string().optional(),
	modelAlias: z.string().optional(),
	text: z.string(),
	assets: z
		.array(
			z.object({
				type: z.enum(["image", "video", "audio", "file"]),
				title: z.string().optional(),
				url: z.string().min(1),
				fileName: z.string().optional(),
				mimeType: z.string().optional(),
					thumbnailUrl: z.string().optional(),
					assetId: z.string().optional(),
					assetRefId: z.string().optional(),
					vendor: z.string().optional(),
					modelKey: z.string().optional(),
					taskId: z.string().optional(),
				}),
		)
		.optional(),
	agentDecision: PublicChatAgentDecisionSchema.optional(),
	trace: PublicChatTraceSchema.optional(),
	pendingUserInput: z
		.object({
			status: z.literal("needs_input"),
			requestId: z.string(),
			questions: z.array(
				z.object({
					id: z.string(),
					header: z.string(),
					question: z.string(),
					options: z.array(
						z.object({
							label: z.string(),
							description: z.string().optional(),
							imageUrl: z.string().optional(),
							thumbnailUrl: z.string().optional(),
						}),
					),
				}),
			),
		})
		.optional(),
	debugLogs: z.array(z.string()).optional(),
	debug: z
		.object({
			mode: z.enum(["chat", "auto"]).optional(),
			referenceImagesCount: z.number().optional(),
			rawAssetCount: z.number().optional(),
			autoJsonAssetCount: z.number().optional(),
			mergedAssetCount: z.number().optional(),
			autoJson: z
				.object({
					present: z.boolean(),
					total: z.number().optional(),
					valid: z.number().optional(),
					empty: z.number().optional(),
				})
				.optional(),
		})
		.optional(),
});

export type AgentsChatResponseDto = z.infer<typeof AgentsChatResponseSchema>;

export const PublicVisionRequestSchema = z
	.object({
	vendor: z.string().optional().openapi({
		description:
			"兼容旧字段；服务端会忽略外部传入值并固定请求 new-api。调用方不应再传该字段。",
		example: "newapi",
	}),
	vendorCandidates: z.array(z.string()).optional().openapi({
		description: "兼容旧字段；服务端会忽略，不再做多渠道候选重试。",
		example: ["newapi"],
	}),
		imageUrl: z.string().optional().openapi({
			description: "图片 URL（http(s)）；也支持传相对路径（以本次请求的 origin 补全）。",
			example:
				"https://github.com/dianping/cat/raw/master/cat-home/src/main/webapp/images/logo/cat_logo03.png",
		}),
		imageData: z.string().optional().openapi({
			description: "图片 DataURL（data:image/*;base64,...）。",
			example: "data:image/png;base64,...",
		}),
		prompt: z.string().optional().openapi({
			description:
				"图片理解任务提示词（可选；为空时服务端会使用默认指令）。若调用方已提供 prompt，服务端会原样透传，不做静默改写或自动拼接。",
			example:
				"请详细分析我提供的图片，推测可用于复现它的英文提示词，包含主体、环境、镜头、光线和风格。输出必须是纯英文提示词，不要添加中文备注或翻译。",
		}),
		modelKey: z.string().optional().openapi({
			description: "已停用的调用方选模字段；图片理解始终固定使用 gpt-5.6-luna，传入值不会覆盖服务端策略。",
			example: "gpt-5.6-luna",
		}),
		modelAlias: z.string().optional().openapi({
			description:
				"已停用的调用方选模字段；图片理解始终固定使用 gpt-5.6-luna，传入值不会覆盖服务端策略。",
			example: "gpt-5.6-luna",
		}),
		systemPrompt: z.string().optional().openapi({
			description: "系统提示词（可选）。",
			example: "请用中文回答。",
		}),
		temperature: z.number().min(0).max(2).optional().openapi({
			description: "采样温度（可选）。",
			example: 0.2,
		}),
	})
	.refine((v) => Boolean(v.imageUrl || v.imageData), {
		message: "imageUrl 或 imageData 必须提供一个",
		path: ["imageUrl"],
	});

export type PublicVisionRequestDto = z.infer<typeof PublicVisionRequestSchema>;

export const PublicVisionResponseSchema = z.object({
	id: z.string(),
	vendor: z.string(),
	text: z.string(),
});

export type PublicVisionResponseDto = z.infer<typeof PublicVisionResponseSchema>;

// ---- Public tasks (API key) ----

export const PublicRunTaskRequestSchema = z.object({
	vendor: z.string().optional().openapi({
		description:
			"兼容旧字段；服务端会忽略外部传入值并固定请求 new-api。调用方不应再传该字段。",
		example: "newapi",
	}),
	vendorCandidates: z.array(z.string()).optional().openapi({
		description: "兼容旧字段；服务端会忽略，不再做多渠道候选重试。",
		example: ["newapi"],
	}),
	request: TaskRequestSchema,
});

export type PublicRunTaskRequestDto = z.infer<typeof PublicRunTaskRequestSchema>;

export const PublicRunTaskResponseSchema = z.object({
	vendor: z.string(),
	result: TaskResultSchema,
});

export type PublicRunTaskResponseDto = z.infer<typeof PublicRunTaskResponseSchema>;

export const PublicFetchTaskResultRequestSchema = z.object({
	taskId: z.string().min(1),
	vendor: z.string().optional().openapi({
		description:
			"兼容旧字段；new-api 任务不需要传 vendor，服务端会优先按 taskId 记录与 new-api 查询。",
		example: "newapi",
	}),
	taskKind: TaskKindSchema.optional(),
	prompt: z.string().nullable().optional(),
});

export type PublicFetchTaskResultRequestDto = z.infer<
	typeof PublicFetchTaskResultRequestSchema
>;

export const PublicFetchTaskResultResponseSchema = z.object({
	vendor: z.string(),
	result: TaskResultSchema,
});

export type PublicFetchTaskResultResponseDto = z.infer<
	typeof PublicFetchTaskResultResponseSchema
>;

export const PublicDrawRequestSchema = z.object({
	vendor: z.string().optional().openapi({
		description:
			"兼容旧字段；服务端会忽略外部传入值并固定请求 new-api。调用方不应再传该字段。",
		example: "newapi",
	}),
	vendorCandidates: z.array(z.string()).optional().openapi({
		description: "兼容旧字段；服务端会忽略，不再做多渠道候选重试。",
		example: ["newapi"],
	}),
	kind: z.enum(["text_to_image", "image_edit"]).optional().openapi({
		description: "任务类型（默认 text_to_image）。",
		example: "text_to_image",
	}),
	prompt: z.string().min(1).openapi({
		description: "提示词（必填）。",
		example: "一张电影感海报，中文“TapCanvas”，高细节，干净背景",
	}),
	negativePrompt: z.string().optional().openapi({
		description: "反向提示词（可选；不同厂商可能忽略）。",
		example: "low quality, blurry, watermark",
	}),
	seed: z.number().optional().openapi({
		description: "随机种子（可选；不同厂商可能忽略）。",
		example: 42,
	}),
	width: z.number().optional().openapi({
		description:
			"宽度（像素）。目前仅 qwen 会严格使用；其他厂商可能仅用于推断横竖构图/选择 portrait/landscape。",
		example: 1328,
	}),
	height: z.number().optional().openapi({
		description:
			"高度（像素）。目前仅 qwen 会严格使用；其他厂商可能仅用于推断横竖构图/选择 portrait/landscape。",
		example: 1328,
	}),
	steps: z.number().optional().openapi({
		description: "采样步数（可选；不同厂商可能忽略）。",
		example: 30,
	}),
	cfgScale: z.number().optional().openapi({
		description: "提示词强度/CFG（可选；不同厂商可能忽略）。",
		example: 7,
	}),
	extras: z.record(z.unknown()).optional().openapi({
		description:
			"额外参数透传（常用：modelAlias/modelKey/aspectRatio/referenceImages/resolution）。不同厂商/通道支持不一致。",
		example: {
			modelAlias: "nano-banana-pro",
			aspectRatio: "1:1",
		},
	}),
});

export type PublicDrawRequestDto = z.infer<typeof PublicDrawRequestSchema>;

export const PublicVideoRequestSchema = z.object({
	vendor: z.string().optional().openapi({
		description:
			"兼容旧字段；服务端会忽略外部传入值并固定请求 new-api。调用方不应再传该字段。",
		example: "newapi",
	}),
	vendorCandidates: z.array(z.string()).optional().openapi({
		description: "兼容旧字段；服务端会忽略，不再做多渠道候选重试。",
		example: ["newapi"],
	}),
	prompt: z.string().min(1),
	durationSeconds: z.number().optional(),
	extras: z.record(z.unknown()).optional(),
});

export type PublicVideoRequestDto = z.infer<typeof PublicVideoRequestSchema>;

export const PublicOssUploadRequestSchema = z
	.object({
		sourceUrl: z.string().optional().openapi({
			description: "待上传的远端文件 URL（http/https）。",
			example: "https://example.com/sample.mp4",
		}),
		dataUrl: z.string().optional().openapi({
			description: "待上传文件的 Data URL（data:<mime>;base64,...）。",
			example: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...",
		}),
		fileName: z.string().optional().openapi({
			description: "原始文件名（可选，用于扩展名推断）。",
			example: "sample.mp4",
		}),
		contentType: z.string().optional().openapi({
			description: "内容类型（可选；优先于 fileName 推断）。",
			example: "video/mp4",
		}),
		name: z.string().optional().openapi({
			description: "资产展示名（可选）。",
			example: "产品演示视频",
		}),
		prompt: z.string().optional(),
		vendor: z.string().optional(),
		modelKey: z.string().optional(),
		taskKind: z.string().optional(),
	})
	.refine((v) => Boolean(v.sourceUrl || v.dataUrl), {
		message: "sourceUrl 或 dataUrl 必须提供一个",
		path: ["sourceUrl"],
	});

export type PublicOssUploadRequestDto = z.infer<typeof PublicOssUploadRequestSchema>;

export const PublicOssUploadResponseSchema = z.object({
	id: z.string(),
	name: z.string(),
	type: z.enum(["image", "video", "file"]),
	url: z.string(),
	key: z.string(),
	contentType: z.string(),
	size: z.number().nullable(),
});

export type PublicOssUploadResponseDto = z.infer<typeof PublicOssUploadResponseSchema>;

export const PublicVideoUnderstandRequestSchema = z.object({
	vendor: z.string().optional().openapi({
		description:
			"兼容旧字段；服务端会忽略外部传入值并固定请求 new-api。调用方不应再传该字段。",
		example: "newapi",
	}),
	vendorCandidates: z.array(z.string()).optional().openapi({
		description: "兼容旧字段；服务端会忽略，不再做多渠道候选重试。",
		example: ["newapi"],
	}),
	prompt: z.string().min(1).openapi({
		description: "视频理解任务提示词（例如总结、提取分镜、问答等）。",
		example: "请总结视频内容并输出 5 个镜头段落。",
	}),
	videoFileUri: z.string().min(1).optional().openapi({
		description: "Gemini Files API 返回的 file_uri（可选；若未提供可用 videoUrl/videoData 自动上传）。",
		example: "https://generativelanguage.googleapis.com/v1beta/files/abc123",
	}),
	videoUrl: z.string().optional().openapi({
		description: "远程视频 URL（http/https）。当未传 videoFileUri 时，服务端会下载并上传为 Gemini file_uri。",
		example: "https://example.com/sample.mp4",
	}),
	videoData: z.string().optional().openapi({
		description: "视频 Data URL（data:video/*;base64,...）。当未传 videoFileUri 时，服务端会上传为 Gemini file_uri。",
		example: "data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb20...",
	}),
	videoMimeType: z.string().optional().openapi({
		description: "视频 MIME（默认 video/mp4）。",
		example: "video/mp4",
	}),
	modelAlias: z.string().optional().openapi({
		description: "模型别名（推荐文本模型别名）。",
		example: "gemini-3-flash-preview",
	}),
	modelKey: z.string().optional().openapi({
		description: "模型 key（可选）。",
		example: "gemini-3-flash-preview",
	}),
	systemPrompt: z.string().optional().openapi({
		description: "系统提示词（可选）。",
		example: "请用中文回答。",
	}),
	temperature: z.number().min(0).max(2).optional().openapi({
		description: "采样温度（可选）。",
		example: 0.2,
	}),
}).refine((v) => Boolean(v.videoFileUri || v.videoUrl || v.videoData), {
	message: "videoFileUri / videoUrl / videoData 至少提供一个",
	path: ["videoFileUri"],
});

export type PublicVideoUnderstandRequestDto = z.infer<typeof PublicVideoUnderstandRequestSchema>;

export const PublicVideoUnderstandResponseSchema = z.object({
	id: z.string(),
	vendor: z.string(),
	text: z.string(),
	result: TaskResultSchema,
});

export type PublicVideoUnderstandResponseDto = z.infer<typeof PublicVideoUnderstandResponseSchema>;
