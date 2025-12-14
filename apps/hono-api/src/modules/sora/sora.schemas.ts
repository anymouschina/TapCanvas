import { z } from "zod";

export const UnwatermarkVideoRequestSchema = z.object({
	url: z.string().min(1),
});

export const UnwatermarkVideoResponseSchema = z.object({
	downloadUrl: z.string(),
	raw: z.unknown(),
});

export const CreateSoraVideoRequestSchema = z.object({
	tokenId: z.string().optional().nullable(),
	prompt: z.string(),
	orientation: z.enum(["portrait", "landscape", "square"]),
	size: z.string().optional(),
	n_frames: z.number().optional(),
	inpaintFileId: z.string().optional().nullable(),
	imageUrl: z.string().optional().nullable(),
	remixTargetId: z.string().optional().nullable(),
	operation: z.string().optional().nullable(),
	title: z.string().optional().nullable(),
	model: z.string().optional().nullable(),
});

// We keep response loosely typed and validate critical fields only
export const CreateSoraVideoResponseSchema = z
	.object({
		id: z.string().optional(),
		model: z.string().optional(),
		__usedTokenId: z.string().optional(),
		__switchedFromTokenIds: z.array(z.string()).optional(),
	})
	.catchall(z.unknown());

export const SoraDraftItemSchema = z.object({
	id: z.string(),
	kind: z.string(),
	title: z.string().nullable(),
	prompt: z.string().nullable(),
	width: z.number().nullable(),
	height: z.number().nullable(),
	generationType: z.string().nullable(),
	createdAt: z.number().nullable(),
	thumbnailUrl: z.string().nullable(),
	videoUrl: z.string().nullable(),
	platform: z.literal("sora"),
});

export type SoraDraftItemDto = z.infer<typeof SoraDraftItemSchema>;

export const SoraDraftListSchema = z.object({
	items: z.array(SoraDraftItemSchema),
	cursor: z.string().nullable(),
});

export const SoraVideoDraftResponseSchema = z.object({
	id: z.string(),
	title: z.string().nullable(),
	prompt: z.string().nullable(),
	thumbnailUrl: z.string().nullable(),
	videoUrl: z.string().nullable(),
	postId: z.string().nullable().optional(),
	status: z.string().nullable().optional(),
	progress: z.number().nullable().optional(),
	raw: z.unknown().optional(),
});

export const PublishSoraVideoRequestSchema = z.object({
	tokenId: z.string().optional().nullable(),
	taskId: z.string(),
	postText: z.string().optional().nullable(),
	generationId: z.string().optional().nullable(),
});

export const PublishSoraVideoResponseSchema = z.object({
	success: z.boolean(),
	postId: z.string().nullable().optional(),
	message: z.string().optional(),
});
