import { z } from "zod";

export const CommerceEntitlementTypeSchema = z.enum(["none", "points_topup", "monthly_quota", "openclaw_subscription"]);
export type CommerceEntitlementType = z.infer<typeof CommerceEntitlementTypeSchema>;

export const DictionaryItemSchema = z.object({
	id: z.string(),
	ownerId: z.string(),
	dictType: z.string(),
	code: z.string(),
	name: z.string(),
	valueJson: z.string().nullable(),
	enabled: z.boolean(),
	sortOrder: z.number().int(),
	createdAt: z.string(),
	updatedAt: z.string(),
});
export type DictionaryItemDto = z.infer<typeof DictionaryItemSchema>;

export const UpsertDictionaryItemRequestSchema = z.object({
	id: z.string().trim().min(1).optional(),
	dictType: z.string().trim().min(1).max(64),
	code: z.string().trim().min(1).max(64),
	name: z.string().trim().min(1).max(120),
	valueJson: z.string().trim().max(10000).optional(),
	enabled: z.boolean().optional(),
	sortOrder: z.number().int().min(-9999).max(9999).optional(),
});

export const RechargePackageSchema = z.object({
	productId: z.string(),
	title: z.string(),
	subtitle: z.string().nullable(),
	currency: z.string(),
	priceCents: z.number().int().nonnegative(),
	points: z.number().int().positive(),
	bonusPoints: z.number().int().nonnegative(),
	totalPoints: z.number().int().positive(),
});
export type RechargePackageDto = z.infer<typeof RechargePackageSchema>;

export const ProductEntitlementSchema = z.object({
	productId: z.string(),
	entitlementType: CommerceEntitlementTypeSchema,
	configJson: z.string().nullable(),
	createdAt: z.string(),
	updatedAt: z.string(),
});
export type ProductEntitlementDto = z.infer<typeof ProductEntitlementSchema>;

const PointsTopupConfigSchema = z.object({
	points: z.number().int().positive(),
});

const MonthlyQuotaConfigSchema = z.object({
	durationDays: z.number().int().min(1).max(365),
	dailyLimit: z.number().int().positive(),
	timezone: z.string().trim().min(1).max(64).default("Asia/Shanghai"),
});

const OpenClawSubscriptionConfigSchema = z.object({
	durationDays: z.number().int().min(1).max(365),
	dailyLimit: z.number().int().positive(),
	timezone: z.string().trim().min(1).max(64).default("Asia/Shanghai"),
	descriptionText: z.string().trim().max(500).optional(),
	externalName: z.string().trim().min(1).max(120).default("openclaw"),
	allowWallet: z.boolean().default(true),
	allowedItemIds: z.array(z.string().trim().min(1).max(120)).max(100).nullable().optional(),
});

export const OpenClawAuthorizationAdminSchema = z.object({
	id: z.string(),
	ownerId: z.string(),
	subscriptionId: z.string().nullable(),
	sourceOrderId: z.string().nullable(),
	productId: z.string().nullable(),
	skuId: z.string().nullable(),
	externalKeyMasked: z.string().nullable(),
	externalName: z.string(),
	quotaLimit: z.number().int().nonnegative(),
	descriptionText: z.string().nullable(),
	allowWallet: z.boolean(),
	allowedItemIds: z.array(z.string()).nullable(),
	expiredAt: z.string().nullable(),
	status: z.enum(["pending", "active", "inactive", "error"]),
	upstreamKeyId: z.string().nullable(),
	lastSyncedAt: z.string().nullable(),
	lastError: z.string().nullable(),
	createdAt: z.string(),
	updatedAt: z.string(),
	disabledAt: z.string().nullable(),
});
export type OpenClawAuthorizationAdminDto = z.infer<typeof OpenClawAuthorizationAdminSchema>;

export const OpenClawAuthorizationAdminListResponseSchema = z.object({
	items: z.array(OpenClawAuthorizationAdminSchema),
});

