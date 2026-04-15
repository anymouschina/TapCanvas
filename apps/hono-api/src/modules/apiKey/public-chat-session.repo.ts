import type { PrismaClient } from "../../types";
import { execute, queryAll, queryOne } from "../../db/db";
import { PUBLIC_CHAT_SESSION_KEY_MAX_LENGTH } from "./public-chat-session.constants";

export type PublicChatSessionRow = {
	id: string;
	user_id: string;
	session_key: string;
	created_at: string;
	updated_at: string;
};

export type PublicChatMessageRole = "user" | "assistant";

export type PublicChatMessageRow = {
	id: string;
	user_id: string;
	session_id: string;
	role: PublicChatMessageRole;
	content: string;
	assets_json: string | null;
	created_at: string;
};

export type PublicChatTurnVerdict = "satisfied" | "partial" | "failed";
export type PublicChatRunOutcome = "promote" | "hold" | "discard";

export type PublicChatTurnRunRow = {
	id: string;
	user_id: string;
	session_id: string;
	request_id: string | null;
	session_key: string;
	project_id: string | null;
	book_id: string | null;
	chapter_id: string | null;
	label: string | null;
	workflow_key: string;
	request_kind: string;
	user_message_id: string | null;
	assistant_message_id: string | null;
	output_mode: string;
	turn_verdict: PublicChatTurnVerdict;
	turn_verdict_reasons_json: string;
	run_outcome: PublicChatRunOutcome;
	agent_decision_json: string | null;
	tool_status_summary_json: string | null;
	diagnostic_flags_json: string | null;
	canvas_plan_json: string | null;
	asset_count: number;
	canvas_write: number;
	run_ms: number | null;
	created_at: string;
};

let schemaEnsured = false;
let schemaEnsurePromise: Promise<void> | null = null;

export async function ensurePublicChatSessionSchema(db: PrismaClient): Promise<void> {
	if (schemaEnsured) return;
	if (schemaEnsurePromise) {
		await schemaEnsurePromise;
		return;
	}
	schemaEnsurePromise = (async () => {
		await execute(
			db,
			`CREATE TABLE IF NOT EXISTS public_chat_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      session_key TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id),
      UNIQUE(user_id, session_key)
    )`,
		);
		await execute(
			db,
			`CREATE INDEX IF NOT EXISTS idx_public_chat_sessions_user_updated
     ON public_chat_sessions(user_id, updated_at DESC)`,
		);
		await execute(
			db,
			`CREATE TABLE IF NOT EXISTS public_chat_messages (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      assets_json TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (session_id) REFERENCES public_chat_sessions(id)
    )`,
		);
		await execute(
			db,
			`CREATE INDEX IF NOT EXISTS idx_public_chat_messages_user_session_created
     ON public_chat_messages(user_id, session_id, created_at ASC)`,
		);
		await execute(
			db,
			`CREATE TABLE IF NOT EXISTS public_chat_turn_runs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      request_id TEXT,
      session_key TEXT NOT NULL,
      project_id TEXT,
      book_id TEXT,
      chapter_id TEXT,
      label TEXT,
      workflow_key TEXT NOT NULL,
      request_kind TEXT NOT NULL,
      user_message_id TEXT,
      assistant_message_id TEXT,
      output_mode TEXT NOT NULL,
      turn_verdict TEXT NOT NULL,
      turn_verdict_reasons_json TEXT NOT NULL,
      run_outcome TEXT NOT NULL DEFAULT 'hold',
      agent_decision_json TEXT,
      tool_status_summary_json TEXT,
      diagnostic_flags_json TEXT,
      canvas_plan_json TEXT,
      asset_count INTEGER NOT NULL DEFAULT 0,
      canvas_write INTEGER NOT NULL DEFAULT 0,
      run_ms INTEGER,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (session_id) REFERENCES public_chat_sessions(id)
    )`,
		);
		await execute(
			db,
			`CREATE INDEX IF NOT EXISTS idx_public_chat_turn_runs_user_session_created
     ON public_chat_turn_runs(user_id, session_id, created_at ASC)`,
		);
		await execute(
			db,
			`CREATE INDEX IF NOT EXISTS idx_public_chat_turn_runs_user_workflow_created
     ON public_chat_turn_runs(user_id, workflow_key, created_at DESC)`,
		);
		await execute(
			db,
			`CREATE INDEX IF NOT EXISTS idx_public_chat_turn_runs_user_verdict_created
     ON public_chat_turn_runs(user_id, turn_verdict, created_at DESC)`,
		);
		await execute(db, `ALTER TABLE public_chat_turn_runs ADD COLUMN IF NOT EXISTS project_id TEXT`);
		await execute(db, `ALTER TABLE public_chat_turn_runs ADD COLUMN IF NOT EXISTS book_id TEXT`);
		await execute(db, `ALTER TABLE public_chat_turn_runs ADD COLUMN IF NOT EXISTS chapter_id TEXT`);
		await execute(db, `ALTER TABLE public_chat_turn_runs ADD COLUMN IF NOT EXISTS label TEXT`);
		await execute(
			db,
			`CREATE INDEX IF NOT EXISTS idx_public_chat_turn_runs_user_project_created
     ON public_chat_turn_runs(user_id, project_id, created_at DESC)`,
		);
		await execute(
			db,
			`CREATE INDEX IF NOT EXISTS idx_public_chat_turn_runs_user_book_chapter_created
     ON public_chat_turn_runs(user_id, book_id, chapter_id, created_at DESC)`,
		);
		await execute(
			db,
			`CREATE INDEX IF NOT EXISTS idx_public_chat_turn_runs_user_label_created
     ON public_chat_turn_runs(user_id, label, created_at DESC)`,
		);
		schemaEnsured = true;
	})();
	try {
		await schemaEnsurePromise;
	} finally {
		schemaEnsurePromise = null;
	}
}

