import { ASSET_REFERENCE_ROLES, validateAssetRecord, validateAssetBinding, assembleWorkflowAssetRegistry, type AssetRecord, type AssetBinding } from '../../../../../packages/schemas/workflow-asset-registry/index.mjs';
import { assetBindingIdentity, assetFactIdentity } from './execution.asset-identity';
import { createWorkflowCollection, isWorkflowCollection } from '@tapcanvas/workflow-kernel-protocol';
import { compileWorkflowAssetPlanDrafts } from './execution.video-workflow-contract';
import { resolveWorkflowProjectImageReferences } from './execution.project-image-references';
import type { WorkflowProjectContext } from './execution.project-context';
import type { ChapterAssetPlan } from './execution.video-authoring-stages';

type Facts = Readonly<Record<string, unknown>>;
function record(value: unknown): value is Facts {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function role(object: Facts): string {
  const kind = object.kind;
  const identity = kind === 'character' ? object.physicalIdentityKey : object.name;
  if (typeof kind !== 'string' || typeof identity !== 'string' || !identity.trim()) {
    throw new Error(`Asset object ${String(object.objectId)} requires a canonical identity`);
  }
  return `${kind}://${identity}`;
}

/** Materialize the author's explicit asset plans independently of clip consumers. */
export function prepareChapterAssetCollection(input: Readonly<{
  assets: ChapterAssetPlan;
  projectContext: WorkflowProjectContext;
  executionId: string;
  nodeId: string;
}>) {
  const drafts = compileWorkflowAssetPlanDrafts(input.assets.assetPlans, input.assets.objectRegistry, [], []);
  const objects = new Map(input.assets.objectRegistry.map(object => [object.objectId, object]));
  const reuse = new Map<string, readonly Facts[]>();
  for (const object of objects.values()) {
    const objectRole = role(object);
    const ids = resolveWorkflowProjectImageReferences(object, input.projectContext);
    if (!ids.length) continue;
    reuse.set(String(object.objectId), ids.map(assetId => {
      const asset = input.projectContext.assetSnapshot.find(item => item.assetId === assetId);
      if (!asset) throw new Error(`Frozen asset ${assetId} disappeared during projection`);
      return { assetId, objectId: object.objectId, role: objectRole, displayName: object.name, consumerClipIds: [],
        existingAssetId: assetId, existingProjectId: input.projectContext.projectId,
        ...(asset.nodeId ? { existingNodeId: asset.nodeId } : {}) };
    }));
  }
  const plans: Facts[] = [
    ...drafts.filter(plan => !reuse.has(plan.objectId)).map(plan => ({
      ...plan, displayName: objects.get(plan.objectId)?.name,
    })),
    ...Array.from(reuse.values()).flat(),
  ];
  const records: AssetRecord[] = [];
  const bindings: AssetBinding[] = [];
  const plansByAsset = new Map<string, Facts[]>();
  for (const plan of plans) {
    if (typeof plan.assetId !== 'string' || typeof plan.role !== 'string') throw new Error('Asset preparation requires stable identities');
    const object = objects.get(plan.objectId);
    if (!object || typeof object.objectId !== 'string') throw new Error(`Asset ${plan.assetId} has no registered object`);
    const referenceRole = object.referenceRole;
    if (typeof referenceRole !== 'string' || !ASSET_REFERENCE_ROLES.includes(referenceRole as AssetBinding['referenceRole'])) {
      throw new Error(`Object ${object.objectId} has an invalid referenceRole`);
    }
    const existing = typeof plan.existingAssetId === 'string'
      ? input.projectContext.assetSnapshot.find(asset => asset.assetId === plan.existingAssetId) : undefined;
    if (existing && !existing.assetVersionId) throw new Error(`Existing asset ${existing.assetId} has no frozen version`);
    const { consumerClipIds: _consumers, displayName: _label, ...specification } = plan;
    const version = assetFactIdentity('generation-spec', specification);
    records.push({ assetId: plan.assetId, mediaType: 'image', source: existing
      ? { mode: 'existing', sourceAssetId: existing.assetId, sourceVersionId: existing.assetVersionId }
      : { mode: 'generate', generationSpecId: plan.assetId, generationSpecVersion: version } });
    bindings.push({ bindingId: assetBindingIdentity(plan.assetId, object.objectId), objectId: object.objectId,
      assetId: plan.assetId, referenceRole: referenceRole as AssetBinding['referenceRole'], consumerClipIds: [] });
    plansByAsset.set(plan.assetId, [...(plansByAsset.get(plan.assetId) ?? []), plan]);
  }
  const registry = assembleWorkflowAssetRegistry(records, bindings);
  const values = registry.assets.map(asset => {
    const uses = plansByAsset.get(asset.assetId)!;
    // Only the immutable media specification drives generation. All object uses
    // travel alongside it, never as extra materialization queue entries.
    return { ...uses[0], asset, bindings: registry.bindings.filter(binding => binding.assetId === asset.assetId),
      objectPlans: uses };
  });
  return createWorkflowCollection({ collectionId: `${input.executionId}:${input.nodeId}:asset-plans`,
    producerNodeId: input.nodeId, producerPortId: 'asset-items', itemIds: registry.assets.map(asset => asset.assetId), values });
}

/** Read all declared object uses of one physical materialization receipt. */
export function materializedAssetUses(value: unknown): Facts[] {
  if (!record(value)) throw new Error('Materialized asset requires a plan');
  if (value.asset === undefined) return [value];
  if (!record(value.asset) || !Array.isArray(value.bindings) || !Array.isArray(value.objectPlans)
    || value.objectPlans.some(plan => !record(plan) || plan.assetId !== value.assetId)) {
    throw new Error('Physical asset requires its complete object binding projection');
  }
  const asset = validateAssetRecord(value.asset);
  const bindings = value.bindings.map(validateAssetBinding);
  assembleWorkflowAssetRegistry([asset], bindings);
  const uses = value.objectPlans as Facts[];
  if (asset.assetId !== value.assetId || uses.length !== bindings.length || uses.some(use =>
    !bindings.some(binding => binding.objectId === use.objectId && binding.assetId === use.assetId))) {
    throw new Error('Physical asset object projection differs from its registered bindings');
  }
  return uses;
}

/** Join exact consumer identities after design; never submit or discard media. */
export function bindMaterializedAssetConsumers(bindings: unknown, consumers: unknown) {
  if (!isWorkflowCollection(bindings) || !isWorkflowCollection(consumers)) {
    throw new Error('Asset consumer binding requires two workflow collections');
  }
  const plans = new Map(consumers.items.map(item => {
    if (!record(item.value) || typeof item.value.assetId !== 'string' || typeof item.value.role !== 'string') {
      throw new Error('Consumer plan requires assetId and object role');
    }
    return [assetBindingIdentity(item.value.assetId, item.value.role), item.value] as const;
  }));
  if (plans.size !== consumers.items.length) throw new Error('Duplicate consumer binding identities');
  const matched = new Set<string>();
  const items = bindings.items.flatMap(item => {
    if (!record(item.value) || !record(item.value.assetPlan)) throw new Error('Materialized binding requires its original asset plan');
    const receipt = item.value;
    return materializedAssetUses(receipt.assetPlan).map(use => {
      if (typeof use.assetId !== 'string' || typeof use.role !== 'string') throw new Error('Materialized use requires assetId and role');
      const id = assetBindingIdentity(use.assetId, use.role);
      const plan = plans.get(id);
      if (plan) matched.add(id);
      const originalPlan = receipt.assetPlan as Facts;
      const registeredBindings = Array.isArray(originalPlan.bindings) ? originalPlan.bindings.map(validateAssetBinding) : [];
      const binding = registeredBindings.find(candidate => candidate.objectId === use.objectId && candidate.assetId === use.assetId);
      return { ...item, itemId: id, value: { ...receipt,
        ...(originalPlan.asset ? { asset: originalPlan.asset } : {}),
        ...(binding ? { binding: { ...binding, consumerClipIds: plan ? plan.consumerClipIds : binding.consumerClipIds } } : {}),
        assetPlan: { ...use,
        consumerClipIds: plan ? plan.consumerClipIds : use.consumerClipIds } } };
    });
  });
  for (const [id, plan] of plans) if (!matched.has(id)) throw new Error(`Missing materialized asset ${String(plan.assetId)} for ${String(plan.role)}`);
  return { ...bindings, items: items.map((item, index) => ({ ...item, index })) };
}
