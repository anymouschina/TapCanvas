export const VIDEO_ORCHESTRATOR_PROTOCOL_VERSION = "1" as const;
export const VIDEO_AUTHORING_GRAPH_PROTOCOL_VERSION = "2" as const;
export const VIDEO_RUN_STATUS_PROTOCOL_VERSION = "2" as const;
export const VIDEO_RUN_STATUS_PROJECTION_OWNER = "video_run_status" as const;
export const VIDEO_PRODUCTION_WORKFLOW_PROTOCOL_VERSION = "1" as const;
export const VIDEO_PRODUCTION_WORKFLOW_KEY = "one-click-production/v1" as const;
export const VIDEO_ATOMIC_WORKFLOW_PROTOCOL_VERSION = "2" as const;
/**
 * Canonical authoring schema revision for the editable one-click-production
 * canvas. The editor, capability equipment boundary, and durable executor must
 * compare the same structural fact.
 */
export const VIDEO_ATOMIC_CANVAS_DEFINITION_VERSION = 71 as const;

/**
 * SHA-256 of the canonical executable canvas template with instance-specific
 * ids and this fingerprint field removed. The Web template test recomputes it
 * from every node contract, runtime datum and edge. Hono compares the persisted
 * value before capability equipment and before execution admission, so two
 * structurally different definitions can never both masquerade as the same version.
 */
export const VIDEO_ATOMIC_CANVAS_DEFINITION_FINGERPRINT =
	"sha256:88a3dc15edf80a7268723be2b93e6a04f4e2366a8d7df1004ee4bd316d880f29" as const;

/**
 * Editable one-click-production operations. These IDs are the stable bridge
 * between the canvas definition and the durable authoring/effect journals.
 * They intentionally describe executable operations rather than the seven
 * coarse production stages retained for high-level run observability.
 */
export const VIDEO_ATOMIC_WORKFLOW_NODE_IDS = [
	"canvas-source",
	"delivery-contract",
	"beat-sheet-agent",
	"beat-sheet-format",
	"asset-coverage",
	"asset-fan-out",
	"asset-image-generate",
	"clip-fan-out",
	"clip-writer-agent",
	"prompt-package",
	"voice-materialize",
	"cost-estimate",
	"production-handoff",
	"video-submit",
	"video-results",
	"concat",
	"delivery-verify",
] as const;
export type VideoAtomicWorkflowNodeId = (typeof VIDEO_ATOMIC_WORKFLOW_NODE_IDS)[number];

export const VIDEO_PRODUCTION_WORKFLOW_NODE_IDS = [
	"production-contract",
	"story-adaptation",
	"clip-contracts",
	"asset-preparation",
	"media-production",
	"composition",
	"delivery",
] as const;
export type VideoProductionWorkflowNodeId = (typeof VIDEO_PRODUCTION_WORKFLOW_NODE_IDS)[number];

export const VIDEO_PRODUCTION_WORKFLOW_NODE_STATUSES = [
	"queued",
	"running",
	"waiting_external",
	"succeeded",
	"partial",
	"failed",
	"cancelled",
] as const;
export type VideoProductionWorkflowNodeStatus = (typeof VIDEO_PRODUCTION_WORKFLOW_NODE_STATUSES)[number];

export const VIDEO_PRODUCTION_WORKFLOW_EVENT_KINDS = [
	"agent_turn",
	"tool_call",
	"effect",
	"artifact",
	"diagnostic",
	"status",
] as const;
export type VideoProductionWorkflowEventKind = (typeof VIDEO_PRODUCTION_WORKFLOW_EVENT_KINDS)[number];

export type VideoProductionWorkflowNodeDefinition = Readonly<{
	nodeId: VideoProductionWorkflowNodeId;
	label: string;
	kind: "contract" | "authoring" | "asset" | "media" | "compose" | "delivery";
	inputPorts: readonly string[];
	outputPorts: readonly string[];
}>;

