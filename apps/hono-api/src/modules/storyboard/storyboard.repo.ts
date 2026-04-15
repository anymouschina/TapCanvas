import { execute, queryAll, queryOne } from "../../db/db";
import type { PrismaClient } from "../../types";
import type {
	StoryboardDiagnosticLogDto,
	StoryboardJobStatus,
	StoryboardMetricsDto,
	StoryboardPlanShotInput,
	StoryboardRenderJobDto,
	StoryboardRenderMode,
	StoryboardShotDto,
} from "./storyboard.schemas";

type StoryboardShotRow = {
	id: string;
	owner_id: string;
	project_id: string;
	chapter_id: string | null;
	chunk_index: number;
	shot_index: number;
	title: string | null;
	summary: string | null;
	scene_asset_id: string;
	character_asset_ids: string;
	prop_asset_ids: string;
	camera_plan_json: string;
	lighting_plan_json: string;
	continuity_tail_frame_url: string | null;
	status: string;
	created_at: string;
	updated_at: string;
};

type StoryboardRenderJobRow = {
	id: string;
	owner_id: string;
	project_id: string;
	shot_id: string;
	model_key: string;
	mode: string;
	params_json: string;
	seed: number | null;
	status: string;
	output_video_url: string | null;
	output_last_frame_url: string | null;
	cost_cents: number | null;
	latency_ms: number | null;
	fail_code: string | null;
	fail_reason: string | null;
	based_on_job_id: string | null;
	created_at: string;
	updated_at: string;
};

type StoryboardDiagnosticLogRow = {
	id: string;
	owner_id: string;
	project_id: string;
	shot_id: string | null;
	job_id: string | null;
	stage: string;
	level: string;
	message: string;
	summary_json: string | null;
	created_at: string;
};

let storyboardSchemaEnsured = false;
let storyboardSchemaEnsuring: Promise<void> | null = null;

const STORYBOARD_SCHEMA_LOCK_NAMESPACE = 42001;
const STORYBOARD_SCHEMA_LOCK_KEY = 1;
const SCHEMA_LOCK_RETRY_MS = 25;

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withSchemaLock<T>(
	db: PrismaClient,
	work: () => Promise<T>,
): Promise<T> {
	let locked = false;
	while (!locked) {
		const row = await queryOne<{ locked: boolean }>(
			db,
			"SELECT pg_try_advisory_lock((?)::integer, (?)::integer) AS locked",
			[STORYBOARD_SCHEMA_LOCK_NAMESPACE, STORYBOARD_SCHEMA_LOCK_KEY],
		);
		locked = row?.locked === true;
		if (!locked) await delay(SCHEMA_LOCK_RETRY_MS);
	}
	try {
		return await work();
	} finally {
		await queryOne(
			db,
			"SELECT pg_advisory_unlock((?)::integer, (?)::integer) AS unlocked",
			[STORYBOARD_SCHEMA_LOCK_NAMESPACE, STORYBOARD_SCHEMA_LOCK_KEY],
		);
	}
}

async function hasIndex(db: PrismaClient, indexName: string): Promise<boolean> {
	const row = await queryOne<{ count: number }>(
		db,
		`SELECT count(*) AS count
		 FROM pg_indexes
		 WHERE schemaname = ?
		   AND indexname = ?`,
		["public", indexName],
	);
	return Number(row?.count || 0) > 0;
}

async function ensureIndex(
	db: PrismaClient,
	indexName: string,
	sql: string,
): Promise<void> {
	if (await hasIndex(db, indexName)) return;
	await execute(db, sql);
}

function safeParseJsonObject(value: string): Record<string, unknown> {
	try {
		const parsed = JSON.parse(value);
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}
	} catch {
		// Keep explicit fallback empty object to avoid crashing on malformed legacy rows.
	}
	return {};
}

function safeParseJsonArray(value: string): string[] {
	try {
		const parsed = JSON.parse(value);
		if (!Array.isArray(parsed)) return [];
		return parsed.filter((item): item is string => typeof item === "string");
	} catch {
		return [];
	}
}

