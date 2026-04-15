import { AppError } from "../../middleware/error";
import type { AppContext } from "../../types";
import { syncOpenClawAuthorizationForOwner } from "./openclaw.service";
import { listOrderItems } from "../order/order.repo";
import { getProductById } from "../product/product.repo";
import {
	ensurePersonalBillingTeam,
	getMyTeam,
} from "../team/team.service";
import {
	getTeamCreditsOverview,
	topUpTeamCredits,
} from "../team/team.repo";
import {
	consumeDailyQuota,
	deleteDictionaryRow,
	getDailyQuotaByDate,
	getDictionaryById,
	getOrderEntitlementLog,
	getProductEntitlementByProductId,
	getProductEntitlement,
	getQuotaEventByIdempotencyKey,
	getDetailPageSampleById,
	getDetailPageEvolutionSummaryRow,
	getSubscriptionById,
	insertOrderEntitlementLog,
	insertSubscription,
	insertSubscriptionDailyQuota,
	insertDetailPageEvolutionRun,
	insertDetailPageFeedbackRows,
	insertDetailPageRetrievalLogRows,
	listActiveSubscriptions,
	listDetailPageSamples,
	listDailyQuotas,
	listDictionaryRows,
	listTopDetailPageSamplesForRetrieve,
	listWeakDetailPageCategories,
	listRechargePackageRows,
	countDetailPageFeedbacks,
	deleteDetailPageSampleRow,
	ensureDetailPageSchema,
	upsertDetailPageSampleRow,
	touchDetailPageSamplesUsage,
	upsertDictionaryRow,
	upsertProductEntitlement,
	type DictionaryRow,
	type DetailPageSampleRow,
	type ProductEntitlementRow,
	type SubscriptionDailyQuotaRow,
	type SubscriptionRow,
} from "./commerce.repo";
import type {
	CommerceEntitlementType,
	DetailPageEvolutionSummaryDto,
	DetailPageSampleDto,
	DetailPageSampleRetrieveResponseDto,
	DictionaryItemDto,
	ProductEntitlementDto,
	RechargePackageDto,
	RunDetailPageEvolutionResponseDto,
	SubscriptionDailyQuotaDto,
	SubscriptionDto,
} from "./commerce.schemas";

