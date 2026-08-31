import { describe, expect, it } from "vitest";
import { mergeDerivedBookIndex } from "./book-index-derived-merge";
import type { BookIndexRecord } from "./book-index-store";

function createIndex(overrides: BookIndexRecord = {}): BookIndexRecord {
	return {
		bookId: "book-1",
		projectId: "project-1",
		chapters: [{ chapter: 1, title: "Chapter 1", summary: "old summary" }],
		assets: { semanticAssets: [] },
		...overrides,
	};
}

describe("mergeDerivedBookIndex", () => {
	it("preserves assets added while a derivation task is running", () => {
		const base = createIndex();
		const current = createIndex({
			assets: { semanticAssets: [{ semanticId: "asset-1", videoUrl: "https://example.com/1.mp4" }] },
		});
		const derived = createIndex({ title: "Updated title" });

		const merged = mergeDerivedBookIndex(base, current, derived);

		expect(merged.title).toBe("Updated title");
		expect(merged.assets).toMatchObject({
			semanticAssets: [{ semanticId: "asset-1", videoUrl: "https://example.com/1.mp4" }],
		});
	});

	it("merges concurrent first entries when the managed array did not exist in the base", () => {
		const base = createIndex({ assets: {} });
		const current = createIndex({
			assets: { semanticAssets: [{ semanticId: "current", imageUrl: "https://example.com/current.png" }] },
		});
		const derived = createIndex({
			assets: { semanticAssets: [{ semanticId: "derived", imageUrl: "https://example.com/derived.png" }] },
		});

		const merged = mergeDerivedBookIndex(base, current, derived);

		expect(merged.assets).toMatchObject({
			semanticAssets: [
				{ semanticId: "current", imageUrl: "https://example.com/current.png" },
				{ semanticId: "derived", imageUrl: "https://example.com/derived.png" },
			],
		});
	});

	it("preserves a concurrent chapter summary while applying derived chapter metadata", () => {
		const base = createIndex();
		const current = createIndex({
			chapters: [{ chapter: 1, title: "Chapter 1", summary: "new summary" }],
		});
		const derived = createIndex({
			chapters: [{ chapter: 1, title: "Chapter 1", summary: "old summary", roles: ["Alice"] }],
		});

		const merged = mergeDerivedBookIndex(base, current, derived);

		expect(merged.chapters).toEqual([
			{ chapter: 1, title: "Chapter 1", summary: "new summary", roles: ["Alice"] },
		]);
	});

	it("applies an intended deletion without deleting a concurrent record", () => {
		const base = createIndex({
			assets: { semanticAssets: [{ semanticId: "old", imageUrl: "https://example.com/old.png" }] },
		});
		const current = createIndex({
			assets: {
				semanticAssets: [
					{ semanticId: "old", imageUrl: "https://example.com/old.png" },
					{ semanticId: "new", imageUrl: "https://example.com/new.png" },
				],
			},
		});
		const derived = createIndex({ assets: { semanticAssets: [] } });

		const merged = mergeDerivedBookIndex(base, current, derived);

		expect(merged.assets).toMatchObject({
			semanticAssets: [{ semanticId: "new", imageUrl: "https://example.com/new.png" }],
		});
	});

	it("merges different fields changed concurrently on the same record", () => {
		const base = createIndex({
			assets: { semanticAssets: [{ semanticId: "asset-1", prompt: "old", status: "draft" }] },
		});
		const current = createIndex({
			assets: { semanticAssets: [{ semanticId: "asset-1", prompt: "current", status: "draft" }] },
		});
		const derived = createIndex({
			assets: { semanticAssets: [{ semanticId: "asset-1", prompt: "old", status: "confirmed" }] },
		});

		const merged = mergeDerivedBookIndex(base, current, derived);

		expect(merged.assets).toMatchObject({
			semanticAssets: [{ semanticId: "asset-1", prompt: "current", status: "confirmed" }],
		});
	});

	it("fails explicitly when the same business field changed concurrently", () => {
		const base = createIndex({
			assets: { semanticAssets: [{ semanticId: "asset-1", prompt: "old" }] },
		});
		const current = createIndex({
			assets: { semanticAssets: [{ semanticId: "asset-1", prompt: "current" }] },
		});
		const derived = createIndex({
			assets: { semanticAssets: [{ semanticId: "asset-1", prompt: "derived" }] },
		});

		expect(() => mergeDerivedBookIndex(base, current, derived)).toThrowError(
			/concurrent changes at assets\.semanticAssets\[asset-1\]\.prompt/,
		);
	});

	it("fails explicitly when a managed array has no stable identity", () => {
		const base = createIndex({ assets: { semanticAssets: [{ prompt: "old" }] } });
		const current = createIndex({ assets: { semanticAssets: [{ prompt: "old" }] } });
		const derived = createIndex({ assets: { semanticAssets: [{ prompt: "new" }] } });

		expect(() => mergeDerivedBookIndex(base, current, derived)).toThrowError(
			/without semanticId/,
		);
	});

	it("fails explicitly when a managed array contains duplicate identities", () => {
		const duplicated = [
			{ semanticId: "asset-1", prompt: "first" },
			{ semanticId: "asset-1", prompt: "second" },
		];
		const base = createIndex({ assets: { semanticAssets: duplicated } });
		const current = createIndex({ assets: { semanticAssets: duplicated } });
		const derived = createIndex({ assets: { semanticAssets: [...duplicated, { semanticId: "asset-2" }] } });

		expect(() => mergeDerivedBookIndex(base, current, derived)).toThrowError(
			/duplicate semanticId/,
		);
	});
});
