import type { PrismaClient } from "../../types";

export type WorkflowNodeJobPhase = "execute" | "await_external" | "recover";

export type WorkflowNodeAttemptIdentity = Readonly<{
	nodeRunId: string;
	attempt: number;
}>;

export type WorkflowNodeJob = Readonly<{
	executionId: string;
	nodeId: string;
	nodeRunId: string;
	attempt: number;
	phase?: WorkflowNodeJobPhase;
}>;

function readNonEmptyString(value: unknown, field: string): string {
	if (typeof value !== "string" || !value.trim()) {
		throw new Error(`${field} must be a non-empty string`);
	}
	return value.trim();
}

function readAttempt(value: unknown): number {
	const attempt = Number(value);
	if (!Number.isInteger(attempt) || attempt < 1) {
		throw new Error("attempt must be a positive integer");
	}
	return attempt;
}

export function parseWorkflowNodeAttemptIdentity(
	value: Readonly<Record<string, unknown>>,
): WorkflowNodeAttemptIdentity {
	return {
		nodeRunId: readNonEmptyString(value.nodeRunId, "nodeRunId"),
		attempt: readAttempt(value.attempt),
	};
}

export function parseWorkflowNodeJob(value: unknown): WorkflowNodeJob {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("Workflow node job must be an object");
	}
	const record = value as Record<string, unknown>;
	const phase = record.phase === undefined
		? undefined
		: record.phase === "execute" || record.phase === "await_external" || record.phase === "recover"
			? record.phase
			: null;
	if (phase === null) throw new Error("Workflow node job phase is invalid");
	return {
		executionId: readNonEmptyString(record.executionId, "executionId"),
		nodeId: readNonEmptyString(record.nodeId, "nodeId"),
		...parseWorkflowNodeAttemptIdentity(record),
		...(phase ? { phase } : {}),
	};
}

export function workflowNodeAttemptMatches(
	actual: WorkflowNodeAttemptIdentity,
	expected: WorkflowNodeAttemptIdentity,
): boolean {
	return actual.nodeRunId === expected.nodeRunId && actual.attempt === expected.attempt;
}

export async function createWorkflowNodeJob(
	db: PrismaClient,
	input: Readonly<{
		executionId: string;
		nodeId: string;
		phase?: WorkflowNodeJobPhase;
	}>,
): Promise<WorkflowNodeJob> {
	const nodeRun = await db.workflow_node_runs.findUnique({
		where: {
			execution_id_node_id: {
				execution_id: input.executionId,
				node_id: input.nodeId,
			},
		},
		select: { id: true, attempt: true },
	});
	if (!nodeRun) {
		throw new Error(`Workflow node run ${input.executionId}/${input.nodeId} does not exist`);
	}
	return {
		executionId: input.executionId,
		nodeId: input.nodeId,
		nodeRunId: nodeRun.id,
		attempt: nodeRun.attempt,
		...(input.phase ? { phase: input.phase } : {}),
	};
}
