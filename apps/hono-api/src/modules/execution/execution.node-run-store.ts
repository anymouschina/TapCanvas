import {
	parseWorkflowExecutionSemanticsV2,
	type WorkflowExecutionSemanticsV2,
} from "@tapcanvas/workflow-kernel-protocol";
import type { PrismaClient } from "../../types";
import { getPrismaClient } from "../../platform/node/prisma";
import { readWorkflowNodeExecutionSemantics } from "./execution.semantics-snapshot";

// Workflow media nodes can update their aggregate row while several sibling
// items are persisting external-task receipts in parallel. The Prisma default
// interactive transaction timeout (5s) is too short for that contention and
// can fail an otherwise valid execution after the provider task was accepted.
// Keep the lifecycle ledger mutation atomic, but give it the same bounded
// headroom as the execution-event ledger.
const WORKFLOW_NODE_TRANSACTION_OPTIONS = {
	timeout: 20_000,
	maxWait: 10_000,
} as const;

export type WorkflowNodeAttemptTrigger =
	| "initial"
	| "recovery_execution"
	| "runtime_recovery"
	| "automatic_retry"
	| "manual_repair";

export type UpdateWorkflowNodeRunInput = Readonly<{
	executionId: string;
	nodeId: string;
	status?: string;
	errorMessage?: string | null;
	errorCode?: string | null;
	failureStage?: string | null;
	inputRefs?: unknown;
	outputRefs?: unknown;
	toolCalls?: unknown;
	retryCount?: number;
	nodeType?: string | null;
	toolName?: string | null;
	modelKey?: string | null;
	startedAt?: string | null;
	finishedAt?: string | null;
}>;

type NewWorkflowNodeAttemptRow = Readonly<{
	id: string;
	execution_family_id: string;
	execution_id: string;
	node_run_id: string;
	node_id: string;
	attempt: number;
	trigger: "initial" | "recovery_execution";
	status: string;
	semantics_snapshot: string;
	input_refs: string | null;
	output_refs: string | null;
	tool_calls: string | null;
	error_message: string | null;
	error_code: string | null;
	failure_stage: string | null;
	node_type: string | null;
	tool_name: string | null;
	model_key: string | null;
	created_at: string;
	started_at: string | null;
	finished_at: string | null;
}>;

function stringifyStoredValue(value: unknown, field: string): string {
	try {
		return JSON.stringify(value);
	} catch (error: unknown) {
		throw new Error(`${field} is not JSON serializable: ${error instanceof Error ? error.message : String(error)}`);
	}
}

function parseStoredJson(value: string | null): unknown | null {
	if (value === null) return null;
	try {
		return JSON.parse(value) as unknown;
	} catch (error: unknown) {
		throw new Error(`Persisted workflow attempt JSON is invalid: ${error instanceof Error ? error.message : String(error)}`);
	}
}

function storedStringList(value: string | null): readonly string[] {
	if (value === null) return [];
	const parsed = parseStoredJson(value);
	if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string" || !item.trim())) {
		throw new Error("Persisted workflow provider receipts must be a non-empty string array");
	}
	return parsed.map((item) => item.trim());
}

function collectDeclaredOutputValues(value: unknown, field: string): readonly string[] {
	const values: string[] = [];
	const queue: unknown[] = [value];
	let visited = 0;
	while (queue.length > 0) {
		const current = queue.shift();
		visited += 1;
		if (visited > 20_000) throw new Error("Workflow output exceeds the provider-receipt traversal bound");
		if (Array.isArray(current)) {
			queue.push(...current);
			continue;
		}
		if (!current || typeof current !== "object") continue;
		const record = current as Record<string, unknown>;
		const candidate = record[field];
		if (typeof candidate === "string" && candidate.trim()) values.push(candidate.trim());
		queue.push(...Object.values(record));
	}
	return [...new Set(values)];
}

function providerReceipts(
	semantics: WorkflowExecutionSemanticsV2,
	outputRefs: string | null,
	existing: string | null,
): string | null {
	const previous = storedStringList(existing);
	const field = semantics.resultLookup.outputField;
	if (!field || outputRefs === null) return previous.length > 0 ? stringifyStoredValue(previous, "Workflow provider receipts") : null;
	const collected = collectDeclaredOutputValues(parseStoredJson(outputRefs), field);
	const merged = [...new Set([...previous, ...collected])];
	return merged.length > 0 ? stringifyStoredValue(merged, "Workflow provider receipts") : null;
}

