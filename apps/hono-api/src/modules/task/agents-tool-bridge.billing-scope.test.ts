import { describe, expect, it, vi } from "vitest";

const { mockedGetTeamProjectShareForUser } = vi.hoisted(() => ({
	mockedGetTeamProjectShareForUser: vi.fn(),
}));

vi.mock("../team/team.repo", () => ({
	getTeamProjectShareForUser: mockedGetTeamProjectShareForUser,
}));

import { resolveProjectBillingTeamId } from "./agents-tool-bridge.billing-scope";

describe("resolveProjectBillingTeamId", () => {
	it("bills the bound team when the project owner is a member of it", async () => {
		mockedGetTeamProjectShareForUser.mockResolvedValueOnce({
			project_id: "p1",
			team_id: "team-x",
			access: "edit",
			shared_by_user_id: "owner-1",
			created_at: "2026-06-01T00:00:00.000Z",
			updated_at: "2026-06-01T00:00:00.000Z",
		});

		await expect(
			resolveProjectBillingTeamId({} as never, { projectId: "p1", userId: "owner-1" }),
		).resolves.toBe("team-x");
		expect(mockedGetTeamProjectShareForUser).toHaveBeenCalledWith(
			{},
			{ projectId: "p1", userId: "owner-1" },
		);
	});

	it("bills personal for a project not bound to any team the owner belongs to", async () => {
		mockedGetTeamProjectShareForUser.mockResolvedValueOnce(null);

		await expect(
			resolveProjectBillingTeamId({} as never, { projectId: "p2", userId: "owner-1" }),
		).resolves.toBe("personal");
	});

	it("treats a blank team_id as personal", async () => {
		mockedGetTeamProjectShareForUser.mockResolvedValueOnce({
			project_id: "p3",
			team_id: "   ",
			access: "edit",
			shared_by_user_id: "owner-1",
			created_at: "2026-06-01T00:00:00.000Z",
			updated_at: "2026-06-01T00:00:00.000Z",
		});

		await expect(
			resolveProjectBillingTeamId({} as never, { projectId: "p3", userId: "owner-1" }),
		).resolves.toBe("personal");
	});
});
