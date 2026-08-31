import type { Next } from "hono";
import type { AppContext, WorkerEnv } from "../types";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function normalizedHttpOrigin(raw: string): string | null {
	try {
		const url = new URL(raw);
		if (url.protocol !== "http:" && url.protocol !== "https:") return null;
		return url.origin;
	} catch {
		return null;
	}
}

function configuredOrigins(env: WorkerEnv): Set<string> {
	const raw = typeof env.CORS_ALLOWED_ORIGINS === "string"
		? env.CORS_ALLOWED_ORIGINS
		: "";
	return new Set(
		raw
			.split(",")
			.map((value) => normalizedHttpOrigin(value.trim()))
			.filter((value): value is string => Boolean(value)),
	);
}

export function resolveRequestOrigin(c: Pick<AppContext, "req">): string | null {
	const forwardedHost = c.req.header("x-forwarded-host")?.split(",")[0]?.trim();
	const forwardedProto = c.req.header("x-forwarded-proto")?.split(",")[0]?.trim();
	const host = forwardedHost || c.req.header("host");
	if (host && forwardedProto) return normalizedHttpOrigin(`${forwardedProto}://${host}`);
	return normalizedHttpOrigin(c.req.url);
}

function hasSameRequestHost(origin: string, currentRequestOrigin: string | null): boolean {
	if (!currentRequestOrigin) return false;
	try {
		return new URL(origin).host === new URL(currentRequestOrigin).host;
	} catch {
		return false;
	}
}

function isApprovedLocalDevelopmentOrigin(origin: string): boolean {
	return origin === "http://localhost:5175" || origin === "http://127.0.0.1:5175";
}

function isLocalRequestOrigin(origin: string | null): boolean {
	if (!origin) return false;
	try {
		const hostname = new URL(origin).hostname;
		return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
	} catch {
		return false;
	}
}

export function resolveAllowedCorsOrigin(
	origin: string,
	c: AppContext,
): string | null {
	const normalized = normalizedHttpOrigin(origin);
	if (!normalized) return null;
	const currentRequestOrigin = resolveRequestOrigin(c);
	// A TLS terminator can leave the internal request URL as http:// while the
	// browser Origin is https://. The host is still the same public host, so
	// treat this as same-origin after the proxy has normalized the request host.
	if (normalized === currentRequestOrigin || hasSameRequestHost(normalized, currentRequestOrigin)) {
		return normalized;
	}
	if (isLocalRequestOrigin(currentRequestOrigin) && isApprovedLocalDevelopmentOrigin(normalized)) {
		return normalized;
	}
	return configuredOrigins(c.env).has(normalized) ? normalized : null;
}

function hasCookieSession(c: AppContext): boolean {
	const cookie = c.req.header("cookie") || "";
	return cookie
		.split(";")
		.map((entry) => entry.trim())
		.some(
			(entry) =>
				entry.startsWith("tap_token=") ||
				entry.startsWith("tap_refresh_token="),
		);
}

export async function browserOriginGuard(c: AppContext, next: Next) {
	const origin = c.req.header("origin");
	if (origin && !resolveAllowedCorsOrigin(origin, c)) {
		return c.json({ error: "Origin not allowed", code: "origin_not_allowed" }, 403);
	}
	if (!SAFE_METHODS.has(c.req.method.toUpperCase()) && hasCookieSession(c) && !origin) {
		return c.json({ error: "Origin required", code: "origin_required" }, 403);
	}
	return next();
}
