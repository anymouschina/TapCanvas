import { describe, expect, it } from 'vitest';
import { chapterAssetPlanSchema, VIDEO_AUTHORING_STAGE_ARTIFACTS } from '../../../../../packages/schemas/video-authoring-stages/schema.mjs';
import { projectChapterAssetSources } from './execution.chapter-asset-source';
import { validateWorkflowToolArguments } from './execution.json-schema-validator';
import { bindRegisteredAssetReferenceSchema } from './execution.asset-reference-schema';
import { createWorkflowProjectContext } from './execution.project-context';
import { projectNodeAssetsFromCanvases } from '../material/material.project-node-assets';
import { chapterAssetImageSourceSchema } from '../../../../../packages/schemas/video-authoring-stages/schema.mjs';

const object = { objectId: 'key', kind: 'prop', name: '钥匙', physicalIdentityKey: null,
  referenceRole: 'prop', identityInvariant: '铜钥匙' };
const plan = { prompt: '同一铜钥匙的新参考视角', negativePrompt: '无文字', identityAnchors: ['铜'], prohibitedDrift: ['材料不变'] };

describe('explicit chapter asset sources', () => {
  it('projects direct reuse into output references without inventing a generation', () => {
    const result = projectChapterAssetSources([{ ...object, imageSource: { mode: 'reuse', assetIds: ['front', 'side'] } }]);
    expect(result).toEqual({ objectRegistry: [{ ...object, referenceAssetIds: ['front', 'side'], referenceImageNodeIds: [] }], assetPlans: [] });
  });

  it('retains generation input references only on its generated plan, leaving clip output references unbound', () => {
    const source = [{ ...object, imageSource: { mode: 'generate',
      referenceAssetBindings: [{ assetId: 'old-key', role: 'identity' }], plan } }];
    const before = JSON.stringify(source);
    expect(projectChapterAssetSources(source)).toEqual({
      objectRegistry: [{ ...object, referenceAssetIds: [], referenceImageNodeIds: [] }],
      assetPlans: [{ ...plan, objectId: 'key', referenceAssetBindings: [{ assetId: 'old-key', role: 'identity' }] }],
    });
    expect(JSON.stringify(source)).toBe(before);
  });

  it('supports generation without existing images while retaining a real asset production plan', () => {
    const result = projectChapterAssetSources([
      { ...object, objectId: 'second-key', imageSource: { mode: 'generate', referenceAssetBindings: [], plan } },
    ]);
    expect(result.objectRegistry.map(item => item.referenceAssetIds)).toEqual([[]]);
    expect(result.assetPlans).toEqual([{ ...plan, objectId: 'second-key', referenceAssetBindings: [] }]);
  });

  it('rejects none sources and none reference roles for every registered visual subject', () => {
    expect(validateWorkflowToolArguments(chapterAssetImageSourceSchema, { mode: 'none' }).length).toBeGreaterThan(0);
    for (const referenceRole of ['none', 'prop']) {
      expect(() => projectChapterAssetSources([{ ...object, referenceRole, imageSource: { mode: 'none' } }])).toThrow('violate schema');
    }
    for (const imageSource of [{ mode: 'reuse', assetIds: ['a'] }, { mode: 'generate', referenceAssetBindings: [], plan }]) {
      expect(() => projectChapterAssetSources([{ ...object, referenceRole: 'none', imageSource }])).toThrow('violate schema');
    }
  });

  it('keeps a subject shared across clips as one registry identity and one generation plan', () => {
    const source = { ...object, imageSource: { mode: 'generate', referenceAssetBindings: [], plan } };
    const result = projectChapterAssetSources([source]);
    expect(result.objectRegistry.map(item => item.objectId)).toEqual(['key']);
    expect(result.assetPlans.map(item => item.objectId)).toEqual(['key']);
    expect(() => projectChapterAssetSources([source, source])).toThrow('Duplicate chapter asset objectId key');
  });

  it('rejects old reference arrays, mixed modes, mismatched roles, and separately authored plan object IDs', () => {
    for (const imageSource of [{ mode: 'reuse', assetIds: [] }, { mode: 'reuse', assetIds: ['a'], plan },
      { mode: 'generate', referenceAssetBindings: [], plan: { ...plan, objectId: 'other' } }]) {
      expect(() => projectChapterAssetSources([{ ...object, imageSource }])).toThrow('violate schema');
    }
    expect(() => projectChapterAssetSources([{ ...object, referenceAssetIds: ['old'], referenceImageNodeIds: [], imageSource: { mode: 'none' } }])).toThrow('violate schema');
    expect(() => projectChapterAssetSources([{ ...object, imageSource: { mode: 'none' } }])).toThrow('violate schema');
    expect(() => projectChapterAssetSources([{ ...object, referenceRole: 'none', imageSource: { mode: 'reuse', assetIds: ['a'] } }])).toThrow('violate schema');
  });

  it('publishes only the v3 author contract and rejects the removed root assetPlans', () => {
    expect(VIDEO_AUTHORING_STAGE_ARTIFACTS.assets).toBe('tapcanvas.chapter-asset-plan/v3');
    const issues = validateWorkflowToolArguments(chapterAssetPlanSchema, {
      objectRegistry: [{ ...object, imageSource: { mode: 'reuse', assetIds: ['a'] } }],
      assetPlans: [], backgroundPlans: [],
    });
    expect(issues.some(issue => issue.path.includes('assetPlans'))).toBe(true);
  });

  it('binds both reuse and generation input handles to the exact same frozen ready-image permission set', () => {
    const assets = projectNodeAssetsFromCanvases([{ projectId: 'project', ownerType: 'project', ownerId: 'project',
      flowId: 'canvas', canvasRevision: 1, createdAt: '2026-09-20', updatedAt: '2026-09-20',
      data: { nodes: [{ id: 'old-key', data: { kind: 'image', imageUrl: 'https://assets.test/key.png' } }], edges: [] } }]);
    const context = createWorkflowProjectContext({ projectId: 'project', canvasId: 'canvas', principalId: 'owner',
      canvasData: { nodes: [], edges: [] }, assets });
    const schema = bindRegisteredAssetReferenceSchema(chapterAssetImageSourceSchema, context);
    const assetId = assets[0]!.id;
    expect(validateWorkflowToolArguments(schema, { mode: 'reuse', assetIds: [assetId] })).toEqual([]);
    expect(validateWorkflowToolArguments(schema, { mode: 'generate', referenceAssetBindings: [{ assetId, role: 'identity' }], plan })).toEqual([]);
    expect(validateWorkflowToolArguments(schema, { mode: 'reuse', assetIds: ['invented'] }).length).toBeGreaterThan(0);
    expect(validateWorkflowToolArguments(schema, { mode: 'generate', referenceAssetBindings: [{ assetId: 'invented', role: 'identity' }], plan }).length).toBeGreaterThan(0);
    const empty = bindRegisteredAssetReferenceSchema(chapterAssetImageSourceSchema, { ...context, projectAssetIds: [] });
    expect(validateWorkflowToolArguments(empty, { mode: 'generate', referenceAssetBindings: [], plan })).toEqual([]);
    expect(validateWorkflowToolArguments(empty, { mode: 'reuse', assetIds: [assetId] }).length).toBeGreaterThan(0);
  });
});
