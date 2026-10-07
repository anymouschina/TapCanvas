import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../../types";
import { decodeWorkflowOutput, encodeWorkflowOutput, type StoredWorkflowOutput } from "./execution.output-storage";
import { workflowOutputRootHash, type WorkflowOutputCheckpointWrite } from "./execution.output-checkpoint-packet";
const mocks = vi.hoisted(() => ({ update: vi.fn(), insert: vi.fn() }));
vi.mock("./execution.repo", () => ({ updateNodeRun: mocks.update, insertExecutionEvent: mocks.insert }));
import { recoverWorkflowCheckpointObservation, workflowCheckpointRecoveryAttempts,
	WorkflowCheckpointRecoveryConflict } from "./execution.checkpoint-observation-recovery";

const scope = { executionId: "execution-1", nodeId: "node-1", nodeRunId: "node-run-1", attempt: 1 };
function output(status = "waiting", taskId = "already-accepted") {
	return { protocolVersion: "1", executorRef: "tapcanvas.video.generate/v1", nodeId: scope.nodeId,
		executionMode: "once", ports: {}, artifacts: [], itemRuns: [], evidence: { taskId, status } };
}
type Event = { id: string; seq: number; event_type: string; data: string };
function observation(base: StoredWorkflowOutput | null, snapshots: readonly unknown[], attempt = 1): Event {
	return { id: "observation-1", seq: 7, event_type: "node_checkpoint_observation",
		data: JSON.stringify({ nodeRunId: scope.nodeRunId, attempt, baseRootHash: base === null ? null : workflowOutputRootHash(base),
			failureReason: "unacknowledged checkpoint", terminalAuthority: false, snapshots }) };
}
function fixture(current: StoredWorkflowOutput | null, rows: Event[], attempts = [{ attempt: 1, trigger: "initial" }]) {
	let persisted = current;
	const events = vi.fn(async () => [...rows].sort((a, b) => b.seq - a.seq));
	const db = { workflow_execution_events: { findMany: events },
		workflow_node_attempts: { findMany: vi.fn(async () => attempts) } } as unknown as PrismaClient;
	mocks.update.mockImplementation(async (_db: unknown, params: { outputCheckpoint: WorkflowOutputCheckpointWrite }) => {
		const currentHash = persisted === null ? null : workflowOutputRootHash(persisted);
		if (currentHash !== params.outputCheckpoint.baseRootHash) throw new Error("base changed inside transaction");
		persisted = params.outputCheckpoint.output;
	});
	mocks.insert.mockImplementation(async (_db: unknown, params: { id: string; eventType: string; data: unknown }) => {
		const seq = Math.max(0, ...rows.map(row => row.seq)) + 1;
		rows.push({ id: params.id, seq, event_type: params.eventType, data: JSON.stringify(params.data) });
		return seq;
	});
	return { db, rows, events, persisted: () => persisted };
}
beforeEach(() => { vi.resetAllMocks(); });

