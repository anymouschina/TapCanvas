import type { Edge, Node } from '@xyflow/react'
import { useUIStore } from '../../../ui/uiStore'

type GlobalStyleGuide = {
  styleName: string
  referenceImages: string[]
}

type WindowChapterContext = {
  projectId: string
  bookId: string | null
  chapterId: string
}

type FlowSnapshot = {
  nodes: Array<{
    id: string
    kind: string
    preset?: string
    data: Record<string, unknown>
    position?: { x: number; y: number }
  }>
  edges: Array<{
    id: string
    source: string
    target: string
    sourceHandle?: string
    targetHandle?: string
  }>
}

export type IntentChapterContext = WindowChapterContext & {
  flowSnapshot: FlowSnapshot
}

const CHAPTER_SEED_NODE_ID_PREFIX = 'chapter-seed-'

function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readWindowChapterContext(): WindowChapterContext | null {
  if (typeof window === 'undefined') return null
  const raw = (window as Window & { __TAPCANVAS_CURRENT_CHAPTER__?: unknown }).__TAPCANVAS_CURRENT_CHAPTER__
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  const projectId = readTrimmedString(record.projectId)
  const chapterId = readTrimmedString(record.chapterId)
  if (!projectId || !chapterId) return null
  const bookId = readTrimmedString(record.bookId)
  return {
    projectId,
    bookId: bookId || null,
    chapterId,
  }
}

function buildFlowSnapshot(nodes: Node[], edges: Edge[]): FlowSnapshot {
  return {
    nodes: nodes.map((node) => {
      const data =
        node.data && typeof node.data === 'object'
          ? (node.data as Record<string, unknown>)
          : {}
      return {
        id: node.id,
        kind: readTrimmedString(data.kind) || 'text',
        preset: readTrimmedString(data.preset) || undefined,
        data,
        position:
          node.position && typeof node.position.x === 'number'
            ? { x: node.position.x, y: node.position.y }
            : undefined,
      }
    }),
    edges: edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: typeof edge.sourceHandle === 'string' ? edge.sourceHandle : undefined,
      targetHandle: typeof edge.targetHandle === 'string' ? edge.targetHandle : undefined,
    })),
  }
}

function findChapterSeedNode(nodes: Node[]): Node | null {
  return (
    nodes.find((node) => {
      const data =
        node.data && typeof node.data === 'object'
          ? (node.data as Record<string, unknown>)
          : {}
      return (
        readTrimmedString(data.preset) === 'chapter-info' &&
        node.id.startsWith(CHAPTER_SEED_NODE_ID_PREFIX)
      )
    }) || null
  )
}

function deriveChapterIdFromNode(sourceNode: Node | undefined, allNodes: Node[]): string {
  const sourceData =
    sourceNode?.data && typeof sourceNode.data === 'object'
      ? (sourceNode.data as Record<string, unknown>)
      : {}
  const directChapterId = readTrimmedString(sourceData.chapterId)
  if (directChapterId) return directChapterId

  const sourceNodeId = readTrimmedString(sourceData.sourceNodeId)
  if (sourceNodeId.startsWith(CHAPTER_SEED_NODE_ID_PREFIX)) {
    return sourceNodeId.slice(CHAPTER_SEED_NODE_ID_PREFIX.length)
  }

  if (sourceNode?.id.startsWith(CHAPTER_SEED_NODE_ID_PREFIX)) {
    return sourceNode.id.slice(CHAPTER_SEED_NODE_ID_PREFIX.length)
  }

  const seedNode = findChapterSeedNode(allNodes)
  if (seedNode) {
    return seedNode.id.slice(CHAPTER_SEED_NODE_ID_PREFIX.length)
  }

  return ''
}

function deriveBookIdFromNode(sourceNode: Node | undefined): string | null {
  const sourceData =
    sourceNode?.data && typeof sourceNode.data === 'object'
      ? (sourceNode.data as Record<string, unknown>)
      : {}
  const directBookId = readTrimmedString(sourceData.bookId) || readTrimmedString(sourceData.sourceBookId)
  return directBookId || null
}

export function resolveIntentChapterContext(params: {
  sourceNodeId: string
  nodes: Node[]
  edges: Edge[]
}): IntentChapterContext | null {
  const flowSnapshot = buildFlowSnapshot(params.nodes, params.edges)
  const fromWindow = readWindowChapterContext()
  if (fromWindow) {
    return {
      ...fromWindow,
      flowSnapshot,
    }
  }

  const projectId = readTrimmedString(useUIStore.getState().currentProject?.id)
  if (!projectId) return null

  const sourceNode = params.nodes.find((node) => node.id === params.sourceNodeId)
  const chapterId = deriveChapterIdFromNode(sourceNode, params.nodes)

  return {
    projectId,
    bookId: deriveBookIdFromNode(sourceNode),
    chapterId,
    flowSnapshot,
  }
}
