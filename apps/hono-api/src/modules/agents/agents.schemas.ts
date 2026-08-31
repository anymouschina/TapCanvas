import { z } from "zod";
import { SkillMarketplaceCategorySchema } from "./skill-marketplace.constants";
import {
	AgentAnnotationQueueItemSchema,
	AgentDiagnosticsMetricsSchema,
	AgentEvaluationResultSchema,
	AgentHumanFeedbackSchema,
	AgentRegressionExampleSchema,
	AgentSpanKindSchema,
	AgentSpanStatusSchema,
	AgentTraceSpanSchema,
} from "./agent-observability.schemas";

export const AgentSkillSchema = z.object({
	id: z.string(),
	key: z.string(),
	name: z.string(),
	description: z.string().nullable().optional(),
	content: z.string(),
	logoUrl: z.string().url().nullable(),
	category: z.string(),
	enabled: z.boolean(),
	visible: z.boolean(),
	sortOrder: z.number().int().nullable().optional(),
	createdAt: z.string(),
	updatedAt: z.string(),
});

export type AgentSkillDto = z.infer<typeof AgentSkillSchema>;

export const AgentSkillMetadataSchema = AgentSkillSchema.omit({ content: true });

export type AgentSkillMetadataDto = z.infer<typeof AgentSkillMetadataSchema>;

export const UserContextAssetKindSchema = z.literal("skill");

export const UserContextAssetMarketplaceListingSchema = z.object({
	productId: z.string(),
	priceCredits: z.number().int().positive(),
	listedAt: z.string(),
});

export const UserContextAssetSchema = z.object({
	id: z.string(),
	kind: UserContextAssetKindSchema,
	fileName: z.string(),
	name: z.string(),
	description: z.string().nullable(),
	logoUrl: z.string().url().nullable(),
	sizeBytes: z.number().int().min(0),
	sha256: z.string(),
	marketplaceListing: UserContextAssetMarketplaceListingSchema.nullable(),
	sourceMarketplaceProductId: z.string().nullable(),
	createdAt: z.string(),
	updatedAt: z.string(),
});

export type UserContextAssetDto = z.infer<typeof UserContextAssetSchema>;

export const UserContextAssetContentSchema = UserContextAssetSchema.extend({
	content: z.string(),
});

const HostedSkillLogoUrlSchema = z.string().url().max(2_048).refine(
	(value) => value.startsWith("https://") || value.startsWith("http://"),
	"Skill Logo 必须是可访问的 HTTP(S) URL",
);

export const CreateUserContextAssetRequestSchema = z
	.object({
		fileName: z.string().min(1).max(180),
		content: z.string().min(1).max(200_000),
		name: z.string().min(1).max(120).optional(),
		description: z.string().max(4_000).nullable().optional(),
		logoUrl: HostedSkillLogoUrlSchema,
		overwrite: z.boolean().optional(),
	})
	.strict();

export type CreateUserContextAssetRequestDto = z.infer<
	typeof CreateUserContextAssetRequestSchema
>;

export const UpdateUserContextAssetRequestSchema = z
	.object({
		name: z.string().min(1).max(120).optional(),
		description: z.string().max(4_000).nullable().optional(),
		logoUrl: HostedSkillLogoUrlSchema.optional(),
		content: z.string().min(1).max(200_000).optional(),
	})
	.strict()
	.refine((value) => Object.keys(value).length > 0, "至少提供一个要更新的字段");

export type UpdateUserContextAssetRequestDto = z.infer<
	typeof UpdateUserContextAssetRequestSchema
>;

export const ListUserContextAssetMarketplaceRequestSchema = z.object({
	priceCredits: z.number().int().min(1).max(10_000_000),
	category: SkillMarketplaceCategorySchema,
}).strict();

export const UpsertAgentSkillRequestSchema = z
	.object({
		id: z.string().optional(),
		key: z.string().optional(),
		name: z.string().optional(),
		description: z.string().nullable().optional(),
		content: z.string().optional(),
		logoUrl: z.string().url().max(2_048).nullable().optional(),
		category: z.string().min(1).max(40).optional(),
		enabled: z.boolean().optional(),
		visible: z.boolean().optional(),
		sortOrder: z.number().int().nullable().optional(),
	})
	.strict();

