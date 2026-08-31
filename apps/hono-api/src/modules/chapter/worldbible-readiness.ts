// 【世界书就绪软提醒·2026-07-14 用户拍板】书级项目四件套（世界观圣经/角色总表/红线对照清单/
// IP-safe替换表）未经用户定稿前，各生产触点（画风锁定/commit_beats/estimate/连续性注入）持续
// 软提醒——不拦任何动作（用户定「倒也不强制，只会反复提醒」）；独立项目（非 book-* 章节）零感知。
// 状态位＝书级 index.json 顶层 worldBible:{status:"confirmed",confirmedAt}，经
// tapcanvas_book_worldbible_confirm 写入（缺件拒绝）。索引缺失按未定稿；损坏或不可读则显式失败。

import fs from "node:fs/promises";
import path from "node:path";

import { AppError } from "../../middleware/error";
import { BookIndexStoreError, readBookIndex } from "../asset/book-index-store";
import { resolveProjectDataRepoRoot } from "../asset/project-data-root";

function sanitizePathSegment(raw: string): string {
	return raw.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
}

const SAFE_BOOK_DIR = /^[a-zA-Z0-9._-]+$/;

/** chapterId 形如 `book-<bookDir>-ch<N>` → bookDir；解析口径与 chapter.book-index-context 一致。 */
function parseBookDirFromChapterId(chapterId: string): string | null {
	const m = /^book-(.+)-ch(\d+)$/i.exec(String(chapterId || "").trim());
	if (!m) return null;
	const bookDir = m[1]!;
	if (!SAFE_BOOK_DIR.test(bookDir) || bookDir.includes("..")) return null;
	return bookDir;
}

function buildBooksRoot(repoRoot: string, ownerId: string, projectId: string): string {
	return path.join(
		repoRoot,
		"project-data",
		"users",
		sanitizePathSegment(ownerId),
		"projects",
		sanitizePathSegment(projectId),
		"books",
	);
}

async function readIndexSafe(indexPath: string): Promise<Record<string, unknown> | null> {
	try {
		return await readBookIndex(indexPath);
	} catch (error) {
		if (error instanceof BookIndexStoreError && error.code === "book_index_not_found") return null;
		if (error instanceof BookIndexStoreError) {
			throw new AppError(error.message, { status: 500, code: error.code, details: error.details });
		}
		throw error;
	}
}

/** index.json 顶层 worldBible.status === "confirmed" 才算定稿；字段缺失/形状不对＝未定稿。 */
export function isWorldBibleConfirmed(idx: Record<string, unknown> | null | undefined): boolean {
	const wb = idx?.worldBible;
	if (!wb || typeof wb !== "object" || Array.isArray(wb)) return false;
	return (wb as Record<string, unknown>).status === "confirmed";
}

export function buildWorldBibleReminder(): string {
	return (
		"⚠️ 世界书未定稿：本书四件套（世界观圣经/角色总表/红线对照清单/IP-safe替换表）尚未经用户确认定稿。" +
		"请先做齐四件套并展示给用户，用 request_user_input 请用户确认定稿，确认后调用 tapcanvas_book_worldbible_confirm(bookId) 落状态。" +
		"定稿前继续画风锁定/资产生产/出片可能返工——每次此类动作都要向用户提一句。（软提醒·不阻断）"
	);
}

/**
 * 章级触点判定（commit_beats/estimate 用）：chapterId 解析出 bookDir 才算书级项目。
 * 书级 + 未定稿（含 index.json 读不到）→ 提醒文案；已定稿/非书级 → null。
 */
export async function getWorldBibleReminderForChapter(input: {
	projectId: string;
	ownerId: string;
	chapterId: string;
	/** 测试注入用；生产走 resolveProjectDataRepoRoot()。 */
	repoRoot?: string;
}): Promise<string | null> {
	try {
		const bookDir = parseBookDirFromChapterId(input.chapterId);
		if (!bookDir || !input.projectId || !input.ownerId) return null;
		const indexPath = path.join(
			buildBooksRoot(input.repoRoot || resolveProjectDataRepoRoot(), input.ownerId, input.projectId),
			bookDir,
			"index.json",
		);
		const idx = await readIndexSafe(indexPath);
		// chapterId 已确证书级：index 读不到也按未定稿提醒（spec 定：读失败=未定稿只提醒）。
		if (isWorldBibleConfirmed(idx)) return null;
		return buildWorldBibleReminder();
	} catch (error) {
		if (error instanceof AppError) throw error;
		return null;
	}
}

/**
 * 项目级触点判定（set_style_reference 用，无 chapterId）：扫项目 books 目录，
 * 任一本书有可读 index.json 且未定稿 → 提醒；无书/全部定稿 → null。
 */
export async function getWorldBibleReminderForProject(input: {
	projectId: string;
	ownerId: string;
	repoRoot?: string;
}): Promise<string | null> {
	try {
		if (!input.projectId || !input.ownerId) return null;
		const booksRoot = buildBooksRoot(
			input.repoRoot || resolveProjectDataRepoRoot(),
			input.ownerId,
			input.projectId,
		);
		const entries = await fs.readdir(booksRoot, { withFileTypes: true }).catch(() => []);
		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			const idx = await readIndexSafe(path.join(booksRoot, entry.name, "index.json"));
			if (idx && !isWorldBibleConfirmed(idx)) return buildWorldBibleReminder();
		}
		return null;
	} catch (error) {
		if (error instanceof AppError) throw error;
		return null;
	}
}
