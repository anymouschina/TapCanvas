import { z } from "zod";

export const CapabilityKindSchema = z.literal("workflow");

export const WorkflowCapabilityDescriptorSchema = z.object({
	protocolVersion: z.literal("tapcanvas.agent-capability/v1"),
	capabilityId: z.string().min(1),
	kind: CapabilityKindSchema,
	name: z.string().min(1),
	summary: z.string(),
	sourceId: z.string().min(1),
	sourceVersionId: z.string().min(1),
	sourceRevision: z.number().int().min(0),
	projectId: z.string().nullable(),
	triggerNodeId: z.string().min(1),
	nodeCount: z.number().int().min(1),
	operations: z.array(z.string()),
	requiredSkills: z.array(z.string()),
	requiredTools: z.array(z.string()),
	inputArtifacts: z.array(z.string()),
	outputArtifacts: z.array(z.string()),
	invocation: z.object({
		sourceMode: z.enum(["inline_text", "canvas_group", "project_context", "none"]),
		requiredTriggerPayloadFields: z.array(z.string()),
		executionVariant: z.enum(["full_video", "first_video"]).optional(),
	}).optional(),
	permissions: z.array(z.string()),
	sideEffects: z.array(z.enum(["none", "local_mutation", "external_mutation", "paid_generation"])),
	semanticEvidence: z.array(z.object({
		label: z.string(),
		description: z.string(),
		operation: z.string(),
	})),
});

export type WorkflowCapabilityDescriptor = z.infer<typeof WorkflowCapabilityDescriptorSchema>;

export const CapabilityConflictSeveritySchema = z.enum(["blocking", "warning", "info"]);
export const CapabilityConflictCategorySchema = z.enum([
	"identity_collision",
	"version_change",
	"permission_overlap",
	"functional_overlap",
	"semantic_overlap",
	"goal_contradiction",
	"side_effect_collision",
	"input_output_ambiguity",
]);

export const CapabilityConflictSchema = z.object({
	id: z.string().min(1),
	severity: CapabilityConflictSeveritySchema,
	category: CapabilityConflictCategorySchema,
	withCapabilityId: z.string().nullable(),
	resolutionMode: z.enum(["acknowledge", "choose_primary"]),
	title: z.string().min(1),
	rationale: z.string().min(1),
	resolution: z.string().min(1),
});

export const CapabilityConflictReportSchema = z.object({
	protocolVersion: z.literal("tapcanvas.capability-conflict-report/v1"),
	targetCapabilityId: z.string().min(1),
	checkedAt: z.string().min(1),
	descriptorSha256: z.string().min(1),
	semanticAnalysis: z.discriminatedUnion("status", [
		z.object({ status: z.literal("succeeded") }).strict(),
		z.object({
			status: z.literal("unavailable"),
			errorCode: z.string().min(1),
			message: z.string().min(1),
		}).strict(),
	]).default({ status: "succeeded" }),
	conflicts: z.array(CapabilityConflictSchema),
	blocking: z.boolean(),
	requiresConfirmation: z.boolean(),
});

export type CapabilityConflictReport = z.infer<typeof CapabilityConflictReportSchema>;

export const CapabilityRouteDecisionSchema = z.object({
	conflictId: z.string().min(1),
	withCapabilityId: z.string().nullable(),
	action: z.enum(["acknowledge", "replace_existing"]),
}).strict();

/**
 * 工作流装配给小T的作用范围：
 * - current_user：仅装配用户自己可见/可用（普通用户默认，管理员个人使用）。
 * - all_users：管理员发布的系统级工作流，全体用户可见/可用。
 */
export const WorkflowCapabilityEquipScopeSchema = z.enum(["current_user", "all_users"]);
export type WorkflowCapabilityEquipScope = z.infer<typeof WorkflowCapabilityEquipScopeSchema>;

export const AgentCapabilityAttachmentSchema = z.object({
	id: z.string(),
	kind: CapabilityKindSchema,
	sourceId: z.string(),
	sourceVersionId: z.string(),
	descriptorSha256: z.string(),
	descriptor: WorkflowCapabilityDescriptorSchema,
	conflictReport: CapabilityConflictReportSchema,
	routeDecisions: z.array(CapabilityRouteDecisionSchema),
	routingReady: z.boolean(),
	scope: WorkflowCapabilityEquipScopeSchema.default("current_user"),
	// 当前用户是否启用了该系统级工作流（all_users）；自己的装配恒为 true。
	userEnabled: z.boolean().default(true),
	createdAt: z.string(),
	updatedAt: z.string(),
});

export const CapabilityBayCandidateSchema = z.object({
	descriptor: WorkflowCapabilityDescriptorSchema,
	descriptorSha256: z.string(),
	projectName: z.string().nullable(),
	attached: z.boolean(),
	attachedVersionId: z.string().nullable(),
	stale: z.boolean(),
});

export const SkillCapabilityStateSchema = z.object({
	id: z.string().min(1),
	key: z.string().min(1),
	name: z.string().min(1),
	description: z.string().nullable(),
	logoUrl: z.string().nullable(),
	category: z.string(),
	enabled: z.boolean(),
	disabledReason: z.enum(["user", "replaced"]).nullable(),
	replacedByCapabilityId: z.string().nullable(),
});

export const BuiltInCapabilityStateSchema = z.object({
	id: z.string().min(1),
	key: z.string().min(1),
	name: z.string().min(1),
	description: z.string(),
	requiredTools: z.array(z.string()),
	sideEffects: z.array(z.enum(["none", "external_mutation", "paid_generation"])),
	enabled: z.boolean(),
	systemEnabled: z.boolean(),
	userEnabled: z.boolean(),
	disabledReason: z.enum(["system", "user", "replaced"]).nullable(),
	replacedByCapabilityId: z.string().nullable(),
	replaceable: z.boolean(),
});

