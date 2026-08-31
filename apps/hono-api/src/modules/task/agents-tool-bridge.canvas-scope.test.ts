import { describe, expect, it } from "vitest";

import { resolveChapterCanvasId } from "./agents-tool-bridge.canvas-scope";

describe("resolveChapterCanvasId", () => {
	it("routes every flow-scoped tool to the current chapter canvas", () => {
		expect(
			resolveChapterCanvasId({
				chapterId: "book-example-1783266177207-ch32",
				flowScopedToolRequested: true,
			}),
		).toBe("book-example-1783266177207-ch32");
	});

	it("does not reinterpret a numeric book chapter selector as a chapter row id", () => {
		expect(
			resolveChapterCanvasId({
				chapterId: "32",
				flowScopedToolRequested: true,
			}),
		).toBe("");
	});

	it("does not route project-scoped tools through a chapter canvas", () => {
		expect(
			resolveChapterCanvasId({
				chapterId: "book-example-1783266177207-ch32",
				flowScopedToolRequested: false,
			}),
		).toBe("");
	});
});
