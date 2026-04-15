import type { Node } from '@xyflow/react'
import { CanvasService } from '../../ai/canvasService'
import { getTaskNodeCoreType } from '../../canvas/nodes/taskNodeSchema'
import { getStoryboardEditorCellCount, normalizeStoryboardEditorGrid } from '../../canvas/nodes/taskNode/storyboardEditor'
import { hasPotentialImagePromptExecution } from '../../canvas/nodes/taskNode/imagePromptSpec'
import { useRFStore } from '../../canvas/store'

const AUTO_RUN_CORE_TYPES = new Set(['image', 'storyboard'])
const ACTIVE_STATUSES = new Set(['queued', 'running'])
const TERMINAL_SKIP_STATUSES = new Set(['success'])
const PATCHED_NODE_SKIP_STATUSES = new Set(['running', 'success', 'canceled'])
const RESULT_LIST_KEYS = ['imageResults', 'videoResults', 'audioResults', 'results', 'assets', 'outputs'] as const
const TASK_ID_KEYS = ['taskId', 'imageTaskId', 'videoTaskId'] as const

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function hasNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function hasResolvedAssetOutput(data: Record<string, unknown>): boolean {
  if (
    hasNonEmptyString(data.imageUrl) ||
    hasNonEmptyString(data.videoUrl) ||
    hasNonEmptyString(data.audioUrl)
  ) {
    return true
  }

  return RESULT_LIST_KEYS.some((key) => {
    const value = data[key]
    if (!Array.isArray(value)) return false
    return value.some((item) => {
      const record = asRecord(item)
      return Boolean(record && hasNonEmptyString(record.url))
    })
  })
}

function hasExistingExecutionMarker(data: Record<string, unknown>): boolean {
  return TASK_ID_KEYS.some((key) => hasNonEmptyString(data[key]))
}

function hasStoryboardPromptExecution(data: Record<string, unknown>): boolean {
  const rawCells = Array.isArray(data.storyboardEditorCells) ? data.storyboardEditorCells : []
  const grid = normalizeStoryboardEditorGrid(data.storyboardEditorGrid)
  const expectedCellCount = getStoryboardEditorCellCount(grid)
  if (rawCells.length < expectedCellCount) return false
  return rawCells.some((item) => {
    const record = asRecord(item)
    return Boolean(record && hasNonEmptyString(record.prompt))
  })
}

function hasAutoRunnableVisualExecution(kind: string | null, coreType: string | null, data: Record<string, unknown>): boolean {
  if (!coreType || !AUTO_RUN_CORE_TYPES.has(coreType)) return false
  if (coreType === 'storyboard' || kind === 'storyboard') {
    return hasStoryboardPromptExecution(data)
  }
  return hasPotentialImagePromptExecution(data)
}

export function shouldAutoRunAiChatNode(node: Node): boolean {
  const data = asRecord(node.data)
  if (!data) return false
  if (data.aiChatAutoRun === false) return false
  if (data.skipDagRun === true) return false

  const kind = hasNonEmptyString(data.kind) ? data.kind.trim() : null
  const coreType = getTaskNodeCoreType(kind)
  if (!AUTO_RUN_CORE_TYPES.has(coreType)) return false

  const status = hasNonEmptyString(data.status) ? data.status.trim().toLowerCase() : ''
  if (ACTIVE_STATUSES.has(status) || TERMINAL_SKIP_STATUSES.has(status)) return false
  if (hasExistingExecutionMarker(data) || hasResolvedAssetOutput(data)) return false

  return hasAutoRunnableVisualExecution(kind, coreType, data)
}

export function collectAiChatAutoRunNodeIds(input: {
  nodes: Node[]
  candidateNodeIds: string[]
}): string[] {
  const nodesById = new Map(
    input.nodes.map((node) => [String(node.id || '').trim(), node] as const).filter(([nodeId]) => Boolean(nodeId)),
  )
  const out: string[] = []
  const seen = new Set<string>()

  for (const rawNodeId of input.candidateNodeIds) {
    const nodeId = String(rawNodeId || '').trim()
    if (!nodeId || seen.has(nodeId)) continue
    const node = nodesById.get(nodeId)
    if (!node || !shouldAutoRunAiChatNode(node)) continue
    seen.add(nodeId)
    out.push(nodeId)
  }

  return out
}

export function shouldAutoRunAiChatPatchedNode(node: Node): boolean {
  const data = asRecord(node.data)
  if (!data) return false
  if (data.aiChatAutoRun === false) return false
  if (data.skipDagRun === true) return false

  const kind = hasNonEmptyString(data.kind) ? data.kind.trim() : null
  const coreType = getTaskNodeCoreType(kind)
  if (!AUTO_RUN_CORE_TYPES.has(coreType)) return false

  const status = hasNonEmptyString(data.status) ? data.status.trim().toLowerCase() : ''
  if (PATCHED_NODE_SKIP_STATUSES.has(status)) return false
  if (hasExistingExecutionMarker(data) || hasResolvedAssetOutput(data)) return false

  return hasAutoRunnableVisualExecution(kind, coreType, data)
}

export function collectAiChatPatchedNodeIds(input: {
  nodes: Node[]
  candidateNodeIds: string[]
}): string[] {
  const nodesById = new Map(
    input.nodes.map((node) => [String(node.id || '').trim(), node] as const).filter(([nodeId]) => Boolean(nodeId)),
  )
  const out: string[] = []
  const seen = new Set<string>()

  for (const rawNodeId of input.candidateNodeIds) {
    const nodeId = String(rawNodeId || '').trim()
    if (!nodeId || seen.has(nodeId)) continue
    const node = nodesById.get(nodeId)
    if (!node || !shouldAutoRunAiChatPatchedNode(node)) continue
    seen.add(nodeId)
    out.push(nodeId)
  }

  return out
}

export function autoRunAiChatCanvasNodes(candidateNodeIds: string[]): void {
  const nodeIds = collectAiChatAutoRunNodeIds({
    nodes: useRFStore.getState().nodes,
    candidateNodeIds,
  })

  nodeIds.forEach((nodeId) => {
    void CanvasService.runNode({ nodeId }).catch((error: unknown) => {
      console.warn('[ai-chat] auto-run canvas node failed', nodeId, error)
    })
  })
}

export function autoRunAiChatPatchedCanvasNodes(candidateNodeIds: string[]): void {
  const nodeIds = collectAiChatPatchedNodeIds({
    nodes: useRFStore.getState().nodes,
    candidateNodeIds,
  })

  nodeIds.forEach((nodeId) => {
    void CanvasService.runNode({ nodeId }).catch((error: unknown) => {
      console.warn('[ai-chat] auto-run patched canvas node failed', nodeId, error)
    })
  })
}
