import { randomUUID } from "node:crypto";
import type { PrismaClient } from "../../types";
import { execute, queryAll } from "../../db/db";
import {
	appendPublicChatMessage,
	findPublicChatSessionByKey,
	listPublicChatMessages,
	listPublicChatSessionsByPrefix,
	resolveOrCreatePublicChatSession,
} from "../apiKey/public-chat-session.repo";
import type {
	ExecutionTraceWriteRequest,
	MemoryContextRequest,
	MemoryEntryType,
	MemorySearchRequest,
	MemoryScopeType,
	MemoryStatus,
	MemoryWriteRequest,
} from "./memory.schemas";

export type MemoryEntryRow = {
	id: string;
	user_id: string;
	scope_type: string;
	scope_id: string;
	memory_type: string;
	title: string | null;
	summary_text: string | null;
	content_json: string;
	source_kind: string;
	source_id: string | null;
	importance: number;
	status: string;
	created_at: string;
	updated_at: string;
};

export type NormalizedMemoryEntry = {
	id: string;
	scopeType: MemoryScopeType;
	scopeId: string;
	memoryType: MemoryEntryType;
	title: string | null;
	summaryText: string | null;
	content: Record<string, unknown>;
	importance: number;
	status: MemoryStatus;
	createdAt: string;
	updatedAt: string;
};

export type MemoryContextConversationItem = {
	role: string;
	content: string;
	assets: unknown[];
	createdAt: string;
};

export type ProjectChatArtifactAsset = {
	type: string | null;
	title: string | null;
	url: string;
	thumbnailUrl: string | null;
	vendor: string | null;
	modelKey: string | null;
	taskId: string | null;
};

export type ProjectChatArtifactTurn = {
	assistantMessageId: string;
	createdAt: string;
	userText: string | null;
	assistantText: string;
	assets: ProjectChatArtifactAsset[];
};

export type ProjectChatArtifactSession = {
	sessionId: string;
	sessionKey: string;
	updatedAt: string;
	lane: string;
	skillId: string;
	turns: ProjectChatArtifactTurn[];
};

export type MemoryContextResult = {
	userPreferences: NormalizedMemoryEntry[];
	projectFacts: NormalizedMemoryEntry[];
	bookFacts: NormalizedMemoryEntry[];
	chapterFacts: NormalizedMemoryEntry[];
	artifactRefs: NormalizedMemoryEntry[];
	rollups: {
		user: NormalizedMemoryEntry[];
		project: NormalizedMemoryEntry[];
		book: NormalizedMemoryEntry[];
		chapter: NormalizedMemoryEntry[];
		session: NormalizedMemoryEntry[];
	};
	recentConversation: MemoryContextConversationItem[];
};

export type ExecutionTraceRow = {
	id: string;
	user_id: string;
	scope_type: string;
	scope_id: string;
	task_id: string | null;
	request_kind: string;
	input_summary: string;
	decision_log_json: string | null;
	tool_calls_json: string | null;
	meta_json: string | null;
	result_summary: string | null;
	error_code: string | null;
	error_detail: string | null;
	created_at: string;
};

export type PersistConversationTurnResult = {
	sessionId: string;
	userMessageId: string | null;
	assistantMessageId: string | null;
};

type PublicChatMessageRow = {
	id: string;
	user_id: string;
	session_id: string;
	role: string;
	content: string;
	assets_json: string | null;
	created_at: string;
};

type MemorySearchRow = MemoryEntryRow & {
	search_rank?: number | null;
};

const MEMORY_FTS_DOCUMENT_SQL =
	"COALESCE(memory_entries.title, '') || ' ' || COALESCE(memory_entries.summary_text, '') || ' ' || COALESCE(memory_entries.content_json, '')";

let schemaEnsured = false;
let schemaEnsurePromise: Promise<void> | null = null;

