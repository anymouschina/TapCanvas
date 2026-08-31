import type { AppContext } from "../../types";
import { resolveRequestOrigin } from "../../middleware/http-security";
import {
	resolveLocalAssetPublicBase,
	resolveLocalAssetStorageConfig,
} from "./local-asset-storage";
import { resolveObjectStorageConfig } from "./rustfs.client";

function resolveConfiguredLocalAssetPublicBase(
	env: Pick<AppContext, "env">["env"],
): string | null {
	const raw = typeof env.LOCAL_ASSET_PUBLIC_BASE_URL === "string"
		? env.LOCAL_ASSET_PUBLIC_BASE_URL.trim()
		: "";
	if (!raw) return null;

	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		throw new Error("LOCAL_ASSET_PUBLIC_BASE_URL must be a valid URL");
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new Error("LOCAL_ASSET_PUBLIC_BASE_URL must use http or https");
	}
	if (url.search || url.hash) {
		throw new Error("LOCAL_ASSET_PUBLIC_BASE_URL must not contain query or hash");
	}
	return url.toString().replace(/\/+$/, "");
}

/**
 * Resolve the publicly-accessible base URL for hosted assets.
 *
 * The selected provider contract always includes one canonical public origin.
 */
export function resolvePublicAssetBaseUrl(
	c: Pick<AppContext, "env" | "req">,
): string {
	const storage = resolveObjectStorageConfig(c.env);
	if (storage) return storage.publicBase;
	if (!resolveLocalAssetStorageConfig()) return "";
	const configuredLocalBase = resolveConfiguredLocalAssetPublicBase(c.env);
	if (configuredLocalBase) return configuredLocalBase;
	const requestOrigin = resolveRequestOrigin(c);
	return requestOrigin ? resolveLocalAssetPublicBase(requestOrigin) : "";
}
