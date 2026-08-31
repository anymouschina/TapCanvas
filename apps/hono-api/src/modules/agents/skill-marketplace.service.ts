import { AppError } from "../../middleware/error";
import { getPrismaClient } from "../../platform/node/prisma";
import type { AppContext } from "../../types";
import { parseSkillLicenseConfig } from "../ranking/ranking-control";
import { ensurePersonalBillingTeam, getPersonalBillingTeamId } from "../team/team.service";
import type {
	PurchaseMarketplaceSkillResponse,
	SkillMarketplaceSellerDashboard,
	SkillMarketplaceSellerListing,
} from "./skill-marketplace.schemas";
import {
	installUserContextAssetFromMarketplaceInTransaction,
	listUserContextAssets,
} from "./user-context-assets.service";
import {
	chargeTeamCreditBatchesInTransaction,
	grantTeamCreditsInTransaction,
} from "../team/team-credit-batch.service";

type LockedCreditAccount = {
	id: string;
	credits: number;
	credits_frozen: number;
};

function isGuestAuth(auth: unknown): boolean {
	return Boolean(auth && typeof auth === "object" && "guest" in auth && auth.guest === true);
}

async function requirePersonalBillingTeam(c: AppContext, userId: string): Promise<string> {
	const teamId = await ensurePersonalBillingTeam(c, userId);
	if (!teamId) {
		throw new AppError("个人积分账户不存在", {
			status: 409,
			code: "personal_billing_team_missing",
		});
	}
	return teamId;
}