export type VideoProductionWorkflowEdgeDefinition = Readonly<{
	edgeId: string;
	source: VideoProductionWorkflowNodeId;
	target: VideoProductionWorkflowNodeId;
}>;

export type VideoProductionWorkflowDefinition = Readonly<{
	protocolVersion: typeof VIDEO_PRODUCTION_WORKFLOW_PROTOCOL_VERSION;
	workflowKey: typeof VIDEO_PRODUCTION_WORKFLOW_KEY;
	definitionVersion: number;
	nodes: readonly VideoProductionWorkflowNodeDefinition[];
	edges: readonly VideoProductionWorkflowEdgeDefinition[];
}>;

export const VIDEO_PRODUCTION_WORKFLOW_DEFINITION: VideoProductionWorkflowDefinition = {
	protocolVersion: VIDEO_PRODUCTION_WORKFLOW_PROTOCOL_VERSION,
	workflowKey: VIDEO_PRODUCTION_WORKFLOW_KEY,
	definitionVersion: 1,
	nodes: [
		{ nodeId: "production-contract", label: "任务合同", kind: "contract", inputPorts: ["request"], outputPorts: ["delivery-contract"] },
		{ nodeId: "story-adaptation", label: "剧本改编", kind: "authoring", inputPorts: ["delivery-contract"], outputPorts: ["beat-sheet"] },
		{ nodeId: "clip-contracts", label: "Clip 合同", kind: "authoring", inputPorts: ["beat-sheet"], outputPorts: ["clip-contracts"] },
		{ nodeId: "asset-preparation", label: "资产准备", kind: "asset", inputPorts: ["clip-contracts"], outputPorts: ["asset-bindings"] },
		{ nodeId: "media-production", label: "媒体生产", kind: "media", inputPorts: ["asset-bindings"], outputPorts: ["media-assets"] },
		{ nodeId: "composition", label: "合成", kind: "compose", inputPorts: ["media-assets"], outputPorts: ["master-video"] },
		{ nodeId: "delivery", label: "交付", kind: "delivery", inputPorts: ["master-video"], outputPorts: ["delivery-evidence"] },
	],
	edges: [
		{ edgeId: "production-contract-to-story-adaptation", source: "production-contract", target: "story-adaptation" },
		{ edgeId: "story-adaptation-to-clip-contracts", source: "story-adaptation", target: "clip-contracts" },
		{ edgeId: "clip-contracts-to-asset-preparation", source: "clip-contracts", target: "asset-preparation" },
		{ edgeId: "asset-preparation-to-media-production", source: "asset-preparation", target: "media-production" },
		{ edgeId: "media-production-to-composition", source: "media-production", target: "composition" },
		{ edgeId: "composition-to-delivery", source: "composition", target: "delivery" },
	],
};

export type VideoProductionWorkflowNodeProjection = Readonly<{
	workflowRunId: string;
	workflowNodeId: VideoProductionWorkflowNodeId;
	status: VideoProductionWorkflowNodeStatus;
	completedUnits: number;
	totalUnits: number | null;
	inputArtifactIds: readonly string[];
	outputArtifactIds: readonly string[];
	effectIds: readonly string[];
	errorCount: number;
	timing: Readonly<{
		startedAt: string | null;
		updatedAt: string | null;
		finishedAt: string | null;
		durationMs: number | null;
	}>;
	latestEventSeq: number;
}>;

export type VideoProductionWorkflowEvent = Readonly<{
	protocolVersion: typeof VIDEO_PRODUCTION_WORKFLOW_PROTOCOL_VERSION;
	workflowRunId: string;
	workflowNodeId: VideoProductionWorkflowNodeId;
	eventId: string;
	seq: number;
	kind: VideoProductionWorkflowEventKind;
	occurredAt: string;
	payloadRef: string | null;
	artifactIds: readonly string[];
	effectIds: readonly string[];
}>;

