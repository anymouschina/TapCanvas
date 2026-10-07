import { describe, it, expect, vi } from 'vitest';
import { buildWorkflowImageClaim, buildWorkflowImagePreUpstreamRejection, buildWorkflowImageTaskId } from './workflow-image-effect-claim';
import { workflowImageEffectIdentity, inspectPersistedWorkflowImageNode } from '../execution/execution.image-runner';
describe('durable image effect claim', () => {
  it('rejects the second CAS writer before paid submission and preserves the first claim', async () => {
    const current = { nodes: [] as Record<string, unknown>[] };
    const submit = vi.fn();
    const workflowTaskId = buildWorkflowImageTaskId({ ownerId: 'user-1', effectId: 'effect' });
    const attempt = async () => {
      const patch = buildWorkflowImageClaim({ current, node: { data: { prompt: 'image', workflowTaskId } }, nodeId:'asset', effectId:'effect', claimedAt:'now' });
      if (!('createNodes' in patch)) throw new Error('Expected a new claim');
      current.nodes.push(...patch.createNodes!);
      await submit();
    };
    const result = await Promise.allSettled([attempt(), attempt()]);
    expect(result.map(item => item.status)).toEqual(['fulfilled','rejected']);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(current.nodes).toHaveLength(1);
    expect(current.nodes[0]?.data).toMatchObject({ workflowTaskId, workflowSubmissionState: 'submitting' });
    expect(() => buildWorkflowImageClaim({ current, node:{data:{workflowTaskId}},nodeId:'asset',effectId:'effect',claimedAt:'later' })).toThrow('already claimed');
  });

  it('claims an exact idle prepared node once and rejects changed image settings', () => {
    const workflowTaskId = buildWorkflowImageTaskId({ ownerId: 'user-1', effectId: 'effect' });
    const data = { kind: 'image', prompt: 'frozen', negativePrompt: 'none', modelKey: 'image-model',
      aspect: '16:9', imageSize: '2K', imageQuality: '', referenceAssetBindings: [],
      workflowEffectId: 'effect', workflowTaskId, workflowExecutionFamilyId: 'family' };
    const current: { nodes: Array<{ id: string; data: Record<string, unknown> }> } = {
      nodes: [{ id: 'asset', data: { ...data, status: 'idle', workflowPreparedOnly: true } }],
    };
    const patch = buildWorkflowImageClaim({ current, node: { data }, nodeId: 'asset', effectId: 'effect', claimedAt: 'now' });
    expect(patch).toMatchObject({ allowOverwrite: true, patchNodeData: [{ id: 'asset', data: {
      status: 'submitting', workflowPreparedOnly: false, workflowSubmissionState: 'submitting',
    } }] });
    expect(() => buildWorkflowImageClaim({ current, node: { data: { ...data, modelKey: 'other' } },
      nodeId: 'asset', effectId: 'effect', claimedAt: 'now' })).toThrow('generation contract changed');
    current.nodes[0]!.data = { ...current.nodes[0]!.data, taskId: 'accepted' };
    expect(() => buildWorkflowImageClaim({ current, node: { data }, nodeId: 'asset', effectId: 'effect', claimedAt: 'now' })).toThrow('already claimed');
  });

  it('derives image edit kind from reference bindings when claiming a prepared image', () => {
    const workflowTaskId = buildWorkflowImageTaskId({ ownerId: 'user-1', effectId: 'effect' });
    const referenceAssetBindings = [{ assetId: 'reference-one', role: 'layout' }];
    const frozen = { prompt: 'frozen', negativePrompt: 'none', modelKey: 'image-model',
      aspect: '16:9', imageSize: '1K', imageQuality: '', referenceAssetBindings,
      workflowEffectId: 'effect', workflowTaskId, workflowExecutionFamilyId: 'family' };
    const current = { nodes: [{ id: 'asset', data: { ...frozen, kind: 'image', status: 'idle', workflowPreparedOnly: true } }] };
    const patch = buildWorkflowImageClaim({ current, node: { data: { ...frozen, kind: 'imageEdit' } },
      nodeId: 'asset', effectId: 'effect', claimedAt: 'now' });
    expect(patch).toMatchObject({ patchNodeData: [{ id: 'asset', data: {
      kind: 'imageEdit', status: 'submitting', workflowPreparedOnly: false,
    } }] });
    expect(() => buildWorkflowImageClaim({ current, node: { data: { ...frozen, kind: 'video' } },
      nodeId: 'asset', effectId: 'effect', claimedAt: 'now' })).toThrow('generation contract changed');
  });

  it('shares one prepared node and paid claim across concurrent Clip consumers', async () => {
    const firstIdentity = workflowImageEffectIdentity({ executionFamilyId: 'family',
      runtimeNodeId: 'clip-media::item::clip-0::image',
      assetIdentity: { assetId: 'shared-effect', generationSpecVersion: 'v1' } });
    const secondIdentity = workflowImageEffectIdentity({ executionFamilyId: 'family',
      runtimeNodeId: 'clip-media::item::clip-1::image',
      assetIdentity: { assetId: 'shared-effect', generationSpecVersion: 'v1' } });
    expect(secondIdentity).toEqual(firstIdentity);
    const workflowTaskId = buildWorkflowImageTaskId({ ownerId: 'owner', effectId: firstIdentity.effectId });
    const frozen = { kind: 'image', prompt: 'shared image', negativePrompt: 'none', modelKey: 'image-model',
      aspect: '16:9', imageSize: '2K', imageQuality: '', referenceAssetBindings: [],
      workflowEffectId: firstIdentity.effectId, workflowTaskId, workflowExecutionFamilyId: 'family' };
    const graph: { nodes: Array<{ id: string; data: Record<string, unknown> }> } = { nodes: [{ id: firstIdentity.canvasNodeId, data: {
      ...frozen, status: 'idle', workflowPreparedOnly: true,
    } }] };
    const paidSubmit = vi.fn();
    const consume = async (clipId: string) => {
      try {
        const patch = buildWorkflowImageClaim({ current: graph, node: { data: frozen },
          nodeId: firstIdentity.canvasNodeId, effectId: firstIdentity.effectId, claimedAt: clipId });
        if (!('patchNodeData' in patch)) throw new Error('Expected prepared-node claim');
        graph.nodes[0]!.data = patch.patchNodeData![0]!.data;
        await paidSubmit();
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes('already claimed')) throw error;
        return inspectPersistedWorkflowImageNode(JSON.stringify(graph), firstIdentity.canvasNodeId, null);
      }
      return inspectPersistedWorkflowImageNode(JSON.stringify(graph), firstIdentity.canvasNodeId, null);
    };
    const results = await Promise.all([consume('clip-0'), consume('clip-1')]);
    expect(paidSubmit).toHaveBeenCalledTimes(1);
    expect(results.map((result) => result.status)).toEqual(['waiting_external', 'waiting_external']);
    expect(results.map((result) => result.nodeId)).toEqual([firstIdentity.canvasNodeId, firstIdentity.canvasNodeId]);
  });

  it('derives a stable owner-scoped identity and records only an exact pre-upstream rejection', () => {
    const workflowTaskId = buildWorkflowImageTaskId({ ownerId: 'user-1', effectId: 'effect' });
    expect(workflowTaskId).toBe(buildWorkflowImageTaskId({ ownerId: 'user-1', effectId: 'effect' }));
    expect(workflowTaskId).not.toBe(buildWorkflowImageTaskId({ ownerId: 'user-2', effectId: 'effect' }));

    const rejection = buildWorkflowImagePreUpstreamRejection({
      current: { nodes: [{ id: 'asset', data: {
        status: 'submitting', workflowEffectId: 'effect', workflowTaskId, workflowSubmissionState: 'submitting',
      } }] },
      nodeId: 'asset', effectId: 'effect', workflowTaskId,
      failedAt: '2026-09-23T00:00:00.000Z', errorMessage: 'queue unavailable',
    });
    expect(rejection.patchNodeData[0]).toMatchObject({ id: 'asset', data: {
      status: 'error', workflowSubmissionState: 'rejected_pre_upstream', workflowTaskId,
      workflowSubmissionRejectedAt: '2026-09-23T00:00:00.000Z',
    } });
    expect(() => buildWorkflowImagePreUpstreamRejection({
      current: { nodes: [{ id: 'asset', data: {
        status: 'submitting', workflowEffectId: 'effect', workflowTaskId, workflowSubmissionState: 'submitting', taskId: 'accepted-task',
      } }] },
      nodeId: 'asset', effectId: 'effect', workflowTaskId,
      failedAt: 'now', errorMessage: 'queue unavailable',
    })).toThrow('claim changed');
  });
});
