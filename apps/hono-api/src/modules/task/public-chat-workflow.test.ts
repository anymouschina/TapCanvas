import { describe, expect, it } from "vitest";

import { resolveEffectivePublicChatBookChapterScope } from "./public-chat-workflow";

describe("agents chat workflow policy", () => {
	it("resolves explicit book chapter scope from request fields", () => {
		expect(
			resolveEffectivePublicChatBookChapterScope({
				bookId: "book-1",
				chapterId: "3",
				chatContext: {
					currentProjectName: "七十二变",
				},
			}),
		).toEqual({ bookId: "book-1", chapterId: "3" });
	});

	it("resolves fallback book chapter scope from selected reference", () => {
		expect(
			resolveEffectivePublicChatBookChapterScope({
				chatContext: {
					currentProjectName: "七十二变",
					selectedReference: {
						bookId: "book-1",
						chapterId: "3",
					},
				},
			}),
		).toEqual({ bookId: "book-1", chapterId: "3" });
	});

	it("prefers explicit scope over selected reference fallback", () => {
		expect(
			resolveEffectivePublicChatBookChapterScope({
				bookId: "book-2",
				chapterId: "4",
				chatContext: {
					selectedReference: {
						bookId: "book-1",
						chapterId: "3",
					},
				},
			}),
		).toEqual({ bookId: "book-2", chapterId: "4" });
	});

	it("returns null when book or chapter scope is incomplete", () => {
		expect(
			resolveEffectivePublicChatBookChapterScope({
				bookId: "book-1",
				chatContext: {
					selectedReference: {
						bookId: "book-1",
					},
				},
			}),
		).toBeNull();
	});
});
