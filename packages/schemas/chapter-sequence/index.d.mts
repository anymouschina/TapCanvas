import type { PerformanceMode } from '../performance-routing/index.mjs';
export const CHAPTER_SEQUENCE_ARTIFACT_TYPE: 'tapcanvas.chapter-sequence/v4';
export const BOUND_CHAPTER_SEQUENCE_ARTIFACT_TYPE: 'tapcanvas.chapter-sequence-bound/v2';
export const CHAPTER_SEQUENCE_CLIPS_ARTIFACT_TYPE: 'tapcanvas.chapter-sequence-clips/v2';
export const CHAPTER_SEQUENCE_CLIP_ARTIFACT_TYPE: 'tapcanvas.chapter-sequence-clip/v2';
export const chapterSequenceSchema: Readonly<Record<string, unknown>>;
export const CHAPTER_SCRIPT_PROTOCOL_VERSION: 'tapcanvas.chapter-script/v2';
export const chapterScriptSchema: Readonly<Record<string, unknown>>;

export type ChapterSequenceSourceRange = Readonly<{
  sourceIndex: number;
  startOffset: number;
  endOffset: number;
  sourceId: string;
  sourceFingerprint: string;
}>;
export type ChapterSequenceSourceSlice = ChapterSequenceSourceRange & Readonly<{ text: string }>;
export type ChapterSequenceKeyframe = Readonly<{ visual: string; state: string }>;
export const STAGING_POSTURES: readonly ['stand', 'sit', 'kneel', 'crouch', 'lie'];
export type StagingPosture = (typeof STAGING_POSTURES)[number];
/** Normalized top-down floor-plan point: origin top-left, x to the right, y downwards. */
export type StagingPoint = readonly [number, number];
export type StagingLandmark = Readonly<{ kind: 'door' | 'window' | 'furniture' | 'area'; label: string; at: StagingPoint }>;
/** A named place in one scene where people stand or sit; `where` reads after 站在/坐在/走到. */
export type StagingMark = Readonly<{ mark: string; where: string; at: StagingPoint }>;
export type StagingLayout = Readonly<{ landmarks: readonly StagingLandmark[]; marks: readonly StagingMark[] }>;
export type StagingPosition = Readonly<{ who: string; mark: string; posture: StagingPosture }>;
export type ChapterSequenceStoryEvent = Readonly<{
  eventId: string;
  eventIndex: number;
  clipId: string;
  action: string;
  sourceRanges: readonly ChapterSequenceSourceRange[];
  /** Characters visible while this event plays; compiled from the script's cast, entrances and exits. */
  onScreen?: readonly string[];
  /** Scene this event belongs to. */
  sceneId?: string;
  /** Performance mode the author tagged this beat with. */
  performance?: PerformanceMode;
  /** Position changes the author declared for this beat; they complete by the beat's end. */
  moves?: readonly StagingPosition[];
  /** Where everyone on screen is after this beat (exits removed). */
  staging?: readonly StagingPosition[];
}>;
export type ChapterSequenceSpeechEvent = Readonly<{
  speechEventId: string;
  sceneId: string;
  scope: 'beat' | 'scene';
  storyEventId?: string;
  speaker: string;
  delivery: string;
  text: string;
  textOrigin: 'authored' | 'source_quote';
  /** How the line is heard; a declared voice role for the video model. */
  voice?: SpeechVoice;
  eventIndex: number;
  clipId: string;
  sourceRanges: readonly ChapterSequenceSourceRange[];
}>;
/** onscreen: a visible character speaks; inner: inner monologue heard as voice-over; offscreen: a voice whose speaker is not in frame; narration: the narrator reads narration that neither the picture nor a character can carry. */
export type SpeechVoice = 'onscreen' | 'inner' | 'offscreen' | 'narration';
export type ChapterSequenceBoundary = Readonly<{
  boundaryId: string;
  timeSeconds: number;
  keyframe: ChapterSequenceKeyframe;
  causalEntry: string;
  irreversibleResult: string;
  handoff: string;
}>;
export type ChapterSequenceWindow = Readonly<{
  clipId: string;
  durationSeconds: number;
  storyEventIds: readonly string[];
  speechEventIds: readonly string[];
  startBoundaryId: string;
  endBoundaryId: string;
}>;
export type ChapterSequenceAuthoringAction = Readonly<{
  action: string;
  reason: string;
  result: string;
}>;
export type ChapterSequenceAuthoringRecord = Readonly<{
  sourceAssessment: string;
  approach: string;
  actions: readonly ChapterSequenceAuthoringAction[];
  review: Readonly<{ findings: readonly string[]; revisions: readonly string[] }>;
  sourceIds: readonly string[];
}>;
export type ChapterAdaptationDecision = 'dramatize' | 'condense' | 'cut';
/** One contiguous source span and what the film does with it; spans partition every frozen source. */
export type ChapterSequenceAdaptationSpan = Readonly<{
  spanId: string;
  decision: ChapterAdaptationDecision;
  note: string;
  sourceRanges: readonly ChapterSequenceSourceRange[];
}>;
export type ChapterSequenceScene = Readonly<{
  sceneId: string;
  setting: string;
  entryState: string;
  exitState: string;
  adapts: readonly string[];
  clipIds: readonly string[];
  layout?: StagingLayout;
  /** Where the scene's cast is when it opens. */
  positions?: readonly StagingPosition[];
}>;
export type AuthoredChapterSequence = Readonly<{
  protocolVersion: typeof CHAPTER_SEQUENCE_ARTIFACT_TYPE;
  wholeFilmIntent: string;
  totalDurationSeconds: number;
  adaptation?: readonly ChapterSequenceAdaptationSpan[];
  scenes?: readonly ChapterSequenceScene[];
  storyEvents: readonly ChapterSequenceStoryEvent[];
  speechEvents: readonly ChapterSequenceSpeechEvent[];
  boundaries: readonly ChapterSequenceBoundary[];
  clips: readonly ChapterSequenceWindow[];
  authoringRecord?: ChapterSequenceAuthoringRecord;
}>;
export type BoundChapterSequenceStoryEvent = ChapterSequenceStoryEvent;
export type BoundChapterSequenceSpeechEvent = ChapterSequenceSpeechEvent;
export type BoundChapterSequenceClip = Readonly<{
  clipId: string;
  clipIndex: number;
  durationSeconds: number;
  sourceRanges: readonly ChapterSequenceSourceRange[];
  wholeFilmIntent: string;
  globalStartSeconds: number;
  globalEndSeconds: number;
  startBoundaryId: string;
  endBoundaryId: string;
  startKeyframe: ChapterSequenceKeyframe;
  endKeyframe: ChapterSequenceKeyframe;
  causalEntry: string;
  irreversibleResult: string;
  handoff: string;
  storyEvents: readonly BoundChapterSequenceStoryEvent[];
  speechEvents: readonly BoundChapterSequenceSpeechEvent[];
  /** Frozen staging this window plays in; absent for timelines compiled without a staging ledger. */
  staging?: ChapterSequenceClipStaging;
}>;
/** Floor plans and positions declared before the clip’s first ordered event. */
export type ChapterSequenceClipStaging = Readonly<{
  scenes: readonly Readonly<{ sceneId: string; setting: string; layout: StagingLayout; positions: readonly StagingPosition[] }>[];
  opening: readonly StagingPosition[];
}>;
export type BoundChapterSequence = Readonly<{
  protocolVersion: typeof BOUND_CHAPTER_SEQUENCE_ARTIFACT_TYPE;
  wholeFilmIntent: string;
  totalDurationSeconds: number;
  adaptation?: readonly ChapterSequenceAdaptationSpan[];
  scenes?: readonly ChapterSequenceScene[];
  storyEvents: readonly ChapterSequenceStoryEvent[];
  speechEvents: readonly BoundChapterSequenceSpeechEvent[];
  boundaries: readonly ChapterSequenceBoundary[];
  clips: readonly BoundChapterSequenceClip[];
  authoringRecord?: ChapterSequenceAuthoringRecord;
}>;
/** A neighboring clip’s frozen story event, in declared story order. */
export type ChapterSequenceNeighborEvent = Readonly<{
  eventId: string;
  action: string;
  eventIndex: number;
}>;

