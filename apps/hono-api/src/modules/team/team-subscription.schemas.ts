import { z } from "zod";

export const SubscriptionPlanFeaturesSchema = z.object({
	concurrent_tasks_per_seat: z.number().int().default(0),
	unlimited_concurrent_tasks: z.boolean(),
	canvas_collab: z.boolean().default(false),
	shared_asset_library: z.boolean().default(false),
	seat_management: z.boolean().default(false),
	credit_quota_control: z.boolean().default(false),
	fast_invoice: z.boolean().default(false),
	creditGrants: z.object({
		annual: z.object({
			includedCreditsPerSeat: z.number().int().nonnegative(),
		}),
	}),
	presentation: z.object({
		badge: z.string().trim().max(40).default(""),
		variantOrder: z.number().int().min(1).max(99),
		accent: z.enum(["graphite", "violet", "blue", "cyan"]).default("graphite"),
		featured: z.boolean().default(false),
		campaignBenefits: z.array(z.string().trim().min(1).max(120)).max(8).default([]),
		capabilities: z.array(z.string().trim().min(1).max(160)).max(24).default([]),
	}),
});

export type SubscriptionPlanFeatures = z.infer<typeof SubscriptionPlanFeaturesSchema>;

export const TeamSubscriptionPlanSchema = z.object({
	id: z.string(),
	name: z.string(),
	tier: z.string(),
	maxSeats: z.number().int(),
	minSeats: z.number().int(),
	features: SubscriptionPlanFeaturesSchema,
	sortWeight: z.number().int(),
	enabled: z.boolean(),
	createdAt: z.string(),
	updatedAt: z.string(),
});

export type TeamSubscriptionPlanDto = z.infer<typeof TeamSubscriptionPlanSchema>;

export const TeamPlanSubscriptionSchema = z.object({
	id: z.string(),
	teamId: z.string(),
	planId: z.string(),
	plan: TeamSubscriptionPlanSchema.optional(),
	billingCycle: z.enum(["monthly", "annual"]),
	seatCount: z.number().int(),
	status: z.enum(["active", "expired", "cancelled"]),
	currentPeriodStart: z.string(),
	currentPeriodEnd: z.string(),
	nextCreditRenewalAt: z.string(),
	lastRenewedAt: z.string().nullable(),
	creditsPerRenewal: z.number().int(),
	cancelledAt: z.string().nullable(),
	createdAt: z.string(),
	updatedAt: z.string(),
});

export type TeamPlanSubscriptionDto = z.infer<typeof TeamPlanSubscriptionSchema>;

export const ActivateTeamSubscriptionSchema = z.object({
	planId: z.string().min(1),
	billingCycle: z.literal("annual").default("annual"),
	seatCount: z.number().int().min(1).max(500).default(2),
	issueCreditsNow: z.boolean().default(true),
});

export const UpsertTeamSubscriptionPlanSchema = z.object({
	id: z.string().trim().min(1).max(80).optional(),
	name: z.string().trim().min(1).max(120),
	tier: z.string().trim().min(1).max(40),
	maxSeats: z.number().int().min(1).max(2000),
	minSeats: z.number().int().min(1).max(2000),
	features: SubscriptionPlanFeaturesSchema,
	sortWeight: z.number().int().min(-9999).max(9999).default(0),
	enabled: z.boolean().default(true),
}).superRefine((value, context) => {
	if (value.minSeats > value.maxSeats) {
		context.addIssue({
			code: z.ZodIssueCode.custom,
			path: ["minSeats"],
			message: "最小席位不能大于最大席位",
		});
	}
});

export type UpsertTeamSubscriptionPlanInput = z.infer<typeof UpsertTeamSubscriptionPlanSchema>;

export const CancelTeamSubscriptionSchema = z.object({
	reason: z.string().optional(),
});
