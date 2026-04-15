import { z } from "zod";

export const MaterialKindSchema = z.enum([
	"character",
	"scene",
	"prop",
	"style",
]);

export const MaterialAssetSchema = z
	.object({
		id: z.string(),
		projectId: z.string(),
		kind: MaterialKindSchema,
		name: z.string(),
		currentVersion: z.number().int().min(1),
		latestVersion: z.lazy(() => MaterialAssetVersionSchema).nullable().optional(),
		createdAt: z.string(),
		updatedAt: z.string(),
	})
	.strict();

export const MaterialAssetVersionSchema = z
	.object({
		id: z.string(),
		assetId: z.string(),
		projectId: z.string(),
		version: z.number().int().min(1),
		data: z.record(z.unknown()),
		note: z.string().nullable(),
		createdAt: z.string(),
	})
	.strict();

export const MaterialShotRefSchema = z
	.object({
		id: z.string(),
		projectId: z.string(),
		shotId: z.string(),
		assetId: z.string(),
		assetVersion: z.number().int().min(1),
		createdAt: z.string(),
		updatedAt: z.string(),
	})
	.strict();

export const CreateMaterialAssetRequestSchema = z
	.object({
		projectId: z.string().min(1),
		kind: MaterialKindSchema,
		name: z.string().min(1).max(200),
		initialData: z.record(z.unknown()),
		note: z.string().max(500).optional(),
	})
	.strict();

export const CreateMaterialVersionRequestSchema = z
	.object({
		data: z.record(z.unknown()),
		note: z.string().max(500).optional(),
	})
	.strict();

export const UpsertShotMaterialRefsRequestSchema = z
	.object({
		projectId: z.string().min(1),
		shotId: z.string().min(1),
		refs: z
			.array(
				z
					.object({
						assetId: z.string().min(1),
						assetVersion: z.number().int().min(1),
					})
					.strict(),
			)
			.max(128),
	})
	.strict();

export const MaterialImpactItemSchema = z
	.object({
		shotId: z.string(),
		assetId: z.string(),
		boundVersion: z.number().int().min(1),
		currentVersion: z.number().int().min(1),
		isOutdated: z.boolean(),
	})
	.strict();

export const MaterialImpactResponseSchema = z
	.object({
		projectId: z.string(),
		items: z.array(MaterialImpactItemSchema),
	})
	.strict();

export type MaterialAssetDto = z.infer<typeof MaterialAssetSchema>;
export type MaterialAssetVersionDto = z.infer<typeof MaterialAssetVersionSchema>;
export type MaterialShotRefDto = z.infer<typeof MaterialShotRefSchema>;
export type CreateMaterialAssetRequest = z.infer<
	typeof CreateMaterialAssetRequestSchema
>;
export type CreateMaterialVersionRequest = z.infer<
	typeof CreateMaterialVersionRequestSchema
>;
export type UpsertShotMaterialRefsRequest = z.infer<
	typeof UpsertShotMaterialRefsRequestSchema
>;
export type MaterialImpactResponseDto = z.infer<typeof MaterialImpactResponseSchema>;
