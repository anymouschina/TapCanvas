import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../../types";
import {
	readWorkflowAgentPreferences, writeWorkflowAgentPreferences,
	workflowAgentPreferencesRequestSchema, WorkflowAgentPreferencesConflictError,
} from "./execution.agent-preferences";

const mocks = vi.hoisted(() => ({ insert: vi.fn() }));
vi.mock("./execution.repo", () => ({ insertExecutionEvent: mocks.insert }));

type Event = {
	id: string; execution_id: string; node_id: string | null; event_type: string;
	data: string | null; seq: number; ownerId: string;
};
type Append = {
	id: string; executionId: string; nodeId: string | null; eventType: string; data: unknown;
};
const request = {
	executionId: "execution-1", nodeId: "node-1", authorizedBy: "owner-1",
	idempotencyKey: "request-1", preferences: { reasoningEffort: "none" as const },
};

function store() {
	const events = new Map<string, Event>();
	const persist = (input: Append): number => {
		const seq = events.size + 1;
		events.set(input.id, { id: input.id, execution_id: input.executionId, node_id: input.nodeId,
			event_type: input.eventType, data: JSON.stringify(input.data), seq, ownerId: "owner-1" });
		return seq;
	};
	const findUnique = vi.fn(async (input: { where: { id: string } }) => events.get(input.where.id) ?? null);
	const findFirst = vi.fn(async (input: { where: { execution_id: string; OR: Array<{ node_id: string | null }>; event_type: string; workflow_executions: { owner_id: string } }; orderBy: { seq: string } }) => {
		return [...events.values()].filter(event => event.execution_id === input.where.execution_id
			&& input.where.OR.some(target => target.node_id === event.node_id) && event.event_type === input.where.event_type
			&& event.ownerId === input.where.workflow_executions.owner_id).sort((a, b) => b.seq - a.seq)[0] ?? null;
	});
	mocks.insert.mockImplementation(async (_db: unknown, input: Append) => persist(input));
	const db = { workflow_execution_events: { findUnique, findFirst } } as unknown as PrismaClient;
	return { db, events, persist, findUnique, findFirst };
}

beforeEach(() => { mocks.insert.mockReset(); });

