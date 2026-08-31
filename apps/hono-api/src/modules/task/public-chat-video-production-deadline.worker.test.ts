import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	getAgentsChatTurnStatus: vi.fn(),
	interruptAgentsChatTurn: vi.fn(),
	findAsyncAgentContinuationForPublicTurn: vi.fn(),
	cancelActiveSessionAgentContinuations: vi.fn(),
	cancelWorkflowExecutionsOwnedByChatTurn: vi.fn(),
	inspectPublicChatVideoProductionStart: vi.fn(),
	recordPublicChatVideoProductionStartDeadlineObservation: vi.fn(),
	getExecutionTraceLifecycleSnapshot: vi.fn(),
}));

vi.mock("./task.agents-chat-runtime", () => ({
	getAgentsChatTurnStatus: mocks.getAgentsChatTurnStatus,
	interruptAgentsChatTurn: mocks.interruptAgentsChatTurn,
}));
vi.mock("./async-agent-continuation", () => ({
	ASYNC_AGENT_CONTINUATION_PROVIDER: "agents_async_continuation",
	findAsyncAgentContinuationForPublicTurn: mocks.findAsyncAgentContinuationForPublicTurn,
	cancelActiveSessionAgentContinuations: mocks.cancelActiveSessionAgentContinuations,
}));
vi.mock("../execution/execution.cancel-service", () => ({
	cancelWorkflowExecutionsOwnedByChatTurn: mocks.cancelWorkflowExecutionsOwnedByChatTurn,
}));
vi.mock("./public-chat-video-production-deadline", () => ({
	inspectPublicChatVideoProductionStart: mocks.inspectPublicChatVideoProductionStart,
	recordPublicChatVideoProductionStartDeadlineObservation: mocks.recordPublicChatVideoProductionStartDeadlineObservation,
}));
vi.mock("../memory/execution-trace-events.repo", () => ({
	getExecutionTraceLifecycleSnapshot: mocks.getExecutionTraceLifecycleSnapshot,
}));

import { enforcePublicChatVideoProductionDeadline } from "./public-chat-video-production-deadline.worker";

const contract = { contractHash: "contract-1", delivery: { mode: "async_artifact", mediaType: "video" } };
const job = {
	version: 2 as const,
	userId: "user-1",
	sessionKey: "session-1",
	publicTurnId: "turn-1",
	rootTraceId: "turn-1",
	deadlineAt: "2026-08-28T00:05:00.000Z",
	userIntentContract: contract,
};
const context = { env: { DB: {} } } as never;

