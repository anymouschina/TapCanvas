/**
 * TapCanvas AI observability contract.
 *
 * This package is declaration-only on purpose. Web, Hono and agents-cli share
 * the same protocol types without adding a runtime dependency or duplicating
 * product decisions in the transport layer.
 */

export type AgentTraceCapturePolicy = "structural" | "diagnostic" | "full";

export type AgentTracePersistenceStatus =
	| "persisted"
	| "degraded"
	| "disabled";

export type AgentTraceTerminalStatus =
	| "running"
	| "succeeded"
	| "failed"
	| "needs_input"
	| "suspended";

/**
 * Physical agent-run completion contract. Local fuses and action gates may
 * request another run, but they never manufacture a user-level blocker.
 */
export type AgentTaskCompletionDispositionV1 =
	| "succeeded"
	| "waiting_for_evidence"
	| "needs_input"
	| "repair_required"
	| "replan_required"
	| "failed";

export type AgentTaskTerminalBoundaryV1 =
	| "insufficient_balance"
	| "capability_unavailable"
	| "permission_denied"
	| "external_dependency_failure";

export type AgentTaskCompletionSignalV1 = {
	version: 1;
	disposition: AgentTaskCompletionDispositionV1;
	reasonCode: string;
	rationale: string;
	missingCriteria: string[];
	requiredActions: string[];
	terminalBoundary: AgentTaskTerminalBoundaryV1 | null;
	safePathsExhausted: boolean;
};

/** Stable handoff identity for one non-terminal physical-run exit. */
export type AgentContinuationTicketV1 = Readonly<{
	version: 1;
	ticketId: string;
	logicalTaskId: string;
	taskNodeId: string;
	taskRevision: number;
	resumeFromStatus: "repair_required" | "replan_required" | "waiting_for_evidence";
	nextTrigger: "durable_resume" | "external_evidence";
	reasonCode: string;
	issuedAt: string;
}>;

type AgentPhysicalRunExitBaseV1 = Readonly<{
	version: 1;
	logicalTaskId: string;
	taskNodeId: string;
	taskRevision: number;
	reasonCode: string;
	exitedAt: string;
}>;

/**
 * The only durable-owner-backed exit shapes for one physical executor. Public
 * chat roots are owned by TaskStore; atomic Workflow Agents are owned by the
 * durable Workflow runtime. This shared contract prevents transports from
 * omitting an exit or reinterpreting a recoverable handoff as user-level
 * failure.
 */
export type AgentPhysicalRunExitV1 =
	| (AgentPhysicalRunExitBaseV1 & Readonly<{
		kind: "logical_terminal";
		taskStatus: "satisfied" | "failed" | "canceled";
		continuationTicket: null;
	}>)
	| (AgentPhysicalRunExitBaseV1 & Readonly<{
		kind: "needs_input";
		taskStatus: "needs_input";
		continuationTicket: null;
	}>)
	| (AgentPhysicalRunExitBaseV1 & Readonly<{
		kind: "waiting_external";
		taskStatus: "waiting_for_evidence";
		continuationTicket: AgentContinuationTicketV1;
	}>)
	| (AgentPhysicalRunExitBaseV1 & Readonly<{
		kind: "handoff";
		taskStatus: "repair_required";
		continuationTicket: AgentContinuationTicketV1;
	}>)
	| (AgentPhysicalRunExitBaseV1 & Readonly<{
		kind: "replan";
		taskStatus: "replan_required";
		continuationTicket: AgentContinuationTicketV1;
	}>);

/** Read-only projection of the next durable obligation for operators/UIs. */
export type AgentAttentionProjectionV1 = {
	version: 1;
	logicalTaskId: string;
	status: "run_now" | "wait" | "user_action_required" | "repair" | "replan" | "terminal";
	waitingOn: string | null;
	obligation: string;
	sourceHeads: {
		graphRevision: number | null;
		evidenceRevision: number | null;
		physicalRunId: string | null;
	};
};

