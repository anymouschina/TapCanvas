import { describe, expect, it, vi, beforeEach } from "vitest";
import * as repo from "./community.repo";
import { buildExplorePage } from "./community.service";

function makeRow(i: number) {
	return {
		id: "p" + i,
		name: "n" + i,
		cover_url: null,
		description: null,
		channel_slug: "tv-show",
		like_count: 0,
		favorite_count: 0,
		comment_count: 0,
		view_count: 0,
		clone_count: 0,
		published_at: null,
		updated_at: "x",
		forked_from_project_id: null,
		users: { login: "u", name: "U" },
	} as unknown as Awaited<ReturnType<typeof repo.exploreProjects>>[number];
}

describe("buildExplorePage", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		vi.spyOn(repo, "countEpisodes").mockResolvedValue(3);
	});

	it("returns nextCursor and trims the extra row when more than limit", async () => {
		vi.spyOn(repo, "exploreProjects").mockResolvedValue(Array.from({ length: 25 }, (_, i) => makeRow(i)));
		const page = await buildExplorePage({ sort: "hot", limit: 24 });
		expect(page.items).toHaveLength(24);
		expect(page.nextCursor).toBe("p23");
		expect(page.items[0].episodeCount).toBe(3);
	});

	it("returns null nextCursor when results fit within limit", async () => {
		vi.spyOn(repo, "exploreProjects").mockResolvedValue(Array.from({ length: 5 }, (_, i) => makeRow(i)));
		const page = await buildExplorePage({ sort: "new", limit: 24 });
		expect(page.items).toHaveLength(5);
		expect(page.nextCursor).toBeNull();
	});
});
