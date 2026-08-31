import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildBookIndexContextBlock } from "./chapter.book-index-context";
import type { PrismaClient } from "../../types";

const OWNER = "phone_owner123";
const PROJECT = "proj-abc";
const BOOK_DIR = "____-1782981799278";
const CHAPTER_ID = `book-${BOOK_DIR}-ch5`;

// buildBookIndexContextBlock 只用到 queryOne → $queryRawUnsafe。
function fakeDb(rowsBySql: Array<{ match: RegExp; rows: unknown[] }>): PrismaClient {
	return {
		$queryRawUnsafe: async (sql: string) => {
			for (const item of rowsBySql) {
				if (item.match.test(sql)) return item.rows;
			}
			return [];
		},
	} as unknown as PrismaClient;
}

const db = fakeDb([
	{ match: /FROM chapters/i, rows: [{ project_id: PROJECT }] },
	{ match: /FROM projects/i, rows: [{ owner_id: OWNER }] },
]);

let repoRoot = "";

beforeAll(async () => {
	repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "book-index-ctx-"));
	const bookDir = path.join(
		repoRoot,
		"project-data",
		"users",
		OWNER,
		"projects",
		PROJECT,
		"books",
		BOOK_DIR,
	);
	await fs.mkdir(bookDir, { recursive: true });
	await fs.writeFile(
		path.join(bookDir, "index.json"),
		JSON.stringify({
			bookId: BOOK_DIR,
			projectId: PROJECT,
			title: "十日终焉",
			chapterCount: 1394,
			chapters: [
				{ chapter: 4, title: "第3章 有技术的人", summary: "山羊头宣布规则，众人被迫自证。" },
				{ chapter: 5, title: "第4章 灾难？" },
				{ chapter: 6, title: "第5章 医生" },
			],
		}),
		"utf8",
	);
});

afterAll(async () => {
	await fs.rm(repoRoot, { recursive: true, force: true });
});

describe("buildBookIndexContextBlock", () => {
	it("注入真书名 + 总章数 + 前后章定位（根治封面拿书内游戏名当书名）", async () => {
		const block = await buildBookIndexContextBlock({
			db,
			chapterId: CHAPTER_ID,
			projectId: PROJECT,
			repoRoot,
		});
		expect(block).toBeTruthy();
		expect(block).toContain("《十日终焉》");
		expect(block).toContain("1394");
		expect(block).toContain("上一章：索引4《第3章 有技术的人》");
		expect(block).toContain("摘要：山羊头宣布规则");
		expect(block).toContain("当前章：索引5《第4章 灾难？》");
		expect(block).toContain("下一章：索引6《第5章 医生》");
		expect(block).toContain("<book_index readonly>");
		expect(block).toContain("</book_index>");
	});

	it("projectId 缺省时从 chapters 表反查", async () => {
		const block = await buildBookIndexContextBlock({
			db,
			chapterId: CHAPTER_ID,
			repoRoot,
		});
		expect(block).toContain("《十日终焉》");
	});

	it("首章无上一章、末章无下一章：不输出对应行", async () => {
		const first = await buildBookIndexContextBlock({
			db,
			chapterId: `book-${BOOK_DIR}-ch4`,
			projectId: PROJECT,
			repoRoot,
		});
		expect(first).toContain("当前章：索引4");
		expect(first).not.toContain("上一章：");
		const last = await buildBookIndexContextBlock({
			db,
			chapterId: `book-${BOOK_DIR}-ch6`,
			projectId: PROJECT,
			repoRoot,
		});
		expect(last).not.toContain("下一章：");
	});

	it("非书籍章节 id / index.json 缺失 → null（零回归）", async () => {
		expect(
			await buildBookIndexContextBlock({ db, chapterId: "uuid-not-book", projectId: PROJECT, repoRoot }),
		).toBeNull();
		expect(
			await buildBookIndexContextBlock({
				db,
				chapterId: "book-nonexistent-book-ch1",
				projectId: PROJECT,
				repoRoot,
			}),
		).toBeNull();
	});

	// 会临时改写共享 fixture，必须保持为本文件最后一个用例，末尾还原。
	it("世界书未定稿 → 块尾带软提醒；已定稿 → 无提醒", async () => {
		const draft = await buildBookIndexContextBlock({
			db,
			chapterId: CHAPTER_ID,
			projectId: PROJECT,
			repoRoot,
		});
		expect(draft).toContain("世界书未定稿");
		expect(draft).toContain("tapcanvas_book_worldbible_confirm");
		const indexPath = path.join(
			repoRoot,
			"project-data",
			"users",
			OWNER,
			"projects",
			PROJECT,
			"books",
			BOOK_DIR,
			"index.json",
		);
		const idx = JSON.parse(await fs.readFile(indexPath, "utf8"));
		idx.worldBible = { status: "confirmed", confirmedAt: "2026-07-14T00:00:00Z" };
		await fs.writeFile(indexPath, JSON.stringify(idx), "utf8");
		const confirmed = await buildBookIndexContextBlock({
			db,
			chapterId: CHAPTER_ID,
			projectId: PROJECT,
			repoRoot,
		});
		expect(confirmed).not.toContain("世界书未定稿");
		// 还原现场
		delete idx.worldBible;
		await fs.writeFile(indexPath, JSON.stringify(idx), "utf8");
	});
});