export type VideoProductionWorkflowSnapshot = Readonly<{
	protocolVersion: typeof VIDEO_PRODUCTION_WORKFLOW_PROTOCOL_VERSION;
	workflowKey: typeof VIDEO_PRODUCTION_WORKFLOW_KEY;
	definitionVersion: number;
	workflowRunId: string;
	generatedAt: string;
	latestEventSeq: number;
	nodes: readonly VideoProductionWorkflowNodeProjection[];
}>;

export type VideoAtomicWorkflowOutputRefs = Readonly<{
	ports: Readonly<Record<string, unknown>>;
	artifacts: readonly Readonly<{
		identity: string;
		type: string;
		value: unknown;
	}>[];
	evidence: Readonly<Record<string, unknown>>;
	itemRuns: readonly Readonly<Record<string, unknown>>[];
}>;

export type VideoAtomicWorkflowNodeProjection = Readonly<{
	workflowRunId: string;
	atomicNodeId: VideoAtomicWorkflowNodeId;
	status: VideoProductionWorkflowNodeStatus;
	completedUnits: number;
	totalUnits: number | null;
	inputArtifactIds: readonly string[];
	outputArtifactIds: readonly string[];
	effectIds: readonly string[];
	errorCount: number;
	errorMessages: readonly string[];
	timing: VideoProductionWorkflowNodeProjection["timing"];
	outputRefs: VideoAtomicWorkflowOutputRefs;
	latestEventSeq: number;
}>;

export type VideoAtomicWorkflowSnapshot = Readonly<{
	protocolVersion: typeof VIDEO_ATOMIC_WORKFLOW_PROTOCOL_VERSION;
	workflowKey: typeof VIDEO_PRODUCTION_WORKFLOW_KEY;
	definitionVersion: 2;
	workflowRunId: string;
	executionScope: VideoAuthoringExecutionScope | null;
	generatedAt: string;
	latestEventSeq: number;
	nodes: readonly VideoAtomicWorkflowNodeProjection[];
}>;

export type FrozenAuthoringShot = Readonly<Record<string, unknown>>;

export type FrozenAuthoringClip = Readonly<{
	clipIndex: number;
	shots: readonly FrozenAuthoringShot[];
}>;

export type ExecutableVideoClip = Readonly<{
	clipIndex: number;
	clipPrompt: string;
}>;

export type ExecutableVideoPlan = Readonly<{
	protocolVersion: typeof VIDEO_ORCHESTRATOR_PROTOCOL_VERSION;
	runId: string;
	clips: readonly ExecutableVideoClip[];
}>;

export const VIDEO_AUTHORING_EXECUTION_SCOPES = ["prompt_only", "media_delivery"] as const;
export type VideoAuthoringExecutionScope = (typeof VIDEO_AUTHORING_EXECUTION_SCOPES)[number];

/**
 * Authoring graph kinds are a fixed execution vocabulary. A concrete run is
 * still dynamic: one clip_writer node is compiled for every frozen BeatSheet
 * clip, and dependencies are persisted with the run rather than inferred from
 * chat history or worker control flow.
 */
export const VIDEO_AUTHORING_GRAPH_NODE_KINDS = [
	"beat_sheet",
	"asset_coverage",
	"clip_writer",
	"assembly",
	"prompt_package",
	"estimate",
	"production_handoff",
	"video_submission",
	"video_result",
	"concat",
	"delivery_verify",
] as const;
export type VideoAuthoringGraphNodeKind = (typeof VIDEO_AUTHORING_GRAPH_NODE_KINDS)[number];

export type VideoAuthoringGraphNode = Readonly<{
	key: string;
	kind: VideoAuthoringGraphNodeKind;
	dependsOn: readonly string[];
	clipIndex?: number;
}>;

export type VideoAuthoringGraph = Readonly<{
	protocolVersion: typeof VIDEO_AUTHORING_GRAPH_PROTOCOL_VERSION;
	runId: string;
	executionScope: VideoAuthoringExecutionScope;
	nodes: readonly VideoAuthoringGraphNode[];
}>;

export const VIDEO_AUTHORING_GRAPH_NODE_STATES = [
	"pending",
	"running",
	"waiting_external",
	"ready",
	"failed",
	"stale",
] as const;
export type VideoAuthoringGraphNodeState = (typeof VIDEO_AUTHORING_GRAPH_NODE_STATES)[number];

