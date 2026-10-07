/** Author ordered chapter events with explicit provider clip ownership. */
export const CHAPTER_SEQUENCE_ARTIFACT_TYPE = 'tapcanvas.chapter-sequence/v4';
/** The bound root preserves source facts and ordered clip ownership. */
export const BOUND_CHAPTER_SEQUENCE_ARTIFACT_TYPE = 'tapcanvas.chapter-sequence-bound/v2';
/** Per-Clip consumers receive deterministic projections of the global authoring artifact. */
export const CHAPTER_SEQUENCE_CLIPS_ARTIFACT_TYPE = 'tapcanvas.chapter-sequence-clips/v2';
export const CHAPTER_SEQUENCE_CLIP_ARTIFACT_TYPE = 'tapcanvas.chapter-sequence-clip/v2';

import { PERFORMANCE_MODES, PERFORMANCE_MODE_LABELS } from '../performance-routing/index.mjs';

const text = { type: 'string', minLength: 1 };
/** What kind of performance a beat is; each Clip author receives the methods routed to its window's modes. */
const performance = { type: 'string', enum: [...PERFORMANCE_MODES],
  description: `这一拍的演出类型，宿主据此给逐 Clip 作者装配对口的方法与知识：${PERFORMANCE_MODES.map((mode) => `${mode}＝${PERFORMANCE_MODE_LABELS[mode]}`).join('；')}` };
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

/** Normalized top-down floor-plan point: [x, y] in 0..1, origin top-left, x to the right, y downwards. */
const planPoint = { type: 'array', minItems: 2, maxItems: 2, items: { type: 'number', minimum: 0, maximum: 1 } };

/** Body postures the staging ledger tracks; the host renders them as 站/坐/跪/蹲/躺. */
export const STAGING_POSTURES = ['stand', 'sit', 'kneel', 'crouch', 'lie'];

const stagingLandmark = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: ['door', 'window', 'furniture', 'area'] },
    label: text,
    at: planPoint,
  },
  required: ['kind', 'label', 'at'],
  additionalProperties: false,
};

const stagingMark = {
  type: 'object',
  properties: { mark: text, where: text, at: planPoint },
  required: ['mark', 'where', 'at'],
  additionalProperties: false,
};

/** One scene's floor plan: fixed landmarks and the named marks people stand or sit on. */
const stagingLayout = {
  type: 'object',
  properties: {
    landmarks: { type: 'array', minItems: 1, items: stagingLandmark },
    marks: { type: 'array', minItems: 1, items: stagingMark },
  },
  required: ['landmarks', 'marks'],
  additionalProperties: false,
};

const stagingPosition = {
  type: 'object',
  properties: { who: text, mark: text, posture: { type: 'string', enum: STAGING_POSTURES } },
  required: ['who', 'mark', 'posture'],
  additionalProperties: false,
};

const storyEvent = {
  type: 'object',
  properties: {
    eventId: text,
    eventIndex: { type: 'integer', minimum: 0 },
    clipId: text,
    action: text,
    sourceRanges: { type: 'array', minItems: 1, items: sourceRange },
    onScreen: { type: 'array', uniqueItems: true, items: text },
    sceneId: text,
    performance,
    moves: { type: 'array', minItems: 1, items: stagingPosition },
    staging: { type: 'array', items: stagingPosition },
  },
  required: ['eventId', 'eventIndex', 'clipId', 'action', 'sourceRanges'],
  additionalProperties: false,
};

const speechEvent = {
  type: 'object',
  properties: {
    speechEventId: text,
    sceneId: text,
    scope: { type: 'string', enum: ['beat', 'scene'] },
    storyEventId: text,
    speaker: text,
    delivery: text,
    text: { ...text, description: 'Exact words spoken by this character; never assembled from creative instructions.' },
    textOrigin: { type: 'string', enum: ['authored', 'source_quote'] },
    voice: { type: 'string', enum: ['onscreen', 'inner', 'offscreen', 'narration'] },
    eventIndex: { type: 'integer', minimum: 0 },
    clipId: text,
    sourceRanges: { type: 'array', items: sourceRange },
  },
  required: ['speechEventId', 'speaker', 'delivery', 'text', 'textOrigin', 'eventIndex', 'clipId', 'sceneId', 'scope', 'sourceRanges'],
  additionalProperties: false,
};

const keyframe = {
  type: 'object',
  properties: { visual: text, state: text },
  required: ['visual', 'state'],
  additionalProperties: false,
};

const boundary = {
  type: 'object',
  properties: {
    boundaryId: text,
    timeSeconds: { type: 'number', minimum: 0 },
    keyframe,
    causalEntry: text,
    irreversibleResult: { type: 'string' },
    handoff: text,
  },
  required: ['boundaryId', 'timeSeconds', 'keyframe', 'causalEntry', 'irreversibleResult', 'handoff'],
  additionalProperties: false,
};

