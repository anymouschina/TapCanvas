import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppContext } from "../../types";

const {
	createTeam,
	getTeamById,
	hasTeamSignupBonusLedgerEntry,
	topUpTeamCredits,
} = vi.hoisted(() => ({
	createTeam: vi.fn(),
	getTeamById: vi.fn(),
	hasTeamSignupBonusLedgerEntry: vi.fn(),
	topUpTeamCredits: vi.fn(),
}));

vi.mock("./team.repo", async () => {
	const actual = await vi.importActual<typeof import("./team.repo")>("./team.repo");
	return {
		...actual,
		createTeam,
		getTeamById,
		hasTeamSignupBonusLedgerEntry,
		topUpTeamCredits,
	};
});
import { grantSignupBonusToPersonalTeam } from "./team.service";

function createContext(): AppContext {
	return {
		env: { DB: {} } as AppContext["env"],
		get: () => ({ login: "tester" }),
	} as unknown as AppContext;
}

describe("grantSignupBonusToPersonalTeam", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		createTeam.mockResolvedValue(undefined);
		getTeamById
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce({ id: "personal_user_1", credits: 0 });
		hasTeamSignupBonusLedgerEntry.mockResolvedValue(false);
		topUpTeamCredits.mockResolvedValue(undefined);
	});

	it("tops up 100 points when signup bonus has not been granted", async () => {
		await grantSignupBonusToPersonalTeam(createContext(), "user-1");

		expect(hasTeamSignupBonusLedgerEntry).toHaveBeenCalledWith(
			expect.anything(),
			{ teamId: "personal_user-1", actorUserId: "user-1" },
		);
		expect(topUpTeamCredits).toHaveBeenCalledTimes(1);
		expect(topUpTeamCredits).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				teamId: "personal_user-1",
				amount: 100,
				actorUserId: "user-1",
				note: "signup_bonus",
			}),
		);
	});

	it("skips topup when signup bonus ledger already exists", async () => {
		hasTeamSignupBonusLedgerEntry.mockResolvedValue(true);

		await grantSignupBonusToPersonalTeam(createContext(), "user-1");

		expect(topUpTeamCredits).not.toHaveBeenCalled();
	});
});
