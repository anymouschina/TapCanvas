import { AppError } from "../../middleware/error";
import type { AppContext } from "../../types";

export const COMMERCE_PLATFORM_OWNER_ENV_KEY = "COMMERCE_PLATFORM_OWNER_ID";

export function getPlatformCatalogOwnerId(c: AppContext): string | null {
	const ownerId = String(c.env.COMMERCE_PLATFORM_OWNER_ID || "").trim();
	return ownerId || null;
}

export function resolveProductCatalogOwnerId(c: AppContext, userId: string): string {
	return getPlatformCatalogOwnerId(c) ?? userId;
}

export function requirePlatformCatalogOwnerId(c: AppContext): string {
	const ownerId = getPlatformCatalogOwnerId(c);
	if (!ownerId) {
		throw new AppError(`${COMMERCE_PLATFORM_OWNER_ENV_KEY} is required`, {
			status: 500,
			code: "commerce_platform_owner_missing",
		});
	}
	return ownerId;
}
