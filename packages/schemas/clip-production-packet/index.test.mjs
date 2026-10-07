import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CLIP_PRODUCTION_PACKET_PROTOCOL_VERSION,
  collectClipProductionPackets,
  validateClipProductionPacket,
} from './index.mjs';

const generationSpec = {
  prompt: '一个完整的图像生成规格',
  negativePrompt: '避免错误的外观',
  modelKey: 'image-model',
  aspectRatio: '16:9',
  size: '2K',
  references: ['identity-image'],
};

function assetIntent({ assetId = 'character-main', state = 'injured-left-cheek-v1', generationSpecVersion = 'image-spec-v3', spec = generationSpec } = {}) {
  return {
    assetId,
    state,
    registryObjectId: 'character-main',
    displayName: '主角',
    referenceType: 'character',
    referenceAssetBindings: [],
    imageSource: { mode: 'generate', generationSpecVersion, generationSpec: structuredClone(spec) },
  };
}

function packet(clipIndex, options = {}) {
  const clipId = options.clipId ?? `clip-${clipIndex}`;
  const intent = options.intent ?? assetIntent();
  return {
    protocolVersion: CLIP_PRODUCTION_PACKET_PROTOCOL_VERSION,
    clipId,
    clipIndex,
    durationSeconds: 5,
    videoInputMode: 'image_to_video',
    firstFrameAsset: { assetId: intent.assetId, state: intent.state },
    referenceAssets: [{ assetId: intent.assetId, state: intent.state }],
    sourceRanges: [{ sourceIndex: 0, startOffset: clipIndex * 10, endOffset: clipIndex * 10 + 10, sourceId: 'source-main', sourceFingerprint: 'sha256:source' }],
    videoPrompt: `镜头 ${clipIndex} 的完整提示词，保留所有执行细节。`,
    blockingPlan: {
      title: `镜头 ${clipIndex}`,
      sceneName: '门厅',
      landmarks: [],
      characters: [],
      camera: { at: [0.5, 0.5], lookAt: [0.5, 0.5] },
      compositionContract: { framing: 'medium' },
      backgroundObjectId: 'chapter-background',
    },
    clipFacts: { actionBeats: [{ action: '向前一步', result: '停在门边' }], continuity: { startState: '站立' } },
    assetIntents: [intent],
  };
}

test('validates a packet while retaining prompt, local facts, exact source range, and full generation spec', () => {
  const input = packet(0);
  const validated = validateClipProductionPacket(input);
  assert.deepEqual(validated, input);
  assert.notEqual(validated, input);
  assert.equal(validated.videoPrompt, input.videoPrompt);
  assert.deepEqual(validated.sourceRanges, input.sourceRanges);
  assert.deepEqual(validated.assetIntents[0]?.imageSource.generationSpec, generationSpec);
});

test('accepts and collects packets without optional staging while preserving media identity checks', () => {
  const { blockingPlan: _blockingPlan, ...input } = packet(0);
  assert.deepEqual(validateClipProductionPacket(input), input);
  assert.equal(Object.hasOwn(collectClipProductionPackets([input]).clips[0], 'blockingPlan'), false);
  assert.throws(() => validateClipProductionPacket({ ...input, firstFrameAsset: { assetId: 'missing', state: 'state' } }), /firstFrameAsset must match/);
});

test('accepts author-selected reference subsets and still rejects unknown reference identities', () => {
  const first = packet(0);
  const input = { ...first, assetIntents: [...first.assetIntents, assetIntent({ assetId: 'scene-unselected' })] };
  assert.deepEqual(validateClipProductionPacket(input).referenceAssets, first.referenceAssets);
  assert.throws(() => validateClipProductionPacket({ ...input, referenceAssets: [...first.referenceAssets, { assetId: 'unknown', state: 'state' }] }), /must match an asset intent/);
});

test('preserves an explicitly bound speech track and permits packets whose producer has no frozen track', () => {
  const withoutTrack = packet(0);
  assert.deepEqual(validateClipProductionPacket(withoutTrack), withoutTrack);
  const authored = {
    speechEventId: 'speech-1', speaker: '阿乔', delivery: 'on_screen', text: '  我来。\n', textOrigin: 'authored',
    eventIndex: 0, clipId: withoutTrack.clipId, sceneId: 'scene', scope: 'beat', storyEventId: 'event', sourceRanges: [],
  };
  const withTrack = { ...withoutTrack, speechEvents: [authored] };
  assert.deepEqual(validateClipProductionPacket(withTrack), withTrack);
  const quoted = { ...authored, speechEventId: 'speech-2', text: '\n原文片段  ', textOrigin: 'source_quote',
    sourceRanges: [{ sourceIndex: 0, startOffset: 0, endOffset: 4, sourceId: 'source-main', sourceFingerprint: 'sha256:source' }] };
  assert.deepEqual(validateClipProductionPacket({ ...withoutTrack, speechEvents: [quoted] }).speechEvents, [quoted]);
  assert.deepEqual(validateClipProductionPacket({ ...withoutTrack, speechEvents: [] }).speechEvents, []);
  assert.throws(() => validateClipProductionPacket({ ...withoutTrack, speechEvents: [{
    ...authored, textOrigin: 'source_quote', sourceRanges: [],
  }] }), /sourceRanges must be non-empty for source_quote/);
  assert.throws(() => validateClipProductionPacket({ ...withoutTrack, speechEvents: [{
    ...authored, clipId: 'other-clip',
  }] }), /matching Clip ownership/);
});

