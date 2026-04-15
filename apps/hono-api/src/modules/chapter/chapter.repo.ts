import { execute, queryAll, queryOne } from "../../db/db";
import type { PrismaClient } from "../../types";
import { ensureStoryboardSchema } from "../storyboard/storyboard.repo";

export type ChapterRow = {
	id: string;
	owner_id: string;
	project_id: string;
	chapter_index: number;
	title: string;
	summary: string | null;
	status: string;
	sort_order: number;
	cover_asset_id: string | null;
	continuity_context: string | null;
	style_profile_override: string | null;
	legacy_chunk_index: number | null;
	source_book_id: string | null;
	source_book_chapter: number | null;
	last_worked_at: string | null;
	created_at: string;
	updated_at: string;
};

let chapterSchemaEnsured = false;
let chapterSchemaEnsuring: Promise<void> | null = null;

const CHAPTER_SCHEMA_LOCK_NAMESPACE = 42001;
const CHAPTER_SCHEMA_LOCK_KEY = 2;
const CHAPTER_CREATE_LOCK_NAMESPACE = 42001;
const CHAPTER_CREATE_LOCK_KEY = 21;
const SCHEMA_LOCK_RETRY_MS = 25;

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withChapterSchemaLock<T>(
	db: PrismaClient,
	work: () => Promise<T>,
): Promise<T> {
	let locked = false;
	while (!locked) {
		const row = await queryOne<{ locked: boolean }>(
			db,
			"SELECT pg_try_advisory_lock((?)::integer, (?)::integer) AS locked",
			[CHAPTER_SCHEMA_LOCK_NAMESPACE, CHAPTER_SCHEMA_LOCK_KEY],
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
			[CHAPTER_SCHEMA_LOCK_NAMESPACE, CHAPTER_SCHEMA_LOCK_KEY],
		);
	}
}

