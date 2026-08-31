import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppContext } from "../../types";

const { prisma } = vi.hoisted(() => ({
	prisma: {
		commerce_dictionaries: {
			findUnique: vi.fn(),
			upsert: vi.fn(),
		},
		users: { findUnique: vi.fn() },
	},
}));

vi.mock("../../platform/node/prisma", () => ({ getPrismaClient: () => prisma }));

import { readAccountSettings, saveAccountSettings } from "./account.settings";

function createContext(platformOwnerId?: string): AppContext {
	return {
		env: {
			DB: {},
			...(platformOwnerId ? { COMMERCE_PLATFORM_OWNER_ID: platformOwnerId } : {}),
		} as AppContext["env"],
		get: () => "admin-user",
	} as unknown as AppContext;
}

const settings = {
	checkInEnabled: true,
	checkInRewardCredits: 10,
	membershipEnabled: true,
	sessionTtlDays: 7,
	maxActiveSessions: 10,
};

describe("account settings ownership", () => {
	beforeEach(() => vi.clearAllMocks());

	it("returns safe unconfigured defaults without querying another owner", async () => {
		await expect(readAccountSettings(createContext())).resolves.toEqual({
			configured: false,
			settings: null,
			effectiveSessionTtlDays: 7,
			effectiveMaxActiveSessions: 10,
		});
		expect(prisma.commerce_dictionaries.findUnique).not.toHaveBeenCalled();
	});

	it("fails explicitly when saving without the configured platform owner", async () => {
		await expect(saveAccountSettings(createContext(), settings)).rejects.toMatchObject({
			status: 503,
			code: "account_platform_owner_not_configured",
		});
		expect(prisma.commerce_dictionaries.upsert).not.toHaveBeenCalled();
	});

	it("reads only the configured platform owner's settings", async () => {
		prisma.commerce_dictionaries.findUnique.mockResolvedValue({ value_json: JSON.stringify(settings), enabled: 1 });

		await readAccountSettings(createContext("platform-owner"));

		expect(prisma.commerce_dictionaries.findUnique).toHaveBeenCalledWith(expect.objectContaining({
			where: {
				owner_id_dict_type_code: {
					owner_id: "platform-owner",
					dict_type: "platform_account",
					code: "member_center",
				},
			},
		}));
	});
});
