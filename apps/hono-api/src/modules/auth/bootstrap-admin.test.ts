import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
	DEFAULT_TAPCANVAS_ADMIN_PASSWORD,
	DEFAULT_TAPCANVAS_ADMIN_USERNAME,
	ensureBootstrapAdmin,
	resolveBootstrapAdminCredentials,
} from "./bootstrap-admin";
import { verifyPasswordRecord } from "./password";

vi.mock("../team/team-credit-batch.service", () => ({
	grantTeamCreditsInTransaction: vi.fn().mockResolvedValue({ granted: true, ledgerEntryId: "grant" }),
}));
import { grantTeamCreditsInTransaction } from "../team/team-credit-batch.service";

function createPrismaMock() {
	const tx = {
		teams: { create: vi.fn() },
		users: {
			findMany: vi.fn(),
			create: vi.fn(),
		},
	};
	return { ...tx, $transaction: vi.fn(async (operation: (transaction: typeof tx) => Promise<void>) => operation(tx)) };
}

describe("bootstrap administrator", () => {
	it("uses the documented default credentials", () => {
		expect(resolveBootstrapAdminCredentials({})).toEqual({
			username: DEFAULT_TAPCANVAS_ADMIN_USERNAME,
			password: DEFAULT_TAPCANVAS_ADMIN_PASSWORD,
		});
	});

	it("creates an administrator only when the login is absent", async () => {
		const prisma = createPrismaMock();
		prisma.users.findMany.mockResolvedValue([]);
		await expect(ensureBootstrapAdmin(prisma as unknown as PrismaClient)).resolves.toBe("tapcanvas_admin");

		expect(prisma.users.create).toHaveBeenCalledOnce();
		expect(prisma.teams.create).toHaveBeenCalledOnce();
		expect(grantTeamCreditsInTransaction).toHaveBeenCalledWith(
			expect.objectContaining({ users: prisma.users, teams: prisma.teams }),
			expect.objectContaining({ amount: 100000, teamId: "personal_tapcanvas_admin", sourceType: "bootstrap_admin" }),
		);
		const data = prisma.users.create.mock.calls[0]?.[0]?.data;
		expect(data).toMatchObject({
			id: "tapcanvas_admin",
			login: "admin",
			role: "admin",
		});
		expect(await verifyPasswordRecord({
			password: "123456",
			hash: String(data.password_hash),
			salt: String(data.password_salt),
		})).toBe(true);
	});

	it("does not rewrite an existing administrator", async () => {
		const prisma = createPrismaMock();
		prisma.users.findMany.mockResolvedValue([{
			id: "existing-admin",
			role: "admin",
			disabled: 0,
			deleted_at: null,
			password_hash: "existing-hash",
			password_salt: "existing-salt",
		}]);
		await expect(ensureBootstrapAdmin(prisma as unknown as PrismaClient)).resolves.toBe("existing-admin");
		expect(prisma.users.create).not.toHaveBeenCalled();
		expect(prisma.$transaction).not.toHaveBeenCalled();
	});

	it("fails explicitly when an existing administrator has no password", async () => {
		const prisma = createPrismaMock();
		prisma.users.findMany.mockResolvedValue([{
			id: "existing-admin",
			role: "admin",
			disabled: 0,
			deleted_at: null,
			password_hash: null,
			password_salt: null,
		}]);

		await expect(ensureBootstrapAdmin(prisma as unknown as PrismaClient))
			.rejects.toThrow("passwordless");
		expect(prisma.users.create).not.toHaveBeenCalled();
		expect(prisma.$transaction).not.toHaveBeenCalled();
	});
});
