export const WORKFLOW_KERNEL_PROTOCOL_VERSION = "1" as const;
export const AGENT_WORKFLOW_KEY = "agent-workflow/v1" as const;

export * from "./plugin-contract";
export * from "./artifact-contract";
export * from "./control-contract";
export * from "./execution-semantics";

export const WORKFLOW_ATOMIC_NODE_CATEGORIES = [
	"source",
	"agent",
	"media",
	"skill",
	"tool",
	"control",
	"artifact",
	"delivery",
] as const;
export type WorkflowAtomicNodeCategory = (typeof WORKFLOW_ATOMIC_NODE_CATEGORIES)[number];

export const WORKFLOW_NODE_EXECUTION_MODES = ["once", "each", "collect"] as const;
export type WorkflowNodeExecutionMode = (typeof WORKFLOW_NODE_EXECUTION_MODES)[number];
export const WORKFLOW_AGENT_OUTPUT_ENCODINGS = ["plain_text", "json_object", "json_artifact", "json_array"] as const;
export type WorkflowAgentOutputEncoding = (typeof WORKFLOW_AGENT_OUTPUT_ENCODINGS)[number];
/**
 * Version of the Agent-authored BeatSheet wire contract. This is distinct from
 * the expanded `tapcanvas.beat-sheet/v2` port artifact: the runtime may project
 * compiler-owned fields before the artifact crosses the typed port boundary.
 */
export const WORKFLOW_BEAT_SHEET_AGENT_CONTRACT_NAME = "tapcanvas.beat-sheet-artifact" as const;
export const WORKFLOW_BEAT_SHEET_AGENT_CONTRACT_VERSION = "20" as const;
/**
 * One scheduling boundary shared by whole-workflow and per-item execution.
 * Keeping both admission paths on this contract prevents an authored DAG from
 * passing the editor/runtime node checks and then failing at execution start.
 */
export const WORKFLOW_CONCURRENCY_MIN = 1 as const;
export const WORKFLOW_CONCURRENCY_MAX = 16 as const;

/**
 * Cross-execution recovery is an authored workflow fact. `fresh_only` forbids
 * every new physical execution from inheriting an execution family, DAG cursor,
 * checkpoint, or idempotency identity from an earlier execution. It does not
 * affect durable waiting/resumption inside the same physical execution.
 */
export const WORKFLOW_EXECUTION_RECOVERY_POLICIES = ["recoverable", "fresh_only"] as const;
export type WorkflowExecutionRecoveryPolicy = (typeof WORKFLOW_EXECUTION_RECOVERY_POLICIES)[number];
export const WORKFLOW_AGENT_MAX_OUTPUT_TOKENS_MIN = 128 as const;
export const WORKFLOW_AGENT_MAX_OUTPUT_TOKENS_MAX = 32_768 as const;

export const WORKFLOW_COLLECTION_PROTOCOL_VERSION = "workflow.collection/v1" as const;

export const WORKFLOW_KNOWLEDGE_CANDIDATE_SET_VERSION = "workflow.knowledge-candidates/v1" as const;
export const WORKFLOW_KNOWLEDGE_CARD_VERSION = "workflow.knowledge-card/v1" as const;

export type WorkflowKnowledgeCandidateV1 = Readonly<{
	cardId: string;
	sourceRoot: string;
	domain: string;
	facet: string | null;
	title: string;
	roleScope: readonly string[];
	keywords: readonly string[];
	sourceUrls: readonly string[];
	bodyPreview: string;
	rank: number;
	score: number;
	vectorScore: number;
	vectorRank: number;
	matchedQueryIds: readonly string[];
}>;

/**
 * Durable output of an explicit Knowledge Search node. It carries the exact recalled identities,
 * so a later Knowledge Read node can prove membership without relying on one agent turn's memory.
 */
export type WorkflowKnowledgeCandidateSetV1 = Readonly<{
	protocolVersion: typeof WORKFLOW_KNOWLEDGE_CANDIDATE_SET_VERSION;
	candidateSetId: string;
	requestHash: string;
	createdAt: string;
	retrievalMode: "vector";
	abstained: boolean;
	diagnostics: Readonly<{
		vectorCandidates: number;
		indexedCards: number;
		availableCards: number;
		embeddingModel: string;
	}>;
	candidates: readonly WorkflowKnowledgeCandidateV1[];
}>;

