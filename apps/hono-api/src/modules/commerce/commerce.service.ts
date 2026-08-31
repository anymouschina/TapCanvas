import { AppError } from "../../middleware/error";
import type { AppContext } from "../../types";
import { getProductById } from "../product/product.repo";
import { isAdminRequest } from "../team/team.service";
import {
	ACCOUNT_SETTINGS_DICT_TYPE,
	resolveConfiguredPlatformOwnerId,
} from "../account/account.settings";
import {
	consumeDailyQuota,
	deleteDictionaryRow,
	getDailyQuotaByDate,
	getDictionaryById,
	getDictionaryByIdAnyOwner,
	getProductEntitlementByProductId,
	getProductEntitlement,
	getQuotaEventByIdempotencyKey,
	getDetailPageSampleById,
	getDetailPageEvolutionSummaryRow,
	getSubscriptionById,
	insertDetailPageEvolutionRun,
	insertDetailPageFeedbackRows,
	insertDetailPageRetrievalLogRows,
	listActiveSubscriptions,
	listDetailPageSamples,
	listDailyQuotas,
	listDictionaryRows,
	listTopDetailPageSamplesForRetrieve,
	listWeakDetailPageCategories,
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
import {
	CommerceEntitlementTypeSchema,
	MembershipConfigSchema,
} from "./commerce.schemas";
import type {
	CommerceEntitlementType,
	DetailPageEvolutionSummaryDto,
	DetailPageSampleDto,
	DetailPageSampleRetrieveResponseDto,
	DictionaryItemDto,
	ProductEntitlementDto,
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

function mapSubscriptionRowToDto(row: SubscriptionRow): SubscriptionDto {
	return {
		id: row.id,
		ownerId: row.owner_id,
		planCode: row.plan_code,
		status: row.status as "active" | "expired" | "canceled",
		startAt: row.start_at,
		endAt: row.end_at,
		billingCycle: row.billing_cycle as "monthly" | "annual",
		durationDays: Number(row.duration_days ?? 0) || 0,
		monthlyCredits: Number(row.monthly_credits ?? 0) || 0,
		dailyGiftCredits: Number(row.daily_gift_credits ?? 0) || 0,
		concurrencyLimit: Number(row.concurrency_limit ?? 0) || 0,
		capacityLabel: row.capacity_label,
		creditGrantCount: Number(row.credit_grant_count ?? 0) || 0,
		creditGrantsIssued: Number(row.credit_grants_issued ?? 0) || 0,
		nextCreditGrantAt: row.next_credit_grant_at,
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

function mapProductEntitlementRowToDto(row: ProductEntitlementRow): ProductEntitlementDto {
	return {
		productId: row.product_id,
		entitlementType: row.entitlement_type as CommerceEntitlementType,
		configJson: row.config_json,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function toIsoDate(input: Date): string {
	return input.toISOString().slice(0, 10);
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
	if (dictType === ACCOUNT_SETTINGS_DICT_TYPE && !isAdminRequest(c)) {
		throw new AppError("平台账户配置仅管理员可读取", { status: 403, code: "platform_account_admin_required" });
	}
	const rows = await listDictionaryRows(c.env.DB, ownerId, dictType);
	return rows.map(mapDictionaryRowToDto);
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
	if (input.dictType === ACCOUNT_SETTINGS_DICT_TYPE) {
		if (!isAdminRequest(c)) {
			throw new AppError("平台账户配置仅管理员可操作", { status: 403, code: "platform_account_admin_required" });
		}
		const platformOwnerId = resolveConfiguredPlatformOwnerId(c);
		if (!platformOwnerId) {
			throw new AppError("未配置 COMMERCE_PLATFORM_OWNER_ID", {
				status: 503,
				code: "account_platform_owner_not_configured",
			});
		}
		if (ownerId !== platformOwnerId) {
			throw new AppError("平台账户配置归属不正确", { status: 403, code: "platform_account_owner_invalid" });
		}
	}
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

export async function deleteCommerceDictionaryItem(
	c: AppContext,
	actorUserId: string,
	id: string,
): Promise<void> {
	const admin = isAdminRequest(c);
	const row = admin
		? await getDictionaryByIdAnyOwner(c.env.DB, id)
		: await getDictionaryById(c.env.DB, actorUserId, id);
	if (!row) throw new AppError("Dictionary item not found", { status: 404, code: "dictionary_not_found" });
	if (row.dict_type === ACCOUNT_SETTINGS_DICT_TYPE) {
		if (!admin) {
			throw new AppError("平台账户配置仅管理员可操作", { status: 403, code: "platform_account_admin_required" });
		}
		const platformOwnerId = resolveConfiguredPlatformOwnerId(c);
		if (!platformOwnerId) {
			throw new AppError("未配置 COMMERCE_PLATFORM_OWNER_ID", {
				status: 503,
				code: "account_platform_owner_not_configured",
			});
		}
		if (row.owner_id !== platformOwnerId) {
			throw new AppError("Dictionary item not found", { status: 404, code: "dictionary_not_found" });
		}
	}
	await deleteDictionaryRow(c.env.DB, row.owner_id, row.id);
}

export async function upsertProductEntitlementForCatalog(c: AppContext, productId: string, input: {
	entitlementType: CommerceEntitlementType;
	config: Record<string, unknown>;
}) {
	const product = await getProductById(c.env.DB, { id: productId });
	if (!product) throw new AppError("Product not found", { status: 404, code: "product_not_found" });
	const config = input.entitlementType === "membership"
		? MembershipConfigSchema.safeParse(input.config)
		: null;
	if (config && !config.success) {
		throw new AppError("月度会员权益配置不正确", {
			status: 400,
			code: "membership_config_invalid",
			details: config.error.issues,
		});
	}
	const nowIso = new Date().toISOString();
	await upsertProductEntitlement(c.env.DB, {
		id: crypto.randomUUID(),
		ownerId: product.owner_id,
		productId,
		entitlementType: input.entitlementType,
		configJson: JSON.stringify(config?.success ? config.data : input.config),
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