export function normalizePublicChatSessionKey(value: unknown): string {
	const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
	if (!raw) return "";
	return raw.replace(/[^a-z0-9:_-]/g, "").slice(0, PUBLIC_CHAT_SESSION_KEY_MAX_LENGTH);
}

export async function resolveOrCreatePublicChatSession(
	db: PrismaClient,
	input: { id: string; userId: string; sessionKey: string; nowIso: string },
): Promise<PublicChatSessionRow | null> {
	await ensurePublicChatSessionSchema(db);
	const userId = String(input.userId || "").trim();
	const sessionKey = normalizePublicChatSessionKey(input.sessionKey);
	if (!userId || !sessionKey) return null;
	await execute(
		db,
		`INSERT INTO public_chat_sessions (id, user_id, session_key, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, session_key) DO UPDATE SET
         updated_at = excluded.updated_at`,
		[input.id, userId, sessionKey, input.nowIso, input.nowIso],
	);
	return queryOne<PublicChatSessionRow>(
		db,
		`SELECT * FROM public_chat_sessions WHERE user_id = ? AND session_key = ? LIMIT 1`,
		[userId, sessionKey],
	);
}

export async function findPublicChatSessionByKey(
	db: PrismaClient,
	input: { userId: string; sessionKey: string },
): Promise<PublicChatSessionRow | null> {
	await ensurePublicChatSessionSchema(db);
	const userId = String(input.userId || "").trim();
	const sessionKey = normalizePublicChatSessionKey(input.sessionKey);
	if (!userId || !sessionKey) return null;
	return queryOne<PublicChatSessionRow>(
		db,
		`SELECT * FROM public_chat_sessions WHERE user_id = ? AND session_key = ? LIMIT 1`,
		[userId, sessionKey],
	);
}

export async function listPublicChatSessionsByPrefix(
	db: PrismaClient,
	input: { userId: string; sessionKeyPrefix: string; limit?: number },
): Promise<PublicChatSessionRow[]> {
	await ensurePublicChatSessionSchema(db);
	const userId = String(input.userId || "").trim();
	const sessionKeyPrefix = normalizePublicChatSessionKey(input.sessionKeyPrefix);
	if (!userId || !sessionKeyPrefix) return [];
	const limit = Number.isFinite(input.limit)
		? Math.max(1, Math.min(30, Math.trunc(Number(input.limit))))
		: 10;
	return queryAll<PublicChatSessionRow>(
		db,
		`SELECT * FROM public_chat_sessions
		 WHERE user_id = ? AND session_key LIKE ?
		 ORDER BY updated_at DESC
		 LIMIT ?`,
		[userId, `${sessionKeyPrefix}%`, limit],
	);
}

