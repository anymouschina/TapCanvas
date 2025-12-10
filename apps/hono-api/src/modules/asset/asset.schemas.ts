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

export const PublicAssetSchema = z.object({
	id: z.string(),
	name: z.string(),
	type: z.enum(["image", "video"]),
	url: z.string(),
	thumbnailUrl: z.string().nullable().optional(),
	prompt: z.string().nullable().optional(),
	vendor: z.string().nullable().optional(),
	modelKey: z.string().nullable().optional(),
	createdAt: z.string(),
	ownerLogin: z.string().nullable().optional(),
	ownerName: z.string().nullable().optional(),
	projectName: z.string().nullable().optional(),
});

export type PublicAssetDto = z.infer<typeof PublicAssetSchema>;

export const CreateAssetSchema = z.object({
	name: z.string().min(1),
	data: z.unknown(),
});

export const RenameAssetSchema = z.object({
	name: z.string().min(1),
});