const clipWindow = {
  type: 'object',
  properties: {
    clipId: text,
    durationSeconds: { type: 'integer', minimum: 1 },
    storyEventIds: { type: 'array', uniqueItems: true, items: text },
    speechEventIds: { type: 'array', uniqueItems: true, items: text },
    startBoundaryId: text,
    endBoundaryId: text,
  },
  required: ['clipId', 'durationSeconds', 'storyEventIds', 'speechEventIds', 'startBoundaryId', 'endBoundaryId'],
  additionalProperties: false,
};

const authoringRecord = {
  type: 'object',
  properties: {
    sourceAssessment: text,
    approach: text,
    actions: {
      type: 'array',
      items: {
        type: 'object',
        properties: { action: text, reason: text, result: text },
        required: ['action', 'reason', 'result'],
        additionalProperties: false,
      },
    },
    review: {
      type: 'object',
      properties: { findings: { type: 'array', items: text }, revisions: { type: 'array', items: text } },
      required: ['findings', 'revisions'],
      additionalProperties: false,
    },
    sourceIds: { type: 'array', uniqueItems: true, items: text },
  },
  required: ['sourceAssessment', 'approach', 'actions', 'review', 'sourceIds'],
  additionalProperties: false,
};

/** Compiled adaptation decision: one contiguous source span and what the film does with it. */
const adaptationSpan = {
  type: 'object',
  properties: {
    spanId: text,
    decision: { type: 'string', enum: ['dramatize', 'condense', 'cut'] },
    note: text,
    sourceRanges: { type: 'array', minItems: 1, items: sourceRange },
  },
  required: ['spanId', 'decision', 'note', 'sourceRanges'],
  additionalProperties: false,
};

/** Compiled scene: one environment, its adapted spans and explicit provider clip owners. */
const sceneSummary = {
  type: 'object',
  properties: {
    sceneId: text,
    setting: text,
    entryState: text,
    exitState: text,
    adapts: { type: 'array', minItems: 1, uniqueItems: true, items: text },
    clipIds: { type: 'array', minItems: 1, uniqueItems: true, items: text },
    layout: stagingLayout,
    positions: { type: 'array', items: stagingPosition },
  },
  required: ['sceneId', 'setting', 'entryState', 'exitState', 'adapts', 'clipIds'],
  additionalProperties: false,
};

export const chapterSequenceSchema = {
  type: 'object',
  properties: {
    protocolVersion: { type: 'string', const: CHAPTER_SEQUENCE_ARTIFACT_TYPE },
    wholeFilmIntent: text,
    totalDurationSeconds: { type: 'integer', minimum: 1 },
    adaptation: { type: 'array', minItems: 1, items: adaptationSpan },
    scenes: { type: 'array', minItems: 1, items: sceneSummary },
    storyEvents: { type: 'array', minItems: 1, items: storyEvent },
    speechEvents: {
      type: 'array',
      description: 'Ordered speech instructions belong to one explicit clip; the video model chooses speech timing and shot pacing within that clip.',
      items: speechEvent,
    },
    boundaries: {
      type: 'array',
      minItems: 2,
      maxItems: 81,
      description: 'Exactly one more entry than clips: one boundary at the start of every clip plus one at the final end. With N clips provide N+1 boundaries in time order.',
      items: boundary,
    },
    clips: { type: 'array', minItems: 1, maxItems: 80, items: clipWindow },
    authoringRecord,
  },
  required: ['protocolVersion', 'wholeFilmIntent', 'totalDurationSeconds', 'storyEvents', 'speechEvents', 'boundaries', 'clips'],
  additionalProperties: false,
};

/**
 * Author-facing chapter script. The author decides what the film adapts, cuts or
 * adds and writes ordered scenes of beats; the author explicitly groups provider clips while the model chooses internal pacing.
 * The host binds identities and shared submission boundaries, then compiles chapter-sequence/v4.
 */
export const CHAPTER_SCRIPT_PROTOCOL_VERSION = 'tapcanvas.chapter-script/v2';

const scriptAdaptationSpan = {
  type: 'object',
  properties: {
    spanId: text,
    until: text,
    decision: { type: 'string', enum: ['dramatize', 'condense', 'cut'], description: '此来源范围的改编取舍：演出、压缩或删去。' },
    note: text,
  },
  required: ['spanId', 'until', 'decision', 'note'],
  additionalProperties: false,
};

/** Words of one speech: a numbered source sentence said verbatim, or the authored line itself. */
const SOURCE_UNIT_ID = '^U[1-9][0-9]*$';

/**
 * Someone is heard during this beat. Every field is required, so a speaking beat
 * can never be half-written; the beat's picture is what the audience sees meanwhile.
 */
const scriptSpeech = {
  type: 'object',
  properties: {
    speaker: { ...text, description: '发声来源的名称；可见人物引用 characters 中的名字，纯声音来源可独立命名。' },
    voice: { type: 'string', enum: ['onscreen', 'inner', 'offscreen', 'narration'], description: 'onscreen＝画内对白；inner＝内心独白或心声；offscreen＝画外人声；narration＝叙述者旁白。' },
    delivery: { ...text, description: '这句怎么说：语气、语速、潜台词。' },
    says: { ...text, description: '原文对白或要念的原文叙述：只写它的编号（如 "U12"），宿主逐字填入；扩写的台词或心声：直接写说出口的完整台词。' },
    conveys: { type: 'array', minItems: 1, uniqueItems: true, items: { type: 'string', pattern: SOURCE_UNIT_ID }, description: '本句原创人声表达的来源叙述编号。' },
  },
  required: ['speaker', 'voice', 'delivery', 'says'],
  additionalProperties: false,
};

