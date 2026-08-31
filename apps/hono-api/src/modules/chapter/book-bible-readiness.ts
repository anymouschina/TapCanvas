import { AppError } from "../../middleware/error";
import { queryAll } from "../../db/db";
import type { PrismaClient } from "../../types";
import {
	BOOK_BIBLE_ARTIFACTS,
	hasBookBibleArtifactContent,
	readBookBibleArtifactType,
	type BookBibleArtifactType,
} from "./book-bible-contract";

type ChapterCanvasRow = Readonly<{
	id: string;
	canvas_flow: string | null;
}>;

function readCanvasNodes(row: ChapterCanvasRow): Array<Record<string, unknown>> {
	if (!row.canvas_flow) return [];
	let parsed: unknown;
	try {
		parsed = JSON.parse(row.canvas_flow);
	} catch (error) {
		throw new AppError("章节画布 JSON 无法解析，不能确认世界书就绪状态", {
			status: 409,
			code: "book_bible_canvas_invalid",
			details: {
				chapterId: row.id,
				reason: error instanceof Error ? error.message : String(error),
			},
		});
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
	const nodes = (parsed as { nodes?: unknown }).nodes;
	return Array.isArray(nodes)
		? nodes.filter((node): node is Record<string, unknown> =>
			Boolean(node && typeof node === "object" && !Array.isArray(node)))
		: [];
}

export async function collectBookBibleReadiness(
	db: PrismaClient,
	projectId: string,
): Promise<{ present: string[]; missing: string[] }> {
	const rows = await queryAll<ChapterCanvasRow>(
		db,
		`SELECT id, canvas_flow FROM chapters
		 WHERE project_id = ? AND canvas_flow IS NOT NULL AND canvas_flow LIKE ?
		 ORDER BY chapter_index DESC`,
		[projectId, '%"bookBibleType"%'],
	);
	const presentTypes = new Set<BookBibleArtifactType>();
	for (const row of rows) {
		for (const node of readCanvasNodes(row)) {
			const rawData = node.data;
			if (!rawData || typeof rawData !== "object" || Array.isArray(rawData)) continue;
			const data = rawData as Record<string, unknown>;
			const artifactType = readBookBibleArtifactType(data);
			if (artifactType && hasBookBibleArtifactContent(data)) presentTypes.add(artifactType);
		}
	}
	return {
		present: BOOK_BIBLE_ARTIFACTS
			.filter((artifact) => presentTypes.has(artifact.type))
			.map((artifact) => artifact.name),
		missing: BOOK_BIBLE_ARTIFACTS
			.filter((artifact) => !presentTypes.has(artifact.type))
			.map((artifact) => artifact.name),
	};
}
