import { beforeEach, describe, expect, it, vi } from "vitest";
import { WORKFLOW_EXECUTION_SEMANTICS_PROTOCOL_VERSION } from "@tapcanvas/workflow-kernel-protocol";
import {
	applyWorkflowOutputCheckpointPacket, createWorkflowOutputCheckpointSender, parseWorkflowOutputCheckpointPacket,
	workflowOutputRootHash, type WorkflowOutputCheckpointPacket,
} from "./execution.output-checkpoint-packet";
import { decodeWorkflowOutput, encodeWorkflowOutput, workflowOutputDelta, type StoredWorkflowOutput } from "./execution.output-storage";

const ledger = vi.hoisted(() => ({
	output: null as unknown,
	attempt: 1,
	nodeRunId: "node-run-1",
	query: vi.fn(),
	update: vi.fn(),
	execute: vi.fn(async () => 1),
	findAttempt: vi.fn(),
}));
const prisma = vi.hoisted(() => ({
	$transaction: vi.fn(async (operation: (transaction: unknown) => Promise<unknown>) => operation({
		$queryRaw: ledger.query, $executeRaw: ledger.execute,
		workflow_node_runs: { update: ledger.update },
		workflow_node_attempts: { findUnique: ledger.findAttempt },
	})),
}));
vi.mock("../../platform/node/prisma", () => ({ getPrismaClient: () => prisma }));
import { updateNodeRun, WorkflowOutputCheckpointStaleError } from "./execution.node-run-store";

function initialPacket(value: unknown): WorkflowOutputCheckpointPacket {
	return { version: 1, baseRootHash: null, ...workflowOutputDelta(encodeWorkflowOutput(value), []) };
}

