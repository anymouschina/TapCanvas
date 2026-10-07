import { describe, expect, it } from 'vitest';
import { lookupWorkflowProjectImages } from './execution.project-asset-lookup';
import { createWorkflowProjectContext } from './execution.project-context';
import { projectNodeAssetsFromCanvases } from '../material/material.project-node-assets';

function fixture() {
  const assets = projectNodeAssetsFromCanvases([{ projectId: 'project', ownerType: 'project', ownerId: 'project',
    flowId: 'canvas', canvasRevision: 1, createdAt: '2026-09-20', updatedAt: '2026-09-20', data: {
      nodes: [
        { id: 'original', data: { kind: 'image', imageUrl: 'https://assets.test/front.png',
          label: 'Ａ', referenceType: 'character', physicalIdentityKey: 'body', assetReuseKey: 'identity', stateKey: 'front' } },
        { id: 'alias', data: { kind: 'image', imageUrl: 'https://assets.test/front.png',
          label: 'Ａ', referenceType: 'character', physicalIdentityKey: 'body', assetReuseKey: 'identity', stateKey: 'front' } },
        { id: 'side', data: { kind: 'image', imageUrl: 'https://assets.test/side.png',
          label: 'Ａ', referenceType: 'character', physicalIdentityKey: 'body', assetReuseKey: 'identity', stateKey: 'side' } },
        { id: 'different-body', data: { kind: 'image', imageUrl: 'https://assets.test/other.png',
          label: 'Ａ', referenceType: 'character', physicalIdentityKey: 'other-body' } },
        { id: 'untyped-state', data: { kind: 'image', imageUrl: 'https://assets.test/space.png',
          label: 'Space', referenceType: 'scene', assetPurpose: 'blocking_background' } },
        { id: 'unready', data: { kind: 'image', imageUrl: 'https://assets.test/unready.png',
          status: 'processing', label: 'Ａ', referenceType: 'character', physicalIdentityKey: 'body' } },
      ], edges: [] } }]);
  return createWorkflowProjectContext({ projectId: 'project', canvasId: 'canvas', principalId: 'owner',
    canvasData: { nodes: [], edges: [] }, assets, selectedAssetIds: [] });
}

describe('frozen project image lookup', () => {
  it('requires an explicit identity condition and non-empty declared fields', () => {
    const context = fixture();
    expect(() => lookupWorkflowProjectImages(context, { referenceType: 'character' })).toThrow('identity_required');
    expect(() => lookupWorkflowProjectImages(context, { referenceType: '', canonicalName: 'A' })).toThrow('identity_required');
    expect(() => lookupWorkflowProjectImages(context, { referenceType: 'character', canonicalName: 'A', stateKey: '' }))
      .toThrow('field_invalid:stateKey');
  });

  it('names retrieve all exact normalized-name candidates without merging physical identities', () => {
    const context = fixture();
    const before = JSON.stringify(context);
    const result = lookupWorkflowProjectImages(context, { referenceType: 'character', canonicalName: ' A ' });
    expect(result).toMatchObject({ status: 'candidates', basis: { identity: 'canonical_name_only', handleCount: 4,
      mediaCount: 3, suitability: 'not_evaluated' } });
    expect(result.candidates.flatMap(candidate => [candidate.assetId, ...candidate.aliases])).toHaveLength(4);
    expect(result.candidates.map(candidate => candidate.physicalIdentityKey)).toContain('other-body');
    const serialized = JSON.stringify(result);
    for (const forbidden of ['https://', 'sourceFacts', 'prompt', 'mediaIdentityKey', 'contentFingerprint', 'sourceIdentity']) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(JSON.stringify(context)).toBe(before);
    expect(lookupWorkflowProjectImages(context, { referenceType: 'character', canonicalName: 'A alias' }).status).toBe('no_match');
  });

  it('intersects all provided keys and only reports matched for one distinct media', () => {
    const context = fixture();
    const ambiguous = lookupWorkflowProjectImages(context, { referenceType: 'character', physicalIdentityKey: 'body' });
    expect(ambiguous).toMatchObject({ status: 'candidates', basis: { handleCount: 3, mediaCount: 2 } });
    const result = lookupWorkflowProjectImages(context, { referenceType: 'character', physicalIdentityKey: 'body',
      assetReuseKey: 'identity', canonicalName: 'A', stateKey: 'front' });
    expect(result).toMatchObject({ status: 'matched', basis: { fields: ['referenceType', 'physicalIdentityKey', 'canonicalName',
      'assetReuseKey', 'stateKey'], identity: 'exact_handle_or_key', handleCount: 2, mediaCount: 1 } });
    expect(result.candidates[0]?.aliases).toHaveLength(1);
    const id = result.candidates[0]!.assetId;
    expect(lookupWorkflowProjectImages(context, { referenceType: 'character', assetId: id })).toMatchObject({ status: 'matched' });
    expect(lookupWorkflowProjectImages(context, { referenceType: 'character', assetId: id, physicalIdentityKey: 'other-body' }).status)
      .toBe('no_match');
  });

  it('keeps missing visual state unknown and never substitutes resource readiness or a base state', () => {
    const context = fixture();
    expect(lookupWorkflowProjectImages(context, { referenceType: 'scene', canonicalName: 'Space', assetPurpose: 'blocking_background' }))
      .toMatchObject({ status: 'candidates', candidates: [{ stateKey: null }] });
    for (const stateKey of ['ready', 'base']) expect(lookupWorkflowProjectImages(context, {
      referenceType: 'scene', canonicalName: 'Space', stateKey }).status).toBe('no_match');
    expect(context.assetSnapshot.find(asset => asset.name === 'Space')?.sourceFacts.stateKey).toBeNull();
    expect(context.assetSnapshot.find(asset => asset.nodeId === 'original')?.sourceFacts.stateKey).toBe('front');
  });

  it('applies frozen visibility, project, media eligibility and exact type before matching', () => {
    const context = fixture();
    const match = { referenceType: 'character', physicalIdentityKey: 'body' };
    expect(lookupWorkflowProjectImages({ ...context, projectAssetIds: [] }, match).status).toBe('no_match');
    expect(lookupWorkflowProjectImages({ ...context, projectId: 'other-project' }, match).status).toBe('no_match');
    expect(lookupWorkflowProjectImages(context, { referenceType: 'scene', physicalIdentityKey: 'body' }).status).toBe('no_match');
    const unready = context.assetSnapshot.find(asset => asset.nodeId === 'unready')!;
    expect(lookupWorkflowProjectImages(context, { referenceType: 'character', assetId: unready.assetId }).status).toBe('no_match');
    expect(lookupWorkflowProjectImages({ ...context,
      assetSnapshot: context.assetSnapshot.map(asset => ({ ...asset, productionEligible: false })) }, match).status).toBe('no_match');
  });
});
