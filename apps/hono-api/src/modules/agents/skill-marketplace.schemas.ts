import { z } from "zod";
import { UserContextAssetSchema } from "./agents.schemas";

export const PurchaseMarketplaceSkillResponseSchema = z.object({
	status: z.enum(["purchased", "already_owned"]),
	listingPriceCredits: z.number().int().positive(),
	chargedCredits: z.number().int().nonnegative(),
	creditBalance: z.number().int().nonnegative(),
	installedAsset: UserContextAssetSchema,
}).strict();

export const SkillMarketplaceSaleSchema = z.object({
	id: z.string(),
	skillName: z.string(),
	priceCredits: z.number().int().positive(),
	createdAt: z.string(),
}).strict();

export const SkillMarketplaceSellerDashboardSchema = z.object({
	listedCount: z.number().int().nonnegative(),
	soldCount: z.number().int().nonnegative(),
	totalIncomeCredits: z.number().int().nonnegative(),
	recentSales: z.array(SkillMarketplaceSaleSchema),
}).strict();

export const SkillMarketplaceListingReviewStatusSchema = z.enum([
	"pending",
	"approved",
	"rejected",
]);

export const SkillMarketplaceSellerListingSchema = z.object({
	asset: UserContextAssetSchema,
	reviewStatus: SkillMarketplaceListingReviewStatusSchema,
	category: z.string(),
	submittedAt: z.string(),
	reviewedAt: z.string().nullable(),
}).strict();

export const SkillMarketplaceSellerListingsSchema = z.object({
	items: z.array(SkillMarketplaceSellerListingSchema),
}).strict();

export type PurchaseMarketplaceSkillResponse = z.infer<typeof PurchaseMarketplaceSkillResponseSchema>;
export type SkillMarketplaceSellerDashboard = z.infer<typeof SkillMarketplaceSellerDashboardSchema>;
export type SkillMarketplaceSellerListing = z.infer<typeof SkillMarketplaceSellerListingSchema>;
