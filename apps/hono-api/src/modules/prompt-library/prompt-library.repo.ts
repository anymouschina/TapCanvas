import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { createPromptHash } from "./prompt-library.parser";
import {
	PROMPT_LIBRARY_AUTHOR_LABEL,
	type ParsedPromptSource,
	type PromptLibraryCard,
	type PromptLibraryCrawlRun,
	type PromptLibraryDetail,
	type PromptLibraryFacets,
	type PromptLibraryMedia,
	type PromptLibraryComment,
	type PromptLibraryModel,
	type PromptLibrarySort,
} from "./prompt-library.types";

export function promptLibraryOrderBy(
	sort: PromptLibrarySort,
): Prisma.prompt_library_entriesOrderByWithRelationInput[] {
	if (sort === "likes_desc") return [{ community_like_count: "desc" }, { created_at: "desc" }, { id: "asc" }];
	if (sort === "name_asc") return [{ title: "asc" }, { id: "asc" }];
	if (sort === "time_asc") return [{ created_at: "asc" }, { id: "asc" }];
	return [{ created_at: "desc" }, { id: "asc" }];
}

function parseCategories(value: string | null): string[] {
	if (!value) return [];
	try {
		const parsed: unknown = JSON.parse(value);
		return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
	} catch {
		return [];
	}
}

