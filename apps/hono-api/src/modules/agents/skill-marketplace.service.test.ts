import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "../../middleware/error";
import type { AppContext } from "../../types";

const stubs = vi.hoisted(() => ({
	ensurePersonalBillingTeam: vi.fn(),
	getPersonalBillingTeamId: vi.fn((userId: string) => `personal_${userId}`),
	installMarketplaceAsset: vi.fn(),
	parseSkillLicenseConfig: vi.fn(),
	productEntitlementFindFirst: vi.fn(),
	assetFindFirst: vi.fn(),
	teamFindUnique: vi.fn(),
	teamUpdate: vi.fn(),
	queryRaw: vi.fn(),
	ledgerCreateMany: vi.fn(),
	listUserContextAssets: vi.fn(),
	productsFindMany: vi.fn(),
	transaction: vi.fn(),
	chargeCreditBatches: vi.fn(),
	grantCreditBatch: vi.fn(),
}));

const transactionClient = {
	user_skill_assets: { findFirst: stubs.assetFindFirst },
	teams: { findUnique: stubs.teamFindUnique, update: stubs.teamUpdate },
	team_credit_ledger: { createMany: stubs.ledgerCreateMany },
	$queryRaw: stubs.queryRaw,
};

vi.mock("../../platform/node/prisma", () => ({
	getPrismaClient: () => ({
		product_entitlements: { findFirst: stubs.productEntitlementFindFirst },
		products: { findMany: stubs.productsFindMany },
		$transaction: stubs.transaction,
	}),
}));

vi.mock("../team/team.service", () => ({
	ensurePersonalBillingTeam: stubs.ensurePersonalBillingTeam,
	getPersonalBillingTeamId: stubs.getPersonalBillingTeamId,
}));

vi.mock("../ranking/ranking-control", () => ({
	parseSkillLicenseConfig: stubs.parseSkillLicenseConfig,
}));

vi.mock("./user-context-assets.service", () => ({
	installUserContextAssetFromMarketplaceInTransaction: stubs.installMarketplaceAsset,
	listUserContextAssets: stubs.listUserContextAssets,
}));

vi.mock("../team/team-credit-batch.service", () => ({
	chargeTeamCreditBatchesInTransaction: stubs.chargeCreditBatches,
	grantTeamCreditsInTransaction: stubs.grantCreditBatch,
}));

import { listSkillMarketplaceSellerListings, purchaseMarketplaceSkill } from "./skill-marketplace.service";

const installedAsset = {
	id: "installed-a",
	kind: "skill" as const,
	fileName: "camera-producta.md",
	name: "镜头导演",
	description: "镜头语言 Skill",
	logoUrl: null,
	sizeBytes: 12,
	sha256: "digest",
	marketplaceListing: null,
	sourceMarketplaceProductId: "product-a",
	createdAt: "2026-07-22T00:00:00.000Z",
	updatedAt: "2026-07-22T00:00:00.000Z",
};

function createContext(guest = false): AppContext {
	return {
		get: vi.fn((key: string) => key === "auth" ? { guest } : undefined),
	} as unknown as AppContext;
}

