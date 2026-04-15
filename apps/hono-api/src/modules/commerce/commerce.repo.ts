import type { PrismaClient } from "../../types";
import { getPrismaClient } from "../../platform/node/prisma";

export type DictionaryRow = {
	id: string;
	owner_id: string;
	dict_type: string;
	code: string;
	name: string;
	value_json: string | null;
	enabled: number;
	sort_order: number;
	created_at: string;
	updated_at: string;
};

export type PointsAccountRow = {
	owner_id: string;
	balance: number;
	total_earned: number;
	total_spent: number;
	updated_at: string;
};

export type PointsLedgerRow = {
	id: string;
	owner_id: string;
	change_amount: number;
	balance_after: number;
	source_type: string;
	source_id: string | null;
	note: string | null;
	idempotency_key: string;
	created_at: string;
};

export type ProductEntitlementRow = {
	id: string;
	product_id: string;
	owner_id: string;
	entitlement_type: string;
	config_json: string | null;
	created_at: string;
	updated_at: string;
};

export type SubscriptionRow = {
	id: string;
	owner_id: string;
	plan_code: string;
	source_order_id: string | null;
	status: string;
	start_at: string;
	end_at: string;
	duration_days: number;
	daily_limit: number;
	timezone: string;
	created_at: string;
	updated_at: string;
	canceled_at: string | null;
};

export type SubscriptionDailyQuotaRow = {
	id: string;
	subscription_id: string;
	owner_id: string;
	quota_date: string;
	daily_limit: number;
	used_count: number;
	created_at: string;
	updated_at: string;
};

export type RechargePackageRow = {
	product_id: string;
	title: string;
	subtitle: string | null;
	currency: string;
	price_cents: number;
	config_json: string | null;
};

export type DetailPageSampleRow = {
	id: string;
	owner_id: string;
	title: string;
	category: string;
	tags_json: string;
	source: string | null;
	image_url: string | null;
	summary: string | null;
	modules_json: string | null;
	copy_json: string | null;
	style_json: string | null;
	score_quality: number;
	score_visual: number;
	score_conversion: number;
	usage_count: number;
	last_used_at: string | null;
	created_at: string;
	updated_at: string;
};

let detailPageSchemaEnsured = false;

export async function ensureDetailPageSchema(db: PrismaClient): Promise<void> {
	void db;
	if (detailPageSchemaEnsured) return;
	// DDL is handled by startup schema bootstrap for Postgres.
	detailPageSchemaEnsured = true;
}

export async function listDictionaryRows(db: PrismaClient, ownerId: string | undefined, dictType?: string): Promise<DictionaryRow[]> {
	void db;
	return getPrismaClient().commerce_dictionaries.findMany({
		where: {
			...(ownerId ? { owner_id: ownerId } : {}),
			...(dictType ? { dict_type: dictType } : {}),
		},
		orderBy: dictType
			? [{ sort_order: "asc" }, { code: "asc" }]
			: [{ dict_type: "asc" }, { sort_order: "asc" }, { code: "asc" }],
	});
}

export async function listRechargePackageRows(db: PrismaClient, ownerId?: string): Promise<RechargePackageRow[]> {
	void db;
	const rows = await getPrismaClient().products.findMany({
		where: {
			...(ownerId ? { owner_id: ownerId } : {}),
			status: "active",
			product_entitlements: {
				some: {
					...(ownerId ? { owner_id: ownerId } : {}),
					entitlement_type: "points_topup",
				},
			},
		},
		orderBy: [{ price_cents: "asc" }, { created_at: "asc" }],
		select: {
			id: true,
			title: true,
			subtitle: true,
			currency: true,
			price_cents: true,
			product_entitlements: {
				where: {
					...(ownerId ? { owner_id: ownerId } : {}),
					entitlement_type: "points_topup",
				},
				select: { config_json: true },
				take: 1,
			},
		},
	});
	return rows.map((row) => ({
		product_id: row.id,
		title: row.title,
		subtitle: row.subtitle,
		currency: row.currency,
		price_cents: row.price_cents,
		config_json: row.product_entitlements[0]?.config_json ?? null,
	}));
}

