import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppContext } from "../../types";

const prisma = {
	users: {
		findUnique: vi.fn(),
	},
};

vi.mock("../../platform/node/prisma", () => ({
	getPrismaClient: () => prisma,
}));
import { assertOwnerUserExists } from "./user-owner";

function createContext(platformOwnerId?: string): AppContext {
	return {
		env: {
			COMMERCE_PLATFORM_OWNER_ID: platformOwnerId,
		} as AppContext["env"],
	} as AppContext;
}

describe("assertOwnerUserExists", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("throws a config error when platform owner user row is missing", async () => {
		prisma.users.findUnique.mockResolvedValue(null);

		await expect(
			assertOwnerUserExists(createContext("platform-owner"), "platform-owner"),
		).rejects.toMatchObject({
			code: "commerce_platform_owner_user_missing",
			status: 500,
		});
	});

	it("passes when owner user row exists", async () => {
		prisma.users.findUnique.mockResolvedValue({ id: "user_1" });

		await expect(
			assertOwnerUserExists(createContext("platform-owner"), "user_1"),
		).resolves.toBeUndefined();
	});
});
