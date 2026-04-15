import type { AppContext } from "../../types";
import { resolveRustfsConfig } from "./rustfs.client";

/**
 * Resolve the publicly-accessible base URL for hosted assets.
 *
 * Priority:
 * 1) Explicit storage public base derived from `R2_PUBLIC_BASE_URL` / `RUSTFS_PUBLIC_BASE_URL`.
 * 2) If storage is configured but no direct public base exists, proxy via this API's `/assets/r2`.
 */
export function resolvePublicAssetBaseUrl(
	c: Pick<AppContext, "env" | "req">,
): string {
	const storage = resolveRustfsConfig(c.env);
	if (!storage) return "";
	if (storage.publicBase) return storage.publicBase;
	try {
		const requestUrl = new URL(c.req.url);
		return `${requestUrl.origin}/assets/r2`;
	} catch {
		// ignore invalid request urls
	}
	return "";
}
