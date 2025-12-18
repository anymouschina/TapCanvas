import type { AppContext } from "../../types";
import { AppError } from "../../middleware/error";
import { execute, queryOne } from "../../db/db";
import { getProjectById, getProjectForOwner } from "../project/project.repo";

type LangGraphProjectThreadRow = {
	id: string;
	user_id: string;
	project_id: string;
	thread_id: string;
	created_at: string;
	updated_at: string;
};

type LangGraphProjectSnapshotRow = {
	id: string;
	user_id: string;
	project_id: string;
	thread_id: string | null;
	messages_json: string;
	created_at: string;
	updated_at: string;
};

type ParsedSnapshot = { messages: unknown[]; conversation_summary: string };

function parseSnapshotJson(raw: string): ParsedSnapshot | null {
	if (typeof raw !== "string" || !raw.trim()) return null;
	try {
		const parsed = JSON.parse(raw);
		if (Array.isArray(parsed)) {
			return { messages: parsed, conversation_summary: "" };
		}
		if (parsed && typeof parsed === "object") {
			const messages = Array.isArray((parsed as any).messages)
				? ((parsed as any).messages as unknown[])
				: [];
			const summary =
				typeof (parsed as any).conversation_summary === "string"
					? (parsed as any).conversation_summary
					: "";
			return { messages, conversation_summary: summary };
		}
		return null;
	} catch {
		return null;
	}
}

function mergeSnapshotJson(prevRaw: string, nextRaw: string): string {
	const prev = parseSnapshotJson(prevRaw) || { messages: [], conversation_summary: "" };
	const next = parseSnapshotJson(nextRaw) || { messages: [], conversation_summary: "" };

	const seen = new Set<string>();
	const merged: unknown[] = [];

	const keyOf = (m: any): string => {
		const id = m?.id;
		if (typeof id === "string" && id.trim()) return `id:${id.trim()}`;
		try {
			return `raw:${JSON.stringify(m).slice(0, 2000)}`;
		} catch {
			return `raw:${String(m)}`;
		}
	};

	for (const m of prev.messages || []) {
		const k = keyOf(m);
		if (seen.has(k)) continue;
		seen.add(k);
		merged.push(m);
	}
	for (const m of next.messages || []) {
		const k = keyOf(m);
		if (seen.has(k)) continue;
		seen.add(k);
		merged.push(m);
	}

	const summary =
		typeof next.conversation_summary === "string" && next.conversation_summary.trim()
			? next.conversation_summary
			: prev.conversation_summary || "";

	return JSON.stringify({
		messages: merged,
		conversation_summary: summary,
	});
}

function isMissingLangGraphSnapshotTable(err: unknown): boolean {
	const msg =
		err instanceof Error
			? err.message
			: typeof err === "string"
				? err
				: "";
	return /no such table:\s*langgraph_project_snapshots/i.test(msg);
}

async function ensureLangGraphSnapshotTable(db: D1Database): Promise<void> {
	// Keep this in sync with ../../../apps/hono-api/schema.sql
	await execute(
		db,
		`CREATE TABLE IF NOT EXISTS langgraph_project_snapshots (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      thread_id TEXT,
      messages_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      UNIQUE (user_id, project_id)
    )`,
	);
	await execute(
		db,
		`CREATE INDEX IF NOT EXISTS idx_langgraph_project_snapshots_user_project ON langgraph_project_snapshots(user_id, project_id)`,
	);
}

async function assertProjectOwned(
	c: AppContext,
	userId: string,
	projectId: string,
): Promise<void> {
	const project = await getProjectForOwner(c.env.DB, projectId, userId);
	if (!project) {
		throw new AppError("Project not found", {
			status: 404,
			code: "project_not_found",
		});
	}
}