export async function purchaseMarketplaceSkill(
	c: AppContext,
	buyerUserId: string,
	productId: string,
): Promise<PurchaseMarketplaceSkillResponse> {
	if (isGuestAuth(c.get("auth"))) {
		throw new AppError("游客账号不能购买 Skill", {
			status: 403,
			code: "skill_marketplace_guest_purchase_restricted",
		});
	}
	const normalizedProductId = productId.trim();
	if (!normalizedProductId) {
		throw new AppError("Skill 商品 ID 不能为空", {
			status: 400,
			code: "skill_marketplace_product_id_required",
		});
	}
	const prisma = getPrismaClient();
	const entitlement = await prisma.product_entitlements.findFirst({
		where: {
			product_id: normalizedProductId,
			entitlement_type: "skill_license",
			products: { status: "active" },
		},
		include: { products: true },
	});
	if (!entitlement) {
		throw new AppError("Skill 商品不存在或未上架", {
			status: 404,
			code: "skill_marketplace_product_not_found",
		});
	}
	const config = parseSkillLicenseConfig(entitlement.config_json, entitlement.product_id);
	if (config.sourceType !== "user_asset") {
		throw new AppError("系统 Skill 已默认拥有，无需购买", {
			status: 409,
			code: "skill_marketplace_system_skill_owned",
		});
	}
	if (config.sellerUserId === buyerUserId) {
		throw new AppError("不能购买自己上架的 Skill", {
			status: 409,
			code: "skill_marketplace_self_purchase_forbidden",
		});
	}
	if (entitlement.products.currency !== "CREDITS") {
		throw new AppError("Skill 商品必须使用站内积分交易", {
			status: 500,
			code: "skill_marketplace_currency_invalid",
			details: { productId: entitlement.product_id, currency: entitlement.products.currency },
		});
	}
	const priceCredits = entitlement.products.price_cents;
	if (!Number.isSafeInteger(priceCredits) || priceCredits < 1 || priceCredits > 10_000_000) {
		throw new AppError("Skill 积分售价无效", {
			status: 500,
			code: "skill_marketplace_price_invalid",
			details: { productId: entitlement.product_id, priceCredits },
		});
	}
	const buyerTeamId = await requirePersonalBillingTeam(c, buyerUserId);
	const sellerTeamId = getPersonalBillingTeamId(config.sellerUserId);
	const skillName = config.skillName.trim();

	return prisma.$transaction(async (transaction) => {
		const existing = await transaction.user_skill_assets.findFirst({
			where: { owner_id: buyerUserId, source_marketplace_product_id: normalizedProductId },
			select: { id: true },
		});
		if (existing) {
			const installed = await installUserContextAssetFromMarketplaceInTransaction(transaction, {
				buyerUserId,
				sellerUserId: config.sellerUserId,
				sourceAssetId: config.sourceAssetId,
				productId: normalizedProductId,
				priceCredits,
			});
			const buyer = await transaction.teams.findUnique({ where: { id: buyerTeamId } });
			if (!buyer) throw new AppError("个人积分账户不存在", { status: 409, code: "personal_billing_team_missing" });
			return {
				status: "already_owned",
				listingPriceCredits: priceCredits,
				chargedCredits: 0,
				creditBalance: Math.max(0, buyer.credits - buyer.credits_frozen),
				installedAsset: installed.asset,
			};
		}

		const teamIds = [buyerTeamId, sellerTeamId].sort();
		const lockedAccounts = await transaction.$queryRaw<LockedCreditAccount[]>`
			SELECT id, credits, credits_frozen
			FROM teams
			WHERE id IN (${teamIds[0]}, ${teamIds[1]})
			ORDER BY id
			FOR UPDATE
		`;
		const accountById = new Map(lockedAccounts.map((account) => [account.id, account]));
		const buyer = accountById.get(buyerTeamId);
		const seller = accountById.get(sellerTeamId);
		if (!buyer || !seller) {
			throw new AppError("买家或卖家积分账户不存在", {
				status: 409,
				code: "skill_marketplace_credit_account_missing",
			});
		}
		const availableCredits = Math.max(0, buyer.credits - buyer.credits_frozen);
		if (availableCredits < priceCredits) {
			throw new AppError("积分不足，无法购买该 Skill", {
				status: 409,
				code: "skill_marketplace_insufficient_credits",
				details: { availableCredits, requiredCredits: priceCredits },
			});
		}

		const installed = await installUserContextAssetFromMarketplaceInTransaction(transaction, {
			buyerUserId,
			sellerUserId: config.sellerUserId,
			sourceAssetId: config.sourceAssetId,
			productId: normalizedProductId,
			priceCredits,
		});
		if (!installed.created) {
			return {
				status: "already_owned",
				listingPriceCredits: priceCredits,
				chargedCredits: 0,
				creditBalance: availableCredits,
				installedAsset: installed.asset,
			};
		}
		const nowIso = new Date().toISOString();
		const purchaseTaskId = `skill-purchase:${normalizedProductId}`;
		const charged = await chargeTeamCreditBatchesInTransaction(transaction, {
			teamId: buyerTeamId,
			entryType: "deduct",
			amount: priceCredits,
			taskId: purchaseTaskId,
			taskKind: "skill_marketplace_purchase",
			actorUserId: buyerUserId,
			note: skillName,
			nowIso,
		});
		if (!charged.charged) {
			throw new AppError("积分不足，无法购买该 Skill", {
				status: 409,
				code: "skill_marketplace_insufficient_credits",
				details: { requiredCredits: priceCredits },
			});
		}
		const saleTaskId = `skill-sale:${normalizedProductId}:${buyerUserId}`;
		await grantTeamCreditsInTransaction(transaction, {
			teamId: sellerTeamId,
			entryType: "topup",
			amount: priceCredits,
			taskId: saleTaskId,
			taskKind: "skill_marketplace_sale",
			actorUserId: config.sellerUserId,
			note: skillName,
			nowIso,
			sourceType: "skill_marketplace_sale",
			sourceKey: saleTaskId,
		});
		const buyerAfter = await transaction.teams.findUnique({
			where: { id: buyerTeamId },
			select: { credits: true, credits_frozen: true },
		});
		if (!buyerAfter) throw new Error(`buyer credit account missing after charge: ${buyerTeamId}`);
		return {
			status: "purchased",
			listingPriceCredits: priceCredits,
			chargedCredits: priceCredits,
			creditBalance: Math.max(0, buyerAfter.credits - buyerAfter.credits_frozen),
			installedAsset: installed.asset,
		};
	});
}