/** Cross-runtime replay input/output envelope shared by agents-cli and Hono tests. */
export type AgentReplayFixtureV1 = {
	version: 1;
	name: string;
	input: Record<string, unknown>;
	expected: Record<string, unknown>;
};

/** Versions that must be advanced together when a cross-runtime contract changes. */
export type AgentProtocolVersionsV1 = {
	attentionProjection: 1;
	replayFixture: 1;
	continuationSettlement: 1;
	continuationTicket: 1;
	physicalRunExit: 1;
	logicalTaskState: 1;
};

export type AgentCompletionTraceSourceV1 =
	| "runtime"
	| "task_completion_priority"
	| "terminal_delivery_verifier"
	| "async_submission"
	| "deterministic";

export type AgentCompletionTraceV1 = {
	version: 1;
	source: AgentCompletionTraceSourceV1;
	terminal: "success" | "failure" | "suspended";
	allowFinish: boolean;
	failureReason: string | null;
	rationale: string;
	successCriteria: string[];
	missingCriteria: string[];
	requiredActions: string[];
	retryCount?: number;
	recoveredAfterRetry?: boolean;
};

/**
 * Outcome of one agents-cli HTTP run. This is evidence for the Hono arbiter,
 * not a second public task terminal.
 */
export type AgentRunOutcomeV1 = {
	version: 1;
	terminal: true;
	status: "succeeded" | "failed" | "needs_input" | "suspended";
	reason: string;
};

/**
 * Canonical status of the user's logical task. Unlike AgentRunOutcomeV1 this
 * state survives physical model windows, process restarts and asynchronous
 * workflow/provider handoffs.
 */
export type AgentLogicalTaskStatusV1 =
	| "active"
	| "waiting_input"
	| "waiting_external"
	| "succeeded"
	| "failed"
	| "cancelled";

/** The state of the physical agents-cli window that produced this projection. */
export type AgentPhysicalRunStatusV1 =
	| "running"
	| "completed"
	| "handed_off"
	| "interrupted";

/** Delivery closure is intentionally independent from process/task state. */
export type AgentDeliveryStatusV1 = "pending" | "satisfied" | "unsatisfied";

/**
 * Single public lifecycle projection. Hono commits this projection from the
 * TaskStore-backed PhysicalRunExitV1 and the versioned delivery envelope; Web
 * must not derive a competing task terminal from runOutcome, verdict text or
 * transport completion.
 */
export type AgentLogicalTaskStateV1 = Readonly<{
	version: 1;
	logicalTaskId: string;
	status: AgentLogicalTaskStatusV1;
	reasonCode: string;
	physicalRunStatus: AgentPhysicalRunStatusV1;
	deliveryStatus: AgentDeliveryStatusV1;
	taskNodeId: string;
	taskRevision: number;
	updatedAt: string;
	continuationTicket: AgentContinuationTicketV1 | null;
}>;

/** The only terminal exposed for the user's logical request. */
export type AgentRequestTerminalV1 = {
	version: 1;
	terminal: true;
	status: "succeeded" | "failed" | "needs_input" | "suspended";
	reason: string;
};

export type AgentSpanStatus =
	| "running"
	| "succeeded"
	| "failed"
	| "denied"
	| "blocked"
	| "needs_input"
	| "suspended"
	| "accepted_async";

export type AgentSpanKind =
	| "request"
	| "agent"
	| "llm"
	| "tool"
	| "skill"
	| "subagent"
	| "delivery_verification"
	| "async_task"
	| "asset_materialization"
	| "evaluation";

export type AgentObservabilityService =
	| "web"
	| "hono-api"
	| "agents-cli"
	| "tool"
	| "async-worker"
	| "vendor";

export type AgentTraceCorrelationInputV1 = {
	version: 1;
	traceId: string;
	parentSpanId: string | null;
	requestId: string;
	threadId: string | null;
	capturePolicy: AgentTraceCapturePolicy;
	startedAt: string;
};

export type AgentTraceCorrelationV1 = AgentTraceCorrelationInputV1 & {
	spanId: string;
	turnId: string | null;
	service: AgentObservabilityService;
};