export async function ensureMemorySchema(db: PrismaClient): Promise<void> {
	if (schemaEnsured) return;
	if (schemaEnsurePromise) {
		await schemaEnsurePromise;
		return;
	}
	schemaEnsurePromise = (async () => {
		await execute(
			db,
			`CREATE TABLE IF NOT EXISTS memory_entries (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      scope_type TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      memory_type TEXT NOT NULL,
      title TEXT,
      summary_text TEXT,
      content_json TEXT NOT NULL,
      source_kind TEXT NOT NULL,
      source_id TEXT,
      importance REAL NOT NULL DEFAULT 0.6,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )`,
		);
		await execute(
			db,
			`CREATE INDEX IF NOT EXISTS idx_memory_entries_user_scope
     ON memory_entries(user_id, scope_type, scope_id, memory_type, updated_at DESC)`,
		);
		await execute(
			db,
			`CREATE INDEX IF NOT EXISTS idx_memory_entries_user_status
     ON memory_entries(user_id, status, updated_at DESC)`,
		);
		await execute(
			db,
			`CREATE INDEX IF NOT EXISTS idx_memory_entries_fts
     ON memory_entries
     USING GIN (to_tsvector('simple', ${MEMORY_FTS_DOCUMENT_SQL}))`,
		);
		await execute(
			db,
			`CREATE TABLE IF NOT EXISTS memory_entry_tags (
      id TEXT PRIMARY KEY,
      memory_id TEXT NOT NULL,
      tag TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (memory_id) REFERENCES memory_entries(id)
    )`,
		);
		await execute(
			db,
			`CREATE INDEX IF NOT EXISTS idx_memory_entry_tags_tag
     ON memory_entry_tags(tag, memory_id)`,
		);
		await execute(
			db,
			`CREATE INDEX IF NOT EXISTS idx_memory_entry_tags_lower_tag
     ON memory_entry_tags(LOWER(tag), memory_id)`,
		);
		await execute(
			db,
			`CREATE TABLE IF NOT EXISTS memory_links (
      id TEXT PRIMARY KEY,
      memory_id TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      relation TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (memory_id) REFERENCES memory_entries(id)
    )`,
		);
		await execute(
			db,
			`CREATE INDEX IF NOT EXISTS idx_memory_links_target
     ON memory_links(target_type, target_id)`,
		);
		await execute(
			db,
			`CREATE TABLE IF NOT EXISTS execution_traces (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      scope_type TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      task_id TEXT,
      request_kind TEXT NOT NULL,
      input_summary TEXT NOT NULL,
      decision_log_json TEXT,
      tool_calls_json TEXT,
      meta_json TEXT,
      result_summary TEXT,
      error_code TEXT,
      error_detail TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )`,
		);
		await execute(
			db,
			`CREATE INDEX IF NOT EXISTS idx_execution_traces_user_scope
     ON execution_traces(user_id, scope_type, scope_id, created_at DESC)`,
		);
		await execute(db, `ALTER TABLE execution_traces ADD COLUMN IF NOT EXISTS meta_json TEXT`);
		schemaEnsured = true;
	})();
	try {
		await schemaEnsurePromise;
	} finally {
		schemaEnsurePromise = null;
	}
}

function clampImportance(value: number | undefined): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return 0.6;
	return Math.max(0, Math.min(1, value));
}

function serializeJson(value: unknown): string {
	return JSON.stringify(value ?? {});
}

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
	if (!raw) return fallback;
	try {
		return JSON.parse(raw) as T;
	} catch {
		return fallback;
	}
}

function normalizeProjectChatArtifactAssets(input: unknown[]): ProjectChatArtifactAsset[] {
	const out: ProjectChatArtifactAsset[] = [];
	const seenUrl = new Set<string>();
	for (const item of input) {
		if (!item || typeof item !== "object" || Array.isArray(item)) continue;
		const record = item as Record<string, unknown>;
		const url = typeof record.url === "string" ? record.url.trim() : "";
		if (!url || seenUrl.has(url)) continue;
		seenUrl.add(url);
		out.push({
			type: typeof record.type === "string" && record.type.trim() ? record.type.trim() : null,
			title: typeof record.title === "string" && record.title.trim() ? record.title.trim() : null,
			url,
			thumbnailUrl:
				typeof record.thumbnailUrl === "string" && record.thumbnailUrl.trim()
					? record.thumbnailUrl.trim()
					: null,
			vendor: typeof record.vendor === "string" && record.vendor.trim() ? record.vendor.trim() : null,
			modelKey:
				typeof record.modelKey === "string" && record.modelKey.trim() ? record.modelKey.trim() : null,
			taskId: typeof record.taskId === "string" && record.taskId.trim() ? record.taskId.trim() : null,
		});
	}
	return out;
}

