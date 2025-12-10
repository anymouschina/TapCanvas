import type { Next } from "hono";
import type { AppContext } from "../types";
import { getConfig } from "../config";
import { verifyJwtHS256 } from "../jwt";

export type AuthPayload = {
	sub: string;
	login: string;
	name?: string;
	avatarUrl?: string | null;
	email?: string | null;
	guest?: boolean;
};

export async function authMiddleware(c: AppContext, next: Next) {
	const authHeader = c.req.header("Authorization") || "";
	const token = authHeader.startsWith("Bearer ")
		? authHeader.slice("Bearer ".length).trim()
		: null;

	if (!token) {
		return c.json({ error: "Unauthorized" }, 401);
	}

	const config = getConfig(c.env);

	const payload = await verifyJwtHS256<AuthPayload>(
		token,
		config.jwtSecret,
	);

	if (!payload || !payload.sub) {
		return c.json({ error: "Invalid or expired token" }, 401);
	}

	c.set("userId", payload.sub);
	c.set("auth", payload);

	return next();
}

