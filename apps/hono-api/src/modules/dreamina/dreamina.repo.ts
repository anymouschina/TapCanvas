import { randomUUID } from "node:crypto";
import type { PrismaClient } from "../../types";
import { execute, executeWithChanges, queryAll, queryOne } from "../../db/db";

export type DreaminaAccountRow = {
	id: string;
	owner_id: string;
	label: string;
	cli_path: string | null;
	session_root: string;
	enabled: number;
	last_healthcheck_at: string | null;
	last_login_at: string | null;
	last_error: string | null;
	meta_json: string | null;
	created_at: string;
	updated_at: string;
};

export type DreaminaProjectBindingRow = {
	id: string;
	owner_id: string;
	project_id: string;
	account_id: string;
	enabled: number;
	default_model_version: string | null;
	default_ratio: string | null;
	default_resolution_type: string | null;
	default_video_resolution: string | null;
	created_at: string;
	updated_at: string;
};

let schemaEnsured = false;

async function hasColumn(
	db: PrismaClient,
	table: string,
	column: string,
): Promise<boolean> {
	const row = await queryOne<{ count: number }>(
		db,
		"SELECT count(*) AS count FROM information_schema.columns WHERE table_schema = ? AND table_name = ? AND column_name = ?",
		["public", table, column],
	);
	return Number(row?.count || 0) > 0;
}

export async function ensureDreaminaSchema(db: PrismaClient): Promise<void> {
	if (schemaEnsured) return;

	await execute(
		db,
		`CREATE TABLE IF NOT EXISTS dreamina_accounts (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      label TEXT NOT NULL,
      cli_path TEXT,
      session_root TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_healthcheck_at TEXT,
      last_login_at TEXT,
      last_error TEXT,
      meta_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (owner_id) REFERENCES users(id)
    )`,
	);
	await execute(
		db,
		`CREATE INDEX IF NOT EXISTS idx_dreamina_accounts_owner_updated
     ON dreamina_accounts(owner_id, updated_at DESC)`,
	);

	await execute(
		db,
		`CREATE TABLE IF NOT EXISTS dreamina_project_bindings (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      default_model_version TEXT,
      default_ratio TEXT,
      default_resolution_type TEXT,
      default_video_resolution TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (owner_id) REFERENCES users(id),
      FOREIGN KEY (project_id) REFERENCES projects(id),
      FOREIGN KEY (account_id) REFERENCES dreamina_accounts(id)
    )`,
	);
	await execute(
		db,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_dreamina_project_bindings_project
     ON dreamina_project_bindings(project_id)`,
	);
	await execute(
		db,
		`CREATE INDEX IF NOT EXISTS idx_dreamina_project_bindings_owner_updated
     ON dreamina_project_bindings(owner_id, updated_at DESC)`,
	);

	if (!(await hasColumn(db, "dreamina_project_bindings", "default_model_version"))) {
		await execute(
			db,
			`ALTER TABLE dreamina_project_bindings ADD COLUMN default_model_version TEXT`,
		);
	}
	if (!(await hasColumn(db, "dreamina_project_bindings", "default_ratio"))) {
		await execute(
			db,
			`ALTER TABLE dreamina_project_bindings ADD COLUMN default_ratio TEXT`,
		);
	}
	if (
		!(await hasColumn(db, "dreamina_project_bindings", "default_resolution_type"))
	) {
		await execute(
			db,
			`ALTER TABLE dreamina_project_bindings ADD COLUMN default_resolution_type TEXT`,
		);
	}
	if (
		!(await hasColumn(db, "dreamina_project_bindings", "default_video_resolution"))
	) {
		await execute(
			db,
			`ALTER TABLE dreamina_project_bindings ADD COLUMN default_video_resolution TEXT`,
		);
	}

	schemaEnsured = true;
}

export async function listDreaminaAccountsByOwner(
	db: PrismaClient,
	ownerId: string,
): Promise<DreaminaAccountRow[]> {
	await ensureDreaminaSchema(db);
	return await queryAll<DreaminaAccountRow>(
		db,
		`SELECT id, owner_id, label, cli_path, session_root, enabled, last_healthcheck_at, last_login_at, last_error, meta_json, created_at, updated_at
     FROM dreamina_accounts
     WHERE owner_id = ?
     ORDER BY updated_at DESC, created_at DESC`,
		[ownerId],
	);
}

export async function getDreaminaAccountByIdForOwner(
	db: PrismaClient,
	id: string,
	ownerId: string,
): Promise<DreaminaAccountRow | null> {
	await ensureDreaminaSchema(db);
	return await queryOne<DreaminaAccountRow>(
		db,
		`SELECT id, owner_id, label, cli_path, session_root, enabled, last_healthcheck_at, last_login_at, last_error, meta_json, created_at, updated_at
     FROM dreamina_accounts
     WHERE id = ? AND owner_id = ?
     LIMIT 1`,
		[id, ownerId],
	);
}

export async function upsertDreaminaAccountRow(
	db: PrismaClient,
	input: {
		id?: string;
		ownerId: string;
		label: string;
		cliPath: string | null;
		sessionRoot: string;
		enabled: boolean;
		metaJson: string | null;
		nowIso: string;
	},
): Promise<DreaminaAccountRow> {
	await ensureDreaminaSchema(db);
	const id = (input.id || "").trim() || randomUUID();
	const existing = await getDreaminaAccountByIdForOwner(db, id, input.ownerId);
	if (existing) {
		await execute(
			db,
			`UPDATE dreamina_accounts
       SET label = ?, cli_path = ?, session_root = ?, enabled = ?, meta_json = ?, updated_at = ?
       WHERE id = ? AND owner_id = ?`,
			[
				input.label,
				input.cliPath,
				input.sessionRoot,
				input.enabled ? 1 : 0,
				input.metaJson,
				input.nowIso,
				id,
				input.ownerId,
			],
		);
	} else {
		await execute(
			db,
			`INSERT INTO dreamina_accounts (
         id, owner_id, label, cli_path, session_root, enabled, meta_json, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				id,
				input.ownerId,
				input.label,
				input.cliPath,
				input.sessionRoot,
				input.enabled ? 1 : 0,
				input.metaJson,
				input.nowIso,
				input.nowIso,
			],
		);
	}
	const row = await getDreaminaAccountByIdForOwner(db, id, input.ownerId);
	if (!row) throw new Error("dreamina account upsert failed");
	return row;
}