/** One ordered picture description, optionally while someone speaks; models choose internal timing. */
const scriptBeat = {
  type: 'object',
  properties: {
    performance,
    clipId: { ...text, description: '这一拍所属的供应商片段，引用本稿 clips 的 clipId；只声明内容归属，不分配拍内时钟。' },
    picture: { ...text, description: '这一拍观众看见的事：谁做了什么、什么反应；有人说话时写说话期间正在发生的可见过程。' },
    visible: { type: 'array', uniqueItems: true, items: text, description: '本拍可见人物；空镜写 []。' },
    speech: scriptSpeech,
    enters: { type: 'array', minItems: 1, uniqueItems: true, items: text },
    exits: { type: 'array', minItems: 1, uniqueItems: true, items: text },
    moves: { type: 'array', minItems: 1, items: stagingPosition },
    shows: { type: 'array', minItems: 1, uniqueItems: true, items: { type: 'string', pattern: SOURCE_UNIT_ID }, description: '本拍画面表达的来源叙述编号。' },
  },
  required: ['performance', 'clipId', 'picture', 'visible'],
  additionalProperties: false,
};

/** Author-side floor-plan spot; any extra annotation is ignored by the host. */
const scriptStagingMark = { ...stagingMark, additionalProperties: true };
const scriptStagingLayout = {
  ...stagingLayout,
  properties: { ...stagingLayout.properties, marks: { type: 'array', minItems: 1, items: scriptStagingMark } },
};

/** The author's own notes on what it did; free-form annotations are kept out by the host, not rejected. */
const scriptAuthoringRecord = {
  ...authoringRecord,
  properties: {
    ...authoringRecord.properties,
    actions: { type: 'array', items: { ...authoringRecord.properties.actions.items, additionalProperties: true } },
  },
};

const scriptScene = {
  type: 'object',
  properties: {
    sceneId: text,
    setting: text,
    place: { ...text, description: '场景所在地点的固定名称（如“百花酒楼二楼雅间”），同一地点在全章始终写同一个名字。当下场景与上一个当下场景 place 相同且没写 timeSkip 时，宿主把它当作同一空间接着演：沿用上一场的平面和每个人此刻的位置。' },
    timeSkip: { type: 'boolean', description: '声明与上一个同地点当下场景之间的故事时间跳跃；true 时不继承前场可选空间事实，不要求补写 layout 或 positions。' },
    memoryVoice: { ...scriptSpeech, properties: { ...scriptSpeech.properties, clipId: text }, required: [...scriptSpeech.required, 'clipId'], description: '可选回忆场景人声；clipId 引用本场所属片段，整句在该片段内发声一次。' },
    adapts: { type: 'array', minItems: 1, uniqueItems: true, items: text },
    cast: { type: 'array', uniqueItems: true, items: text },
    layout: { ...scriptStagingLayout, required: [], description: '可选场景平面；同地点继续场景可补充 landmarks/marks。' },
    positions: { type: 'array', items: stagingPosition, description: '可选开场位置；未声明时继承同地点已知位置。' },
    entryState: text,
    exitState: text,
    beats: { type: 'array', minItems: 1, items: scriptBeat },
  },
  required: ['sceneId', 'setting', 'place', 'adapts', 'cast', 'entryState', 'exitState', 'beats'],
  additionalProperties: false,
};

export const chapterScriptSchema = {
  type: 'object',
  properties: {
    wholeFilmIntent: text,
    sourceKind: { type: 'string', enum: ['narrative', 'brief'], description: 'narrative＝待改编的叙事正文；brief＝创作要求。具体改编取舍记录在 adaptation。' },
    characters: { type: 'array', uniqueItems: true, items: text, description: '本章实际可见的人物，包括回忆、闪回中的可见人物；每人一个固定名字，供 cast、enters 及该人物的 speech.speaker 引用。只有声音而无可见形象的来源不列入名册。实际在场、进入、离开与镜头未拍到分别由场景和动作字段表达。' },
    adaptation: { type: 'array', minItems: 1, items: scriptAdaptationSpan },
    scenes: { type: 'array', minItems: 1, items: scriptScene },
    clips: { type: 'array', minItems: 1, maxItems: 80, items: { type: 'object', properties: { clipId: text, durationSeconds: { type: 'integer', minimum: 1, description: '供应商要求的整个片段执行时长，内部镜头和发声节奏交给视频模型适配。' } }, required: ['clipId', 'durationSeconds'], additionalProperties: false } },
    authoringRecord: scriptAuthoringRecord,
  },
  required: ['wholeFilmIntent', 'sourceKind', 'characters', 'adaptation', 'scenes', 'clips'],
  additionalProperties: false,
};
