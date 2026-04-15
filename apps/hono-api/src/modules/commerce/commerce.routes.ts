import { Hono } from "hono";
import type { AppEnv } from "../../types";
import type { AppContext } from "../../types";
import { authMiddleware } from "../../middleware/auth";
import {
	ConsumeSubscriptionQuotaRequestSchema,
	CreateDetailPageFeedbackRequestSchema,
	DetailPageEvolutionSummarySchema,
	DetailPageSampleRetrieveResponseSchema,
	DetailPageSampleSchema,
	DictionaryItemSchema,
	OpenClawAuthorizationAdminListResponseSchema,
	OpenClawAuthorizationAdminSchema,
	OpenClawAuthorizationDeleteResponseSchema,
	OpenClawSelfAuthorizationSchema,
	OpenClawSelfKeySchema,
	OpenClawAuthorizationResetAllUsageResponseSchema,
	OpenClawAuthorizationResetUsageRequestSchema,
	OpenClawAuthorizationResyncRequestSchema,
	ProductEntitlementSchema,
	RechargePackageSchema,
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
	listRechargePackagesForOwner,
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
import { deleteOpenClawAuthorizationById, getOpenClawAuthorizationForOwner, getOpenClawKeyForOwner, listOpenClawAdminAuthorizations, resetAllOpenClawAuthorizationUsages, resetOpenClawAuthorizationUsageById, resyncOpenClawAuthorizationById } from "./openclaw.service";

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
	const items = await listCommerceDictionaryItems(c, resolveReadOwnerScope(c, userId), dictType);
	return c.json(items.map((item) => DictionaryItemSchema.parse(item)));
});

commerceRouter.post("/dictionaries", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = UpsertDictionaryItemRequestSchema.safeParse(body);
	if (!parsed.success) return c.json({ error: "Invalid request body", issues: parsed.error.issues }, 400);
	const item = await upsertCommerceDictionaryItem(c, userId, parsed.data);
	return c.json(DictionaryItemSchema.parse(item));
});

commerceRouter.delete("/dictionaries/:id", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	await deleteCommerceDictionaryItem(c, userId, c.req.param("id"));
	return c.body(null, 204);
});

commerceRouter.get("/recharge/packages", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const items = await listRechargePackagesForOwner(c, userId);
	return c.json(items.map((item) => RechargePackageSchema.parse(item)));
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
		config: parsed.data.config as Record<string, unknown>,
	});
	return c.json(ProductEntitlementSchema.parse(dto));
});

commerceRouter.get("/openclaw/me", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const dto = await getOpenClawAuthorizationForOwner(c, userId);
	return c.json(OpenClawSelfAuthorizationSchema.parse(dto));
});

commerceRouter.post("/openclaw/me/key", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const dto = await getOpenClawKeyForOwner(c, userId);
	return c.json(OpenClawSelfKeySchema.parse(dto));
});


commerceRouter.get("/openclaw/admin/authorizations", async (c) => {
	if (!isAdmin(c)) return c.json({ error: "Forbidden" }, 403);
	const limitRaw = Number(c.req.query("limit") || 200);
	const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, Math.trunc(limitRaw))) : 200;
	const items = await listOpenClawAdminAuthorizations(c, {
		q: c.req.query("q") || undefined,
		status: c.req.query("status") || undefined,
		limit,
	});
	return c.json(OpenClawAuthorizationAdminListResponseSchema.parse({ items }));
});

commerceRouter.post("/openclaw/admin/authorizations/:id/resync", async (c) => {
	if (!isAdmin(c)) return c.json({ error: "Forbidden" }, 403);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = OpenClawAuthorizationResyncRequestSchema.safeParse(body);
	if (!parsed.success) return c.json({ error: "Invalid request body", issues: parsed.error.issues }, 400);
	const dto = await resyncOpenClawAuthorizationById(c, {
		id: c.req.param("id"),
		quotaLimit: parsed.data.quotaLimit,
		descriptionText: parsed.data.descriptionText,
		desiredStatus: parsed.data.desiredStatus,
	});
	return c.json(OpenClawAuthorizationAdminSchema.parse(dto));
});


commerceRouter.post("/openclaw/admin/reset-usage-all", async (c) => {
	if (!isAdmin(c)) return c.json({ error: "Forbidden" }, 403);
	const result = await resetAllOpenClawAuthorizationUsages(c);
	return c.json(OpenClawAuthorizationResetAllUsageResponseSchema.parse(result));
});

commerceRouter.post("/openclaw/admin/authorizations/:id/reset-usage", async (c) => {
	if (!isAdmin(c)) return c.json({ error: "Forbidden" }, 403);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = OpenClawAuthorizationResetUsageRequestSchema.safeParse(body);
	if (!parsed.success) return c.json({ error: "Invalid request body", issues: parsed.error.issues }, 400);
	const dto = await resetOpenClawAuthorizationUsageById(c, { id: c.req.param("id") });
	return c.json(OpenClawAuthorizationAdminSchema.parse(dto));
});

commerceRouter.delete("/openclaw/admin/authorizations/:id", async (c) => {
	if (!isAdmin(c)) return c.json({ error: "Forbidden" }, 403);
	const dto = await deleteOpenClawAuthorizationById(c, { id: c.req.param("id") });
	return c.json(OpenClawAuthorizationDeleteResponseSchema.parse(dto));
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