export const VIDEO_RUN_STATES = [
	"collecting",
	"planned",
	"scheduled",
	"video_running",
	"video_success",
	"concatenating",
	"concatenated",
	"failed",
	"cancelled",
] as const;
export type VideoRunState = (typeof VIDEO_RUN_STATES)[number];

export const VIDEO_RUN_TERMINAL_STATES = [
	"concatenated",
	"failed",
	"cancelled",
] as const satisfies readonly VideoRunState[];

export const VIDEO_AUTHORING_STATES = [
	"beats_committed",
	"writing_dispatched",
	"assembled",
	"script_approved",
	"deriving_assets",
	"asset_repair_required",
	"assets_ready",
	"estimate_ready",
	"authoring_done",
	"authoring_failed",
] as const;
export type VideoAuthoringState = (typeof VIDEO_AUTHORING_STATES)[number];

export const VIDEO_AUTHORING_TERMINAL_STATES = [
	"authoring_done",
	"authoring_failed",
] as const satisfies readonly VideoAuthoringState[];

export type VideoRunStatusEvent = Readonly<{
	protocolVersion: typeof VIDEO_RUN_STATUS_PROTOCOL_VERSION;
	runId: string;
	flowId: string | null;
	state: VideoRunState;
	totalClips: number;
	clipsDone: number;
	errorMessage: string | null;
	completedAt: string | null;
	authoringState: VideoAuthoringState | null;
	authoringClipsReady: number;
	authoringTotalClips: number;
	chapterId: string | null;
	chapterTitle: string | null;
	updatedAt: string;
}>;

export type VideoRunStatusSnapshot = Readonly<{
	protocolVersion: typeof VIDEO_RUN_STATUS_PROTOCOL_VERSION;
	scopeType: "project" | "chapter";
	scopeId: string;
	generatedAt: string;
	/** Snapshot query began after this persisted run timestamp. Buffered events at or below it are already represented. */
	watermarkUpdatedAt: string | null;
	runs: readonly VideoRunStatusEvent[];
}>;

type ParseSuccess<T> = Readonly<{ success: true; data: T }>;
type ParseFailure = Readonly<{ success: false; error: Readonly<{ message: string }> }>;
export type ParseResult<T> = ParseSuccess<T> | ParseFailure;

const VIDEO_RUN_STATE_SET = new Set<string>(VIDEO_RUN_STATES);
const VIDEO_AUTHORING_STATE_SET = new Set<string>(VIDEO_AUTHORING_STATES);
const VIDEO_PRODUCTION_WORKFLOW_NODE_ID_SET = new Set<string>(VIDEO_PRODUCTION_WORKFLOW_NODE_IDS);
const VIDEO_ATOMIC_WORKFLOW_NODE_ID_SET = new Set<string>(VIDEO_ATOMIC_WORKFLOW_NODE_IDS);
const VIDEO_PRODUCTION_WORKFLOW_NODE_STATUS_SET = new Set<string>(VIDEO_PRODUCTION_WORKFLOW_NODE_STATUSES);
const VIDEO_PRODUCTION_WORKFLOW_EVENT_KIND_SET = new Set<string>(VIDEO_PRODUCTION_WORKFLOW_EVENT_KINDS);

function asRecord(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? value as Record<string, unknown>
		: null;
}

function isNullableString(value: unknown): value is string | null {
	return value === null || typeof value === "string";
}

function isNonNegativeInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isNullableNonNegativeInteger(value: unknown): value is number | null {
	return value === null || isNonNegativeInteger(value);
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((entry) => typeof entry === "string" && entry.trim().length > 0);
}

function isTimestamp(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0 && Number.isFinite(Date.parse(value));
}

function isNullableTimestamp(value: unknown): value is string | null {
	return value === null || isTimestamp(value);
}

function failure(message: string): ParseFailure {
	return { success: false, error: { message } };
}

