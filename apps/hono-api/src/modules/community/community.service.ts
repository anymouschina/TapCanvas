import type { AppContext } from "../../types";
import { AppError } from "../../middleware/error";
import { computeHotScore } from "./community.hotscore";
import * as repo from "./community.repo";
import type {
	AuthorPageDto,
	ChannelDto,
	CommentPageDto,
	ExplorePageDto,
	ProjectCardDto,
	ProjectDetailDto,
	PublishProjectInput,
	UpdateProfileInput,
} from "./community.schemas";

type ProjectRow = Awaited<ReturnType<typeof repo.exploreProjects>>[number];

async function toCard(r: ProjectRow): Promise<ProjectCardDto> {
	return {
		id: r.id,
		name: r.name,
		coverUrl: r.cover_url ?? null,
		description: r.description ?? null,
		channelSlug: r.channel_slug ?? null,
		ownerLogin: r.users?.login ?? null,
		ownerName: r.users?.name ?? null,
		ownerAvatarUrl: r.users?.avatar_url ?? null,
		likeCount: r.like_count,
		favoriteCount: r.favorite_count,
		commentCount: r.comment_count,
		viewCount: r.view_count,
		cloneCount: r.clone_count,
		episodeCount: await repo.countEpisodes(r.id),
		publishedAt: r.published_at ?? null,
		updatedAt: r.updated_at,
	};
}

export async function listChannels(): Promise<ChannelDto[]> {
	const rows = await repo.listChannels();
	return rows.map((c) => ({
		slug: c.slug,
		name: c.name,
		description: c.description ?? null,
		icon: c.icon ?? null,
		sortOrder: c.sort_order,
	}));
}

export async function buildExplorePage(params: {
	channel?: string;
	sort: "hot" | "new" | "fav";
	q?: string;
	cursor?: string;
	limit: number;
}): Promise<ExplorePageDto> {
	const rows = await repo.exploreProjects(params);
	const hasMore = rows.length > params.limit;
	const page = hasMore ? rows.slice(0, params.limit) : rows;
	const items: ProjectCardDto[] = [];
	for (const r of page) items.push(await toCard(r));
	return { items, nextCursor: hasMore && page.length ? page[page.length - 1].id : null };
}

export async function recomputeHotScore(projectId: string): Promise<void> {
	const c = await repo.getProjectCounters(projectId);
	const publishedAt = await repo.getPublishedAt(projectId);
	const score = computeHotScore({
		likeCount: c.likeCount,
		favoriteCount: c.favoriteCount,
		commentCount: c.commentCount,
		viewCount: c.viewCount,
		publishedAt,
	});
	await repo.setHotScore(projectId, score);
}

export async function likeAndRehot(projectId: string, userId: string): Promise<void> {
	await repo.likeProject(projectId, userId);
	await recomputeHotScore(projectId);
}
export async function unlikeAndRehot(projectId: string, userId: string): Promise<void> {
	await repo.unlikeProject(projectId, userId);
	await recomputeHotScore(projectId);
}
export async function favoriteAndRehot(projectId: string, userId: string): Promise<void> {
	await repo.favoriteProject(projectId, userId);
	await recomputeHotScore(projectId);
}
export async function unfavoriteAndRehot(projectId: string, userId: string): Promise<void> {
	await repo.unfavoriteProject(projectId, userId);
	await recomputeHotScore(projectId);
}

export async function comment(
	projectId: string,
	userId: string,
	body: string,
	parentId?: string,
): Promise<{ id: string }> {
	const res = await repo.addComment(projectId, userId, body, parentId);
	await recomputeHotScore(projectId);
	return res;
}

export async function getComments(projectId: string, cursor: string | null, limit = 30): Promise<CommentPageDto> {
	const rows = await repo.listComments(projectId, cursor, limit);
	const hasMore = rows.length > limit;
	const page = hasMore ? rows.slice(0, limit) : rows;
	// 批量拼装评论作者身份（按 user_id 二次查 users，零 schema relation 改动）。
	const authorIds = [...new Set(page.map((r) => r.user_id))];
	const authors = await repo.getUsersByIds(authorIds);
	const authorMap = new Map(authors.map((u) => [u.id, u]));
	return {
		items: page.map((r) => {
			const a = authorMap.get(r.user_id);
			return {
				id: r.id,
				projectId: r.project_id,
				userId: r.user_id,
				parentId: r.parent_id ?? null,
				body: r.body,
				likeCount: r.like_count,
				createdAt: r.created_at,
				authorLogin: a?.login ?? null,
				authorName: a?.name ?? null,
				authorAvatarUrl: a?.avatar_url ?? null,
			};
		}),
		nextCursor: hasMore && page.length ? page[page.length - 1].id : null,
	};
}

