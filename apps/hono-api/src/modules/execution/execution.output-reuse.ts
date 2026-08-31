import { parseWorkflowPinnedOutputSourceV1 } from "@tapcanvas/workflow-kernel-protocol";
import type { PrismaClient } from "../../types";
import { getPrismaClient } from "../../platform/node/prisma";
import { stripWorkflowAuthoringRuntimeData } from "../flow/flow-authoring-runtime";
import {
	findWorkflowNode,
	parseWorkflowNodeOutputV1,
	resolveWorkflowNodeExecutorRef,
	type WorkflowNodeOutputV1,
} from "./execution.node-runtime";
import {
	applyWorkflowArtifactJsonArrayContract,
	applyWorkflowArtifactJsonObjectContract,
	parseWorkflowAgentJsonArrayContract,
	parseWorkflowAgentJsonObjectContract,
	parseWorkflowAgentOutputEncoding,
	validateWorkflowAgentOutput,
} from "./execution.agent-output-contract";

export type WorkflowReplayRequest = Readonly<{
	sourceExecutionId: string;
	startFromNodeId: string;
	/** Exact dirty frontiers whose prior outputs and descendants are invalid. */
	invalidatedNodeIds?: readonly string[];
	scope?: "ancestors" | "recovery_snapshot";
}>;

export type ResolvedWorkflowOutputReuseV1 = Readonly<{
	version: 1;
	kind: "pin" | "replay";
	sourceExecutionId: string;
	sourceNodeRunId: string;
	outputRefs: WorkflowNodeOutputV1;
}>;

export type ResolvedWorkflowReplayCheckpointV1 = Readonly<{
	version: 1;
	kind: "replay_checkpoint";
	sourceExecutionId: string;
	sourceNodeRunId: string;
	outputRefs: WorkflowNodeOutputV1;
}>;

type SourceNodeRun = Readonly<{
	id: string;
	nodeId: string;
	status: string;
	outputRefs: unknown;
}>;

type SourceExecutionBundle = Readonly<{
	flowData: Record<string, unknown>;
	nodeRuns: readonly SourceNodeRun[];
}>;

export type WorkflowOutputReuseRepository = Readonly<{
	loadExecutionBundle: (
		executionId: string,
		ownerId: string,
		flowId: string,
	) => Promise<SourceExecutionBundle | null>;
}>;

type GraphNode = Readonly<{
	id: string;
	type?: unknown;
	data: Record<string, unknown>;
}>;

type GraphEdge = Readonly<{
	source: string;
	target: string;
	sourceHandle: string;
	targetHandle: string;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Resolved reuse and replay-checkpoint fields are execution receipts, not
 * authoring input. Every physical execution must resolve them again from its
 * explicitly named source execution so an older ancestor cannot remain pinned
 * merely because its frozen snapshot became the next rerun definition.
 */
function stripResolvedReuseReceipts(
	flowData: Record<string, unknown>,
): Record<string, unknown> {
	if (!Array.isArray(flowData.nodes)) return flowData;
	return {
		...flowData,
		nodes: flowData.nodes.map((rawNode) => {
			if (!isRecord(rawNode) || !isRecord(rawNode.data)) return rawNode;
			const {
				workflowResolvedOutputReuse: _discardedOutputReuseReceipt,
				workflowResolvedReplayCheckpoint: _discardedReplayCheckpointReceipt,
				...definitionData
			} = rawNode.data;
			return { ...rawNode, data: definitionData };
		}),
	};
}

function text(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function parseGraph(raw: unknown): Readonly<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
	let parsed = raw;
	if (typeof raw === "string") parsed = JSON.parse(raw) as unknown;
	if (!isRecord(parsed) || !Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
		throw new Error("Workflow output reuse requires a graph with nodes and edges");
	}
	const nodes = parsed.nodes.map((node, index) => {
		if (!isRecord(node) || !text(node.id) || !isRecord(node.data)) {
			throw new Error(`Workflow output reuse node ${index} is invalid`);
		}
		return { id: text(node.id), type: node.type, data: node.data };
	});
	const nodeIds = new Set(nodes.map((node) => node.id));
	const edges = parsed.edges.flatMap((edge) => {
		if (!isRecord(edge)) return [];
		const source = text(edge.source);
		const target = text(edge.target);
		if (!source || !target || !nodeIds.has(source) || !nodeIds.has(target)) return [];
		return [{
			source,
			target,
			sourceHandle: text(edge.sourceHandle),
			targetHandle: text(edge.targetHandle),
		}];
	});
	return { nodes, edges };
}

function canonicalValue(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonicalValue);
	if (!isRecord(value)) return value;
	return Object.fromEntries(Object.keys(value)
		.filter((key) => value[key] !== undefined)
		.sort()
		.map((key) => [key, canonicalValue(value[key])]));
}