export const OpenClawSelfAuthorizationSchema = z.object({
	id: z.string(),
	ownerId: z.string(),
	subscriptionId: z.string().nullable(),
	sourceOrderId: z.string().nullable(),
	productId: z.string().nullable(),
	skuId: z.string().nullable(),
	externalKeyMasked: z.string().nullable(),
	externalName: z.string(),
	quotaLimit: z.number().int().nonnegative(),
	descriptionText: z.string().nullable(),
	allowWallet: z.boolean(),
	allowedItemIds: z.array(z.string()).nullable(),
	expiredAt: z.string().nullable(),
	status: z.enum(["pending", "active", "inactive", "error"]),
	upstreamKeyId: z.string().nullable(),
	lastSyncedAt: z.string().nullable(),
	lastError: z.string().nullable(),
	createdAt: z.string(),
	updatedAt: z.string(),
	disabledAt: z.string().nullable(),
});
export type OpenClawSelfAuthorizationDto = z.infer<typeof OpenClawSelfAuthorizationSchema>;

export const OpenClawSelfKeySchema = z.object({
	key: z.string(),
	keyMasked: z.string(),
	externalName: z.string(),
	status: z.enum(["pending", "active", "inactive", "error"]),
	expiredAt: z.string().nullable(),
	quotaLimit: z.number().int().nonnegative(),
	allowWallet: z.boolean(),
	allowedItemIds: z.array(z.string()).nullable(),
	upstreamKeyId: z.string().nullable(),
	updatedAt: z.string(),
});
export type OpenClawSelfKeyDto = z.infer<typeof OpenClawSelfKeySchema>;

export const OpenClawAuthorizationResyncRequestSchema = z.object({
	quotaLimit: z.number().int().positive().optional(),
	descriptionText: z.string().trim().max(500).nullable().optional(),
	desiredStatus: z.enum(["active", "inactive"]).optional(),
});

export const OpenClawAuthorizationResetUsageRequestSchema = z.object({});

export const OpenClawAuthorizationResetAllUsageResponseSchema = z.object({
	total: z.number().int().nonnegative(),
	succeeded: z.number().int().nonnegative(),
	failed: z.number().int().nonnegative(),
});

export const OpenClawAuthorizationDeleteResponseSchema = z.object({
	id: z.string(),
	ownerId: z.string(),
	upstreamKeyId: z.string().nullable(),
	upstreamDeleted: z.boolean(),
	upstreamDeleteStatus: z.enum(["deleted", "not_found"]),
});
export type OpenClawAuthorizationDeleteResponseDto = z.infer<typeof OpenClawAuthorizationDeleteResponseSchema>;

export const UpsertProductEntitlementRequestSchema = z.object({
	entitlementType: CommerceEntitlementTypeSchema,
	config: z.record(z.unknown()),
});

export const SubscriptionSchema = z.object({
	id: z.string(),
	ownerId: z.string(),
	planCode: z.string(),
	sourceOrderId: z.string().nullable(),
	status: z.enum(["active", "expired", "canceled"]),
	startAt: z.string(),
	endAt: z.string(),
	durationDays: z.number().int().positive(),
	dailyLimit: z.number().int().positive(),
	timezone: z.string(),
	createdAt: z.string(),
	updatedAt: z.string(),
	canceledAt: z.string().nullable(),
});
export type SubscriptionDto = z.infer<typeof SubscriptionSchema>;

export const SubscriptionDailyQuotaSchema = z.object({
	id: z.string(),
	subscriptionId: z.string(),
	ownerId: z.string(),
	quotaDate: z.string(),
	dailyLimit: z.number().int().positive(),
	usedCount: z.number().int().nonnegative(),
	remaining: z.number().int().nonnegative(),
	createdAt: z.string(),
	updatedAt: z.string(),
});
export type SubscriptionDailyQuotaDto = z.infer<typeof SubscriptionDailyQuotaSchema>;

export const ConsumeSubscriptionQuotaRequestSchema = z.object({
	amount: z.number().int().positive(),
	idempotencyKey: z.string().trim().min(1).max(128),
	reason: z.string().trim().max(200).optional(),
});

