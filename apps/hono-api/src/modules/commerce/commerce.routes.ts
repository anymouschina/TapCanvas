import { Hono } from "hono";
import type { AppEnv } from "../../types";
import type { AppContext } from "../../types";
import { authMiddleware } from "../../middleware/auth";
import {
	ACCOUNT_SETTINGS_DICT_TYPE,
	resolveConfiguredPlatformOwnerId,
} from "../account/account.settings";
import {
	ConsumeSubscriptionQuotaRequestSchema,
	CreateDetailPageFeedbackRequestSchema,
	DetailPageEvolutionSummarySchema,
	DetailPageSampleRetrieveResponseSchema,
	DetailPageSampleSchema,
	DictionaryItemSchema,
	ProductEntitlementSchema,
	RetrieveDetailPageSamplesRequestSchema,
	RunDetailPageEvolutionRequestSchema,
	RunDetailPageEvolutionResponseSchema,
	SubscriptionDailyQuotaSchema,
	SubscriptionSchema,
	UpsertDetailPageSampleRequestSchema,
	UpsertDictionaryItemRequestSchema,
	UpsertProductEntitlementRequestSchema,
} from "./commerce.schemas";
import {
	createDetailPageFeedbackForOwner,
	deleteDetailPageSampleForOwner,
	consumeSubscriptionQuotaForOwner,
	deleteCommerceDictionaryItem,
	getDetailPageEvolutionSummaryForOwner,
	listActiveSubscriptionsForOwner,
	listCommerceDictionaryItems,
	listDetailPageSamplesForOwner,
	listSubscriptionDailyQuotasForOwner,
	retrieveDetailPageSamplesForOwner,
	runDetailPageEvolutionForOwner,
	upsertDetailPageSampleForOwner,
	upsertCommerceDictionaryItem,
	upsertProductEntitlementForCatalog,
} from "./commerce.service";

export const commerceRouter = new Hono<AppEnv>();
commerceRouter.use("*", authMiddleware);

function isAdmin(c: AppContext): boolean {
	const auth = c.get("auth") as { role?: string } | undefined;
	return auth?.role === "admin";
}

function resolveReadOwnerScope(c: AppContext, userId: string): string | undefined {
	return isAdmin(c) ? undefined : userId;
}

commerceRouter.get("/dictionaries", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const dictType = c.req.query("dictType") || undefined;
	const admin = isAdmin(c);
	if (dictType === ACCOUNT_SETTINGS_DICT_TYPE && !admin) {
		return c.json({ error: "Forbidden", code: "platform_account_admin_required" }, 403);
	}
	const platformOwnerId = resolveConfiguredPlatformOwnerId(c);
	if (dictType === ACCOUNT_SETTINGS_DICT_TYPE && !platformOwnerId) {
		return c.json({ error: "未配置 COMMERCE_PLATFORM_OWNER_ID", code: "account_platform_owner_not_configured" }, 503);
	}
	const ownerScope = dictType === ACCOUNT_SETTINGS_DICT_TYPE
		? platformOwnerId ?? undefined
		: resolveReadOwnerScope(c, userId);
	const items = await listCommerceDictionaryItems(c, ownerScope, dictType);
	const visibleItems = admin ? items : items.filter((item) => item.dictType !== ACCOUNT_SETTINGS_DICT_TYPE);
	return c.json(visibleItems.map((item) => DictionaryItemSchema.parse(item)));
});

commerceRouter.post("/dictionaries", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = UpsertDictionaryItemRequestSchema.safeParse(body);
	if (!parsed.success) return c.json({ error: "Invalid request body", issues: parsed.error.issues }, 400);
	const platformSettings = parsed.data.dictType === ACCOUNT_SETTINGS_DICT_TYPE;
	if (platformSettings && !isAdmin(c)) {
		return c.json({ error: "Forbidden", code: "platform_account_admin_required" }, 403);
	}
	const ownerId = platformSettings ? resolveConfiguredPlatformOwnerId(c) : userId;
	if (!ownerId) {
		return c.json({ error: "未配置 COMMERCE_PLATFORM_OWNER_ID", code: "account_platform_owner_not_configured" }, 503);
	}
	const item = await upsertCommerceDictionaryItem(c, ownerId, parsed.data);
	return c.json(DictionaryItemSchema.parse(item));
});