function canonicalNodeData(data: Readonly<Record<string, unknown>>): unknown {
	return canonicalValue(stripWorkflowAuthoringRuntimeData(data));
}

function nodeExecutionSignature(node: GraphNode): string {
	return JSON.stringify({ type: node.type ?? null, data: canonicalNodeData(node.data) });
}

function edgeSignature(edge: GraphEdge): string {
	return JSON.stringify([
		edge.source,
		edge.sourceHandle,
		edge.target,
		edge.targetHandle,
	]);
}

function strictAncestorIds(graph: ReturnType<typeof parseGraph>, startFromNodeId: string): Set<string> {
	const nodeIds = new Set(graph.nodes.map((node) => node.id));
	if (!nodeIds.has(startFromNodeId)) {
		throw new Error(`Replay start node ${startFromNodeId} is outside the frozen workflow graph`);
	}
	const parents = new Map<string, string[]>();
	for (const edge of graph.edges) {
		const current = parents.get(edge.target) ?? [];
		current.push(edge.source);
		parents.set(edge.target, current);
	}
	const ancestors = new Set<string>();
	const queue = [...(parents.get(startFromNodeId) ?? [])];
	while (queue.length > 0) {
		const nodeId = queue.shift();
		if (!nodeId || ancestors.has(nodeId)) continue;
		ancestors.add(nodeId);
		queue.push(...(parents.get(nodeId) ?? []));
	}
	return ancestors;
}

function assertReplayUpstreamUnchanged(
	current: ReturnType<typeof parseGraph>,
	source: ReturnType<typeof parseGraph>,
	startFromNodeId: string,
	ancestorIds: ReadonlySet<string>,
): void {
	const sourceNodes = new Map(source.nodes.map((node) => [node.id, node] as const));
	for (const currentNode of current.nodes.filter((node) => ancestorIds.has(node.id))) {
		const sourceNode = sourceNodes.get(currentNode.id);
		if (!sourceNode || nodeExecutionSignature(sourceNode) !== nodeExecutionSignature(currentNode)) {
			throw new Error(`Cannot replay from ${startFromNodeId}: upstream node ${currentNode.id} changed since the source execution`);
		}
	}
	const boundaryIds = new Set([...ancestorIds, startFromNodeId]);
	const relevantEdges = (graph: ReturnType<typeof parseGraph>): string[] => graph.edges
		.filter((edge) => ancestorIds.has(edge.source) && boundaryIds.has(edge.target))
		.map(edgeSignature)
		.sort();
	if (JSON.stringify(relevantEdges(current)) !== JSON.stringify(relevantEdges(source))) {
		throw new Error(`Cannot replay from ${startFromNodeId}: upstream connections changed since the source execution`);
	}
}

function replayBoundaryIsUnchanged(
	current: ReturnType<typeof parseGraph>,
	source: ReturnType<typeof parseGraph>,
	startFromNodeId: string,
): boolean {
	const currentNode = current.nodes.find((node) => node.id === startFromNodeId);
	const sourceNode = source.nodes.find((node) => node.id === startFromNodeId);
	return Boolean(
		currentNode
		&& sourceNode
		&& nodeExecutionSignature(currentNode) === nodeExecutionSignature(sourceNode),
	);
}

