type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requireString(record: JsonRecord, field: string): string {
	const value = record[field];
	if (typeof value !== "string" || !value.trim()) {
		throw new Error(`Immutable workflow snapshot is missing ${field}`);
	}
	return value.trim();
}

export type WorkflowExecutionSnapshotRerun = Readonly<{
	data: JsonRecord;
	triggerNodeId: string;
	stopAfterNodeId?: string;
}>;

export type WorkflowDefinitionCutoverAudit = Readonly<{
	fromFlowVersionId: string;
	currentFlowUpdatedAt: string;
	authorizedBy: string;
	requestedAt: string;
}>;

function normalizedString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function nodeMap(nodes: readonly unknown[], label: string): ReadonlyMap<string, JsonRecord> {
	const result = new Map<string, JsonRecord>();
	for (const value of nodes) {
		if (!isRecord(value)) throw new Error(`${label} contains a non-object node`);
		const id = normalizedString(value.id);
		if (!id) throw new Error(`${label} contains a node without an id`);
		if (result.has(id)) throw new Error(`${label} contains duplicate node ${id}`);
		result.set(id, value);
	}
	return result;
}

function edgeSignature(value: unknown): string {
	if (!isRecord(value)) throw new Error("Workflow definition contains a non-object edge");
	const source = normalizedString(value.source);
	const target = normalizedString(value.target);
	if (!source || !target) throw new Error("Workflow definition contains an edge without source or target");
	return JSON.stringify([
		source,
		normalizedString(value.sourceHandle),
		target,
		normalizedString(value.targetHandle),
	]);
}

function stableStructuralValue(value: unknown): string {
	if (Array.isArray(value)) return JSON.stringify(value);
	return typeof value === "string" || typeof value === "boolean" || typeof value === "number"
		? JSON.stringify(value)
		: "";
}

function assertNodeExecutionIdentity(
	nodeId: string,
	frozenNode: JsonRecord,
	currentNode: JsonRecord,
): void {
	for (const field of ["type", "parentId"] as const) {
		if (stableStructuralValue(frozenNode[field]) !== stableStructuralValue(currentNode[field])) {
			throw new Error(`Workflow definition cutover changed ${field} for node ${nodeId}`);
		}
	}
	const frozenData = isRecord(frozenNode.data) ? frozenNode.data : {};
	const currentData = isRecord(currentNode.data) ? currentNode.data : {};
	for (const field of [
		"kind",
		"adminWorkflow",
		"workflowInstanceId",
		"workflowCanvasDefinitionVersion",
		"workflowCanvasDefinitionFingerprint",
	] as const) {
		if (stableStructuralValue(frozenData[field]) !== stableStructuralValue(currentData[field])) {
			throw new Error(`Workflow definition cutover changed ${field} for node ${nodeId}`);
		}
	}
	const frozenSpec = isRecord(frozenData.workflowAtomicSpec) ? frozenData.workflowAtomicSpec : {};
	const currentSpec = isRecord(currentData.workflowAtomicSpec) ? currentData.workflowAtomicSpec : {};
	for (const field of [
		"executorRef",
		"executionMode",
		"inputPorts",
		"outputPorts",
		"inputArtifactTypes",
		"outputArtifactTypes",
		"selectiveOutputPorts",
	] as const) {
		if (stableStructuralValue(frozenSpec[field]) !== stableStructuralValue(currentSpec[field])) {
			throw new Error(`Workflow definition cutover changed workflowAtomicSpec.${field} for node ${nodeId}`);
		}
	}
}

/**
 * Applies an explicitly authorized configuration hotfix to a failed execution.
 *
 * The current definition may change authored node configuration, but it cannot
 * change the executable topology, node identity, executor, execution mode or
 * port contract. Invocation facts and source snapshots stay frozen so a resume
 * cannot silently re-read mutable canvas state or change the user's request.
 */