export async function updateDreaminaAccountProbeRow(
	db: PrismaClient,
	input: {
		id: string;
		ownerId: string;
		lastHealthcheckAt: string;
		lastLoginAt?: string | null;
		lastError?: string | null;
	},
): Promise<void> {
	await ensureDreaminaSchema(db);
	await execute(
		db,
		`UPDATE dreamina_accounts
     SET last_healthcheck_at = ?, last_login_at = ?, last_error = ?, updated_at = ?
     WHERE id = ? AND owner_id = ?`,
		[
			input.lastHealthcheckAt,
			input.lastLoginAt ?? null,
			input.lastError ?? null,
			input.lastHealthcheckAt,
			input.id,
			input.ownerId,
		],
	);
}

export async function deleteDreaminaAccountForOwner(
	db: PrismaClient,
	id: string,
	ownerId: string,
): Promise<void> {
	await ensureDreaminaSchema(db);
	await execute(
		db,
		`DELETE FROM dreamina_project_bindings WHERE account_id = ? AND owner_id = ?`,
		[id, ownerId],
	);
	await execute(
		db,
		`DELETE FROM dreamina_accounts WHERE id = ? AND owner_id = ?`,
		[id, ownerId],
	);
}

export async function getDreaminaProjectBindingForOwner(
	db: PrismaClient,
	projectId: string,
	ownerId: string,
): Promise<DreaminaProjectBindingRow | null> {
	await ensureDreaminaSchema(db);
	return await queryOne<DreaminaProjectBindingRow>(
		db,
		`SELECT id, owner_id, project_id, account_id, enabled, default_model_version, default_ratio, default_resolution_type, default_video_resolution, created_at, updated_at
     FROM dreamina_project_bindings
     WHERE project_id = ? AND owner_id = ?
     LIMIT 1`,
		[projectId, ownerId],
	);
}

export async function upsertDreaminaProjectBindingRow(
	db: PrismaClient,
	input: {
		projectId: string;
		ownerId: string;
		accountId: string;
		enabled: boolean;
		defaultModelVersion: string | null;
		defaultRatio: string | null;
		defaultResolutionType: string | null;
		defaultVideoResolution: string | null;
		nowIso: string;
	},
): Promise<DreaminaProjectBindingRow> {
	await ensureDreaminaSchema(db);
	const existing = await getDreaminaProjectBindingForOwner(
		db,
		input.projectId,
		input.ownerId,
	);
	if (existing) {
		await execute(
			db,
			`UPDATE dreamina_project_bindings
       SET account_id = ?, enabled = ?, default_model_version = ?, default_ratio = ?, default_resolution_type = ?, default_video_resolution = ?, updated_at = ?
       WHERE project_id = ? AND owner_id = ?`,
			[
				input.accountId,
				input.enabled ? 1 : 0,
				input.defaultModelVersion,
				input.defaultRatio,
				input.defaultResolutionType,
				input.defaultVideoResolution,
				input.nowIso,
				input.projectId,
				input.ownerId,
			],
		);
	} else {
		await execute(
			db,
			`INSERT INTO dreamina_project_bindings (
         id, owner_id, project_id, account_id, enabled, default_model_version, default_ratio, default_resolution_type, default_video_resolution, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				randomUUID(),
				input.ownerId,
				input.projectId,
				input.accountId,
				input.enabled ? 1 : 0,
				input.defaultModelVersion,
				input.defaultRatio,
				input.defaultResolutionType,
				input.defaultVideoResolution,
				input.nowIso,
				input.nowIso,
			],
		);
	}
	const row = await getDreaminaProjectBindingForOwner(
		db,
		input.projectId,
		input.ownerId,
	);
	if (!row) throw new Error("dreamina project binding upsert failed");
	return row;
}

export async function deleteDreaminaProjectBindingForOwner(
	db: PrismaClient,
	projectId: string,
	ownerId: string,
): Promise<number> {
	await ensureDreaminaSchema(db);
	return await executeWithChanges(
		db,
		`DELETE FROM dreamina_project_bindings WHERE project_id = ? AND owner_id = ?`,
		[projectId, ownerId],
	);
}