export async function getSkillMarketplaceSellerDashboard(
	userId: string,
): Promise<SkillMarketplaceSellerDashboard> {
	const prisma = getPrismaClient();
	const teamId = getPersonalBillingTeamId(userId);
	const [listedCount, revenue, recentSales] = await Promise.all([
		prisma.user_skill_assets.count({
			where: { owner_id: userId, marketplace_product_id: { not: null } },
		}),
		prisma.team_credit_ledger.aggregate({
			where: { team_id: teamId, entry_type: "topup", task_kind: "skill_marketplace_sale" },
			_count: { id: true },
			_sum: { amount: true },
		}),
		prisma.team_credit_ledger.findMany({
			where: { team_id: teamId, entry_type: "topup", task_kind: "skill_marketplace_sale" },
			select: { id: true, amount: true, note: true, created_at: true },
			orderBy: { created_at: "desc" },
			take: 50,
		}),
	]);
	return {
		listedCount,
		soldCount: revenue._count.id,
		totalIncomeCredits: revenue._sum.amount ?? 0,
		recentSales: recentSales.map((sale) => {
			const skillName = sale.note?.trim();
			if (!skillName) {
				throw new AppError("Skill 成交记录缺少技能名称", {
					status: 500,
					code: "skill_marketplace_sale_name_missing",
					details: { saleId: sale.id },
				});
			}
			return {
				id: sale.id,
				skillName,
				priceCredits: sale.amount,
				createdAt: sale.created_at,
			};
		}),
	};
}

function mapProductStatusToReviewStatus(
	status: string,
	productId: string,
): SkillMarketplaceSellerListing["reviewStatus"] {
	if (status === "draft") return "pending";
	if (status === "active") return "approved";
	if (status === "inactive") return "rejected";
	throw new AppError("Skill 上架审核状态无效", {
		status: 500,
		code: "skill_marketplace_review_status_invalid",
		details: { productId, status },
	});
}

export async function listSkillMarketplaceSellerListings(
	userId: string,
): Promise<{ items: SkillMarketplaceSellerListing[] }> {
	const assets = (await listUserContextAssets(userId)).filter(
		(asset) => asset.marketplaceListing !== null,
	);
	if (assets.length === 0) return { items: [] };
	const productIds = assets.map((asset) => {
		if (!asset.marketplaceListing) {
			throw new AppError("Skill 上架元数据缺失", {
				status: 500,
				code: "skill_marketplace_listing_metadata_missing",
				details: { assetId: asset.id },
			});
		}
		return asset.marketplaceListing.productId;
	});
	const products = await getPrismaClient().products.findMany({
		where: { id: { in: productIds } },
		select: { id: true, status: true, subtitle: true, updated_at: true },
	});
	const productById = new Map(products.map((product) => [product.id, product]));
	return {
		items: assets.map((asset) => {
			const listing = asset.marketplaceListing;
			if (!listing) {
				throw new AppError("Skill 上架元数据缺失", {
					status: 500,
					code: "skill_marketplace_listing_metadata_missing",
					details: { assetId: asset.id },
				});
			}
			const product = productById.get(listing.productId);
			if (!product) {
				throw new AppError("Skill 上架记录关联商品不存在", {
					status: 500,
					code: "skill_marketplace_listing_product_missing",
					details: { assetId: asset.id, productId: listing.productId },
				});
			}
			const reviewStatus = mapProductStatusToReviewStatus(product.status, product.id);
			const category = product.subtitle?.trim();
			if (!category) {
				throw new AppError("Skill 上架记录商品类目缺失", {
					status: 500,
					code: "skill_marketplace_listing_category_missing",
					details: { assetId: asset.id, productId: listing.productId },
				});
			}
			return {
				asset,
				reviewStatus,
				category,
				submittedAt: listing.listedAt,
				reviewedAt: reviewStatus === "pending" ? null : product.updated_at,
			};
		}),
	};
}
