import { describe, expect, it, vi } from "vitest";

import type { AppContext } from "../../types";
import type { FlowRow } from "../flow/flow.repo";

const mocks = vi.hoisted(() => ({
	fetchTaskResultForPolling: vi.fn(),
	freshReadFlowRow: vi.fn(),
	persistFlowPatch: vi.fn(),
}));

vi.mock("./task.polling", () => ({
	fetchTaskResultForPolling: mocks.fetchTaskResultForPolling,
}));

vi.mock("./video-orchestrator.flow-io", () => ({
	freshReadFlowRow: mocks.freshReadFlowRow,
	persistFlowPatch: mocks.persistFlowPatch,
}));

import { reconcileImageNodesForFlow } from "./agents-tool-bridge.generate-image-to-canvas";

describe("reconcileImageNodesForFlow provider diagnostics", () => {
	it("persists and returns the exact nested provider failure", async () => {
		const graph = {
			nodes: [{
				id: "image-node-1",
				type: "taskNode",
				position: { x: 0, y: 0 },
				data: {
					kind: "image",
					status: "running",
					prompt: "asset reference",
					taskId: "task-image-1",
					imageTaskId: "task-image-1",
				},
			}],
			edges: [],
		};
		const row = {
			id: "chapter-1",
			name: "Chapter",
			data: JSON.stringify(graph),
			owner_id: "user-1",
			project_id: "project-1",
			created_at: "2026-08-29T00:00:00.000Z",
			updated_at: "2026-08-29T00:00:00.000Z",
		} as FlowRow;
		mocks.freshReadFlowRow.mockResolvedValue(row);
		mocks.persistFlowPatch.mockResolvedValue(undefined);
		mocks.fetchTaskResultForPolling.mockResolvedValue({
			ok: true,
			vendor: "newapi",
			result: {
				id: "task-image-1",
				kind: "text_to_image",
				status: "failed",
				assets: [],
				raw: {
					response: {
						error: {
							code: "new_api_model_list_request_failed",
							message: "Enabled image model catalog was unavailable",
						},
					},
				},
			},
		});

		const result = await reconcileImageNodesForFlow({
			c: { env: { DB: {} } } as AppContext,
			requestUserId: "user-1",
			devBypass: false,
			flowId: "chapter-1",
			chapterId: "chapter-1",
			row,
		});

		const expected =
			"Enabled image model catalog was unavailable (new_api_model_list_request_failed)";
		expect(result).toMatchObject({
			reconciled: 0,
			failed: 1,
			stillRunning: 0,
			details: [{
				nodeId: "image-node-1",
				taskId: "task-image-1",
				status: "failed",
				errorMessage: expected,
			}],
		});
		const patch = mocks.persistFlowPatch.mock.calls[0]?.[0]?.patch as {
			patchNodeData: Array<{ data: Record<string, unknown> }>;
		};
		expect(patch.patchNodeData[0]?.data).toMatchObject({
			status: "error",
			error: expected,
			errorMessage: expected,
			providerStatus: "failed",
		});
	});
});