export async function getLangGraphThreadIdForProject(
	c: AppContext,
	userId: string,
	projectId: string,
): Promise<string | null> {
	await assertProjectOwned(c, userId, projectId);
	const row = await queryOne<Pick<LangGraphProjectThreadRow, "thread_id">>(
		c.env.DB,
		`SELECT thread_id FROM langgraph_project_threads WHERE user_id = ? AND project_id = ? LIMIT 1`,
		[userId, projectId],
	);
	return row?.thread_id ?? null;
}

export async function getLangGraphSnapshotForProject(
	c: AppContext,
	userId: string,
	projectId: string,
): Promise<{ threadId: string | null; messagesJson: string } | null> {
	await assertProjectOwned(c, userId, projectId);
	try {
		const row = await queryOne<
			Pick<LangGraphProjectSnapshotRow, "thread_id" | "messages_json">
		>(
			c.env.DB,
			`SELECT thread_id, messages_json FROM langgraph_project_snapshots WHERE user_id = ? AND project_id = ? LIMIT 1`,
			[userId, projectId],
		);
		if (!row?.messages_json) return null;
		return {
			threadId: row.thread_id ?? null,
			messagesJson: row.messages_json,
		};
	} catch (err) {
		// Deploy safety: allow shipping code before the D1 migration lands.
		if (isMissingLangGraphSnapshotTable(err)) return null;
		throw err;
	}
}

export async function upsertLangGraphSnapshotForProject(
	c: AppContext,
	userId: string,
	projectId: string,
	payload: { threadId?: string | null; messagesJson: string },
): Promise<{ threadId: string | null }> {
	const incomingMessagesJson =
		typeof payload.messagesJson === "string" ? payload.messagesJson : "";
	if (!incomingMessagesJson.trim()) {
		throw new AppError("messagesJson is required", {
			status: 400,
			code: "messages_json_required",
		});
	}

	await assertProjectOwned(c, userId, projectId);

	const nowIso = new Date().toISOString();
	let existing:
		| Pick<LangGraphProjectSnapshotRow, "id" | "thread_id" | "messages_json">
		| null = null;
	try {
		existing = await queryOne<
			Pick<LangGraphProjectSnapshotRow, "id" | "thread_id" | "messages_json">
		>(
			c.env.DB,
			`SELECT id, thread_id, messages_json FROM langgraph_project_snapshots WHERE user_id = ? AND project_id = ? LIMIT 1`,
			[userId, projectId],
		);
	} catch (err) {
		if (isMissingLangGraphSnapshotTable(err)) {
			// Self-heal: create the missing table so snapshots become durable without requiring manual migration.
			await ensureLangGraphSnapshotTable(c.env.DB);
			existing = await queryOne<
				Pick<LangGraphProjectSnapshotRow, "id" | "thread_id" | "messages_json">
			>(
				c.env.DB,
				`SELECT id, thread_id, messages_json FROM langgraph_project_snapshots WHERE user_id = ? AND project_id = ? LIMIT 1`,
				[userId, projectId],
			);
		} else {
			throw err;
		}
	}
	const threadId =
		typeof payload.threadId === "string" && payload.threadId.trim()
			? payload.threadId.trim()
			: null;
	const effectiveThreadId = threadId ?? existing?.thread_id ?? null;
	const mergedMessagesJson =
		existing?.messages_json && existing.messages_json.trim()
			? mergeSnapshotJson(existing.messages_json, incomingMessagesJson)
			: incomingMessagesJson;

	if (existing?.id) {
		try {
			await execute(
				c.env.DB,
				`UPDATE langgraph_project_snapshots SET thread_id = ?, messages_json = ?, updated_at = ? WHERE id = ?`,
				[effectiveThreadId, mergedMessagesJson, nowIso, existing.id],
			);
		} catch (err) {
			if (isMissingLangGraphSnapshotTable(err)) {
				await ensureLangGraphSnapshotTable(c.env.DB);
				await execute(
					c.env.DB,
					`UPDATE langgraph_project_snapshots SET thread_id = ?, messages_json = ?, updated_at = ? WHERE id = ?`,
					[effectiveThreadId, mergedMessagesJson, nowIso, existing.id],
				);
			} else {
				throw err;
			}
		}
		return { threadId: effectiveThreadId };
	}

	const id = crypto.randomUUID();
	try {
		await execute(
			c.env.DB,
			`INSERT INTO langgraph_project_snapshots
     (id, user_id, project_id, thread_id, messages_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
			[id, userId, projectId, effectiveThreadId, mergedMessagesJson, nowIso, nowIso],
		);
	} catch (err) {
		if (isMissingLangGraphSnapshotTable(err)) {
			await ensureLangGraphSnapshotTable(c.env.DB);
			await execute(
				c.env.DB,
				`INSERT INTO langgraph_project_snapshots
     (id, user_id, project_id, thread_id, messages_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
				[id, userId, projectId, effectiveThreadId, mergedMessagesJson, nowIso, nowIso],
			);
		} else {
			throw err;
		}
	}

	return { threadId: effectiveThreadId };
}

