import type React from 'react'
import { Position } from '@xyflow/react'
import type { TaskNodeHandlesConfig } from './taskNodeSchema'
import type { TaskResultDto } from '../../api/server'

export const MAX_VEO_REFERENCE_IMAGES = 3
export const HANDLE_HORIZONTAL_OFFSET = 36
export const HANDLE_VERTICAL_OFFSET = 36
export const CHARACTER_CLIP_MIN = 1.2
export const CHARACTER_CLIP_MAX = 3

export type VisualNodeDefaults = {
  width: number
  height: number
  minWidth: number
  maxWidth: number
  minHeight: number
  maxHeight: number
}

export const TEXT_NODE_DEFAULT_WIDTH = 350
export const TEXT_NODE_MIN_WIDTH = 300
export const TEXT_NODE_MAX_WIDTH = 620
export const TEXT_NODE_DEFAULT_HEIGHT = 350
export const TEXT_NODE_MIN_HEIGHT = 240
export const TEXT_NODE_MAX_HEIGHT = 680

export function getTextNodeSize(data: Record<string, unknown> | null | undefined): { width: number; height: number } {
  return {
    width: clampVisualDimension(data?.nodeWidth, TEXT_NODE_MIN_WIDTH, TEXT_NODE_MAX_WIDTH, TEXT_NODE_DEFAULT_WIDTH),
    height: clampVisualDimension(data?.nodeHeight, TEXT_NODE_MIN_HEIGHT, TEXT_NODE_MAX_HEIGHT, TEXT_NODE_DEFAULT_HEIGHT),
  }
}

// Single source of truth for visual (image / video / storyboard-editor) node base dimensions.
// Shared by the focused TaskNode body and the lightweight TaskNodeSkeleton shell so a node keeps
// the SAME width/height before and after focus — otherwise the LOD swap snaps between two different
// hardcoded defaults (the shell used to fall back to 360-wide / minHeight 160 while the body used
// 120×210, producing a visible jump on focus).
export function getVisualNodeDefaults(kind: string, coreKind: string, isStoryboardEditor: boolean): VisualNodeDefaults {
  if (kind === 'videoAnalysis') return { width: 320, height: 393, minWidth: 320, maxWidth: 820, minHeight: 393, maxHeight: 820 }
  if (kind === 'shotTable') return { width: 920, height: 620, minWidth: 640, maxWidth: 1400, minHeight: 480, maxHeight: 960 }
  if (coreKind === 'video') return { width: 622, height: 350, minWidth: 300, maxWidth: 960, minHeight: 169, maxHeight: 720 }
  if (isStoryboardEditor) return { width: 560, height: 470, minWidth: 360, maxWidth: 960, minHeight: 260, maxHeight: 760 }
  if (kind === 'imageEdit') return { width: 622, height: 350, minWidth: 300, maxWidth: 960, minHeight: 169, maxHeight: 720 }
  // width×height defines the unified TARGET AREA every auto-sized image node fits to (see
  // fitVisualSizeToNatural) — so all generated image nodes land at the same on-canvas size for a
  // given aspect (e.g. 16:9 → 622×350), regardless of which creation path made them.
  return { width: 622, height: 350, minWidth: 300, maxWidth: 960, minHeight: 169, maxHeight: 960 }
}

// Clamp a persisted node dimension into the node's valid range, falling back to the default when
// the stored value is missing/non-finite. Mirrors the body's clampFinite so shell and body resolve
// identical pixels from the same data.nodeWidth / data.nodeHeight.
export function clampVisualDimension(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.round(n)))
}

// Fit a visual node's box to its media's natural aspect ratio at the node kind's UNIFIED TARGET AREA
// (d.width × d.height), clamped into the valid range. Using the target area — rather than the node's
// own current area — is what makes every auto-sized node of a kind render at the same on-canvas size
// for a given aspect, no matter how it was created or what stale size it carries. This is the SAME
// computation the focused body runs on media load (handleMediaNaturalSize) and the shell pre-applies,
// so before/after focus are identical. Manually-resized nodes (data.nodeSizeManual) bypass this and
// keep their explicit size — callers gate on that flag.
export function fitVisualSizeToNatural(
  currentWidth: number,
  currentHeight: number,
  naturalWidth: number,
  naturalHeight: number,
  d: VisualNodeDefaults,
): { width: number; height: number } {
  if (!(naturalWidth > 0) || !(naturalHeight > 0) || !(currentWidth > 0) || !(currentHeight > 0)) {
    return { width: currentWidth, height: currentHeight }
  }
  const naturalRatio = naturalWidth / naturalHeight
  const targetArea = d.width * d.height
  let nextWidth = Math.sqrt(targetArea * naturalRatio)
  let nextHeight = nextWidth / naturalRatio
  if (nextWidth > d.maxWidth) { nextWidth = d.maxWidth; nextHeight = nextWidth / naturalRatio }
  if (nextHeight > d.maxHeight) { nextHeight = d.maxHeight; nextWidth = nextHeight * naturalRatio }
  if (nextWidth < d.minWidth) { nextWidth = d.minWidth; nextHeight = nextWidth / naturalRatio }
  if (nextHeight < d.minHeight) { nextHeight = d.minHeight; nextWidth = nextHeight * naturalRatio }
  return {
    width: clampVisualDimension(nextWidth, d.minWidth, d.maxWidth, currentWidth),
    height: clampVisualDimension(nextHeight, d.minHeight, d.maxHeight, currentHeight),
  }
}

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
  offsets: Readonly<{ horizontal: number; vertical: number }> = {
    horizontal: HANDLE_HORIZONTAL_OFFSET,
    vertical: HANDLE_VERTICAL_OFFSET,
  },
) => {
  const pos = handle.pos ?? Position.Left
  const coords = layout.get(handle.id) || {}
  const style: React.CSSProperties = {
    position: 'absolute',
    pointerEvents: 'auto',
  }

  if (pos === Position.Left) {
    style.left = -offsets.horizontal
    style.top = coords.top ?? '50%'
  } else if (pos === Position.Right) {
    style.right = -offsets.horizontal
    style.top = coords.top ?? '50%'
  } else if (pos === Position.Top) {
    style.top = -offsets.vertical
    style.left = coords.left ?? '50%'
  } else if (pos === Position.Bottom) {
    style.bottom = -offsets.vertical
    style.left = coords.left ?? '50%'
  } else {
    style.top = coords.top ?? '50%'
    style.left = coords.left ?? '50%'
  }

  return style
}

export const genTaskNodeId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return (crypto as any).randomUUID()
  }
  return `n-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
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

export const isDynamicHandlesConfig = (
  handles?: TaskNodeHandlesConfig | null,
): handles is { dynamic: true } => Boolean(handles && 'dynamic' in handles && handles.dynamic)

export const isStaticHandlesConfig = (
  handles?: TaskNodeHandlesConfig | null,
): handles is Exclude<TaskNodeHandlesConfig, { dynamic: true }> =>
  Boolean(handles && (!('dynamic' in handles) || !handles.dynamic))