export function parseVideoRunStatusEvent(value: unknown): ParseResult<VideoRunStatusEvent> {
	const record = asRecord(value);
	if (!record) return failure("video run status event must be an object");
	if (record.protocolVersion !== VIDEO_RUN_STATUS_PROTOCOL_VERSION) {
		return failure(`protocolVersion must equal ${VIDEO_RUN_STATUS_PROTOCOL_VERSION}`);
	}
	if (typeof record.runId !== "string" || !record.runId.trim()) return failure("runId must be a non-empty string");
	if (!isNullableString(record.flowId)) return failure("flowId must be a string or null");
	if (typeof record.state !== "string" || !VIDEO_RUN_STATE_SET.has(record.state)) return failure("state is not canonical");
	if (!isNonNegativeInteger(record.totalClips)) return failure("totalClips must be a non-negative integer");
	if (!isNonNegativeInteger(record.clipsDone)) return failure("clipsDone must be a non-negative integer");
	if (!isNullableString(record.errorMessage)) return failure("errorMessage must be a string or null");
	if (!isNullableString(record.completedAt)) return failure("completedAt must be a string or null");
	if (
		record.authoringState !== null &&
		(typeof record.authoringState !== "string" || !VIDEO_AUTHORING_STATE_SET.has(record.authoringState))
	) return failure("authoringState is not canonical");
	if (!isNonNegativeInteger(record.authoringClipsReady)) return failure("authoringClipsReady must be a non-negative integer");
	if (!isNonNegativeInteger(record.authoringTotalClips)) return failure("authoringTotalClips must be a non-negative integer");
	if (!isNullableString(record.chapterId)) return failure("chapterId must be a string or null");
	if (!isNullableString(record.chapterTitle)) return failure("chapterTitle must be a string or null");
	if (!isTimestamp(record.updatedAt)) return failure("updatedAt must be an ISO timestamp");

	return { success: true, data: record as VideoRunStatusEvent };
}

export function parseVideoRunStatusSnapshot(value: unknown): ParseResult<VideoRunStatusSnapshot> {
	const record = asRecord(value);
	if (!record) return failure("video run status snapshot must be an object");
	if (record.protocolVersion !== VIDEO_RUN_STATUS_PROTOCOL_VERSION) {
		return failure(`protocolVersion must equal ${VIDEO_RUN_STATUS_PROTOCOL_VERSION}`);
	}
	if (record.scopeType !== "project" && record.scopeType !== "chapter") return failure("scopeType must be project or chapter");
	if (typeof record.scopeId !== "string" || !record.scopeId.trim()) return failure("scopeId must be a non-empty string");
	if (!isTimestamp(record.generatedAt)) return failure("generatedAt must be an ISO timestamp");
	if (!isNullableTimestamp(record.watermarkUpdatedAt)) return failure("watermarkUpdatedAt must be an ISO timestamp or null");
	if (!Array.isArray(record.runs)) return failure("runs must be an array");
	const runs: VideoRunStatusEvent[] = [];
	for (const rawRun of record.runs) {
		const parsed = parseVideoRunStatusEvent(rawRun);
		if (!parsed.success) return failure(`invalid snapshot run: ${parsed.error.message}`);
		runs.push(parsed.data);
	}
	return {
		success: true,
		data: {
			protocolVersion: VIDEO_RUN_STATUS_PROTOCOL_VERSION,
			scopeType: record.scopeType,
			scopeId: record.scopeId,
			generatedAt: record.generatedAt,
			watermarkUpdatedAt: record.watermarkUpdatedAt,
			runs,
		},
	};
}

export function isTerminalVideoRunState(state: VideoRunState): boolean {
	return state === "concatenated" || state === "failed" || state === "cancelled";
}

export function isTerminalVideoAuthoringState(state: VideoAuthoringState | null): boolean {
	return state === "authoring_done" || state === "authoring_failed";
}

