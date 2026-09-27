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

const blockingPlan = {
  title: '门口对峙',
  sceneName: '大厅',
  backgroundObjectId: 'background-main',
  landmarks: [{ kind: 'area', at: [0.5, 0.5], label: '大厅中央' }],
  characters: [{ name: '张羽', at: [0.3, 0.5], facingTo: [0.7, 0.5], moveTo: null }],
  camera: { at: [0.5, 0.9], lookAt: [0.5, 0.5] },
  compositionContract: { narrativeTask: '交代双方的空间关系' },
};

function generatedIntent(overrides = {}) {
  return {
    assetId: 'character-main',
    state: 'injured-left-cheek-v1',
    registryObjectId: 'character-main',
    displayName: '主角左脸受伤状态',
    referenceType: 'character',
    referenceAssetBindings: [],
    imageSource: {
      mode: 'generate',
      generationSpecVersion: 'image-spec-v3',
      generationSpec: structuredClone(generationSpec),
    },
    ...overrides,
  };
}

function packet(clipIndex, options = {}) {
  const clipId = options.clipId ?? `clip-${clipIndex}`;
  const intent = options.intent ?? generatedIntent();
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
    blockingPlan: structuredClone(blockingPlan),
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

test('collects clips by index and merges only the exact asset state and generation specification', () => {
  const result = collectClipProductionPackets([packet(1), packet(0)]);
  assert.deepEqual(result.clips.map((clip) => clip.clipId), ['clip-0', 'clip-1']);
  assert.equal(result.assetIntents.length, 1);
  assert.deepEqual(result.assetIntents[0]?.consumerClipIds, ['clip-0', 'clip-1']);
  assert.equal(result.assetIntents[0]?.assetId, 'character-main');
});

test('compares complete JSON specs independent of object key order', () => {
  const reordered = generatedIntent({ imageSource: {
    mode: 'generate',
    generationSpecVersion: 'image-spec-v3',
    generationSpec: {
      references: ['identity-image'],
      modelKey: 'image-model',
      aspectRatio: '16:9',
      size: '2K',
      negativePrompt: '避免错误的外观',
      prompt: '一个完整的图像生成规格',
    },
  } });
  const result = collectClipProductionPackets([packet(0), packet(1, { intent: reordered })]);
  assert.equal(result.assetIntents.length, 1);
  assert.deepEqual(result.assetIntents[0]?.consumerClipIds, ['clip-0', 'clip-1']);
});

test('keeps different canonical states separate for the same entity assetId', () => {
  const otherState = generatedIntent({ state: 'clean-face-v1' });
  const result = collectClipProductionPackets([packet(0), packet(1, { intent: otherState })]);
  assert.equal(result.assetIntents.length, 2);
  assert.deepEqual(result.assetIntents.map((intent) => intent.state), ['clean-face-v1', 'injured-left-cheek-v1']);
});

test('rejects specification drift for the same exact asset and state identity', () => {
  const changedPrompt = generatedIntent({ imageSource: {
    mode: 'generate', generationSpecVersion: 'image-spec-v3',
    generationSpec: { ...generationSpec, prompt: '规格发生漂移' },
  } });
  assert.throws(() => collectClipProductionPackets([packet(0), packet(1, { intent: changedPrompt })]), /conflicting source or semantic identity facts/);
  const changedVersion = generatedIntent({ imageSource: {
    mode: 'generate', generationSpecVersion: 'image-spec-v4', generationSpec: structuredClone(generationSpec),
  } });
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
  }), /generationSpec.negativePrompt/);
  assert.throws(() => validateClipProductionPacket({
    ...input,
    assetIntents: [{ ...intent, imageSource: {
      ...intent.imageSource,
      generationSpec: { ...generationSpec, modelKey: '' },
    } }],
  }), /generationSpec.modelKey/);
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
