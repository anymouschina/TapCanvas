import { describe, expect, it } from "vitest";
import { AdminSetUserMembershipRequestSchema } from "./user-admin.schemas";

describe("AdminSetUserMembershipRequestSchema", () => {
	it("accepts explicit membership cancellation", () => {
		const parsed = AdminSetUserMembershipRequestSchema.safeParse({ productId: null });
		expect(parsed.success).toBe(true);
	});

	it("requires an explicit expiry when assigning a personal plan", () => {
		const parsed = AdminSetUserMembershipRequestSchema.safeParse({
			productId: "product-personal-pro",
		});
		expect(parsed.success).toBe(false);
	});

	it("accepts a personal plan, optional SKU, and timezone-aware expiry", () => {
		const parsed = AdminSetUserMembershipRequestSchema.safeParse({
			productId: "product-personal-pro",
			skuId: "sku-annual",
			endAt: "2027-07-22T12:00:00.000Z",
		});
		expect(parsed.success).toBe(true);
	});
});
