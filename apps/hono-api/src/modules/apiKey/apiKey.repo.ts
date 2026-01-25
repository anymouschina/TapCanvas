import type { D1Database } from "../../types";
import { execute, queryAll, queryOne } from "../../db/db";

export type ApiKeyRow = {
	id: string;
	owner_id: string;
	label: string;
	key_prefix: string;
	key_hash: string;
	allowed_origins: string;
	enabled: number;
	last_used_at: string | null;
	created_at: string;
	updated_at: string;
};

export async function listApiKeysForOwner(
	db: D1Database,
	ownerId: string,
): Promise<ApiKeyRow[]> {
	return queryAll<ApiKeyRow>(
		db,
		`SELECT * FROM api_keys WHERE owner_id = ? ORDER BY created_at DESC`,
		[ownerId],
	);
}

export async function getApiKeyByIdForOwner(
	db: D1Database,
	id: string,
	ownerId: string,
): Promise<ApiKeyRow | null> {
	return queryOne<ApiKeyRow>(
		db,
		`SELECT * FROM api_keys WHERE id = ? AND owner_id = ?`,
		[id, ownerId],
	);
}

export async function getApiKeyByHash(
	db: D1Database,
	keyHash: string,
): Promise<ApiKeyRow | null> {
	return queryOne<ApiKeyRow>(
		db,
		`SELECT * FROM api_keys WHERE key_hash = ? LIMIT 1`,
		[keyHash],
	);
}

export async function insertApiKeyRow(
	db: D1Database,
	row: ApiKeyRow,
): Promise<void> {
	await execute(
		db,
		`INSERT INTO api_keys
     (id, owner_id, label, key_prefix, key_hash, allowed_origins, enabled, last_used_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			row.id,
			row.owner_id,
			row.label,
			row.key_prefix,
			row.key_hash,
			row.allowed_origins,
			row.enabled,
			row.last_used_at,
			row.created_at,
			row.updated_at,
		],
	);
}

export async function updateApiKeyRow(
	db: D1Database,
	ownerId: string,
	id: string,
	input: {
		label: string;
		allowedOriginsJson: string;
		enabled: boolean;
	},
	nowIso: string,
): Promise<ApiKeyRow> {
	const existing = await getApiKeyByIdForOwner(db, id, ownerId);
	if (!existing) {
		throw new Error("api key not found or unauthorized");
	}

	await execute(
		db,
		`UPDATE api_keys
     SET label = ?, allowed_origins = ?, enabled = ?, updated_at = ?
     WHERE id = ? AND owner_id = ?`,
		[
			input.label,
			input.allowedOriginsJson,
			input.enabled ? 1 : 0,
			nowIso,
			id,
			ownerId,
		],
	);

	const row = await getApiKeyByIdForOwner(db, id, ownerId);
	if (!row) throw new Error("api key update failed");
	return row;
}

export async function deleteApiKeyRow(
	db: D1Database,
	ownerId: string,
	id: string,
): Promise<void> {
	const existing = await getApiKeyByIdForOwner(db, id, ownerId);
	if (!existing) {
		throw new Error("api key not found or unauthorized");
	}
	await execute(db, `DELETE FROM api_keys WHERE id = ? AND owner_id = ?`, [
		id,
		ownerId,
	]);
}

export async function touchApiKeyLastUsedAt(
	db: D1Database,
	id: string,
	nowIso: string,
): Promise<void> {
	await execute(
		db,
		`UPDATE api_keys SET last_used_at = ? WHERE id = ?`,
		[nowIso, id],
	);
}

