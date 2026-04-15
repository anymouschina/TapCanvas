import type { AppContext } from "../../types";

export function isLocalDevRequest(c: AppContext): boolean {
	try {
		const url = new URL(c.req.url);
		const host = url.hostname.trim().toLowerCase();
		return (
			host === "localhost" ||
			host === "127.0.0.1" ||
			host === "0.0.0.0" ||
			host === "::1"
		);
	} catch {
		return false;
	}
}

export function resolveLocalDevRole(
	c: AppContext,
	role: string | null | undefined,
): string | null {
	if (isLocalDevRequest(c)) return "admin";
	const normalized = typeof role === "string" ? role.trim().toLowerCase() : "";
	return normalized || null;
}
