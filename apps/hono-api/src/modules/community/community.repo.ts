import { getPrismaClient } from "../../platform/node/prisma";

const now = (): string => new Date().toISOString();
const uuid = (): string => crypto.randomUUID();

// ---------- channels ----------

export async function listChannels() {
	return getPrismaClient().content_channels.findMany({
		where: { enabled: 1 },
		orderBy: [{ sort_order: "asc" }, { name: "asc" }],
	});
}

export async function getChannelBySlug(slug: string) {
	return getPrismaClient().content_channels.findUnique({ where: { slug } });
}

// ---------- counters ----------

export async function getProjectCounters(projectId: string): Promise<{
	likeCount: number;
	favoriteCount: number;
	commentCount: number;
	viewCount: number;
}> {
	const p = await getPrismaClient().projects.findUnique({
		where: { id: projectId },
		select: { like_count: true, favorite_count: true, comment_count: true, view_count: true },
	});
	return {
		likeCount: p?.like_count ?? 0,
		favoriteCount: p?.favorite_count ?? 0,
		commentCount: p?.comment_count ?? 0,
		viewCount: p?.view_count ?? 0,
	};
}

export async function incrementView(projectId: string): Promise<void> {
	await getPrismaClient()
		.projects.update({ where: { id: projectId }, data: { view_count: { increment: 1 } } })
		.catch(() => {});
}

// ---------- likes ----------

export async function likeProject(projectId: string, userId: string): Promise<void> {
	const db = getPrismaClient();
	const existing = await db.project_likes
		.findUnique({ where: { project_id_user_id: { project_id: projectId, user_id: userId } } })
		.catch(() => null);
	if (existing) return;
	await db.$transaction([
		db.project_likes.create({ data: { id: uuid(), project_id: projectId, user_id: userId, created_at: now() } }),
		db.projects.update({ where: { id: projectId }, data: { like_count: { increment: 1 } } }),
	]);
}

export async function unlikeProject(projectId: string, userId: string): Promise<void> {
	const db = getPrismaClient();
	const existing = await db.project_likes
		.findUnique({ where: { project_id_user_id: { project_id: projectId, user_id: userId } } })
		.catch(() => null);
	if (!existing) return;
	await db.$transaction([
		db.project_likes.delete({ where: { id: existing.id } }),
		db.projects.update({ where: { id: projectId }, data: { like_count: { decrement: 1 } } }),
	]);
}

export async function hasLiked(projectId: string, userId: string): Promise<boolean> {
	const row = await getPrismaClient()
		.project_likes.findUnique({ where: { project_id_user_id: { project_id: projectId, user_id: userId } } })
		.catch(() => null);
	return !!row;
}

// ---------- favorites ----------

export async function favoriteProject(projectId: string, userId: string): Promise<void> {
	const db = getPrismaClient();
	const existing = await db.project_favorites
		.findUnique({ where: { project_id_user_id: { project_id: projectId, user_id: userId } } })
		.catch(() => null);
	if (existing) return;
	await db.$transaction([
		db.project_favorites.create({ data: { id: uuid(), project_id: projectId, user_id: userId, created_at: now() } }),
		db.projects.update({ where: { id: projectId }, data: { favorite_count: { increment: 1 } } }),
	]);
}

export async function unfavoriteProject(projectId: string, userId: string): Promise<void> {
	const db = getPrismaClient();
	const existing = await db.project_favorites
		.findUnique({ where: { project_id_user_id: { project_id: projectId, user_id: userId } } })
		.catch(() => null);
	if (!existing) return;
	await db.$transaction([
		db.project_favorites.delete({ where: { id: existing.id } }),
		db.projects.update({ where: { id: projectId }, data: { favorite_count: { decrement: 1 } } }),
	]);
}

export async function hasFavorited(projectId: string, userId: string): Promise<boolean> {
	const row = await getPrismaClient()
		.project_favorites.findUnique({ where: { project_id_user_id: { project_id: projectId, user_id: userId } } })
		.catch(() => null);
	return !!row;
}

// ---------- comments ----------

