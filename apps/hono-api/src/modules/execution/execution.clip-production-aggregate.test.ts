import { describe, expect, it } from 'vitest';
import { createWorkflowCollection } from '@tapcanvas/workflow-kernel-protocol';
import { aggregateClipProduction } from './execution.clip-production-aggregate';
import { projectClipProductionAssetItems, projectClipProductionPackets } from './execution.clip-production';
import { projectClipProductionPromptPackage } from './execution.clip-production-project';
import { inspectWorkflowPromptPackageAdmission } from './execution.video-workflow-contract';
import { clipProductionBlockingFixture } from './test-fixtures/clip-production-blocking';

function batch(values: readonly unknown[], ids: readonly string[], port = 'items') {
  return createWorkflowCollection({ collectionId: port, producerNodeId: 'test', producerPortId: port, values, itemIds: ids });
}

function clip(index: number) {
  const clipId = `clip-${index}`;
  const source = { protocolVersion: 'tapcanvas.clip-source-segment/v1', clipId, clipIndex: index,
    sourceId: 'chapter', sourceFingerprint: 'sha256:source', durationSeconds: 5,
    sourceRanges: [{ sourceIndex: 0, startOffset: index * 10, endOffset: index * 10 + 10, sourceId: 'chapter', sourceFingerprint: 'sha256:source' }] };
  const intent = { assetId: 'shared', state: 'base', registryObjectId: 'character-main',
    displayName: '主角', referenceType: 'character', referenceAssetBindings: [],
    imageSource: { mode: 'generate', generationSpecVersion: 'v1', generationSpec: {
      prompt: 'shared exact reference', negativePrompt: 'no drift', modelKey: 'image', aspectRatio: '16:9', size: '2K' } } };
  const packet = { protocolVersion: 'tapcanvas.clip-production-packet/v1', clipId, clipIndex: index,
    durationSeconds: 5, videoInputMode: 'image_to_video', videoPrompt: `original prompt ${index}`,
    blockingPlan: clipProductionBlockingFixture(), clipFacts: { action: "source action" },
    sourceRanges: source.sourceRanges, firstFrameAsset: { assetId: intent.assetId, state: intent.state },
    referenceAssets: [{ assetId: intent.assetId, state: intent.state }], assetIntents: [intent] };
  const projection = projectClipProductionPackets({ executionId: 'execution', nodeId: `collect-${index}`,
    packets: [packet], sourceSegmentCollection: batch([source], [clipId]) });
  const assets = projectClipProductionAssetItems({ executionId: 'execution', nodeId: `assets-${index}`, assetIntentCollection: projection.assetIntentCollection });
  const asset = assets.items[0]!.value;
  const promptPackage = projectClipProductionPromptPackage({ executionId: 'execution', workflowKey: 'workflow',
    deliveryContract: { protocolVersion: '2', workflowKey: 'workflow' },
    clipProductionCollection: projection.clipProductionCollection,
    assetBindings: batch([{ assetPlan: asset, nodeId: 'shared-image', imageUrl: 'https://media.example/shared.png', generatedAssetId: 'stored-image' }], [asset.effectAssetId]) });
  return { clipId, source, promptPackage, estimate: { estimateIdentity: `estimate-${index}`, modelKey: 'video', resolution: '720p', aspectRatio: '16:9', estimatedCredits: 2,
    perClip: [{ itemId: clipId, durationSeconds: 5, credits: 2 }] }, video: batch([{ videoUrl: `https://media.example/${index}.mp4` }], [clipId]) };
}

function inputs() {
  const clips = [clip(0), clip(1)];
  const reversed = [...clips].reverse();
  return { executionId: 'execution', nodeId: 'aggregate', sourceSegments: batch(clips.map(c => c.source), clips.map(c => c.clipId)),
    promptPackages: batch(reversed.map(c => c.promptPackage), reversed.map(c => c.clipId)),
    estimates: batch(reversed.map(c => c.estimate), reversed.map(c => c.clipId)),
    videoAssets: batch(reversed.map(c => c.video), reversed.map(c => c.clipId)) };
}

describe('independent Clip aggregation', () => {
  it('preserves nonzero frozen clip indices through per-item projection and restores source order after out-of-order completion', () => {
    const result = aggregateClipProduction(inputs());
    expect(inspectWorkflowPromptPackageAdmission(result.ports['prompt-package']).structurallyValid).toBe(true);
    expect(result.ports['prompt-package']).toMatchObject({ clips: [
      { itemId: 'clip-0', clipIndex: 0, index: 0, prompt: 'original prompt 0' },
      { itemId: 'clip-1', clipIndex: 1, index: 1, prompt: 'original prompt 1' },
    ], deliveryEvidence: { clipCount: 2, totalDurationSeconds: 10 } });
    expect(result.ports.estimate).toMatchObject({ estimatedCredits: 4, perClip: [{ itemId: 'clip-0' }, { itemId: 'clip-1' }] });
    expect(result.ports['video-assets']).toMatchObject({ items: [{ itemId: 'clip-0' }, { itemId: 'clip-1' }] });
    expect(result.ports).not.toHaveProperty('prepared-nodes');
  });
  it('keeps prepare-only delivery distinct and does not manufacture a video output', () => {
    const original = inputs();
    const result = aggregateClipProduction({ ...original, videoAssets: undefined, preparedNodes: original.videoAssets });
    expect(result.selectedOutputPorts).toEqual(['prompt-package', 'estimate', 'prepared-nodes']);
    expect(result.ports).not.toHaveProperty('video-assets');
  });
  it('rejects foreign, missing and ambiguous receipt sets', () => {
    const original = inputs();
    expect(() => aggregateClipProduction({ ...original, estimates: batch([], []) })).toThrow('exactly cover');
    expect(() => aggregateClipProduction({ ...original, preparedNodes: original.videoAssets })).toThrow('exactly one');
    const other = clip(7);
    expect(() => aggregateClipProduction({ ...original, promptPackages: batch([other.promptPackage], ['clip-7']) })).toThrow('exactly cover');
  });
});