function declaredOutputPorts(node: GraphNode): readonly string[] {
	const atomicSpec = isRecord(node.data.workflowAtomicSpec) ? node.data.workflowAtomicSpec : null;
	const value = atomicSpec?.outputPorts ?? node.data.workflowOutputPorts;
	return Array.isArray(value)
		? value.flatMap((port) => typeof port === "string" && port.trim() ? [port.trim()] : [])
		: [];
}

function validateReusableOutput(node: GraphNode, run: SourceNodeRun): WorkflowNodeOutputV1 {
	if (run.status !== "success") {
		throw new Error(`Node run ${run.id} is ${run.status}; only successful durable outputs can be reused`);
	}
	const output = parseWorkflowNodeOutputV1(run.outputRefs);
	if (!output) throw new Error(`Successful node run ${run.id} has no reusable output`);
	if (output.nodeId !== node.id || run.nodeId !== node.id) {
		throw new Error(`Node run ${run.id} does not belong to workflow node ${node.id}`);
	}
	const executorRef = resolveWorkflowNodeExecutorRef(findWorkflowNode({ nodes: [node], edges: [] }, node.id));
	if (!executorRef || output.executorRef !== executorRef) {
		throw new Error(`Node run ${run.id} executor does not match workflow node ${node.id}`);
	}
	const allowedPorts = new Set(declaredOutputPorts(node));
	const undeclaredPort = Object.keys(output.ports).find((port) => !allowedPorts.has(port));
	if (undeclaredPort) {
		throw new Error(`Node run ${run.id} produced undeclared output port ${undeclaredPort}`);
	}
	return output;
}

function reusableAgentOutputContractFailure(
	node: GraphNode,
	output: WorkflowNodeOutputV1,
): string | null {
	if (resolveWorkflowNodeExecutorRef(findWorkflowNode({ nodes: [node], edges: [] }, node.id)) !== "agents.logical-task/v2") {
		return null;
	}
	const outputEncoding = parseWorkflowAgentOutputEncoding(node.data.workflowAgentOutputEncoding);
	const artifactType = text(node.data.workflowAgentOutputArtifactType);
	if (!outputEncoding || !artifactType) {
		return `Workflow Agent node ${node.id} has no current typed output contract`;
	}
	const outputPort = declaredOutputPorts(node)[0];
	const portValue = outputPort ? output.ports[outputPort] : undefined;
	const jsonArrayContract = outputEncoding === "json_array"
		? applyWorkflowArtifactJsonArrayContract(
			artifactType,
			parseWorkflowAgentJsonArrayContract(node.data.workflowAgentJsonArrayContract),
		)
		: null;
	const jsonObjectContract = outputEncoding === "json_object"
		? applyWorkflowArtifactJsonObjectContract(
			artifactType,
			parseWorkflowAgentJsonObjectContract(node.data.workflowAgentJsonObjectContract),
		)
		: null;
	const validateRawText = (rawText: string, itemIdentity?: string): string | null => {
		const validation = validateWorkflowAgentOutput({
			encoding: outputEncoding,
			artifactType,
			rawText,
			jsonArrayContract,
			jsonObjectContract,
		});
		return validation.ok
			? null
			: `Workflow Agent node ${node.id}${itemIdentity ? ` item ${itemIdentity}` : ""} violated its current ${outputEncoding} output contract: ${validation.errorMessage}`;
	};
	if (output.executionMode === "each") {
		if (!isRecord(portValue) || !Array.isArray(portValue.items)) {
			return `Workflow Agent node ${node.id} has no reusable collection output on port ${outputPort ?? "<missing>"}`;
		}
		for (const [index, rawItem] of portValue.items.entries()) {
			if (!isRecord(rawItem) || !isRecord(rawItem.value)) {
				return `Workflow Agent node ${node.id} collection item ${index} has no reusable value`;
			}
			const rawText = typeof rawItem.value.text === "string" ? rawItem.value.text : "";
			const failure = validateRawText(rawText, text(rawItem.itemId) || String(index));
			if (failure) return failure;
		}
		return null;
	}
	const rawText = isRecord(portValue) && typeof portValue.text === "string"
		? portValue.text
		: typeof portValue === "string"
			? portValue
			: "";
	return validateRawText(rawText);
}

