import { z } from "zod";

export const ServerAssetSchema = z.object({
	id: z.string(),
	name: z.string(),
	data: z.unknown(),
	createdAt: z.string(),
	updatedAt: z.string(),
	userId: z.string(),
	projectId: z.string().nullable().optional(),
});

export type ServerAssetDto = z.infer<typeof ServerAssetSchema>;

export const CreateAssetSchema = z.object({
	name: z.string().min(1),
	data: z.unknown(),
});

export const RenameAssetSchema = z.object({
	name: z.string().min(1),
});

