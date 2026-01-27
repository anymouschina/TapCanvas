import { z } from "zod";
import { TaskKindSchema } from "../task/task.schemas";

export const ModelCatalogVendorAuthTypeSchema = z.enum([
	"none",
	"bearer",
	"x-api-key",
	"query",
]);

export type ModelCatalogVendorAuthType = z.infer<
	typeof ModelCatalogVendorAuthTypeSchema
>;

export const ModelCatalogVendorSchema = z.object({
	key: z.string(),
	name: z.string(),
	enabled: z.boolean(),
	hasApiKey: z.boolean().optional(),
	baseUrlHint: z.string().nullable().optional(),
	authType: ModelCatalogVendorAuthTypeSchema.optional(),
	authHeader: z.string().nullable().optional(),
	authQueryParam: z.string().nullable().optional(),
	meta: z.unknown().optional(),
	createdAt: z.string(),
	updatedAt: z.string(),
});

export type ModelCatalogVendorDto = z.infer<typeof ModelCatalogVendorSchema>;

export const UpsertModelCatalogVendorSchema = z.object({
	key: z.string().min(1),
	name: z.string().min(1),
	enabled: z.boolean().optional(),
	baseUrlHint: z.string().nullable().optional(),
	authType: ModelCatalogVendorAuthTypeSchema.optional(),
	authHeader: z.string().nullable().optional(),
	authQueryParam: z.string().nullable().optional(),
	meta: z.unknown().optional(),
});

export const UpsertModelCatalogVendorApiKeySchema = z.object({
	apiKey: z.string().min(1),
	enabled: z.boolean().optional(),
});

export const ModelCatalogVendorApiKeyStatusSchema = z.object({
	vendorKey: z.string(),
	hasApiKey: z.boolean(),
	enabled: z.boolean(),
	createdAt: z.string(),
	updatedAt: z.string(),
});

export type ModelCatalogVendorApiKeyStatusDto = z.infer<
	typeof ModelCatalogVendorApiKeyStatusSchema
>;

export const BillingModelKindSchema = z.enum(["text", "image", "video"]);

export type BillingModelKind = z.infer<typeof BillingModelKindSchema>;

export const ModelCatalogModelSchema = z.object({
	modelKey: z.string(),
	vendorKey: z.string(),
	modelAlias: z.string().nullable().optional(),
	labelZh: z.string(),
	kind: BillingModelKindSchema,
	enabled: z.boolean(),
	meta: z.unknown().optional(),
	createdAt: z.string(),
	updatedAt: z.string(),
});

export type ModelCatalogModelDto = z.infer<typeof ModelCatalogModelSchema>;

export const UpsertModelCatalogModelSchema = z.object({
	modelKey: z.string().min(1),
	vendorKey: z.string().min(1),
	modelAlias: z.string().nullable().optional(),
	labelZh: z.string().min(1),
	kind: BillingModelKindSchema,
	enabled: z.boolean().optional(),
	meta: z.unknown().optional(),
});

export const ModelCatalogMappingSchema = z.object({
	id: z.string(),
	vendorKey: z.string(),
	taskKind: TaskKindSchema,
	name: z.string(),
	enabled: z.boolean(),
	requestMapping: z.unknown().optional(),
	responseMapping: z.unknown().optional(),
	createdAt: z.string(),
	updatedAt: z.string(),
});

export type ModelCatalogMappingDto = z.infer<typeof ModelCatalogMappingSchema>;

export const UpsertModelCatalogMappingSchema = z.object({
	id: z.string().optional(),
	vendorKey: z.string().min(1),
	taskKind: TaskKindSchema,
	name: z.string().min(1),
	enabled: z.boolean().optional(),
	requestMapping: z.unknown().optional(),
	responseMapping: z.unknown().optional(),
});

// ---- Import / Export ----

export const ModelCatalogImportVendorSchema = z.object({
	vendor: UpsertModelCatalogVendorSchema,
	apiKey: UpsertModelCatalogVendorApiKeySchema.optional(),
	models: z
		.array(
			UpsertModelCatalogModelSchema.extend({
				// vendorKey inside bundle is optional (defaults to bundle.vendor.key)
				vendorKey: z.string().optional(),
			}),
		)
		.default([]),
	mappings: z
		.array(
			z.object({
				taskKind: TaskKindSchema,
				name: z.string().min(1),
				enabled: z.boolean().optional(),
				requestMapping: z.unknown().optional(),
				responseMapping: z.unknown().optional(),
			}),
		)
		.default([]),
});

export const ModelCatalogImportPackageSchema = z.object({
	version: z.string().min(1),
	exportedAt: z.string().optional(),
	vendors: z.array(ModelCatalogImportVendorSchema).min(1),
});

export type ModelCatalogImportPackage = z.infer<
	typeof ModelCatalogImportPackageSchema
>;

export const ModelCatalogImportResultSchema = z.object({
	imported: z.object({
		vendors: z.number(),
		models: z.number(),
		mappings: z.number(),
	}),
	errors: z.array(z.string()).default([]),
});

export type ModelCatalogImportResult = z.infer<
	typeof ModelCatalogImportResultSchema
>;