/** 精选/热榜兜底：直接复用热度排序 top N（无 is_featured 列，零 schema）。 */
export async function listFeatured(limit = 8): Promise<ProjectCardDto[]> {
	const rows = await repo.exploreProjects({ sort: "hot", limit });
	const page = rows.length > limit ? rows.slice(0, limit) : rows;
	const items: ProjectCardDto[] = [];
	for (const r of page) items.push(await toCard(r));
	return items;
}

export async function getProjectDetail(c: AppContext, projectId: string): Promise<ProjectDetailDto> {
	const row = await repo.getPublicProject(projectId);
	if (!row) throw new AppError("project not found or not public", { status: 404, code: "not_found" });
	const card = await toCard(row);
	const viewerId = c.get("userId");
	const liked = viewerId ? await repo.hasLiked(projectId, viewerId) : false;
	const favorited = viewerId ? await repo.hasFavorited(projectId, viewerId) : false;
	return { ...card, liked, favorited, forkedFromProjectId: row.forked_from_project_id ?? null };
}

export async function publishProject(
	c: AppContext,
	projectId: string,
	userId: string,
	input: PublishProjectInput,
): Promise<{ ok: true }> {
	const ownerId = await repo.getProjectOwner(projectId);
	if (ownerId !== userId) throw new AppError("not project owner", { status: 403, code: "forbidden" });
	if (input.channelSlug) {
		const ch = await repo.getChannelBySlug(input.channelSlug);
		if (!ch) throw new AppError("unknown channel", { status: 400, code: "unknown_channel" });
	}
	const alreadyPublished = await repo.getPublishedAt(projectId);
	await repo.applyPublish(projectId, {
		is_public: input.isPublic ? 1 : 0,
		channel_slug: input.channelSlug ?? null,
		cover_url: input.coverUrl ?? null,
		description: input.description ?? null,
		...(input.isPublic && !alreadyPublished ? { published_at: new Date().toISOString() } : {}),
	});
	if (input.tags) await repo.setProjectTags(projectId, input.tags);
	await recomputeHotScore(projectId);
	return { ok: true };
}

export async function follow(targetLogin: string, followerId: string): Promise<void> {
	const target = await repo.getUserByLogin(targetLogin);
	if (!target) throw new AppError("user not found", { status: 404, code: "not_found" });
	await repo.followUser(followerId, target.id);
}

export async function unfollow(targetLogin: string, followerId: string): Promise<void> {
	const target = await repo.getUserByLogin(targetLogin);
	if (!target) throw new AppError("user not found", { status: 404, code: "not_found" });
	await repo.unfollowUser(followerId, target.id);
}

export async function updateProfile(userId: string, input: UpdateProfileInput): Promise<{ ok: true }> {
	await repo.upsertProfile(userId, {
		bio: input.bio ?? null,
		banner_url: input.bannerUrl ?? null,
		links_json: input.links ? JSON.stringify(input.links) : null,
	});
	return { ok: true };
}

export async function getAuthorPage(c: AppContext, login: string): Promise<AuthorPageDto> {
	const user = await repo.getUserByLogin(login);
	if (!user) throw new AppError("user not found", { status: 404, code: "not_found" });
	const profile = await repo.getProfile(user.id);
	const projectRows = await repo.listPublicProjectsByOwner(user.id);
	const projects: ProjectCardDto[] = [];
	for (const r of projectRows) projects.push(await toCard(r));
	const viewerId = c.get("userId");
	const following = viewerId ? await repo.isFollowing(viewerId, user.id) : false;
	let links: Array<{ label: string; url: string }> = [];
	if (profile?.links_json) {
		try {
			const parsed = JSON.parse(profile.links_json);
			if (Array.isArray(parsed)) links = parsed;
		} catch {
			links = [];
		}
	}
	return {
		login: user.login,
		name: user.name ?? null,
		avatarUrl: user.avatar_url ?? null,
		bio: profile?.bio ?? null,
		bannerUrl: profile?.banner_url ?? null,
		links,
		followerCount: profile?.follower_count ?? 0,
		followingCount: profile?.following_count ?? 0,
		following,
		projects,
	};
}

export async function recomputeRecentHotScores(days = 7): Promise<number> {
	const since = new Date(Date.now() - days * 86_400_000).toISOString();
	const rows = await repo.listProjectsNeedingRehot(since);
	for (const r of rows) await recomputeHotScore(r.id);
	return rows.length;
}
