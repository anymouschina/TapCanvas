import type { Edge, Node } from '@xyflow/react'
import { getTaskNodeCoreType, normalizeTaskNodeKind } from './nodes/taskNodeSchema'
import { getNodeSize } from './utils/nodeBounds'
import {
  WORKFLOW_ICON_NODE_FLOW_GAP_X,
  WORKFLOW_ICON_NODE_FLOW_GAP_Y,
} from './workflowNodeGeometry'
import { computeWorkflowFlowLayout } from './workflowFlowLayout'

// 「一键整理」的语义类别。列从左到右按 TIDY_CATEGORY_ORDER 排布。
// taskNode 的归类以统一 node schema 为真源；新增 kind 注册 schema 后会自动参与整理。
// audio / director 是独立能力，放在文本与视觉产物之间。
export type TidyCategory = 'text' | 'audio' | 'director' | 'image' | 'video'

export const TIDY_CATEGORY_ORDER: TidyCategory[] = [
  'text',
  'audio',
  'director',
  'image',
  'video',
]

function getNodeParentId(node: Node): string | null {
  const compatibleNode = node as Node & { parentNode?: unknown }
  const raw =
    typeof compatibleNode.parentId === 'string'
      ? compatibleNode.parentId
      : typeof compatibleNode.parentNode === 'string'
        ? compatibleNode.parentNode
        : ''
  const trimmed = typeof raw === 'string' ? raw.trim() : ''
  return trimmed || null
}

function hasAssetList(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0
}