export type WorkflowKnowledgeCardV1 = Readonly<{
	protocolVersion: typeof WORKFLOW_KNOWLEDGE_CARD_VERSION;
	candidateSetId: string;
	requestHash: string;
	cardId: string;
	domain: string;
	facet: string | null;
	title: string;
	roleScope: readonly string[];
	keywords: readonly string[];
	sourceUrls: readonly string[];
	body: string;
}>;

function requireKnowledgeString(value: unknown, field: string): string {
	if (typeof value !== "string" || !value.trim()) {
		throw new Error(`Workflow knowledge ${field} must be a non-empty string`);
	}
	return value.trim();
}

function readKnowledgeStringList(value: unknown, field: string): readonly string[] {
	if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
		throw new Error(`Workflow knowledge ${field} must be a string array`);
	}
	return value.map((item) => item.trim()).filter(Boolean);
}

function requireFiniteKnowledgeNumber(value: unknown, field: string): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		throw new Error(`Workflow knowledge ${field} must be a finite number`);
	}
	return value;
}

function parseWorkflowKnowledgeCandidate(value: unknown, index: number): WorkflowKnowledgeCandidateV1 {
	const candidate = asRecord(value);
	if (!candidate) throw new Error(`Workflow knowledge candidates[${index}] must be an object`);
	const rank = requireFiniteKnowledgeNumber(candidate.rank, `candidates[${index}].rank`);
	const vectorRank = requireFiniteKnowledgeNumber(candidate.vectorRank, `candidates[${index}].vectorRank`);
	if (!Number.isInteger(rank) || rank < 1 || !Number.isInteger(vectorRank) || vectorRank < 1) {
		throw new Error(`Workflow knowledge candidates[${index}] ranks must be positive integers`);
	}
	if (candidate.facet !== null && typeof candidate.facet !== "string") {
		throw new Error(`Workflow knowledge candidates[${index}].facet must be a string or null`);
	}
	return {
		cardId: requireKnowledgeString(candidate.cardId, `candidates[${index}].cardId`),
		sourceRoot: requireKnowledgeString(candidate.sourceRoot, `candidates[${index}].sourceRoot`),
		domain: requireKnowledgeString(candidate.domain, `candidates[${index}].domain`),
		facet: candidate.facet === null ? null : candidate.facet.trim() || null,
		title: requireKnowledgeString(candidate.title, `candidates[${index}].title`),
		roleScope: readKnowledgeStringList(candidate.roleScope, `candidates[${index}].roleScope`),
		keywords: readKnowledgeStringList(candidate.keywords, `candidates[${index}].keywords`),
		sourceUrls: readKnowledgeStringList(candidate.sourceUrls, `candidates[${index}].sourceUrls`),
		bodyPreview: requireKnowledgeString(candidate.bodyPreview, `candidates[${index}].bodyPreview`),
		rank,
		score: requireFiniteKnowledgeNumber(candidate.score, `candidates[${index}].score`),
		vectorScore: requireFiniteKnowledgeNumber(candidate.vectorScore, `candidates[${index}].vectorScore`),
		vectorRank,
		matchedQueryIds: readKnowledgeStringList(candidate.matchedQueryIds, `candidates[${index}].matchedQueryIds`),
	};
}

export function parseWorkflowKnowledgeCandidateSetV1(value: unknown): WorkflowKnowledgeCandidateSetV1 {
	const record = asRecord(value);
	if (!record || record.protocolVersion !== WORKFLOW_KNOWLEDGE_CANDIDATE_SET_VERSION) {
		throw new Error(`Workflow knowledge candidate set protocolVersion must be ${WORKFLOW_KNOWLEDGE_CANDIDATE_SET_VERSION}`);
	}
	const diagnostics = asRecord(record.diagnostics);
	if (!diagnostics) throw new Error("Workflow knowledge candidate set diagnostics must be an object");
	if (!Array.isArray(record.candidates) || record.candidates.length > 12) {
		throw new Error("Workflow knowledge candidate set requires at most 12 candidates");
	}
	const candidates = record.candidates.map(parseWorkflowKnowledgeCandidate);
	const cardIdentities = candidates.map((candidate) => `${candidate.sourceRoot}\u0000${candidate.cardId}`);
	if (new Set(cardIdentities).size !== cardIdentities.length) {
		throw new Error("Workflow knowledge candidate identities must be unique");
	}
	if (candidates.some((candidate, index) => candidate.rank !== index + 1)) {
		throw new Error("Workflow knowledge candidate ranks must match result order");
	}
	return {
		protocolVersion: WORKFLOW_KNOWLEDGE_CANDIDATE_SET_VERSION,
		candidateSetId: requireKnowledgeString(record.candidateSetId, "candidateSetId"),
		requestHash: requireKnowledgeString(record.requestHash, "requestHash"),
		createdAt: requireKnowledgeString(record.createdAt, "createdAt"),
		retrievalMode: record.retrievalMode === "vector"
			? "vector"
			: (() => { throw new Error("Workflow knowledge retrievalMode must be vector"); })(),
		abstained: typeof record.abstained === "boolean"
			? record.abstained
			: (() => { throw new Error("Workflow knowledge abstained must be boolean"); })(),
		diagnostics: {
			vectorCandidates: requireFiniteKnowledgeNumber(diagnostics.vectorCandidates, "diagnostics.vectorCandidates"),
			indexedCards: requireFiniteKnowledgeNumber(diagnostics.indexedCards, "diagnostics.indexedCards"),
			availableCards: requireFiniteKnowledgeNumber(diagnostics.availableCards, "diagnostics.availableCards"),
			embeddingModel: requireKnowledgeString(diagnostics.embeddingModel, "diagnostics.embeddingModel"),
		},
		candidates,
	};
}

