import { describe, expect, it } from "vitest";

import {
	resolveBookMetadataAgentExecutionMode,
	resolveBookMetadataTargetChapterNumbers,
} from "./book-metadata-agent-mode";

describe("resolveBookMetadataAgentExecutionMode", () => {
	it("uses single-turn mode when explicitly requested", () => {
		expect(
			resolveBookMetadataAgentExecutionMode({
				mode: "deep",
				chapterCount: 8,
				batchCount: 4,
				preferSingleTurn: true,
			}),
		).toBe("single");
	});

	it("uses single-turn mode for standard single-chapter single-batch extraction", () => {
		expect(
			resolveBookMetadataAgentExecutionMode({
				mode: "standard",
				chapterCount: 1,
				batchCount: 1,
			}),
		).toBe("single");
	});

	it("keeps team mode for multi-chapter windows", () => {
		expect(
			resolveBookMetadataAgentExecutionMode({
				mode: "standard",
				chapterCount: 2,
				batchCount: 1,
			}),
		).toBe("team");
	});

	it("keeps team mode for deep mode even with a single chapter", () => {
		expect(
			resolveBookMetadataAgentExecutionMode({
				mode: "deep",
				chapterCount: 1,
				batchCount: 1,
			}),
		).toBe("team");
	});
});

describe("resolveBookMetadataTargetChapterNumbers", () => {
	it("refreshes only missing chapters by default", () => {
		expect(
			resolveBookMetadataTargetChapterNumbers({
				windowChapterNumbers: [5, 6, 7],
				missingChapterNumbers: [6],
				safeChapter: 7,
			}),
		).toEqual([6]);
	});

	it("forces current chapter refresh even when metadata is already complete", () => {
		expect(
			resolveBookMetadataTargetChapterNumbers({
				windowChapterNumbers: [7],
				missingChapterNumbers: [],
				safeChapter: 7,
				forceRefreshChapter: true,
			}),
		).toEqual([7]);
	});

	it("merges missing chapters with forced current chapter without duplicates", () => {
		expect(
			resolveBookMetadataTargetChapterNumbers({
				windowChapterNumbers: [7, 8],
				missingChapterNumbers: [7, 8],
				safeChapter: 7,
				forceRefreshChapter: true,
			}),
		).toEqual([7, 8]);
	});
});
