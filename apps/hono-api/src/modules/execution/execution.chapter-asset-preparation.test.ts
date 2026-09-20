import { describe, expect, it } from 'vitest';
import { createWorkflowCollection } from '@tapcanvas/workflow-kernel-protocol';
import { prepareChapterAssetCollection, bindMaterializedAssetConsumers } from './execution.chapter-asset-preparation';
import { stagedAuthoringFixture } from './test-fixtures/video-authoring-stages';
import type { WorkflowProjectContext } from './execution.project-context';

const context: WorkflowProjectContext = {
  version: 3, projectId: 'project', canvasId: 'canvas', sourceNodeId: 'source',
  selectedAssetIds: [], projectAssetIds: [], timeline: { clips: [] },
  selection: { nodeIds: [], assetIds: [], activeNodeId: null, groupId: null },
  permissions: { principalId: 'user', projectRead: true, canvasRead: true, assetRead: true, assetWrite: true },
  assetSnapshot: [], capturedAt: '2026-09-20T00:00:00Z',
};
function collection(values: readonly Record<string, unknown>[]) {
  return createWorkflowCollection({ collectionId: 'items', producerNodeId: 'producer', producerPortId: 'items',
    itemIds: values.map((_, index) => String(index)), values });
}
describe('independent chapter assets', () => {
  it('compiles explicit image plans without a BeatSheet or invented clip consumers', () => {
    const { shared } = stagedAuthoringFixture();
    const assets = { ...shared, objectRegistry: [{ ...shared.objectRegistry[0], objectId: 'key', kind: 'prop', name: '钥匙' }],
      assetPlans: [{ objectId: 'key', prompt: '铜钥匙', negativePrompt: '无文字', identityAnchors: ['铜'], prohibitedDrift: ['材质不变'] }] };
    const result = prepareChapterAssetCollection({ assets, projectContext: context, executionId: 'execution', nodeId: 'prepare' });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.value).toMatchObject({ assetId: expect.stringMatching(/^planned-image:[a-f0-9]{64}$/), prompt: '铜钥匙', consumerClipIds: [] });
  });
  it('retains generated media while binding only exact consumer identities', () => {
    const bindings = collection([
      { nodeId: 'image-1', imageUrl: 'https://assets.example.test/image-1', assetPlan: { assetId: 'a', role: 'prop://钥匙', consumerClipIds: [] } },
      { nodeId: 'image-2', imageUrl: 'https://assets.example.test/image-2', assetPlan: { assetId: 'b', role: 'prop://门', consumerClipIds: [] } },
    ]);
    const source = JSON.stringify(bindings);
    const bound = bindMaterializedAssetConsumers(bindings, collection([{ assetId: 'a', role: 'prop://钥匙', consumerClipIds: ['clip-2'] }]));
    expect(bound.items[0]!.value).toMatchObject({ nodeId: 'image-1', assetPlan: { consumerClipIds: ['clip-2'] } });
    expect(bound.items[1]!.value).toEqual(bindings.items[1]!.value);
    expect(JSON.stringify(bindings)).toBe(source);
  });
  it('exposes missing media or changed identities instead of binding a different image', () => {
    const bindings = collection([{ assetPlan: { assetId: 'a', role: 'prop://钥匙', consumerClipIds: [] } }]);
    expect(() => bindMaterializedAssetConsumers(bindings, collection([{ assetId: 'b', role: 'prop://门' }]))).toThrow('Missing materialized asset b');
    expect(() => bindMaterializedAssetConsumers(bindings, collection([{ assetId: 'a', role: 'prop://门' }]))).toThrow('Missing materialized asset a for prop://门');
  });
});
