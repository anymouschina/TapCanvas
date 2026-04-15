import { z } from "zod";

export const AgentSkillSchema = z.object({
	id: z.string(),
	key: z.string(),
	name: z.string(),
	description: z.string().nullable().optional(),
	content: z.string(),
	enabled: z.boolean(),
	visible: z.boolean(),
	sortOrder: z.number().int().nullable().optional(),
	createdAt: z.string(),
	updatedAt: z.string(),
});

export type AgentSkillDto = z.infer<typeof AgentSkillSchema>;

export const UpsertAgentSkillRequestSchema = z
	.object({
		id: z.string().optional(),
		key: z.string().optional(),
		name: z.string().optional(),
		description: z.string().nullable().optional(),
		content: z.string().optional(),
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
	label: z.string().nullable(),
	traces: z.array(AgentDiagnosticsTraceSchema),
	publicChatRuns: z.array(AgentDiagnosticsPublicChatTurnRunSchema),
	storyboardDiagnostics: z.array(z.unknown()),
});

export type AgentDiagnosticsResponseDto = z.infer<typeof AgentDiagnosticsResponseSchema>;

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
