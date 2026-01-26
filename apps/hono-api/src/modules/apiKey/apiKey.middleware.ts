import type { Next } from "hono";
import type { AppContext } from "../../types";
import { AppError } from "../../middleware/error";
import { resolveAuth } from "../../middleware/auth";
import { getApiKeyByHash, touchApiKeyLastUsedAt } from "./apiKey.repo";
import { hashApiKeySecret } from "./apiKey.service";

function readApiKeyFromRequest(c: AppContext): string | null {
	const headerKey = (c.req.header("x-api-key") || "").trim();
	if (headerKey) return headerKey;

	const auth = (c.req.header("Authorization") || "").trim();
	if (/^bearer\s+/i.test(auth)) {
		// Backward-compatible: allow passing API key in Authorization header.
		// IMPORTANT: only treat it as an API key when it matches our key format,
		// otherwise it may conflict with end-user JWT tokens (also in Authorization).
		const token = auth.slice("bearer".length).trim();
		if (token.startsWith("tc_sk_")) return token;
	}

	return null;
}

function normalizeOrigin(input: string): string | null {
	const trimmed = input.trim();
	if (!trimmed) return null;
	try {
		const url = new URL(trimmed);
		if (url.protocol !== "http:" && url.protocol !== "https:") return null;
		return url.origin;
	} catch {
		return null;
	}
}

function parseAllowedOrigins(json: string): string[] {
	try {
		const parsed = JSON.parse(json);
		if (Array.isArray(parsed)) {
			return parsed.filter(
				(v) => typeof v === "string" && !!v.trim(),
			) as string[];
		}
		return [];
	} catch {
		return [];
	}
}

function isOriginAllowed(allowedOrigins: string[], originHeader: string | null): boolean {
	if (allowedOrigins.includes("*")) return true;
	if (!originHeader) return false;
	const normalized = normalizeOrigin(originHeader);
	if (!normalized) return false;
	return allowedOrigins.includes(normalized);
}

export async function apiKeyAuthMiddleware(c: AppContext, next: Next) {
	const apiKey = readApiKeyFromRequest(c);
	if (!apiKey) {
		throw new AppError("Unauthorized", {
			status: 401,
			code: "api_key_missing",
		});
	}

	const keyHash = await hashApiKeySecret(apiKey);
	const row = await getApiKeyByHash(c.env.DB, keyHash);
	if (!row || row.enabled !== 1) {
		throw new AppError("Unauthorized", {
			status: 401,
			code: "api_key_invalid",
		});
	}

	const allowedOrigins = parseAllowedOrigins(row.allowed_origins);
	const originHeader = c.req.header("Origin");
	if (!isOriginAllowed(allowedOrigins, originHeader)) {
		throw new AppError("Origin not allowed", {
			status: 403,
			code: "origin_not_allowed",
			details: {
				origin: originHeader || null,
			},
		});
	}

	c.set("apiKeyId", row.id);
	c.set("apiKeyOwnerId", row.owner_id);

	// Optional: if a valid TapCanvas JWT is present, bill/own tasks by that user.
	// This enables in-canvas usage like: X-API-Key (channel) + Authorization (end-user).
	const resolved = await resolveAuth(c).catch(() => null);
	if (resolved?.payload?.sub) {
		c.set("userId", resolved.payload.sub);
		c.set("auth", resolved.payload);
	} else {
		c.set("userId", row.owner_id);
	}

	try {
		await touchApiKeyLastUsedAt(c.env.DB, row.id, new Date().toISOString());
	} catch {
		// best-effort only
	}

	return next();
}
