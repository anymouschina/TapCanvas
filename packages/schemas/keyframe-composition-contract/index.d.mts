import { KEYFRAME_FOCUS_KINDS, KEYFRAME_SHOT_SCALES, KEYFRAME_VISUAL_WEIGHTS, KEYFRAME_DEPTH_LAYERS, KEYFRAME_CENTER_PLACEMENTS } from "./constants.mjs";
export { KEYFRAME_FOCUS_KINDS, KEYFRAME_SHOT_SCALES, KEYFRAME_VISUAL_WEIGHTS, KEYFRAME_DEPTH_LAYERS, KEYFRAME_CENTER_PLACEMENTS } from "./constants.mjs";
export type KeyframeFocusKind = (typeof KEYFRAME_FOCUS_KINDS)[number];
export type KeyframeShotScale = (typeof KEYFRAME_SHOT_SCALES)[number];
export type KeyframeVisualWeight = (typeof KEYFRAME_VISUAL_WEIGHTS)[number];
export type KeyframeDepthLayer = (typeof KEYFRAME_DEPTH_LAYERS)[number];
export type KeyframeCenterPlacement = (typeof KEYFRAME_CENTER_PLACEMENTS)[number];
export type KeyframeCompositionSubject = {
    name: string;
    visualWeight: KeyframeVisualWeight;
    depthLayer: KeyframeDepthLayer;
    centerPlacement: KeyframeCenterPlacement;
    maxFrameHeightRatio: number;
};
export type KeyframeCompositionContract = {
    narrativeTask: string;
    focusKind: KeyframeFocusKind;
    focusTargetNames: string[];
    focalPoint: [number, number];
    shotScale: KeyframeShotScale;
    environmentVisualWeight: KeyframeVisualWeight;
    subjects: KeyframeCompositionSubject[];
};
export type ParsedKeyframeCompositionContract = {
    ok: true;
    contract: KeyframeCompositionContract;
    hash: string;
} | {
    ok: false;
    issues: string[];
};
export declare function hashKeyframeCompositionContract(contract: KeyframeCompositionContract): string;
export declare function doesCompositionImageUrlCarryHash(imageUrl: string, hash: string): boolean;
export declare function parseKeyframeCompositionContract(value: unknown): ParsedKeyframeCompositionContract;
export declare function validateCompositionSubjectCoverage(input: {
    contract: KeyframeCompositionContract;
    characterNames: string[];
}): string[];
export declare function renderKeyframeCompositionFacts(contract: KeyframeCompositionContract): string;
