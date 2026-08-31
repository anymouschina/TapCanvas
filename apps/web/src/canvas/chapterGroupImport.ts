import type { Edge, Node } from '@xyflow/react'
import type { ChapterDto } from '../api/server'
import { getChapterCanvasFlow } from '../projects/chapterCanvasFlow'
import { sanitizeGraphForCanvas, useRFStore } from './store'
import { getNodeAbsPosition, getNodeSize } from './utils/nodeBounds'

// 章节组在项目画布上的标识：groupNode.data.chapterId === 章节 id。
// 重复执行时凭这个跳过已装载章节，保证幂等。
export const CHAPTER_GROUP_ID_PREFIX = 'chgrp-'

const GROUP_PADDING = 8
const GROUP_MIN_WIDTH = 160
const GROUP_MIN_HEIGHT = 90
const GROUP_GAP = 120
const FETCH_CONCURRENCY = 6

export type ChapterGroupImportSummary = {
  imported: number
  skippedExisting: number
  skippedEmpty: number
  failed: number
}

type ChapterSubgraph = {
  chapter: ChapterLike
  groupNode: Node
  childNodes: Node[]
  edges: Edge[]
  width: number
  height: number
}

function chapterGroupIdFor(chapterId: string): string {
  return `${CHAPTER_GROUP_ID_PREFIX}${chapterId}`
}

export function findImportedChapterIds(nodes: Node[]): Set<string> {
  const ids = new Set<string>()
  for (const node of nodes) {
    const data = (node.data || {}) as any
    if (node.type === 'groupNode') {
      const chapterId = String(data?.chapterId || '').trim()
      if (chapterId) ids.add(chapterId)
    }
    // 子节点也带来源标记：章节组被解组/部分删除后，残留节点仍能让该章节被跳过。
    const importedFrom = String(data?.importedFromChapterId || '').trim()
    if (importedFrom) ids.add(importedFrom)
  }
  return ids
}

function remapId(chapterId: string, originalId: string, taken: Set<string>): string {
  const base = `ch-${chapterId.slice(0, 8)}-${originalId}`
  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(`${base}-${n}`)) n += 1
  return `${base}-${n}`
}

function getParentId(node: Node): string | null {
  const anyNode = node as any
  const raw =
    typeof anyNode?.parentId === 'string'
      ? anyNode.parentId
      : typeof anyNode?.parentNode === 'string'
        ? anyNode.parentNode
        : ''
  const trimmed = String(raw || '').trim()
  return trimmed || null
}

function buildChapterSubgraph(
  chapter: ChapterLike,
  flow: { nodes: unknown[]; edges: unknown[] },
  takenIds: Set<string>,
): ChapterSubgraph | null {
  const sanitized = sanitizeGraphForCanvas(flow as any)
  if (!sanitized.nodes.length) return null

  const idMap = new Map<string, string>()
  for (const node of sanitized.nodes) {
    const nextId = remapId(chapter.id, String(node.id), takenIds)
    idMap.set(String(node.id), nextId)
    takenIds.add(nextId)
  }

  const nodesById = new Map(sanitized.nodes.map((n) => [n.id, n] as const))
  const rootNodes = sanitized.nodes.filter((n) => !getParentId(n))

  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const node of rootNodes) {
    const abs = getNodeAbsPosition(node, nodesById)
    const { w, h } = getNodeSize(node)
    minX = Math.min(minX, abs.x)
    minY = Math.min(minY, abs.y)
    maxX = Math.max(maxX, abs.x + w)
    maxY = Math.max(maxY, abs.y + h)
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return null
  }

  const groupId = chapterGroupIdFor(chapter.id)
  takenIds.add(groupId)
  const width = Math.max(GROUP_MIN_WIDTH, (maxX - minX) + GROUP_PADDING * 2)
  const height = Math.max(GROUP_MIN_HEIGHT, (maxY - minY) + GROUP_PADDING * 2)

  const groupNode: Node = {
    id: groupId,
    type: 'groupNode',
    position: { x: 0, y: 0 },
    draggable: true,
    selectable: true,
    focusable: true,
    selected: false,
    data: {
      label: chapter.title || `第${chapter.index + 1}章`,
      isGroup: true,
      chapterId: chapter.id,
      chapterImport: true,
    },
    style: { width, height },
    width,
    height,
  } as Node

  const childNodes = sanitized.nodes.map((node) => {
    const remappedId = idMap.get(String(node.id))!
    const parentId = getParentId(node)
    const { parentNode: _legacyParent, extent: _extent, ...restRaw } = node as any
    // 章节种子卡（chapter-seed-*）在章节画布是 locked 的；装进项目画布的是副本，
    // 保留 locked 会让整组无法级联删除，这里解锁（仍保留 readOnly 展示语义）。
    const unlocked = String(node.id).startsWith('chapter-seed-') && (restRaw?.data as any)?.locked
      ? { ...restRaw, data: { ...(restRaw.data as any), locked: false } }
      : restRaw
    // 打上来源章节标记，跳过判定不依赖组节点存活（解组后仍可识别）。
    const rest = {
      ...unlocked,
      data: { ...((unlocked.data as any) || {}), importedFromChapterId: chapter.id },
    }
    if (parentId) {
      // 章节内部嵌套组的子节点：保持相对坐标，仅重映射父 id。
      return {
        ...rest,
        id: remappedId,
        parentId: idMap.get(parentId) ?? undefined,
        selected: false,
      } as Node
    }
    // 章节顶层节点：挂到章节组下，坐标转为相对组内坐标。
    const abs = getNodeAbsPosition(node, nodesById)
    return {
      ...rest,
      id: remappedId,
      parentId: groupId,
      selected: false,
      position: {
        x: abs.x - minX + GROUP_PADDING,
        y: abs.y - minY + GROUP_PADDING,
      },
    } as Node
  })

  const edges = sanitized.edges
    .filter((e) => idMap.has(String(e.source)) && idMap.has(String(e.target)))
    .map((e) => ({
      ...e,
      id: remapId(chapter.id, String(e.id || `${e.source}-${e.target}`), takenIds),
      source: idMap.get(String(e.source))!,
      target: idMap.get(String(e.target))!,
      selected: false,
    } as Edge))
  for (const e of edges) takenIds.add(String(e.id))

  return { chapter, groupNode, childNodes, edges, width, height }
}