test('collects clips by index and merges only the exact asset state and generation specification', () => {
  const result = collectClipProductionPackets([packet(1), packet(0)]);
  assert.deepEqual(result.clips.map((clip) => clip.clipId), ['clip-0', 'clip-1']);
  assert.equal(result.assetIntents.length, 1);
  assert.deepEqual(result.assetIntents[0]?.consumerClipIds, ['clip-0', 'clip-1']);
  assert.equal(result.assetIntents[0]?.assetId, 'character-main');
});

test('compares complete JSON specs independent of object key order', () => {
  const reordered = assetIntent({
    spec: {
      references: ['identity-image'],
      modelKey: 'image-model',
      aspectRatio: '16:9',
      size: '2K',
      negativePrompt: '避免错误的外观',
      prompt: '一个完整的图像生成规格',
    },
  });
  const result = collectClipProductionPackets([packet(0), packet(1, { intent: reordered })]);
  assert.equal(result.assetIntents.length, 1);
  assert.deepEqual(result.assetIntents[0]?.consumerClipIds, ['clip-0', 'clip-1']);
});

test('keeps different canonical states separate for the same entity assetId', () => {
  const otherState = assetIntent({ state: 'clean-face-v1' });
  const result = collectClipProductionPackets([packet(0), packet(1, { intent: otherState })]);
  assert.equal(result.assetIntents.length, 2);
  assert.deepEqual(result.assetIntents.map((intent) => intent.state), ['clean-face-v1', 'injured-left-cheek-v1']);
});

test('rejects specification drift for the same exact asset and state identity', () => {
  const changedPrompt = assetIntent({ spec: { ...generationSpec, prompt: '规格发生漂移' } });
  assert.throws(() => collectClipProductionPackets([packet(0), packet(1, { intent: changedPrompt })]), /conflicting source or semantic identity facts/);
  const changedVersion = assetIntent({ generationSpecVersion: 'image-spec-v4' });
  assert.throws(() => collectClipProductionPackets([packet(0), packet(1, { intent: changedVersion })]), /conflicting source or semantic identity facts/);
});

test('rejects malformed ranges, blank prompt, non-canonical identities, duplicate clip identity, and duplicate indices', () => {
  assert.throws(() => validateClipProductionPacket({ ...packet(0), videoPrompt: '  ' }), /videoPrompt/);
  assert.throws(() => validateClipProductionPacket({ ...packet(0), sourceRanges: [{ ...packet(0).sourceRanges[0], endOffset: 0 }] }), /positive UTF-16 range/);
  assert.throws(() => validateClipProductionPacket({ ...packet(0), assetIntents: [{ ...packet(0).assetIntents[0], state: ' state ' }] }), /canonical non-empty string/);
  assert.throws(() => collectClipProductionPackets([packet(0), packet(1, { clipId: 'clip-0' })]), /clipId duplicates/);
  assert.throws(() => collectClipProductionPackets([packet(0), { ...packet(1), clipIndex: 0 }]), /clipIndex duplicates/);
});

test('requires explicit video input mode and generated identities for image references', () => {
  const input = packet(0);
  assert.throws(() => validateClipProductionPacket({ ...input, videoInputMode: 'automatic' }), /videoInputMode/);
  assert.throws(() => validateClipProductionPacket({ ...input, firstFrameAsset: { assetId: 'missing', state: 'state' } }), /firstFrameAsset must match/);
  assert.throws(() => validateClipProductionPacket({ ...input, referenceAssets: [] }), /must also be listed/);
  const textToVideo = {
    ...input,
    videoInputMode: 'text_to_video',
    firstFrameAsset: null,
    referenceAssets: [],
    assetIntents: [],
  };
  assert.equal(validateClipProductionPacket(textToVideo).videoInputMode, 'text_to_video');
  assert.throws(() => validateClipProductionPacket({ ...textToVideo, firstFrameAsset: input.firstFrameAsset }), /must not declare/);
  const referenceToVideo = {
    ...input,
    videoInputMode: 'reference_to_video',
    firstFrameAsset: null,
  };
  assert.equal(validateClipProductionPacket(referenceToVideo).videoInputMode, 'reference_to_video');
  assert.throws(() => validateClipProductionPacket({ ...referenceToVideo, referenceAssets: [] }), /requires at least one referenceAsset/);
});

test('requires image prompt and provider settings as explicit generation facts', () => {
  const input = packet(0);
  const intent = input.assetIntents[0];
  assert.throws(() => validateClipProductionPacket({
    ...input,
    assetIntents: [{ ...intent, imageSource: { ...intent.imageSource, generationSpec: { prompt: '提示词' } } }],
  }), /imageSource.generationSpec.negativePrompt/);
  assert.throws(() => validateClipProductionPacket({
    ...input,
    assetIntents: [{ ...intent, imageSource: { ...intent.imageSource,
      generationSpec: { ...intent.imageSource.generationSpec, modelKey: '' } } }],
  }), /imageSource.generationSpec.modelKey/);
});

test('rejects non-JSON generation facts and protects caller-owned packet input from mutation', () => {
  const invalid = packet(0);
  invalid.assetIntents[0].imageSource.generationSpec.undefinedField = undefined;
  assert.throws(() => validateClipProductionPacket(invalid), /JSON values only/);
  const first = packet(0);
  const second = packet(1);
  const original = structuredClone(second);
  collectClipProductionPackets([first, second]);
  assert.deepEqual(second, original);
});

test('collects independently ready source subsets without renumbering frozen clip indices', () => {
  const result = collectClipProductionPackets([packet(7), packet(2)]);
  assert.deepEqual(result.clips.map(clip => clip.clipIndex), [2, 7]);
});
