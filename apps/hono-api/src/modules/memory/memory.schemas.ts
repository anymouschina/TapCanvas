import { z } from "zod";
import { PUBLIC_CHAT_SESSION_KEY_MAX_LENGTH } from "../apiKey/public-chat-session.constants";

export const MEMORY_SCOPE_TYPES = [
	"user",
	"project",
	"book",
	"chapter",
	"session",
	"task",
] as const;

export const MEMORY_ENTRY_TYPES = [
	"preference",
	"domain_fact",
	"artifact_ref",
	"summary",
] as const;

export const MEMORY_STATUS_TYPES = ["active", "archived", "superseded"] as const;

export const MemoryScopeTypeSchema = z.enum(MEMORY_SCOPE_TYPES);
export const MemoryEntryTypeSchema = z.enum(MEMORY_ENTRY_TYPES);
export const MemoryStatusSchema = z.enum(MEMORY_STATUS_TYPES);

export const MemoryLinkSchema = z.object({
	targetType: z.enum(["project", "book", "chapter", "session", "task", "asset"]),
	targetId: z.string().min(1).max(120),
	relation: z.enum(["about", "derived_from", "depends_on", "references", "produced"]),
});

export const MemoryWriteEntrySchema = z.object({
	scopeType: MemoryScopeTypeSchema,
	scopeId: z.string().min(1).max(120),
	memoryType: MemoryEntryTypeSchema,
	title: z.string().max(200).optional(),
	summaryText: z.string().max(2000).optional(),
	content: z.record(z.string(), z.unknown()),
	sourceKind: z.enum(["user_input", "agent_output", "system_extract", "task_result", "manual"]),
	sourceId: z.string().max(120).optional(),
	importance: z.number().min(0).max(1).optional(),
	tags: z.array(z.string().min(1).max(80)).max(20).optional(),
	links: z.array(MemoryLinkSchema).max(20).optional(),
	status: MemoryStatusSchema.optional(),
});

export const MemoryWriteRequestSchema = z.object({
	entries: z.array(MemoryWriteEntrySchema).min(1).max(50),
});

export const MemoryContextRequestSchema = z.object({
	sessionKey: z.string().min(1).max(PUBLIC_CHAT_SESSION_KEY_MAX_LENGTH).optional(),
	projectId: z.string().min(1).max(120).optional(),
	bookId: z.string().min(1).max(120).optional(),
	chapterId: z.string().min(1).max(120).optional(),
	limitPerScope: z.number().int().min(1).max(20).optional(),
	recentConversationLimit: z.number().int().min(1).max(20).optional(),
});

export const MemoryProjectChatArtifactSessionsRequestSchema = z.object({
	projectId: z.string().min(1).max(120),
	flowId: z.string().min(1).max(120).optional(),
	limitSessions: z.number().int().min(1).max(20).optional(),
	limitTurns: z.number().int().min(1).max(20).optional(),
});

export const MemorySearchScopeSchema = z.object({
	scopeType: MemoryScopeTypeSchema,
	scopeId: z.string().min(1).max(120),
});

export const MemorySearchRequestSchema = z.object({
	query: z.string().max(500).optional(),
	scopes: z.array(MemorySearchScopeSchema).max(20).optional(),
	memoryTypes: z.array(MemoryEntryTypeSchema).max(10).optional(),
	tags: z.array(z.string().min(1).max(80)).max(20).optional(),
	status: MemoryStatusSchema.optional(),
	limit: z.number().int().min(1).max(100).optional(),
});

export const ExecutionTraceWriteRequestSchema = z.object({
	scopeType: MemoryScopeTypeSchema,
	scopeId: z.string().min(1).max(120),
	taskId: z.string().min(1).max(120).optional(),
	requestKind: z.string().min(1).max(80),
	inputSummary: z.string().min(1).max(4000),
	decisionLog: z.array(z.string().min(1).max(2000)).max(100).optional(),
	toolCalls: z.array(z.record(z.string(), z.unknown())).max(200).optional(),
	meta: z.record(z.string(), z.unknown()).optional(),
	resultSummary: z.string().max(4000).optional(),
	errorCode: z.string().max(120).optional(),
	errorDetail: z.string().max(8000).optional(),
});

export type MemoryScopeType = z.infer<typeof MemoryScopeTypeSchema>;
export type MemoryEntryType = z.infer<typeof MemoryEntryTypeSchema>;
export type MemoryStatus = z.infer<typeof MemoryStatusSchema>;
export type MemoryWriteRequest = z.infer<typeof MemoryWriteRequestSchema>;
export type MemoryContextRequest = z.infer<typeof MemoryContextRequestSchema>;
export type MemoryProjectChatArtifactSessionsRequest = z.infer<typeof MemoryProjectChatArtifactSessionsRequestSchema>;
export type MemorySearchRequest = z.infer<typeof MemorySearchRequestSchema>;
export type ExecutionTraceWriteRequest = z.infer<typeof ExecutionTraceWriteRequestSchema>;
