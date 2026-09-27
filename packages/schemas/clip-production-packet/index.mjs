/**
 * Per-Clip creative and materialization packet. This contract preserves authored
 * facts; it does not inspect creative prose or infer asset identities.
 */
import { clipDesignSchema } from '../video-authoring-stages/schema.mjs';
import { normalizedPointSchema } from '../blocking-plan-contract/schema.mjs';

export const CLIP_PRODUCTION_PACKET_PROTOCOL_VERSION = 'tapcanvas.clip-production-packet/v1';
export const CLIP_PRODUCTION_PACKET_COLLECTION_ARTIFACT_TYPE = 'tapcanvas.clip-production-packets/v1';
export const CLIP_PRODUCTION_ASSET_INTENTS_ARTIFACT_TYPE = 'tapcanvas.clip-production-asset-intents/v1';
export const CLIP_PRODUCTION_PACKET_MAX_ITEMS = 80;

const text = { type: 'string', minLength: 1 };
const canonicalText = { ...text, pattern: '^\\S(?:[\\s\\S]*\\S)?$' };
const sourceRangeSchema = {
  type: 'object',
  properties: {
    sourceIndex: { type: 'integer', minimum: 0 },
    startOffset: { type: 'integer', minimum: 0 },
    endOffset: { type: 'integer', minimum: 1 },
    sourceId: canonicalText,
    sourceFingerprint: canonicalText,
  },
  required: ['sourceIndex', 'startOffset', 'endOffset', 'sourceId', 'sourceFingerprint'],
  additionalProperties: false,
};

const referenceAssetBindingSchema = {
  type: 'object',
  properties: {
    assetId: canonicalText,
    role: { type: 'string', enum: ['identity', 'content', 'layout', 'style'] },
    strength: { type: 'number', minimum: 0, maximum: 1 },
  },
  required: ['assetId', 'role'],
  additionalProperties: false,
};

const generationSpecSchema = {
  type: 'object',
  properties: {
    prompt: text,
    negativePrompt: text,
    modelKey: canonicalText,
    aspectRatio: canonicalText,
    size: canonicalText,
  },
  required: ['prompt', 'negativePrompt', 'modelKey', 'aspectRatio', 'size'],
  additionalProperties: true,
};

const assetImageSourceSchema = {
  oneOf: [
    {
      type: 'object',
      properties: {
        mode: { const: 'generate' },
        generationSpecVersion: canonicalText,
        generationSpec: generationSpecSchema,
      },
      required: ['mode', 'generationSpecVersion', 'generationSpec'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        mode: { const: 'reuse' },
        existingAssetId: { ...canonicalText, 'x-referenceSource': 'project_image' },
        existingProjectId: canonicalText,
      },
      required: ['mode', 'existingAssetId', 'existingProjectId'],
      additionalProperties: false,
    },
  ],
};

const assetIntentSchema = {
  type: 'object',
  properties: {
    assetId: canonicalText,
    state: {
      ...canonicalText,
      description: 'Agent-authored normalized state identity; never infer it from prompt or source prose in the host.',
    },
    registryObjectId: canonicalText,
    displayName: canonicalText,
    referenceType: { type: 'string', enum: ['character', 'scene', 'prop', 'vfx', 'palette', 'composition'] },
    referenceAssetBindings: { type: 'array', items: referenceAssetBindingSchema },
    imageSource: assetImageSourceSchema,
    canonicalName: canonicalText,
    roleName: canonicalText,
    physicalIdentityKey: canonicalText,
    assetReuseKey: canonicalText,
    characterAssetRole: canonicalText,
    characterProfileVersion: canonicalText,
    identityBoardSpec: { type: 'object', minProperties: 1 },
    identityAnchors: { type: 'array', items: canonicalText },
    prohibitedDrift: { type: 'array', items: canonicalText },
    sceneCard: { type: 'object', minProperties: 1 },
    sceneName: canonicalText,
    propName: canonicalText,
    assetPurpose: canonicalText,
  },
  required: ['assetId', 'state', 'registryObjectId', 'displayName', 'referenceType', 'referenceAssetBindings', 'imageSource'],
  additionalProperties: false,
};

