import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AppContext } from "../../types";

const chapterSourceMocks = vi.hoisted(() => ({
	getChapterByIdForOwner: vi.fn(),
	getChapterCanvasFlow: vi.fn(),
}));

vi.mock("../chapter/chapter.repo", () => ({
	getChapterByIdForOwner: chapterSourceMocks.getChapterByIdForOwner,
}));

vi.mock("../chapter/chapter.canvas-flow.service", () => ({
	getChapterCanvasFlow: chapterSourceMocks.getChapterCanvasFlow,
}));

import {
	readVerifiedBookChapterSource,
	resolveVerifiedStoryFactSource,
} from "./story-facts.source";

const PROJECT_ID = "project-story-source";
const BOOK_ID = "book-story-source";
const OWNER_ID = "owner-story-source";
const REQUEST_USER_ID = "request-user-story-source";
const tempRoots: string[] = [];

function sha256(value: string): string {
	return crypto.createHash("sha256").update(value).digest("hex");
}

async function createTempRoot(): Promise<string> {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "tapcanvas-story-facts-source-"));
	tempRoots.push(root);
	return root;
}

async function writeIndex(
	bookDir: string,
	input: {
		projectId?: string;
		bookId?: string;
		chapters: Array<Record<string, unknown>>;
	},
): Promise<void> {
	await fs.mkdir(bookDir, { recursive: true });
	await fs.writeFile(
		path.join(bookDir, "index.json"),
		`${JSON.stringify(
			{
				projectId: input.projectId ?? PROJECT_ID,
				bookId: input.bookId ?? BOOK_ID,
				chapters: input.chapters,
				assets: {},
			},
			null,
			2,
		)}\n`,
		"utf8",
	);
}

function resolveBookChapterSource(bookDir: string, chapter: number) {
	return resolveVerifiedStoryFactSource({
		c: { env: { DB: {} } } as AppContext,
		requestUserId: REQUEST_USER_ID,
		projectOwnerId: OWNER_ID,
		projectId: PROJECT_ID,
		bookId: BOOK_ID,
		bookDir,
		selector: { kind: "book_chapter", chapter },
	});
}

