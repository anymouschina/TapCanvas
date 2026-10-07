import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { AppContext, AppEnv, PrismaClient } from "../../types";
import type { ExecutionRow, ExecutionSnapshotRow, NodeRunRow } from "./execution.repo";
import type { WorkflowAgentPreferencesReceipt } from "./execution.agent-preferences";
import type { WorkflowAgentTurnIdentity, WorkflowAgentTurnCancellationResult } from "./execution.agent-cancellation";
import type { AgentsChatTurnStatusSnapshot } from "../task/task.agents-chat-runtime";
import { createWorkflowAgentPreferencesRouter } from "./execution.agent-preferences.routes";

const at = "2026-10-02T00:00:00.000Z";
const receipt: WorkflowAgentPreferencesReceipt = { version: 1, executionId: "execution-1", nodeId: "author", authorizedBy: "owner", requestedAt: at, idempotencyKey: "request-1", preferences: { reasoningEffort: "none" } };
const turn: WorkflowAgentTurnIdentity = { nodeId: "author", runtimeNodeId: "author", sessionId: "workflow:execution-1:author", turnId: "turn-1" };
const execution: ExecutionRow = { id: "execution-1", flow_id: "flow-1", flow_version_id: "version-1", owner_id: "owner", status: "running", concurrency: 1, trigger: "agent", error_message: null, execution_family_id: "execution-1", created_at: at, started_at: at, finished_at: null };
const row: NodeRunRow = { id: "run-1", execution_id: "execution-1", node_id: "author", status: "running", attempt: 1, error_message: null, output_refs: null, created_at: at, started_at: at, finished_at: null };
const snapshot: ExecutionSnapshotRow = { id: "execution-1", flow_id: "flow-1", flow_version_id: "version-1", flow_versions: { name: "workflow", created_at: at, data: JSON.stringify({ nodes: [{ id: "author", data: { workflowAtomicSpec: { executorRef: "agents.logical-task/v2" } } }] }) } };

function turnStatus(active = true, turnId = turn.turnId, sessionId = turn.sessionId): AgentsChatTurnStatusSnapshot {
	return { sessionId, durable: true, activeTurn: active, turn: active ? {
		turnId, internalTurnId: turnId, state: "running", phase: "agent_running", startedAt: at, updatedAt: at, lastConfirmedAt: at, requestText: "author task", terminalAuthority: "workflow_action", reasonCode: "initial_execution", userIntentContract: null, suspension: null, recoveryCheckpoint: null, lastConfirmedSummary: "Waiting for model", finalResponse: null, terminalDelivery: null, pendingQueueCount: 0, recentEvents: [],
		logicalTaskState: { version: 1, logicalTaskId: turnId, status: "active", reasonCode: "initial_execution", physicalRunStatus: "running", deliveryStatus: "pending", taskNodeId: turnId, taskRevision: 0, updatedAt: at, continuationTicket: null },
	} : null };
}

function harness(options: { owned?: boolean; executionStatus?: string; nodeStatus?: string; executor?: string; created?: boolean; interruptFails?: boolean; activeTurns?: readonly WorkflowAgentTurnIdentity[]; rows?: NodeRunRow[] } = {}) {
	const getExecution = vi.fn(async () => options.owned === false ? null : { ...execution, status: options.executionStatus ?? execution.status });
	const getSnapshot = vi.fn(async () => options.executor ? { ...snapshot, flow_versions: { ...snapshot.flow_versions, data: JSON.stringify({ nodes: [{ id: "author", data: { workflowAtomicSpec: { executorRef: options.executor } } }] }) } } : snapshot);
	const listNodeRuns = vi.fn(async () => options.rows ?? [{ ...row, status: options.nodeStatus ?? row.status }]);
	const listActiveTurns = vi.fn(async () => options.activeTurns ?? [turn, { ...turn, nodeId: "sibling", runtimeNodeId: "sibling", sessionId: "workflow:execution-1:sibling" }]);
	const getTurnStatus = vi.fn(async (_context: AppContext, _ownerId: string, sessionId: string) => turnStatus(true, turn.turnId, sessionId));
	const writePreferences = vi.fn(async (_db: PrismaClient, input: Pick<WorkflowAgentPreferencesReceipt, "nodeId">) => ({ receipt: { ...receipt, nodeId: input.nodeId }, created: options.created !== false }));
	const interruptTurns = vi.fn(async (): Promise<readonly WorkflowAgentTurnCancellationResult[]> => [{ target: turn, status: options.interruptFails ? "failed" : "interrupted", receipt: null, errorCode: options.interruptFails ? "transport_unknown" : null, errorMessage: options.interruptFails ? "No interruption receipt" : null }]);
	const app = new Hono<AppEnv>();
	app.use("*", async (c, next) => { c.set("userId", "owner"); await next(); });
	app.route("/", createWorkflowAgentPreferencesRouter({ getExecution, getSnapshot, listNodeRuns, listActiveTurns, getTurnStatus, writePreferences, interruptTurns }));
	const request = (payload: unknown = { nodeId: "author", idempotencyKey: "request-1", preferences: { reasoningEffort: "none" } }) => app.request("/execution-1/agent-preferences", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }, { DB: {} as PrismaClient, JWT_SECRET: "test" });
	return { request, getExecution, getSnapshot, listNodeRuns, writePreferences, interruptTurns, listActiveTurns, getTurnStatus };
}

