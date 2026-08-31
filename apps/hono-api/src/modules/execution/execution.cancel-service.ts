import type { AppContext } from "../../types";
import {
	cancelWorkflowAgentTurns,
	collectWorkflowAgentTurnIdentities,
	listActiveWorkflowAgentTurnIdentities,
	mergeWorkflowAgentTurnIdentities,
} from "./execution.agent-cancellation";
import { cancelActiveWorkflowNodeJobs } from "./execution.queue";
import {
	getExecutionForOwner,
	listNodeRunsForExecutionOwner,
	mapExecutionRow,
} from "./execution.repo";

type WorkflowCancellationActor =
	| Readonly<{
		reasonCode: "user_requested";
		actorType: "owner_admin" | "owner_eval" | "owning_chat_turn";
		actorId: string;
	}>
	| Readonly<{
		reasonCode: "video_production_start_deadline_exceeded";
		actorType: "deadline_enforcer";
		actorId: string;
	}>;

export type WorkflowExecutionCancellationResult = Readonly<{
	execution: ReturnType<typeof mapExecutionRow>;
	receipt: unknown;
	localAbortedJobs: number;
	agentTurnCancellations: Awaited<ReturnType<typeof cancelWorkflowAgentTurns>>;
	familyCanceledExecutionIds: readonly string[];
	fullyInterrupted: boolean;
}>;

function parseInvocationInput(value: string | null): Record<string, unknown> | null {
	if (!value) return null;
	try {
		const parsed: unknown = JSON.parse(value);
		return parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? parsed as Record<string, unknown>
			: null;
	} catch {
		return null;
	}
}

type CancelWorkflowExecutionInput = Readonly<{
	context: AppContext;
	userId: string;
	executionId: string;
	actor: WorkflowCancellationActor;
}>;

type ExactWorkflowExecutionCancellationResult = Omit<
	WorkflowExecutionCancellationResult,
	"familyCanceledExecutionIds"
>;

async function cancelExactWorkflowExecutionForOwner(
	input: CancelWorkflowExecutionInput,
): Promise<ExactWorkflowExecutionCancellationResult | null> {
	const execution = await getExecutionForOwner(input.context.env.DB, input.executionId, input.userId);
	if (!execution) return null;
	const activeNodeRuns = await listNodeRunsForExecutionOwner(input.context.env.DB, {
		ownerId: input.userId,
		executionId: input.executionId,
	});
	const traceTurnTargets = await listActiveWorkflowAgentTurnIdentities({
		db: input.context.env.DB,
		userId: input.userId,
		executionId: input.executionId,
	});
	const agentTurnTargets = mergeWorkflowAgentTurnIdentities(
		collectWorkflowAgentTurnIdentities(activeNodeRuns),
		traceTurnTargets,
	);
	const namespace = input.context.env.EXECUTION_DO;
	if (!namespace) throw new Error("Workflow execution runtime bindings are unavailable");
	const stub = namespace.get(namespace.idFromName(input.executionId));
	const response = await stub.fetch("https://do/cancel", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(input.actor),
	});
	if (!response.ok) {
		const detail = (await response.text().catch(() => "")).trim();
		throw new Error(detail || `Workflow cancellation failed with HTTP ${response.status}`);
	}
	const receipt: unknown = await response.json().catch(() => null);
	const localAbortedJobs = cancelActiveWorkflowNodeJobs(input.executionId);
	const agentTurnCancellations = await cancelWorkflowAgentTurns({
		context: input.context,
		userId: input.userId,
		targets: agentTurnTargets,
		...(input.actor.reasonCode === "video_production_start_deadline_exceeded"
			? { interruptReasonCode: "video_production_start_deadline_exceeded" as const }
			: {}),
	});
	const refreshed = await getExecutionForOwner(input.context.env.DB, input.executionId, input.userId);
	if (!refreshed) throw new Error("Execution not found after cancellation");
	return {
		execution: mapExecutionRow(refreshed),
		receipt,
		localAbortedJobs,
		agentTurnCancellations,
		fullyInterrupted: agentTurnCancellations.every((result) => result.status !== "failed"),
	};
}