function mapRun(row: {
	id: string;
	target_site: string;
	status: string;
	discovered_count: number;
	processed_count: number;
	imported_count: number;
	deduplicated_count: number;
	skipped_count: number;
	failed_count: number;
	current_url: string | null;
	error_message: string | null;
	started_at: string | null;
	finished_at: string | null;
	created_at: string;
	updated_at: string;
}): PromptLibraryCrawlRun {
	const allowedStatuses = new Set(["queued", "running", "succeeded", "partial", "failed"]);
	if (!allowedStatuses.has(row.status)) throw new Error(`未知提示词采集状态：${row.status}`);
	return {
		id: row.id,
		targetSite: row.target_site,
		status: row.status as PromptLibraryCrawlRun["status"],
		discoveredCount: row.discovered_count,
		processedCount: row.processed_count,
		importedCount: row.imported_count,
		deduplicatedCount: row.deduplicated_count,
		skippedCount: row.skipped_count,
		failedCount: row.failed_count,
		currentUrl: row.current_url,
		errorMessage: row.error_message,
		startedAt: row.started_at,
		finishedAt: row.finished_at,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

export async function importPromptSource(
	db: PrismaClient,
	parsed: ParsedPromptSource,
): Promise<{ entryId: string; deduplicated: boolean }> {
	const now = new Date().toISOString();
	const canonicalHash = createPromptHash(parsed.promptTextOriginal);
	return db.$transaction(async (tx) => {
		const [existingSource, canonicalEntry] = await Promise.all([
			tx.prompt_library_sources.findUnique({ where: { source_url: parsed.sourceUrl } }),
			tx.prompt_library_entries.findUnique({ where: { canonical_hash: canonicalHash } }),
		]);
		const sourceEntry = existingSource
			? await tx.prompt_library_entries.findUnique({ where: { id: existingSource.entry_id } })
			: null;
		if (sourceEntry && sourceEntry.canonical_hash !== canonicalHash) {
			throw new Error(
				`来源 ${parsed.sourceUrl} 的市场验证提示词原文发生变化，拒绝覆盖不可变案例`,
			);
		}
		if (sourceEntry && canonicalEntry && sourceEntry.id !== canonicalEntry.id) {
			throw new Error(`来源 ${parsed.sourceUrl} 的已导入条目与规范化正文哈希指向不同条目，拒绝隐式合并`);
		}
		const existingEntry = sourceEntry ?? canonicalEntry;
		const entryId = existingEntry?.id ?? randomUUID();
		if (existingEntry) {
			await tx.prompt_library_entries.update({
				where: { id: entryId },
				data: {
					latest_source_at: now,
				},
			});
		} else {
			await tx.prompt_library_entries.create({
				data: {
					id: entryId,
					canonical_hash: canonicalHash,
					title: parsed.title,
					description: parsed.description,
					prompt_text: parsed.promptText,
					prompt_text_original: parsed.promptTextOriginal,
					media_type: parsed.mediaType,
					author_label: PROMPT_LIBRARY_AUTHOR_LABEL,
					published_at: parsed.publishedAt,
					latest_source_at: now,
					created_at: now,
					updated_at: now,
				},
			});
		}

		const sourceId = existingSource?.id ?? randomUUID();
		await tx.prompt_library_sources.upsert({
			where: { source_url: parsed.sourceUrl },
			create: {
				id: sourceId,
				entry_id: entryId,
				source_site: new URL(parsed.sourceUrl).hostname,
				source_prompt_id: parsed.sourcePromptId,
				source_url: parsed.sourceUrl,
				source_author: parsed.sourceAuthor,
				source_author_url: parsed.sourceAuthorUrl,
				original_language: parsed.originalLanguage,
				model_slug: parsed.modelSlug,
				model_name: parsed.modelName,
				original_source_url: parsed.originalSourceUrl,
				categories_json: JSON.stringify(parsed.categories),
				like_count: parsed.metrics.likes,
				view_count: parsed.metrics.views,
				share_count: parsed.metrics.shares,
				comment_count: parsed.metrics.comments,
				bookmark_count: parsed.metrics.bookmarks,
				quote_count: parsed.metrics.quotes,
				fetched_at: now,
				content_hash: canonicalHash,
				created_at: now,
				updated_at: now,
			},
			update: {
				entry_id: entryId,
				source_prompt_id: parsed.sourcePromptId,
				source_author: parsed.sourceAuthor,
				source_author_url: parsed.sourceAuthorUrl,
				original_language: parsed.originalLanguage,
				model_slug: parsed.modelSlug,
				model_name: parsed.modelName,
				original_source_url: parsed.originalSourceUrl,
				categories_json: JSON.stringify(parsed.categories),
				like_count: parsed.metrics.likes,
				view_count: parsed.metrics.views,
				share_count: parsed.metrics.shares,
				comment_count: parsed.metrics.comments,
				bookmark_count: parsed.metrics.bookmarks,
				quote_count: parsed.metrics.quotes,
				fetched_at: now,
				content_hash: canonicalHash,
				updated_at: now,
			},
		});
		await tx.prompt_library_models.upsert({
			where: { entry_id_model_slug: { entry_id: entryId, model_slug: parsed.modelSlug } },
			create: { id: randomUUID(), entry_id: entryId, model_slug: parsed.modelSlug, model_name: parsed.modelName, created_at: now },
			update: { model_name: parsed.modelName },
		});
		for (const [index, media] of parsed.media.entries()) {
			await tx.prompt_library_media.upsert({
				where: { entry_id_media_url: { entry_id: entryId, media_url: media.url } },
				create: {
					id: randomUUID(), entry_id: entryId, source_id: sourceId, media_kind: media.kind,
					media_url: media.url, thumbnail_url: media.thumbnailUrl, width: media.width,
					height: media.height, sort_order: index, created_at: now,
				},
				update: {
					source_id: sourceId, media_kind: media.kind, thumbnail_url: media.thumbnailUrl,
					width: media.width, height: media.height, sort_order: index,
				},
			});
		}
		return { entryId, deduplicated: Boolean(existingEntry) };
	});
}

async function readEntryAssociations(db: PrismaClient, entryIds: string[]): Promise<{
	models: Map<string, PromptLibraryModel[]>;
	media: Map<string, PromptLibraryMedia[]>;
}> {
	const [modelRows, mediaRows] = await Promise.all([
		db.prompt_library_models.findMany({ where: { entry_id: { in: entryIds } }, orderBy: { model_name: "asc" } }),
		db.prompt_library_media.findMany({ where: { entry_id: { in: entryIds } }, orderBy: [{ entry_id: "asc" }, { sort_order: "asc" }] }),
	]);
	const models = new Map<string, PromptLibraryModel[]>();
	for (const row of modelRows) {
		const values = models.get(row.entry_id) ?? [];
		values.push({ slug: row.model_slug, name: row.model_name });
		models.set(row.entry_id, values);
	}
	const media = new Map<string, PromptLibraryMedia[]>();
	for (const row of mediaRows) {
		if (row.media_kind !== "image" && row.media_kind !== "video") continue;
		const values = media.get(row.entry_id) ?? [];
		values.push({
			id: row.id, kind: row.media_kind, url: row.media_url, thumbnailUrl: row.thumbnail_url,
			width: row.width, height: row.height, order: row.sort_order,
		});
		media.set(row.entry_id, values);
	}
	return { models, media };
}

export async function listPromptLibrary(
	db: PrismaClient,
	input: { query?: string; model?: string; mediaType?: "image" | "video"; sort: PromptLibrarySort; page: number; pageSize: number },
): Promise<{ items: PromptLibraryCard[]; total: number; page: number; pageSize: number; facets: PromptLibraryFacets }> {
	const modelEntryIds = input.model
		? (await db.prompt_library_models.findMany({ where: { model_slug: input.model }, select: { entry_id: true } })).map((row) => row.entry_id)
		: null;
	const queryWhere: Prisma.prompt_library_entriesWhereInput = input.query ? {
		OR: [
			{ title: { contains: input.query, mode: "insensitive" } },
			{ prompt_text: { contains: input.query, mode: "insensitive" } },
		],
	} : {};
	const where: Prisma.prompt_library_entriesWhereInput = {
		...(input.mediaType ? { media_type: input.mediaType } : {}),
		...(modelEntryIds ? { id: { in: modelEntryIds } } : {}),
		...queryWhere,
	};
	const mediaFacetWhere: Prisma.prompt_library_entriesWhereInput = {
		...(modelEntryIds ? { id: { in: modelEntryIds } } : {}),
		...queryWhere,
	};
	const modelFacetEntriesWhere: Prisma.prompt_library_entriesWhereInput = {
		...(input.mediaType ? { media_type: input.mediaType } : {}),
		...queryWhere,
	};
	const [rows, total, mediaFacetRows, modelFacetEntryRows] = await Promise.all([
		db.prompt_library_entries.findMany({
			where,
			orderBy: promptLibraryOrderBy(input.sort),
			...(input.sort === "likes_desc" ? {} : { skip: (input.page - 1) * input.pageSize, take: input.pageSize }),
		}),
		db.prompt_library_entries.count({ where }),
		db.prompt_library_entries.groupBy({ by: ["media_type"], where: mediaFacetWhere, _count: { _all: true } }),
		db.prompt_library_entries.findMany({ where: modelFacetEntriesWhere, select: { id: true } }),
	]);
	const sourceRows = rows.length > 0
		? await db.prompt_library_sources.findMany({ where: { entry_id: { in: rows.map((row) => row.id) } }, select: { entry_id: true, like_count: true, comment_count: true } })
		: [];
	const sourceMetrics = new Map<string, { likes: number; comments: number }>();
	for (const source of sourceRows) {
		const current = sourceMetrics.get(source.entry_id) ?? { likes: 0, comments: 0 };
		current.likes = Math.max(current.likes, source.like_count);
		current.comments = Math.max(current.comments, source.comment_count);
		sourceMetrics.set(source.entry_id, current);
	}
	if (input.sort === "likes_desc") {
		rows.sort((left, right) => {
			const leftLikes = (sourceMetrics.get(left.id)?.likes ?? 0) + (left.community_like_count ?? 0);
			const rightLikes = (sourceMetrics.get(right.id)?.likes ?? 0) + (right.community_like_count ?? 0);
			return rightLikes - leftLikes || right.created_at.localeCompare(left.created_at) || left.id.localeCompare(right.id);
		});
	}
	const pagedRows = input.sort === "likes_desc"
		? rows.slice((input.page - 1) * input.pageSize, input.page * input.pageSize)
		: rows;
	const modelFacetEntryIds = modelFacetEntryRows.map((row) => row.id);
	const modelFacetRows = modelFacetEntryIds.length > 0
		? await db.prompt_library_models.findMany({
			where: { entry_id: { in: modelFacetEntryIds } },
			select: { entry_id: true, model_slug: true, model_name: true },
		})
		: [];
	const modelCounts = new Map<string, { name: string; entryIds: Set<string> }>();
	for (const row of modelFacetRows) {
		const current = modelCounts.get(row.model_slug) ?? { name: row.model_name, entryIds: new Set<string>() };
		current.entryIds.add(row.entry_id);
		modelCounts.set(row.model_slug, current);
	}
	const media: PromptLibraryFacets["media"] = [];
	for (const row of mediaFacetRows) {
		if (row.media_type === "image" || row.media_type === "video") {
			media.push({ kind: row.media_type, count: row._count._all });
		}
	}
	media.sort((left, right) => (left.kind === "image" ? -1 : 1) - (right.kind === "image" ? -1 : 1));
	const facets: PromptLibraryFacets = {
		media,
		models: [...modelCounts.entries()]
			.map(([slug, value]) => ({ slug, name: value.name, count: value.entryIds.size }))
			.filter((item) => item.count > 0)
			.sort((left, right) => left.name.localeCompare(right.name)),
		allMediaCount: media.reduce((sum, item) => sum + item.count, 0),
		allModelCount: modelFacetEntryIds.length,
	};
	const associations = await readEntryAssociations(db, pagedRows.map((row) => row.id));
	const items: PromptLibraryCard[] = pagedRows.flatMap((row) => {
		if (row.media_type !== "image" && row.media_type !== "video") return [];
		const sourceMetric = sourceMetrics.get(row.id) ?? { likes: 0, comments: 0 };
		return [{
			id: row.id, title: row.title, description: row.description, promptText: row.prompt_text,
			mediaType: row.media_type, authorLabel: PROMPT_LIBRARY_AUTHOR_LABEL,
			publishedAt: row.published_at, models: associations.models.get(row.id) ?? [],
			media: associations.media.get(row.id) ?? [],
			likes: sourceMetric.likes + (row.community_like_count ?? 0),
			comments: sourceMetric.comments + (row.community_comment_count ?? 0),
		}];
	});
	return { items, total, page: input.page, pageSize: input.pageSize, facets };
}

export async function getPromptLibraryDetail(db: PrismaClient, id: string, viewerUserId?: string | null): Promise<PromptLibraryDetail | null> {
	const entry = await db.prompt_library_entries.findUnique({ where: { id } });
	if (!entry || (entry.media_type !== "image" && entry.media_type !== "video")) return null;
	const [associations, source, viewerLike, communityComments] = await Promise.all([
		readEntryAssociations(db, [id]),
		db.prompt_library_sources.findFirst({ where: { entry_id: id }, orderBy: { fetched_at: "desc" } }),
		viewerUserId ? db.prompt_library_likes.findUnique({ where: { entry_id_user_id: { entry_id: id, user_id: viewerUserId } }, select: { id: true } }) : null,
		db.prompt_library_comments.findMany({ where: { entry_id: id }, orderBy: { created_at: "desc" }, take: 100, include: { users: { select: { id: true, name: true, login: true } } } }),
	]);
	if (!source) throw new Error(`提示词 ${id} 缺少来源证据`);
	return {
		id: entry.id,
		title: entry.title,
		description: entry.description,
		promptText: entry.prompt_text,
		promptTextOriginal: entry.prompt_text_original,
		mediaType: entry.media_type,
		authorLabel: PROMPT_LIBRARY_AUTHOR_LABEL,
		publishedAt: entry.published_at,
		models: associations.models.get(id) ?? [],
		media: associations.media.get(id) ?? [],
		likes: source.like_count + (entry.community_like_count ?? 0),
		comments: source.comment_count + (entry.community_comment_count ?? 0),
		categories: parseCategories(source.categories_json),
		sourceUrl: source.source_url,
		originalSourceUrl: source.original_source_url,
		originalLanguage: source.original_language,
		metrics: {
			likes: source.like_count + (entry.community_like_count ?? 0), views: source.view_count, shares: source.share_count,
			comments: source.comment_count + (entry.community_comment_count ?? 0), bookmarks: source.bookmark_count, quotes: source.quote_count,
		},
		viewerLiked: Boolean(viewerLike),
		communityComments: communityComments.map((comment): PromptLibraryComment => ({
			id: comment.id,
			content: comment.content,
			authorName: comment.users.name?.trim() || comment.users.login,
			createdAt: comment.created_at,
			canDelete: comment.user_id === viewerUserId,
		})),
	};
}

export async function togglePromptLibraryLike(db: PrismaClient, entryId: string, userId: string): Promise<{ liked: boolean; likes: number }> {
	const entry = await db.prompt_library_entries.findUnique({ where: { id: entryId }, select: { id: true } });
	if (!entry) return Promise.reject(new Error("提示词不存在"));
	const now = new Date().toISOString();
	let liked = false;
	await db.$transaction(async (tx) => {
		const existing = await tx.prompt_library_likes.findUnique({ where: { entry_id_user_id: { entry_id: entryId, user_id: userId } }, select: { id: true } });
		if (existing) {
			await tx.prompt_library_likes.delete({ where: { id: existing.id } });
			await tx.prompt_library_entries.updateMany({ where: { id: entryId, community_like_count: { gt: 0 } }, data: { community_like_count: { decrement: 1 } } });
		} else {
			await tx.prompt_library_likes.create({ data: { id: randomUUID(), entry_id: entryId, user_id: userId, created_at: now } });
			await tx.prompt_library_entries.update({ where: { id: entryId }, data: { community_like_count: { increment: 1 } } });
			liked = true;
		}
	});
	const [current, sourceRows] = await Promise.all([
		db.prompt_library_entries.findUnique({ where: { id: entryId }, select: { community_like_count: true } }),
		db.prompt_library_sources.findMany({ where: { entry_id: entryId }, select: { like_count: true } }),
	]);
	const sourceLikes = sourceRows.reduce((max, row) => Math.max(max, row.like_count), 0);
	return { liked, likes: sourceLikes + (current?.community_like_count ?? 0) };
}

export async function listPromptLibraryComments(db: PrismaClient, entryId: string, viewerUserId?: string | null): Promise<PromptLibraryComment[]> {
	const rows = await db.prompt_library_comments.findMany({ where: { entry_id: entryId }, orderBy: { created_at: "desc" }, take: 100, include: { users: { select: { id: true, name: true, login: true } } } });
	return rows.map((comment): PromptLibraryComment => ({ id: comment.id, content: comment.content, authorName: comment.users.name?.trim() || comment.users.login, createdAt: comment.created_at, canDelete: comment.user_id === viewerUserId }));
}

export async function createPromptLibraryComment(db: PrismaClient, entryId: string, userId: string, content: string): Promise<PromptLibraryComment> {
	const normalized = content.trim();
	if (!normalized || normalized.length > 2_000) throw new Error("评论不能为空且不能超过 2000 个字符");
	const entry = await db.prompt_library_entries.findUnique({ where: { id: entryId }, select: { id: true } });
	if (!entry) throw new Error("提示词不存在");
	const now = new Date().toISOString();
	const row = await db.$transaction(async (tx) => {
		const created = await tx.prompt_library_comments.create({ data: { id: randomUUID(), entry_id: entryId, user_id: userId, content: normalized, created_at: now, updated_at: now }, include: { users: { select: { id: true, name: true, login: true } } } });
		await tx.prompt_library_entries.update({ where: { id: entryId }, data: { community_comment_count: { increment: 1 } } });
		return created;
	});
	return { id: row.id, content: row.content, authorName: row.users.name?.trim() || row.users.login, createdAt: row.created_at, canDelete: true };
}

export async function deletePromptLibraryComment(db: PrismaClient, commentId: string, userId: string): Promise<void> {
	const result = await db.$transaction(async (tx) => {
		const comment = await tx.prompt_library_comments.findFirst({ where: { id: commentId, user_id: userId }, select: { id: true, entry_id: true } });
		if (!comment) return false;
		await tx.prompt_library_comments.delete({ where: { id: comment.id } });
		await tx.prompt_library_entries.updateMany({ where: { id: comment.entry_id, community_comment_count: { gt: 0 } }, data: { community_comment_count: { decrement: 1 } } });
		return true;
	});
	if (!result) throw new Error("评论不存在或无权删除");
}

export async function listCrawlRuns(db: PrismaClient, limit = 20): Promise<PromptLibraryCrawlRun[]> {
	return (await db.prompt_library_crawl_runs.findMany({ orderBy: { created_at: "desc" }, take: limit })).map(mapRun);
}

export async function getCrawlRun(db: PrismaClient, id: string): Promise<PromptLibraryCrawlRun | null> {
	const row = await db.prompt_library_crawl_runs.findUnique({ where: { id } });
	return row ? mapRun(row) : null;
}

export async function getPromptLibrarySummary(db: PrismaClient): Promise<{
	entryCount: number;
	mediaCount: number;
	sourceCount: number;
	modelCount: number;
}> {
	const [entryCount, mediaCount, sourceCount, modelRows] = await Promise.all([
		db.prompt_library_entries.count(),
		db.prompt_library_media.count(),
		db.prompt_library_sources.count(),
		db.prompt_library_models.findMany({ distinct: ["model_slug"], select: { model_slug: true } }),
	]);
	return { entryCount, mediaCount, sourceCount, modelCount: modelRows.length };
}
