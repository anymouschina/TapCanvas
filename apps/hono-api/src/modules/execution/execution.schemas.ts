import { WorkflowAuthorRepairRequestSchema } from "./execution.author-repair";
import { WorkflowMediaAdoptionsSchema } from "./execution.media-adoption";
import { WorkflowPlanningRevisionSchema } from "./execution.planning-revision";
import { WorkflowNodeAgentProgressSchema } from "./execution.agent-progress";
import { z } from "zod";
import {
	WORKFLOW_CONCURRENCY_MAX,
	WORKFLOW_CONCURRENCY_MIN,
} from "@tapcanvas/workflow-kernel-protocol";

export const ExecutionStatusSchema = z.enum([
	"queued",
	"running",
	"success",
	"failed",
	"canceled",
]);

export const NodeRunStatusSchema = z.enum([
	"queued",
	"running",
	"waiting_external",
	"success",
	"failed",
	"canceled",
	"skipped",
	"not_selected",
]);

export const ExecutionEventLevelSchema = z.enum([
	"debug",
	"info",
	"warn",
	"error",
]);

export const ExecutionEventTypeSchema = z.enum([
	"agent_preferences_changed",
	"execution_created",
	"execution_started",
	"node_queued",
	"node_started",
	"node_heartbeat",
	"node_external_check_started",
	"node_waiting_external",
	"node_recovered_after_restart",
	"node_recovery_started",
	"node_retry_scheduled",
	"node_restart_interrupted",
	"node_progress",
	"node_agent_activity",
	"node_log",
	"node_succeeded",
	"node_failed",
	"execution_succeeded",
	"execution_failed",
	"execution_canceled",
	"node_output_after_cancel",
	"node_stale_attempt_ignored",
	"node_output_reused",
	"node_not_selected",
]);

import { WorkflowConsumerReplaySelectionRequestSchema } from "./execution.consumer-replay-selection";
export const WorkflowSnapshotRerunRequestSchema = z.object({
	authorRepair: WorkflowAuthorRepairRequestSchema.optional(),
	consumerReplay: WorkflowConsumerReplaySelectionRequestSchema.optional(),
	stopAfterNodeId: z.string().trim().min(1).optional(),
	startFromNodeId: z.string().trim().min(1).optional(),
}).strict().refine(value => !value.startFromNodeId || Boolean(value.stopAfterNodeId), {
	message: "A checkpoint replay must declare its stopAfterNodeId boundary",
	path: ["stopAfterNodeId"],
}).refine(value => !value.authorRepair || Boolean(value.startFromNodeId && value.startFromNodeId === value.stopAfterNodeId), {
	message: "An author repair must run only its explicitly named author node",
	path: ["authorRepair"],
}).refine(value => !value.consumerReplay || Boolean(value.startFromNodeId && value.startFromNodeId === value.stopAfterNodeId && !value.authorRepair), {
	message: "A selected consumer replay requires one explicit root boundary and excludes author repair",
	path: ["consumerReplay"],
});

export const RunFlowExecutionRequestSchema = z.object({
	idempotencyKey: z.string().trim().min(1).optional(),
	refreshAssetIds: z.array(z.string().trim().min(1)).describe("Explicit canvas/material handles or registered generation IDs; each identity is owner/project validated without substitution").optional(),
	flowId: z.string().min(1),
	triggerNodeId: z.string().min(1),
	stopAfterNodeId: z.string().min(1).optional(),
	replayFromExecutionId: z.string().min(1).optional(),
	startFromNodeId: z.string().min(1).optional(),
	concurrency: z.number().int().min(WORKFLOW_CONCURRENCY_MIN).max(WORKFLOW_CONCURRENCY_MAX).optional(),
	trigger: z.enum(["manual", "api", "schedule", "agent"]).optional(),
	triggerPayload: z.record(z.string(), z.unknown()).optional(),
}).strict().superRefine((value, context) => {
	if (value.replayFromExecutionId && !value.idempotencyKey) context.addIssue({ code: z.ZodIssueCode.custom, message: "A replay requires an explicit attempt idempotencyKey", path: ["idempotencyKey"] });
	if (value.refreshAssetIds !== undefined && !value.replayFromExecutionId) context.addIssue({ code: z.ZodIssueCode.custom, message: "refreshAssetIds requires an explicit source execution replay", path: ["refreshAssetIds"] });
	if (value.replayFromExecutionId && (!value.stopAfterNodeId || value.triggerPayload !== undefined)) context.addIssue({ code: z.ZodIssueCode.custom, message: "A source execution replay requires an explicit stop boundary and inherits its frozen trigger payload", path: ["replayFromExecutionId"] });
	if (Boolean(value.replayFromExecutionId) === Boolean(value.startFromNodeId)) return;
	context.addIssue({
		code: z.ZodIssueCode.custom,
		message: "replayFromExecutionId and startFromNodeId must be provided together",
		path: value.replayFromExecutionId ? ["startFromNodeId"] : ["replayFromExecutionId"],
	});
});