export const AiWorkflowProjectSchema = z.object({
	id: z.string().min(1),
	name: z.string().min(1),
	projectKind: z.literal("ai_workflow"),
	flowCount: z.number().int().min(0),
	updatedAt: z.string().min(1),
	canDelete: z.boolean(),
});

export const CapabilityBayProjectSchema = z.object({
	id: z.string().min(1),
	name: z.string().min(1),
	projectKind: z.enum(["creative", "ai_workflow"]),
	flowCount: z.number().int().min(0),
	updatedAt: z.string().min(1),
});

export const CapabilityInvocationSchema = z.object({
	id: z.string().min(1),
	attachmentId: z.string().min(1),
	capabilityId: z.string().min(1),
	capabilityName: z.string().min(1),
	sourceId: z.string().min(1),
	sourceVersionId: z.string().min(1),
	descriptorSha256: z.string().min(1),
	workflowExecutionId: z.string().min(1),
	executionStatus: z.enum(["queued", "running", "success", "failed", "canceled"]),
	executionErrorMessage: z.string().nullable(),
	agentExecutionId: z.string().nullable(),
	sessionId: z.string().nullable(),
	toolCallId: z.string().nullable(),
	input: z.record(z.string(), z.unknown()).nullable(),
	createdAt: z.string().min(1),
	startedAt: z.string().nullable(),
	finishedAt: z.string().nullable(),
});

export const CapabilityBayResponseSchema = z.object({
	productName: z.literal("Agent 配置"),
	candidates: z.array(CapabilityBayCandidateSchema),
	attachments: z.array(AgentCapabilityAttachmentSchema),
	skills: z.array(SkillCapabilityStateSchema),
	builtInCapabilities: z.array(BuiltInCapabilityStateSchema),
	currentProject: CapabilityBayProjectSchema.nullable(),
	workflowProjects: z.array(AiWorkflowProjectSchema),
	invocations: z.array(CapabilityInvocationSchema),
});

export const InspectCapabilityRequestSchema = z.object({
	flowId: z.string().min(1),
}).strict();

export const GenerateWorkflowCapabilityDescriptionRequestSchema = z.object({
	model: z.string().trim().min(1).max(200),
	workflow: z.object({
		name: z.string().trim().min(1).max(200),
		nodeCount: z.number().int().min(0).max(10_000),
		edgeCount: z.number().int().min(0).max(50_000),
		invocation: z.object({
			sourceMode: z.enum(["inline_text", "canvas_group", "project_context", "none"]),
			requiredTriggerPayloadFields: z.array(z.string().trim().min(1)).max(16),
			executionVariant: z.enum(["full_video", "first_video"]).optional(),
		}).strict(),
		stages: z.array(z.object({
			label: z.string().trim().min(1).max(200),
			description: z.string().trim().max(2_000),
			operation: z.string().trim().max(200),
			executorRef: z.string().trim().max(300),
			outputArtifactType: z.string().trim().max(200),
		}).strict()).max(64),
	}).strict(),
}).strict();

export const GenerateWorkflowCapabilityDescriptionResponseSchema = z.object({
	description: z.string().trim().min(1).max(1_000),
}).strict();

export type GenerateWorkflowCapabilityDescriptionRequest = z.infer<typeof GenerateWorkflowCapabilityDescriptionRequestSchema>;

export const CapabilityBayQuerySchema = z.object({
	projectId: z.string().min(1).optional(),
}).strict();

export const CreateAiWorkflowProjectRequestSchema = z.object({
	name: z.string().trim().min(1).max(120),
}).strict();

export const AdoptAiWorkflowProjectRequestSchema = z.object({
	projectKind: z.literal("ai_workflow"),
}).strict();

export const AdoptAiWorkflowProjectResponseSchema = z.object({
	projectId: z.string().min(1),
	projectName: z.string().min(1),
	projectKind: z.literal("ai_workflow"),
	flowCount: z.number().int().min(1),
	eligibleFlowCount: z.number().int().min(1),
	changed: z.boolean(),
	updatedAt: z.string().min(1),
}).strict();

export const UpdateSkillCapabilityRequestSchema = z.object({
	enabled: z.boolean(),
}).strict();

export const UpdateBuiltInCapabilityRequestSchema = z.object({
	enabled: z.boolean(),
}).strict();

export const EquipCapabilityRequestSchema = z.object({
	sourceVersionId: z.string().min(1),
	descriptorSha256: z.string().min(1),
	inspectionToken: z.string().min(1),
	resolutions: z.array(CapabilityRouteDecisionSchema).max(48),
	// 管理员装配时可显式选择作用范围；缺省为 current_user（普通用户不传）。
	scope: WorkflowCapabilityEquipScopeSchema.optional(),
}).strict();

export const CapabilityInspectionGrantSchema = z.object({
	purpose: z.literal("capability_inspection"),
	userId: z.string().min(1),
	flowId: z.string().min(1),
	sourceVersionId: z.string().min(1),
	descriptorSha256: z.string().min(1),
	attachmentStateSha256: z.string().min(1),
	skillStateSha256: z.string().min(1),
	preferenceStateSha256: z.string().min(1),
	builtInCapabilityStateSha256: z.string().min(1),
	report: CapabilityConflictReportSchema,
	iat: z.number().int().optional(),
	exp: z.number().int().optional(),
}).strict();

/** 普通用户手动关闭/重新启用系统级（all_users）工作流的状态请求。 */
export const UpdateWorkflowCapabilityStateRequestSchema = z.object({
	enabled: z.boolean(),
}).strict();
