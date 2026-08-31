import { z } from "zod";

const W3CTraceIdSchema = z.string().regex(/^(?!0{32}$)[a-f0-9]{32}$/);
const W3CSpanIdSchema = z.string().regex(/^(?!0{16}$)[a-f0-9]{16}$/);

export const AgentTraceCapturePolicySchema = z.enum(["structural", "diagnostic", "full"]);
export const AgentTracePersistenceStatusSchema = z.enum(["persisted", "degraded", "disabled"]);
export const AgentTraceTerminalStatusSchema = z.enum([
	"running",
	"succeeded",
	"failed",
	"needs_input",
	"suspended",
]);
export const AgentSpanStatusSchema = z.enum([
	"running",
	"succeeded",
	"failed",
	"denied",
	"blocked",
	"needs_input",
	"suspended",
	"accepted_async",
]);
export const AgentSpanKindSchema = z.enum([
	"request",
	"agent",
	"llm",
	"tool",
	"skill",
	"subagent",
	"delivery_verification",
	"async_task",
	"asset_materialization",
	"evaluation",
]);
export const AgentObservabilityServiceSchema = z.enum([
	"web",
	"hono-api",
	"agents-cli",
	"tool",
	"async-worker",
	"vendor",
]);

export const AgentTokenUsageSchema = z.object({
	inputTokens: z.number().int().min(0),
	outputTokens: z.number().int().min(0),
	totalTokens: z.number().int().min(0),
	cacheReadInputTokens: z.number().int().min(0),
	cacheCreationInputTokens: z.number().int().min(0),
}).strict();

export const AgentTraceCorrelationInputSchema = z.object({
	version: z.literal(1),
	traceId: W3CTraceIdSchema,
	parentSpanId: W3CSpanIdSchema.nullable(),
	requestId: z.string().trim().min(1).max(160),
	threadId: z.string().trim().min(1).max(240).nullable(),
	capturePolicy: AgentTraceCapturePolicySchema,
	startedAt: z.string().datetime(),
}).strict();

export const AgentTraceCorrelationSchema = AgentTraceCorrelationInputSchema.extend({
	spanId: W3CSpanIdSchema,
	turnId: z.string().trim().min(1).max(160).nullable(),
	service: AgentObservabilityServiceSchema,
}).strict();

export const AgentPayloadCaptureHealthSchema = z.object({
	policy: AgentTraceCapturePolicySchema,
	status: AgentTracePersistenceStatusSchema,
	eventCount: z.number().int().min(0),
	droppedEventCount: z.number().int().min(0),
	lastErrorCode: z.string().trim().min(1).max(160).nullable(),
}).strict();

export const AgentRuntimeLlmSpanSchema = z.object({
	spanId: W3CSpanIdSchema,
	parentSpanId: W3CSpanIdSchema,
	turn: z.number().int().min(1),
	phase: z.enum(["initial", "continuation"]),
	startedAt: z.string().datetime(),
	finishedAt: z.string().datetime(),
	durationMs: z.number().int().min(0),
	status: z.enum(["succeeded", "failed"]),
	stopReason: z.string().trim().min(1).max(160).nullable(),
	providerStopReason: z.string().trim().min(1).max(160).nullable(),
	usage: AgentTokenUsageSchema,
}).strict();

export const AgentRuntimeObservabilitySchema = z.object({
	version: z.literal(1),
	correlation: AgentTraceCorrelationSchema,
	status: AgentTraceTerminalStatusSchema,
	finishedAt: z.string().datetime(),
	durationMs: z.number().int().min(0),
	usage: AgentTokenUsageSchema,
	llmSpans: z.array(AgentRuntimeLlmSpanSchema).max(256),
	payloadCapture: AgentPayloadCaptureHealthSchema,
}).strict();

export const AgentTraceScopeSchema = z.object({
	projectId: z.string().nullable(),
	bookId: z.string().nullable(),
	chapterId: z.string().nullable(),
	flowId: z.string().nullable(),
	nodeId: z.string().nullable(),
	label: z.string().nullable(),
	workflowKey: z.string().nullable(),
}).strict();

export const AgentTraceSpanSchema = z.object({
	version: z.literal(1),
	id: z.string(),
	traceId: W3CTraceIdSchema,
	spanId: W3CSpanIdSchema,
	parentSpanId: W3CSpanIdSchema.nullable(),
	linkedSpanIds: z.array(W3CSpanIdSchema).max(64),
	requestId: z.string().nullable(),
	threadId: z.string().nullable(),
	turnId: z.string().nullable(),
	service: AgentObservabilityServiceSchema,
	kind: AgentSpanKindSchema,
	name: z.string().trim().min(1).max(200),
	status: AgentSpanStatusSchema,
	startedAt: z.string().datetime(),
	finishedAt: z.string().datetime().nullable(),
	durationMs: z.number().int().min(0).nullable(),
	scope: AgentTraceScopeSchema,
	modelKey: z.string().nullable(),
	inputTokens: z.number().int().min(0),
	outputTokens: z.number().int().min(0),
	totalTokens: z.number().int().min(0),
	cacheReadInputTokens: z.number().int().min(0),
	cacheCreationInputTokens: z.number().int().min(0),
	costCredits: z.number().min(0).nullable(),
	capturePolicy: AgentTraceCapturePolicySchema,
	persistenceStatus: AgentTracePersistenceStatusSchema,
	errorCode: z.string().nullable(),
	attributes: z.record(z.string(), z.unknown()),
	createdAt: z.string().datetime(),
}).strict();

