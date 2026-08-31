import fs from "node:fs/promises";
import path from "node:path";
import { execute, queryAll, queryOne } from "../../db/db";
import { resolveProjectDataRepoRoot } from "../asset/project-data-root";
import type { PrismaClient } from "../../types";
import { computeIdentityKeyBackfill } from "./identity-key";
import { analyzeMaterialMigration, type MigrationGroup } from "./material-migration-analyzer";
import type {
	MaterialAssetDto,
	MaterialAssetVersionDto,
	MaterialFolderDto,
	MaterialImpactResponseDto,
	MaterialShotRefDto,
} from "./material.schemas";
import { MaterialKindSchema } from "./material.schemas";

function sanitizeCanvasPathSegment(raw: string): string {
	return String(raw || "").trim().replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
}

function buildCanvasIndexFilePath(projectId: string, ownerId: string): string {
	const repoRoot = resolveProjectDataRepoRoot(process.cwd());
	return path.join(
		repoRoot,
		"project-data",
		"users",
		sanitizeCanvasPathSegment(ownerId),
		"projects",
		sanitizeCanvasPathSegment(projectId),
		"canvas-index.json",
	);
}

export async function writeCanvasIndexRefs(
	projectId: string,
	ownerId: string,
	refs: Array<{
		kind: "character" | "scene";
		name: string;
		imageUrl: string;
		nodeId?: string;
		sourceNodeId?: string;
		prompt?: string;
		modelKey?: string;
		imageSize?: string;
		creationStage?: string;
	}>,
): Promise<void> {
	const indexPath = buildCanvasIndexFilePath(projectId, ownerId);
	let existing: Record<string, unknown> = {};
	try {
		const raw = await fs.readFile(indexPath, "utf8");
		const parsed = JSON.parse(raw) as unknown;
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			existing = parsed as Record<string, unknown>;
		}
	} catch { /* start fresh */ }

	const assets = existing.assets && typeof existing.assets === "object" && !Array.isArray(existing.assets)
		? { ...(existing.assets as Record<string, unknown>) }
		: {};
	const roleCards: Record<string, unknown>[] = Array.isArray(assets.roleCards) ? [...(assets.roleCards as Record<string, unknown>[])] : [];
	const visualRefs: Record<string, unknown>[] = Array.isArray(assets.visualRefs) ? [...(assets.visualRefs as Record<string, unknown>[])] : [];
	const nowIso = new Date().toISOString();

	for (const ref of refs) {
		if (!ref.name.trim() || !ref.imageUrl.trim()) continue;
		const entry: Record<string, unknown> = {
			...(ref.nodeId ? { nodeId: ref.nodeId } : {}),
			...(ref.sourceNodeId ? { sourceNodeId: ref.sourceNodeId } : {}),
			...(ref.prompt ? { prompt: ref.prompt } : {}),
			...(ref.modelKey ? { modelKey: ref.modelKey } : {}),
			...(ref.imageSize ? { imageSize: ref.imageSize } : {}),
			...(ref.creationStage ? { creationStage: ref.creationStage } : {}),
			approvalStatus: "confirmed",
			updatedAt: nowIso,
		};
		if (ref.kind === "character") {
			const idx = roleCards.findIndex(
				(rc) => String(rc.roleName ?? "").trim() === ref.name.trim()
					|| (ref.nodeId && String(rc.nodeId ?? "").trim() === ref.nodeId),
			);
			const next = { roleName: ref.name, imageUrl: ref.imageUrl, url: ref.imageUrl, ...entry };
			if (idx >= 0) roleCards[idx] = { ...roleCards[idx], ...next };
			else roleCards.push(next);
		} else {
			const idx = visualRefs.findIndex(
				(vr) => String(vr.label ?? "").trim() === ref.name.trim()
					|| (ref.nodeId && String(vr.nodeId ?? "").trim() === ref.nodeId),
			);
			const next = { label: ref.name, kind: "scene", referenceType: "scene", imageUrl: ref.imageUrl, url: ref.imageUrl, ...entry };
			if (idx >= 0) visualRefs[idx] = { ...visualRefs[idx], ...next };
			else visualRefs.push(next);
		}
	}

	const next: Record<string, unknown> = {
		...existing,
		assets: { ...assets, roleCards: roleCards.slice(-200), visualRefs: visualRefs.slice(-400) },
		updatedAt: nowIso,
	};
	await fs.mkdir(path.dirname(indexPath), { recursive: true });
	await fs.writeFile(indexPath, JSON.stringify(next, null, 2), "utf8");
}