import { WorkflowMediaRetriesSchema } from "./execution.media-retry";

export const WorkflowExecutionResumeRequestSchema = z.object({
	nodeId: z.string().trim().min(1).optional(),
	planningRevision: WorkflowPlanningRevisionSchema.optional(),
	mediaAdoptions: WorkflowMediaAdoptionsSchema.optional(),
	mediaRetries: WorkflowMediaRetriesSchema.optional(),
	providerBalanceRestored: z.literal(true).optional(),
	cancellationRevoked: z.literal(true).optional(),
	agentModelCutover: z.object({
		targetModelKey: z.string().trim().min(1),
		apiStyle: z.enum(["chat", "responses"]),
	}).strict().optional(),
	definitionCutover: z.object({
		mode: z.literal("current_flow"),
	}).strict().optional(),
}).strict().superRefine((value, context) => {
	const selectedModes = [
		Boolean(value.nodeId),
		value.providerBalanceRestored === true,
		value.cancellationRevoked === true,
		Boolean(value.agentModelCutover),
		Boolean(value.definitionCutover),
		Boolean(value.planningRevision),
		Boolean(value.mediaAdoptions),
		Boolean(value.mediaRetries),
	].filter(Boolean).length;
	if (selectedModes <= 1) return;
	context.addIssue({
		code: z.ZodIssueCode.custom,
		message: "providerBalanceRestored, cancellationRevoked, agentModelCutover, and definitionCutover are mutually exclusive",
		path: ["cancellationRevoked"],
	});
});

export const WorkflowHumanApprovalResponseSchema = z.object({
	nodeId: z.string().trim().min(1),
	response: z.enum(["approved", "rejected"]),
});

export const WorkflowExecutionSchema = z.object({
	id: z.string(),
	flowId: z.string(),
	flowVersionId: z.string(),
	workflowVersion: z.string().optional(),
	flowName: z.string().nullable().optional(),
	ownerId: z.string(),
	status: ExecutionStatusSchema,
	concurrency: z.number().int(),
	trigger: z.string().nullable().optional(),
	errorMessage: z.string().nullable().optional(),
	errorCode: z.string().nullable().optional(),
	failureStage: z.string().nullable().optional(),
	projectId: z.string().nullable().optional(),
	canvasId: z.string().nullable().optional(),
	userInput: z.string().nullable().optional(),
	projectContext: z.unknown().optional(),
	assetSnapshot: z.unknown().optional(),
	durationMs: z.number().int().min(0).nullable().optional(),
	retryCount: z.number().int().min(0).optional(),
	recoveryOfExecutionId: z.string().nullable().optional(),
	executionFamilyId: z.string().min(1),
	usesProjectAssets: z.boolean().optional(),
	createdAt: z.string(),
	startedAt: z.string().nullable().optional(),
	finishedAt: z.string().nullable().optional(),
	nodeSummary: z.object({
		total: z.number().int().min(0),
		queued: z.number().int().min(0),
		running: z.number().int().min(0),
		waitingExternal: z.number().int().min(0),
		success: z.number().int().min(0),
		failed: z.number().int().min(0),
		canceled: z.number().int().min(0),
		skipped: z.number().int().min(0),
		notSelected: z.number().int().min(0),
	}).optional(),
	focusNode: z.object({
		nodeId: z.string().min(1),
		nodeLabel: z.string().min(1),
		status: NodeRunStatusSchema,
		errorMessage: z.string().nullable(),
		waitingReasonCode: z.enum([
			"structured_output_repair_required",
			"provider_balance_required",
			"workflow_agent_no_progress_recovery_deferred",
			"external_dependency_unavailable",
		]).nullable().optional(),
		waitingReasonLabel: z.string().min(1).nullable().optional(),
	}).nullable().optional(),
});

export type WorkflowExecutionDto = z.infer<typeof WorkflowExecutionSchema>;

export const WorkflowExecutionHistoryPageSchema = z.object({
	items: WorkflowExecutionSchema.array(),
	nextCursor: z.string().nullable(),
});

export const WorkflowExecutionSnapshotSchema = z.object({
	executionId: z.string().min(1),
	flowId: z.string().min(1),
	flowVersionId: z.string().min(1),
	name: z.string(),
	createdAt: z.string(),
	data: z.unknown(),
	canvasData: z.unknown().optional(),
});

export type WorkflowExecutionSnapshotDto = z.infer<typeof WorkflowExecutionSnapshotSchema>;

