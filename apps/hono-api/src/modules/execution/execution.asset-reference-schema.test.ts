import { prepareChapterAssetCollection } from "./execution.chapter-asset-preparation";
import { expect, it } from 'vitest';
import { bindRegisteredAssetReferenceSchema } from './execution.asset-reference-schema';
import type { WorkflowProjectContext, WorkflowProjectAssetSnapshot } from './execution.project-context';
import { validateWorkflowToolArguments } from './execution.json-schema-validator';
const image = (assetId: string, flowId: string): WorkflowProjectAssetSnapshot => ({
  assetId, flowId, nodeId: `${assetId}-node`, projectId: 'p', assetVersion: 1, assetVersionId: 'v', contentFingerprint: 'hash',
  name: assetId, canonicalName: assetId, kind: 'scene', referenceType: 'scene', approvalStatus: null,
  origin: 'project_node', mediaKind: 'image', state: 'ready', assetUsage: 'production', assetPurpose: null,
  productionEligible: true, productionExclusionReason: null, styleFingerprint: null, updatedAt: '2026-09-20',
  sourceFacts: { referenceType: null, roleName: null, physicalIdentityKey: null, characterAssetRole: null,
    characterProfileVersion: null, identityAnchors: [], prohibitedDrift: [], sourceNodeId: null,
    workflowExecutionId: null, taskId: null, prompt: null },
});
const context: WorkflowProjectContext = { version: 3, projectId: 'p', canvasId: 'c', sourceNodeId: null,
  selectedAssetIds: [], projectAssetIds: ['a', 'b', 'unready'], timeline: { clips: [] },
  selection: { nodeIds: [], assetIds: [], activeNodeId: null, groupId: null },
  permissions: { principalId: 'u', projectRead: true, canvasRead: true, assetRead: true, assetWrite: true },
  assetSnapshot: [image('a','c'), image('b','other'), {...image('unready','c'),state:'unavailable'}], capturedAt: '2026-09-20' };
const schema = { type: 'object', properties: { objectRegistry: { type: 'array', items: { type: 'object', properties: {
  referenceAssetIds: {type:'array',items:{type:'string','x-referenceSource':'project_image'}}, referenceImageNodeIds:{type:'array',items:{type:'string','x-referenceSource':'canvas_image_node'}},
} } } } };
it('binds permitted images and current-canvas node handles before author dispatch', () => {
  const bound = bindRegisteredAssetReferenceSchema(schema, context);
  const check = (referenceAssetIds: string[], referenceImageNodeIds: string[]) => validateWorkflowToolArguments(bound,{objectRegistry:[{referenceAssetIds,referenceImageNodeIds}]});
  expect(check(['a','b'],['a-node'])).toEqual([]);
  expect(check(['hash'],[]).length).toBeGreaterThan(0);
  expect(check(['unready'],[]).length).toBeGreaterThan(0);
  expect(check([],['b-node']).length).toBeGreaterThan(0);
  expect(schema.properties.objectRegistry.items.properties.referenceAssetIds.items).toEqual({type:'string','x-referenceSource':'project_image'});
});
it('allows an empty selection without inventing a fallback reference', () => {
  const bound=bindRegisteredAssetReferenceSchema(schema,{...context,projectAssetIds:[]});
  expect(validateWorkflowToolArguments(bound,{objectRegistry:[{referenceAssetIds:[],referenceImageNodeIds:[]}]})).toEqual([]);
  expect(validateWorkflowToolArguments(bound,{objectRegistry:[{referenceAssetIds:['a'],referenceImageNodeIds:[]}]}).length).toBeGreaterThan(0);
});

it('preserves one existing image used by distinct declared objects without duplicate collection identities', () => {
  const objectRegistry = ['one','two'].map(name => ({ objectId:name, kind:'prop', referenceRole:'prop', name, referenceAssetIds:['a'], referenceImageNodeIds:[] }));
  const collection = prepareChapterAssetCollection({ assets:{objectRegistry,assetPlans:[],backgroundPlans:[]}, projectContext:context,executionId:'e',nodeId:'n' });
  expect(collection.items).toHaveLength(1);
  expect(new Set(collection.items.map(item=>item.itemId)).size).toBe(1);
  expect(collection.items.map(item=>item.value)).toEqual([expect.objectContaining({existingAssetId:'a'})]);
  expect(collection.items[0]!.value).toMatchObject({ bindings: [expect.objectContaining({objectId:'one',assetId:'a'}), expect.objectContaining({objectId:'two',assetId:'a'})] });
});


it('binds nested background references with the same frozen handles as object references', () => {
  const authored = { type: 'object', properties: { plans: { type: 'array', items: { type: 'object',
    properties: { references: { type: 'array', items: { type: 'object', properties: {
      assetId: { type: 'string', 'x-referenceSource': 'project_image' },
    } } } },
  } } } };
  const bound = bindRegisteredAssetReferenceSchema(authored, context);
  const check = (assetId: string) => validateWorkflowToolArguments(bound, {plans:[{references:[{assetId}]}]});
  expect(check('a')).toEqual([]);
  expect(check('b')).toEqual([]);
  expect(check('invented-reference')).toHaveLength(1);
  expect(check('unready')).toHaveLength(1);
  expect(JSON.stringify(bound)).not.toContain('x-referenceSource');
});
