export const chapterBeatPlanSchema: Record<string, unknown>;
export const chapterAssetPlanSchema: Record<string, unknown>;
export const clipDesignSchema: Record<string, unknown>;
export const VIDEO_AUTHORING_STAGE_ARTIFACTS: Readonly<{ chapter: 'tapcanvas.chapter-beat-plan/v1'; assets: 'tapcanvas.chapter-asset-plan/v1'; clip: 'tapcanvas.clip-design/v1' }>;
export function bindClipDesignSchema(input: Readonly<{ clipIndex: number; durationSeconds: number; speechLineIds: readonly string[]; objectIds: readonly string[]; backgroundObjectIds: readonly string[] }>): Record<string, unknown>;
