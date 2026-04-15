import { z } from "zod";

export const AdminProjectSchema = z.object({
	id: z.string(),
	name: z.string(),
	isPublic: z.boolean(),
	ownerId: z.string().nullable(),
	owner: z.string().nullable(),
	ownerName: z.string().nullable(),
	flowCount: z.number().int().nonnegative(),
	createdAt: z.string(),
	updatedAt: z.string(),
	templateTitle: z.string(),
	templateDescription: z.string().nullable(),
	templateCoverUrl: z.string().nullable(),
});
export type AdminProjectDto = z.infer<typeof AdminProjectSchema>;

export const ListAdminProjectsQuerySchema = z.object({
	q: z.string().max(128).optional(),
	ownerId: z.string().max(128).optional(),
	isPublic: z
		.union([
			z.literal("1"),
			z.literal("true"),
			z.literal("yes"),
			z.literal("on"),
			z.literal("0"),
			z.literal("false"),
			z.literal("no"),
			z.literal("off"),
		])
		.optional(),
	limit: z.coerce.number().int().min(1).max(1000).optional(),
});

export const AdminUpdateProjectRequestSchema = z.object({
	name: z.string().trim().min(1).max(200).optional(),
	isPublic: z.boolean().optional(),
	templateTitle: z.string().trim().max(200).optional(),
	templateDescription: z.string().trim().max(1000).optional(),
	templateCoverUrl: z.string().trim().max(2000).optional(),
});
