import { beatSheetObjectRegistrySchema, beatSheetAssetPlansSchema, beatSheetAssetPlanVariants } from './asset-schema.mjs';
import { blockingPlanSchema, backgroundPlanSchema } from '../blocking-plan-contract/schema.mjs';
import { clipObjectStateSchema } from '../clip-reference-selection/index.mjs';
const text = { type: 'string', minLength: 1 };
const positive = { type: 'number', exclusiveMinimum: 0 };
const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const array = (items, minItems = 0) => ({ type: 'array', items, minItems });
const delivery = { type: 'string', enum: ['on_screen', 'off_screen', 'voice_over'] };
// The author submits `{ unitId, endOffset? }` only: startOffset is cursor
// state the host derives from reference order, and endOffset is needed only
// where a unit splits across beats. Both stay in the schema as optional
// consistency fields so artifacts frozen before the derivation still validate.
const sourceUnitRef = { type: 'object', properties: { unitId: text, startOffset: { type: 'integer', minimum: 0 }, endOffset: { type: 'integer', minimum: 1 } }, required: ['unitId'], additionalProperties: false };
const positiveInterval = properties => ({ ...object(properties), 'x-fieldRelations': [{ left: 'endSeconds', operator: 'gt', right: 'startSeconds' }] });
const storyEvent = positiveInterval({ sourceBeatId: text, event: text, exitState: text, startSeconds: { type: 'number', minimum: 0 }, endSeconds: positive });
/** Chapter author owns narrative allocation, not per-clip visual execution. */
export const chapterBeatPlanSchema = { ...object({
  sourceId: text, sourceFingerprint: text,
  chapterArc: object({ storyPromise: text, protagonistThroughline: text, primaryPayoff: text, endingHook: { type: ['string', 'null'] } }),
  sourceFidelityAudit: object({ sourceBeatLedger: array(object({ sourceBeatId: text, sourceOrder: { type: 'integer', minimum: 0 }, durationSeconds: positive, summary: text }), 1) }),
  beats: array(object({ durationSeconds: positive, dialoguePaceRate: { ...positive, description: 'Authored spoken characters per second, not a playback-speed multiplier. Allocate this beat duration together with the frozen source-unit speech allocated to it.' },
    sourceUnitRefs: array(sourceUnitRef), startKeyframe: text, endKeyframe: text,
    sourceSpan: text, narrativeIntent: text, dominantFunction: text,
    causalEntry: text, irreversibleResult: text, handoffToNext: text, storyEvents: array(storyEvent, 1) }), 1),
}), 'x-authoringObservations': ['speech_budget'] };
/** One shared registry prevents parallel clips inventing incompatible identities. */
const existingImageId = { ...text, 'x-referenceSource': 'project_image' };
const { referenceAssetIds: ignoredAssetIds, referenceImageNodeIds: ignoredImageNodes, ...registryProperties } = beatSheetObjectRegistrySchema().items.properties;
const generationPlan = { anyOf: beatSheetAssetPlansSchema().items.anyOf.map(variant => {
  const { objectId: ignoredObjectId, referenceAssetBindings: ignoredInputBindings, ...properties } = variant.properties;
  return object(properties);
}) };
export const chapterAssetImageSourceSchema = { anyOf: [
  object({ mode: { const: 'reuse', type: 'string' }, assetIds: { ...array(existingImageId, 1), uniqueItems: true } }),
  object({ mode: { const: 'generate', type: 'string' },
    referenceAssetBindings: array(object({ assetId: existingImageId, role: { type: 'string', enum: ['identity', 'content', 'layout', 'style'] } })),
    plan: generationPlan }),
] };
const registryVariant = (kind, imageSource) => object({
  ...registryProperties, kind,
  referenceRole: { ...registryProperties.referenceRole, enum: registryProperties.referenceRole.enum.filter(role => role !== 'none') },
  imageSource,
});
const chapterAssetRegistryVariants = [
  registryVariant(registryProperties.kind, chapterAssetImageSourceSchema.anyOf[0]),
  ...beatSheetAssetPlanVariants().map(({ kinds, schema }) => {
    const { objectId: ignoredObjectId, referenceAssetBindings: ignoredInputBindings, ...planProperties } = schema.properties;
    const generateSource = chapterAssetImageSourceSchema.anyOf[1];
    return registryVariant({ type: 'string', enum: kinds }, {
      ...generateSource, properties: { ...generateSource.properties, plan: object(planProperties) },
    });
  }),
];
export const chapterAssetPlanSchema = {
  ...object({
  objectRegistry: { ...array({ 'x-referenceFactEquality': [
    { ownerField: 'physicalIdentityKey', referencePath: ['imageSource', 'assetIds', '*'],
      catalog: 'project_image', factField: 'physicalIdentityKey', unknownFact: 'observe',
      when: [{ path: ['kind'], equals: 'character' }, { path: ['imageSource', 'mode'], equals: 'reuse' }] },
    { ownerField: 'physicalIdentityKey', referencePath: ['imageSource', 'referenceAssetBindings', '*'], referenceField: 'assetId',
      referenceWhen: { field: 'role', equals: 'identity' }, catalog: 'project_image', factField: 'physicalIdentityKey', unknownFact: 'observe',
      when: [{ path: ['kind'], equals: 'character' }, { path: ['imageSource', 'mode'], equals: 'generate' }] },
  ], allOf: [{ anyOf: [
    { type: 'object', properties: { kind: { const: 'character' }, physicalIdentityKey: text }, required: ['kind', 'physicalIdentityKey'] },
    { type: 'object', properties: { kind: { enum: registryProperties.kind.enum.filter(kind => kind !== 'character') }, physicalIdentityKey: { type: 'null' } }, required: ['kind', 'physicalIdentityKey'] },
  ] }], anyOf: chapterAssetRegistryVariants }, 1), 'x-uniqueBy': ['objectId'] },
  backgroundPlans: { ...array(object({ objectId: text, plan: backgroundPlanSchema }), 1), 'x-uniqueBy': ['objectId'] },
  }),
  // A batch may bind to existing project assets, but cannot bind to an identity
  // that the same batch is creating. The host interprets these paths through its
  // generic typed-output repair contract; this metadata does not rewrite output.
  'x-batchAssetReferenceConstraints': [{
    declaredIdentityPath: ['backgroundPlans', '*', 'plan', 'assetId'],
    referencedIdentityPath: ['backgroundPlans', '*', 'plan', 'referenceAssetBindings', '*', 'assetId'],
  }],
};
const { clipIndex: ignoredIndex, durationSeconds: ignoredDuration, backgroundPlan: ignoredBackground, ...blockingProperties } = blockingPlanSchema.properties;
const narrativeLine = object({ lineId: text, speakerName: text, text, delivery,
  sourceLineId: { type: ['string', 'null'] }, afterSourceLineId: { type: ['string', 'null'] }, sourceEvidence: array(text) });
