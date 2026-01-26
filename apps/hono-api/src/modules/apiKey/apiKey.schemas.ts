import { z } from "@hono/zod-openapi";
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
	vendor: z.string().optional().openapi({
		description: "指定厂商/通道；可填 auto/gemini/sora2api/qwen 等（默认 auto，自动回退）。",
		example: "auto",
	}),
	kind: z.enum(["text_to_image", "image_edit"]).optional().openapi({
		description: "任务类型（默认 text_to_image）。",
		example: "text_to_image",
	}),
	prompt: z.string().min(1).openapi({
		description: "提示词（必填）。",
		example: "一张电影感海报，中文“TapCanvas”，高细节，干净背景",
	}),
	negativePrompt: z.string().optional().openapi({
		description: "反向提示词（可选；不同厂商可能忽略）。",
		example: "low quality, blurry, watermark",
	}),
	seed: z.number().optional().openapi({
		description: "随机种子（可选；不同厂商可能忽略）。",
		example: 42,
	}),
	width: z.number().optional().openapi({
		description:
			"宽度（像素）。目前仅 qwen 会严格使用；其他厂商可能仅用于推断横竖构图/选择 portrait/landscape。",
		example: 1328,
	}),
	height: z.number().optional().openapi({
		description:
			"高度（像素）。目前仅 qwen 会严格使用；其他厂商可能仅用于推断横竖构图/选择 portrait/landscape。",
		example: 1328,
	}),
	steps: z.number().optional().openapi({
		description: "采样步数（可选；不同厂商可能忽略）。",
		example: 30,
	}),
	cfgScale: z.number().optional().openapi({
		description: "提示词强度/CFG（可选；不同厂商可能忽略）。",
		example: 7,
	}),
	extras: z.record(z.any()).optional().openapi({
		description:
			"额外参数透传（常用：modelKey/aspectRatio/referenceImages/resolution）。不同厂商/通道支持不一致。",
		example: {
			modelKey: "nano-banana-pro",
			aspectRatio: "1:1",
		},
	}),
});

export type PublicDrawRequestDto = z.infer<typeof PublicDrawRequestSchema>;

export const PublicVideoRequestSchema = z.object({
	vendor: z.string().optional(),
	prompt: z.string().min(1),
	durationSeconds: z.number().optional(),
	extras: z.record(z.any()).optional(),
});

export type PublicVideoRequestDto = z.infer<typeof PublicVideoRequestSchema>;
