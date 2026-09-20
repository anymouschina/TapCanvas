import { ASSET_OBJECT_KINDS } from "../workflow-asset-registry/index.mjs";
// Structural asset-role contract. Never inspect or rewrite creative prose here.
const text = { type: 'string', minLength: 1 };
const strings = { type: 'array', items: text };
const lightTextFields = [
  'narrativeIntent', 'keySource', 'direction', 'colorTemperature', 'lightQuality',
  'shadowBehavior', 'atmosphereInteraction', 'reflectiveBehavior',
];
const lightingProperties = {
  version: { type: 'string', enum: ['scene-lighting/v1'] },
  ...Object.fromEntries(lightTextFields.map((key) => [key, text])),
  practicalSources: strings,
  continuityLocks: strings,
};
export const sceneReferenceCardSchema = {
  type: 'object',
  properties: {
    spacePrompt: { ...text, description: 'Executable image prompt for the unoccupied physical space only.' },
    negativePrompt: { ...text, description: 'Restrictions on this empty spatial reference only.' },
    sceneProfileVersion: { type: 'string', enum: ['scene-card/v1'] },
    sceneAssetRole: { type: 'string', enum: ['space_anchor'] },
    sceneOccupancy: { type: 'string', enum: ['none'] },
    sceneLightingSpec: {
      type: 'object', properties: lightingProperties,
      required: Object.keys(lightingProperties), additionalProperties: false,
    },
  },
  required: ['spacePrompt', 'negativePrompt', 'sceneProfileVersion', 'sceneAssetRole', 'sceneOccupancy', 'sceneLightingSpec'],
  additionalProperties: false,
};

const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonempty = (value) => typeof value === 'string' && value.trim().length > 0;
const stringList = (value) => Array.isArray(value) && value.every(nonempty);

export function inspectSceneReferencePlan(value, path = 'assetPlan', stage = 'authored') {
  if (!record(value)) return `${path} must be an object`;
  const kind = typeof value.role === 'string' ? value.role.split('://')[0] : '';
  const scene = kind === 'scene';
  if (kind !== 'character' && value.identityBoardSpec !== undefined) {
    return `${path}.identityBoardSpec belongs only to character assets`;
  }
  if (!scene) {
    if (value.sceneCard !== undefined) return `${path}.sceneCard belongs only to scene assets`;
    for (const key of ['prompt', 'negativePrompt']) {
      if (!nonempty(value[key])) return `${path}.${key} must be non-empty`;
    }
    return null;
  }
  const card = value.sceneCard;
  if (!record(card)) return `${path}.sceneCard must contain the scene-reference structural contract`;
  for (const key of Object.keys(card)) {
    if (!(Object.hasOwn(sceneReferenceCardSchema.properties, key))) return `${path}.sceneCard contains unexpected field ${key}`;
  }
  for (const [key, expected] of Object.entries({ sceneProfileVersion: 'scene-card/v1', sceneAssetRole: 'space_anchor', sceneOccupancy: 'none' })) {
    if (card[key] !== expected) return `${path}.sceneCard.${key} must equal ${expected}`;
  }
  for (const key of ['spacePrompt', 'negativePrompt']) {
    if (!nonempty(card[key])) return `${path}.sceneCard.${key} must be non-empty`;
  }
  if (stage === 'authored' && (value.prompt !== undefined || value.negativePrompt !== undefined)) {
    return `${path} scene authors submit only sceneCard.spacePrompt/negativePrompt, not the generic performance prompt fields`;
  }
  if (stage === 'projected' && (value.prompt !== card.spacePrompt || value.negativePrompt !== card.negativePrompt)) {
    return `${path} executable prompts must exactly equal the authored sceneCard fields`;
  }
  for (const key of ['identityAnchors', 'prohibitedDrift']) {
    if (!stringList(value[key]) || value[key].length === 0) return `${path}.${key} must be a non-empty string array`;
  }
  const light = card.sceneLightingSpec;
  /*
   * 只报"requires scene-lighting/v1"会让作者以为补一个 version 就够了：同一份计划
   * 反复补版本、必填键仍缺失，检查永远不过。这里把该对象自己声明的必填键集合一并给出，
   * 与 schema 同一事实来源。
   */
  if (!record(light) || light.version !== 'scene-lighting/v1') {
    return `${path}.sceneCard.sceneLightingSpec requires scene-lighting/v1; required keys ${JSON.stringify(Object.keys(lightingProperties))}`;
  }
  for (const key of Object.keys(light)) {
    if (!(Object.hasOwn(lightingProperties, key))) return `${path}.sceneCard.sceneLightingSpec contains unexpected field ${key}`;
  }
  for (const key of lightTextFields) {
    if (!nonempty(light[key])) return `${path}.sceneCard.sceneLightingSpec.${key} must be non-empty`;
  }
  for (const key of ['practicalSources', 'continuityLocks']) {
    if (!stringList(light[key])) return `${path}.sceneCard.sceneLightingSpec.${key} must be a string array`;
  }
  return null;
}

export function projectSceneReferenceMetadata(value, path = 'assetPlan') {
  const error = inspectSceneReferencePlan(value, path, 'projected');
  if (error) throw new Error(error);
  if (!value.sceneCard) throw new Error(`${path} must be a scene reference plan`);
  return {
    referenceType: 'scene',
    sceneProfileVersion: value.sceneCard.sceneProfileVersion,
    sceneAssetRole: value.sceneCard.sceneAssetRole,
    sceneOccupancy: value.sceneCard.sceneOccupancy,
    sceneLightingSpec: value.sceneCard.sceneLightingSpec,
    sceneAnchors: [...value.identityAnchors],
    prohibitedSceneDrift: [...value.prohibitedDrift],
  };
}

/** Cross-field structure for artifacts that declare a registry and authored plans.
 * Resolve exact identifiers only; never infer kinds from creative text or mutate drafts.
 */
export function inspectRegisteredAssetPlans(value) {
  if (!record(value) || !Array.isArray(value.objectRegistry) || !Array.isArray(value.assetPlans)) return null;
  const objects = new Map();
  for (const [index, item] of value.objectRegistry.entries()) {
    if (!record(item) || !nonempty(item.objectId)) return `objectRegistry[${index}].objectId must be non-empty`;
    if (objects.has(item.objectId)) return `objectRegistry[${index}].objectId duplicates ${item.objectId}`;
    if (!ASSET_OBJECT_KINDS.includes(item.kind)) return `objectRegistry[${index}].kind must use a canonical object kind`;
    objects.set(item.objectId, item);
  }
  const seen = new Set();
  for (const [index, plan] of value.assetPlans.entries()) {
    const path = `assetPlans[${index}]`;
    if (!record(plan)) return `${path} must be an object`;
    const object = objects.get(plan.objectId);
    if (!object) return `${path}.objectId must reference an exact objectRegistry object`;
    if (seen.has(plan.objectId)) return `${path}.objectId duplicates an existing asset plan`;
    seen.add(plan.objectId);
    const identity = object.kind === 'character' ? object.physicalIdentityKey : object.name;
    if (!nonempty(object.kind) || !nonempty(identity)) return `${path}.objectId references an object without its required canonical identity`;
    const error = inspectSceneReferencePlan({ ...plan, role: `${object.kind}://${identity}` }, path);
    if (error) return error;
  }
  return null;
}
