import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CHAPTER_CLIP_SEGMENTATION_ARTIFACT_TYPE,
  chapterClipSegmentationSchema,
  inspectClipSegmentationCoverage,
} from './index.mjs';

test('chapter clip segmentation contract is compact and structural', () => {
  assert.deepEqual(chapterClipSegmentationSchema.required, ['protocolVersion', 'clips']);
  assert.equal(chapterClipSegmentationSchema.additionalProperties, false);
  assert.equal(chapterClipSegmentationSchema.properties.clips.maxItems, 80);
  assert.deepEqual(chapterClipSegmentationSchema.properties.clips.items.required, ['durationSeconds', 'sourceRanges']);
  assert.equal(chapterClipSegmentationSchema.properties.clips.items.additionalProperties, false);
});

test('coverage accepts contiguous UTF-16 ranges across clip and source boundaries', () => {
  const sources = ['甲👩‍🚀乙。', '第二幕。'];
  const splitAt = sources[0].indexOf('乙');
  const clips = [
    { durationSeconds: 4, sourceRanges: [{ sourceIndex: 0, startOffset: 0, endOffset: splitAt }] },
    { durationSeconds: 6, sourceRanges: [
      { sourceIndex: 0, startOffset: splitAt, endOffset: sources[0].length },
      { sourceIndex: 1, startOffset: 0, endOffset: sources[1].length },
    ] },
  ];

  assert.equal(inspectClipSegmentationCoverage(clips, sources), null);
  assert.equal(CHAPTER_CLIP_SEGMENTATION_ARTIFACT_TYPE, 'tapcanvas.chapter-clip-segmentation/v1');
});

test('coverage reports gaps, overlaps, source-order skips and out-of-range offsets', () => {
  const source = '甲乙丙';
  const first = { durationSeconds: 3, sourceRanges: [{ sourceIndex: 0, startOffset: 0, endOffset: 1 }] };
  const remainder = { durationSeconds: 3, sourceRanges: [{ sourceIndex: 0, startOffset: 1, endOffset: source.length }] };
  assert.equal(inspectClipSegmentationCoverage([first, remainder], [source]), null);
  assert.match(inspectClipSegmentationCoverage([first, { ...remainder, sourceRanges: [{ ...remainder.sourceRanges[0], startOffset: 2 }] }], [source]), /cursor/u);
  assert.match(inspectClipSegmentationCoverage([first, { ...remainder, sourceRanges: [{ ...remainder.sourceRanges[0], startOffset: 0 }] }], [source]), /cursor/u);
  assert.match(inspectClipSegmentationCoverage([first, { ...remainder, sourceRanges: [{ ...remainder.sourceRanges[0], sourceIndex: 1 }] }], [source]), /continue source/u);
  assert.match(inspectClipSegmentationCoverage([{ durationSeconds: 3, sourceRanges: [{ sourceIndex: 0, startOffset: 0, endOffset: source.length + 1 }] }], [source]), /cursor/u);
});

test('coverage rejects offsets that split a surrogate pair', () => {
  const source = '甲👩‍🚀乙';
  const splitPair = source.indexOf('👩') + 1;
  const error = inspectClipSegmentationCoverage([
    { durationSeconds: 4, sourceRanges: [{ sourceIndex: 0, startOffset: 0, endOffset: splitPair }] },
    { durationSeconds: 4, sourceRanges: [{ sourceIndex: 0, startOffset: splitPair, endOffset: source.length }] },
  ], [source]);
  assert.match(error, /surrogate pair/u);
});

test('coverage requires every non-empty frozen source to be fully covered', () => {
  assert.match(inspectClipSegmentationCoverage([
    { durationSeconds: 4, sourceRanges: [{ sourceIndex: 0, startOffset: 0, endOffset: 2 }] },
  ], ['甲乙', '丙丁']), /cover every frozen source/u);
  assert.match(inspectClipSegmentationCoverage([], ['甲']), /1 and 80/u);
  assert.match(inspectClipSegmentationCoverage([
    { durationSeconds: 0, sourceRanges: [{ sourceIndex: 0, startOffset: 0, endOffset: 1 }] },
  ], ['甲']), /positive safe integer/u);
});