export function parseWorkflowKnowledgeCardV1(value: unknown): WorkflowKnowledgeCardV1 {
	const record = asRecord(value);
	if (!record || record.protocolVersion !== WORKFLOW_KNOWLEDGE_CARD_VERSION) {
		throw new Error(`Workflow knowledge card protocolVersion must be ${WORKFLOW_KNOWLEDGE_CARD_VERSION}`);
	}
	if (record.facet !== null && typeof record.facet !== "string") {
		throw new Error("Workflow knowledge card facet must be a string or null");
	}
	return {
		protocolVersion: WORKFLOW_KNOWLEDGE_CARD_VERSION,
		candidateSetId: requireKnowledgeString(record.candidateSetId, "candidateSetId"),
		requestHash: requireKnowledgeString(record.requestHash, "requestHash"),
		cardId: requireKnowledgeString(record.cardId, "cardId"),
		domain: requireKnowledgeString(record.domain, "domain"),
		facet: record.facet === null ? null : record.facet.trim() || null,
		title: requireKnowledgeString(record.title, "title"),
		roleScope: readKnowledgeStringList(record.roleScope, "roleScope"),
		keywords: readKnowledgeStringList(record.keywords, "keywords"),
		sourceUrls: readKnowledgeStringList(record.sourceUrls, "sourceUrls"),
		body: requireKnowledgeString(record.body, "body"),
	};
}

export type WorkflowItemLineageV1 = Readonly<{
	nodeId: string;
	portId: string;
	itemId: string;
	index: number;
}>;

export type WorkflowCollectionItemV1<T = unknown> = Readonly<{
	itemId: string;
	index: number;
	value: T;
	lineage: readonly WorkflowItemLineageV1[];
}>;

export type WorkflowCollectionV1<T = unknown> = Readonly<{
	protocolVersion: typeof WORKFLOW_COLLECTION_PROTOCOL_VERSION;
	collectionId: string;
	items: readonly WorkflowCollectionItemV1<T>[];
}>;

export type CreateWorkflowCollectionInput<T> = Readonly<{
	collectionId: string;
	producerNodeId: string;
	producerPortId: string;
	values: readonly T[];
	itemIds?: readonly string[];
	parentLineage?: readonly (readonly WorkflowItemLineageV1[])[];
}>;

function requireWorkflowIdentity(value: string, field: string): string {
	const normalized = value.trim();
	if (!normalized) throw new Error(`${field} must be a non-empty string`);
	return normalized;
}

/**
 * Creates an ordered collection with stable item identity and explicit provenance. The caller
 * owns item order and identity; no semantic inference or repeat-last alignment is performed.
 */
export function createWorkflowCollection<T>(
	input: CreateWorkflowCollectionInput<T>,
): WorkflowCollectionV1<T> {
	const collectionId = requireWorkflowIdentity(input.collectionId, "collectionId");
	const producerNodeId = requireWorkflowIdentity(input.producerNodeId, "producerNodeId");
	const producerPortId = requireWorkflowIdentity(input.producerPortId, "producerPortId");
	if (input.itemIds && input.itemIds.length !== input.values.length) {
		throw new Error("itemIds length must match values length");
	}
	if (input.parentLineage && input.parentLineage.length !== input.values.length) {
		throw new Error("parentLineage length must match values length");
	}
	const itemIds = input.values.map((_, index) => requireWorkflowIdentity(
		input.itemIds?.[index] ?? `${collectionId}:item:${index + 1}`,
		`itemIds[${index}]`,
	));
	if (new Set(itemIds).size !== itemIds.length) {
		throw new Error("Workflow collection itemIds must be unique");
	}
	return {
		protocolVersion: WORKFLOW_COLLECTION_PROTOCOL_VERSION,
		collectionId,
		items: input.values.map((value, index) => ({
			itemId: itemIds[index],
			index,
			value,
			lineage: [
				...(input.parentLineage?.[index] ?? []),
				{ nodeId: producerNodeId, portId: producerPortId, itemId: itemIds[index], index },
			],
		})),
	};
}

