import { Position, type Node, type NodeHandle } from '@xyflow/react'
import {
  clampVisualDimension,
  getVisualNodeDefaults,
  HANDLE_HORIZONTAL_OFFSET,
  HANDLE_VERTICAL_OFFSET,
  isStaticHandlesConfig,
} from './nodes/taskNodeHelpers'
import { getTaskNodeCoreType, getTaskNodeSchema } from './nodes/taskNodeSchema'
import { resolveWorkflowNodeCanvasSize } from './workflowNodeGeometry'

const HANDLE_SIZE = 20
const WIDE_HANDLE_WIDTH = 18
const AUDIO_MIN_WIDTH = 320
const AUDIO_MAX_WIDTH = 720
const AUDIO_DEFAULT_WIDTH = 360

type SizedNode = Node<Record<string, unknown>>

type ResolvedHandle = {
  id: string
  position: Position
  type: string
  direction: 'source' | 'target'
}

type ResolvedDimensions = {
  width: number
  height: number
}

function readPositiveNumber(value: unknown): number | null {
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null
}

function resolvePersistedWidth(node: SizedNode): number | null {
  const style = node.style as Record<string, unknown> | undefined
  return readPositiveNumber(node.measured?.width)
    ?? readPositiveNumber(node.width)
    ?? readPositiveNumber(node.initialWidth)
    ?? readPositiveNumber(style?.width)
}

function resolvePersistedHeight(node: SizedNode): number | null {
  const style = node.style as Record<string, unknown> | undefined
  return readPositiveNumber(node.measured?.height)
    ?? readPositiveNumber(node.height)
    ?? readPositiveNumber(node.initialHeight)
    ?? readPositiveNumber(style?.height)
}

function resolveTaskNodeDimensions(node: SizedNode, kind: string): ResolvedDimensions | null {
  if (kind === 'workflowStage' || kind === 'workflowTrigger') {
    return resolveWorkflowNodeCanvasSize(node.data)
  }
  const coreKind = getTaskNodeCoreType(kind)
  if (coreKind !== 'image' && coreKind !== 'video' && coreKind !== 'storyboard' && coreKind !== 'audio') {
    return null
  }

  if (coreKind === 'image' || coreKind === 'video' || coreKind === 'storyboard') {
    const defaults = getVisualNodeDefaults(kind, coreKind, coreKind === 'storyboard')
    const width = resolvePersistedWidth(node) ?? readPositiveNumber(node.data.nodeWidth) ?? defaults.width
    const height = resolvePersistedHeight(node) ?? readPositiveNumber(node.data.nodeHeight) ?? defaults.height
    return {
      width: clampVisualDimension(width, defaults.minWidth, defaults.maxWidth, defaults.width),
      height: clampVisualDimension(height, defaults.minHeight, defaults.maxHeight, defaults.height),
    }
  }

  if (coreKind === 'audio') {
    const persistedWidth = resolvePersistedWidth(node)
    const persistedHeight = resolvePersistedHeight(node)
    if (persistedWidth !== null && persistedHeight !== null) {
      return { width: Math.round(persistedWidth), height: Math.round(persistedHeight) }
    }
    const contentWidth = Math.max(
      AUDIO_MIN_WIDTH,
      Math.min(AUDIO_MAX_WIDTH, readPositiveNumber(node.data.nodeWidth) ?? AUDIO_DEFAULT_WIDTH),
    )
    return {
      width: Math.round(contentWidth + HANDLE_HORIZONTAL_OFFSET * 2),
      height: Math.round((contentWidth * 9) / 16),
    }
  }

  return null
}

function resolveStaticHandles(kind: string): ResolvedHandle[] | null {
  const handles = getTaskNodeSchema(kind).handles
  if (!isStaticHandlesConfig(handles)) return null
  return [
    ...(handles.targets ?? []).map((handle): ResolvedHandle => ({
      id: handle.id,
      position: handle.position ?? Position.Left,
      type: handle.type,
      direction: 'target',
    })),
    ...(handles.sources ?? []).map((handle): ResolvedHandle => ({
      id: handle.id,
      position: handle.position ?? Position.Right,
      type: handle.type,
      direction: 'source',
    })),
  ]
}

