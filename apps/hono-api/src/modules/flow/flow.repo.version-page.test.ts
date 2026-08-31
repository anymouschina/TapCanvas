import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
	flow_versions: { findMany: vi.fn() },
}));

vi.mock("../../platform/node/prisma", () => ({
	getPrismaClient: () => prismaMock,
}));

import { listFlowVersionPage } from "./flow.repo";

describe("flow version cursor page", () => {
	beforeEach(() => vi.clearAllMocks());

	it("selects metadata only and returns a bounded next cursor", async () => {
		prismaMock.flow_versions.findMany.mockResolvedValue([
			{ id: "version-3", name: "工作流", created_at: "2026-08-20T03:00:00.000Z" },
			{ id: "version-2", name: "工作流", created_at: "2026-08-20T02:00:00.000Z" },
			{ id: "version-1", name: "工作流", created_at: "2026-08-20T01:00:00.000Z" },
		]);

		const page = await listFlowVersionPage({} as never, "flow-1", {
			limit: 2,
			cursor: "version-4",
		});

		expect(prismaMock.flow_versions.findMany).toHaveBeenCalledWith({
			where: { flow_id: "flow-1" },
			select: { id: true, name: true, created_at: true },
			orderBy: [{ created_at: "desc" }, { id: "desc" }],
			cursor: { id: "version-4" },
			skip: 1,
			take: 3,
		});
		expect(page.items.map((item) => item.id)).toEqual(["version-3", "version-2"]);
		expect(page.nextCursor).toBe("version-2");
	});
});
