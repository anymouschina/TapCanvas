import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppContext } from "../../types";

const { createTeam, getTeamById, topUpTeamCredits } = vi.hoisted(() => ({
	createTeam: vi.fn(),
	getTeamById: vi.fn(),
	topUpTeamCredits: vi.fn(),
}));

vi.mock("./team.repo", async () => {
	const actual = await vi.importActual<typeof import("./team.repo")>("./team.repo");
	return {
		...actual,
		createTeam,
		getTeamById,
		topUpTeamCredits,
	};
});
import { ensurePersonalBillingTeamOnLogin } from "./team.service";

function createContext(): AppContext {
	return {
		env: { DB: {} } as AppContext["env"],
		get: () => ({ login: "tester" }),
	} as unknown as AppContext;
}

describe("ensurePersonalBillingTeamOnLogin", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		createTeam.mockResolvedValue(undefined);
		getTeamById
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce({ id: "personal_user-1", credits: 0 });
		topUpTeamCredits.mockResolvedValue(undefined);
	});

	it("creates the personal billing team when it does not exist yet", async () => {
		await ensurePersonalBillingTeamOnLogin(createContext(), "user-1");

		expect(createTeam).toHaveBeenCalledTimes(1);
		expect(createTeam).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ id: "personal_user-1" }),
		);
	});

	// 回归守卫：2026-07-15 产品决策——注册不再无条件赠送积分，只有带邀请码进来的用户
	// 由 referral.service.bindReferrerOnRegister 赠送 50。此前这里无条件送 100。
	it("never grants credits on signup", async () => {
		await ensurePersonalBillingTeamOnLogin(createContext(), "user-1");

		expect(topUpTeamCredits).not.toHaveBeenCalled();
	});

	it("ignores blank user ids without touching the repo", async () => {
		await ensurePersonalBillingTeamOnLogin(createContext(), "   ");

		expect(createTeam).not.toHaveBeenCalled();
		expect(topUpTeamCredits).not.toHaveBeenCalled();
	});
});
