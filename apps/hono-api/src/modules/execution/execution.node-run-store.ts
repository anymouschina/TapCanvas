import {
	parseWorkflowExecutionSemanticsV2,
	type WorkflowExecutionSemanticsV2,
} from "@tapcanvas/workflow-kernel-protocol";
import type { PrismaClient } from "../../types";
import { getPrismaClient } from "../../platform/node/prisma";
import { readDatabaseErrorCodes } from "../../platform/node/database-read-retry";
import { runDatabaseTransactionWithTransientRetry } from "../../platform/node/database-transaction-retry";
import { readWorkflowExecutionSemanticsSnapshot } from "./execution.semantics-snapshot";
import { Prisma } from "@prisma/client";
import { WorkflowPersistenceError } from "./execution.persistence-error";
import { decodeWorkflowOutput, encodeWorkflowOutput, WORKFLOW_OUTPUT_STORAGE_VERSION } from "./execution.output-storage";
import { persistWorkflowOutput } from "./execution.output-storage-store";
import { readStoredWorkflowOutputStrict, workflowOutputRootHash, type WorkflowOutputCheckpointWrite } from "./execution.output-checkpoint-packet";

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

// A PostgreSQL restart can overlap a media fan-out's result writes. These
// mutations contain only durable workflow ledger state, so replaying the
// whole transaction is safe and preserves idempotent identities. Wait in
// bounded 5s intervals for the database to become ready instead of turning
// one transient infrastructure window into a failed user task.
const WORKFLOW_NODE_PERSISTENCE_RETRY_OPTIONS = {
	maxAttempts: 3,
	baseDelayMs: 5_000,
	onRetry: (diagnostic: Readonly<{
		operation: string;
		attempt: number;
		maxAttempts: number;
		nextDelayMs: number;
		errorCodes: readonly string[];
	}>) => {
		console.warn(JSON.stringify({
			message: "workflow_node_persistence_database_retry",
			...diagnostic,
		}));
	},
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
	toolCalls?: unknown;
	retryCount?: number;
	nodeType?: string | null;
	toolName?: string | null;
	modelKey?: string | null;
	startedAt?: string | null;
	finishedAt?: string | null;
}> & (
	| Readonly<{ outputRefs?: unknown; outputCheckpoint?: never }>
	| Readonly<{ outputRefs?: never; outputCheckpoint: WorkflowOutputCheckpointWrite }>
);

/** A stale local checkpoint cannot acquire database-retry or task-terminal authority. */
export class WorkflowOutputCheckpointStaleError extends Error {
	readonly code = "workflow_output_checkpoint_stale";
	constructor(readonly reason: "attempt_changed" | "base_root_changed", cause?: unknown) {
		super(`Workflow output checkpoint is stale: ${reason}`, { cause });
		this.name = "WorkflowOutputCheckpointStaleError";
	}
}

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
	// The input has already passed JSON serialization. Its finite size is not a
	// provider boundary: a receipt-indexing limit must not discard valid output.
	// An indexed queue is linear (unlike repeated shift); enqueue only containers
	// and avoid spread arguments, so wide arrays cannot exhaust the call stack.
	const values = new Set<string>();
	const queue: object[] = [];
	if (value !== null && typeof value === "object") queue.push(value);
	for (let cursor = 0; cursor < queue.length; cursor += 1) {
		const current = queue[cursor];
		if (!Array.isArray(current)) {
			const candidate = (current as Record<string, unknown>)[field];
			if (typeof candidate === "string" && candidate.trim()) values.add(candidate.trim());
		}
		const children: unknown[] = Array.isArray(current) ? current : Object.values(current);
		for (const child of children) {
			if (child !== null && typeof child === "object") queue.push(child);
		}
	}
	return [...values];
}

