import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppContext } from "../../types";
import { MembershipConfigSchema, UpsertProductEntitlementRequestSchema } from "./commerce.schemas";

const {
	deleteDictionaryRow,
	getDictionaryById,
	getDictionaryByIdAnyOwner,
	getProductById,
	upsertProductEntitlement,
} = vi.hoisted(() => ({
	deleteDictionaryRow: vi.fn(),
	getDictionaryById: vi.fn(),
	getDictionaryByIdAnyOwner: vi.fn(),
	getProductById: vi.fn(),
	upsertProductEntitlement: vi.fn(),
}));

vi.mock("./commerce.repo", () => ({
	deleteDictionaryRow,
	getDictionaryById,
	getDictionaryByIdAnyOwner,
	getProductById,
	upsertProductEntitlement,
}));
vi.mock("../product/product.repo", () => ({ getProductById }));

import {
	deleteCommerceDictionaryItem,
	upsertCommerceDictionaryItem,
	upsertProductEntitlementForCatalog,
} from "./commerce.service";

function createContext(): AppContext {
	return {
		env: { DB: {}, COMMERCE_PLATFORM_OWNER_ID: "platform-owner" } as AppContext["env"],
		get: (key: string) => key === "auth" ? { role: "member" } : undefined,
	} as unknown as AppContext;
}

const validMembershipConfig = {
	billingCycle: "monthly",
	durationDays: 30,
	monthlyCredits: 9900,
	dailyGiftCredits: 350,
	concurrencyLimit: 6,
	capacityLabel: "",
	timezone: "Asia/Shanghai",
	skuConfigs: {
		"sku-1": {
			billingCycle: "annual",
			durationDays: 90,
			monthlyCredits: 10900,
			dailyGiftCredits: 500,
			concurrencyLimit: 6,
			capacityLabel: "",
			timezone: "Asia/Shanghai",
			compareAtPriceCents: 29900,
		},
	},
};

describe("commerce security contracts", () => {
	beforeEach(() => vi.clearAllMocks());

	it("strictly validates monthly quota entitlement configuration", () => {
		expect(UpsertProductEntitlementRequestSchema.safeParse({
			entitlementType: "membership",
			config: validMembershipConfig,
		}).success).toBe(true);
		expect(MembershipConfigSchema.parse(validMembershipConfig).skuConfigs?.["sku-1"]?.compareAtPriceCents).toBe(29900);
		expect(UpsertProductEntitlementRequestSchema.safeParse({
			entitlementType: "membership",
			config: { ...validMembershipConfig, timezone: "Invalid/Timezone" },
		}).success).toBe(false);
		expect(UpsertProductEntitlementRequestSchema.safeParse({
			entitlementType: "membership",
			config: { ...validMembershipConfig, durationDays: 0 },
		}).success).toBe(false);
		expect(UpsertProductEntitlementRequestSchema.safeParse({
			entitlementType: "membership",
			config: { ...validMembershipConfig, unexpected: true },
		}).success).toBe(false);
	});

	it("rejects direct service upsert of invalid monthly quota config", async () => {
		getProductById.mockResolvedValue({ id: "product-1", owner_id: "platform-owner" });

		await expect(upsertProductEntitlementForCatalog(createContext(), "product-1", {
			entitlementType: "membership",
			config: { ...validMembershipConfig, timezone: "Not/AZone" },
		})).rejects.toMatchObject({ code: "membership_config_invalid" });
		expect(upsertProductEntitlement).not.toHaveBeenCalled();
	});

	it("forbids a non-admin from deleting a reserved platform dictionary", async () => {
		getDictionaryById.mockResolvedValue({
			id: "dict-1",
			owner_id: "user-1",
			dict_type: "platform_account",
			code: "member_center",
			name: "settings",
			value_json: null,
			enabled: 1,
			sort_order: 0,
			created_at: "2026-07-22T00:00:00.000Z",
			updated_at: "2026-07-22T00:00:00.000Z",
		});

		await expect(deleteCommerceDictionaryItem(createContext(), "user-1", "dict-1"))
			.rejects.toMatchObject({ status: 403, code: "platform_account_admin_required" });
		expect(deleteDictionaryRow).not.toHaveBeenCalled();
	});

	it("forbids a direct non-admin service write to the reserved platform namespace", async () => {
		await expect(upsertCommerceDictionaryItem(createContext(), "user-1", {
			dictType: "platform_account",
			code: "member_center",
			name: "settings",
			valueJson: "{}",
		})).rejects.toMatchObject({ status: 403, code: "platform_account_admin_required" });
	});
});
