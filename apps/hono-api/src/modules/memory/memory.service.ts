import type { AppContext, PrismaClient } from "../../types";
import {
	buildMemoryContext,
	listProjectChatArtifactSessions,
	listProjectChatSessionSummaries,
	listExecutionTraces,
	persistConversationTurn,
	searchMemoryEntries,
	supersedeSessionMemoryEntries,
	writeExecutionTrace,
	writeMemoryEntries,
	PUBLIC_CHAT_REFERENCE_PROVENANCE_REQUEST_KIND,
	type ChatSessionSummary,
	type ExecutionTraceRow,
	type MemoryContextResult,
	type NormalizedMemoryEntry,
	type PersistConversationTurnResult,
	type ProjectChatArtifactSession,
} from "./memory.repo";
import type {
	ExecutionTraceWriteRequest,
	MemoryContextRequest,
	MemoryProjectChatArtifactSessionsRequest,
	MemoryProjectSessionsRequest,
	MemorySearchRequest,
	MemoryWriteRequest,
} from "./memory.schemas";
import { parseAgentExecutionProvenance } from "../task/agent-execution-provenance";
import {
	buildPublicChatTurnEntityId,
	resetPublicChatSession,
} from "../apiKey/public-chat-session.repo";

function truncateText(value: string, maxLength: number): string {
	const text = String(value || "").trim();
	if (!text) return "";
	if (text.length <= maxLength) return text;
	return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function headlineOfEntry(item: Pick<NormalizedMemoryEntry, "summaryText" | "title" | "content">): string {
	const summary = String(item.summaryText || "").trim();
	if (summary) return summary;
	const title = String(item.title || "").trim();
	if (title) return title;
	try {
		return truncateText(JSON.stringify(item.content), 240);
	} catch {
		return "";
	}
}

function summarizeHeadlines(items: NormalizedMemoryEntry[], limit = 3): string {
	return items
		.map((item) => headlineOfEntry(item))
		.filter(Boolean)
		.slice(0, limit)
		.join("；");
}

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
	if (!raw) return fallback;
	try {
		return JSON.parse(raw) as T;
	} catch {
		return fallback;
	}
}

export async function buildUserMemoryContext(
	c: AppContext,
	userId: string,
	input: MemoryContextRequest,
) {
	return buildMemoryContext(c.env.DB, userId, input);
}

/** Replace all recallable projections for one canonical chat session. */
export async function resetUserConversation(
	c: AppContext,
	input: { userId: string; sessionKey: string },
): Promise<void> {
	const nowIso = new Date().toISOString();
	await resetPublicChatSession(c.env.DB, { ...input, nowIso });
	await supersedeSessionMemoryEntries(c.env.DB, { ...input, nowIso });
}

export async function writeUserMemoryEntries(
	c: AppContext,
	userId: string,
	input: MemoryWriteRequest,
) {
	return writeMemoryEntries(c.env.DB, userId, input);
}

export async function searchUserMemoryEntries(
	c: AppContext,
	userId: string,
	input: MemorySearchRequest,
) {
	return searchMemoryEntries(c.env.DB, userId, input);
}

export async function listUserProjectChatArtifactSessions(
	c: AppContext,
	userId: string,
	input: MemoryProjectChatArtifactSessionsRequest,
): Promise<ProjectChatArtifactSession[]> {
	return listProjectChatArtifactSessions(c.env.DB, {
		userId,
		projectId: input.projectId,
		...(input.flowId ? { flowId: input.flowId } : {}),
		...(typeof input.limitSessions === "number" ? { limitSessions: input.limitSessions } : {}),
		...(typeof input.limitTurns === "number" ? { limitTurns: input.limitTurns } : {}),
	});
}

