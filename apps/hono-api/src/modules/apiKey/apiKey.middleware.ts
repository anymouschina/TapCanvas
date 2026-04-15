import type { Next } from "hono";
import type { AppContext } from "../../types";
import { AppError } from "../../middleware/error";
import { resolveAuth, tryGetUserDbAuthState } from "../../middleware/auth";
import {
	resolveDevPublicBypassFromContext,
} from "../../middleware/devPublicBypass";
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

export async function apiKeyAuthMiddleware(c: AppContext, next: Next) {
	const apiKey = readApiKeyFromRequest(c);

	const devBypass = resolveDevPublicBypassFromContext(c);
	if (devBypass) {
		c.set("userId", devBypass.userId);
		c.set("auth", { sub: devBypass.userId, login: devBypass.userId, role: devBypass.role });
		c.set("devPublicBypass", true);
		return next();
	}

	// Prefer JWT as end-user identity (canvas usage); API key becomes optional.
	const resolved = await resolveAuth(c).catch(() => null);

	const jwtUserId = resolved?.payload?.sub ? String(resolved.payload.sub) : "";
	const hasJwt = Boolean(jwtUserId);

	if (hasJwt) {
		const userState = await tryGetUserDbAuthState(c.env.DB, jwtUserId);
		if (userState?.deletedAt) {
			throw new AppError("Account deleted", {
				status: 403,
				code: "user_deleted",
			});
		}
		if (userState?.disabled) {
			throw new AppError("Account disabled", {
				status: 403,
				code: "user_disabled",
			});
		}
		c.set("userId", jwtUserId);
		c.set("auth", {
			...resolved!.payload,
			role: userState?.role ?? resolved!.payload.role ?? null,
		});
	}

	let apiKeyRow:
		| Awaited<ReturnType<typeof getApiKeyByHash>>
		| null = null;
	if (apiKey) {
		try {
			const keyHash = await hashApiKeySecret(apiKey);
			const row = await getApiKeyByHash(c.env.DB, keyHash);
			if (row && row.enabled === 1) {
				const ownerState = await tryGetUserDbAuthState(c.env.DB, row.owner_id);
				if (ownerState?.deletedAt) {
					throw new AppError("Account deleted", {
						status: 403,
						code: "api_key_owner_deleted",
					});
				}
				if (ownerState?.disabled) {
					throw new AppError("Account disabled", {
						status: 403,
						code: "api_key_owner_disabled",
					});
				}
				apiKeyRow = row;
			}
		} catch (err) {
			// If JWT is valid, allow ignoring a bad API key (either one is enough).
			if (!hasJwt) throw err;
		}
	}

	// Require at least one valid auth method.
	if (!hasJwt && !apiKeyRow) {
		throw new AppError("Unauthorized", {
			status: 401,
			code: apiKey ? "api_key_invalid" : "auth_missing",
		});
	}

	if (apiKeyRow) {
		c.set("apiKeyId", apiKeyRow.id);
		c.set("apiKeyOwnerId", apiKeyRow.owner_id);
		if (!hasJwt) {
			c.set("userId", apiKeyRow.owner_id);
		}

		try {
			await touchApiKeyLastUsedAt(
				c.env.DB,
				apiKeyRow.id,
				new Date().toISOString(),
			);
		} catch {
			// best-effort only
		}
	}

	return next();
}
