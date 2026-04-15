import { describe, expect, it } from "vitest";
import type { AppContext } from "../../types";
import {
	getPlatformCatalogOwnerId,
	requirePlatformCatalogOwnerId,
	resolveProductCatalogOwnerId,
} from "./commerce.constants";

function createContext(platformOwnerId?: string): AppContext {
	return {
		env: {
			COMMERCE_PLATFORM_OWNER_ID: platformOwnerId,
		} as AppContext["env"],
	} as AppContext;
}

describe("commerce owner resolution", () => {
	it("uses current admin user when platform owner env is missing for product catalog", () => {
		expect(resolveProductCatalogOwnerId(createContext(), "admin_1")).toBe("admin_1");
		expect(getPlatformCatalogOwnerId(createContext())).toBeNull();
	});

	it("uses configured platform owner when provided", () => {
		expect(resolveProductCatalogOwnerId(createContext("platform_1"), "admin_1")).toBe("platform_1");
		expect(requirePlatformCatalogOwnerId(createContext("platform_1"))).toBe("platform_1");
	});
});