export type ChapterSequenceClipItem = BoundChapterSequenceClip & Readonly<{
  protocolVersion: typeof CHAPTER_SEQUENCE_CLIP_ARTIFACT_TYPE;
  previousBoundary: Readonly<{
    clipId: string;
    endKeyframe: ChapterSequenceKeyframe;
    irreversibleResult: string;
    handoff: string;
    sourceSlices: readonly ChapterSequenceSourceSlice[];
    /** Events that finished inside the previous window; this Clip must not re-enact them. */
    storyEvents: readonly ChapterSequenceNeighborEvent[];
  }> | null;
  nextBoundary: Readonly<{
    clipId: string;
    startKeyframe: ChapterSequenceKeyframe;
    causalEntry: string;
    sourceSlices: readonly ChapterSequenceSourceSlice[];
    /** Events that start inside the next window; this Clip must not perform them early. */
    storyEvents: readonly ChapterSequenceNeighborEvent[];
  }> | null;
}>;

export type ChapterScriptBeat = Readonly<{
  kind: 'action' | 'reaction' | 'line';
  /** Performance mode of the beat, routing per-Clip methods and knowledge. */
  performance: PerformanceMode;
  text: string;
  /** Explicit provider clip ownership; no per-beat clock is authored. */
  clipId: string;
  speaker?: string;
  delivery?: string;
  textOrigin?: 'authored' | 'source_quote';
  visual?: string;
  /** Author-declared characters visible in this beat, independent of names in picture prose. */
  visible?: readonly string[];
  enters?: readonly string[];
  exits?: readonly string[];
  moves?: readonly StagingPosition[];
  /** Source unit spoken or read verbatim by this line; the host fills text from it. */
  unit?: string;
  /** Narration units this beat plays in the picture. */
  shows?: readonly string[];
  /** Narration units an authored line says in a character's own words. */
  conveys?: readonly string[];
}> & (
  | Readonly<{ kind: 'action' | 'reaction' }>
  | Readonly<{ kind: 'line'; speaker: string; delivery: string; textOrigin: 'authored' | 'source_quote'; voice: SpeechVoice; visual: string }>
);
export type ChapterScriptScene = Readonly<{
  sceneId: string;
  setting: string;
  /** Stable place name; a present scene in the previous present scene's place continues its space unless timeSkip. */
  place: string;
  /** Story time jumped since the previous present scene in this place; optional spatial facts are not inherited. */
  timeSkip?: boolean;
  /** present (default) or memory: flashback beats belong only to memory scenes. */
  timeLayer?: 'present' | 'memory';
  memoryVoice?: ChapterScriptMemoryVoice;
  adapts: readonly string[];
  cast: readonly string[];
  /** Optional author-declared floor plan; same-place scenes may inherit or add spatial facts without a continuity gate. */
  layout?: StagingLayout;
  /** Optional author-declared opening positions, independent of layout; omitted positions are never filled from a template. */
  positions?: readonly StagingPosition[];
  entryState: string;
  exitState: string;
  beats: readonly ChapterScriptBeat[];
}>;
export type ChapterScriptAdaptationSpan = Readonly<{
  spanId: string;
  until: string;
  decision: ChapterAdaptationDecision;
  note: string;
}>;
export type ChapterScript = Readonly<{
  protocolVersion: typeof CHAPTER_SCRIPT_PROTOCOL_VERSION;
  wholeFilmIntent: string;
  /** narrative: source text adapted with every sentence kept; brief: a creative request the film fulfils without reading it. */
  sourceKind: 'narrative' | 'brief';
  /** Everyone the chapter's pictures show, memories included; the host checks each beat's picture against it. */
  characters?: readonly string[];
  adaptation: readonly ChapterScriptAdaptationSpan[];
  scenes: readonly ChapterScriptScene[];
  clips: readonly Readonly<{ clipId: string; durationSeconds: number }>[];
  authoringRecord?: ChapterSequenceAuthoringRecord;
}>;

