import type { Next } from "hono";
import type { AppContext, PrismaClient } from "../types";
import { getConfig } from "../config";
import { getCookie } from "hono/cookie";
import { verifyJwtHS256 } from "../jwt";
import { getPrismaClient } from "../platform/node/prisma";
import { resolveLocalDevRole } from "../modules/auth/local-admin";

export type AuthPayload = {
	sub: string;
	login: string;
	name?: string;
	avatarUrl?: string | null;
	email?: string | null;
	phone?: string | null;
	hasPassword?: boolean;
	role?: string | null;
	guest?: boolean;
};

export type UserDbAuthState = {
	role: string | null;
	disabled: boolean;
	deletedAt: string | null;
	hasPassword: boolean;
};

function normalizeDbRole(value: unknown): string | null {
	const r = typeof value === "string" ? value.trim() : "";
	return r ? r : null;
}

function normalizeDbDeletedAt(value: unknown): string | null {
	const s = typeof value === "string" ? value.trim() : "";
	return s ? s : null;
}

function normalizeDbDisabled(value: unknown): boolean {
	return Number(value ?? 0) !== 0;
}

export async function tryGetUserDbAuthState(
	db: PrismaClient,
	userId: string,
): Promise<UserDbAuthState | null> {
	void db;
	const row = await getPrismaClient().users.findUnique({
		where: { id: userId },
		select: {
			role: true,
			disabled: true,
			deleted_at: true,
			password_hash: true,
		},
	});
	if (!row) return null;
	return {
		role: normalizeDbRole(row.role),
		disabled: normalizeDbDisabled(row.disabled),
		deletedAt: normalizeDbDeletedAt(row.deleted_at),
		hasPassword: typeof row.password_hash === "string" && row.password_hash.trim().length > 0,
	};
}

async function ensureUserRow(c: AppContext, payload: AuthPayload) {
	const nowIso = new Date().toISOString();
	const id = payload.sub;
	const login =
		(typeof payload.login === "string" && payload.login.trim()) ||
		`user_${id.slice(0, 8)}`;
	const name =
		(typeof payload.name === "string" && payload.name.trim()) || login;
	const avatarUrl =
		typeof payload.avatarUrl === "string" ? payload.avatarUrl : null;
	const email = typeof payload.email === "string" ? payload.email : null;
	const guest = payload.guest ? 1 : 0;

	try {
		const prisma = getPrismaClient();
		const existing = await prisma.users.findUnique({
			where: { id },
			select: { id: true },
		});
		if (existing) {
			await prisma.users.update({
				where: { id },
				data: {
					last_seen_at: nowIso,
					updated_at: nowIso,
				},
			});
			return;
		}
		const role = resolveLocalDevRole(c, payload.role);
		await prisma.users.create({
			data: {
				id,
				login,
				name,
				avatar_url: avatarUrl,
				email,
				role,
				guest,
				last_seen_at: nowIso,
				created_at: nowIso,
				updated_at: nowIso,
			},
		});
	} catch {
		// Best-effort only: auth should not be blocked by a failed "ensure user" write.
	}
}

export function readAuthToken(c: AppContext): string | null {
	const authHeader = c.req.header("Authorization") || "";
	const headerToken = authHeader.startsWith("Bearer ")
		? authHeader.slice("Bearer ".length).trim()
		: null;
	const cookieToken = getCookie(c, "tap_token") || null;
	return headerToken || cookieToken;
}

export async function resolveAuth(
	c: AppContext,
): Promise<{ token: string; payload: AuthPayload } | null> {
	const token = readAuthToken(c);

	if (!token) {
		return null;
	}

	const config = getConfig(c.env);

	const payload = await verifyJwtHS256<AuthPayload>(
		token,
		config.jwtSecret,
	);

	if (!payload || !payload.sub) {
		return null;
	}

	return { token, payload };
}

export async function authMiddleware(c: AppContext, next: Next) {
	const resolved = await resolveAuth(c);

	if (!resolved) {
		return c.json({ error: "Unauthorized" }, 401);
	}

	c.set("userId", resolved.payload.sub);
	c.set("auth", {
		...resolved.payload,
		role: resolveLocalDevRole(c, resolved.payload.role),
	});
	await ensureUserRow(c, resolved.payload);

	const dbState = await tryGetUserDbAuthState(c.env.DB, resolved.payload.sub);
	if (dbState) {
		const nextAuth: AuthPayload = {
			...resolved.payload,
			role: resolveLocalDevRole(c, dbState.role),
			hasPassword: dbState.hasPassword,
		};
		c.set("auth", nextAuth);
		if (dbState.deletedAt) {
			return c.json({ error: "Account deleted", code: "user_deleted" }, 403);
		}
		if (dbState.disabled) {
			return c.json({ error: "Account disabled", code: "user_disabled" }, 403);
		}
	}

	if (!dbState) {
		c.set("auth", {
			...resolved.payload,
			role: resolveLocalDevRole(c, resolved.payload.role),
		});
	}

	return next();
}
