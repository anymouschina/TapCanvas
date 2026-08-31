import type { AppContext } from "../../types";
import { AppError } from "../../middleware/error";
import { getApiKeyByHash } from "./apiKey.repo";
import { hashApiKeySecret } from "./apiKey.service";
import { isInternalApiKey } from "./internal-api-key";

export function assertOriginAllowedForApiKey(
	requestOrigin: string | undefined,
	allowedOriginsJson: string,
): void {
	const origin = (requestOrigin || "").trim();
	if (!origin) return;
	let allowed: string[] = [];
	try {
		const parsed: unknown = JSON.parse(allowedOriginsJson);
		if (Array.isArray(parsed)) {
			allowed = parsed.filter(
				(value): value is string => typeof value === "string" && Boolean(value.trim()),
			);
		}
	} catch {
		return;
	}
	if (!allowed.length || allowed.includes("*")) return;
	let normalized = origin;
	try {
		normalized = new URL(origin).origin;
	} catch {
		// Invalid Origin values, including "null", remain unmatched.
	}
	if (allowed.includes(normalized)) return;
	throw new AppError("Origin not allowed for this API key", {
		status: 403,
		code: "api_key_origin_forbidden",
		details: { origin: normalized },
	});
}

export function readApiKeyFromRequest(c: AppContext): string | null {
	const headerKey = (c.req.header("x-api-key") || "").trim();
	if (headerKey) return headerKey;

	const authorization = (c.req.header("Authorization") || "").trim();
	if (!/^bearer\s+/i.test(authorization)) return null;
	const token = authorization.slice("bearer".length).trim();
	return token.startsWith("tc_sk_") || isInternalApiKey(token) ? token : null;
}

export async function resolveApiKeyRowFromRequest(c: AppContext) {
	const apiKey = readApiKeyFromRequest(c);
	if (!apiKey || apiKey.startsWith("tc_internal:")) return null;
	const keyHash = await hashApiKeySecret(apiKey);
	const row = await getApiKeyByHash(c.env.DB, keyHash);
	if (!row || row.enabled !== 1 || row.revoked_at) return null;
	if (row.expires_at && Date.parse(row.expires_at) <= Date.now()) {
		throw new AppError("API key expired", {
			status: 401,
			code: "api_key_expired",
		});
	}
	assertOriginAllowedForApiKey(c.req.header("Origin"), row.allowed_origins);
	return row;
}