/** What the author writes for someone heard during a beat; every field is required. */
export type AuthoredChapterScriptSpeech = Readonly<{
  speaker: string;
  voice: SpeechVoice;
  delivery: string;
  /** A numbered source sentence ("U12") said verbatim, or the authored words. */
  says: string;
  conveys?: readonly string[];
}>;
/** What the author writes for one beat; the host derives the internal line/action beat from it. */
export type AuthoredChapterScriptBeat = Readonly<{
  performance: PerformanceMode;
  clipId: string;
  picture: string;
  /** Who the picture shows; people only talked about or remembered are left out. */
  visible: readonly string[];
  speech?: AuthoredChapterScriptSpeech;
  enters?: readonly string[];
  exits?: readonly string[];
  moves?: readonly StagingPosition[];
  shows?: readonly string[];
}>;
/** The author-facing chapter script: the host stamps protocolVersion and derives internal beats. */
export type AuthoredChapterScript = Readonly<Omit<ChapterScript, 'protocolVersion' | 'scenes'> & {
  scenes: readonly (Readonly<Omit<ChapterScriptScene, 'beats' | 'timeLayer' | 'memoryVoice'>> & Readonly<{
    beats: readonly AuthoredChapterScriptBeat[];
    /** Present on a memory scene only: the voice that says whose memory it is. */
    memoryVoice?: AuthoredChapterScriptSpeech & Readonly<{ clipId: string }>;
  }>)[];
}>;

export type ChapterScriptMemoryVoice = Readonly<{ clipId: string; speaker: string; voice: SpeechVoice; delivery: string; text: string; textOrigin: 'authored' | 'source_quote'; unit?: string; conveys?: readonly string[] }>;