export type AgentTokenUsageV1 = {
	inputTokens: number;
	outputTokens: number;
	totalTokens: number;
	cacheReadInputTokens: number;
	cacheCreationInputTokens: number;
};

export type AgentPayloadCaptureHealthV1 = {
	policy: AgentTraceCapturePolicy;
	status: AgentTracePersistenceStatus;
	eventCount: number;
	droppedEventCount: number;
	lastErrorCode: string | null;
};

export type AgentCanonicalPersistenceHealthV1 = {
	status: Exclude<AgentTracePersistenceStatus, "disabled">;
	spanCount: number;
	evaluationCount: number;
	errorCode: string | null;
};

export type AgentRuntimeLlmSpanV1 = {
	spanId: string;
	parentSpanId: string;
	turn: number;
	phase: "initial" | "continuation";
	startedAt: string;
	finishedAt: string;
	durationMs: number;
	status: "succeeded" | "failed";
	stopReason: string | null;
	providerStopReason: string | null;
	usage: AgentTokenUsageV1;
};

export type AgentRuntimeObservabilityV1 = {
	version: 1;
	correlation: AgentTraceCorrelationV1;
	status: AgentTraceTerminalStatus;
	finishedAt: string;
	durationMs: number;
	usage: AgentTokenUsageV1;
	llmSpans: AgentRuntimeLlmSpanV1[];
	payloadCapture: AgentPayloadCaptureHealthV1;
};

/** Diagnostic-only physical-run performance facts. This contract never decides
 * creative quality or whether the logical user task may terminate. */
export type AgentPerformanceSnapshotV1 = {
	version: 1;
	wallTimeMs: number;
	timeToFirstTextMs: number | null;
	timeToFirstToolMs: number | null;
	model: {
		turnCount: number;
		durationMs: number;
		wallTimeShare: number;
		inputTokens: number;
		outputTokens: number;
		totalTokens: number;
		cacheReadInputTokens: number;
		cacheCreationInputTokens: number;
	};
	tools: {
		callCount: number;
		durationMs: number;
		wallTimeShare: number;
		schemaDiscoveryCount: number;
		blockedCount: number;
		failedCount: number;
	};
	context: {
		budgetTokens: number | null;
		thresholdTokens: number | null;
		totalTokens: number | null;
		peakTotalTokens: number | null;
		systemTokens: number | null;
		messageTokens: number | null;
		toolTokens: number | null;
		overBudget: boolean | null;
	};
	toolSurface: {
		modelVisibleCount: number | null;
		sentSchemaChars: number | null;
		modelVisibleDefinitionChars: number | null;
		initialSentSchemaChars: number | null;
		maxSentSchemaChars: number | null;
		initialModelVisibleDefinitionChars: number | null;
		maxModelVisibleDefinitionChars: number | null;
		catalogRemoteCount: number | null;
		authorizedRemoteDefinitionChars: number | null;
		catalogNameChars: number | null;
		duplicatedWrapperEnumChars: number | null;
	};
	progress: {
		revision: number;
		durableClaimCount: number;
		progressSincePhysicalRunStart: number;
		suspended: boolean;
		suspensionBudgetKind: string | null;
		suspensionLimit: number | null;
		suspensionObserved: number | null;
		suspensionUsageTokens: number | null;
		projectedInputTokens: number | null;
		projectedMinimumOutputTokens: number | null;
		projectedTotalTokens: number | null;
	};
};

export type AgentTraceScopeV1 = {
	projectId: string | null;
	bookId: string | null;
	chapterId: string | null;
	flowId: string | null;
	nodeId: string | null;
	label: string | null;
	workflowKey: string | null;
};