export async function getDictionaryById(db: PrismaClient, ownerId: string, id: string): Promise<DictionaryRow | null> {
	void db;
	return getPrismaClient().commerce_dictionaries.findFirst({
		where: { owner_id: ownerId, id },
	});
}

export async function upsertDictionaryRow(db: PrismaClient, input: {
	id: string;
	ownerId: string;
	dictType: string;
	code: string;
	name: string;
	valueJson: string | null;
	enabled: boolean;
	sortOrder: number;
	nowIso: string;
}): Promise<void> {
	void db;
	await getPrismaClient().commerce_dictionaries.upsert({
		where: {
			owner_id_dict_type_code: {
				owner_id: input.ownerId,
				dict_type: input.dictType,
				code: input.code,
			},
		},
		create: {
			id: input.id,
			owner_id: input.ownerId,
			dict_type: input.dictType,
			code: input.code,
			name: input.name,
			value_json: input.valueJson,
			enabled: input.enabled ? 1 : 0,
			sort_order: input.sortOrder,
			created_at: input.nowIso,
			updated_at: input.nowIso,
		},
		update: {
			id: input.id,
			name: input.name,
			value_json: input.valueJson,
			enabled: input.enabled ? 1 : 0,
			sort_order: input.sortOrder,
			updated_at: input.nowIso,
		},
	});
}

export async function deleteDictionaryRow(db: PrismaClient, ownerId: string, id: string): Promise<void> {
	void db;
	await getPrismaClient().commerce_dictionaries.deleteMany({
		where: { owner_id: ownerId, id },
	});
}

export async function getPointsAccount(db: PrismaClient, ownerId: string): Promise<PointsAccountRow | null> {
	void db;
	return getPrismaClient().points_accounts.findUnique({ where: { owner_id: ownerId } });
}

export async function ensurePointsAccount(db: PrismaClient, ownerId: string, nowIso: string): Promise<void> {
	void db;
	await getPrismaClient().points_accounts.upsert({
		where: { owner_id: ownerId },
		create: {
			owner_id: ownerId,
			balance: 0,
			total_earned: 0,
			total_spent: 0,
			updated_at: nowIso,
		},
		update: {},
	});
}

export async function listPointsLedger(db: PrismaClient, ownerId: string, limit: number): Promise<PointsLedgerRow[]> {
	void db;
	return getPrismaClient().points_ledger.findMany({
		where: { owner_id: ownerId },
		orderBy: { created_at: "desc" },
		take: limit,
	});
}

export async function getPointsLedgerByIdempotencyKey(db: PrismaClient, ownerId: string, idempotencyKey: string): Promise<PointsLedgerRow | null> {
	void db;
	return getPrismaClient().points_ledger.findUnique({
		where: {
			owner_id_idempotency_key: {
				owner_id: ownerId,
				idempotency_key: idempotencyKey,
			},
		},
	});
}