export function applyWorkflowDefinitionCutover(input: Readonly<{
	frozenSnapshot: unknown;
	currentScopedDefinition: unknown;
	audit: WorkflowDefinitionCutoverAudit;
}>): JsonRecord {
	if (!isRecord(input.frozenSnapshot)
		|| !Array.isArray(input.frozenSnapshot.nodes)
		|| !Array.isArray(input.frozenSnapshot.edges)) {
		throw new Error("Immutable workflow snapshot must contain nodes and edges arrays");
	}
	if (!isRecord(input.currentScopedDefinition)
		|| !Array.isArray(input.currentScopedDefinition.nodes)
		|| !Array.isArray(input.currentScopedDefinition.edges)) {
		throw new Error("Current workflow definition must contain nodes and edges arrays");
	}
	const frozenNodes = nodeMap(input.frozenSnapshot.nodes, "Immutable workflow snapshot");
	const currentNodes = nodeMap(input.currentScopedDefinition.nodes, "Current workflow definition");
	if (frozenNodes.size !== currentNodes.size
		|| [...frozenNodes.keys()].some((nodeId) => !currentNodes.has(nodeId))) {
		throw new Error("Workflow definition cutover cannot change the execution node set");
	}
	for (const [nodeId, frozenNode] of frozenNodes) {
		const currentNode = currentNodes.get(nodeId);
		if (!currentNode) throw new Error(`Current workflow definition is missing node ${nodeId}`);
		assertNodeExecutionIdentity(nodeId, frozenNode, currentNode);
	}
	const frozenEdges = input.frozenSnapshot.edges.map(edgeSignature).sort();
	const currentEdges = input.currentScopedDefinition.edges.map(edgeSignature).sort();
	if (JSON.stringify(frozenEdges) !== JSON.stringify(currentEdges)) {
		throw new Error("Workflow definition cutover cannot change execution edges or handles");
	}

	const frozenTriggerId = isRecord(input.frozenSnapshot.workflowExecutionScope)
		? requireString(input.frozenSnapshot.workflowExecutionScope, "triggerNodeId")
		: "";
	const currentTriggerId = isRecord(input.currentScopedDefinition.workflowExecutionScope)
		? requireString(input.currentScopedDefinition.workflowExecutionScope, "triggerNodeId")
		: "";
	if (frozenTriggerId !== currentTriggerId) {
		throw new Error("Workflow definition cutover cannot change the trigger node");
	}
	const frozenTrigger = frozenNodes.get(frozenTriggerId);
	const frozenTriggerData = frozenTrigger && isRecord(frozenTrigger.data) ? frozenTrigger.data : {};
	const triggerPayload = frozenTriggerData.workflowTriggerPayload;
	const nodes = input.currentScopedDefinition.nodes.map((value) => {
		if (!isRecord(value) || value.id !== frozenTriggerId || triggerPayload === undefined) return value;
		const data = isRecord(value.data) ? value.data : {};
		return { ...value, data: { ...data, workflowTriggerPayload: triggerPayload } };
	});
	const priorAudits = Array.isArray(input.frozenSnapshot.workflowDefinitionCutovers)
		? input.frozenSnapshot.workflowDefinitionCutovers
		: [];
	const next: JsonRecord = {
		...input.currentScopedDefinition,
		nodes,
		workflowDefinitionCutovers: [...priorAudits, {
			version: 1,
			mode: "current_flow",
			...input.audit,
		}],
	};
	for (const field of [
		"workflowExecutionScope",
		"workflowSourceSnapshots",
		"workflowProjectContext",
		"workflowCallerCanvasSnapshot",
		"workflowInitiatingAgentExecution",
		"workflowDeliveryScope",
		"workflowExecutionAncestry",
		"workflowAgentModelCutovers",
	] as const) {
		if (input.frozenSnapshot[field] !== undefined) next[field] = input.frozenSnapshot[field];
	}
	return next;
}

/**
 * Rebuilds executable input from an immutable execution snapshot.
 *
 * `workflowResolvedOutputReuse` and `workflowResolvedReplayCheckpoint` are
 * receipts created for one physical run. They must never leak into a later
 * rerun, otherwise a recovery can be seeded from an older ancestor instead of
 * the immediately preceding durable node output.
 * User-authored durable pins remain part of the frozen workflow definition.
 */
export function prepareWorkflowExecutionSnapshotRerun(
	snapshot: unknown,
): WorkflowExecutionSnapshotRerun {
	if (!isRecord(snapshot) || !Array.isArray(snapshot.nodes) || !Array.isArray(snapshot.edges)) {
		throw new Error("Immutable workflow snapshot must contain nodes and edges arrays");
	}
	if (!isRecord(snapshot.workflowExecutionScope)) {
		throw new Error("Immutable workflow snapshot is missing workflowExecutionScope");
	}
	const triggerNodeId = requireString(snapshot.workflowExecutionScope, "triggerNodeId");
	const stopAfterRaw = snapshot.workflowExecutionScope.stopAfterNodeId;
	if (stopAfterRaw !== undefined && (typeof stopAfterRaw !== "string" || !stopAfterRaw.trim())) {
		throw new Error("Immutable workflow snapshot has an invalid stopAfterNodeId");
	}
	const nodes = snapshot.nodes.map((value) => {
		if (!isRecord(value) || !isRecord(value.data)) return value;
		const {
			workflowResolvedOutputReuse: _discardedOutputReuseReceipt,
			workflowResolvedReplayCheckpoint: _discardedReplayCheckpointReceipt,
			...definitionData
		} = value.data;
		return { ...value, data: definitionData };
	});
	return {
		data: { ...snapshot, nodes },
		triggerNodeId,
		...(typeof stopAfterRaw === "string" && stopAfterRaw.trim()
			? { stopAfterNodeId: stopAfterRaw.trim() }
			: {}),
	};
}