export type UpsertAgentSkillRequestDto = z.infer<
	typeof UpsertAgentSkillRequestSchema
>;

export const AgentPipelineRunStatusSchema = z.enum([
	"queued",
	"running",
	"succeeded",
	"failed",
	"canceled",
]);

export const AgentPipelineStageSchema = z.enum([
	"material_ingest",
	"script_breakdown",
	"storyboard_generation",
	"shot_planning",
	"image_generation",
	"video_generation",
	"qc_publish",
]);

export const AgentPipelineRunSchema = z.object({
	id: z.string(),
	ownerId: z.string(),
	projectId: z.string(),
	title: z.string(),
	goal: z.string().nullable().optional(),
	status: AgentPipelineRunStatusSchema,
	stages: z.array(AgentPipelineStageSchema),
	progress: z.unknown().optional(),
	result: z.unknown().optional(),
	errorMessage: z.string().nullable().optional(),
	createdAt: z.string(),
	updatedAt: z.string(),
	startedAt: z.string().nullable().optional(),
	finishedAt: z.string().nullable().optional(),
});

export type AgentPipelineRunDto = z.infer<typeof AgentPipelineRunSchema>;

export const CreateAgentPipelineRunRequestSchema = z
	.object({
		projectId: z.string().min(1),
		title: z.string().min(1).max(200),
		goal: z.string().max(5000).nullable().optional(),
		stages: z.array(AgentPipelineStageSchema).min(1).max(16),
	})
	.strict();

export type CreateAgentPipelineRunRequestDto = z.infer<
	typeof CreateAgentPipelineRunRequestSchema
>;

export const UpdateAgentPipelineRunStatusRequestSchema = z
	.object({
		status: AgentPipelineRunStatusSchema,
		progress: z.unknown().optional(),
		result: z.unknown().optional(),
		errorMessage: z.string().max(5000).nullable().optional(),
	})
	.strict();

export type UpdateAgentPipelineRunStatusRequestDto = z.infer<
	typeof UpdateAgentPipelineRunStatusRequestSchema
>;

export const ExecuteAgentPipelineRunRequestSchema = z
	.object({
		force: z.boolean().optional(),
		skipMediaGeneration: z.boolean().optional(),
		systemPrompt: z.string().max(5000).optional(),
		modelKey: z.string().min(1).max(200).optional(),
		chapter: z.number().int().min(1).max(9999).optional(),
		bookId: z.string().min(1).max(200).optional(),
		progress: z
			.object({
				taskId: z.string().min(1).max(200).optional(),
				previousChunkId: z.string().min(1).max(300).optional(),
				mode: z.union([z.literal("single"), z.literal("full")]).optional(),
				groupSize: z.union([z.literal(1), z.literal(4), z.literal(9), z.literal(25)]).optional(),
				totalShots: z.number().int().min(0).max(5000).optional(),
				completedShots: z.number().int().min(0).max(5000).optional(),
				nextShotStart: z.number().int().min(1).max(5000).optional(),
				nextShotEnd: z.number().int().min(1).max(5000).optional(),
				totalGroups: z.number().int().min(0).max(5000).optional(),
				completedGroups: z.number().int().min(0).max(5000).optional(),
				existingStoryboardContent: z.string().max(200000).optional(),
			})
			.strict()
			.optional(),
	})
	.strict();

export type ExecuteAgentPipelineRunRequestDto = z.infer<
	typeof ExecuteAgentPipelineRunRequestSchema
>;

export const AgentDiagnosticsTraceSchema = z.object({
	id: z.string(),
	scopeType: z.string(),
	scopeId: z.string(),
	taskId: z.string().nullable(),
	requestKind: z.string(),
	inputSummary: z.string(),
	decisionLog: z.array(z.string()),
	toolCalls: z.array(z.record(z.string(), z.unknown())),
	meta: z.record(z.string(), z.unknown()).nullable(),
	resultSummary: z.string().nullable(),
	errorCode: z.string().nullable(),
	errorDetail: z.string().nullable(),
	createdAt: z.string(),
	status: z.string(),
	sessionKey: z.string().nullable(),
	workflowKey: z.string().nullable(),
	logicalTaskId: z.string().nullable(),
	rootTraceId: z.string().nullable(),
	parentTraceId: z.string().nullable(),
	physicalRunId: z.string().nullable(),
	workflowRunId: z.string().nullable(),
	startedAt: z.string(),
	updatedAt: z.string(),
	finishedAt: z.string().nullable(),
	nextEventSeq: z.number().int().min(0),
});

