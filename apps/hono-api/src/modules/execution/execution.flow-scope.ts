import {
	deriveWorkflowPipelinePortArtifactContractV1,
	parseWorkflowPipelineRunSpec,
	WORKFLOW_PIPELINE_RUN_EXECUTOR_REF,
} from "@tapcanvas/workflow-kernel-protocol";

type JsonRecord = Record<string, unknown>;

const NESTED_STEP_MARKER = "::step::";

function isRecord(value: unknown): value is JsonRecord {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseGraph(raw: unknown): JsonRecord {
	const parsed = typeof raw === "string" ? JSON.parse(raw) as unknown : raw;
	if (!isRecord(parsed) || !Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
		throw new Error("Workflow flow data must contain nodes and edges arrays");
	}
	return parsed;
}

function nodeIdentity(value: unknown): string {
	if (!isRecord(value)) return "";
	return typeof value.id === "string" ? value.id.trim() : "";
}

function nodeData(value: unknown): JsonRecord {
	if (!isRecord(value) || !isRecord(value.data)) return {};
	return value.data;
}

function readNestedStepStopId(value: string): Readonly<{ pipelineId: string; stepId: string }> | null {
	const markerIndex = value.indexOf(NESTED_STEP_MARKER);
	if (markerIndex < 0) return null;
	const pipelineId = value.slice(0, markerIndex).trim();
	const stepId = value.slice(markerIndex + NESTED_STEP_MARKER.length).trim();
	if (!pipelineId || !stepId || stepId.includes(NESTED_STEP_MARKER)) {
		throw new Error(`Nested workflow checkpoint ${value} must be <pipelineId>${NESTED_STEP_MARKER}<stepId>`);
	}
	return { pipelineId, stepId };
}

export function workflowInputPortFromHandle(value: unknown): string | null {
	if (typeof value !== "string" || !value.startsWith("in-workflow:")) return null;
	const encoded = value.slice("in-workflow:".length);
	if (!encoded) return null;
	try {
		const portId = decodeURIComponent(encoded).trim();
		return portId || null;
	} catch {
		throw new Error(`Workflow input handle ${value} is not valid URI encoding`);
	}
}

export function workflowOutputPortFromHandle(value: unknown): string | null {
	if (typeof value !== "string" || !value.startsWith("out-workflow:")) return null;
	const encoded = value.slice("out-workflow:".length);
	if (!encoded) return null;
	try {
		const portId = decodeURIComponent(encoded).trim();
		return portId || null;
	} catch {
		throw new Error(`Workflow output handle ${value} is not valid URI encoding`);
	}
}

function scopeNestedPipelineToStep(
	node: unknown,
	stepId: string,
): Readonly<{
	node: unknown;
	removedInputPorts: ReadonlySet<string>;
	retainedOutputPorts: ReadonlySet<string>;
}> {
	if (!isRecord(node) || !isRecord(node.data)) throw new Error("Nested workflow pipeline node is invalid");
	const data = node.data;
	const atomicSpec = isRecord(data.workflowAtomicSpec) ? data.workflowAtomicSpec : null;
	if (atomicSpec?.executorRef !== WORKFLOW_PIPELINE_RUN_EXECUTOR_REF) {
		throw new Error(`Workflow nested stop owner ${nodeIdentity(node)} is not an inline pipeline`);
	}
	if (data.workflowPipeline === undefined) throw new Error(`Workflow pipeline ${nodeIdentity(node)} is missing workflowPipeline`);
	const spec = parseWorkflowPipelineRunSpec(data.workflowPipeline);
	const target = spec.steps.find((step) => step.stepId === stepId);
	if (!target) throw new Error(`Workflow pipeline ${nodeIdentity(node)} has no step ${stepId}`);

	const incoming = new Map<string, Set<string>>();
	for (const binding of spec.bindings) {
		if (binding.from.kind !== "step") continue;
		const parents = incoming.get(binding.to.stepId) ?? new Set<string>();
		parents.add(binding.from.stepId);
		incoming.set(binding.to.stepId, parents);
	}
	const includedStepIds = new Set<string>([stepId]);
	const pending = [stepId];
	while (pending.length > 0) {
		const current = pending.shift();
		if (!current) continue;
		for (const parentId of incoming.get(current) ?? []) {
			if (includedStepIds.has(parentId)) continue;
			includedStepIds.add(parentId);
			pending.push(parentId);
		}
	}
	const steps = spec.steps.filter((step) => includedStepIds.has(step.stepId));
	const bindings = spec.bindings.filter((binding) => includedStepIds.has(binding.to.stepId)
		&& (binding.from.kind === "input" || includedStepIds.has(binding.from.stepId)));
	const usedInputIds = new Set(bindings.flatMap((binding) => binding.from.kind === "input" ? [binding.from.portId] : []));
	const inputs = spec.inputs.filter((input) => usedInputIds.has(input.portId));
	if (inputs.length === 0) {
		throw new Error(`Workflow pipeline ${nodeIdentity(node)} step ${stepId} has no declared external input dependency`);
	}
	const targetAtomicSpec = isRecord(target.node.data.workflowAtomicSpec) ? target.node.data.workflowAtomicSpec : null;
	const targetOutputPorts = Array.isArray(targetAtomicSpec?.outputPorts)
		? targetAtomicSpec.outputPorts.filter((port): port is string => typeof port === "string" && port.trim().length > 0)
		: [];
	if (targetOutputPorts.length === 0) {
		throw new Error(`Workflow pipeline ${nodeIdentity(node)} step ${stepId} has no declared output ports`);
	}
	const outputs = targetOutputPorts.map((portId) => ({
		portId,
		from: { stepId, portId },
		mode: "value" as const,
	}));
	const scopedPipeline = parseWorkflowPipelineRunSpec({
		protocolVersion: spec.protocolVersion,
		inputs,
		steps,
		bindings,
		outputs,
	});
	const portContract = deriveWorkflowPipelinePortArtifactContractV1(scopedPipeline);
	const retainedInputPorts = new Set(scopedPipeline.inputs.map((input) => input.portId));
	const retainedOutputPorts = new Set(scopedPipeline.outputs.map((output) => output.portId));
	const priorOptionalInputs = Array.isArray(atomicSpec.optionalInputPorts)
		? atomicSpec.optionalInputPorts.filter((port): port is string => typeof port === "string")
		: [];
	const priorInputPorts = Array.isArray(atomicSpec.inputPorts)
		? atomicSpec.inputPorts.filter((port): port is string => typeof port === "string")
		: [];
	if (priorInputPorts.length === 0) throw new Error(`Workflow pipeline ${nodeIdentity(node)} has no declared input ports`);
	const optionalInputPorts = priorOptionalInputs.filter((port) => retainedInputPorts.has(port));
	const priorSelectiveOutputPorts = Array.isArray(atomicSpec.selectiveOutputPorts)
		? atomicSpec.selectiveOutputPorts.filter((port): port is string => typeof port === "string")
		: [];
	const nextAtomicSpec: JsonRecord = {
		...atomicSpec,
		inputPorts: scopedPipeline.inputs.map((input) => input.portId),
		...(optionalInputPorts.length > 0 ? { optionalInputPorts } : { optionalInputPorts: [] }),
		outputPorts: scopedPipeline.outputs.map((output) => output.portId),
		...(Object.keys(portContract.inputArtifactTypes).length > 0
			? { inputArtifactTypes: portContract.inputArtifactTypes }
			: { inputArtifactTypes: {} }),
		...(Object.keys(portContract.outputArtifactTypes).length > 0
			? { outputArtifactTypes: portContract.outputArtifactTypes }
			: { outputArtifactTypes: {} }),
		...(priorSelectiveOutputPorts.length > 0
			? { selectiveOutputPorts: priorSelectiveOutputPorts.filter((port) => retainedOutputPorts.has(port)) }
			: {}),
	};
	const outputArtifactTypes = isRecord(atomicSpec.outputArtifactTypes) ? atomicSpec.outputArtifactTypes : {};
	for (const portId of retainedOutputPorts) {
		if (!(portId in portContract.outputArtifactTypes) && portId in outputArtifactTypes) {
			throw new Error(`Workflow pipeline output ${portId} has no output type in its existing binding`);
		}
	}
	return {
		node: {
			...node,
			data: {
				...data,
				workflowPipeline: scopedPipeline,
				workflowAtomicSpec: nextAtomicSpec,
				workflowInputPorts: scopedPipeline.inputs.map((input) => input.portId),
				workflowOptionalInputPorts: optionalInputPorts,
				workflowOutputPorts: scopedPipeline.outputs.map((output) => output.portId),
			},
		},
		removedInputPorts: new Set(priorInputPorts.filter((portId) => !retainedInputPorts.has(portId))),
		retainedOutputPorts,
	};
}

function workflowSourceSnapshots(
	nodes: readonly unknown[],
	eligibleNodeIds: ReadonlySet<string>,
): JsonRecord {
	const groupIds = new Set(nodes.flatMap((node) => {
		if (!eligibleNodeIds.has(nodeIdentity(node))) return [];
		const value = nodeData(node).sourceGroupId;
		return typeof value === "string" && value.trim() ? [value.trim()] : [];
	}));
	return Object.fromEntries([...groupIds].map((groupId) => {
		const group = nodes.find((node) => nodeIdentity(node) === groupId);
		if (!isRecord(group) || group.type !== "groupNode") {
			throw new Error(`Workflow source group ${groupId} does not exist`);
		}
		if (nodeData(group).adminWorkflow === true) {
			throw new Error(`Workflow source group ${groupId} cannot be an administrator workflow group`);
		}
		const children = nodes.filter((node) => isRecord(node) && node.parentId === groupId);
		if (children.length === 0) throw new Error(`Workflow source group ${groupId} has no child nodes`);
		return [groupId, { group, children }];
	}));
}

export function scopeWorkflowFlowData(
	raw: unknown,
	triggerNodeId: string,
	stopAfterNodeId?: string,
	startFromNodeId?: string,
): JsonRecord {
	const graph = parseGraph(raw);
	const normalizedTriggerId = triggerNodeId.trim();
	if (!normalizedTriggerId) throw new Error("triggerNodeId is required");
	const nodes = graph.nodes as unknown[];
	const edges = graph.edges as unknown[];
	const trigger = nodes.find((node) => nodeIdentity(node) === normalizedTriggerId);
	if (!trigger) throw new Error(`Workflow trigger ${normalizedTriggerId} does not exist`);
	const triggerFacts = nodeData(trigger);
	if (triggerFacts.kind !== "workflowTrigger" || triggerFacts.adminWorkflow !== true) {
		throw new Error(`Node ${normalizedTriggerId} is not an administrator workflow trigger`);
	}
	const workflowInstanceId =
		typeof triggerFacts.workflowInstanceId === "string"
			? triggerFacts.workflowInstanceId.trim()
			: "";
	if (!workflowInstanceId) throw new Error("Workflow trigger is missing workflowInstanceId");

	const eligibleNodeIds = new Set(nodes.flatMap((node) => {
		const facts = nodeData(node);
		const id = nodeIdentity(node);
		return id
			&& isRecord(node)
			&& node.type === "taskNode"
			&& facts.adminWorkflow === true
			&& facts.workflowInstanceId === workflowInstanceId
			? [id]
			: [];
	}));
	let eligibleEdges = edges.filter((edge) => {
		if (!isRecord(edge)) return false;
		return typeof edge.source === "string"
			&& typeof edge.target === "string"
			&& eligibleNodeIds.has(edge.source)
			&& eligibleNodeIds.has(edge.target);
	});
	const normalizedStopAfterNodeId = stopAfterNodeId?.trim() ?? "";
	const normalizedStartFromNodeId = startFromNodeId?.trim() ?? "";
	const rootStopNodeId = normalizedStopAfterNodeId && !nodes.some((node) => nodeIdentity(node) === normalizedStopAfterNodeId)
		? readNestedStepStopId(normalizedStopAfterNodeId)?.pipelineId ?? normalizedStopAfterNodeId
		: normalizedStopAfterNodeId;
	const nestedStop = normalizedStopAfterNodeId && rootStopNodeId !== normalizedStopAfterNodeId
		? readNestedStepStopId(normalizedStopAfterNodeId)
		: null;
	let executionNodes = nodes;
	if (nestedStop) {
		const pipelineNode = nodes.find((node) => nodeIdentity(node) === nestedStop.pipelineId);
		if (!pipelineNode || nodeData(pipelineNode).kind !== "workflowStage") {
			throw new Error(`Workflow nested stop owner ${nestedStop.pipelineId} is not an atomic workflow stage`);
		}
		const scopedPipeline = scopeNestedPipelineToStep(pipelineNode, nestedStop.stepId);
		const removedInputPorts = scopedPipeline.removedInputPorts;
		eligibleEdges = eligibleEdges.filter((edge) => {
			if (!isRecord(edge)) return false;
			if (edge.target === nestedStop.pipelineId) {
				const targetPortId = workflowInputPortFromHandle(edge.targetHandle);
				if (!targetPortId && removedInputPorts.size > 0) {
					throw new Error(`Workflow pipeline ${nestedStop.pipelineId} has an incoming edge without a valid target input handle`);
				}
				if (targetPortId && removedInputPorts.has(targetPortId)) return false;
			}
			if (edge.source === nestedStop.pipelineId) {
				const sourcePortId = workflowOutputPortFromHandle(edge.sourceHandle);
				if (!sourcePortId && scopedPipeline.retainedOutputPorts.size > 0) {
					throw new Error(`Workflow pipeline ${nestedStop.pipelineId} has an outgoing edge without a valid source output handle`);
				}
				if (sourcePortId && !scopedPipeline.retainedOutputPorts.has(sourcePortId)) return false;
			}
			return true;
		});
		executionNodes = nodes.map((node) => nodeIdentity(node) === nestedStop.pipelineId ? scopedPipeline.node : node);
	}
	const outgoing = new Map<string, string[]>();
	for (const edge of eligibleEdges) {
		if (!isRecord(edge) || typeof edge.source !== "string" || typeof edge.target !== "string") continue;
		const targets = outgoing.get(edge.source) ?? [];
		targets.push(edge.target);
		outgoing.set(edge.source, targets);
	}
	const reachable = new Set<string>([normalizedTriggerId]);
	const pending = [normalizedTriggerId];
	while (pending.length > 0) {
		const current = pending.shift();
		if (!current) continue;
		for (const target of outgoing.get(current) ?? []) {
			if (reachable.has(target)) continue;
			reachable.add(target);
			pending.push(target);
		}
	}
	if (reachable.size < 2) {
		throw new Error("Workflow trigger has no reachable atomic nodes");
	}
	let executionNodeIds = reachable;
	if (normalizedStopAfterNodeId) {
		if (rootStopNodeId === normalizedTriggerId) {
			throw new Error("stopAfterNodeId must identify an atomic node after the trigger");
		}
		if (!reachable.has(rootStopNodeId)) {
			throw new Error(`Workflow stop node ${normalizedStopAfterNodeId} is not reachable from trigger ${normalizedTriggerId}`);
		}
		const stopNode = nodes.find((node) => nodeIdentity(node) === rootStopNodeId);
		if (nodeData(stopNode).kind !== "workflowStage") {
			throw new Error(`Workflow stop node ${normalizedStopAfterNodeId} is not an atomic workflow stage`);
		}
		const incoming = new Map<string, string[]>();
		for (const edge of eligibleEdges) {
			if (!isRecord(edge) || typeof edge.source !== "string" || typeof edge.target !== "string") continue;
			const sources = incoming.get(edge.target) ?? [];
			sources.push(edge.source);
			incoming.set(edge.target, sources);
		}
		const ancestors = new Set<string>([rootStopNodeId]);
		const ancestorQueue = [rootStopNodeId];
		while (ancestorQueue.length > 0) {
			const current = ancestorQueue.shift();
			if (!current) continue;
			for (const source of incoming.get(current) ?? []) {
				if (!reachable.has(source) || ancestors.has(source)) continue;
				ancestors.add(source);
				ancestorQueue.push(source);
			}
		}
		if (!ancestors.has(normalizedTriggerId)) {
			throw new Error(`Workflow stop node ${normalizedStopAfterNodeId} has no dependency path from trigger ${normalizedTriggerId}`);
		}
		executionNodeIds = ancestors;
	}
	if (nestedStop && (!normalizedStartFromNodeId || !executionNodeIds.has(normalizedStartFromNodeId))) {
		throw new Error(`Nested workflow checkpoint ${normalizedStopAfterNodeId} requires an explicit startFromNodeId at its owner or a retained dependency ancestor`);
	}
	const scopedEligibleNodeIds = new Set([...executionNodeIds].filter((nodeId) => eligibleNodeIds.has(nodeId)));
	const sourceSnapshots = workflowSourceSnapshots(nodes, scopedEligibleNodeIds);
	return {
		...graph,
		nodes: executionNodes.filter((node) => executionNodeIds.has(nodeIdentity(node))),
		edges: eligibleEdges.filter((edge) => (
			isRecord(edge)
			&& typeof edge.source === "string"
			&& typeof edge.target === "string"
			&& executionNodeIds.has(edge.source)
			&& executionNodeIds.has(edge.target)
		)),
		workflowExecutionScope: {
			version: 1,
			triggerNodeId: normalizedTriggerId,
			workflowInstanceId,
			...(typeof triggerFacts.workflowKey === "string" && triggerFacts.workflowKey.trim()
				? { workflowKey: triggerFacts.workflowKey.trim() }
				: {}),
			...(normalizedStopAfterNodeId ? { stopAfterNodeId: normalizedStopAfterNodeId } : {}),
		},
		workflowSourceSnapshots: sourceSnapshots,
	};
}