export const AgentDiagnosticsMetricsSchema = z.object({
	traceCount: z.number().int().min(0),
	succeededCount: z.number().int().min(0),
	failedCount: z.number().int().min(0),
	partialCount: z.number().int().min(0),
	needsInputCount: z.number().int().min(0),
	persistedCount: z.number().int().min(0),
	degradedCount: z.number().int().min(0),
	totalTokens: z.number().int().min(0),
	inputTokens: z.number().int().min(0),
	outputTokens: z.number().int().min(0),
	cacheReadInputTokens: z.number().int().min(0),
	totalDurationMs: z.number().int().min(0),
	averageDurationMs: z.number().min(0).nullable(),
	p50DurationMs: z.number().min(0).nullable(),
	p95DurationMs: z.number().min(0).nullable(),
	acceptedAsyncCount: z.number().int().min(0),
	materializedAsyncCount: z.number().int().min(0),
	staleAsyncCount: z.number().int().min(0),
}).strict();

export const AgentEvaluationResultSchema = z.object({
	version: z.literal(1),
	id: z.string(),
	traceId: W3CTraceIdSchema,
	spanId: W3CSpanIdSchema.nullable(),
	threadId: z.string().nullable(),
	artifactId: z.string().nullable(),
	evaluatorKey: z.string(),
	evaluatorVersion: z.string(),
	source: z.enum(["deterministic", "agents_judge", "human"]),
	target: z.enum(["span", "trace", "thread", "artifact"]),
	status: z.enum(["passed", "failed", "needs_review", "not_applicable"]),
	score: z.number().min(0).max(1).nullable(),
	value: z.string().nullable(),
	rationale: z.string(),
	evidence: z.record(z.string(), z.unknown()),
	createdAt: z.string().datetime(),
}).strict();

export const AgentHumanFeedbackSchema = z.object({
	version: z.literal(1),
	id: z.string(),
	traceId: W3CTraceIdSchema,
	spanId: W3CSpanIdSchema.nullable(),
	threadId: z.string().nullable(),
	feedbackKey: z.string(),
	value: z.enum(["accepted", "rejected", "needs_revision"]),
	comment: z.string().nullable(),
	createdAt: z.string().datetime(),
}).strict();

export const AgentRegressionExampleSchema = z.object({
	version: z.literal(1),
	id: z.string(),
	datasetKey: z.string(),
	datasetVersion: z.number().int().positive(),
	traceId: W3CTraceIdSchema,
	expectedDelivery: z.record(z.string(), z.unknown()),
	deliveryEvidence: z.record(z.string(), z.unknown()),
	deliveryVerification: z.record(z.string(), z.unknown()),
	metadata: z.record(z.string(), z.unknown()),
	createdAt: z.string().datetime(),
}).strict();

export const AgentAnnotationQueueItemSchema = z.object({
	version: z.literal(1),
	id: z.string(),
	traceId: W3CTraceIdSchema,
	reasonCode: z.string(),
	status: z.enum(["pending", "reviewed"]),
	priority: z.number().int().min(0).max(100),
	createdAt: z.string().datetime(),
	reviewedAt: z.string().datetime().nullable(),
}).strict();

export const CreateAgentHumanFeedbackRequestSchema = z.object({
	traceId: W3CTraceIdSchema,
	spanId: W3CSpanIdSchema.nullable().optional(),
	threadId: z.string().trim().min(1).max(240).nullable().optional(),
	feedbackKey: z.string().trim().min(1).max(120),
	value: z.enum(["accepted", "rejected", "needs_revision"]),
	comment: z.string().trim().max(4_000).nullable().optional(),
}).strict();

export const CreateAgentRegressionExampleRequestSchema = z.object({
	traceId: W3CTraceIdSchema,
	datasetKey: z.string().trim().min(1).max(120),
}).strict();

export type AgentRuntimeObservabilityDto = z.infer<typeof AgentRuntimeObservabilitySchema>;
export type AgentTraceSpanDto = z.infer<typeof AgentTraceSpanSchema>;
export type AgentDiagnosticsMetricsDto = z.infer<typeof AgentDiagnosticsMetricsSchema>;
export type AgentEvaluationResultDto = z.infer<typeof AgentEvaluationResultSchema>;
export type AgentHumanFeedbackDto = z.infer<typeof AgentHumanFeedbackSchema>;
export type AgentRegressionExampleDto = z.infer<typeof AgentRegressionExampleSchema>;
export type AgentAnnotationQueueItemDto = z.infer<typeof AgentAnnotationQueueItemSchema>;
export type CreateAgentHumanFeedbackRequestDto = z.infer<typeof CreateAgentHumanFeedbackRequestSchema>;
export type CreateAgentRegressionExampleRequestDto = z.infer<typeof CreateAgentRegressionExampleRequestSchema>;

export function normalizeAgentRuntimeObservability(value: unknown): AgentRuntimeObservabilityDto | null {
	const parsed = AgentRuntimeObservabilitySchema.safeParse(value);
	return parsed.success ? parsed.data : null;
}