export function parseVideoProductionWorkflowNodeProjection(
	value: unknown,
): ParseResult<VideoProductionWorkflowNodeProjection> {
	const record = asRecord(value);
	if (!record) return failure("video production workflow node projection must be an object");
	if (typeof record.workflowRunId !== "string" || !record.workflowRunId.trim()) {
		return failure("workflowRunId must be a non-empty string");
	}
	if (typeof record.workflowNodeId !== "string" || !VIDEO_PRODUCTION_WORKFLOW_NODE_ID_SET.has(record.workflowNodeId)) {
		return failure("workflowNodeId is not canonical");
	}
	if (typeof record.status !== "string" || !VIDEO_PRODUCTION_WORKFLOW_NODE_STATUS_SET.has(record.status)) {
		return failure("status is not canonical");
	}
	if (!isNonNegativeInteger(record.completedUnits)) return failure("completedUnits must be a non-negative integer");
	if (!isNullableNonNegativeInteger(record.totalUnits)) return failure("totalUnits must be a non-negative integer or null");
	if (!isStringArray(record.inputArtifactIds)) return failure("inputArtifactIds must be non-empty string values");
	if (!isStringArray(record.outputArtifactIds)) return failure("outputArtifactIds must be non-empty string values");
	if (!isStringArray(record.effectIds)) return failure("effectIds must be non-empty string values");
	if (!isNonNegativeInteger(record.errorCount)) return failure("errorCount must be a non-negative integer");
	const timing = asRecord(record.timing);
	if (!timing) return failure("timing must be an object");
	if (!isNullableTimestamp(timing.startedAt)) return failure("timing.startedAt must be an ISO timestamp or null");
	if (!isNullableTimestamp(timing.updatedAt)) return failure("timing.updatedAt must be an ISO timestamp or null");
	if (!isNullableTimestamp(timing.finishedAt)) return failure("timing.finishedAt must be an ISO timestamp or null");
	if (!isNullableNonNegativeInteger(timing.durationMs)) return failure("timing.durationMs must be a non-negative integer or null");
	if (!isNonNegativeInteger(record.latestEventSeq)) return failure("latestEventSeq must be a non-negative integer");
	return { success: true, data: record as VideoProductionWorkflowNodeProjection };
}

export function parseVideoProductionWorkflowEvent(value: unknown): ParseResult<VideoProductionWorkflowEvent> {
	const record = asRecord(value);
	if (!record) return failure("video production workflow event must be an object");
	if (record.protocolVersion !== VIDEO_PRODUCTION_WORKFLOW_PROTOCOL_VERSION) {
		return failure(`protocolVersion must equal ${VIDEO_PRODUCTION_WORKFLOW_PROTOCOL_VERSION}`);
	}
	if (typeof record.workflowRunId !== "string" || !record.workflowRunId.trim()) {
		return failure("workflowRunId must be a non-empty string");
	}
	if (typeof record.workflowNodeId !== "string" || !VIDEO_PRODUCTION_WORKFLOW_NODE_ID_SET.has(record.workflowNodeId)) {
		return failure("workflowNodeId is not canonical");
	}
	if (typeof record.eventId !== "string" || !record.eventId.trim()) return failure("eventId must be a non-empty string");
	if (!isNonNegativeInteger(record.seq)) return failure("seq must be a non-negative integer");
	if (typeof record.kind !== "string" || !VIDEO_PRODUCTION_WORKFLOW_EVENT_KIND_SET.has(record.kind)) {
		return failure("kind is not canonical");
	}
	if (!isTimestamp(record.occurredAt)) return failure("occurredAt must be an ISO timestamp");
	if (!isNullableString(record.payloadRef)) return failure("payloadRef must be a string or null");
	if (!isStringArray(record.artifactIds)) return failure("artifactIds must be non-empty string values");
	if (!isStringArray(record.effectIds)) return failure("effectIds must be non-empty string values");
	return { success: true, data: record as VideoProductionWorkflowEvent };
}

