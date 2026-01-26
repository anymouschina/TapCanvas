import { z } from "zod";

export const BillingModelKindSchema = z.enum(["text", "image", "video"]);

export const BillingModelOptionSchema = z.object({
	modelKey: z.string(),
	labelZh: z.string(),
	kind: BillingModelKindSchema,
	vendor: z.string().optional(),
});

export type BillingModelOptionDto = z.infer<typeof BillingModelOptionSchema>;

export const ModelCreditCostSchema = z.object({
	modelKey: z.string(),
	cost: z.number(),
	enabled: z.boolean(),
	createdAt: z.string(),
	updatedAt: z.string(),
});

export type ModelCreditCostDto = z.infer<typeof ModelCreditCostSchema>;

export const UpsertModelCreditCostRequestSchema = z.object({
	modelKey: z.string(),
	cost: z.number(),
	enabled: z.boolean().optional(),
});

export type UpsertModelCreditCostRequestDto = z.infer<
	typeof UpsertModelCreditCostRequestSchema
>;

