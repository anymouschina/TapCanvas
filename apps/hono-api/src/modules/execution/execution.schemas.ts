import { z } from "zod";

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
	"success",
	"failed",
	"canceled",
	"skipped",
]);

export const ExecutionEventLevelSchema = z.enum([
	"debug",
	"info",
	"warn",
	"error",
]);

export const ExecutionEventTypeSchema = z.enum([
	"execution_created",
	"execution_started",
	"node_queued",
	"node_started",
	"node_log",
	"node_succeeded",
	"node_failed",
	"execution_succeeded",
	"execution_failed",
]);

export const RunFlowExecutionRequestSchema = z.object({
	flowId: z.string().min(1),
	concurrency: z.number().int().min(1).max(8).optional(),
	trigger: z.enum(["manual", "api", "schedule", "agent"]).optional(),
});

export const WorkflowExecutionSchema = z.object({
	id: z.string(),
	flowId: z.string(),
	flowVersionId: z.string(),
	ownerId: z.string(),
	status: ExecutionStatusSchema,
	concurrency: z.number().int(),
	trigger: z.string().nullable().optional(),
	errorMessage: z.string().nullable().optional(),
	createdAt: z.string(),
	startedAt: z.string().nullable().optional(),
	finishedAt: z.string().nullable().optional(),
});

export type WorkflowExecutionDto = z.infer<typeof WorkflowExecutionSchema>;

export const WorkflowNodeRunSchema = z.object({
	id: z.string(),
	executionId: z.string(),
	nodeId: z.string(),
	status: NodeRunStatusSchema,
	attempt: z.number().int(),
	errorMessage: z.string().nullable().optional(),
	outputRefs: z.unknown().optional(),
	createdAt: z.string(),
	startedAt: z.string().nullable().optional(),
	finishedAt: z.string().nullable().optional(),
});

export type WorkflowNodeRunDto = z.infer<typeof WorkflowNodeRunSchema>;

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

