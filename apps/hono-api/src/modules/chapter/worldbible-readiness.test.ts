import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	getWorldBibleReminderForChapter,
	getWorldBibleReminderForProject,
	isWorldBibleConfirmed,
} from "./worldbible-readiness";

const OWNER = "phone_owner123";
const PROJECT = "proj-abc";
const BOOK_DRAFT = "book-draft-1";
const BOOK_DONE = "book-done-2";

let repoRoot = "";

async function writeIndex(bookDir: string, extra: Record<string, unknown>): Promise<void> {
	const dir = path.join(
		repoRoot,
		"project-data",
		"users",
		OWNER,
		"projects",
		PROJECT,
		"books",
		bookDir,
	);
	await fs.mkdir(dir, { recursive: true });
	await fs.writeFile(
		path.join(dir, "index.json"),
		JSON.stringify({ bookId: bookDir, projectId: PROJECT, title: "测试书", chapters: [], ...extra }),
		"utf8",
	);
}

beforeAll(async () => {
	repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "worldbible-readiness-"));
	await writeIndex(BOOK_DRAFT, {});
	await writeIndex(BOOK_DONE, {
		worldBible: { status: "confirmed", confirmedAt: "2026-07-14T00:00:00Z" },
	});
});

afterAll(async () => {
	await fs.rm(repoRoot, { recursive: true, force: true });
});

describe("isWorldBibleConfirmed", () => {
	it("字段缺失/非对象/status≠confirmed → false；confirmed → true", () => {
		expect(isWorldBibleConfirmed(null)).toBe(false);
		expect(isWorldBibleConfirmed({})).toBe(false);
		expect(isWorldBibleConfirmed({ worldBible: "yes" })).toBe(false);
		expect(isWorldBibleConfirmed({ worldBible: { status: "draft" } })).toBe(false);
		expect(isWorldBibleConfirmed({ worldBible: { status: "confirmed" } })).toBe(true);
	});
});

describe("getWorldBibleReminderForChapter", () => {
	it("书级章节+未定稿 → 提醒文案（含定稿工具名）", async () => {
		const r = await getWorldBibleReminderForChapter({
			projectId: PROJECT,
			ownerId: OWNER,
			chapterId: `book-${BOOK_DRAFT}-ch1`,
			repoRoot,
		});
		expect(r).toContain("世界书未定稿");
		expect(r).toContain("tapcanvas_book_worldbible_confirm");
	});

	it("已定稿 → null；非书级 chapterId → null", async () => {
		expect(
			await getWorldBibleReminderForChapter({
				projectId: PROJECT,
				ownerId: OWNER,
				chapterId: `book-${BOOK_DONE}-ch1`,
				repoRoot,
			}),
		).toBeNull();
		expect(
			await getWorldBibleReminderForChapter({
				projectId: PROJECT,
				ownerId: OWNER,
				chapterId: "uuid-not-book",
				repoRoot,
			}),
		).toBeNull();
	});

	it("chapterId 是书级形态但 index.json 读不到 → 仍提醒（按未定稿处理）", async () => {
		const r = await getWorldBibleReminderForChapter({
			projectId: PROJECT,
			ownerId: OWNER,
			chapterId: "book-no-such-book-ch1",
			repoRoot,
		});
		expect(r).toContain("世界书未定稿");
	});
});

describe("getWorldBibleReminderForProject", () => {
	it("项目下存在未定稿的书 → 提醒", async () => {
		const r = await getWorldBibleReminderForProject({
			projectId: PROJECT,
			ownerId: OWNER,
			repoRoot,
		});
		expect(r).toContain("世界书未定稿");
	});

	it("无书的项目 → null；全部已定稿 → null", async () => {
		expect(
			await getWorldBibleReminderForProject({
				projectId: "proj-nobooks",
				ownerId: OWNER,
				repoRoot,
			}),
		).toBeNull();
		await writeIndex(BOOK_DRAFT, {
			worldBible: { status: "confirmed", confirmedAt: "2026-07-14T00:00:00Z" },
		});
		expect(
			await getWorldBibleReminderForProject({ projectId: PROJECT, ownerId: OWNER, repoRoot }),
		).toBeNull();
		// 还原现场
		await writeIndex(BOOK_DRAFT, {});
	});
});