function hasNonEmptyString(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

function taskNodeCategory(node: Node): TidyCategory {
  const data = (node.data ?? {}) as Record<string, unknown>
  if (hasNonEmptyString(data.videoUrl) || hasAssetList(data.videoResults)) return 'video'
  if (hasNonEmptyString(data.imageUrl) || hasAssetList(data.imageResults)) return 'image'

  const kind = typeof data.kind === 'string' ? data.kind : null
  const normalizedKind = normalizeTaskNodeKind(kind)
  if (normalizedKind === 'audio') return 'audio'
  const coreType = getTaskNodeCoreType(kind)
  if (coreType === 'video') return 'video'
  if (coreType === 'image' || coreType === 'storyboard') return 'image'
  if (coreType === 'audio') return 'audio'
  return 'text'
}

// 组容器取直接子节点出现最多的媒体类别；空组按文本整理。
function groupCategory(node: Node, childrenByParent: Map<string, Node[]>): TidyCategory {
  const children = childrenByParent.get(node.id) ?? []
  const counts = new Map<TidyCategory, number>()
  for (const child of children) {
    if (child.type !== 'taskNode') continue
    const cat = taskNodeCategory(child)
    counts.set(cat, (counts.get(cat) ?? 0) + 1)
  }
  let best: TidyCategory | null = null
  let bestCount = 0
  // 按 TIDY_CATEGORY_ORDER 遍历，天然实现「平票取靠前类别」的确定性
  for (const cat of TIDY_CATEGORY_ORDER) {
    const c = counts.get(cat) ?? 0
    if (c > bestCount) {
      best = cat
      bestCount = c
    }
  }
  return best ?? 'text'
}

// 整理单元的类别。整理单元 = 未打组根节点 或 组容器。
export function categoryOfUnit(node: Node, childrenByParent: Map<string, Node[]>): TidyCategory | null {
  if (node.type === 'groupNode') return groupCategory(node, childrenByParent)
  if (node.type === 'taskNode') return taskNodeCategory(node)
  if (node.type === 'directorConsole') return 'director'
  if (node.type === 'ioNode') return null
  // 新增的非 taskNode 只要是画布内容节点，也不能因未加入枚举而漏排。
  return taskNodeCategory(node)
}

// ── 场景聚合(spec: 2026-07-09-canvas-tidy-scene-clustering)──
// scene/image/video/audio 四列列内按「所属场景」聚簇、簇内网格换行。
// 场景归属为纯读取启发式:sceneCardNodeId 预留位 → 自身是场景卡 →
// archivedFromNodeId 回链 → scene binding label/refId 匹配 → 入边(场景卡→节点)。
// audio 不参与:线上配音卡是角色维度(「配音卡｜角色-…」),按场景聚不上,保持竖排单列。
const SCENE_AWARE_CATEGORIES: ReadonlySet<TidyCategory> = new Set(['image', 'video'])
const MAX_PER_ROW = 3
const ITEM_GAP = 24
const CLUSTER_GAP = 60

function normalizeSceneName(v: unknown): string {
  return typeof v === 'string' ? v.replace(/\s+/g, '').toLowerCase() : ''
}

// 线上场景卡命名规范「场景卡｜场景名」(全角/半角分隔皆有)。剥前缀取纯场景名,
// 供产物 scene binding 的 label(=场景名)匹配;非该前缀返回 null。
const SCENE_CARD_LABEL_RE = /^场景卡\s*[|｜:：-]?\s*/
function sceneNameFromCardLabel(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const trimmed = v.trim()
  if (!SCENE_CARD_LABEL_RE.test(trimmed)) return null
  return normalizeSceneName(trimmed.replace(SCENE_CARD_LABEL_RE, '')) || null
}

type SceneRegistry = { ids: Set<string>; byLabel: Map<string, string>; byRefId: Map<string, string>; order: string[] }

// 场景注册表:仅收「整理单元」中的真场景卡。两种形态:
// ① 结构化:referenceType/kind === 'scene'(material.repo 两者同写);
// ② 线上常见:kind='image' 且 label 前缀「场景卡｜」(无任何结构化字段,DB 实证)。
// 注意不能用 categoryOfUnit === 'scene' 判——它会把「带 scene 绑定的产物图」也归进
// scene 类,产物混进注册表会各自领簇、聚合失效。
// 组内场景卡不收(其产物落未归类)。order 按 (y,x) 升序,作为各列共用的场景顺序。
function buildSceneRegistry(units: Node[]): SceneRegistry {
  const cards = units
    .filter((n) => {
      if (n.type !== 'taskNode') return false
      const d = (n.data ?? {}) as Record<string, unknown>
      const refType = String(d.referenceType ?? '').trim().toLowerCase()
      const kind = String(d.kind ?? '').trim().toLowerCase()
      if (refType === 'scene' || kind === 'scene') return true
      return sceneNameFromCardLabel(d.label) !== null
    })
    .sort(
      (a, b) =>
        Number(a.position?.y ?? 0) - Number(b.position?.y ?? 0) ||
        Number(a.position?.x ?? 0) - Number(b.position?.x ?? 0),
    )
  const reg: SceneRegistry = { ids: new Set(), byLabel: new Map(), byRefId: new Map(), order: [] }
  for (const card of cards) {
    const data = (card.data ?? {}) as Record<string, unknown>
    reg.ids.add(card.id)
    reg.order.push(card.id)
    // 双索引:完整 label + 剥「场景卡｜」前缀后的纯场景名(产物 binding 的 label 是后者)
    const label = normalizeSceneName(data.label)
    if (label && !reg.byLabel.has(label)) reg.byLabel.set(label, card.id)
    const sceneName = sceneNameFromCardLabel(data.label)
    if (sceneName && !reg.byLabel.has(sceneName)) reg.byLabel.set(sceneName, card.id)
    for (const raw of [data.refId, data.scenePropRefId]) {
      const rid = typeof raw === 'string' ? raw.trim() : ''
      if (rid && !reg.byRefId.has(rid)) reg.byRefId.set(rid, card.id)
    }
  }
  return reg
}

// 归档旧版判定:重生成留痕机制会把旧版快照成带 archivedFromNodeId 的独立节点。
function isArchivedNode(node: Node): boolean {
  const d = (node.data ?? {}) as Record<string, unknown>
  return typeof d.archivedFromNodeId === 'string' && d.archivedFromNodeId.trim() !== ''
}

// 对整理单元求 sceneKey(=场景卡节点 id;null=未归类)。归档节点第二遍处理,
// 通过 archivedFromNodeId 继承活跃原节点的归属。导出供直测。
export function resolveTidySceneKeys(units: Node[], edges: Edge[]): Map<string, string | null> {
  const registry = buildSceneRegistry(units)
  const sceneCardByTarget = new Map<string, string>()
  for (const e of edges) {
    if (registry.ids.has(e.source) && !sceneCardByTarget.has(e.target)) sceneCardByTarget.set(e.target, e.source)
  }
  const resolveDirect = (node: Node): string | null => {
    const data = (node.data ?? {}) as Record<string, unknown>
    const pinned = typeof data.sceneCardNodeId === 'string' ? data.sceneCardNodeId.trim() : ''
    if (pinned && registry.ids.has(pinned)) return pinned
    if (registry.ids.has(node.id)) return node.id
    const anchors = Array.isArray(data.anchorBindings) ? data.anchorBindings : []
    for (const a of anchors) {
      const rec = (a ?? {}) as Record<string, unknown>
      if (String(rec.kind ?? '').trim().toLowerCase() !== 'scene') continue
      const byLabel = registry.byLabel.get(normalizeSceneName(rec.label))
      if (byLabel) return byLabel
      const rid = typeof rec.refId === 'string' ? rec.refId.trim() : ''
      if (rid) {
        const byRef = registry.byRefId.get(rid)
        if (byRef) return byRef
      }
    }
    return sceneCardByTarget.get(node.id) ?? null
  }
  const keys = new Map<string, string | null>()
  const archived: Node[] = []
  for (const n of units) {
    if (n.type !== 'taskNode') {
      keys.set(n.id, null)
      continue
    }
    if (isArchivedNode(n)) {
      archived.push(n)
      continue
    }
    keys.set(n.id, resolveDirect(n))
  }
  for (const n of archived) {
    const from = String((n.data as Record<string, unknown>)?.archivedFromNodeId ?? '').trim()
    keys.set(n.id, keys.get(from) ?? resolveDirect(n))
  }
  return keys
}

export type TidyLayoutOptions = { colGap?: number; rowGap?: number }

type WorkflowInstanceLayout = Readonly<{
  virtualNode: Node
  relativePositions: ReadonlyMap<string, Readonly<{ x: number; y: number }>>
}>

function nodeData(node: Node): Record<string, unknown> {
  return node.data && typeof node.data === 'object' && !Array.isArray(node.data)
    ? node.data as Record<string, unknown>
    : {}
}

function workflowInstanceId(node: Node): string {
  const value = nodeData(node).workflowInstanceId
  return typeof value === 'string' ? value.trim() : ''
}

function isRuntimeWorkflowReference(node: Node): boolean {
  return nodeData(node).workflowRuntimeReference === true
}

function computeRootWorkflowInstanceLayouts(
  rootUnits: readonly Node[],
  edges: readonly Edge[],
  occupiedNodeIds: ReadonlySet<string>,
): Readonly<{
  layouts: readonly WorkflowInstanceLayout[]
  memberNodeIds: ReadonlySet<string>
}> {
  const byInstance = new Map<string, Node[]>()
  for (const node of rootUnits) {
    const data = nodeData(node)
    const instanceId = workflowInstanceId(node)
    if (node.type !== 'taskNode' || data.adminWorkflow !== true || !instanceId) continue
    const members = byInstance.get(instanceId) ?? []
    members.push(node)
    byInstance.set(instanceId, members)
  }

  const layouts: WorkflowInstanceLayout[] = []
  const memberNodeIds = new Set<string>()
  for (const [instanceId, members] of byInstance) {
    const primaryNodes = members.filter((node) => !isRuntimeWorkflowReference(node))
    if (primaryNodes.length < 2 || !primaryNodes.every((node) => {
      const kind = nodeData(node).kind
      return kind === 'workflowStage' || kind === 'workflowTrigger'
    })) continue

    const primaryIds = new Set(primaryNodes.map((node) => node.id))
    const primaryPositions = computeWorkflowFlowLayout(
      primaryNodes.map((node) => {
        const size = getNodeSize(node)
        return {
          id: node.id,
          position: node.position,
          size: { width: size.w, height: size.h },
        }
      }),
      edges.filter((edge) => primaryIds.has(edge.source) && primaryIds.has(edge.target)),
      WORKFLOW_ICON_NODE_FLOW_GAP_X,
      WORKFLOW_ICON_NODE_FLOW_GAP_Y,
    )
    const rawPositions = new Map<string, { x: number; y: number }>(primaryPositions)
    const sizeById = new Map(members.map((node) => [node.id, getNodeSize(node)] as const))
    for (const referenceNode of members.filter(isRuntimeWorkflowReference)) {
      const data = nodeData(referenceNode)
      const ownerNodeId = typeof data.workflowRuntimeReferenceOwnerNodeId === 'string'
        ? data.workflowRuntimeReferenceOwnerNodeId.trim()
        : ''
      const ownerPosition = rawPositions.get(ownerNodeId)
      const ownerSize = sizeById.get(ownerNodeId)
      if (!ownerPosition || !ownerSize) continue
      const referenceKind = data.workflowRuntimeReferenceKind === 'skill' ? 'skill' : 'knowledge'
      rawPositions.set(referenceNode.id, {
        x: ownerPosition.x + (referenceKind === 'skill' ? -44 : 44),
        y: ownerPosition.y + ownerSize.h + 48,
      })
    }

    const positionedMembers = members.filter((node) => rawPositions.has(node.id))
    const minX = Math.min(...positionedMembers.map((node) => rawPositions.get(node.id)?.x ?? 0))
    const minY = Math.min(...positionedMembers.map((node) => rawPositions.get(node.id)?.y ?? 0))
    const relativePositions = new Map<string, { x: number; y: number }>()
    let width = 0
    let height = 0
    for (const node of positionedMembers) {
      const rawPosition = rawPositions.get(node.id)
      if (!rawPosition) continue
      const relativePosition = { x: rawPosition.x - minX, y: rawPosition.y - minY }
      const size = sizeById.get(node.id) ?? { w: 0, h: 0 }
      relativePositions.set(node.id, relativePosition)
      width = Math.max(width, relativePosition.x + size.w)
      height = Math.max(height, relativePosition.y + size.h)
      memberNodeIds.add(node.id)
    }

    let virtualNodeId = `__workflow-layout-unit:${instanceId}`
    while (occupiedNodeIds.has(virtualNodeId)) virtualNodeId = `_${virtualNodeId}`
    layouts.push({
      virtualNode: {
        id: virtualNodeId,
        type: 'groupNode',
        position: {
          x: Math.min(...positionedMembers.map((node) => Number(node.position?.x ?? 0))),
          y: Math.min(...positionedMembers.map((node) => Number(node.position?.y ?? 0))),
        },
        width,
        height,
        measured: { width, height },
        style: { width, height },
        data: { label: '工作流' },
      },
      relativePositions,
    })
  }
  return { layouts, memberNodeIds }
}

type SceneColumnGaps = { rowGap: number; itemGap: number; clusterGap: number; maxPerRow: number }

// scene-aware 列:按 sceneKey 分簇(未归类 null 簇殿后),簇内活跃版在前(按原 y,x)、
// 归档版在后(按 archivedAt),每行最多 maxPerRow 个网格换行。返回列宽。
function layoutSceneAwareColumn(
  col: Node[],
  colX: number,
  anchorY: number,
  sceneKeys: Map<string, string | null>,
  sceneOrder: string[],
  positions: Map<string, { x: number; y: number }>,
  gaps: SceneColumnGaps,
): number {
  const clusters = new Map<string | null, Node[]>()
  for (const n of col) {
    const key = sceneKeys.get(n.id) ?? null
    const list = clusters.get(key)
    if (list) list.push(n)
    else clusters.set(key, [n])
  }
  const orderedKeys: Array<string | null> = sceneOrder.filter((k) => clusters.has(k))
  if (clusters.has(null)) orderedKeys.push(null)

  const posCmp = (a: Node, b: Node) =>
    Number(a.position?.y ?? 0) - Number(b.position?.y ?? 0) ||
    Number(a.position?.x ?? 0) - Number(b.position?.x ?? 0) ||
    a.id.localeCompare(b.id)
  const archivedCmp = (a: Node, b: Node) => {
    const at = String((a.data as Record<string, unknown>)?.archivedAt ?? '')
    const bt = String((b.data as Record<string, unknown>)?.archivedAt ?? '')
    return at.localeCompare(bt) || a.id.localeCompare(b.id)
  }

  // 场景卡自己领簇(sceneKey === 自身 id),恒排簇首;之后活跃产物按原 (y,x),归档版殿后。
  const isClusterCard = (n: Node) => sceneKeys.get(n.id) === n.id

  let y = anchorY
  let colWidth = 0
  for (const key of orderedKeys) {
    const members = clusters.get(key)!
    const ordered = [
      ...members.filter(isClusterCard).sort(posCmp),
      ...members.filter((n) => !isClusterCard(n) && !isArchivedNode(n)).sort(posCmp),
      ...members.filter((n) => !isClusterCard(n) && isArchivedNode(n)).sort(archivedCmp),
    ]
    let rowX = colX
    let rowMaxH = 0
    let inRow = 0
    for (const n of ordered) {
      const { w, h } = getNodeSize(n)
      if (inRow >= gaps.maxPerRow) {
        y += rowMaxH + gaps.rowGap
        rowX = colX
        rowMaxH = 0
        inRow = 0
      }
      positions.set(n.id, { x: rowX, y })
      rowX += w + gaps.itemGap
      if (h > rowMaxH) rowMaxH = h
      inRow += 1
      const rowWidth = rowX - gaps.itemGap - colX
      if (rowWidth > colWidth) colWidth = rowWidth
    }
    y += rowMaxH + gaps.clusterGap
  }
  return colWidth
}

// 计算「按类别分列」后的新坐标。只返回需要移动的单元（组容器 + 未打组根节点）的目标位置；
// 组内子节点不在结果里——它们相对父容器、随组容器自动跟随。
export function computeTidyByCategoryLayout(
  nodes: Node[],
  edges: Edge[] = [],
  options: TidyLayoutOptions = {},
): { positions: Map<string, { x: number; y: number }> } {
  const colGap = options.colGap ?? 120
  const rowGap = options.rowGap ?? 40
  const positions = new Map<string, { x: number; y: number }>()

  const nodeIds = new Set(nodes.map((n) => n.id))
  const childrenByParent = new Map<string, Node[]>()
  for (const n of nodes) {
    const pid = getNodeParentId(n)
    if (!pid) continue
    const list = childrenByParent.get(pid)
    if (list) list.push(n)
    else childrenByParent.set(pid, [n])
  }

  // 整理单元：组容器，或「未打组根节点」（无 parent，或 parent 指向已不存在的幽灵组）。
  const isUnit = (n: Node): boolean => {
    if (n.type === 'groupNode') return true
    const pid = getNodeParentId(n)
    return !pid || !nodeIds.has(pid)
  }

  const rootUnits = nodes.filter((n) => isUnit(n) && categoryOfUnit(n, childrenByParent) !== null)
  const rootWorkflowLayouts = computeRootWorkflowInstanceLayouts(rootUnits, edges, nodeIds)
  const units = [
    ...rootUnits.filter((node) => !rootWorkflowLayouts.memberNodeIds.has(node.id)),
    ...rootWorkflowLayouts.layouts.map((layout) => layout.virtualNode),
  ]
  if (!units.length) return { positions }

  const anchorX = Math.min(...units.map((n) => Number(n.position?.x ?? 0)))
  const anchorY = Math.min(...units.map((n) => Number(n.position?.y ?? 0)))

  // 归档旧版的绑定字段已被剥(archived* 前缀),裸判会漂到 image 列、与活跃版
  // (可能在 scene 列)分家。让归档节点继承其活跃原节点的类别,保证同列同簇并排。
  const unitById = new Map(units.map((u) => [u.id, u] as const))
  const unitCategory = (n: Node): TidyCategory => {
    if (n.type === 'taskNode' && isArchivedNode(n)) {
      const from = String((n.data as Record<string, unknown>)?.archivedFromNodeId ?? '').trim()
      const origin = from ? unitById.get(from) : undefined
      if (origin) {
        const oc = categoryOfUnit(origin, childrenByParent)
        if (oc) return oc
      }
    }
    return categoryOfUnit(n, childrenByParent)!
  }

  const buckets = new Map<TidyCategory, Node[]>()
  for (const n of units) {
    const cat = unitCategory(n)
    const list = buckets.get(cat)
    if (list) list.push(n)
    else buckets.set(cat, [n])
  }

  // 场景聚合:scene-aware 列(scene/image/video/audio)按所属场景分簇。
  // registry 与 resolveTidySceneKeys 内部各建一次(便宜),换取导出函数自洽可直测。
  const sceneOrder = buildSceneRegistry(units).order
  const sceneKeys = resolveTidySceneKeys(units, edges)

  let colX = anchorX
  for (const cat of TIDY_CATEGORY_ORDER) {
    const col = buckets.get(cat)
    if (!col || !col.length) continue
    if (SCENE_AWARE_CATEGORIES.has(cat)) {
      const colWidth = layoutSceneAwareColumn(col, colX, anchorY, sceneKeys, sceneOrder, positions, {
        rowGap,
        itemGap: ITEM_GAP,
        clusterGap: CLUSTER_GAP,
        maxPerRow: MAX_PER_ROW,
      })
      colX += colWidth + colGap
      continue
    }
    // 列内保持当前视觉顺序（先 y 后 x）
    col.sort(
      (a, b) =>
        Number(a.position?.y ?? 0) - Number(b.position?.y ?? 0) ||
        Number(a.position?.x ?? 0) - Number(b.position?.x ?? 0),
    )
    let y = anchorY
    let maxW = 0
    for (const n of col) {
      const { w, h } = getNodeSize(n)
      positions.set(n.id, { x: colX, y })
      if (w > maxW) maxW = w
      y += h + rowGap
    }
    colX += maxW + colGap
  }

  for (const layout of rootWorkflowLayouts.layouts) {
    const unitPosition = positions.get(layout.virtualNode.id)
    positions.delete(layout.virtualNode.id)
    if (!unitPosition) continue
    for (const [nodeId, relativePosition] of layout.relativePositions) {
      positions.set(nodeId, {
        x: unitPosition.x + relativePosition.x,
        y: unitPosition.y + relativePosition.y,
      })
    }
  }

  return { positions }
}
