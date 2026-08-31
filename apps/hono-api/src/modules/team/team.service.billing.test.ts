import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppContext } from "../../types";

const {
	getTeamMembershipByUserId,
	getTeamMembershipForUserInTeam,
	getTeamById,
	tryReserveTeamCreditsUpToAvailableOnce,
} = vi.hoisted(() => ({
	getTeamMembershipByUserId: vi.fn(),
	getTeamMembershipForUserInTeam: vi.fn(),
	getTeamById: vi.fn(),
	tryReserveTeamCreditsUpToAvailableOnce: vi.fn(),
}));

vi.mock("./team.repo", async () => {
	const actual = await vi.importActual<typeof import("./team.repo")>("./team.repo");
	return {
		...actual,
		getTeamMembershipByUserId,
		getTeamMembershipForUserInTeam,
		getTeamById,
		tryReserveTeamCreditsUpToAvailableOnce,
	};
});

import { requireSufficientTeamCredits, resolveBillingTeamId } from "./team.service";

const PERSONAL_ID = "personal_user-1";

/**
 * Build a context with a given activeTeamId. `auth.guest` defaults to false so
 * the resolver's guest short-circuit is not triggered. The URL is localhost so
 * the asset-hosting / publicApi billing guards in requireSufficientTeamCredits
 * are skipped, keeping these focused on team selection.
 */
function createContext(
	activeTeamId: string | null,
	opts?: { guest?: boolean; publicApi?: boolean },
): AppContext {
	const store: Record<string, unknown> = {
		activeTeamId,
		auth: { guest: Boolean(opts?.guest) },
		publicApi: Boolean(opts?.publicApi),
	};
	return {
		env: { DB: {} } as AppContext["env"],
		req: { url: "http://localhost:8788/x" },
		get: (key: string) => store[key],
	} as unknown as AppContext;
}

beforeEach(() => {
	vi.clearAllMocks();
	// ensurePersonalBillingTeam: getTeamById(personal_*) returns a row => returns the id.
	getTeamById.mockImplementation(async (_db: unknown, id: string) =>
		id === PERSONAL_ID ? { id: PERSONAL_ID, name: "个人账户" } : null,
	);
	getTeamMembershipByUserId.mockResolvedValue(null);
	getTeamMembershipForUserInTeam.mockResolvedValue(null);
	tryReserveTeamCreditsUpToAvailableOnce.mockImplementation(
		async (_db: unknown, input: { targetAmount: number }) => ({
			status: "reserved" as const,
			amount: input.targetAmount,
		}),
	);
});

describe("resolveBillingTeamId", () => {
	it("bills the personal account when activeTeamId is the 'personal' sentinel, even with enterprise memberships", async () => {
		getTeamMembershipByUserId.mockResolvedValue({ team_id: "team-ent", role: "member" });

		const teamId = await resolveBillingTeamId(createContext("personal"), "user-1");

		// The return value is what governs billing: it must be the personal team,
		// never the enterprise membership.
		expect(teamId).toBe(PERSONAL_ID);
	});

	it("bills the personal account when activeTeamId is a personal_<uid> id, even with enterprise memberships", async () => {
		getTeamMembershipByUserId.mockResolvedValue({ team_id: "team-ent", role: "member" });

		const teamId = await resolveBillingTeamId(createContext(PERSONAL_ID), "user-1");

		expect(teamId).toBe(PERSONAL_ID);
	});

	it("bills the selected enterprise team when the user is a member of it", async () => {
		getTeamMembershipForUserInTeam.mockResolvedValue({ team_id: "team-x", role: "admin" });

		const teamId = await resolveBillingTeamId(createContext("team-x"), "user-1");

		expect(teamId).toBe("team-x");
		expect(getTeamMembershipForUserInTeam).toHaveBeenCalledWith(
			expect.anything(),
			"user-1",
			"team-x",
		);
	});

	it("does NOT bill a spoofed enterprise team the user is not a member of; falls back instead", async () => {
		// Not a member of the spoofed team...
		getTeamMembershipForUserInTeam.mockResolvedValue(null);
		// ...but a member of a real team => fallback bills the real one.
		getTeamMembershipByUserId.mockResolvedValue({ team_id: "team-real", role: "member" });

		const teamId = await resolveBillingTeamId(createContext("team-spoofed"), "user-1");

		expect(teamId).toBe("team-real");
		expect(teamId).not.toBe("team-spoofed");
	});

	it("falls back to the first membership team when activeTeamId is null", async () => {
		getTeamMembershipByUserId.mockResolvedValue({ team_id: "team-first", role: "member" });

		const teamId = await resolveBillingTeamId(createContext(null), "user-1");

		expect(teamId).toBe("team-first");
	});

	it("falls back to the personal account when activeTeamId is null and there are no memberships", async () => {
		getTeamMembershipByUserId.mockResolvedValue(null);

		const teamId = await resolveBillingTeamId(createContext(null), "user-1");

		expect(teamId).toBe(PERSONAL_ID);
	});

	it("returns null for a guest with no membership (keeps prior guest behavior)", async () => {
		getTeamMembershipByUserId.mockResolvedValue(null);

		const teamId = await resolveBillingTeamId(createContext(null, { guest: true }), "user-1");

		expect(teamId).toBeNull();
	});
});