export const AgentExecutionHealthSchema = z.object({
	status: z.enum(["healthy", "degraded"]),
	staleAfterSeconds: z.number().int().min(60),
	totalTraceCount: z.number().int().min(0),
	runningTraceCount: z.number().int().min(0),
	waitingAsyncTraceCount: z.number().int().min(0),
	staleRunningTraceCount: z.number().int().min(0),
	sequenceMismatchCount: z.number().int().min(0),
	terminalIntegrityIssueCount: z.number().int().min(0),
	orphanParentTraceCount: z.number().int().min(0),
	persistenceDegradedTraceCount: z.number().int().min(0),
	totalEventCount: z.number().int().min(0),
	totalPayloadBytes: z.number().int().min(0),
	oldestActiveStartedAt: z.string().nullable(),
	calculatedAt: z.string(),
});

export const AgentExecutionEventSchema = z.object({
	id: z.string(),
	traceId: z.string(),
	seq: z.number().int().min(1),
	producerEventId: z.string(),
	eventType: z.string(),
	eventClass: z.string(),
	eventKey: z.string(),
	phase: z.string().nullable(),
	status: z.string().nullable(),
	logicalTaskId: z.string().nullable(),
	rootTraceId: z.string().nullable(),
	parentTraceId: z.string().nullable(),
	physicalRunId: z.string().nullable(),
	workflowRunId: z.string().nullable(),
	workflowNodeId: z.string().nullable(),
	agentId: z.string().nullable(),
	parentAgentId: z.string().nullable(),
	toolCallId: z.string().nullable(),
	effectId: z.string().nullable(),
	providerTaskId: z.string().nullable(),
	spanId: z.string().nullable(),
	parentSpanId: z.string().nullable(),
	attempt: z.number().int().min(1).nullable(),
	payload: z.record(z.string(), z.unknown()),
	payloadSizeBytes: z.number().int().min(0),
	payloadTruncated: z.boolean(),
	createdAt: z.string(),
});

export const AgentExecutionEventPageSchema = z.object({
	events: z.array(AgentExecutionEventSchema),
	nextAfterSeq: z.number().int().min(1).nullable(),
	latestSeq: z.number().int().min(0),
	traceStatus: z.enum(["running", "succeeded", "failed", "cancelled", "waiting_async"]),
	serverObservedAt: z.string(),
	hasMore: z.boolean(),
	integrity: z.object({
		status: z.enum(["consistent", "incomplete", "inconsistent"]),
		requestAcceptedCount: z.number().int().min(0),
		terminalEventCount: z.number().int().min(0),
		persistedEventCount: z.number().int().min(0),
		latestPersistedSeq: z.number().int().min(0),
		issues: z.array(z.object({
			code: z.string(),
			severity: z.enum(["warning", "error"]),
			detail: z.string(),
		})),
	}),
});

export const AgentDiagnosticsPublicChatTurnRunSchema = z.object({
	id: z.string(),
	sessionId: z.string(),
	sessionKey: z.string(),
	requestId: z.string().nullable(),
	projectId: z.string().nullable(),
	bookId: z.string().nullable(),
	chapterId: z.string().nullable(),
	label: z.string().nullable(),
	workflowKey: z.string(),
	requestKind: z.string(),
	userMessageId: z.string().nullable(),
	assistantMessageId: z.string().nullable(),
	outputMode: z.string(),
	turnVerdict: z.enum(["satisfied", "partial", "failed"]),
	turnVerdictReasons: z.array(z.string()),
	runOutcome: z.enum(["promote", "hold", "discard"]),
	agentDecision: z.record(z.string(), z.unknown()).nullable(),
	toolStatusSummary: z.record(z.string(), z.unknown()).nullable(),
	diagnosticFlags: z.array(z.record(z.string(), z.unknown())),
	canvasPlan: z.record(z.string(), z.unknown()).nullable(),
	assetCount: z.number().int().min(0),
	canvasWrite: z.boolean(),
	runMs: z.number().int().min(0).nullable(),
	createdAt: z.string(),
});

