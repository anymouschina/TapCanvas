import { describe, expect, it } from 'vitest';
import { createWorkflowCollection } from '@tapcanvas/workflow-kernel-protocol';
import { compileWorkflowAssetPlanDrafts, buildVideoAssetPlanCollection, enrichVideoClipContextWithMaterializedAssets } from './execution.video-workflow-contract';
import { reusableWorkflowAssetRoleFacts } from './execution.node-executors';
import { createWorkflowProjectContext } from './execution.project-context';
import { projectNodeAssetsFromCanvases } from '../material/material.project-node-assets';
import { prepareChapterAssetCollection, bindMaterializedAssetConsumers } from './execution.chapter-asset-preparation';
import { projectChapterAssetSources } from './execution.chapter-asset-source';
import { inspectClipReferenceSelection } from './execution.clip-reference-selection';

const registry = [{ objectId: 'key', kind: 'prop', name: '钥匙', physicalIdentityKey: null }];
const contract = { kind: 'prop', name: '钥匙', referenceRole: 'prop', referenceAssetIds: [], referenceImageNodeIds: [],
  identityInvariant: '铜钥匙', startState: '手中', spatialRelation: '门旁', driver: '持有人', stateChange: '移动', endState: '锁前' };
const draft = { objectId: 'key', prompt: '钥匙细节图', negativePrompt: '无文字', identityAnchors: ['铜'], prohibitedDrift: ['材质不变'] };
const beatSheet = { text: JSON.stringify({ beats: [{ clipId: 'clip-0', clipIndex: 0, assetObjectContracts: [contract] }] }) };

