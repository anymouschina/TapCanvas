/** Physical assets, semantic objects and their uses are separate identities. */
export const ASSET_MEDIA_TYPES = Object.freeze(['image', 'video', 'audio']);
export const ASSET_OBJECT_KINDS = Object.freeze(['character', 'scene', 'prop', 'vfx', 'palette', 'composition']);
export const ASSET_REFERENCE_ROLES = Object.freeze(['none', 'identity', 'wardrobe', 'prop', 'environment', 'palette', 'composition', 'vfx']);
export const IMAGE_REFERENCE_ROLES = Object.freeze(['layout', 'style', 'identity', 'content']);
export const ASSET_SOURCE_MODES = Object.freeze(['existing', 'generate']);
const text = { type: 'string', minLength: 1 };
const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const strings = { type: 'array', items: text, uniqueItems: true };
export const workflowAssetRegistrySchema = object({
  protocolVersion: { type: 'string', const: 'workflow.asset-registry/v1' },
  assets: { type: 'array', items: object({
    assetId: text, mediaType: { type: 'string', enum: ASSET_MEDIA_TYPES },
    source: { oneOf: [
      object({ mode: {const:'existing'}, sourceAssetId: text, sourceVersionId: text }),
      object({ mode: {const:'generate'}, generationSpecId: text, generationSpecVersion: text }),
    ] },
  }) },
  bindings: { type:'array', items:object({
    bindingId:text, objectId:text, assetId:text,
    referenceRole:{type:'string',enum:ASSET_REFERENCE_ROLES}, consumerClipIds:strings,
  }) },
});

function record(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function string(value) { return typeof value === 'string' && value.trim().length > 0; }
function exact(value, fields, path) {
  if (!record(value) || Object.keys(value).some(key => !fields.includes(key)) || fields.some(key => !(key in value))) {
    throw new Error(`${path} has missing or unknown fields`);
  }
}
export function validateAssetRecord(asset) {
  exact(asset, ['assetId', 'mediaType', 'source'], 'asset');
  if (!string(asset.assetId) || !ASSET_MEDIA_TYPES.includes(asset.mediaType)) throw new Error('Invalid asset identity or mediaType');
  if (!record(asset.source) || !ASSET_SOURCE_MODES.includes(asset.source.mode)) throw new Error('Invalid asset source.mode');
  const fields = asset.source.mode === 'existing' ? ['mode','sourceAssetId','sourceVersionId'] : ['mode','generationSpecId','generationSpecVersion'];
  exact(asset.source, fields, `asset ${asset.assetId}.source`);
  if (fields.some(field => !string(asset.source[field]))) throw new Error(`Asset ${asset.assetId} requires immutable source identity and version`);
  return asset;
}
export function validateAssetBinding(binding) {
  exact(binding, ['bindingId','objectId','assetId','referenceRole','consumerClipIds'], 'binding');
  if (!['bindingId','objectId','assetId'].every(field => string(binding[field])) || !ASSET_REFERENCE_ROLES.includes(binding.referenceRole)) {
    throw new Error('Invalid binding identity or referenceRole');
  }
  if (!Array.isArray(binding.consumerClipIds) || binding.consumerClipIds.some(id => !string(id))
    || new Set(binding.consumerClipIds).size !== binding.consumerClipIds.length) throw new Error('consumerClipIds must be unique non-empty IDs');
  return binding;
}

/** Merge only identical frozen facts. Replay adds usages, never new media work. */
export function assembleWorkflowAssetRegistry(assets, bindings) {
  const byAsset = new Map();
  const bySource = new Map();
  for (const input of assets) {
    const asset = validateAssetRecord(input);
    const prior = byAsset.get(asset.assetId);
    const sourceKey = asset.source.mode === 'existing'
      ? JSON.stringify([asset.mediaType, asset.source.mode, asset.source.sourceAssetId, asset.source.sourceVersionId])
      : JSON.stringify([asset.mediaType, asset.source.mode, asset.source.generationSpecId, asset.source.generationSpecVersion]);
    const priorSource = bySource.get(sourceKey);
    if (priorSource && priorSource !== asset.assetId) throw new Error(`Source version has multiple asset identities: ${priorSource}, ${asset.assetId}`);
    if (prior && (prior.mediaType !== asset.mediaType || prior.source.mode !== asset.source.mode
      || (asset.source.mode === 'existing'
        ? prior.source.sourceAssetId !== asset.source.sourceAssetId || prior.source.sourceVersionId !== asset.source.sourceVersionId
        : prior.source.generationSpecId !== asset.source.generationSpecId || prior.source.generationSpecVersion !== asset.source.generationSpecVersion))) {
      throw new Error(`Asset ${asset.assetId} has conflicting immutable source facts`);
    }
    bySource.set(sourceKey, asset.assetId);
    if (!prior) byAsset.set(asset.assetId, structuredClone(asset));
  }
  const byBinding = new Map();
  const byUsage = new Map();
  for (const input of bindings) {
    const binding = validateAssetBinding(input);
    if (!byAsset.has(binding.assetId)) throw new Error(`Binding ${binding.bindingId} references unknown asset ${binding.assetId}`);
    const usage = JSON.stringify([binding.objectId, binding.assetId, binding.referenceRole]);
    const priorUsage = byUsage.get(usage);
    if (priorUsage && priorUsage !== binding.bindingId) throw new Error('Same usage has multiple binding identities');
    byUsage.set(usage, binding.bindingId);
    const prior = byBinding.get(binding.bindingId);
    if (prior && (prior.objectId !== binding.objectId || prior.assetId !== binding.assetId || prior.referenceRole !== binding.referenceRole)) {
      throw new Error(`Binding ${binding.bindingId} has conflicting immutable usage facts`);
    }
    byBinding.set(binding.bindingId, prior
      ? {...prior, consumerClipIds: [...new Set([...prior.consumerClipIds, ...binding.consumerClipIds])]}
      : structuredClone(binding));
  }
  return { protocolVersion:'workflow.asset-registry/v1', assets:[...byAsset.values()], bindings:[...byBinding.values()] };
}

/** One materialization item per asset, regardless of object/clip/reference count. */
export function materializationItems(registry) {
  if (registry.protocolVersion !== 'workflow.asset-registry/v1') throw new Error('Unsupported asset registry protocol');
  const validated = assembleWorkflowAssetRegistry(registry.assets, registry.bindings);
  const bindings = new Map();
  for (const binding of validated.bindings) bindings.set(binding.assetId, [...(bindings.get(binding.assetId) ?? []), binding]);
  return validated.assets.map(asset => ({ itemId: asset.assetId, asset, bindings: bindings.get(asset.assetId) ?? [] }));
}
