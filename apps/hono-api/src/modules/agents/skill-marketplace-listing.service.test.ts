import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppContext } from "../../types";

const stubs = vi.hoisted(() => ({
	listActiveSubscriptionsForOwner: vi.fn(),
	upsertProductEntitlementForCatalog: vi.fn(),
	updateProductStatusForCatalog: vi.fn(),
	upsertProductForCatalog: vi.fn(),
	getUserContextAssetContent: vi.fn(),
	updateUserContextAssetMarketplaceListing: vi.fn(),
	clearUserContextAssetMarketplaceListing: vi.fn(),
}));

vi.mock("../commerce/commerce.service", () => ({
	listActiveSubscriptionsForOwner: stubs.listActiveSubscriptionsForOwner,
	upsertProductEntitlementForCatalog: stubs.upsertProductEntitlementForCatalog,
}));

vi.mock("../product/product.service", () => ({
	updateProductStatusForCatalog: stubs.updateProductStatusForCatalog,
	upsertProductForCatalog: stubs.upsertProductForCatalog,
}));

vi.mock("./user-context-assets.service", () => ({
	getUserContextAssetContent: stubs.getUserContextAssetContent,
	updateUserContextAssetMarketplaceListing: stubs.updateUserContextAssetMarketplaceListing,
	clearUserContextAssetMarketplaceListing: stubs.clearUserContextAssetMarketplaceListing,
}));

import {
	listUserContextAssetOnMarketplace,
	unlistUserContextAssetFromMarketplace,
} from "./skill-marketplace-listing.service";

const appContext = {} as AppContext;

const sourceAsset = {
	id: "asset-a",
	kind: "skill" as const,
	fileName: "camera.md",
	name: "镜头导演",
	description: "镜头语言 Skill",
	content: "# Camera",
	logoUrl: "https://assets.example.com/camera-skill-logo.png",
	sizeBytes: 8,
	sha256: "digest",
	marketplaceListing: null,
	sourceMarketplaceProductId: null,
	createdAt: "2026-07-01T00:00:00.000Z",
	updatedAt: "2026-07-01T00:00:00.000Z",
};

describe("listUserContextAssetOnMarketplace", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("rejects non-members before reading or mutating the Skill", async () => {
		stubs.listActiveSubscriptionsForOwner.mockResolvedValue([]);

		await expect(listUserContextAssetOnMarketplace(appContext, "user-a", {
			assetId: sourceAsset.id,
			priceCredits: 900,
			category: "视频创作",
		})).rejects.toMatchObject({
			code: "skill_marketplace_membership_required",
			status: 403,
		});
		expect(stubs.getUserContextAssetContent).not.toHaveBeenCalled();
		expect(stubs.upsertProductForCatalog).not.toHaveBeenCalled();
	});

	it("rejects a member listing when the Skill has no Logo", async () => {
		stubs.listActiveSubscriptionsForOwner.mockResolvedValue([{ id: "subscription-a" }]);
		stubs.getUserContextAssetContent.mockResolvedValue({ ...sourceAsset, logoUrl: null });

		await expect(listUserContextAssetOnMarketplace(appContext, "user-a", {
			assetId: sourceAsset.id,
			priceCredits: 900,
			category: "视频创作",
		})).rejects.toMatchObject({
			code: "skill_marketplace_logo_required",
			status: 409,
		});
		expect(stubs.upsertProductForCatalog).not.toHaveBeenCalled();
	});

	it("creates the entitlement and leaves a member listing pending review", async () => {
		stubs.listActiveSubscriptionsForOwner.mockResolvedValue([{ id: "subscription-a" }]);
		stubs.getUserContextAssetContent.mockResolvedValue(sourceAsset);
		stubs.upsertProductForCatalog.mockResolvedValue({ id: "product-a" });
		stubs.upsertProductEntitlementForCatalog.mockResolvedValue({ id: "entitlement-a" });
		stubs.updateUserContextAssetMarketplaceListing.mockImplementation(async (
			_userId: string,
			_assetId: string,
			listing: { productId: string; priceCredits: number; listedAt: string },
		) => ({ ...sourceAsset, marketplaceListing: listing }));

		const listed = await listUserContextAssetOnMarketplace(appContext, "user-a", {
			assetId: sourceAsset.id,
			priceCredits: 900,
			category: "视频创作",
		});

		expect(listed.marketplaceListing).toMatchObject({ productId: "product-a", priceCredits: 900 });
		expect(stubs.upsertProductForCatalog).toHaveBeenCalledWith(appContext, "user-a", expect.objectContaining({
			currency: "CREDITS",
			coverImageUrl: sourceAsset.logoUrl,
			priceCents: 900,
			subtitle: "视频创作",
		}));
		expect(stubs.upsertProductEntitlementForCatalog).toHaveBeenCalledWith(appContext, "product-a", {
			entitlementType: "skill_license",
			config: expect.objectContaining({
				sourceType: "user_asset",
				skillId: "user_asset:user-a:asset-a",
				sellerUserId: "user-a",
				sourceAssetId: "asset-a",
				category: "视频创作",
			}),
		});
		expect(stubs.upsertProductForCatalog).toHaveBeenCalledWith(appContext, "user-a", expect.objectContaining({
			status: "draft",
		}));
		expect(stubs.updateProductStatusForCatalog).not.toHaveBeenCalled();
	});

	it("deactivates the product before clearing the listing", async () => {
		const listedAsset = {
			...sourceAsset,
			marketplaceListing: {
				productId: "product-a",
				priceCredits: 900,
				listedAt: "2026-07-22T00:00:00.000Z",
			},
		};
		stubs.getUserContextAssetContent.mockResolvedValue(listedAsset);
		stubs.updateProductStatusForCatalog.mockResolvedValue({ id: "product-a", status: "inactive" });
		stubs.clearUserContextAssetMarketplaceListing.mockResolvedValue({ ...sourceAsset, marketplaceListing: null });

		const unlisted = await unlistUserContextAssetFromMarketplace(appContext, "user-a", sourceAsset.id);

		expect(unlisted.marketplaceListing).toBeNull();
		expect(stubs.updateProductStatusForCatalog).toHaveBeenCalledWith(appContext, {
			productId: "product-a",
			status: "inactive",
		});
		expect(stubs.updateProductStatusForCatalog.mock.invocationCallOrder[0]).toBeLessThan(
			stubs.clearUserContextAssetMarketplaceListing.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
		);
	});
});
