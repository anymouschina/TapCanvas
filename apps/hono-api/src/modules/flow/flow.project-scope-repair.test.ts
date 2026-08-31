import { describe, expect, it } from "vitest";
import type { FlowRow } from "./flow.repo";
import { prepareProjectFlowScopeRepair } from "./flow.project-scope-repair";

const updatedAt = "2026-08-01T04:24:18.000Z";

function row(data: Record<string, unknown>): FlowRow {
	return {
		id: "flow-1",
		name: "Flow",
		data: JSON.stringify(data),
		owner_id: "user-1",
		project_id: "project-1",
		created_at: "2026-08-01T00:00:00.000Z",
		updated_at: updatedAt,
		canvas_revision: 3,
	};
}

const request = {
	projectId: "project-1",
	expectedUpdatedAt: updatedAt,
	expectedNodeCount: 1,
	expectedEdgeCount: 0,
};

describe("prepareProjectFlowScopeRepair", () => {
	it("adds only the canonical project owner metadata", () => {
		const source = row({
			nodes: [{ id: "node-1" }],
			edges: [],
			viewport: { x: 4, y: 5, zoom: 1.2 },
			sceneCreationProgress: { stage: "video" },
		});
		const prepared = prepareProjectFlowScopeRepair(source, request);

		expect(prepared.expectedData).toBe(source.data);
		expect(JSON.parse(prepared.nextData)).toEqual({
			nodes: [{ id: "node-1" }],
			edges: [],
			viewport: { x: 4, y: 5, zoom: 1.2 },
			sceneCreationProgress: { stage: "video" },
			__tapcanvasFlowOwner: { ownerType: "project", ownerId: "project-1" },
		});
	});

	it("rejects a graph that changed after inspection", () => {
		expect(() => prepareProjectFlowScopeRepair(
			row({ nodes: [{ id: "node-1" }, { id: "node-2" }], edges: [] }),
			request,
		)).toThrow(expect.objectContaining({
			code: "flow_scope_repair_precondition_failed",
			status: 409,
		}));
	});

	it("rejects an existing conflicting owner scope", () => {
		expect(() => prepareProjectFlowScopeRepair(row({
			nodes: [{ id: "node-1" }],
			edges: [],
			__tapcanvasFlowOwner: { ownerType: "chapter", ownerId: "chapter-1" },
		}), request)).toThrow(expect.objectContaining({
			code: "flow_scope_conflict",
			status: 409,
		}));
	});

	it("rejects an already healthy project scope", () => {
		expect(() => prepareProjectFlowScopeRepair(row({
			nodes: [{ id: "node-1" }],
			edges: [],
			__tapcanvasFlowOwner: { ownerType: "project", ownerId: "project-1" },
		}), request)).toThrow(expect.objectContaining({
			code: "flow_scope_already_set",
			status: 409,
		}));
	});
});
