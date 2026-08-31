import {
  getTaskNodeCoreType,
  normalizeTaskNodeKind,
  type TaskNodeKind,
} from '../canvas/nodes/taskNodeSchema'

export type ExecutionPromptSourceCategory = 'image' | 'video' | 'text'

const IMAGE_PROMPT_SOURCE_KINDS = new Set<TaskNodeKind>([
  'image',
  'imageEdit',
  'storyboard',
])

function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readLatestTextResult(value: unknown): string {
  if (!Array.isArray(value)) return ''
  for (let index = value.length - 1; index >= 0; index -= 1) {
    const item = value[index]
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const text = readTrimmedString((item as Record<string, unknown>).text)
    if (text) return text
  }
  return ''
}

/**
 * Resolves a canvas node through the unified task-node schema before deciding
 * whether it can supply an execution prompt. Unknown kinds stay unsupported;
 * they are never silently treated as text.
 */
export function resolveExecutionPromptSourceCategory(
  rawKind: unknown,
): ExecutionPromptSourceCategory | null {
  if (typeof rawKind !== 'string') return null
  const normalizedKind = normalizeTaskNodeKind(rawKind)
  if (!normalizedKind) return null
  if (IMAGE_PROMPT_SOURCE_KINDS.has(normalizedKind)) return 'image'

  const coreType = getTaskNodeCoreType(normalizedKind)
  if (coreType === 'video') return 'video'
  if (coreType === 'text') return 'text'
  return null
}

/**
 * Text-core nodes share the same outbound prompt contract. A shot table keeps
 * its applied serialized table in `shotTableRawText`; read that first so a
 * valid table remains executable even when an older canvas lacks the mirrored
 * `prompt` field.
 */
export function collectTextExecutionPromptCandidates(
  rawKind: unknown,
  data: Record<string, unknown>,
): string[] {
  if (resolveExecutionPromptSourceCategory(rawKind) !== 'text') return []
  const normalizedKind = normalizeTaskNodeKind(typeof rawKind === 'string' ? rawKind : null)
  if (!normalizedKind) return []

  if (normalizedKind === 'shotTable') {
    const appliedTable = readTrimmedString(data.shotTableRawText)
    if (appliedTable) return [appliedTable]
  }

  const candidates = [
    readTrimmedString(data.prompt),
    readTrimmedString(data.text),
    readTrimmedString(data.content),
    readLatestTextResult(data.textResults),
  ]

  return candidates.filter(Boolean)
}