export async function updatePointsAccountAndInsertLedger(db: PrismaClient, input: {
	ownerId: string;
	changeAmount: number;
	sourceType: string;
	sourceId: string | null;
	note: string | null;
	idempotencyKey: string;
	nowIso: string;
}): Promise<void> {
	void db;
	await getPrismaClient().$transaction(async (tx) => {
		await tx.points_accounts.upsert({
			where: { owner_id: input.ownerId },
			create: {
				owner_id: input.ownerId,
				balance: 0,
				total_earned: 0,
				total_spent: 0,
				updated_at: input.nowIso,
			},
			update: {},
		});
		const account = await tx.points_accounts.findUnique({
			where: { owner_id: input.ownerId },
		});
		const currentBalance = Number(account?.balance ?? 0) || 0;
		const nextBalance = currentBalance + input.changeAmount;
		if (nextBalance < 0) throw new Error("points_balance_not_enough");

		const earnedDelta = input.changeAmount > 0 ? input.changeAmount : 0;
		const spentDelta = input.changeAmount < 0 ? -input.changeAmount : 0;
		await tx.points_accounts.update({
			where: { owner_id: input.ownerId },
			data: {
				balance: nextBalance,
				total_earned: { increment: earnedDelta },
				total_spent: { increment: spentDelta },
				updated_at: input.nowIso,
			},
		});
		await tx.points_ledger.create({
			data: {
				id: crypto.randomUUID(),
				owner_id: input.ownerId,
				change_amount: input.changeAmount,
				balance_after: nextBalance,
				source_type: input.sourceType,
				source_id: input.sourceId,
				note: input.note,
				idempotency_key: input.idempotencyKey,
				created_at: input.nowIso,
			},
		});
	});
}

export async function getProductEntitlement(db: PrismaClient, ownerId: string, productId: string): Promise<ProductEntitlementRow | null> {
	void db;
	return getPrismaClient().product_entitlements.findUnique({
		where: {
			owner_id_product_id: { owner_id: ownerId, product_id: productId },
		},
	});
}

export async function getProductEntitlementByProductId(db: PrismaClient, productId: string): Promise<ProductEntitlementRow | null> {
	void db;
	return getPrismaClient().product_entitlements.findFirst({
		where: { product_id: productId },
	});
}

export async function upsertProductEntitlement(db: PrismaClient, input: {
	id: string;
	ownerId: string;
	productId: string;
	entitlementType: string;
	configJson: string | null;
	nowIso: string;
}): Promise<void> {
	void db;
	await getPrismaClient().product_entitlements.upsert({
		where: {
			owner_id_product_id: {
				owner_id: input.ownerId,
				product_id: input.productId,
			},
		},
		create: {
			id: input.id,
			product_id: input.productId,
			owner_id: input.ownerId,
			entitlement_type: input.entitlementType,
			config_json: input.configJson,
			created_at: input.nowIso,
			updated_at: input.nowIso,
		},
		update: {
			entitlement_type: input.entitlementType,
			config_json: input.configJson,
			updated_at: input.nowIso,
		},
	});
}

export async function insertSubscription(db: PrismaClient, input: {
	id: string;
	ownerId: string;
	planCode: string;
	sourceOrderId: string | null;
	status: string;
	startAt: string;
	endAt: string;
	durationDays: number;
	dailyLimit: number;
	timezone: string;
	nowIso: string;
}): Promise<void> {
	void db;
	await getPrismaClient().subscriptions.create({
		data: {
			id: input.id,
			owner_id: input.ownerId,
			plan_code: input.planCode,
			source_order_id: input.sourceOrderId,
			status: input.status,
			start_at: input.startAt,
			end_at: input.endAt,
			duration_days: input.durationDays,
			daily_limit: input.dailyLimit,
			timezone: input.timezone,
			created_at: input.nowIso,
			updated_at: input.nowIso,
			canceled_at: null,
		},
	});
}

export async function insertSubscriptionDailyQuota(db: PrismaClient, input: {
	id: string;
	subscriptionId: string;
	ownerId: string;
	quotaDate: string;
	dailyLimit: number;
	usedCount: number;
	nowIso: string;
}): Promise<void> {
	void db;
	await getPrismaClient().subscription_daily_quotas.upsert({
		where: {
			subscription_id_quota_date: {
				subscription_id: input.subscriptionId,
				quota_date: input.quotaDate,
			},
		},
		create: {
			id: input.id,
			subscription_id: input.subscriptionId,
			owner_id: input.ownerId,
			quota_date: input.quotaDate,
			daily_limit: input.dailyLimit,
			used_count: input.usedCount,
			created_at: input.nowIso,
			updated_at: input.nowIso,
		},
		update: {},
	});
}

