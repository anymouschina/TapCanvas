/**
 * 画布增量写协议：浏览器只上送「相对已确认基线改了什么」，由服务端在本章写队列里
 * 基于最新图做字段级合并。整图快照 + expectedRevision 的乐观锁在执行器持续写入时
 * 必然 409，而增量合并只在「同一节点的同一字段」上才有先后之分（后写者胜），
 * 不同字段 / 不同节点的并发写天然可交换，不存在阻塞性冲突。
 *
 * 同一组函数在两端复用：服务端用 apply 合并客户端增量；客户端用 compute + apply
 * 把服务端权威图里自己不知道的改动并回本地 store。
 */

type GraphRecord = Record<string, unknown>

export type CanvasFlowGraph = Readonly<{
  nodes: readonly GraphRecord[]
  edges: readonly GraphRecord[]
}>

export type CanvasFlowDeltaNode = {
  id: string
  /** 基线中不存在的节点：完整节点。 */
  node?: GraphRecord
  /** 顶层字段改动（不含 data）。 */
  set?: GraphRecord
  unset?: string[]
  /** data 内按键改动；data 非对象时整体走 set.data。 */
  dataSet?: GraphRecord
  dataUnset?: string[]
}

export type CanvasFlowDelta = {
  nodes: CanvasFlowDeltaNode[]
  removeNodeIds: string[]
  upsertEdges: GraphRecord[]
  removeEdgeIds: string[]
  /** 节点顺序有变化时给出完整 id 顺序（React Flow 要求父节点在子节点之前）。 */
  nodeOrder?: string[]
}

function isRecord(value: unknown): value is GraphRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function idOf(item: GraphRecord): string {
  return typeof item.id === 'string' ? item.id : String(item.id ?? '')
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  return JSON.stringify(a) === JSON.stringify(b)
}

function diffKeys(
  base: GraphRecord,
  local: GraphRecord,
  skip?: string,
): { set: GraphRecord; unset: string[] } {
  const set: GraphRecord = {}
  const unset: string[] = []
  for (const key of Object.keys(local)) {
    if (key === skip) continue
    const value = local[key]
    if (value === undefined) {
      if (base[key] !== undefined) unset.push(key)
      continue
    }
    if (!sameValue(base[key], value)) set[key] = value
  }
  for (const key of Object.keys(base)) {
    if (key === skip || key in local || base[key] === undefined) continue
    unset.push(key)
  }
  return { set, unset }
}

function diffNode(base: GraphRecord, local: GraphRecord): CanvasFlowDeltaNode | null {
  if (base === local) return null
  const id = idOf(local)
  const splitData = isRecord(base.data) && isRecord(local.data)
  const top = diffKeys(base, local, splitData ? 'data' : undefined)
  const entry: CanvasFlowDeltaNode = { id }
  if (Object.keys(top.set).length) entry.set = top.set
  if (top.unset.length) entry.unset = top.unset
  if (splitData && base.data !== local.data) {
    const data = diffKeys(base.data as GraphRecord, local.data as GraphRecord)
    if (Object.keys(data.set).length) entry.dataSet = data.set
    if (data.unset.length) entry.dataUnset = data.unset
  }
  return entry.set || entry.unset || entry.dataSet || entry.dataUnset ? entry : null
}

function sameOrder(a: readonly GraphRecord[], b: readonly GraphRecord[]): boolean {
  if (a.length !== b.length) return false
  for (let index = 0; index < a.length; index += 1) {
    if (idOf(a[index]) !== idOf(b[index])) return false
  }
  return true
}

/** 计算 local 相对 base 的增量。节点引用相同直接跳过，未改动的大图开销接近 O(n) 引用比较。 */
export function computeCanvasFlowDelta(base: CanvasFlowGraph, local: CanvasFlowGraph): CanvasFlowDelta {
  const baseNodes = new Map(base.nodes.map((node) => [idOf(node), node]))
  const localNodeIds = new Set<string>()
  const nodes: CanvasFlowDeltaNode[] = []
  for (const node of local.nodes) {
    const id = idOf(node)
    localNodeIds.add(id)
    const previous = baseNodes.get(id)
    if (!previous) {
      nodes.push({ id, node })
      continue
    }
    const entry = diffNode(previous, node)
    if (entry) nodes.push(entry)
  }
  const removeNodeIds = [...baseNodes.keys()].filter((id) => !localNodeIds.has(id))

  const baseEdges = new Map(base.edges.map((edge) => [idOf(edge), edge]))
  const localEdgeIds = new Set<string>()
  const upsertEdges: GraphRecord[] = []
  for (const edge of local.edges) {
    const id = idOf(edge)
    localEdgeIds.add(id)
    const previous = baseEdges.get(id)
    if (previous === edge) continue
    if (!previous || !sameValue(previous, edge)) upsertEdges.push(edge)
  }
  const removeEdgeIds = [...baseEdges.keys()].filter((id) => !localEdgeIds.has(id))

  const delta: CanvasFlowDelta = { nodes, removeNodeIds, upsertEdges, removeEdgeIds }
  if (!sameOrder(base.nodes, local.nodes)) delta.nodeOrder = local.nodes.map(idOf)
  return delta
}

