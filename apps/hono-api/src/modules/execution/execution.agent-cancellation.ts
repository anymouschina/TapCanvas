import type { AppContext, PrismaClient } from "../../types";
import { cancelActiveSessionAgentContinuations } from "../task/async-agent-continuation";
import {
	buildInflightChatTurnKey,
	interruptInflightChatTurn,
} from "../task/chat-turn-inflight";
import { coordinatePublicChatInterrupt } from "../task/chat-interrupt-coordinator";
import { interruptAgentsChatTurn } from "../task/task.agents-chat-runtime";
import type { NodeRunRow } from "./execution.repo";

const WORKFLOW_AGENT_INTERRUPT_DEADLINE_MS = 10_000;

export type WorkflowAgentTurnIdentity = Readonly<{
	sessionId: string;
	turnId: string;
	nodeId: string;
	runtimeNodeId: string;
}>;

export type WorkflowAgentTurnCancellationResult = Readonly<{
	target: WorkflowAgentTurnIdentity;
	status: "interrupted" | "already_inactive" | "failed";
	receipt: Readonly<{
		localTransport: "interrupted" | "not_running" | "failed";
		runtime: "interrupted" | "already_inactive" | "unknown" | "failed";
		continuations: "cancelled" | "none" | "failed";
		localTransportError: Readonly<{ code: string; message: string }> | null;
		runtimeError: Readonly<{ code: string; message: string }> | null;
		continuationsError: Readonly<{ code: string; message: string }> | null;
	}> | null;
	errorCode: string | null;
	errorMessage: string | null;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseOutputRefs(value: string | null): Record<string, unknown> | null {
	if (!value) return null;
	try {
		const parsed: unknown = JSON.parse(value);
		return isRecord(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

function nonEmptyString(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function identityFromEvidence(input: Readonly<{
	nodeId: string;
	runtimeNodeId: string;
	evidence: unknown;
}>): WorkflowAgentTurnIdentity | null {
	const evidence = isRecord(input.evidence) ? input.evidence : null;
	const deliveryEvidence = evidence && isRecord(evidence.deliveryEvidence)
		? evidence.deliveryEvidence
		: null;
	const sessionId = nonEmptyString(deliveryEvidence?.sessionKey);
	const turnId = nonEmptyString(deliveryEvidence?.logicalTaskId);
	if (!sessionId || !turnId) return null;
	return {
		sessionId,
		turnId,
		nodeId: input.nodeId,
		runtimeNodeId: input.runtimeNodeId,
	};
}

/**
 * Reads only persisted protocol evidence. Node labels and domain-specific IDs are
 * deliberately ignored so cancellation applies to every workflow Agent node.
 */
export function collectWorkflowAgentTurnIdentities(
	rows: readonly NodeRunRow[],
): readonly WorkflowAgentTurnIdentity[] {
	const identities = new Map<string, WorkflowAgentTurnIdentity>();
	for (const row of rows) {
		if (row.status !== "running" && row.status !== "waiting_external") continue;
		const output = parseOutputRefs(row.output_refs);
		if (!output) continue;
		const topLevel = identityFromEvidence({
			nodeId: row.node_id,
			runtimeNodeId: row.node_id,
			evidence: output.evidence,
		});
		if (topLevel) identities.set(`${topLevel.sessionId}\u0000${topLevel.turnId}`, topLevel);
		const itemRuns = Array.isArray(output.itemRuns) ? output.itemRuns : [];
		for (const itemRun of itemRuns) {
			if (!isRecord(itemRun) || itemRun.status !== "waiting_external") continue;
			const runtimeNodeId = nonEmptyString(itemRun.runtimeNodeId) ?? row.node_id;
			const identity = identityFromEvidence({
				nodeId: row.node_id,
				runtimeNodeId,
				evidence: itemRun.evidence,
			});
			if (identity) identities.set(`${identity.sessionId}\u0000${identity.turnId}`, identity);
		}
	}
	return [...identities.values()];
}

export async function listActiveWorkflowAgentTurnIdentities(input: Readonly<{
	db: PrismaClient;
	userId: string;
	executionId: string;
}>): Promise<readonly WorkflowAgentTurnIdentity[]> {
	const prefix = `workflow:${input.executionId}:`;
	const rows = await input.db.execution_traces.findMany({
		where: {
			user_id: input.userId,
			session_key: { startsWith: prefix },
			status: { in: ["running", "waiting_async"] },
		},
		select: {
			session_key: true,
			logical_task_id: true,
		},
	});
	return rows.flatMap((row) => {
		const sessionId = nonEmptyString(row.session_key);
		const turnId = nonEmptyString(row.logical_task_id);
		if (!sessionId || !turnId || !sessionId.startsWith(prefix)) return [];
		const runtimeNodeId = sessionId.slice(prefix.length);
		if (!runtimeNodeId) return [];
		return [{ sessionId, turnId, nodeId: runtimeNodeId, runtimeNodeId }];
	});
}

export function mergeWorkflowAgentTurnIdentities(
	...groups: ReadonlyArray<readonly WorkflowAgentTurnIdentity[]>
): readonly WorkflowAgentTurnIdentity[] {
	const identities = new Map<string, WorkflowAgentTurnIdentity>();
	for (const identity of groups.flat()) {
		identities.set(`${identity.sessionId}\u0000${identity.turnId}`, identity);
	}
	return [...identities.values()];
}

function errorFacts(error: unknown): Readonly<{ code: string | null; message: string }> {
	if (isRecord(error)) {
		return {
			code: nonEmptyString(error.code),
			message: nonEmptyString(error.message) ?? String(error),
		};
	}
	return {
		code: null,
		message: error instanceof Error ? error.message : String(error),
	};
}

export async function cancelWorkflowAgentTurns(input: Readonly<{
	context: AppContext;
	userId: string;
	targets: readonly WorkflowAgentTurnIdentity[];
	interruptReasonCode?:
		| "chat_turn_user_interrupt"
		| "provider_stream_interrupted"
		| "video_production_start_deadline_exceeded";
}>): Promise<readonly WorkflowAgentTurnCancellationResult[]> {
	return Promise.all(input.targets.map(async (target): Promise<WorkflowAgentTurnCancellationResult> => {
		try {
			const inflightKey = buildInflightChatTurnKey(input.userId, target.sessionId);
			const receipt = await coordinatePublicChatInterrupt({
				sessionKey: target.sessionId,
				turnId: target.turnId,
				dependencies: {
					interruptLocalTransport: () => interruptInflightChatTurn(
						inflightKey,
						target.turnId,
						input.interruptReasonCode ?? "chat_turn_user_interrupt",
					),
					interruptRuntime: () => interruptAgentsChatTurn(input.context, input.userId, {
						sessionId: target.sessionId,
						turnId: target.turnId,
						reasonCode: input.interruptReasonCode ?? "chat_turn_user_interrupt",
					}, {
						timeoutMs: WORKFLOW_AGENT_INTERRUPT_DEADLINE_MS,
					}),
					cancelContinuations: () => cancelActiveSessionAgentContinuations({
						c: input.context,
						userId: input.userId,
						sessionKey: target.sessionId,
						rootRequestId: target.turnId,
						scope: "all",
					}),
				},
			});
			const compactReceipt = {
				localTransport: receipt.localTransport.status,
				runtime: receipt.runtime.status,
				continuations: receipt.continuations.status,
				localTransportError: receipt.localTransport.status === "failed"
					? { code: receipt.localTransport.error.code, message: receipt.localTransport.error.message }
					: null,
				runtimeError: receipt.runtime.status === "failed" || receipt.runtime.status === "unknown"
					? { code: receipt.runtime.error.code, message: receipt.runtime.error.message }
					: null,
				continuationsError: receipt.continuations.status === "failed"
					? { code: receipt.continuations.error.code, message: receipt.continuations.error.message }
					: null,
			} as const;
			if (!receipt.fullyInterrupted) {
				return {
					target,
					status: "failed",
					receipt: compactReceipt,
					errorCode: "workflow_agent_turn_partial_interrupt",
					errorMessage: "One or more workflow Agent cancellation planes have an unknown or failed outcome",
				};
			}
			return {
				target,
				status: receipt.interrupted ? "interrupted" : "already_inactive",
				receipt: compactReceipt,
				errorCode: null,
				errorMessage: null,
			};
		} catch (error: unknown) {
			const facts = errorFacts(error);
			return {
				target,
				status: "failed",
				receipt: null,
				errorCode: facts.code,
				errorMessage: facts.message,
			};
		}
	}));
}
