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

	return next();
}
