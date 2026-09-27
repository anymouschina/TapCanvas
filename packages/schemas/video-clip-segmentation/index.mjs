/** Minimal agent-authored chapter segmentation contract.
 * The agent chooses semantic boundaries and legal provider durations. The host
 * only verifies ordered UTF-16 offsets and projects the exact frozen source.
 */
export const CHAPTER_CLIP_SEGMENTATION_ARTIFACT_TYPE = 'tapcanvas.chapter-clip-segmentation/v1';
export const CLIP_SOURCE_SEGMENT_PROTOCOL_VERSION = 'tapcanvas.clip-source-segment/v1';

const sourceRangeSchema = {
  type: 'object',
  properties: {
    sourceIndex: { type: 'integer', minimum: 0 },
    startOffset: { type: 'integer', minimum: 0 },
    endOffset: { type: 'integer', minimum: 1 },
  },
  required: ['sourceIndex', 'startOffset', 'endOffset'],
  additionalProperties: false,
};

const clipSchema = {
  type: 'object',
  properties: {
    durationSeconds: { type: 'integer', minimum: 1 },
    sourceRanges: { type: 'array', minItems: 1, items: sourceRangeSchema },
  },
  required: ['durationSeconds', 'sourceRanges'],
  additionalProperties: false,
};

export const chapterClipSegmentationSchema = {
  type: 'object',
  properties: {
    protocolVersion: { type: 'string', const: CHAPTER_CLIP_SEGMENTATION_ARTIFACT_TYPE },
    clips: { type: 'array', minItems: 1, maxItems: 80, items: clipSchema },
  },
  required: ['protocolVersion', 'clips'],
  additionalProperties: false,
};

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function splitsSurrogatePair(text, offset) {
  if (offset <= 0 || offset >= text.length) return false;
  const left = text.charCodeAt(offset - 1);
  const right = text.charCodeAt(offset);
  return left >= 0xd800 && left <= 0xdbff && right >= 0xdc00 && right <= 0xdfff;
}

/** Validate one complete, ordered partition over frozen source UTF-16 ranges. */
export function inspectClipSegmentationCoverage(clips, sourceContents) {
  if (!Array.isArray(clips) || clips.length === 0 || clips.length > 80) {
    return 'clips must contain between 1 and 80 items';
  }
  if (!Array.isArray(sourceContents) || sourceContents.length === 0
    || sourceContents.some((content) => typeof content !== 'string' || !content.trim())) {
    return 'sourceContents must contain non-empty frozen source strings';
  }

  let sourceIndex = 0;
  let offset = 0;
  for (const [clipIndex, clip] of clips.entries()) {
    if (!isRecord(clip) || !Array.isArray(clip.sourceRanges) || clip.sourceRanges.length === 0) {
      return `clips[${clipIndex}].sourceRanges must be a non-empty array`;
    }
    if (!Number.isSafeInteger(clip.durationSeconds) || clip.durationSeconds <= 0) {
      return `clips[${clipIndex}].durationSeconds must be a positive safe integer`;
    }
    for (const [rangeIndex, range] of clip.sourceRanges.entries()) {
      if (!isRecord(range)) return `clips[${clipIndex}].sourceRanges[${rangeIndex}] must be an object`;
      const rangeSourceIndex = range.sourceIndex;
      const startOffset = range.startOffset;
      const endOffset = range.endOffset;
      if (!Number.isSafeInteger(rangeSourceIndex) || !Number.isSafeInteger(startOffset) || !Number.isSafeInteger(endOffset)) {
        return `clips[${clipIndex}].sourceRanges[${rangeIndex}] offsets and sourceIndex must be safe integers`;
      }
      if (rangeSourceIndex !== sourceIndex) {
        return `clips[${clipIndex}].sourceRanges[${rangeIndex}] must continue source ${sourceIndex} before advancing`;
      }
      const content = sourceContents[sourceIndex];
      if (typeof content !== 'string') return `sourceContents[${sourceIndex}] is missing`;
      if (startOffset !== offset || endOffset <= startOffset || endOffset > content.length) {
        return `clips[${clipIndex}].sourceRanges[${rangeIndex}] must continue the exact UTF-16 source cursor`;
      }
      if (splitsSurrogatePair(content, startOffset) || splitsSurrogatePair(content, endOffset)) {
        return `clips[${clipIndex}].sourceRanges[${rangeIndex}] must not split a UTF-16 surrogate pair`;
      }
      offset = endOffset;
      if (offset === content.length && sourceIndex < sourceContents.length - 1) {
        sourceIndex += 1;
        offset = 0;
      }
    }
  }

  const finalSourceIndex = sourceContents.length - 1;
  const finalSource = sourceContents[finalSourceIndex];
  if (sourceIndex !== finalSourceIndex || typeof finalSource !== 'string' || offset !== finalSource.length) {
    return `clips must cover every frozen source exactly; stopped at source ${sourceIndex}, UTF-16 offset ${offset}`;
  }
  return null;
}
