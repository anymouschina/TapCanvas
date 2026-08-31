import type { PrismaClient } from "../../types";
import {
	getExecutionForOwner,
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

export function projectWorkflowExecutionAgentOutputs(
	rows: readonly NodeRunRow[],
): WorkflowExecutionAgentOutput[] {
	return rows.flatMap((row) => {
		if (row.status !== "success" || row.node_type !== "workflow.output/v1") return [];
		const mapped = mapNodeRunRow(row);
		const output = parseWorkflowNodeOutputV1(mapped.outputRefs);
		if (!output || output.executorRef !== "workflow.output/v1") return [];
		return [{
			nodeId: mapped.nodeId,
			nodeRunId: mapped.id,
			ports: output.ports,
			artifacts: output.artifacts,
		}];
	});
}

export async function readWorkflowExecutionAgentOutputs(
	db: PrismaClient,
	params: Readonly<{ ownerId: string; executionId: string }>,
): Promise<WorkflowExecutionAgentOutput[]> {
	const rows = await listSuccessfulWorkflowOutputNodeRunsForExecutionOwner(db, params);
	return projectWorkflowExecutionAgentOutputs(rows);
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
