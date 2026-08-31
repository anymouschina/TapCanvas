import { z } from "zod";

export const ProjectSchema = z.object({
	id: z.string(),
	name: z.string(),
	createdAt: z.string(),
	updatedAt: z.string(),
	isPublic: z.boolean().optional(),
	owner: z.string().optional(),
	ownerName: z.string().optional(),
	cloneCount: z.number().int().nonnegative().optional(),
	sortWeight: z.number().int().optional(),
	templateTitle: z.string().optional(),
	templateDescription: z.string().optional(),
	templateCoverUrl: z.string().optional(),
	teamShared: z.boolean().optional(),
	teamId: z.string().optional(),
	access: z.enum(["owner", "team_edit"]).optional(),
	projectKind: z.enum(["creative", "ai_workflow"]).default("creative"),
});

export type ProjectDto = z.infer<typeof ProjectSchema>;

export const UpsertProjectSchema = z.object({
	id: z.string().optional(),
	name: z.string().min(1),
	teamId: z.string().optional(),
});

export const BootstrapProjectFlowSchema = z.object({
	name: z.string().min(1),
	teamId: z.string().optional(),
	flow: z.object({
		name: z.string().min(1),
		data: z.unknown(),
	}),
});

export const TogglePublicSchema = z.object({
	isPublic: z.boolean(),
});

export const UpdateProjectTemplateSchema = z.object({
	templateTitle: z.string().trim().min(1).max(200),
	templateDescription: z.string().trim().max(1000).optional(),
	templateCoverUrl: z.string().trim().max(2000).optional(),
	isPublic: z.boolean(),
	sortWeight: z.number().int().min(-9999).max(9999).optional(),
});

export const CloneProjectSchema = z.object({
	name: z.string().optional(),
});
