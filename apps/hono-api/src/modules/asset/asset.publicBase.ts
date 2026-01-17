import type { AppContext } from "../../types";

/**
 * Resolve the publicly-accessible base URL for hosted assets.
 *
 * Priority:
 * 1) Explicit env var `R2_PUBLIC_BASE_URL` (recommended: custom domain / CDN)
 * 2) Fallback to same-origin proxy route (`/assets/r2`) so R2 works without extra setup.
 */
export function resolvePublicAssetBaseUrl(
	c: Pick<AppContext, "env" | "req">,
): string {
	const fromEnv =
		typeof (c.env as any).R2_PUBLIC_BASE_URL === "string"
			? String((c.env as any).R2_PUBLIC_BASE_URL).trim()
			: "";
	const trimmed = fromEnv.replace(/\/+$/, "");
	if (trimmed) return trimmed;

	try {
		const origin = new URL(c.req.url).origin;
		return `${origin}/assets/r2`;
	} catch {
		return "";
	}
}