function descendantsIncludingRoots(
	graph: ReturnType<typeof parseGraph>,
	roots: ReadonlySet<string>,
): Set<string> {
	const children = new Map<string, string[]>();
	for (const graphEdge of graph.edges) {
		const current = children.get(graphEdge.source) ?? [];
		current.push(graphEdge.target);
		children.set(graphEdge.source, current);
	}
	const descendants = new Set(roots);
	const queue = [...roots];
	while (queue.length > 0) {
		const nodeId = queue.shift();
		if (!nodeId) continue;
		for (const childId of children.get(nodeId) ?? []) {
			if (descendants.has(childId)) continue;
			descendants.add(childId);
			queue.push(childId);
		}
	}
	return descendants;
}

function replayCheckpointOutput(
	node: GraphNode,
	run: SourceNodeRun,
	provenance: Omit<ResolvedWorkflowReplayCheckpointV1, "version" | "outputRefs">,
): WorkflowNodeOutputV1 | null {
	if (run.status === "success") return null;
	const output = parseWorkflowNodeOutputV1(run.outputRefs);
	if (!output || output.executionMode !== "each") return null;
	if (output.nodeId !== node.id || run.nodeId !== node.id) return null;
	const executorRef = resolveWorkflowNodeExecutorRef(findWorkflowNode({ nodes: [node], edges: [] }, node.id));
	if (!executorRef || output.executorRef !== executorRef) return null;
	const successfulItems = output.itemRuns.filter((itemRun) => itemRun.status === "success");
	// A recovery checkpoint is a receipt set, not a retry authorization. Preserve
	// every settled or accepted item exactly. The collection runtime separately
	// decides whether a failed item is side-effect-free and may be executed again;
	// paid/externally mutating failures remain terminal evidence.
	const checkpointItems = [...output.itemRuns]
		.sort((left, right) => left.index - right.index);
	if (checkpointItems.length === 0) return null;
	const failedItems = checkpointItems.filter((itemRun) => itemRun.status === "failed");
	const waitingItems = checkpointItems.filter((itemRun) => itemRun.status === "waiting_external");
	return {
		...output,
		ports: {},
		artifacts: successfulItems.flatMap((itemRun) => itemRun.artifacts),
		evidence: {
			...output.evidence,
			executorCompleted: false,
			completedItems: successfulItems.length,
			failedItems: failedItems.length,
			settledItems: checkpointItems.length,
			waitingItems: waitingItems.length,
			replayCheckpoint: { version: 1, ...provenance },
		},
		itemRuns: checkpointItems,
	};
}