function isWorkflowLineage(value: unknown): value is WorkflowItemLineageV1 {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const record = value as Record<string, unknown>;
	return typeof record.nodeId === "string" && record.nodeId.trim().length > 0
		&& typeof record.portId === "string" && record.portId.trim().length > 0
		&& typeof record.itemId === "string" && record.itemId.trim().length > 0
		&& Number.isInteger(record.index) && Number(record.index) >= 0;
}

export function isWorkflowCollection(value: unknown): value is WorkflowCollectionV1 {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const record = value as Record<string, unknown>;
	if (record.protocolVersion !== WORKFLOW_COLLECTION_PROTOCOL_VERSION) return false;
	if (typeof record.collectionId !== "string" || !record.collectionId.trim()) return false;
	if (!Array.isArray(record.items)) return false;
	const itemIds = new Set<string>();
	for (let index = 0; index < record.items.length; index += 1) {
		const item = record.items[index];
		if (!item || typeof item !== "object" || Array.isArray(item)) return false;
		const itemRecord = item as Record<string, unknown>;
		if (typeof itemRecord.itemId !== "string" || !itemRecord.itemId.trim()) return false;
		if (itemIds.has(itemRecord.itemId)) return false;
		itemIds.add(itemRecord.itemId);
		if (itemRecord.index !== index) return false;
		if (!Object.prototype.hasOwnProperty.call(itemRecord, "value")) return false;
		if (!Array.isArray(itemRecord.lineage) || !itemRecord.lineage.every(isWorkflowLineage)) return false;
	}
	return true;
}

/**
 * Canvas nodes persist this explicit, domain-neutral contract. The category controls the
 * editor surface; executorRef controls execution. Neither is inferred from labels or prompts.
 */
export type WorkflowAtomicNodeSpecV1 = Readonly<{
	version: 1;
	category: WorkflowAtomicNodeCategory;
	operation: string;
	executorRef: string | null;
	executionMode: WorkflowNodeExecutionMode;
	/** Maximum in-flight item executions for `each`; omitted means one-at-a-time. */
	itemConcurrency?: number;
	inputPorts: readonly string[];
	/** Input ports that may be supplied by configuration instead of an edge. */
	optionalInputPorts?: readonly string[];
	outputPorts: readonly string[];
	/**
	 * Machine-readable artifact contracts for values transported by typed ports.
	 * The graph compiler compares these declarations with the server-owned
	 * executor registry before an execution is created. Arrays express a closed
	 * union of accepted artifact versions; they are not semantic fallbacks.
	 */
	inputArtifactTypes?: Readonly<Record<string, readonly string[]>>;
	outputArtifactTypes?: Readonly<Record<string, readonly string[]>>;
	/** Output ports whose edge activation is selected by the executor's actual output. */
	selectiveOutputPorts?: readonly string[];
	/**
	 * Authoring declaration only. The runtime enables reuse only when this exact contract
	 * is also attested by the server-owned executor registry.
	 */
	cachePolicy?: WorkflowPureNodeCachePolicyV1;
}>;

export type WorkflowExecutorPortArtifactContractV1 = Readonly<{
	inputArtifactTypes: Readonly<Record<string, readonly string[]>>;
	outputArtifactTypes: Readonly<Record<string, readonly string[]>>;
}>;

/**
 * Cross-runtime typed-port authority for executor boundaries whose payload
 * shape cannot be inferred from a port name. Keeping this registry in the
 * shared protocol lets the editor emit the same declaration that the durable
 * executor compiles. A new required field must publish a new artifact version
 * here instead of changing a consumer silently.
 */