export async function listActiveSubscriptions(db: PrismaClient, ownerId: string, nowIso: string): Promise<SubscriptionRow[]> {
	void db;
	return getPrismaClient().subscriptions.findMany({
		where: {
			owner_id: ownerId,
			status: "active",
			start_at: { lte: nowIso },
			end_at: { gte: nowIso },
		},
		orderBy: { start_at: "desc" },
	});
}

export async function getSubscriptionById(db: PrismaClient, ownerId: string, id: string): Promise<SubscriptionRow | null> {
	void db;
	return getPrismaClient().subscriptions.findFirst({
		where: { owner_id: ownerId, id },
	});
}

export async function getDailyQuotaByDate(db: PrismaClient, ownerId: string, subscriptionId: string, quotaDate: string): Promise<SubscriptionDailyQuotaRow | null> {
	void db;
	return getPrismaClient().subscription_daily_quotas.findFirst({
		where: { owner_id: ownerId, subscription_id: subscriptionId, quota_date: quotaDate },
	});
}

export async function listDailyQuotas(db: PrismaClient, ownerId: string, subscriptionId: string): Promise<SubscriptionDailyQuotaRow[]> {
	void db;
	return getPrismaClient().subscription_daily_quotas.findMany({
		where: { owner_id: ownerId, subscription_id: subscriptionId },
		orderBy: { quota_date: "asc" },
	});
}

export async function getQuotaEventByIdempotencyKey(db: PrismaClient, ownerId: string, subscriptionId: string, idempotencyKey: string): Promise<{ id: string } | null> {
	void db;
	return getPrismaClient().subscription_quota_events.findFirst({
		where: {
			owner_id: ownerId,
			subscription_id: subscriptionId,
			idempotency_key: idempotencyKey,
		},
		select: { id: true },
	});
}

export async function consumeDailyQuota(db: PrismaClient, input: {
	ownerId: string;
	subscriptionId: string;
	quotaDate: string;
	amount: number;
	idempotencyKey: string;
	reason: string | null;
	nowIso: string;
}): Promise<void> {
	void db;
	await getPrismaClient().$transaction(async (tx) => {
		const quota = await tx.subscription_daily_quotas.findFirst({
			where: {
				owner_id: input.ownerId,
				subscription_id: input.subscriptionId,
				quota_date: input.quotaDate,
			},
		});
		if (!quota) throw new Error("quota_not_found");
		const used = Number(quota.used_count ?? 0) || 0;
		const limit = Number(quota.daily_limit ?? 0) || 0;
		if (used + input.amount > limit) throw new Error("quota_exceeded");
		await tx.subscription_daily_quotas.update({
			where: { id: quota.id },
			data: {
				used_count: { increment: input.amount },
				updated_at: input.nowIso,
			},
		});
		await tx.subscription_quota_events.create({
			data: {
				id: crypto.randomUUID(),
				subscription_id: input.subscriptionId,
				owner_id: input.ownerId,
				quota_date: input.quotaDate,
				delta: input.amount,
				idempotency_key: input.idempotencyKey,
				reason: input.reason,
				created_at: input.nowIso,
			},
		});
	});
}

export async function getOrderEntitlementLog(db: PrismaClient, ownerId: string, orderItemId: string, entitlementType: string): Promise<{ id: string } | null> {
	void db;
	return getPrismaClient().order_entitlements.findFirst({
		where: {
			owner_id: ownerId,
			order_item_id: orderItemId,
			entitlement_type: entitlementType,
		},
		select: { id: true },
	});
}

