/**
 * TapCanvas Canvas → host Codex task protocol.
 *
 * This package intentionally has no runtime dependency. Web and Hono import the
 * same literal unions and TypeScript contracts; Hono owns runtime Zod validation
 * in modules/codex/codex.schemas.ts so package resolution never depends on a
 * repository-root node_modules directory.
 */

export const CODEX_TASK_PROTOCOL_VERSION = 2 as const;

export const CODEX_TASK_STATES = [
	"queued",
	"claimed",
	"codex_running",
	"awaiting_user_input",
	"codex_failed",
	"remote_build_queued",
	"remote_build_running",
	"remote_build_failed_code",
	"remote_build_failed_infrastructure",
	"fallback_waiting_approval",
	"local_fallback_approved",
	"local_build_running",
	"succeeded",
	"failed",
	"canceled",
	"unknown",
] as const;
export type CodexTaskState = (typeof CODEX_TASK_STATES)[number];

export const CODEX_TERMINAL_TASK_STATES = [
	"awaiting_user_input",
	"codex_failed",
	"remote_build_failed_code",
	"succeeded",
	"failed",
	"canceled",
	"unknown",
] as const;

export const CODEX_BUILD_EXECUTORS = [
	"vercel-sandbox",
	"local-docker",
] as const;
export type CodexBuildExecutor = (typeof CODEX_BUILD_EXECUTORS)[number];

export const CODEX_FALLBACK_POLICIES = ["disabled", "ask"] as const;
export type CodexFallbackPolicy = (typeof CODEX_FALLBACK_POLICIES)[number];

export type CodexWorkspaceSummary = {
	id: string;
	label: string;
	configFingerprint: string;
	remoteBuildConfigured: boolean;
	localDockerConfigured: boolean;
};

export type CodexBridgeHeartbeat = {
	protocolVersion: typeof CODEX_TASK_PROTOCOL_VERSION;
	bridgeId: string;
	workerInstanceId: string;
	name: string;
	workerVersion: string;
	codexVersion: string;
	workspaces: CodexWorkspaceSummary[];
};

export type CodexBridgeSummary = CodexBridgeHeartbeat & {
	status: "online" | "offline";
	lastSeenAt: string;
	activeTaskId: string | null;
};

export type CodexCanvasScope = {
	projectId: string;
	flowId: string | null;
	chapterId: string | null;
	canvasRevision: number | null;
	selectedNodeIds: string[];
};

export type CodexCanvasContext = CodexCanvasScope & {
	snapshotId: string;
	selectedNodeKinds: string[];
	projectName: string;
	flowName: string | null;
	nodeCount: number;
	edgeCount: number;
	sha256: string;
	createdAt: string;
};

export type CodexCanvasContextSnapshot = CodexCanvasContext & {
	graph: {
		nodes: unknown[];
		edges: unknown[];
		viewport: {
			x: number;
			y: number;
			zoom: number;
		} | null;
	};
	selectedNodes: unknown[];
};

export type CodexExpectedDeliveryCriterion =
	| "codex_turn"
	| "tests"
	| "build"
	| "preview";

export type CodexExpectedDelivery =
	| {
			kind: "workspace_change_with_verified_preview";
			workspaceId: string;
			requiredEvidence: CodexExpectedDeliveryCriterion[];
	  }
	| {
			kind: "codex_response";
			workspaceId: string;
			requiredEvidence: ["codex_turn"];
	  };

export const CODEX_TURN_OUTCOMES = [
	"workspace_changed",
	"needs_input",
	"response_only",
	"failed",
] as const;
export type CodexTurnOutcome = (typeof CODEX_TURN_OUTCOMES)[number];

export type CodexCommandEvidence = {
	name: "install" | "test" | "build" | "preview";
	executor: CodexBuildExecutor;
	exitCode: number;
	startedAt: string;
	completedAt: string;
	logSha256: string;
	logTail: string;
};

export type CodexDeliveryEvidence = {
	source: {
		sha256: string;
		archiveBytes: number;
	} | null;
	codex: {
		threadId: string;
		turnId: string;
		status: "completed" | "failed" | "interrupted";
		outcome: CodexTurnOutcome;
		changedFiles: string[];
		summary: string;
	} | null;
	build: {
		executor: CodexBuildExecutor;
		executionId: string;
		commands: CodexCommandEvidence[];
	} | null;
	preview: {
		previewId: string;
		url: string;
		expiresAt: string;
		isolatedOrigin: true;
	} | null;
};

export type CodexDeliveryVerification = {
	status: "pending" | "satisfied" | "failed";
	checkedAt: string | null;
	missingCriteria: CodexExpectedDeliveryCriterion[];
	rationale: string;
};

export type CodexTaskEvent = {
	id: string;
	taskId: string;
	at: string;
	state: CodexTaskState;
	code: string;
	message: string;
};

