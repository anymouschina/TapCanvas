import {
	findWorkflowNode,
} from "./execution.node-runtime";
import { resolveWorkflowExecutorPortArtifactContract } from "@tapcanvas/workflow-kernel-protocol";
import { resolveCoreWorkflowExecutorPortContract } from "./execution.core-semantics";
import { readWorkflowNodeExecutionSemantics } from "./execution.semantics-snapshot";

export type WorkflowExecutionGraphStatus = "queued" | "running" | "success" | "failed" | "canceled";

export type WorkflowExecutionGraphState = {
	status: WorkflowExecutionGraphStatus;
	concurrency: number;
	running: number;
	seq: number;
	indeg: Record<string, number>;
	adj: Record<string, string[]>;
	routes: Record<string, WorkflowCompiledRoute[]>;
	incoming: Record<string, number>;
	activeIncoming: Record<string, number>;
	selectiveOutputPorts: Record<string, string[]>;
	notSelected: string[];
	ready: string[];
};

export type WorkflowCompiledRoute = Readonly<{
	target: string;
	sourcePort: string | null;
}>;

export type WorkflowNodeRestartPolicy = "replay_safe" | "reconcile_effect" | "fail_explicitly";

export type ReactFlowLike = {
	nodes?: Array<{ id?: unknown; type?: unknown; data?: unknown }>;
	edges?: Array<{ id?: unknown; source?: unknown; target?: unknown; sourceHandle?: unknown; targetHandle?: unknown }>;
};

export type WorkflowNodeRunStatusSnapshot = Readonly<{
	nodeId: string;
	status: string;
	outputRefs?: unknown;
}>;

