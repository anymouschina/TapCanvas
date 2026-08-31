import type { AppContext } from "../../types";
import { AppError } from "../../middleware/error";
import { getProjectForUserAccess, type ProjectRow } from "../project/project.repo";
import type { ChapterDto, ChapterStyleProfileOverride } from "./chapter.schemas";
import {
	createChapterRow,
	deleteChapterRow,
	findLatestWorkedChapterByProjectForOwner,
	getChapterById,
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
import { getTeamProjectShareForUser } from "../team/team.repo";
import { touchProjectActivity } from "../project/project-activity.repo";
import { broadcastPatch } from "./canvas-sse.manager";
import {
	normalizeStoryPreviewContract,
	type StoryPreviewContract,
} from "./story-preview-contract";

type AccessibleProjectRow = ProjectRow & { owner_id: string };

function normalizeOptionalText(value: string | null | undefined): string | undefined {
	const trimmed = typeof value === "string" ? value.trim() : "";
	return trimmed || undefined;
}

function readCanvasRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? value as Record<string, unknown>
		: {};
}

function readCanvasRecords(value: unknown): Record<string, unknown>[] {
	return Array.isArray(value)
		? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
		: [];
}

async function sha256Hex(value: string): Promise<string> {
	const bytes = new TextEncoder().encode(value);
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function parseChapterCanvasFlow(chapterId: string, value: string | null): {
	nodes: Record<string, unknown>[];
	edges: Record<string, unknown>[];
} {
	if (!value) return { nodes: [], edges: [] };
	let parsed: unknown;
	try {
		parsed = JSON.parse(value) as unknown;
	} catch (error) {
		throw new AppError("Chapter canvas is corrupted", {
			status: 500,
			code: "chapter_canvas_corrupted",
			details: { chapterId, reason: error instanceof Error ? error.message : String(error) },
		});
	}
	const root = readCanvasRecord(parsed);
	return { nodes: readCanvasRecords(root.nodes), edges: readCanvasRecords(root.edges) };
}

function buildCanonicalChapterSeed(input: {
	chapterId: string;
	title: string;
	summary: string;
	sourceRevision: number;
	sourceHash: string;
	storyPreviewContract?: StoryPreviewContract;
	existing?: Record<string, unknown>;
}): Record<string, unknown> {
	const existingData = readCanvasRecord(input.existing?.data);
	return {
		...(input.existing ?? {}),
		id: `chapter-seed-${input.chapterId}`,
		type: "taskNode",
		position: readCanvasRecord(input.existing?.position).x !== undefined
			? input.existing?.position
			: { x: 0, y: 0 },
		data: {
			...existingData,
			kind: "text",
			preset: "chapter-info",
			locked: true,
			readOnly: true,
			chapterTitle: input.title,
			chapterText: input.summary,
			label: input.title,
			content: input.summary,
			prompt: `【${input.title}】\n\n${input.summary}`,
			sourceChapterRevision: input.sourceRevision,
			sourceHash: input.sourceHash,
			...(input.storyPreviewContract
				? { storyPreviewContract: input.storyPreviewContract }
				: existingData.storyPreviewContract !== undefined
					? { storyPreviewContract: existingData.storyPreviewContract }
					: {}),
		},
	};
}

export type ChapterNarrativeUpdateResult = Readonly<{
	chapter: ChapterDto;
	canvasRevision: number;
	sourceHash: string;
	seedNode: Record<string, unknown>;
}>;

/**
 * Canonical chapter narrative write. Chapter metadata and the locked canvas seed
 * are committed by one revision-guarded database update, so SmallT, the chapter
 * page, and workflow execution can never observe two different story sources.
 */
export async function updateChapterNarrativeForUser(
	c: AppContext,
	userId: string,
	chapterId: string,
	input: {
		title?: string;
		summary?: string;
		storyPreviewContract?: StoryPreviewContract;
		expectedCanvasRevision?: number;
		allowEmptySummary?: boolean;
	},
): Promise<ChapterNarrativeUpdateResult> {
	const { project } = await requireChapterAccess(c, userId, chapterId);
	const maxAttempts = input.expectedCanvasRevision === undefined ? 4 : 1;
	for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
		const current = await c.env.DB.chapters.findFirst({
			where: { id: chapterId, owner_id: project.owner_id },
			select: {
				id: true,
				title: true,
				summary: true,
				canvas_flow: true,
				canvas_flow_revision: true,
			},
		});
		if (!current) {
			throw new AppError("Chapter not found", { status: 404, code: "chapter_not_found" });
		}
		if (
			input.expectedCanvasRevision !== undefined
			&& current.canvas_flow_revision !== input.expectedCanvasRevision
		) {
			throw new AppError("Chapter narrative changed after it was read", {
				status: 409,
				code: "chapter_narrative_revision_conflict",
				details: {
					expected: input.expectedCanvasRevision,
					actual: current.canvas_flow_revision,
				},
			});
		}
		const title = typeof input.title === "string" ? input.title.trim() : current.title.trim();
		const summary = typeof input.summary === "string" ? input.summary.trim() : (current.summary ?? "").trim();
		if (!title || (!summary && input.allowEmptySummary !== true)) {
			throw new AppError("Chapter title and narrative must be non-empty", {
				status: 400,
				code: "chapter_narrative_required",
			details: { titlePresent: Boolean(title), summaryPresent: Boolean(summary) },
			});
		}
		const flow = parseChapterCanvasFlow(chapterId, current.canvas_flow);
		const seedId = `chapter-seed-${chapterId}`;
		const existingSeed = flow.nodes.find((node) => String(node.id ?? "") === seedId);
		const existingSeedData = readCanvasRecord(existingSeed?.data);
		const storyPreviewContract = input.storyPreviewContract
			?? (normalizeStoryPreviewContract(existingSeedData.storyPreviewContract) ?? undefined);
		const sourceRevision = current.canvas_flow_revision + 1;
		const sourceHash = await sha256Hex(JSON.stringify({
			chapterId,
			title,
			summary,
			storyPreviewContract: storyPreviewContract ?? null,
		}));
		const seedNode = buildCanonicalChapterSeed({
			chapterId,
			title,
			summary,
			sourceRevision,
			sourceHash,
			...(storyPreviewContract ? { storyPreviewContract } : {}),
			...(existingSeed ? { existing: existingSeed } : {}),
		});
		const nextNodes = [seedNode, ...flow.nodes.filter((node) => String(node.id ?? "") !== seedId)];
		const nowIso = new Date().toISOString();
		const updated = await c.env.DB.chapters.updateMany({
			where: {
				id: chapterId,
				owner_id: project.owner_id,
				canvas_flow_revision: current.canvas_flow_revision,
			},
			data: {
				title,
				summary,
				canvas_flow: JSON.stringify({ nodes: nextNodes, edges: flow.edges }),
				canvas_flow_revision: { increment: 1 },
				updated_at: nowIso,
			},
		});
		if (updated.count === 0) {
			if (input.expectedCanvasRevision !== undefined || attempt === maxAttempts - 1) {
				throw new AppError("Chapter narrative changed concurrently", {
					status: 409,
					code: "chapter_narrative_revision_conflict",
					details: { expected: current.canvas_flow_revision },
				});
			}
			continue;
		}
		const chapter = await getChapterByIdForOwner({
			db: c.env.DB,
			chapterId,
			ownerId: project.owner_id,
		});
		if (!chapter) throw new AppError("Chapter not found", { status: 404, code: "chapter_not_found" });
		await touchProjectActivity({
			db: c.env.DB,
			projectId: chapter.project_id,
			ownerId: project.owner_id,
			nowIso,
		});
		broadcastPatch(chapterId, { upsertNodes: [seedNode], revision: sourceRevision }, "");
		return {
			chapter: mapChapterRowToDto(chapter),
			canvasRevision: sourceRevision,
			sourceHash,
			seedNode,
		};
	}
	throw new AppError("Chapter narrative update exhausted its conflict budget", {
		status: 409,
		code: "chapter_narrative_revision_conflict",
	});
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

async function requireProjectAccess(
	c: AppContext,
	userId: string,
	projectId: string,
): Promise<AccessibleProjectRow> {
	const project = await getProjectForUserAccess(c.env.DB, projectId, userId);
	if (!project) {
		throw new AppError("Project not found", {
			status: 404,
			code: "project_not_found",
		});
	}
	if (!project.owner_id) {
		throw new AppError("Project owner missing", {
			status: 500,
			code: "project_owner_missing",
			details: { projectId },
		});
	}
	return { ...project, owner_id: project.owner_id };
}

async function requireChapterAccess(
	c: AppContext,
	userId: string,
	chapterId: string,
): Promise<{ chapter: ChapterRow; project: AccessibleProjectRow }> {
	const chapter = await getChapterById({
		db: c.env.DB,
		chapterId,
	});
	if (!chapter) {
		throw new AppError("Chapter not found", {
			status: 404,
			code: "chapter_not_found",
		});
	}
	const project = await requireProjectAccess(c, userId, chapter.project_id);
	return { chapter, project };
}

export async function listProjectChaptersForUser(
	c: AppContext,
	userId: string,
	projectId: string,
) {
	const project = await requireProjectAccess(c, userId, projectId);
	const rows = await listChaptersByProjectForOwner({
		db: c.env.DB,
		projectId,
		ownerId: project.owner_id,
	});
	return sortChapterDtosForDisplay(rows.map(mapChapterRowToDto));
}

export async function createChapterForUser(
	c: AppContext,
	userId: string,
	projectId: string,
	input: { title: string; summary?: string },
) {
	const project = await requireProjectAccess(c, userId, projectId);
	const nowIso = new Date().toISOString();
	const row = await createChapterRow({
		db: c.env.DB,
		id: crypto.randomUUID(),
		projectId,
		ownerId: project.owner_id,
		title: input.title.trim(),
		summary: normalizeOptionalText(input.summary) ?? null,
		nowIso,
	});
	await touchProjectActivity({
		db: c.env.DB,
		projectId,
		ownerId: project.owner_id,
		nowIso,
	});
	return mapChapterRowToDto(row);
}

async function getDefaultChapterForProject(
	c: AppContext,
	ownerId: string,
	projectId: string,
) {
	const rows = await listChaptersByProjectForOwner({
		db: c.env.DB,
		projectId,
		ownerId,
	});
	if (rows.length === 0) {
		throw new AppError("No chapters found for project", {
			status: 404,
			code: "no_chapters",
		});
	}
	const latest =
		(await findLatestWorkedChapterByProjectForOwner({
			db: c.env.DB,
			projectId,
			ownerId,
		})) ?? rows[0];
	return latest;
}

export async function getProjectDefaultEntryForUser(
	c: AppContext,
	userId: string,
	projectId: string,
) {
	const project = await requireProjectAccess(c, userId, projectId);
	const chapter = await getDefaultChapterForProject(c, project.owner_id, projectId);
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
	const { chapter: row } = await requireChapterAccess(c, userId, chapterId);
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
		styleProfileOverride?: ChapterStyleProfileOverride | null;
	},
) {
	const { chapter, project } = await requireChapterAccess(c, userId, chapterId);
	let narrativeChapter: ChapterDto | null = null;
	if (typeof input.title === "string" || typeof input.summary === "string") {
		narrativeChapter = (await updateChapterNarrativeForUser(c, userId, chapterId, {
			...(typeof input.title === "string" ? { title: input.title } : {}),
			...(typeof input.summary === "string" ? { summary: input.summary } : {}),
			...(typeof input.summary !== "string" ? { allowEmptySummary: true } : {}),
		})).chapter;
	}
	const nowIso = new Date().toISOString();
	const hasNonNarrativeUpdate = input.status !== undefined
		|| input.sortOrder !== undefined
		|| input.sourceBookId !== undefined
		|| input.sourceBookChapter !== undefined
		|| input.styleProfileOverride !== undefined;
	if (!hasNonNarrativeUpdate && narrativeChapter) return narrativeChapter;
	const updated = await updateChapterRow({
		db: c.env.DB,
		chapterId,
		ownerId: project.owner_id,
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
		styleProfileOverride: input.styleProfileOverride,
		nowIso,
	});
	if (!updated) {
		throw new AppError("Chapter not found", {
			status: 404,
			code: "chapter_not_found",
		});
	}
	await touchProjectActivity({
		db: c.env.DB,
		projectId: chapter.project_id,
		ownerId: project.owner_id,
		nowIso,
	});
	return mapChapterRowToDto(updated);
}

