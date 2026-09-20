import type { PrismaClient } from "../../types";
import {
	getExecutionForOwner,
	readExecutionFrozenGraphForOwner,
	listSuccessfulWorkflowOutputNodeRunsForExecutionOwner,
	mapExecutionRow,
	mapNodeRunRow,
	type NodeRunRow,
} from "./execution.repo";
import {
	WorkflowExecutionSchema,
	type WorkflowExecutionDto,
} from "./execution.schemas";
import { parseWorkflowNodeOutputV1 } from "./execution.node-runtime";

export type WorkflowExecutionAgentOutput = Readonly<{
	nodeId: string;
	nodeRunId: string;
	ports: Readonly<Record<string, unknown>>;
	artifacts: readonly unknown[];
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Only graph-authored terminal delivery ports are exposed, never intermediate media. */
export function declaredTerminalDeliveryOutputs(graph: unknown): ReadonlyMap<string, Readonly<{
	executorRef: string;
	outputPorts: readonly string[];
}>> {
	if (!isRecord(graph) || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
		throw new Error("Invalid frozen workflow graph for delivery projection");
	}
	const sources = new Set(graph.edges.flatMap((edge: unknown) =>
		isRecord(edge) && typeof edge.source === "string" ? [edge.source] : []));
	const outputs = new Map<string, { executorRef: string; outputPorts: readonly string[] }>();
	for (const node of graph.nodes as unknown[]) {
		if (!isRecord(node) || typeof node.id !== "string" || !isRecord(node.data)) continue;
		const spec = node.data.workflowAtomicSpec;
		if (!isRecord(spec) || spec.category !== "delivery" || sources.has(node.id)) continue;
		if (typeof spec.executorRef !== "string" || !Array.isArray(spec.outputPorts)
			|| !spec.outputPorts.every((port: unknown) => typeof port === "string")) {
			throw new Error(`Invalid terminal delivery contract: ${node.id}`);
		}
		outputs.set(node.id, { executorRef: spec.executorRef, outputPorts: spec.outputPorts });
	}
	return outputs;
}

export function projectWorkflowExecutionAgentOutputs(
	rows: readonly NodeRunRow[],
	declaredOutputs: ReturnType<typeof declaredTerminalDeliveryOutputs> = new Map(),
): WorkflowExecutionAgentOutput[] {
	return rows.flatMap((row) => {
		if (row.status !== "success") return [];
		const declared = declaredOutputs.get(row.node_id);
		if (row.node_type !== "workflow.output/v1" && !declared) return [];
		const mapped = mapNodeRunRow(row);
		const output = parseWorkflowNodeOutputV1(mapped.outputRefs);
		if (!output || output.executorRef !== row.node_type) return [];
		if (declared && (output.executorRef !== declared.executorRef
			|| declared.outputPorts.some((port) => !(port in output.ports)))) {
			throw new Error(`Terminal delivery output does not match frozen contract: ${row.node_id}`);
		}
		return [{
			nodeId: mapped.nodeId,
			nodeRunId: mapped.id,
			ports: declared ? Object.fromEntries(declared.outputPorts.map((port) => [port, output.ports[port]])) : output.ports,
			artifacts: output.artifacts,
		}];
	});
}

export async function readWorkflowExecutionAgentOutputs(
	db: PrismaClient,
	params: Readonly<{ ownerId: string; executionId: string }>,
): Promise<WorkflowExecutionAgentOutput[]> {
	const [rows, graph] = await Promise.all([
		listSuccessfulWorkflowOutputNodeRunsForExecutionOwner(db, params),
		readExecutionFrozenGraphForOwner(db, params),
	]);
	return projectWorkflowExecutionAgentOutputs(rows, declaredTerminalDeliveryOutputs(graph));
}

export type WorkflowExecutionImmediateAgentState = Readonly<{
	execution: WorkflowExecutionDto;
	workflowOutputs: readonly WorkflowExecutionAgentOutput[];
}>;

function isTerminalWorkflowExecution(execution: WorkflowExecutionDto): boolean {
	return execution.status === "success"
		|| execution.status === "failed"
		|| execution.status === "canceled";
}

function waitForImmediateExecutionPoll(delayMs: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, delayMs));
}

/**
 * Refreshes the accepted receipt for a short, bounded window so workflows that
 * finish immediately can return their authored output boundary in the original
 * tool call. Longer workflows remain accepted-async and use family inspection.
 */
export async function readImmediateWorkflowExecutionAgentState(
	db: PrismaClient,
	params: Readonly<{
		ownerId: string;
		fallbackExecution: WorkflowExecutionDto;
		maxWaitMs?: number;
		pollIntervalMs?: number;
	}>,
): Promise<WorkflowExecutionImmediateAgentState> {
	const maxWaitMs = Math.max(0, Math.min(2_000, params.maxWaitMs ?? 600));
	const pollIntervalMs = Math.max(20, Math.min(250, params.pollIntervalMs ?? 50));
	const deadline = Date.now() + maxWaitMs;
	let execution = params.fallbackExecution;
	while (true) {
		const row = await getExecutionForOwner(db, execution.id, params.ownerId);
		if (row) execution = WorkflowExecutionSchema.parse(mapExecutionRow(row));
		if (isTerminalWorkflowExecution(execution) || Date.now() >= deadline) break;
		await waitForImmediateExecutionPoll(Math.min(pollIntervalMs, deadline - Date.now()));
	}
	const workflowOutputs = execution.status === "success"
		? await readWorkflowExecutionAgentOutputs(db, {
			ownerId: params.ownerId,
			executionId: execution.id,
		})
		: [];
	return { execution, workflowOutputs };
}
