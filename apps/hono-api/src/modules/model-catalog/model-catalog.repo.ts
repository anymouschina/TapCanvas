import type { D1Database } from "../../types";
import { execute, queryAll, queryOne } from "../../db/db";

export type ModelCatalogVendorRow = {
	key: string;
	name: string;
	enabled: number;
	base_url_hint: string | null;
	auth_type: string | null;
	auth_header: string | null;
	auth_query_param: string | null;
	meta: string | null;
	created_at: string;
	updated_at: string;
};

export type ModelCatalogVendorApiKeyRow = {
	vendor_key: string;
	api_key: string;
	enabled: number;
	created_at: string;
	updated_at: string;
};

export type ModelCatalogModelRow = {
	model_key: string;
	vendor_key: string;
	label_zh: string;
	kind: string;
	enabled: number;
	meta: string | null;
	created_at: string;
	updated_at: string;
};

export type ModelCatalogMappingRow = {
	id: string;
	vendor_key: string;
	task_kind: string;
	name: string;
	enabled: number;
	request_mapping: string | null;
	response_mapping: string | null;
	created_at: string;
	updated_at: string;
};

let schemaEnsured = false;

async function ensureModelCatalogModelsTable(db: D1Database): Promise<void> {
	// Create v2 schema for new installs.
	await execute(
		db,
		`CREATE TABLE IF NOT EXISTS model_catalog_models (
      model_key TEXT NOT NULL,
      vendor_key TEXT NOT NULL,
      label_zh TEXT NOT NULL,
      kind TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      meta TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (vendor_key, model_key),
      FOREIGN KEY (vendor_key) REFERENCES model_catalog_vendors(key)
    )`,
	);

	// Detect legacy schema: model_key is PK, vendor_key is not.
	let tableInfo: Array<{ name?: string; pk?: number }> = [];
	try {
		tableInfo = await queryAll(db, `PRAGMA table_info(model_catalog_models)`);
	} catch {
		tableInfo = [];
	}

	const vendorPk =
		tableInfo.find((c) => String(c?.name || "").toLowerCase() === "vendor_key")
			?.pk ?? 0;
	const modelPk =
		tableInfo.find((c) => String(c?.name || "").toLowerCase() === "model_key")
			?.pk ?? 0;

	const hasCompositePk = Number(vendorPk) > 0 && Number(modelPk) > 0;
	const hasLegacyPk = Number(vendorPk) === 0 && Number(modelPk) > 0;
	if (!hasLegacyPk || hasCompositePk) return;

	// Migrate legacy schema -> composite PK on (vendor_key, model_key).
	try {
		// D1/DO SQLite disallow `BEGIN/SAVEPOINT` SQL; use the JS batch API for atomicity.
		await db.batch([
			db.prepare(
				`DROP INDEX IF EXISTS idx_model_catalog_models_vendor_kind`,
			),
			db.prepare(`DROP INDEX IF EXISTS idx_model_catalog_models_enabled`),
			db.prepare(
				`ALTER TABLE model_catalog_models RENAME TO model_catalog_models_legacy`,
			),
			db.prepare(
				`CREATE TABLE model_catalog_models (
        model_key TEXT NOT NULL,
        vendor_key TEXT NOT NULL,
        label_zh TEXT NOT NULL,
        kind TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        meta TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (vendor_key, model_key),
        FOREIGN KEY (vendor_key) REFERENCES model_catalog_vendors(key)
      )`,
			),
			db.prepare(
				`INSERT INTO model_catalog_models
       (vendor_key, model_key, label_zh, kind, enabled, meta, created_at, updated_at)
       SELECT vendor_key, model_key, label_zh, kind, enabled, meta, created_at, updated_at
       FROM model_catalog_models_legacy`,
			),
			db.prepare(`DROP TABLE model_catalog_models_legacy`),
		]);
	} catch (err) {
		throw err;
	}
}

