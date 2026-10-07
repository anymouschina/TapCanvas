export const CHAPTER_ASSET_OUTLINE_ARTIFACT_TYPE: 'tapcanvas.chapter-asset-outline/v2';
export const CHAPTER_ASSET_SEEDS_ARTIFACT_TYPE: 'tapcanvas.chapter-asset-seeds/v1';
export const CHAPTER_ASSET_PART_ARTIFACT_TYPE: 'tapcanvas.chapter-asset-part/v1';
export const CHAPTER_ASSET_PLAN_ARTIFACT_TYPE: 'tapcanvas.chapter-asset-plan/v3';
export const CHAPTER_ASSET_OBJECT_KINDS: readonly ['character', 'scene', 'prop', 'vfx', 'palette', 'composition'];
export const CHAPTER_ASSET_OUTLINE_LISTED_KINDS: readonly ['character', 'prop', 'vfx', 'composition'];
export const CHAPTER_ASSET_BACKGROUND_KIND: 'background';
export const chapterAssetOutlineSchema: Record<string, unknown>;
export type ChapterAssetSeed = Readonly<{
	outlineId: string;
	objectId: string;
	kind: 'character' | 'scene' | 'prop' | 'vfx' | 'palette' | 'composition' | 'background';
	name: string;
	brief: string;
	/** 仅背景底图：所属场景对象的 objectId。 */
	sceneObjectId?: string;
}>;
export function readJsonArtifact(value: unknown, label: string): unknown;
export function seedsFromOutline(outline: unknown): ChapterAssetSeed[];
export function bindChapterAssetPartSchema(seed: ChapterAssetSeed | Readonly<Record<string, unknown>>): Record<string, unknown>;
export function mergeChapterAssetParts(
	seeds: readonly ChapterAssetSeed[],
	parts: readonly unknown[],
): { objectRegistry: Record<string, unknown>[]; backgroundPlans: Record<string, unknown>[] };