export async function insertOrderEntitlementLog(db: PrismaClient, input: {
	id: string;
	ownerId: string;
	orderId: string;
	orderItemId: string;
	productId: string;
	entitlementType: string;
	status: string;
	resultJson: string | null;
	nowIso: string;
}): Promise<void> {
	void db;
	await getPrismaClient().order_entitlements.upsert({
		where: {
			order_item_id_entitlement_type: {
				order_item_id: input.orderItemId,
				entitlement_type: input.entitlementType,
			},
		},
		create: {
			id: input.id,
			owner_id: input.ownerId,
			order_id: input.orderId,
			order_item_id: input.orderItemId,
			product_id: input.productId,
			entitlement_type: input.entitlementType,
			status: input.status,
			result_json: input.resultJson,
			created_at: input.nowIso,
			updated_at: input.nowIso,
		},
		update: {},
	});
}

export async function listDetailPageSamples(
	db: PrismaClient,
	ownerId: string | undefined,
	options?: { category?: string; limit?: number },
): Promise<DetailPageSampleRow[]> {
	await ensureDetailPageSchema(db);
	const limit = Math.max(1, Math.min(200, Number(options?.limit ?? 100) || 100));
	const category = options?.category?.trim();
	return getPrismaClient().detail_page_samples.findMany({
		where: {
			...(ownerId ? { owner_id: ownerId } : {}),
			...(category ? { category } : {}),
		},
		orderBy: { updated_at: "desc" },
		take: limit,
	});
}

export async function getDetailPageSampleById(
	db: PrismaClient,
	ownerId: string | undefined,
	id: string,
): Promise<DetailPageSampleRow | null> {
	await ensureDetailPageSchema(db);
	return getPrismaClient().detail_page_samples.findFirst({
		where: {
			id,
			...(ownerId ? { owner_id: ownerId } : {}),
		},
	});
}

export async function upsertDetailPageSampleRow(
	db: PrismaClient,
	input: {
		id: string;
		ownerId: string;
		title: string;
		category: string;
		tagsJson: string;
		source: string | null;
		imageUrl: string | null;
		summary: string | null;
		modulesJson: string | null;
		copyJson: string | null;
		styleJson: string | null;
		scoreQuality: number;
		scoreVisual: number;
		scoreConversion: number;
		nowIso: string;
	},
): Promise<void> {
	await ensureDetailPageSchema(db);
	await getPrismaClient().detail_page_samples.upsert({
		where: { id: input.id },
		create: {
			id: input.id,
			owner_id: input.ownerId,
			title: input.title,
			category: input.category,
			tags_json: input.tagsJson,
			source: input.source,
			image_url: input.imageUrl,
			summary: input.summary,
			modules_json: input.modulesJson,
			copy_json: input.copyJson,
			style_json: input.styleJson,
			score_quality: input.scoreQuality,
			score_visual: input.scoreVisual,
			score_conversion: input.scoreConversion,
			usage_count: 0,
			last_used_at: null,
			created_at: input.nowIso,
			updated_at: input.nowIso,
		},
		update: {
			title: input.title,
			category: input.category,
			tags_json: input.tagsJson,
			source: input.source,
			image_url: input.imageUrl,
			summary: input.summary,
			modules_json: input.modulesJson,
			copy_json: input.copyJson,
			style_json: input.styleJson,
			score_quality: input.scoreQuality,
			score_visual: input.scoreVisual,
			score_conversion: input.scoreConversion,
			updated_at: input.nowIso,
		},
	});
}

export async function deleteDetailPageSampleRow(db: PrismaClient, ownerId: string | undefined, id: string): Promise<void> {
	await ensureDetailPageSchema(db);
	await getPrismaClient().detail_page_samples.deleteMany({
		where: {
			id,
			...(ownerId ? { owner_id: ownerId } : {}),
		},
	});
}