export const WorkflowNodeRunSchema = z.object({
	id: z.string(),
	executionId: z.string(),
	nodeId: z.string(),
	status: NodeRunStatusSchema,
	attempt: z.number().int(),
	errorMessage: z.string().nullable().optional(),
	errorCode: z.string().nullable().optional(),
	failureStage: z.string().nullable().optional(),
	inputRefs: z.unknown().optional(),
	outputRefs: z.unknown().optional(),
	agentProgress: WorkflowNodeAgentProgressSchema.optional(),
	toolCalls: z.unknown().optional(),
	retryCount: z.number().int().min(0).optional(),
	nodeType: z.string().nullable().optional(),
	toolName: z.string().nullable().optional(),
	modelKey: z.string().nullable().optional(),
	durationMs: z.number().int().min(0).nullable().optional(),
	createdAt: z.string(),
	startedAt: z.string().nullable().optional(),
	finishedAt: z.string().nullable().optional(),
});

export type WorkflowNodeRunDto = z.infer<typeof WorkflowNodeRunSchema>;

export const WorkflowNodeAttemptTriggerSchema = z.enum([
	"initial",
	"recovery_execution",
	"runtime_recovery",
	"automatic_retry",
	"manual_repair",
]);

export const WorkflowNodeAttemptSchema = z.object({
	id: z.string().min(1),
	executionFamilyId: z.string().min(1),
	executionId: z.string().min(1),
	nodeRunId: z.string().min(1),
	nodeId: z.string().min(1),
	attempt: z.number().int().min(1),
	trigger: WorkflowNodeAttemptTriggerSchema,
	status: z.enum(["pending", ...NodeRunStatusSchema.options]),
	semanticsSnapshot: z.unknown(),
	inputRefs: z.unknown().optional(),
	outputRefs: z.unknown().optional(),
	toolCalls: z.unknown().optional(),
	providerReceipts: z.string().min(1).array().optional(),
	tokenUsage: z.unknown().optional(),
	creditUsage: z.unknown().optional(),
	errorMessage: z.string().nullable().optional(),
	errorCode: z.string().nullable().optional(),
	failureStage: z.string().nullable().optional(),
	nodeType: z.string().nullable().optional(),
	toolName: z.string().nullable().optional(),
	modelKey: z.string().nullable().optional(),
	createdAt: z.string(),
	startedAt: z.string().nullable().optional(),
	finishedAt: z.string().nullable().optional(),
});

export type WorkflowNodeAttemptDto = z.infer<typeof WorkflowNodeAttemptSchema>;

export const WorkflowNodeAttemptPageSchema = z.object({
	items: WorkflowNodeAttemptSchema.array(),
	nextCursor: z.string().min(1).nullable(),
});

export type WorkflowNodeAttemptPageDto = z.infer<typeof WorkflowNodeAttemptPageSchema>;

export const WorkflowExecutionFamilyMemberSchema = WorkflowExecutionSchema.pick({
	id: true,
	flowId: true,
	flowVersionId: true,
	workflowVersion: true,
	flowName: true,
	status: true,
	concurrency: true,
	trigger: true,
	errorMessage: true,
	errorCode: true,
	failureStage: true,
	projectId: true,
	canvasId: true,
	durationMs: true,
	retryCount: true,
	recoveryOfExecutionId: true,
	executionFamilyId: true,
	usesProjectAssets: true,
	createdAt: true,
	startedAt: true,
	finishedAt: true,
});

export type WorkflowExecutionFamilyMemberDto = z.infer<typeof WorkflowExecutionFamilyMemberSchema>;

export const WorkflowExecutionFamilySchema = z.object({
	executionFamilyId: z.string().min(1),
	rootExecutionId: z.string().min(1),
	latestExecutionId: z.string().min(1),
	latestExecutionStatus: ExecutionStatusSchema,
	activeExecutionIds: z.string().min(1).array(),
	activeExecutionCount: z.number().int().nonnegative(),
	activeExecutionIdsTruncated: z.boolean(),
	executionCount: z.number().int().nonnegative(),
	successfulExecutionCount: z.number().int().nonnegative(),
	nodeAttemptCount: z.number().int().nonnegative(),
	createdAt: z.string(),
	updatedAt: z.string(),
	executions: WorkflowExecutionFamilyMemberSchema.array(),
	nextCursor: z.string().min(1).nullable(),
});

export type WorkflowExecutionFamilyDto = z.infer<typeof WorkflowExecutionFamilySchema>;

export const WorkflowNodeRunHistorySchema = WorkflowNodeRunSchema.extend({
	executionStatus: ExecutionStatusSchema,
	executionCreatedAt: z.string(),
	executionFinishedAt: z.string().nullable().optional(),
});

export type WorkflowNodeRunHistoryDto = z.infer<
	typeof WorkflowNodeRunHistorySchema
>;

export const WorkflowExecutionEventSchema = z.object({
	id: z.string(),
	executionId: z.string(),
	seq: z.number().int(),
	eventType: ExecutionEventTypeSchema,
	level: ExecutionEventLevelSchema,
	nodeId: z.string().nullable().optional(),
	message: z.string().nullable().optional(),
	data: z.unknown().optional(),
	createdAt: z.string(),
});

export type WorkflowExecutionEventDto = z.infer<typeof WorkflowExecutionEventSchema>;