export type CompiledWorkflowGraph = Readonly<{
	nodeIds: readonly string[];
	indeg: Record<string, number>;
	adj: Record<string, string[]>;
	routes: Record<string, WorkflowCompiledRoute[]>;
	incoming: Record<string, number>;
	selectiveOutputPorts: Record<string, string[]>;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function declaredPorts(node: { data?: unknown }, direction: "input" | "output"): readonly string[] {
	const data = isRecord(node.data) ? node.data : {};
	const spec = isRecord(data.workflowAtomicSpec) ? data.workflowAtomicSpec : null;
	const value = spec?.[direction === "input" ? "inputPorts" : "outputPorts"]
		?? data[direction === "input" ? "workflowInputPorts" : "workflowOutputPorts"];
	return Array.isArray(value)
		? value.flatMap((port) => typeof port === "string" && port.trim() ? [port.trim()] : [])
		: [];
}

function declaredArtifactTypes(
	node: { data?: unknown },
	direction: "input" | "output",
): Readonly<Record<string, readonly string[]>> {
	const data = isRecord(node.data) ? node.data : {};
	const spec = isRecord(data.workflowAtomicSpec) ? data.workflowAtomicSpec : null;
	const field = direction === "input" ? "inputArtifactTypes" : "outputArtifactTypes";
	const value = spec?.[field];
	if (value === undefined) {
		const ports = declaredPorts(node, direction);
		const legacyArtifactType = direction === "output" && typeof data.workflowOutputArtifactType === "string"
			? data.workflowOutputArtifactType.trim()
			: "";
		return ports.length === 1 && legacyArtifactType
			? { [ports[0]]: [legacyArtifactType] }
			: {};
	}
	if (!isRecord(value)) throw new Error(`Workflow graph ${field} must be an object`);
	const declared = new Set(declaredPorts(node, direction));
	return Object.fromEntries(Object.entries(value).map(([port, rawTypes]) => {
		const normalizedPort = port.trim();
		if (!normalizedPort || !declared.has(normalizedPort)) {
			throw new Error(`Workflow graph ${field} declares unknown ${direction} port ${port || "<empty>"}`);
		}
		if (!Array.isArray(rawTypes)) {
			throw new Error(`Workflow graph ${field}.${normalizedPort} must be a non-empty string array`);
		}
		const artifactTypes = [...new Set(rawTypes.flatMap((rawType) => (
			typeof rawType === "string" && rawType.trim() ? [rawType.trim()] : []
		)))];
		if (artifactTypes.length === 0 || artifactTypes.length !== rawTypes.length) {
			throw new Error(`Workflow graph ${field}.${normalizedPort} must contain unique non-empty artifact types`);
		}
		return [normalizedPort, artifactTypes] as const;
	}));
}

function sameArtifactTypes(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((value, index) => value === right[index]);
}

function assertExecutorArtifactPortContract(
	nodeId: string,
	node: { data?: unknown },
	executorReference: string,
): void {
	const expected = resolveWorkflowExecutorPortArtifactContract(executorReference);
	if (!expected) return;
	const declaredInputs = new Set(declaredPorts(node, "input"));
	const declaredOutputs = new Set(declaredPorts(node, "output"));
	const inputArtifactTypes = declaredArtifactTypes(node, "input");
	const outputArtifactTypes = declaredArtifactTypes(node, "output");
	for (const [port, expectedTypes] of Object.entries(expected.inputArtifactTypes)) {
		if (!declaredInputs.has(port)) continue;
		const actualTypes = inputArtifactTypes[port];
		if (!actualTypes || !sameArtifactTypes(actualTypes, expectedTypes)) {
			throw new Error(
				`Workflow graph node ${nodeId} input port ${port} must declare executor artifact contract ${expectedTypes.join(" | ")}`,
			);
		}
	}
	for (const [port, expectedTypes] of Object.entries(expected.outputArtifactTypes)) {
		if (!declaredOutputs.has(port)) {
			throw new Error(`Workflow graph node ${nodeId} omits executor output port ${port}`);
		}
		const actualTypes = outputArtifactTypes[port];
		if (!actualTypes || !sameArtifactTypes(actualTypes, expectedTypes)) {
			throw new Error(
				`Workflow graph node ${nodeId} output port ${port} must declare executor artifact contract ${expectedTypes.join(" | ")}`,
			);
		}
	}
}

function optionalInputPorts(node: { data?: unknown }): readonly string[] {
	const data = isRecord(node.data) ? node.data : {};
	const spec = isRecord(data.workflowAtomicSpec) ? data.workflowAtomicSpec : null;
	const value = spec?.optionalInputPorts ?? data.workflowOptionalInputPorts;
	return Array.isArray(value)
		? value.flatMap((port) => typeof port === "string" && port.trim() ? [port.trim()] : [])
		: [];
}

function selectiveOutputPorts(node: { data?: unknown }): readonly string[] {
	const data = isRecord(node.data) ? node.data : {};
	const spec = isRecord(data.workflowAtomicSpec) ? data.workflowAtomicSpec : null;
	const value = spec?.selectiveOutputPorts ?? data.workflowSelectiveOutputPorts;
	return Array.isArray(value)
		? value.flatMap((port) => typeof port === "string" && port.trim() ? [port.trim()] : [])
		: [];
}

function executorRef(node: { data?: unknown }): string | null {
	const data = isRecord(node.data) ? node.data : {};
	const spec = isRecord(data.workflowAtomicSpec) ? data.workflowAtomicSpec : null;
	const value = spec?.executorRef;
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function portFromHandle(value: unknown, prefix: string): string | null {
	if (typeof value !== "string" || !value.startsWith(prefix)) return null;
	try {
		const port = decodeURIComponent(value.slice(prefix.length)).trim();
		return port || null;
	} catch {
		return null;
	}
}

export function resolveWorkflowNodeRestartPolicy(
	flowData: unknown,
	nodeId: string,
): WorkflowNodeRestartPolicy {
	findWorkflowNode(flowData, nodeId);
	const recoveryMode = readWorkflowNodeExecutionSemantics(flowData, nodeId).recoveryMode;
	if (recoveryMode === "replay") return "replay_safe";
	if (recoveryMode === "reconcile") return "reconcile_effect";
	return "fail_explicitly";
}

export function resolveWorkflowNodeRetryPolicy(
	flowData: unknown,
	nodeId: string,
): Readonly<{ maxAttempts: number; failureStage: string }> {
	findWorkflowNode(flowData, nodeId);
	const semantics = readWorkflowNodeExecutionSemantics(flowData, nodeId);
	return {
		maxAttempts: semantics.maxAutomaticAttempts,
		failureStage: semantics.failureStage,
	};
}

export function compileWorkflowGraph(input: ReactFlowLike): CompiledWorkflowGraph {
	const nodes = Array.isArray(input.nodes) ? input.nodes : [];
	const edges = Array.isArray(input.edges) ? input.edges : [];
	const nodeIds = nodes
		.map((node) => typeof node.id === "string" ? node.id.trim() : "")
		.filter((nodeId) => nodeId.length > 0);
	if (new Set(nodeIds).size !== nodeIds.length) {
		throw new Error("Workflow graph node ids must be unique");
	}
	const nodeIdSet = new Set(nodeIds);
	const nodeById = new Map(nodes.flatMap((node) => {
		const id = typeof node.id === "string" ? node.id.trim() : "";
		return id ? [[id, node] as const] : [];
	}));
	const indeg: Record<string, number> = {};
	const adj: Record<string, string[]> = {};
	const routes: Record<string, WorkflowCompiledRoute[]> = {};
	const incoming: Record<string, number> = {};
	const selectivePortsByNode: Record<string, string[]> = {};
	for (const nodeId of nodeIds) {
		indeg[nodeId] = 0;
		adj[nodeId] = [];
		routes[nodeId] = [];
		incoming[nodeId] = 0;
		const node = nodeById.get(nodeId);
		const declaredSelectivePorts = node ? selectiveOutputPorts(node) : [];
		const declaredOutputs = node ? declaredPorts(node, "output") : [];
		const declaredInputs = node ? declaredPorts(node, "input") : [];
		const portContract = node ? resolveCoreWorkflowExecutorPortContract(executorRef(node) ?? "") : null;
		const missingContractPort = portContract?.requiredInputPorts.find((port) => !declaredInputs.includes(port));
		if (missingContractPort) {
			throw new Error(
				`Workflow graph node ${nodeId} omits executor-required input port ${missingContractPort}`,
			);
		}
		if (node) assertExecutorArtifactPortContract(nodeId, node, executorRef(node) ?? "");
		const invalidSelectivePort = declaredSelectivePorts.find((port) => !declaredOutputs.includes(port));
		if (invalidSelectivePort) {
			throw new Error(`Workflow graph node ${nodeId} declares unknown selective output port ${invalidSelectivePort}`);
		}
		selectivePortsByNode[nodeId] = [...new Set(declaredSelectivePorts)];
	}
	const edgeIdentities = new Set<string>();
	for (let edgeIndex = 0; edgeIndex < edges.length; edgeIndex += 1) {
		const edge = edges[edgeIndex];
		const source = typeof edge.source === "string" ? edge.source.trim() : "";
		const target = typeof edge.target === "string" ? edge.target.trim() : "";
		if (!source || !target) {
			throw new Error(`Workflow graph edge at index ${edgeIndex} requires non-empty source and target node ids`);
		}
		if (!nodeIdSet.has(source) || !nodeIdSet.has(target)) {
			throw new Error(`Workflow graph edge ${source} -> ${target} references a node outside the immutable graph`);
		}
		const sourceNode = nodeById.get(source);
		const targetNode = nodeById.get(target);
		if (!sourceNode || !targetNode) throw new Error(`Workflow graph edge ${source} -> ${target} cannot resolve its nodes`);
		const sourcePorts = declaredPorts(sourceNode, "output");
		const targetPorts = declaredPorts(targetNode, "input");
		let sourcePort: string | null = null;
		let targetPort: string | null = null;
		if (sourcePorts.length > 0 || targetPorts.length > 0) {
			sourcePort = portFromHandle(edge.sourceHandle, "out-workflow:");
			targetPort = portFromHandle(edge.targetHandle, "in-workflow:");
			if (!sourcePort || !targetPort) {
				throw new Error(`Workflow graph edge ${source} -> ${target} requires explicit typed port handles`);
			}
			if (!sourcePorts.includes(sourcePort)) {
				throw new Error(`Workflow graph node ${source} does not declare output port ${sourcePort}`);
			}
			if (!targetPorts.includes(targetPort)) {
				throw new Error(`Workflow graph node ${target} does not declare input port ${targetPort}`);
			}
			const sourceArtifactTypes = declaredArtifactTypes(sourceNode, "output")[sourcePort];
			const targetArtifactTypes = declaredArtifactTypes(targetNode, "input")[targetPort];
			if (targetArtifactTypes) {
				if (!sourceArtifactTypes) {
					throw new Error(
						`Workflow graph edge ${source}.${sourcePort} -> ${target}.${targetPort} does not declare a producer artifact contract`,
					);
				}
				const unsupportedType = sourceArtifactTypes.find((artifactType) => !targetArtifactTypes.includes(artifactType));
				if (unsupportedType) {
					throw new Error(
						`Workflow graph edge ${source}.${sourcePort} -> ${target}.${targetPort} cannot deliver ${unsupportedType}; target accepts ${targetArtifactTypes.join(" | ")}`,
					);
				}
			}
		}
		const edgeIdentity = typeof edge.id === "string" && edge.id.trim()
			? edge.id.trim()
			: `${source}\u0000${target}`;
		if (edgeIdentities.has(edgeIdentity)) {
			throw new Error(`Workflow graph edge identity ${edgeIdentity} must be unique`);
		}
		edgeIdentities.add(edgeIdentity);
		adj[source].push(target);
		routes[source].push({ target, sourcePort });
		indeg[target] = (indeg[target] ?? 0) + 1;
		incoming[target] = (incoming[target] ?? 0) + 1;
	}
	for (const [nodeId, node] of nodeById) {
		for (const inputPort of declaredPorts(node, "input")) {
			if (optionalInputPorts(node).includes(inputPort)) continue;
			const connected = edges.some((edge) => (
				edge.target === nodeId
				&& portFromHandle(edge.targetHandle, "in-workflow:") === inputPort
			));
			if (!connected) throw new Error(`Workflow graph node ${nodeId} has no edge for required input port ${inputPort}`);
		}
	}
	return { nodeIds, indeg, adj, routes, incoming, selectiveOutputPorts: selectivePortsByNode };
}

function outputPortNames(outputRefs: unknown): ReadonlySet<string> {
	if (!isRecord(outputRefs) || !isRecord(outputRefs.ports)) return new Set<string>();
	return new Set(Object.keys(outputRefs.ports));
}

/**
 * Resolves all outgoing edges for one settled node. A branch that receives no active
 * incoming edge becomes `not_selected` and propagates inactive edges until an active
 * path or root is reached. This mutates only the in-memory durable graph state.
 */
export function resolveWorkflowGraphNode(
	graph: WorkflowExecutionGraphState,
	input: Readonly<{ nodeId: string; status: "success" | "not_selected"; outputRefs?: unknown }>,
): Readonly<{ readyNodeIds: readonly string[]; notSelectedNodeIds: readonly string[] }> {
	const readyNodeIds: string[] = [];
	const notSelectedNodeIds: string[] = [];
	const pending = [{
		nodeId: input.nodeId,
		active: input.status === "success",
		ports: outputPortNames(input.outputRefs),
	}];
	while (pending.length > 0) {
		const current = pending.shift();
		if (!current) break;
		const selectivePorts = new Set(graph.selectiveOutputPorts[current.nodeId] ?? []);
		for (const route of graph.routes[current.nodeId] ?? []) {
			const active = current.active && (
				!route.sourcePort
				|| !selectivePorts.has(route.sourcePort)
				|| current.ports.has(route.sourcePort)
			);
			graph.indeg[route.target] = Math.max(0, (graph.indeg[route.target] ?? 0) - 1);
			if (active) graph.activeIncoming[route.target] = (graph.activeIncoming[route.target] ?? 0) + 1;
			if (graph.indeg[route.target] !== 0) continue;
			if ((graph.incoming[route.target] ?? 0) === 0 || (graph.activeIncoming[route.target] ?? 0) > 0) {
				readyNodeIds.push(route.target);
				continue;
			}
			if (graph.notSelected.includes(route.target)) continue;
			graph.notSelected.push(route.target);
			notSelectedNodeIds.push(route.target);
			pending.push({ nodeId: route.target, active: false, ports: new Set<string>() });
		}
	}
	return { readyNodeIds, notSelectedNodeIds };
}

export function workflowGraphHasCycle(
	graph: Pick<CompiledWorkflowGraph, "nodeIds" | "indeg" | "adj">,
): boolean {
	const ready = graph.nodeIds.filter((nodeId) => (graph.indeg[nodeId] ?? 0) === 0);
	const indeg = { ...graph.indeg };
	let visited = 0;
	while (ready.length > 0) {
		const nodeId = ready.shift();
		if (!nodeId) break;
		visited += 1;
		for (const childId of graph.adj[nodeId] ?? []) {
			indeg[childId] = (indeg[childId] ?? 0) - 1;
			if (indeg[childId] === 0) ready.push(childId);
		}
	}
	return visited !== graph.nodeIds.length;
}

export function rebuildWorkflowExecutionGraph(input: Readonly<{
	flowData: ReactFlowLike;
	executionStatus: "running" | "failed";
	concurrency: number;
	latestEventSeq: number;
	nodeRuns: readonly WorkflowNodeRunStatusSnapshot[];
}>): WorkflowExecutionGraphState {
	const compiled = compileWorkflowGraph(input.flowData);
	if (workflowGraphHasCycle(compiled)) {
		throw new Error("Cycle detected in workflow graph");
	}
	const statusByNodeId = new Map(input.nodeRuns.map((run) => [run.nodeId, run.status] as const));
	const indeg = { ...compiled.indeg };
	const graph: WorkflowExecutionGraphState = {
		status: input.executionStatus,
		concurrency: Math.max(1, Math.min(8, Math.floor(input.concurrency || 1))),
		// queued means a dispatch intent already exists; reserve its concurrency slot
		// until the attempt-fenced worker claims or reconciles that exact job.
		running: input.nodeRuns.filter((run) => run.status === "queued" || run.status === "running").length,
		seq: Math.max(0, Math.floor(input.latestEventSeq || 0)),
		indeg,
		adj: compiled.adj,
		routes: compiled.routes,
		incoming: compiled.incoming,
		activeIncoming: Object.fromEntries(compiled.nodeIds.map((nodeId) => [nodeId, 0])),
		selectiveOutputPorts: compiled.selectiveOutputPorts,
		notSelected: input.nodeRuns.filter((run) => run.status === "not_selected").map((run) => run.nodeId),
		ready: [],
	};
	const runByNodeId = new Map(input.nodeRuns.map((run) => [run.nodeId, run] as const));
	const topologicalReady = compiled.nodeIds.filter((nodeId) => (compiled.indeg[nodeId] ?? 0) === 0);
	while (topologicalReady.length > 0) {
		const nodeId = topologicalReady.shift();
		if (!nodeId) break;
		const run = runByNodeId.get(nodeId);
		if (run?.status === "success" || run?.status === "not_selected") {
			resolveWorkflowGraphNode(graph, {
				nodeId,
				status: run.status,
				...(run.outputRefs !== undefined ? { outputRefs: run.outputRefs } : {}),
			});
		}
		for (const childId of compiled.adj[nodeId] ?? []) {
			compiled.indeg[childId] = (compiled.indeg[childId] ?? 0) - 1;
			if (compiled.indeg[childId] === 0) topologicalReady.push(childId);
		}
	}
	const ready = input.executionStatus === "running"
		? compiled.nodeIds.filter((nodeId) => (
			statusByNodeId.get(nodeId) === "pending"
			&& !graph.notSelected.includes(nodeId)
			&& (graph.indeg[nodeId] ?? 0) === 0
			&& ((graph.incoming[nodeId] ?? 0) === 0 || (graph.activeIncoming[nodeId] ?? 0) > 0)
		))
		: [];
	graph.ready = ready;
	return graph;
}