describe("workflow explicit agent preferences receipts", () => {
	it("validates the exact request protocol without model or unrelated override fields", () => {
		expect(workflowAgentPreferencesRequestSchema.parse({ nodeId: request.nodeId, idempotencyKey: request.idempotencyKey, preferences: request.preferences })).toEqual({ nodeId: request.nodeId, idempotencyKey: request.idempotencyKey, preferences: request.preferences });
		for (const preferences of [{ reasoningEffort: "invalid" }, { reasoningEffort: "none", model: "other" }, {}]) {
			expect(workflowAgentPreferencesRequestSchema.safeParse({ nodeId: "node", idempotencyKey: "key", preferences }).success).toBe(false);
		}
		expect(workflowAgentPreferencesRequestSchema.safeParse({ nodeId: " ", idempotencyKey: "key", preferences: request.preferences }).success).toBe(false);
		expect(workflowAgentPreferencesRequestSchema.safeParse({ nodeId: "node", idempotencyKey: "", preferences: request.preferences }).success).toBe(false);
		expect(workflowAgentPreferencesRequestSchema.safeParse({ nodeId: "node", idempotencyKey: "key", preferences: request.preferences, extra: true }).success).toBe(false);
	});

	it("persists once, returns the original receipt on duplicate and reads the owner-scoped value", async () => {
		const h = store();
		const first = await writeWorkflowAgentPreferences(h.db, request);
		expect(first.created).toBe(true);
		expect(first.receipt).toEqual({ version: 1, ...request, requestedAt: expect.any(String) });
		expect(await writeWorkflowAgentPreferences(h.db, request)).toEqual({ receipt: first.receipt, created: false });
		expect(mocks.insert).toHaveBeenCalledTimes(1);
		expect(await readWorkflowAgentPreferences(h.db, { executionId: request.executionId, nodeId: request.nodeId, ownerId: request.authorizedBy })).toEqual(first.receipt);
		expect(await readWorkflowAgentPreferences(h.db, { executionId: request.executionId, nodeId: request.nodeId, ownerId: "other-owner" })).toBeNull();
	});

	it("rejects a reused key with changed preferences or a different node", async () => {
		const h = store();
		await writeWorkflowAgentPreferences(h.db, request);
		await expect(writeWorkflowAgentPreferences(h.db, { ...request, preferences: { reasoningEffort: "low" } })).rejects.toBeInstanceOf(WorkflowAgentPreferencesConflictError);
		await expect(writeWorkflowAgentPreferences(h.db, { ...request, nodeId: "node-2" })).rejects.toBeInstanceOf(WorkflowAgentPreferencesConflictError);
		await expect(writeWorkflowAgentPreferences(h.db, { ...request, nodeId: null })).rejects.toBeInstanceOf(WorkflowAgentPreferencesConflictError);
		expect(h.events.size).toBe(1);
	});

	it("requires explicit execution scope and applies it to future runtime nodes without crossing executions", async () => {
		const h = store();
		expect(workflowAgentPreferencesRequestSchema.safeParse({ idempotencyKey: "key", preferences: request.preferences }).success).toBe(false);
		expect(workflowAgentPreferencesRequestSchema.parse({ nodeId: null, idempotencyKey: "key", preferences: request.preferences }).nodeId).toBeNull();
		const saved = await writeWorkflowAgentPreferences(h.db, { ...request, nodeId: null });
		expect(await writeWorkflowAgentPreferences(h.db, { ...request, nodeId: null })).toEqual({ receipt: saved.receipt, created: false });
		for (const nodeId of ["node-1", "pipeline::future-runtime-author"]) {
			expect(await readWorkflowAgentPreferences(h.db, { executionId: request.executionId, nodeId, ownerId: request.authorizedBy })).toEqual(saved.receipt);
		}
		expect(await readWorkflowAgentPreferences(h.db, { executionId: "other-execution", nodeId: "node-1", ownerId: request.authorizedBy })).toBeNull();
	});

	it("uses the latest applicable authorization across node and execution scopes", async () => {
		const h = store();
		await writeWorkflowAgentPreferences(h.db, request);
		const all = await writeWorkflowAgentPreferences(h.db, { ...request, nodeId: null, idempotencyKey: "all", preferences: { reasoningEffort: "low" } });
		expect(await readWorkflowAgentPreferences(h.db, { executionId: request.executionId, nodeId: request.nodeId, ownerId: request.authorizedBy })).toEqual(all.receipt);
		const one = await writeWorkflowAgentPreferences(h.db, { ...request, idempotencyKey: "one-again" });
		expect(await readWorkflowAgentPreferences(h.db, { executionId: request.executionId, nodeId: request.nodeId, ownerId: request.authorizedBy })).toEqual(one.receipt);
		expect(await readWorkflowAgentPreferences(h.db, { executionId: request.executionId, nodeId: "other-node", ownerId: request.authorizedBy })).toEqual(all.receipt);
	});

	it("selects the latest sequence only for the requested execution and node", async () => {
		const h = store();
		await writeWorkflowAgentPreferences(h.db, request);
		const latest = await writeWorkflowAgentPreferences(h.db, { ...request, idempotencyKey: "second", preferences: { reasoningEffort: "medium" } });
		await writeWorkflowAgentPreferences(h.db, { ...request, nodeId: "node-2", idempotencyKey: "third", preferences: { reasoningEffort: "high" } });
		await writeWorkflowAgentPreferences(h.db, { ...request, executionId: "execution-2", idempotencyKey: "fourth", preferences: { reasoningEffort: "max" } });
		expect(await readWorkflowAgentPreferences(h.db, { executionId: request.executionId, nodeId: request.nodeId, ownerId: request.authorizedBy })).toEqual(latest.receipt);
		expect(await readWorkflowAgentPreferences(h.db, { executionId: request.executionId, nodeId: "absent", ownerId: request.authorizedBy })).toBeNull();
	});

	it("reconciles a concurrent unique insert only after validating its durable winner", async () => {
		const h = store();
		mocks.insert.mockImplementationOnce(async (_db: unknown, input: Append) => {
			h.persist(input);
			throw { code: "P2010", meta: { code: "23505" } };
		});
		const result = await writeWorkflowAgentPreferences(h.db, request);
		expect(result.created).toBe(false);
		expect(result.receipt.preferences).toEqual(request.preferences);
		expect(h.findUnique).toHaveBeenCalledTimes(2);
		expect(h.events.size).toBe(1);
	});

	it("does not swallow a database failure or a unique conflict without a matching event", async () => {
		const h = store();
		const unavailable = new Error("database unavailable");
		mocks.insert.mockRejectedValueOnce(unavailable);
		await expect(writeWorkflowAgentPreferences(h.db, request)).rejects.toBe(unavailable);
		const unrelatedConflict = { code: "P2002" };
		mocks.insert.mockRejectedValueOnce(unrelatedConflict);
		await expect(writeWorkflowAgentPreferences(h.db, request)).rejects.toBe(unrelatedConflict);
	});

	it("rejects corrupt receipts and mismatched event identity instead of silently ignoring them", async () => {
		const h = store();
		await writeWorkflowAgentPreferences(h.db, request);
		const event = [...h.events.values()][0]!;
		const original = event.data;
		event.data = "malformed";
		await expect(readWorkflowAgentPreferences(h.db, { executionId: request.executionId, nodeId: request.nodeId, ownerId: request.authorizedBy })).rejects.toThrow("receipt_invalid");
		event.data = original;
		const parsed = JSON.parse(original!) as Record<string, unknown>;
		event.data = JSON.stringify({ ...parsed, authorizedBy: "other-owner" });
		await expect(readWorkflowAgentPreferences(h.db, { executionId: request.executionId, nodeId: request.nodeId, ownerId: request.authorizedBy })).rejects.toThrow("scope_mismatch");
		event.data = JSON.stringify({ ...parsed, nodeId: "other-node" });
		await expect(writeWorkflowAgentPreferences(h.db, request)).rejects.toThrow("scope_mismatch");
		event.data = original;
		event.id = "forged-id";
		await expect(readWorkflowAgentPreferences(h.db, { executionId: request.executionId, nodeId: request.nodeId, ownerId: request.authorizedBy })).rejects.toThrow("scope_mismatch");
	});
});