/**
 * Cancels one owner-scoped logical workflow family. A recovery child is not a
 * separate user goal, so it must not survive cancellation of its source run.
 * Recovery creation locks the source row; this post-cancel family scan is the
 * other half of that race contract and catches a child that won the lock first.
 */
export async function cancelWorkflowExecutionForOwner(
	input: CancelWorkflowExecutionInput,
): Promise<WorkflowExecutionCancellationResult | null> {
	const primary = await cancelExactWorkflowExecutionForOwner(input);
	if (!primary) return null;
	const familyId = primary.execution.executionFamilyId;
	const activeFamilyMembers = await input.context.env.DB.workflow_executions.findMany({
		where: {
			execution_family_id: familyId,
			owner_id: input.userId,
			id: { not: input.executionId },
			status: { in: ["queued", "running"] },
		},
		select: { id: true },
		orderBy: [{ created_at: "asc" }, { id: "asc" }],
	});
	const familyResults: ExactWorkflowExecutionCancellationResult[] = [];
	for (const member of activeFamilyMembers) {
		const result = await cancelExactWorkflowExecutionForOwner({
			...input,
			executionId: member.id,
		});
		if (result) familyResults.push(result);
	}
	return {
		...primary,
		familyCanceledExecutionIds: familyResults
			.filter((result) => result.execution.status === "canceled")
			.map((result) => result.execution.id),
		fullyInterrupted: primary.fullyInterrupted
			&& familyResults.every((result) => result.fullyInterrupted),
	};
}

/**
 * Resolves workflow ownership from persisted invocation facts. Exact publicTurnId
 * is authoritative; agent execution ids cover invocations created before that
 * field was added to the invocation journal.
 */
export async function listActiveWorkflowExecutionIdsForChatTurn(input: Readonly<{
	context: AppContext;
	userId: string;
	sessionKey: string;
	publicTurnId: string;
	agentExecutionIds: readonly string[];
}>): Promise<string[]> {
	const rows = await input.context.env.DB.agent_capability_invocations.findMany({
		where: { user_id: input.userId, session_id: input.sessionKey },
		orderBy: { created_at: "desc" },
		take: 100,
		include: { workflow_executions: true },
	});
	const acceptedAgentExecutionIds = new Set(input.agentExecutionIds.map((id) => id.trim()).filter(Boolean));
	return rows.flatMap((row) => {
		if (row.workflow_executions.status !== "queued" && row.workflow_executions.status !== "running") return [];
		const invocationInput = parseInvocationInput(row.input_json);
		const invocationTurnId = typeof invocationInput?.publicTurnId === "string"
			? invocationInput.publicTurnId.trim()
			: "";
		const exactTurnMatch = invocationTurnId === input.publicTurnId;
		const legacyExecutionMatch = !invocationTurnId
			&& typeof row.agent_execution_id === "string"
			&& acceptedAgentExecutionIds.has(row.agent_execution_id.trim());
		return exactTurnMatch || legacyExecutionMatch ? [row.workflow_execution_id] : [];
	});
}

export async function cancelWorkflowExecutionsOwnedByChatTurn(input: Readonly<{
	context: AppContext;
	userId: string;
	sessionKey: string;
	publicTurnId: string;
	agentExecutionIds: readonly string[];
	actor?: WorkflowCancellationActor;
}>): Promise<Readonly<{
	matchedCount: number;
	cancelledCount: number;
	executionIds: string[];
	fullyInterrupted: boolean;
}>> {
	const executionIds = await listActiveWorkflowExecutionIdsForChatTurn(input);
	const results = await Promise.all(executionIds.map((executionId) => cancelWorkflowExecutionForOwner({
		context: input.context,
		userId: input.userId,
		executionId,
		actor: input.actor ?? { reasonCode: "user_requested", actorType: "owning_chat_turn", actorId: input.publicTurnId },
	})));
	return {
		matchedCount: executionIds.length,
		cancelledCount: results.filter((result) => result?.execution.status === "canceled").length,
		executionIds,
		fullyInterrupted: results.every((result) => result !== null && result.fullyInterrupted),
	};
}