describe("requireSufficientTeamCredits honors the resolver", () => {
	it("reserves against the personal account when 'personal' is selected despite enterprise membership", async () => {
		getTeamMembershipByUserId.mockResolvedValue({ team_id: "team-ent", role: "member" });

		const res = await requireSufficientTeamCredits(createContext("personal"), "user-1", {
			required: 10,
			taskKind: "chat",
		});

		expect(res?.teamId).toBe(PERSONAL_ID);
		expect(tryReserveTeamCreditsUpToAvailableOnce).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				teamId: PERSONAL_ID,
				targetAmount: 10,
				minimumAmount: 10,
			}),
		);
	});

	it("reserves against the selected enterprise team when the user is a member", async () => {
		getTeamMembershipForUserInTeam.mockResolvedValue({ team_id: "team-x", role: "member" });

		const res = await requireSufficientTeamCredits(createContext("team-x"), "user-1", {
			required: 5,
			taskKind: "chat",
		});

		expect(res?.teamId).toBe("team-x");
	});

	it("allows a chat turn with any positive balance and reserves only what is available", async () => {
		tryReserveTeamCreditsUpToAvailableOnce.mockResolvedValueOnce({
			status: "reserved",
			amount: 3,
		});

		const res = await requireSufficientTeamCredits(createContext("personal"), "user-1", {
			required: 500,
			minimumRequired: 1,
			reservationTaskId: "turn-1",
			taskKind: "agents_chat",
		});

		expect(res?.amount).toBe(3);
		expect(tryReserveTeamCreditsUpToAvailableOnce).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				targetAmount: 500,
				minimumAmount: 1,
				taskId: "turn-1",
			}),
		);
	});

	it("reports insufficient credits only when the atomic balance is below the minimum", async () => {
		tryReserveTeamCreditsUpToAvailableOnce.mockResolvedValueOnce({
			status: "insufficient",
			credits: 10,
			creditsFrozen: 10,
			available: 0,
		});

		await expect(requireSufficientTeamCredits(createContext("personal"), "user-1", {
			required: 500,
			minimumRequired: 1,
			reservationTaskId: "turn-2",
			taskKind: "agents_chat",
		})).rejects.toMatchObject({
			status: 402,
			code: "team_insufficient_credits",
			details: expect.objectContaining({ available: 0, minimumRequired: 1 }),
		});
	});

	it("does not disguise an idempotency collision as insufficient credits", async () => {
		tryReserveTeamCreditsUpToAvailableOnce.mockResolvedValueOnce({
			status: "idempotency_conflict",
			credits: 1000,
			creditsFrozen: 0,
			available: 1000,
		});

		await expect(requireSufficientTeamCredits(createContext("personal"), "user-1", {
			required: 500,
			minimumRequired: 1,
			reservationTaskId: "duplicate-turn",
			taskKind: "agents_chat",
		})).rejects.toMatchObject({
			status: 409,
			code: "team_credit_reservation_conflict",
			details: expect.objectContaining({ available: 1000 }),
		});
	});

	it("passes explicit stale-worker reservation adoption to the atomic ledger operation", async () => {
		tryReserveTeamCreditsUpToAvailableOnce.mockResolvedValueOnce({
			status: "existing_reservation",
			amount: 73,
		});

		const reservation = await requireSufficientTeamCredits(createContext("personal"), "user-1", {
			required: 500,
			minimumRequired: 1,
			reservationTaskId: "recovered-run",
			taskKind: "agents_chat",
			allowExistingReservation: true,
		});

		expect(reservation?.amount).toBe(73);
		expect(tryReserveTeamCreditsUpToAvailableOnce).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ allowExistingReservation: true }),
		);
	});
});