export const WORKFLOW_EXECUTOR_PORT_ARTIFACT_CONTRACTS = Object.freeze({
	"video.asset-plans.project/v1": {
		inputArtifactTypes: {
			"beat-sheet": ["tapcanvas.beat-sheet/v2", "tapcanvas.launch-beat-sheet/v1"],
		},
		outputArtifactTypes: {
			"asset-plans": ["tapcanvas.asset-plans/v1"],
		},
	},
	"video.asset-plans.split/v1": {
		inputArtifactTypes: {
			"asset-plans": ["tapcanvas.asset-plans/v1"],
			"beat-sheet": ["tapcanvas.beat-sheet/v2", "tapcanvas.launch-beat-sheet/v1"],
			"asset-bindings": ["tapcanvas.asset-bindings/v1"],
		},
		outputArtifactTypes: {
			"asset-items": ["tapcanvas.asset-plan-items/v2"],
		},
	},
	"tapcanvas.image.generate/v1": {
		inputArtifactTypes: {
			"asset-items": ["tapcanvas.asset-plan-items/v2"],
		},
		outputArtifactTypes: {},
	},
} satisfies Readonly<Record<string, WorkflowExecutorPortArtifactContractV1>>);

export function resolveWorkflowExecutorPortArtifactContract(
	executorRef: string,
): WorkflowExecutorPortArtifactContractV1 | null {
	return Object.prototype.hasOwnProperty.call(WORKFLOW_EXECUTOR_PORT_ARTIFACT_CONTRACTS, executorRef)
		? WORKFLOW_EXECUTOR_PORT_ARTIFACT_CONTRACTS[
			executorRef as keyof typeof WORKFLOW_EXECUTOR_PORT_ARTIFACT_CONTRACTS
		]
		: null;
}

export const WORKFLOW_PURE_NODE_CACHE_POLICY_VERSION = 1 as const;

export type WorkflowPureNodeCachePolicyV1 = Readonly<{
	version: typeof WORKFLOW_PURE_NODE_CACHE_POLICY_VERSION;
	strategy: "content_addressed";
	contractVersion: string;
}>;

export const WORKFLOW_PINNED_OUTPUT_SOURCE_VERSION = 1 as const;

/**
 * Authoring-time reference to one real, successful durable node run. The output itself is
 * deliberately not embedded in the canvas: the workflow runtime must resolve this identity
 * against its durable store before freezing an execution version.
 */
export type WorkflowPinnedOutputSourceV1 = Readonly<{
	version: typeof WORKFLOW_PINNED_OUTPUT_SOURCE_VERSION;
	sourceExecutionId: string;
	sourceNodeRunId: string;
}>;

export function parseWorkflowPinnedOutputSourceV1(
	value: unknown,
): WorkflowPinnedOutputSourceV1 | null {
	if (value === null || value === undefined) return null;
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("Pinned workflow output source must be an object");
	}
	const source = value as Record<string, unknown>;
	if (source.version !== WORKFLOW_PINNED_OUTPUT_SOURCE_VERSION) {
		throw new Error("Pinned workflow output source version must be 1");
	}
	const sourceExecutionId = typeof source.sourceExecutionId === "string"
		? source.sourceExecutionId.trim()
		: "";
	const sourceNodeRunId = typeof source.sourceNodeRunId === "string"
		? source.sourceNodeRunId.trim()
		: "";
	if (!sourceExecutionId || !sourceNodeRunId) {
		throw new Error("Pinned workflow output source requires execution and node-run identities");
	}
	return { version: 1, sourceExecutionId, sourceNodeRunId };
}

export const WORKFLOW_TRIGGER_KINDS = ["manual", "schedule", "webhook", "event"] as const;
export type WorkflowTriggerKind = (typeof WORKFLOW_TRIGGER_KINDS)[number];

export const WORKFLOW_TRIGGER_MISFIRE_POLICIES = ["skip", "run_once"] as const;
export type WorkflowTriggerMisfirePolicy = (typeof WORKFLOW_TRIGGER_MISFIRE_POLICIES)[number];

export const ADMIN_WORKFLOW_PERMISSION = {
	visibilityRoles: ["admin"],
	editRoles: ["admin"],
	runRoles: ["admin"],
} as const;

export type WorkflowNodePermissionV1 = Readonly<{
	visibilityRoles: readonly ["admin"];
	editRoles: readonly ["admin"];
	runRoles: readonly ["admin"];
}>;

export type ManualWorkflowTriggerSpecV1 = Readonly<{
	version: 1;
	kind: "manual";
}>;

export type ScheduleWorkflowTriggerSpecV1 = Readonly<{
	version: 1;
	kind: "schedule";
	scheduleId: string;
	cron: string;
	timezone: string;
	enabled: boolean;
	misfirePolicy: WorkflowTriggerMisfirePolicy;
	maxCatchUpRuns: number;
}>;

export type WebhookWorkflowTriggerSpecV1 = Readonly<{
	version: 1;
	kind: "webhook";
	webhookId: string;
	secretRef: string;
}>;

