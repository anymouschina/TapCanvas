import type { Edge, Node } from '@xyflow/react'

export const PRODUCTION_LAYER_VALUES = [
  'evidence',
  'constraints',
  'anchors',
  'expansion',
  'execution',
  'results',
] as const

export type ProductionLayer = (typeof PRODUCTION_LAYER_VALUES)[number]

export const CREATION_STAGE_VALUES = [
  'source_understanding',
  'constraint_definition',
  'world_anchor_lock',
  'character_anchor_lock',
  'shot_anchor_lock',
  'single_variable_expansion',
  'approved_keyframe_selection',
  'video_plan',
  'video_execution',
  'result_persistence',
] as const

export type CreationStage = (typeof CREATION_STAGE_VALUES)[number]

export const APPROVAL_STATUS_VALUES = [
  'needs_confirmation',
  'approved',
  'rejected',
] as const

export type ApprovalStatus = (typeof APPROVAL_STATUS_VALUES)[number]

export type ProductionNodeMeta = {
  productionLayer?: ProductionLayer
  creationStage?: CreationStage
  approvalStatus?: ApprovalStatus
  sourceEvidence?: string[]
}

export type ChapterGroundedProductionMetadata = {
  chapterGrounded: true
  lockedAnchors: {
    character: string[]
    scene: string[]
    shot: string[]
    continuity: string[]
    missing: string[]
  }
  authorityBaseFrame: {
    status: 'planned' | 'confirmed'
    source: string
    reason: string
    nodeId: string | null
  }
}

export type ResolvedChapterGroundedProductionMetadata = {
  metadata: ChapterGroundedProductionMetadata
  sourceNodeId: string
  sourceNodeLabel: string | null
  relation: 'self' | 'upstream' | 'group'
}

const PRODUCTION_LAYER_SET = new Set<string>(PRODUCTION_LAYER_VALUES)
const CREATION_STAGE_SET = new Set<string>(CREATION_STAGE_VALUES)
const APPROVAL_STATUS_SET = new Set<string>(APPROVAL_STATUS_VALUES)

const IMAGE_KIND_SET = new Set<string>([
  'image',
  'imageedit',
  'texttoimage',
  'storyboardimage',
  'novelstoryboard',
  'storyboardshot',
  'imagefission',
])

const VIDEO_KIND_SET = new Set<string>(['composevideo', 'video', 'storyboard'])
const EVIDENCE_KIND_SET = new Set<string>(['noveldoc', 'scriptdoc'])
const CONSTRAINT_KIND_SET = new Set<string>(['text', 'storyboardscript'])
const PREFERRED_UPSTREAM_METADATA_KIND_SET = new Set<string>([
  'text',
  'noveldoc',
  'scriptdoc',
  'storyboardscript',
])

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function readTrimmedString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}

function normalizeStringArray(value: unknown, limit: number): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const normalized = value
    .map((item) => readTrimmedString(item))
    .filter((item): item is string => Boolean(item))
    .slice(0, limit)
  return normalized.length ? normalized : undefined
}

function readStringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  const normalized = value
    .map((item) => readTrimmedString(item))
    .filter((item): item is string => Boolean(item))
  return normalized
}

export function normalizeProductionLayer(value: unknown): ProductionLayer | undefined {
  const normalized = readTrimmedString(value)
  if (!normalized || !PRODUCTION_LAYER_SET.has(normalized)) return undefined
  return normalized as ProductionLayer
}

export function normalizeCreationStage(value: unknown): CreationStage | undefined {
  const normalized = readTrimmedString(value)
  if (!normalized || !CREATION_STAGE_SET.has(normalized)) return undefined
  return normalized as CreationStage
}

export function normalizeApprovalStatus(value: unknown): ApprovalStatus | undefined {
  const normalized = readTrimmedString(value)
  if (!normalized || !APPROVAL_STATUS_SET.has(normalized)) return undefined
  return normalized as ApprovalStatus
}

export function normalizeSourceEvidence(value: unknown): string[] | undefined {
  return normalizeStringArray(value, 24)
}

function normalizeKind(kind: unknown): string {
  return readTrimmedString(kind)?.toLowerCase() || ''
}

export function inferProductionNodeMeta(kind: unknown): Pick<ProductionNodeMeta, 'productionLayer' | 'creationStage'> {
  const normalizedKind = normalizeKind(kind)
  if (EVIDENCE_KIND_SET.has(normalizedKind)) {
    return {
      productionLayer: 'evidence',
      creationStage: 'source_understanding',
    }
  }
  if (CONSTRAINT_KIND_SET.has(normalizedKind)) {
    return normalizedKind === 'storyboardscript'
      ? {
          productionLayer: 'constraints',
          creationStage: 'shot_anchor_lock',
        }
      : {
          productionLayer: 'constraints',
          creationStage: 'constraint_definition',
        }
  }
  if (normalizedKind === 'storyboardshot') {
    return {
      productionLayer: 'anchors',
      creationStage: 'shot_anchor_lock',
    }
  }
  if (IMAGE_KIND_SET.has(normalizedKind)) {
    return {
      productionLayer: 'expansion',
      creationStage: 'single_variable_expansion',
    }
  }
  if (VIDEO_KIND_SET.has(normalizedKind)) {
    return {
      productionLayer: 'execution',
      creationStage: 'video_plan',
    }
  }
  return {}
}