function nodeRunMutationData(params: UpdateWorkflowNodeRunInput) {
	return {
		...(params.status !== undefined ? { status: params.status } : {}),
		...(params.errorMessage !== undefined ? { error_message: params.errorMessage } : {}),
		...(params.errorCode !== undefined ? { error_code: params.errorCode } : {}),
		...(params.failureStage !== undefined ? { failure_stage: params.failureStage } : {}),
		...(params.inputRefs !== undefined ? { input_refs: stringifyStoredValue(params.inputRefs, "Workflow node inputRefs") } : {}),
		...(params.outputRefs !== undefined ? { output_refs: stringifyStoredValue(params.outputRefs, "Workflow node outputRefs") } : {}),
		...(params.toolCalls !== undefined ? { tool_calls: stringifyStoredValue(params.toolCalls, "Workflow node toolCalls") } : {}),
		...(params.retryCount !== undefined ? { retry_count: Math.max(0, Math.trunc(params.retryCount)) } : {}),
		...(params.nodeType !== undefined ? { node_type: params.nodeType } : {}),
		...(params.toolName !== undefined ? { tool_name: params.toolName } : {}),
		...(params.modelKey !== undefined ? { model_key: params.modelKey } : {}),
		...(params.startedAt !== undefined ? { started_at: params.startedAt } : {}),
		...(params.finishedAt !== undefined ? { finished_at: params.finishedAt } : {}),
	};
}

export async function ensureNodeRuns(
	db: PrismaClient,
	params: Readonly<{ executionId: string; nodeIds: string[]; nowIso: string }>,
): Promise<void> {
	void db;
	if (params.nodeIds.length === 0) return;
	if (new Set(params.nodeIds).size !== params.nodeIds.length) throw new Error("Workflow node run identities must be unique");
	const prisma = getPrismaClient();
	await prisma.$transaction(async (transaction) => {
		const execution = await transaction.workflow_executions.findUnique({
			where: { id: params.executionId },
			select: {
				execution_family_id: true,
				recovery_of_execution_id: true,
				flow_versions: { select: { data: true } },
			},
		});
		if (!execution) throw new Error(`Workflow execution ${params.executionId} does not exist`);
		const attempts: NewWorkflowNodeAttemptRow[] = [];
		for (const nodeId of params.nodeIds) {
			const semantics = readWorkflowNodeExecutionSemantics(execution.flow_versions.data, nodeId);
			const nodeRun = await transaction.workflow_node_runs.upsert({
				where: { execution_id_node_id: { execution_id: params.executionId, node_id: nodeId } },
				create: {
					id: crypto.randomUUID(),
					execution_id: params.executionId,
					node_id: nodeId,
					status: "pending",
					attempt: 1,
					created_at: params.nowIso,
				},
				update: {},
			});
			attempts.push({
				id: crypto.randomUUID(),
				execution_family_id: execution.execution_family_id,
				execution_id: params.executionId,
				node_run_id: nodeRun.id,
				node_id: nodeId,
				attempt: nodeRun.attempt,
				trigger: execution.recovery_of_execution_id ? "recovery_execution" : "initial",
				status: nodeRun.status,
				semantics_snapshot: stringifyStoredValue(semantics, "Workflow node execution semantics"),
				input_refs: nodeRun.input_refs,
				output_refs: nodeRun.output_refs,
				tool_calls: nodeRun.tool_calls,
				error_message: nodeRun.error_message,
				error_code: nodeRun.error_code,
				failure_stage: nodeRun.failure_stage,
				node_type: nodeRun.node_type,
				tool_name: nodeRun.tool_name,
				model_key: nodeRun.model_key,
				created_at: nodeRun.created_at,
				started_at: nodeRun.started_at,
				finished_at: nodeRun.finished_at,
			});
		}
		await transaction.workflow_node_attempts.createMany({ data: attempts, skipDuplicates: true });
		const persistedCount = await transaction.workflow_node_attempts.count({
			where: {
				execution_id: params.executionId,
				OR: attempts.map((attempt) => ({ node_run_id: attempt.node_run_id, attempt: attempt.attempt })),
			},
		});
		if (persistedCount !== attempts.length) {
			throw new Error("Workflow node attempt ledger does not cover every current node run");
		}
	}, WORKFLOW_NODE_TRANSACTION_OPTIONS);
}

