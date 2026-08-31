import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { AppError } from "../../middleware/error";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function replaceChapterScopedIdentity(
	value: string,
	input: {
		sourceProjectId: string;
		targetProjectId: string;
		sourceChapterId: string;
		targetChapterId: string;
	},
): string {
	if (value === input.sourceProjectId) return input.targetProjectId;
	if (value === input.sourceChapterId) return input.targetChapterId;
	return value
		.replaceAll(
			`project-node:chapter:${input.sourceChapterId}:`,
			`project-node:chapter:${input.targetChapterId}:`,
		)
		.replaceAll(
			`chapter-seed-${input.sourceChapterId}`,
			`chapter-seed-${input.targetChapterId}`,
		)
		.replaceAll(
			`chapter:${input.sourceChapterId}`,
			`chapter:${input.targetChapterId}`,
		);
}

function rewriteChapterScopedValue(
	value: unknown,
	input: {
		sourceProjectId: string;
		targetProjectId: string;
		sourceChapterId: string;
		targetChapterId: string;
	},
): unknown {
	if (typeof value === "string") return replaceChapterScopedIdentity(value, input);
	if (Array.isArray(value)) return value.map((item) => rewriteChapterScopedValue(item, input));
	if (!isRecord(value)) return value;
	return Object.fromEntries(
		Object.entries(value).map(([key, item]) => [key, rewriteChapterScopedValue(item, input)]),
	);
}

export function rewriteClonedChapterCanvasFlow(input: {
	rawFlow: string | null;
	sourceProjectId: string;
	targetProjectId: string;
	sourceChapterId: string;
	targetChapterId: string;
}): string | null {
	if (!input.rawFlow) return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(input.rawFlow) as unknown;
	} catch (error) {
		throw new AppError("Source chapter canvas flow is invalid JSON", {
			status: 500,
			code: "project_clone_chapter_canvas_invalid",
			details: {
				sourceProjectId: input.sourceProjectId,
				sourceChapterId: input.sourceChapterId,
				reason: error instanceof Error ? error.message : String(error),
			},
		});
	}
	if (!isRecord(parsed)) {
		throw new AppError("Source chapter canvas flow must be an object", {
			status: 500,
			code: "project_clone_chapter_canvas_invalid",
			details: {
				sourceProjectId: input.sourceProjectId,
				sourceChapterId: input.sourceChapterId,
			},
		});
	}
	const rewritten = rewriteChapterScopedValue(parsed, input);
	if (!isRecord(rewritten)) {
		throw new AppError("Rewritten chapter canvas flow must be an object", {
			status: 500,
			code: "project_clone_chapter_canvas_invalid",
		});
	}
	return JSON.stringify({
		...rewritten,
		__tapcanvasFlowOwner: {
			ownerType: "chapter",
			ownerId: input.targetChapterId,
		},
	});
}

function rewriteProjectScopedFilePath(
	value: string,
	input: {
		sourceOwnerId: string;
		targetOwnerId: string;
		sourceProjectId: string;
		targetProjectId: string;
	},
): string {
	const sourceScope = path.join(
		"project-data",
		"users",
		input.sourceOwnerId,
		"projects",
		input.sourceProjectId,
	);
	const targetScope = path.join(
		"project-data",
		"users",
		input.targetOwnerId,
		"projects",
		input.targetProjectId,
	);
	return value.replace(sourceScope, targetScope);
}

function rewriteBookIndexPaths(
	value: unknown,
	input: {
		sourceOwnerId: string;
		targetOwnerId: string;
		sourceProjectId: string;
		targetProjectId: string;
	},
	key: string | null = null,
): unknown {
	if (typeof value === "string") {
		return key === "rawPath" || key === "filePath"
			? rewriteProjectScopedFilePath(value, input)
			: value;
	}
	if (Array.isArray(value)) return value.map((item) => rewriteBookIndexPaths(item, input));
	if (!isRecord(value)) return value;
	return Object.fromEntries(
		Object.entries(value).map(([entryKey, item]) => [
			entryKey,
			rewriteBookIndexPaths(item, input, entryKey),
		]),
	);
}

async function atomicWriteJson(filePath: string, value: UnknownRecord): Promise<void> {
	const temporaryPath = `${filePath}.clone-${crypto.randomUUID()}.tmp`;
	try {
		await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
		await fs.rename(temporaryPath, filePath);
	} catch (error) {
		await fs.unlink(temporaryPath).catch(() => undefined);
		throw new AppError("Failed to rewrite cloned book identity", {
			status: 500,
			code: "project_clone_book_identity_rewrite_failed",
			details: {
				filePath,
				reason: error instanceof Error ? error.message : String(error),
			},
		});
	}
}

export async function rewriteClonedBookIndexes(input: {
	targetBooksRoot: string;
	sourceOwnerId: string;
	targetOwnerId: string;
	sourceProjectId: string;
	targetProjectId: string;
}): Promise<number> {
	const bookEntries = await fs.readdir(input.targetBooksRoot, { withFileTypes: true });
	let rewrittenCount = 0;
	for (const entry of bookEntries) {
		if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
		const indexPath = path.join(input.targetBooksRoot, entry.name, "index.json");
		const raw = await fs.readFile(indexPath, "utf8").catch((error: unknown) => {
			throw new AppError("Cloned book index is unreadable", {
				status: 500,
				code: "project_clone_book_index_unreadable",
				details: {
					indexPath,
					reason: error instanceof Error ? error.message : String(error),
				},
			});
		});
		let parsed: unknown;
		try {
			parsed = JSON.parse(raw) as unknown;
		} catch (error) {
			throw new AppError("Cloned book index is invalid JSON", {
				status: 500,
				code: "project_clone_book_index_invalid",
				details: {
					indexPath,
					reason: error instanceof Error ? error.message : String(error),
				},
			});
		}
		if (!isRecord(parsed)) {
			throw new AppError("Cloned book index must be an object", {
				status: 500,
				code: "project_clone_book_index_invalid",
				details: { indexPath },
			});
		}
		const rewritten = rewriteBookIndexPaths(parsed, input);
		if (!isRecord(rewritten)) {
			throw new AppError("Rewritten book index must be an object", {
				status: 500,
				code: "project_clone_book_index_invalid",
				details: { indexPath },
			});
		}
		await atomicWriteJson(indexPath, {
			...rewritten,
			projectId: input.targetProjectId,
		});
		rewrittenCount += 1;
	}
	return rewrittenCount;
}
