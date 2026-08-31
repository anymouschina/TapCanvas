import * as Y from 'yjs'
import type { Node, Edge } from '@xyflow/react'

/**
 * Yjs 画布文档：每个 flowId 一个 Y.Doc，作为 useRFStore.nodes/edges 的 CRDT 镜像。
 *
 * 数据模型（与现有 SyncPatch 语义对齐，便于灰度互通）：
 *   doc.getMap('nodes'): nodeId → Y.Map { type, position, data, parentId, style, width, height }
 *   doc.getMap('edges'): edgeId → Y.Map { source, target, sourceHandle, targetHandle, data }
 *
 * 节点采用 Y.Map（而非整对象值）以获得字段级合并：拖拽改 position 与 agent 回写 data.imageUrl
 * 落在不同 key，并发不互相覆盖。data/style/position 内部仍按普通 JSON 值存储（v1 不做 data 内部
 * 深层 CRDT，与当前 SSE 整节点 upsert 行为一致）。
 */

export const LOCAL_ORIGIN = 'local-store'
export const REMOTE_ORIGIN = 'remote-yjs'

const SEED_PREFIX = 'chapter-seed-'

const docs = new Map<string, Y.Doc>()

export function getCanvasDoc(flowId: string): Y.Doc {
  let doc = docs.get(flowId)
  if (!doc) {
    doc = new Y.Doc()
    docs.set(flowId, doc)
  }
  return doc
}

export function destroyCanvasDoc(flowId: string): void {
  const doc = docs.get(flowId)
  if (doc) {
    doc.destroy()
    docs.delete(flowId)
  }
}

export function nodesYMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>('nodes')
}

export function edgesYMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>('edges')
}

const NODE_KEYS = ['type', 'position', 'data', 'parentId', 'style', 'width', 'height'] as const
const EDGE_KEYS = ['source', 'target', 'sourceHandle', 'targetHandle', 'data'] as const

function isSeed(id: string): boolean {
  return id.startsWith(SEED_PREFIX)
}

/** 把一个 xyflow Node 写进/更新到 nodes Y.Map（字段级 set，只改有变化的 key）。 */
function writeNodeInto(target: Y.Map<unknown>, node: Node): void {
  for (const key of NODE_KEYS) {
    const next = (node as Record<string, unknown>)[key]
    if (next === undefined) {
      if (target.has(key)) target.delete(key)
      continue
    }
    const prev = target.get(key)
    // 仅在序列化结果不同的时候写，避免无意义 update 风暴
    if (JSON.stringify(prev) !== JSON.stringify(next)) {
      target.set(key, next as unknown)
    }
  }
}

function writeEdgeInto(target: Y.Map<unknown>, edge: Edge): void {
  for (const key of EDGE_KEYS) {
    const next = (edge as Record<string, unknown>)[key]
    if (next === undefined || next === null) {
      if (target.has(key)) target.delete(key)
      continue
    }
    const prev = target.get(key)
    if (JSON.stringify(prev) !== JSON.stringify(next)) {
      target.set(key, next as unknown)
    }
  }
}

function readNodeFrom(id: string, m: Y.Map<unknown>): Node {
  const out: Record<string, unknown> = { id }
  for (const key of NODE_KEYS) {
    if (m.has(key)) out[key] = m.get(key)
  }
  if (!out.position) out.position = { x: 0, y: 0 }
  return out as unknown as Node
}

function readEdgeFrom(id: string, m: Y.Map<unknown>): Edge {
  const out: Record<string, unknown> = { id }
  for (const key of EDGE_KEYS) {
    if (m.has(key)) out[key] = m.get(key)
  }
  return out as unknown as Edge
}

/** Y.Doc → 普通数组（供 setState 用）。 */
export function readNodesFromDoc(doc: Y.Doc): Node[] {
  const map = nodesYMap(doc)
  const out: Node[] = []
  map.forEach((m, id) => {
    if (m instanceof Y.Map) out.push(readNodeFrom(id, m))
  })
  return out
}

export function readEdgesFromDoc(doc: Y.Doc): Edge[] {
  const map = edgesYMap(doc)
  const out: Edge[] = []
  map.forEach((m, id) => {
    if (m instanceof Y.Map) out.push(readEdgeFrom(id, m))
  })
  return out
}

/**
 * 把整份 nodes/edges 同步进 Y.Doc（diff 后只写变化项 + 删除已不存在项）。
 * 在一个 transaction 内完成，origin=LOCAL_ORIGIN，便于 observer 跳过自身回声。
 */
export function syncStoreToDoc(doc: Y.Doc, nodes: Node[], edges: Edge[]): void {
  doc.transact(() => {
    const nMap = nodesYMap(doc)
    const seenNodes = new Set<string>()
    for (const node of nodes) {
      if (isSeed(node.id)) continue
      seenNodes.add(node.id)
      let entry = nMap.get(node.id)
      if (!(entry instanceof Y.Map)) {
        entry = new Y.Map<unknown>()
        nMap.set(node.id, entry)
      }
      writeNodeInto(entry, node)
    }
    for (const id of Array.from(nMap.keys())) {
      if (!seenNodes.has(id) && !isSeed(id)) nMap.delete(id)
    }

    const eMap = edgesYMap(doc)
    const seenEdges = new Set<string>()
    for (const edge of edges) {
      seenEdges.add(edge.id)
      let entry = eMap.get(edge.id)
      if (!(entry instanceof Y.Map)) {
        entry = new Y.Map<unknown>()
        eMap.set(edge.id, entry)
      }
      writeEdgeInto(entry, edge)
    }
    for (const id of Array.from(eMap.keys())) {
      if (!seenEdges.has(id)) eMap.delete(id)
    }
  }, LOCAL_ORIGIN)
}

/** 文档是否还没装载任何节点（用于决定是否需要用 store 当前态做幂等初始化）。 */
export function isDocEmpty(doc: Y.Doc): boolean {
  return nodesYMap(doc).size === 0 && edgesYMap(doc).size === 0
}
