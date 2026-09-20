import { beatSheetObjectRegistrySchema, beatSheetAssetPlansSchema } from './asset-schema.mjs';
import { blockingPlanSchema, backgroundPlanSchema } from '../blocking-plan-contract/schema.mjs';
import { clipObjectStateSchema } from '../clip-reference-selection/index.mjs';
const text = { type: 'string', minLength: 1 };
const positive = { type: 'number', exclusiveMinimum: 0 };
const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const array = (items, minItems = 0) => ({ type: 'array', items, minItems });
const delivery = { type: 'string', enum: ['on_screen', 'off_screen', 'voice_over'] };
const speech = object({ lineId: text, speakerName: text, text, clipIndex: { type: 'integer', minimum: 0 }, delivery });
const positiveInterval = properties => ({ ...object(properties), 'x-fieldRelations': [{ left: 'endSeconds', operator: 'gt', right: 'startSeconds' }] });
const storyEvent = positiveInterval({ sourceBeatId: text, event: text, exitState: text, startSeconds: { type: 'number', minimum: 0 }, endSeconds: positive });
/** Chapter author owns narrative allocation, not per-clip visual execution. */
export const chapterBeatPlanSchema = { ...object({
  sourceId: text, sourceFingerprint: text,
  chapterArc: object({ storyPromise: text, protagonistThroughline: text, primaryPayoff: text, endingHook: { type: ['string', 'null'] } }),
  sourceCoveragePlan: object({ speechLedger: array(speech) }),
  sourceFidelityAudit: object({ sourceBeatLedger: array(object({ sourceBeatId: text, sourceOrder: { type: 'integer', minimum: 0 }, durationSeconds: positive, summary: text }), 1) }),
  beats: array(object({ durationSeconds: positive, sourceSpan: text, narrativeIntent: text, dominantFunction: text,
    causalEntry: text, irreversibleResult: text, handoffToNext: text, storyEvents: array(storyEvent, 1) }), 1),
}), 'x-indexReferences': [{ values: ['sourceCoveragePlan', 'speechLedger', '*', 'clipIndex'], collection: ['beats'] }] };
/** One shared registry prevents parallel clips inventing incompatible identities. */
export const chapterAssetPlanSchema = object({
  objectRegistry: beatSheetObjectRegistrySchema(),
  assetPlans: { ...beatSheetAssetPlansSchema(), minItems: 0 },
  backgroundPlans: array(object({ objectId: text, plan: backgroundPlanSchema }), 1),
});
const { clipIndex: ignoredIndex, durationSeconds: ignoredDuration, backgroundPlan: ignoredBackground, ...blockingProperties } = blockingPlanSchema.properties;
const narrativeLine = object({ lineId: text, speakerName: text, text, delivery,
  sourceLineId: { type: ['string', 'null'] }, afterSourceLineId: { type: ['string', 'null'] }, sourceEvidence: array(text) });
/** All time windows are local; the deterministic join derives absolute coordinates. */
export const clipDesignSchema = object({
  clipIndex: { type: 'integer', minimum: 0 },
  beat: object({ visualIntent: text, startKeyframe: text, endKeyframe: text, dialoguePaceRate: positive,
    narrativeAudioPlan: object({ strategy: { type: 'string', enum: ['visual_only', 'source_speech_only', 'source_grounded_voice', 'mixed'] }, rationale: text, lines: array(narrativeLine) }),
    objectStates: array(clipObjectStateSchema, 1),
  }),
  blockingPlan: object({ ...blockingProperties, backgroundObjectId: text }),
  timing: object({ transitionFromPrevious: text, transitionToNext: text,
    temporalDirectives: array(positiveInterval({ startSeconds: { type: 'number', minimum: 0 }, endSeconds: positive, kind: text, reason: text })),
  }),
});
export const VIDEO_AUTHORING_STAGE_ARTIFACTS = Object.freeze({
  chapter: 'tapcanvas.chapter-beat-plan/v1', assets: 'tapcanvas.chapter-asset-plan/v1', clip: 'tapcanvas.clip-design/v1',
});

/** Bind immutable item identity and physical clock limits before model dispatch. */
export function bindClipDesignSchema(input) {
  if (!Number.isInteger(input.clipIndex) || input.clipIndex < 0 || !Number.isFinite(input.durationSeconds) || input.durationSeconds <= 0
    || !Array.isArray(input.objectIds) || input.objectIds.length === 0 || input.objectIds.some(id => typeof id !== 'string' || !id)) {
    throw new Error('Clip design schema requires an exact index, positive duration and non-empty registered object IDs');
  }
  if (!Array.isArray(input.speechLineIds) || input.speechLineIds.some(id => typeof id !== 'string' || !id)) throw new Error('Clip design requires frozen speech identities');
  const schema = structuredClone(clipDesignSchema);
  schema.properties.beat.properties.narrativeAudioPlan.properties.lines.items.properties.sourceLineId = {
    type: ['string', 'null'], enum: [null, ...input.speechLineIds],
    description: 'Exact source speech line identity from this clip ledger; null for an additional authored occurrence. Never use a story event or beat identity.',
  };
  schema.properties.beat.properties.narrativeAudioPlan.properties.lines.items.properties.afterSourceLineId = {
    type: ['string', 'null'], enum: [null, ...input.speechLineIds],
    description: 'Exact source speech line identity from this clip ledger, or null. Authored narrative line IDs are not source anchors; null anchors execute in authored array order.',
  };
  if (!Array.isArray(input.backgroundObjectIds) || input.backgroundObjectIds.length === 0 || input.backgroundObjectIds.some(id => typeof id !== 'string' || !id)) throw new Error('Clip design requires shared background IDs');
  schema.properties.blockingPlan.properties.backgroundObjectId = { ...schema.properties.blockingPlan.properties.backgroundObjectId, enum: [...input.backgroundObjectIds] };
  schema.properties.clipIndex.const = input.clipIndex;
  schema.properties.beat.properties.objectStates.items.properties.objectId = { ...schema.properties.beat.properties.objectStates.items.properties.objectId, enum: [...input.objectIds] };
  // The same frozen background identities constrain both selection and presence.
  // This relationship must be checked in the author tool, before host acceptance.
  schema.properties.beat.properties.objectStates.contains = {
    type: 'object', properties: { objectId: { enum: [...input.backgroundObjectIds] } }, required: ['objectId'],
  };
  const interval = schema.properties.timing.properties.temporalDirectives.items.properties;
  interval.startSeconds = { ...interval.startSeconds, exclusiveMaximum: input.durationSeconds };
  interval.endSeconds = { ...interval.endSeconds, maximum: input.durationSeconds };
  return schema;
}
