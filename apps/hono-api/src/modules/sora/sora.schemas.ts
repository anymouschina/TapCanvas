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

// --- Comfly Sora official format: create character from video ---

export const ComflyCreateCharacterRequestSchema = z
	.object({
		url: z.string().trim().optional(),
		from_task: z.string().trim().optional(),
		timestamps: z.string().trim().min(1),
	})
		.superRefine((val, ctx) => {
			const hasUrl = typeof val.url === "string" && val.url.trim().length > 0;
			const hasTask =
				typeof val.from_task === "string" && val.from_task.trim().length > 0;
			if (!hasUrl && !hasTask) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: "url 或 from_task 必须提供一个",
				path: ["url"],
			});
		}
			if (hasUrl && hasTask) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: "url 与 from_task 只能二选一",
					path: ["from_task"],
				});
			}
			if (hasUrl) {
				const url = val.url!.trim();
				if (!/^https?:\/\//i.test(url)) {
					ctx.addIssue({
						code: z.ZodIssueCode.custom,
						message: "url 必须是 http(s) 链接",
						path: ["url"],
					});
				}
			}
			if (hasTask) {
				const task = val.from_task!.trim();
				if (!task.startsWith("video_")) {
					ctx.addIssue({
						code: z.ZodIssueCode.custom,
						message: "from_task 必须是 Sora 视频任务 ID（以 video_ 开头）",
						path: ["from_task"],
					});
				}
			}

			const [startRaw, endRaw] = (val.timestamps || "").split(",");
			const start = Number(startRaw);
			const end = Number(endRaw);
		if (!Number.isFinite(start) || !Number.isFinite(end)) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: "timestamps 格式错误，应为 'start,end'（单位秒）",
				path: ["timestamps"],
			});
			return;
		}
		if (end <= start) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: "timestamps 结束时间必须大于起始时间",
				path: ["timestamps"],
			});
			return;
		}
		const span = end - start;
		if (span < 1 - 1e-6) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: "timestamps 范围差值最小 1 秒",
				path: ["timestamps"],
			});
		}
		if (span > 3 + 1e-6) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: "timestamps 范围差值最大 3 秒",
				path: ["timestamps"],
			});
		}
	});

export const ComflyCreateCharacterResponseSchema = z.object({
	id: z.string(),
	username: z.string(),
	permalink: z.string(),
	profile_picture_url: z.string(),
});
