import { describe, expect, it } from 'vitest';
import { resolvePreparedCanvasMediaSubmission, resolvePreparedVideoGenerationContract } from './prepared-canvas-media-submission';
import { buildWorkflowImageClaim } from './workflow-image-effect-claim';

const image = {
  id: 'image-1', type: 'taskNode', position: { x: 10, y: 20 }, data: {
    kind: 'image', status: 'idle', workflowPreparedOnly: true,
    prompt: 'frozen prompt', modelKey: 'user-selected-image-model', imageSize: '2K',
    workflowEffectId: 'image-effect', workflowExecutionFamilyId: 'family', workflowTaskId: 'reserved-task',
    styleImages: ['https://assets.test/style.png'], styleFingerprint: 'style-revision',
    assetReuseKey: 'asset-identity', referenceAssetBindings: [], customMetadata: { variant: 2 },
  },
};
const video = {
  id: 'video-1', type: 'taskNode', position: { x: 0, y: 0 }, data: {
    kind: 'video', status: 'idle', workflowPreparedOnly: true,
    prompt: 'frozen clip', modelKey: 'user-selected-video-model',
    workflowEffectId: 'video-effect', workflowExecutionFamilyId: 'family',
    firstFrameImageNodeId: 'image-1', firstFrameFromNodeId: 'image-1', referenceImageNodeIds: ['image-1'],
  },
};

