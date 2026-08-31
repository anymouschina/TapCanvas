import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
	new URL(
		"../../../prisma/migrations/20260723133000_seed_personal_membership_products/migration.sql",
		import.meta.url,
	),
	"utf8",
);

describe("personal membership catalog hard cutover", () => {
	it("keeps legacy catalog records but removes them from the active purchase surface", () => {
		expect(migrationSql).toContain('UPDATE "product_skus" sku');
		expect(migrationSql).toContain('UPDATE "products" product');
		expect(migrationSql).toContain('"status" = \'inactive\'');
		expect(migrationSql).not.toMatch(/DELETE\s+FROM\s+"(?:products|product_skus|product_entitlements|order_items)"/i);
	});

	it("rebinds active legacy subscriptions to exact canonical SKU IDs", () => {
		expect(migrationSql).toContain("legacy_subscription_map");
		expect(migrationSql).toContain("('ULTRA', 'ultra', 'sys_membership_ultra')");
		expect(migrationSql).toContain("('ultra', 'monthly', 'monthly')");
		expect(migrationSql).toContain("an active legacy subscription could not be mapped to a canonical SKU");
	});
});
