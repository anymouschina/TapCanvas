import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { AppEnv, WorkerEnv } from "../../types";

const { listCommerceDictionaryItems, upsertCommerceDictionaryItem } = vi.hoisted(() => ({
	listCommerceDictionaryItems: vi.fn(),
	upsertCommerceDictionaryItem: vi.fn(),
}));

vi.mock("../../middleware/auth", () => ({
	authMiddleware: async (
		c: { req: { header: (name: string) => string | undefined }; set: (key: string, value: unknown) => void },
		next: () => Promise<void>,
	) => {
		const role = c.req.header("x-test-role") || "member";
		c.set("userId", "request-user");
		c.set("auth", { role });
		await next();
	},
}));

vi.mock("./commerce.service", () => ({
	createDetailPageFeedbackForOwner: vi.fn(),
	deleteDetailPageSampleForOwner: vi.fn(),
	consumeSubscriptionQuotaForOwner: vi.fn(),
	deleteCommerceDictionaryItem: vi.fn(),
	getDetailPageEvolutionSummaryForOwner: vi.fn(),
	listActiveSubscriptionsForOwner: vi.fn(),
	listCommerceDictionaryItems,
	listDetailPageSamplesForOwner: vi.fn(),
	listSubscriptionDailyQuotasForOwner: vi.fn(),
	retrieveDetailPageSamplesForOwner: vi.fn(),
	runDetailPageEvolutionForOwner: vi.fn(),
	upsertDetailPageSampleForOwner: vi.fn(),
	upsertCommerceDictionaryItem,
	upsertProductEntitlementForCatalog: vi.fn(),
}));

import { commerceRouter } from "./commerce.routes";

const app = new Hono<AppEnv>();
app.route("/commerce", commerceRouter);

const env = {
	DB: {},
	COMMERCE_PLATFORM_OWNER_ID: "platform-owner",
} as unknown as WorkerEnv;

describe("commerce reserved dictionary routes", () => {
	beforeEach(() => vi.clearAllMocks());

	it("forbids a regular user from reading the platform account namespace", async () => {
		const response = await app.request("/commerce/dictionaries?dictType=platform_account", {}, env);

		expect(response.status).toBe(403);
		expect(await response.json()).toMatchObject({ code: "platform_account_admin_required" });
		expect(listCommerceDictionaryItems).not.toHaveBeenCalled();
	});

	it("forbids a regular user from writing the platform account namespace", async () => {
		const response = await app.request("/commerce/dictionaries", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				dictType: "platform_account",
				code: "member_center",
				name: "malicious settings",
				valueJson: "{}",
			}),
		}, env);

		expect(response.status).toBe(403);
		expect(await response.json()).toMatchObject({ code: "platform_account_admin_required" });
		expect(upsertCommerceDictionaryItem).not.toHaveBeenCalled();
	});

	it("writes an admin platform account dictionary under the configured platform owner", async () => {
		upsertCommerceDictionaryItem.mockResolvedValue({
			id: "dict-1",
			ownerId: "platform-owner",
			dictType: "platform_account",
			code: "member_center",
			name: "settings",
			valueJson: "{}",
			enabled: true,
			sortOrder: 0,
			createdAt: "2026-07-22T00:00:00.000Z",
			updatedAt: "2026-07-22T00:00:00.000Z",
		});
		const response = await app.request("/commerce/dictionaries", {
			method: "POST",
			headers: { "Content-Type": "application/json", "X-Test-Role": "admin" },
			body: JSON.stringify({
				dictType: "platform_account",
				code: "member_center",
				name: "settings",
				valueJson: "{}",
			}),
		}, env);

		expect(response.status).toBe(200);
		expect(upsertCommerceDictionaryItem).toHaveBeenCalledWith(expect.anything(), "platform-owner", expect.objectContaining({
			dictType: "platform_account",
		}));
	});
});
