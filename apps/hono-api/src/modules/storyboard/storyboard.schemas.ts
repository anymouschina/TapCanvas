import { z } from "zod";

export const StoryboardAssetKindSchema = z.enum([
	"character",
	"scene",
	"prop",
	"style",
]);

export const StoryboardViewKindSchema = z.enum([
	"front",
	"back",
	"left",
	"right",
	"side",
]);

export const StoryboardJobStatusSchema = z.enum([
	"queued",
	"running",
	"succeeded",
	"failed",
]);

export const StoryboardRenderModeSchema = z.enum([
	"cost",
	"quality",
	"balanced",
]);

export const StoryboardPlanShotInputSchema = z
	.object({
		chunkIndex: z.number().int().min(0),
		shotIndex: z.number().int().min(0),
		sceneAssetId: z.string().min(1),
		characterAssetIds: z.array(z.string().min(1)).max(128).default([]),
		propAssetIds: z.array(z.string().min(1)).max(128).default([]),
		cameraPlan: z.record(z.unknown()),
		lightingPlan: z.record(z.unknown()),
		continuityTailFrameUrl: z.string().url().nullable().optional(),
	})
	.strict();

export const StoryboardPlanRequestSchema = z
	.object({
		projectId: z.string().min(1),
		shots: z.array(StoryboardPlanShotInputSchema).min(1).max(512),
	})
	.strict();

export const StoryboardShotSchema = z
	.object({
		id: z.string(),
		projectId: z.string(),
		chapterId: z.string().nullable().optional(),
		chunkIndex: z.number().int().min(0),
		shotIndex: z.number().int().min(0),
		title: z.string().optional(),
		summary: z.string().optional(),
		sceneAssetId: z.string(),
		characterAssetIds: z.array(z.string()),
		propAssetIds: z.array(z.string()),
		cameraPlan: z.record(z.unknown()),
		lightingPlan: z.record(z.unknown()),
		continuityTailFrameUrl: z.string().url().nullable(),
		status: StoryboardJobStatusSchema,
		createdAt: z.string(),
		updatedAt: z.string(),
	})
	.strict();

export const UpdateStoryboardShotSchema = z
	.object({
		title: z.string().trim().max(200).optional(),
		summary: z.string().trim().max(5000).optional(),
		status: StoryboardJobStatusSchema.optional(),
	})
	.strict()
	.refine((value) => Object.keys(value).length > 0, {
		message: "At least one field must be provided",
	});

export const StoryboardPlanResponseSchema = z
	.object({
		projectId: z.string(),
		shots: z.array(StoryboardShotSchema),
	})
	.strict();

export const StoryboardRenderRequestSchema = z
	.object({
		modelKey: z.string().min(1),
		mode: StoryboardRenderModeSchema.default("balanced"),
		params: z.record(z.unknown()).default({}),
		seed: z.number().int().nullable().optional(),
		outputVideoUrl: z.string().url().optional(),
		outputLastFrameUrl: z.string().url().optional(),
		costCents: z.number().int().nonnegative().optional(),
		latencyMs: z.number().int().nonnegative().optional(),
	})
	.strict();

export const StoryboardRerenderRequestSchema = z
	.object({
		basedOnJobId: z.string().min(1),
		overrideParams: z.record(z.unknown()).default({}),
		replaceInTimeline: z.boolean().default(false),
		outputVideoUrl: z.string().url().optional(),
		outputLastFrameUrl: z.string().url().optional(),
		costCents: z.number().int().nonnegative().optional(),
		latencyMs: z.number().int().nonnegative().optional(),
	})
	.strict();

export const StoryboardRenderJobSchema = z
	.object({
		id: z.string(),
		shotId: z.string(),
		projectId: z.string(),
		modelKey: z.string(),
		mode: StoryboardRenderModeSchema,
		params: z.record(z.unknown()),
		seed: z.number().int().nullable(),
		status: StoryboardJobStatusSchema,
		outputVideoUrl: z.string().url().nullable(),
		outputLastFrameUrl: z.string().url().nullable(),
		costCents: z.number().int().nullable(),
		latencyMs: z.number().int().nullable(),
		failCode: z.string().nullable(),
		failReason: z.string().nullable(),
		basedOnJobId: z.string().nullable(),
		createdAt: z.string(),
		updatedAt: z.string(),
	})
	.strict();

export const StoryboardTimelineReplaceRequestSchema = z
	.object({
		projectId: z.string().min(1),
		shotId: z.string().min(1),
		jobId: z.string().min(1),
		position: z.number().int().min(0).optional(),
		durationMs: z.number().int().min(0).optional(),
		audioTrackId: z.string().min(1).nullable().optional(),
	})
	.strict();

export const StoryboardTimelineReplaceResponseSchema = z
	.object({
		projectId: z.string(),
		shotId: z.string(),
		jobId: z.string(),
		timelineVersion: z.number().int().min(1),
	})
	.strict();

export const StoryboardMetricsSchema = z
	.object({
		projectId: z.string(),
		consistencyScore: z.number().min(0).max(1),
		rerenderSuccessRate: z.number().min(0).max(1),
		avgCostPerShot: z.number().min(0),
		p95LatencyMs: z.number().int().min(0),
	})
	.strict();

export const StoryboardDiagnosticLogSchema = z
	.object({
		id: z.string(),
		projectId: z.string(),
		shotId: z.string().nullable(),
		jobId: z.string().nullable(),
		stage: z.string(),
		level: z.enum(["info", "warn", "error"]),
		message: z.string(),
		summary: z.record(z.unknown()).nullable(),
		createdAt: z.string(),
	})
	.strict();

export const StoryboardDiagnosticListResponseSchema = z
	.object({
		projectId: z.string(),
		items: z.array(StoryboardDiagnosticLogSchema),
	})
	.strict();

export type StoryboardPlanRequest = z.infer<typeof StoryboardPlanRequestSchema>;
export type StoryboardRenderRequest = z.infer<typeof StoryboardRenderRequestSchema>;
export type StoryboardRerenderRequest = z.infer<typeof StoryboardRerenderRequestSchema>;
export type StoryboardTimelineReplaceRequest = z.infer<
	typeof StoryboardTimelineReplaceRequestSchema
>;
export type StoryboardPlanShotInput = z.infer<typeof StoryboardPlanShotInputSchema>;
export type StoryboardJobStatus = z.infer<typeof StoryboardJobStatusSchema>;
export type StoryboardRenderMode = z.infer<typeof StoryboardRenderModeSchema>;
export type StoryboardShotDto = z.infer<typeof StoryboardShotSchema>;
export type StoryboardRenderJobDto = z.infer<typeof StoryboardRenderJobSchema>;
export type StoryboardMetricsDto = z.infer<typeof StoryboardMetricsSchema>;
export type StoryboardDiagnosticLogDto = z.infer<typeof StoryboardDiagnosticLogSchema>;