export async function listUserProjectChatSessions(
	c: AppContext,
	userId: string,
	input: MemoryProjectSessionsRequest,
): Promise<ChatSessionSummary[]> {
	return listProjectChatSessionSummaries(c.env.DB, {
		userId,
		projectId: input.projectId,
		...(input.flowId ? { flowId: input.flowId } : {}),
		...(input.chapterId ? { chapterId: input.chapterId } : {}),
		...(typeof input.limit === "number" ? { limit: input.limit } : {}),
	});
}

export async function writeUserExecutionTrace(
	c: AppContext,
	userId: string,
	input: ExecutionTraceWriteRequest,
) {
	return writeExecutionTrace(c.env.DB, userId, input);
}

export function formatMemoryContextSummary(input: MemoryContextResult): string {
	const parts: string[] = [];
	const sessionRollup = summarizeHeadlines(input.rollups.session, 1);
	if (sessionRollup) parts.push(`最近对话摘要：${sessionRollup}`);
	const chapterRollup = summarizeHeadlines(input.rollups.chapter, 1);
	if (chapterRollup) parts.push(`章节记忆：${chapterRollup}`);
	const bookRollup = summarizeHeadlines(input.rollups.book, 1);
	if (bookRollup) parts.push(`书籍记忆：${bookRollup}`);
	const preferenceSummary = summarizeHeadlines(input.userPreferences, 2);
	if (preferenceSummary) parts.push(`用户偏好：${preferenceSummary}`);
	const artifactSummary = summarizeHeadlines(input.artifactRefs, 2);
	if (artifactSummary) parts.push(`关键资产：${artifactSummary}`);
	return parts.join("\n");
}

export async function persistUserConversationTurn(
	c: AppContext,
	input: {
		userId: string;
		sessionKey: string;
		turnId: string;
		userText: string;
		assistantText: string;
		assistantAssets?: unknown[];
		assistantExecutionProvenance?: unknown;
	},
): Promise<PersistConversationTurnResult | null> {
	const persisted = await persistConversationTurn(c.env.DB, input);
	const executionProvenance = parseAgentExecutionProvenance(input.assistantExecutionProvenance);
	if (persisted?.assistantMessageId && executionProvenance) {
		const tracePersistence = await writeExecutionTrace(c.env.DB, input.userId, {
			scopeType: "session",
			scopeId: input.sessionKey,
			taskId: persisted.assistantMessageId,
			requestKind: PUBLIC_CHAT_REFERENCE_PROVENANCE_REQUEST_KIND,
			inputSummary: "assistant reference provenance",
			meta: { executionProvenance },
			resultSummary: "assistant reference provenance persisted",
		}, {
			traceId: buildPublicChatTurnEntityId({
				kind: "reference_provenance",
				userId: input.userId,
				sessionKey: input.sessionKey,
				turnId: input.turnId,
			}),
			idempotent: true,
		});
		if (tracePersistence.status === "degraded") {
			console.warn(
				`[memory] assistant reference provenance degraded message=${persisted.assistantMessageId} code=${tracePersistence.errorCode ?? "unknown"}`,
			);
		}
	}
	const context = await buildMemoryContext(c.env.DB, input.userId, {
		sessionKey: input.sessionKey,
		recentConversationLimit: 8,
		limitPerScope: 4,
	});
	const lastUserText = truncateText(
		context.recentConversation
			.filter((item) => item.role === "user")
			.map((item) => item.content)
			.slice(-1)[0] || input.userText,
		240,
	);
	const recentTurns = context.recentConversation
		.slice(-6)
		.map((item) => `${item.role}: ${truncateText(item.content, 160)}`)
		.filter(Boolean);
	const summaryText = lastUserText ? `用户最近请求：${lastUserText}` : "";
	if (!summaryText && !recentTurns.length) return persisted;
	await writeMemoryEntries(c.env.DB, input.userId, {
		entries: [
			{
				scopeType: "session",
				scopeId: input.sessionKey,
				memoryType: "summary",
				title: `session ${input.sessionKey} rollup`,
				summaryText,
				content: {
					kind: "conversation_rollup",
					sessionKey: input.sessionKey,
					lastUserText,
					recentTurns,
				},
				sourceKind: "system_extract",
				sourceId: `conversation_rollup:${input.turnId}`,
				importance: 0.88,
				status: "active",
				tags: ["conversation", "rollup", "session"],
			},
		],
	}, {
		entryIds: [buildPublicChatTurnEntityId({
			kind: "memory_rollup",
			userId: input.userId,
			sessionKey: input.sessionKey,
			turnId: input.turnId,
		})],
		idempotent: true,
	});
	return persisted;
}

