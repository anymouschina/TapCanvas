import { describe, expect, it } from "vitest";
import {
	isStoryPreviewAssetData,
	normalizeStoryPreviewAssetData,
} from "./story-preview-asset";

describe("story preview asset contract", () => {
	it("normalizes a complete preview board and forces production isolation", () => {
		expect(normalizeStoryPreviewAssetData({
			assetUsage: "preview_only",
			previewSeriesId: "chapter-1-r75",
			previewBoardIndex: 1,
			previewBoardCount: 3,
			previewShotCount: 9,
		})).toEqual({
			assetUsage: "preview_only",
			assetPurpose: "story_preview",
			productionEligible: false,
			productionLayer: "preview",
			creationStage: "story_preview",
			previewSeriesId: "chapter-1-r75",
			previewBoardIndex: 1,
			previewBoardCount: 3,
			previewShotCount: 9,
		});
	});

	it("rejects more than nine panels and does not misclassify generic non-production data", () => {
		expect(normalizeStoryPreviewAssetData({
			assetPurpose: "story_preview",
			previewSeriesId: "chapter-1-r75",
			previewBoardIndex: 0,
			previewBoardCount: 1,
			previewShotCount: 10,
		})).toBeNull();
		expect(isStoryPreviewAssetData({ productionEligible: false })).toBe(false);
	});
});