/**
 * 项目级「全局风格图」读写（落在 canvas-index.json 顶层 styleImages 字段）。
 * 这是画布所有图片节点共享的风格锁来源：前端 picker、agent set-style 工具、出图回退三方读写同一处，
 * 取代原先只存浏览器 localStorage（换设备/会话即丢、agent 写不了）的项目风格设置。
 */
export async function readCanvasIndexStyleImages(
	projectId: string,
	ownerId: string,
): Promise<string[]> {
	const indexPath = buildCanvasIndexFilePath(projectId, ownerId);
	try {
		const raw = await fs.readFile(indexPath, "utf8");
		const parsed = JSON.parse(raw) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
		const items = (parsed as Record<string, unknown>).styleImages;
		if (!Array.isArray(items)) return [];
		const out: string[] = [];
		const seen = new Set<string>();
		for (const item of items) {
			const url = typeof item === "string" ? item.trim() : "";
			if (!url || !/^https?:\/\//i.test(url) || seen.has(url)) continue;
			seen.add(url);
			out.push(url);
			if (out.length >= 8) break;
		}
		return out;
	} catch {
		return [];
	}
}

export async function writeCanvasIndexStyleImages(
	projectId: string,
	ownerId: string,
	styleImages: string[],
): Promise<string[]> {
	const indexPath = buildCanvasIndexFilePath(projectId, ownerId);
	let existing: Record<string, unknown> = {};
	try {
		const raw = await fs.readFile(indexPath, "utf8");
		const parsed = JSON.parse(raw) as unknown;
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			existing = parsed as Record<string, unknown>;
		}
	} catch { /* start fresh */ }

	const normalized: string[] = [];
	const seen = new Set<string>();
	for (const item of Array.isArray(styleImages) ? styleImages : []) {
		const url = typeof item === "string" ? item.trim() : "";
		if (!url || !/^https?:\/\//i.test(url) || seen.has(url)) continue;
		seen.add(url);
		normalized.push(url);
		if (normalized.length >= 8) break;
	}

	const next: Record<string, unknown> = {
		...existing,
		styleImages: normalized,
		updatedAt: new Date().toISOString(),
	};
	await fs.mkdir(path.dirname(indexPath), { recursive: true });
	await fs.writeFile(indexPath, JSON.stringify(next, null, 2), "utf8");
	return normalized;
}

/**
 * 项目级「锁定风格」元数据（canvas-index.json 顶层 styleLock 字段）。
 * 与 styleImages 并列共存：styleImages 承载实际风格图（agent/出图回退三方读），
 * styleLock 承载前端 chip 渲染所需的单选元信息（预设 id/名字/自定义文字风格/分类）。
 */
export type CanvasIndexStyleLock = {
	styleId: string;
	styleName: string;
	stylePrompt: string;
	category?: string;
};

function normalizeStyleLock(raw: unknown): CanvasIndexStyleLock | null {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
	const obj = raw as Record<string, unknown>;
	const styleId = typeof obj.styleId === "string" ? obj.styleId.trim().slice(0, 200) : "";
	if (!styleId) return null;
	const styleName = typeof obj.styleName === "string" ? obj.styleName.trim().slice(0, 200) : "";
	const stylePrompt =
		typeof obj.stylePrompt === "string" ? obj.stylePrompt.trim().slice(0, 4000) : "";
	const category = typeof obj.category === "string" ? obj.category.trim().slice(0, 40) : "";
	return { styleId, styleName, stylePrompt, ...(category ? { category } : {}) };
}

export async function readCanvasIndexStyleLock(
	projectId: string,
	ownerId: string,
): Promise<CanvasIndexStyleLock | null> {
	const indexPath = buildCanvasIndexFilePath(projectId, ownerId);
	try {
		const raw = await fs.readFile(indexPath, "utf8");
		const parsed = JSON.parse(raw) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
		return normalizeStyleLock((parsed as Record<string, unknown>).styleLock);
	} catch {
		return null;
	}
}

export async function writeCanvasIndexStyleLock(
	projectId: string,
	ownerId: string,
	styleLock: CanvasIndexStyleLock | null,
): Promise<CanvasIndexStyleLock | null> {
	const indexPath = buildCanvasIndexFilePath(projectId, ownerId);
	let existing: Record<string, unknown> = {};
	try {
		const raw = await fs.readFile(indexPath, "utf8");
		const parsed = JSON.parse(raw) as unknown;
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			existing = parsed as Record<string, unknown>;
		}
	} catch { /* start fresh */ }

	const normalized = normalizeStyleLock(styleLock);
	const next: Record<string, unknown> = {
		...existing,
		styleLock: normalized,
		updatedAt: new Date().toISOString(),
	};
	await fs.mkdir(path.dirname(indexPath), { recursive: true });
	await fs.writeFile(indexPath, JSON.stringify(next, null, 2), "utf8");
	return normalized;
}

