import { z } from "zod";

// ---- SSE event envelopes (loosely modeled after the oiioii logs) ----

export const SseWorkspaceOperationSchema = z.object({
	id: z.string(),
	name: z.string(),
	params: z.record(z.any()).optional(),
});

export type SseWorkspaceOperation = z.infer<typeof SseWorkspaceOperationSchema>;

export const SseMessageEventSchema = z.object({
	type: z.string(),
	data: z.any(),
});

export type SseMessageEvent = z.infer<typeof SseMessageEventSchema>;

export const SseDeltaEventSchema = z.object({
	op: z.string(),
	path: z.string(),
	value: z.any().optional(),
});

export type SseDeltaEvent = z.infer<typeof SseDeltaEventSchema>;

// ---- Chat submit/update request payloads ----

export const ChatConversationSchema = z.object({
	type: z.string().optional(),
	data: z.object({
		id: z.string(),
		status: z.string().optional(),
	}),
});

export const ChatSubmitMessageSchema = z.object({
	type: z.string(),
	data: z
		.object({
			content: z.string().optional(),
			id: z.string().optional(),
			additional_kwargs: z.record(z.any()).optional(),
			response_metadata: z.record(z.any()).optional(),
		})
		.passthrough(),
});

export const ChatSubmitMessagesRequestSchema = z.object({
	conversation: ChatConversationSchema,
	localizationOptions: z.record(z.any()).optional(),
	messages: z.array(ChatSubmitMessageSchema).default([]),
	tools: z.array(z.any()).optional(),
	workspace: z.record(z.any()).optional(),
});

export type ChatSubmitMessagesRequest = z.infer<
	typeof ChatSubmitMessagesRequestSchema
>;

export const ChatUpdateMessageRequestSchema = z.object({
	conversation: ChatConversationSchema,
	messageId: z.string(),
	kwargsUpdates: z.record(z.any()),
});

export type ChatUpdateMessageRequest = z.infer<
	typeof ChatUpdateMessageRequestSchema
>;

// ---- Chat REST responses used by apps/web ----

export type ChatSessionRowDto = {
	id: string; // sessionId (external)
	title: string | null;
	model: string | null;
	provider: string | null;
	lastMessage: string | null;
	createdAt: string;
	updatedAt: string;
};

export type ChatHistoryMessageRowDto = {
	id: string;
	role: string;
	content: string | null;
	metadata: any | null;
	createdAt: string;
};

