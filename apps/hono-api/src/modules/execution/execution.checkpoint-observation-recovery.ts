import crypto from "node:crypto";
import type { PrismaClient } from "../../types";
import { insertExecutionEvent, updateNodeRun } from "./execution.repo";
import { parseWorkflowNodeOutputV1 } from "./execution.node-runtime";
import { encodeWorkflowOutput, type StoredWorkflowOutput } from "./execution.output-storage";
import { workflowOutputRootHash } from "./execution.output-checkpoint-packet";
import type { WorkflowOutputCheckpointJson } from "./execution.output-checkpoint-delta";

export type WorkflowCheckpointRecoveryScope = Readonly<{
	executionId: string; nodeId: string; nodeRunId: string; attempt: number;
}>;
type RecoveryEvent = Readonly<{ id: string; seq: number; event_type: string; data: string | null }>;
type AttemptRow = Readonly<{ attempt: number; trigger: string }>;
type RecoveryDisposition = "promote" | "already_committed" | "ancestry_confirmed" | "diagnostic_only";
type RecoveryFact = Readonly<{
	observationId: string; observationSeq: number; sourceAttempt: number;
	candidateRootHash: string | null; matchedSnapshotIndex: number | null;
	disposition: RecoveryDisposition;
}>;
type Observation = Readonly<{
	id: string; seq: number; attempt: number; baseRootHash: string | null;
	outputs: readonly StoredWorkflowOutput[]; hashes: readonly string[];
}>;
type RecoveryPlan = Readonly<{
	baseRootHash: string | null; output: StoredWorkflowOutput | null;
	promote: boolean; resumeOnly: boolean; facts: readonly RecoveryFact[];
}>;

/** A retained receipt conflict releases its physical worker, never the logical task. */
export class WorkflowCheckpointRecoveryConflict extends Error {
	readonly code = "workflow_checkpoint_recovery_conflict";
	constructor(readonly reason: string, readonly details: Readonly<Record<string, unknown>> = {}, cause?: unknown) {
		super(`Workflow checkpoint observation recovery failed: ${reason}`, { cause });
		this.name = "WorkflowCheckpointRecoveryConflict";
	}
}

function record(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
function json(value: unknown): value is WorkflowOutputCheckpointJson {
	return value === null || typeof value === "string" || typeof value === "boolean"
		|| (typeof value === "number" && Number.isFinite(value))
		|| (Array.isArray(value) ? value.every(json) : record(value) && Object.values(value).every(json));
}
function hash(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value); }

/** Only immutable automatic-attempt triggers authorize reading an earlier physical attempt. */
export function workflowCheckpointRecoveryAttempts(currentAttempt: number, rows: readonly AttemptRow[]): readonly number[] {
	if (!Number.isSafeInteger(currentAttempt) || currentAttempt < 1) throw new WorkflowCheckpointRecoveryConflict("invalid_attempt_ancestry");
	const attempts = new Map(rows.map(row => [row.attempt, row.trigger]));
	const allowed: number[] = [];
	let cursor = currentAttempt;
	while (cursor >= 1) {
		const trigger = attempts.get(cursor);
		if (!trigger || !["initial", "recovery_execution", "runtime_recovery", "automatic_retry", "manual_repair"].includes(trigger)) {
			throw new WorkflowCheckpointRecoveryConflict("invalid_attempt_ancestry", { attempt: cursor });
		}
		allowed.push(cursor);
		if (trigger !== "runtime_recovery" && trigger !== "automatic_retry") break;
		if (cursor === 1) throw new WorkflowCheckpointRecoveryConflict("invalid_attempt_ancestry", { attempt: cursor });
		cursor -= 1;
	}
	return allowed;
}