function asJobStatus(value: string): StoryboardJobStatus {
	if (value === "queued") return "queued";
	if (value === "running") return "running";
	if (value === "succeeded") return "succeeded";
	if (value === "failed") return "failed";
	return "failed";
}

function asRenderMode(value: string): StoryboardRenderMode {
	if (value === "cost") return "cost";
	if (value === "quality") return "quality";
	return "balanced";
}

function toShotDto(row: StoryboardShotRow): StoryboardShotDto {
	return {
		id: row.id,
		projectId: row.project_id,
		chapterId: row.chapter_id,
		chunkIndex: Number(row.chunk_index || 0),
		shotIndex: Number(row.shot_index || 0),
		title: typeof row.title === "string" && row.title.trim() ? row.title : undefined,
		summary: typeof row.summary === "string" && row.summary.trim() ? row.summary : undefined,
		sceneAssetId: row.scene_asset_id,
		characterAssetIds: safeParseJsonArray(row.character_asset_ids),
		propAssetIds: safeParseJsonArray(row.prop_asset_ids),
		cameraPlan: safeParseJsonObject(row.camera_plan_json),
		lightingPlan: safeParseJsonObject(row.lighting_plan_json),
		continuityTailFrameUrl: row.continuity_tail_frame_url,
		status: asJobStatus(row.status),
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function toRenderJobDto(row: StoryboardRenderJobRow): StoryboardRenderJobDto {
	return {
		id: row.id,
		shotId: row.shot_id,
		projectId: row.project_id,
		modelKey: row.model_key,
		mode: asRenderMode(row.mode),
		params: safeParseJsonObject(row.params_json),
		seed: row.seed == null ? null : Number(row.seed),
		status: asJobStatus(row.status),
		outputVideoUrl: row.output_video_url,
		outputLastFrameUrl: row.output_last_frame_url,
		costCents: row.cost_cents == null ? null : Number(row.cost_cents),
		latencyMs: row.latency_ms == null ? null : Number(row.latency_ms),
		failCode: row.fail_code,
		failReason: row.fail_reason,
		basedOnJobId: row.based_on_job_id,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function toDiagnosticDto(row: StoryboardDiagnosticLogRow): StoryboardDiagnosticLogDto {
	const summary = row.summary_json
		? safeParseJsonObject(row.summary_json)
		: null;
	const level = row.level === "warn" || row.level === "error" ? row.level : "info";
	return {
		id: row.id,
		projectId: row.project_id,
		shotId: row.shot_id,
		jobId: row.job_id,
		stage: row.stage,
		level,
		message: row.message,
		summary,
		createdAt: row.created_at,
	};
}

export async function ensureStoryboardSchema(db: PrismaClient): Promise<void> {
	if (storyboardSchemaEnsured) return;
	if (storyboardSchemaEnsuring) {
		await storyboardSchemaEnsuring;
		return;
	}
	storyboardSchemaEnsuring = withSchemaLock(db, async () => {
		if (storyboardSchemaEnsured) return;
		await execute(
			db,
			`CREATE TABLE IF NOT EXISTS storyboard_assets (
			id TEXT PRIMARY KEY,
			owner_id TEXT NOT NULL,
			project_id TEXT NOT NULL,
			kind TEXT NOT NULL,
			name TEXT NOT NULL,
			version INTEGER NOT NULL DEFAULT 1,
			prompt_pack_id TEXT,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		)`,
		);
		await ensureIndex(
			db,
			"idx_storyboard_assets_owner_project",
			`CREATE INDEX idx_storyboard_assets_owner_project
				ON storyboard_assets(owner_id, project_id, updated_at DESC)`,
		);
		await execute(
			db,
			`CREATE TABLE IF NOT EXISTS storyboard_asset_views (
			id TEXT PRIMARY KEY,
			owner_id TEXT NOT NULL,
			project_id TEXT NOT NULL,
			asset_id TEXT NOT NULL,
			view_kind TEXT NOT NULL,
			image_url TEXT NOT NULL,
			metadata_json TEXT,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			FOREIGN KEY (asset_id) REFERENCES storyboard_assets(id)
		)`,
		);
		await ensureIndex(
			db,
			"idx_storyboard_asset_views_asset_view",
			`CREATE INDEX idx_storyboard_asset_views_asset_view
				ON storyboard_asset_views(asset_id, view_kind)`,
		);
		await execute(
			db,
			`CREATE TABLE IF NOT EXISTS storyboard_shots (
			id TEXT PRIMARY KEY,
			owner_id TEXT NOT NULL,
			project_id TEXT NOT NULL,
			chunk_index INTEGER NOT NULL,
			shot_index INTEGER NOT NULL,
			title TEXT,
			summary TEXT,
			scene_asset_id TEXT NOT NULL,
			character_asset_ids TEXT NOT NULL,
			prop_asset_ids TEXT NOT NULL,
			camera_plan_json TEXT NOT NULL,
			lighting_plan_json TEXT NOT NULL,
			continuity_tail_frame_url TEXT,
			status TEXT NOT NULL,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			UNIQUE (project_id, chunk_index, shot_index)
		)`,
		);
		await ensureIndex(
			db,
			"idx_storyboard_shots_owner_project",
			`CREATE INDEX idx_storyboard_shots_owner_project
				ON storyboard_shots(owner_id, project_id, chunk_index, shot_index)`,
		);
		await execute(
			db,
			`ALTER TABLE storyboard_shots
				ADD COLUMN IF NOT EXISTS chapter_id TEXT`,
		);
		await execute(
			db,
			`ALTER TABLE storyboard_shots
				ADD COLUMN IF NOT EXISTS title TEXT`,
		);
		await execute(
			db,
			`ALTER TABLE storyboard_shots
				ADD COLUMN IF NOT EXISTS summary TEXT`,
		);
		await ensureIndex(
			db,
			"idx_storyboard_shots_project_chapter_shot",
			`CREATE INDEX idx_storyboard_shots_project_chapter_shot
				ON storyboard_shots(project_id, chapter_id, shot_index)`,
		);
		await execute(
			db,
			`CREATE TABLE IF NOT EXISTS storyboard_render_jobs (
			id TEXT PRIMARY KEY,
			owner_id TEXT NOT NULL,
			project_id TEXT NOT NULL,
			shot_id TEXT NOT NULL,
			model_key TEXT NOT NULL,
			mode TEXT NOT NULL,
			params_json TEXT NOT NULL,
			seed INTEGER,
			status TEXT NOT NULL,
			output_video_url TEXT,
			output_last_frame_url TEXT,
			cost_cents INTEGER,
			latency_ms INTEGER,
			fail_code TEXT,
			fail_reason TEXT,
			based_on_job_id TEXT,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			FOREIGN KEY (shot_id) REFERENCES storyboard_shots(id),
			FOREIGN KEY (based_on_job_id) REFERENCES storyboard_render_jobs(id)
		)`,
		);
		await ensureIndex(
			db,
			"idx_storyboard_render_jobs_shot_created",
			`CREATE INDEX idx_storyboard_render_jobs_shot_created
				ON storyboard_render_jobs(shot_id, created_at DESC)`,
		);
		await ensureIndex(
			db,
			"idx_storyboard_render_jobs_owner_project",
			`CREATE INDEX idx_storyboard_render_jobs_owner_project
				ON storyboard_render_jobs(owner_id, project_id, created_at DESC)`,
		);
		await execute(
			db,
			`CREATE TABLE IF NOT EXISTS storyboard_timeline_tracks (
			id TEXT PRIMARY KEY,
			owner_id TEXT NOT NULL,
			project_id TEXT NOT NULL,
			shot_id TEXT NOT NULL,
			active_job_id TEXT NOT NULL,
			position INTEGER NOT NULL DEFAULT 0,
			duration_ms INTEGER NOT NULL DEFAULT 0,
			audio_track_id TEXT,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			UNIQUE (project_id, shot_id),
			FOREIGN KEY (shot_id) REFERENCES storyboard_shots(id),
			FOREIGN KEY (active_job_id) REFERENCES storyboard_render_jobs(id)
		)`,
		);
		await ensureIndex(
			db,
			"idx_storyboard_timeline_tracks_owner_project",
			`CREATE INDEX idx_storyboard_timeline_tracks_owner_project
				ON storyboard_timeline_tracks(owner_id, project_id, position)`,
		);
		await execute(
			db,
			`CREATE TABLE IF NOT EXISTS storyboard_diagnostic_logs (
			id TEXT PRIMARY KEY,
			owner_id TEXT NOT NULL,
			project_id TEXT NOT NULL,
			shot_id TEXT,
			job_id TEXT,
			stage TEXT NOT NULL,
			level TEXT NOT NULL,
			message TEXT NOT NULL,
			summary_json TEXT,
			created_at TEXT NOT NULL,
			FOREIGN KEY (shot_id) REFERENCES storyboard_shots(id),
			FOREIGN KEY (job_id) REFERENCES storyboard_render_jobs(id)
		)`,
		);
		await ensureIndex(
			db,
			"idx_storyboard_diagnostic_owner_project_stage",
			`CREATE INDEX idx_storyboard_diagnostic_owner_project_stage
				ON storyboard_diagnostic_logs(owner_id, project_id, stage, created_at DESC)`,
		);
		storyboardSchemaEnsured = true;
	});
	try {
		await storyboardSchemaEnsuring;
	} finally {
		storyboardSchemaEnsuring = null;
	}
}

export async function listStoryboardShotsByChapter(input: {
	db: PrismaClient;
	ownerId: string;
	projectId: string;
	chapterId: string;
	legacyChunkIndex: number | null;
}): Promise<StoryboardShotDto[]> {
	await ensureStoryboardSchema(input.db);
	const rows = await queryAll<StoryboardShotRow>(
		input.db,
		`SELECT *
		 FROM storyboard_shots
		 WHERE owner_id = ?
		   AND project_id = ?
		   AND (
		     chapter_id = ?
		     OR (
		       chapter_id IS NULL
		       AND ? IS NOT NULL
		       AND chunk_index = ?
		     )
		   )
		 ORDER BY shot_index ASC, created_at ASC`,
		[
			input.ownerId,
			input.projectId,
			input.chapterId,
			input.legacyChunkIndex,
			input.legacyChunkIndex,
		],
	);
	return rows.map(toShotDto);
}

export async function createEmptyStoryboardShotForChapter(input: {
	db: PrismaClient;
	id: string;
	ownerId: string;
	projectId: string;
	chapterId: string;
	chunkIndex: number;
	nowIso: string;
}): Promise<StoryboardShotDto> {
	await ensureStoryboardSchema(input.db);
	const maxRow = await queryOne<{ max_shot_index: number | null }>(
		input.db,
		`SELECT MAX(shot_index) AS max_shot_index
		 FROM storyboard_shots
		 WHERE owner_id = ?
		   AND project_id = ?
		   AND chapter_id = ?`,
		[input.ownerId, input.projectId, input.chapterId],
	);
	const nextShotIndex = Math.max(0, Number(maxRow?.max_shot_index ?? -1) + 1);
	await execute(
		input.db,
		`INSERT INTO storyboard_shots (
			id,
			owner_id,
			project_id,
			chapter_id,
			chunk_index,
			shot_index,
			title,
			summary,
			scene_asset_id,
			character_asset_ids,
			prop_asset_ids,
			camera_plan_json,
			lighting_plan_json,
			continuity_tail_frame_url,
			status,
			created_at,
			updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			input.id,
			input.ownerId,
			input.projectId,
			input.chapterId,
			input.chunkIndex,
			nextShotIndex,
			null,
			null,
			"",
			JSON.stringify([]),
			JSON.stringify([]),
			JSON.stringify({}),
			JSON.stringify({}),
			null,
			"queued",
			input.nowIso,
			input.nowIso,
		],
	);
	const row = await queryOne<StoryboardShotRow>(
		input.db,
		`SELECT *
		 FROM storyboard_shots
		 WHERE id = ?
		   AND owner_id = ?
		 LIMIT 1`,
		[input.id, input.ownerId],
	);
	if (!row) throw new Error("Failed to create storyboard shot");
	return toShotDto(row);
}

export async function ensureProjectOwnership(
	db: PrismaClient,
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

export async function upsertStoryboardShot(
	db: PrismaClient,
	input: {
		id: string;
		ownerId: string;
		projectId: string;
		nowIso: string;
		shot: StoryboardPlanShotInput;
	},
): Promise<StoryboardShotDto> {
	const { id, ownerId, projectId, nowIso, shot } = input;
	await execute(
		db,
		`INSERT INTO storyboard_shots (
			id,
			owner_id,
			project_id,
			chunk_index,
			shot_index,
			scene_asset_id,
			character_asset_ids,
			prop_asset_ids,
			camera_plan_json,
			lighting_plan_json,
			continuity_tail_frame_url,
			status,
			created_at,
			updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(project_id, chunk_index, shot_index) DO UPDATE SET
			scene_asset_id = excluded.scene_asset_id,
			character_asset_ids = excluded.character_asset_ids,
			prop_asset_ids = excluded.prop_asset_ids,
			camera_plan_json = excluded.camera_plan_json,
			lighting_plan_json = excluded.lighting_plan_json,
			continuity_tail_frame_url = excluded.continuity_tail_frame_url,
			status = excluded.status,
			updated_at = excluded.updated_at`,
		[
			id,
			ownerId,
			projectId,
			shot.chunkIndex,
			shot.shotIndex,
			shot.sceneAssetId,
			JSON.stringify(shot.characterAssetIds),
			JSON.stringify(shot.propAssetIds),
			JSON.stringify(shot.cameraPlan),
			JSON.stringify(shot.lightingPlan),
			shot.continuityTailFrameUrl ?? null,
			"queued",
			nowIso,
			nowIso,
		],
	);

	const row = await queryOne<StoryboardShotRow>(
		db,
		`SELECT * FROM storyboard_shots
		WHERE owner_id = ? AND project_id = ? AND chunk_index = ? AND shot_index = ?
		LIMIT 1`,
		[ownerId, projectId, shot.chunkIndex, shot.shotIndex],
	);
	if (!row) {
		throw new Error("Failed to load storyboard shot");
	}
	return toShotDto(row);
}

export async function getShotForOwner(
	db: PrismaClient,
	shotId: string,
	ownerId: string,
): Promise<StoryboardShotDto | null> {
	const row = await queryOne<StoryboardShotRow>(
		db,
		`SELECT * FROM storyboard_shots WHERE id = ? AND owner_id = ? LIMIT 1`,
		[shotId, ownerId],
	);
	return row ? toShotDto(row) : null;
}

export async function deleteStoryboardShotForOwner(input: {
	db: PrismaClient;
	shotId: string;
	ownerId: string;
}): Promise<boolean> {
	await ensureStoryboardSchema(input.db);
	const target = await queryOne<Pick<StoryboardShotRow, "id" | "project_id" | "chapter_id" | "shot_index">>(
		input.db,
		`SELECT id, project_id, chapter_id, shot_index
		 FROM storyboard_shots
		 WHERE id = ?
		   AND owner_id = ?
		 LIMIT 1`,
		[input.shotId, input.ownerId],
	);
	if (!target?.id) return false;
	await execute(
		input.db,
		`DELETE FROM storyboard_shots
		 WHERE id = ?
		   AND owner_id = ?`,
		[input.shotId, input.ownerId],
	);
	await execute(
		input.db,
		`UPDATE storyboard_shots
		 SET shot_index = shot_index - 1
		 WHERE owner_id = ?
		   AND project_id = ?
		   AND ((chapter_id = ?) OR (chapter_id IS NULL AND ? IS NULL))
		   AND shot_index > ?`,
		[input.ownerId, target.project_id, target.chapter_id, target.chapter_id, target.shot_index],
	);
	return true;
}

export async function updateStoryboardShotForOwner(input: {
	db: PrismaClient;
	shotId: string;
	ownerId: string;
	title?: string;
	summary?: string;
	status?: StoryboardJobStatus;
	nowIso: string;
}): Promise<StoryboardShotDto | null> {
	await ensureStoryboardSchema(input.db);
	const assignments: string[] = ["updated_at = ?"];
	const bindings: unknown[] = [input.nowIso];
	if (typeof input.title === "string") {
		assignments.push("title = ?");
		bindings.push(input.title);
	}
	if (typeof input.summary === "string") {
		assignments.push("summary = ?");
		bindings.push(input.summary);
	}
	if (typeof input.status === "string") {
		assignments.push("status = ?");
		bindings.push(input.status);
	}
	bindings.push(input.shotId, input.ownerId);
	await execute(
		input.db,
		`UPDATE storyboard_shots
		 SET ${assignments.join(", ")}
		 WHERE id = ?
		   AND owner_id = ?`,
		bindings,
	);
	return getShotForOwner(input.db, input.shotId, input.ownerId);
}

export async function moveStoryboardShotForOwner(input: {
	db: PrismaClient;
	shotId: string;
	ownerId: string;
	direction: "up" | "down";
	nowIso: string;
}): Promise<StoryboardShotDto | null> {
	await ensureStoryboardSchema(input.db);
	const current = await queryOne<
		Pick<StoryboardShotRow, "id" | "owner_id" | "project_id" | "chapter_id" | "shot_index">
	>(
		input.db,
		`SELECT id, owner_id, project_id, chapter_id, shot_index
		 FROM storyboard_shots
		 WHERE id = ?
		   AND owner_id = ?
		 LIMIT 1`,
		[input.shotId, input.ownerId],
	);
	if (!current?.id) return null;
	const operator = input.direction === "up" ? "<" : ">";
	const order = input.direction === "up" ? "DESC" : "ASC";
	const neighbor = await queryOne<
		Pick<StoryboardShotRow, "id" | "shot_index">
	>(
		input.db,
		`SELECT id, shot_index
		 FROM storyboard_shots
		 WHERE owner_id = ?
		   AND project_id = ?
		   AND ((chapter_id = ?) OR (chapter_id IS NULL AND ? IS NULL))
		   AND shot_index ${operator} ?
		 ORDER BY shot_index ${order}
		 LIMIT 1`,
		[
			input.ownerId,
			current.project_id,
			current.chapter_id,
			current.chapter_id,
			current.shot_index,
		],
	);
	if (!neighbor?.id) {
		return getShotForOwner(input.db, input.shotId, input.ownerId);
	}
	const tempShotIndex = -1000000 - Number(current.shot_index || 0);
	await execute(
		input.db,
		`UPDATE storyboard_shots
		 SET shot_index = ?, updated_at = ?
		 WHERE id = ?
		   AND owner_id = ?`,
		[tempShotIndex, input.nowIso, current.id, input.ownerId],
	);
	await execute(
		input.db,
		`UPDATE storyboard_shots
		 SET shot_index = ?, updated_at = ?
		 WHERE id = ?
		   AND owner_id = ?`,
		[current.shot_index, input.nowIso, neighbor.id, input.ownerId],
	);
	await execute(
		input.db,
		`UPDATE storyboard_shots
		 SET shot_index = ?, updated_at = ?
		 WHERE id = ?
		   AND owner_id = ?`,
		[neighbor.shot_index, input.nowIso, current.id, input.ownerId],
	);
	return getShotForOwner(input.db, input.shotId, input.ownerId);
}

export async function insertRenderJob(
	db: PrismaClient,
	input: {
		id: string;
		ownerId: string;
		projectId: string;
		shotId: string;
		modelKey: string;
		mode: StoryboardRenderMode;
		params: Record<string, unknown>;
		seed: number | null;
		status: StoryboardJobStatus;
		outputVideoUrl: string | null;
		outputLastFrameUrl: string | null;
		costCents: number | null;
		latencyMs: number | null;
		failCode: string | null;
		failReason: string | null;
		basedOnJobId: string | null;
		nowIso: string;
	},
): Promise<StoryboardRenderJobDto> {
	await execute(
		db,
		`INSERT INTO storyboard_render_jobs (
			id,
			owner_id,
			project_id,
			shot_id,
			model_key,
			mode,
			params_json,
			seed,
			status,
			output_video_url,
			output_last_frame_url,
			cost_cents,
			latency_ms,
			fail_code,
			fail_reason,
			based_on_job_id,
			created_at,
			updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			input.id,
			input.ownerId,
			input.projectId,
			input.shotId,
			input.modelKey,
			input.mode,
			JSON.stringify(input.params),
			input.seed,
			input.status,
			input.outputVideoUrl,
			input.outputLastFrameUrl,
			input.costCents,
			input.latencyMs,
			input.failCode,
			input.failReason,
			input.basedOnJobId,
			input.nowIso,
			input.nowIso,
		],
	);
	const row = await queryOne<StoryboardRenderJobRow>(
		db,
		`SELECT * FROM storyboard_render_jobs WHERE id = ? AND owner_id = ? LIMIT 1`,
		[input.id, input.ownerId],
	);
	if (!row) throw new Error("Failed to load render job");
	return toRenderJobDto(row);
}

export async function getRenderJobForOwner(
	db: PrismaClient,
	jobId: string,
	ownerId: string,
): Promise<StoryboardRenderJobDto | null> {
	const row = await queryOne<StoryboardRenderJobRow>(
		db,
		`SELECT * FROM storyboard_render_jobs WHERE id = ? AND owner_id = ? LIMIT 1`,
		[jobId, ownerId],
	);
	return row ? toRenderJobDto(row) : null;
}

export async function updateShotStatus(
	db: PrismaClient,
	input: {
		shotId: string;
		ownerId: string;
		status: StoryboardJobStatus;
		nowIso: string;
	},
): Promise<void> {
	await execute(
		db,
		`UPDATE storyboard_shots
		SET status = ?, updated_at = ?
		WHERE id = ? AND owner_id = ?`,
		[input.status, input.nowIso, input.shotId, input.ownerId],
	);
}

export async function replaceTimelineShot(
	db: PrismaClient,
	input: {
		id: string;
		ownerId: string;
		projectId: string;
		shotId: string;
		jobId: string;
		position: number;
		durationMs: number;
		audioTrackId: string | null;
		nowIso: string;
	},
): Promise<number> {
	await execute(
		db,
		`INSERT INTO storyboard_timeline_tracks (
			id,
			owner_id,
			project_id,
			shot_id,
			active_job_id,
			position,
			duration_ms,
			audio_track_id,
			created_at,
			updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(project_id, shot_id) DO UPDATE SET
			active_job_id = excluded.active_job_id,
			position = excluded.position,
			duration_ms = excluded.duration_ms,
			audio_track_id = excluded.audio_track_id,
			updated_at = excluded.updated_at`,
		[
			input.id,
			input.ownerId,
			input.projectId,
			input.shotId,
			input.jobId,
			input.position,
			input.durationMs,
			input.audioTrackId,
			input.nowIso,
			input.nowIso,
		],
	);

	const versionRow = await queryOne<{ total: number }>(
		db,
		`SELECT COUNT(*) AS total
		 FROM storyboard_timeline_tracks
		 WHERE owner_id = ? AND project_id = ?`,
		[input.ownerId, input.projectId],
	);
	const total = Number(versionRow?.total ?? 0);
	return Math.max(1, total);
}

function clampRate(value: number): number {
	if (!Number.isFinite(value)) return 0;
	return Math.max(0, Math.min(1, value));
}

export async function getStoryboardMetrics(
	db: PrismaClient,
	input: {
		ownerId: string;
		projectId: string;
	},
): Promise<StoryboardMetricsDto> {
	const [shotTotals, rerenderTotals, rerenderSuccess, costRows, latencyRows] =
		await Promise.all([
			queryOne<{ total: number; with_tail: number }>(
				db,
				`SELECT
					COUNT(*) AS total,
					SUM(CASE WHEN continuity_tail_frame_url IS NOT NULL AND continuity_tail_frame_url <> '' THEN 1 ELSE 0 END) AS with_tail
				FROM storyboard_shots
				WHERE owner_id = ? AND project_id = ?`,
				[input.ownerId, input.projectId],
			),
			queryOne<{ total: number }>(
				db,
				`SELECT COUNT(*) AS total
				FROM storyboard_render_jobs
				WHERE owner_id = ? AND project_id = ? AND based_on_job_id IS NOT NULL`,
				[input.ownerId, input.projectId],
			),
			queryOne<{ total: number }>(
				db,
				`SELECT COUNT(*) AS total
				FROM storyboard_render_jobs
				WHERE owner_id = ? AND project_id = ? AND based_on_job_id IS NOT NULL AND status = 'succeeded'`,
				[input.ownerId, input.projectId],
			),
			queryAll<{ shot_id: string; sum_cost: number }>(
				db,
				`SELECT shot_id, SUM(cost_cents) AS sum_cost
				FROM storyboard_render_jobs
				WHERE owner_id = ? AND project_id = ? AND cost_cents IS NOT NULL
				GROUP BY shot_id`,
				[input.ownerId, input.projectId],
			),
			queryAll<{ latency_ms: number }>(
				db,
				`SELECT latency_ms
				FROM storyboard_render_jobs
				WHERE owner_id = ? AND project_id = ? AND latency_ms IS NOT NULL`,
				[input.ownerId, input.projectId],
			),
		]);

	const shotTotal = Number(shotTotals?.total ?? 0);
	const shotsWithTail = Number(shotTotals?.with_tail ?? 0);
	const consistencyScore =
		shotTotal > 0 ? clampRate(shotsWithTail / shotTotal) : 0;

	const rerenderTotal = Number(rerenderTotals?.total ?? 0);
	const rerenderSucceeded = Number(rerenderSuccess?.total ?? 0);
	const rerenderSuccessRate =
		rerenderTotal > 0 ? clampRate(rerenderSucceeded / rerenderTotal) : 0;

	const totalCost = costRows.reduce((sum, row) => {
		const cost = Number(row.sum_cost ?? 0);
		return sum + (Number.isFinite(cost) ? cost : 0);
	}, 0);
	const avgCostPerShot = costRows.length > 0 ? totalCost / costRows.length : 0;

	const latencies = latencyRows
		.map((row) => Number(row.latency_ms ?? 0))
		.filter((value) => Number.isFinite(value) && value >= 0)
		.sort((a, b) => a - b);
	const p95Index = latencies.length
		? Math.max(0, Math.ceil(latencies.length * 0.95) - 1)
		: 0;
	const p95LatencyMs =
		latencies.length > 0 ? Math.round(latencies[p95Index] || 0) : 0;

	return {
		projectId: input.projectId,
		consistencyScore,
		rerenderSuccessRate,
		avgCostPerShot,
		p95LatencyMs,
	};
}

export async function insertStoryboardDiagnosticLog(
	db: PrismaClient,
	input: {
		id: string;
		ownerId: string;
		projectId: string;
		shotId?: string | null;
		jobId?: string | null;
		stage: string;
		level: "info" | "warn" | "error";
		message: string;
		summary?: Record<string, unknown> | null;
		createdAt: string;
	},
): Promise<void> {
	await execute(
		db,
		`INSERT INTO storyboard_diagnostic_logs (
			id,
			owner_id,
			project_id,
			shot_id,
			job_id,
			stage,
			level,
			message,
			summary_json,
			created_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			input.id,
			input.ownerId,
			input.projectId,
			input.shotId ?? null,
			input.jobId ?? null,
			input.stage,
			input.level,
			input.message,
			input.summary ? JSON.stringify(input.summary) : null,
			input.createdAt,
		],
	);
}

export async function listStoryboardDiagnosticLogs(
	db: PrismaClient,
	input: {
		ownerId: string;
		projectId: string;
		limit: number;
		stage?: string;
	},
): Promise<StoryboardDiagnosticLogDto[]> {
	const limit = Math.max(1, Math.min(500, Math.floor(input.limit)));
	const rows = input.stage
		? await queryAll<StoryboardDiagnosticLogRow>(
				db,
				`SELECT * FROM storyboard_diagnostic_logs
				 WHERE owner_id = ? AND project_id = ? AND stage = ?
				 ORDER BY created_at DESC
				 LIMIT ?`,
				[input.ownerId, input.projectId, input.stage, limit],
			)
		: await queryAll<StoryboardDiagnosticLogRow>(
				db,
				`SELECT * FROM storyboard_diagnostic_logs
				 WHERE owner_id = ? AND project_id = ?
				 ORDER BY created_at DESC
				 LIMIT ?`,
				[input.ownerId, input.projectId, limit],
			);
	return rows.map(toDiagnosticDto);
}