commerceRouter.delete("/dictionaries/:id", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	await deleteCommerceDictionaryItem(c, userId, c.req.param("id"));
	return c.body(null, 204);
});

commerceRouter.post("/products/:productId/entitlement", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	if (!isAdmin(c)) return c.json({ error: "Forbidden" }, 403);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = UpsertProductEntitlementRequestSchema.safeParse(body);
	if (!parsed.success) return c.json({ error: "Invalid request body", issues: parsed.error.issues }, 400);
	const dto = await upsertProductEntitlementForCatalog(c, c.req.param("productId"), {
		entitlementType: parsed.data.entitlementType,
		config: parsed.data.config,
	});
	return c.json(ProductEntitlementSchema.parse(dto));
});

commerceRouter.get("/subscriptions/active", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const rows = await listActiveSubscriptionsForOwner(c, userId);
	return c.json(rows.map((row) => SubscriptionSchema.parse(row)));
});

commerceRouter.get("/subscriptions/:id/quotas", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const rows = await listSubscriptionDailyQuotasForOwner(c, userId, c.req.param("id"));
	return c.json(rows.map((row) => SubscriptionDailyQuotaSchema.parse(row)));
});

commerceRouter.post("/subscriptions/:id/consume", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = ConsumeSubscriptionQuotaRequestSchema.safeParse(body);
	if (!parsed.success) return c.json({ error: "Invalid request body", issues: parsed.error.issues }, 400);
	const quota = await consumeSubscriptionQuotaForOwner(c, userId, {
		subscriptionId: c.req.param("id"),
		amount: parsed.data.amount,
		idempotencyKey: parsed.data.idempotencyKey,
		reason: parsed.data.reason,
	});
	return c.json(SubscriptionDailyQuotaSchema.parse(quota));
});

commerceRouter.get("/detail-page-samples", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const category = c.req.query("category") || undefined;
	const limitRaw = Number(c.req.query("limit") || 100);
	const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, Math.trunc(limitRaw))) : 100;
	const items = await listDetailPageSamplesForOwner(c, resolveReadOwnerScope(c, userId), { category, limit });
	return c.json(items.map((item) => DetailPageSampleSchema.parse(item)));
});

commerceRouter.post("/detail-page-samples", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = UpsertDetailPageSampleRequestSchema.safeParse(body);
	if (!parsed.success) return c.json({ error: "Invalid request body", issues: parsed.error.issues }, 400);
	const dto = await upsertDetailPageSampleForOwner(c, userId, parsed.data);
	return c.json(DetailPageSampleSchema.parse(dto));
});

commerceRouter.delete("/detail-page-samples/:id", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	await deleteDetailPageSampleForOwner(c, userId, c.req.param("id"));
	return c.body(null, 204);
});

commerceRouter.post("/detail-page-samples/retrieve", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = RetrieveDetailPageSamplesRequestSchema.safeParse(body);
	if (!parsed.success) return c.json({ error: "Invalid request body", issues: parsed.error.issues }, 400);
	const dto = await retrieveDetailPageSamplesForOwner(c, {
		actorOwnerId: userId,
		scopeOwnerId: resolveReadOwnerScope(c, userId),
		...parsed.data,
	});
	return c.json(DetailPageSampleRetrieveResponseSchema.parse(dto));
});

commerceRouter.post("/detail-page-feedback", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = CreateDetailPageFeedbackRequestSchema.safeParse(body);
	if (!parsed.success) return c.json({ error: "Invalid request body", issues: parsed.error.issues }, 400);
	const result = await createDetailPageFeedbackForOwner(c, userId, parsed.data);
	return c.json(result);
});

commerceRouter.get("/detail-page-evolution/summary", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const summary = await getDetailPageEvolutionSummaryForOwner(c, resolveReadOwnerScope(c, userId));
	return c.json(DetailPageEvolutionSummarySchema.parse(summary));
});

commerceRouter.post("/detail-page-evolution/run", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = RunDetailPageEvolutionRequestSchema.safeParse(body);
	if (!parsed.success) return c.json({ error: "Invalid request body", issues: parsed.error.issues }, 400);
	const dto = await runDetailPageEvolutionForOwner(c, {
		actorOwnerId: userId,
		scopeOwnerId: resolveReadOwnerScope(c, userId),
		...parsed.data,
	});
	return c.json(RunDetailPageEvolutionResponseSchema.parse(dto));
});