async function withProjectChapterCreateLock<T>(
	db: PrismaClient,
	projectId: string,
	work: () => Promise<T>,
): Promise<T> {
	let locked = false;
	while (!locked) {
		const row = await queryOne<{ locked: boolean }>(
			db,
			"SELECT pg_try_advisory_lock((?)::integer, hashtext(?)) AS locked",
			[CHAPTER_CREATE_LOCK_NAMESPACE + CHAPTER_CREATE_LOCK_KEY, projectId],
		);
		locked = row?.locked === true;
		if (!locked) await delay(SCHEMA_LOCK_RETRY_MS);
	}
	try {
		return await work();
	} finally {
		await queryOne(
			db,
			"SELECT pg_advisory_unlock((?)::integer, hashtext(?)) AS unlocked",
			[CHAPTER_CREATE_LOCK_NAMESPACE + CHAPTER_CREATE_LOCK_KEY, projectId],
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

export async function ensureChapterSchema(db: PrismaClient): Promise<void> {
	if (chapterSchemaEnsured) return;
	if (chapterSchemaEnsuring) {
		await chapterSchemaEnsuring;
		return;
	}
	chapterSchemaEnsuring = withChapterSchemaLock(db, async () => {
		if (chapterSchemaEnsured) return;
		await ensureStoryboardSchema(db);
		await execute(
			db,
			`CREATE TABLE IF NOT EXISTS chapters (
			id TEXT PRIMARY KEY,
			owner_id TEXT NOT NULL,
			project_id TEXT NOT NULL,
			chapter_index INTEGER NOT NULL,
			title TEXT NOT NULL,
			summary TEXT,
			status TEXT NOT NULL,
			sort_order INTEGER NOT NULL,
			cover_asset_id TEXT,
			continuity_context TEXT,
			style_profile_override TEXT,
			legacy_chunk_index INTEGER,
			source_book_id TEXT,
			source_book_chapter INTEGER,
			last_worked_at TEXT,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			UNIQUE (project_id, chapter_index)
		)`,
		);
		await ensureIndex(
			db,
			"idx_chapters_owner_project_sort",
			`CREATE INDEX idx_chapters_owner_project_sort
				ON chapters(owner_id, project_id, sort_order)`,
		);
		await ensureIndex(
			db,
			"idx_chapters_project_last_worked",
			`CREATE INDEX idx_chapters_project_last_worked
				ON chapters(project_id, last_worked_at)`,
		);
		await execute(
			db,
			`ALTER TABLE storyboard_shots
				ADD COLUMN IF NOT EXISTS chapter_id TEXT`,
		);
		await execute(
			db,
			`ALTER TABLE chapters
				ADD COLUMN IF NOT EXISTS source_book_id TEXT`,
		);
		await execute(
			db,
			`ALTER TABLE chapters
				ADD COLUMN IF NOT EXISTS source_book_chapter INTEGER`,
		);
		chapterSchemaEnsured = true;
	});
	try {
		await chapterSchemaEnsuring;
	} finally {
		chapterSchemaEnsuring = null;
	}
}

export async function listChaptersByProjectForOwner(input: {
	db: PrismaClient;
	projectId: string;
	ownerId: string;
}): Promise<ChapterRow[]> {
	await ensureChapterSchema(input.db);
	return queryAll<ChapterRow>(
		input.db,
		`SELECT *
		 FROM chapters
		 WHERE project_id = ?
		   AND owner_id = ?
		 ORDER BY sort_order ASC, chapter_index ASC, created_at ASC`,
		[input.projectId, input.ownerId],
	);
}

export async function getChapterByIdForOwner(input: {
	db: PrismaClient;
	chapterId: string;
	ownerId: string;
}): Promise<ChapterRow | null> {
	await ensureChapterSchema(input.db);
	return queryOne<ChapterRow>(
		input.db,
		`SELECT *
		 FROM chapters
		 WHERE id = ?
		   AND owner_id = ?
		 LIMIT 1`,
		[input.chapterId, input.ownerId],
	);
}

export async function createChapterRow(input: {
	db: PrismaClient;
	id: string;
	projectId: string;
	ownerId: string;
	title: string;
	summary: string | null;
	nowIso: string;
}): Promise<ChapterRow> {
	await ensureChapterSchema(input.db);
	await withProjectChapterCreateLock(input.db, input.projectId, async () => {
		const maxRow = await queryOne<{ max_index: number | null; max_sort: number | null }>(
			input.db,
			`SELECT
			   MAX(chapter_index) AS max_index,
			   MAX(sort_order) AS max_sort
			 FROM chapters
			 WHERE project_id = ?
			   AND owner_id = ?`,
			[input.projectId, input.ownerId],
		);
		const nextIndex = Math.max(1, Number(maxRow?.max_index || 0) + 1);
		const nextSort = Math.max(10, Number(maxRow?.max_sort || 0) + 10);
		await execute(
			input.db,
			`INSERT INTO chapters (
				id, owner_id, project_id, chapter_index, title, summary, status,
				sort_order, legacy_chunk_index, created_at, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				input.id,
				input.ownerId,
				input.projectId,
				nextIndex,
				input.title,
				input.summary,
				"draft",
				nextSort,
				nextIndex,
				input.nowIso,
				input.nowIso,
			],
		);
	});
	const created = await getChapterByIdForOwner({
		db: input.db,
		chapterId: input.id,
		ownerId: input.ownerId,
	});
	if (!created) throw new Error("failed to create chapter");
	return created;
}

export async function updateChapterRow(input: {
	db: PrismaClient;
	chapterId: string;
	ownerId: string;
	title?: string;
	summary?: string;
	status?: string;
	sortOrder?: number;
	sourceBookId?: string | null;
	sourceBookChapter?: number | null;
	nowIso: string;
}): Promise<ChapterRow | null> {
	await ensureChapterSchema(input.db);
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
	if (typeof input.sortOrder === "number") {
		assignments.push("sort_order = ?");
		bindings.push(input.sortOrder);
	}
	if (input.sourceBookId !== undefined) {
		assignments.push("source_book_id = ?");
		bindings.push(input.sourceBookId);
	}
	if (input.sourceBookChapter !== undefined) {
		assignments.push("source_book_chapter = ?");
		bindings.push(input.sourceBookChapter);
	}
	bindings.push(input.chapterId, input.ownerId);
	await execute(
		input.db,
		`UPDATE chapters
		 SET ${assignments.join(", ")}
		 WHERE id = ?
		   AND owner_id = ?`,
		bindings,
	);
	return getChapterByIdForOwner({
		db: input.db,
		chapterId: input.chapterId,
		ownerId: input.ownerId,
	});
}

export async function findLatestWorkedChapterByProjectForOwner(input: {
	db: PrismaClient;
	projectId: string;
	ownerId: string;
}): Promise<ChapterRow | null> {
	await ensureChapterSchema(input.db);
	return queryOne<ChapterRow>(
		input.db,
		`SELECT *
		 FROM chapters
		 WHERE project_id = ?
		   AND owner_id = ?
		 ORDER BY COALESCE(last_worked_at, updated_at) DESC, sort_order ASC
		 LIMIT 1`,
		[input.projectId, input.ownerId],
	);
}

export async function touchChapterLastWorkedAt(input: {
	db: PrismaClient;
	chapterId: string;
	ownerId: string;
	nowIso: string;
}): Promise<void> {
	await ensureChapterSchema(input.db);
	await execute(
		input.db,
		`UPDATE chapters
		 SET last_worked_at = ?,
		     updated_at = CASE WHEN updated_at < ? THEN ? ELSE updated_at END
		 WHERE id = ?
		   AND owner_id = ?`,
		[input.nowIso, input.nowIso, input.nowIso, input.chapterId, input.ownerId],
	);
}

export async function deleteChapterRow(input: {
	db: PrismaClient;
	chapterId: string;
	ownerId: string;
}): Promise<boolean> {
	await ensureChapterSchema(input.db);
	const existing = await getChapterByIdForOwner({
		db: input.db,
		chapterId: input.chapterId,
		ownerId: input.ownerId,
	});
	if (!existing) return false;
	await execute(
		input.db,
		`DELETE FROM chapters
		 WHERE id = ?
		   AND owner_id = ?`,
		[input.chapterId, input.ownerId],
	);
	return true;
}