/**
 * 项目级「摄像机规格」（canvas-index.json 顶层 cinematicCamera 字段）。
 * 与 styleImages/styleLock 并列：前端摄像机 chip 写、agent 出图（generate-image-to-canvas）读并
 * 自动拼进 prompt，取代原先只存浏览器 localStorage（换设备即丢、agent 不可见）的摄像机设置。
 * 字段形状与前端 CameraControlPanel.tsx 的 CinematicCameraValue 同构——两处改动必须同步。
 */
export type CanvasIndexCinematicCamera = {
	enabled: boolean;
	cameraKey: string;
	lensKey: string;
	focalKey: string;
	apertureKey: string;
};

function normalizeCinematicCamera(raw: unknown): CanvasIndexCinematicCamera | null {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
	const obj = raw as Record<string, unknown>;
	if (obj.enabled !== true) return null;
	const pick = (k: string) =>
		typeof obj[k] === "string" ? (obj[k] as string).trim().slice(0, 60) : "";
	const cam = {
		enabled: true as const,
		cameraKey: pick("cameraKey"),
		lensKey: pick("lensKey"),
		focalKey: pick("focalKey"),
		apertureKey: pick("apertureKey"),
	};
	if (!cam.cameraKey && !cam.lensKey && !cam.focalKey && !cam.apertureKey) return null;
	return cam;
}

export async function readCanvasIndexCinematicCamera(
	projectId: string,
	ownerId: string,
): Promise<CanvasIndexCinematicCamera | null> {
	const indexPath = buildCanvasIndexFilePath(projectId, ownerId);
	try {
		const raw = await fs.readFile(indexPath, "utf8");
		const parsed = JSON.parse(raw) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
		return normalizeCinematicCamera((parsed as Record<string, unknown>).cinematicCamera);
	} catch {
		return null;
	}
}

export async function writeCanvasIndexCinematicCamera(
	projectId: string,
	ownerId: string,
	cinematicCamera: CanvasIndexCinematicCamera | null,
): Promise<CanvasIndexCinematicCamera | null> {
	const indexPath = buildCanvasIndexFilePath(projectId, ownerId);
	let existing: Record<string, unknown> = {};
	try {
		const raw = await fs.readFile(indexPath, "utf8");
		const parsed = JSON.parse(raw) as unknown;
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			existing = parsed as Record<string, unknown>;
		}
	} catch { /* start fresh */ }

	const normalized = normalizeCinematicCamera(cinematicCamera);
	const next: Record<string, unknown> = {
		...existing,
		cinematicCamera: normalized,
		updatedAt: new Date().toISOString(),
	};
	await fs.mkdir(path.dirname(indexPath), { recursive: true });
	await fs.writeFile(indexPath, JSON.stringify(next, null, 2), "utf8");
	return normalized;
}

/**
 * 项目级「导演人格」（canvas-index.json 顶层 directorPersona 字段）。
 * 与 styleImages（画风锚）正交：画风管"长什么样"，导演人格管"怎么拍"（filmBible.directorTone 的选型锚）。
 * 前端「选导演」picker 写、agents-bridge 每轮对话读并注入锁定块；personaId 对应
 * knowledge/作者导演美学/<personaId>.md 知识卡（单一真相源，此处只存指针不存卡内容）。
 */
export type CanvasIndexDirectorPersona = {
	personaId: string;
	personaName: string;
};

function normalizeDirectorPersona(raw: unknown): CanvasIndexDirectorPersona | null {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
	const obj = raw as Record<string, unknown>;
	const personaId = typeof obj.personaId === "string" ? obj.personaId.trim().slice(0, 200) : "";
	if (!personaId) return null;
	const personaName =
		typeof obj.personaName === "string" ? obj.personaName.trim().slice(0, 200) : "";
	return { personaId, personaName };
}

export async function readCanvasIndexDirectorPersona(
	projectId: string,
	ownerId: string,
): Promise<CanvasIndexDirectorPersona | null> {
	const indexPath = buildCanvasIndexFilePath(projectId, ownerId);
	try {
		const raw = await fs.readFile(indexPath, "utf8");
		const parsed = JSON.parse(raw) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
		return normalizeDirectorPersona((parsed as Record<string, unknown>).directorPersona);
	} catch {
		return null;
	}
}