const assetIdentitySchema = {
  type: 'object',
  properties: { assetId: canonicalText, state: canonicalText },
  required: ['assetId', 'state'],
  additionalProperties: false,
};

/** The Clip author owns spatial facts. The chapter plan owns the background identity. */
export const clipProductionBlockingPlanSchema = {
  ...clipDesignSchema.properties.blockingPlan,
  properties: {
    ...clipDesignSchema.properties.blockingPlan.properties,
    axisLine: {
      type: 'object',
      properties: { from: normalizedPointSchema, to: normalizedPointSchema },
      required: ['from', 'to'],
      additionalProperties: false,
    },
  },
};

export const clipProductionPacketSchema = {
  type: 'object',
  properties: {
    protocolVersion: { type: 'string', const: CLIP_PRODUCTION_PACKET_PROTOCOL_VERSION },
    clipId: canonicalText,
    clipIndex: { type: 'integer', minimum: 0, maximum: CLIP_PRODUCTION_PACKET_MAX_ITEMS - 1 },
    durationSeconds: { type: 'integer', minimum: 1 },
    videoInputMode: { type: 'string', enum: ['image_to_video', 'reference_to_video', 'text_to_video'] },
    firstFrameAsset: { oneOf: [assetIdentitySchema, { type: 'null' }] },
    referenceAssets: { type: 'array', items: assetIdentitySchema },
    sourceRanges: { type: 'array', minItems: 1, items: sourceRangeSchema },
    videoPrompt: text,
    blockingPlan: clipProductionBlockingPlanSchema,
    clipFacts: {
      type: 'object',
      minProperties: 1,
      additionalProperties: true,
    },
    assetIntents: { type: 'array', items: assetIntentSchema },
  },
  required: [
    'protocolVersion', 'clipId', 'clipIndex', 'durationSeconds', 'videoInputMode',
    'firstFrameAsset', 'referenceAssets', 'sourceRanges',
    'videoPrompt', 'blockingPlan', 'clipFacts', 'assetIntents',
  ],
  additionalProperties: false,
};

function isRecord(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value, keys) {
  return isRecord(value)
    && Object.keys(value).length === keys.length
    && keys.every((key) => Object.hasOwn(value, key));
}

function isCanonicalText(value) {
  return typeof value === 'string' && value.length > 0 && value === value.trim();
}

function assertJsonValue(value, path, ancestors = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (typeof value !== 'object') throw new Error(`${path} must contain JSON values only`);
  if (ancestors.has(value)) throw new Error(`${path} must not contain a cycle`);
  ancestors.add(value);
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertJsonValue(entry, `${path}[${index}]`, ancestors));
  } else {
    if (!isRecord(value)) throw new Error(`${path} must contain plain JSON objects only`);
    for (const [key, entry] of Object.entries(value)) {
      assertJsonValue(entry, `${path}.${key}`, ancestors);
    }
  }
  ancestors.delete(value);
}

/** Stable structural serialization: object-key order is irrelevant; array order is preserved. */
export function canonicalClipProductionJson(value) {
  assertJsonValue(value, 'value');
  const encode = (entry) => {
    if (entry === null || typeof entry !== 'object') return JSON.stringify(entry);
    if (Array.isArray(entry)) return `[${entry.map(encode).join(',')}]`;
    return `{${Object.keys(entry).sort().map((key) => `${JSON.stringify(key)}:${encode(entry[key])}`).join(',')}}`;
  };
  return encode(value);
}