export async function updateNodeRun(
	db: PrismaClient,
	params: UpdateWorkflowNodeRunInput,
): Promise<void> {
	void db;
	const prisma = getPrismaClient();
	await prisma.$transaction(async (transaction) => {
		const nodeRun = await transaction.workflow_node_runs.update({
			where: { execution_id_node_id: { execution_id: params.executionId, node_id: params.nodeId } },
			data: nodeRunMutationData(params),
		});
		const attempt = await transaction.workflow_node_attempts.findUnique({
			where: { node_run_id_attempt: { node_run_id: nodeRun.id, attempt: nodeRun.attempt } },
		});
		if (!attempt) throw new Error(`Workflow node ${params.nodeId} current attempt has no ledger row`);
		const semantics = parseWorkflowExecutionSemanticsV2(parseStoredJson(attempt.semantics_snapshot));
		await transaction.workflow_node_attempts.update({
			where: { node_run_id_attempt: { node_run_id: nodeRun.id, attempt: nodeRun.attempt } },
			data: {
				status: nodeRun.status,
				input_refs: nodeRun.input_refs,
				output_refs: nodeRun.output_refs,
				tool_calls: nodeRun.tool_calls,
				provider_receipts: providerReceipts(semantics, nodeRun.output_refs, attempt.provider_receipts),
				error_message: nodeRun.error_message,
				error_code: nodeRun.error_code,
				failure_stage: nodeRun.failure_stage,
				node_type: nodeRun.node_type,
				tool_name: nodeRun.tool_name,
				model_key: nodeRun.model_key,
				started_at: nodeRun.started_at,
				finished_at: nodeRun.finished_at,
			},
		});
	}, WORKFLOW_NODE_TRANSACTION_OPTIONS);
}

export async function incrementNodeRunAttempt(
	db: PrismaClient,
	params: Readonly<{
		executionId: string;
		nodeId: string;
		trigger: Extract<WorkflowNodeAttemptTrigger, "runtime_recovery" | "automatic_retry" | "manual_repair">;
		nextStatus: "pending" | "queued";
		previousErrorMessage: string;
		previousErrorCode: string;
		failureStage: string;
		nowIso: string;
	}>,
): Promise<number> {
	void db;
	const prisma = getPrismaClient();
	return prisma.$transaction(async (transaction) => {
		const current = await transaction.workflow_node_runs.findUnique({
			where: { execution_id_node_id: { execution_id: params.executionId, node_id: params.nodeId } },
		});
		if (!current) throw new Error(`Workflow node ${params.nodeId} does not exist`);
		const previousAttempt = await transaction.workflow_node_attempts.findUnique({
			where: { node_run_id_attempt: { node_run_id: current.id, attempt: current.attempt } },
		});
		if (!previousAttempt) throw new Error(`Workflow node ${params.nodeId} current attempt has no ledger row`);
		await transaction.workflow_node_attempts.update({
			where: { node_run_id_attempt: { node_run_id: current.id, attempt: current.attempt } },
			data: {
				status: "failed",
				error_message: params.previousErrorMessage,
				error_code: params.previousErrorCode,
				failure_stage: params.failureStage,
				finished_at: params.nowIso,
			},
		});
		const next = await transaction.workflow_node_runs.update({
			where: { id: current.id },
			data: {
				status: params.nextStatus,
				attempt: { increment: 1 },
				...(params.trigger === "automatic_retry" ? { retry_count: { increment: 1 } } : {}),
				// The failed physical attempt remains immutable in
				// workflow_node_attempts. The aggregate node row represents the
				// current attempt, so it must not expose the previous attempt's
				// diagnosis as the current lifecycle reason.
				error_message: null,
				error_code: null,
				failure_stage: null,
				finished_at: null,
			},
		});
		if (params.trigger === "automatic_retry") {
			await transaction.workflow_executions.update({
				where: { id: params.executionId },
				data: { retry_count: { increment: 1 } },
			});
		}
		await transaction.workflow_node_attempts.create({
			data: {
				id: crypto.randomUUID(),
				execution_family_id: previousAttempt.execution_family_id,
				execution_id: next.execution_id,
				node_run_id: next.id,
				node_id: next.node_id,
				attempt: next.attempt,
				trigger: params.trigger,
				status: next.status,
				semantics_snapshot: previousAttempt.semantics_snapshot,
				input_refs: next.input_refs,
				output_refs: next.output_refs,
				tool_calls: next.tool_calls,
				provider_receipts: previousAttempt.provider_receipts,
				error_message: null,
				error_code: null,
				failure_stage: next.failure_stage,
				node_type: next.node_type,
				tool_name: next.tool_name,
				model_key: next.model_key,
				created_at: params.nowIso,
				started_at: null,
				finished_at: null,
			},
		});
		return next.attempt;
	}, WORKFLOW_NODE_TRANSACTION_OPTIONS);
}

export async function updateNodeRuns(
	db: PrismaClient,
	params: Readonly<{
		executionId: string;
		nodeIds: readonly string[];
		update: Omit<UpdateWorkflowNodeRunInput, "executionId" | "nodeId">;
	}>,
): Promise<void> {
	for (const nodeId of params.nodeIds) {
		await updateNodeRun(db, { executionId: params.executionId, nodeId, ...params.update });
	}
}