async function receive(packet: WorkflowOutputCheckpointPacket, nodeRunId = "node-run-1", attempt = 1): Promise<void> {
	const parsed = parseWorkflowOutputCheckpointPacket(JSON.parse(JSON.stringify(packet)));
	const output = applyWorkflowOutputCheckpointPacket(ledger.output, parsed);
	await updateNodeRun({} as never, {
		executionId: "execution-1", nodeId: "node-1", status: "running",
		outputCheckpoint: { output, nodeRunId, attempt, baseRootHash: parsed.baseRootHash },
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	ledger.output = null; ledger.attempt = 1; ledger.nodeRunId = "node-run-1";
	ledger.update.mockImplementation(async (input: { where: { id: string; attempt: number } }) => {
		if (input.where.id !== ledger.nodeRunId || input.where.attempt !== ledger.attempt) {
			throw Object.assign(new Error("attempt changed"), { code: "P2025" });
		}
		return { id: ledger.nodeRunId, attempt: ledger.attempt, output_refs: ledger.output === null ? null : JSON.stringify(ledger.output) };
	});
	ledger.query.mockImplementation(async (query: { sql: string; values: unknown[] }) => {
		const previous = ledger.output as StoredWorkflowOutput | null;
		if (query.sql.includes("SELECT id, attempt, output_refs FROM workflow_node_runs")) {
			if (query.values[2] !== ledger.nodeRunId || query.values[3] !== ledger.attempt) return [];
			return [{ id: ledger.nodeRunId, attempt: ledger.attempt, output_refs: previous === null ? null : JSON.stringify(previous) }];
		}
		if (query.sql.includes("FOR UPDATE")) {
			return [{ block_ids: previous ? Object.keys(previous.blocks) : [], storage_version: previous?.storageVersion ?? null }];
		}
		if (!query.sql.includes("UPDATE workflow_node_runs")) throw new Error("Unexpected test persistence query");
		const root: unknown = JSON.parse(query.values[1] as string);
		const ids = JSON.parse(query.values[3] as string) as string[];
		const blocks: unknown = JSON.parse(query.values[4] as string);
		const retained = Object.fromEntries(Object.entries(previous?.blocks ?? {}).filter(([id]) => ids.includes(id)));
		ledger.output = { storageVersion: query.values[0], root, blocks: { ...retained, ...blocks as Record<string, unknown> } };
		return [{ output_bytes: Buffer.byteLength(JSON.stringify(ledger.output)) }];
	});
	ledger.findAttempt.mockResolvedValue({ semantics_snapshot: JSON.stringify({
		protocolVersion: WORKFLOW_EXECUTION_SEMANTICS_PROTOCOL_VERSION,
		sideEffect: "paid_generation", retrySafety: "idempotency_key_required", executionMode: "exclusive",
		idempotency: { source: "runtime_node", inputField: null }, resultLookup: { mode: "provider_receipt", outputField: "taskId" },
		recoveryMode: "reconcile", maxAutomaticAttempts: 1, backoffClass: "none", failureStage: "media_generation",
	}), provider_receipts: null });
});

describe("workflow checkpoint sender, receiver and attempt ledger", () => {
	it("sends a large accepted body once and only a bounded state delta thereafter", async () => {
		const packets: WorkflowOutputCheckpointPacket[] = [];
		const send = createWorkflowOutputCheckpointSender(async packet => { packets.push(packet); await receive(packet); });
		const body = "retained synthetic author receipt ".repeat(40_000);
		const value = { nodeId: "node-1", evidence: { taskId: "already-accepted", body }, state: { status: "waiting", detail: "old" } };
		await send(value);
		const firstRoot = workflowOutputRootHash(ledger.output as StoredWorkflowOutput);
		value.state.status = "success";
		value.state.detail = "changed status fact ".repeat(4_000);
		await send(value);
		expect(packets[0]!.baseRootHash).toBeNull();
		expect(packets[1]!.baseRootHash).toBe(firstRoot);
		expect(JSON.stringify(packets[0])).toContain(body);
		expect(JSON.stringify(packets[1])).not.toContain(body);
		expect(Buffer.byteLength(JSON.stringify(packets[1]))).toBeLessThan(95_000);
		expect(decodeWorkflowOutput(ledger.output)).toEqual(value);
		expect(ledger.update).toHaveBeenCalledTimes(2);
		expect(ledger.update.mock.calls[1]![0]).toMatchObject({ where: { id: "node-run-1", attempt: 1 } });
	});

	it("captures each mutable callback before serializing concurrent sends into one acknowledged chain", async () => {
		let release!: () => void;
		const gate = new Promise<void>(resolve => { release = resolve; });
		const observed: number[] = [];
		const packets: WorkflowOutputCheckpointPacket[] = [];
		const roots: string[] = [];
		const send = createWorkflowOutputCheckpointSender(async packet => {
			packets.push(packet);
			if (packets.length === 1) await gate;
			await receive(packet);
			observed.push((decodeWorkflowOutput(ledger.output) as { count: number }).count);
			roots.push(workflowOutputRootHash(ledger.output as StoredWorkflowOutput));
		});
		const mutable = { count: 0, evidence: { taskId: "same-accepted-task", body: "retained".repeat(1_000) } };
		const acknowledgements: number[] = [];
		const writes = [send(mutable).then(() => { acknowledgements.push(0); })];
		mutable.count = 1; writes.push(send(mutable).then(() => { acknowledgements.push(1); }));
		mutable.count = 2; writes.push(send(mutable).then(() => { acknowledgements.push(2); }));
		await Promise.resolve();
		expect(packets).toHaveLength(1); expect(acknowledgements).toEqual([]);
		release(); await Promise.all(writes);
		expect(observed).toEqual([0, 1, 2]); expect(acknowledgements).toEqual([0, 1, 2]);
		expect(packets.map(packet => packet.baseRootHash)).toEqual([null, roots[0], roots[1]]);
	});

	it.each(["rejected", "ack_unknown"])("does not advance or resend after %s, retaining the exact accepted receipt", async outcome => {
		const packets: WorkflowOutputCheckpointPacket[] = [];
		const failure = new Error(outcome);
		const send = createWorkflowOutputCheckpointSender(async packet => {
			packets.push(packet);
			if (packets.length === 1) { await receive(packet); return; }
			if (outcome === "ack_unknown") await receive(packet);
			throw failure;
		});
		await send({ evidence: { taskId: "same-accepted-task" }, state: "waiting" });
		const acknowledgedRoot = workflowOutputRootHash(ledger.output as StoredWorkflowOutput);
		await expect(send({ evidence: { taskId: "same-accepted-task" }, state: "completed" })).rejects.toMatchObject({ cause: failure });
		await expect(send({ evidence: { taskId: "must-not-be-submitted" }, state: "new-request" })).rejects.toBe(send.failure());
		expect(send.unacknowledgedSnapshots()).toEqual([
			{ evidence: { taskId: "same-accepted-task" }, state: "completed" },
			{ evidence: { taskId: "must-not-be-submitted" }, state: "new-request" },
		]);
		await expect(send.settle()).rejects.toBe(send.failure());
		expect(send.acknowledgedRootHash()).toBe(acknowledgedRoot);
		expect(packets).toHaveLength(2); expect(packets[0]!.baseRootHash).toBeNull();
		expect(packets[1]!.baseRootHash).toBe(acknowledgedRoot);
		expect(JSON.stringify(packets)).not.toContain("must-not-be-submitted");
		expect(decodeWorkflowOutput(ledger.output)).toEqual({ evidence: { taskId: "same-accepted-task" },
			state: outcome === "ack_unknown" ? "completed" : "waiting" });
	});

	it("rejects malformed manifests, missing or corrupt hashes, and stale sender bases", async () => {
		const packet = initialPacket({ evidence: { taskId: "accepted", body: "retained".repeat(1_000) }, status: "waiting" });
		expect(() => parseWorkflowOutputCheckpointPacket({ ...packet, version: 2 })).toThrow("Invalid");
		expect(() => parseWorkflowOutputCheckpointPacket({ ...packet, blockIds: [...packet.blockIds, packet.blockIds[0]] })).toThrow("Invalid");
		expect(() => parseWorkflowOutputCheckpointPacket({ ...packet, blocks: { ...packet.blocks, ["0".repeat(64)]: "unlisted" } })).toThrow("outside");
		const hash = packet.blockIds.find(id => typeof packet.blocks[id] === "string")!;
		expect(() => applyWorkflowOutputCheckpointPacket(null, { ...packet, blocks: { ...packet.blocks, [hash]: "corrupt" } })).toThrow("hash mismatch");
		const missing = { ...packet.blocks }; delete missing[hash];
		expect(() => applyWorkflowOutputCheckpointPacket(null, { ...packet, blocks: missing })).toThrow("block missing");
		await receive(packet);
		const before = JSON.stringify(ledger.output);
		expect(() => applyWorkflowOutputCheckpointPacket(ledger.output, packet)).toThrow("stale_base");
		await expect(receive({ ...packet, baseRootHash: "0".repeat(64) })).rejects.toThrow("stale_base");
		expect(JSON.stringify(ledger.output)).toBe(before); expect(ledger.update).toHaveBeenCalledTimes(1);
	});

	it.each(["node_run", "attempt", "base_race"])("fences a prepared %s mutation again inside the store transaction", async boundary => {
		await receive(initialPacket({ evidence: { taskId: "accepted" }, state: "waiting" }));
		const before = JSON.stringify(ledger.output);
		const output = encodeWorkflowOutput({ evidence: { taskId: "accepted" }, state: "complete" });
		const baseRootHash = workflowOutputRootHash(ledger.output as StoredWorkflowOutput);
		if (boundary === "attempt") ledger.attempt = 2;
		if (boundary === "base_race") ledger.output = encodeWorkflowOutput({ evidence: { taskId: "accepted" }, state: "newer-observation" });
		const current = JSON.stringify(ledger.output);
		await expect(updateNodeRun({} as never, {
			executionId: "execution-1", nodeId: "node-1", status: "running",
			outputCheckpoint: { output, nodeRunId: boundary === "node_run" ? "other-run" : "node-run-1", attempt: 1, baseRootHash },
		})).rejects.toBeInstanceOf(WorkflowOutputCheckpointStaleError);
		expect(JSON.stringify(ledger.output)).toBe(current);
		if (boundary !== "base_race") expect(current).toBe(before);
		expect(ledger.query.mock.calls.filter(([query]) => !(query as { sql: string }).sql.includes("FOR UPDATE"))).toHaveLength(1);
	});
});
