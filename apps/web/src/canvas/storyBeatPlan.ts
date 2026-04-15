export type StoryBeatPlanBeat = {
  summary: string
  beatRole?: string
  rhythm?: string
  durationSec?: number
  motionIntensity?: string
  continuity?: string
  cameraMotion?: string
}

export type StoryBeatPlanItem = string | StoryBeatPlanBeat

const MAX_STORY_BEATS = 24

function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeDurationSec(value: unknown): number | undefined {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined
  return Math.max(1, Math.min(30, Math.trunc(parsed)))
}

function isBeatRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function readBeatField(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const text = asTrimmedString(record[key])
    if (text) return text
  }
  return ''
}

function normalizeBeatRecord(record: Record<string, unknown>): StoryBeatPlanBeat | null {
  const summary = readBeatField(record, ['summary', 'content', 'text', 'label', 'beat', 'storyBeat'])
  if (!summary) return null
  const normalized: StoryBeatPlanBeat = { summary }
  const beatRole = readBeatField(record, ['beatRole', 'beat_role', 'role'])
  const rhythm = readBeatField(record, ['rhythm', 'rhythmRole', 'rhythm_role'])
  const motionIntensity = readBeatField(record, ['motionIntensity', 'motion_intensity', 'motion'])
  const continuity = readBeatField(record, ['continuity', 'continuityNote', 'continuity_note'])
  const cameraMotion = readBeatField(record, ['cameraMotion', 'camera_motion'])
  const durationSec = normalizeDurationSec(record.durationSec ?? record.duration ?? record.duration_sec)
  if (beatRole) normalized.beatRole = beatRole
  if (rhythm) normalized.rhythm = rhythm
  if (durationSec) normalized.durationSec = durationSec
  if (motionIntensity) normalized.motionIntensity = motionIntensity
  if (continuity) normalized.continuity = continuity
  if (cameraMotion) normalized.cameraMotion = cameraMotion
  return normalized
}

function parseKeyValueSegment(segment: string): { key: string; value: string } | null {
  const match = segment.match(/^([^:=：]+)\s*[:=：]\s*(.+)$/)
  if (!match) return null
  const key = match[1]?.trim().toLowerCase() || ''
  const value = match[2]?.trim() || ''
  if (!key || !value) return null
  return { key, value }
}

function applyParsedField(target: StoryBeatPlanBeat, key: string, value: string) {
  if (['summary', '内容', '拍点', '镜头', 'text', 'content'].includes(key)) {
    target.summary = value
    return
  }
  if (['beatrole', 'beat_role', '功能', '阶段', 'role'].includes(key)) {
    target.beatRole = value
    return
  }
  if (['rhythm', '节奏', 'rhythmrole', 'rhythm_role'].includes(key)) {
    target.rhythm = value
    return
  }
  if (['duration', 'durationsec', 'duration_sec', '时长'].includes(key)) {
    const normalized = normalizeDurationSec(value.replace(/s$/i, ''))
    if (normalized) target.durationSec = normalized
    return
  }
  if (['motion', 'motionintensity', 'motion_intensity', '运动', '强度'].includes(key)) {
    target.motionIntensity = value
    return
  }
  if (['continuity', '承接', '连续性'].includes(key)) {
    target.continuity = value
    return
  }
  if (['camera', 'cameramotion', 'camera_motion', '运镜', '机位'].includes(key)) {
    target.cameraMotion = value
  }
}

function parseStoryBeatPlanLine(line: string): StoryBeatPlanItem | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  const segments = trimmed.split('|').map((segment) => segment.trim()).filter(Boolean)
  if (!segments.length) return null

  if (segments.length === 1) return segments[0]

  const beat: StoryBeatPlanBeat = { summary: '' }
  for (const segment of segments) {
    const parsed = parseKeyValueSegment(segment)
    if (parsed) {
      applyParsedField(beat, parsed.key, parsed.value)
      continue
    }
    if (!beat.summary) beat.summary = segment
  }
  return beat.summary ? beat : trimmed
}

export function normalizeStoryBeatPlan(value: unknown): StoryBeatPlanItem[] {
  if (Array.isArray(value)) {
    const out: StoryBeatPlanItem[] = []
    for (const item of value) {
      if (typeof item === "string") {
        const text = item.trim()
        if (!text) continue
        out.push(text)
      } else if (isBeatRecord(item)) {
        const beat = normalizeBeatRecord(item)
        if (beat) out.push(beat)
      }
      if (out.length >= MAX_STORY_BEATS) break
    }
    return out
  }
  if (typeof value !== 'string') return []
  return value
    .split(/\r?\n/)
    .map(parseStoryBeatPlanLine)
    .filter((item): item is StoryBeatPlanItem => Boolean(item))
    .slice(0, MAX_STORY_BEATS)
}

export function formatStoryBeatPlanItem(item: StoryBeatPlanItem): string {
  if (typeof item === 'string') return item.trim()
  const parts = [item.summary.trim()]
  if (item.rhythm) parts.push(`节奏=${item.rhythm}`)
  if (item.durationSec) parts.push(`时长=${item.durationSec}s`)
  if (item.motionIntensity) parts.push(`运动=${item.motionIntensity}`)
  if (item.cameraMotion) parts.push(`运镜=${item.cameraMotion}`)
  if (item.continuity) parts.push(`承接=${item.continuity}`)
  if (item.beatRole) parts.push(`阶段=${item.beatRole}`)
  return parts.filter(Boolean).join(' | ')
}

export function serializeStoryBeatPlan(value: unknown): string {
  return normalizeStoryBeatPlan(value).map(formatStoryBeatPlanItem).join('\n')
}

export function summarizeStoryBeatPlan(value: unknown, limit = 8): string {
  return normalizeStoryBeatPlan(value)
    .slice(0, limit)
    .map((item) => {
      if (typeof item === 'string') return item
      const meta: string[] = []
      if (item.rhythm) meta.push(item.rhythm)
      if (item.durationSec) meta.push(`${item.durationSec}s`)
      return meta.length ? `${item.summary}（${meta.join(' / ')}）` : item.summary
    })
    .filter(Boolean)
    .join('；')
}

export function storyBeatPlanToPromptText(value: unknown): string {
  return normalizeStoryBeatPlan(value)
    .map((item, index) => {
      if (typeof item === 'string') return item
      const parts = [`镜头${index + 1}：${item.summary}`]
      if (item.rhythm) parts.push(`节奏=${item.rhythm}`)
      if (item.durationSec) parts.push(`时长=${item.durationSec}秒`)
      if (item.motionIntensity) parts.push(`运动强度=${item.motionIntensity}`)
      if (item.cameraMotion) parts.push(`运镜=${item.cameraMotion}`)
      if (item.continuity) parts.push(`承接=${item.continuity}`)
      return parts.join('，')
    })
    .filter(Boolean)
    .join('；')
}