function parseChatSessionMeta(sessionKey: string): { lane: string; skillId: string } {
	const segments = String(sessionKey || "").trim().split(":").filter(Boolean);
	const laneIndex = segments.indexOf("lane");
	const skillIndex = segments.indexOf("skill");
	return {
		lane:
			laneIndex >= 0 && typeof segments[laneIndex + 1] === "string" && segments[laneIndex + 1]
				? segments[laneIndex + 1]
				: "general",
		skillId:
			skillIndex >= 0 && typeof segments[skillIndex + 1] === "string" && segments[skillIndex + 1]
				? segments[skillIndex + 1]
				: "default",
	};
}

function normalizeMemoryChapterId(value: unknown): string | null {
	if (typeof value === "number" && Number.isFinite(value) && value > 0) {
		return String(Math.trunc(value));
	}
	const text = typeof value === "string" ? value.trim() : "";
	if (!text) return null;
	const numeric = Number(text);
	if (!Number.isFinite(numeric) || numeric <= 0) return null;
	return String(Math.trunc(numeric));
}

function filterEntriesForChapterContext(
	entries: NormalizedMemoryEntry[],
	chapterId?: string,
): NormalizedMemoryEntry[] {
	const normalizedChapterId = normalizeMemoryChapterId(chapterId);
	if (!normalizedChapterId) return entries;
	return entries.filter((entry) => {
		const entryChapterId = normalizeMemoryChapterId(
			entry.content.chapterId ?? entry.content.chapter,
		);
		return !entryChapterId || entryChapterId === normalizedChapterId;
	});
}