export async function listTopDetailPageSamplesForRetrieve(
	db: PrismaClient,
	ownerId: string | undefined,
	options: { queryText: string; category?: string; limit: number },
): Promise<Array<DetailPageSampleRow & { score: number }>> {
	await ensureDetailPageSchema(db);
	const queryText = options.queryText.trim().toLowerCase();
	const category = options.category?.trim() || "";
	const limit = Math.max(1, Math.min(20, options.limit));
	const candidates = await getPrismaClient().detail_page_samples.findMany({
		where: {
			...(ownerId ? { owner_id: ownerId } : {}),
			...(category ? { category } : {}),
		},
		take: 500,
		orderBy: { updated_at: "desc" },
	});

	const scored = candidates
		.map((row) => {
			const title = (row.title || "").toLowerCase();
			const tags = (row.tags_json || "").toLowerCase();
			const summary = (row.summary || "").toLowerCase();
			const categoryScore = category && row.category === category ? 30 : 0;
			const textScore = queryText
				? (title.includes(queryText) ? 20 : 0) +
					(tags.includes(queryText) ? 12 : 0) +
					(summary.includes(queryText) ? 8 : 0)
				: 0;
			const qualityScore =
				Number(row.score_quality || 0) +
				Number(row.score_visual || 0) +
				Number(row.score_conversion || 0);
			const score = categoryScore + textScore + qualityScore;
			return { ...row, score };
		})
		.filter((row) => {
			if (!queryText) return true;
			return (
				row.title.toLowerCase().includes(queryText) ||
				(row.tags_json || "").toLowerCase().includes(queryText) ||
				(row.summary || "").toLowerCase().includes(queryText) ||
				(category ? row.category === category : false)
			);
		})
		.sort((a, b) => {
			if (b.score !== a.score) return b.score - a.score;
			return String(b.updated_at).localeCompare(String(a.updated_at));
		})
		.slice(0, limit);

	return scored;
}

export async function touchDetailPageSamplesUsage(
	db: PrismaClient,
	ownerId: string | undefined,
	sampleIds: string[],
	nowIso: string,
): Promise<void> {
	await ensureDetailPageSchema(db);
	const prisma = getPrismaClient();
	for (const sampleId of sampleIds) {
		await prisma.detail_page_samples.updateMany({
			where: {
				id: sampleId,
				...(ownerId ? { owner_id: ownerId } : {}),
			},
			data: {
				usage_count: { increment: 1 },
				last_used_at: nowIso,
				updated_at: nowIso,
			},
		});
	}
}

export async function insertDetailPageRetrievalLogRows(
	db: PrismaClient,
	input: Array<{
		id: string;
		ownerId: string;
		queryText: string | null;
		category: string | null;
		sampleId: string;
		rankNo: number;
		score: number;
		createdAt: string;
	}>,
): Promise<void> {
	await ensureDetailPageSchema(db);
	const prisma = getPrismaClient();
	for (const row of input) {
		await prisma.detail_page_retrieval_logs.create({
			data: {
				id: row.id,
				owner_id: row.ownerId,
				query_text: row.queryText,
				category: row.category,
				sample_id: row.sampleId,
				rank_no: row.rankNo,
				score: row.score,
				created_at: row.createdAt,
			},
		});
	}
}

export async function insertDetailPageFeedbackRows(
	db: PrismaClient,
	rows: Array<{
		id: string;
		ownerId: string;
		generationId: string | null;
		sampleId: string;
		scoreOverall: number;
		scoreStructure: number | null;
		scoreVisual: number | null;
		scoreConversion: number | null;
		editRatio: number | null;
		note: string | null;
		createdAt: string;
	}>,
): Promise<void> {
	await ensureDetailPageSchema(db);
	const prisma = getPrismaClient();
	for (const row of rows) {
		await prisma.detail_page_feedback_logs.create({
			data: {
				id: row.id,
				owner_id: row.ownerId,
				generation_id: row.generationId,
				sample_id: row.sampleId,
				score_overall: row.scoreOverall,
				score_structure: row.scoreStructure,
				score_visual: row.scoreVisual,
				score_conversion: row.scoreConversion,
				edit_ratio: row.editRatio,
				note: row.note,
				created_at: row.createdAt,
			},
		});
	}
}