/** Pure structural decision: only exact stored hashes authorize a retained snapshot. */
export function planWorkflowCheckpointObservationRecovery(input: Readonly<{
	scope: WorkflowCheckpointRecoveryScope; currentOutput: StoredWorkflowOutput | null;
	events: readonly RecoveryEvent[]; allowedAttempts: readonly number[];
}>): RecoveryPlan | null {
	const consumed = new Set<number>();
	const observations: Observation[] = [];
	const rows = [...input.events].sort((left, right) => right.seq - left.seq);
	for (const row of rows) {
		if (row.event_type !== "node_checkpoint_observation" && row.event_type !== "node_checkpoint_observation_recovered") continue;
		let data: unknown;
		try { data = row.data === null ? null : JSON.parse(row.data); }
		catch (cause: unknown) { throw new WorkflowCheckpointRecoveryConflict("invalid_observation_json", { observationSeq: row.seq }, cause); }
		if (!record(data)) throw new WorkflowCheckpointRecoveryConflict("invalid_observation_data", { observationSeq: row.seq });
		if (data.nodeRunId !== input.scope.nodeRunId || typeof data.attempt !== "number" || !input.allowedAttempts.includes(data.attempt)) continue;
		if (row.event_type === "node_checkpoint_observation_recovered") {
			const diagnostic = data.disposition === "diagnostic_only";
			if (data.terminalAuthority !== false || !Number.isSafeInteger(data.observationSeq) || Number(data.observationSeq) < 1 || Number(data.observationSeq) >= row.seq
				|| !(diagnostic ? data.candidateRootHash === null : hash(data.candidateRootHash))
				|| typeof data.sourceAttempt !== "number" || !input.allowedAttempts.includes(data.sourceAttempt)
				|| !["promote", "already_committed", "ancestry_confirmed", "diagnostic_only"].includes(String(data.disposition))) {
				throw new WorkflowCheckpointRecoveryConflict("invalid_recovery_marker", { observationSeq: row.seq });
			}
			consumed.add(Number(data.observationSeq));
			continue;
		}
		if (data.terminalAuthority !== false || typeof data.failureReason !== "string" || !data.failureReason.trim()
			|| !(data.baseRootHash === null || hash(data.baseRootHash)) || !Array.isArray(data.snapshots)) {
			throw new WorkflowCheckpointRecoveryConflict("invalid_observation_contract", { observationSeq: row.seq });
		}
		for (const snapshot of data.snapshots) {
			if (!record(snapshot) || snapshot.protocolVersion !== "1" || !json(snapshot)
				|| parseWorkflowNodeOutputV1(snapshot)?.nodeId !== input.scope.nodeId) {
				throw new WorkflowCheckpointRecoveryConflict("invalid_observation_output", { observationSeq: row.seq });
			}
		}
		const outputs = data.snapshots.map(snapshot => encodeWorkflowOutput(snapshot));
		observations.push({ id: row.id, seq: row.seq, attempt: data.attempt, baseRootHash: data.baseRootHash,
			outputs, hashes: outputs.map(workflowOutputRootHash) });
	}
	const pending = observations.filter(row => !consumed.has(row.seq));
	const consumedReceipt = observations.some(row => consumed.has(row.seq) && row.outputs.length > 0);
	const currentRootHash = input.currentOutput === null ? null : workflowOutputRootHash(input.currentOutput);
	if (pending.length === 0) return consumedReceipt ? { baseRootHash: currentRootHash, output: input.currentOutput,
		promote: false, resumeOnly: input.currentOutput !== null, facts: [] } : null;
	const head = observations.find(row => row.outputs.length > 0);
	const roots = new Set<string | null>();
	if (head) {
		roots.add(head.baseRootHash);
		for (const root of head.hashes) roots.add(root);
		for (const older of observations) {
			if (older.seq >= head.seq || older.outputs.length === 0) continue;
			const candidate = older.hashes.at(-1)!;
			if (roots.has(candidate)) {
				roots.add(older.baseRootHash);
				for (const root of older.hashes) roots.add(root);
			} else if (!consumed.has(older.seq)) {
				throw new WorkflowCheckpointRecoveryConflict("observation_ancestry_fork", {
					observationSeq: older.seq, candidateRootHash: candidate, headObservationSeq: head.seq });
			}
		}
		if (!consumed.has(head.seq) && !roots.has(currentRootHash)) {
			throw new WorkflowCheckpointRecoveryConflict("base_root_changed", { observationSeq: head.seq,
				sourceAttempt: head.attempt, baseRootHash: head.baseRootHash, candidateRootHash: head.hashes.at(-1), currentRootHash });
		}
	}
	const promote = head !== undefined && !consumed.has(head.seq) && currentRootHash !== head.hashes.at(-1);
	const facts = pending.map(row => ({ observationId: row.id, observationSeq: row.seq, sourceAttempt: row.attempt,
		candidateRootHash: row.hashes.at(-1) ?? null,
		matchedSnapshotIndex: row.hashes.indexOf(currentRootHash ?? "") < 0 ? null : row.hashes.indexOf(currentRootHash ?? ""),
		disposition: row.outputs.length === 0 ? "diagnostic_only" as const : row.seq !== head?.seq ? "ancestry_confirmed" as const
			: promote ? "promote" as const : "already_committed" as const }));
	return { baseRootHash: currentRootHash, output: promote ? head!.outputs.at(-1)! : input.currentOutput,
		promote, resumeOnly: input.currentOutput !== null && consumedReceipt || pending.some(row => row.outputs.length > 0), facts };
}

