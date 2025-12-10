import { z } from "zod";

export const FlowSchema = z.object({
	id: z.string(),
	name: z.string(),
	data: z.unknown(),
	createdAt: z.string(),
	updatedAt: z.string(),
});

export type FlowDto = z.infer<typeof FlowSchema>;

export const UpsertFlowSchema = z.object({
	id: z.string().optional(),
	name: z.string().min(1),
	data: z.unknown(),
	projectId: z.string().nullable().optional(),
});

export const FlowVersionSchema = z.object({
	id: z.string(),
	name: z.string(),
	createdAt: z.string(),
});

