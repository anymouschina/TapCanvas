import { z } from "zod";

export const TaskKindSchema = z.enum([
	"chat",
	"prompt_refine",
	"text_to_image",
	"image_to_prompt",
	"image_to_video",
	"text_to_video",
	"image_edit",
	"image_to_3d",
	"video_enhance",
	"video_edit",
	"image_remove_bg",
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
	type: z.enum(["image", "video", "audio", "file"]),
	url: z.string(),
	fileName: z.string().nullable().optional(),
	mimeType: z.string().nullable().optional(),
	thumbnailUrl: z.string().nullable().optional(),
	// 内联微 poster（~320px base64 data URI，≤12KB）：hosting 时从视频首帧现切，
	// 随节点数据持久化供画布首绘零请求。仅新托管产出，best-effort。
	posterInline: z.string().nullable().optional(),
	assetId: z.string().nullable().optional(),
	assetRefId: z.string().nullable().optional(),
	assetName: z.string().nullable().optional(),
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

export const TaskInboxStatusSchema = z.enum([
	"queued",
	"running",
	"succeeded",
	"failed",
]);

export const TaskInboxItemSchema = z.object({
	taskId: z.string().min(1),
	vendor: z.string().min(1),
	kind: z.string().min(1),
	status: TaskInboxStatusSchema,
	assetCount: z.number().int().min(0),
	assets: z.array(TaskAssetSchema),
	prompt: z.string().nullable(),
	errorMessage: z.string().nullable(),
	nodeId: z.string().nullable(),
	chapterId: z.string().nullable(),
	createdAt: z.string().datetime({ offset: true }),
	updatedAt: z.string().datetime({ offset: true }),
	completedAt: z.string().datetime({ offset: true }).nullable(),
	notificationId: z.string().nullable(),
	readAt: z.string().datetime({ offset: true }).nullable(),
});

export const TaskInboxQuerySchema = z.object({
	limit: z.coerce.number().int().min(1).max(100).default(50),
	cursor: z.string().trim().min(1).max(500).optional(),
});

export const TaskInboxResponseSchema = z.object({
	items: z.array(TaskInboxItemSchema),
	nextCursor: z.string().nullable(),
	unreadCount: z.number().int().min(0),
});

export type TaskInboxItemDto = z.infer<typeof TaskInboxItemSchema>;
export type TaskInboxResponseDto = z.infer<typeof TaskInboxResponseSchema>;

export const RunTaskByVendorSchema = z.object({
	vendor: z.string().optional(),
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
	prompt: z.string().nullable().optional(),
	taskKind: TaskKindSchema.optional(),
});

// ---- Vendor API call logs (per-user generation history) ----

export const VendorCallLogStatusSchema = z.enum([
	"running",
	"succeeded",
	"failed",
]);

export type VendorCallLogStatus = z.infer<typeof VendorCallLogStatusSchema>;

export const VendorCallLogSchema = z.object({
	vendor: z.string(),
	taskId: z.string(),
	userId: z.string(),
	userLogin: z.string().nullable().optional(),
	userName: z.string().nullable().optional(),
	taskKind: z.string().nullable().optional(),
	status: VendorCallLogStatusSchema,
	startedAt: z.string().nullable().optional(),
	finishedAt: z.string().nullable().optional(),
	durationMs: z.number().nullable().optional(),
	errorMessage: z.string().nullable().optional(),
	requestPayload: z.string().nullable().optional(),
	upstreamResponse: z.string().nullable().optional(),
	createdAt: z.string(),
	updatedAt: z.string(),
});

export type VendorCallLogDto = z.infer<typeof VendorCallLogSchema>;

export const VendorCallLogListQuerySchema = z
	.object({
		page: z.coerce.number().int().min(1).default(1),
		pageSize: z.coerce.number().int().min(1).max(100).default(20),
		vendor: z.string().trim().min(1).max(200).optional(),
		userId: z.string().trim().min(1).max(200).optional(),
		taskId: z.string().trim().min(1).max(500).optional(),
		taskKind: z.string().trim().min(1).max(100).optional(),
		status: VendorCallLogStatusSchema.optional(),
		createdFrom: z.string().datetime({ offset: true }).optional(),
		createdTo: z.string().datetime({ offset: true }).optional(),
	})
	.strict();

export const VendorCallLogListResponseSchema = z.object({
	items: z.array(VendorCallLogSchema),
	page: z.number().int().min(1),
	pageSize: z.number().int().min(1),
	total: z.number().int().min(0),
	totalPages: z.number().int().min(0),
});

export type VendorCallLogListResponseDto = z.infer<
	typeof VendorCallLogListResponseSchema
>;