export type CodexTask = {
	protocolVersion: typeof CODEX_TASK_PROTOCOL_VERSION;
	id: string;
	sessionId: string;
	parentTaskId: string | null;
	turnSequence: number;
	resumeThreadId: string | null;
	userId: string;
	bridgeId: string;
	workspaceId: string;
	workspaceConfigFingerprint: string;
	goal: string;
	context: CodexCanvasContext;
	fallbackPolicy: CodexFallbackPolicy;
	state: CodexTaskState;
	previewId: string;
	idempotencyKey: string;
	createdAt: string;
	updatedAt: string;
	terminalAt: string | null;
	lastMessage: string;
	expectedDelivery: CodexExpectedDelivery;
	deliveryEvidence: CodexDeliveryEvidence;
	deliveryVerification: CodexDeliveryVerification;
};

export type CreateCodexTaskRequest = {
	bridgeId: string;
	workspaceId: string;
	sessionId: string | null;
	parentTaskId: string | null;
	goal: string;
	context: CodexCanvasScope;
	fallbackPolicy: CodexFallbackPolicy;
	idempotencyKey: string;
};

export type CreateCodexTaskResponse = {
	task: CodexTask;
	deduplicated: boolean;
	queuePosition: number | null;
};

export type CodexTaskListResponse = { items: CodexTask[] };
export type CodexBridgeListResponse = { items: CodexBridgeSummary[] };

export type CodexTaskClaimRequest = {
	bridgeId: string;
	workerInstanceId: string;
};

export type CodexTaskClaimResponse = {
	task: CodexTask | null;
	contextSnapshot: CodexCanvasContextSnapshot | null;
	leaseId: string | null;
	leaseExpiresAt: string | null;
};

export type CodexTaskLeaseHeartbeat = {
	bridgeId: string;
	workerInstanceId: string;
	leaseId: string;
};

export type CodexTaskWorkerUpdate = CodexTaskLeaseHeartbeat & {
	state: CodexTaskState;
	code: string;
	message: string;
	expectedDelivery?: CodexExpectedDelivery;
	deliveryEvidence?: CodexDeliveryEvidence;
};

export const CODEX_TASK_MESSAGE_STATES = [
	"queued",
	"delivered",
	"rejected",
	"unknown",
] as const;
export type CodexTaskMessageState =
	(typeof CODEX_TASK_MESSAGE_STATES)[number];

export type CodexTaskMessage = {
	id: string;
	taskId: string;
	sessionId: string;
	text: string;
	state: CodexTaskMessageState;
	idempotencyKey: string;
	createdAt: string;
	deliveredAt: string | null;
	detail: string;
};

export type CreateCodexTaskMessageRequest = {
	text: string;
	idempotencyKey: string;
};

export type CreateCodexTaskMessageResponse = {
	message: CodexTaskMessage;
	deduplicated: boolean;
};

export type CodexTaskMessageListResponse = {
	items: CodexTaskMessage[];
};

export type CodexTaskMessageClaimRequest = CodexTaskLeaseHeartbeat & {
	limit: number;
};

export type CodexTaskMessageClaimResponse = {
	items: CodexTaskMessage[];
};

export type CodexTaskMessageAckRequest = CodexTaskLeaseHeartbeat & {
	messageId: string;
	state: "delivered" | "rejected" | "unknown";
	detail: string;
};

export type CodexBuildCommandSet = {
	install: string[];
	test: string[];
	build: string[];
	preview: string[];
};

export type CodexRemoteBuildSpec = {
	configFingerprint: string;
	runtime: "node22" | "node24" | "node26";
	timeoutMs: number;
	vcpus: number;
	commands: CodexBuildCommandSet;
	outputDirectory: string;
	previewPort: number;
	previewReadyPath: string;
	previewReadyTimeoutMs: number;
	environment: Record<string, string>;
};

export type CodexSourceUploadRequest = CodexTaskLeaseHeartbeat & {
	sourceSha256: string;
	archiveBytes: number;
};

export type CodexSourceUploadResponse = {
	uploadUrl: string;
	objectKey: string;
	expiresAt: string;
	requiredHeaders: {
		"content-type": "application/gzip";
		"x-amz-meta-sha256": string;
	};
};

export type CodexSourceDiscardRequest = CodexTaskLeaseHeartbeat & {
	sourceSha256: string;
	objectKey: string;
};

export type CodexRemoteBuildRequest = CodexTaskLeaseHeartbeat & {
	sourceSha256: string;
	archiveBytes: number;
	objectKey: string;
	spec: CodexRemoteBuildSpec;
};

export type CodexRemoteBuildResponse = {
	buildId: string;
	state: "queued";
};

export type CodexFallbackDecision = {
	decision: "approve" | "decline";
};

export type CodexPreviewResolution = {
	previewId: string;
	taskId: string;
	url: string;
	expiresAt: string;
	isolatedOrigin: true;
};

export type CodexPairingSession = {
	pairingCode: string;
	expiresAt: string;
};

export type CodexPairingExchangeRequest = {
	pairingCode: string;
	deviceName: string;
};

export type CodexPairingExchangeResponse = {
	apiKey: string;
	pairedAt: string;
};

const terminalStateSet: ReadonlySet<CodexTaskState> = new Set(
	CODEX_TERMINAL_TASK_STATES,
);

export function isCodexTerminalTaskState(
	state: CodexTaskState,
): boolean {
	return terminalStateSet.has(state);
}