export function parseVideoProductionWorkflowSnapshot(value: unknown): ParseResult<VideoProductionWorkflowSnapshot> {
	const record = asRecord(value);
	if (!record) return failure("video production workflow snapshot must be an object");
	if (record.protocolVersion !== VIDEO_PRODUCTION_WORKFLOW_PROTOCOL_VERSION) {
		return failure(`protocolVersion must equal ${VIDEO_PRODUCTION_WORKFLOW_PROTOCOL_VERSION}`);
	}
	if (record.workflowKey !== VIDEO_PRODUCTION_WORKFLOW_KEY) {
		return failure(`workflowKey must equal ${VIDEO_PRODUCTION_WORKFLOW_KEY}`);
	}
	if (record.definitionVersion !== VIDEO_PRODUCTION_WORKFLOW_DEFINITION.definitionVersion) {
		return failure(`definitionVersion must equal ${VIDEO_PRODUCTION_WORKFLOW_DEFINITION.definitionVersion}`);
	}
	if (typeof record.workflowRunId !== "string" || !record.workflowRunId.trim()) {
		return failure("workflowRunId must be a non-empty string");
	}
	if (!isTimestamp(record.generatedAt)) return failure("generatedAt must be an ISO timestamp");
	if (!isNonNegativeInteger(record.latestEventSeq)) return failure("latestEventSeq must be a non-negative integer");
	if (!Array.isArray(record.nodes)) return failure("nodes must be an array");
	const nodes: VideoProductionWorkflowNodeProjection[] = [];
	for (const rawNode of record.nodes) {
		const parsed = parseVideoProductionWorkflowNodeProjection(rawNode);
		if (!parsed.success) return failure(`invalid workflow node: ${parsed.error.message}`);
		if (parsed.data.workflowRunId !== record.workflowRunId) {
			return failure("workflow node run ID must match snapshot workflowRunId");
		}
		nodes.push(parsed.data);
	}
	const expectedNodeIds = VIDEO_PRODUCTION_WORKFLOW_NODE_IDS.join(",");
	const actualNodeIds = nodes.map((node) => node.workflowNodeId).join(",");
	if (actualNodeIds !== expectedNodeIds) return failure("workflow snapshot must contain the canonical seven nodes in order");
	return {
		success: true,
		data: {
			protocolVersion: VIDEO_PRODUCTION_WORKFLOW_PROTOCOL_VERSION,
			workflowKey: VIDEO_PRODUCTION_WORKFLOW_KEY,
			definitionVersion: VIDEO_PRODUCTION_WORKFLOW_DEFINITION.definitionVersion,
			workflowRunId: record.workflowRunId,
			generatedAt: record.generatedAt,
			latestEventSeq: record.latestEventSeq,
			nodes,
		},
	};
}

export function parseVideoAtomicWorkflowNodeProjection(
	value: unknown,
): ParseResult<VideoAtomicWorkflowNodeProjection> {
	const record = asRecord(value);
	if (!record) return failure("video atomic workflow node projection must be an object");
	if (typeof record.workflowRunId !== "string" || !record.workflowRunId.trim()) {
		return failure("workflowRunId must be a non-empty string");
	}
	if (typeof record.atomicNodeId !== "string" || !VIDEO_ATOMIC_WORKFLOW_NODE_ID_SET.has(record.atomicNodeId)) {
		return failure("atomicNodeId is not canonical");
	}
	if (typeof record.status !== "string" || !VIDEO_PRODUCTION_WORKFLOW_NODE_STATUS_SET.has(record.status)) {
		return failure("status is not canonical");
	}
	if (!isNonNegativeInteger(record.completedUnits)) return failure("completedUnits must be a non-negative integer");
	if (!isNullableNonNegativeInteger(record.totalUnits)) return failure("totalUnits must be a non-negative integer or null");
	if (!isStringArray(record.inputArtifactIds)) return failure("inputArtifactIds must be non-empty string values");
	if (!isStringArray(record.outputArtifactIds)) return failure("outputArtifactIds must be non-empty string values");
	if (!isStringArray(record.effectIds)) return failure("effectIds must be non-empty string values");
	if (!isNonNegativeInteger(record.errorCount)) return failure("errorCount must be a non-negative integer");
	if (!isStringArray(record.errorMessages)) return failure("errorMessages must be non-empty string values");
	const timing = asRecord(record.timing);
	if (!timing) return failure("timing must be an object");
	if (!isNullableTimestamp(timing.startedAt)) return failure("timing.startedAt must be an ISO timestamp or null");
	if (!isNullableTimestamp(timing.updatedAt)) return failure("timing.updatedAt must be an ISO timestamp or null");
	if (!isNullableTimestamp(timing.finishedAt)) return failure("timing.finishedAt must be an ISO timestamp or null");
	if (!isNullableNonNegativeInteger(timing.durationMs)) return failure("timing.durationMs must be a non-negative integer or null");
	const outputRefs = asRecord(record.outputRefs);
	if (!outputRefs || !asRecord(outputRefs.ports) || !asRecord(outputRefs.evidence)) {
		return failure("outputRefs ports and evidence must be objects");
	}
	if (!Array.isArray(outputRefs.artifacts) || !Array.isArray(outputRefs.itemRuns)) {
		return failure("outputRefs artifacts and itemRuns must be arrays");
	}
	if (!isNonNegativeInteger(record.latestEventSeq)) return failure("latestEventSeq must be a non-negative integer");
	return { success: true, data: record as VideoAtomicWorkflowNodeProjection };
}

