import { execute, queryAll, queryOne } from "../../db/db";
import type { PrismaClient } from "../../types";
import type {
	MaterialAssetDto,
	MaterialAssetVersionDto,
	MaterialImpactResponseDto,
	MaterialShotRefDto,
} from "./material.schemas";

type MaterialAssetRow = {
	id: string;
	owner_id: string;
	project_id: string;
	kind: string;
	name: string;
	current_version: number;
	created_at: string;
	updated_at: string;
};

type MaterialVersionRow = {
	id: string;
	asset_id: string;
	owner_id: string;
	project_id: string;
	version: number;
	data_json: string;
	note: string | null;
	created_at: string;
};

type ShotMaterialRefRow = {
	id: string;
	owner_id: string;
	project_id: string;
	shot_id: string;
	asset_id: string;
	asset_version: number;
	created_at: string;
	updated_at: string;
};

type D1Database = PrismaClient;

let materialSchemaEnsured = false;

function toMaterialAssetDto(row: MaterialAssetRow): MaterialAssetDto {
	const kind = row.kind;
	return {
		id: row.id,
		projectId: row.project_id,
		kind:
			kind === "character" || kind === "scene" || kind === "prop" || kind === "style"
				? kind
				: "prop",
		name: row.name,
		currentVersion: Math.max(1, Math.trunc(Number(row.current_version || 1))),
		latestVersion: null,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function toVersionDto(row: MaterialVersionRow): MaterialAssetVersionDto {
	let data: Record<string, unknown> = {};
	try {
		const parsed = JSON.parse(row.data_json);
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			data = parsed as Record<string, unknown>;
		}
	} catch {
		data = {};
	}
	return {
		id: row.id,
		assetId: row.asset_id,
		projectId: row.project_id,
		version: Math.max(1, Math.trunc(Number(row.version || 1))),
		data,
		note: row.note,
		createdAt: row.created_at,
	};
}

function toShotRefDto(row: ShotMaterialRefRow): MaterialShotRefDto {
	return {
		id: row.id,
		projectId: row.project_id,
		shotId: row.shot_id,
		assetId: row.asset_id,
		assetVersion: Math.max(1, Math.trunc(Number(row.asset_version || 1))),
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

export async function ensureMaterialSchema(db: PrismaClient): Promise<void> {
	if (materialSchemaEnsured) return;
	await execute(
		db,
		`CREATE TABLE IF NOT EXISTS material_assets (
			id TEXT PRIMARY KEY,
			owner_id TEXT NOT NULL,
			project_id TEXT NOT NULL,
			kind TEXT NOT NULL,
			name TEXT NOT NULL,
			current_version INTEGER NOT NULL DEFAULT 1,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		)`,
	);
	await execute(
		db,
		`CREATE INDEX IF NOT EXISTS idx_material_assets_owner_project
		 ON material_assets(owner_id, project_id, kind, updated_at DESC)`,
	);
	await execute(
		db,
		`CREATE TABLE IF NOT EXISTS material_asset_versions (
			id TEXT PRIMARY KEY,
			asset_id TEXT NOT NULL,
			owner_id TEXT NOT NULL,
			project_id TEXT NOT NULL,
			version INTEGER NOT NULL,
			data_json TEXT NOT NULL,
			note TEXT,
			created_at TEXT NOT NULL,
			UNIQUE (asset_id, version),
			FOREIGN KEY (asset_id) REFERENCES material_assets(id)
		)`,
	);
	await execute(
		db,
		`CREATE INDEX IF NOT EXISTS idx_material_versions_asset
		 ON material_asset_versions(asset_id, version DESC)`,
	);
	await execute(
		db,
		`CREATE TABLE IF NOT EXISTS shot_material_refs (
			id TEXT PRIMARY KEY,
			owner_id TEXT NOT NULL,
			project_id TEXT NOT NULL,
			shot_id TEXT NOT NULL,
			asset_id TEXT NOT NULL,
			asset_version INTEGER NOT NULL,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			UNIQUE (project_id, shot_id, asset_id),
			FOREIGN KEY (asset_id) REFERENCES material_assets(id)
		)`,
	);
	await execute(
		db,
		`CREATE INDEX IF NOT EXISTS idx_shot_material_refs_owner_project
		 ON shot_material_refs(owner_id, project_id, shot_id)`,
	);
	materialSchemaEnsured = true;
}

export async function ensureProjectOwnership(
	db: D1Database,
	projectId: string,
	ownerId: string,
): Promise<boolean> {
	const row = await queryOne<{ id: string }>(
		db,
		`SELECT id FROM projects WHERE id = ? AND owner_id = ? LIMIT 1`,
		[projectId, ownerId],
	);
	return !!row?.id;
}

export async function createMaterialAsset(
	db: D1Database,
	input: {
		id: string;
		ownerId: string;
		projectId: string;
		kind: "character" | "scene" | "prop" | "style";
		name: string;
		nowIso: string;
	},
): Promise<MaterialAssetDto> {
	await execute(
		db,
		`INSERT INTO material_assets (
			id, owner_id, project_id, kind, name, current_version, created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			input.id,
			input.ownerId,
			input.projectId,
			input.kind,
			input.name,
			1,
			input.nowIso,
			input.nowIso,
		],
	);
	const row = await queryOne<MaterialAssetRow>(
		db,
		`SELECT * FROM material_assets WHERE id = ? AND owner_id = ? LIMIT 1`,
		[input.id, input.ownerId],
	);
	if (!row) throw new Error("Failed to load created material asset");
	return toMaterialAssetDto(row);
}

export async function listMaterialAssets(
	db: D1Database,
	input: {
		ownerId: string;
		projectId: string;
		kind?: "character" | "scene" | "prop" | "style";
	},
): Promise<MaterialAssetDto[]> {
	const rows = input.kind
		? await queryAll<MaterialAssetRow>(
				db,
				`SELECT * FROM material_assets
				 WHERE owner_id = ? AND project_id = ? AND kind = ?
				 ORDER BY updated_at DESC`,
				[input.ownerId, input.projectId, input.kind],
			)
		: await queryAll<MaterialAssetRow>(
				db,
				`SELECT * FROM material_assets
				 WHERE owner_id = ? AND project_id = ?
				 ORDER BY updated_at DESC`,
				[input.ownerId, input.projectId],
			);
	const assets = rows.map(toMaterialAssetDto);
	if (assets.length === 0) return assets;

	const placeholders = assets.map(() => "?").join(", ");
	const versionRows = await queryAll<MaterialVersionRow>(
		db,
		`SELECT * FROM material_asset_versions
		 WHERE owner_id = ?
		   AND asset_id IN (${placeholders})
		   AND version = (
		     SELECT current_version
		     FROM material_assets
		     WHERE id = material_asset_versions.asset_id
		       AND owner_id = material_asset_versions.owner_id
		     LIMIT 1
		   )`,
		[input.ownerId, ...assets.map((asset) => asset.id)],
	);
	const latestVersionByAssetId = new Map(
		versionRows.map((row) => [row.asset_id, toVersionDto(row)]),
	);
	return assets.map((asset) => ({
		...asset,
		latestVersion: latestVersionByAssetId.get(asset.id) || null,
	}));
}

export async function getMaterialAssetForOwner(
	db: D1Database,
	input: {
		ownerId: string;
		assetId: string;
	},
): Promise<MaterialAssetDto | null> {
	const row = await queryOne<MaterialAssetRow>(
		db,
		`SELECT * FROM material_assets WHERE id = ? AND owner_id = ? LIMIT 1`,
		[input.assetId, input.ownerId],
	);
	return row ? toMaterialAssetDto(row) : null;
}

export async function createMaterialVersion(
	db: D1Database,
	input: {
		id: string;
		ownerId: string;
		projectId: string;
		assetId: string;
		version: number;
		data: Record<string, unknown>;
		note: string | null;
		createdAt: string;
	},
): Promise<MaterialAssetVersionDto> {
	await execute(
		db,
		`INSERT INTO material_asset_versions (
			id, asset_id, owner_id, project_id, version, data_json, note, created_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			input.id,
			input.assetId,
			input.ownerId,
			input.projectId,
			input.version,
			JSON.stringify(input.data),
			input.note,
			input.createdAt,
		],
	);
	await execute(
		db,
		`UPDATE material_assets
		 SET current_version = ?, updated_at = ?
		 WHERE id = ? AND owner_id = ?`,
		[input.version, input.createdAt, input.assetId, input.ownerId],
	);
	const row = await queryOne<MaterialVersionRow>(
		db,
		`SELECT * FROM material_asset_versions
		 WHERE id = ? AND owner_id = ? LIMIT 1`,
		[input.id, input.ownerId],
	);
	if (!row) throw new Error("Failed to load created material version");
	return toVersionDto(row);
}

export async function listMaterialVersions(
	db: D1Database,
	input: {
		ownerId: string;
		assetId: string;
		limit: number;
	},
): Promise<MaterialAssetVersionDto[]> {
	const limit = Math.max(1, Math.min(200, Math.floor(input.limit)));
	const rows = await queryAll<MaterialVersionRow>(
		db,
		`SELECT * FROM material_asset_versions
		 WHERE owner_id = ? AND asset_id = ?
		 ORDER BY version DESC
		 LIMIT ?`,
		[input.ownerId, input.assetId, limit],
	);
	return rows.map(toVersionDto);
}

export async function upsertShotMaterialRef(
	db: D1Database,
	input: {
		id: string;
		ownerId: string;
		projectId: string;
		shotId: string;
		assetId: string;
		assetVersion: number;
		nowIso: string;
	},
): Promise<MaterialShotRefDto> {
	await execute(
		db,
		`INSERT INTO shot_material_refs (
			id, owner_id, project_id, shot_id, asset_id, asset_version, created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(project_id, shot_id, asset_id) DO UPDATE SET
			asset_version = excluded.asset_version,
			updated_at = excluded.updated_at`,
		[
			input.id,
			input.ownerId,
			input.projectId,
			input.shotId,
			input.assetId,
			input.assetVersion,
			input.nowIso,
			input.nowIso,
		],
	);
	const row = await queryOne<ShotMaterialRefRow>(
		db,
		`SELECT * FROM shot_material_refs
		 WHERE owner_id = ? AND project_id = ? AND shot_id = ? AND asset_id = ?
		 LIMIT 1`,
		[input.ownerId, input.projectId, input.shotId, input.assetId],
	);
	if (!row) throw new Error("Failed to load shot material ref");
	return toShotRefDto(row);
}

export async function listImpactedShots(
	db: D1Database,
	input: {
		ownerId: string;
		projectId: string;
		assetId?: string;
	},
): Promise<MaterialImpactResponseDto> {
	const rows = input.assetId
		? await queryAll<{
				shot_id: string;
				asset_id: string;
				asset_version: number;
				current_version: number;
			}>(
				db,
				`SELECT
					r.shot_id,
					r.asset_id,
					r.asset_version,
					a.current_version
				 FROM shot_material_refs r
				 INNER JOIN material_assets a ON a.id = r.asset_id
				 WHERE r.owner_id = ? AND r.project_id = ? AND r.asset_id = ?
				 ORDER BY r.updated_at DESC`,
				[input.ownerId, input.projectId, input.assetId],
			)
		: await queryAll<{
				shot_id: string;
				asset_id: string;
				asset_version: number;
				current_version: number;
			}>(
				db,
				`SELECT
					r.shot_id,
					r.asset_id,
					r.asset_version,
					a.current_version
				 FROM shot_material_refs r
				 INNER JOIN material_assets a ON a.id = r.asset_id
				 WHERE r.owner_id = ? AND r.project_id = ?
				 ORDER BY r.updated_at DESC`,
				[input.ownerId, input.projectId],
			);
	return {
		projectId: input.projectId,
		items: rows.map((row) => {
			const boundVersion = Math.max(1, Math.trunc(Number(row.asset_version || 1)));
			const currentVersion = Math.max(
				1,
				Math.trunc(Number(row.current_version || 1)),
			);
			return {
				shotId: row.shot_id,
				assetId: row.asset_id,
				boundVersion,
				currentVersion,
				isOutdated: boundVersion < currentVersion,
			};
		}),
	};
}

export async function listShotMaterialRefs(
	db: D1Database,
	input: {
		ownerId: string;
		projectId: string;
		shotId: string;
	},
): Promise<MaterialShotRefDto[]> {
	const rows = await queryAll<ShotMaterialRefRow>(
		db,
		`SELECT * FROM shot_material_refs
		 WHERE owner_id = ? AND project_id = ? AND shot_id = ?
		 ORDER BY updated_at DESC`,
		[input.ownerId, input.projectId, input.shotId],
	);
	return rows.map(toShotRefDto);
}
