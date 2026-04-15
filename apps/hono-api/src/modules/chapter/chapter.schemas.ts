import { z } from "zod";
import { StoryboardJobStatusSchema } from "../storyboard/storyboard.schemas";

export const ChapterStatusSchema = z.enum([
	"draft",
	"planning",
	"producing",
	"review",
	"approved",
	"locked",
	"archived",
]);

export const ChapterSchema = z
	.object({
		id: z.string(),
		projectId: z.string(),
		index: z.number().int().min(1),
		title: z.string(),
		summary: z.string().optional(),
		status: ChapterStatusSchema,
		sortOrder: z.number().int(),
		coverAssetId: z.string().optional(),
		continuityContext: z.string().optional(),
		styleProfileOverride: z.string().optional(),
		legacyChunkIndex: z.number().int().nullable().optional(),
		sourceBookId: z.string().optional(),
		sourceBookChapter: z.number().int().min(1).nullable().optional(),
		lastWorkedAt: z.string().optional(),
		createdAt: z.string(),
		updatedAt: z.string(),
	})
	.strict();

export const ChapterListResponseSchema = z
	.object({
		projectId: z.string(),
		items: z.array(ChapterSchema),
	})
	.strict();

export const CreateChapterSchema = z
	.object({
		title: z.string().trim().min(1).max(200),
		summary: z.string().trim().max(5000).optional(),
	})
	.strict();

export const UpdateChapterSchema = z
	.object({
		title: z.string().trim().min(1).max(200).optional(),
		summary: z.string().trim().max(5000).optional(),
		status: ChapterStatusSchema.optional(),
		sortOrder: z.number().int().optional(),
		sourceBookId: z.string().trim().min(1).nullable().optional(),
		sourceBookChapter: z.number().int().min(1).nullable().optional(),
	})
	.strict()
	.refine((value) => Object.keys(value).length > 0, {
		message: "At least one field must be provided",
	});

export const ProjectDefaultEntrySchema = z
	.object({
		entryType: z.literal("chapter"),
		projectId: z.string(),
		chapterId: z.string(),
	})
	.strict();

export const ChapterWorkbenchShotSchema = z
	.object({
		id: z.string(),
		shotIndex: z.number().int().min(0),
		title: z.string().optional(),
		summary: z.string().optional(),
		status: z.string(),
		thumbnailUrl: z.string().optional(),
		sceneAssetId: z.string().optional(),
		characterAssetIds: z.array(z.string()),
		updatedAt: z.string(),
	})
	.strict();

export const CreateChapterShotSchema = z
	.object({
		title: z.string().trim().max(200).optional(),
	})
	.strict();

export const UpdateChapterShotSchema = z
	.object({
		title: z.string().trim().max(200).optional(),
		summary: z.string().trim().max(5000).optional(),
		status: StoryboardJobStatusSchema.optional(),
	})
	.strict()
	.refine((value) => Object.keys(value).length > 0, {
		message: "At least one field must be provided",
	});

export const MoveChapterShotSchema = z
	.object({
		direction: z.enum(["up", "down"]),
	})
	.strict();

export const ChapterWorkbenchSchema = z
	.object({
		project: z.object({
			id: z.string(),
			name: z.string(),
		}),
		chapter: ChapterSchema,
		shots: z.array(ChapterWorkbenchShotSchema),
		stats: z.object({
			totalShots: z.number().int().min(0),
			generatedShots: z.number().int().min(0),
			reviewShots: z.number().int().min(0),
			reworkShots: z.number().int().min(0),
		}),
		recentTasks: z.array(
			z.object({
				id: z.string(),
				kind: z.string(),
				status: z.string(),
				ownerType: z.enum(["chapter", "shot"]),
				ownerId: z.string(),
				updatedAt: z.string(),
			}),
		),
	})
	.strict();

export type ChapterDto = z.infer<typeof ChapterSchema>;
