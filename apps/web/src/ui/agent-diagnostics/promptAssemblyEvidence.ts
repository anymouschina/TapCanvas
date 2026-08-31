import type {
  ExecutionPromptAssembly,
  ExecutionPromptAssemblySource,
  ExecutionPromptAssemblyStep,
} from './executionGraph.types'

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readString(record: Record<string, unknown> | null, key: string): string {
  const value = record?.[key]
  return typeof value === 'string' ? value.trim() : ''
}

function readNullableString(record: Record<string, unknown> | null, key: string): string | null {
  const value = record?.[key]
  return value === null ? null : typeof value === 'string' && value.trim() ? value : null
}

function readStringArray(record: Record<string, unknown> | null, key: string): string[] | null {
  const value = record?.[key]
  if (!Array.isArray(value)) return null
  const strings = value.map((item) => typeof item === 'string' ? item.trim() : '')
  return strings.every(Boolean) ? strings : null
}

function readSource(value: unknown): ExecutionPromptAssemblySource | null {
  const record = readRecord(value)
  const kind = record?.kind
  const status = record?.status
  if (
    !record ||
    !['user_contract', 'generation_contract', 'project_fact', 'clip_fact', 'skill', 'skill_reference', 'writer_output', 'compiler', 'asset_binding'].some((candidate) => candidate === kind) ||
    !['applied', 'not_used', 'pending', 'unavailable'].some((candidate) => candidate === status)
  ) return null
  const id = readString(record, 'id')
  const label = readString(record, 'label')
  const ref = readString(record, 'ref')
  const summary = readString(record, 'summary')
  if (!id || !label || !ref || !summary) return null
  return {
    id,
    label,
    kind: kind as ExecutionPromptAssemblySource['kind'],
    ref,
    status: status as ExecutionPromptAssemblySource['status'],
    summary,
  }
}

function readStep(value: unknown): ExecutionPromptAssemblyStep | null {
  const record = readRecord(value)
  const order = Number(record?.order)
  const id = readString(record, 'id')
  const title = readString(record, 'title')
  const explanation = readString(record, 'explanation')
  const sourceIds = readStringArray(record, 'sourceIds')
  if (!id || !title || !explanation || !Number.isInteger(order) || order <= 0 || !sourceIds) return null
  return { id, order, title, explanation, sourceIds }
}

export function readPromptAssembly(value: unknown): ExecutionPromptAssembly | null {
  const record = readRecord(value)
  const clipIndex = Number(record?.clipIndex)
  const state = record?.state
  if (
    record?.version !== 2 ||
    !Number.isInteger(clipIndex) || clipIndex < 0 ||
    !['complete', 'partial', 'pending'].some((candidate) => candidate === state)
  ) return null
  const artifactKey = readString(record, 'artifactKey')
  const assemblySummary = readString(record, 'assemblySummary')
  const sources = Array.isArray(record.sources) ? record.sources.map(readSource) : []
  const steps = Array.isArray(record.steps) ? record.steps.map(readStep) : []
  if (!artifactKey || !assemblySummary || sources.some((item) => item === null) || steps.some((item) => item === null)) return null
  const finalPromptRecord = readRecord(record.finalPrompt)
  const contractSnapshotRecord = readRecord(record.contractSnapshot)
  if (!contractSnapshotRecord) return null
  const dialogueScriptJson = readString(contractSnapshotRecord, 'dialogueScriptJson')
  if (!dialogueScriptJson) return null
  const contractSnapshot: ExecutionPromptAssembly['contractSnapshot'] = {
    sourceSpanText: readNullableString(contractSnapshotRecord, 'sourceSpanText'),
    dialogueScriptJson,
    temporalContextJson: readNullableString(contractSnapshotRecord, 'temporalContextJson'),
    sceneStateJson: readNullableString(contractSnapshotRecord, 'sceneStateJson'),
    characterStatesJson: readNullableString(contractSnapshotRecord, 'characterStatesJson'),
    characterStateVersionsJson: readNullableString(contractSnapshotRecord, 'characterStateVersionsJson'),
    startKeyframe: readNullableString(contractSnapshotRecord, 'startKeyframe'),
    endKeyframe: readNullableString(contractSnapshotRecord, 'endKeyframe'),
    previousExitState: readNullableString(contractSnapshotRecord, 'previousExitState'),
    exitState: readNullableString(contractSnapshotRecord, 'exitState'),
    writerOutputJson: readNullableString(contractSnapshotRecord, 'writerOutputJson'),
  }
  const characterCount = Number(finalPromptRecord?.characterCount)
  const finalPrompt = finalPromptRecord
    ? {
        label: readString(finalPromptRecord, 'label'),
        characterCount,
        text: readString(finalPromptRecord, 'text'),
        hash: readString(finalPromptRecord, 'hash') || null,
      }
    : null
  if (finalPrompt && (!finalPrompt.label || !Number.isInteger(characterCount) || characterCount < 0 || !finalPrompt.text)) return null
  return {
    version: 2,
    artifactKey,
    clipIndex,
    state: state as ExecutionPromptAssembly['state'],
    assemblySummary,
    steps: (steps as ExecutionPromptAssemblyStep[]).sort((left, right) => left.order - right.order),
    sources: sources as ExecutionPromptAssemblySource[],
    contractSnapshot,
    finalPrompt,
  }
}
