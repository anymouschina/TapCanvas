import type { PrismaClient } from "@prisma/client";
import { createPasswordRecord } from "./password";

export const DEFAULT_TAPCANVAS_ADMIN_USERNAME = "admin";
export const DEFAULT_TAPCANVAS_ADMIN_PASSWORD = "123456";

type BootstrapAdminCredentials = {
	username: string;
	password: string;
};

export function resolveBootstrapAdminCredentials(
	env: NodeJS.ProcessEnv = process.env,
): BootstrapAdminCredentials {
	const username = String(
		env.TAPCANVAS_ADMIN_USERNAME ?? DEFAULT_TAPCANVAS_ADMIN_USERNAME,
	).trim();
	const password = String(
		env.TAPCANVAS_ADMIN_PASSWORD ?? DEFAULT_TAPCANVAS_ADMIN_PASSWORD,
	);
	if (!/^[A-Za-z0-9_.-]{1,64}$/.test(username)) {
		throw new Error(
			"TAPCANVAS_ADMIN_USERNAME must contain 1-64 letters, digits, dots, underscores, or hyphens",
		);
	}
	if (password.length < 6 || password.length > 128) {
		throw new Error("TAPCANVAS_ADMIN_PASSWORD must contain 6-128 characters");
	}
	return { username, password };
}

/**
 * Creates the documented administrator only for a fresh database. Existing
 * credentials are never rewritten during startup.
 */
export async function ensureBootstrapAdmin(
	prisma: PrismaClient,
	credentials = resolveBootstrapAdminCredentials(),
): Promise<string> {
	const matches = await prisma.users.findMany({
		where: { login: credentials.username },
		select: {
			id: true,
			role: true,
			disabled: true,
			deleted_at: true,
			password_hash: true,
			password_salt: true,
		},
		take: 2,
	});
	if (matches.length > 1) {
		throw new Error(
			`TapCanvas bootstrap administrator login ${JSON.stringify(credentials.username)} is not unique`,
		);
	}
	const existing = matches[0];
	if (existing) {
		if (
			existing.role !== "admin" ||
			Number(existing.disabled ?? 0) !== 0 ||
			existing.deleted_at !== null ||
			!existing.password_hash ||
			!existing.password_salt
		) {
			throw new Error(
				`TapCanvas bootstrap login ${JSON.stringify(credentials.username)} already belongs to an unavailable, passwordless, or non-admin account`,
			);
		}
		return existing.id;
	}

	const { hash, salt } = await createPasswordRecord(credentials.password);
	const nowIso = new Date().toISOString();
	await prisma.users.create({
		data: {
			id: "tapcanvas_admin",
			login: credentials.username,
			name: "TapCanvas Admin",
			password_hash: hash,
			password_salt: salt,
			password_updated_at: nowIso,
			role: "admin",
			disabled: 0,
			guest: 0,
			created_at: nowIso,
			updated_at: nowIso,
		},
	});
	return "tapcanvas_admin";
}
