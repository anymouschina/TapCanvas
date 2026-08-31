import type { ChapterCreativeOverride, ChapterStyleOverrideContext } from '../api/server'
import type { LockedStyle } from '../canvas/projectImageSettingsStore'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function readTrimmedString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}

function readDirectorPersona(value: unknown): ChapterCreativeOverride['directorPersona'] | undefined {
  if (value === null) return null
  if (!isRecord(value)) return undefined
  const personaId = readTrimmedString(value.personaId)
  if (!personaId) return undefined
  const personaName = typeof value.personaName === 'string' ? value.personaName.trim() : ''
  const source = value.source === 'custom' ? 'custom' : value.source === 'catalog' ? 'catalog' : undefined
  const prompt = readTrimmedString(value.prompt)
  return {
    personaId,
    personaName,
    ...(source ? { source } : {}),
    ...(prompt ? { prompt } : {}),
  }
}

/**
 * The chapter API keeps this field as JSON text for compatibility with the existing
 * column. The parser only performs structural normalization; creative decisions stay
 * in the selected chapter override itself.
 */
export function parseChapterCreativeOverride(raw: unknown): ChapterCreativeOverride | null {
  let candidate: unknown = raw
  if (typeof raw === 'string') {
    const text = raw.trim()
    if (!text) return null
    try {
      candidate = JSON.parse(text) as unknown
    } catch {
      return null
    }
  }
  if (!isRecord(candidate)) return null

  const referenceImages = Array.isArray(candidate.referenceImages)
    ? candidate.referenceImages.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : undefined
  const directorPersona = readDirectorPersona(candidate.directorPersona)
  const styleId = readTrimmedString(candidate.styleId)
  const styleName = readTrimmedString(candidate.styleName)
  const stylePrompt = typeof candidate.stylePrompt === 'string' && candidate.stylePrompt.trim()
    ? candidate.stylePrompt.trim()
    : undefined
  const category = readTrimmedString(candidate.category)
  const next: ChapterCreativeOverride = {
    ...(styleId ? { styleId } : {}),
    ...(styleName ? { styleName } : {}),
    ...(stylePrompt ? { stylePrompt } : {}),
    ...(category ? { category } : {}),
    ...(referenceImages ? { referenceImages } : {}),
    ...(typeof directorPersona !== 'undefined' ? { directorPersona } : {}),
  }

  return Object.keys(next).length > 0 ? next : null
}

export function hasChapterStyleOverride(override: ChapterCreativeOverride | null): boolean {
  if (!override) return false
  return Boolean(
    override.styleId ||
    override.styleName ||
    override.stylePrompt ||
    override.category ||
    typeof override.referenceImages !== 'undefined',
  )
}

export function chapterOverrideToChatContext(
  override: ChapterCreativeOverride | null,
): ChapterStyleOverrideContext | null {
  if (!hasChapterStyleOverride(override)) return null
  return {
    ...(override?.styleId ? { styleId: override.styleId } : {}),
    ...(override?.styleName ? { styleName: override.styleName } : {}),
    ...(override?.stylePrompt ? { stylePrompt: override.stylePrompt } : {}),
    ...(override?.category ? { category: override.category } : {}),
    referenceImageCount: override?.referenceImages?.length ?? 0,
  }
}

export function chapterOverrideToLockedStyle(override: ChapterCreativeOverride | null): LockedStyle | null {
  if (!hasChapterStyleOverride(override)) return null
  const referenceImageUrl = override?.referenceImages?.find((url) => typeof url === 'string' && url.trim()) ?? null
  return {
    styleId: override?.styleId || 'chapter-custom',
    styleName: override?.styleName || '本章自定义风格',
    referenceImageUrl,
    stylePrompt: override?.stylePrompt || '',
    ...(override?.category ? { category: override.category } : {}),
  }
}

export function buildChapterOverrideWithStyle(
  current: ChapterCreativeOverride | null,
  style: LockedStyle | null,
): ChapterCreativeOverride | null {
  const next: ChapterCreativeOverride = { ...(current ?? {}) }
  delete next.styleId
  delete next.styleName
  delete next.stylePrompt
  delete next.category
  delete next.referenceImages

  if (style) {
    next.styleId = style.styleId
    next.styleName = style.styleName
    next.stylePrompt = style.stylePrompt
    if (style.category) next.category = style.category
    if (style.referenceImageUrl) next.referenceImages = [style.referenceImageUrl]
  }

  return Object.keys(next).length > 0 ? next : null
}

export function buildChapterOverrideWithDirector(
  current: ChapterCreativeOverride | null,
  directorPersona: ChapterCreativeOverride['directorPersona'],
): ChapterCreativeOverride | null {
  const next: ChapterCreativeOverride = { ...(current ?? {}) }
  if (directorPersona) next.directorPersona = directorPersona
  else delete next.directorPersona
  return Object.keys(next).length > 0 ? next : null
}
