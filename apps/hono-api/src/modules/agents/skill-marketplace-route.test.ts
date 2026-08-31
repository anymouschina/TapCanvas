import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppContext, AppEnv } from "../../types";

const { listSkillMarketplace, purchaseMarketplaceSkill, getSkillMarketplaceSellerDashboard, listSkillMarketplaceSellerListings } = vi.hoisted(() => ({
	listSkillMarketplace: vi.fn(),
	purchaseMarketplaceSkill: vi.fn(),
	getSkillMarketplaceSellerDashboard: vi.fn(),
	listSkillMarketplaceSellerListings: vi.fn(),
}));

vi.mock("../ranking/ranking-control", () => ({
	listSkillMarketplace,
	SkillMarketplaceResponseSchema: {
		parse: (value: unknown): unknown => value,
	},
}));

vi.mock("./skill-marketplace.service", () => ({
	purchaseMarketplaceSkill,
	getSkillMarketplaceSellerDashboard,
	listSkillMarketplaceSellerListings,
}));

import { skillMarketplaceRouter } from "./skill-marketplace.routes";

const marketplaceResponse = {
	configured: false,
	config: {
		purchaseWeight: 70,
		freshnessWeight: 30,
		freshnessHalfLifeDays: 90,
		items: {},
	},
	creditBalance: 1200,
	canListSkills: false,
	items: [],
};

function createApp(): Hono<AppEnv> {
	const app = new Hono<AppEnv>();
	app.use("/agents/*", async (c: AppContext, next: () => Promise<void>) => {
		c.set("userId", "marketplace-route-test-user");
		await next();
	});
	app.route("/agents", skillMarketplaceRouter);
	return app;
}

describe("GET /agents/skills/marketplace", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		listSkillMarketplace.mockResolvedValue(marketplaceResponse);
	});

	it("is mounted at the frontend's canonical marketplace path", async () => {
		const response = await createApp().request("/agents/skills/marketplace");

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual(marketplaceResponse);
		expect(listSkillMarketplace).toHaveBeenCalledOnce();
		expect(listSkillMarketplace).toHaveBeenCalledWith("marketplace-route-test-user");
	});

	it("returns the authenticated seller's credit-only dashboard", async () => {
		const dashboard = { listedCount: 2, soldCount: 3, totalIncomeCredits: 600, recentSales: [] };
		getSkillMarketplaceSellerDashboard.mockResolvedValue(dashboard);

		const response = await createApp().request("/agents/skills/marketplace/seller-dashboard");

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual(dashboard);
		expect(getSkillMarketplaceSellerDashboard).toHaveBeenCalledWith("marketplace-route-test-user");
	});

	it("returns the authenticated seller's listing review records", async () => {
		listSkillMarketplaceSellerListings.mockResolvedValue({ items: [] });

		const response = await createApp().request("/agents/skills/marketplace/seller-listings");

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ items: [] });
		expect(listSkillMarketplaceSellerListings).toHaveBeenCalledWith("marketplace-route-test-user");
	});

	it("routes an integral purchase to the authenticated buyer", async () => {
		const purchase = {
			status: "purchased",
			listingPriceCredits: 200,
			chargedCredits: 200,
			creditBalance: 800,
			installedAsset: {
				id: "installed-a",
				kind: "skill",
				fileName: "camera-producta.md",
				name: "镜头导演",
				description: null,
				logoUrl: null,
				sizeBytes: 12,
				sha256: "digest",
				marketplaceListing: null,
				sourceMarketplaceProductId: "product-a",
				createdAt: "2026-07-22T00:00:00.000Z",
				updatedAt: "2026-07-22T00:00:00.000Z",
			},
		};
		purchaseMarketplaceSkill.mockResolvedValue(purchase);

		const response = await createApp().request("/agents/skills/marketplace/product-a/purchase", { method: "POST" });

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual(purchase);
		expect(purchaseMarketplaceSkill).toHaveBeenCalledWith(
			expect.anything(),
			"marketplace-route-test-user",
			"product-a",
		);
	});
});
