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

// ---- Chat & Tool Events (Worker AI assistant) ----

export const ChatStreamRequestSchema = z.object({
	model: z.string().min(1),
	messages: z.array(z.any()),
	context: z.any().optional(),
	temperature: z.number().optional(),
	apiKey: z.string().optional(),
	baseUrl: z.string().optional(),
	provider: z.string().optional(),
	tools: z.any().optional(),
	clientToolExecution: z.boolean().optional(),
	toolChoice: z.any().optional(),
	maxToolRoundtrips: z.number().optional(),
	maxTokens: z.number().optional(),
	headers: z.record(z.string()).optional(),
	intelligentMode: z.boolean().optional(),
	enableThinking: z.boolean().optional(),
	enableWebSearch: z.boolean().optional(),
	sessionId: z.string().optional(),
});

export type ChatStreamRequest = z.infer<typeof ChatStreamRequestSchema>;

export const ToolResultSchema = z.object({
	toolCallId: z.string(),
	toolName: z.string(),
	output: z.any().optional(),
	errorText: z.string().optional(),
});

export type ToolResultPayload = z.infer<typeof ToolResultSchema>;

export const ToolEventMessageSchema = z.object({
	type: z.enum(["tool-call", "tool-result"]),
	toolCallId: z.string(),
	toolName: z.string(),
	input: z.record(z.any()).optional(),
	output: z.any().optional(),
	errorText: z.string().optional(),
});

export type ToolEventMessageDto = z.infer<typeof ToolEventMessageSchema>;