export type EventWorkflowTriggerSpecV1 = Readonly<{
	version: 1;
	kind: "event";
	topic: string;
	filter: Readonly<Record<string, string | number | boolean | null>>;
}>;

export type WorkflowTriggerSpecV1 =
	| ManualWorkflowTriggerSpecV1
	| ScheduleWorkflowTriggerSpecV1
	| WebhookWorkflowTriggerSpecV1
	| EventWorkflowTriggerSpecV1;

export type WorkflowTriggerOccurrenceV1 = Readonly<{
	version: 1;
	triggerId: string;
	workflowKey: string;
	workflowDefinitionVersion: number;
	scheduledFor: string;
	occurrenceKey: string;
}>;

export type WorkflowPortDefinitionV1 = Readonly<{
	id: string;
	dataType: string;
	required: boolean;
	cardinality: "one" | "many";
}>;

export type WorkflowNodeDefinitionV1 = Readonly<{
	nodeId: string;
	nodeType: string;
	nodeVersion: number;
	label: string;
	category: "trigger" | "source" | "agent" | "media" | "skill" | "tool" | "control" | "artifact" | "delivery" | "subworkflow";
	inputPorts: readonly WorkflowPortDefinitionV1[];
	outputPorts: readonly WorkflowPortDefinitionV1[];
	executorRef: string | null;
	permission: WorkflowNodePermissionV1;
	config: Readonly<Record<string, unknown>>;
}>;

export type WorkflowDefinitionV1 = Readonly<{
	protocolVersion: typeof WORKFLOW_KERNEL_PROTOCOL_VERSION;
	workflowKey: string;
	definitionVersion: number;
	nodes: readonly WorkflowNodeDefinitionV1[];
	edges: readonly Readonly<{
		edgeId: string;
		sourceNodeId: string;
		sourcePortId: string;
		targetNodeId: string;
		targetPortId: string;
	}>[];
}>;

type WorkflowGraphRecord = Record<string, unknown>;

function readWorkflowGraphRecord(value: unknown): WorkflowGraphRecord | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? value as WorkflowGraphRecord
		: null;
}

function readWorkflowGraphNodeId(value: unknown): string {
	const record = readWorkflowGraphRecord(value);
	return typeof record?.id === "string" ? record.id.trim() : "";
}

function isAdminOnlyPermission(value: unknown): boolean {
	const permission = readWorkflowGraphRecord(value);
	const roles = Array.isArray(permission?.visibilityRoles)
		? permission.visibilityRoles
		: [];
	return roles.length === 1 && roles[0] === "admin";
}

/**
 * Admin workflow nodes are identified from explicit protocol facts only. Feature names are
 * included so a caller cannot expose a protected node by deleting its UI marker.
 */
export function isAdminWorkflowGraphNode(value: unknown): boolean {
	const node = readWorkflowGraphRecord(value);
	const data = readWorkflowGraphRecord(node?.data);
	if (!data) return false;
	return data.adminWorkflow === true
		|| data.kind === "workflowTrigger"
		|| data.kind === "workflowStage"
		|| isAdminOnlyPermission(data.workflowPermission);
}

export function hasAdminWorkflowGraphNodes(value: unknown): boolean {
	const graph = readWorkflowGraphRecord(value);
	return Array.isArray(graph?.nodes) && graph.nodes.some(isAdminWorkflowGraphNode);
}

function edgeTouchesNodeIds(value: unknown, nodeIds: ReadonlySet<string>): boolean {
	const edge = readWorkflowGraphRecord(value);
	const source = typeof edge?.source === "string" ? edge.source.trim() : "";
	const target = typeof edge?.target === "string" ? edge.target.trim() : "";
	return nodeIds.has(source) || nodeIds.has(target);
}

/** Remove admin-only workflow nodes and every connected edge from a graph-shaped value. */
export function projectWorkflowGraphForViewer(value: unknown, canViewAdminWorkflow: boolean): unknown {
	if (canViewAdminWorkflow) return value;
	const graph = readWorkflowGraphRecord(value);
	if (!graph) return value;
	const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
	const hiddenNodeIds = new Set(nodes
		.filter(isAdminWorkflowGraphNode)
		.map(readWorkflowGraphNodeId)
		.filter(Boolean));
	const edges = Array.isArray(graph.edges) ? graph.edges : [];
	return {
		...graph,
		nodes: nodes.filter((node) => !isAdminWorkflowGraphNode(node)),
		edges: edges.filter((edge) => !edgeTouchesNodeIds(edge, hiddenNodeIds)),
	};
}

