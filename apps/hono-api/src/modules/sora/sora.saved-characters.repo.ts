import type { D1Database } from "../../types";
import { execute, queryAll } from "../../db/db";

export type SavedSoraCharacterRow = {
	user_id: string;
	character_id: string;
	username: string;
	permalink: string | null;
	profile_picture_url: string | null;
	source: string;
	created_at: string;
	updated_at: string;
};

let schemaEnsured = false;

export async function ensureSavedSoraCharactersSchema(
	db: D1Database,
): Promise<void> {
	if (schemaEnsured) return;
	await execute(
		db,
		`CREATE TABLE IF NOT EXISTS sora_saved_characters (
      user_id TEXT NOT NULL,
      character_id TEXT NOT NULL,
      username TEXT NOT NULL,
      permalink TEXT,
      profile_picture_url TEXT,
      source TEXT NOT NULL DEFAULT 'comfly',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, character_id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )`,
	);
	await execute(
		db,
		`CREATE INDEX IF NOT EXISTS idx_sora_saved_characters_user_id
     ON sora_saved_characters(user_id)`,
	);
	await execute(
		db,
		`CREATE INDEX IF NOT EXISTS idx_sora_saved_characters_user_username
     ON sora_saved_characters(user_id, username)`,
	);
	await execute(
		db,
		`CREATE INDEX IF NOT EXISTS idx_sora_saved_characters_updated_at
     ON sora_saved_characters(updated_at)`,
	);
	schemaEnsured = true;
}

export async function upsertSavedSoraCharacter(
	db: D1Database,
	userId: string,
	input: {
		characterId: string;
		username: string;
		permalink?: string | null;
		profilePictureUrl?: string | null;
		source?: string;
	},
	nowIso: string,
): Promise<void> {
	await ensureSavedSoraCharactersSchema(db);
	await execute(
		db,
		`INSERT INTO sora_saved_characters
       (user_id, character_id, username, permalink, profile_picture_url, source, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, character_id) DO UPDATE SET
         username = excluded.username,
         permalink = excluded.permalink,
         profile_picture_url = excluded.profile_picture_url,
         source = excluded.source,
         updated_at = excluded.updated_at`,
		[
			userId,
			input.characterId,
			input.username,
			input.permalink ?? null,
			input.profilePictureUrl ?? null,
			input.source || "comfly",
			nowIso,
			nowIso,
		],
	);
}

export async function searchSavedSoraCharacters(
	db: D1Database,
	userId: string,
	input: { query?: string; limit?: number },
): Promise<SavedSoraCharacterRow[]> {
	await ensureSavedSoraCharactersSchema(db);
	const limit =
		typeof input.limit === "number" && Number.isFinite(input.limit)
			? Math.max(1, Math.min(50, Math.floor(input.limit)))
			: 10;
	const query = (input.query || "").trim();
	if (!query) {
		return queryAll<SavedSoraCharacterRow>(
			db,
			`SELECT * FROM sora_saved_characters
       WHERE user_id = ?
       ORDER BY updated_at DESC
       LIMIT ?`,
			[userId, limit],
		);
	}

	return queryAll<SavedSoraCharacterRow>(
		db,
		`SELECT * FROM sora_saved_characters
     WHERE user_id = ?
       AND LOWER(username) LIKE LOWER(?)
     ORDER BY updated_at DESC
     LIMIT ?`,
		[userId, `${query}%`, limit],
	);
}

