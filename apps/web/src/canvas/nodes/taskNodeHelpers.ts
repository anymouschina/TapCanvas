import type React from 'react'
import { Position } from '@xyflow/react'
import type { TaskNodeHandlesConfig } from './taskNodeSchema'
import type { TaskResultDto } from '../../api/server'
import { REMOTE_IMAGE_URL_REGEX } from './taskNode/utils'

export const MAX_VEO_REFERENCE_IMAGES = 3
export const HANDLE_HORIZONTAL_OFFSET = 36
export const HANDLE_VERTICAL_OFFSET = 36
export const MAX_FRAME_ANALYSIS_SAMPLES = 60
export const CHARACTER_CLIP_MIN = 1.2
export const CHARACTER_CLIP_MAX = 3

export function normalizeVeoReferenceUrls(values: any): string[] {
  if (!Array.isArray(values)) return []
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    result.push(trimmed)
    if (result.length >= MAX_VEO_REFERENCE_IMAGES) break
  }
  return result
}

export type HandleLayout = { id: string; pos: Position }

export const computeHandleLayout = (handles: HandleLayout[]) => {
  const layout = new Map<string, { top?: string; left?: string }>()
  const grouped = new Map<Position, HandleLayout[]>()

  handles.forEach((handle) => {
    const key = handle.pos ?? Position.Left
    const group = grouped.get(key) || []
    group.push(handle)
    grouped.set(key, group)
  })

  grouped.forEach((group, pos) => {
    const total = group.length
    group.forEach((handle, index) => {
      if (pos === Position.Left || pos === Position.Right) {
        const topPercent = total === 1 ? 50 : ((index + 1) / (total + 1)) * 100
        layout.set(handle.id, { top: `${topPercent}%` })
      } else if (pos === Position.Top || pos === Position.Bottom) {
        const leftPercent = total === 1 ? 50 : ((index + 1) / (total + 1)) * 100
        layout.set(handle.id, { left: `${leftPercent}%` })
      }
    })
  })

  return layout
}

export const getHandlePositionName = (pos?: Position) => {
  if (pos === Position.Right) return 'right'
  if (pos === Position.Top) return 'top'
  if (pos === Position.Bottom) return 'bottom'
  return 'left'
}

export const buildHandleStyle = (
  handle: HandleLayout,
  layout: Map<string, { top?: string; left?: string }>,
) => {
  const pos = handle.pos ?? Position.Left
  const coords = layout.get(handle.id) || {}
  const style: React.CSSProperties = {
    position: 'absolute',
    pointerEvents: 'auto',
  }

  if (pos === Position.Left) {
    style.left = -HANDLE_HORIZONTAL_OFFSET
    style.top = coords.top ?? '50%'
  } else if (pos === Position.Right) {
    style.right = -HANDLE_HORIZONTAL_OFFSET
    style.top = coords.top ?? '50%'
  } else if (pos === Position.Top) {
    style.top = -HANDLE_VERTICAL_OFFSET
    style.left = coords.left ?? '50%'
  } else if (pos === Position.Bottom) {
    style.bottom = -HANDLE_VERTICAL_OFFSET
    style.left = coords.left ?? '50%'
  } else {
    style.top = coords.top ?? '50%'
    style.left = coords.left ?? '50%'
  }

  return style
}

export async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => {
      const result = reader.result
      resolve(typeof result === 'string' ? result : '')
    }
    reader.onerror = () => reject(new Error('Failed to convert blob to data URL'))
    reader.readAsDataURL(blob)
  })
}

export async function resolveImageForReversePrompt(
  url: string,
): Promise<{ imageUrl?: string; imageData?: string }> {
  const normalized = (url || '').trim()
  if (!normalized) return {}
  if (REMOTE_IMAGE_URL_REGEX.test(normalized) || normalized.startsWith('data:')) {
    return { imageUrl: normalized }
  }
  if (normalized.startsWith('blob:')) {
    try {
      const res = await fetch(normalized)
      if (!res.ok) {
        throw new Error('Failed to fetch blob URL')
      }
      const blob = await res.blob()
      const dataUrl = await blobToDataUrl(blob)
      if (dataUrl) {
        return { imageData: dataUrl }
      }
    } catch (error) {
      console.error('resolveImageForReversePrompt: failed to read blob URL', error)
      return {}
    }
  }
  return {}
}