export async function clearLangGraphSnapshotForProject(
	c: AppContext,
	userId: string,
	projectId: string,
): Promise<void> {
	await assertProjectOwned(c, userId, projectId);
	try {
		await execute(
			c.env.DB,
			`DELETE FROM langgraph_project_snapshots WHERE user_id = ? AND project_id = ?`,
			[userId, projectId],
		);
	} catch (err) {
		if (isMissingLangGraphSnapshotTable(err)) return;
		throw err;
	}
}

export async function setLangGraphThreadIdForProject(
	c: AppContext,
	userId: string,
	projectId: string,
	threadId: string,
): Promise<{ threadId: string }> {
	if (!threadId.trim()) {
		throw new AppError("threadId is required", {
			status: 400,
			code: "thread_id_required",
		});
	}

	await assertProjectOwned(c, userId, projectId);

	const existing = await queryOne<
		Pick<LangGraphProjectThreadRow, "id" | "thread_id">
	>(
		c.env.DB,
		`SELECT id, thread_id FROM langgraph_project_threads WHERE user_id = ? AND project_id = ? LIMIT 1`,
		[userId, projectId],
	);

	const nowIso = new Date().toISOString();
	if (existing?.id) {
		if (existing.thread_id !== threadId) {
			throw new AppError(
				"Thread already set for project; clear it before starting a new conversation",
				{ status: 409, code: "thread_already_set" },
			);
		}
		await execute(
			c.env.DB,
			`UPDATE langgraph_project_threads SET updated_at = ? WHERE id = ?`,
			[nowIso, existing.id],
		);
		return { threadId };
	}

	const id = crypto.randomUUID();
	await execute(
		c.env.DB,
		`INSERT INTO langgraph_project_threads
     (id, user_id, project_id, thread_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
		[id, userId, projectId, threadId, nowIso, nowIso],
	);

	return { threadId };
}

export async function clearLangGraphThreadForProject(
	c: AppContext,
	userId: string,
	projectId: string,
): Promise<void> {
	await assertProjectOwned(c, userId, projectId);
	await execute(
		c.env.DB,
		`DELETE FROM langgraph_project_threads WHERE user_id = ? AND project_id = ?`,
		[userId, projectId],
	);
}

export async function getLangGraphThreadIdForPublicProject(
	c: AppContext,
	projectId: string,
): Promise<string | null> {
	const project = await getProjectById(c.env.DB, projectId);
	if (!project) {
		throw new AppError("Project not found", {
			status: 400,
			code: "project_not_found",
		});
	}
	if (project.is_public !== 1) {
		throw new AppError("Project is not public", {
			status: 403,
			code: "project_not_public",
		});
	}

	const ownerId = project.owner_id;
	if (!ownerId) return null;

	const row = await queryOne<Pick<LangGraphProjectThreadRow, "thread_id">>(
		c.env.DB,
		`SELECT thread_id FROM langgraph_project_threads WHERE user_id = ? AND project_id = ? LIMIT 1`,
		[ownerId, projectId],
	);
	return row?.thread_id ?? null;
}
