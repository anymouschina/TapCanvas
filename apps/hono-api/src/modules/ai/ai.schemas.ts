import { z } from "zod";

export const PromptSampleNodeKindSchema = z.enum([
	"image",
	"composeVideo",
	"storyboard",
]);

export const PromptSampleSchema = z.object({
	id: z.string(),
	scene: z.string(),
	commandType: z.string(),
	title: z.string(),
	nodeKind: PromptSampleNodeKindSchema,
	prompt: z.string(),
	description: z.string().optional(),
	inputHint: z.string().optional(),
	outputNote: z.string().optional(),
	keywords: z.array(z.string()),
	source: z.enum(["official", "custom"]).optional(),
});

export type PromptSampleDto = z.infer<typeof PromptSampleSchema>;

export const PromptSampleInputSchema = z.object({
	scene: z.string(),
	commandType: z.string(),
	title: z.string(),
	nodeKind: PromptSampleNodeKindSchema,
	prompt: z.string(),
	description: z.string().optional(),
	inputHint: z.string().optional(),
	outputNote: z.string().optional(),
	keywords: z.array(z.string()).optional(),
});

export type PromptSampleInput = z.infer<typeof PromptSampleInputSchema>;

export const PromptSampleParseRequestSchema = z.object({
	rawPrompt: z.string(),
	nodeKind: PromptSampleNodeKindSchema.optional(),
});

export const LlmNodePresetTypeSchema = z.enum(["text", "image", "video"]);

export const LlmNodePresetSchema = z.object({
	id: z.string(),
	title: z.string(),
	type: LlmNodePresetTypeSchema,
	prompt: z.string(),
	description: z.string().optional(),
	scope: z.enum(["base", "user"]),
	enabled: z.boolean().optional(),
	sortOrder: z.number().int().nullable().optional(),
	createdAt: z.string(),
	updatedAt: z.string(),
});

export type LlmNodePresetDto = z.infer<typeof LlmNodePresetSchema>;

export const CreateLlmNodePresetRequestSchema = z.object({
	title: z.string(),
	type: LlmNodePresetTypeSchema,
	prompt: z.string(),
	description: z.string().optional(),
});

export type CreateLlmNodePresetRequestDto = z.infer<
	typeof CreateLlmNodePresetRequestSchema
>;

export const UpsertAdminLlmNodePresetRequestSchema = z
	.object({
		id: z.string().optional(),
		title: z.string(),
		type: LlmNodePresetTypeSchema,
		prompt: z.string(),
		description: z.string().nullable().optional(),
		enabled: z.boolean().optional(),
		sortOrder: z.number().int().nullable().optional(),
	})
	.strict();

export type UpsertAdminLlmNodePresetRequestDto = z.infer<
	typeof UpsertAdminLlmNodePresetRequestSchema
>;
