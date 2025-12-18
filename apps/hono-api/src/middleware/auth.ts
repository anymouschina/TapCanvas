import type { Next } from "hono";
import type { AppContext } from "../types";
import { getConfig } from "../config";
import { getCookie } from "hono/cookie";
import { verifyJwtHS256 } from "../jwt";

export type AuthPayload = {
	sub: string;
	login: string;
	name?: string;
	avatarUrl?: string | null;
	email?: string | null;
	role?: string | null;
	guest?: boolean;
};

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
		await c.env.DB.prepare(
			`UPDATE users SET last_seen_at = ?, updated_at = ? WHERE id = ?`,
		)
			.bind(nowIso, nowIso, id)
			.run();

		const exists = await c.env.DB.prepare(
			`SELECT id FROM users WHERE id = ? LIMIT 1`,
		)
			.bind(id)
			.first<any>();

		if (exists) return;

		await c.env.DB.prepare(
			`
      INSERT INTO users (id, login, name, avatar_url, email, role, guest, last_seen_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)
    `,
		)
			.bind(id, login, name, avatarUrl, email, guest, nowIso, nowIso, nowIso)
			.run();
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
	c.set("auth", resolved.payload);
	await ensureUserRow(c, resolved.payload);

	return next();
}