function recoverySnapshotOutputReuse(input: Readonly<{
	currentGraph: ReturnType<typeof parseGraph>;
	sourceGraph: ReturnType<typeof parseGraph>;
	sourceBundle: SourceExecutionBundle;
	sourceExecutionId: string;
	resolvedByNodeId: Map<string, ResolvedWorkflowOutputReuseV1>;
	replayCheckpointByNodeId: Map<string, ResolvedWorkflowReplayCheckpointV1>;
	explicitInvalidatedNodeIds: readonly string[];
}>): void {
	const currentNodeIds = new Set(input.currentGraph.nodes.map((node) => node.id));
	const sourceNodeIds = new Set(input.sourceGraph.nodes.map((node) => node.id));
	if (currentNodeIds.size !== sourceNodeIds.size
		|| [...currentNodeIds].some((nodeId) => !sourceNodeIds.has(nodeId))) {
		throw new Error("Workflow recovery snapshot topology changed since the source execution");
	}
	const currentEdges = input.currentGraph.edges.map(edgeSignature).sort();
	const sourceEdges = input.sourceGraph.edges.map(edgeSignature).sort();
	if (JSON.stringify(currentEdges) !== JSON.stringify(sourceEdges)) {
		throw new Error("Workflow recovery snapshot connections changed since the source execution");
	}

	const sourceNodes = new Map(input.sourceGraph.nodes.map((node) => [node.id, node] as const));
	const sourceRuns = new Map(input.sourceBundle.nodeRuns.map((run) => [run.nodeId, run] as const));
	const changedOrIncompleteNodeIds = new Set<string>();
	for (const nodeId of input.explicitInvalidatedNodeIds) {
		if (!currentNodeIds.has(nodeId)) {
			throw new Error(`Workflow recovery invalidation node ${nodeId} is outside the frozen workflow graph`);
		}
		changedOrIncompleteNodeIds.add(nodeId);
	}
	const reusableOutputs = new Map<string, Readonly<{ run: SourceNodeRun; output: WorkflowNodeOutputV1 }>>();
	const currentContractFailures = new Map<string, string>();

	for (const node of input.currentGraph.nodes) {
		const sourceNode = sourceNodes.get(node.id);
		const run = sourceRuns.get(node.id);
		if (!sourceNode || nodeExecutionSignature(sourceNode) !== nodeExecutionSignature(node)) {
			changedOrIncompleteNodeIds.add(node.id);
			continue;
		}
		if (!run || run.status !== "success") {
			changedOrIncompleteNodeIds.add(node.id);
			continue;
		}
		const output = validateReusableOutput(node, run);
		reusableOutputs.set(node.id, { run, output });
		const contractFailure = reusableAgentOutputContractFailure(node, output);
		if (contractFailure) {
			currentContractFailures.set(node.id, contractFailure);
			changedOrIncompleteNodeIds.add(node.id);
		}
	}

	const invalidatedNodeIds = descendantsIncludingRoots(input.currentGraph, changedOrIncompleteNodeIds);
	for (const node of input.currentGraph.nodes) {
		if (input.resolvedByNodeId.has(node.id)) continue;
		const run = sourceRuns.get(node.id);
		if (!run) continue;
		const provenance = {
			sourceExecutionId: input.sourceExecutionId,
			sourceNodeRunId: run.id,
		};
		if (!invalidatedNodeIds.has(node.id)) {
			const reusable = reusableOutputs.get(node.id);
			if (!reusable) continue;
			const reuseProvenance = { kind: "replay" as const, ...provenance };
			input.resolvedByNodeId.set(node.id, {
				version: 1,
				...reuseProvenance,
				outputRefs: withReuseEvidence(reusable.output, reuseProvenance),
			});
			continue;
		}

		const checkpointProvenance = { kind: "replay_checkpoint" as const, ...provenance };
		// A previously successful Agent output that no longer satisfies the current
		// contract is not a retry checkpoint and is never rewritten. The replayed
		// execution authors that node again from its frozen inputs with no old
		// candidate or validation error injected into the model context.
		const checkpoint = currentContractFailures.has(node.id)
			? null
			: replayCheckpointOutput(node, run, checkpointProvenance);
		if (checkpoint) {
			input.replayCheckpointByNodeId.set(node.id, {
				version: 1,
				...checkpointProvenance,
				outputRefs: checkpoint,
			});
		}
	}
}

function withReuseEvidence(
	output: WorkflowNodeOutputV1,
	provenance: Omit<ResolvedWorkflowOutputReuseV1, "version" | "outputRefs">,
): WorkflowNodeOutputV1 {
	return {
		...output,
		evidence: {
			...output.evidence,
			outputReuse: { version: 1, ...provenance },
		},
	};
}

