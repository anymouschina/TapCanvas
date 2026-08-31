import { AppError } from "../../middleware/error";
import type { AppContext } from "../../types";
import { listActiveSubscriptionsForOwner, upsertProductEntitlementForCatalog } from "../commerce/commerce.service";
import { updateProductStatusForCatalog, upsertProductForCatalog } from "../product/product.service";
import {
	clearUserContextAssetMarketplaceListing,
	getUserContextAssetContent,
	updateUserContextAssetMarketplaceListing,
} from "./user-context-assets.service";
import type { SkillMarketplaceCategory } from "./skill-marketplace.constants";

export async function listUserContextAssetOnMarketplace(
	c: AppContext,
	userId: string,
	input: { assetId: string; priceCredits: number; category: SkillMarketplaceCategory },
) {
	const subscriptions = await listActiveSubscriptionsForOwner(c, userId);
	if (subscriptions.length === 0) {
		throw new AppError("上架 Skill 需要有效会员", {
			status: 403,
			code: "skill_marketplace_membership_required",
		});
	}
	const asset = await getUserContextAssetContent(userId, input.assetId);
	if (!asset.logoUrl) {
		throw new AppError("请先在“我的技能”中编辑并上传 Skill Logo", {
			status: 409,
			code: "skill_marketplace_logo_required",
		});
	}
	const product = await upsertProductForCatalog(c, userId, {
		...(asset.marketplaceListing?.productId ? { id: asset.marketplaceListing.productId } : {}),
		title: asset.name,
		subtitle: input.category,
		...(asset.description ? { description: asset.description } : {}),
		currency: "CREDITS",
		priceCents: input.priceCredits,
		stock: 999_999,
		status: "draft",
		coverImageUrl: asset.logoUrl,
	});
	const skillId = `user_asset:${userId}:${asset.id}`;
	await upsertProductEntitlementForCatalog(c, product.id, {
		entitlementType: "skill_license",
		config: {
			sourceType: "user_asset",
			skillId,
			skillName: asset.name,
			description: asset.description,
			logoUrl: asset.logoUrl,
			sellerUserId: userId,
			sourceAssetId: asset.id,
			createdAt: asset.createdAt,
			category: input.category,
		},
	});
	const listedAt = new Date().toISOString();
	const updatedAsset = await updateUserContextAssetMarketplaceListing(userId, asset.id, {
		productId: product.id,
		priceCredits: input.priceCredits,
		listedAt,
	});
	return updatedAsset;
}

export async function unlistUserContextAssetFromMarketplace(
	c: AppContext,
	userId: string,
	assetId: string,
) {
	const asset = await getUserContextAssetContent(userId, assetId);
	if (!asset.marketplaceListing) {
		throw new AppError("该 Skill 尚未上架", {
			status: 409,
			code: "skill_marketplace_listing_missing",
		});
	}
	await updateProductStatusForCatalog(c, {
		productId: asset.marketplaceListing.productId,
		status: "inactive",
	});
	return clearUserContextAssetMarketplaceListing(userId, asset.id);
}