export async function getDetailPageEvolutionSummaryRow(
	db: PrismaClient,
	ownerId: string | undefined,
): Promise<{
	sampleCount: number;
	retrievalCount7d: number;
	feedbackCount7d: number;
	avgOverallScore: number;
	avgEditRatio: number;
}> {
	await ensureDetailPageSchema(db);
	const prisma = getPrismaClient();
	const threshold = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
	const [sampleCount, retrievalCount7d, feedbackCount7d, feedbackAgg] = await Promise.all([
		prisma.detail_page_samples.count({ where: { ...(ownerId ? { owner_id: ownerId } : {}) } }),
		prisma.detail_page_retrieval_logs.count({
			where: {
				...(ownerId ? { owner_id: ownerId } : {}),
				created_at: { gte: threshold },
			},
		}),
		prisma.detail_page_feedback_logs.count({
			where: {
				...(ownerId ? { owner_id: ownerId } : {}),
				created_at: { gte: threshold },
			},
		}),
		prisma.detail_page_feedback_logs.aggregate({
			where: { ...(ownerId ? { owner_id: ownerId } : {}) },
			_avg: { score_overall: true, edit_ratio: true },
		}),
	]);
	return {
		sampleCount: sampleCount || 0,
		retrievalCount7d: retrievalCount7d || 0,
		feedbackCount7d: feedbackCount7d || 0,
		avgOverallScore: Number(feedbackAgg._avg.score_overall ?? 0) || 0,
		avgEditRatio: Number(feedbackAgg._avg.edit_ratio ?? 0) || 0,
	};
}

export async function listWeakDetailPageCategories(
	db: PrismaClient,
	ownerId: string | undefined,
	limit = 5,
): Promise<Array<{ category: string; avg_overall_score: number; feedback_count: number }>> {
	await ensureDetailPageSchema(db);
	const safeLimit = Math.max(1, Math.min(20, limit));
	const rows = await getPrismaClient().detail_page_feedback_logs.findMany({
		where: { ...(ownerId ? { owner_id: ownerId } : {}) },
		select: {
			score_overall: true,
			detail_page_samples: {
				select: { category: true, owner_id: true },
			},
		},
	});
	const bucket = new Map<string, { total: number; count: number }>();
	for (const row of rows) {
		const sample = row.detail_page_samples;
		if (!sample) continue;
		if (ownerId && sample.owner_id !== ownerId) continue;
		const key = sample.category;
		const prev = bucket.get(key) ?? { total: 0, count: 0 };
		bucket.set(key, {
			total: prev.total + Number(row.score_overall || 0),
			count: prev.count + 1,
		});
	}
	return Array.from(bucket.entries())
		.filter(([, v]) => v.count >= 2)
		.map(([category, v]) => ({
			category,
			avg_overall_score: v.count > 0 ? v.total / v.count : 0,
			feedback_count: v.count,
		}))
		.sort((a, b) => {
			if (a.avg_overall_score !== b.avg_overall_score) {
				return a.avg_overall_score - b.avg_overall_score;
			}
			return b.feedback_count - a.feedback_count;
		})
		.slice(0, safeLimit);
}

export async function countDetailPageFeedbacks(db: PrismaClient, ownerId: string | undefined): Promise<number> {
	await ensureDetailPageSchema(db);
	return getPrismaClient().detail_page_feedback_logs.count({
		where: { ...(ownerId ? { owner_id: ownerId } : {}) },
	});
}

export async function insertDetailPageEvolutionRun(
	db: PrismaClient,
	input: {
		id: string;
		ownerId: string;
		minFeedbacks: number;
		action: string;
		metricsJson: string;
		createdAt: string;
	},
): Promise<void> {
	await ensureDetailPageSchema(db);
	await getPrismaClient().detail_page_evolution_runs.create({
		data: {
			id: input.id,
			owner_id: input.ownerId,
			min_feedbacks: input.minFeedbacks,
			action: input.action,
			metrics_json: input.metricsJson,
			created_at: input.createdAt,
		},
	});
}