/** All time windows are local; the deterministic join derives absolute coordinates. */
export const clipDesignSchema = object({
  clipIndex: { type: 'integer', minimum: 0 },
  beat: object({ visualIntent: text,
    narrativeAudioPlan: object({ strategy: { type: 'string', enum: ['visual_only', 'source_speech_only', 'source_grounded_voice', 'mixed'] }, rationale: text, lines: array(narrativeLine) }),
    objectStates: array(clipObjectStateSchema, 1),
  }),
  blockingPlan: object({ ...blockingProperties, backgroundObjectId: text }),
  timing: object({ transitionFromPrevious: text, transitionToNext: text,
    temporalDirectives: array(positiveInterval({ startSeconds: { type: 'number', minimum: 0 }, endSeconds: positive, kind: text, reason: text })),
  }),
});
export const VIDEO_AUTHORING_STAGE_ARTIFACTS = Object.freeze({
  chapter: 'tapcanvas.chapter-beat-plan/v3', assets: 'tapcanvas.chapter-asset-plan/v3', clip: 'tapcanvas.clip-design/v2',
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
  // Scene objects and generated background plans are distinct identity domains.
  // Match the assembly contract: states reference registered scene objects;
  // backgroundObjectId independently selects a shared background plan.
  if (!Array.isArray(input.sceneObjectIds) || input.sceneObjectIds.length === 0
    || input.sceneObjectIds.some(id => typeof id !== 'string' || !id || !input.objectIds.includes(id))) {
    throw new Error('Clip design requires non-empty scene IDs contained in the frozen object registry');
  }
  schema.properties.beat.properties.objectStates.contains = {
    type: 'object', properties: { objectId: { enum: [...input.sceneObjectIds] } }, required: ['objectId'],
  };
  const interval = schema.properties.timing.properties.temporalDirectives.items.properties;
  interval.startSeconds = { ...interval.startSeconds, exclusiveMaximum: input.durationSeconds };
  interval.endSeconds = { ...interval.endSeconds, maximum: input.durationSeconds };
  return schema;
}