export function readResolvedWorkflowOutputReuses(
	flowData: unknown,
): readonly Readonly<{ nodeId: string; reuse: ResolvedWorkflowOutputReuseV1 }>[] {
	const graph = parseGraph(flowData);
	return graph.nodes.flatMap((node) => {
		const value = node.data.workflowResolvedOutputReuse;
		if (value === undefined) return [];
		if (!isRecord(value) || value.version !== 1 || (value.kind !== "pin" && value.kind !== "replay")) {
			throw new Error(`Workflow node ${node.id} has an invalid resolved output reuse contract`);
		}
		const sourceExecutionId = text(value.sourceExecutionId);
		const sourceNodeRunId = text(value.sourceNodeRunId);
		const outputRefs = parseWorkflowNodeOutputV1(value.outputRefs);
		if (!sourceExecutionId || !sourceNodeRunId || !outputRefs || outputRefs.nodeId !== node.id) {
			throw new Error(`Workflow node ${node.id} resolved output reuse is incomplete`);
		}
		return [{
			nodeId: node.id,
			reuse: {
				version: 1,
				kind: value.kind,
				sourceExecutionId,
				sourceNodeRunId,
				outputRefs,
			},
		}];
	});
}

export function readResolvedWorkflowReplayCheckpoints(
	flowData: unknown,
): readonly Readonly<{ nodeId: string; checkpoint: ResolvedWorkflowReplayCheckpointV1 }>[] {
	const graph = parseGraph(flowData);
	return graph.nodes.flatMap((node) => {
		const value = node.data.workflowResolvedReplayCheckpoint;
		if (value === undefined) return [];
		if (!isRecord(value) || value.version !== 1 || value.kind !== "replay_checkpoint") {
			throw new Error(`Workflow node ${node.id} has an invalid resolved replay checkpoint`);
		}
		const sourceExecutionId = text(value.sourceExecutionId);
		const sourceNodeRunId = text(value.sourceNodeRunId);
		const outputRefs = parseWorkflowNodeOutputV1(value.outputRefs);
		if (!sourceExecutionId || !sourceNodeRunId || !outputRefs || outputRefs.nodeId !== node.id) {
			throw new Error(`Workflow node ${node.id} resolved replay checkpoint is incomplete`);
		}
		return [{
			nodeId: node.id,
			checkpoint: {
				version: 1,
				kind: "replay_checkpoint",
				sourceExecutionId,
				sourceNodeRunId,
				outputRefs,
			},
		}];
	});
}