/** Project incremental React Flow patches before they cross a non-admin realtime channel. */
export function projectWorkflowGraphPatchForViewer(value: unknown, canViewAdminWorkflow: boolean): unknown {
	if (canViewAdminWorkflow) return value;
	const patch = readWorkflowGraphRecord(value);
	if (!patch) return value;
	const hasNodePatch = Object.prototype.hasOwnProperty.call(patch, "upsertNodes");
	const hasEdgePatch = Object.prototype.hasOwnProperty.call(patch, "upsertEdges");
	if (!hasNodePatch && !hasEdgePatch) return value;
	const upsertNodes = Array.isArray(patch.upsertNodes) ? patch.upsertNodes : [];
	const hiddenNodeIds = new Set(upsertNodes
		.filter(isAdminWorkflowGraphNode)
		.map(readWorkflowGraphNodeId)
		.filter(Boolean));
	const upsertEdges = Array.isArray(patch.upsertEdges) ? patch.upsertEdges : [];
	return {
		...patch,
		...(hasNodePatch
			? { upsertNodes: upsertNodes.filter((node) => !isAdminWorkflowGraphNode(node)) }
			: {}),
		...(hasEdgePatch
			? { upsertEdges: upsertEdges.filter((edge) => !edgeTouchesNodeIds(edge, hiddenNodeIds)) }
			: {}),
	};
}

/**
 * A non-admin saves the projected graph it was allowed to read. Preserve the existing protected
 * nodes and their edges, and reject attempts to mint or mutate protected workflow capabilities.
 */
export function preserveAdminWorkflowGraphForNonAdmin(input: Readonly<{
	existing: unknown;
	incoming: unknown;
}>): unknown {
	const existing = readWorkflowGraphRecord(input.existing) ?? {};
	const incoming = readWorkflowGraphRecord(input.incoming) ?? {};
	const existingNodes = Array.isArray(existing.nodes) ? existing.nodes : [];
	const incomingNodes = Array.isArray(incoming.nodes) ? incoming.nodes : [];
	const existingAdminNodes = existingNodes.filter(isAdminWorkflowGraphNode);
	const existingAdminIds = new Set(existingAdminNodes
		.map(readWorkflowGraphNodeId)
		.filter(Boolean));
	const claimedAdminIds = new Set(incomingNodes
		.filter(isAdminWorkflowGraphNode)
		.map(readWorkflowGraphNodeId)
		.filter(Boolean));
	const protectedIds = new Set([...existingAdminIds, ...claimedAdminIds]);
	const existingEdges = Array.isArray(existing.edges) ? existing.edges : [];
	const incomingEdges = Array.isArray(incoming.edges) ? incoming.edges : [];
	return {
		...incoming,
		nodes: [
			...incomingNodes.filter((node) => !isAdminWorkflowGraphNode(node)),
			...existingAdminNodes,
		],
		edges: [
			...incomingEdges.filter((edge) => !edgeTouchesNodeIds(edge, protectedIds)),
			...existingEdges.filter((edge) => edgeTouchesNodeIds(edge, existingAdminIds)),
		],
	};
}

export type WorkflowTriggerParseResult =
	| Readonly<{ success: true; data: WorkflowTriggerSpecV1 }>
	| Readonly<{ success: false; error: Readonly<{ message: string }> }>;

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? value as Record<string, unknown>
		: null;
}