export async function appendPublicChatMessage(
	db: PrismaClient,
	input: {
		id: string;
		userId: string;
		sessionId: string;
		role: PublicChatMessageRole;
		content: string;
		assetsJson?: string | null;
		nowIso: string;
	},
): Promise<void> {
	await ensurePublicChatSessionSchema(db);
	const userId = String(input.userId || "").trim();
	const sessionId = String(input.sessionId || "").trim();
	const content = String(input.content || "").trim();
	if (!userId || !sessionId || !content) return;
	await execute(
		db,
		`INSERT INTO public_chat_messages (id, user_id, session_id, role, content, assets_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
		[
			input.id,
			userId,
			sessionId,
			input.role,
			content,
			input.assetsJson ?? null,
			input.nowIso,
		],
	);
	await execute(
		db,
		`UPDATE public_chat_sessions
       SET updated_at = ?
       WHERE id = ? AND user_id = ?`,
		[input.nowIso, sessionId, userId],
	);
}

export async function listPublicChatMessages(
	db: PrismaClient,
	input: { userId: string; sessionId: string; limit?: number },
): Promise<PublicChatMessageRow[]> {
	await ensurePublicChatSessionSchema(db);
	const userId = String(input.userId || "").trim();
	const sessionId = String(input.sessionId || "").trim();
	if (!userId || !sessionId) return [];
	const limit = Number.isFinite(input.limit)
		? Math.max(1, Math.min(80, Math.trunc(Number(input.limit))))
		: 24;
	const rows = await queryAll<PublicChatMessageRow>(
		db,
		`SELECT * FROM public_chat_messages
     WHERE user_id = ? AND session_id = ?
     ORDER BY created_at DESC
     LIMIT ?`,
		[userId, sessionId, limit],
	);
	return rows.reverse();
}

export async function appendPublicChatTurnRun(
	db: PrismaClient,
	input: {
		id: string;
		userId: string;
		sessionId: string;
		requestId?: string | null;
		sessionKey: string;
		projectId?: string | null;
		bookId?: string | null;
		chapterId?: string | null;
		label?: string | null;
		workflowKey: string;
		requestKind: string;
		userMessageId?: string | null;
		assistantMessageId?: string | null;
		outputMode: string;
		turnVerdict: PublicChatTurnVerdict;
		turnVerdictReasonsJson: string;
		runOutcome: PublicChatRunOutcome;
		agentDecisionJson?: string | null;
		toolStatusSummaryJson?: string | null;
		diagnosticFlagsJson?: string | null;
		canvasPlanJson?: string | null;
		assetCount: number;
		canvasWrite: boolean;
		runMs?: number | null;
		nowIso: string;
	},
): Promise<void> {
	await ensurePublicChatSessionSchema(db);
	const userId = String(input.userId || "").trim();
	const sessionId = String(input.sessionId || "").trim();
	const sessionKey = normalizePublicChatSessionKey(input.sessionKey);
	const workflowKey = String(input.workflowKey || "").trim().toLowerCase();
	const requestKind = String(input.requestKind || "").trim();
	const outputMode = String(input.outputMode || "").trim();
	const turnVerdict = String(input.turnVerdict || "").trim() as PublicChatTurnVerdict;
	const runOutcome = String(input.runOutcome || "").trim() as PublicChatRunOutcome;
	if (!userId || !sessionId || !sessionKey || !workflowKey || !requestKind || !outputMode) return;
	await execute(
		db,
		`INSERT INTO public_chat_turn_runs (
      id, user_id, session_id, request_id, session_key, project_id, book_id, chapter_id, label, workflow_key, request_kind,
      user_message_id, assistant_message_id, output_mode, turn_verdict,
      turn_verdict_reasons_json, run_outcome, agent_decision_json,
      tool_status_summary_json, diagnostic_flags_json, canvas_plan_json,
      asset_count, canvas_write, run_ms, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			input.id,
			userId,
			sessionId,
			input.requestId?.trim() || null,
			sessionKey,
			input.projectId?.trim() || null,
			input.bookId?.trim() || null,
			input.chapterId?.trim() || null,
			input.label?.trim() || null,
			workflowKey,
			requestKind,
			input.userMessageId?.trim() || null,
			input.assistantMessageId?.trim() || null,
			outputMode,
			turnVerdict,
			input.turnVerdictReasonsJson,
			runOutcome,
			input.agentDecisionJson ?? null,
			input.toolStatusSummaryJson ?? null,
			input.diagnosticFlagsJson ?? null,
			input.canvasPlanJson ?? null,
			Math.max(0, Math.trunc(Number(input.assetCount || 0))),
			input.canvasWrite ? 1 : 0,
			typeof input.runMs === "number" && Number.isFinite(input.runMs)
				? Math.max(0, Math.trunc(input.runMs))
				: null,
			input.nowIso,
		],
	);
}