export const AgentDiagnosticsResponseSchema = z.object({
	projectId: z.string().nullable(),
	bookId: z.string().nullable(),
	chapterId: z.string().nullable(),
	flowId: z.string().nullable(),
	nodeId: z.string().nullable(),
	label: z.string().nullable(),
	traces: z.array(AgentDiagnosticsTraceSchema),
	executionHealth: AgentExecutionHealthSchema,
	publicChatRuns: z.array(AgentDiagnosticsPublicChatTurnRunSchema),
	storyboardDiagnostics: z.array(z.unknown()),
	spans: z.array(AgentTraceSpanSchema),
	metrics: AgentDiagnosticsMetricsSchema,
	evaluations: z.array(AgentEvaluationResultSchema),
	humanFeedback: z.array(AgentHumanFeedbackSchema),
	annotationQueue: z.array(AgentAnnotationQueueItemSchema),
	regressionExamples: z.array(AgentRegressionExampleSchema),
	nextCursor: z.string().nullable(),
});

export type AgentDiagnosticsResponseDto = z.infer<typeof AgentDiagnosticsResponseSchema>;

const OptionalDiagnosticsStringSchema = z.preprocess(
	(value) => typeof value === "string" && value.trim() ? value.trim() : undefined,
	z.string().max(240).optional(),
);

export const AgentDiagnosticsQuerySchema = z.object({
	traceId: OptionalDiagnosticsStringSchema,
	projectId: OptionalDiagnosticsStringSchema,
	bookId: OptionalDiagnosticsStringSchema,
	chapterId: OptionalDiagnosticsStringSchema,
	flowId: OptionalDiagnosticsStringSchema,
	nodeId: OptionalDiagnosticsStringSchema,
	label: OptionalDiagnosticsStringSchema,
	workflowKey: OptionalDiagnosticsStringSchema,
	modelKey: OptionalDiagnosticsStringSchema,
	status: z.preprocess(
		(value) => typeof value === "string" && value.trim() ? value.trim() : undefined,
		AgentSpanStatusSchema.optional(),
	),
	kind: z.preprocess(
		(value) => typeof value === "string" && value.trim() ? value.trim() : undefined,
		AgentSpanKindSchema.optional(),
	),
	from: z.preprocess(
		(value) => typeof value === "string" && value.trim() ? value.trim() : undefined,
		z.string().datetime().optional(),
	),
	to: z.preprocess(
		(value) => typeof value === "string" && value.trim() ? value.trim() : undefined,
		z.string().datetime().optional(),
	),
	cursor: z.preprocess(
		(value) => typeof value === "string" && value.trim() ? value.trim() : undefined,
		z.string().max(1_000).optional(),
	),
	turnVerdict: z.preprocess(
		(value) => typeof value === "string" && value.trim() ? value.trim() : undefined,
		z.enum(["satisfied", "partial", "failed"]).optional(),
	),
	runOutcome: z.preprocess(
		(value) => typeof value === "string" && value.trim() ? value.trim() : undefined,
		z.enum(["promote", "hold", "discard"]).optional(),
	),
	limit: z.coerce.number().int().min(1).max(200).default(50),
}).strict().superRefine((value, context) => {
	if (value.from && value.to && Date.parse(value.from) > Date.parse(value.to)) {
		context.addIssue({
			code: "custom",
			path: ["from"],
			message: "from must be earlier than or equal to to",
		});
	}
});

export type AgentDiagnosticsQueryDto = z.infer<typeof AgentDiagnosticsQuerySchema>;

export const ProjectWorkspaceContextFileVersionSchema = z.object({
  versionId: z.string(),
  fileName: z.string(),
  layer: z.union([z.literal("global"), z.literal("project")]),
  updatedAt: z.string(),
  updatedBy: z.string(),
});

