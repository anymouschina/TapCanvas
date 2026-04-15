import { describe, expect, it } from "vitest";
import type { ChapterDto } from "./chapter.schemas";
import { sortChapterDtosForDisplay } from "./chapter.service";

function buildChapter(input: {
	id: string;
	index: number;
	sortOrder: number;
	sourceBookChapter?: number | null;
	title?: string;
}): ChapterDto {
	return {
		id: input.id,
		projectId: "project-1",
		index: input.index,
		title: input.title || input.id,
		summary: null,
		status: "draft",
		sortOrder: input.sortOrder,
		continuityContext: undefined,
		styleProfileOverride: undefined,
		legacyChunkIndex: null,
		sourceBookId: input.sourceBookChapter ? "book-1" : undefined,
		sourceBookChapter: input.sourceBookChapter ?? null,
		lastWorkedAt: undefined,
		createdAt: `2026-04-15T00:00:0${input.index}.000Z`,
		updatedAt: `2026-04-15T00:00:0${input.index}.000Z`,
		coverAssetId: undefined,
	};
}

describe("sortChapterDtosForDisplay", () => {
	it("prioritizes sourceBookChapter ordering over legacy sort order", () => {
		const sorted = sortChapterDtosForDisplay([
			buildChapter({ id: "chapter-3", index: 3, sortOrder: 20, sourceBookChapter: 3 }),
			buildChapter({ id: "chapter-1", index: 1, sortOrder: 10, sourceBookChapter: 1 }),
			buildChapter({ id: "chapter-2", index: 2, sortOrder: 30, sourceBookChapter: 2 }),
		]);

		expect(sorted.map((item) => item.id)).toEqual(["chapter-1", "chapter-2", "chapter-3"]);
	});

	it("keeps unmapped chapters after mapped chapters and preserves fallback order", () => {
		const sorted = sortChapterDtosForDisplay([
			buildChapter({ id: "mapped-2", index: 2, sortOrder: 30, sourceBookChapter: 2 }),
			buildChapter({ id: "draft-a", index: 5, sortOrder: 10, sourceBookChapter: null }),
			buildChapter({ id: "mapped-1", index: 1, sortOrder: 40, sourceBookChapter: 1 }),
			buildChapter({ id: "draft-b", index: 6, sortOrder: 20, sourceBookChapter: null }),
		]);

		expect(sorted.map((item) => item.id)).toEqual(["mapped-1", "mapped-2", "draft-a", "draft-b"]);
	});
});
