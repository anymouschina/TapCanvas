import { describe, expect, it, vi } from "vitest";
import type { AppContext, PrismaClient } from "../../types";
import type { NodeRunRow } from "./execution.repo";
import {
	cancelWorkflowAgentTurns,
	collectWorkflowAgentTurnIdentities,
	listActiveWorkflowAgentTurnIdentities,
	mergeWorkflowAgentTurnIdentities,
} from "./execution.agent-cancellation";
import * as runtime from "../task/task.agents-chat-runtime";
import * as continuations from "../task/async-agent-continuation";

function row(input: Partial<NodeRunRow> & Pick<NodeRunRow, "node_id" | "status">): NodeRunRow {
	return {
		id: "run-1",
		execution_id: "execution-1",
		attempt: 1,
		error_message: null,
		output_refs: null,
		created_at: "2026-08-12T00:00:00.000Z",
		started_at: null,
		finished_at: null,
		...input,
	};
}

describe("workflow Agent cancellation", () => {
	it("extracts and deduplicates exact durable turn identities from per-item wait receipts", () => {
		const outputRefs = {
			protocolVersion: "1",
			executorRef: "agents.logical-task/v2",
			nodeId: "writer",
			executionMode: "each",
			ports: {},
			artifacts: [],
			evidence: {},
			itemRuns: [
				{
					status: "waiting_external",
					runtimeNodeId: "writer::item::clip-1",
					evidence: { deliveryEvidence: { sessionKey: "session-1", logicalTaskId: "turn-1" } },
				},
				{
					status: "waiting_external",
					runtimeNodeId: "writer::item::clip-2",
					evidence: { deliveryEvidence: { sessionKey: "session-2", logicalTaskId: "turn-2" } },
				},
			],
		};
		const targets = collectWorkflowAgentTurnIdentities([
			row({ node_id: "writer", status: "waiting_external", output_refs: JSON.stringify(outputRefs) }),
			row({ node_id: "terminal", status: "success", output_refs: JSON.stringify(outputRefs) }),
		]);
		expect(targets).toEqual([
			{ sessionId: "session-1", turnId: "turn-1", nodeId: "writer", runtimeNodeId: "writer::item::clip-1" },
			{ sessionId: "session-2", turnId: "turn-2", nodeId: "writer", runtimeNodeId: "writer::item::clip-2" },
		]);
	});

	it("reports interrupted, already inactive and failed turns independently", async () => {
		vi.spyOn(continuations, "cancelActiveSessionAgentContinuations").mockResolvedValue(0);
		const spy = vi.spyOn(runtime, "interruptAgentsChatTurn")
			.mockResolvedValueOnce({ ok: true, interrupted: true, sessionId: "s1", turnId: "t1", status: null })
			.mockResolvedValueOnce({ ok: true, interrupted: false, sessionId: "s2", turnId: "t2", status: null })
			.mockRejectedValueOnce(Object.assign(new Error("runtime unavailable"), { code: "runtime_unavailable" }));
		const results = await cancelWorkflowAgentTurns({
			context: {} as AppContext,
			userId: "user-1",
			targets: [
				{ sessionId: "s1", turnId: "t1", nodeId: "n", runtimeNodeId: "n1" },
				{ sessionId: "s2", turnId: "t2", nodeId: "n", runtimeNodeId: "n2" },
				{ sessionId: "s3", turnId: "t3", nodeId: "n", runtimeNodeId: "n3" },
			],
		});
		expect(results.map((result) => result.status)).toEqual(["interrupted", "already_inactive", "failed"]);
		expect(results[2]).toMatchObject({
			errorCode: "workflow_agent_turn_partial_interrupt",
			errorMessage: "One or more workflow Agent cancellation planes have an unknown or failed outcome",
			receipt: { runtime: "failed" },
		});
		expect(spy).toHaveBeenCalledTimes(3);
	});

	it("loads active durable identities from running and waiting trace rows", async () => {
		const findMany = vi.fn().mockResolvedValue([
			{
				session_key: "workflow:execution-1:writer::item::clip-1",
				logical_task_id: "workflow:execution-1:writer::item::clip-1",
			},
		]);
		const db = { execution_traces: { findMany } } as unknown as PrismaClient;

		await expect(listActiveWorkflowAgentTurnIdentities({
			db,
			userId: "user-1",
			executionId: "execution-1",
		})).resolves.toEqual([{
			sessionId: "workflow:execution-1:writer::item::clip-1",
			turnId: "workflow:execution-1:writer::item::clip-1",
			nodeId: "writer::item::clip-1",
			runtimeNodeId: "writer::item::clip-1",
		}]);
		expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
			where: expect.objectContaining({
				user_id: "user-1",
				status: { in: ["running", "waiting_async"] },
			}),
		}));
	});

	it("deduplicates checkpoint and active trace identities before interruption", () => {
		const identity = {
			sessionId: "workflow:execution-1:writer",
			turnId: "workflow:execution-1:writer",
			nodeId: "writer",
			runtimeNodeId: "writer",
		};
		expect(mergeWorkflowAgentTurnIdentities([identity], [identity])).toEqual([identity]);
	});
});