export async function listPublicChatTurnRuns(
	db: PrismaClient,
	input: { userId: string; sessionId: string; limit?: number },
): Promise<PublicChatTurnRunRow[]> {
	await ensurePublicChatSessionSchema(db);
	const userId = String(input.userId || "").trim();
	const sessionId = String(input.sessionId || "").trim();
	if (!userId || !sessionId) return [];
	const limit = Number.isFinite(input.limit)
		? Math.max(1, Math.min(100, Math.trunc(Number(input.limit))))
		: 24;
	return queryAll<PublicChatTurnRunRow>(
		db,
		`SELECT * FROM public_chat_turn_runs
     WHERE user_id = ? AND session_id = ?
     ORDER BY created_at ASC
     LIMIT ?`,
		[userId, sessionId, limit],
	);
}

export async function listPublicChatTurnRunsByWorkflow(
	db: PrismaClient,
	input: { userId: string; workflowKey: string; limit?: number },
): Promise<PublicChatTurnRunRow[]> {
	await ensurePublicChatSessionSchema(db);
	const userId = String(input.userId || "").trim();
	const workflowKey = String(input.workflowKey || "").trim().toLowerCase();
	if (!userId || !workflowKey) return [];
	const limit = Number.isFinite(input.limit)
		? Math.max(1, Math.min(200, Math.trunc(Number(input.limit))))
		: 50;
	return queryAll<PublicChatTurnRunRow>(
		db,
		`SELECT * FROM public_chat_turn_runs
     WHERE user_id = ? AND workflow_key = ?
     ORDER BY created_at DESC
     LIMIT ?`,
		[userId, workflowKey, limit],
	);
}

export async function listRecentPublicChatTurnRuns(
	db: PrismaClient,
	input: {
		userId: string;
		projectId?: string;
		bookId?: string;
		chapterId?: string;
		label?: string;
		turnVerdict?: PublicChatTurnVerdict;
		runOutcome?: PublicChatRunOutcome;
		sessionKeyPrefix?: string;
		workflowKey?: string;
		limit?: number;
	},
): Promise<PublicChatTurnRunRow[]> {
	await ensurePublicChatSessionSchema(db);
	const userId = String(input.userId || "").trim();
	if (!userId) return [];
	const sessionKeyPrefix = input.sessionKeyPrefix
		? normalizePublicChatSessionKey(input.sessionKeyPrefix)
		: "";
	const workflowKey = input.workflowKey ? String(input.workflowKey || "").trim().toLowerCase() : "";
	const limit = Number.isFinite(input.limit)
		? Math.max(1, Math.min(200, Math.trunc(Number(input.limit))))
		: 50;
	const whereParts = ["user_id = ?"];
	const params: Array<string | number> = [userId];
	const projectId = input.projectId ? String(input.projectId || "").trim() : "";
	const bookId = input.bookId ? String(input.bookId || "").trim() : "";
	const chapterId = input.chapterId ? String(input.chapterId || "").trim() : "";
	const label = input.label ? String(input.label || "").trim() : "";
	const turnVerdict = input.turnVerdict ? String(input.turnVerdict || "").trim() : "";
	const runOutcome = input.runOutcome ? String(input.runOutcome || "").trim() : "";
	if (projectId && sessionKeyPrefix) {
		whereParts.push("(project_id = ? OR session_key LIKE ?)");
		params.push(projectId, `${sessionKeyPrefix}%`);
	} else if (projectId) {
		whereParts.push("project_id = ?");
		params.push(projectId);
	} else if (sessionKeyPrefix) {
		whereParts.push("session_key LIKE ?");
		params.push(`${sessionKeyPrefix}%`);
	}
	if (bookId) {
		whereParts.push("book_id = ?");
		params.push(bookId);
	}
	if (chapterId) {
		whereParts.push("chapter_id = ?");
		params.push(chapterId);
	}
	if (label) {
		whereParts.push("label = ?");
		params.push(label);
	}
	if (turnVerdict) {
		whereParts.push("turn_verdict = ?");
		params.push(turnVerdict);
	}
	if (runOutcome) {
		whereParts.push("run_outcome = ?");
		params.push(runOutcome);
	}
	if (workflowKey) {
		whereParts.push("workflow_key = ?");
		params.push(workflowKey);
	}
	params.push(limit);
	return queryAll<PublicChatTurnRunRow>(
		db,
		`SELECT * FROM public_chat_turn_runs
     WHERE ${whereParts.join(" AND ")}
     ORDER BY created_at DESC
     LIMIT ?`,
		params,
	);
}
