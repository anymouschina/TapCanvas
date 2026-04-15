import type { AppContext } from "../../types";
import { AppError } from "../../middleware/error";
import { getProjectForOwner } from "../project/project.repo";
import type { ChapterDto } from "./chapter.schemas";
import {
	createChapterRow,
	deleteChapterRow,
	findLatestWorkedChapterByProjectForOwner,
	getChapterByIdForOwner,
	listChaptersByProjectForOwner,
	touchChapterLastWorkedAt,
	type ChapterRow,
	updateChapterRow,
} from "./chapter.repo";
import { createEmptyStoryboardShotForChapter, deleteStoryboardShotForOwner, getShotForOwner, listStoryboardShotsByChapter, moveStoryboardShotForOwner, updateStoryboardShotForOwner } from "../storyboard/storyboard.repo";
import {
	sanitizeShotSummaryText,
	sanitizeShotTitleText,
} from "../asset/book-text-sanitizer";

function normalizeOptionalText(value: string | null | undefined): string | undefined {
	const trimmed = typeof value === "string" ? value.trim() : "";
	return trimmed || undefined;
}

function compareDateAsc(left?: string, right?: string): number {
	const leftTs = Date.parse(String(left || ""));
	const rightTs = Date.parse(String(right || ""));
	return (Number.isFinite(leftTs) ? leftTs : 0) - (Number.isFinite(rightTs) ? rightTs : 0);
}