function mapDictionaryRowToDto(row: DictionaryRow): DictionaryItemDto {
	return {
		id: row.id,
		ownerId: row.owner_id,
		dictType: row.dict_type,
		code: row.code,
		name: row.name,
		valueJson: row.value_json,
		enabled: Number(row.enabled ?? 0) !== 0,
		sortOrder: Number(row.sort_order ?? 0) || 0,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

async function getBillingTeamSnapshot(c: AppContext, ownerId: string): Promise<{
	teamId: string;
}> {
	const membership = await getMyTeam(c, ownerId);
	const teamId = membership?.team?.id ?? (await ensurePersonalBillingTeam(c, ownerId));
	if (!teamId) {
		throw new AppError("Billing team not found", {
			status: 404,
			code: "billing_team_not_found",
			details: { ownerId },
		});
	}
	const overview = await getTeamCreditsOverview(c.env.DB, teamId);
	if (!overview) {
		throw new AppError("Billing team not found", {
			status: 404,
			code: "billing_team_not_found",
			details: { ownerId, teamId },
		});
	}
	return { teamId };
}

function mapSubscriptionRowToDto(row: SubscriptionRow): SubscriptionDto {
	return {
		id: row.id,
		ownerId: row.owner_id,
		planCode: row.plan_code,
		sourceOrderId: row.source_order_id,
		status: row.status as "active" | "expired" | "canceled",
		startAt: row.start_at,
		endAt: row.end_at,
		durationDays: Number(row.duration_days ?? 0) || 0,
		dailyLimit: Number(row.daily_limit ?? 0) || 0,
		timezone: row.timezone,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		canceledAt: row.canceled_at,
	};
}

function mapDailyQuotaRowToDto(row: SubscriptionDailyQuotaRow): SubscriptionDailyQuotaDto {
	const dailyLimit = Number(row.daily_limit ?? 0) || 0;
	const usedCount = Number(row.used_count ?? 0) || 0;
	return {
		id: row.id,
		subscriptionId: row.subscription_id,
		ownerId: row.owner_id,
		quotaDate: row.quota_date,
		dailyLimit,
		usedCount,
		remaining: Math.max(0, dailyLimit - usedCount),
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function parseEntitlementConfig(row: ProductEntitlementRow): Record<string, unknown> {
	try {
		const parsed: unknown = row.config_json ? JSON.parse(row.config_json) : {};
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
		return {};
	} catch {
		return {};
	}
}

function pickSkuConfig(
	config: Record<string, unknown>,
	skuId: string | null,
): Record<string, unknown> {
	if (!skuId) return {};
	const skuConfigs = config.skuConfigs;
	if (!skuConfigs || typeof skuConfigs !== "object" || Array.isArray(skuConfigs)) return {};
	const matched = (skuConfigs as Record<string, unknown>)[skuId];
	if (!matched || typeof matched !== "object" || Array.isArray(matched)) return {};
	return matched as Record<string, unknown>;
}

function mapProductEntitlementRowToDto(row: ProductEntitlementRow): ProductEntitlementDto {
	return {
		productId: row.product_id,
		entitlementType: row.entitlement_type as CommerceEntitlementType,
		configJson: row.config_json,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function parseRechargeConfig(value: string | null): { points: number; bonusPoints: number } | null {
	if (!value) return null;
	try {
		const parsed: unknown = JSON.parse(value);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
		const obj = parsed as Record<string, unknown>;
		const points = Number(obj.points ?? 0) || 0;
		const bonusPoints = Math.max(0, Number(obj.bonusPoints ?? 0) || 0);
		if (points <= 0) return null;
		return { points, bonusPoints };
	} catch {
		return null;
	}
}

function buildRechargePackageSignature(input: {
	title: string;
	priceCents: number;
	points: number;
	bonusPoints: number;
}): string {
	return [
		input.title.trim(),
		String(Math.trunc(input.priceCents) || 0),
		String(Math.trunc(input.points) || 0),
		String(Math.trunc(input.bonusPoints) || 0),
	].join("::");
}

function dedupeRechargePackages(items: RechargePackageDto[]): RechargePackageDto[] {
	const seen = new Set<string>();
	const uniqueItems: RechargePackageDto[] = [];
	for (const item of items) {
		const signature = buildRechargePackageSignature({
			title: item.title,
			priceCents: item.priceCents,
			points: item.points,
			bonusPoints: item.bonusPoints,
		});
		if (seen.has(signature)) {
			continue;
		}
		seen.add(signature);
		uniqueItems.push(item);
	}
	return uniqueItems;
}

function toIsoDate(input: Date): string {
	return input.toISOString().slice(0, 10);
}

function addDays(input: Date, days: number): Date {
	const out = new Date(input.getTime());
	out.setUTCDate(out.getUTCDate() + days);
	return out;
}

function parseTagsJson(raw: string): string[] {
	try {
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed
			.map((x) => (typeof x === "string" ? x.trim() : ""))
			.filter((x) => x.length > 0)
			.slice(0, 50);
	} catch {
		return [];
	}
}

function mapDetailPageSampleRowToDto(row: DetailPageSampleRow): DetailPageSampleDto {
	return {
		id: row.id,
		ownerId: row.owner_id,
		title: row.title,
		category: row.category,
		tags: parseTagsJson(row.tags_json),
		source: row.source,
		imageUrl: row.image_url,
		summary: row.summary,
		modulesJson: row.modules_json,
		copyJson: row.copy_json,
		styleJson: row.style_json,
		scoreQuality: Number(row.score_quality ?? 0) || 0,
		scoreVisual: Number(row.score_visual ?? 0) || 0,
		scoreConversion: Number(row.score_conversion ?? 0) || 0,
		usageCount: Number(row.usage_count ?? 0) || 0,
		lastUsedAt: row.last_used_at,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function buildDetailSampleContextSnippet(items: Array<{ sample: DetailPageSampleDto; score: number }>): string {
	if (items.length === 0) return "";
	return items
		.map((item, index) => {
			const sample = item.sample;
			const tags = sample.tags.slice(0, 8).join("、");
			const summary = String(sample.summary || "").trim();
			const modulesText = String(sample.modulesJson || "").trim();
			const firstLine = [
				`样例${index + 1}（score=${item.score.toFixed(1)}）`,
				`标题：${sample.title}`,
				`类目：${sample.category}`,
				tags ? `标签：${tags}` : "",
			]
				.filter(Boolean)
				.join("｜");
			const detail = [
				summary ? `摘要：${summary}` : "",
				modulesText ? `模块结构：${modulesText}` : "",
			]
				.filter(Boolean)
				.join("\n");
			return detail ? `${firstLine}\n${detail}` : firstLine;
		})
		.join("\n\n");
}

export async function listCommerceDictionaryItems(c: AppContext, ownerId: string | undefined, dictType?: string) {
	const rows = await listDictionaryRows(c.env.DB, ownerId, dictType);
	return rows.map(mapDictionaryRowToDto);
}

export async function listRechargePackagesForOwner(c: AppContext, ownerId: string): Promise<RechargePackageDto[]> {
	void ownerId;
	const rows = await listRechargePackageRows(c.env.DB);
	const items: RechargePackageDto[] = [];
	for (const row of rows) {
		const cfg = parseRechargeConfig(row.config_json);
		if (!cfg) continue;
		items.push({
			productId: row.product_id,
			title: row.title,
			subtitle: row.subtitle,
			currency: row.currency,
			priceCents: Number(row.price_cents ?? 0) || 0,
			points: cfg.points,
			bonusPoints: cfg.bonusPoints,
			totalPoints: cfg.points + cfg.bonusPoints,
		});
	}
	const uniqueItems = dedupeRechargePackages(items);
	uniqueItems.sort((a, b) => a.priceCents - b.priceCents);
	return uniqueItems;
}

export async function upsertCommerceDictionaryItem(c: AppContext, ownerId: string, input: {
	id?: string;
	dictType: string;
	code: string;
	name: string;
	valueJson?: string;
	enabled?: boolean;
	sortOrder?: number;
}) {
	const nowIso = new Date().toISOString();
	await upsertDictionaryRow(c.env.DB, {
		id: input.id || crypto.randomUUID(),
		ownerId,
		dictType: input.dictType,
		code: input.code,
		name: input.name,
		valueJson: input.valueJson?.trim() || null,
		enabled: input.enabled !== false,
		sortOrder: Number(input.sortOrder ?? 0) || 0,
		nowIso,
	});
	const rows = await listDictionaryRows(c.env.DB, ownerId, input.dictType);
	const target = rows.find((row) => row.code === input.code);
	if (!target) throw new AppError("Dictionary upsert failed", { status: 500, code: "dictionary_upsert_failed" });
	return mapDictionaryRowToDto(target);
}

export async function deleteCommerceDictionaryItem(c: AppContext, ownerId: string, id: string): Promise<void> {
	const row = await getDictionaryById(c.env.DB, ownerId, id);
	if (!row) throw new AppError("Dictionary item not found", { status: 404, code: "dictionary_not_found" });
	await deleteDictionaryRow(c.env.DB, ownerId, id);
}

export async function upsertProductEntitlementForCatalog(c: AppContext, productId: string, input: {
	entitlementType: CommerceEntitlementType;
	config: Record<string, unknown>;
}) {
	const product = await getProductById(c.env.DB, { id: productId });
	if (!product) throw new AppError("Product not found", { status: 404, code: "product_not_found" });
	const nowIso = new Date().toISOString();
	await upsertProductEntitlement(c.env.DB, {
		id: crypto.randomUUID(),
		ownerId: product.owner_id,
		productId,
		entitlementType: input.entitlementType,
		configJson: JSON.stringify(input.config || {}),
		nowIso,
	});
	const row = await getProductEntitlementByProductId(c.env.DB, productId);
	if (!row) throw new AppError("Entitlement upsert failed", { status: 500, code: "entitlement_upsert_failed" });
	return mapProductEntitlementRowToDto(row);
}

export async function listActiveSubscriptionsForOwner(c: AppContext, ownerId: string) {
	const nowIso = new Date().toISOString();
	const rows = await listActiveSubscriptions(c.env.DB, ownerId, nowIso);
	return rows.map(mapSubscriptionRowToDto);
}

export async function listSubscriptionDailyQuotasForOwner(c: AppContext, ownerId: string, subscriptionId: string) {
	const sub = await getSubscriptionById(c.env.DB, ownerId, subscriptionId);
	if (!sub) throw new AppError("Subscription not found", { status: 404, code: "subscription_not_found" });
	const rows = await listDailyQuotas(c.env.DB, ownerId, subscriptionId);
	return rows.map(mapDailyQuotaRowToDto);
}

export async function consumeSubscriptionQuotaForOwner(c: AppContext, ownerId: string, input: {
	subscriptionId: string;
	amount: number;
	idempotencyKey: string;
	reason?: string;
}) {
	const sub = await getSubscriptionById(c.env.DB, ownerId, input.subscriptionId);
	if (!sub) throw new AppError("Subscription not found", { status: 404, code: "subscription_not_found" });
	if (sub.status !== "active") throw new AppError("Subscription is not active", { status: 400, code: "subscription_inactive" });
	const now = new Date();
	const nowIso = now.toISOString();
	if (nowIso < sub.start_at || nowIso > sub.end_at) throw new AppError("Subscription expired", { status: 400, code: "subscription_expired" });
	const duplicated = await getQuotaEventByIdempotencyKey(c.env.DB, ownerId, input.subscriptionId, input.idempotencyKey);
	const quotaDate = toIsoDate(now);
	if (!duplicated) {
		try {
			await consumeDailyQuota(c.env.DB, {
				ownerId,
				subscriptionId: input.subscriptionId,
				quotaDate,
				amount: input.amount,
				idempotencyKey: input.idempotencyKey,
				reason: input.reason?.trim() || null,
				nowIso,
			});
		} catch (error) {
			if (error instanceof Error && error.message === "quota_exceeded") {
				throw new AppError("Daily quota exceeded", { status: 400, code: "quota_exceeded" });
			}
			if (error instanceof Error && error.message === "quota_not_found") {
				throw new AppError("Daily quota not found", { status: 400, code: "quota_not_found" });
			}
			throw error;
		}
	}
	const quota = await getDailyQuotaByDate(c.env.DB, ownerId, input.subscriptionId, quotaDate);
	if (!quota) throw new AppError("Daily quota not found", { status: 400, code: "quota_not_found" });
	return mapDailyQuotaRowToDto(quota);
}

export async function applyOrderEntitlementsForPaidOrder(c: AppContext, ownerId: string, orderId: string): Promise<void> {
	const items = await listOrderItems(c.env.DB, { orderId });
	if (!items.length) return;
	for (const item of items) {
		const entitlement = await getProductEntitlementByProductId(c.env.DB, item.product_id);
		if (!entitlement || entitlement.entitlement_type === "none") continue;
		const duplicate = await getOrderEntitlementLog(c.env.DB, ownerId, item.id, entitlement.entitlement_type);
		if (duplicate) continue;
		const now = new Date();
		const nowIso = now.toISOString();
		const quantity = Math.max(1, Number(item.quantity ?? 0) || 1);
		const config = parseEntitlementConfig(entitlement);
		const skuConfig = pickSkuConfig(config, item.sku_id);
		const mergedConfig = { ...config, ...skuConfig };
		if (entitlement.entitlement_type === "points_topup") {
			const points = Number(mergedConfig.points ?? 0) || 0;
			const bonusPoints = Math.max(0, Number(mergedConfig.bonusPoints ?? 0) || 0);
			const totalPoints = (points + bonusPoints) * quantity;
			if (points <= 0) {
				await insertOrderEntitlementLog(c.env.DB, {
					id: crypto.randomUUID(),
					ownerId,
					orderId,
					orderItemId: item.id,
					productId: item.product_id,
					entitlementType: entitlement.entitlement_type,
					status: "skipped",
					resultJson: JSON.stringify({ reason: "invalid_points_config", quantity, skuId: item.sku_id }),
					nowIso,
				});
				continue;
			}
			const teamSnapshot = await getBillingTeamSnapshot(c, ownerId);
			await topUpTeamCredits(c.env.DB, {
				teamId: teamSnapshot.teamId,
				amount: totalPoints,
				actorUserId: ownerId,
				note: `order_paid | order:${orderId} | product:${item.product_id}`,
				nowIso,
			});
			await insertOrderEntitlementLog(c.env.DB, {
				id: crypto.randomUUID(),
				ownerId,
				orderId,
				orderItemId: item.id,
				productId: item.product_id,
				entitlementType: entitlement.entitlement_type,
				status: "applied",
				resultJson: JSON.stringify({ points, bonusPoints, quantity, totalPoints, skuId: item.sku_id }),
				nowIso,
			});
			continue;
		}
		if (entitlement.entitlement_type === "monthly_quota") {
			const durationDays = Number(mergedConfig.durationDays ?? 0) || 0;
			const dailyLimit = Number(mergedConfig.dailyLimit ?? 0) || 0;
			const timezone =
				typeof mergedConfig.timezone === "string" && mergedConfig.timezone.trim()
					? mergedConfig.timezone.trim()
					: "Asia/Shanghai";
			if (durationDays <= 0 || dailyLimit <= 0) {
				await insertOrderEntitlementLog(c.env.DB, {
					id: crypto.randomUUID(),
					ownerId,
					orderId,
					orderItemId: item.id,
					productId: item.product_id,
					entitlementType: entitlement.entitlement_type,
					status: "skipped",
					resultJson: JSON.stringify({ reason: "invalid_monthly_quota_config", quantity, skuId: item.sku_id }),
					nowIso,
				});
				continue;
			}
			const subscriptionIds: string[] = [];
			for (let index = 0; index < quantity; index += 1) {
				const subscriptionId = crypto.randomUUID();
				const start = now;
				const end = addDays(start, durationDays);
				await insertSubscription(c.env.DB, {
					id: subscriptionId,
					ownerId,
					planCode: `monthly_quota_${durationDays}d_${dailyLimit}`,
					sourceOrderId: orderId,
					status: "active",
					startAt: start.toISOString(),
					endAt: end.toISOString(),
					durationDays,
					dailyLimit,
					timezone,
					nowIso,
				});
				for (let i = 0; i < durationDays; i += 1) {
					const d = addDays(start, i);
					await insertSubscriptionDailyQuota(c.env.DB, {
						id: crypto.randomUUID(),
						subscriptionId,
						ownerId,
						quotaDate: toIsoDate(d),
						dailyLimit,
						usedCount: 0,
						nowIso,
					});
				}
				subscriptionIds.push(subscriptionId);
			}
			await insertOrderEntitlementLog(c.env.DB, {
				id: crypto.randomUUID(),
				ownerId,
				orderId,
				orderItemId: item.id,
				productId: item.product_id,
				entitlementType: entitlement.entitlement_type,
				status: "applied",
				resultJson: JSON.stringify({ subscriptionIds, quantity, durationDays, dailyLimit, timezone, skuId: item.sku_id }),
				nowIso,
			});
		}

		if (entitlement.entitlement_type === "openclaw_subscription") {
			const durationDays = Number(mergedConfig.durationDays ?? 0) || 0;
			const dailyLimit = Number(mergedConfig.dailyLimit ?? 0) || 0;
			const timezone =
				typeof mergedConfig.timezone === "string" && mergedConfig.timezone.trim()
					? mergedConfig.timezone.trim()
					: "Asia/Shanghai";
			const descriptionText =
				typeof mergedConfig.descriptionText === "string" && mergedConfig.descriptionText.trim()
					? mergedConfig.descriptionText.trim()
					: null;
			const externalName =
				typeof mergedConfig.externalName === "string" && mergedConfig.externalName.trim()
					? mergedConfig.externalName.trim()
					: "openclaw";
			const allowWallet = mergedConfig.allowWallet !== false;
			const allowedItemIds = Array.isArray(mergedConfig.allowedItemIds)
				? mergedConfig.allowedItemIds
					.map((item) => (typeof item === "string" ? item.trim() : ""))
					.filter(Boolean)
				: null;
			if (durationDays <= 0 || dailyLimit <= 0) {
				await insertOrderEntitlementLog(c.env.DB, {
					id: crypto.randomUUID(),
					ownerId,
					orderId,
					orderItemId: item.id,
					productId: item.product_id,
					entitlementType: entitlement.entitlement_type,
					status: "skipped",
					resultJson: JSON.stringify({ reason: "invalid_openclaw_config", quantity, skuId: item.sku_id }),
					nowIso,
				});
				continue;
			}
			const subscriptionIds: string[] = [];
			for (let index = 0; index < quantity; index += 1) {
				const subscriptionId = crypto.randomUUID();
				const start = now;
				const end = addDays(start, durationDays);
				await insertSubscription(c.env.DB, {
					id: subscriptionId,
					ownerId,
					planCode: `openclaw_${durationDays}d_${dailyLimit}`,
					sourceOrderId: orderId,
					status: "active",
					startAt: start.toISOString(),
					endAt: end.toISOString(),
					durationDays,
					dailyLimit,
					timezone,
					nowIso,
				});
				for (let i = 0; i < durationDays; i += 1) {
					const d = addDays(start, i);
					await insertSubscriptionDailyQuota(c.env.DB, {
						id: crypto.randomUUID(),
						subscriptionId,
						ownerId,
						quotaDate: toIsoDate(d),
						dailyLimit,
						usedCount: 0,
						nowIso,
					});
				}
				subscriptionIds.push(subscriptionId);
			}
			const quotaLimit = quantity * dailyLimit;
			try {
				const authorization = await syncOpenClawAuthorizationForOwner(c, {
					ownerId,
					subscriptionId: subscriptionIds[subscriptionIds.length - 1] || null,
					sourceOrderId: orderId,
					productId: item.product_id,
					skuId: item.sku_id,
					quotaLimit,
					externalName,
					descriptionText,
					allowWallet,
					allowedItemIds,
					desiredStatus: "active",
				});
				await insertOrderEntitlementLog(c.env.DB, {
					id: crypto.randomUUID(),
					ownerId,
					orderId,
					orderItemId: item.id,
					productId: item.product_id,
					entitlementType: entitlement.entitlement_type,
					status: "applied",
					resultJson: JSON.stringify({
						authorizationId: authorization.id,
						subscriptionIds,
						quantity,
						durationDays,
						dailyLimit,
						quotaLimit: authorization.quotaLimit,
						externalName: authorization.externalName,
						skuId: item.sku_id,
					}),
					nowIso,
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error || "openclaw sync failed");
				await insertOrderEntitlementLog(c.env.DB, {
					id: crypto.randomUUID(),
					ownerId,
					orderId,
					orderItemId: item.id,
					productId: item.product_id,
					entitlementType: entitlement.entitlement_type,
					status: "failed",
					resultJson: JSON.stringify({ subscriptionIds, quantity, durationDays, dailyLimit, quotaLimit, skuId: item.sku_id, message }),
					nowIso,
				});
			}
		}
	}
}

export async function listDetailPageSamplesForOwner(
	c: AppContext,
	ownerId: string | undefined,
	options?: { category?: string; limit?: number },
): Promise<DetailPageSampleDto[]> {
	await ensureDetailPageSchema(c.env.DB);
	const rows = await listDetailPageSamples(c.env.DB, ownerId, options);
	return rows.map(mapDetailPageSampleRowToDto);
}

export async function upsertDetailPageSampleForOwner(
	c: AppContext,
	ownerId: string,
	input: {
		id?: string;
		title: string;
		category: string;
		tags?: string[];
		source?: string;
		imageUrl?: string;
		summary?: string;
		modulesJson?: string;
		copyJson?: string;
		styleJson?: string;
		scoreQuality?: number;
		scoreVisual?: number;
		scoreConversion?: number;
	},
): Promise<DetailPageSampleDto> {
	await ensureDetailPageSchema(c.env.DB);
	const nowIso = new Date().toISOString();
	const id = input.id?.trim() || crypto.randomUUID();
	await upsertDetailPageSampleRow(c.env.DB, {
		id,
		ownerId,
		title: input.title.trim(),
		category: input.category.trim(),
		tagsJson: JSON.stringify(
			Array.from(new Set((input.tags || []).map((x) => x.trim()).filter(Boolean))).slice(0, 50),
		),
		source: input.source?.trim() || null,
		imageUrl: input.imageUrl?.trim() || null,
		summary: input.summary?.trim() || null,
		modulesJson: input.modulesJson?.trim() || null,
		copyJson: input.copyJson?.trim() || null,
		styleJson: input.styleJson?.trim() || null,
		scoreQuality: Number(input.scoreQuality ?? 0) || 0,
		scoreVisual: Number(input.scoreVisual ?? 0) || 0,
		scoreConversion: Number(input.scoreConversion ?? 0) || 0,
		nowIso,
	});
	const row = await getDetailPageSampleById(c.env.DB, ownerId, id);
	if (!row) {
		throw new AppError("detail page sample upsert failed", {
			status: 500,
			code: "detail_page_sample_upsert_failed",
		});
	}
	return mapDetailPageSampleRowToDto(row);
}

export async function deleteDetailPageSampleForOwner(
	c: AppContext,
	ownerId: string | undefined,
	sampleId: string,
): Promise<void> {
	await ensureDetailPageSchema(c.env.DB);
	const existing = await getDetailPageSampleById(c.env.DB, ownerId, sampleId);
	if (!existing) {
		throw new AppError("detail page sample not found", {
			status: 404,
			code: "detail_page_sample_not_found",
		});
	}
	await deleteDetailPageSampleRow(c.env.DB, ownerId, sampleId);
}

export async function retrieveDetailPageSamplesForOwner(
	c: AppContext,
	input: {
		actorOwnerId: string;
		scopeOwnerId?: string;
		query?: string;
		category?: string;
		limit?: number;
	},
): Promise<DetailPageSampleRetrieveResponseDto> {
	await ensureDetailPageSchema(c.env.DB);
	const limit = Math.max(1, Math.min(20, Number(input.limit ?? 5) || 5));
	const query = String(input.query || "").trim();
	const category = String(input.category || "").trim();
	const rows = await listTopDetailPageSamplesForRetrieve(c.env.DB, input.scopeOwnerId, {
		queryText: query,
		category: category || undefined,
		limit,
	});
	const items = rows.map((row) => ({
		sample: mapDetailPageSampleRowToDto(row),
		score: Number(row.score ?? 0) || 0,
	}));
	const nowIso = new Date().toISOString();
	if (items.length > 0) {
		await touchDetailPageSamplesUsage(
			c.env.DB,
			input.scopeOwnerId,
			items.map((item) => item.sample.id),
			nowIso,
		);
		await insertDetailPageRetrievalLogRows(
			c.env.DB,
			items.map((item, idx) => ({
				id: crypto.randomUUID(),
				ownerId: input.actorOwnerId,
				queryText: query || null,
				category: category || null,
				sampleId: item.sample.id,
				rankNo: idx + 1,
				score: item.score,
				createdAt: nowIso,
			})),
		);
	}
	return {
		items,
		contextSnippet: buildDetailSampleContextSnippet(items),
	};
}

export async function createDetailPageFeedbackForOwner(
	c: AppContext,
	ownerId: string,
	input: {
		generationId?: string;
		sampleIds: string[];
		scoreOverall: number;
		scoreStructure?: number;
		scoreVisual?: number;
		scoreConversion?: number;
		editRatio?: number;
		note?: string;
	},
): Promise<{ inserted: number }> {
	await ensureDetailPageSchema(c.env.DB);
	const nowIso = new Date().toISOString();
	const dedupedIds = Array.from(new Set(input.sampleIds.map((x) => x.trim()).filter(Boolean))).slice(0, 20);
	if (dedupedIds.length === 0) {
		throw new AppError("sampleIds cannot be empty", {
			status: 400,
			code: "detail_page_feedback_sample_ids_empty",
		});
	}
	for (const sampleId of dedupedIds) {
		const exists = await getDetailPageSampleById(c.env.DB, ownerId, sampleId);
		if (!exists) {
			throw new AppError(`sample not found: ${sampleId}`, {
				status: 404,
				code: "detail_page_feedback_sample_not_found",
			});
		}
	}
	await insertDetailPageFeedbackRows(
		c.env.DB,
		dedupedIds.map((sampleId) => ({
			id: crypto.randomUUID(),
			ownerId,
			generationId: input.generationId?.trim() || null,
			sampleId,
			scoreOverall: input.scoreOverall,
			scoreStructure:
				typeof input.scoreStructure === "number" ? Math.trunc(input.scoreStructure) : null,
			scoreVisual: typeof input.scoreVisual === "number" ? Math.trunc(input.scoreVisual) : null,
			scoreConversion:
				typeof input.scoreConversion === "number" ? Math.trunc(input.scoreConversion) : null,
			editRatio: typeof input.editRatio === "number" ? input.editRatio : null,
			note: input.note?.trim() || null,
			createdAt: nowIso,
		})),
	);
	return { inserted: dedupedIds.length };
}

export async function getDetailPageEvolutionSummaryForOwner(
	c: AppContext,
	ownerId: string | undefined,
): Promise<DetailPageEvolutionSummaryDto> {
	await ensureDetailPageSchema(c.env.DB);
	return await getDetailPageEvolutionSummaryRow(c.env.DB, ownerId);
}

export async function runDetailPageEvolutionForOwner(
	c: AppContext,
	input: {
		actorOwnerId: string;
		scopeOwnerId?: string;
		minFeedbacks?: number;
	},
): Promise<RunDetailPageEvolutionResponseDto> {
	await ensureDetailPageSchema(c.env.DB);
	const minFeedbacks = Math.max(1, Math.min(10_000, Math.trunc(Number(input.minFeedbacks ?? 30) || 30)));
	const summary = await getDetailPageEvolutionSummaryForOwner(c, input.scopeOwnerId);
	const feedbackCount = await countDetailPageFeedbacks(c.env.DB, input.scopeOwnerId);
	const weakCategoriesRaw = await listWeakDetailPageCategories(c.env.DB, input.scopeOwnerId, 5);
	const weakCategories = weakCategoriesRaw.map((item) => ({
		category: item.category,
		avgOverallScore: Number(item.avg_overall_score ?? 0) || 0,
		feedbackCount: Number(item.feedback_count ?? 0) || 0,
	}));
	const hasEnoughFeedbacks = feedbackCount >= minFeedbacks;
	const action: "ready_for_optimizer" | "skip" = hasEnoughFeedbacks ? "ready_for_optimizer" : "skip";
	const createdAt = new Date().toISOString();
	const runId = crypto.randomUUID();
	const metrics = {
		...summary,
		minFeedbacks,
		hasEnoughFeedbacks,
		weakCategories,
	};
	await insertDetailPageEvolutionRun(c.env.DB, {
		id: runId,
		ownerId: input.actorOwnerId,
		minFeedbacks,
		action,
		metricsJson: JSON.stringify(metrics),
		createdAt,
	});
	return {
		runId,
		action,
		metrics,
		createdAt,
	};
}
