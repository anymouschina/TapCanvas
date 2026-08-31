import { describe, expect, it } from "vitest";

import {
	readStoryPreviewSourceWindow,
	readStoryPreviewTimedSections,
} from "./story-preview-source-window";

const SOURCE = `■【30-50s】中段攻坚
三十至五十秒的完整原文。
■【50-60s】终局反转
五十至六十秒的完整原文。`;

describe("story preview source window", () => {
	it("returns complete overlapping source sections without interpreting their prose", () => {
		expect(readStoryPreviewSourceWindow({
			sourceNarrative: SOURCE,
			boardStartSeconds: 45,
			boardEndSeconds: 54,
		})).toBe(SOURCE);
	});

	it("returns only the structurally overlapping timed section", () => {
		const result = readStoryPreviewSourceWindow({
			sourceNarrative: SOURCE,
			boardStartSeconds: 54,
			boardEndSeconds: 60,
		});

		expect(result).toContain("五十至六十秒的完整原文");
		expect(result).not.toContain("三十至五十秒的完整原文");
	});

	it("returns no source when timed headings leave a deterministic gap", () => {
		expect(readStoryPreviewSourceWindow({
			sourceNarrative: SOURCE,
			boardStartSeconds: 10,
			boardEndSeconds: 20,
		})).toBe("");
	});

	it("returns the full source when no timed heading contract exists", () => {
		const source = "没有时间标题的章节真源";
		expect(readStoryPreviewSourceWindow({
			sourceNarrative: source,
			boardStartSeconds: 0,
			boardEndSeconds: 9,
		})).toBe(source);
		expect(readStoryPreviewTimedSections(source)).toEqual([]);
	});
});
