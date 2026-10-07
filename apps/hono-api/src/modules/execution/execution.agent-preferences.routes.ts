import { Hono } from "hono";
import type { AppContext, AppEnv } from "../../types";
import { getAgentsChatTurnStatus } from "../task/task.agents-chat-runtime";
import {
	getExecutionForOwner,
	getExecutionSnapshotForOwner,
	listNodeRunsForExecutionOwner,
	mapExecutionSnapshotRow,
} from "./execution.repo";
import {
	cancelWorkflowAgentTurns,
	collectWorkflowAgentTurnIdentities,
	listActiveWorkflowAgentTurnIdentities,
	mergeWorkflowAgentTurnIdentities,
	type WorkflowAgentTurnIdentity,
} from "./execution.agent-cancellation";
import {
	workflowAgentPreferencesRequestSchema,
	writeWorkflowAgentPreferences,
	WorkflowAgentPreferencesConflictError,
} from "./execution.agent-preferences";

export type WorkflowAgentPreferencesRouteDependencies = Readonly<{
	getExecution: typeof getExecutionForOwner;
	getSnapshot: typeof getExecutionSnapshotForOwner;
	listNodeRuns: typeof listNodeRunsForExecutionOwner;
	listActiveTurns: typeof listActiveWorkflowAgentTurnIdentities;
	getTurnStatus: typeof getAgentsChatTurnStatus;
	writePreferences: typeof writeWorkflowAgentPreferences;
	interruptTurns: typeof cancelWorkflowAgentTurns;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasLogicalAgentExecutor(snapshot: unknown, nodeId: string): boolean {
	if (!isRecord(snapshot) || !Array.isArray(snapshot.nodes)) return false;
	const node: unknown = snapshot.nodes.find((value: unknown) => isRecord(value) && value.id === nodeId);
	if (!isRecord(node) || !isRecord(node.data)) return false;
	const spec = node.data.workflowAtomicSpec;
	return isRecord(spec) && spec.executorRef === "agents.logical-task/v2";
}

const dependencies: WorkflowAgentPreferencesRouteDependencies = {
	getExecution: getExecutionForOwner,
	getSnapshot: getExecutionSnapshotForOwner,
	listNodeRuns: listNodeRunsForExecutionOwner,
	listActiveTurns: listActiveWorkflowAgentTurnIdentities,
	getTurnStatus: getAgentsChatTurnStatus,
	writePreferences: writeWorkflowAgentPreferences,
	interruptTurns: cancelWorkflowAgentTurns,
};

/** Explicit owner preferences affect the selected scope's next model requests.
 * Receipts survive a failed interrupt; they never claim the active request has
 * already adopted the preferences or cancel the logical workflow. */
export function createWorkflowAgentPreferencesRouter(
	services: WorkflowAgentPreferencesRouteDependencies = dependencies,
): Hono<AppEnv> {
	const router = new Hono<AppEnv>();
	router.post("/:id/agent-preferences", async (c) => {
		const ownerId = c.get("userId");
		if (!ownerId) return c.json({ error: "Unauthorized" }, 401);
		const parsed = workflowAgentPreferencesRequestSchema.safeParse(await c.req.json().catch(() => null));
		if (!parsed.success) return c.json({ error: "Invalid Agent preferences request", code: "workflow_agent_preferences_request_invalid", details: parsed.error.flatten() }, 400);
		const executionId = c.req.param("id").trim();
		const execution = await services.getExecution(c.env.DB, executionId, ownerId);
		if (!execution) return c.json({ error: "Execution not found", code: "workflow_execution_not_found" }, 404);
		const { nodeId, idempotencyKey, preferences } = parsed.data;
		const responseScope = { executionId, nodeId, scope: nodeId === null ? "execution" : "node" } as const;
		if (execution.status !== "running" && execution.status !== "queued") {
			return c.json({ error: "This execution has no continuing work to apply preferences to", code: "workflow_agent_preferences_execution_inactive" }, 409);
		}
		const rows = await services.listNodeRuns(c.env.DB, { executionId, ownerId });
		const target = nodeId === null ? null : rows.find((row) => row.node_id === nodeId);
		if (nodeId !== null) {
			if (!target) return c.json({ error: "Node run not found in this execution", code: "workflow_agent_preferences_node_not_found" }, 404);
			const snapshot = await services.getSnapshot(c.env.DB, { executionId, ownerId });
			if (!snapshot || !hasLogicalAgentExecutor(mapExecutionSnapshotRow(snapshot).data, nodeId)) {
				return c.json({ error: "The exact node must use agents.logical-task/v2", code: "workflow_agent_preferences_executor_invalid" }, 409);
			}
			if (!["queued", "running", "waiting_external"].includes(target.status)) {
				return c.json({ error: "This node has no continuing execution to apply preferences to", code: "workflow_agent_preferences_execution_inactive" }, 409);
			}
		}
		// Capture exact predecessor generations before publishing preferences.
		// A fresh request can read the receipt immediately after persistence; it
		// must never be mistaken for the old request that needs interruption.
		let turns: readonly WorkflowAgentTurnIdentity[] = [];
		let observationError: string | null = null;
		let observedSessionCount = 0;
		try {
			const observed = await services.listActiveTurns({ db: c.env.DB, userId: ownerId, executionId });
			const candidates = mergeWorkflowAgentTurnIdentities(
				collectWorkflowAgentTurnIdentities(target ? [target] : rows),
				observed,
			).filter((turn) => (nodeId === null || turn.runtimeNodeId === nodeId)
				&& turn.sessionId.startsWith(`workflow:${executionId}:`));
			// Trace lifecycle records can outlive their physical generation. The
			// owning runtime, queried once per session, identifies the sole live
			// turn; old trace IDs are discovery evidence rather than cancellation
			// authority.
			const sessions = new Map(candidates.map((candidate) => [candidate.sessionId, candidate]));
			observedSessionCount = sessions.size;
			const confirmed: WorkflowAgentTurnIdentity[] = [];
			for (const candidate of sessions.values()) {
				const status = await services.getTurnStatus(c as unknown as AppContext, ownerId, candidate.sessionId, { timeoutMs: 10_000 });
				if (status.sessionId !== candidate.sessionId) throw new Error("workflow_agent_preferences_status_session_mismatch");
				if (!status.activeTurn) continue;
				if (!status.turn?.turnId) throw new Error("workflow_agent_preferences_active_turn_identity_missing");
				confirmed.push({ ...candidate, turnId: status.turn.turnId });
			}
			turns = confirmed;
		} catch (error: unknown) {
			observationError = error instanceof Error ? error.message : String(error);
		}
		let saved: Awaited<ReturnType<typeof writeWorkflowAgentPreferences>>;
		try {
			saved = await services.writePreferences(c.env.DB, { executionId, nodeId, authorizedBy: ownerId, idempotencyKey, preferences });
		} catch (error: unknown) {
			if (error instanceof WorkflowAgentPreferencesConflictError) {
				return c.json({ error: error.message, code: "workflow_agent_preferences_idempotency_conflict" }, 409);
			}
			throw error;
		}
		if (!saved.created) {
			return c.json({ ...responseScope, ...saved, applicationStatus: "receipt_already_recorded", appliedToActiveRequest: false });
		}
		try {
			if (observationError !== null) throw new Error(observationError);
			if (turns.length === 0) {
				const pending = nodeId !== null && target?.status !== "queued" && observedSessionCount === 0;
				return c.json({ ...responseScope, ...saved, applicationStatus: "pending_next_model_request", appliedToActiveRequest: false,
					...(pending ? { code: "workflow_agent_preferences_active_turn_unresolved", error: "Preferences were saved, but the active physical turn could not be identified; its current request has not been interrupted" } : {}),
				}, 202);
			}
			const interruptions = await services.interruptTurns({ context: c as unknown as AppContext, userId: ownerId, targets: turns, interruptReasonCode: "provider_stream_interrupted" });
			const pending = interruptions.some((result) => result.status === "failed");
			return c.json({ ...responseScope, ...saved, applicationStatus: pending ? "pending_interrupt" : "continuation_requested", appliedToActiveRequest: false, interruptions,
				...(pending ? { code: "workflow_agent_preferences_interrupt_pending", error: "Preferences were saved, but interruption has an unknown or failed outcome; the original workflow and draft are retained" } : {}),
			}, 202);
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			console.error(JSON.stringify({ message: "workflow_agent_preferences_interrupt_failed", executionId, nodeId, idempotencyKey, error: message, receiptRetained: true }));
			return c.json({ ...responseScope, ...saved, applicationStatus: "pending_interrupt", appliedToActiveRequest: false, code: "workflow_agent_preferences_interrupt_pending", error: message }, 202);
		}
	});
	return router;
}

export const workflowAgentPreferencesRouter = createWorkflowAgentPreferencesRouter();