describe("public chat video production deadline worker", () => {
	beforeEach(() => {
		for (const mock of Object.values(mocks)) mock.mockReset();
		mocks.getAgentsChatTurnStatus.mockResolvedValue({ activeTurn: false, turn: null });
		mocks.findAsyncAgentContinuationForPublicTurn.mockResolvedValue(null);
		mocks.getExecutionTraceLifecycleSnapshot.mockResolvedValue({ status: "waiting_async" });
		mocks.recordPublicChatVideoProductionStartDeadlineObservation.mockResolvedValue(undefined);
		mocks.cancelWorkflowExecutionsOwnedByChatTurn.mockResolvedValue({
			matchedCount: 1,
			cancelledCount: 1,
			executionIds: ["workflow-1"],
			fullyInterrupted: true,
		});
		mocks.cancelActiveSessionAgentContinuations.mockResolvedValue(1);
		mocks.interruptAgentsChatTurn.mockResolvedValue({
			ok: true,
			interrupted: true,
			sessionId: "session-1",
			turnId: "turn-1",
			status: null,
		});
	});

	it("retries when an active turn has not frozen its intent contract yet", async () => {
		await expect(enforcePublicChatVideoProductionDeadline(context, {
			...job,
			userIntentContract: undefined,
		})).rejects.toThrow("public_chat_video_production_deadline_intent_pending");
		expect(mocks.inspectPublicChatVideoProductionStart).not.toHaveBeenCalled();
	});

	it("does nothing when a terminal turn has no frozen video intent contract", async () => {
		mocks.getExecutionTraceLifecycleSnapshot.mockResolvedValue({ status: "succeeded" });
		const outcome = await enforcePublicChatVideoProductionDeadline(context, {
			...job,
			userIntentContract: undefined,
		});

		expect(outcome.status).toBe("not_applicable");
		expect(mocks.inspectPublicChatVideoProductionStart).not.toHaveBeenCalled();
	});

	it("reads the frozen contract from an active turn without requiring a recovery checkpoint", async () => {
		mocks.getAgentsChatTurnStatus.mockResolvedValue({
			activeTurn: true,
			turn: { turnId: "turn-1", userIntentContract: contract, recoveryCheckpoint: null },
		});
		mocks.inspectPublicChatVideoProductionStart.mockResolvedValue({
			status: "started",
			providerAcceptedAt: "2026-08-28T00:04:59.000Z",
		});

		const outcome = await enforcePublicChatVideoProductionDeadline(context, {
			...job,
			userIntentContract: undefined,
		});

		expect(outcome.status).toBe("started");
		expect(mocks.inspectPublicChatVideoProductionStart).toHaveBeenCalledWith(
			expect.objectContaining({ userIntentContract: contract }),
		);
	});

	it("preserves a provider task accepted before the deadline", async () => {
		mocks.inspectPublicChatVideoProductionStart.mockResolvedValue({
			status: "started",
			providerAcceptedAt: "2026-08-28T00:04:59.000Z",
		});

		const outcome = await enforcePublicChatVideoProductionDeadline(context, job);

		expect(outcome).toMatchObject({
			status: "started",
			providerAcceptedAt: "2026-08-28T00:04:59.000Z",
		});
		expect(mocks.recordPublicChatVideoProductionStartDeadlineObservation).not.toHaveBeenCalled();
	});

	it("does not terminate when the initial probe arrives before the execution-anchored deadline", async () => {
		mocks.inspectPublicChatVideoProductionStart.mockResolvedValue({
			version: 6,
			status: "waiting",
			anchor: "workflow_execution_created",
			acceptedAt: "2026-08-28T00:02:00.000Z",
			deadlineAt: "2026-08-28T00:07:00.000Z",
			providerAcceptedAt: null,
		});

		await expect(enforcePublicChatVideoProductionDeadline(context, job))
			.rejects.toThrow("public_chat_video_production_deadline_fired_early:2026-08-28T00:07:00.000Z");
		expect(mocks.recordPublicChatVideoProductionStartDeadlineObservation).not.toHaveBeenCalled();
		expect(mocks.cancelWorkflowExecutionsOwnedByChatTurn).not.toHaveBeenCalled();
		expect(mocks.cancelActiveSessionAgentContinuations).not.toHaveBeenCalled();
		expect(mocks.interruptAgentsChatTurn).not.toHaveBeenCalled();
	});

	it("fails the exact logical task and cancels its unaccepted execution planes", async () => {
		mocks.getAgentsChatTurnStatus.mockResolvedValue({
			activeTurn: true,
			turn: {
				turnId: "turn-1",
				userIntentContract: contract,
				recoveryCheckpoint: null,
				executionProvenanceHistory: [{ executionId: "agent-execution-1" }],
			},
		});
		mocks.findAsyncAgentContinuationForPublicTurn.mockResolvedValue({
			id: "continuation-1",
			userIntentContract: contract,
		});
		mocks.inspectPublicChatVideoProductionStart.mockResolvedValue({
			status: "failed",
			providerAcceptedAt: null,
			evidence: null,
			deadlineAt: job.deadlineAt,
		});

		const outcome = await enforcePublicChatVideoProductionDeadline(context, job);

		expect(outcome).toMatchObject({
			status: "failed",
			providerAcceptedAt: null,
			termination: {
				workflowExecutionsMatched: 1,
				workflowExecutionsCancelled: 1,
				continuationsCancelled: 1,
				runtimeTurn: "failed",
			},
		});
		expect(mocks.recordPublicChatVideoProductionStartDeadlineObservation).toHaveBeenCalledWith(expect.objectContaining({
			publicTurnId: "turn-1",
			rootTraceId: "turn-1",
			scheduledDeadlineAt: job.deadlineAt,
		}));
		expect(mocks.cancelWorkflowExecutionsOwnedByChatTurn).toHaveBeenCalledWith(expect.objectContaining({
			publicTurnId: "turn-1",
			actor: expect.objectContaining({ reasonCode: "video_production_start_deadline_exceeded" }),
		}));
		expect(mocks.cancelActiveSessionAgentContinuations).toHaveBeenCalledWith(expect.objectContaining({
			rootRequestId: "turn-1",
			scope: "all",
		}));
		expect(mocks.interruptAgentsChatTurn).toHaveBeenCalledWith(
			expect.anything(),
			"user-1",
			expect.objectContaining({ reasonCode: "video_production_start_deadline_exceeded" }),
			expect.anything(),
		);
	});

	it("preserves late provider evidence while failing the five-minute production attempt", async () => {
		mocks.inspectPublicChatVideoProductionStart.mockResolvedValue({
			status: "failed",
			providerAcceptedAt: "2026-08-28T00:05:01.000Z",
			evidence: { taskId: "video-task-1" },
			deadlineAt: job.deadlineAt,
		});

		const outcome = await enforcePublicChatVideoProductionDeadline(context, job);

		expect(outcome.status).toBe("failed");
		expect(outcome.providerAcceptedAt).toBe("2026-08-28T00:05:01.000Z");
		expect(mocks.recordPublicChatVideoProductionStartDeadlineObservation).toHaveBeenCalledTimes(1);
	});
});
