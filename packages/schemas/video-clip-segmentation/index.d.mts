export const CHAPTER_CLIP_SEGMENTATION_ARTIFACT_TYPE: 'tapcanvas.chapter-clip-segmentation/v1';
export const CLIP_SOURCE_SEGMENT_PROTOCOL_VERSION: 'tapcanvas.clip-source-segment/v1';
export const chapterClipSegmentationSchema: Record<string, unknown>;

export type ClipSegmentationRange = Readonly<{
  sourceIndex: number;
  startOffset: number;
  endOffset: number;
}>;

export type AuthoredChapterClipSegmentation = Readonly<{
  protocolVersion: typeof CHAPTER_CLIP_SEGMENTATION_ARTIFACT_TYPE;
  clips: readonly Readonly<{
    durationSeconds: number;
    sourceRanges: readonly ClipSegmentationRange[];
  }>[];
}>;

export function inspectClipSegmentationCoverage(
  clips: unknown,
  sourceContents: readonly string[],
): string | null;