function normalizeEntryRow(row: MemoryEntryRow): NormalizedMemoryEntry {
	return {
		id: row.id,
		scopeType: row.scope_type as MemoryScopeType,
		scopeId: row.scope_id,
		memoryType: row.memory_type as MemoryEntryType,
		title: row.title,
		summaryText: row.summary_text,
		content: parseJson<Record<string, unknown>>(row.content_json, {}),
		importance: Number(row.importance || 0),
		status: row.status as MemoryStatus,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

async function loadTagsByMemoryIds(
	db: PrismaClient,
	ids: string[],
): Promise<Map<string, string[]>> {
	if (!ids.length) return new Map<string, string[]>();
	const tagRows = await queryAll<{ memory_id: string; tag: string }>(
		db,
		`SELECT memory_id, tag FROM memory_entry_tags WHERE memory_id IN (${ids.map(() => "?").join(", ")})`,
		ids,
	);
	const tagsById = new Map<string, string[]>();
	for (const row of tagRows) {
		const current = tagsById.get(row.memory_id) ?? [];
		current.push(row.tag);
		tagsById.set(row.memory_id, current);
	}
	return tagsById;
}

async function loadEntriesForScope(
	db: PrismaClient,
	userId: string,
	scopeType: MemoryScopeType,
	scopeId: string | undefined,
	memoryTypes: MemoryEntryType[],
	limit: number,
): Promise<NormalizedMemoryEntry[]> {
	const normalizedScopeId = String(scopeId || "").trim();
	if (!normalizedScopeId || !memoryTypes.length) return [];
	const placeholders = memoryTypes.map(() => "?").join(", ");
	const rows = await queryAll<MemoryEntryRow>(
		db,
		`SELECT * FROM memory_entries
       WHERE user_id = ? AND scope_type = ? AND scope_id = ? AND status = 'active'
         AND memory_type IN (${placeholders})
       ORDER BY importance DESC, updated_at DESC
       LIMIT ?`,
		[userId, scopeType, normalizedScopeId, ...memoryTypes, limit],
	);
	return rows.map(normalizeEntryRow);
}

export async function writeMemoryEntries(
	db: PrismaClient,
	userId: string,
	input: MemoryWriteRequest,
): Promise<string[]> {
	await ensureMemorySchema(db);
	const nowIso = new Date().toISOString();
	const ids: string[] = [];
	for (const entry of input.entries) {
		const id = randomUUID();
		ids.push(id);
		await execute(
			db,
			`INSERT INTO memory_entries (
        id, user_id, scope_type, scope_id, memory_type, title, summary_text,
        content_json, source_kind, source_id, importance, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				id,
				userId,
				entry.scopeType,
				entry.scopeId,
				entry.memoryType,
				entry.title?.trim() || null,
				entry.summaryText?.trim() || null,
				serializeJson(entry.content),
				entry.sourceKind,
				entry.sourceId?.trim() || null,
				clampImportance(entry.importance),
				(entry.status ?? "active") as MemoryStatus,
				nowIso,
				nowIso,
			],
		);
		for (const tag of entry.tags ?? []) {
			await execute(
				db,
				`INSERT INTO memory_entry_tags (id, memory_id, tag, created_at) VALUES (?, ?, ?, ?)`,
				[randomUUID(), id, tag.trim(), nowIso],
			);
		}
		for (const link of entry.links ?? []) {
			await execute(
				db,
				`INSERT INTO memory_links (id, memory_id, target_type, target_id, relation, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
				[randomUUID(), id, link.targetType, link.targetId, link.relation, nowIso],
			);
		}
	}
	return ids;
}

export async function listExecutionTraces(
	db: PrismaClient,
	input: {
		userId: string;
		limit: number;
		scopeType?: string;
		scopeId?: string;
		requestKindPrefix?: string;
	},
): Promise<ExecutionTraceRow[]> {
	await ensureMemorySchema(db);
	const limit = Math.max(1, Math.min(200, Math.floor(input.limit)));
	const clauses = ["user_id = ?"];
	const params: Array<string | number> = [input.userId];
	const scopeType = String(input.scopeType || "").trim();
	const scopeId = String(input.scopeId || "").trim();
	const requestKindPrefix = String(input.requestKindPrefix || "").trim();
	if (scopeType) {
		clauses.push("scope_type = ?");
		params.push(scopeType);
	}
	if (scopeId) {
		clauses.push("scope_id = ?");
		params.push(scopeId);
	}
	if (requestKindPrefix) {
		clauses.push("request_kind LIKE ?");
		params.push(`${requestKindPrefix}%`);
	}
	params.push(limit);
	return queryAll<ExecutionTraceRow>(
		db,
		`SELECT * FROM execution_traces WHERE ${clauses.join(" AND ")} ORDER BY created_at DESC LIMIT ?`,
		params,
	);
}

export async function writeExecutionTrace(
	db: PrismaClient,
	userId: string,
	input: ExecutionTraceWriteRequest,
): Promise<string> {
	await ensureMemorySchema(db);
	const id = randomUUID();
	await execute(
		db,
		`INSERT INTO execution_traces (
      id, user_id, scope_type, scope_id, task_id, request_kind, input_summary,
      decision_log_json, tool_calls_json, meta_json, result_summary, error_code, error_detail, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			id,
			userId,
			input.scopeType,
			input.scopeId,
			input.taskId?.trim() || null,
			input.requestKind,
			input.inputSummary,
			serializeJson(input.decisionLog ?? []),
			serializeJson(input.toolCalls ?? []),
			input.meta ? serializeJson(input.meta) : null,
			input.resultSummary?.trim() || null,
			input.errorCode?.trim() || null,
			input.errorDetail?.trim() || null,
			new Date().toISOString(),
		],
	);
	return id;
}

export async function persistConversationTurn(
	db: PrismaClient,
	input: {
		userId: string;
		sessionKey: string;
		userText: string;
		assistantText: string;
		assistantAssets?: unknown[];
	},
): Promise<PersistConversationTurnResult | null> {
	await ensureMemorySchema(db);
	const nowIso = new Date().toISOString();
	const session =
		(await findPublicChatSessionByKey(db, {
			userId: input.userId,
			sessionKey: input.sessionKey,
		})) ??
		(await resolveOrCreatePublicChatSession(db, {
			id: randomUUID(),
			userId: input.userId,
			sessionKey: input.sessionKey,
			nowIso,
		}));
	if (!session) return null;
	let userMessageId: string | null = null;
	let assistantMessageId: string | null = null;
	if (input.userText.trim()) {
		userMessageId = randomUUID();
		await appendPublicChatMessage(db, {
			id: userMessageId,
			userId: input.userId,
			sessionId: session.id,
			role: "user",
			content: input.userText.trim(),
			nowIso,
		});
	}
	if (input.assistantText.trim()) {
		assistantMessageId = randomUUID();
		await appendPublicChatMessage(db, {
			id: assistantMessageId,
			userId: input.userId,
			sessionId: session.id,
			role: "assistant",
			content: input.assistantText.trim(),
			assetsJson:
				Array.isArray(input.assistantAssets) && input.assistantAssets.length
					? serializeJson(input.assistantAssets)
					: null,
			nowIso,
		});
	}
	return {
		sessionId: session.id,
		userMessageId,
		assistantMessageId,
	};
}

export async function listProjectChatArtifactSessions(
	db: PrismaClient,
	input: {
		userId: string;
		projectId: string;
		flowId?: string;
		limitSessions?: number;
		limitTurns?: number;
	},
): Promise<ProjectChatArtifactSession[]> {
	await ensureMemorySchema(db);
	const userId = String(input.userId || "").trim();
	const projectId = String(input.projectId || "").trim().toLowerCase();
	const flowId = String(input.flowId || "").trim().toLowerCase();
	if (!userId || !projectId) return [];
	const limitSessions = Number.isFinite(input.limitSessions)
		? Math.max(1, Math.min(20, Math.trunc(Number(input.limitSessions))))
		: 8;
	const limitTurns = Number.isFinite(input.limitTurns)
		? Math.max(1, Math.min(20, Math.trunc(Number(input.limitTurns))))
		: 6;
	const sessionKeyPrefix = flowId ? `project:${projectId}:flow:${flowId}` : `project:${projectId}`;
	const sessions = await listPublicChatSessionsByPrefix(db, {
		userId,
		sessionKeyPrefix,
		limit: limitSessions,
	});
	const out: ProjectChatArtifactSession[] = [];
	for (const session of sessions) {
		const rows = await listPublicChatMessages(db, {
			userId,
			sessionId: session.id,
			limit: 80,
		});
		let lastUserText: string | null = null;
		const turns: ProjectChatArtifactTurn[] = [];
		for (const row of rows as PublicChatMessageRow[]) {
			if (row.role === "user") {
				lastUserText = row.content.trim() || null;
				continue;
			}
			if (row.role !== "assistant") continue;
			const assets = normalizeProjectChatArtifactAssets(parseJson<unknown[]>(row.assets_json, []));
			if (!assets.length) continue;
			turns.push({
				assistantMessageId: row.id,
				createdAt: row.created_at,
				userText: lastUserText,
				assistantText: row.content,
				assets,
			});
		}
		if (!turns.length) continue;
		const meta = parseChatSessionMeta(session.session_key);
		out.push({
			sessionId: session.id,
			sessionKey: session.session_key,
			updatedAt: session.updated_at,
			lane: meta.lane,
			skillId: meta.skillId,
			turns: turns.slice(-limitTurns).reverse(),
		});
	}
	return out;
}

export async function searchMemoryEntries(
	db: PrismaClient,
	userId: string,
	input: MemorySearchRequest,
): Promise<Array<NormalizedMemoryEntry & { tags: string[] }>> {
	await ensureMemorySchema(db);
	const where: string[] = ["memory_entries.user_id = ?", "memory_entries.status = ?"];
	const bindings: unknown[] = [userId, input.status ?? "active"];
	if (input.scopes?.length) {
		const scopeParts: string[] = [];
		for (const scope of input.scopes) {
			scopeParts.push("(memory_entries.scope_type = ? AND memory_entries.scope_id = ?)");
			bindings.push(scope.scopeType, scope.scopeId);
		}
		where.push(`(${scopeParts.join(" OR ")})`);
	}
	if (input.memoryTypes?.length) {
		const placeholders = input.memoryTypes.map(() => "?").join(", ");
		where.push(`memory_entries.memory_type IN (${placeholders})`);
		bindings.push(...input.memoryTypes);
	}
	const query = String(input.query || "").trim();
	if (query) {
		const like = `%${query.toLowerCase()}%`;
		where.push(`(
			to_tsvector('simple', ${MEMORY_FTS_DOCUMENT_SQL}) @@ plainto_tsquery('simple', ?)
			OR EXISTS (
				SELECT 1 FROM memory_entry_tags metq
				WHERE metq.memory_id = memory_entries.id AND LOWER(metq.tag) LIKE ?
			)
		)`);
		bindings.push(query, like);
	}
	for (const tag of input.tags ?? []) {
		where.push(`EXISTS (
			SELECT 1 FROM memory_entry_tags met
			WHERE met.memory_id = memory_entries.id AND LOWER(met.tag) = ?
		)`);
		bindings.push(tag.trim().toLowerCase());
	}
	const queryBindings = [...bindings];
	const selectRankSql = query
		? `ts_rank_cd(to_tsvector('simple', ${MEMORY_FTS_DOCUMENT_SQL}), plainto_tsquery('simple', ?)) AS search_rank`
		: "0::real AS search_rank";
		if (query) queryBindings.push(query);
	const rows = await queryAll<MemorySearchRow>(
		db,
		`SELECT memory_entries.*, ${selectRankSql}
		 FROM memory_entries
		 WHERE ${where.join(" AND ")}
		 ORDER BY ${query ? "search_rank DESC, " : ""}memory_entries.importance DESC, memory_entries.updated_at DESC
		 LIMIT ?`,
		[...queryBindings, input.limit ?? 20],
	);
	if (!rows.length) return [];
	const tagsById = await loadTagsByMemoryIds(
		db,
		rows.map((row) => row.id),
	);
	return rows.map((row) => ({ ...normalizeEntryRow(row), tags: tagsById.get(row.id) ?? [] }));
}

export async function buildMemoryContext(
	db: PrismaClient,
	userId: string,
	input: MemoryContextRequest,
): Promise<MemoryContextResult> {
	await ensureMemorySchema(db);
	const limitPerScope = input.limitPerScope ?? 8;
	const recentConversationLimit = input.recentConversationLimit ?? 10;
	const normalizedSessionKey = String(input.sessionKey || "").trim();
	let recentMessages: MemoryContextConversationItem[] = [];
	if (normalizedSessionKey) {
		const session = await findPublicChatSessionByKey(db, { userId, sessionKey: normalizedSessionKey });
		if (session) {
			const rows = await listPublicChatMessages(db, {
				userId,
				sessionId: session.id,
				limit: recentConversationLimit,
			});
			recentMessages = (rows as PublicChatMessageRow[]).map((row) => ({
				role: row.role,
				content: row.content,
				assets: parseJson<unknown[]>(row.assets_json, []),
				createdAt: row.created_at,
			}));
		}
	}
	const chapterArtifactRefs = await loadEntriesForScope(db, userId, "chapter", input.chapterId, ["artifact_ref"], limitPerScope);
	const bookArtifactRefs = filterEntriesForChapterContext(
		await loadEntriesForScope(db, userId, "book", input.bookId, ["artifact_ref"], limitPerScope),
		input.chapterId,
	);
	const projectFacts = filterEntriesForChapterContext(
		await loadEntriesForScope(db, userId, "project", input.projectId, ["domain_fact", "artifact_ref"], limitPerScope),
		input.chapterId,
	);
	const bookFacts = filterEntriesForChapterContext(
		await loadEntriesForScope(db, userId, "book", input.bookId, ["domain_fact", "artifact_ref"], limitPerScope),
		input.chapterId,
	);
	const projectRollups = filterEntriesForChapterContext(
		await loadEntriesForScope(db, userId, "project", input.projectId, ["summary"], limitPerScope),
		input.chapterId,
	);
	const bookRollups = filterEntriesForChapterContext(
		await loadEntriesForScope(db, userId, "book", input.bookId, ["summary"], limitPerScope),
		input.chapterId,
	);
	return {
		userPreferences: await loadEntriesForScope(db, userId, "user", userId, ["preference"], limitPerScope),
		projectFacts,
		bookFacts,
		chapterFacts: await loadEntriesForScope(db, userId, "chapter", input.chapterId, ["domain_fact"], limitPerScope),
		artifactRefs: [...chapterArtifactRefs, ...bookArtifactRefs].slice(0, limitPerScope * 2),
		rollups: {
			user: await loadEntriesForScope(db, userId, "user", userId, ["summary"], limitPerScope),
			project: projectRollups,
			book: bookRollups,
			chapter: await loadEntriesForScope(db, userId, "chapter", input.chapterId, ["summary"], limitPerScope),
			session: await loadEntriesForScope(db, userId, "session", input.sessionKey, ["summary"], limitPerScope),
		},
		recentConversation: recentMessages,
	};
}