function resolveHandleBounds(
  handle: ResolvedHandle,
  index: number,
  count: number,
  width: number,
  height: number,
): NodeHandle {
  const ratio = count === 1 ? 0.5 : (index + 1) / (count + 1)
  const base = {
    id: handle.id,
    position: handle.position,
    type: handle.direction,
  } as const
  if (handle.position === Position.Left) {
    return { ...base, x: -HANDLE_HORIZONTAL_OFFSET, y: height * ratio - HANDLE_SIZE / 2, width: HANDLE_SIZE, height: HANDLE_SIZE }
  }
  if (handle.position === Position.Right) {
    return { ...base, x: width + HANDLE_HORIZONTAL_OFFSET - HANDLE_SIZE, y: height * ratio - HANDLE_SIZE / 2, width: HANDLE_SIZE, height: HANDLE_SIZE }
  }
  if (handle.position === Position.Top) {
    return { ...base, x: width * ratio - HANDLE_SIZE / 2, y: -HANDLE_VERTICAL_OFFSET, width: HANDLE_SIZE, height: HANDLE_SIZE }
  }
  return { ...base, x: width * ratio - HANDLE_SIZE / 2, y: height + HANDLE_VERTICAL_OFFSET - HANDLE_SIZE, width: HANDLE_SIZE, height: HANDLE_SIZE }
}

function buildTaskNodeHandles(handles: ResolvedHandle[], width: number, height: number): NodeHandle[] {
  const byPosition = new Map<Position, ResolvedHandle[]>()
  for (const handle of handles) {
    const group = byPosition.get(handle.position)
    if (group) group.push(handle)
    else byPosition.set(handle.position, [handle])
  }

  const measuredHandles = handles.map((handle) => {
    const group = byPosition.get(handle.position) ?? [handle]
    return resolveHandleBounds(handle, group.indexOf(handle), group.length, width, height)
  })
  const firstTarget = handles.find((handle) => handle.direction === 'target')
  const firstSource = handles.find((handle) => handle.direction === 'source')
  if (firstTarget) {
    measuredHandles.push({
      id: `in-${firstTarget.type}-wide`,
      type: 'target',
      position: Position.Left,
      x: -HANDLE_HORIZONTAL_OFFSET - WIDE_HANDLE_WIDTH / 2,
      y: 6,
      width: WIDE_HANDLE_WIDTH,
      height: Math.max(1, height - 12),
    })
  }
  if (firstSource) {
    measuredHandles.push({
      id: `out-${firstSource.type}-wide`,
      type: 'source',
      position: Position.Right,
      x: width + HANDLE_HORIZONTAL_OFFSET - WIDE_HANDLE_WIDTH / 2,
      y: 6,
      width: WIDE_HANDLE_WIDTH,
      height: Math.max(1, height - 12),
    })
  }
  return measuredHandles
}

/**
 * Supplies React Flow with deterministic dimensions and handle bounds before the first DOM measure.
 * Without these values, @xyflow deliberately force-renders every unmeasured node even when
 * `onlyRenderVisibleElements` is enabled, which defeats cold-start culling on media-heavy chapters.
 */
export function prepareVirtualizedTaskNodes<TNode extends SizedNode>(
  nodes: readonly TNode[],
  enabled: boolean,
): TNode[] {
  if (!enabled) return nodes as TNode[]
  return nodes.map((node) => {
    if (node.type !== 'taskNode') return node
    const kind = typeof node.data.kind === 'string' ? node.data.kind : 'text'
    const dimensions = resolveTaskNodeDimensions(node, kind)
    const isWorkflowNode = kind === 'workflowStage' || kind === 'workflowTrigger'
    if (dimensions && isWorkflowNode) {
      const { width, height } = dimensions
      return {
        ...node,
        initialWidth: width,
        initialHeight: height,
        measured: { ...node.measured, width, height },
        style: { ...node.style, width, height },
      }
    }
    const handles = resolveStaticHandles(kind)
    if (!dimensions || !handles) return node
    const { width, height } = dimensions
    return {
      ...node,
      initialWidth: width,
      initialHeight: height,
      measured: { ...node.measured, width, height },
      style: { ...node.style, width, height },
      handles: buildTaskNodeHandles(handles, width, height),
    }
  })
}