export async function addComment(
	projectId: string,
	userId: string,
	body: string,
	parentId?: string,
): Promise<{ id: string }> {
	const db = getPrismaClient();
	const id = uuid();
	await db.$transaction([
		db.project_comments.create({
			data: {
				id,
				project_id: projectId,
				user_id: userId,
				parent_id: parentId ?? null,
				body,
				like_count: 0,
				created_at: now(),
				updated_at: now(),
			},
		}),
		db.projects.update({ where: { id: projectId }, data: { comment_count: { increment: 1 } } }),
	]);
	return { id };
}

export async function softDeleteComment(commentId: string, userId: string): Promise<boolean> {
	const db = getPrismaClient();
	const c = await db.project_comments.findUnique({ where: { id: commentId } });
	if (!c || c.deleted_at || c.user_id !== userId) return false;
	await db.$transaction([
		db.project_comments.update({ where: { id: commentId }, data: { deleted_at: now() } }),
		db.projects.update({ where: { id: c.project_id }, data: { comment_count: { decrement: 1 } } }),
	]);
	return true;
}

export async function listComments(projectId: string, cursor: string | null, limit: number) {
	return getPrismaClient().project_comments.findMany({
		where: { project_id: projectId, deleted_at: null },
		orderBy: { created_at: "desc" },
		take: limit + 1,
		...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
	});
}

// ---------- follows / profiles ----------

export async function ensureProfile(userId: string): Promise<void> {
	const db = getPrismaClient();
	const p = await db.user_profiles.findUnique({ where: { user_id: userId } });
	if (p) return;
	await db.user_profiles
		.create({
			data: { user_id: userId, follower_count: 0, following_count: 0, created_at: now(), updated_at: now() },
		})
		.catch(() => {});
}

export async function followUser(followerId: string, followingId: string): Promise<void> {
	if (followerId === followingId) return;
	const db = getPrismaClient();
	const existing = await db.user_follows
		.findUnique({ where: { follower_id_following_id: { follower_id: followerId, following_id: followingId } } })
		.catch(() => null);
	if (existing) return;
	await ensureProfile(followerId);
	await ensureProfile(followingId);
	await db.$transaction([
		db.user_follows.create({ data: { id: uuid(), follower_id: followerId, following_id: followingId, created_at: now() } }),
		db.user_profiles.update({ where: { user_id: followingId }, data: { follower_count: { increment: 1 } } }),
		db.user_profiles.update({ where: { user_id: followerId }, data: { following_count: { increment: 1 } } }),
	]);
}

export async function unfollowUser(followerId: string, followingId: string): Promise<void> {
	const db = getPrismaClient();
	const existing = await db.user_follows
		.findUnique({ where: { follower_id_following_id: { follower_id: followerId, following_id: followingId } } })
		.catch(() => null);
	if (!existing) return;
	await db.$transaction([
		db.user_follows.delete({ where: { id: existing.id } }),
		db.user_profiles.update({ where: { user_id: followingId }, data: { follower_count: { decrement: 1 } } }),
		db.user_profiles.update({ where: { user_id: followerId }, data: { following_count: { decrement: 1 } } }),
	]);
}

export async function isFollowing(followerId: string, followingId: string): Promise<boolean> {
	const row = await getPrismaClient()
		.user_follows.findUnique({
			where: { follower_id_following_id: { follower_id: followerId, following_id: followingId } },
		})
		.catch(() => null);
	return !!row;
}

export async function getProfile(userId: string) {
	return getPrismaClient().user_profiles.findUnique({ where: { user_id: userId } });
}

export async function upsertProfile(
	userId: string,
	data: { bio?: string | null; banner_url?: string | null; links_json?: string | null },
) {
	const db = getPrismaClient();
	await ensureProfile(userId);
	return db.user_profiles.update({ where: { user_id: userId }, data: { ...data, updated_at: now() } });
}

// ---------- users ----------

export async function getUserByLogin(login: string) {
	return getPrismaClient().users.findFirst({
		where: { login },
		select: { id: true, login: true, name: true, avatar_url: true },
	});
}

// ---------- explore / detail ----------

type ExploreParams = {
	channel?: string;
	sort: "hot" | "new" | "fav";
	q?: string;
	cursor?: string;
	limit: number;
};