export function parseVideoAtomicWorkflowSnapshot(value: unknown): ParseResult<VideoAtomicWorkflowSnapshot> {
	const record = asRecord(value);
	if (!record) return failure("video atomic workflow snapshot must be an object");
	if (record.protocolVersion !== VIDEO_ATOMIC_WORKFLOW_PROTOCOL_VERSION) {
		return failure(`protocolVersion must equal ${VIDEO_ATOMIC_WORKFLOW_PROTOCOL_VERSION}`);
	}
	if (record.workflowKey !== VIDEO_PRODUCTION_WORKFLOW_KEY) {
		return failure(`workflowKey must equal ${VIDEO_PRODUCTION_WORKFLOW_KEY}`);
	}
	if (record.definitionVersion !== 2) return failure("definitionVersion must equal 2");
	if (typeof record.workflowRunId !== "string" || !record.workflowRunId.trim()) {
		return failure("workflowRunId must be a non-empty string");
	}
	if (
		record.executionScope !== null &&
		record.executionScope !== "prompt_only" &&
		record.executionScope !== "media_delivery"
	) return failure("executionScope is not canonical");
	if (!isTimestamp(record.generatedAt)) return failure("generatedAt must be an ISO timestamp");
	if (!isNonNegativeInteger(record.latestEventSeq)) return failure("latestEventSeq must be a non-negative integer");
	if (!Array.isArray(record.nodes)) return failure("nodes must be an array");
	const nodes: VideoAtomicWorkflowNodeProjection[] = [];
	for (const rawNode of record.nodes) {
		const parsed = parseVideoAtomicWorkflowNodeProjection(rawNode);
		if (!parsed.success) return failure(`invalid atomic workflow node: ${parsed.error.message}`);
		if (parsed.data.workflowRunId !== record.workflowRunId) {
			return failure("atomic workflow node run ID must match snapshot workflowRunId");
		}
		nodes.push(parsed.data);
	}
	if (nodes.map((node) => node.atomicNodeId).join(",") !== VIDEO_ATOMIC_WORKFLOW_NODE_IDS.join(",")) {
		return failure("atomic workflow snapshot must contain the canonical fifteen nodes in order");
	}
	return {
		success: true,
		data: {
			protocolVersion: VIDEO_ATOMIC_WORKFLOW_PROTOCOL_VERSION,
			workflowKey: VIDEO_PRODUCTION_WORKFLOW_KEY,
			definitionVersion: 2,
			workflowRunId: record.workflowRunId,
			executionScope: record.executionScope,
			generatedAt: record.generatedAt,
			latestEventSeq: record.latestEventSeq,
			nodes,
		},
	};
}
