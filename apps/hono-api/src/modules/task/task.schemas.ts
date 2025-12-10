import { z } from "zod";

export const TaskKindSchema = z.enum([
	"chat",
	"prompt_refine",
	"text_to_image",
	"image_to_prompt",
	"image_to_video",
	"text_to_video",
	"image_edit",
]);

export type TaskKind = z.infer<typeof TaskKindSchema>;

export const TaskStatusSchema = z.enum([
	"queued",
	"running",
	"succeeded",
	"failed",
]);

export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const TaskAssetSchema = z.object({
	type: z.enum(["image", "video"]),
	url: z.string(),
	thumbnailUrl: z.string().nullable().optional(),
});

export type TaskAssetDto = z.infer<typeof TaskAssetSchema>;

export const TaskResultSchema = z.object({
	id: z.string(),
	kind: TaskKindSchema,
	status: TaskStatusSchema,
	assets: z.array(TaskAssetSchema),
	raw: z.unknown(),
});

export type TaskResultDto = z.infer<typeof TaskResultSchema>;

export const TaskRequestSchema = z.object({
	kind: TaskKindSchema,
	prompt: z.string(),
	negativePrompt: z.string().optional(),
	seed: z.number().optional(),
	width: z.number().optional(),
	height: z.number().optional(),
	steps: z.number().optional(),
	cfgScale: z.number().optional(),
	extras: z.record(z.any()).optional(),
});

export type TaskRequestDto = z.infer<typeof TaskRequestSchema>;

export const TaskProgressSnapshotSchema = z.object({
	taskId: z.string().optional(),
	nodeId: z.string().optional(),
	nodeKind: z.string().optional(),
	taskKind: TaskKindSchema.optional(),
	vendor: z.string().optional(),
	status: TaskStatusSchema,
	progress: z.number().optional(),
	message: z.string().optional(),
	assets: z.array(TaskAssetSchema).optional(),
	raw: z.unknown().optional(),
	timestamp: z.number().optional(),
});

export type TaskProgressSnapshotDto = z.infer<
	typeof TaskProgressSnapshotSchema
>;

export const RunTaskByVendorSchema = z.object({
	vendor: z.string(),
	request: TaskRequestSchema,
});

export const RunTaskByProfileSchema = z.object({
	profileId: z.string(),
	request: TaskRequestSchema,
});

export const RunTaskRequestSchema = z.union([
	RunTaskByVendorSchema,
	RunTaskByProfileSchema,
]);

export const FetchTaskResultRequestSchema = z.object({
	taskId: z.string(),
});