export const DetailPageSampleSchema = z.object({
	id: z.string(),
	ownerId: z.string(),
	title: z.string(),
	category: z.string(),
	tags: z.array(z.string()),
	source: z.string().nullable(),
	imageUrl: z.string().nullable(),
	summary: z.string().nullable(),
	modulesJson: z.string().nullable(),
	copyJson: z.string().nullable(),
	styleJson: z.string().nullable(),
	scoreQuality: z.number(),
	scoreVisual: z.number(),
	scoreConversion: z.number(),
	usageCount: z.number().int().nonnegative(),
	lastUsedAt: z.string().nullable(),
	createdAt: z.string(),
	updatedAt: z.string(),
});
export type DetailPageSampleDto = z.infer<typeof DetailPageSampleSchema>;

export const UpsertDetailPageSampleRequestSchema = z.object({
	id: z.string().trim().min(1).optional(),
	title: z.string().trim().min(1).max(160),
	category: z.string().trim().min(1).max(80),
	tags: z.array(z.string().trim().min(1).max(50)).max(50).optional(),
	source: z.string().trim().max(200).optional(),
	imageUrl: z.string().trim().url().max(2000).optional(),
	summary: z.string().trim().max(4000).optional(),
	modulesJson: z.string().trim().max(20000).optional(),
	copyJson: z.string().trim().max(30000).optional(),
	styleJson: z.string().trim().max(10000).optional(),
	scoreQuality: z.number().min(0).max(5).optional(),
	scoreVisual: z.number().min(0).max(5).optional(),
	scoreConversion: z.number().min(0).max(5).optional(),
});

export const RetrieveDetailPageSamplesRequestSchema = z.object({
	query: z.string().trim().max(2000).optional(),
	category: z.string().trim().max(80).optional(),
	limit: z.number().int().min(1).max(20).optional(),
});

export const DetailPageSampleRetrievalItemSchema = z.object({
	sample: DetailPageSampleSchema,
	score: z.number(),
});

export const DetailPageSampleRetrieveResponseSchema = z.object({
	items: z.array(DetailPageSampleRetrievalItemSchema),
	contextSnippet: z.string(),
});
export type DetailPageSampleRetrieveResponseDto = z.infer<typeof DetailPageSampleRetrieveResponseSchema>;

export const CreateDetailPageFeedbackRequestSchema = z.object({
	generationId: z.string().trim().min(1).max(120).optional(),
	sampleIds: z.array(z.string().trim().min(1)).min(1).max(20),
	scoreOverall: z.number().int().min(1).max(5),
	scoreStructure: z.number().int().min(1).max(5).optional(),
	scoreVisual: z.number().int().min(1).max(5).optional(),
	scoreConversion: z.number().int().min(1).max(5).optional(),
	editRatio: z.number().min(0).max(1).optional(),
	note: z.string().trim().max(2000).optional(),
});

export const DetailPageEvolutionSummarySchema = z.object({
	sampleCount: z.number().int().nonnegative(),
	retrievalCount7d: z.number().int().nonnegative(),
	feedbackCount7d: z.number().int().nonnegative(),
	avgOverallScore: z.number(),
	avgEditRatio: z.number(),
});
export type DetailPageEvolutionSummaryDto = z.infer<typeof DetailPageEvolutionSummarySchema>;

export const RunDetailPageEvolutionRequestSchema = z.object({
	minFeedbacks: z.number().int().min(1).max(10000).optional(),
});

export const RunDetailPageEvolutionResponseSchema = z.object({
	runId: z.string(),
	action: z.enum(["ready_for_optimizer", "skip"]),
	metrics: DetailPageEvolutionSummarySchema.extend({
		minFeedbacks: z.number().int().positive(),
		hasEnoughFeedbacks: z.boolean(),
		weakCategories: z.array(
			z.object({
				category: z.string(),
				avgOverallScore: z.number(),
				feedbackCount: z.number().int().nonnegative(),
			}),
		),
	}),
	createdAt: z.string(),
});
export type RunDetailPageEvolutionResponseDto = z.infer<typeof RunDetailPageEvolutionResponseSchema>;
