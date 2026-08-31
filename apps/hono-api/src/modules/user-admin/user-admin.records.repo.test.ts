import { describe, expect, it } from "vitest";
import { buildCreditGrantWhere } from "./user-admin.records.repo";
import { AdminCreditGrantQuerySchema } from "./user-admin.schemas";

describe("admin user record query schemas", () => {
	it("normalizes credit-grant filters", () => {
		expect(AdminCreditGrantQuerySchema.safeParse({ grantType: "weekly" }).success).toBe(false);
		expect(AdminCreditGrantQuerySchema.safeParse({ grantType: "purchase" }).success).toBe(false);
		expect(AdminCreditGrantQuerySchema.parse({ from: "2026-07-23T08:00:00+08:00" }).from).toBe("2026-07-23T00:00:00.000Z");
	});
});

describe("buildCreditGrantWhere", () => {
	it("combines ledger grant type, time range and related membership matches", () => {
		const where = buildCreditGrantWhere({
			q: "user-1",
			grantType: "daily",
			from: "2026-07-22T00:00:00.000Z",
			to: "2026-07-23T00:00:00.000Z",
			page: 1,
			pageSize: 20,
		}, ["related-task-id"]);

		expect(where).toMatchObject({
			entry_type: "topup",
			task_kind: "membership_daily_grant",
			created_at: {
				gte: "2026-07-22T00:00:00.000Z",
				lte: "2026-07-23T00:00:00.000Z",
			},
		});
		expect(where.OR).toHaveLength(8);
		expect(where.OR).toContainEqual({ task_id: { in: ["related-task-id"] } });
	});
});
