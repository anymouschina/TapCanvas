import type { D1Database } from "../../types";

export type ChatSessionRow = {
	id: string; // internal id
	user_id: string;
	session_id: string; // external id
	title: string | null;
	model: string | null;
	provider: string | null;
	created_at: string;
	updated_at: string;
};

export type ChatMessageRow = {
	id: string;
	session_id: string; // internal session id
	role: string;
	content: string | null;
	raw: string | null;
	created_at: string;
};

export async function getChatSessionByExternalId(
	db: D1Database,
	userId: string,
	sessionId: string,
): Promise<ChatSessionRow | null> {
	const row = await db
		.prepare(
			`SELECT * FROM chat_sessions WHERE user_id = ? AND session_id = ? LIMIT 1`,
		)
		.bind(userId, sessionId)
		.first<any>();
	return row ? (row as ChatSessionRow) : null;
}

export async function upsertChatSessionByExternalId(
	db: D1Database,
	userId: string,
	sessionId: string,
	input: {
		title?: string | null;
		model?: string | null;
		provider?: string | null;
		nowIso: string;
	},
): Promise<ChatSessionRow> {
	const existing = await getChatSessionByExternalId(db, userId, sessionId);
	if (existing) {
		await db
			.prepare(
				`UPDATE chat_sessions SET title = COALESCE(?, title), model = COALESCE(?, model), provider = COALESCE(?, provider), updated_at = ? WHERE id = ?`,
			)
			.bind(
				input.title ?? null,
				input.model ?? null,
				input.provider ?? null,
				input.nowIso,
				existing.id,
			)
			.run();
		const updated = await getChatSessionByExternalId(db, userId, sessionId);
		if (!updated) throw new Error("failed to load updated chat session");
		return updated;
	}

	const id = crypto.randomUUID();
	await db
		.prepare(
			`INSERT INTO chat_sessions (id, user_id, session_id, title, model, provider, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.bind(
			id,
			userId,
			sessionId,
			input.title ?? null,
			input.model ?? null,
			input.provider ?? null,
			input.nowIso,
			input.nowIso,
		)
		.run();
	const inserted = await getChatSessionByExternalId(db, userId, sessionId);
	if (!inserted) throw new Error("failed to load inserted chat session");
	return inserted;
}

export async function insertChatMessage(
	db: D1Database,
	sessionInternalId: string,
	input: {
		id: string;
		role: string;
		content?: string | null;
		raw?: any;
		nowIso: string;
	},
): Promise<void> {
	const rawText =
		typeof input.raw === "undefined"
			? null
			: (() => {
					try {
						return JSON.stringify(input.raw);
					} catch {
						return String(input.raw);
					}
				})();

	await db
		.prepare(
			`INSERT INTO chat_messages (id, session_id, role, content, raw, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
		)
		.bind(
			input.id,
			sessionInternalId,
			input.role,
			input.content ?? null,
			rawText,
			input.nowIso,
		)
		.run();
}

export async function listChatSessionsForUser(
	db: D1Database,
	userId: string,
	limit = 50,
): Promise<
	Array<
		ChatSessionRow & {
			last_message: string | null;
		}
	>
> {
	const res = await db
		.prepare(
			`
      SELECT
        s.*,
        (
          SELECT m.content
          FROM chat_messages m
          WHERE m.session_id = s.id
          ORDER BY m.created_at DESC
          LIMIT 1
        ) AS last_message
      FROM chat_sessions s
      WHERE s.user_id = ?
      ORDER BY s.updated_at DESC
      LIMIT ?
    `,
		)
		.bind(userId, Math.max(1, Math.min(200, Math.floor(limit))))
		.all<any>();
	return (res.results || []) as any;
}

export async function listChatMessagesForSession(
	db: D1Database,
	sessionInternalId: string,
	limit = 200,
): Promise<ChatMessageRow[]> {
	const res = await db
		.prepare(
			`SELECT * FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC LIMIT ?`,
		)
		.bind(sessionInternalId, Math.max(1, Math.min(1000, Math.floor(limit))))
		.all<any>();
	return (res.results || []) as any;
}

export async function deleteChatSessionByExternalId(
	db: D1Database,
	userId: string,
	sessionId: string,
): Promise<void> {
	await db
		.prepare(`DELETE FROM chat_sessions WHERE user_id = ? AND session_id = ?`)
		.bind(userId, sessionId)
		.run();
}

export async function renameChatSessionByExternalId(
	db: D1Database,
	userId: string,
	sessionId: string,
	title: string,
	nowIso: string,
): Promise<ChatSessionRow | null> {
	await db
		.prepare(
			`UPDATE chat_sessions SET title = ?, updated_at = ? WHERE user_id = ? AND session_id = ?`,
		)
		.bind(title, nowIso, userId, sessionId)
		.run();
	return getChatSessionByExternalId(db, userId, sessionId);
}

export async function upsertChatMessageRaw(
	db: D1Database,
	sessionInternalId: string,
	messageId: string,
	raw: any,
): Promise<void> {
	const rawText = (() => {
		try {
			return JSON.stringify(raw);
		} catch {
			return String(raw);
		}
	})();
	await db
		.prepare(
			`UPDATE chat_messages SET raw = ? WHERE session_id = ? AND id = ?`,
		)
		.bind(rawText, sessionInternalId, messageId)
		.run();
}

