import { useRFStore } from './store'
import { mergePresetData } from './nodePresetRegistry'
import type { FlowPatchToolCall } from './batchBuffer'
import { getTaskNodeCoreType } from './nodes/taskNodeSchema'
import { getNodeAbsPosition, getNodeSize } from './utils/nodeBounds'
import { resolveNonOverlappingPosition } from './store'

function makeEdgeId(source: string, target: string, role?: string): string {
  return role
    ? `e-${source}-${target}-${role}`
    : `e-${source}-${target}`
}

function nodeById(id: string) {
  return useRFStore.getState().nodes.find((n) => n.id === id)
}

function getNodeCoreType(node: ReturnType<typeof nodeById>): string | null {
  if (!node || node.type !== 'taskNode') return null
  const data = node.data
  if (!data || typeof data !== 'object') return null
  const kind = (data as Record<string, unknown>).kind
  return getTaskNodeCoreType(typeof kind === 'string' ? kind : null)
}

function normalizeFlowPatchTargetHandle(targetNode: ReturnType<typeof nodeById>, targetHandle: string | undefined): string | undefined {
  const targetCoreType = getNodeCoreType(targetNode)
  if (
    targetCoreType === 'video' &&
    (targetHandle === 'in-image' || targetHandle === 'in-video')
  ) {
    return 'in-any'
  }
  return targetHandle
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isGenerateVideoNodePatch(kind: string, data: Record<string, unknown>): boolean {
  if (getTaskNodeCoreType(kind) !== 'video') return false
  const creationStage = readTrimmedString(data.creationStage)
  return (
    creationStage === 'intent_generate_video_nodes' ||
    creationStage === 'intent_generate_video_nodes_from_text'
  )
}

function resolveFlowPatchNodeFootprint(kind: string): { w: number; h: number } {
  const coreType = getTaskNodeCoreType(kind)
  if (coreType === 'text') return { w: 360, h: 180 }
  return { w: 400, h: 220 }
}

// 智能布局依据：按节点类型从左到右分列（text → image → storyboard → video），
// 同一类型在该列里纵向单列向下堆叠。agent 编排时新建的节点不再"放在来源右侧"
// 横向铺成长条，而是各归各的类型列，整齐成管线状。
const TYPE_COLUMN_ORDER: Record<string, number> = { text: 0, image: 1, storyboard: 2, video: 3 }
const TYPE_COL_WIDTH = 460
const TYPE_COL_GAP = 4
const TYPE_ROW_HEIGHT = 260
const TYPE_ROW_GAP = 4
const TYPE_BASE_X = 96
const TYPE_BASE_Y = 96

function resolveTypeColumnIndex(kind: string): number {
  const core = getTaskNodeCoreType(kind)
  return TYPE_COLUMN_ORDER[core] ?? TYPE_COLUMN_ORDER.image
}

function resolveFlowPatchAddNodePosition(params: {
  nodes: ReturnType<typeof useRFStore.getState>['nodes']
  kind: string
  requestedPosition: { x: number; y: number } | undefined
  data: Record<string, unknown>
}): { x: number; y: number } {
  const footprint = resolveFlowPatchNodeFootprint(params.kind)
  const core = getTaskNodeCoreType(params.kind)
  const col = resolveTypeColumnIndex(params.kind)
  // 同列（同 coreType）已有的顶层节点数 → 该节点在列内的行号；忽略已在组内的子节点。
  const rowIndex = params.nodes.filter((node) => {
    const parentId = (node as { parentId?: unknown }).parentId
    if (typeof parentId === 'string' && parentId.trim()) return false
    const k = typeof (node.data as Record<string, unknown> | undefined)?.kind === 'string'
      ? ((node.data as Record<string, unknown>).kind as string)
      : ''
    return getTaskNodeCoreType(k) === core
  }).length
  const preferred = {
    x: TYPE_BASE_X + col * (TYPE_COL_WIDTH + TYPE_COL_GAP),
    y: TYPE_BASE_Y + rowIndex * (TYPE_ROW_HEIGHT + TYPE_ROW_GAP),
  }
  return resolveNonOverlappingPosition(
    params.nodes,
    preferred,
    footprint,
    null,
    useRFStore.getState().userMovedNodeIds,
  )
}

function resolveDerivedVideoPosition(params: {
  nodes: ReturnType<typeof useRFStore.getState>['nodes']
  kind: string
  position: { x: number; y: number }
  data: Record<string, unknown>
}): { x: number; y: number } {
  // 类型分列布局已统一把视频归到「视频列」，不再把图生视频节点甩到来源图右侧。
  return params.position
}

// Batch row cursors: keyed by `${batchUlid}:${sourceNodeId}` so same-source siblings
// share one 2D grid instead of scattering via the spiral overlap search.
type BatchGridCursor = {
  startX: number   // 行首 x（换行后回到此处）
  x: number        // 当前插入 x
  y: number        // 当前插入 y
  col: number      // 当前列（0-based）
  rowH: number     // 当前行已积累的最大高度
}

const MAX_BATCH_COLS = 4
const BATCH_ITEM_GAP = 24

const batchRowCursors = new Map<string, BatchGridCursor>()

function advanceBatchCursor(cursor: BatchGridCursor, nodeW: number, nodeH: number): void {
  cursor.rowH = Math.max(cursor.rowH, nodeH)
  cursor.col += 1
  if (cursor.col >= MAX_BATCH_COLS) {
    cursor.col = 0
    cursor.x = cursor.startX
    cursor.y += cursor.rowH + BATCH_ITEM_GAP
    cursor.rowH = 0
  } else {
    cursor.x += nodeW + BATCH_ITEM_GAP
  }
}

export function clearBatchRowCursor(batchUlid: string): void {
  for (const key of batchRowCursors.keys()) {
    if (key.startsWith(`${batchUlid}:`)) batchRowCursors.delete(key)
  }
}

export function applySingleFlowPatch(call: FlowPatchToolCall, batchUlid?: string, dispatchSourceNodeId?: string): void {
  if (call.name === 'add_node') {
    const { id, kind, preset, position, content, data } = call.args
    const mergedData = mergePresetData(kind, preset, { kind, preset, ...(content ?? data ?? {}) })
    const safeMergedData = isRecord(mergedData) ? mergedData : {}
    // Prefer the sourceNodeId from dispatch context — agent may omit it in patch data.
    const sourceNodeId = dispatchSourceNodeId || readTrimmedString(safeMergedData.sourceNodeId)

    const currentNodes = useRFStore.getState().nodes
    if (currentNodes.some((n) => n.id === id)) return

    let resolvedPosition: { x: number; y: number }

    if (batchUlid && sourceNodeId) {
      const cursorKey = `${batchUlid}:${sourceNodeId}`
      const cursor = batchRowCursors.get(cursorKey)
      const footprint = resolveFlowPatchNodeFootprint(kind)
      if (!cursor) {
        const nodesById = new Map(currentNodes.map((node) => [node.id, node] as const))
        const sourceNode = nodesById.get(sourceNodeId)
        if (sourceNode) {
          const sourcePos = getNodeAbsPosition(sourceNode, nodesById)
          const srcSize = getNodeSize(sourceNode)
          const preferredStart = { x: sourcePos.x + srcSize.w + 48, y: sourcePos.y }
          resolvedPosition = resolveNonOverlappingPosition(
            currentNodes,
            preferredStart,
            footprint,
            null,
            useRFStore.getState().userMovedNodeIds,
          )
          const initCursor: BatchGridCursor = {
            startX: resolvedPosition.x,
            x: resolvedPosition.x,
            y: resolvedPosition.y,
            col: 0,
            rowH: footprint.h,
          }
          advanceBatchCursor(initCursor, footprint.w, footprint.h)
          batchRowCursors.set(cursorKey, initCursor)
        } else {
          resolvedPosition = resolveFlowPatchAddNodePosition({ nodes: currentNodes, kind, requestedPosition: position, data: safeMergedData })
          resolvedPosition = resolveDerivedVideoPosition({ nodes: currentNodes, kind, position: resolvedPosition, data: safeMergedData })
        }
      } else {
        resolvedPosition = resolveNonOverlappingPosition(
          currentNodes,
          { x: cursor.x, y: cursor.y },
          footprint,
          null,
          useRFStore.getState().userMovedNodeIds,
        )
        advanceBatchCursor(cursor, footprint.w, footprint.h)
      }
    } else {
      resolvedPosition = resolveFlowPatchAddNodePosition({ nodes: currentNodes, kind, requestedPosition: position, data: safeMergedData })
      resolvedPosition = resolveDerivedVideoPosition({ nodes: currentNodes, kind, position: resolvedPosition, data: safeMergedData })
    }

    useRFStore.setState((s) => {
      if (s.nodes.some((n) => n.id === id)) return s
      return {
        ...s,
        nodes: [
          ...s.nodes,
          {
            id,
            type: 'taskNode',
            position: resolvedPosition,
            data: mergedData as any,
          } as any,
        ],
      }
    })
    return
  }

  if (call.name === 'connect_edge') {
    const { source, target, sourceHandle, targetHandle } = call.args
    useRFStore.setState((s) => {
      const eid = makeEdgeId(source, target)
      if (s.edges.some((e) => e.id === eid)) return s
      const targetNode = s.nodes.find((n) => n.id === target)
      return {
        ...s,
        edges: [
          ...s.edges,
          {
            id: eid,
            source,
            target,
            sourceHandle,
            targetHandle: normalizeFlowPatchTargetHandle(targetNode, targetHandle),
          } as any,
        ],
      }
    })
    return
  }

  if (call.name === 'set_param') {
    const { nodeId, patch } = call.args
    const target = nodeById(nodeId)
    if (!target) return
    if ((target.data as any)?.readOnly === true) {
      return
    }
    useRFStore.setState((s) => ({
      ...s,
      nodes: s.nodes.map((n) =>
        n.id === nodeId
          ? { ...n, data: { ...(n.data as any), ...patch } as any }
          : n,
      ),
    }))
    return
  }

  if (call.name === 'link_existing_asset') {
    const { targetNodeId, existingNodeId, role } = call.args
    useRFStore.setState((s) => {
      const eid = makeEdgeId(existingNodeId, targetNodeId, role)
      if (s.edges.some((e) => e.id === eid)) return s
      return {
        ...s,
        edges: [
          ...s.edges,
          {
            id: eid,
            source: existingNodeId,
            target: targetNodeId,
            data: { linkRole: role },
          } as any,
        ],
      }
    })
    return
  }

  if (call.name === 'add_director_console') {
    const { id, position } = call.args
    useRFStore.getState().addDirectorConsoleNode({ id, position })
    return
  }
}

export type CommitBatchInfo = {
  batchUlid: string
  focusNodeId?: string
  summary?: string
}

export function commitBatchToRFStore(
  info: CommitBatchInfo,
  queuedCalls: FlowPatchToolCall[],
): void {
  for (const call of queuedCalls) {
    applySingleFlowPatch(call)
  }
  if (info.focusNodeId) {
    const existing = nodeById(info.focusNodeId)
    if (existing) {
      useRFStore.setState((s) => ({
        ...s,
        nodes: s.nodes.map((n) => ({ ...n, selected: n.id === info.focusNodeId })),
      }))
    }
  }
}
