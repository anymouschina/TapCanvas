import { createHash } from "node:crypto";
import { z } from "zod";
import type { PrismaClient } from "../../types";
import { readDatabaseErrorCodes } from "../../platform/node/database-read-retry";
import { insertExecutionEvent } from "./execution.repo";

const nonEmptyIdentity = z.string().min(1).refine(value => value.trim().length > 0);
export const workflowAgentPreferencesSchema = z.object({
	reasoningEffort: z.enum(["none", "minimal", "low", "medium", "high", "xhigh", "max"]),
}).strict();

export const workflowAgentPreferencesRequestSchema = z.object({
	// An explicit null applies to every Agent in this execution, including
	// runtime nodes instantiated later by a pipeline. Omission is invalid.
	nodeId: nonEmptyIdentity.nullable(),
	idempotencyKey: nonEmptyIdentity,
	preferences: workflowAgentPreferencesSchema,
}).strict();

const receiptSchema = workflowAgentPreferencesRequestSchema.extend({
	version: z.literal(1),
	executionId: nonEmptyIdentity,
	authorizedBy: nonEmptyIdentity,
	requestedAt: z.string().datetime({ offset: true }),
}).strict();

export type WorkflowAgentPreferences = z.infer<typeof workflowAgentPreferencesSchema>;
export type WorkflowAgentPreferencesReceipt = z.infer<typeof receiptSchema>;
export type WorkflowAgentPreferencesWriteResult = Readonly<{
	receipt: WorkflowAgentPreferencesReceipt;
	created: boolean;
}>;

const EVENT_TYPE = "agent_preferences_changed";
type PreferenceEvent = Readonly<{
	id: string; execution_id: string; node_id: string | null; event_type: string; data: string | null;
}>;

export class WorkflowAgentPreferencesConflictError extends Error {
	readonly code = "workflow_agent_preferences_idempotency_conflict";
	constructor() {
		super("The workflow agent preferences idempotency key already identifies a different request.");
		this.name = "WorkflowAgentPreferencesConflictError";
	}
}

function preferenceEventId(scope: Pick<WorkflowAgentPreferencesReceipt, "authorizedBy" | "executionId" | "idempotencyKey">): string {
	return `agent-preferences:${createHash("sha256").update(JSON.stringify([
		scope.authorizedBy, scope.executionId, scope.idempotencyKey,
	])).digest("hex")}`;
}

function inspectReceipt(event: PreferenceEvent, scope: Readonly<{
	executionId: string; nodeId?: string; ownerId: string;
}>): WorkflowAgentPreferencesReceipt {
	let receipt: WorkflowAgentPreferencesReceipt;
	try {
		receipt = receiptSchema.parse(JSON.parse(event.data ?? "null") as unknown);
	} catch (cause) {
		throw new Error("workflow_agent_preferences_receipt_invalid", { cause });
	}
	if (event.event_type !== EVENT_TYPE || event.execution_id !== scope.executionId
		|| receipt.executionId !== scope.executionId || receipt.authorizedBy !== scope.ownerId
		|| receipt.nodeId !== event.node_id || (scope.nodeId !== undefined && receipt.nodeId !== null && receipt.nodeId !== scope.nodeId)
		|| event.id !== preferenceEventId(receipt)) {
		throw new Error("workflow_agent_preferences_receipt_scope_mismatch");
	}
	return receipt;
}

/** Append the explicit request; this receipt does not assert an active request has changed. */
export async function writeWorkflowAgentPreferences(db: PrismaClient, input: Readonly<{
	executionId: string; nodeId: string | null; authorizedBy: string;
	idempotencyKey: string; preferences: WorkflowAgentPreferences;
}>): Promise<WorkflowAgentPreferencesWriteResult> {
	const requested = receiptSchema.parse({ version: 1, ...input, requestedAt: new Date().toISOString() });
	const id = preferenceEventId(requested);
	const reuse = (event: PreferenceEvent): WorkflowAgentPreferencesWriteResult => {
		const receipt = inspectReceipt(event, { executionId: requested.executionId, ownerId: requested.authorizedBy });
		if (receipt.idempotencyKey !== requested.idempotencyKey || receipt.nodeId !== requested.nodeId
			|| receipt.preferences.reasoningEffort !== requested.preferences.reasoningEffort) {
			throw new WorkflowAgentPreferencesConflictError();
		}
		return { receipt, created: false };
	};
	const existing = await db.workflow_execution_events.findUnique({ where: { id } });
	if (existing) return reuse(existing);
	try {
		await insertExecutionEvent(db, {
			id, executionId: requested.executionId, nodeId: requested.nodeId,
			eventType: EVENT_TYPE, message: "Explicit workflow agent preferences requested.",
			data: requested, nowIso: requested.requestedAt,
		});
	} catch (error) {
		const codes = readDatabaseErrorCodes(error);
		if (!codes.includes("P2002") && !codes.includes("23505")) throw error;
		const winner = await db.workflow_execution_events.findUnique({ where: { id } });
		if (!winner) throw error;
		return reuse(winner);
	}
	return { receipt: requested, created: true };
}

/** Latest applicable explicit request wins; execution scope never crosses executions. */
export async function readWorkflowAgentPreferences(db: PrismaClient, scope: Readonly<{
	executionId: string; nodeId: string; ownerId: string;
}>): Promise<WorkflowAgentPreferencesReceipt | null> {
	const event = await db.workflow_execution_events.findFirst({
		where: { execution_id: scope.executionId, OR: [{ node_id: scope.nodeId }, { node_id: null }], event_type: EVENT_TYPE,
			workflow_executions: { owner_id: scope.ownerId } },
		orderBy: { seq: "desc" },
	});
	return event ? inspectReceipt(event, scope) : null;
}