function validateSourceRanges(ranges, path) {
  if (!Array.isArray(ranges) || ranges.length === 0) throw new Error(`${path} must contain at least one range`);
  let previous = null;
  for (const [index, range] of ranges.entries()) {
    const rangePath = `${path}[${index}]`;
    if (!hasExactKeys(range, ['sourceIndex', 'startOffset', 'endOffset', 'sourceId', 'sourceFingerprint'])) {
      throw new Error(`${rangePath} has missing or unknown fields`);
    }
    if (!Number.isSafeInteger(range.sourceIndex) || range.sourceIndex < 0
      || !Number.isSafeInteger(range.startOffset) || range.startOffset < 0
      || !Number.isSafeInteger(range.endOffset) || range.endOffset <= range.startOffset
      || !isCanonicalText(range.sourceId) || !isCanonicalText(range.sourceFingerprint)) {
      throw new Error(`${rangePath} must contain canonical source identity and a positive UTF-16 range`);
    }
    if (previous && (range.sourceIndex < previous.sourceIndex
      || (range.sourceIndex === previous.sourceIndex && range.startOffset < previous.endOffset))) {
      throw new Error(`${rangePath} must be ordered and must not overlap a prior range`);
    }
    previous = range;
  }
}

function validateAssetIntent(value, path) {
  const requiredFields = ['assetId', 'state', 'registryObjectId', 'displayName', 'referenceType', 'referenceAssetBindings', 'imageSource'];
  const optionalFields = ['canonicalName', 'roleName', 'physicalIdentityKey', 'assetReuseKey', 'characterAssetRole', 'characterProfileVersion',
    'identityBoardSpec', 'identityAnchors', 'prohibitedDrift', 'sceneCard', 'sceneName', 'propName', 'assetPurpose'];
  if (!isRecord(value) || requiredFields.some((field) => !Object.hasOwn(value, field))
    || Object.keys(value).some((field) => !requiredFields.includes(field) && !optionalFields.includes(field))) {
    throw new Error(`${path} has missing or unknown fields`);
  }
  for (const field of ['assetId', 'state', 'registryObjectId', 'displayName']) {
    if (!isCanonicalText(value[field])) throw new Error(`${path}.${field} must be a canonical non-empty string`);
  }
  if (!['character', 'scene', 'prop', 'vfx', 'palette', 'composition'].includes(value.referenceType)) {
    throw new Error(`${path}.referenceType is invalid`);
  }
  for (const field of optionalFields) {
    if (!Object.hasOwn(value, field)) continue;
    if (field === 'identityBoardSpec' || field === 'sceneCard') {
      if (!isRecord(value[field]) || Object.keys(value[field]).length === 0) throw new Error(`${path}.${field} must be a non-empty object`);
    } else if (field === 'identityAnchors' || field === 'prohibitedDrift') {
      if (!Array.isArray(value[field]) || value[field].some((entry) => !isCanonicalText(entry))) {
        throw new Error(`${path}.${field} must contain canonical strings`);
      }
    } else if (!isCanonicalText(value[field])) throw new Error(`${path}.${field} must be a canonical non-empty string`);
  }
  if (!Array.isArray(value.referenceAssetBindings)) throw new Error(`${path}.referenceAssetBindings must be an array`);
  const bindingIds = new Set();
  for (const [index, binding] of value.referenceAssetBindings.entries()) {
    const bindingPath = `${path}.referenceAssetBindings[${index}]`;
    if (!isRecord(binding) || !isCanonicalText(binding.assetId)
      || !['identity', 'content', 'layout', 'style'].includes(binding.role)
      || Object.keys(binding).some((key) => !['assetId', 'role', 'strength'].includes(key))
      || (binding.strength !== undefined && (typeof binding.strength !== 'number'
        || !Number.isFinite(binding.strength) || binding.strength < 0 || binding.strength > 1))) {
      throw new Error(`${bindingPath} is invalid`);
    }
    if (bindingIds.has(binding.assetId)) throw new Error(`${path}.referenceAssetBindings has duplicate assetId`);
    bindingIds.add(binding.assetId);
  }
  const source = value.imageSource;
  if (!isRecord(source)) throw new Error(`${path}.imageSource must be an object`);
  if (source.mode === 'generate') {
    if (!hasExactKeys(source, ['mode', 'generationSpecVersion', 'generationSpec'])
      || !isCanonicalText(source.generationSpecVersion) || !isRecord(source.generationSpec)) {
      throw new Error(`${path}.imageSource generate facts are invalid`);
    }
    for (const field of ['prompt', 'negativePrompt', 'modelKey', 'aspectRatio', 'size']) {
      if (!isCanonicalText(source.generationSpec[field])) {
        throw new Error(`${path}.imageSource.generationSpec.${field} must be a canonical non-empty string`);
      }
    }
  } else if (source.mode === 'reuse') {
    if (!hasExactKeys(source, ['mode', 'existingAssetId', 'existingProjectId'])
      || !isCanonicalText(source.existingAssetId) || !isCanonicalText(source.existingProjectId)) {
      throw new Error(`${path}.imageSource reuse facts are invalid`);
    }
  } else {
    throw new Error(`${path}.imageSource.mode is invalid`);
  }
  assertJsonValue(value, path);
}

