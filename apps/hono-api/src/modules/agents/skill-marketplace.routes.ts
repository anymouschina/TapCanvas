import { Hono } from "hono";
import type { AppContext, AppEnv } from "../../types";
import {
	listSkillMarketplace,
	SkillMarketplaceResponseSchema,
} from "../ranking/ranking-control";
import {
	PurchaseMarketplaceSkillResponseSchema,
	SkillMarketplaceSellerDashboardSchema,
	SkillMarketplaceSellerListingsSchema,
} from "./skill-marketplace.schemas";
import {
	getSkillMarketplaceSellerDashboard,
	listSkillMarketplaceSellerListings,
	purchaseMarketplaceSkill,
} from "./skill-marketplace.service";

export const skillMarketplaceRouter = new Hono<AppEnv>();

skillMarketplaceRouter.get("/skills/marketplace", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const marketplace = await listSkillMarketplace(userId);
	return c.json(SkillMarketplaceResponseSchema.parse(marketplace));
});

skillMarketplaceRouter.get("/skills/marketplace/seller-dashboard", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const dashboard = await getSkillMarketplaceSellerDashboard(userId);
	return c.json(SkillMarketplaceSellerDashboardSchema.parse(dashboard));
});

skillMarketplaceRouter.get("/skills/marketplace/seller-listings", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const listings = await listSkillMarketplaceSellerListings(userId);
	return c.json(SkillMarketplaceSellerListingsSchema.parse(listings));
});

skillMarketplaceRouter.post("/skills/marketplace/:productId/purchase", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const purchase = await purchaseMarketplaceSkill(
		c as AppContext,
		userId,
		c.req.param("productId"),
	);
	return c.json(PurchaseMarketplaceSkillResponseSchema.parse(purchase));
});