export async function ensureModelCatalogSchema(db: D1Database): Promise<void> {
	if (schemaEnsured) return;

	await execute(
		db,
		`CREATE TABLE IF NOT EXISTS model_catalog_vendors (
      key TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      base_url_hint TEXT,
      auth_type TEXT NOT NULL DEFAULT 'bearer',
      auth_header TEXT,
      auth_query_param TEXT,
      meta TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
	);

	await execute(
		db,
		`CREATE TABLE IF NOT EXISTS model_catalog_vendor_api_keys (
      vendor_key TEXT PRIMARY KEY,
      api_key TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (vendor_key) REFERENCES model_catalog_vendors(key)
    )`,
	);

	await execute(
		db,
		`CREATE TABLE IF NOT EXISTS model_catalog_models (
      model_key TEXT NOT NULL,
      vendor_key TEXT NOT NULL,
      label_zh TEXT NOT NULL,
      kind TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      meta TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (vendor_key, model_key),
      FOREIGN KEY (vendor_key) REFERENCES model_catalog_vendors(key)
    )`,
	);

	await ensureModelCatalogModelsTable(db);

	await execute(
		db,
		`CREATE INDEX IF NOT EXISTS idx_model_catalog_models_vendor_kind
     ON model_catalog_models(vendor_key, kind)`,
	);
	await execute(
		db,
		`CREATE INDEX IF NOT EXISTS idx_model_catalog_models_enabled
     ON model_catalog_models(enabled)`,
	);

	await execute(
		db,
		`CREATE TABLE IF NOT EXISTS model_catalog_mappings (
      id TEXT PRIMARY KEY,
      vendor_key TEXT NOT NULL,
      task_kind TEXT NOT NULL,
      name TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      request_mapping TEXT,
      response_mapping TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (vendor_key) REFERENCES model_catalog_vendors(key),
      UNIQUE (vendor_key, task_kind, name)
    )`,
	);

	await execute(
		db,
		`CREATE INDEX IF NOT EXISTS idx_model_catalog_mappings_vendor_kind
     ON model_catalog_mappings(vendor_key, task_kind)`,
	);

	schemaEnsured = true;
}

export async function listCatalogVendors(
	db: D1Database,
): Promise<ModelCatalogVendorRow[]> {
	await ensureModelCatalogSchema(db);
	return queryAll<ModelCatalogVendorRow>(
		db,
		`SELECT * FROM model_catalog_vendors ORDER BY key ASC`,
	);
}

export async function listCatalogVendorApiKeys(
	db: D1Database,
): Promise<ModelCatalogVendorApiKeyRow[]> {
	await ensureModelCatalogSchema(db);
	return queryAll<ModelCatalogVendorApiKeyRow>(
		db,
		`SELECT * FROM model_catalog_vendor_api_keys ORDER BY vendor_key ASC`,
	);
}

export async function getCatalogVendorApiKeyByVendorKey(
	db: D1Database,
	vendorKey: string,
): Promise<ModelCatalogVendorApiKeyRow | null> {
	await ensureModelCatalogSchema(db);
	return queryOne<ModelCatalogVendorApiKeyRow>(
		db,
		`SELECT * FROM model_catalog_vendor_api_keys WHERE vendor_key = ? LIMIT 1`,
		[vendorKey],
	);
}

export async function upsertCatalogVendorApiKeyRow(
	db: D1Database,
	input: { vendorKey: string; apiKey: string; enabled: boolean },
	nowIso: string,
): Promise<ModelCatalogVendorApiKeyRow> {
	await ensureModelCatalogSchema(db);

	await execute(
		db,
		`INSERT INTO model_catalog_vendor_api_keys
       (vendor_key, api_key, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(vendor_key) DO UPDATE SET
         api_key = excluded.api_key,
         enabled = excluded.enabled,
         updated_at = excluded.updated_at`,
		[input.vendorKey, input.apiKey, input.enabled ? 1 : 0, nowIso, nowIso],
	);

	const row = await getCatalogVendorApiKeyByVendorKey(db, input.vendorKey);
	if (!row) throw new Error("vendor api key upsert failed");
	return row;
}

export async function deleteCatalogVendorApiKeyRow(
	db: D1Database,
	vendorKey: string,
): Promise<void> {
	await ensureModelCatalogSchema(db);
	await execute(
		db,
		`DELETE FROM model_catalog_vendor_api_keys WHERE vendor_key = ?`,
		[vendorKey],
	);
}

export async function getCatalogVendorByKey(
	db: D1Database,
	key: string,
): Promise<ModelCatalogVendorRow | null> {
	await ensureModelCatalogSchema(db);
	return queryOne<ModelCatalogVendorRow>(
		db,
		`SELECT * FROM model_catalog_vendors WHERE key = ? LIMIT 1`,
		[key],
	);
}

export async function upsertCatalogVendorRow(
	db: D1Database,
	input: {
		key: string;
		name: string;
		enabled: boolean;
		baseUrlHint?: string | null;
		authType: string;
		authHeader?: string | null;
		authQueryParam?: string | null;
		meta?: string | null;
	},
	nowIso: string,
): Promise<ModelCatalogVendorRow> {
	await ensureModelCatalogSchema(db);

	await execute(
		db,
		`INSERT INTO model_catalog_vendors
       (key, name, enabled, base_url_hint, auth_type, auth_header, auth_query_param, meta, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         name = excluded.name,
         enabled = excluded.enabled,
         base_url_hint = excluded.base_url_hint,
         auth_type = excluded.auth_type,
         auth_header = excluded.auth_header,
         auth_query_param = excluded.auth_query_param,
         meta = excluded.meta,
         updated_at = excluded.updated_at`,
		[
			input.key,
			input.name,
			input.enabled ? 1 : 0,
			input.baseUrlHint ?? null,
			input.authType,
			input.authHeader ?? null,
			input.authQueryParam ?? null,
			input.meta ?? null,
			nowIso,
			nowIso,
		],
	);

	const row = await getCatalogVendorByKey(db, input.key);
	if (!row) throw new Error("vendor upsert failed");
	return row;
}

export async function deleteCatalogVendorRow(
	db: D1Database,
	key: string,
): Promise<void> {
	await ensureModelCatalogSchema(db);
	await execute(db, `DELETE FROM model_catalog_vendors WHERE key = ?`, [key]);
}

export async function listCatalogModels(
	db: D1Database,
	filter?: { vendorKey?: string; kind?: string; enabled?: boolean },
): Promise<ModelCatalogModelRow[]> {
	await ensureModelCatalogSchema(db);
	const where: string[] = [];
	const bindings: unknown[] = [];

	if (filter?.vendorKey) {
		where.push("vendor_key = ?");
		bindings.push(filter.vendorKey);
	}
	if (filter?.kind) {
		where.push("kind = ?");
		bindings.push(filter.kind);
	}
	if (typeof filter?.enabled === "boolean") {
		where.push("enabled = ?");
		bindings.push(filter.enabled ? 1 : 0);
	}

	const sql = `SELECT * FROM model_catalog_models${
		where.length ? ` WHERE ${where.join(" AND ")}` : ""
	} ORDER BY vendor_key ASC, model_key ASC`;
	return queryAll<ModelCatalogModelRow>(db, sql, bindings);
}

export async function listCatalogModelsByModelKey(
	db: D1Database,
	modelKey: string,
): Promise<ModelCatalogModelRow[]> {
	await ensureModelCatalogSchema(db);
	const mk = String(modelKey || "").trim();
	if (!mk) return [];
	return queryAll<ModelCatalogModelRow>(
		db,
		`SELECT * FROM model_catalog_models WHERE model_key = ? ORDER BY vendor_key ASC`,
		[mk],
	);
}

export async function getCatalogModelByVendorAndKey(
	db: D1Database,
	input: { vendorKey: string; modelKey: string },
): Promise<ModelCatalogModelRow | null> {
	await ensureModelCatalogSchema(db);
	const mk = String(input.modelKey || "").trim();
	const vk = String(input.vendorKey || "").trim().toLowerCase();
	if (!mk || !vk) return null;
	return queryOne<ModelCatalogModelRow>(
		db,
		`SELECT * FROM model_catalog_models WHERE vendor_key = ? AND model_key = ? LIMIT 1`,
		[vk, mk],
	);
}

export async function upsertCatalogModelRow(
	db: D1Database,
	input: {
		modelKey: string;
		vendorKey: string;
		labelZh: string;
		kind: string;
		enabled: boolean;
		meta?: string | null;
	},
	nowIso: string,
): Promise<ModelCatalogModelRow> {
	await ensureModelCatalogSchema(db);

	await execute(
		db,
		`INSERT INTO model_catalog_models
       (model_key, vendor_key, label_zh, kind, enabled, meta, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(vendor_key, model_key) DO UPDATE SET
         label_zh = excluded.label_zh,
         kind = excluded.kind,
         enabled = excluded.enabled,
         meta = excluded.meta,
         updated_at = excluded.updated_at`,
		[
			input.modelKey,
			input.vendorKey,
			input.labelZh,
			input.kind,
			input.enabled ? 1 : 0,
			input.meta ?? null,
			nowIso,
			nowIso,
		],
	);

	const row = await getCatalogModelByVendorAndKey(db, {
		vendorKey: input.vendorKey,
		modelKey: input.modelKey,
	});
	if (!row) throw new Error("model upsert failed");
	return row;
}

export async function deleteCatalogModelRow(
	db: D1Database,
	input: { vendorKey: string; modelKey: string },
): Promise<void> {
	await ensureModelCatalogSchema(db);
	const mk = String(input.modelKey || "").trim();
	const vk = String(input.vendorKey || "").trim().toLowerCase();
	if (!mk || !vk) return;
	await execute(
		db,
		`DELETE FROM model_catalog_models WHERE vendor_key = ? AND model_key = ?`,
		[vk, mk],
	);
}

export async function listCatalogMappings(
	db: D1Database,
	filter?: { vendorKey?: string; taskKind?: string; enabled?: boolean },
): Promise<ModelCatalogMappingRow[]> {
	await ensureModelCatalogSchema(db);
	const where: string[] = [];
	const bindings: unknown[] = [];

	if (filter?.vendorKey) {
		where.push("vendor_key = ?");
		bindings.push(filter.vendorKey);
	}
	if (filter?.taskKind) {
		where.push("task_kind = ?");
		bindings.push(filter.taskKind);
	}
	if (typeof filter?.enabled === "boolean") {
		where.push("enabled = ?");
		bindings.push(filter.enabled ? 1 : 0);
	}

	const sql = `SELECT * FROM model_catalog_mappings${
		where.length ? ` WHERE ${where.join(" AND ")}` : ""
	} ORDER BY vendor_key ASC, task_kind ASC, name ASC`;
	return queryAll<ModelCatalogMappingRow>(db, sql, bindings);
}

export async function getCatalogMappingById(
	db: D1Database,
	id: string,
): Promise<ModelCatalogMappingRow | null> {
	await ensureModelCatalogSchema(db);
	return queryOne<ModelCatalogMappingRow>(
		db,
		`SELECT * FROM model_catalog_mappings WHERE id = ? LIMIT 1`,
		[id],
	);
}

export async function getCatalogMappingByUnique(
	db: D1Database,
	input: { vendorKey: string; taskKind: string; name: string },
): Promise<ModelCatalogMappingRow | null> {
	await ensureModelCatalogSchema(db);
	return queryOne<ModelCatalogMappingRow>(
		db,
		`SELECT * FROM model_catalog_mappings WHERE vendor_key = ? AND task_kind = ? AND name = ? LIMIT 1`,
		[input.vendorKey, input.taskKind, input.name],
	);
}

export async function upsertCatalogMappingRow(
	db: D1Database,
	input: {
		id?: string;
		vendorKey: string;
		taskKind: string;
		name: string;
		enabled: boolean;
		requestMapping?: string | null;
		responseMapping?: string | null;
	},
	nowIso: string,
): Promise<ModelCatalogMappingRow> {
	await ensureModelCatalogSchema(db);

	if (input.id) {
		const existing = await getCatalogMappingById(db, input.id);
		if (!existing) throw new Error("mapping not found");

		await execute(
			db,
			`UPDATE model_catalog_mappings
       SET vendor_key = ?, task_kind = ?, name = ?, enabled = ?, request_mapping = ?, response_mapping = ?, updated_at = ?
       WHERE id = ?`,
			[
				input.vendorKey,
				input.taskKind,
				input.name,
				input.enabled ? 1 : 0,
				input.requestMapping ?? null,
				input.responseMapping ?? null,
				nowIso,
				input.id,
			],
		);

		const row = await getCatalogMappingById(db, input.id);
		if (!row) throw new Error("mapping update failed");
		return row;
	}

	const id = crypto.randomUUID();
	await execute(
		db,
		`INSERT INTO model_catalog_mappings
       (id, vendor_key, task_kind, name, enabled, request_mapping, response_mapping, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(vendor_key, task_kind, name) DO UPDATE SET
         enabled = excluded.enabled,
         request_mapping = excluded.request_mapping,
         response_mapping = excluded.response_mapping,
         updated_at = excluded.updated_at`,
		[
			id,
			input.vendorKey,
			input.taskKind,
			input.name,
			input.enabled ? 1 : 0,
			input.requestMapping ?? null,
			input.responseMapping ?? null,
			nowIso,
			nowIso,
		],
	);

	const row = await getCatalogMappingByUnique(db, {
		vendorKey: input.vendorKey,
		taskKind: input.taskKind,
		name: input.name,
	});
	if (!row) throw new Error("mapping upsert failed");
	return row;
}

export async function deleteCatalogMappingRow(
	db: D1Database,
	id: string,
): Promise<void> {
	await ensureModelCatalogSchema(db);
	await execute(db, `DELETE FROM model_catalog_mappings WHERE id = ?`, [id]);
}
