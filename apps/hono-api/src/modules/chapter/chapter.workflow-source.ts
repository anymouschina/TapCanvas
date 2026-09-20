import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import type { AppContext } from "../../types";
import { AppError } from "../../middleware/error";
import { readBookIndex } from "../asset/book-index-store";
import { sanitizeImportedBookText } from "../asset/book-text-sanitizer";
import { resolveProjectBookDirectoryPath } from "../task/agents-tool-bridge.book-lookup";
import { getProjectForUserAccess } from "../project/project.repo";
import { getChapterCanvasFlow } from "./chapter.canvas-flow.service";
import { getChapterForUser } from "./chapter.service";
import type { CanvasFlow } from "./chapter.canvas-flow.schemas";

function record(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? value as Record<string, unknown> : {};
}

export async function readBoundBookChapterText(directory: string, chapter: number): Promise<string> {
	const index = await readBookIndex(path.join(directory, "index.json"));
	const target = (Array.isArray(index.chapters) ? index.chapters : [])
		.map(record).find((entry) => entry.chapter === chapter);
	if (!target) throw new Error(`Bound book chapter ${chapter} is missing from its index`);
	let text: string;
	if (typeof target.contentFile === "string" && target.contentFile.trim()) {
		const file = path.resolve(directory, target.contentFile);
		if (!file.startsWith(`${path.resolve(directory)}${path.sep}`)) throw new Error("Book chapter contentFile escapes its book directory");
		const content = record(JSON.parse(await fs.readFile(file, "utf8")) as unknown).content;
		if (typeof content !== "string") throw new Error("Book chapter content is not text");
		text = content;
	} else {
		const raw = await fs.readFile(path.join(directory, "raw.md"), "utf8");
		const { startOffset, endOffset } = target;
		if (typeof startOffset !== "number" || typeof endOffset !== "number"
			|| !Number.isInteger(startOffset) || !Number.isInteger(endOffset)
			|| startOffset < 0 || endOffset <= startOffset || endOffset > raw.length) {
			throw new Error("Bound book chapter has invalid source offsets");
		}
		text = sanitizeImportedBookText(raw.slice(startOffset, endOffset));
	}
	if (!text.trim()) throw new Error("Bound book chapter narrative is empty");
	return text.trim();
}

/** Project the saved chapter source for production while keeping the canvas text editable. */
export function projectChapterNarrativeSnapshot(input: {
	chapterId: string; title: string; text: string; revision: number; flow: CanvasFlow | null;
}): CanvasFlow {
	if (!input.text.trim()) throw new Error("Chapter narrative is empty");
	const flow = input.flow ?? { nodes: [], edges: [] };
	const id = `chapter-seed-${input.chapterId}`;
	const existing = flow.nodes.find((node) => node.id === id);
	const sourceHash = createHash("sha256").update(JSON.stringify({ chapterId: input.chapterId,
		title: input.title, summary: input.text, storyPreviewContract: record(existing?.data).storyPreviewContract ?? null })).digest("hex");
	const node = { ...existing, id, type: "taskNode", position: existing?.position ?? { x: 0, y: 0 },
		data: { ...record(existing?.data), kind: "text", preset: "chapter-info", locked: true, readOnly: false,
			label: input.title, chapterTitle: input.title, chapterText: input.text, content: input.text,
			prompt: `【${input.title}】\n\n${input.text}`, sourceChapterRevision: input.revision, sourceHash } };
	return { ...flow, nodes: [node, ...flow.nodes.filter((candidate) => candidate.id !== id)] };
}

export async function loadChapterWorkflowSource(c: AppContext, userId: string, projectId: string, chapterId: string) {
	const chapter = await getChapterForUser(c, userId, chapterId);
	const project = await getProjectForUserAccess(c.env.DB, projectId, userId);
	if (!project?.owner_id || chapter.projectId !== projectId) throw new AppError("Chapter is not in the requested project", { status: 404, code: "chapter_not_found" });
	const canvas = await getChapterCanvasFlow(c, userId, chapterId, true);
	const savedSeed = canvas.flow?.nodes.find((node) => node.id === `chapter-seed-${chapterId}`);
	const savedText = record(savedSeed?.data).chapterText;
	let text = typeof savedText === "string" ? savedText.trim() : chapter.summary?.trim() ?? "";
	if (typeof savedText !== "string" && !text && chapter.sourceBookId && chapter.sourceBookChapter != null) {
		const directory = await resolveProjectBookDirectoryPath({ projectId, userId: project.owner_id, requestedBookId: chapter.sourceBookId });
		if (!directory) throw new AppError("Bound chapter book is missing", { status: 404, code: "book_not_found" });
		text = await readBoundBookChapterText(directory, chapter.sourceBookChapter);
	}
	const flow = projectChapterNarrativeSnapshot({ chapterId, title: chapter.title, text, revision: canvas.revision, flow: canvas.flow });
	return { flow, revision: canvas.revision, chapter };
}
