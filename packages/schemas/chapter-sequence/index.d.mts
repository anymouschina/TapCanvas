export const CHAPTER_SEQUENCE_ARTIFACT_TYPE: 'tapcanvas.chapter-sequence/v1';
export const BOUND_CHAPTER_SEQUENCE_ARTIFACT_TYPE: 'tapcanvas.chapter-sequence-bound/v1';
export const CHAPTER_SEQUENCE_CLIPS_ARTIFACT_TYPE: 'tapcanvas.chapter-sequence-clips/v1';
export const CHAPTER_SEQUENCE_CLIP_ARTIFACT_TYPE: 'tapcanvas.chapter-sequence-clip/v1';
export const chapterSequenceSchema: Readonly<Record<string, unknown>>;

export type ChapterSequenceSourceRange = Readonly<{
  sourceIndex: number;
  startOffset: number;
  endOffset: number;
  sourceId: string;
  sourceFingerprint: string;
}>;
export type ChapterSequenceKeyframe = Readonly<{ visual: string; state: string }>;
export type ChapterSequenceStoryEvent = Readonly<{
  eventId: string;
  startSeconds: number;
  endSeconds: number;
  action: string;
}>;
export type ChapterSequenceSpeechEvent = Readonly<{
  speechEventId: string;
  speaker: string;
  delivery: string;
  startSeconds: number;
  endSeconds: number;
  sourceRanges: readonly ChapterSequenceSourceRange[];
}>;
export type ChapterSequenceClip = Readonly<{
  clipId: string;
  clipIndex: number;
  durationSeconds: number;
  sourceRanges: readonly ChapterSequenceSourceRange[];
  startKeyframe: ChapterSequenceKeyframe;
  endKeyframe: ChapterSequenceKeyframe;
  causalEntry: string;
  irreversibleResult: string;
  handoff: string;
  storyEvents: readonly ChapterSequenceStoryEvent[];
  speechEvents: readonly ChapterSequenceSpeechEvent[];
}>;
export type AuthoredChapterSequence = Readonly<{
  protocolVersion: typeof CHAPTER_SEQUENCE_ARTIFACT_TYPE;
  clips: readonly ChapterSequenceClip[];
}>;
export type BoundChapterSequenceClip = Omit<ChapterSequenceClip, 'speechEvents'> & Readonly<{
  speechEvents: readonly (ChapterSequenceSpeechEvent & Readonly<{ text: string }>)[];
}>;
export type BoundChapterSequence = Readonly<{
  protocolVersion: typeof BOUND_CHAPTER_SEQUENCE_ARTIFACT_TYPE;
  clips: readonly BoundChapterSequenceClip[];
}>;
export type ChapterSequenceClipItem = BoundChapterSequenceClip & Readonly<{
  protocolVersion: typeof CHAPTER_SEQUENCE_CLIP_ARTIFACT_TYPE;
  previousBoundary: Readonly<{
    clipId: string;
    endKeyframe: ChapterSequenceKeyframe;
    irreversibleResult: string;
    handoff: string;
  }> | null;
  nextBoundary: Readonly<{
    clipId: string;
    startKeyframe: ChapterSequenceKeyframe;
    causalEntry: string;
  }> | null;
}>;