export async function prepareWorkflowOutputReuse(input: Readonly<{
	flowData: Record<string, unknown>;
	flowId: string;
	ownerId: string;
	replay?: WorkflowReplayRequest;
	repository: WorkflowOutputReuseRepository;
}>): Promise<Record<string, unknown>> {
	const cleanFlowData = stripResolvedReuseReceipts(input.flowData);
	const currentGraph = parseGraph(cleanFlowData);
	const bundleCache = new Map<string, SourceExecutionBundle>();
	const loadBundle = async (executionId: string): Promise<SourceExecutionBundle> => {
		const cached = bundleCache.get(executionId);
		if (cached) return cached;
		const loaded = await input.repository.loadExecutionBundle(executionId, input.ownerId, input.flowId);
		if (!loaded) throw new Error(`Output source execution ${executionId} was not found in this workflow`);
		bundleCache.set(executionId, loaded);
		return loaded;
	};
	const resolvedByNodeId = new Map<string, ResolvedWorkflowOutputReuseV1>();
	const replayCheckpointByNodeId = new Map<string, ResolvedWorkflowReplayCheckpointV1>();

	for (const node of currentGraph.nodes) {
		const pin = parseWorkflowPinnedOutputSourceV1(node.data.workflowPinnedOutputSource);
		if (!pin) continue;
		const bundle = await loadBundle(pin.sourceExecutionId);
		const run = bundle.nodeRuns.find((candidate) => candidate.id === pin.sourceNodeRunId);
		if (!run) throw new Error(`Pinned node run ${pin.sourceNodeRunId} was not found in execution ${pin.sourceExecutionId}`);
		const provenance = {
			kind: "pin" as const,
			sourceExecutionId: pin.sourceExecutionId,
			sourceNodeRunId: pin.sourceNodeRunId,
		};
		resolvedByNodeId.set(node.id, {
			version: 1,
			...provenance,
			outputRefs: withReuseEvidence(validateReusableOutput(node, run), provenance),
		});
	}

	if (input.replay) {
		const sourceExecutionId = input.replay.sourceExecutionId.trim();
		const startFromNodeId = input.replay.startFromNodeId.trim();
		if (!sourceExecutionId || !startFromNodeId) throw new Error("Workflow replay requires source execution and start node identities");
		const sourceBundle = await loadBundle(sourceExecutionId);
		const sourceGraph = parseGraph(sourceBundle.flowData);
		if (input.replay.scope === "recovery_snapshot") {
			if (!currentGraph.nodes.some((node) => node.id === startFromNodeId)) {
				throw new Error(`Replay start node ${startFromNodeId} is outside the frozen workflow graph`);
			}
			recoverySnapshotOutputReuse({
				currentGraph,
				sourceGraph,
				sourceBundle,
				sourceExecutionId,
				resolvedByNodeId,
				replayCheckpointByNodeId,
				explicitInvalidatedNodeIds: input.replay.invalidatedNodeIds ?? [],
			});
		} else {
			const ancestors = strictAncestorIds(currentGraph, startFromNodeId);
			assertReplayUpstreamUnchanged(currentGraph, sourceGraph, startFromNodeId, ancestors);
			const ancestorCandidates = currentGraph.nodes.filter((candidate) => ancestors.has(candidate.id));
			const reusableOutputs = new Map<string, Readonly<{ run: SourceNodeRun; output: WorkflowNodeOutputV1 }>>();
			const currentContractFailures = new Map<string, string>();
			const ancestorRuns = new Map<string, SourceNodeRun>();
			for (const node of ancestorCandidates) {
				const run = sourceBundle.nodeRuns.find((candidate) => candidate.nodeId === node.id);
				if (!run) throw new Error(`Source execution ${sourceExecutionId} has no run for upstream node ${node.id}`);
				ancestorRuns.set(node.id, run);
				// A failed/skipped ancestor is a replay frontier, not an invalid request.
				// It and every descendant must run again; only successful ancestors before
				// that frontier are eligible for exact output reuse.  This is essential when
				// a terminal failure marked pending media nodes skipped: resuming the failed
				// verifier must not try to validate those skipped rows as successful output.
				if (run.status !== "success") {
					currentContractFailures.set(
						node.id,
						`Workflow node ${node.id} has no successful durable output in source execution ${sourceExecutionId}`,
					);
					continue;
				}
				const output = validateReusableOutput(node, run);
				reusableOutputs.set(node.id, { run, output });
				const currentContractFailure = reusableAgentOutputContractFailure(node, output);
				if (currentContractFailure) currentContractFailures.set(node.id, currentContractFailure);
			}
			const invalidNodeIds = new Set(currentContractFailures.keys());
			const minimalInvalidNodeIds = new Set([...invalidNodeIds].filter((nodeId) => (
				![...strictAncestorIds(currentGraph, nodeId)].some((ancestorId) => invalidNodeIds.has(ancestorId))
			)));
			const replayInvalidatedNodeIds = descendantsIncludingRoots(currentGraph, minimalInvalidNodeIds);
			for (const node of ancestorCandidates) {
				if (resolvedByNodeId.has(node.id)) continue;
				const reusable = reusableOutputs.get(node.id);
				if (minimalInvalidNodeIds.has(node.id)) {
					const sourceRun = ancestorRuns.get(node.id);
					if (!sourceRun) throw new Error(`Source execution ${sourceExecutionId} has no run for upstream node ${node.id}`);
					const provenance = {
						kind: "replay_checkpoint" as const,
						sourceExecutionId,
						sourceNodeRunId: sourceRun.id,
					};
					const checkpointOutput = reusable
						? null
						: replayCheckpointOutput(node, sourceRun, provenance);
					if (checkpointOutput) {
						replayCheckpointByNodeId.set(node.id, {
							version: 1,
							...provenance,
							outputRefs: checkpointOutput,
						});
					}
					continue;
				}
				if (replayInvalidatedNodeIds.has(node.id)) continue;
				if (!reusable) throw new Error(`Source execution ${sourceExecutionId} has no reusable output for upstream node ${node.id}`);
				const provenance = {
					kind: "replay" as const,
					sourceExecutionId,
					sourceNodeRunId: reusable.run.id,
				};
				resolvedByNodeId.set(node.id, {
					version: 1,
					...provenance,
					outputRefs: withReuseEvidence(reusable.output, provenance),
				});
			}
			if (!resolvedByNodeId.has(startFromNodeId) && replayBoundaryIsUnchanged(currentGraph, sourceGraph, startFromNodeId)) {
				const boundaryNode = currentGraph.nodes.find((node) => node.id === startFromNodeId);
				const boundaryRun = sourceBundle.nodeRuns.find((candidate) => candidate.nodeId === startFromNodeId);
				if (boundaryNode && boundaryRun) {
					const provenance = {
						kind: "replay_checkpoint" as const,
						sourceExecutionId,
						sourceNodeRunId: boundaryRun.id,
					};
					const outputRefs = replayCheckpointOutput(boundaryNode, boundaryRun, provenance);
					if (outputRefs) {
						replayCheckpointByNodeId.set(startFromNodeId, {
							version: 1,
							...provenance,
							outputRefs,
						});
					}
				}
			}
		}
	}

	if (resolvedByNodeId.size === 0 && replayCheckpointByNodeId.size === 0) return cleanFlowData;
	const originalNodes = Array.isArray(cleanFlowData.nodes) ? cleanFlowData.nodes : [];
	return {
		...cleanFlowData,
		nodes: originalNodes.map((rawNode) => {
			if (!isRecord(rawNode)) return rawNode;
			const nodeId = text(rawNode.id);
			const reuse = resolvedByNodeId.get(nodeId);
			const replayCheckpoint = replayCheckpointByNodeId.get(nodeId);
			if (!reuse && !replayCheckpoint) return rawNode;
			const data = isRecord(rawNode.data) ? rawNode.data : {};
			return {
				...rawNode,
				data: {
					...data,
					...(reuse ? { workflowResolvedOutputReuse: reuse } : {}),
					...(replayCheckpoint ? { workflowResolvedReplayCheckpoint: replayCheckpoint } : {}),
				},
			};
		}),
	};
}