/** Read the workflow event ledger; promotion and consumption must complete before any executor runs. */
export async function recoverWorkflowCheckpointObservation(
	db: PrismaClient, scope: WorkflowCheckpointRecoveryScope, currentOutput: StoredWorkflowOutput | null,
): Promise<Readonly<{ output: StoredWorkflowOutput | null; recovered: boolean; resumeOnly: boolean }>> {
	try {
		const events = await db.workflow_execution_events.findMany({
			where: { execution_id: scope.executionId, node_id: scope.nodeId,
				event_type: { in: ["node_checkpoint_observation", "node_checkpoint_observation_recovered"] } },
			orderBy: { seq: "desc" }, select: { id: true, seq: true, event_type: true, data: true },
		});
		if (events.length === 0) return { output: currentOutput, recovered: false, resumeOnly: false };
		const attempts = await db.workflow_node_attempts.findMany({
			where: { execution_id: scope.executionId, node_id: scope.nodeId, node_run_id: scope.nodeRunId, attempt: { lte: scope.attempt } },
			orderBy: { attempt: "desc" }, select: { attempt: true, trigger: true },
		});
		const allowedAttempts = workflowCheckpointRecoveryAttempts(scope.attempt, attempts);
		const plan = planWorkflowCheckpointObservationRecovery({ scope, currentOutput, events, allowedAttempts });
		if (plan === null) return { output: currentOutput, recovered: false, resumeOnly: false };
		if (plan.promote) {
			await updateNodeRun(db, { executionId: scope.executionId, nodeId: scope.nodeId,
				outputCheckpoint: { output: plan.output, nodeRunId: scope.nodeRunId, attempt: scope.attempt, baseRootHash: plan.baseRootHash } });
		}
		// All chain proofs are checked before any write. Each real observation seq
		// gets its own append-only marker, including diagnostics without an output.
		for (const fact of plan.facts) {
			await insertExecutionEvent(db, { id: crypto.randomUUID(), executionId: scope.executionId, nodeId: scope.nodeId,
				eventType: "node_checkpoint_observation_recovered", nowIso: new Date().toISOString(),
				data: { nodeRunId: scope.nodeRunId, attempt: scope.attempt, ...fact, terminalAuthority: false } });
		}
		return { output: plan.output, recovered: plan.facts.some(fact => fact.disposition !== "diagnostic_only"), resumeOnly: plan.resumeOnly };
	} catch (cause: unknown) {
		const error = cause instanceof WorkflowCheckpointRecoveryConflict ? cause
			: new WorkflowCheckpointRecoveryConflict("ledger_unavailable_or_changed", {}, cause);
		console.error(JSON.stringify({ message: "workflow_checkpoint_observation_recovery_conflict", ...scope,
			reason: error.reason, ...error.details, error: error.message,
			cause: cause instanceof Error ? cause.message : String(cause) }));
		throw error;
	}
}