function mapChapterRowToDto(row: ChapterRow): ChapterDto {
	return {
		id: row.id,
		projectId: row.project_id,
		index: Number(row.chapter_index || 1),
		title: row.title,
		summary: normalizeOptionalText(row.summary),
		status:
			row.status === "planning" ||
			row.status === "producing" ||
			row.status === "review" ||
			row.status === "approved" ||
			row.status === "locked" ||
			row.status === "archived"
				? row.status
				: "draft",
		sortOrder: Number(row.sort_order || 0),
		coverAssetId: normalizeOptionalText(row.cover_asset_id),
		continuityContext: normalizeOptionalText(row.continuity_context),
		styleProfileOverride: normalizeOptionalText(row.style_profile_override),
		legacyChunkIndex:
			row.legacy_chunk_index == null ? null : Number(row.legacy_chunk_index),
		sourceBookId: normalizeOptionalText(row.source_book_id),
		sourceBookChapter:
			row.source_book_chapter == null ? null : Number(row.source_book_chapter),
		lastWorkedAt: normalizeOptionalText(row.last_worked_at),
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

export function sortChapterDtosForDisplay(chapters: readonly ChapterDto[]): ChapterDto[] {
	return [...chapters].sort((left, right) => {
		const leftSource =
			typeof left.sourceBookChapter === "number" && Number.isFinite(left.sourceBookChapter)
				? Math.trunc(left.sourceBookChapter)
				: null;
		const rightSource =
			typeof right.sourceBookChapter === "number" && Number.isFinite(right.sourceBookChapter)
				? Math.trunc(right.sourceBookChapter)
				: null;
		if (leftSource !== null && rightSource !== null && leftSource !== rightSource) {
			return leftSource - rightSource;
		}
		if (leftSource !== null && rightSource === null) return -1;
		if (leftSource === null && rightSource !== null) return 1;
		if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder;
		if (left.index !== right.index) return left.index - right.index;
		return compareDateAsc(left.createdAt, right.createdAt);
	});
}

function normalizeRecentTaskStatus(value: string): string {
	if (value === "approved") return "succeeded";
	if (value === "review") return "running";
	if (value === "planning" || value === "producing") return "running";
	if (value === "archived" || value === "locked") return "succeeded";
	if (value === "failed") return "failed";
	if (value === "queued" || value === "running" || value === "succeeded") return value;
	return "queued";
}

function compareRecentTaskTimeDesc(
	left: { updatedAt: string },
	right: { updatedAt: string },
): number {
	const leftTs = Date.parse(left.updatedAt || "");
	const rightTs = Date.parse(right.updatedAt || "");
	return (Number.isFinite(rightTs) ? rightTs : 0) - (Number.isFinite(leftTs) ? leftTs : 0);
}

async function requireProjectForOwner(
	c: AppContext,
	userId: string,
	projectId: string,
) {
	const project = await getProjectForOwner(c.env.DB, projectId, userId);
	if (!project) {
		throw new AppError("Project not found", {
			status: 404,
			code: "project_not_found",
		});
	}
	return project;
}

export async function listProjectChaptersForUser(
	c: AppContext,
	userId: string,
	projectId: string,
) {
	await requireProjectForOwner(c, userId, projectId);
	const rows = await listChaptersByProjectForOwner({
		db: c.env.DB,
		projectId,
		ownerId: userId,
	});
	return sortChapterDtosForDisplay(rows.map(mapChapterRowToDto));
}

export async function createChapterForUser(
	c: AppContext,
	userId: string,
	projectId: string,
	input: { title: string; summary?: string },
) {
	await requireProjectForOwner(c, userId, projectId);
	const nowIso = new Date().toISOString();
	const row = await createChapterRow({
		db: c.env.DB,
		id: crypto.randomUUID(),
		projectId,
		ownerId: userId,
		title: input.title.trim(),
		summary: normalizeOptionalText(input.summary) ?? null,
		nowIso,
	});
	return mapChapterRowToDto(row);
}

async function getOrCreateDefaultChapterForProject(
	c: AppContext,
	userId: string,
	projectId: string,
) {
	const rows = await listChaptersByProjectForOwner({
		db: c.env.DB,
		projectId,
		ownerId: userId,
	});
	if (rows.length > 0) {
		const latest =
			(await findLatestWorkedChapterByProjectForOwner({
				db: c.env.DB,
				projectId,
				ownerId: userId,
			})) ?? rows[0];
		return latest;
	}
	return createChapterRow({
		db: c.env.DB,
		id: crypto.randomUUID(),
		projectId,
		ownerId: userId,
		title: "第1章",
		summary: null,
		nowIso: new Date().toISOString(),
	});
}

export async function getProjectDefaultEntryForUser(
	c: AppContext,
	userId: string,
	projectId: string,
) {
	await requireProjectForOwner(c, userId, projectId);
	const chapter = await getOrCreateDefaultChapterForProject(c, userId, projectId);
	return {
		entryType: "chapter" as const,
		projectId,
		chapterId: chapter.id,
	};
}

export async function getChapterForUser(
	c: AppContext,
	userId: string,
	chapterId: string,
) {
	const row = await getChapterByIdForOwner({
		db: c.env.DB,
		chapterId,
		ownerId: userId,
	});
	if (!row) {
		throw new AppError("Chapter not found", {
			status: 404,
			code: "chapter_not_found",
		});
	}
	return mapChapterRowToDto(row);
}

export async function updateChapterForUser(
	c: AppContext,
	userId: string,
	chapterId: string,
	input: {
		title?: string;
		summary?: string;
		status?: string;
		sortOrder?: number;
		sourceBookId?: string | null;
		sourceBookChapter?: number | null;
	},
) {
	const updated = await updateChapterRow({
		db: c.env.DB,
		chapterId,
		ownerId: userId,
		title: typeof input.title === "string" ? input.title.trim() : undefined,
		summary: typeof input.summary === "string" ? input.summary.trim() : undefined,
		status: input.status,
		sortOrder: input.sortOrder,
		sourceBookId:
			input.sourceBookId === null
				? null
				: typeof input.sourceBookId === "string"
					? input.sourceBookId.trim()
					: undefined,
		sourceBookChapter:
			input.sourceBookChapter === null
				? null
				: typeof input.sourceBookChapter === "number"
					? input.sourceBookChapter
					: undefined,
		nowIso: new Date().toISOString(),
	});
	if (!updated) {
		throw new AppError("Chapter not found", {
			status: 404,
			code: "chapter_not_found",
		});
	}
	return mapChapterRowToDto(updated);
}

export async function deleteChapterForUser(
	c: AppContext,
	userId: string,
	chapterId: string,
) {
	const chapterRow = await getChapterByIdForOwner({
		db: c.env.DB,
		chapterId,
		ownerId: userId,
	});
	if (!chapterRow) {
		throw new AppError("Chapter not found", {
			status: 404,
			code: "chapter_not_found",
		});
	}
	const shots = await listStoryboardShotsByChapter({
		db: c.env.DB,
		ownerId: userId,
		projectId: chapterRow.project_id,
		chapterId,
		legacyChunkIndex: chapterRow.legacy_chunk_index ?? null,
	});
	for (const shot of shots) {
		await deleteStoryboardShotForOwner({
			db: c.env.DB,
			ownerId: userId,
			projectId: chapterRow.project_id,
			shotId: shot.id,
		});
	}
	const deleted = await deleteChapterRow({
		db: c.env.DB,
		chapterId,
		ownerId: userId,
	});
	if (!deleted) {
		throw new AppError("Chapter not found", {
			status: 404,
			code: "chapter_not_found",
		});
	}
	return {
		ok: true as const,
		chapterId,
		projectId: chapterRow.project_id,
		deletedShotCount: shots.length,
	};
}

export async function getChapterWorkbenchForUser(
	c: AppContext,
	userId: string,
	chapterId: string,
) {
	const chapterRow = await getChapterByIdForOwner({
		db: c.env.DB,
		chapterId,
		ownerId: userId,
	});
	if (!chapterRow) {
		throw new AppError("Chapter not found", {
			status: 404,
			code: "chapter_not_found",
		});
	}
	const project = await requireProjectForOwner(c, userId, chapterRow.project_id);
	const chapter = mapChapterRowToDto(chapterRow);
	await touchChapterLastWorkedAt({
		db: c.env.DB,
		chapterId,
		ownerId: userId,
		nowIso: new Date().toISOString(),
	});
	const shots = await listStoryboardShotsByChapter({
		db: c.env.DB,
		ownerId: userId,
		projectId: chapter.projectId,
		chapterId,
		legacyChunkIndex: chapter.legacyChunkIndex ?? null,
	});
	const recentTasks = [
		{
			id: `chapter:${chapter.id}:updated`,
			kind: chapter.sourceBookChapter ? "chapter_bound" : "chapter_created",
			status: normalizeRecentTaskStatus(chapter.status),
			ownerType: "chapter" as const,
			ownerId: chapter.id,
			updatedAt: chapter.updatedAt,
		},
		...(chapter.lastWorkedAt && chapter.lastWorkedAt !== chapter.updatedAt
			? [
					{
						id: `chapter:${chapter.id}:lastWorked`,
						kind: "chapter_active",
						status: normalizeRecentTaskStatus(chapter.status),
						ownerType: "chapter" as const,
						ownerId: chapter.id,
						updatedAt: chapter.lastWorkedAt,
					},
				]
			: []),
		...shots.map((shot) => ({
			id: `shot:${shot.id}:updated`,
			kind:
				shot.status === "succeeded"
					? "shot_generated"
					: shot.status === "failed"
						? "shot_rework"
						: shot.status === "running"
							? "shot_running"
							: "shot_planned",
			status: normalizeRecentTaskStatus(shot.status),
			ownerType: "shot" as const,
			ownerId: shot.id,
			updatedAt: shot.updatedAt,
		})),
	]
		.sort(compareRecentTaskTimeDesc)
		.slice(0, 12);
	return {
		project: {
			id: project.id,
			name: project.name,
		},
		chapter,
		shots: shots.map((shot) => ({
			id: shot.id,
			shotIndex: shot.shotIndex,
			title: sanitizeShotTitleText(shot.title) || `镜头 ${shot.shotIndex + 1}`,
			summary: sanitizeShotSummaryText(shot.summary) || (shot.sceneAssetId ? `scene:${shot.sceneAssetId}` : undefined),
			status: shot.status,
			sceneAssetId: shot.sceneAssetId,
			characterAssetIds: shot.characterAssetIds,
			updatedAt: shot.updatedAt,
		})),
		stats: {
			totalShots: shots.length,
			generatedShots: shots.filter((shot) => shot.status === "succeeded").length,
			reviewShots: shots.filter((shot) => shot.status === "queued" || shot.status === "running").length,
			reworkShots: shots.filter((shot) => shot.status === "failed").length,
		},
		recentTasks,
	};
}

export async function createChapterShotForUser(
	c: AppContext,
	userId: string,
	chapterId: string,
) {
	const chapterRow = await getChapterByIdForOwner({
		db: c.env.DB,
		chapterId,
		ownerId: userId,
	});
	if (!chapterRow) {
		throw new AppError("Chapter not found", {
			status: 404,
			code: "chapter_not_found",
		});
	}
	const nowIso = new Date().toISOString();
	const created = await createEmptyStoryboardShotForChapter({
		db: c.env.DB,
		id: crypto.randomUUID(),
		ownerId: userId,
		projectId: chapterRow.project_id,
		chapterId: chapterRow.id,
		chunkIndex: chapterRow.legacy_chunk_index ?? Math.max(0, Number(chapterRow.chapter_index || 1) - 1),
		nowIso,
	});
	return {
		id: created.id,
		shotIndex: created.shotIndex,
		title: sanitizeShotTitleText(created.title) || `镜头 ${created.shotIndex + 1}`,
		summary: sanitizeShotSummaryText(created.summary),
		status: created.status,
		thumbnailUrl: undefined,
		sceneAssetId: created.sceneAssetId || undefined,
		characterAssetIds: created.characterAssetIds,
		updatedAt: created.updatedAt,
	};
}

export async function updateChapterShotForUser(
	c: AppContext,
	userId: string,
	chapterId: string,
	shotId: string,
	input: {
		title?: string;
		summary?: string;
		status?: "queued" | "running" | "succeeded" | "failed";
	},
) {
	const chapterRow = await getChapterByIdForOwner({
		db: c.env.DB,
		chapterId,
		ownerId: userId,
	});
	if (!chapterRow) {
		throw new AppError("Chapter not found", {
			status: 404,
			code: "chapter_not_found",
		});
	}
	const shot = await getShotForOwner(c.env.DB, shotId, userId);
	if (!shot || shot.chapterId !== chapterId) {
		throw new AppError("Shot not found", {
			status: 404,
			code: "shot_not_found",
		});
	}
	const updated = await updateStoryboardShotForOwner({
		db: c.env.DB,
		shotId,
		ownerId: userId,
		title:
			typeof input.title === "string"
				? (sanitizeShotTitleText(input.title) ?? "")
				: undefined,
		summary:
			typeof input.summary === "string"
				? (sanitizeShotSummaryText(input.summary) ?? "")
				: undefined,
		status: input.status,
		nowIso: new Date().toISOString(),
	});
	if (!updated) {
		throw new AppError("Shot not found", {
			status: 404,
			code: "shot_not_found",
		});
	}
	return {
		id: updated.id,
		shotIndex: updated.shotIndex,
		title: sanitizeShotTitleText(updated.title) || `镜头 ${updated.shotIndex + 1}`,
		summary: sanitizeShotSummaryText(updated.summary),
		status: updated.status,
		thumbnailUrl: undefined,
		sceneAssetId: updated.sceneAssetId || undefined,
		characterAssetIds: updated.characterAssetIds,
		updatedAt: updated.updatedAt,
	};
}

export async function moveChapterShotForUser(
	c: AppContext,
	userId: string,
	chapterId: string,
	shotId: string,
	direction: "up" | "down",
) {
	const chapterRow = await getChapterByIdForOwner({
		db: c.env.DB,
		chapterId,
		ownerId: userId,
	});
	if (!chapterRow) {
		throw new AppError("Chapter not found", {
			status: 404,
			code: "chapter_not_found",
		});
	}
	const shot = await getShotForOwner(c.env.DB, shotId, userId);
	if (!shot || shot.chapterId !== chapterId) {
		throw new AppError("Shot not found", {
			status: 404,
			code: "shot_not_found",
		});
	}
	const moved = await moveStoryboardShotForOwner({
		db: c.env.DB,
		shotId,
		ownerId: userId,
		direction,
		nowIso: new Date().toISOString(),
	});
	if (!moved) {
		throw new AppError("Shot not found", {
			status: 404,
			code: "shot_not_found",
		});
	}
	return {
		id: moved.id,
		shotIndex: moved.shotIndex,
		title: sanitizeShotTitleText(moved.title) || `镜头 ${moved.shotIndex + 1}`,
		summary: sanitizeShotSummaryText(moved.summary),
		status: moved.status,
		thumbnailUrl: undefined,
		sceneAssetId: moved.sceneAssetId || undefined,
		characterAssetIds: moved.characterAssetIds,
		updatedAt: moved.updatedAt,
	};
}

export async function deleteChapterShotForUser(
	c: AppContext,
	userId: string,
	chapterId: string,
	shotId: string,
) {
	const chapterRow = await getChapterByIdForOwner({
		db: c.env.DB,
		chapterId,
		ownerId: userId,
	});
	if (!chapterRow) {
		throw new AppError("Chapter not found", {
			status: 404,
			code: "chapter_not_found",
		});
	}
	const shot = await getShotForOwner(c.env.DB, shotId, userId);
	if (!shot || shot.chapterId !== chapterId) {
		throw new AppError("Shot not found", {
			status: 404,
			code: "shot_not_found",
		});
	}
	const deleted = await deleteStoryboardShotForOwner({
		db: c.env.DB,
		shotId,
		ownerId: userId,
	});
	if (!deleted) {
		throw new AppError("Shot not found", {
			status: 404,
			code: "shot_not_found",
		});
	}
	return { ok: true as const, shotId };
}