function inferDefaultApprovalStatus(layer: ProductionLayer | undefined): ApprovalStatus | undefined {
  if (layer === 'anchors' || layer === 'expansion' || layer === 'execution') {
    return 'needs_confirmation'
  }
  return undefined
}

export function normalizeProductionNodeMetaRecord(
  input: Record<string, unknown>,
  options?: {
    kind?: unknown
  },
): Record<string, unknown> {
  const kind = options?.kind ?? input.kind
  const inferred = inferProductionNodeMeta(kind)
  const productionLayer = normalizeProductionLayer(input.productionLayer) ?? inferred.productionLayer
  const creationStage = normalizeCreationStage(input.creationStage) ?? inferred.creationStage
  const approvalStatus =
    normalizeApprovalStatus(input.approvalStatus) ??
    normalizeApprovalStatus(input.status) ??
    inferDefaultApprovalStatus(productionLayer)
  const sourceEvidence = normalizeSourceEvidence(input.sourceEvidence)

  return {
    ...input,
    ...(productionLayer ? { productionLayer } : null),
    ...(creationStage ? { creationStage } : null),
    ...(approvalStatus ? { approvalStatus } : null),
    ...(sourceEvidence ? { sourceEvidence } : null),
  }
}

export function normalizeProductionNodeMeta(node: Node): Node {
  const data = asRecord(node.data)
  return {
    ...node,
    data: normalizeProductionNodeMetaRecord(data, {
      kind: data.kind ?? node.type,
    }),
  }
}

export function getNodeProductionMeta(node: { type?: string; data?: unknown }): ProductionNodeMeta {
  const data = asRecord(node.data)
  const inferred = inferProductionNodeMeta(data.kind ?? node.type)
  const productionLayer = normalizeProductionLayer(data.productionLayer) ?? inferred.productionLayer
  const creationStage = normalizeCreationStage(data.creationStage) ?? inferred.creationStage
  const approvalStatus =
    normalizeApprovalStatus(data.approvalStatus) ??
    normalizeApprovalStatus(data.status) ??
    inferDefaultApprovalStatus(productionLayer)
  const sourceEvidence = normalizeSourceEvidence(data.sourceEvidence)
  return {
    ...(productionLayer ? { productionLayer } : null),
    ...(creationStage ? { creationStage } : null),
    ...(approvalStatus ? { approvalStatus } : null),
    ...(sourceEvidence ? { sourceEvidence } : null),
  }
}

function readNodeLabel(node: Node<Record<string, unknown>>): string | null {
  return readTrimmedString(asRecord(node.data).label) ?? null
}

function readNodeParentId(node: Node<Record<string, unknown>>): string | null {
  return readTrimmedString(node.parentId) ?? null
}

function isPreferredUpstreamMetadataNode(node: Node<Record<string, unknown>>): boolean {
  return PREFERRED_UPSTREAM_METADATA_KIND_SET.has(normalizeKind(asRecord(node.data).kind))
}

type ProductionMetadataCandidate = {
  node: Node<Record<string, unknown>>
  metadata: ChapterGroundedProductionMetadata
  relation: 'upstream' | 'group'
  depth: number
}

export function readChapterGroundedProductionMetadata(
  value: unknown,
): ChapterGroundedProductionMetadata | null {
  const root = asRecord(value)
  if (root.chapterGrounded !== true) return null

  const lockedAnchors = asRecord(root.lockedAnchors)
  const authorityBaseFrame = asRecord(root.authorityBaseFrame)
  if (!Object.keys(lockedAnchors).length || !Object.keys(authorityBaseFrame).length) return null

  const character = readStringList(lockedAnchors.character)
  const scene = readStringList(lockedAnchors.scene)
  const shot = readStringList(lockedAnchors.shot)
  const continuity = readStringList(lockedAnchors.continuity)
  const missing = readStringList(lockedAnchors.missing)
  const status = readTrimmedString(authorityBaseFrame.status)
  const source = readTrimmedString(authorityBaseFrame.source)
  const reason = readTrimmedString(authorityBaseFrame.reason)
  const nodeId = readTrimmedString(authorityBaseFrame.nodeId) ?? null

  if (!character || !scene || !shot || !continuity || !missing) return null
  if (status !== 'planned' && status !== 'confirmed') return null
  if (!source || !reason) return null

  return {
    chapterGrounded: true,
    lockedAnchors: {
      character,
      scene,
      shot,
      continuity,
      missing,
    },
    authorityBaseFrame: {
      status,
      source,
      reason,
      nodeId,
    },
  }
}

