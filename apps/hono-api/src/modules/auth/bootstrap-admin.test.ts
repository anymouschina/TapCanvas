import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
	DEFAULT_TAPCANVAS_ADMIN_PASSWORD,
	DEFAULT_TAPCANVAS_ADMIN_USERNAME,
	ensureBootstrapAdmin,
	resolveBootstrapAdminCredentials,
} from "./bootstrap-admin";
import { verifyPasswordRecord } from "./password";

function createPrismaMock() {
	return {
		users: {
			findMany: vi.fn(),
			create: vi.fn(),
		},
	};
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
	});
});