function providerReceipts(
	semantics: WorkflowExecutionSemanticsV2,
	outputRefs: unknown,
	existing: string | null,
): string | null {
	const previous = storedStringList(existing);
	const field = semantics.resultLookup.outputField;
	if (!field || outputRefs === null) return previous.length > 0 ? stringifyStoredValue(previous, "Workflow provider receipts") : null;
	const collected = collectDeclaredOutputValues(outputRefs, field);
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
	// The immutable definition may contain large recovered outputs. Parse it
	// once, before taking transaction locks, rather than once per node inside.
	const execution = await prisma.workflow_executions.findUnique({
			where: { id: params.executionId },
			select: {
				execution_family_id: true,
				recovery_of_execution_id: true,
				flow_versions: { select: { data: true } },
			},
		});
	if (!execution) throw new Error(`Workflow execution ${params.executionId} does not exist`);
	const snapshot = readWorkflowExecutionSemanticsSnapshot(execution.flow_versions.data);
	const semanticsByNode = new Map(params.nodeIds.map((nodeId) => {
		const frozen = snapshot.nodes[nodeId];
		if (!frozen) throw new Error(`Workflow node ${nodeId} has no frozen execution semantics`);
		return [nodeId, stringifyStoredValue(frozen.semantics, "Workflow node execution semantics")] as const;
	}));
	await runDatabaseTransactionWithTransientRetry(() => prisma.$transaction(async (transaction) => {
		const attempts: NewWorkflowNodeAttemptRow[] = [];
		for (const nodeId of params.nodeIds) {
			const semantics = semanticsByNode.get(nodeId);
			if (semantics === undefined) throw new Error(`Workflow node ${nodeId} has no frozen execution semantics`);
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
				semantics_snapshot: semantics,
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
	}, WORKFLOW_NODE_TRANSACTION_OPTIONS), {
		operation: "workflow_node_runs.ensure",
		...WORKFLOW_NODE_PERSISTENCE_RETRY_OPTIONS,
	});
}

export async function updateNodeRun(
	db: PrismaClient,
	params: UpdateWorkflowNodeRunInput,
): Promise<void> {
	void db;
	const prisma = getPrismaClient();
	// Serialize before acquiring the row lock. Only changed fields cross the
	// connection; returning/replaying the full collection makes every checkpoint
	// transfer all accumulated inputs and tool history twice.
	let outputStorage: Awaited<ReturnType<typeof persistWorkflowOutput>> | undefined;
	const startedAt = performance.now();
	let phase = "prepare_mutation";
	let phaseStartedAt = startedAt;
	const phaseDurationsMs: Record<string, number> = {};
	let preparationElapsedMs: number | undefined;
	let preparationCompleted = false;
	let preparationSize: Readonly<{
		inputRefsBytes: number;
		toolCallsBytes: number;
		suppliedOutputStringBytes: number | null;
		outputStorageBlockCount: number;
	}> | undefined;
	const enterPhase = (next: string): void => {
		const now = performance.now();
		phaseDurationsMs[phase] = (phaseDurationsMs[phase] ?? 0) + now - phaseStartedAt;
		phase = next;
		phaseStartedAt = now;
	};
	let outcome: "success" | "failed" = "failed";
	let errorCodes: readonly string[] = [];
	try {
		const checkpoint = params.outputCheckpoint;
		if (checkpoint !== undefined && params.outputRefs !== undefined) {
			throw new Error("Workflow node outputRefs and outputCheckpoint are mutually exclusive");
		}
		if (checkpoint !== undefined && (!checkpoint.nodeRunId.trim() || !Number.isSafeInteger(checkpoint.attempt) || checkpoint.attempt < 1)) {
			throw new Error("Workflow output checkpoint requires a node-run identity and positive attempt");
		}
		if (checkpoint !== undefined && checkpoint.output !== null && checkpoint.output.storageVersion !== WORKFLOW_OUTPUT_STORAGE_VERSION) {
			throw new Error("Unsupported workflow output checkpoint storage envelope");
		}
		const mutation = nodeRunMutationData(params);
		enterPhase("prepare_output_decode");
		const semanticOutput = checkpoint !== undefined ? checkpoint.output === null ? undefined : decodeWorkflowOutput(checkpoint.output)
			: params.outputRefs === undefined ? undefined : decodeWorkflowOutput(params.outputRefs);
		enterPhase(checkpoint === undefined ? "prepare_output_encode" : "prepare_output_checkpoint");
		const storedOutput = checkpoint?.output ?? (semanticOutput === undefined ? undefined : encodeWorkflowOutput(semanticOutput));
		enterPhase("prepare_size_diagnostics");
		// Reuse strings already required for persistence. Measuring a semantic
		// output by stringifying it again would recreate the work being observed.
		preparationSize = {
			inputRefsBytes: mutation.input_refs === undefined ? 0 : Buffer.byteLength(mutation.input_refs),
			toolCallsBytes: mutation.tool_calls === undefined ? 0 : Buffer.byteLength(mutation.tool_calls),
			suppliedOutputStringBytes: typeof params.outputRefs === "string" ? Buffer.byteLength(params.outputRefs) : null,
			outputStorageBlockCount: storedOutput === undefined ? 0 : Object.keys(storedOutput.blocks).length,
		};
		const { retry_count: ignoredRetryCount, ...attemptMutation } = mutation;
		void ignoredRetryCount;
		preparationElapsedMs = performance.now() - startedAt;
		preparationCompleted = true;
		await runDatabaseTransactionWithTransientRetry(() => {
			enterPhase("transaction_admission");
			return prisma.$transaction(async (transaction) => {
				if (checkpoint !== undefined) {
					// Prisma can turn an empty mutation into a read. Acquire the row
					// lock before reading its authoritative base, including guard-only
					// writes, so no physical writer can change it before persistence.
					enterPhase("lock_output_checkpoint_base");
					const targets = await transaction.$queryRaw<Readonly<{ id: string; attempt: number; output_refs: string | null }>[]>(Prisma.sql`
						SELECT id, attempt, output_refs FROM workflow_node_runs
						WHERE execution_id = ${params.executionId} AND node_id = ${params.nodeId}
							AND id = ${checkpoint.nodeRunId} AND attempt = ${checkpoint.attempt}
						FOR UPDATE
					`);
					if (targets.length !== 1 || targets[0]!.id !== checkpoint.nodeRunId || targets[0]!.attempt !== checkpoint.attempt) {
						throw new WorkflowOutputCheckpointStaleError("attempt_changed");
					}
					enterPhase("validate_output_checkpoint_base");
					const previousOutput = targets[0]!.output_refs;
					if (checkpoint.baseRootHash === null) {
						// Null fences absence, never permission to replace an existing receipt.
						if (previousOutput !== null) throw new WorkflowOutputCheckpointStaleError("base_root_changed");
					} else if (previousOutput == null || workflowOutputRootHash(readStoredWorkflowOutputStrict(previousOutput)) !== checkpoint.baseRootHash) {
						throw new WorkflowOutputCheckpointStaleError("base_root_changed");
					}
				}
				enterPhase("update_node_run");
				let nodeRun: Readonly<{ id: string; attempt: number }>;
				try {
					nodeRun = await transaction.workflow_node_runs.update({
						where: {
							execution_id_node_id: { execution_id: params.executionId, node_id: params.nodeId },
							...(checkpoint === undefined ? {} : { id: checkpoint.nodeRunId, attempt: checkpoint.attempt }),
						},
						data: mutation,
						select: { id: true, attempt: true },
					});
				} catch (error: unknown) {
					if (checkpoint !== undefined && readDatabaseErrorCodes(error).includes("P2025")) {
						throw new WorkflowOutputCheckpointStaleError("attempt_changed", error);
					}
					throw error;
				}
				if (checkpoint !== undefined) {
					if (nodeRun.id !== checkpoint.nodeRunId || nodeRun.attempt !== checkpoint.attempt) {
						throw new WorkflowOutputCheckpointStaleError("attempt_changed");
					}
				}
				if (storedOutput !== undefined) {
					enterPhase("persist_output_delta");
					outputStorage = await persistWorkflowOutput(transaction, nodeRun.id, storedOutput);
				}
				enterPhase("read_attempt_contract");
				const attempt = await transaction.workflow_node_attempts.findUnique({
					where: { node_run_id_attempt: { node_run_id: nodeRun.id, attempt: nodeRun.attempt } },
					select: { semantics_snapshot: true, provider_receipts: true },
				});
				if (!attempt) throw new Error(`Workflow node ${params.nodeId} current attempt has no ledger row`);
				enterPhase("collect_provider_receipts");
				const semantics = parseWorkflowExecutionSemanticsV2(parseStoredJson(attempt.semantics_snapshot));
				const receipts = storedOutput !== undefined
					? providerReceipts(semantics, semanticOutput, attempt.provider_receipts)
					: undefined;
				enterPhase("update_attempt");
				// Copy changed fields inside PostgreSQL while the current node row is
				// locked. In particular, never send the multi-MB inputs/output a second
				// time through Prisma just to mirror them into the attempt ledger.
				const assignments = Object.keys(attemptMutation).map((field) =>
					Prisma.sql`${Prisma.raw(`"${field}"`)} = n.${Prisma.raw(`"${field}"`)}`);
				if (storedOutput !== undefined) assignments.push(Prisma.sql`"output_refs" = n."output_refs"`);
				if (receipts !== undefined) assignments.push(Prisma.sql`provider_receipts = ${receipts}`);
				if (assignments.length > 0) {
					const updated = await transaction.$executeRaw(Prisma.sql`
						UPDATE workflow_node_attempts AS a SET ${Prisma.join(assignments)}
						FROM workflow_node_runs AS n
						WHERE n.id = ${nodeRun.id} AND a.node_run_id = n.id AND a.attempt = n.attempt
					`);
					if (updated !== 1) throw new Error(`Workflow node ${params.nodeId} current attempt ledger changed`);
				}
				enterPhase("commit");
			}, WORKFLOW_NODE_TRANSACTION_OPTIONS);
		}, {
			operation: "workflow_node_runs.update",
			...WORKFLOW_NODE_PERSISTENCE_RETRY_OPTIONS,
			onRetry: (diagnostic) => {
				enterPhase("retry_backoff");
				WORKFLOW_NODE_PERSISTENCE_RETRY_OPTIONS.onRetry(diagnostic);
			},
		});
		outcome = "success";
	} catch (error: unknown) {
		errorCodes = readDatabaseErrorCodes(error);
		// Serialization/schema failures retain their existing error meaning;
		// only a started persistence action is a WorkflowPersistenceError.
		if (!preparationCompleted || error instanceof WorkflowOutputCheckpointStaleError) throw error;
		throw new WorkflowPersistenceError(error);
	} finally {
		const elapsedMs = performance.now() - startedAt;
		const lastPhase = phase;
		enterPhase("finished");
		if (outcome === "failed" || elapsedMs >= 1_000 || outputStorage !== undefined) {
			console.warn(JSON.stringify({
				message: "workflow_node_persistence_timing",
				executionId: params.executionId, nodeId: params.nodeId,
				outcome, elapsedMs, lastPhase, phaseDurationsMs, errorCodes,
				preparationElapsedMs: preparationElapsedMs ?? elapsedMs,
				preparationSize,
				outputBytes: outputStorage?.outputBytes ?? 0,
				outputStorage,
			}));
		}
	}
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
	return runDatabaseTransactionWithTransientRetry(() => prisma.$transaction(async (transaction) => {
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
	}, WORKFLOW_NODE_TRANSACTION_OPTIONS), {
		operation: "workflow_node_runs.increment_attempt",
		...WORKFLOW_NODE_PERSISTENCE_RETRY_OPTIONS,
	});
}

export async function updateNodeRuns(
	db: PrismaClient,
	params: Readonly<{
		executionId: string;
		nodeIds: readonly string[];
		// A prepared checkpoint owns one node-run/attempt; aggregate lifecycle
		// updates retain the ordinary output contract and cannot replay that fence.
		update: Omit<UpdateWorkflowNodeRunInput, "executionId" | "nodeId"> & Readonly<{ outputCheckpoint?: never }>;
	}>,
): Promise<void> {
	if (params.update.outputCheckpoint !== undefined) throw new Error("Prepared output checkpoints must target one node-run identity");
	for (const nodeId of params.nodeIds) {
		await updateNodeRun(db, { executionId: params.executionId, nodeId, ...params.update });
	}
}
