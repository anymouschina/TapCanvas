import type {
	WorkflowNodeExecutionResult,
	WorkflowNodeOutputV1,
	WorkflowNodeSnapshot,
} from "./execution.node-runtime";

type WorkflowOutputPortBindingContext = Readonly<{
	node: WorkflowNodeSnapshot;
	flowVersionData?: unknown;
}>;

export type WorkflowOutputPortBinding = Readonly<{
	outputPortId: string;
	itemPortId: string;
}>;

function declaredOutputPortIds(node: WorkflowNodeSnapshot): readonly string[] {
	const rawSpec = node.data.workflowAtomicSpec;
	if (!rawSpec || typeof rawSpec !== "object" || Array.isArray(rawSpec)) return [];
	const outputPorts = (rawSpec as Record<string, unknown>).outputPorts;
	return Array.isArray(outputPorts)
		? outputPorts.filter((port): port is string => typeof port === "string" && port.trim().length > 0)
		: [];
}

function outgoingTopologyPortIds(context: WorkflowOutputPortBindingContext): readonly string[] {
	const flow = context.flowVersionData;
	if (!flow || typeof flow !== "object" || Array.isArray(flow)) return [];
	const edges = (flow as Record<string, unknown>).edges;
	if (!Array.isArray(edges)) return [];
	const portIds = edges.flatMap((value): string[] => {
		if (!value || typeof value !== "object" || Array.isArray(value)) return [];
		const edge = value as Record<string, unknown>;
		if (edge.source !== context.node.id || typeof edge.sourceHandle !== "string") return [];
		const prefix = "out-workflow:";
		if (!edge.sourceHandle.startsWith(prefix)) return [];
		const portId = edge.sourceHandle.slice(prefix.length).trim();
		return portId ? [portId] : [];
	});
	return [...new Set(portIds)];
}

export function canonicalWorkflowOutputPortIds(
	context: WorkflowOutputPortBindingContext,
): readonly string[] {
	return [...new Set([
		...declaredOutputPortIds(context.node),
		...outgoingTopologyPortIds(context),
	])];
}

export function resolveSingleWorkflowOutputPortBinding(input: Readonly<{
	context: WorkflowOutputPortBindingContext;
	observedPortIds: readonly string[];
}>): WorkflowOutputPortBinding | null {
	const observedPortIds = [...new Set(input.observedPortIds)];
	const canonicalPortIds = canonicalWorkflowOutputPortIds(input.context);
	if (observedPortIds.length !== 1 || canonicalPortIds.length !== 1) return null;
	const itemPortId = observedPortIds[0]!;
	const outputPortId = canonicalPortIds[0]!;
	if (itemPortId === outputPortId) return null;
	return { outputPortId, itemPortId };
}

export function bindSingleWorkflowOutputPort(input: Readonly<{
	context: WorkflowOutputPortBindingContext;
	ports: Record<string, unknown>;
}>): Record<string, unknown> {
	const binding = resolveSingleWorkflowOutputPortBinding({
		context: input.context,
		observedPortIds: Object.keys(input.ports),
	});
	if (!binding) return input.ports;
	return { [binding.outputPortId]: input.ports[binding.itemPortId] };
}

function bindOutputRefs(
	context: WorkflowOutputPortBindingContext,
	outputRefs: WorkflowNodeOutputV1,
): WorkflowNodeOutputV1 {
	const ports = bindSingleWorkflowOutputPort({ context, ports: outputRefs.ports });
	return ports === outputRefs.ports ? outputRefs : { ...outputRefs, ports };
}

export function bindWorkflowNodeExecutionResultPorts(
	context: WorkflowOutputPortBindingContext,
	result: WorkflowNodeExecutionResult,
): WorkflowNodeExecutionResult {
	if (!result.outputRefs) return result;
	return { ...result, outputRefs: bindOutputRefs(context, result.outputRefs) };
}