function validateAssetIdentity(value, path) {
  if (!hasExactKeys(value, ['assetId', 'state'])) throw new Error(`${path} has missing or unknown fields`);
  if (!isCanonicalText(value.assetId) || !isCanonicalText(value.state)) {
    throw new Error(`${path} must contain canonical non-empty assetId and state`);
  }
}

function validPoint(value) {
  return Array.isArray(value) && value.length === 2
    && value.every((coordinate) => typeof coordinate === 'number'
      && Number.isFinite(coordinate) && coordinate >= 0 && coordinate <= 1);
}

function validateBlockingPlan(value) {
  const path = 'clip-production-packet.blockingPlan';
  const required = ['title', 'sceneName', 'landmarks', 'characters', 'camera', 'compositionContract', 'backgroundObjectId'];
  if (!isRecord(value) || required.some((field) => !Object.hasOwn(value, field))
    || Object.keys(value).some((field) => !required.includes(field) && field !== 'axisLine')) {
    throw new Error(`${path} has missing or unknown fields`);
  }
  for (const field of ['title', 'sceneName', 'backgroundObjectId']) {
    if (!isCanonicalText(value[field])) throw new Error(`${path}.${field} must be a canonical non-empty string`);
  }
  if (!Array.isArray(value.landmarks) || !Array.isArray(value.characters)
    || !isRecord(value.camera) || !validPoint(value.camera.at) || !validPoint(value.camera.lookAt)
    || !isRecord(value.compositionContract) || Object.keys(value.compositionContract).length === 0) {
    throw new Error(`${path} requires structured landmarks, characters, camera and composition`);
  }
  for (const [index, character] of value.characters.entries()) {
    if (!isRecord(character) || !isCanonicalText(character.name) || !validPoint(character.at)
      || (character.facingTo !== null && !validPoint(character.facingTo))
      || (character.moveTo !== null && !validPoint(character.moveTo))) {
      throw new Error(`${path}.characters[${index}] has invalid spatial facts`);
    }
  }
  for (const [index, landmark] of value.landmarks.entries()) {
    const landmarkPath = `${path}.landmarks[${index}]`;
    if (!isRecord(landmark) || !isCanonicalText(landmark.label)
      || (landmark.kind === 'wall' && (!validPoint(landmark.from) || !validPoint(landmark.to)))
      || (landmark.kind === 'door' && (!validPoint(landmark.at)
        || !['h', 'v'].includes(landmark.orient) || !['in', 'out', 'none'].includes(landmark.swing)
        || typeof landmark.lengthN !== 'number' || !Number.isFinite(landmark.lengthN)
        || landmark.lengthN <= 0 || landmark.lengthN > 1))
      || (landmark.kind === 'area' && !validPoint(landmark.at))
      || !['wall', 'door', 'area'].includes(landmark.kind)) {
      throw new Error(`${landmarkPath} has invalid spatial facts`);
    }
  }
  if (value.axisLine !== undefined && (!isRecord(value.axisLine)
    || !validPoint(value.axisLine.from) || !validPoint(value.axisLine.to))) {
    throw new Error(`${path}.axisLine has invalid endpoints`);
  }
  assertJsonValue(value, path);
}

