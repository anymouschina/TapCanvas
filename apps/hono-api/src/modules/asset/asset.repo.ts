import type { D1Database } from "../../types";
import { queryAll, queryOne, execute } from "../../db/db";

export type AssetRow = {
	id: string;
	name: string;
	data: string | null;
	owner_id: string;
	project_id: string | null;
	created_at: string;
	updated_at: string;
};

export type PublicAssetRow = AssetRow & {
	owner_login: string | null;
	owner_name: string | null;
	project_name: string | null;
};

export async function findGeneratedAssetBySourceUrl(
	db: D1Database,
	userId: string,
	sourceUrl: string,
): Promise<AssetRow | null> {
	const trimmed = (sourceUrl || "").trim();
	if (!trimmed) return null;

	return queryOne<AssetRow>(
		db,
		`SELECT *
     FROM assets
     WHERE owner_id = ?
       AND json_extract(data, '$.kind') = 'generation'
       AND json_extract(data, '$.sourceUrl') = ?
     ORDER BY created_at DESC
     LIMIT 1`,
		[userId, trimmed],
	);
}

export async function listAssetsForUser(
	db: D1Database,
	userId: string,
	params?: { limit?: number; cursor?: string | null },
): Promise<AssetRow[]> {
	const rawLimit = params?.limit;
	const normalizedLimit =
		typeof rawLimit === "number" && !Number.isNaN(rawLimit) ? rawLimit : 10;
	// 每次最多返回 10 条
	const limit = Math.max(1, Math.min(normalizedLimit, 10));
	const cursor = params?.cursor ? String(params.cursor) : null;

	const args: any[] = [userId];
	let sql = `SELECT * FROM assets WHERE owner_id = ?`;
	if (cursor) {
		sql += ` AND created_at < ?`;
		args.push(cursor);
	}
	// newest first
	sql += ` ORDER BY created_at DESC`;
	if (limit) {
		sql += ` LIMIT ?`;
		args.push(limit);
	}

	return queryAll<AssetRow>(db, sql, args);
}

export async function getAssetByIdForUser(
	db: D1Database,
	id: string,
	userId: string,
): Promise<AssetRow | null> {
	return queryOne<AssetRow>(
		db,
		`SELECT * FROM assets WHERE id = ? AND owner_id = ?`,
		[id, userId],
	);
}

export async function createAssetRow(
	db: D1Database,
	userId: string,
	input: { name: string; data: unknown; projectId?: string | null },
	nowIso: string,
): Promise<AssetRow> {
	const id = crypto.randomUUID();
	await execute(
		db,
		`INSERT INTO assets
     (id, name, data, owner_id, project_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
		[
			id,
			input.name,
			JSON.stringify(input.data ?? null),
			userId,
			input.projectId ?? null,
			nowIso,
			nowIso,
		],
	);
	const row = await getAssetByIdForUser(db, id, userId);
	if (!row) {
		throw new Error("asset create failed");
	}
	return row;
}

export async function updateAssetDataRow(
	db: D1Database,
	userId: string,
	id: string,
	data: unknown,
	nowIso: string,
): Promise<void> {
	await execute(
		db,
		`UPDATE assets SET data = ?, updated_at = ? WHERE id = ? AND owner_id = ?`,
		[JSON.stringify(data ?? null), nowIso, id, userId],
	);
}

export async function renameAssetRow(
	db: D1Database,
	userId: string,
	id: string,
	name: string,
	nowIso: string,
): Promise<AssetRow> {
	const existing = await getAssetByIdForUser(db, id, userId);
	if (!existing) {
		throw new Error("asset not found or unauthorized");
	}
	await execute(
		db,
		`UPDATE assets SET name = ?, updated_at = ? WHERE id = ?`,
		[name, nowIso, id],
	);
	const row = await getAssetByIdForUser(db, id, userId);
	if (!row) {
		throw new Error("asset rename failed");
	}
	return row;
}

export async function deleteAssetRow(
	db: D1Database,
	userId: string,
	id: string,
): Promise<void> {
	const existing = await getAssetByIdForUser(db, id, userId);
	if (!existing) {
		throw new Error("asset not found or unauthorized");
	}
	await execute(db, `DELETE FROM assets WHERE id = ?`, [id]);
}

export async function listPublicAssets(
	db: D1Database,
	params?: { limit?: number },
): Promise<PublicAssetRow[]> {
	const rawLimit = params?.limit;
	const limit =
		typeof rawLimit === "number" && !Number.isNaN(rawLimit)
			? Math.max(1, Math.min(rawLimit, 96))
			: 48;

	return queryAll<PublicAssetRow>(
		db,
		`SELECT a.*, u.login AS owner_login, u.name AS owner_name, p.name AS project_name
     FROM assets a
     LEFT JOIN projects p ON a.project_id = p.id
     LEFT JOIN users u ON u.id = a.owner_id
     ORDER BY a.created_at DESC
     LIMIT ?`,
		[limit],
	);
}
