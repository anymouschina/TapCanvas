// 【全书索引注入·根治「不知书名/不知前后章」（2026-07-04 ch5《灾难？》封面实测）】
//
// 病根：章节会话里小T拿到的上下文（画布快照 + book_chapter_get）从头到尾没有真书名——
// bookId 里中文被 sanitize 成下划线、chapter_get 响应只有章节字段。正文里书内道具/游戏名
// （《十日终焉》卡牌背面的「女娲游戏」）长得像作品名，模型就把它当书名印上章节封面。
// 前后章标题/摘要同理不在眼前，承接/预告只能瞎猜或多轮工具试探。
//
// 修法（正确默认 > 检测纠正）：会话注入块里直接带上 书名+总章数+上一章/当前章/下一章，
// 信息推到眼前。纯确定性读取（chapters 表 + index.json）、无 LLM、best-effort：
// 任何一步失败 → 返回 null，零回归。

import path from "node:path";

import { queryOne } from "../../db/db";
import { AppError } from "../../middleware/error";
import type { PrismaClient } from "../../types";
import { BookIndexStoreError, readBookIndex } from "../asset/book-index-store";
import { resolveProjectDataRepoRoot } from "../asset/project-data-root";
import { buildWorldBibleReminder, isWorldBibleConfirmed } from "./worldbible-readiness";

const BLOCK_OPEN = "<book_index readonly>";
const BLOCK_CLOSE = "</book_index>";
/** 上一章摘要截断长度：给承接用的一句话定位，不整段灌。 */
const SUMMARY_SNIPPET_CHARS = 160;

function str(v: unknown): string {
	return typeof v === "string" ? v.trim() : "";
}

function snippet(v: unknown, max: number): string {
	const s = str(v).replace(/\s+/g, " ");
	return s.length > max ? `${s.slice(0, max)}…` : s;
}

function sanitizePathSegment(raw: string): string {
	return raw.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
}

// 上传时目录名由 sanitize 生成，必然只含这些字符（可以下划线开头，如中文书名
// 《十日终焉》→ `____-1782981799278`）。作为路径段白名单，防 chapterId 注入路径穿越。
const SAFE_BOOK_DIR = /^[a-zA-Z0-9._-]+$/;

/**
 * chapterId 形如 `book-<bookDir>-ch<N>` → 解析出书目录名与索引序号。
 * 注意 bookDir 必须按字面用（chapter id 就是拿目录名拼的）——不能再过一遍
 * sanitizePathSegment，它会剥首尾下划线，把 `____-1782981799278` 掰坏。
 */
function parseBookChapterId(chapterId: string): { bookDir: string; sequence: number } | null {
	const m = /^book-(.+)-ch(\d+)$/i.exec(String(chapterId || "").trim());
	if (!m) return null;
	const bookDir = m[1]!;
	if (!SAFE_BOOK_DIR.test(bookDir) || bookDir.includes("..")) return null;
	const sequence = Number(m[2]);
	if (!Number.isFinite(sequence) || sequence <= 0) return null;
	return { bookDir, sequence: Math.trunc(sequence) };
}

type BookIndexChapterMeta = {
	chapter?: unknown;
	title?: unknown;
	summary?: unknown;
};

async function readBookIndexSafe(indexPath: string): Promise<Record<string, unknown> | null> {
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

/**
 * 构建【全书索引】注入块：书名、总章数、上一章/当前章/下一章（标题 + 上一章摘要若有）。
 * 数据源 = 项目 owner 目录下该书的 index.json（chapters 表只兜底 projectId→owner 解析）。
 * 非书籍章节 id / 找不到 index.json → null；索引损坏、不可读或结构非法时显式失败。
 */
export async function buildBookIndexContextBlock(input: {
	db: PrismaClient;
	chapterId: string;
	projectId?: string | null;
	/** 测试注入用；生产走 resolveProjectDataRepoRoot()。 */
	repoRoot?: string;
}): Promise<string | null> {
	const parsed = parseBookChapterId(input.chapterId);
	if (!parsed) return null;

	let projectId = str(input.projectId);
	try {
		if (!projectId) {
			const row = await queryOne<{ project_id: string }>(
				input.db,
				`SELECT project_id FROM chapters WHERE id = ? LIMIT 1`,
				[input.chapterId],
			);
			projectId = str(row?.project_id);
		}
		if (!projectId) return null;
		const project = await queryOne<{ owner_id: string | null }>(
			input.db,
			`SELECT owner_id FROM projects WHERE id = ? LIMIT 1`,
			[projectId],
		);
		const ownerId = str(project?.owner_id);
		if (!ownerId) return null;

		const indexPath = path.join(
			input.repoRoot || resolveProjectDataRepoRoot(),
			"project-data",
			"users",
			sanitizePathSegment(ownerId),
			"projects",
			sanitizePathSegment(projectId),
			"books",
			parsed.bookDir,
			"index.json",
		);
		const idx = await readBookIndexSafe(indexPath);
		if (!idx) return null;

		const bookTitle = str(idx.title);
		const chapters = Array.isArray(idx.chapters) ? (idx.chapters as BookIndexChapterMeta[]) : [];
		const chapterCount = Number(idx.chapterCount || 0) || chapters.length;
		const findMeta = (seq: number): BookIndexChapterMeta | null =>
			chapters.find((item) => Number(item?.chapter) === seq) ?? null;
		const current = findMeta(parsed.sequence);
		if (!bookTitle && !current) return null;

		const prev = findMeta(parsed.sequence - 1);
		const next = findMeta(parsed.sequence + 1);
		const lines: string[] = [BLOCK_OPEN, "【全书索引·章节定位】"];
		if (bookTitle) {
			lines.push(
				`书名：《${bookTitle}》（封面/海报/标题文字一律用这个真实书名；正文里的道具/游戏/组织名不是书名）`,
			);
		}
		if (chapterCount > 0) lines.push(`全书共 ${chapterCount} 章（按索引序号计，可能含卷标题行）`);
		if (prev) {
			const prevSummary = snippet(prev.summary, SUMMARY_SNIPPET_CHARS);
			lines.push(
				`上一章：索引${parsed.sequence - 1}《${str(prev.title) || `第${parsed.sequence - 1}章`}》${prevSummary ? `｜摘要：${prevSummary}` : ""}`,
			);
		}
		lines.push(
			`当前章：索引${parsed.sequence}《${str(current?.title) || `第${parsed.sequence}章`}》`,
		);
		if (next) {
			lines.push(`下一章：索引${parsed.sequence + 1}《${str(next.title) || `第${parsed.sequence + 1}章`}》`);
		}
		lines.push(
			"读任意章原文/摘要 → tapcanvas_book_chapter_get(chapter=索引序号)；全书章节列表与书级元数据 → tapcanvas_book_index_get。",
		);
		// 【世界书未定稿软提醒·2026-07-14 用户拍板「先定世界书再出内容·不强制只反复提醒」】
		// 挂在全书索引块，确保首章同样获得基于真实 index.json 状态的提醒。
		if (!isWorldBibleConfirmed(idx)) {
			lines.push(buildWorldBibleReminder());
		}
		lines.push(BLOCK_CLOSE);
		return lines.join("\n");
	} catch (error) {
		if (error instanceof AppError) throw error;
		return null;
	}
}
