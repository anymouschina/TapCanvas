import type { ProjectBookIndexDto } from '../../api/server'
import {
  deriveShotPromptsFromStructuredData,
  normalizeStoryboardStructuredData,
  type StoryboardStructuredData,
} from '../../storyboard/storyboardStructure'

export type StoryboardGroupSize = 1 | 4 | 9 | 25

type StoryboardProgressKey = '1' | '4' | '9' | '25'

const STORYBOARD_GROUP_SIZE_VALUES: readonly StoryboardGroupSize[] = [1, 4, 9, 25]

export const DEFAULT_NANO_COMIC_STORYBOARD_GROUP_SIZE: StoryboardGroupSize = 25

type StoryboardPlanRecord = NonNullable<NonNullable<ProjectBookIndexDto['assets']>['storyboardPlans']>[number]
type StoryboardChunkRecord = NonNullable<NonNullable<ProjectBookIndexDto['assets']>['storyboardChunks']>[number]

export type NanoComicStoryboardChunkSummary = {
  chunkId: string
  chunkIndex: number
  groupSize: StoryboardGroupSize
  shotStart: number
  shotEnd: number
  frameCount: number
  previewImageUrl: string
  tailFrameUrl: string
  updatedAt: string
  updatedAtLabel: string
}

export type NanoComicStoryboardProductionSummary = {
  chapterNo: number
  groupSize: StoryboardGroupSize
  plan: StoryboardPlanRecord | null
  chunks: NanoComicStoryboardChunkSummary[]
  totalShots: number
  totalChunks: number
  generatedChunks: number
  generatedShots: number
  nextChunkIndex: number
  nextShotStart: number
  nextShotEnd: number
  isComplete: boolean
  latestTailFrameUrl: string
}

export function normalizeNanoComicStoryboardGroupSize(value: unknown): StoryboardGroupSize | null {
  const normalized = Math.trunc(Number(value))
  return STORYBOARD_GROUP_SIZE_VALUES.includes(normalized as StoryboardGroupSize)
    ? normalized as StoryboardGroupSize
    : null
}

export function resolveNanoComicStoryboardGroupSize(
  value: unknown,
  fallback: StoryboardGroupSize = DEFAULT_NANO_COMIC_STORYBOARD_GROUP_SIZE,
): StoryboardGroupSize {
  return normalizeNanoComicStoryboardGroupSize(value) ?? fallback
}

export function getStoryboardProgressMapKey(groupSize: StoryboardGroupSize): StoryboardProgressKey {
  return String(groupSize) as StoryboardProgressKey
}

function formatTimeLabel(input?: string | null): string {
  const raw = typeof input === 'string' ? input.trim() : ''
  if (!raw) return '刚刚'
  const ts = Date.parse(raw)
  if (!Number.isFinite(ts)) return raw
  const diffMs = Date.now() - ts
  const diffMinutes = Math.max(0, Math.trunc(diffMs / 60000))
  if (diffMinutes < 1) return '刚刚'
  if (diffMinutes < 60) return `${diffMinutes} 分钟前`
  const diffHours = Math.trunc(diffMinutes / 60)
  if (diffHours < 24) return `${diffHours} 小时前`
  const diffDays = Math.trunc(diffHours / 24)
  if (diffDays < 7) return `${diffDays} 天前`
  return raw.slice(0, 10)
}