export function isCanvasFlowDeltaEmpty(delta: CanvasFlowDelta): boolean {
  return delta.nodes.length === 0
    && delta.removeNodeIds.length === 0
    && delta.upsertEdges.length === 0
    && delta.removeEdgeIds.length === 0
    && delta.nodeOrder === undefined
}

function mergeNode(current: GraphRecord, entry: CanvasFlowDeltaNode): GraphRecord {
  if (entry.node) {
    // 对方视角是新建、本端已存在（并发创建同 id）：对方字段胜出，data 按键并集。
    const data = isRecord(current.data) && isRecord(entry.node.data)
      ? { ...current.data, ...entry.node.data }
      : entry.node.data ?? current.data
    return { ...current, ...entry.node, ...(data !== undefined ? { data } : {}) }
  }
  const next: GraphRecord = { ...current, ...(entry.set ?? {}) }
  for (const key of entry.unset ?? []) delete next[key]
  if (entry.dataSet || entry.dataUnset) {
    const data: GraphRecord = { ...(isRecord(current.data) ? current.data : {}), ...(entry.dataSet ?? {}) }
    for (const key of entry.dataUnset ?? []) delete data[key]
    next.data = data
  }
  return next
}

/** 父节点必须排在子节点之前；父节点已不存在的子节点摘掉 parentId，避免 React Flow 渲染失败。 */
function orderParentsFirst(nodes: GraphRecord[]): GraphRecord[] {
  const byId = new Map(nodes.map((node) => [idOf(node), node]))
  const emitted = new Set<string>()
  const visiting = new Set<string>()
  const out: GraphRecord[] = []
  const visit = (node: GraphRecord) => {
    const id = idOf(node)
    if (emitted.has(id) || visiting.has(id)) return
    visiting.add(id)
    const parentId = typeof node.parentId === 'string' ? node.parentId : ''
    let emittedNode = node
    if (parentId) {
      const parent = byId.get(parentId)
      if (parent) visit(parent)
      else {
        emittedNode = { ...node }
        delete emittedNode.parentId
        if (emittedNode.extent === 'parent') delete emittedNode.extent
      }
    }
    visiting.delete(id)
    emitted.add(id)
    out.push(emittedNode)
  }
  nodes.forEach(visit)
  return out
}

/**
 * 增量里「只改字段、但 current 中不存在」的节点。apply 无法凭字段补出整节点，只能跳过；
 * 调用方必须把这些 id 明确回报给写入方，由其补发完整节点——绝不能静默成功
 * （新章节 seed 未落库却被当作已确认基线，正是这样被静默丢掉的）。
 */
export function findCanvasFlowDeltaMissingNodeIds(current: CanvasFlowGraph, delta: CanvasFlowDelta): string[] {
  const existing = new Set(current.nodes.map(idOf))
  const removed = new Set(delta.removeNodeIds)
  return delta.nodes
    .filter((entry) => !entry.node && !existing.has(entry.id) && !removed.has(entry.id))
    .map((entry) => entry.id)
}

/**
 * 把增量合并进 current：只覆盖增量里出现的字段，current 里其他人写入的字段原样保留。
 * 只改字段的节点若 current 中已不存在则跳过（见 findCanvasFlowDeltaMissingNodeIds，
 * 由写入方补发整节点：编辑胜过并发删除）；端点缺失的边一并丢弃。
 */
