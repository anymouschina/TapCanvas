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

function isMissingLangGraphSnapshotTable(err: unknown): boolean {
	const msg =
		err instanceof Error
			? err.message
			: typeof err === "string"
				? err
				: "";
	return /no such table:\s*langgraph_project_snapshots/i.test(msg);
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
	const messagesJson =
		typeof payload.messagesJson === "string" ? payload.messagesJson : "";
	if (!messagesJson.trim()) {
		throw new AppError("messagesJson is required", {
			status: 400,
			code: "messages_json_required",
		});
	}

	await assertProjectOwned(c, userId, projectId);

	const nowIso = new Date().toISOString();
	let existing: Pick<LangGraphProjectSnapshotRow, "id"> | null = null;
	try {
		existing = await queryOne<Pick<LangGraphProjectSnapshotRow, "id">>(
			c.env.DB,
			`SELECT id FROM langgraph_project_snapshots WHERE user_id = ? AND project_id = ? LIMIT 1`,
			[userId, projectId],
		);
	} catch (err) {
		if (isMissingLangGraphSnapshotTable(err)) {
			// Best-effort: if the table hasn't been migrated yet, do not block chat.
			return {
				threadId:
					typeof payload.threadId === "string" && payload.threadId.trim()
						? payload.threadId.trim()
						: null,
			};
		}
		throw err;
	}

	const threadId =
		typeof payload.threadId === "string" && payload.threadId.trim()
			? payload.threadId.trim()
			: null;

	if (existing?.id) {
		try {
			await execute(
				c.env.DB,
				`UPDATE langgraph_project_snapshots SET thread_id = ?, messages_json = ?, updated_at = ? WHERE id = ?`,
				[threadId, messagesJson, nowIso, existing.id],
			);
		} catch (err) {
			if (isMissingLangGraphSnapshotTable(err)) return { threadId };
			throw err;
		}
		return { threadId };
	}

	const id = crypto.randomUUID();
	try {
		await execute(
			c.env.DB,
			`INSERT INTO langgraph_project_snapshots
     (id, user_id, project_id, thread_id, messages_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
			[id, userId, projectId, threadId, messagesJson, nowIso, nowIso],
		);
	} catch (err) {
		if (isMissingLangGraphSnapshotTable(err)) return { threadId };
		throw err;
	}

	return { threadId };
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