/** Validate one packet without rewriting any author-produced content. */
export function validateClipProductionPacket(value) {
  const packetFields = [
    'protocolVersion', 'clipId', 'clipIndex', 'durationSeconds', 'videoInputMode',
    'firstFrameAsset', 'referenceAssets', 'sourceRanges',
    'videoPrompt', 'blockingPlan', 'clipFacts', 'assetIntents',
  ];
  if (!hasExactKeys(value, packetFields)) throw new Error('clip-production-packet has missing or unknown fields');
  if (value.protocolVersion !== CLIP_PRODUCTION_PACKET_PROTOCOL_VERSION) {
    throw new Error(`clip-production-packet.protocolVersion must equal ${CLIP_PRODUCTION_PACKET_PROTOCOL_VERSION}`);
  }
  if (!isCanonicalText(value.clipId)) throw new Error('clip-production-packet.clipId must be a canonical non-empty string');
  if (!Number.isSafeInteger(value.clipIndex) || value.clipIndex < 0 || value.clipIndex >= CLIP_PRODUCTION_PACKET_MAX_ITEMS) {
    throw new Error(`clip-production-packet.clipIndex must be between 0 and ${CLIP_PRODUCTION_PACKET_MAX_ITEMS - 1}`);
  }
  if (!Number.isSafeInteger(value.durationSeconds) || value.durationSeconds <= 0) {
    throw new Error('clip-production-packet.durationSeconds must be a positive safe integer');
  }
  if (value.videoInputMode !== 'image_to_video'
    && value.videoInputMode !== 'reference_to_video'
    && value.videoInputMode !== 'text_to_video') {
    throw new Error('clip-production-packet.videoInputMode must be image_to_video, reference_to_video, or text_to_video');
  }
  if (!Array.isArray(value.assetIntents)) throw new Error('clip-production-packet.assetIntents must be an array');
  value.assetIntents.forEach((intent, index) => validateAssetIntent(intent, `clip-production-packet.assetIntents[${index}]`));
  if (value.firstFrameAsset !== null) validateAssetIdentity(value.firstFrameAsset, 'clip-production-packet.firstFrameAsset');
  if (!Array.isArray(value.referenceAssets)) throw new Error('clip-production-packet.referenceAssets must be an array');
  value.referenceAssets.forEach((identity, index) => validateAssetIdentity(identity, `clip-production-packet.referenceAssets[${index}]`));
  const identityKey = (identity) => JSON.stringify([identity.assetId, identity.state]);
  const intentKeys = value.assetIntents.map(identityKey);
  if (new Set(intentKeys).size !== intentKeys.length) {
    throw new Error('clip-production-packet.assetIntents must not contain duplicate identities');
  }
  const availableIdentities = new Set(intentKeys);
  const referenceKeys = value.referenceAssets.map(identityKey);
  if (new Set(referenceKeys).size !== referenceKeys.length) {
    throw new Error('clip-production-packet.referenceAssets must not contain duplicate identities');
  }
  if (value.videoInputMode === 'image_to_video') {
    if (value.firstFrameAsset === null) throw new Error('image_to_video requires firstFrameAsset');
    if (!availableIdentities.has(identityKey(value.firstFrameAsset))) {
      throw new Error('firstFrameAsset must match an asset intent by assetId and state');
    }
    if (!referenceKeys.includes(identityKey(value.firstFrameAsset))) {
      throw new Error('image_to_video firstFrameAsset must also be listed in referenceAssets');
    }
  } else if (value.videoInputMode === 'reference_to_video') {
    if (value.firstFrameAsset !== null) throw new Error('reference_to_video must not declare firstFrameAsset');
    if (value.referenceAssets.length === 0) throw new Error('reference_to_video requires at least one referenceAsset');
  } else if (value.firstFrameAsset !== null || value.referenceAssets.length !== 0 || value.assetIntents.length !== 0) {
    throw new Error('text_to_video must not declare firstFrameAsset, referenceAssets, or assetIntents');
  }
  for (const [index, identity] of value.referenceAssets.entries()) {
    if (!availableIdentities.has(identityKey(identity))) {
      throw new Error(`referenceAssets[${index}] must match an asset intent by assetId and state`);
    }
  }
  if (value.videoInputMode !== 'text_to_video'
    && (availableIdentities.size !== referenceKeys.length || intentKeys.some((key) => !referenceKeys.includes(key)))) {
    throw new Error('assetIntents and referenceAssets must declare the same identities for image-input modes');
  }
  if (typeof value.videoPrompt !== 'string' || value.videoPrompt.trim().length === 0) {
    throw new Error('clip-production-packet.videoPrompt must be non-empty');
  }
  validateBlockingPlan(value.blockingPlan);
  validateSourceRanges(value.sourceRanges, 'clip-production-packet.sourceRanges');
  if (!isRecord(value.clipFacts) || Object.keys(value.clipFacts).length === 0) {
    throw new Error('clip-production-packet.clipFacts must be a non-empty structured object');
  }
  assertJsonValue(value.clipFacts, 'clip-production-packet.clipFacts');
  return structuredClone(value);
}