export function formatMemoryContextForPrompt(input: MemoryContextResult): string {
	const lines: string[] = [];
	const pushSection = (
		title: string,
		items: Array<{ summaryText: string | null; title: string | null; content: Record<string, unknown> }>,
	) => {
		if (!items.length) return;
		lines.push(`## ${title}`);
		for (const item of items) {
			const headline = headlineOfEntry({
				summaryText: item.summaryText,
				title: item.title,
				content: item.content,
			});
			if (headline) lines.push(`- ${headline}`);
		}
		lines.push("");
	};
	pushSection("Session Rollups (Background Only)", input.rollups.session);
	pushSection("Chapter Rollups", input.rollups.chapter);
	pushSection("Book Rollups", input.rollups.book);
	pushSection("Project Rollups", input.rollups.project);
	pushSection("User Preferences", input.userPreferences);
	pushSection("Project Facts", input.projectFacts);
	pushSection("Book Facts", input.bookFacts);
	pushSection("Chapter Facts", input.chapterFacts);
	pushSection("Artifact References", input.artifactRefs);
	if (input.recentConversation.length) {
		lines.push("## Recent Conversation (Background Only)");
		for (const item of input.recentConversation) {
			lines.push(`- [${item.role}] ${truncateText(item.content, 280)}`);
		}
		lines.push("");
	}
	if (!lines.length) return "";
	return [
		"以下是按用户维度和业务 scope 检索出的记忆上下文。",
		"只有 Project Facts / Book Facts / Chapter Facts / Artifact References 可作为候选事实线索；User Preferences 仅表示长期偏好。",
		"Session Rollups 与 Recent Conversation 只可作为背景线索，尤其 assistant 历史输出可能过期、出错或已被后续回合推翻，绝不能替代本轮工具取证。",
		...lines,
	].join("\n");
}



export type ExecutionTraceDto = {
	id: string;
	scopeType: string;
	scopeId: string;
	taskId: string | null;
	requestKind: string;
	inputSummary: string;
	decisionLog: string[];
	toolCalls: Array<Record<string, unknown>>;
	meta: Record<string, unknown> | null;
	resultSummary: string | null;
	errorCode: string | null;
	errorDetail: string | null;
	createdAt: string;
	status: string;
	sessionKey: string | null;
	workflowKey: string | null;
	logicalTaskId: string | null;
	rootTraceId: string | null;
	parentTraceId: string | null;
	physicalRunId: string | null;
	workflowRunId: string | null;
	startedAt: string;
	updatedAt: string;
	finishedAt: string | null;
	nextEventSeq: number;
};

export async function listUserExecutionTraces(
	c: AppContext,
	userId: string,
	input: {
		limit: number;
		traceId?: string;
		traceFamilyId?: string;
		scopeType?: string;
		scopeId?: string;
		requestKindPrefix?: string;
	},
): Promise<ExecutionTraceDto[]> {
	const rows = await listExecutionTraces(c.env.DB, {
		userId,
		limit: input.limit,
		...(input.traceId ? { traceId: input.traceId } : {}),
		...(input.traceFamilyId ? { traceFamilyId: input.traceFamilyId } : {}),
		...(input.scopeType ? { scopeType: input.scopeType } : {}),
		...(input.scopeId ? { scopeId: input.scopeId } : {}),
		...(input.requestKindPrefix ? { requestKindPrefix: input.requestKindPrefix } : {}),
	});
	return rows.map(normalizeExecutionTraceRow);
}

