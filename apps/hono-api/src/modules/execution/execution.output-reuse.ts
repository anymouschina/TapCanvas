import { resolveWorkflowAuthorRepair, workflowAuthorRepairAttempt, type WorkflowAuthorRepairRequest, type ResolvedWorkflowAuthorRepairV1 } from "./execution.author-repair";
import { resolveWorkflowAuthorRepairTarget, readWorkflowAuthorRepairSelection, type WorkflowAuthorRepairSelection } from "./execution.author-repair-target";
import { resolveWorkflowConsumerReplaySelection, workflowConsumerReplaySelectionAttempt, type WorkflowConsumerReplaySelectionRequest } from "./execution.consumer-replay-selection";
import { workflowAgentRepairSource } from "./execution.agent-repair-handoff";
import { bindWorkflowNestedAgentRepairSources } from "./execution.nested-agent-repair-source";
import { inheritWorkflowRecoveryInvocation, assertWorkflowRecoveryObservationReceipt } from "./execution.recovery-invocation";
import { readWorkflowAgentOutputRepair } from "./execution.agent-output-repair";
import { bindWorkflowAcceptedAuthorRecovery, readWorkflowAcceptedAuthorRecovery } from "./execution.accepted-author-recovery";
import { bindWorkflowAgentInitialRecovery, readWorkflowAgentInitialRecovery } from "./execution.agent-initial-recovery";
import { admitWorkflowAuthorSource } from "./execution.author-source-admission";
import { workflowAuthorDeliveryArtifact } from "./execution.author-repair";
import { readWorkflowMediaRetries } from "./execution.media-retry";
import {
	readWorkflowMediaAdoptions,
	workflowMediaAdoptionCheckpoint,
	workflowMediaAdoptionPipelineCheckpoint,
	type WorkflowMediaAdoption,
} from "./execution.media-adoption";
import { parseWorkflowPinnedOutputSourceV1 } from "@tapcanvas/workflow-kernel-protocol";
import { workflowInputPortFromHandle, workflowOutputPortFromHandle } from "./execution.flow-scope";
import type { PrismaClient } from "../../types";
import { getPrismaClient } from "../../platform/node/prisma";
import { stripWorkflowAuthoringRuntimeData } from "../flow/flow-authoring-runtime";
import {
	findWorkflowNode,
	parseWorkflowNodeOutputV1,
	resolveWorkflowNodeExecutorRef,
	type WorkflowNodeOutputV1,
} from "./execution.node-runtime";
export type WorkflowReplayRequest = Readonly<{
	authorRepair?: WorkflowAuthorRepairRequest;
	consumerReplay?: WorkflowConsumerReplaySelectionRequest;
	/** Explicit consumer replay requires settled source inputs; never resubmit an accepted ancestor. */
	requireSuccessfulAncestors?: true;
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
	/** Actual source execution version, resolved by the owner-authorized repository. */
	flowVersionId?: string;
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
	const { workflowResolvedAuthorRepair: _discardedAuthorRepair, workflowAuthorRepairSelection: _discardedSelection, workflowConsumerReplayAttempt: _discardedConsumerAttempt, workflowAuthorRepairAttempt: _discardedAuthorRepairAttempt, workflowReplayAttempt: _discardedReplayAttempt, ...definition } = flowData;
	if (!Array.isArray(flowData.nodes)) return definition;
	return {
		...definition,
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
	// Publication stamps identify the whole released DAG, not this node's executable
	// contract. A downstream release must not invalidate an unchanged successful ancestor.
	// Keep them on both receipts; compare all actual node definitions and bindings below.
	const {
		workflowCanvasDefinitionVersion: _publicationVersion,
		workflowCanvasDefinitionFingerprint: _publicationFingerprint,
		...executionDefinition
	} = stripWorkflowAuthoringRuntimeData(data);
	return canonicalValue(executionDefinition);
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

function declaredInputPortIds(node: GraphNode | undefined): ReadonlySet<string> | null {
	if (!node) return null;
	const atomicSpec = isRecord(node.data.workflowAtomicSpec) ? node.data.workflowAtomicSpec : null;
	const value = atomicSpec?.inputPorts ?? node.data.workflowInputPorts;
	if (!Array.isArray(value)) return null;
	const ports = value.map((port) => typeof port === "string" ? port.trim() : "");
	if (ports.some((port) => !port) || new Set(ports).size !== ports.length) return null;
	return new Set(ports);
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
	const ancestorEdges = (graph: ReturnType<typeof parseGraph>): string[] => graph.edges
		.filter((edge) => ancestorIds.has(edge.source) && ancestorIds.has(edge.target))
		.map(edgeSignature)
		.sort();
	if (JSON.stringify(ancestorEdges(current)) !== JSON.stringify(ancestorEdges(source))) {
		throw new Error(`Cannot replay from ${startFromNodeId}: upstream connections changed since the source execution`);
	}
	const currentBoundary = current.nodes.find((node) => node.id === startFromNodeId);
	const sourceBoundary = source.nodes.find((node) => node.id === startFromNodeId);
	// A bounded source receipt may stop at its author. The new consumer has no historical
	// boundary edges to compare; its explicit bindings are verified against durable ports below.
	if (!sourceBoundary) {
		if (!currentBoundary) throw new Error(`Replay consumer ${startFromNodeId} is missing`);
		return;
	}
	const currentInputPorts = declaredInputPortIds(currentBoundary);
	const sourceInputPorts = declaredInputPortIds(sourceBoundary);
	const sourceBoundaryEdges = source.edges
		.filter((edge) => edge.target === startFromNodeId)
		.filter((edge) => {
			const portId = workflowInputPortFromHandle(edge.targetHandle);
			// Drop a historical boundary edge only when both frozen definitions
			// explicitly declared its port and the current scoped definition removed it.
			return !portId
				|| !sourceInputPorts
				|| !currentInputPorts
				|| !sourceInputPorts.has(portId)
				|| currentInputPorts.has(portId);
		})
		.map(edgeSignature)
		.sort();
	const currentBoundaryEdges = current.edges
		.filter((edge) => edge.target === startFromNodeId)
		.map(edgeSignature)
		.sort();
	if (JSON.stringify(currentBoundaryEdges) !== JSON.stringify(sourceBoundaryEdges)) {
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

// Persisted artifacts have already passed their delivery boundary and may differ
// from the compact model submission schema. Reuse validates durable identity and
// ports; only explicit consumer rejection or changed execution facts invalidate it.
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
	preserveAgentRepair = false,
): WorkflowNodeOutputV1 | null {
	if (run.status === "success") return null;
	const output = parseWorkflowNodeOutputV1(run.outputRefs);
	if (!output) return null;
	if (output.nodeId !== node.id || run.nodeId !== node.id) return null;
	const executorRef = resolveWorkflowNodeExecutorRef(findWorkflowNode({ nodes: [node], edges: [] }, node.id));
	if (!executorRef || output.executorRef !== executorRef) return null;
	if (output.executionMode === "once") {
		const pipelineState = isRecord(output.evidence.pipelineState) ? output.evidence.pipelineState : null;
		if (executorRef === "workflow.pipeline.run/v1"
			&& pipelineState?.protocolVersion === "workflow.pipeline.state/v1"
			&& isRecord(pipelineState.steps)
			&& Object.values(pipelineState.steps).some((step) => isRecord(step))) {
			return { ...output, ports: {}, evidence: { ...output.evidence, executorCompleted: false,
				replayCheckpoint: { version: 1, ...provenance } } };
		}
		if (!preserveAgentRepair || executorRef !== "agents.logical-task/v2") return null;
		const initialOutput = node.data.workflowAgentOutputEncoding !== "plain_text"
			? bindWorkflowAgentInitialRecovery({ output, sourceExecutionId: provenance.sourceExecutionId,
				sourceNodeRunId: provenance.sourceNodeRunId }) : output;
		const acceptedOutput = node.data.workflowAgentOutputEncoding !== "plain_text"
			? bindWorkflowAcceptedAuthorRecovery({ output: initialOutput, sourceExecutionId: provenance.sourceExecutionId,
				sourceNodeRunId: provenance.sourceNodeRunId }) : output;
		const acceptedRecovery = readWorkflowAcceptedAuthorRecovery(acceptedOutput.evidence);
		const repairSource = node.data.workflowAgentOutputEncoding !== "plain_text"
			? output.evidence.agentRepairSource ?? workflowAgentRepairSource({ evidence: output.evidence,
				sourceExecutionId: provenance.sourceExecutionId, nodeId: node.id }) : null;
		if (!readWorkflowAgentOutputRepair(output.evidence) && !repairSource && !acceptedRecovery && !readWorkflowAgentInitialRecovery(acceptedOutput.evidence)) return null;
		return { ...acceptedOutput, ports: acceptedRecovery ? acceptedOutput.ports : {}, evidence: { ...acceptedOutput.evidence, executorCompleted: false,
			...(repairSource ? { agentRepairSource: repairSource } : {}),
			replayCheckpoint: { version: 1, ...provenance } } };
	}
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
	mediaAdoptions: readonly Pick<WorkflowMediaAdoption, "nodeId" | "itemId">[];
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

	}

	const preserveAgentRepair = input.mediaAdoptions.length === 0
		&& input.currentGraph.nodes.every((current) => {
			const source = sourceNodes.get(current.id);
			return source && nodeExecutionSignature(source) === nodeExecutionSignature(current);
		});
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
		const sourceOutput = parseWorkflowNodeOutputV1(run.outputRefs);
		const runtimeNode = findWorkflowNode({ nodes: [node], edges: [] }, node.id);
		const hasNestedAdoption = sourceOutput !== null
			&& workflowMediaAdoptionPipelineCheckpoint({ node: runtimeNode, output: sourceOutput, adoptions: input.mediaAdoptions }) !== sourceOutput;
		const amended = hasNestedAdoption || input.mediaAdoptions.some((item) => item.nodeId === node.id);
		const repairBoundOutput = sourceOutput ? bindWorkflowNestedAgentRepairSources({
			node: findWorkflowNode({ nodes: [node], edges: [] }, node.id), output: sourceOutput,
			sourceExecutionId: input.sourceExecutionId, sourceNodeRunId: run.id, preserveAgentRepair,
		}) : null;
		const checkpointRun = { ...run, ...(repairBoundOutput ? { outputRefs: repairBoundOutput } : {}),
			...(amended ? { status: "failed" } : {}) };
		const rawCheckpoint = replayCheckpointOutput(node, checkpointRun, checkpointProvenance, preserveAgentRepair);
		const checkpoint = rawCheckpoint
			? workflowMediaAdoptionPipelineCheckpoint({
				node: runtimeNode,
				output: workflowMediaAdoptionCheckpoint(rawCheckpoint, input.mediaAdoptions),
				adoptions: input.mediaAdoptions,
			})
			: null;
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
	/** The real independent attempt identity; never synthesized from a source receipt. */
	attemptExecutionId?: string;
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
	let authorRepair: ResolvedWorkflowAuthorRepairV1 | undefined;
	let authorRepairSelection: WorkflowAuthorRepairSelection | undefined;
	let recoveryInvocation: Record<string, unknown> = {};
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
		if (input.replay.authorRepair) {
			if (input.replay.scope === "recovery_snapshot") throw new Error("workflow_author_repair_requires_new_replay");
			const target = currentGraph.nodes.find(node => node.id === startFromNodeId);
			const sourceTarget = sourceGraph.nodes.find(node => node.id === startFromNodeId);
			const repairRequest = input.replay.authorRepair;
			const run = sourceBundle.nodeRuns.find(run => run.id === repairRequest.sourceNodeRunId);
			if (!target || !sourceTarget || !run || !replayBoundaryIsUnchanged(currentGraph, sourceGraph, startFromNodeId)) {
				throw new Error("workflow_author_repair_frozen_contract_changed");
			}
			if (parseWorkflowPinnedOutputSourceV1(target.data.workflowPinnedOutputSource)) throw new Error("workflow_author_repair_target_is_pinned");
			const sourceEvidence = (output: WorkflowNodeOutputV1) => {
				if (output.evidence.authorSource === undefined) return undefined;
				if (!input.attemptExecutionId || !sourceBundle.flowVersionId) throw new Error("workflow_author_source_attempt_or_version_identity_missing");
				const attempt = workflowAuthorRepairAttempt(repairRequest, sourceExecutionId, startFromNodeId);
				const result = admitWorkflowAuthorSource({ output, ownerId: input.ownerId, flowId: input.flowId,
					flowVersionId: sourceBundle.flowVersionId, sourceExecutionId, rootNodeId: startFromNodeId, rootNodeRunId: run.id,
					savedDelivery: workflowAuthorDeliveryArtifact(output), attempt: { executionId: input.attemptExecutionId,
						targetNodeId: output.nodeId, idempotencyKey: attempt.idempotencyKey, requestHash: attempt.requestHash } });
				if (result.status !== "verified") throw new Error(`workflow_author_source_admission_invalid: ${JSON.stringify(result.diagnostic)}`);
				return { source: result.source, sourceEvidenceHash: result.sourceEvidenceHash, attemptBinding: result.attemptBinding };
			};
			if (repairRequest.targetPath) {
				const sourceOutput = parseWorkflowNodeOutputV1(run.outputRefs);
				if (run.nodeId !== startFromNodeId || !sourceOutput) throw new Error("workflow_author_repair_source_run_invalid");
				const nested = resolveWorkflowAuthorRepairTarget(findWorkflowNode(sourceBundle.flowData, startFromNodeId), sourceOutput, repairRequest.targetPath);
				authorRepair = resolveWorkflowAuthorRepair({ request: repairRequest, sourceExecutionId,
					targetNodeId: nested.node.id, nodeData: nested.node.data,
					authorSource: sourceEvidence(nested.output),
					run: { ...run, nodeId: nested.node.id, status: "success", outputRefs: nested.output } });
				authorRepairSelection = { version: 1, mode: "author_revision", deliveryExecutorRef: "agents.logical-task/v2", rootNodeId: startFromNodeId, sourceExecutionId, sourceNodeRunId: run.id,
					targetNodeId: nested.node.id, deliveryHash: authorRepair.deliveryHash, route: nested.route, inputLineage: [...nested.inputLineage] };
				replayCheckpointByNodeId.set(startFromNodeId, { version: 1, kind: "replay_checkpoint",
					sourceExecutionId, sourceNodeRunId: run.id, outputRefs: nested.checkpoint });
			} else {
				authorRepair = resolveWorkflowAuthorRepair({ request: repairRequest, sourceExecutionId,
					targetNodeId: startFromNodeId, nodeData: target.data, run,
					...(parseWorkflowNodeOutputV1(run.outputRefs) ? { authorSource: sourceEvidence(parseWorkflowNodeOutputV1(run.outputRefs)!) } : {}) });
			}
		}
		if (input.replay.consumerReplay) {
			if (input.replay.authorRepair || input.replay.scope === "recovery_snapshot") throw new Error("workflow_consumer_replay_requires_new_attempt");
			const request = input.replay.consumerReplay;
			const target = currentGraph.nodes.find(node => node.id === startFromNodeId);
			if (target && parseWorkflowPinnedOutputSourceV1(target.data.workflowPinnedOutputSource)) throw new Error("workflow_consumer_replay_target_is_pinned");
			const run = sourceBundle.nodeRuns.find(candidate => candidate.id === request.sourceNodeRunId && candidate.nodeId === startFromNodeId);
			const sourceOutput = parseWorkflowNodeOutputV1(run?.outputRefs);
			if (!sourceOutput || !run || !replayBoundaryIsUnchanged(currentGraph, sourceGraph, startFromNodeId)) throw new Error("workflow_consumer_replay_frozen_contract_changed");
			const resolved = resolveWorkflowConsumerReplaySelection({ node: findWorkflowNode(sourceBundle.flowData, startFromNodeId),
				output: sourceOutput, request, sourceExecutionId, flowData: sourceBundle.flowData });
			authorRepairSelection = resolved.selection;
			replayCheckpointByNodeId.set(startFromNodeId, { version: 1, kind: "replay_checkpoint", sourceExecutionId,
				sourceNodeRunId: run.id, outputRefs: resolved.checkpoint });
		}
		if (input.replay.scope === "recovery_snapshot") {
			if (!currentGraph.nodes.some((node) => node.id === startFromNodeId)) {
				throw new Error(`Replay start node ${startFromNodeId} is outside the frozen workflow graph`);
			}
			recoveryInvocation = inheritWorkflowRecoveryInvocation({ source: sourceBundle.flowData, current: cleanFlowData });
			if (Object.keys(recoveryInvocation).length > 0 && !replayBoundaryIsUnchanged(currentGraph, sourceGraph,
				readWorkflowAuthorRepairSelection(recoveryInvocation)?.rootNodeId ?? startFromNodeId)) {
				throw new Error("workflow_recovery_bounded_definition_changed");
			}
			recoverySnapshotOutputReuse({
				currentGraph,
				sourceGraph,
				sourceBundle,
				sourceExecutionId,
				resolvedByNodeId,
				replayCheckpointByNodeId,
				explicitInvalidatedNodeIds: input.replay.invalidatedNodeIds ?? [],
				mediaAdoptions: [
					...(cleanFlowData.workflowMediaAdoptionSourceExecutionId === sourceExecutionId ? readWorkflowMediaAdoptions(cleanFlowData) : []),
					...(cleanFlowData.workflowMediaRetrySourceExecutionId === sourceExecutionId
						? readWorkflowMediaRetries(cleanFlowData).flatMap((retry) => retry.itemId !== null
							? [{ nodeId: retry.nodeId, itemId: retry.itemId }] : []) : []),
				],
			});
			if (Object.keys(recoveryInvocation).length > 0) for (const [nodeId, checkpoint] of replayCheckpointByNodeId) {
				assertWorkflowRecoveryObservationReceipt({ node: findWorkflowNode(cleanFlowData, nodeId),
					output: checkpoint.outputRefs, sourceExecutionId, invocation: recoveryInvocation });
			}
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
			}
			if (authorRepair && currentContractFailures.size > 0) throw new Error("workflow_author_repair_upstream_receipts_incomplete");
			if (input.replay.consumerReplay && currentContractFailures.size > 0) throw new Error("workflow_consumer_replay_upstream_receipts_incomplete");
			if (input.replay.requireSuccessfulAncestors && currentContractFailures.size > 0) throw new Error("workflow_replay_upstream_receipt_not_settled");
			if (!sourceGraph.nodes.some(node => node.id === startFromNodeId)) {
				const boundary = currentGraph.nodes.find(node => node.id === startFromNodeId);
				const inputPorts = declaredInputPortIds(boundary);
				for (const edge of currentGraph.edges.filter(edge => edge.target === startFromNodeId)) {
					const sourcePort = workflowOutputPortFromHandle(edge.sourceHandle);
					const targetPort = workflowInputPortFromHandle(edge.targetHandle);
					const sourceNode = currentGraph.nodes.find(node => node.id === edge.source);
					const durable = reusableOutputs.get(edge.source);
					if (!sourcePort || !targetPort || !inputPorts?.has(targetPort) || !sourceNode
						|| !declaredOutputPorts(sourceNode).includes(sourcePort) || !durable
						|| !Object.prototype.hasOwnProperty.call(durable.output.ports, sourcePort)) {
						throw new Error(`workflow_replay_new_consumer_binding_invalid:${edge.source}:${startFromNodeId}`);
					}
				}
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
			if (!replayCheckpointByNodeId.has(startFromNodeId) && !resolvedByNodeId.has(startFromNodeId) && replayBoundaryIsUnchanged(currentGraph, sourceGraph, startFromNodeId)) {
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

	if (resolvedByNodeId.size === 0 && replayCheckpointByNodeId.size === 0 && !authorRepair && Object.keys(recoveryInvocation).length === 0) return cleanFlowData;
	const originalNodes = Array.isArray(cleanFlowData.nodes) ? cleanFlowData.nodes : [];
	return {
		...cleanFlowData,
		...recoveryInvocation,
		...(authorRepairSelection ? { workflowAuthorRepairSelection: authorRepairSelection } : {}),
		...(input.replay?.consumerReplay ? { workflowConsumerReplayAttempt: workflowConsumerReplaySelectionAttempt(input.replay.consumerReplay, input.replay.sourceExecutionId, input.replay.startFromNodeId) } : {}),
		...(authorRepair && input.replay?.authorRepair ? { workflowResolvedAuthorRepair: authorRepair,
			workflowAuthorRepairAttempt: workflowAuthorRepairAttempt(input.replay.authorRepair, input.replay.sourceExecutionId, input.replay.startFromNodeId) } : {}),
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
				flowVersionId: execution.flow_version_id,
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