afterEach(async () => {
	vi.clearAllMocks();
	const roots = tempRoots.splice(0, tempRoots.length);
	await Promise.all(roots.map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("resolveVerifiedStoryFactSource", () => {
	it("returns exact verified chapter content for an authorized workflow source node", async () => {
		const bookDir = path.join(await createTempRoot(), "book");
		const contentFile = "chapters/chapter-1.json";
		const content = "  第一章正文原样保留。\n第二行。  ";
		await writeIndex(bookDir, {
			chapters: [{ chapter: 1, contentFile }],
		});
		await fs.mkdir(path.join(bookDir, "chapters"), { recursive: true });
		await fs.writeFile(
			path.join(bookDir, contentFile),
			JSON.stringify({ content }),
			"utf8",
		);

		await expect(readVerifiedBookChapterSource({
			bookDir,
			projectId: PROJECT_ID,
			bookId: BOOK_ID,
			chapter: 1,
		})).resolves.toEqual({
			content,
			contentSha256: sha256(content),
			fileName: contentFile,
		});
	});

	it("fresh-reads a chapter JSON file and hashes the exact persisted text", async () => {
		const bookDir = path.join(await createTempRoot(), "book");
		const contentFile = "chapters/chapter-1.json";
		const content = "  第一章正文。\n第二行仍保留空白。  ";
		await writeIndex(bookDir, {
			chapters: [{ chapter: 1, contentFile }],
		});
		await fs.mkdir(path.join(bookDir, "chapters"), { recursive: true });
		await fs.writeFile(
			path.join(bookDir, contentFile),
			JSON.stringify({ content }),
			"utf8",
		);

		const source = await resolveBookChapterSource(bookDir, 1);

		expect(source).toMatchObject({
			kind: "book_chapter",
			projectId: PROJECT_ID,
			bookId: BOOK_ID,
			chapter: 1,
			fileName: contentFile,
			contentChars: content.length,
			contentSha256: sha256(content),
		});
	});

	it("fresh-reads the exact raw.md offset range", async () => {
		const bookDir = path.join(await createTempRoot(), "book");
		const raw = "序言\n第一章正文\n第二章正文\n尾声";
		const chapterText = "第一章正文\n";
		const startOffset = raw.indexOf(chapterText);
		const endOffset = startOffset + chapterText.length;
		await writeIndex(bookDir, {
			chapters: [{ chapter: 1, startOffset, endOffset }],
		});
		await fs.writeFile(path.join(bookDir, "raw.md"), raw, "utf8");

		const source = await resolveBookChapterSource(bookDir, 1);

		expect(source).toMatchObject({
			fileName: "raw.md",
			contentChars: chapterText.length,
			contentSha256: sha256(chapterText),
		});
	});

	it("rejects escaped content paths and empty persisted sources", async () => {
		const root = await createTempRoot();
		const escapedBookDir = path.join(root, "escaped-book");
		await writeIndex(escapedBookDir, {
			chapters: [{ chapter: 1, contentFile: "../outside.json" }],
		});
		await fs.writeFile(path.join(root, "outside.json"), JSON.stringify({ content: "越界正文" }), "utf8");

		await expect(resolveBookChapterSource(escapedBookDir, 1)).rejects.toMatchObject({
			code: "story_fact_source_path_invalid",
		});

		const emptyBookDir = path.join(root, "empty-book");
		await writeIndex(emptyBookDir, {
			chapters: [{ chapter: 1, contentFile: "chapters/chapter-1.json" }],
		});
		await fs.mkdir(path.join(emptyBookDir, "chapters"), { recursive: true });
		await fs.writeFile(
			path.join(emptyBookDir, "chapters/chapter-1.json"),
			JSON.stringify({ content: "  \n\t" }),
			"utf8",
		);

		await expect(resolveBookChapterSource(emptyBookDir, 1)).rejects.toMatchObject({
			code: "story_fact_source_empty",
		});
	});

	it("rejects book and project identity mismatches in the fresh index", async () => {
		const root = await createTempRoot();
		const wrongBookDir = path.join(root, "wrong-book");
		await writeIndex(wrongBookDir, {
			bookId: "different-book",
			chapters: [{ chapter: 1, startOffset: 0, endOffset: 1 }],
		});
		await fs.writeFile(path.join(wrongBookDir, "raw.md"), "正文", "utf8");
		await expect(resolveBookChapterSource(wrongBookDir, 1)).rejects.toMatchObject({
			code: "story_fact_source_book_mismatch",
		});

		const wrongProjectDir = path.join(root, "wrong-project");
		await writeIndex(wrongProjectDir, {
			projectId: "different-project",
			chapters: [{ chapter: 1, startOffset: 0, endOffset: 1 }],
		});
		await fs.writeFile(path.join(wrongProjectDir, "raw.md"), "正文", "utf8");
		await expect(resolveBookChapterSource(wrongProjectDir, 1)).rejects.toMatchObject({
			code: "story_fact_source_project_mismatch",
		});
	});

	it("requires a chapter canvas source to be explicitly linked to the target book", async () => {
		chapterSourceMocks.getChapterByIdForOwner.mockResolvedValue({
			id: "chapter-3",
			project_id: PROJECT_ID,
			chapter_index: 3,
			source_book_id: null,
			source_book_chapter: null,
		});

		await expect(
			resolveVerifiedStoryFactSource({
				c: { env: { DB: {} } } as AppContext,
				requestUserId: REQUEST_USER_ID,
				projectOwnerId: OWNER_ID,
				projectId: PROJECT_ID,
				bookId: BOOK_ID,
				bookDir: "/unused-for-canvas-source",
				selector: {
					kind: "chapter_canvas_node",
					chapterId: "chapter-3",
					nodeId: "node-script",
					field: "content",
				},
			}),
		).rejects.toMatchObject({ code: "story_fact_source_book_mismatch" });
		expect(chapterSourceMocks.getChapterCanvasFlow).not.toHaveBeenCalled();
	});

	it("hashes the exact saved chapter canvas field after book-scope verification", async () => {
		const content = "  已保存剧本节点正文。\n保留尾部空格。  ";
		chapterSourceMocks.getChapterByIdForOwner.mockResolvedValue({
			id: "chapter-3",
			project_id: PROJECT_ID,
			chapter_index: 3,
			source_book_id: BOOK_ID,
			source_book_chapter: 7,
		});
		chapterSourceMocks.getChapterCanvasFlow.mockResolvedValue({
			flow: {
				nodes: [{ id: "node-script", data: { content } }],
			},
		});

		const source = await resolveVerifiedStoryFactSource({
			c: { env: { DB: {} } } as AppContext,
			requestUserId: REQUEST_USER_ID,
			projectOwnerId: OWNER_ID,
			projectId: PROJECT_ID,
			bookId: BOOK_ID,
			bookDir: "/unused-for-canvas-source",
			selector: {
				kind: "chapter_canvas_node",
				chapterId: "chapter-3",
				nodeId: "node-script",
				field: "content",
			},
		});

		expect(source).toMatchObject({
			kind: "chapter_canvas_node",
			chapter: 7,
			chapterId: "chapter-3",
			nodeId: "node-script",
			field: "content",
			contentChars: content.length,
			contentSha256: sha256(content),
		});
	});
});