describe('prepared canvas media first submission', () => {
  it('accepts only framework book scope matching the authorized envelope', () => {
    expect(resolvePreparedCanvasMediaSubmission({ args: { nodeId: image.id, bookId: 'book-1' },
      graph: { nodes: [image] }, media: 'image', authorizedBookId: 'book-1' }).node).toHaveProperty('id', image.id);
    for (const authorizedBookId of ['book-2', undefined]) {
      expect(() => resolvePreparedCanvasMediaSubmission({ args: { nodeId: image.id, bookId: 'book-1' },
        graph: { nodes: [image] }, media: 'image', authorizedBookId }))
        .toThrow('book scope does not match');
    }
    expect(() => resolvePreparedCanvasMediaSubmission({ args: { nodeId: image.id, bookId: 'book-1', arbitrary: true },
      graph: { nodes: [image] }, media: 'image', authorizedBookId: 'book-1' })).toThrow('requires only nodeId');
  });
  it('recovers the same model contract from durable delivery evidence and rejects another model', () => {
    const contract = { videoModel: video.data.modelKey, durationOptions: [5, 10], maxDurationSeconds: 10,
      supportsReferenceImages: true,
      supportsFirstLastFrame: false, maxReferenceImages: 4, referenceAudioPolicy: { minimumDurationSeconds: 0, maximumDurationSeconds: 0 } };
    const node: Record<string, unknown> = { ...video, data: { ...video.data } };
    const evidence = [{ artifacts: [{ type: 'tapcanvas.delivery-contract/v2', value: { generationContract: contract } }] }];
    resolvePreparedVideoGenerationContract(node, evidence, contract.referenceAudioPolicy);
    expect(node).toMatchObject({ data: { generationContract: contract } });
    expect(() => resolvePreparedVideoGenerationContract({ ...video, data: { ...video.data, modelKey: 'different' } }, evidence, contract.referenceAudioPolicy))
      .toThrow('no unambiguous frozen generation contract');
    expect(() => resolvePreparedVideoGenerationContract({ ...video, data: { ...video.data } }, [], contract.referenceAudioPolicy))
      .toThrow('no unambiguous frozen generation contract');
  });
  it('uses the original frozen image and reserved task identity with the same atomic claim', () => {
    const graph = { nodes: [image] };
    const result = resolvePreparedCanvasMediaSubmission({ args: { nodeId: image.id }, graph, media: 'image' });
    expect(result.node).toMatchObject({ id: image.id, position: image.position, data: {
      ...image.data, workflowPreparedOnly: false, mediaTaskExecutionOwner: 'canvas_prepared',
    } });
    expect(buildWorkflowImageClaim({ current: graph, node: result.node, nodeId: image.id,
      effectId: image.data.workflowEffectId, claimedAt: 'now' })).toMatchObject({
      patchNodeData: [{ id: image.id, data: { workflowTaskId: 'reserved-task', workflowSubmissionState: 'submitting' } }],
    });
    expect(image.data.workflowPreparedOnly).toBe(true);
  });

  it('retains explicit toolbar image selection after modelKey is cleared and checks concurrent changes', () => {
    const edited = { ...image, data: { ...image.data, modelKey: undefined, imageModel: 'selected-image', modelAlias: 'selected-alias' } };
    const result = resolvePreparedCanvasMediaSubmission({ args: { nodeId: image.id }, graph: { nodes: [edited] }, media: 'image' });
    expect(result.node).toMatchObject({ data: { imageModel: 'selected-image', modelAlias: 'selected-alias', modelKey: undefined } });
    expect(buildWorkflowImageClaim({ current: { nodes: [edited] }, node: result.node, nodeId: image.id,
      effectId: image.data.workflowEffectId, claimedAt: 'now' })).toHaveProperty('patchNodeData');
    expect(() => buildWorkflowImageClaim({ current: { nodes: [{ ...edited, data: { ...edited.data, imageModel: 'changed-concurrently' } }] },
      node: result.node, nodeId: image.id, effectId: image.data.workflowEffectId, claimedAt: 'now' }))
      .toThrow('already claimed or planned generation contract changed');
  });

  it('does not require a generation model or prompt for an exact existing-asset reuse node', () => {
    const reused = { ...image, data: { ...image.data, modelKey: undefined, prompt: undefined, existingAssetId: 'existing-image' } };
    expect(resolvePreparedCanvasMediaSubmission({ args: { nodeId: image.id }, graph: { nodes: [reused] }, media: 'image' }).node)
      .toMatchObject({ data: { existingAssetId: 'existing-image', modelKey: undefined, prompt: undefined } });
  });

  it('uses the live contract of an explicitly edited video model without restoring the old model', () => {
    const node: Record<string, unknown> = { ...video, data: { ...video.data, modelKey: undefined, videoModel: 'selected-video' } };
    const selectedContract = { videoModel: 'selected-video', durationOptions: [5], maxDurationSeconds: 5,
      referenceAudioPolicy: { minimumDurationSeconds: 0, maximumDurationSeconds: 0 } };
    const original = { ...selectedContract, videoModel: video.data.modelKey };
    const evidence = [{ artifacts: [{ type: 'tapcanvas.delivery-contract/v2', value: { generationContract: original } }] }];
    resolvePreparedVideoGenerationContract(node, evidence, selectedContract.referenceAudioPolicy, selectedContract);
    expect(node).toMatchObject({ data: { videoModel: 'selected-video', modelKey: undefined, generationContract: selectedContract } });
    expect(() => resolvePreparedVideoGenerationContract(node, evidence, selectedContract.referenceAudioPolicy, original))
      .toThrow('no unambiguous frozen generation contract');
  });

  it.each([
    { taskId: 'paid-task' }, { workflowSubmissionState: 'submitting' }, { imageTaskId: 'paid' },
    { videoTaskId: 'paid' }, { imageUrl: 'https://assets.test/existing.png' },
    { imageResults: [{ url: 'https://assets.test/existing.png' }] }, { status: 'error' },
    { workflowPreparedOnly: false },
  ])('refuses a claimed or completed node without submitting again: %j', (patch) => {
    expect(() => resolvePreparedCanvasMediaSubmission({ args: { nodeId: image.id },
      graph: { nodes: [{ ...image, data: { ...image.data, ...patch } }] }, media: 'image',
    })).toThrow('not an unsubmitted prepared node');
  });

  it('resolves the exact successful first frame while preserving frozen metadata', () => {
    const graph = { nodes: [video, { ...image, data: { ...image.data, status: 'success',
      imageResults: [{ url: 'https://assets.test/frame.png', assetId: 'asset-1' }] } }] };
    expect(resolvePreparedCanvasMediaSubmission({ args: { nodeId: video.id }, graph, media: 'video' }).node)
      .toMatchObject({ id: video.id, data: { firstFrameUrl: 'https://assets.test/frame.png',
        referenceImageNodeIds: ['image-1'], modelKey: video.data.modelKey, mediaTaskExecutionOwner: 'canvas_prepared' } });
    expect(() => resolvePreparedCanvasMediaSubmission({ args: { nodeId: video.id },
      graph: { nodes: [video, image] }, media: 'video' })).toThrow('no successful real image URL');
  });

  it('rejects input overrides and a node outside the authorized canvas', () => {
    expect(() => resolvePreparedCanvasMediaSubmission({ args: { nodeId: image.id, node: image }, graph: { nodes: [image] }, media: 'image' }))
      .toThrow('requires only nodeId');
    expect(() => resolvePreparedCanvasMediaSubmission({ args: { nodeId: image.id }, graph: { nodes: [] }, media: 'image' }))
      .toThrow('not found');
  });
});
