import { describe, expect, it } from "vitest";

import { decideChapterStyleReferenceWrite } from "./style-reference-write-policy";

describe("decideChapterStyleReferenceWrite", () => {
	it("allows the first style assignment from a chapter when the project has no style", () => {
		expect(decideChapterStyleReferenceWrite({
			chapterId: "book-a-ch1",
			currentStyleImages: [],
			requestedStyleImages: ["https://assets.test/style.png"],
		})).toEqual({ action: "initial_set" });
	});

	it("allows an exact idempotent write from a later chapter", () => {
		expect(decideChapterStyleReferenceWrite({
			chapterId: "book-a-ch28",
			currentStyleImages: ["https://assets.test/style.png"],
			requestedStyleImages: ["https://assets.test/style.png"],
		})).toEqual({ action: "idempotent" });
	});

	it("rejects replacing an existing project style from a chapter", () => {
		expect(decideChapterStyleReferenceWrite({
			chapterId: "book-a-ch28",
			currentStyleImages: ["https://assets.test/original.png"],
			requestedStyleImages: ["https://assets.test/replacement.png"],
		})).toEqual({ action: "reject", code: "chapter_style_reference_overwrite_forbidden" });
	});

	it("rejects clearing an existing project style from a chapter", () => {
		expect(decideChapterStyleReferenceWrite({
			chapterId: "book-a-ch28",
			currentStyleImages: ["https://assets.test/original.png"],
			requestedStyleImages: [],
		})).toEqual({ action: "reject", code: "chapter_style_reference_overwrite_forbidden" });
	});

	it("leaves project-scoped settings writes available", () => {
		expect(decideChapterStyleReferenceWrite({
			currentStyleImages: ["https://assets.test/original.png"],
			requestedStyleImages: ["https://assets.test/replacement.png"],
		})).toEqual({ action: "initial_set" });
	});
});
