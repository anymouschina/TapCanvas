import { beforeEach, describe, expect, it, vi } from "vitest";
import { isValidWorkflow } from "./project.repo";

const { deleteProjectGraph, getTeamProjectShareForUser, listTeamProjectSharesForUser } = vi.hoisted(() => ({
	deleteProjectGraph: vi.fn(),
	getTeamProjectShareForUser: vi.fn(),
	listTeamProjectSharesForUser: vi.fn(),
}));

vi.mock("./project-delete", () => ({
	deleteProjectGraph,
}));

vi.mock("../team/team.repo", () => ({
	getTeamProjectShareForUser,
	listTeamProjectSharesForUser,
}));

import {
	deleteProjectById,
	getProjectAccessSummary,
	listProjectAccessSummaries,
} from "./project.repo";

describe("isValidWorkflow", () => {
	it("accepts valid workflows", () => {
		expect(isValidWorkflow("free_canvas")).toBe(true);
		expect(isValidWorkflow("story_film")).toBe(true);
		expect(isValidWorkflow("music_video")).toBe(true);
	});

	it("rejects invalid values", () => {
		expect(isValidWorkflow("unknown")).toBe(false);
		expect(isValidWorkflow(null)).toBe(false);
		expect(isValidWorkflow(123)).toBe(false);
	});
});

describe("deleteProjectById", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("delegates project deletion to deleteProjectGraph", async () => {
		deleteProjectGraph.mockResolvedValue(undefined);

		await deleteProjectById({} as never, "project-123");

		expect(deleteProjectGraph).toHaveBeenCalledWith("project-123");
		expect(deleteProjectGraph).toHaveBeenCalledTimes(1);
	});
});

describe("capability project access summaries", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		getTeamProjectShareForUser.mockResolvedValue(null);
		listTeamProjectSharesForUser.mockResolvedValue([]);
	});

	it("lists owned and shared projects without requesting presentation data", async () => {
		const findMany = vi.fn()
			.mockResolvedValueOnce([{
				id: "owned-project",
				name: "自有工作流",
				owner_id: "user-1",
				project_kind: "ai_workflow",
				updated_at: "2026-08-20T02:00:00.000Z",
			}])
			.mockResolvedValueOnce([{
				id: "shared-project",
				name: "共享项目",
				owner_id: "user-2",
				project_kind: "creative",
				updated_at: "2026-08-20T01:00:00.000Z",
			}]);
		listTeamProjectSharesForUser.mockResolvedValue([{
			project_id: "shared-project",
			team_id: "team-1",
			access: "edit",
			shared_by_user_id: "user-2",
			created_at: "2026-08-20T00:00:00.000Z",
			updated_at: "2026-08-20T00:00:00.000Z",
		}]);
		const db = { projects: { findMany } } as never;

		await expect(listProjectAccessSummaries(db, "user-1")).resolves.toEqual([
			expect.objectContaining({ id: "owned-project", access: "owner", project_kind: "ai_workflow" }),
			expect.objectContaining({ id: "shared-project", access: "team_edit", team_id: "team-1" }),
		]);
		for (const call of findMany.mock.calls) {
			expect(call[0]).toMatchObject({
				select: {
					id: true,
					name: true,
					owner_id: true,
					project_kind: true,
					updated_at: true,
				},
			});
			expect(call[0]?.select).not.toHaveProperty("data");
		}
	});

	it("resolves team edit access without deriving a project cover", async () => {
		const findFirst = vi.fn().mockResolvedValue({
			id: "shared-project",
			name: "共享项目",
			owner_id: "user-2",
			project_kind: "creative",
			updated_at: "2026-08-20T01:00:00.000Z",
		});
		getTeamProjectShareForUser.mockResolvedValue({
			project_id: "shared-project",
			team_id: "team-1",
			access: "edit",
			shared_by_user_id: "user-2",
			created_at: "2026-08-20T00:00:00.000Z",
			updated_at: "2026-08-20T00:00:00.000Z",
		});

		await expect(getProjectAccessSummary(
			{ projects: { findFirst } } as never,
			"shared-project",
			"user-1",
		)).resolves.toMatchObject({ access: "team_edit", team_id: "team-1" });
		expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
			select: expect.not.objectContaining({ data: true }),
		}));
	});
});
