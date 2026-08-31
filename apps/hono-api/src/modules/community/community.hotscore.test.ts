import { describe, expect, it } from "vitest";
import { computeHotScore } from "./community.hotscore";

describe("computeHotScore", () => {
	it("rewards engagement weighted (favorite > like > view)", () => {
		const base = {
			likeCount: 0,
			favoriteCount: 0,
			commentCount: 0,
			viewCount: 0,
			publishedAt: "2026-06-01T00:00:00.000Z",
		};
		const fav = computeHotScore({ ...base, favoriteCount: 10 });
		const like = computeHotScore({ ...base, likeCount: 10 });
		const view = computeHotScore({ ...base, viewCount: 10 });
		expect(fav).toBeGreaterThan(like);
		expect(like).toBeGreaterThan(view);
	});

	it("newer publish time yields higher score for equal engagement", () => {
		const eng = { likeCount: 5, favoriteCount: 2, commentCount: 1, viewCount: 20 };
		const older = computeHotScore({ ...eng, publishedAt: "2026-01-01T00:00:00.000Z" });
		const newer = computeHotScore({ ...eng, publishedAt: "2026-06-01T00:00:00.000Z" });
		expect(newer).toBeGreaterThan(older);
	});

	it("handles missing publishedAt without NaN", () => {
		const s = computeHotScore({
			likeCount: 1,
			favoriteCount: 0,
			commentCount: 0,
			viewCount: 0,
			publishedAt: null,
		});
		expect(Number.isFinite(s)).toBe(true);
	});
});