function normalizeShotPrompt(line: string): string {
  return String(line || '')
    .replace(/^[-*]\s*/, '')
    .replace(/^#+\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function readPromptTextFromRecord(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ''
  const record = value as Record<string, unknown>
  const candidate = [
    record.prompt_text,
    record.promptText,
    record.script,
    record.scene,
    record.description,
  ].find((item) => typeof item === 'string' && String(item).trim())
  return typeof candidate === 'string' ? candidate.trim() : ''
}

export function extractShotPromptsFromStoryboard(text: string): string[] {
  const raw = String(text || '').trim()
  if (!raw) return []

  if (raw.startsWith('{') || raw.startsWith('[')) {
    try {
      const parsed = JSON.parse(raw) as unknown
      if (Array.isArray(parsed)) {
        const fromArray = parsed
          .map((item) => (typeof item === 'string' ? item.trim() : readPromptTextFromRecord(item)))
          .filter(Boolean)
        if (fromArray.length > 0) return fromArray
      } else if (parsed && typeof parsed === 'object') {
        const structured = normalizeStoryboardStructuredData(
          (parsed as Record<string, unknown>).storyboardStructured ?? parsed,
        )
        if (structured) {
          const structuredPrompts = deriveShotPromptsFromStructuredData(structured)
          if (structuredPrompts.length > 0) return structuredPrompts
        }
        const parsedShots = (parsed as Record<string, unknown>).shots
        const rawShots: unknown[] = Array.isArray(parsedShots)
          ? parsedShots as unknown[]
          : []
        const fromShots = rawShots.map((item: unknown) => readPromptTextFromRecord(item)).filter(Boolean)
        if (fromShots.length > 0) return fromShots
      }
    } catch {
      // keep plain text parsing below
    }
  }

  const numbered = new Map<number, string>()
  for (const rawLine of raw.split('\n')) {
    const line = normalizeShotPrompt(rawLine)
    if (!line) continue
    const match = line.match(/^(?:镜头|shot)\s*#?\s*(\d{1,4})\s*[：:、.\-]?\s*(.+)$/i)
    if (!match) continue
    const shotNo = Number(match[1])
    const prompt = normalizeShotPrompt(match[2] || '')
    if (!Number.isFinite(shotNo) || shotNo <= 0 || !prompt) continue
    if (!numbered.has(shotNo)) numbered.set(shotNo, prompt)
  }
  if (numbered.size > 0) {
    return Array.from(numbered.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([, value]) => value)
      .filter(Boolean)
  }

  const paragraphs = raw
    .split(/\n{2,}/)
    .map((item) => normalizeShotPrompt(item))
    .filter(Boolean)
  return paragraphs
}

export function ensureVisualShotPrompts(shotPrompts: readonly string[]): string[] {
  const unique: string[] = []
  const seen = new Set<string>()
  for (const item of shotPrompts) {
    const prompt = String(item || '').trim()
    if (!prompt) continue
    const key = prompt.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(prompt)
  }
  return unique
}

export function isGenericStoryboardFallbackPrompt(line: string): boolean {
  const value = String(line || '').trim()
  if (!value) return false
  return /第\d+章(电影级写实镜头|人物交互镜头|情绪推进镜头|转场收束镜头)/.test(value)
}

export function chunkShotPrompts(shotPrompts: readonly string[], groupSize: number): string[][] {
  const chunks: string[][] = []
  const normalizedGroupSize = Math.max(1, Math.trunc(groupSize))
  for (let index = 0; index < shotPrompts.length; index += normalizedGroupSize) {
    chunks.push(shotPrompts.slice(index, index + normalizedGroupSize))
  }
  return chunks
}

export function getChapterStoryboardPlan(
  index: ProjectBookIndexDto | null,
  chapterNo: number | null,
): StoryboardPlanRecord | null {
  if (!index || !chapterNo) return null
  const plans = Array.isArray(index.assets?.storyboardPlans) ? index.assets.storyboardPlans : []
  return plans
    .filter((plan) => Math.trunc(Number(plan?.chapter || 0)) === chapterNo)
    .sort((a, b) => Date.parse(String(b.updatedAt || '')) - Date.parse(String(a.updatedAt || '')))[0] ?? null
}

function getLatestChapterStoryboardChunkRecord(
  index: ProjectBookIndexDto | null,
  chapterNo: number | null,
): StoryboardChunkRecord | null {
  if (!index || !chapterNo) return null
  const chunks = Array.isArray(index.assets?.storyboardChunks) ? index.assets.storyboardChunks : []
  return chunks
    .filter((chunk) => Math.trunc(Number(chunk?.chapter || 0)) === chapterNo)
    .sort((a, b) => {
      const chunkIndexDiff = Math.trunc(Number(b.chunkIndex || 0)) - Math.trunc(Number(a.chunkIndex || 0))
      if (chunkIndexDiff !== 0) return chunkIndexDiff
      return Date.parse(String(b.updatedAt || b.createdAt || '')) - Date.parse(String(a.updatedAt || a.createdAt || ''))
    })[0] ?? null
}

export function resolveChapterStoryboardGroupSize(
  index: ProjectBookIndexDto | null,
  chapterNo: number | null,
  preferredGroupSize?: StoryboardGroupSize | null,
): StoryboardGroupSize {
  const planGroupSize = normalizeNanoComicStoryboardGroupSize(getChapterStoryboardPlan(index, chapterNo)?.groupSize)
  if (planGroupSize) return planGroupSize
  const preferred = normalizeNanoComicStoryboardGroupSize(preferredGroupSize)
  if (preferred) return preferred
  const chunkGroupSize = normalizeNanoComicStoryboardGroupSize(getLatestChapterStoryboardChunkRecord(index, chapterNo)?.groupSize)
  if (chunkGroupSize) return chunkGroupSize
  return DEFAULT_NANO_COMIC_STORYBOARD_GROUP_SIZE
}

export function getPlanShotPrompts(plan: StoryboardPlanRecord | null): string[] {
  if (!plan) return []
  const explicit = Array.isArray(plan.shotPrompts) ? plan.shotPrompts : []
  if (explicit.length > 0) return ensureVisualShotPrompts(explicit)
  return ensureVisualShotPrompts(deriveShotPromptsFromStructuredData(plan.storyboardStructured))
}

export function getPlanStructuredData(plan: StoryboardPlanRecord | null): StoryboardStructuredData | null {
  return normalizeStoryboardStructuredData(plan?.storyboardStructured)
}

export function getChapterStoryboardChunks(
  index: ProjectBookIndexDto | null,
  chapterNo: number | null,
  preferredGroupSize?: StoryboardGroupSize | null,
): NanoComicStoryboardChunkSummary[] {
  if (!index || !chapterNo) return []
  const resolvedGroupSize = resolveChapterStoryboardGroupSize(index, chapterNo, preferredGroupSize)
  const chunks = Array.isArray(index.assets?.storyboardChunks) ? index.assets.storyboardChunks : []
  return chunks
    .filter((chunk) => Math.trunc(Number(chunk?.chapter || 0)) === chapterNo)
    .filter((chunk) => Math.trunc(Number(chunk?.groupSize || 0)) === resolvedGroupSize)
    .sort((a, b) => Math.trunc(Number(a.chunkIndex || 0)) - Math.trunc(Number(b.chunkIndex || 0)))
    .map((chunk) => {
      const frameUrls = Array.isArray(chunk.frameUrls)
        ? chunk.frameUrls.map((item) => String(item || '').trim()).filter(Boolean)
        : []
      const tailFrameUrl = String(chunk.tailFrameUrl || '').trim()
      return {
        chunkId: String(chunk.chunkId || '').trim(),
        chunkIndex: Math.max(0, Math.trunc(Number(chunk.chunkIndex || 0))),
        groupSize: resolvedGroupSize,
        shotStart: Math.max(1, Math.trunc(Number(chunk.shotStart || 1))),
        shotEnd: Math.max(1, Math.trunc(Number(chunk.shotEnd || 1))),
        frameCount: frameUrls.length,
        previewImageUrl: frameUrls[0] || tailFrameUrl,
        tailFrameUrl,
        updatedAt: String(chunk.updatedAt || chunk.createdAt || '').trim(),
        updatedAtLabel: formatTimeLabel(chunk.updatedAt || chunk.createdAt),
      }
    })
}

function resolveNextChunkIndexFromChunks(
  chunks: readonly NanoComicStoryboardChunkSummary[],
  totalChunks: number,
): number {
  const normalizedTotalChunks = Math.max(0, Math.trunc(totalChunks))
  if (normalizedTotalChunks <= 0) return 0
  const chunkIndexSet = new Set<number>()
  for (const chunk of chunks) {
    const chunkIndex = Math.trunc(Number(chunk.chunkIndex))
    if (!Number.isFinite(chunkIndex) || chunkIndex < 0) continue
    chunkIndexSet.add(chunkIndex)
  }
  let nextChunkIndex = 0
  while (nextChunkIndex < normalizedTotalChunks && chunkIndexSet.has(nextChunkIndex)) {
    nextChunkIndex += 1
  }
  return nextChunkIndex
}

export function buildStoryboardProductionSummary(
  index: ProjectBookIndexDto | null,
  chapterNo: number | null,
  options?: { preferredGroupSize?: StoryboardGroupSize | null },
): NanoComicStoryboardProductionSummary | null {
  if (!index || !chapterNo) return null
  const plan = getChapterStoryboardPlan(index, chapterNo)
  const groupSize = resolveChapterStoryboardGroupSize(index, chapterNo, options?.preferredGroupSize)
  const shotPrompts = getPlanShotPrompts(plan)
  const chunks = getChapterStoryboardChunks(index, chapterNo, groupSize)
  const generatedChunks = chunks.length
  const totalShots = shotPrompts.length
  const totalChunks =
    totalShots > 0
      ? Math.ceil(totalShots / groupSize)
      : generatedChunks
  const nextChunkIndex = resolveNextChunkIndexFromChunks(chunks, totalChunks)
  const nextShotStart = nextChunkIndex * groupSize + 1
  const nextShotEnd = totalShots > 0
    ? Math.min(totalShots, nextShotStart + groupSize - 1)
    : nextShotStart + groupSize - 1
  const latestChunk = chunks[chunks.length - 1] ?? null
  return {
    chapterNo,
    groupSize,
    plan,
    chunks,
    totalShots,
    totalChunks,
    generatedChunks,
    generatedShots: chunks.reduce((sum, chunk) => sum + Math.max(0, chunk.shotEnd - chunk.shotStart + 1), 0),
    nextChunkIndex,
    nextShotStart,
    nextShotEnd,
    isComplete: totalChunks > 0 && nextChunkIndex >= totalChunks,
    latestTailFrameUrl: latestChunk?.tailFrameUrl || '',
  }
}

export function buildPreviousChunkStoryboardScript(
  shotPrompts: readonly string[],
  nextChunkIndex: number,
  groupSize: StoryboardGroupSize,
): string {
  const previousChunkIndex = Math.max(0, nextChunkIndex - 1)
  const chunkStart = previousChunkIndex * groupSize
  const previousChunk = shotPrompts.slice(chunkStart, chunkStart + groupSize)
  return previousChunk
    .map((prompt, index) => `镜头 ${chunkStart + index + 1}：${prompt}`)
    .join('\n')
}