function normalizeExecutionTraceRow(row: ExecutionTraceRow): ExecutionTraceDto {
	const parseTraceJson = <T>(raw: string | null, field: string, fallback: T): T => {
		if (!raw) return fallback;
		try {
			return JSON.parse(raw) as T;
		} catch (error: unknown) {
			throw new Error(
				`execution_trace_invalid_json:${row.id}:${field}:${error instanceof Error ? error.message : String(error)}`,
			);
		}
	};
	const toolCalls = parseTraceJson<Array<Record<string, unknown>>>(row.tool_calls_json, "tool_calls_json", []);
	const metaFromColumn = (() => {
		const parsed = parseTraceJson<Record<string, unknown>>(row.meta_json, "meta_json", {});
		return Object.keys(parsed).length ? parsed : null;
	})();
	return {
		id: row.id,
		scopeType: row.scope_type,
		scopeId: row.scope_id,
		taskId: row.task_id,
		requestKind: row.request_kind,
		inputSummary: row.input_summary,
		decisionLog: parseTraceJson<string[]>(row.decision_log_json, "decision_log_json", []),
		toolCalls,
		meta: metaFromColumn,
		resultSummary: row.result_summary,
		errorCode: row.error_code,
		errorDetail: row.error_detail,
		createdAt: row.created_at,
		status: row.status,
		sessionKey: row.session_key,
		workflowKey: row.workflow_key,
		logicalTaskId: row.logical_task_id,
		rootTraceId: row.root_trace_id,
		parentTraceId: row.parent_trace_id,
		physicalRunId: row.physical_run_id,
		workflowRunId: row.workflow_run_id,
		startedAt: row.started_at,
		updatedAt: row.updated_at,
		finishedAt: row.finished_at,
		nextEventSeq: Number(row.next_event_seq),
	};
}
export async function persistStoryboardChunkMemory(
	c: AppContext,
	input: {
		userId: string;
		projectId: string;
		bookId: string;
		chapterId?: string;
		chunkId: string;
		sourceId: string;
		groupSize: number;
		chunkIndex: number;
		shotStart: number;
		shotEnd: number;
		tailFrameUrl: string;
		frameUrls: string[];
		roleCardRefIds?: string[];
		scenePropRefId?: string;
		scenePropRefLabel?: string;
		spellFxRefId?: string;
		spellFxRefLabel?: string;
	}
) {
	return persistStoryboardChunkMemoryWithDb(c.env.DB, input);
}