export async function exploreProjects(params: ExploreParams) {
	const db = getPrismaClient();
	const where: Record<string, unknown> = { is_public: 1 };
	if (params.channel) where.channel_slug = params.channel;
	if (params.q) where.name = { contains: params.q, mode: "insensitive" };
	const orderBy =
		params.sort === "new"
			? [{ published_at: "desc" as const }, { id: "desc" as const }]
			: params.sort === "fav"
				? [{ favorite_count: "desc" as const }, { id: "desc" as const }]
				: [{ hot_score: "desc" as const }, { id: "desc" as const }];
	return db.projects.findMany({
		where,
		orderBy,
		take: params.limit + 1,
		...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
		include: { users: { select: { login: true, name: true, avatar_url: true } } },
	});
}

export async function listPublicProjectsByOwner(ownerId: string, limit = 48) {
	return getPrismaClient().projects.findMany({
		where: { is_public: 1, owner_id: ownerId },
		orderBy: [{ published_at: "desc" }, { id: "desc" }],
		take: limit,
		include: { users: { select: { login: true, name: true, avatar_url: true } } },
	});
}

export async function getPublicProject(projectId: string) {
	return getPrismaClient().projects.findFirst({
		where: { id: projectId, is_public: 1 },
		include: { users: { select: { login: true, name: true, avatar_url: true } } },
	});
}

/** 批量按 id 查用户身份（评论作者拼装用，避免 prisma relation 改 schema 的分叉风险）。 */
export async function getUsersByIds(ids: string[]) {
	if (!ids.length) return [] as Array<{ id: string; login: string; name: string | null; avatar_url: string | null }>;
	return getPrismaClient().users.findMany({
		where: { id: { in: ids } },
		select: { id: true, login: true, name: true, avatar_url: true },
	});
}

export async function countEpisodes(projectId: string): Promise<number> {
	return getPrismaClient().chapters.count({ where: { project_id: projectId } });
}

// ---------- publish ----------

export async function applyPublish(
	projectId: string,
	data: {
		is_public: number;
		channel_slug?: string | null;
		cover_url?: string | null;
		description?: string | null;
		published_at?: string;
	},
) {
	return getPrismaClient().projects.update({ where: { id: projectId }, data });
}

export async function getProjectOwner(projectId: string): Promise<string | null> {
	const p = await getPrismaClient().projects.findUnique({ where: { id: projectId }, select: { owner_id: true } });
	return p?.owner_id ?? null;
}

export async function setHotScore(projectId: string, score: number): Promise<void> {
	await getPrismaClient()
		.projects.update({ where: { id: projectId }, data: { hot_score: score } })
		.catch(() => {});
}

export async function getPublishedAt(projectId: string): Promise<string | null> {
	const p = await getPrismaClient().projects.findUnique({ where: { id: projectId }, select: { published_at: true } });
	return p?.published_at ?? null;
}

// ---------- tags ----------

const slugify = (name: string): string =>
	name
		.toLowerCase()
		.trim()
		.replace(/[^\p{L}\p{N}]+/gu, "-")
		.replace(/^-+|-+$/g, "") || "tag";

export async function setProjectTags(projectId: string, tagNames: string[]): Promise<void> {
	const db = getPrismaClient();
	await db.project_tags.deleteMany({ where: { project_id: projectId } });
	for (const raw of tagNames) {
		const name = raw.trim();
		if (!name) continue;
		const slug = slugify(name);
		let tag = await db.tags.findUnique({ where: { name } }).catch(() => null);
		if (!tag) {
			tag = await db.tags
				.create({ data: { id: uuid(), name, slug, usage_count: 0, created_at: now() } })
				.catch(async () => db.tags.findUnique({ where: { name } }));
		}
		if (!tag) continue;
		await db.project_tags.create({ data: { project_id: projectId, tag_id: tag.id } }).catch(() => {});
		await db.tags.update({ where: { id: tag.id }, data: { usage_count: { increment: 1 } } }).catch(() => {});
	}
}

export async function listProjectsNeedingRehot(sinceIso: string) {
	return getPrismaClient().projects.findMany({
		where: { is_public: 1, OR: [{ published_at: { gte: sinceIso } }, { updated_at: { gte: sinceIso } }] },
		select: { id: true },
	});
}