export const ProjectWorkspaceContextFileVersionContentSchema = z.object({
  versionId: z.string(),
  fileName: z.string(),
  layer: z.union([z.literal("global"), z.literal("project")]),
  updatedAt: z.string(),
  updatedBy: z.string(),
  content: z.string(),
});

export const ProjectWorkspaceContextFileSchema = z.object({
  path: z.string(),
  content: z.string(),
  layer: z.union([z.literal("global"), z.literal("project")]),
  updatedAt: z.string().nullable(),
  updatedBy: z.string().nullable(),
  history: z.array(ProjectWorkspaceContextFileVersionSchema),
});

export const ProjectWorkspaceContextSchema = z.object({
  projectId: z.string(),
  ownerId: z.string(),
  projectRoot: z.string(),
  globalContextDir: z.string(),
  projectContextDir: z.string(),
  currentBookId: z.string().nullable(),
  currentChapter: z.number().int().nullable(),
  globalFiles: z.array(ProjectWorkspaceContextFileSchema),
  projectFiles: z.array(ProjectWorkspaceContextFileSchema),
});

export type ProjectWorkspaceContextDto = z.infer<typeof ProjectWorkspaceContextSchema>;

export const RollbackProjectWorkspaceContextFileRequestSchema = z.object({
  projectId: z.string().min(1),
  fileName: z.union([
    z.literal("PROJECT.md"),
    z.literal("CREATIVE_BRIEF.md"),
    z.literal("RULES.md"),
    z.literal("CHARACTERS.md"),
    z.literal("STORY_STATE.md"),
  ]),
  versionId: z.string().min(1).max(200),
}).strict();

export type RollbackProjectWorkspaceContextFileRequestDto = z.infer<
  typeof RollbackProjectWorkspaceContextFileRequestSchema
>;

export const RollbackGlobalWorkspaceContextFileRequestSchema = z.object({
  fileName: z.literal("GLOBAL_RULES.md"),
  versionId: z.string().min(1).max(200),
}).strict();

export type RollbackGlobalWorkspaceContextFileRequestDto = z.infer<
  typeof RollbackGlobalWorkspaceContextFileRequestSchema
>;

export const ProjectWorkspaceContextVerifyFileSchema = z.object({
  layer: z.union([z.literal("global"), z.literal("project")]),
  path: z.string(),
  charCount: z.number().int().min(0),
  truncated: z.boolean(),
  updatedAt: z.string().nullable(),
  updatedBy: z.string().nullable(),
});

export const ProjectWorkspaceContextVerifyResponseSchema = z.object({
  projectId: z.string(),
  ownerId: z.string(),
  projectRoot: z.string(),
  globalContextDir: z.string(),
  projectContextDir: z.string(),
  budgets: z.object({
    maxCharsPerFile: z.number().int().min(1),
    maxTotalChars: z.number().int().min(1),
  }),
  totalChars: z.number().int().min(0),
  files: z.array(ProjectWorkspaceContextVerifyFileSchema),
  warnings: z.array(z.string()),
});

export type ProjectWorkspaceContextVerifyResponseDto = z.infer<
  typeof ProjectWorkspaceContextVerifyResponseSchema
>;



export const UpdateProjectWorkspaceContextFileRequestSchema = z.object({
  projectId: z.string().min(1),
  fileName: z.union([
    z.literal("PROJECT.md"),
    z.literal("CREATIVE_BRIEF.md"),
    z.literal("RULES.md"),
    z.literal("CHARACTERS.md"),
    z.literal("STORY_STATE.md"),
  ]),
  content: z.string().max(200_000),
}).strict();

export type UpdateProjectWorkspaceContextFileRequestDto = z.infer<typeof UpdateProjectWorkspaceContextFileRequestSchema>;

export const UpdateGlobalWorkspaceContextFileRequestSchema = z.object({
  fileName: z.literal("GLOBAL_RULES.md"),
  content: z.string().max(200_000),
}).strict();

export type UpdateGlobalWorkspaceContextFileRequestDto = z.infer<typeof UpdateGlobalWorkspaceContextFileRequestSchema>;
