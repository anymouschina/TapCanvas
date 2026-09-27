/** Agent-authored, chapter-wide continuity and speech plan. Source text is never authored here. */
export const CHAPTER_SEQUENCE_ARTIFACT_TYPE = 'tapcanvas.chapter-sequence/v1';
export const BOUND_CHAPTER_SEQUENCE_ARTIFACT_TYPE = 'tapcanvas.chapter-sequence-bound/v1';
export const CHAPTER_SEQUENCE_CLIPS_ARTIFACT_TYPE = 'tapcanvas.chapter-sequence-clips/v1';
export const CHAPTER_SEQUENCE_CLIP_ARTIFACT_TYPE = 'tapcanvas.chapter-sequence-clip/v1';

const text = { type: 'string', minLength: 1 };
const sourceRange = {
  type: 'object',
  properties: {
    sourceIndex: { type: 'integer', minimum: 0 },
    startOffset: { type: 'integer', minimum: 0 },
    endOffset: { type: 'integer', minimum: 1 },
    sourceId: text,
    sourceFingerprint: text,
  },
  required: ['sourceIndex', 'startOffset', 'endOffset', 'sourceId', 'sourceFingerprint'],
  additionalProperties: false,
};
const timedEvent = {
  type: 'object',
  properties: {
    eventId: text,
    startSeconds: { type: 'number', minimum: 0 },
    endSeconds: { type: 'number', exclusiveMinimum: 0 },
    action: text,
  },
  required: ['eventId', 'startSeconds', 'endSeconds', 'action'],
  additionalProperties: false,
};
const speechEvent = {
  type: 'object',
  properties: {
    speechEventId: text,
    speaker: text,
    delivery: text,
    startSeconds: { type: 'number', minimum: 0 },
    endSeconds: { type: 'number', exclusiveMinimum: 0 },
    sourceRanges: { type: 'array', minItems: 1, items: sourceRange },
  },
  required: ['speechEventId', 'speaker', 'delivery', 'startSeconds', 'endSeconds', 'sourceRanges'],
  additionalProperties: false,
};
const keyframe = {
  type: 'object',
  properties: { visual: text, state: text },
  required: ['visual', 'state'],
  additionalProperties: false,
};
const clip = {
  type: 'object',
  properties: {
    clipId: text,
    clipIndex: { type: 'integer', minimum: 0, maximum: 79 },
    durationSeconds: { type: 'integer', minimum: 1 },
    sourceRanges: { type: 'array', minItems: 1, items: sourceRange },
    startKeyframe: keyframe,
    endKeyframe: keyframe,
    causalEntry: text,
    irreversibleResult: text,
    handoff: text,
    storyEvents: { type: 'array', items: timedEvent },
    speechEvents: { type: 'array', items: speechEvent },
  },
  required: ['clipId', 'clipIndex', 'durationSeconds', 'sourceRanges', 'startKeyframe',
    'endKeyframe', 'causalEntry', 'irreversibleResult', 'handoff', 'storyEvents', 'speechEvents'],
  additionalProperties: false,
};

export const chapterSequenceSchema = {
  type: 'object',
  properties: {
    protocolVersion: { type: 'string', const: CHAPTER_SEQUENCE_ARTIFACT_TYPE },
    clips: { type: 'array', minItems: 1, maxItems: 80, items: clip },
  },
  required: ['protocolVersion', 'clips'],
  additionalProperties: false,
};