export type AgentTraceSpanV1 = {
	version: 1;
	id: string;
	traceId: string;
	spanId: string;
	parentSpanId: string | null;
	linkedSpanIds: string[];
	requestId: string | null;
	threadId: string | null;
	turnId: string | null;
	service: AgentObservabilityService;
	kind: AgentSpanKind;
	name: string;
	status: AgentSpanStatus;
	startedAt: string;
	finishedAt: string | null;
	durationMs: number | null;
	scope: AgentTraceScopeV1;
	modelKey: string | null;
	inputTokens: number;
	outputTokens: number;
	totalTokens: number;
	cacheReadInputTokens: number;
	cacheCreationInputTokens: number;
	costCredits: number | null;
	capturePolicy: AgentTraceCapturePolicy;
	persistenceStatus: AgentTracePersistenceStatus;
	errorCode: string | null;
	attributes: Record<string, unknown>;
	createdAt: string;
};

export type AgentDiagnosticsMetricsV1 = {
	traceCount: number;
	succeededCount: number;
	failedCount: number;
	partialCount: number;
	needsInputCount: number;
	persistedCount: number;
	degradedCount: number;
	totalTokens: number;
	inputTokens: number;
	outputTokens: number;
	cacheReadInputTokens: number;
	totalDurationMs: number;
	averageDurationMs: number | null;
	p50DurationMs: number | null;
	p95DurationMs: number | null;
	acceptedAsyncCount: number;
	materializedAsyncCount: number;
	staleAsyncCount: number;
};

/**
 * Action-oriented projection of already-recorded execution facts.
 *
 * This contract is diagnostic-only: it must not infer user intent, creative
 * quality, or a new task terminal. Producers may only project explicit runtime
 * states, verifier criteria, tool outcomes, evidence references and repair
 * actions that were recorded by the authoritative execution chain.
 */
export type AgentDiagnosticStateV1 =
	| "healthy"
	| "running"
	| "waiting"
	| "needs_input"
	| "repair_required"
	| "failed"
	| "unverifiable";

export type AgentDiagnosticIssueV1 = {
	code: string;
	severity: "error" | "warning" | "info";
	stage: "request" | "context" | "planning" | "execution" | "evidence" | "delivery" | "terminal" | "observability";
	title: string;
	detail: string;
	nodeId: string | null;
	evidenceRefs: string[];
};

export type AgentDiagnosticAssessmentV1 = {
	version: 1;
	state: AgentDiagnosticStateV1;
	headline: string;
	summary: string;
	focusNodeId: string | null;
	missingCriteria: string[];
	requiredActions: string[];
	evidenceRefs: string[];
	issues: AgentDiagnosticIssueV1[];
	sourcePaths: string[];
	/** True only when the authoritative runtime supplied concrete repair actions. */
	actionable: boolean;
};

export type AgentEvaluationSource = "deterministic" | "agents_judge" | "human";

export type AgentEvaluationTarget = "span" | "trace" | "thread" | "artifact";

export type AgentEvaluationResultV1 = {
	version: 1;
	id: string;
	traceId: string;
	spanId: string | null;
	threadId: string | null;
	artifactId: string | null;
	evaluatorKey: string;
	evaluatorVersion: string;
	source: AgentEvaluationSource;
	target: AgentEvaluationTarget;
	status: "passed" | "failed" | "needs_review" | "not_applicable";
	score: number | null;
	value: string | null;
	rationale: string;
	evidence: Record<string, unknown>;
	createdAt: string;
};

export type AgentHumanFeedbackV1 = {
	version: 1;
	id: string;
	traceId: string;
	spanId: string | null;
	threadId: string | null;
	feedbackKey: string;
	value: "accepted" | "rejected" | "needs_revision";
	comment: string | null;
	createdAt: string;
};

export type AgentAnnotationQueueItemV1 = {
	version: 1;
	id: string;
	traceId: string;
	reasonCode: string;
	status: "pending" | "reviewed";
	priority: number;
	createdAt: string;
	reviewedAt: string | null;
};

export type AgentRegressionExampleV1 = {
	version: 1;
	id: string;
	datasetKey: string;
	datasetVersion: number;
	traceId: string;
	expectedDelivery: Record<string, unknown>;
	deliveryEvidence: Record<string, unknown>;
	deliveryVerification: Record<string, unknown>;
	metadata: Record<string, unknown>;
	createdAt: string;
};