describe('generation input and materialized output propagation', () => {
  it('carries v2 reference-guided generation through preparation, consumers and writer using only the newly materialized output', () => {
    const oldAssets = projectNodeAssetsFromCanvases([{ projectId: 'project', ownerType: 'project', ownerId: 'project',
      flowId: 'canvas', canvasRevision: 1, createdAt: '2026-09-20', updatedAt: '2026-09-20',
      data: { nodes: [{ id: 'old-key-node', data: { kind: 'image', imageUrl: 'https://assets.test/old-key.png' } }], edges: [] } }]);
    const projectContext = createWorkflowProjectContext({ projectId: 'project', canvasId: 'canvas', principalId: 'owner',
      canvasData: { nodes: [], edges: [] }, assets: oldAssets });
    const oldId = oldAssets[0]!.id;
    const referenceAssetBindings = [{ assetId: oldId, role: 'identity' }];
    const { objectId: _planObjectId, ...plan } = draft;
    const authored = { objectRegistry: [{ ...registry[0], referenceRole: 'prop', identityInvariant: '铜钥匙',
      imageSource: { mode: 'generate', referenceAssetBindings, plan } }], backgroundPlans: [] };
    const sources = projectChapterAssetSources(authored.objectRegistry);
    const prepared = prepareChapterAssetCollection({ assets: authored, projectContext, executionId: 'run', nodeId: 'prepare' });
    expect(prepared.items).toHaveLength(1);
    const preparedPlan = prepared.items[0]!.value as Record<string, unknown>;
    const generatedPlanId = preparedPlan.assetId as string;
    expect(preparedPlan).toMatchObject({ referenceAssetBindings, asset: { source: { mode: 'generate' } } });
    expect(preparedPlan).not.toHaveProperty('existingAssetId');
    expect(generatedPlanId).not.toBe(oldId);

    const state = { objectId: 'key', referenceAssetIds: [], referenceImageNodeIds: [],
      startState: '手中', spatialRelation: '门旁', driver: '持有人', stateChange: '移动', endState: '锁前' };
    expect(inspectClipReferenceSelection(state, sources.objectRegistry[0]!, 'state')).toBeNull();
    expect(inspectClipReferenceSelection({ ...state, referenceAssetIds: [oldId] }, sources.objectRegistry[0]!, 'state'))
      .toContain('outside this object');
    const { objectId: _registryObjectId, ...object } = sources.objectRegistry[0]!;
    const { objectId: _stateObjectId, ...stateFields } = state;
    const currentContract = { ...object, ...stateFields };
    const beat = { clipId: 'clip-0', clipIndex: 0, durationSeconds: 5, objectStates: [state], assetObjectContracts: [currentContract] };
    const frozenBeatSheet = { text: JSON.stringify({ beats: [beat] }) };
    const receipt = { assetPlan: preparedPlan, nodeId: 'new-key-node', generatedAssetId: 'new-key-asset', imageUrl: 'https://assets.test/new-key.png' };
    const materialized = createWorkflowCollection({ collectionId: 'new-images', producerNodeId: 'generate', producerPortId: 'image',
      itemIds: [generatedPlanId], values: [receipt] });
    const reuse = reusableWorkflowAssetRoleFacts({ 'asset-bindings': [materialized], 'beat-sheet': [frozenBeatSheet] }, projectContext, ['prop://钥匙']);
    const consumers = buildVideoAssetPlanCollection({ executionId: 'run', nodeId: 'consumers',
      beatSheetAgentResult: frozenBeatSheet, assetAgentResult: { text: '[]' }, reusableAssetFacts: reuse });
    const bound = bindMaterializedAssetConsumers(materialized, consumers);
    const contextBeforeJoin = { executionScope: 'media_delivery', clipIndex: 0, beat, assetObjectContracts: [currentContract] };
    const writer = enrichVideoClipContextWithMaterializedAssets({ contextItem: contextBeforeJoin, materializedAssetCollection: bound });
    expect(writer.authoringAssetBindings).toEqual([{ assetId: generatedPlanId, generatedAssetId: 'new-key-asset',
      nodeId: 'new-key-node', imageUrl: 'https://assets.test/new-key.png', role: 'prop://钥匙' }]);
    expect(writer.assetObjectContracts).toEqual([expect.objectContaining({
      assetId: generatedPlanId, referenceImageNodeIds: ['new-key-node'], referenceAssetIds: [],
    })]);
    const writerBeat = writer.beat as Record<string, unknown>;
    expect(writerBeat.objectStates).toEqual([state]);
    expect(JSON.stringify(writer.authoringAssetBindings)).not.toContain(oldId);
    expect(JSON.stringify(writer.assetObjectContracts)).not.toContain(oldId);
    expect(JSON.stringify(writerBeat)).not.toContain(oldId);
    expect((writer.assetPlans as Record<string, unknown>[])[0]?.referenceAssetBindings).toEqual(referenceAssetBindings);
    expect(JSON.stringify(contextBeforeJoin)).not.toContain('new-key-node');
  });

  it('retains exact ordered generation inputs through draft compilation and consumer-plan parsing', () => {
    const referenceAssetBindings = [{ assetId: 'source-front', role: 'identity', strength: 0.75 }, { assetId: 'source-style', role: 'style' }];
    const source = { ...draft, referenceAssetBindings };
    const before = JSON.stringify(source);
    const compiled = compileWorkflowAssetPlanDrafts([source], registry, ['clip-0'], []);
    expect(compiled[0]?.referenceAssetBindings).toEqual(referenceAssetBindings);
    expect(compiled[0]?.assetId).not.toBe('source-front');
    const collection = buildVideoAssetPlanCollection({ executionId: 'run', nodeId: 'split', beatSheetAgentResult: beatSheet,
      assetAgentResult: { text: JSON.stringify(compiled) } });
    expect(collection.items[0]?.value).toMatchObject({ assetId: compiled[0]!.assetId, referenceAssetBindings });
    expect(collection.items[0]?.value).not.toHaveProperty('existingAssetId');
    expect(JSON.stringify(source)).toBe(before);
    const changed = compileWorkflowAssetPlanDrafts([{ ...draft, referenceAssetBindings: [{ assetId: 'different', role: 'identity' }] }], registry, ['clip-0'], []);
    expect(changed[0]?.assetId).not.toBe(compiled[0]?.assetId);
  });

  it('preserves an explicitly empty generation input set and rejects malformed bindings at both projections', () => {
    const [compiled] = compileWorkflowAssetPlanDrafts([{ ...draft, referenceAssetBindings: [] }], registry, ['clip-0'], []);
    expect(compiled?.referenceAssetBindings).toEqual([]);
    const badInputs: unknown[] = [null, {}, [{ assetId: '', role: 'identity' }], [{ assetId: 'a', role: 'environment' }],
      [{ assetId: 'a', role: 'style', strength: 2 }], [{ assetId: 'a', role: 'style', invented: true }],
      [{ assetId: 'a', role: 'style' }, { assetId: 'a', role: 'identity' }]];
    for (const referenceAssetBindings of badInputs) {
      expect(() => compileWorkflowAssetPlanDrafts([{ ...draft, referenceAssetBindings }], registry, ['clip-0'], [])).toThrow('referenceAssetBindings');
      expect(() => buildVideoAssetPlanCollection({ executionId: 'run', nodeId: 'split', beatSheetAgentResult: beatSheet,
        assetAgentResult: { text: JSON.stringify([{ ...compiled, referenceAssetBindings }]) } })).toThrow('referenceAssetBindings');
    }
  });

  it('preserves actual materialization receipts for exact IDs without dropping another explicitly selected view', () => {
    const assets = projectNodeAssetsFromCanvases([{ projectId: 'project', ownerType: 'project', ownerId: 'project',
      flowId: 'canvas', canvasRevision: 1, createdAt: '2026-09-20', updatedAt: '2026-09-20',
      data: { nodes: ['a', 'b'].map(id => ({ id, data: { kind: 'image', imageUrl: `https://assets.test/${id}.png` } })), edges: [] } }]);
    const projectContext = createWorkflowProjectContext({ projectId: 'project', canvasId: 'canvas', principalId: 'owner',
      canvasData: { nodes: [], edges: [] }, assets });
    const first = assets[0]!.id;
    const second = assets[1]!.id;
    const materialized = createWorkflowCollection({ collectionId: 'receipts', producerNodeId: 'generate', producerPortId: 'image',
      itemIds: ['receipt-a'], values: [{ assetPlan: { assetId: first, role: 'prop://钥匙', existingAssetId: first, existingProjectId: 'project' },
        nodeId: 'current-projection-a', imageUrl: 'https://assets.test/a.png' }] });
    const reused = reusableWorkflowAssetRoleFacts({ 'asset-bindings': [materialized], 'beat-sheet': [{ text: JSON.stringify({ beats: [{
      assetObjectContracts: [{ ...contract, referenceAssetIds: [first, second] }],
    }] }) }] }, projectContext, ['prop://钥匙']);
    expect(reused['prop://钥匙']).toEqual([
      { planAssetId: first, existingAssetId: first, existingProjectId: 'project', existingNodeId: 'current-projection-a', existingImageUrl: 'https://assets.test/a.png' },
      { planAssetId: second, existingAssetId: second, existingProjectId: 'project', existingNodeId: 'b' },
    ]);
  });
});