export const genTaskNodeId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return (crypto as any).randomUUID()
  }
  return `n-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const formatMentionInsertion = (
  full: string,
  offset: number,
  matchLength: number,
  mention: string,
) => {
  const prevChar = offset > 0 ? full[offset - 1] : ''
  const nextChar = offset + matchLength < full.length ? full[offset + matchLength] : ''
  const needsLeadingSpace = prevChar ? !/\s/.test(prevChar) : false
  const needsTrailingSpace = nextChar ? !/\s/.test(nextChar) : false
  const leading = needsLeadingSpace ? ' ' : ''
  const trailing = needsTrailingSpace ? ' ' : ''
  return `${leading}${mention}${trailing}`
}

export const applyMentionFallback = (text: string, mention: string, aliases: string[]) => {
  let result = text
  let replaced = false
  const uniqueAliases = Array.from(
    new Set(aliases.filter((alias) => alias && alias.trim().length > 0)),
  )
  uniqueAliases.forEach((alias) => {
    const regex = new RegExp(escapeRegExp(alias), 'gi')
    if (regex.test(result)) {
      result = result.replace(regex, (match, offset, full) => {
        const source = typeof full === 'string' ? full : result
        const off = typeof offset === 'number' ? offset : 0
        return formatMentionInsertion(source, off, match.length, mention)
      })
      replaced = true
    }
  })
  if (!replaced && mention) {
    if (!result.includes(mention)) {
      const trimmedEnd = result.replace(/\s+$/, '')
      const needsSpaceBefore = trimmedEnd.length > 0 && !/\s$/.test(trimmedEnd)
      result = `${trimmedEnd}${needsSpaceBefore ? ' ' : ''}${mention} `
      replaced = true
    }
  }
  return { text: result, replaced }
}

const collectTextFromParts = (parts?: any): string => {
  if (!Array.isArray(parts)) return ''
  const buffer: string[] = []
  const pushPart = (part: any) => {
    if (!part) return
    if (typeof part === 'string' && part.trim()) {
      buffer.push(part.trim())
      return
    }
    const candidates: (string | undefined)[] = [
      typeof part.text === 'string' ? part.text : undefined,
      typeof part.content === 'string' ? part.content : undefined,
      typeof part.output_text === 'string' ? part.output_text : undefined,
      typeof part.value === 'string' ? part.value : undefined,
    ]
    candidates.forEach((text) => {
      if (text && text.trim()) {
        buffer.push(text.trim())
      }
    })
    if (Array.isArray(part.content)) {
      part.content.forEach(pushPart)
    }
  }
  parts.forEach(pushPart)
  return buffer.join('').trim()
}

export const extractTextFromResponsePayload = (payload: any): string => {
  if (!payload || typeof payload !== 'object') return ''

  if (typeof payload.text === 'string' && payload.text.trim()) {
    return payload.text.trim()
  }

  if (Array.isArray(payload.output_text)) {
    const merged = payload.output_text
      .map((entry: any) => (typeof entry === 'string' ? entry : ''))
      .join('')
      .trim()
    if (merged) return merged
  }

  if (Array.isArray(payload.output)) {
    const merged = payload.output
      .map((entry: any) => collectTextFromParts(entry?.content))
      .filter(Boolean)
      .join('\n')
      .trim()
    if (merged) return merged
  }

  if (Array.isArray(payload.content)) {
    const merged = collectTextFromParts(payload.content)
    if (merged) return merged
  }

  const choices = payload.choices
  if (Array.isArray(choices) && choices.length > 0) {
    const message = choices[0]?.message
    const choiceText =
      (typeof message?.content === 'string' && message.content.trim()) ||
      collectTextFromParts(message?.content) ||
      (typeof choices[0]?.text === 'string' ? choices[0].text.trim() : '')
    if (choiceText) return choiceText
  }

  const candidates = payload.candidates
  if (Array.isArray(candidates) && candidates.length > 0) {
    const merged = collectTextFromParts(candidates[0]?.content?.parts || candidates[0]?.content)
    if (merged) return merged
  }

  if (payload.result) {
    const nested = extractTextFromResponsePayload(payload.result)
    if (nested) return nested
  }

  return ''
}

export const extractTextFromTaskResult = (task?: TaskResultDto | null): string => {
  if (!task) return ''
  const raw = task.raw as any
  if (raw && typeof raw.text === 'string' && raw.text.trim()) {
    return raw.text.trim()
  }
  const fromResponse = extractTextFromResponsePayload(raw?.response || raw)
  if (fromResponse) return fromResponse
  return ''
}

export const tryParseJsonLike = (value: string): any | null => {
  const trimmed = value.trim()
  if (!trimmed) return null
  const candidates: string[] = []
  const codeBlock = trimmed.match(/```(?:json)?\s*([\s\S]+?)```/i)
  if (codeBlock && codeBlock[1].trim()) {
    candidates.push(codeBlock[1].trim())
  }
  const braceStart = trimmed.indexOf('{')
  const braceEnd = trimmed.lastIndexOf('}')
  if (braceStart !== -1 && braceEnd > braceStart) {
    candidates.push(trimmed.slice(braceStart, braceEnd + 1))
  }
  candidates.push(trimmed)
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate)
    } catch {
      // ignore parse error and try next candidate
    }
  }
  return null
}

export type FrameCompareSummary = {
  same: boolean | 'unknown'
  reason?: string
  tags?: string[]
  frames?: Array<{ time?: number; desc?: string }>
}

export const parseFrameCompareSummary = (value?: string | null): FrameCompareSummary | null => {
  if (!value) return null
  const parsed = tryParseJsonLike(value)
  if (!parsed || typeof parsed !== 'object') return null

  const normalizedSame = (() => {
    const rawSame = (parsed as any).same
    if (typeof rawSame === 'boolean') return rawSame
    if (typeof rawSame === 'string') {
      const lowered = rawSame.toLowerCase()
      if (lowered === 'true' || lowered === 'yes') return true
      if (lowered === 'false' || lowered === 'no') return false
      if (lowered === 'unknown' || lowered === 'uncertain') return 'unknown'
    }
    return 'unknown'
  })()

  const tags = Array.isArray((parsed as any).tags)
    ? (parsed as any).tags
        .map((tag: any) => (typeof tag === 'string' ? tag.trim() : ''))
        .filter((tag: string) => Boolean(tag))
    : undefined

  const frames = Array.isArray((parsed as any).frames)
    ? (parsed as any).frames
        .map((frame: any) => {
          const timeValue = typeof frame?.time === 'number' ? frame.time : Number(frame?.time)
          return {
            time: Number.isFinite(timeValue) ? timeValue : undefined,
            desc: typeof frame?.desc === 'string' ? frame.desc : undefined,
          }
        })
        .filter(
          (frame: { time?: number; desc?: string }) =>
            typeof frame.time === 'number' || Boolean(frame.desc),
        )
    : undefined

  const summary: FrameCompareSummary = {
    same: normalizedSame,
    reason: typeof (parsed as any).reason === 'string' ? (parsed as any).reason.trim() : undefined,
    tags: tags && tags.length > 0 ? tags : undefined,
    frames: frames && frames.length > 0 ? frames : undefined,
  }

  if (summary.same === 'unknown' && !summary.reason && !summary.tags && !summary.frames) {
    return null
  }
  return summary
}

export type CharacterCardJson = {
  characters: Array<{
    name?: string
    summary?: string
    tags?: string[]
    frames?: Array<{ time?: number; desc?: string }>
    keyframes?: { start?: number; end?: number }
  }>
}

export const parseCharacterCardResult = (value?: string | null): CharacterCardJson | null => {
  if (!value) return null
  const parsed = tryParseJsonLike(value)
  if (!parsed) return null
  const characters = Array.isArray((parsed as any).characters)
    ? (parsed as any).characters
    : Array.isArray(parsed)
      ? parsed
      : null
  if (!characters || characters.length === 0) return null
  return { characters }
}

export const clampCharacterClipWindow = (frames: Array<{ time: number }>, totalDuration?: number | null) => {
  if (!frames.length) {
    return { start: 0, end: CHARACTER_CLIP_MIN }
  }
  const safeDuration = typeof totalDuration === 'number' && Number.isFinite(totalDuration) && totalDuration > 0
    ? totalDuration
    : null
  let start = Number.isFinite(frames[0].time) ? frames[0].time : 0
  let end = Number.isFinite(frames[frames.length - 1].time) ? frames[frames.length - 1].time : start
  if (end < start) {
    const tmp = start
    start = end
    end = tmp
  }
  if (end - start < CHARACTER_CLIP_MIN) {
    end = start + CHARACTER_CLIP_MIN
  }
  if (end - start > CHARACTER_CLIP_MAX) {
    end = start + CHARACTER_CLIP_MAX
  }
  if (safeDuration !== null && end > safeDuration) {
    const delta = end - safeDuration
    end = safeDuration
    start = Math.max(0, start - delta)
  }
  if (start < 0) {
    const delta = -start
    start = 0
    end = safeDuration !== null ? Math.min(safeDuration, end + delta) : end + delta
  }
  if (end - start < CHARACTER_CLIP_MIN) {
    end = Math.min(start + CHARACTER_CLIP_MIN, safeDuration ?? start + CHARACTER_CLIP_MIN)
  }
  return { start, end }
}

export const isDynamicHandlesConfig = (
  handles?: TaskNodeHandlesConfig | null,
): handles is { dynamic: true } => Boolean(handles && 'dynamic' in handles && handles.dynamic)

export const isStaticHandlesConfig = (
  handles?: TaskNodeHandlesConfig | null,
): handles is Exclude<TaskNodeHandlesConfig, { dynamic: true }> =>
  Boolean(handles && (!('dynamic' in handles) || !handles.dynamic))