export async function writeCanvasIndexDirectorPersona(
	projectId: string,
	ownerId: string,
	persona: CanvasIndexDirectorPersona | null,
): Promise<CanvasIndexDirectorPersona | null> {
	const indexPath = buildCanvasIndexFilePath(projectId, ownerId);
	let existing: Record<string, unknown> = {};
	try {
		const raw = await fs.readFile(indexPath, "utf8");
		const parsed = JSON.parse(raw) as unknown;
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			existing = parsed as Record<string, unknown>;
		}
	} catch { /* start fresh */ }

	const normalized = normalizeDirectorPersona(persona);
	const next: Record<string, unknown> = {
		...existing,
		directorPersona: normalized,
		updatedAt: new Date().toISOString(),
	};
	await fs.mkdir(path.dirname(indexPath), { recursive: true });
	await fs.writeFile(indexPath, JSON.stringify(next, null, 2), "utf8");
	return normalized;
}

type MaterialAssetRow = {
	id: string;
	owner_id: string;
	project_id: string;
	team_id: string | null;
	folder_id: string | null;
	is_favorite: number | null;
	kind: string;
	name: string;
	current_version: number;
	created_at: string;
	updated_at: string;
	identity_key?: string | null;
	identity_locked_at?: string | null;
	style_lock_id?: string | null;
};

