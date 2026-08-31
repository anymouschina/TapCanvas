import { describe, expect, it } from "vitest";
import type { FlowDto } from "./flow.schemas";
import { filterFlowsByOwnerScope } from "./flow.owner-scope";

function flow(input: Pick<FlowDto, "id" | "ownerType" | "ownerId">): FlowDto {
	return {
		id: input.id,
		name: input.id,
		data: { nodes: [], edges: [] },
		ownerType: input.ownerType,
		ownerId: input.ownerId,
		canvasRevision: 0,
		createdAt: "2026-08-01T00:00:00.000Z",
		updatedAt: "2026-08-01T00:00:00.000Z",
	};
}

describe("filterFlowsByOwnerScope", () => {
	it("returns only the requested complete scope", () => {
		const flows = [
			flow({ id: "project-flow", ownerType: "project", ownerId: "project-1" }),
			flow({ id: "chapter-flow", ownerType: "chapter", ownerId: "chapter-1" }),
		];

		expect(filterFlowsByOwnerScope(flows, {
			ownerType: "project",
			ownerId: "project-1",
		}).map((item) => item.id)).toEqual(["project-flow"]);
	});

	it("fails before filtering when any project flow has missing owner metadata", () => {
		const flows = [
			flow({ id: "visible-flow", ownerType: "project", ownerId: "project-1" }),
			flow({ id: "hidden-flow", ownerType: null, ownerId: null }),
		];

		expect(() => filterFlowsByOwnerScope(flows, {
			ownerType: "project",
			ownerId: "project-1",
		})).toThrow(expect.objectContaining({
			code: "flow_scope_metadata_missing",
			status: 409,
			details: expect.objectContaining({ affectedFlowIds: ["hidden-flow"] }),
		}));
	});

	it("does not impose scope integrity checks on an unscoped list", () => {
		const flows = [flow({ id: "legacy-flow", ownerType: null, ownerId: null })];
		expect(filterFlowsByOwnerScope(flows)).toEqual(flows);
	});
});
