export const chapterBeatPlanSchema: Record<string, unknown>;
export const chapterAssetPlanSchema: Record<string, unknown>;
export const chapterAssetImageSourceSchema: Record<string, unknown>;
export const clipDesignSchema: Record<string, unknown>;
export const VIDEO_AUTHORING_STAGE_ARTIFACTS: Readonly<{ chapter: 'tapcanvas.chapter-beat-plan/v3'; assets: 'tapcanvas.chapter-asset-plan/v3'; clip: 'tapcanvas.clip-design/v2' }>;
export function bindClipDesignSchema(input: Readonly<{ clipIndex: number; durationSeconds: number; speechLineIds: readonly string[]; objectIds: readonly string[]; sceneObjectIds: readonly string[]; backgroundObjectIds: readonly string[] }>): Record<string, unknown>;
