import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AppContext } from "../../types";

const mocks = vi.hoisted(() => ({
	findProjectFlows: vi.fn(),
	findChapters: vi.fn(),
	reconcileImageNodesForFlow: vi.fn(),
	loadChapterCanvasAsFlowRow: vi.fn(),
}));

vi.mock("../../platform/node/prisma", () => ({
	getPrismaClient: () => ({
		flows: { findMany: mocks.findProjectFlows },
		chapters: { findMany: mocks.findChapters },
	}),
}));

vi.mock("./agents-tool-bridge.generate-image-to-canvas", () => ({
	reconcileImageNodesForFlow: mocks.reconcileImageNodesForFlow,
}));

vi.mock("./agents-tool-bridge.chapter-canvas-write", () => ({
	loadChapterCanvasAsFlowRow: mocks.loadChapterCanvasAsFlowRow,
}));

vi.mock("./agents-tool-bridge.image-return-policy", () => ({
	isImageReconcileSweepEnabled: () => true,
}));

import { sweepRunningImageNodes } from "./image-orphan-recovery";

describe("sweepRunningImageNodes", () => {
	beforeEach(() => {
		mocks.findProjectFlows.mockReset();
		mocks.findChapters.mockReset();
		mocks.reconcileImageNodesForFlow.mockReset();
		mocks.loadChapterCanvasAsFlowRow.mockReset();
		mocks.findProjectFlows.mockResolvedValue([]);
		mocks.findChapters.mockResolvedValue([]);
	});

	it("reconciles stale running image tasks on project-root flows without a browser", async () => {
		const flow = {
			id: "flow-1",
			name: "Project flow",
			data: JSON.stringify({
				nodes: [
					{
						id: "image-1",
						data: { kind: "image", status: "running", imageTaskId: "task-1" },
					},
				],
			}),
			owner_id: "user-1",
			project_id: "project-1",
			created_at: "2026-08-01T00:00:00.000Z",
			updated_at: "2026-08-01T00:00:30.000Z",
			canvas_revision: 4,
		};
		mocks.findProjectFlows.mockResolvedValue([flow]);
		mocks.reconcileImageNodesForFlow.mockResolvedValue({
			ok: true,
			reconciled: 1,
			failed: 0,
			stillRunning: 0,
			details: [],
		});

		const c = { env: { DB: {} } } as unknown as AppContext;
		const result = await sweepRunningImageNodes(c, {
			staleBeforeIso: "2026-08-01T00:02:00.000Z",
			limit: 8,
		});

		expect(mocks.reconcileImageNodesForFlow).toHaveBeenCalledWith({
			c,
			requestUserId: "user-1",
			devBypass: true,
			flowId: "flow-1",
			row: flow,
			markOrphanPlaceholders: true,
		});
		expect(result).toMatchObject({
			enabled: true,
			scannedCanvases: 1,
			scannedProjectFlows: 1,
			scannedChapters: 0,
			reconciledNodes: 1,
		});
	});

	it("returns per-canvas reconcile failures instead of swallowing them", async () => {
		mocks.findProjectFlows.mockResolvedValue([
			{
				id: "flow-broken",
				name: "Broken flow",
				data: JSON.stringify({
					nodes: [
						{
							id: "image-broken",
							data: { kind: "image", status: "running", imageTaskId: "task-broken" },
						},
					],
				}),
				owner_id: "user-1",
				project_id: "project-1",
				created_at: "2026-08-01T00:00:00.000Z",
				updated_at: "2026-08-01T00:00:30.000Z",
				canvas_revision: 1,
			},
		]);
		mocks.reconcileImageNodesForFlow.mockRejectedValue(new Error("upstream lookup failed"));

		const c = { env: { DB: {} } } as unknown as AppContext;
		const result = await sweepRunningImageNodes(c, {
			staleBeforeIso: "2026-08-01T00:02:00.000Z",
		});

		expect(result.errors).toEqual([
			{
				scopeType: "project_flow",
				scopeId: "flow-broken",
				message: "upstream lookup failed",
			},
		]);
	});
});