// 货架式（shelf）紧凑排布：按章节顺序从左到右摆，行宽接近整体正方形时换行。
// 画布本身相当于一个巨大的组，组与组之间只留 GROUP_GAP。
function packChapterGroups(
  subgraphs: ChapterSubgraph[],
  origin: { x: number; y: number },
): void {
  const totalArea = subgraphs.reduce((sum, s) => sum + (s.width + GROUP_GAP) * (s.height + GROUP_GAP), 0)
  const widest = Math.max(...subgraphs.map((s) => s.width))
  const targetRowWidth = Math.max(widest, Math.sqrt(totalArea) * 1.35)

  let cursorX = origin.x
  let cursorY = origin.y
  let rowHeight = 0
  for (const sub of subgraphs) {
    if (cursorX > origin.x && cursorX + sub.width > origin.x + targetRowWidth) {
      cursorX = origin.x
      cursorY += rowHeight + GROUP_GAP
      rowHeight = 0
    }
    sub.groupNode.position = { x: cursorX, y: cursorY }
    cursorX += sub.width + GROUP_GAP
    rowHeight = Math.max(rowHeight, sub.height)
  }
}

function computeImportOrigin(existingNodes: Node[]): { x: number; y: number } {
  const roots = existingNodes.filter((n) => !getParentId(n))
  if (!roots.length) return { x: 96, y: 96 }
  const nodesById = new Map(existingNodes.map((n) => [n.id, n] as const))
  let minX = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const node of roots) {
    const abs = getNodeAbsPosition(node, nodesById)
    const { h } = getNodeSize(node)
    minX = Math.min(minX, abs.x)
    maxY = Math.max(maxY, abs.y + h)
  }
  if (!Number.isFinite(minX) || !Number.isFinite(maxY)) return { x: 96, y: 96 }
  return { x: minX, y: maxY + GROUP_GAP * 2 }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let nextIndex = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const i = nextIndex
      nextIndex += 1
      results[i] = await fn(items[i])
    }
  })
  await Promise.all(workers)
  return results
}

export type ChapterLike = Pick<ChapterDto, 'id' | 'index' | 'title'> &
  Partial<Pick<ChapterDto, 'sortOrder' | 'createdAt'>>

/**
 * 把指定章节画布的内容装载进当前项目画布（按需、非全量）：
 * 每个章节自动打成一个组（groupNode，data.chapterId 标识），
 * 组与组之间按章节顺序紧凑排列，不与既有内容重叠。
 * 已装载过的章节（组或残留子节点带对应章节标记）会跳过，幂等可重复执行。
 */
export async function loadChaptersAsGroups(chapters: ChapterLike[]): Promise<ChapterGroupImportSummary> {
  const summary: ChapterGroupImportSummary = { imported: 0, skippedExisting: 0, skippedEmpty: 0, failed: 0 }
  const ordered = [...chapters].sort((a, b) =>
    ((a.sortOrder ?? 0) - (b.sortOrder ?? 0)) ||
    (a.index - b.index) ||
    String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')),
  )

  const existingNodes = useRFStore.getState().nodes
  const importedChapterIds = findImportedChapterIds(existingNodes)
  const pending = ordered.filter((chapter) => {
    if (importedChapterIds.has(chapter.id)) {
      summary.skippedExisting += 1
      return false
    }
    return true
  })
  if (!pending.length) return summary

  const takenIds = new Set<string>(existingNodes.map((n) => String(n.id)))
  for (const e of useRFStore.getState().edges) takenIds.add(String(e.id))

  const flows = await mapWithConcurrency(pending, FETCH_CONCURRENCY, async (chapter) => {
    try {
      const resp = await getChapterCanvasFlow(chapter.id)
      return { chapter, flow: resp.flow, ok: true as const }
    } catch {
      return { chapter, flow: null, ok: false as const }
    }
  })

  const subgraphs: ChapterSubgraph[] = []
  for (const item of flows) {
    if (!item.ok) {
      summary.failed += 1
      continue
    }
    const flow = item.flow
    if (!flow || !Array.isArray(flow.nodes) || !flow.nodes.length) {
      summary.skippedEmpty += 1
      continue
    }
    const sub = buildChapterSubgraph(item.chapter, flow as any, takenIds)
    if (!sub) {
      summary.skippedEmpty += 1
      continue
    }
    subgraphs.push(sub)
  }
  if (!subgraphs.length) return summary

  packChapterGroups(subgraphs, computeImportOrigin(useRFStore.getState().nodes))

  // 父在前、子在后追加，满足 React Flow 的 parent-first 约束。
  const newNodes: Node[] = []
  const newEdges: Edge[] = []
  for (const sub of subgraphs) {
    newNodes.push(sub.groupNode, ...sub.childNodes)
    newEdges.push(...sub.edges)
    summary.imported += 1
  }
  useRFStore.setState((s) => ({
    nodes: [...s.nodes, ...newNodes],
    edges: [...s.edges, ...newEdges],
  }))

  return summary
}