export function resolveChapterGroundedProductionMetadataForNode(input: {
  selectedNode: Node<Record<string, unknown>> | null
  nodes: Array<Node<Record<string, unknown>>>
  edges: Array<Edge<Record<string, unknown>>>
}): ResolvedChapterGroundedProductionMetadata | null {
  if (!input.selectedNode) return null

  const selfMetadata = readChapterGroundedProductionMetadata(
    asRecord(input.selectedNode.data).productionMetadata,
  )
  if (selfMetadata) {
    return {
      metadata: selfMetadata,
      sourceNodeId: input.selectedNode.id,
      sourceNodeLabel: readNodeLabel(input.selectedNode),
      relation: 'self',
    }
  }

  const nodeById = new Map<string, Node<Record<string, unknown>>>()
  for (const node of input.nodes) {
    nodeById.set(node.id, node)
  }

  const upstreamCandidate = findUpstreamMetadataCandidate({
    selectedNode: input.selectedNode,
    nodes: input.nodes,
    edges: input.edges,
    nodeById,
  })
  if (upstreamCandidate) {
    return {
      metadata: upstreamCandidate.metadata,
      sourceNodeId: upstreamCandidate.node.id,
      sourceNodeLabel: readNodeLabel(upstreamCandidate.node),
      relation: upstreamCandidate.relation,
    }
  }

  const groupCandidate = findGroupMetadataCandidate({
    selectedNode: input.selectedNode,
    nodes: input.nodes,
  })
  if (!groupCandidate) return null

  return {
    metadata: groupCandidate.metadata,
    sourceNodeId: groupCandidate.node.id,
    sourceNodeLabel: readNodeLabel(groupCandidate.node),
    relation: groupCandidate.relation,
  }
}

function findUpstreamMetadataCandidate(input: {
  selectedNode: Node<Record<string, unknown>>
  nodes: Array<Node<Record<string, unknown>>>
  edges: Array<Edge<Record<string, unknown>>>
  nodeById: Map<string, Node<Record<string, unknown>>>
}): ProductionMetadataCandidate | null {
  const incomingByTarget = new Map<string, string[]>()
  for (const edge of input.edges) {
    const sourceId = readTrimmedString(edge.source)
    const targetId = readTrimmedString(edge.target)
    if (!sourceId || !targetId) continue
    const existing = incomingByTarget.get(targetId)
    if (existing) {
      existing.push(sourceId)
    } else {
      incomingByTarget.set(targetId, [sourceId])
    }
  }

  const queue: Array<{ nodeId: string; depth: number }> = [{ nodeId: input.selectedNode.id, depth: 0 }]
  const visited = new Set<string>([input.selectedNode.id])
  const candidates: ProductionMetadataCandidate[] = []

  while (queue.length > 0) {
    const current = queue.shift()
    if (!current) break
    const incomingIds = incomingByTarget.get(current.nodeId) ?? []
    for (const upstreamNodeId of incomingIds) {
      if (visited.has(upstreamNodeId)) continue
      visited.add(upstreamNodeId)
      const upstreamNode = input.nodeById.get(upstreamNodeId)
      if (!upstreamNode) continue
      const metadata = readChapterGroundedProductionMetadata(
        asRecord(upstreamNode.data).productionMetadata,
      )
      if (metadata) {
        candidates.push({
          node: upstreamNode,
          metadata,
          relation: 'upstream',
          depth: current.depth + 1,
        })
      }
      if (current.depth + 1 < 32) {
        queue.push({ nodeId: upstreamNodeId, depth: current.depth + 1 })
      }
    }
  }

  return pickBestMetadataCandidate(candidates)
}

function findGroupMetadataCandidate(input: {
  selectedNode: Node<Record<string, unknown>>
  nodes: Array<Node<Record<string, unknown>>>
}): ProductionMetadataCandidate | null {
  const selectedParentId = readNodeParentId(input.selectedNode)
  if (!selectedParentId) return null

  const candidates: ProductionMetadataCandidate[] = []
  for (const node of input.nodes) {
    if (node.id === input.selectedNode.id) continue
    if (readNodeParentId(node) !== selectedParentId) continue
    const metadata = readChapterGroundedProductionMetadata(
      asRecord(node.data).productionMetadata,
    )
    if (!metadata) continue
    candidates.push({
      node,
      metadata,
      relation: 'group',
      depth: 0,
    })
  }

  return pickBestMetadataCandidate(candidates)
}

function pickBestMetadataCandidate(
  candidates: ProductionMetadataCandidate[],
): ProductionMetadataCandidate | null {
  if (!candidates.length) return null
  candidates.sort((left, right) => {
    const leftPreferred = isPreferredUpstreamMetadataNode(left.node) ? 1 : 0
    const rightPreferred = isPreferredUpstreamMetadataNode(right.node) ? 1 : 0
    if (rightPreferred !== leftPreferred) return rightPreferred - leftPreferred
    if (left.depth !== right.depth) return left.depth - right.depth
    return 0
  })
  return candidates[0] ?? null
}
