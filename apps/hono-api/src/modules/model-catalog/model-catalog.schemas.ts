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

export const VideoModelOrientationSchema = z.enum(["portrait", "landscape"]);

export const ModelCatalogVideoDurationOptionSchema = z
	.object({
		value: z.number().positive(),
		label: z.string().min(1),
		priceLabel: z.string().min(1).optional(),
	})
	.passthrough();

export const ModelCatalogVideoSizeOptionSchema = z
	.object({
		value: z.string().min(1),
		label: z.string().min(1),
		orientation: VideoModelOrientationSchema.optional(),
		aspectRatio: z.string().min(1).optional(),
		priceLabel: z.string().min(1).optional(),
	})
	.passthrough();

export const ModelCatalogVideoOrientationOptionSchema = z
	.object({
		value: VideoModelOrientationSchema,
		label: z.string().min(1),
		size: z.string().min(1).optional(),
		aspectRatio: z.string().min(1).optional(),
	})
	.passthrough();

export const ModelCatalogVideoResolutionOptionSchema = z
	.object({
		value: z.string().min(1),
		label: z.string().min(1),
		priceLabel: z.string().min(1).optional(),
	})
	.passthrough();

export const ModelCatalogVideoOptionsSchema = z
	.object({
		defaultDurationSeconds: z.number().positive().optional(),
		defaultSize: z.string().min(1).optional(),
		defaultResolution: z.string().min(1).optional(),
		defaultOrientation: VideoModelOrientationSchema.optional(),
		durationOptions: z.array(ModelCatalogVideoDurationOptionSchema).default([]),
		sizeOptions: z.array(ModelCatalogVideoSizeOptionSchema).default([]),
		resolutionOptions: z
			.array(ModelCatalogVideoResolutionOptionSchema)
			.default([]),
		orientationOptions: z
			.array(ModelCatalogVideoOrientationOptionSchema)
			.default([]),
	})
	.passthrough();

export type ModelCatalogVideoDurationOption = z.infer<
	typeof ModelCatalogVideoDurationOptionSchema
>;
export type ModelCatalogVideoSizeOption = z.infer<
	typeof ModelCatalogVideoSizeOptionSchema
>;
export type ModelCatalogVideoOrientationOption = z.infer<
	typeof ModelCatalogVideoOrientationOptionSchema
>;
export type ModelCatalogVideoResolutionOption = z.infer<
	typeof ModelCatalogVideoResolutionOptionSchema
>;
export type ModelCatalogVideoOptions = z.infer<
	typeof ModelCatalogVideoOptionsSchema
>;

export const ModelCatalogImageOptionsSchema = z
	.object({
		defaultAspectRatio: z.string().min(1).optional(),
		defaultImageSize: z.string().min(1).optional(),
		aspectRatioOptions: z.array(z.string().min(1)).default([]),
		imageSizeOptions: z
			.array(
				z.union([
					z.string().min(1),
					z
						.object({
							value: z.string().min(1),
							label: z.string().min(1),
							priceLabel: z.string().min(1).optional(),
						})
						.passthrough(),
				]),
			)
			.default([]),
		resolutionOptions: z.array(z.string().min(1)).default([]),
		supportsReferenceImages: z.boolean().optional(),
		supportsTextToImage: z.boolean().optional(),
		supportsImageToImage: z.boolean().optional(),
	})
	.passthrough();

export type ModelCatalogImageOptions = z.infer<
	typeof ModelCatalogImageOptionsSchema
>;

export const ModelCatalogModelSchema = z.object({
	modelKey: z.string(),
	vendorKey: z.string(),
	modelAlias: z.string().nullable().optional(),
	labelZh: z.string(),
	kind: BillingModelKindSchema,
	enabled: z.boolean(),
	meta: z.unknown().optional(),
	pricing: z
		.object({
			cost: z.number().int().nonnegative(),
			enabled: z.boolean(),
			createdAt: z.string().optional(),
			updatedAt: z.string().optional(),
			specCosts: z
				.array(
					z.object({
						specKey: z.string().min(1),
						cost: z.number().int().nonnegative(),
						enabled: z.boolean(),
						createdAt: z.string().optional(),
						updatedAt: z.string().optional(),
					}),
				)
				.default([]),
		})
		.optional(),
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
	pricing: z
		.object({
			cost: z.number().int().nonnegative(),
			enabled: z.boolean().optional(),
			specCosts: z
				.array(
					z.object({
						specKey: z
							.string()
							.trim()
							.min(1)
							.max(120)
							.regex(/^[a-z0-9:_-]+$/i, "specKey format invalid"),
						cost: z.number().int().nonnegative(),
						enabled: z.boolean().optional(),
					}),
				)
				.default([]),
		})
		.optional(),
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
				requestProfile: z.unknown().optional(),
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