export async function persistStoryboardChunkMemoryWithDb(
	db: PrismaClient,
	input: {
		userId: string;
		projectId: string;
		bookId: string;
		chapterId?: string;
		chunkId: string;
		sourceId: string;
		groupSize: number;
		chunkIndex: number;
		shotStart: number;
		shotEnd: number;
		tailFrameUrl: string;
		frameUrls: string[];
		roleCardRefIds?: string[];
		scenePropRefId?: string;
		scenePropRefLabel?: string;
		spellFxRefId?: string;
		spellFxRefLabel?: string;
	}
) {
	const chapterId = String(input.chapterId || "").trim();
	const baseContent = {
		kind: "storyboard_chunk_tail_frame",
		projectId: input.projectId,
		bookId: input.bookId,
		...(chapterId ? { chapterId } : {}),
		chunkId: input.chunkId,
		sourceId: input.sourceId,
		groupSize: input.groupSize,
		chunkIndex: input.chunkIndex,
		shotStart: input.shotStart,
		shotEnd: input.shotEnd,
		tailFrameUrl: input.tailFrameUrl,
		frameUrls: input.frameUrls,
		roleCardRefIds: input.roleCardRefIds ?? [],
		...(input.scenePropRefId ? { scenePropRefId: input.scenePropRefId } : {}),
		...(input.scenePropRefLabel ? { scenePropRefLabel: input.scenePropRefLabel } : {}),
		...(input.spellFxRefId ? { spellFxRefId: input.spellFxRefId } : {}),
		...(input.spellFxRefLabel ? { spellFxRefLabel: input.spellFxRefLabel } : {}),
	};
	const summary = `book=${input.bookId}${chapterId ? ` chapter=${chapterId}` : ""} chunk=${input.chunkIndex} shots=${input.shotStart}-${input.shotEnd} tailFrame=${input.tailFrameUrl}`;
	const entries: MemoryWriteRequest["entries"] = [
		{
			scopeType: "book",
			scopeId: input.bookId,
			memoryType: "artifact_ref",
			title: `storyboard chunk ${input.chunkIndex} tail frame`,
			summaryText: summary,
			content: baseContent,
			sourceKind: "task_result",
			sourceId: input.sourceId,
			importance: 0.95,
			status: "active",
			tags: ["storyboard", "tail-frame", "continuity", `chunk:${input.chunkIndex}`],
			links: [
				{ targetType: "project", targetId: input.projectId, relation: "about" },
				{ targetType: "book", targetId: input.bookId, relation: "about" },
			],
		},
		{
			scopeType: "book",
			scopeId: input.bookId,
			memoryType: "domain_fact",
			title: `storyboard continuity chunk ${input.chunkIndex}`,
			summaryText: `连续性事实：chunk ${input.chunkIndex} 的尾帧参考图已确认，可作为下一分组首帧参考。`,
			content: {
				kind: "storyboard_chunk_continuity",
				projectId: input.projectId,
				bookId: input.bookId,
				...(chapterId ? { chapterId } : {}),
				chunkId: input.chunkId,
				chunkIndex: input.chunkIndex,
				shotStart: input.shotStart,
				shotEnd: input.shotEnd,
				tailFrameUrl: input.tailFrameUrl,
			},
			sourceKind: "task_result",
			sourceId: input.sourceId,
			importance: 0.9,
			status: "active",
			tags: ["storyboard", "continuity", "domain-fact"],
			links: [
				{ targetType: "project", targetId: input.projectId, relation: "about" },
				{ targetType: "book", targetId: input.bookId, relation: "about" },
			],
		},
		{
			scopeType: "project",
			scopeId: input.projectId,
			memoryType: "summary",
			title: `project storyboard rollup chunk ${input.chunkIndex}`,
			summaryText: `项目 storyboard 更新到 ${chapterId ? `章节 ${chapterId} ` : ""}chunk ${input.chunkIndex}，镜头 ${input.shotStart}-${input.shotEnd} 的尾帧已沉淀。`,
			content: {
				kind: "storyboard_project_rollup",
				projectId: input.projectId,
				bookId: input.bookId,
				...(chapterId ? { chapterId } : {}),
				chunkId: input.chunkId,
				chunkIndex: input.chunkIndex,
				shotStart: input.shotStart,
				shotEnd: input.shotEnd,
				tailFrameUrl: input.tailFrameUrl,
			},
			sourceKind: "system_extract",
			sourceId: `storyboard_project_rollup:${input.sourceId}`,
			importance: 0.9,
			status: "active",
			tags: ["storyboard", "rollup", "project"],
			links: [
				{ targetType: "project", targetId: input.projectId, relation: "about" },
				{ targetType: "book", targetId: input.bookId, relation: "references" },
			],
		},
		{
			scopeType: "book",
			scopeId: input.bookId,
			memoryType: "summary",
			title: `book storyboard rollup chunk ${input.chunkIndex}`,
			summaryText: `本书最近一次 continuity 产出为 chunk ${input.chunkIndex}（镜头 ${input.shotStart}-${input.shotEnd}），尾帧可直接承接后续分组。`,
			content: {
				kind: "storyboard_book_rollup",
				projectId: input.projectId,
				bookId: input.bookId,
				...(chapterId ? { chapterId } : {}),
				chunkId: input.chunkId,
				chunkIndex: input.chunkIndex,
				shotStart: input.shotStart,
				shotEnd: input.shotEnd,
				tailFrameUrl: input.tailFrameUrl,
				frameCount: input.frameUrls.length,
			},
			sourceKind: "system_extract",
			sourceId: `storyboard_book_rollup:${input.sourceId}`,
			importance: 0.92,
			status: "active",
			tags: ["storyboard", "rollup", "book", "continuity"],
			links: [
				{ targetType: "project", targetId: input.projectId, relation: "about" },
				{ targetType: "book", targetId: input.bookId, relation: "about" },
			],
		},
	];
	if (chapterId) {
		entries.push(
			{
				scopeType: "chapter",
				scopeId: chapterId,
				memoryType: "artifact_ref",
				title: `chapter ${chapterId} storyboard chunk ${input.chunkIndex}`,
				summaryText: summary,
				content: baseContent,
				sourceKind: "task_result",
				sourceId: input.sourceId,
				importance: 0.97,
				status: "active",
				tags: ["storyboard", "chapter", "tail-frame", "continuity"],
				links: [
					{ targetType: "project", targetId: input.projectId, relation: "about" },
					{ targetType: "book", targetId: input.bookId, relation: "about" },
					{ targetType: "chapter", targetId: chapterId, relation: "about" },
				],
			},
			{
				scopeType: "chapter",
				scopeId: chapterId,
				memoryType: "domain_fact",
				title: `chapter ${chapterId} continuity`,
				summaryText: `章节 ${chapterId} 已确认 chunk ${input.chunkIndex} continuity，可供后续续写直接检索。`,
				content: {
					kind: "storyboard_chapter_continuity",
					projectId: input.projectId,
					bookId: input.bookId,
					chapterId,
					chunkId: input.chunkId,
					chunkIndex: input.chunkIndex,
					tailFrameUrl: input.tailFrameUrl,
				},
				sourceKind: "task_result",
				sourceId: input.sourceId,
				importance: 0.93,
				status: "active",
				tags: ["storyboard", "chapter", "continuity", "domain-fact"],
				links: [
					{ targetType: "project", targetId: input.projectId, relation: "about" },
					{ targetType: "book", targetId: input.bookId, relation: "about" },
					{ targetType: "chapter", targetId: chapterId, relation: "about" },
				],
			},
			{
				scopeType: "chapter",
				scopeId: chapterId,
				memoryType: "summary",
				title: `chapter ${chapterId} storyboard rollup chunk ${input.chunkIndex}`,
				summaryText: `章节 ${chapterId} 最近确认的 continuity 为 chunk ${input.chunkIndex}（镜头 ${input.shotStart}-${input.shotEnd}），尾帧锚点已可用于下一组首帧。`,
				content: {
					kind: "storyboard_chapter_rollup",
					projectId: input.projectId,
					bookId: input.bookId,
					chapterId,
					chunkId: input.chunkId,
					chunkIndex: input.chunkIndex,
					shotStart: input.shotStart,
					shotEnd: input.shotEnd,
					tailFrameUrl: input.tailFrameUrl,
					roleCardRefIds: input.roleCardRefIds ?? [],
				},
				sourceKind: "system_extract",
				sourceId: `storyboard_chapter_rollup:${input.sourceId}`,
				importance: 0.96,
				status: "active",
				tags: ["storyboard", "rollup", "chapter", "continuity"],
				links: [
					{ targetType: "project", targetId: input.projectId, relation: "about" },
					{ targetType: "book", targetId: input.bookId, relation: "about" },
					{ targetType: "chapter", targetId: chapterId, relation: "about" },
				],
			},
		);
	}
	await writeMemoryEntries(db, input.userId, { entries });
}
