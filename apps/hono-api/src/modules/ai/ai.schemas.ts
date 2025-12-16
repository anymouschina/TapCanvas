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
