import { describe, expect, it, vi } from "vitest";

import type { AppContext } from "../../types";
import type { FlowRow } from "../flow/flow.repo";
import type { ExecutionRow } from "../execution/execution.repo";

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

import { getVideoReviewBundle } from "./agents.service";

describe("getVideoReviewBundle", () => {
	it("extracts video review fields from a real video node bundle", async () => {
		const ownerId = "owner-video-review";
		const projectId = "project-video-review";
		const flowId = "flow-video-review";
		const nodeId = "node-video";

		mockedGetFlowForOwner.mockResolvedValueOnce({
			id: flowId,
			name: "Flow",
			data: JSON.stringify({
				nodes: [
					{
						id: nodeId,
						type: "taskNode",
						position: { x: 0, y: 0 },
						data: {
							kind: "composeVideo",
							label: "视频节点",
							prompt: "夜雨中镜头前推",
							storyBeatPlan: ["开场静止", "轻微前推"],
							videoResults: [
								{
									url: "https://example.com/video.mp4",
									thumbnailUrl: "https://example.com/video.jpg",
								},
							],
						},
					},
				],
				edges: [],
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
		mockedListNodeRunsForExecutionOwner.mockResolvedValueOnce([]);
		mockedListExecutionEvents.mockResolvedValueOnce([]);
		mockedListUserExecutionTraces.mockResolvedValueOnce([]);
		mockedListStoryboardDiagnosticLogs.mockResolvedValueOnce([]);

		const result = await getVideoReviewBundle({
			c: { env: { DB: {} } } as AppContext,
			ownerId,
			projectId,
			flowId,
			nodeId,
		});

		expect(result.videoNode.kind).toBe("composeVideo");
		expect(result.videoNode.prompt).toBe("夜雨中镜头前推");
		expect(result.videoNode.storyBeatPlan).toEqual(["开场静止", "轻微前推"]);
		expect(result.videoNode.videoUrl).toBe("https://example.com/video.mp4");
		expect(result.videoNode.videoResults).toEqual([
			{
				url: "https://example.com/video.mp4",
				thumbnailUrl: "https://example.com/video.jpg",
			},
		]);
		expect(result.nodeContext.node.nodeId).toBe(nodeId);
	});
});
