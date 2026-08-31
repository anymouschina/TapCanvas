import type { AppContext } from "../../types";
import { cancelWorkflowExecutionsOwnedByChatTurn } from "../execution/execution.cancel-service";
import { getExecutionTraceLifecycleSnapshot } from "../memory/execution-trace-events.repo";
import {
	cancelActiveSessionAgentContinuations,
	findAsyncAgentContinuationForPublicTurn,
} from "./async-agent-continuation";
import {
	inspectPublicChatVideoProductionStart,
	recordPublicChatVideoProductionStartDeadlineObservation,
} from "./public-chat-video-production-deadline";
import type { PublicChatVideoProductionDeadlineJob } from "./public-chat-video-production-deadline.queue";
import {
	getAgentsChatTurnStatus,
	interruptAgentsChatTurn,
} from "./task.agents-chat-runtime";

const PUBLIC_CHAT_VIDEO_PRODUCTION_DEADLINE_INTERRUPT_MS = 10_000;

export type PublicChatVideoProductionDeadlineTermination = Readonly<{
	workflowExecutionsMatched: number;
	workflowExecutionsCancelled: number;
	continuationsCancelled: number;
	runtimeTurn: "failed" | "not_current";
}>;

export type PublicChatVideoProductionDeadlineOutcome = Readonly<{
	status: "not_applicable" | "started" | "failed";
	publicTurnId: string;
	providerAcceptedAt: string | null;
	termination: PublicChatVideoProductionDeadlineTermination | null;
}>;

async function terminateOverdueVideoProductionAttempt(input: Readonly<{
	c: AppContext;
	job: PublicChatVideoProductionDeadlineJob;
	snapshot: Awaited<ReturnType<typeof getAgentsChatTurnStatus>>;
}>): Promise<PublicChatVideoProductionDeadlineTermination> {
	const ownsCurrentTurn = input.snapshot.turn?.turnId === input.job.publicTurnId;
	const agentExecutionIds = ownsCurrentTurn
		? input.snapshot.turn?.executionProvenanceHistory
			?.map((item) => item.executionId.trim())
			.filter(Boolean) ?? []
		: [];
	const workflowCancellation = cancelWorkflowExecutionsOwnedByChatTurn({
		context: input.c,
		userId: input.job.userId,
		sessionKey: input.job.sessionKey,
		publicTurnId: input.job.publicTurnId,
		agentExecutionIds,
		actor: {
			reasonCode: "video_production_start_deadline_exceeded",
			actorType: "deadline_enforcer",
			actorId: input.job.publicTurnId,
		},
	});
	const continuationCancellation = cancelActiveSessionAgentContinuations({
		c: input.c,
		userId: input.job.userId,
		sessionKey: input.job.sessionKey,
		rootRequestId: input.job.publicTurnId,
		scope: "all",
	});
	const runtimeInterruption = ownsCurrentTurn
		? interruptAgentsChatTurn(input.c, input.job.userId, {
			sessionId: input.job.sessionKey,
			turnId: input.job.publicTurnId,
			reasonCode: "video_production_start_deadline_exceeded",
		}, {
			timeoutMs: PUBLIC_CHAT_VIDEO_PRODUCTION_DEADLINE_INTERRUPT_MS,
		})
		: Promise.resolve(null);
	const [workflows, continuations] = await Promise.all([
		workflowCancellation,
		continuationCancellation,
		runtimeInterruption,
	]).then(([workflowResult, continuationResult]) => [workflowResult, continuationResult] as const);
	if (!workflows.fullyInterrupted) {
		throw new Error(
			`public_chat_video_production_deadline_workflow_interruption_incomplete:${input.job.publicTurnId}`,
		);
	}
	return {
		workflowExecutionsMatched: workflows.matchedCount,
		workflowExecutionsCancelled: workflows.cancelledCount,
		continuationsCancelled: continuations,
		runtimeTurn: ownsCurrentTurn ? "failed" : "not_current",
	};
}

export async function enforcePublicChatVideoProductionDeadline(
	c: AppContext,
	job: PublicChatVideoProductionDeadlineJob,
): Promise<PublicChatVideoProductionDeadlineOutcome> {
	if (job.version !== 2) {
		throw new Error("public_chat_video_production_deadline_job_version_invalid");
	}
	const lifecycle = await getExecutionTraceLifecycleSnapshot(c.env.DB, {
		traceId: job.rootTraceId,
		userId: job.userId,
	});
	const snapshot = await getAgentsChatTurnStatus(c, job.userId, job.sessionKey, { timeoutMs: 10_000 });
	const continuation = await findAsyncAgentContinuationForPublicTurn({
		c,
		userId: job.userId,
		sessionKey: job.sessionKey,
		rootRequestId: job.publicTurnId,
	});
	const recoveryCheckpoint = snapshot.turn?.turnId === job.publicTurnId
		? snapshot.turn.recoveryCheckpoint
		: null;
	const userIntentContract = job.userIntentContract
		?? (snapshot.turn?.turnId === job.publicTurnId ? snapshot.turn.userIntentContract : null)
		?? recoveryCheckpoint?.userIntentContract
		?? continuation?.userIntentContract
		?? null;
	if (!userIntentContract) {
		if (lifecycle?.status === "running" || lifecycle?.status === "waiting_async") {
			throw new Error(
				`public_chat_video_production_deadline_intent_pending:${job.deadlineAt}`,
			);
		}
		return {
			status: "not_applicable",
			publicTurnId: job.publicTurnId,
			providerAcceptedAt: null,
			termination: null,
		};
	}
	const production = await inspectPublicChatVideoProductionStart({
		db: c.env.DB,
		userId: job.userId,
		sessionKey: job.sessionKey,
		publicTurnId: job.publicTurnId,
		rootTraceId: job.rootTraceId,
		userIntentContract,
		durableTaskReferences: job.durableTaskReferences
			?? recoveryCheckpoint?.durableTaskReferences
			?? continuation?.durableTaskReferences,
	});
	if (!production) {
		return {
			status: "not_applicable",
			publicTurnId: job.publicTurnId,
			providerAcceptedAt: null,
			termination: null,
		};
	}
	if (production.status === "waiting") {
		throw new Error(`public_chat_video_production_deadline_fired_early:${production.deadlineAt}`);
	}
	if (production.status === "started") {
		return {
			status: "started",
			publicTurnId: job.publicTurnId,
			providerAcceptedAt: production.providerAcceptedAt,
			termination: null,
		};
	}
	await recordPublicChatVideoProductionStartDeadlineObservation({
		db: c.env.DB,
		userId: job.userId,
		publicTurnId: job.publicTurnId,
		rootTraceId: job.rootTraceId,
		production,
		scheduledDeadlineAt: job.deadlineAt,
	});
	const termination = await terminateOverdueVideoProductionAttempt({ c, job, snapshot });
	return {
		status: "failed",
		publicTurnId: job.publicTurnId,
		providerAcceptedAt: production.providerAcceptedAt,
		termination,
	};
}