describe("purchaseMarketplaceSkill", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		stubs.productEntitlementFindFirst.mockResolvedValue({
			product_id: "product-a",
			config_json: "{}",
			products: { id: "product-a", status: "active", currency: "CREDITS", price_cents: 200 },
		});
		stubs.parseSkillLicenseConfig.mockReturnValue({
			sourceType: "user_asset",
			skillId: "user_asset:seller-a:source-a",
			skillName: "镜头导演",
			description: "镜头语言 Skill",
			sellerUserId: "seller-a",
			sourceAssetId: "source-a",
			createdAt: "2026-07-22T00:00:00.000Z",
		});
		stubs.ensurePersonalBillingTeam.mockImplementation(async (_context: AppContext, userId: string) => `personal_${userId}`);
		stubs.transaction.mockImplementation(async (operation: (client: typeof transactionClient) => Promise<unknown>) => operation(transactionClient));
		stubs.assetFindFirst.mockResolvedValue(null);
		stubs.queryRaw.mockResolvedValue([
			{ id: "personal_buyer-a", credits: 1_000, credits_frozen: 0 },
			{ id: "personal_seller-a", credits: 100, credits_frozen: 0 },
		]);
		stubs.installMarketplaceAsset.mockResolvedValue({ asset: installedAsset, created: true });
		stubs.chargeCreditBatches.mockResolvedValue({ charged: true, ledgerEntryId: "buyer-ledger" });
		stubs.grantCreditBatch.mockResolvedValue({ granted: true, ledgerEntryId: "seller-ledger" });
		stubs.teamFindUnique.mockResolvedValue({ credits: 800, credits_frozen: 0 });
		stubs.teamUpdate.mockResolvedValue({});
		stubs.ledgerCreateMany.mockResolvedValue({ count: 2 });
	});

	it("atomically deducts buyer credits, credits the seller, records both entries, and installs the Skill", async () => {
		const result = await purchaseMarketplaceSkill(createContext(), "buyer-a", "product-a");

		expect(result).toEqual({
			status: "purchased",
			listingPriceCredits: 200,
			chargedCredits: 200,
			creditBalance: 800,
			installedAsset,
		});
		expect(stubs.installMarketplaceAsset).toHaveBeenCalledWith(transactionClient, {
			buyerUserId: "buyer-a",
			sellerUserId: "seller-a",
			sourceAssetId: "source-a",
			productId: "product-a",
			priceCredits: 200,
		});
		expect(stubs.chargeCreditBatches).toHaveBeenCalledWith(transactionClient, expect.objectContaining({
			teamId: "personal_buyer-a",
			entryType: "deduct",
			amount: 200,
			taskKind: "skill_marketplace_purchase",
		}));
		expect(stubs.grantCreditBatch).toHaveBeenCalledWith(transactionClient, expect.objectContaining({
			teamId: "personal_seller-a",
			amount: 200,
			sourceType: "skill_marketplace_sale",
		}));
	});

	it("rejects insufficient credits before installing or writing balances", async () => {
		stubs.queryRaw.mockResolvedValue([
			{ id: "personal_buyer-a", credits: 199, credits_frozen: 0 },
			{ id: "personal_seller-a", credits: 100, credits_frozen: 0 },
		]);

		await expect(purchaseMarketplaceSkill(createContext(), "buyer-a", "product-a")).rejects.toMatchObject({
			code: "skill_marketplace_insufficient_credits",
		});
		expect(stubs.installMarketplaceAsset).not.toHaveBeenCalled();
		expect(stubs.teamUpdate).not.toHaveBeenCalled();
		expect(stubs.ledgerCreateMany).not.toHaveBeenCalled();
	});

	it("returns an idempotent already-owned result without charging twice", async () => {
		stubs.assetFindFirst.mockResolvedValue({ id: installedAsset.id });
		stubs.installMarketplaceAsset.mockResolvedValue({ asset: installedAsset, created: false });
		stubs.teamFindUnique.mockResolvedValue({ credits: 800, credits_frozen: 25 });

		await expect(purchaseMarketplaceSkill(createContext(), "buyer-a", "product-a")).resolves.toEqual({
			status: "already_owned",
			listingPriceCredits: 200,
			chargedCredits: 0,
			creditBalance: 775,
			installedAsset,
		});
		expect(stubs.queryRaw).not.toHaveBeenCalled();
		expect(stubs.teamUpdate).not.toHaveBeenCalled();
		expect(stubs.ledgerCreateMany).not.toHaveBeenCalled();
	});

	it("rejects guest and self purchases explicitly", async () => {
		await expect(purchaseMarketplaceSkill(createContext(true), "buyer-a", "product-a")).rejects.toMatchObject({
			code: "skill_marketplace_guest_purchase_restricted",
		});
		stubs.parseSkillLicenseConfig.mockReturnValue({
			sourceType: "user_asset",
			skillId: "user_asset:buyer-a:source-a",
			skillName: "镜头导演",
			description: null,
			sellerUserId: "buyer-a",
			sourceAssetId: "source-a",
			createdAt: "2026-07-22T00:00:00.000Z",
		});
		await expect(purchaseMarketplaceSkill(createContext(), "buyer-a", "product-a")).rejects.toMatchObject({
			code: "skill_marketplace_self_purchase_forbidden",
		});
	});

	it("rejects non-credit products and propagates source integrity failures without ledger writes", async () => {
		stubs.productEntitlementFindFirst.mockResolvedValueOnce({
			product_id: "product-a",
			config_json: "{}",
			products: { id: "product-a", status: "active", currency: "CNY", price_cents: 200 },
		});
		await expect(purchaseMarketplaceSkill(createContext(), "buyer-a", "product-a")).rejects.toMatchObject({
			code: "skill_marketplace_currency_invalid",
		});

		stubs.installMarketplaceAsset.mockRejectedValueOnce(new AppError("用户上下文资产正文与元数据不一致", {
			status: 500,
			code: "user_context_asset_integrity_mismatch",
		}));
		await expect(purchaseMarketplaceSkill(createContext(), "buyer-a", "product-a")).rejects.toMatchObject({
			code: "user_context_asset_integrity_mismatch",
		});
		expect(stubs.teamUpdate).not.toHaveBeenCalled();
		expect(stubs.ledgerCreateMany).not.toHaveBeenCalled();
	});
});

describe("listSkillMarketplaceSellerListings", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		stubs.listUserContextAssets.mockResolvedValue([{
			...installedAsset,
			id: "source-a",
			sourceMarketplaceProductId: null,
			marketplaceListing: {
				productId: "product-a",
				priceCredits: 200,
				listedAt: "2026-07-22T00:00:00.000Z",
			},
		}]);
	});

	it.each([
		["draft", "pending", null],
		["active", "approved", "2026-07-22T01:00:00.000Z"],
		["inactive", "rejected", "2026-07-22T01:00:00.000Z"],
	] as const)("maps product status %s to review status %s", async (productStatus, reviewStatus, reviewedAt) => {
		stubs.productsFindMany.mockResolvedValue([{
			id: "product-a",
			status: productStatus,
			subtitle: "视频创作",
			updated_at: "2026-07-22T01:00:00.000Z",
		}]);

		await expect(listSkillMarketplaceSellerListings("seller-a")).resolves.toEqual({
			items: [expect.objectContaining({
				reviewStatus,
				category: "视频创作",
				submittedAt: "2026-07-22T00:00:00.000Z",
				reviewedAt,
			})],
		});
	});

	it("fails explicitly when a listing product is missing", async () => {
		stubs.productsFindMany.mockResolvedValue([]);

		await expect(listSkillMarketplaceSellerListings("seller-a")).rejects.toMatchObject({
			code: "skill_marketplace_listing_product_missing",
		});
	});

	it("fails explicitly when a listing product category is missing", async () => {
		stubs.productsFindMany.mockResolvedValue([{
			id: "product-a",
			status: "draft",
			subtitle: null,
			updated_at: "2026-07-22T01:00:00.000Z",
		}]);

		await expect(listSkillMarketplaceSellerListings("seller-a")).rejects.toMatchObject({
			code: "skill_marketplace_listing_category_missing",
		});
	});
});
