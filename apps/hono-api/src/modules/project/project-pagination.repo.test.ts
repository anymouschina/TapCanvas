import { beforeEach, describe, expect, it, vi } from "vitest";

const { queryAll, assetsFindMany, flowsFindMany } = vi.hoisted(() => ({
	queryAll: vi.fn(),
	assetsFindMany: vi.fn(),
	flowsFindMany: vi.fn(),
}));

vi.mock("../../db/db", () => ({ queryAll }));
vi.mock("../../platform/node/prisma", () => ({
	getPrismaClient: () => ({
		assets: { findMany: assetsFindMany },
		flows: { findMany: flowsFindMany },
	}),
}));
vi.mock("./project-delete", () => ({ deleteProjectGraph: vi.fn() }));

import {
	listProjectsAccessibleByUserPaginated,
	listProjectsForTeamPaginated,
} from "./project.repo";

type PageDbRow = {
	id: string;
	name: string;
	is_public: number;
	owner_id: string;
	clone_count: number;
	sort_weight: number;
	created_at: string;
	updated_at: string;
	active_workflow: string;
	owner_login: string;
	owner_name: string;
	team_id: string | null;
};

function createRow(input: {
	id: string;
	updatedAt: string;
	ownerId?: string;
	teamId?: string | null;
}): PageDbRow {
	return {
		id: input.id,
		name: `Project ${input.id}`,
		is_public: 0,
		owner_id: input.ownerId ?? "owner-1",
		clone_count: 0,
		sort_weight: 0,
		created_at: "2026-01-01T00:00:00.000Z",
		updated_at: input.updatedAt,
		active_workflow: "free_canvas",
		owner_login: "owner",
		owner_name: "Owner",
		team_id: input.teamId ?? null,
	};
}

describe("project repository pagination", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		assetsFindMany.mockResolvedValue([]);
		flowsFindMany.mockResolvedValue([]);
	});

	it("paginates accessible projects before loading metadata and flow data", async () => {
		queryAll.mockResolvedValue([
			createRow({ id: "p1", updatedAt: "2026-06-03T00:00:00.000Z", ownerId: "user-1" }),
			createRow({ id: "p2", updatedAt: "2026-06-02T00:00:00.000Z", teamId: "team-1" }),
			createRow({ id: "p3", updatedAt: "2026-06-01T00:00:00.000Z", ownerId: "user-1" }),
		]);

		const result = await listProjectsAccessibleByUserPaginated(
			{} as never,
			"user-1",
			{
				limit: 2,
				cursor: "2026-07-01T00:00:00.000Z__cursor-project",
			},
		);

		expect(result.items.map((item) => item.id)).toEqual(["p1", "p2"]);
		expect(result.items.map((item) => item.access)).toEqual(["owner", "team_edit"]);
		expect(result.nextCursor).toBe("2026-06-02T00:00:00.000Z__p2");

		const queryCall = queryAll.mock.calls[0];
		expect(String(queryCall?.[1])).toContain("WITH accessible_shares AS");
		expect(String(queryCall?.[1])).toContain("ORDER BY p.updated_at DESC, p.id DESC");
		expect(queryCall?.[2]).toEqual([
			"user-1",
			"user-1",
			"2026-07-01T00:00:00.000Z",
			"2026-07-01T00:00:00.000Z",
			"cursor-project",
			3,
		]);
		expect(assetsFindMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: expect.objectContaining({ project_id: { in: ["p1", "p2"] } }),
			}),
		);
		expect(flowsFindMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { project_id: { in: ["p1", "p2"] } },
			}),
		);
	});

	it("keeps team membership and team scope inside the paginated SQL query", async () => {
		queryAll.mockResolvedValue([]);

		const result = await listProjectsForTeamPaginated(
			{} as never,
			"user-1",
			"team-2",
			{ limit: 30 },
		);

		expect(result).toEqual({ items: [], nextCursor: null });
		const queryCall = queryAll.mock.calls[0];
		expect(String(queryCall?.[1])).toContain("JOIN team_memberships");
		expect(String(queryCall?.[1])).toContain("WHERE s.team_id = ?");
		expect(String(queryCall?.[1])).toContain("ORDER BY p.updated_at DESC, p.id DESC");
		expect(queryCall?.[2]).toEqual(["user-1", "team-2", 31]);
		expect(assetsFindMany).not.toHaveBeenCalled();
		expect(flowsFindMany).not.toHaveBeenCalled();
	});
});