describe("explicit workflow Agent preference route", () => {
	it("explicitly applies to all live Agent sessions of one execution when nodeId is null", async () => {
		const sibling = { ...turn, nodeId: "sibling", runtimeNodeId: "sibling", sessionId: "workflow:execution-1:sibling" };
		const unrelated = { ...turn, sessionId: "workflow:execution-2:author" };
		const h = harness({ activeTurns: [turn, sibling, unrelated], rows: [row, { ...row, node_id: "media", node_type: "image", output_refs: JSON.stringify({ executorRef: "tapcanvas.image.generate/v1", evidence: {} }) }] });
		const response = await h.request({ nodeId: null, idempotencyKey: "request-1", preferences: { reasoningEffort: "none" } });
		expect(response.status).toBe(202);
		expect(await response.json()).toMatchObject({ scope: "execution", nodeId: null, receipt: { nodeId: null }, applicationStatus: "continuation_requested" });
		expect(h.getSnapshot).not.toHaveBeenCalled();
		expect(h.getTurnStatus).toHaveBeenCalledTimes(2);
		expect(h.interruptTurns).toHaveBeenCalledWith(expect.objectContaining({ targets: [turn, sibling], interruptReasonCode: "provider_stream_interrupted" }));
		expect(Math.max(...h.getTurnStatus.mock.invocationCallOrder)).toBeLessThan(h.writePreferences.mock.invocationCallOrder[0]);
	});
	it("records execution preferences for future Agent nodes without requiring a current node run", async () => {
		const h = harness({ activeTurns: [], rows: [] });
		const response = await h.request({ nodeId: null, idempotencyKey: "request-1", preferences: { reasoningEffort: "none" } });
		expect(await response.json()).toMatchObject({ scope: "execution", nodeId: null, applicationStatus: "pending_next_model_request" });
		expect(h.writePreferences).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ nodeId: null, executionId: "execution-1" }));
		expect(h.interruptTurns).not.toHaveBeenCalled();
	});
	it("does not interrupt new execution-scope requests on an idempotent repeat", async () => {
		const h = harness({ created: false });
		expect(await (await h.request({ nodeId: null, idempotencyKey: "request-1", preferences: { reasoningEffort: "none" } })).json()).toMatchObject({ scope: "execution", created: false, applicationStatus: "receipt_already_recorded" });
		expect(h.interruptTurns).not.toHaveBeenCalled();
	});
	it("preserves execution-scope preferences as pending when one live status is unreadable", async () => {
		const h = harness();
		h.getTurnStatus.mockRejectedValueOnce(new Error("owner unavailable"));
		expect(await (await h.request({ nodeId: null, idempotencyKey: "request-1", preferences: { reasoningEffort: "none" } })).json()).toMatchObject({ scope: "execution", receipt: { nodeId: null }, applicationStatus: "pending_interrupt", error: "owner unavailable" });
		expect(h.interruptTurns).not.toHaveBeenCalled();
	});
	it("rejects inactive execution scope and omission of the explicit scope", async () => {
		const inactive = harness({ executionStatus: "success" });
		expect((await inactive.request({ nodeId: null, idempotencyKey: "request-1", preferences: { reasoningEffort: "none" } })).status).toBe(409);
		expect(inactive.writePreferences).not.toHaveBeenCalled();
		const omitted = harness();
		expect((await omitted.request({ idempotencyKey: "request-1", preferences: { reasoningEffort: "none" } })).status).toBe(400);
		expect(omitted.writePreferences).not.toHaveBeenCalled();
	});
	it("persists one node's preferences before requesting only its physical interruption", async () => {
		const h = harness();
		const response = await h.request();
		expect(response.status).toBe(202);
		expect(await response.json()).toMatchObject({ receipt, created: true, applicationStatus: "continuation_requested", appliedToActiveRequest: false });
		expect(h.listActiveTurns.mock.invocationCallOrder[0]).toBeLessThan(h.writePreferences.mock.invocationCallOrder[0]);
		expect(h.getTurnStatus.mock.invocationCallOrder[0]).toBeLessThan(h.writePreferences.mock.invocationCallOrder[0]);
		expect(h.writePreferences.mock.invocationCallOrder[0]).toBeLessThan(h.interruptTurns.mock.invocationCallOrder[0]);
		expect(h.interruptTurns).toHaveBeenCalledWith(expect.objectContaining({ targets: [turn], interruptReasonCode: "provider_stream_interrupted" }));
	});
	it("resolves stale historical trace generations to the one runtime owner", async () => {
		const h = harness({ activeTurns: [turn, { ...turn, turnId: "stale-retry-1" }, { ...turn, turnId: "stale-retry-2" }] });
		h.getTurnStatus.mockResolvedValueOnce(turnStatus(true, "current-retry-3"));
		expect(await (await h.request()).json()).toMatchObject({ applicationStatus: "continuation_requested" });
		expect(h.getTurnStatus).toHaveBeenCalledOnce();
		expect(h.interruptTurns).toHaveBeenCalledWith(expect.objectContaining({ targets: [{ ...turn, turnId: "current-retry-3" }] }));
	});
	it("keeps the pre-write owner when persistence allows a new generation to start", async () => {
		const h = harness();
		let currentTurnId = "old-request";
		h.getTurnStatus.mockImplementation(async () => turnStatus(true, currentTurnId));
		h.writePreferences.mockImplementation(async () => { currentTurnId = "new-request-using-none"; return { receipt, created: true }; });
		await h.request();
		expect(currentTurnId).toBe("new-request-using-none");
		expect(h.getTurnStatus).toHaveBeenCalledOnce();
		expect(h.interruptTurns).toHaveBeenCalledWith(expect.objectContaining({ targets: [{ ...turn, turnId: "old-request" }] }));
	});
	it("does not fence runtime-confirmed inactive sessions", async () => {
		const h = harness();
		h.getTurnStatus.mockResolvedValueOnce(turnStatus(false));
		const payload: unknown = await (await h.request()).json();
		expect(payload).toMatchObject({ applicationStatus: "pending_next_model_request" });
		expect(payload).not.toHaveProperty("error");
		expect(h.interruptTurns).not.toHaveBeenCalled();
	});
	it("saves a pending receipt without guessing when authoritative status is unreadable", async () => {
		const h = harness();
		h.getTurnStatus.mockRejectedValueOnce(new Error("status timeout"));
		expect(await (await h.request()).json()).toMatchObject({ receipt, applicationStatus: "pending_interrupt", error: "status timeout" });
		expect(h.writePreferences).toHaveBeenCalledOnce();
		expect(h.interruptTurns).not.toHaveBeenCalled();
	});
	it("does not interrupt a newer model request on an idempotent repeat", async () => {
		const h = harness({ created: false });
		expect(await (await h.request()).json()).toMatchObject({ created: false, applicationStatus: "receipt_already_recorded" });
		expect(h.interruptTurns).not.toHaveBeenCalled();
	});
	it("retains the receipt and reports a pending outcome when interruption fails", async () => {
		const h = harness({ interruptFails: true });
		const response = await h.request();
		expect(response.status).toBe(202);
		expect(await response.json()).toMatchObject({ receipt, applicationStatus: "pending_interrupt", code: "workflow_agent_preferences_interrupt_pending", appliedToActiveRequest: false });
		expect(h.writePreferences).toHaveBeenCalledOnce();
	});
	it("reports unresolved active ownership without pretending the request was changed", async () => {
		const h = harness({ activeTurns: [] });
		expect(await (await h.request()).json()).toMatchObject({ receipt, code: "workflow_agent_preferences_active_turn_unresolved", applicationStatus: "pending_next_model_request" });
		expect(h.interruptTurns).not.toHaveBeenCalled();
	});
	it("keeps preferences pending when owner observation fails before persistence", async () => {
		const h = harness();
		h.listActiveTurns.mockRejectedValueOnce(new Error("owner observation unavailable"));
		expect(await (await h.request()).json()).toMatchObject({ receipt, applicationStatus: "pending_interrupt", error: "owner observation unavailable" });
		expect(h.writePreferences).toHaveBeenCalledOnce();
		expect(h.interruptTurns).not.toHaveBeenCalled();
	});
	it("records preferences for a queued Agent without interrupting siblings", async () => {
		const h = harness({ nodeStatus: "queued", activeTurns: [] });
		const payload: unknown = await (await h.request()).json();
		expect(payload).toMatchObject({ receipt, applicationStatus: "pending_next_model_request" });
		expect(payload).not.toHaveProperty("error");
		expect(h.interruptTurns).not.toHaveBeenCalled();
	});
	it("rejects an unowned execution before writing or fencing", async () => {
		const h = harness({ owned: false });
		expect((await h.request()).status).toBe(404);
		expect(h.listNodeRuns).not.toHaveBeenCalled();
		expect(h.writePreferences).not.toHaveBeenCalled();
		expect(h.interruptTurns).not.toHaveBeenCalled();
	});
	it("rejects a non-Agent executor and a finished node without writing", async () => {
		for (const options of [{ executor: "tapcanvas.image.generate/v1" }, { nodeStatus: "success" }]) {
			const h = harness(options);
			expect((await h.request()).status).toBe(409);
			expect(h.writePreferences).not.toHaveBeenCalled();
			expect(h.interruptTurns).not.toHaveBeenCalled();
		}
	});
	it("rejects unknown preference fields instead of changing model or prompt", async () => {
		const h = harness();
		expect((await h.request({ nodeId: "author", idempotencyKey: "request-1", preferences: { reasoningEffort: "none", model: "other-model" } })).status).toBe(400);
		expect(h.writePreferences).not.toHaveBeenCalled();
	});
});
