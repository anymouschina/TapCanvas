import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppContext } from "../../types";

const { listProjectsForTeamPaginated, listProjectsAccessibleByUserPaginated } = vi.hoisted(() => ({
	listProjectsForTeamPaginated: vi.fn(async () => ({ items: [], nextCursor: null })),
	listProjectsAccessibleByUserPaginated: vi.fn(async () => ({ items: [], nextCursor: null })),
}));

vi.mock("./project.repo", async () => {
	const actual = await vi.importActual<typeof import("./project.repo")>("./project.repo");
	return { ...actual, listProjectsForTeamPaginated, listProjectsAccessibleByUserPaginated };
});

import { listUserProjectsPaginated } from "./project.service";

const c = { env: { DB: {} } } as unknown as AppContext;
const params = { limit: 30 };

describe("listUserProjectsPaginated team scope", () => {
	beforeEach(() => {
		listProjectsForTeamPaginated.mockClear();
		listProjectsAccessibleByUserPaginated.mockClear();
	});

	it("未传 teamId → 查个人可见项目", async () => {
		await listUserProjectsPaginated(c, "u1", params);
		expect(listProjectsAccessibleByUserPaginated).toHaveBeenCalledTimes(1);
		expect(listProjectsForTeamPaginated).not.toHaveBeenCalled();
	});

	it("个人 team（personal_<uid>）→ 回退到个人可见项目，而非空团队列表", async () => {
		await listUserProjectsPaginated(c, "u1", { ...params, teamId: "personal_u1" });
		expect(listProjectsAccessibleByUserPaginated).toHaveBeenCalledTimes(1);
		expect(listProjectsForTeamPaginated).not.toHaveBeenCalled();
	});

	it('"personal" 哨兵 → 个人可见项目', async () => {
		await listUserProjectsPaginated(c, "u1", { ...params, teamId: "personal" });
		expect(listProjectsAccessibleByUserPaginated).toHaveBeenCalledTimes(1);
		expect(listProjectsForTeamPaginated).not.toHaveBeenCalled();
	});

	it("空字符串 teamId → 个人可见项目", async () => {
		await listUserProjectsPaginated(c, "u1", { ...params, teamId: "  " });
		expect(listProjectsAccessibleByUserPaginated).toHaveBeenCalledTimes(1);
		expect(listProjectsForTeamPaginated).not.toHaveBeenCalled();
	});

	it("真实 team id → 走团队共享查询", async () => {
		await listUserProjectsPaginated(c, "u1", { ...params, teamId: "team_abc123" });
		expect(listProjectsForTeamPaginated).toHaveBeenCalledTimes(1);
		expect(listProjectsForTeamPaginated).toHaveBeenCalledWith(c.env.DB, "u1", "team_abc123", expect.objectContaining({ limit: 30 }));
		expect(listProjectsAccessibleByUserPaginated).not.toHaveBeenCalled();
	});

	it("非法 cursor 显式失败而不是回退到第一页", async () => {
		await expect(
			listUserProjectsPaginated(c, "u1", { ...params, cursor: "invalid" }),
		).rejects.toMatchObject({
			status: 400,
			code: "project_cursor_invalid",
		});
		expect(listProjectsForTeamPaginated).not.toHaveBeenCalled();
		expect(listProjectsAccessibleByUserPaginated).not.toHaveBeenCalled();
	});
});
