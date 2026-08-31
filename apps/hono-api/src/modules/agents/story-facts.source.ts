import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { AppError } from "../../middleware/error";
import type { AppContext } from "../../types";
import { BookIndexStoreError, readBookIndex } from "../asset/book-index-store";
import { getChapterByIdForOwner } from "../chapter/chapter.repo";
import { getChapterCanvasFlow } from "../chapter/chapter.canvas-flow.service";
import { resolveProjectWorkspaceContextDir } from "./project-context.service";
import type {
	StoryFactSourceSelector,
	VerifiedStoryFactSource,
} from "./story-facts.schemas";

type UnknownRecord = Record<string, unknown>;

function readText(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function readSourceText(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function sha256(value: string): string {
	return crypto.createHash("sha256").update(value).digest("hex");
}

function buildVerifiedSource(input: {
	selector: StoryFactSourceSelector;
	projectId: string;
	bookId: string;
	content: string;
	chapter?: number;
	fileName?: string;
}): VerifiedStoryFactSource {
	const content = input.content;
	if (!content.trim()) {
		throw new AppError("Story fact source is empty", {
			status: 409,
			code: "story_fact_source_empty",
			details: { sourceKind: input.selector.kind },
		});
	}
	return {
		kind: input.selector.kind,
		projectId: input.projectId,
		bookId: input.bookId,
		...(typeof input.chapter === "number" ? { chapter: input.chapter } : {}),
		...(input.selector.kind === "chapter_canvas_node"
			? {
					chapterId: input.selector.chapterId,
					nodeId: input.selector.nodeId,
					field: input.selector.field,
			  }
			: {}),
		...(input.fileName ? { fileName: input.fileName } : {}),
		contentSha256: sha256(content),
		contentChars: content.length,
		capturedAt: new Date().toISOString(),
	};
}

function assertPathWithinRoot(rootDir: string, candidatePath: string): void {
	const normalizedRootDir = `${path.resolve(rootDir)}${path.sep}`;
	const normalizedCandidate = path.resolve(candidatePath);
	if (normalizedCandidate.startsWith(normalizedRootDir)) return;
	throw new AppError("Story fact source path escapes its authorized root", {
		status: 500,
		code: "story_fact_source_path_invalid",
		details: { rootDir, candidatePath },
	});
}

async function resolveReadablePathWithinRoot(
	rootDir: string,
	candidatePath: string,
	errorOptions?: { message: string; status: number; code: string },
): Promise<string> {
	assertPathWithinRoot(rootDir, candidatePath);
	let realRootDir: string;
	let realCandidatePath: string;
	try {
		[realRootDir, realCandidatePath] = await Promise.all([
			fs.realpath(rootDir),
			fs.realpath(candidatePath),
		]);
	} catch (error) {
		throw new AppError(errorOptions?.message ?? "Story fact source path could not be resolved", {
			status: errorOptions?.status ?? 500,
			code: errorOptions?.code ?? "story_fact_source_read_failed",
			details: {
				rootDir,
				candidatePath,
				reason: error instanceof Error ? error.message : String(error),
			},
		});
	}
	assertPathWithinRoot(realRootDir, realCandidatePath);
	return realCandidatePath;
}

async function readBookIndexStrict(indexPath: string): Promise<UnknownRecord> {
	try {
		return await readBookIndex(indexPath);
	} catch (error) {
		if (error instanceof BookIndexStoreError) {
			throw new AppError(error.message, {
				status: error.code === "book_index_not_found" ? 404 : 500,
				code: error.code,
				details: error.details,
			});
		}
		throw error;
	}
}

export async function readVerifiedBookChapterSource(input: {
	bookDir: string;
	projectId: string;
	bookId: string;
	chapter: number;
}): Promise<{ content: string; contentSha256: string; fileName: string }> {
	const indexPath = await resolveReadablePathWithinRoot(
		input.bookDir,
		path.join(input.bookDir, "index.json"),
	);
	const index = await readBookIndexStrict(indexPath);
	const actualProjectId = readText(index.projectId);
	if (actualProjectId !== input.projectId) {
		throw new AppError("Book index project identity does not match story fact source", {
			status: 409,
			code: "story_fact_source_project_mismatch",
			details: { expectedProjectId: input.projectId, actualProjectId },
		});
	}
	const actualBookId = readText(index.bookId);
	if (actualBookId !== input.bookId) {
		throw new AppError("Book index identity does not match story fact source", {
			status: 409,
			code: "story_fact_source_book_mismatch",
			details: { expectedBookId: input.bookId, actualBookId },
		});
	}
	const chapters = Array.isArray(index.chapters) ? index.chapters : [];
	const chapterRecord = chapters.find((item) => {
		if (!item || typeof item !== "object" || Array.isArray(item)) return false;
		return Number((item as UnknownRecord).chapter) === input.chapter;
	});
	if (!chapterRecord || typeof chapterRecord !== "object" || Array.isArray(chapterRecord)) {
		throw new AppError("Book chapter source not found", {
			status: 404,
			code: "story_fact_source_chapter_not_found",
			details: { bookId: input.bookId, chapter: input.chapter },
		});
	}
	const chapter = chapterRecord as UnknownRecord;
	const contentFile = readText(chapter.contentFile);
	if (contentFile) {
		const contentPath = await resolveReadablePathWithinRoot(
			input.bookDir,
			path.resolve(input.bookDir, contentFile),
		);
		let raw: string;
		try {
			raw = await fs.readFile(contentPath, "utf8");
		} catch (error) {
			throw new AppError("Book chapter content file read failed", {
				status: 500,
				code: "story_fact_source_read_failed",
				details: {
					contentPath,
					reason: error instanceof Error ? error.message : String(error),
				},
			});
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(raw) as unknown;
		} catch (error) {
			throw new AppError("Book chapter content file is invalid JSON", {
				status: 500,
				code: "story_fact_source_parse_failed",
				details: {
					contentPath,
					reason: error instanceof Error ? error.message : String(error),
				},
			});
		}
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			throw new AppError("Book chapter content file must contain an object", {
				status: 500,
				code: "story_fact_source_invalid",
				details: { contentPath },
			});
		}
		const content = readSourceText((parsed as UnknownRecord).content);
		return {
			content,
			contentSha256: sha256(content),
			fileName: contentFile,
		};
	}

	const rawPath = await resolveReadablePathWithinRoot(
		input.bookDir,
		path.join(input.bookDir, "raw.md"),
	);
	let raw: string;
	try {
		raw = await fs.readFile(rawPath, "utf8");
	} catch (error) {
		throw new AppError("Book raw source read failed", {
			status: 500,
			code: "story_fact_source_read_failed",
			details: {
				rawPath,
				reason: error instanceof Error ? error.message : String(error),
			},
		});
	}
	const startOffset = Number(chapter.startOffset);
	const endOffset = Number(chapter.endOffset);
	if (
		!Number.isInteger(startOffset) ||
		!Number.isInteger(endOffset) ||
		startOffset < 0 ||
		endOffset <= startOffset ||
		endOffset > raw.length
	) {
		throw new AppError("Book chapter offsets are invalid", {
			status: 500,
			code: "story_fact_source_offsets_invalid",
			details: { rawPath, startOffset, endOffset, rawLength: raw.length },
		});
	}
	const content = raw.slice(startOffset, endOffset);
	return {
		content,
		contentSha256: sha256(content),
		fileName: "raw.md",
	};
}

async function resolveChapterCanvasNodeSource(input: {
	c: AppContext;
	requestUserId: string;
	projectOwnerId: string;
	projectId: string;
	bookId: string;
	selector: Extract<StoryFactSourceSelector, { kind: "chapter_canvas_node" }>;
}): Promise<VerifiedStoryFactSource> {
	const chapter = await getChapterByIdForOwner({
		db: input.c.env.DB,
		chapterId: input.selector.chapterId,
		ownerId: input.projectOwnerId,
	});
	if (!chapter || chapter.project_id !== input.projectId) {
		throw new AppError("Chapter canvas source is outside the authorized project", {
			status: 404,
			code: "story_fact_source_chapter_not_found",
			details: { chapterId: input.selector.chapterId, projectId: input.projectId },
		});
	}
	if (chapter.source_book_id !== input.bookId) {
		throw new AppError("Chapter canvas source is not linked to the requested book", {
			status: 409,
			code: "story_fact_source_book_mismatch",
			details: {
				chapterId: chapter.id,
				expectedBookId: input.bookId,
				actualBookId: chapter.source_book_id,
			},
		});
	}
	const { flow } = await getChapterCanvasFlow(input.c, input.requestUserId, chapter.id);
	const nodes = Array.isArray(flow?.nodes) ? flow.nodes : [];
	const node = nodes.find((item) => {
		if (!item || typeof item !== "object" || Array.isArray(item)) return false;
		return String((item as UnknownRecord).id ?? "").trim() === input.selector.nodeId;
	});
	if (!node || typeof node !== "object" || Array.isArray(node)) {
		throw new AppError("Story fact source node not found", {
			status: 404,
			code: "story_fact_source_node_not_found",
			details: { chapterId: chapter.id, nodeId: input.selector.nodeId },
		});
	}
	const data = (node as UnknownRecord).data;
	if (!data || typeof data !== "object" || Array.isArray(data)) {
		throw new AppError("Story fact source node data is invalid", {
			status: 409,
			code: "story_fact_source_field_invalid",
			details: { chapterId: chapter.id, nodeId: input.selector.nodeId },
		});
	}
	const content = readSourceText((data as UnknownRecord)[input.selector.field]);
	return buildVerifiedSource({
		selector: input.selector,
		projectId: input.projectId,
		bookId: input.bookId,
		content,
		chapter: chapter.source_book_chapter ?? chapter.chapter_index,
	});
}

export async function resolveVerifiedStoryFactSource(input: {
	c: AppContext;
	requestUserId: string;
	projectOwnerId: string;
	projectId: string;
	bookId: string;
	bookDir: string;
	selector: StoryFactSourceSelector;
}): Promise<VerifiedStoryFactSource> {
	if (input.selector.kind === "chapter_canvas_node") {
		return resolveChapterCanvasNodeSource({
			c: input.c,
			requestUserId: input.requestUserId,
			projectOwnerId: input.projectOwnerId,
			projectId: input.projectId,
			bookId: input.bookId,
			selector: input.selector,
		});
	}
	if (input.selector.kind === "book_chapter") {
		const source = await readVerifiedBookChapterSource({
			bookDir: input.bookDir,
			projectId: input.projectId,
			bookId: input.bookId,
			chapter: input.selector.chapter,
		});
		return buildVerifiedSource({
			selector: input.selector,
			projectId: input.projectId,
			bookId: input.bookId,
			content: source.content,
			chapter: input.selector.chapter,
			fileName: source.fileName,
		});
	}

	const contextDir = resolveProjectWorkspaceContextDir(input.projectId, input.projectOwnerId);
	const fileName = "CREATIVE_BRIEF.md";
	const filePath = await resolveReadablePathWithinRoot(contextDir, path.join(contextDir, fileName), {
		message: "Creative brief source read failed",
		status: 404,
		code: "story_fact_source_creative_brief_not_found",
	});
	let content: string;
	try {
		content = await fs.readFile(filePath, "utf8");
	} catch (error) {
		throw new AppError("Creative brief source read failed", {
			status: 404,
			code: "story_fact_source_creative_brief_not_found",
			details: {
				filePath,
				reason: error instanceof Error ? error.message : String(error),
			},
		});
	}
	return buildVerifiedSource({
		selector: input.selector,
		projectId: input.projectId,
		bookId: input.bookId,
		content,
		fileName,
	});
}