describe("durable checkpoint observation recovery", () => {
	it("promotes only the last retained snapshot using its observed base and current attempt CAS", async () => {
		const base = encodeWorkflowOutput(output("before-acceptance", "old"));
		const last = output("waiting", "accepted-sibling");
		const runtime = fixture(base, [observation(base, [output(), last])]);
		const recovered = await recoverWorkflowCheckpointObservation(runtime.db, scope, base);
		expect(recovered.recovered).toBe(true);
		expect(decodeWorkflowOutput(recovered.output)).toEqual(last);
		expect(mocks.update).toHaveBeenCalledWith(runtime.db, {
			executionId: scope.executionId, nodeId: scope.nodeId,
			outputCheckpoint: { output: encodeWorkflowOutput(last), nodeRunId: scope.nodeRunId, attempt: 1,
				baseRootHash: workflowOutputRootHash(base) },
		});
		expect(mocks.insert).toHaveBeenCalledWith(runtime.db, expect.objectContaining({
			eventType: "node_checkpoint_observation_recovered", data: expect.objectContaining({
				observationSeq: 7, sourceAttempt: 1, attempt: 1, disposition: "promote", terminalAuthority: false }),
		}));
		expect(runtime.events).toHaveBeenCalledWith(expect.objectContaining({
			where: { execution_id: scope.executionId, node_id: scope.nodeId,
				event_type: { in: ["node_checkpoint_observation", "node_checkpoint_observation_recovered"] } },
		}));
	});

	it("recognizes an unknown committed candidate without writing it again", async () => {
		const committed = encodeWorkflowOutput(output());
		const runtime = fixture(committed, [observation(null, [output()])]);
		const recovered = await recoverWorkflowCheckpointObservation(runtime.db, scope, committed);
		expect(recovered.recovered).toBe(true); expect(mocks.update).not.toHaveBeenCalled();
		expect(mocks.insert).toHaveBeenCalledWith(runtime.db, expect.objectContaining({
			data: expect.objectContaining({ disposition: "already_committed" }),
		}));
	});

	it("advances an exactly committed physical-writer prefix to its retained candidate with changed provenance and failure evidence", async () => {
		const prefix = { ...output(), evidence: { ...output().evidence,
			workflowProvenance: { createdAt: "2026-09-30T11:00:00.000Z" } } };
		const retained = { ...prefix, evidence: { ...prefix.evidence,
			workflowProvenance: { createdAt: "2026-09-30T11:00:01.000Z" },
			checkpointPersistenceFailure: { recoverable: false, message: "acknowledgement unavailable" } } };
		const committed = encodeWorkflowOutput(prefix);
		const runtime = fixture(committed, [observation(null, [prefix, retained])]);
		const next = await recoverWorkflowCheckpointObservation(runtime.db, scope, committed);
		expect(decodeWorkflowOutput(next.output)).toEqual(retained);
		expect(mocks.update).toHaveBeenCalledWith(runtime.db, expect.objectContaining({
			outputCheckpoint: expect.objectContaining({ baseRootHash: workflowOutputRootHash(committed) }),
		}));
		expect(mocks.insert).toHaveBeenCalledWith(runtime.db, expect.objectContaining({
			data: expect.objectContaining({ matchedSnapshotIndex: 0, disposition: "promote" }),
		}));
	});

	it("uses its consumption marker to permit later legitimate progress in the same attempt", async () => {
		const runtime = fixture(null, [observation(null, [output()])]);
		await recoverWorkflowCheckpointObservation(runtime.db, scope, null);
		const newer = encodeWorkflowOutput(output("completed"));
		const next = await recoverWorkflowCheckpointObservation(runtime.db, scope, newer);
		expect(next).toEqual({ output: newer, recovered: false, resumeOnly: true });
		expect(mocks.update).toHaveBeenCalledTimes(1); expect(mocks.insert).toHaveBeenCalledTimes(1);
	});

	it("releases a failed consumption marker and safely records it on the next physical poll", async () => {
		const runtime = fixture(null, [observation(null, [output()])]);
		mocks.insert.mockRejectedValueOnce(new Error("marker unavailable"));
		await expect(recoverWorkflowCheckpointObservation(runtime.db, scope, null)).rejects.toBeInstanceOf(WorkflowCheckpointRecoveryConflict);
		const next = await recoverWorkflowCheckpointObservation(runtime.db, scope, runtime.persisted());
		expect(next.recovered).toBe(true); expect(mocks.update).toHaveBeenCalledTimes(1);
		expect(runtime.rows.at(-1)?.event_type).toBe("node_checkpoint_observation_recovered");
	});

	it("reconciles an unknown promotion commit before retrying the marker without replaying the promotion", async () => {
		const runtime = fixture(null, [observation(null, [output()])]);
		const persist = mocks.update.getMockImplementation()!;
		mocks.update.mockImplementationOnce(async (_db: unknown, params: { outputCheckpoint: WorkflowOutputCheckpointWrite }) => {
			await persist(_db, params);
			throw Object.assign(new Error("promotion commit acknowledgement unavailable"), { code: "P2028" });
		});
		await expect(recoverWorkflowCheckpointObservation(runtime.db, scope, null)).rejects.toBeInstanceOf(WorkflowCheckpointRecoveryConflict);
		expect(mocks.insert).not.toHaveBeenCalled();
		await recoverWorkflowCheckpointObservation(runtime.db, scope, runtime.persisted());
		expect(mocks.update).toHaveBeenCalledTimes(1);
		expect(mocks.insert).toHaveBeenCalledWith(runtime.db, expect.objectContaining({
			data: expect.objectContaining({ disposition: "already_committed" }),
		}));
	});

	it("never overwrites a newer root or ignores the retained conflict", async () => {
		const base = encodeWorkflowOutput(output("older"));
		const newer = encodeWorkflowOutput(output("newer", "different-accepted-task"));
		const runtime = fixture(newer, [observation(base, [output()])]);
		await expect(recoverWorkflowCheckpointObservation(runtime.db, scope, newer)).rejects.toMatchObject({
			name: "WorkflowCheckpointRecoveryConflict", reason: "base_root_changed",
		});
		expect(mocks.update).not.toHaveBeenCalled(); expect(mocks.insert).not.toHaveBeenCalled();
		expect(runtime.persisted()).toBe(newer);
	});

	it.each(["other_node", "non_output"])("rejects %s observation content before promotion", async invalid => {
		const snapshots = [invalid === "other_node" ? { ...output(), nodeId: "another-node" } : { status: "accepted" }];
		const runtime = fixture(null, [observation(null, snapshots)]);
		await expect(recoverWorkflowCheckpointObservation(runtime.db, scope, null)).rejects.toBeInstanceOf(WorkflowCheckpointRecoveryConflict);
		expect(mocks.update).not.toHaveBeenCalled(); expect(mocks.insert).not.toHaveBeenCalled();
	});

	it("carries an automatic recovery's prior physical receipt into the current attempt", async () => {
		const runtime = fixture(null, [observation(null, [output()], 1)],
			[{ attempt: 2, trigger: "runtime_recovery" }, { attempt: 1, trigger: "initial" }]);
		const recovered = await recoverWorkflowCheckpointObservation(runtime.db, { ...scope, attempt: 2 }, null);
		expect(recovered.recovered).toBe(true);
		expect(mocks.update).toHaveBeenCalledWith(runtime.db, expect.objectContaining({
			outputCheckpoint: expect.objectContaining({ nodeRunId: scope.nodeRunId, attempt: 2 }),
		}));
	});

	it("does not let an older observation fence a user's explicit new attempt", async () => {
		const runtime = fixture(null, [observation(null, [output()], 1)],
			[{ attempt: 2, trigger: "manual_repair" }, { attempt: 1, trigger: "initial" }]);
		expect(await recoverWorkflowCheckpointObservation(runtime.db, { ...scope, attempt: 2 }, null)).toEqual({ output: null, recovered: false, resumeOnly: false });
		expect(mocks.update).not.toHaveBeenCalled(); expect(mocks.insert).not.toHaveBeenCalled();
	});

	it.each(["first_prefix", "committed_candidate"] as const)("consumes every exact-hash observation ancestor from %s and stays consumed next poll", async boundary => {
		const a = encodeWorkflowOutput(output("first-prefix"));
		const b = encodeWorkflowOutput(output("latest", "accepted-latest"));
		const older = observation(null, [decodeWorkflowOutput(a)]);
		const newer = { ...observation(a, [decodeWorkflowOutput(b)]), id: "observation-2", seq: 9 };
		const current = boundary === "first_prefix" ? a : b;
		const runtime = fixture(current, [older, newer]);
		const first = await recoverWorkflowCheckpointObservation(runtime.db, scope, current);
		expect(first.output).toEqual(b); expect(first.resumeOnly).toBe(true);
		expect(mocks.insert.mock.calls.map(([, params]) => params.data.observationSeq).sort()).toEqual([7, 9]);
		expect(mocks.update).toHaveBeenCalledTimes(boundary === "first_prefix" ? 1 : 0);
		const second = await recoverWorkflowCheckpointObservation(runtime.db, scope, runtime.persisted());
		expect(second).toEqual({ output: b, recovered: false, resumeOnly: true });
		expect(mocks.insert).toHaveBeenCalledTimes(2);
	});

	it("finishes ancestor consumption after latest promotion committed but a later marker failed and attempt restarted", async () => {
		const a = encodeWorkflowOutput(output("first-prefix"));
		const b = encodeWorkflowOutput(output("latest"));
		const runtime = fixture(a, [observation(null, [decodeWorkflowOutput(a)]),
			{ ...observation(a, [decodeWorkflowOutput(b)]), id: "observation-2", seq: 9 }],
			[{ attempt: 2, trigger: "runtime_recovery" }, { attempt: 1, trigger: "initial" }]);
		const insert = mocks.insert.getMockImplementation()!;
		mocks.insert.mockImplementationOnce(insert).mockRejectedValueOnce(new Error("ancestor marker unavailable"));
		await expect(recoverWorkflowCheckpointObservation(runtime.db, scope, a)).rejects.toBeInstanceOf(WorkflowCheckpointRecoveryConflict);
		expect(runtime.persisted()).toEqual(b);
		await recoverWorkflowCheckpointObservation(runtime.db, { ...scope, attempt: 2 }, runtime.persisted());
		const final = await recoverWorkflowCheckpointObservation(runtime.db, { ...scope, attempt: 2 }, runtime.persisted());
		expect(final).toEqual({ output: b, recovered: false, resumeOnly: true });
		expect(mocks.update).toHaveBeenCalledTimes(1);
		expect(runtime.rows.filter(row => row.event_type === "node_checkpoint_observation_recovered")
			.map(row => JSON.parse(row.data).observationSeq).sort()).toEqual([7, 9]);
	});

	it("refuses an unproven older fork before promoting or consuming either writer", async () => {
		const a = encodeWorkflowOutput(output("fork-a", "accepted-a"));
		const b = encodeWorkflowOutput(output("fork-b", "accepted-b"));
		const runtime = fixture(null, [observation(null, [decodeWorkflowOutput(a)]),
			{ ...observation(null, [decodeWorkflowOutput(b)]), id: "observation-2", seq: 9 }]);
		await expect(recoverWorkflowCheckpointObservation(runtime.db, scope, null)).rejects.toMatchObject({ reason: "observation_ancestry_fork" });
		expect(mocks.update).not.toHaveBeenCalled(); expect(mocks.insert).not.toHaveBeenCalled();
	});

	it("consumes empty normalization diagnostics without changing output or fencing the next automatic attempt", async () => {
		const current = encodeWorkflowOutput(output());
		const runtime = fixture(current, [observation(null, [])],
			[{ attempt: 2, trigger: "runtime_recovery" }, { attempt: 1, trigger: "initial" }]);
		mocks.insert.mockRejectedValueOnce(new Error("diagnostic marker unavailable"));
		await expect(recoverWorkflowCheckpointObservation(runtime.db, scope, current)).rejects.toBeInstanceOf(WorkflowCheckpointRecoveryConflict);
		const resumed = await recoverWorkflowCheckpointObservation(runtime.db, { ...scope, attempt: 2 }, current);
		expect(resumed).toEqual({ output: current, recovered: false, resumeOnly: false });
		expect(mocks.update).not.toHaveBeenCalled();
		expect(mocks.insert).toHaveBeenLastCalledWith(runtime.db, expect.objectContaining({
			data: expect.objectContaining({ disposition: "diagnostic_only", candidateRootHash: null, observationSeq: 7 }),
		}));
		await expect(recoverWorkflowCheckpointObservation(runtime.db, { ...scope, attempt: 2 }, current))
			.resolves.toEqual({ output: current, recovered: false, resumeOnly: false });
		expect(mocks.insert).toHaveBeenCalledTimes(2);
	});

	it("bounds automatic ancestry at its immutable explicit-attempt boundary", () => {
		expect(workflowCheckpointRecoveryAttempts(3, [{ attempt: 3, trigger: "runtime_recovery" },
			{ attempt: 2, trigger: "automatic_retry" }, { attempt: 1, trigger: "initial" }])).toEqual([3, 2, 1]);
		expect(workflowCheckpointRecoveryAttempts(3, [{ attempt: 3, trigger: "runtime_recovery" },
			{ attempt: 2, trigger: "manual_repair" }, { attempt: 1, trigger: "initial" }])).toEqual([3, 2]);
		expect(() => workflowCheckpointRecoveryAttempts(2, [{ attempt: 2, trigger: "unrecognized" }])).toThrow(WorkflowCheckpointRecoveryConflict);
	});
});