export async function deleteChapterForUser(
	c: AppContext,
	userId: string,
	chapterId: string,
) {
	const { chapter: chapterRow, project } = await requireChapterAccess(c, userId, chapterId);
	const shots = await listStoryboardShotsByChapter({
		db: c.env.DB,
		ownerId: project.owner_id,
		projectId: chapterRow.project_id,
		chapterId,
		legacyChunkIndex: chapterRow.legacy_chunk_index ?? null,
	});
	for (const shot of shots) {
		await deleteStoryboardShotForOwner({
			db: c.env.DB,
			ownerId: project.owner_id,
			shotId: shot.id,
		});
	}
	const deleted = await deleteChapterRow({
		db: c.env.DB,
		chapterId,
		ownerId: project.owner_id,
	});
	if (!deleted) {
		throw new AppError("Chapter not found", {
			status: 404,
			code: "chapter_not_found",
		});
	}
	await touchProjectActivity({
		db: c.env.DB,
		projectId: chapterRow.project_id,
		ownerId: project.owner_id,
		nowIso: new Date().toISOString(),
	});
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
	const { chapter: chapterRow, project } = await requireChapterAccess(c, userId, chapterId);
	const chapter = mapChapterRowToDto(chapterRow);
	await touchChapterLastWorkedAt({
		db: c.env.DB,
		chapterId,
		ownerId: project.owner_id,
		nowIso: new Date().toISOString(),
	});
	const shots = await listStoryboardShotsByChapter({
		db: c.env.DB,
		ownerId: project.owner_id,
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
	const teamShare = await getTeamProjectShareForUser(c.env.DB, {
		projectId: project.id,
		userId,
	});
	return {
		project: {
			id: project.id,
			name: project.name,
			teamId: teamShare?.team_id ?? null,
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
	const { chapter: chapterRow, project } = await requireChapterAccess(c, userId, chapterId);
	const nowIso = new Date().toISOString();
	const created = await createEmptyStoryboardShotForChapter({
		db: c.env.DB,
		id: crypto.randomUUID(),
		ownerId: project.owner_id,
		projectId: chapterRow.project_id,
		chapterId: chapterRow.id,
		chunkIndex: chapterRow.legacy_chunk_index ?? Math.max(0, Number(chapterRow.chapter_index || 1) - 1),
		nowIso,
	});
	await touchProjectActivity({
		db: c.env.DB,
		projectId: chapterRow.project_id,
		ownerId: project.owner_id,
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
	const { chapter, project } = await requireChapterAccess(c, userId, chapterId);
	const shot = await getShotForOwner(c.env.DB, shotId, project.owner_id);
	if (!shot || shot.chapterId !== chapterId) {
		throw new AppError("Shot not found", {
			status: 404,
			code: "shot_not_found",
		});
	}
	const nowIso = new Date().toISOString();
	const updated = await updateStoryboardShotForOwner({
		db: c.env.DB,
		shotId,
		ownerId: project.owner_id,
		title:
			typeof input.title === "string"
				? (sanitizeShotTitleText(input.title) ?? "")
				: undefined,
		summary:
			typeof input.summary === "string"
				? (sanitizeShotSummaryText(input.summary) ?? "")
				: undefined,
		status: input.status,
		nowIso,
	});
	if (!updated) {
		throw new AppError("Shot not found", {
			status: 404,
			code: "shot_not_found",
		});
	}
	await touchProjectActivity({
		db: c.env.DB,
		projectId: chapter.project_id,
		ownerId: project.owner_id,
		nowIso,
	});
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
	const { chapter, project } = await requireChapterAccess(c, userId, chapterId);
	const shot = await getShotForOwner(c.env.DB, shotId, project.owner_id);
	if (!shot || shot.chapterId !== chapterId) {
		throw new AppError("Shot not found", {
			status: 404,
			code: "shot_not_found",
		});
	}
	const nowIso = new Date().toISOString();
	const moved = await moveStoryboardShotForOwner({
		db: c.env.DB,
		shotId,
		ownerId: project.owner_id,
		direction,
		nowIso,
	});
	if (!moved) {
		throw new AppError("Shot not found", {
			status: 404,
			code: "shot_not_found",
		});
	}
	await touchProjectActivity({
		db: c.env.DB,
		projectId: chapter.project_id,
		ownerId: project.owner_id,
		nowIso,
	});
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
	const { chapter, project } = await requireChapterAccess(c, userId, chapterId);
	const shot = await getShotForOwner(c.env.DB, shotId, project.owner_id);
	if (!shot || shot.chapterId !== chapterId) {
		throw new AppError("Shot not found", {
			status: 404,
			code: "shot_not_found",
		});
	}
	const deleted = await deleteStoryboardShotForOwner({
		db: c.env.DB,
		shotId,
		ownerId: project.owner_id,
	});
	if (!deleted) {
		throw new AppError("Shot not found", {
			status: 404,
			code: "shot_not_found",
		});
	}
	await touchProjectActivity({
		db: c.env.DB,
		projectId: chapter.project_id,
		ownerId: project.owner_id,
		nowIso: new Date().toISOString(),
	});
	return { ok: true as const, shotId };
}
