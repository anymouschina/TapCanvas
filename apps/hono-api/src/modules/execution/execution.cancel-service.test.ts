import { describe, expect, it, vi } from "vitest";

vi.mock("./execution.agent-cancellation", () => ({
	cancelWorkflowAgentTurns: vi.fn(),
	collectWorkflowAgentTurnIdentities: vi.fn(),
	listActiveWorkflowAgentTurnIdentities: vi.fn(),
	mergeWorkflowAgentTurnIdentities: vi.fn(),
}));
vi.mock("./execution.queue", () => ({ cancelActiveWorkflowNodeJobs: vi.fn() }));
vi.mock("./execution.repo", () => ({
	getExecutionForOwner: vi.fn(),
	listNodeRunsForExecutionOwner: vi.fn(),
	mapExecutionRow: vi.fn(),
}));

import { listActiveWorkflowExecutionIdsForChatTurn } from "./execution.cancel-service";

describe("chat-owned workflow cancellation resolution", () => {
	it("matches exact persisted public turn ownership and the legacy agent execution identity", async () => {
		const findMany = vi.fn(async () => [
			{
				workflow_execution_id: "workflow-execution-exact",
				agent_execution_id: "agent-new",
				input_json: JSON.stringify({ publicTurnId: "turn-1" }),
				workflow_executions: { status: "running" },
			},
			{
				workflow_execution_id: "workflow-execution-legacy",
				agent_execution_id: "agent-legacy",
				input_json: JSON.stringify({ canvasFlowId: "chapter-36" }),
				workflow_executions: { status: "queued" },
			},
			{
				workflow_execution_id: "workflow-execution-other-turn",
				agent_execution_id: "agent-legacy",
				input_json: JSON.stringify({ publicTurnId: "turn-2" }),
				workflow_executions: { status: "running" },
			},
			{
				workflow_execution_id: "workflow-execution-finished",
				agent_execution_id: "agent-legacy",
				input_json: JSON.stringify({ publicTurnId: "turn-1" }),
				workflow_executions: { status: "success" },
			},
		]);
		const context = {
			env: { DB: { agent_capability_invocations: { findMany } } },
		};

		const result = await listActiveWorkflowExecutionIdsForChatTurn({
			context: context as never,
			userId: "user-1",
			sessionKey: "session-1",
			publicTurnId: "turn-1",
			agentExecutionIds: ["agent-legacy"],
		});

		expect(result).toEqual(["workflow-execution-exact", "workflow-execution-legacy"]);
		expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
			where: { user_id: "user-1", session_id: "session-1" },
			include: { workflow_executions: true },
		}));
	});

	it("does not let a legacy agent identity override an explicit different turn id", async () => {
		const context = {
			env: {
				DB: {
					agent_capability_invocations: {
						findMany: vi.fn(async () => [{
							workflow_execution_id: "workflow-execution-foreign",
							agent_execution_id: "agent-1",
							input_json: JSON.stringify({ publicTurnId: "turn-foreign" }),
							workflow_executions: { status: "running" },
						}]),
					},
				},
			},
		};
		expect(await listActiveWorkflowExecutionIdsForChatTurn({
			context: context as never,
			userId: "user-1",
			sessionKey: "session-1",
			publicTurnId: "turn-1",
			agentExecutionIds: ["agent-1"],
		})).toEqual([]);
	});
});
