import { isDeepStrictEqual } from "node:util";
import { queryOne } from "../../db/db";
import type { PrismaClient } from "../../types";

export type WorkflowAgentSettledResult = Readonly<{
	traceId: string;
	publicTurnId: string;
	text: string;
	meta: Record<string, unknown>;
}>;

function record(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? value as Record<string, unknown> : null;
}

/** Read one exact physical identity, including its durable continuation results.
 * A session's latest turn is mutable; a settled response and its accepted
 * contract remain addressable after a successor takes over that session.
 */
export async function readWorkflowAgentSettledResult(db: PrismaClient, input: Readonly<{
	ownerId: string;
	sessionKey: string;
	publicTurnIds: readonly string[];
	outputContract: unknown;
}>): Promise<WorkflowAgentSettledResult | null> {
	if (input.publicTurnIds.length === 0) return null;
	const row = await queryOne<{ trace_id: string; public_turn_id: string; response_text: string | null; meta_json: string;
		output_contract: unknown }>(db, `
		SELECT trace.id AS trace_id, trace.logical_task_id AS public_turn_id,
		       terminal.payload_json::jsonb #>> '{response,text}' AS response_text,
		       trace.meta_json,
		       accepted.payload_json::jsonb #> '{recoveryContext,continuationExecutionContract,outputContract}' AS output_contract
		FROM execution_traces trace
		JOIN LATERAL (
			SELECT event.payload_json FROM execution_trace_events event
			WHERE event.trace_id = trace.id AND event.user_id = trace.user_id
			  AND event.event_type = 'response.completed' AND event.status = 'succeeded'
			  AND event.payload_truncated = false
			ORDER BY event.seq DESC LIMIT 1
		) terminal ON true
		JOIN LATERAL (
			SELECT event.payload_json FROM execution_trace_events event
			WHERE event.trace_id = trace.id AND event.user_id = trace.user_id
			  AND event.event_type = 'request.accepted' AND event.payload_truncated = false
			ORDER BY event.seq ASC LIMIT 1
		) accepted ON true
		WHERE trace.user_id = ? AND trace.session_key = ?
		  AND trace.logical_task_id IN (${input.publicTurnIds.map(() => "?").join(",")})
		  AND trace.root_trace_id = trace.logical_task_id
		  AND trace.status = 'succeeded'
		  AND trace.meta_json::jsonb #>> '{requestTerminal,status}' = 'succeeded'
		ORDER BY trace.finished_at DESC, trace.id DESC LIMIT 1`,
	[input.ownerId, input.sessionKey, ...input.publicTurnIds]);
	if (!row || typeof row.response_text !== "string" || !row.response_text.trim()
		|| !isDeepStrictEqual(row.output_contract ?? null, input.outputContract ?? null)) return null;
	const meta = record(JSON.parse(row.meta_json) as unknown);
	if (!meta) throw new Error("workflow_agent_settled_result_meta_invalid");
	return { traceId: row.trace_id, publicTurnId: row.public_turn_id, text: row.response_text, meta };
}