/**
 * Assemble a complete, bounded Clip set and exact-identity asset intents.
 * Consumers are merged only for identical [assetId, state] and generation facts.
 */
export function collectClipProductionPackets(input) {
  if (!Array.isArray(input) || input.length === 0 || input.length > CLIP_PRODUCTION_PACKET_MAX_ITEMS) {
    throw new Error(`clip-production-packet collection must contain 1..${CLIP_PRODUCTION_PACKET_MAX_ITEMS} items`);
  }
  const clips = input.map(validateClipProductionPacket).sort((left, right) => left.clipIndex - right.clipIndex);
  const clipIds = new Set();
  const clipIndexes = new Set();
  for (const clip of clips) {
    if (clipIds.has(clip.clipId)) throw new Error(`clipId duplicates an existing packet: ${clip.clipId}`);
    if (clipIndexes.has(clip.clipIndex)) throw new Error(`clipIndex duplicates an existing packet: ${clip.clipIndex}`);
    clipIds.add(clip.clipId);
    clipIndexes.add(clip.clipIndex);
  }

  const assetsByIdentity = new Map();
  for (const clip of clips) {
    for (const intent of clip.assetIntents) {
      const identityKey = JSON.stringify([intent.assetId, intent.state]);
      const specificationKey = canonicalClipProductionJson({
        registryObjectId: intent.registryObjectId,
        displayName: intent.displayName,
        referenceType: intent.referenceType,
        referenceAssetBindings: intent.referenceAssetBindings,
        imageSource: intent.imageSource,
        canonicalName: intent.canonicalName ?? null,
        roleName: intent.roleName ?? null,
        physicalIdentityKey: intent.physicalIdentityKey ?? null,
        characterAssetRole: intent.characterAssetRole ?? null,
        characterProfileVersion: intent.characterProfileVersion ?? null,
        identityBoardSpec: intent.identityBoardSpec ?? null,
        identityAnchors: intent.identityAnchors ?? null,
        prohibitedDrift: intent.prohibitedDrift ?? null,
        sceneCard: intent.sceneCard ?? null,
        sceneName: intent.sceneName ?? null,
        propName: intent.propName ?? null,
        assetPurpose: intent.assetPurpose ?? null,
      });
      const existing = assetsByIdentity.get(identityKey);
      if (existing && existing.specificationKey !== specificationKey) {
        throw new Error(`Asset intent ${identityKey} has conflicting source or semantic identity facts`);
      }
      if (existing) {
        if (!existing.consumerClipIds.includes(clip.clipId)) existing.consumerClipIds.push(clip.clipId);
      } else {
        assetsByIdentity.set(identityKey, {
          intent: structuredClone(intent),
          specificationKey,
          consumerClipIds: [clip.clipId],
        });
      }
    }
  }

  const assetIntents = [...assetsByIdentity.values()]
    .sort((left, right) => left.intent.assetId.localeCompare(right.intent.assetId)
      || left.intent.state.localeCompare(right.intent.state))
    .map(({ intent, consumerClipIds }) => ({ ...intent, consumerClipIds }));
  return {
    protocolVersion: CLIP_PRODUCTION_PACKET_PROTOCOL_VERSION,
    clips,
    assetIntents,
  };
}
