export const STORY_PREVIEW_ASSET_USAGE = "preview_only" as const;
export const STORY_PREVIEW_ASSET_PURPOSE = "story_preview" as const;
export const STORY_PREVIEW_PRODUCTION_LAYER = "preview" as const;
export const STORY_PREVIEW_CREATION_STAGE = "story_preview" as const;
export const STORY_PREVIEW_MAX_SHOTS_PER_BOARD = 9 as const;

export type StoryPreviewAssetData = Readonly<{
	assetUsage: typeof STORY_PREVIEW_ASSET_USAGE;
	assetPurpose: typeof STORY_PREVIEW_ASSET_PURPOSE;
	productionEligible: false;
	productionLayer: typeof STORY_PREVIEW_PRODUCTION_LAYER;
	creationStage: typeof STORY_PREVIEW_CREATION_STAGE;
	previewSeriesId: string;
	previewBoardIndex: number;
	previewBoardCount: number;
	previewShotCount: number;
}>;

function readString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

export function isStoryPreviewAssetData(value: unknown): boolean {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const data = value as Record<string, unknown>;
	return data.assetUsage === STORY_PREVIEW_ASSET_USAGE
		|| data.assetPurpose === STORY_PREVIEW_ASSET_PURPOSE
		|| data.productionLayer === STORY_PREVIEW_PRODUCTION_LAYER;
}

export function normalizeStoryPreviewAssetData(
	value: Record<string, unknown>,
): StoryPreviewAssetData | null {
	if (!isStoryPreviewAssetData(value)) return null;
	const previewSeriesId = readString(value.previewSeriesId);
	const previewBoardIndex = Number(value.previewBoardIndex);
	const previewBoardCount = Number(value.previewBoardCount);
	const previewShotCount = Number(value.previewShotCount);
	if (
		!previewSeriesId
		|| !Number.isInteger(previewBoardIndex)
		|| previewBoardIndex < 0
		|| !Number.isInteger(previewBoardCount)
		|| previewBoardCount < 1
		|| previewBoardIndex >= previewBoardCount
		|| !Number.isInteger(previewShotCount)
		|| previewShotCount < 1
		|| previewShotCount > STORY_PREVIEW_MAX_SHOTS_PER_BOARD
	) return null;
	return {
		assetUsage: STORY_PREVIEW_ASSET_USAGE,
		assetPurpose: STORY_PREVIEW_ASSET_PURPOSE,
		productionEligible: false,
		productionLayer: STORY_PREVIEW_PRODUCTION_LAYER,
		creationStage: STORY_PREVIEW_CREATION_STAGE,
		previewSeriesId,
		previewBoardIndex,
		previewBoardCount,
		previewShotCount,
	};
}
