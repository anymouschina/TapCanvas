import type { AppContext } from "../types";

export type DevPublicBypassState = {
	enabled: boolean;
	userId: string;
	role: string;
};

function normalizeHeaderValue(value: string | undefined | null): string {
	return typeof value === "string" ? value.trim() : "";
}

function readHostNameFromHostHeader(hostHeader: string): string {
	const raw = normalizeHeaderValue(hostHeader).toLowerCase();
	if (!raw) return "";
	// host may include port; IPv6 may be bracketed.
	if (raw.startsWith("[")) {
		const end = raw.indexOf("]");
		return end > 0 ? raw.slice(1, end) : raw;
	}
	return raw.split(":")[0] || raw;
}

function isLoopbackHost(hostname: string): boolean {
	const h = (hostname || "").trim().toLowerCase();
	return h === "localhost" || h === "127.0.0.1" || h === "::1";
}

function readPathNameFromUrl(rawUrl: string | undefined | null): string {
	const text = normalizeHeaderValue(rawUrl);
	if (!text) return "";
	try {
		return new URL(text).pathname.trim();
	} catch {
		return "";
	}
}

function readEnvString(env: unknown, key: string): string {
	if (!env || typeof env !== "object") return "";
	const v = (env as Record<string, unknown>)[key];
	return typeof v === "string" ? v.trim() : "";
}

function readEnvBool(env: unknown, key: string): boolean {
	const raw = readEnvString(env, key).toLowerCase();
	return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function readLoopbackHostFromContext(c: AppContext): string {
	const hostHeader = c.req.header("host") || "";
	if (hostHeader.trim()) {
		return readHostNameFromHostHeader(hostHeader);
	}
	const rawUrl = "url" in c.req ? String((c.req as { url?: unknown }).url || "") : "";
	try {
		return new URL(rawUrl).hostname.trim().toLowerCase();
	} catch {
		return "";
	}
}

export function resolveDevPublicBypassFromContext(c: AppContext): DevPublicBypassState | null {
	const enabled = readEnvBool(c.env, "TAPCANVAS_DEV_PUBLIC_BYPASS");
	if (!enabled) return null;

	const secret = readEnvString(c.env, "TAPCANVAS_DEV_PUBLIC_BYPASS_SECRET");
	if (!secret) return null;

	const provided = normalizeHeaderValue(c.req.header("x-tap-dev-bypass"));
	if (!provided || provided !== secret) return null;

	const host = readHostNameFromHostHeader(c.req.header("host") || "");
	if (!isLoopbackHost(host)) return null;

	const userId = readEnvString(c.env, "TAPCANVAS_DEV_PUBLIC_BYPASS_USER_ID") || "dev-local";
	const role = readEnvString(c.env, "TAPCANVAS_DEV_PUBLIC_BYPASS_ROLE") || "admin";
	return { enabled: true, userId, role };
}

export function isLoopbackRequestFromContext(c: AppContext): boolean {
	return isLoopbackHost(readLoopbackHostFromContext(c));
}
