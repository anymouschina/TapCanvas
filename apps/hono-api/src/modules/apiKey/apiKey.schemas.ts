import { z } from "zod";
import { TaskKindSchema, TaskRequestSchema, TaskResultSchema } from "../task/task.schemas";

export const ApiKeySchema = z.object({
	id: z.string(),
	label: z.string(),
	keyPrefix: z.string(),
	allowedOrigins: z.array(z.string()),
	enabled: z.boolean(),
	lastUsedAt: z.string().nullable().optional(),
	createdAt: z.string(),
	updatedAt: z.string(),
});

export type ApiKeyDto = z.infer<typeof ApiKeySchema>;

export const CreateApiKeyRequestSchema = z.object({
	label: z.string().min(1).max(80),
	allowedOrigins: z.array(z.string()).default([]),
	enabled: z.boolean().optional(),
});

export const CreateApiKeyResponseSchema = z.object({
	key: z.string(),
	apiKey: ApiKeySchema,
});

export const UpdateApiKeyRequestSchema = z.object({
	label: z.string().min(1).max(80).optional(),
	allowedOrigins: z.array(z.string()).optional(),
	enabled: z.boolean().optional(),
});

export const PublicChatRequestSchema = z.object({
	vendor: z.string().optional(),
	prompt: z.string().min(1),
	modelKey: z.string().optional(),
	systemPrompt: z.string().optional(),
	temperature: z.number().min(0).max(2).optional(),
});

export type PublicChatRequestDto = z.infer<typeof PublicChatRequestSchema>;

export const PublicChatResponseSchema = z.object({
	id: z.string(),
	vendor: z.string(),
	text: z.string(),
});

export type PublicChatResponseDto = z.infer<typeof PublicChatResponseSchema>;

// ---- Public tasks (API key) ----

export const PublicRunTaskRequestSchema = z.object({
	vendor: z.string().optional(),
	request: TaskRequestSchema,
});

export type PublicRunTaskRequestDto = z.infer<typeof PublicRunTaskRequestSchema>;

export const PublicRunTaskResponseSchema = z.object({
	vendor: z.string(),
	result: TaskResultSchema,
});

export type PublicRunTaskResponseDto = z.infer<typeof PublicRunTaskResponseSchema>;

export const PublicFetchTaskResultRequestSchema = z.object({
	taskId: z.string().min(1),
	vendor: z.string().optional(),
	taskKind: TaskKindSchema.optional(),
	prompt: z.string().nullable().optional(),
});

export type PublicFetchTaskResultRequestDto = z.infer<
	typeof PublicFetchTaskResultRequestSchema
>;

export const PublicFetchTaskResultResponseSchema = z.object({
	vendor: z.string(),
	result: TaskResultSchema,
});

export type PublicFetchTaskResultResponseDto = z.infer<
	typeof PublicFetchTaskResultResponseSchema
>;

export const PublicDrawRequestSchema = z.object({
	vendor: z.string().optional(),
	kind: z.enum(["text_to_image", "image_edit"]).optional(),
	prompt: z.string().min(1),
	negativePrompt: z.string().optional(),
	seed: z.number().optional(),
	width: z.number().optional(),
	height: z.number().optional(),
	steps: z.number().optional(),
	cfgScale: z.number().optional(),
	extras: z.record(z.any()).optional(),
});

export type PublicDrawRequestDto = z.infer<typeof PublicDrawRequestSchema>;

export const PublicVideoRequestSchema = z.object({
	vendor: z.string().optional(),
	prompt: z.string().min(1),
	durationSeconds: z.number().optional(),
	extras: z.record(z.any()).optional(),
});

export type PublicVideoRequestDto = z.infer<typeof PublicVideoRequestSchema>;