type MaterialFolderRow = {
	id: string;
	project_id: string | null;
	team_id: string | null;
	owner_id: string | null;
	name: string;
	created_at: string;
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

export const OFFICIAL_MATERIAL_OWNER_ID = "__tapcanvas_official__";

export function resolveMaterialScope(input: {
	ownerId: string | null;
	teamId: string | null;
}): "official" | "personal" | "team" {
	if (input.ownerId === OFFICIAL_MATERIAL_OWNER_ID) return "official";
	return input.teamId ? "team" : "personal";
}

export function parseMaterialAssetKind(value: string): MaterialAssetDto["kind"] {
	const parsed = MaterialKindSchema.safeParse(value);
	if (!parsed.success) {
		throw new Error(`material_asset_kind_invalid: ${value}`);
	}
	return parsed.data;
}

function toMaterialAssetDto(row: MaterialAssetRow): MaterialAssetDto {
	return {
		id: row.id,
		projectId: row.project_id,
		teamId: row.team_id ?? null,
		folderId: row.folder_id ?? null,
		scope: resolveMaterialScope({ ownerId: row.owner_id, teamId: row.team_id }),
		kind: parseMaterialAssetKind(row.kind),
		name: row.name,
		favorite: Number(row.is_favorite || 0) === 1,
		currentVersion: Math.max(1, Math.trunc(Number(row.current_version || 1))),
		latestVersion: null,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function toMaterialFolderDto(row: MaterialFolderRow): MaterialFolderDto {
	return {
		id: row.id,
		projectId: row.project_id ?? null,
		teamId: row.team_id ?? null,
		ownerId: row.owner_id ?? null,
		scope: resolveMaterialScope({ ownerId: row.owner_id, teamId: row.team_id }),
		name: row.name,
		createdAt: row.created_at,
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
	// Migrate: add team_id and folder_id columns to material_assets (safe, idempotent)
	try {
		await execute(db, `ALTER TABLE material_assets ADD COLUMN team_id TEXT`);
	} catch { /* column already exists */ }
	try {
		await execute(db, `ALTER TABLE material_assets ADD COLUMN folder_id TEXT`);
	} catch { /* column already exists */ }
	try {
		await execute(db, `ALTER TABLE material_assets ADD COLUMN is_favorite INTEGER DEFAULT 0`);
	} catch { /* column already exists */ }
	await execute(
		db,
		`CREATE INDEX IF NOT EXISTS idx_material_assets_team_id
		 ON material_assets(team_id, kind, updated_at DESC)`,
	);
	// Material folders table
	await execute(
		db,
		`CREATE TABLE IF NOT EXISTS material_folders (
			id TEXT PRIMARY KEY,
			project_id TEXT,
			team_id TEXT,
			name TEXT NOT NULL,
			created_at TEXT NOT NULL
		)`,
	);
	await execute(
		db,
		`CREATE INDEX IF NOT EXISTS idx_material_folders_project
		 ON material_folders(project_id)`,
	);
	await execute(
		db,
		`CREATE INDEX IF NOT EXISTS idx_material_folders_team
		 ON material_folders(team_id)`,
	);
	// Personal materials are owner-scoped (cross-project); team materials remain team-scoped.
	try {
		await execute(db, `ALTER TABLE material_folders ADD COLUMN owner_id TEXT`);
	} catch { /* column already exists */ }
	await execute(
		db,
		`CREATE INDEX IF NOT EXISTS idx_material_folders_owner
		 ON material_folders(owner_id)`,
	);
	// One-time backfill: owner_id from projects table for legacy personal folders.
	await execute(
		db,
		`UPDATE material_folders
		 SET owner_id = (SELECT owner_id FROM projects WHERE projects.id = material_folders.project_id)
		 WHERE owner_id IS NULL AND project_id IS NOT NULL AND team_id IS NULL`,
	);
	await execute(
		db,
		`CREATE INDEX IF NOT EXISTS idx_material_assets_owner_kind
		 ON material_assets(owner_id, kind, updated_at DESC)`,
	);
	// 状态继承根治 P0：身份键 + 显式锁 + 画风快照列（幂等）。
	await execute(db, `ALTER TABLE material_assets ADD COLUMN IF NOT EXISTS identity_key TEXT`);
	await execute(db, `ALTER TABLE material_assets ADD COLUMN IF NOT EXISTS identity_locked_at TEXT`);
	await execute(db, `ALTER TABLE material_assets ADD COLUMN IF NOT EXISTS style_lock_id TEXT`);
	// 回填既有行 identity_key（仅当为空时，幂等）。精确规范化由后续 backfill 覆盖。
	await execute(db, `UPDATE material_assets SET identity_key = TRIM(name) WHERE identity_key IS NULL OR identity_key = ''`);
	// 非唯一索引（UNIQUE 约束推迟到去重迁移 P4）。
	await execute(db, `CREATE INDEX IF NOT EXISTS idx_material_assets_identity
	 ON material_assets(project_id, kind, identity_key)`);
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

export function rewriteClonedMaterialValue(
	value: unknown,
	input: Readonly<{
		sourceProjectId: string;
		targetProjectId: string;
		assetIdMapping: ReadonlyMap<string, string>;
	}>,
): unknown {
	if (typeof value === "string") {
		if (value === input.sourceProjectId) return input.targetProjectId;
		return input.assetIdMapping.get(value) ?? value;
	}
	if (Array.isArray(value)) return value.map((entry) => rewriteClonedMaterialValue(entry, input));
	if (!value || typeof value !== "object") return value;
	return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
		key,
		rewriteClonedMaterialValue(entry, input),
	]));
}

/**
 * Clone the project-scoped material identity graph together with every immutable
 * version. A project clone without this graph looks visually populated in its
 * copied canvases but loses the stable asset IDs consumed by Workflow IR, which
 * causes paid media workflows to regenerate assets. IDs are deliberately
 * remapped; URLs and provider provenance remain immutable evidence.
 */
export async function cloneProjectMaterialAssets(
	db: D1Database,
	input: Readonly<{
		sourceProjectId: string;
		targetProjectId: string;
		targetOwnerId: string;
		nowIso: string;
		replaceExisting?: boolean;
	}>,
): Promise<ReadonlyMap<string, string>> {
	if (input.sourceProjectId === input.targetProjectId) {
		throw new Error("material_clone_source_target_conflict");
	}
	await ensureMaterialSchema(db);
	if (input.replaceExisting) {
		// Replay clones are exact refreshes. Clear only the target project's
		// dependent references and immutable versions before rebuilding its
		// material graph; otherwise every eval refresh silently accumulates stale
		// identities that can be selected by the next paid workflow.
		await execute(
			db,
			`DELETE FROM shot_material_refs WHERE project_id = ? AND owner_id = ?`,
			[input.targetProjectId, input.targetOwnerId],
		);
		await execute(
			db,
			`DELETE FROM material_asset_versions WHERE project_id = ? AND owner_id = ?`,
			[input.targetProjectId, input.targetOwnerId],
		);
		await execute(
			db,
			`DELETE FROM material_assets WHERE project_id = ? AND owner_id = ?`,
			[input.targetProjectId, input.targetOwnerId],
		);
	}
	const sourceAssets = await queryAll<MaterialAssetRow>(
		db,
		`SELECT * FROM material_assets WHERE project_id = ? ORDER BY created_at ASC, id ASC`,
		[input.sourceProjectId],
	);
	if (sourceAssets.length === 0) return new Map();
	const assetIdMapping = new Map(sourceAssets.map((asset) => [asset.id, crypto.randomUUID()] as const));
	const placeholders = sourceAssets.map(() => "?").join(", ");
	const versions = await queryAll<MaterialVersionRow>(
		db,
		`SELECT * FROM material_asset_versions
		 WHERE asset_id IN (${placeholders})
		 ORDER BY asset_id ASC, version ASC`,
		sourceAssets.map((asset) => asset.id),
	);
	for (const sourceAsset of sourceAssets) {
		const targetAssetId = assetIdMapping.get(sourceAsset.id);
		if (!targetAssetId) throw new Error(`material_clone_asset_mapping_missing: ${sourceAsset.id}`);
		await execute(
			db,
			`INSERT INTO material_assets (
				id, owner_id, project_id, team_id, folder_id, is_favorite,
				kind, name, current_version, identity_key, identity_locked_at,
				style_lock_id, created_at, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				targetAssetId,
				input.targetOwnerId,
				input.targetProjectId,
				null,
				null,
				sourceAsset.is_favorite ?? 0,
				sourceAsset.kind,
				sourceAsset.name,
				sourceAsset.current_version,
				sourceAsset.identity_key?.trim() || sourceAsset.name.trim(),
				sourceAsset.identity_locked_at ?? null,
				sourceAsset.style_lock_id
					? (assetIdMapping.get(sourceAsset.style_lock_id) ?? sourceAsset.style_lock_id)
					: null,
				input.nowIso,
				input.nowIso,
			],
		);
	}
	for (const sourceVersion of versions) {
		const targetAssetId = assetIdMapping.get(sourceVersion.asset_id);
		if (!targetAssetId) throw new Error(`material_clone_version_mapping_missing: ${sourceVersion.asset_id}`);
		let parsedData: unknown;
		try {
			parsedData = JSON.parse(sourceVersion.data_json) as unknown;
		} catch (error: unknown) {
			throw new Error(`material_clone_version_json_invalid: ${sourceVersion.id}: ${error instanceof Error ? error.message : String(error)}`);
		}
		const rewrittenData = rewriteClonedMaterialValue(parsedData, {
			sourceProjectId: input.sourceProjectId,
			targetProjectId: input.targetProjectId,
			assetIdMapping,
		});
		await execute(
			db,
			`INSERT INTO material_asset_versions (
				id, asset_id, owner_id, project_id, version, data_json, note, created_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				crypto.randomUUID(),
				targetAssetId,
				input.targetOwnerId,
				input.targetProjectId,
				sourceVersion.version,
				JSON.stringify(rewrittenData),
				sourceVersion.note,
				sourceVersion.created_at,
			],
		);
	}
	return assetIdMapping;
}

export async function createMaterialAsset(
	db: D1Database,
	input: {
		id: string;
		ownerId: string;
		projectId: string;
		kind: "character" | "scene" | "prop" | "style" | "text" | "ensemble" | "pose" | "voice";
		name: string;
		nowIso: string;
		folderId?: string;
	},
): Promise<MaterialAssetDto> {
	await execute(
		db,
		`INSERT INTO material_assets (
			id, owner_id, project_id, folder_id, kind, name, current_version, created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			input.id,
			input.ownerId,
			input.projectId,
			input.folderId ?? null,
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
		projectId?: string;
		kind?: "character" | "scene" | "prop" | "style" | "text" | "ensemble" | "pose" | "voice";
	},
): Promise<MaterialAssetDto[]> {
	// 动态 WHERE：projectId 可选（不传 = 原行为，向后兼容）。
	const conditions = ["owner_id IN (?, ?)", "team_id IS NULL"];
	const params: unknown[] = [input.ownerId, OFFICIAL_MATERIAL_OWNER_ID];
	if (input.projectId) {
		conditions.push("project_id = ?");
		params.push(input.projectId);
	}
	if (input.kind) {
		conditions.push("kind = ?");
		params.push(input.kind);
	}
	const rows = await queryAll<MaterialAssetRow>(
		db,
		`SELECT * FROM material_assets
		 WHERE ${conditions.join(" AND ")}
		 ORDER BY updated_at DESC`,
		params,
	);
	const assets = rows.map(toMaterialAssetDto);
	if (assets.length === 0) return assets;

	const placeholders = assets.map(() => "?").join(", ");
	const versionRows = await queryAll<MaterialVersionRow>(
		db,
		`SELECT * FROM material_asset_versions
		 WHERE asset_id IN (${placeholders})
		   AND version = (
		     SELECT current_version
		     FROM material_assets
		     WHERE id = material_asset_versions.asset_id
		       AND owner_id = material_asset_versions.owner_id
		     LIMIT 1
		   )`,
		assets.map((asset) => asset.id),
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

export async function getMaterialAssetById(
	db: D1Database,
	assetId: string,
): Promise<MaterialAssetDto | null> {
	const row = await queryOne<MaterialAssetRow>(
		db,
		`SELECT * FROM material_assets WHERE id = ? LIMIT 1`,
		[assetId],
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

export async function getMaterialVersionForOwner(
	db: D1Database,
	input: {
		ownerId: string;
		projectId: string;
		versionId: string;
	},
): Promise<MaterialAssetVersionDto | null> {
	const row = await queryOne<MaterialVersionRow>(
		db,
		`SELECT * FROM material_asset_versions
		 WHERE id = ? AND owner_id = ? AND project_id = ?
		 LIMIT 1`,
		[input.versionId, input.ownerId, input.projectId],
	);
	return row ? toVersionDto(row) : null;
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

export async function updateMaterialAsset(
	db: D1Database,
	input: {
		ownerId: string;
		assetId: string;
		name?: string;
		favorite?: boolean;
		nowIso: string;
	},
): Promise<MaterialAssetDto | null> {
	if (input.name) {
		await execute(
			db,
			`UPDATE material_assets SET name = ?, updated_at = ? WHERE id = ? AND owner_id = ?`,
			[input.name, input.nowIso, input.assetId, input.ownerId],
		);
	}
	if (typeof input.favorite === "boolean") {
		await execute(
			db,
			`UPDATE material_assets SET is_favorite = ?, updated_at = ? WHERE id = ? AND owner_id = ?`,
			[input.favorite ? 1 : 0, input.nowIso, input.assetId, input.ownerId],
		);
	}
	return getMaterialAssetForOwner(db, { ownerId: input.ownerId, assetId: input.assetId });
}

export async function deleteMaterialAsset(
	db: D1Database,
	input: {
		ownerId: string;
		assetId: string;
	},
): Promise<void> {
	await execute(
		db,
		`DELETE FROM material_asset_versions WHERE asset_id = ? AND owner_id = ?`,
		[input.assetId, input.ownerId],
	);
	await execute(
		db,
		`DELETE FROM material_assets WHERE id = ? AND owner_id = ?`,
		[input.assetId, input.ownerId],
	);
}

// ── Team material assets ─────────────────────────────────────────────────────

export async function listTeamMaterialAssets(
	db: D1Database,
	input: {
		teamId: string;
		kind?: "character" | "scene" | "prop" | "style" | "text";
	},
): Promise<MaterialAssetDto[]> {
	const rows = input.kind
		? await queryAll<MaterialAssetRow>(
				db,
				`SELECT * FROM material_assets
				 WHERE team_id = ? AND kind = ?
				 ORDER BY updated_at DESC`,
				[input.teamId, input.kind],
			)
		: await queryAll<MaterialAssetRow>(
				db,
				`SELECT * FROM material_assets
				 WHERE team_id = ?
				 ORDER BY updated_at DESC`,
				[input.teamId],
			);
	const assets = rows.map(toMaterialAssetDto);
	if (assets.length === 0) return assets;

	const placeholders = assets.map(() => "?").join(", ");
	const versionRows = await queryAll<MaterialVersionRow>(
		db,
		`SELECT * FROM material_asset_versions
		 WHERE asset_id IN (${placeholders})
		   AND version = (
		     SELECT current_version
		     FROM material_assets
		     WHERE id = material_asset_versions.asset_id
		     LIMIT 1
		   )`,
		assets.map((asset) => asset.id),
	);
	const latestVersionByAssetId = new Map(
		versionRows.map((row) => [row.asset_id, toVersionDto(row)]),
	);
	return assets.map((asset) => ({
		...asset,
		latestVersion: latestVersionByAssetId.get(asset.id) || null,
	}));
}

export async function createTeamMaterialAsset(
	db: D1Database,
	input: {
		id: string;
		teamId: string;
		userId: string;
		kind: "character" | "scene" | "prop" | "style" | "text" | "ensemble" | "pose" | "voice";
		name: string;
		nowIso: string;
		folderId?: string;
	},
): Promise<MaterialAssetDto> {
	await execute(
		db,
		`INSERT INTO material_assets (
			id, owner_id, project_id, team_id, folder_id, kind, name, current_version, created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			input.id,
			input.userId,
			"",
			input.teamId,
			input.folderId ?? null,
			input.kind,
			input.name,
			1,
			input.nowIso,
			input.nowIso,
		],
	);
	const row = await queryOne<MaterialAssetRow>(
		db,
		`SELECT * FROM material_assets WHERE id = ? LIMIT 1`,
		[input.id],
	);
	if (!row) throw new Error("Failed to load created team material asset");
	return toMaterialAssetDto(row);
}

export async function deleteTeamMaterialAsset(
	db: D1Database,
	input: {
		assetId: string;
		teamId: string;
	},
): Promise<void> {
	const row = await queryOne<MaterialAssetRow>(
		db,
		`SELECT * FROM material_assets WHERE id = ? AND team_id = ? LIMIT 1`,
		[input.assetId, input.teamId],
	);
	if (!row) return;
	await execute(
		db,
		`DELETE FROM material_asset_versions WHERE asset_id = ?`,
		[input.assetId],
	);
	await execute(
		db,
		`DELETE FROM material_assets WHERE id = ? AND team_id = ?`,
		[input.assetId, input.teamId],
	);
}

// ── Material folders ─────────────────────────────────────────────────────────

export async function createMaterialFolder(
	db: D1Database,
	input: {
		id: string;
		projectId?: string;
		teamId?: string;
		ownerId?: string;
		name: string;
		createdAt: string;
	},
): Promise<MaterialFolderDto> {
	await execute(
		db,
		`INSERT INTO material_folders (id, project_id, team_id, owner_id, name, created_at)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		[
			input.id,
			input.projectId ?? null,
			input.teamId ?? null,
			input.ownerId ?? null,
			input.name,
			input.createdAt,
		],
	);
	const row = await queryOne<MaterialFolderRow>(
		db,
		`SELECT * FROM material_folders WHERE id = ? LIMIT 1`,
		[input.id],
	);
	if (!row) throw new Error("Failed to load created material folder");
	return toMaterialFolderDto(row);
}

export async function listMaterialFolders(
	db: D1Database,
	input: {
		ownerId?: string;
		teamId?: string;
	},
): Promise<MaterialFolderDto[]> {
	if (input.teamId) {
		const rows = await queryAll<MaterialFolderRow>(
			db,
			`SELECT * FROM material_folders WHERE team_id = ? ORDER BY created_at ASC`,
			[input.teamId],
		);
		return rows.map(toMaterialFolderDto);
	}
	if (input.ownerId) {
		const rows = await queryAll<MaterialFolderRow>(
			db,
			`SELECT * FROM material_folders
			 WHERE owner_id IN (?, ?) AND team_id IS NULL
			 ORDER BY created_at ASC`,
			[input.ownerId, OFFICIAL_MATERIAL_OWNER_ID],
		);
		return rows.map(toMaterialFolderDto);
	}
	return [];
}

export async function deleteMaterialFolder(
	db: D1Database,
	input: {
		id: string;
	},
): Promise<void> {
	await execute(
		db,
		`DELETE FROM material_folders WHERE id = ?`,
		[input.id],
	);
}

export async function getMaterialFolderById(
	db: D1Database,
	id: string,
): Promise<MaterialFolderDto | null> {
	const row = await queryOne<MaterialFolderRow>(
		db,
		`SELECT * FROM material_folders WHERE id = ? LIMIT 1`,
		[id],
	);
	return row ? toMaterialFolderDto(row) : null;
}

// ── 迁移 dry-run（只读，不变更任何数据）────────────────────────────────────────

export async function dryRunMaterialMigration(
	db: D1Database,
	input: { ownerId: string; projectId: string; currentStyleLockId: string | null },
): Promise<MigrationGroup[]> {
	const assets = await listMaterialAssets(db, { ownerId: input.ownerId, projectId: input.projectId });
	return analyzeMaterialMigration({
		currentStyleLockId: input.currentStyleLockId,
		assets: assets.map((a) => ({
			id: a.id,
			kind: a.kind,
			name: a.name,
			updatedAt: a.updatedAt,
			styleLockId:
				a.latestVersion && typeof a.latestVersion.data === "object"
					? (typeof (a.latestVersion.data as Record<string, unknown>).styleLockId === "string"
						? ((a.latestVersion.data as Record<string, unknown>).styleLockId as string)
						: null)
					: null,
		})),
	});
}

// ── 精确 identity_key 回填 ────────────────────────────────────────────────────

export async function backfillIdentityKeys(
	db: D1Database,
	projectId?: string,
): Promise<{ updated: number }> {
	const rows = await queryAll<{ id: string; name: string }>(
		db,
		`SELECT id, name FROM material_assets ${projectId ? "WHERE project_id = ?" : ""}`,
		projectId ? [projectId] : [],
	);
	const mapped = computeIdentityKeyBackfill(rows);
	let updated = 0;
	for (const m of mapped) {
		await execute(db, `UPDATE material_assets SET identity_key = ? WHERE id = ?`, [m.identityKey, m.id]);
		updated += 1;
	}
	return { updated };
}
