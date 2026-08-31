import { z } from "zod";

export const CommerceEntitlementTypeSchema = z.enum(["none", "membership", "team_plan", "skill_license"]);
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

export const ProductEntitlementSchema = z.object({
	productId: z.string(),
	entitlementType: CommerceEntitlementTypeSchema,
	configJson: z.string().nullable(),
	createdAt: z.string(),
	updatedAt: z.string(),
});
export type ProductEntitlementDto = z.infer<typeof ProductEntitlementSchema>;

function isValidTimeZone(value: string): boolean {
	try {
		new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
		return true;
	} catch {
		return false;
	}
}

const TimeZoneSchema = z.string().trim().min(1).max(64).refine(isValidTimeZone, "无效的 IANA 时区");

export const MembershipBillingCycleSchema = z.enum(["monthly", "annual"]);
export type MembershipBillingCycle = z.infer<typeof MembershipBillingCycleSchema>;

const MembershipSkuConfigSchema = z.object({
	billingCycle: MembershipBillingCycleSchema,
	durationDays: z.number().int().min(1).max(365),
	monthlyCredits: z.number().int().min(1).max(100_000_000),
	dailyGiftCredits: z.number().int().min(1).max(10_000_000),
	concurrencyLimit: z.number().int().min(1).max(1_000),
	capacityLabel: z.string().trim().max(40),
	timezone: TimeZoneSchema,
	compareAtPriceCents: z.number().int().nonnegative().optional(),
}).strict();

export const MembershipPlanPresentationSchema = z.object({
	badge: z.string().trim().max(40).optional(),
	compareAtPriceCents: z.number().int().nonnegative().optional(),
	accent: z.enum(["graphite", "violet", "blue", "cyan"]).default("graphite"),
	featured: z.boolean().default(false),
	sortOrder: z.number().int().min(-9999).max(9999).default(0),
	campaignBenefits: z.array(z.string().trim().min(1).max(120)).max(8).default([]),
	features: z.array(z.string().trim().min(1).max(160)).max(24).default([]),
}).strict();
export type MembershipPlanPresentation = z.infer<typeof MembershipPlanPresentationSchema>;

export const MembershipConfigSchema = z.object({
	billingCycle: MembershipBillingCycleSchema,
	durationDays: z.number().int().min(1).max(365),
	monthlyCredits: z.number().int().min(1).max(100_000_000),
	dailyGiftCredits: z.number().int().min(1).max(10_000_000),
	concurrencyLimit: z.number().int().min(1).max(1_000),
	capacityLabel: z.string().trim().max(40),
	timezone: TimeZoneSchema,
	skuConfigs: z.record(MembershipSkuConfigSchema).optional(),
	presentation: MembershipPlanPresentationSchema.optional(),
}).strict();

export type MembershipConfig = z.infer<typeof MembershipConfigSchema>;

export const UpsertProductEntitlementRequestSchema = z.discriminatedUnion("entitlementType", [
	z.object({
		entitlementType: z.literal("membership"),
		config: MembershipConfigSchema,
	}),
	z.object({
		entitlementType: CommerceEntitlementTypeSchema.exclude(["membership"]),
		config: z.record(z.unknown()),
	}),
]);

export const SubscriptionSchema = z.object({
	id: z.string(),
	ownerId: z.string(),
	planCode: z.string(),
	status: z.enum(["active", "expired", "canceled"]),
	startAt: z.string(),
	endAt: z.string(),
	billingCycle: MembershipBillingCycleSchema,
	durationDays: z.number().int().positive(),
	monthlyCredits: z.number().int().positive(),
	dailyGiftCredits: z.number().int().positive(),
	concurrencyLimit: z.number().int().positive(),
	capacityLabel: z.string(),
	creditGrantCount: z.number().int().positive(),
	creditGrantsIssued: z.number().int().nonnegative(),
	nextCreditGrantAt: z.string().nullable(),
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
