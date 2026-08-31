export type HotScoreInput = {
	likeCount: number;
	favoriteCount: number;
	commentCount: number;
	viewCount: number;
	publishedAt: string | null;
};

/**
 * HN 式热度：engagement 取对数压缩量级 + 发布时间线性衰减项。
 * 权重 favorite(6) > like(4) > comment(3) > view(1)，鼓励高质量互动。
 */
export function computeHotScore(input: HotScoreInput): number {
	const engagement =
		input.favoriteCount * 6 +
		input.likeCount * 4 +
		input.commentCount * 3 +
		input.viewCount;
	const order = Math.log10(Math.max(1, engagement));
	const tsMs = input.publishedAt ? Date.parse(input.publishedAt) : Number.NaN;
	const seconds = Number.isFinite(tsMs) ? tsMs / 1000 : 0;
	const recency = seconds / 45000;
	const score = order + recency;
	return Number.isFinite(score) ? score : 0;
}
