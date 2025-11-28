const SENTENCE_BOUNDARY = /(?<=[。！？!?;；,.])\s*/

export interface NarrativeSplitOptions {
  /** Maximum number of scenes to return */
  maxScenes?: number
  /** Minimum length of a valid scene chunk */
  minLength?: number
  /** Preferred target length per scene before splitting */
  targetLength?: number
  /** Hard ceiling per chunk; overflow forces a split */
  maxChunkLength?: number
}

const DEFAULT_SPLIT_OPTIONS: Required<NarrativeSplitOptions> = {
  maxScenes: 12,
  minLength: 60,
  targetLength: 260,
  maxChunkLength: 360
}

/**
 * Split a long narrative into multiple scene-sized chunks so video generation
 * won't cram everything into a single short clip. Uses paragraph/ellipsis
 * boundaries first, then sentence-aware fallback if the text is one long block.
 */
export function splitNarrativeSections(
  source: string,
  options?: NarrativeSplitOptions
): string[] {
  const { maxScenes, minLength, targetLength, maxChunkLength } = {
    ...DEFAULT_SPLIT_OPTIONS,
    ...(options || {})
  }

  const cleaned = (source || '').replace(/\r/g, '\n').trim()
  if (!cleaned) return []

  const paragraphChunks = cleaned
    .split(/(?:\n\s*\n+|…{3,}|——+|—{3,}|……+)/)
    .map(section => section.replace(/\s+/g, ' ').trim())
    .filter(section => section.length >= minLength)

  let sections = paragraphChunks.length ? paragraphChunks : [cleaned]

  // If everything is still one long block, fall back to sentence-aware chunking.
  if (sections.length === 1 && sections[0].length > targetLength * 1.4) {
    sections = chunkBySentence(sections[0], { minLength, targetLength, maxChunkLength })
  }

  // Cap total scenes to avoid runaway node creation; merge excess chunks.
  if (sections.length > maxScenes) {
    const groupSize = Math.ceil(sections.length / maxScenes)
    const merged: string[] = []
    for (let i = 0; i < sections.length; i += groupSize) {
      const mergedText = sections.slice(i, i + groupSize).join(' ').trim()
      if (mergedText.length) merged.push(mergedText)
    }
    sections = merged
  }

  return sections
}

function chunkBySentence(
  text: string,
  opts: { minLength: number; targetLength: number; maxChunkLength: number }
): string[] {
  const sentences = text
    .split(SENTENCE_BOUNDARY)
    .map(sentence => sentence.trim())
    .filter(Boolean)

  if (!sentences.length) return [text]

  const chunks: string[] = []
  let buffer = ''

  const pushBuffer = () => {
    const trimmed = buffer.trim()
    if (!trimmed) return
    if (trimmed.length >= opts.minLength) {
      chunks.push(trimmed)
    } else if (chunks.length > 0) {
      // Attach undersized trailing bits to the previous chunk to keep tempo.
      chunks[chunks.length - 1] = `${chunks[chunks.length - 1]} ${trimmed}`.trim()
    } else {
      chunks.push(trimmed)
    }
    buffer = ''
  }

  sentences.forEach((sentence, idx) => {
    const candidate = buffer ? `${buffer} ${sentence}`.trim() : sentence
    const reachedTarget = candidate.length >= opts.targetLength && buffer.length >= opts.minLength
    const exceededMax = candidate.length > opts.maxChunkLength && buffer.length >= opts.minLength

    if ((reachedTarget || exceededMax) && buffer) {
      pushBuffer()
      buffer = sentence
    } else {
      buffer = candidate
    }

    if (idx === sentences.length - 1 && buffer) {
      pushBuffer()
    }
  })

  return chunks.length > 0 ? chunks : [text]
}