function nonEmptyString(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function failure(message: string): WorkflowTriggerParseResult {
	return { success: false, error: { message } };
}

export function createManualWorkflowTriggerSpec(): ManualWorkflowTriggerSpecV1 {
	return { version: 1, kind: "manual" };
}

export function createScheduleWorkflowTriggerSpec(input: Readonly<{
	scheduleId: string;
	cron: string;
	timezone: string;
	enabled?: boolean;
	misfirePolicy?: WorkflowTriggerMisfirePolicy;
	maxCatchUpRuns?: number;
}>): ScheduleWorkflowTriggerSpecV1 {
	const scheduleId = nonEmptyString(input.scheduleId);
	const cron = nonEmptyString(input.cron);
	const timezone = nonEmptyString(input.timezone);
	if (!scheduleId) throw new Error("schedule trigger requires scheduleId");
	if (!cron) throw new Error("schedule trigger requires cron");
	if (!timezone) throw new Error("schedule trigger requires an explicit IANA timezone");
	const misfirePolicy = input.misfirePolicy ?? "skip";
	const expectedCatchUpRuns = misfirePolicy === "run_once" ? 1 : 0;
	const maxCatchUpRuns = input.maxCatchUpRuns ?? expectedCatchUpRuns;
	if (maxCatchUpRuns !== expectedCatchUpRuns) {
		throw new Error(`schedule trigger ${misfirePolicy} requires maxCatchUpRuns=${expectedCatchUpRuns}`);
	}
	return {
		version: 1,
		kind: "schedule",
		scheduleId,
		cron,
		timezone,
		enabled: input.enabled ?? false,
		misfirePolicy,
		maxCatchUpRuns,
	};
}

export function createWebhookWorkflowTriggerSpec(input: Readonly<{
	webhookId: string;
	secretRef: string;
}>): WebhookWorkflowTriggerSpecV1 {
	const webhookId = nonEmptyString(input.webhookId);
	const secretRef = nonEmptyString(input.secretRef);
	if (!webhookId) throw new Error("webhook trigger requires webhookId");
	if (!secretRef?.startsWith("env://") || secretRef.slice("env://".length).trim().length === 0) {
		throw new Error("webhook trigger secretRef must reference a non-empty env:// binding");
	}
	return { version: 1, kind: "webhook", webhookId, secretRef };
}

export function createEventWorkflowTriggerSpec(input: Readonly<{
	topic: string;
	filter?: Readonly<Record<string, string | number | boolean | null>>;
}>): EventWorkflowTriggerSpecV1 {
	const topic = nonEmptyString(input.topic);
	if (!topic) throw new Error("event trigger requires topic");
	return { version: 1, kind: "event", topic, filter: { ...(input.filter ?? {}) } };
}

export function parseWorkflowTriggerSpec(value: unknown): WorkflowTriggerParseResult {
	const record = asRecord(value);
	if (!record) return failure("workflow trigger spec must be an object");
	if (record.version !== 1) return failure("workflow trigger version must equal 1");
	if (record.kind === "manual") return { success: true, data: createManualWorkflowTriggerSpec() };
	if (record.kind === "schedule") {
		const scheduleId = nonEmptyString(record.scheduleId);
		const cron = nonEmptyString(record.cron);
		const timezone = nonEmptyString(record.timezone);
		if (!scheduleId) return failure("schedule trigger requires scheduleId");
		if (!cron) return failure("schedule trigger requires cron");
		if (!timezone) return failure("schedule trigger requires an explicit IANA timezone");
		if (typeof record.enabled !== "boolean") return failure("schedule trigger requires enabled");
		if (!WORKFLOW_TRIGGER_MISFIRE_POLICIES.includes(record.misfirePolicy as WorkflowTriggerMisfirePolicy)) {
			return failure("schedule trigger has an invalid misfirePolicy");
		}
		const expectedCatchUpRuns = record.misfirePolicy === "run_once" ? 1 : 0;
		if (record.maxCatchUpRuns !== expectedCatchUpRuns) {
			return failure(`schedule trigger ${String(record.misfirePolicy)} requires maxCatchUpRuns=${expectedCatchUpRuns}`);
		}
		return {
			success: true,
			data: {
				version: 1,
				kind: "schedule",
				scheduleId,
				cron,
				timezone,
				enabled: record.enabled,
				misfirePolicy: record.misfirePolicy as WorkflowTriggerMisfirePolicy,
				maxCatchUpRuns: Number(record.maxCatchUpRuns),
			},
		};
	}
	if (record.kind === "webhook") {
		const webhookId = nonEmptyString(record.webhookId);
		const secretRef = nonEmptyString(record.secretRef);
		if (!webhookId || !secretRef) return failure("webhook trigger requires webhookId and secretRef");
		try {
			return { success: true, data: createWebhookWorkflowTriggerSpec({ webhookId, secretRef }) };
		} catch (error: unknown) {
			return failure(error instanceof Error ? error.message : String(error));
		}
	}
	if (record.kind === "event") {
		const topic = nonEmptyString(record.topic);
		const filter = asRecord(record.filter);
		if (!topic || !filter) return failure("event trigger requires topic and filter");
		const normalizedFilter: Record<string, string | number | boolean | null> = {};
		for (const [key, item] of Object.entries(filter)) {
			if (item !== null && typeof item !== "string" && typeof item !== "number" && typeof item !== "boolean") {
				return failure(`event trigger filter ${key} must be scalar`);
			}
			normalizedFilter[key] = item;
		}
		return { success: true, data: { version: 1, kind: "event", topic, filter: normalizedFilter } };
	}
	return failure("workflow trigger kind is unsupported");
}
