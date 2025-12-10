import type { D1Database } from "../../types";
import { queryAll, queryOne, execute } from "../../db/db";

export type ModelProfileRow = {
	id: string;
	owner_id: string;
	provider_id: string;
	name: string;
	kind: string;
	model_key: string;
	settings: string | null;
	created_at: string;
	updated_at: string;
};

export type ModelProfileWithProviderRow = ModelProfileRow & {
	provider_name: string;
	provider_vendor: string;
};

export async function listProfilesForUser(
	db: D1Database,
	userId: string,
	filter?: { providerId?: string; kinds?: string[] },
): Promise<ModelProfileWithProviderRow[]> {
	const where: string[] = ["p.owner_id = ?"];
	const bindings: unknown[] = [userId];

	if (filter?.providerId) {
		where.push("p.provider_id = ?");
		bindings.push(filter.providerId);
	}

	if (filter?.kinds && filter.kinds.length > 0) {
		const placeholders = filter.kinds.map(() => "?").join(", ");
		where.push(`p.kind IN (${placeholders})`);
		bindings.push(...filter.kinds);
	}

	const sql = `
    SELECT
      p.*,
      mp.name AS provider_name,
      mp.vendor AS provider_vendor
    FROM model_profiles p
    JOIN model_providers mp ON mp.id = p.provider_id
    WHERE ${where.join(" AND ")}
    ORDER BY p.created_at ASC
  `;

	return queryAll<ModelProfileWithProviderRow>(db, sql, bindings);
}

export async function getProfileByIdForUser(
	db: D1Database,
	id: string,
	userId: string,
): Promise<ModelProfileRow | null> {
	return queryOne<ModelProfileRow>(
		db,
		`SELECT * FROM model_profiles WHERE id = ? AND owner_id = ?`,
		[id, userId],
	);
}

export async function upsertProfileRow(
	db: D1Database,
	userId: string,
	input: {
		id?: string;
		providerId: string;
		name: string;
		kind: string;
		modelKey: string;
		settings?: unknown;
	},
	nowIso: string,
): Promise<ModelProfileRow> {
	const normalizedName = input.name.trim() || input.modelKey.trim();
	const normalizedModelKey = input.modelKey.trim();
	const settingsJson =
		typeof input.settings === "undefined"
			? null
			: JSON.stringify(input.settings ?? null);

	if (input.id) {
		const existing = await getProfileByIdForUser(db, input.id, userId);
		if (!existing) {
			throw new Error("profile not found or unauthorized");
		}
		await execute(
			db,
			`UPDATE model_profiles
       SET name = ?, kind = ?, model_key = ?, settings = ?, updated_at = ?
       WHERE id = ?`,
			[
				normalizedName,
				input.kind,
				normalizedModelKey,
				settingsJson,
				nowIso,
				input.id,
			],
		);
		const row = await getProfileByIdForUser(db, input.id, userId);
		if (!row) {
			throw new Error("profile update failed");
		}
		return row;
	}

	const id = crypto.randomUUID();
	await execute(
		db,
		`INSERT INTO model_profiles
       (id, owner_id, provider_id, name, kind, model_key, settings, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			id,
			userId,
			input.providerId,
			normalizedName,
			input.kind,
			normalizedModelKey,
			settingsJson,
			nowIso,
			nowIso,
		],
	);
	const row = await getProfileByIdForUser(db, id, userId);
	if (!row) {
		throw new Error("profile create failed");
	}
	return row;
}

export async function deleteProfileRow(
	db: D1Database,
	id: string,
	userId: string,
): Promise<void> {
	const existing = await getProfileByIdForUser(db, id, userId);
	if (!existing) {
		throw new Error("profile not found or unauthorized");
	}
	await execute(db, `DELETE FROM model_profiles WHERE id = ?`, [id]);
}