export function applyCanvasFlowDelta<T extends CanvasFlowGraph>(current: T, delta: CanvasFlowDelta): T {
  if (isCanvasFlowDeltaEmpty(delta)) return current
  const removed = new Set(delta.removeNodeIds)
  const nodeById = new Map<string, GraphRecord>()
  for (const node of current.nodes) {
    const id = idOf(node)
    if (!removed.has(id)) nodeById.set(id, node)
  }
  const appended: string[] = []
  for (const entry of delta.nodes) {
    const existing = nodeById.get(entry.id)
    if (existing) {
      nodeById.set(entry.id, mergeNode(existing, entry))
    } else if (entry.node) {
      nodeById.set(entry.id, entry.node)
      appended.push(entry.id)
    }
  }

  const orderedIds: string[] = []
  const placed = new Set<string>()
  const place = (id: string) => {
    if (placed.has(id) || !nodeById.has(id)) return
    placed.add(id)
    orderedIds.push(id)
  }
  if (delta.nodeOrder) delta.nodeOrder.forEach(place)
  current.nodes.forEach((node) => place(idOf(node)))
  appended.forEach(place)
  const nodes = orderParentsFirst(orderedIds.map((id) => nodeById.get(id) as GraphRecord))

  const removedEdges = new Set(delta.removeEdgeIds)
  const edgeById = new Map<string, GraphRecord>()
  for (const edge of current.edges) {
    const id = idOf(edge)
    if (!removedEdges.has(id)) edgeById.set(id, edge)
  }
  for (const edge of delta.upsertEdges) edgeById.set(idOf(edge), edge)
  const edges = [...edgeById.values()].filter((edge) =>
    nodeById.has(String(edge.source ?? '')) && nodeById.has(String(edge.target ?? '')))

  return { ...current, nodes, edges }
}

/**
 * 从增量中剔除 local 已经改动的部分（节点字段 / data 键 / 边），用于把服务端改动并回
 * 本地时让「请求飞行期间的本地编辑」胜出——它们会在下一次增量写里上送。
 */
export function omitCanvasFlowDeltaConflicts(delta: CanvasFlowDelta, local: CanvasFlowDelta): CanvasFlowDelta {
  const localNodes = new Map(local.nodes.map((entry) => [entry.id, entry]))
  const localRemoved = new Set(local.removeNodeIds)
  const nodes: CanvasFlowDeltaNode[] = []
  for (const entry of delta.nodes) {
    if (localRemoved.has(entry.id)) continue
    const mine = localNodes.get(entry.id)
    if (!mine) {
      nodes.push(entry)
      continue
    }
    if (mine.node || entry.node) continue
    const mineTop = new Set([...Object.keys(mine.set ?? {}), ...(mine.unset ?? [])])
    const mineData = new Set([...Object.keys(mine.dataSet ?? {}), ...(mine.dataUnset ?? [])])
    const pick = (record: GraphRecord | undefined, taken: Set<string>) => {
      if (!record) return undefined
      const kept = Object.fromEntries(Object.entries(record).filter(([key]) => !taken.has(key)))
      return Object.keys(kept).length ? kept : undefined
    }
    const keep = (keys: string[] | undefined, taken: Set<string>) => {
      const kept = (keys ?? []).filter((key) => !taken.has(key))
      return kept.length ? kept : undefined
    }
    const filtered: CanvasFlowDeltaNode = { id: entry.id }
    const set = pick(entry.set, mineTop)
    const unset = keep(entry.unset, mineTop)
    const dataSet = mineTop.has('data') ? undefined : pick(entry.dataSet, mineData)
    const dataUnset = mineTop.has('data') ? undefined : keep(entry.dataUnset, mineData)
    if (set) filtered.set = set
    if (unset) filtered.unset = unset
    if (dataSet) filtered.dataSet = dataSet
    if (dataUnset) filtered.dataUnset = dataUnset
    if (set || unset || dataSet || dataUnset) nodes.push(filtered)
  }
  const localEdges = new Set([...local.upsertEdges.map(idOf), ...local.removeEdgeIds])
  const localNodeIds = new Set(local.nodes.filter((entry) => entry.node).map((entry) => entry.id))
  return {
    nodes,
    // 与服务端语义一致：编辑胜过并发删除——本地刚编辑/新建的节点不被远端删除抹掉，
    // 它们的改动会随下一次增量上送，服务端回报缺失后由客户端补发整节点。
    removeNodeIds: delta.removeNodeIds.filter((id) => !localNodes.has(id) && !localNodeIds.has(id)),
    upsertEdges: delta.upsertEdges.filter((edge) => !localEdges.has(idOf(edge))),
    removeEdgeIds: delta.removeEdgeIds.filter((id) => !localEdges.has(id)),
    ...(delta.nodeOrder && !local.nodeOrder ? { nodeOrder: delta.nodeOrder } : {}),
  }
}