export function createWorkflowOutputReuseRepository(
	db: PrismaClient,
): WorkflowOutputReuseRepository {
	void db;
	return {
		loadExecutionBundle: async (executionId, ownerId, flowId) => {
			const prisma = getPrismaClient();
			const execution = await prisma.workflow_executions.findFirst({
				where: { id: executionId, owner_id: ownerId, flow_id: flowId },
				select: { flow_version_id: true },
			});
			if (!execution) return null;
			const [version, rows] = await Promise.all([
				prisma.flow_versions.findUnique({
					where: { id: execution.flow_version_id },
					select: { data: true },
				}),
				prisma.workflow_node_runs.findMany({
					where: { execution_id: executionId },
					select: { id: true, node_id: true, status: true, output_refs: true },
				}),
			]);
			if (!version) return null;
			let flowData: unknown;
			try {
				flowData = typeof version.data === "string" ? JSON.parse(version.data) as unknown : version.data;
			} catch {
				throw new Error(`Output source execution ${executionId} has invalid frozen workflow data`);
			}
			if (!isRecord(flowData)) throw new Error(`Output source execution ${executionId} has invalid frozen workflow data`);
			return {
				flowData,
				nodeRuns: rows.map((row) => ({
					id: row.id,
					nodeId: row.node_id,
					status: row.status,
					outputRefs: row.output_refs,
				})),
			};
		},
	};
}
