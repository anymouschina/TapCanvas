import { describe, expect, it } from "vitest";

import { resolveBookMetadataAgentExecutionMode } from "./book-metadata-agent-mode";

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
