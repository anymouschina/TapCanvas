import { describe, expect, it, vi } from "vitest";

import type { AppContext } from "../../types";
import type { FlowRow } from "../flow/flow.repo";
import type { ExecutionRow, NodeRunRow, ExecutionEventRow } from "../execution/execution.repo";

const {
	mockedGetFlowForOwner,
	mockedListExecutionsForOwnerFlow,
	mockedListNodeRunsForExecutionOwner,
	mockedListExecutionEvents,
	mockedListUserExecutionTraces,
	mockedListStoryboardDiagnosticLogs,
} = vi.hoisted(() => ({
	mockedGetFlowForOwner: vi.fn(),
	mockedListExecutionsForOwnerFlow: vi.fn(),
	mockedListNodeRunsForExecutionOwner: vi.fn(),
	mockedListExecutionEvents: vi.fn(),
	mockedListUserExecutionTraces: vi.fn(),
	mockedListStoryboardDiagnosticLogs: vi.fn(),
}));

vi.mock("../flow/flow.repo", async () => {
	const actual = await vi.importActual<typeof import("../flow/flow.repo")>("../flow/flow.repo");
	return {
		...actual,
		getFlowForOwner: mockedGetFlowForOwner,
	};
});

vi.mock("../execution/execution.repo", async () => {
	const actual = await vi.importActual<typeof import("../execution/execution.repo")>("../execution/execution.repo");
	return {
		...actual,
		listExecutionsForOwnerFlow: mockedListExecutionsForOwnerFlow,
		listNodeRunsForExecutionOwner: mockedListNodeRunsForExecutionOwner,
		listExecutionEvents: mockedListExecutionEvents,
	};
});

vi.mock("../memory/memory.service", async () => {
	const actual = await vi.importActual<typeof import("../memory/memory.service")>("../memory/memory.service");
	return {
		...actual,
		listUserExecutionTraces: mockedListUserExecutionTraces,
	};
});

vi.mock("../storyboard/storyboard.repo", async () => {
	const actual = await vi.importActual<typeof import("../storyboard/storyboard.repo")>("../storyboard/storyboard.repo");
	return {
		...actual,
		listStoryboardDiagnosticLogs: mockedListStoryboardDiagnosticLogs,
	};
});

import { getNodeContextBundle } from "./agents.service";

describe("getNodeContextBundle", () => {
	it("aggregates node data, adjacency, executions, and diagnostics for one flow node", async () => {
		const ownerId = "owner-node-context";
		const projectId = "project-node-context";
		const flowId = "flow-node-context";
		const nodeId = "node-target";
		mockedGetFlowForOwner.mockResolvedValueOnce({
			id: flowId,
			name: "Flow",
			data: JSON.stringify({
				nodes: [
					{
						id: "node-upstream",
						type: "taskNode",
						position: { x: 0, y: 0 },
						data: { kind: "storyboardScript", label: "脚本", content: "脚本内容" },
					},
					{
						id: nodeId,
						type: "taskNode",
						position: { x: 120, y: 0 },
						data: {
							kind: "image",
							label: "主图",
							prompt: "提示词",
							imageResults: [{ url: "https://example.com/shot.jpg" }],
						},
					},
					{
						id: "node-downstream",
						type: "taskNode",
						position: { x: 240, y: 0 },
						data: { kind: "composeVideo", label: "视频", prompt: "视频提示词" },
					},
				],
				edges: [
					{ id: "e1", source: "node-upstream", target: nodeId },
					{ id: "e2", source: nodeId, target: "node-downstream" },
				],
			}),
			owner_id: ownerId,
			project_id: projectId,
			created_at: "2026-03-25T00:00:00.000Z",
			updated_at: "2026-03-25T00:00:00.000Z",
		} satisfies FlowRow);
		mockedListExecutionsForOwnerFlow.mockResolvedValueOnce([
			{
				id: "exec-1",
				flow_id: flowId,
				flow_version_id: "fv-1",
				owner_id: ownerId,
				status: "succeeded",
				concurrency: 1,
				trigger: null,
				error_message: null,
				created_at: "2026-03-25T00:01:00.000Z",
				started_at: "2026-03-25T00:01:01.000Z",
				finished_at: "2026-03-25T00:01:10.000Z",
			} satisfies ExecutionRow,
		]);
		mockedListNodeRunsForExecutionOwner.mockResolvedValueOnce([
			{
				id: "run-1",
				execution_id: "exec-1",
				node_id: nodeId,
				status: "succeeded",
				attempt: 1,
				error_message: null,
				output_refs: JSON.stringify([{ url: "https://example.com/shot.jpg" }]),
				created_at: "2026-03-25T00:01:01.000Z",
				started_at: "2026-03-25T00:01:02.000Z",
				finished_at: "2026-03-25T00:01:05.000Z",
			} satisfies NodeRunRow,
		]);
		mockedListExecutionEvents.mockResolvedValueOnce([
			{
				id: "event-1",
				execution_id: "exec-1",
				seq: 1,
				event_type: "node_completed",
				level: "info",
				node_id: nodeId,
				message: "node completed",
				data: JSON.stringify({ imageUrl: "https://example.com/shot.jpg" }),
				created_at: "2026-03-25T00:01:05.000Z",
			} satisfies ExecutionEventRow,
		]);
		mockedListUserExecutionTraces.mockResolvedValueOnce([
			{
				id: "trace-1",
				scopeType: "project",
				scopeId: projectId,
				taskId: null,
				requestKind: "agents_bridge:chat",
				inputSummary: "更新当前节点",
				decisionLog: [],
				toolCalls: [],
				meta: { projectId, flowId, nodeId },
				resultSummary: "已分析节点",
				errorCode: null,
				errorDetail: null,
				createdAt: "2026-03-25T00:02:00.000Z",
			},
		]);
		mockedListStoryboardDiagnosticLogs.mockResolvedValueOnce([
			{
				id: "diag-1",
				projectId,
				shotId: null,
				jobId: null,
				stage: "render",
				level: "info",
				message: "render_job_created",
				summary: { nodeId },
				createdAt: "2026-03-25T00:02:10.000Z",
			},
		]);

		const result = await getNodeContextBundle({
			c: { env: { DB: {} } } as AppContext,
			ownerId,
			projectId,
			flowId,
			nodeId,
		});

		expect(result.node.nodeId).toBe(nodeId);
		expect(result.node.kind).toBe("image");
		expect(result.upstreamNodes.map((item) => item.nodeId)).toEqual(["node-upstream"]);
		expect(result.downstreamNodes.map((item) => item.nodeId)).toEqual(["node-downstream"]);
		expect(result.recentExecutions).toHaveLength(1);
		expect(result.recentExecutions[0]?.nodeRuns[0]?.id).toBe("run-1");
		expect(result.recentExecutions[0]?.events[0]?.id).toBe("event-1");
		expect(result.diagnostics.executionTraces[0]?.id).toBe("trace-1");
		expect(result.diagnostics.storyboardDiagnostics[0]?.message).toBe("render_job_created");
	});
});
