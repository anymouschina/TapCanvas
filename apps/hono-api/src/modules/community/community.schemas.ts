import { z } from "zod";

export const ExploreQuerySchema = z.object({
	channel: z.string().trim().min(1).optional(),
	tag: z.string().trim().min(1).optional(),
	sort: z.enum(["hot", "new", "fav"]).default("hot"),
	q: z.string().trim().min(1).max(120).optional(),
	cursor: z.string().trim().min(1).optional(),
	limit: z.coerce.number().int().min(1).max(48).default(24),
});
export type ExploreQuery = z.infer<typeof ExploreQuerySchema>;

export const PublishProjectSchema = z.object({
	isPublic: z.boolean(),
	channelSlug: z.string().trim().min(1).max(64).optional(),
	coverUrl: z.string().trim().url().max(2048).optional().nullable(),
	description: z.string().trim().max(2000).optional().nullable(),
	tags: z.array(z.string().trim().min(1).max(40)).max(12).optional(),
});
export type PublishProjectInput = z.infer<typeof PublishProjectSchema>;

export const CreateCommentSchema = z.object({
	body: z.string().trim().min(1).max(2000),
	parentId: z.string().trim().min(1).optional(),
});

export const UpdateProfileSchema = z.object({
	bio: z.string().trim().max(500).optional().nullable(),
	bannerUrl: z.string().trim().url().max(2048).optional().nullable(),
	links: z
		.array(
			z.object({
				label: z.string().trim().max(40),
				url: z.string().trim().url().max(2048),
			}),
		)
		.max(8)
		.optional(),
});
export type UpdateProfileInput = z.infer<typeof UpdateProfileSchema>;

export type ChannelDto = {
	slug: string;
	name: string;
	description: string | null;
	icon: string | null;
	sortOrder: number;
};

export type ProjectCardDto = {
	id: string;
	name: string;
	coverUrl: string | null;
	description: string | null;
	channelSlug: string | null;
	ownerLogin: string | null;
	ownerName: string | null;
	ownerAvatarUrl: string | null;
	likeCount: number;
	favoriteCount: number;
	commentCount: number;
	viewCount: number;
	cloneCount: number;
	episodeCount: number;
	publishedAt: string | null;
	updatedAt: string;
};

export type ExplorePageDto = {
	items: ProjectCardDto[];
	nextCursor: string | null;
};

export type CommentDto = {
	id: string;
	projectId: string;
	userId: string;
	parentId: string | null;
	body: string;
	likeCount: number;
	createdAt: string;
	authorLogin: string | null;
	authorName: string | null;
	authorAvatarUrl: string | null;
};

export type CommentPageDto = {
	items: CommentDto[];
	nextCursor: string | null;
};

export type ProjectDetailDto = ProjectCardDto & {
	liked: boolean;
	favorited: boolean;
	forkedFromProjectId: string | null;
};

export type AuthorPageDto = {
	login: string;
	name: string | null;
	avatarUrl: string | null;
	bio: string | null;
	bannerUrl: string | null;
	links: Array<{ label: string; url: string }>;
	followerCount: number;
	followingCount: number;
	following: boolean;
	projects: ProjectCardDto[];
};
