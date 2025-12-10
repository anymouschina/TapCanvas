import { z } from "zod";

export const ProjectSchema = z.object({
	id: z.string(),
	name: z.string(),
	createdAt: z.string(),
	updatedAt: z.string(),
	isPublic: z.boolean().optional(),
	owner: z.string().optional(),
	ownerName: z.string().optional(),
});

export type ProjectDto = z.infer<typeof ProjectSchema>;

export const UpsertProjectSchema = z.object({
	id: z.string().optional(),
	name: z.string().min(1),
});

export const TogglePublicSchema = z.object({
	isPublic: z.boolean(),
});

export const CloneProjectSchema = z.object({
	name: z.string().optional(),
});

