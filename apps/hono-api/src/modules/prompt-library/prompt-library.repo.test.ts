import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { createPromptHash } from "./prompt-library.parser";
import { importPromptSource, promptLibraryOrderBy } from "./prompt-library.repo";
import type { ParsedPromptSource } from "./prompt-library.types";

function makeParsed(promptTextOriginal: string): ParsedPromptSource {
	return {
		sourcePromptId: "source-prompt-1",
		sourceUrl: "https://example.com/prompts/1",
		title: "新的抓取标题",
		description: "新的抓取描述",
		promptText: promptTextOriginal,
		promptTextOriginal,
		mediaType: "video",
		media: [],
		sourceAuthor: null,
		sourceAuthorUrl: null,
		originalLanguage: "zh-CN",
		modelSlug: "seedance-2-5",
		modelName: "Seedance 2.5",
		originalSourceUrl: null,
		categories: ["广告"],
		publishedAt: null,
		metrics: { likes: 1, views: 2, shares: 3, comments: 4, bookmarks: 5, quotes: 6 },
	};
}

describe("market-validated prompt source immutability", () => {
	it("rejects a changed source prompt instead of overwriting the stored case", async () => {
		const parsed = makeParsed("变化后的原文");
		const transaction = {
			prompt_library_sources: {
				findUnique: async () => ({ id: "source-1", entry_id: "entry-1" }),
			},
			prompt_library_entries: {
				findUnique: async (input: { where: Record<string, unknown> }) => (
					"id" in input.where
						? { id: "entry-1", canonical_hash: "stored-immutable-hash" }
						: null
				),
			},
		};
		const db = {
			$transaction: async (callback: (value: typeof transaction) => Promise<unknown>) => callback(transaction),
		} as unknown as PrismaClient;

		await expect(importPromptSource(db, parsed)).rejects.toThrow(/拒绝覆盖不可变案例/);
	});

	it("updates only discovery time when the immutable prompt already exists", async () => {
		const parsed = makeParsed("保持不变的原文");
		const canonicalHash = createPromptHash(parsed.promptTextOriginal);
		let entryUpdateData: Record<string, unknown> | null = null;
		const storedEntry = { id: "entry-1", canonical_hash: canonicalHash };
		const transaction = {
			prompt_library_sources: {
				findUnique: async () => ({ id: "source-1", entry_id: "entry-1" }),
				upsert: async () => ({ id: "source-1" }),
			},
			prompt_library_entries: {
				findUnique: async () => storedEntry,
				update: async (input: { data: Record<string, unknown> }) => {
					entryUpdateData = input.data;
					return storedEntry;
				},
			},
			prompt_library_models: {
				upsert: async () => ({ id: "model-1" }),
			},
			prompt_library_media: {
				upsert: async () => ({ id: "media-1" }),
			},
		};
		const db = {
			$transaction: async (callback: (value: typeof transaction) => Promise<unknown>) => callback(transaction),
		} as unknown as PrismaClient;

		const result = await importPromptSource(db, parsed);

		expect(result).toEqual({ entryId: "entry-1", deduplicated: true });
		expect(entryUpdateData).not.toBeNull();
		expect(Object.keys(entryUpdateData ?? {})).toEqual(["latest_source_at"]);
	});
});

describe("prompt library sorting", () => {
	it("maps every public sort mode to a stable database order", () => {
		expect(promptLibraryOrderBy("likes_desc")).toEqual([{ community_like_count: "desc" }, { created_at: "desc" }, { id: "asc" }]);
		expect(promptLibraryOrderBy("name_asc")).toEqual([{ title: "asc" }, { id: "asc" }]);
		expect(promptLibraryOrderBy("time_asc")).toEqual([{ created_at: "asc" }, { id: "asc" }]);
		expect(promptLibraryOrderBy("time_desc")).toEqual([{ created_at: "desc" }, { id: "asc" }]);
	});
});
