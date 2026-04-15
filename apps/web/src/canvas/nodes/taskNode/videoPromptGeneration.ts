import type { Edge, Node } from '@xyflow/react'

type NodeDataRecord = Record<string, unknown>

export type UpstreamVideoTextContext = {
  blocks: string[]
  combinedText: string
  signature: string
  sourceNodeIds: string[]
}

const MAX_UPSTREAM_TEXT_BLOCKS = 12
const MAX_UPSTREAM_TEXT_CHARS = 7000

function getNodeDataRecord(node: Pick<Node, 'data'> | null | undefined): NodeDataRecord {
  const raw = node?.data
  return raw && typeof raw === 'object' ? (raw as NodeDataRecord) : {}
}

function getTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeTextKey(value: string): string {
  return value
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .toLowerCase()
}

function dedupeTexts(values: string[]): string[] {
  const seen = new Set<string>()
  const output: string[] = []
  values.forEach((value) => {
    const trimmed = getTrimmedString(value)
    if (!trimmed) return
    const key = normalizeTextKey(trimmed)
    if (!key || seen.has(key)) return
    seen.add(key)
    output.push(trimmed)
  })
  return output
}

function getNodeKind(node: Node | null | undefined): string {
  const data = getNodeDataRecord(node)
  const kind = getTrimmedString(data.kind)
  return kind ? kind.toLowerCase() : String(node?.type || '').trim().toLowerCase()
}

function getNodeLabel(node: Node): string {
  const data = getNodeDataRecord(node)
  return getTrimmedString(data.label) || String(node.id)
}

function readLatestTextResult(data: NodeDataRecord): string {
  const results = Array.isArray(data.textResults) ? data.textResults : []
  for (let index = results.length - 1; index >= 0; index -= 1) {
    const item = results[index]
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const text = getTrimmedString((item as NodeDataRecord).text)
    if (text) return text
  }
  return ''
}

function readStoryboardDialogue(data: NodeDataRecord): string {
  if (typeof data.storyboardDialogue === 'string') return data.storyboardDialogue.trim()
  if (!Array.isArray(data.storyboardDialogue)) return ''
  const lines = data.storyboardDialogue
    .map((item) => getTrimmedString(item))
    .filter(Boolean)
  if (!lines.length) return ''
  return `对白：${lines.join('；')}`
}

function readStoryboardShotPrompts(data: NodeDataRecord): string {
  if (!Array.isArray(data.storyboardShotPrompts)) return ''
  const lines = data.storyboardShotPrompts
    .map((item, index) => {
      const text = getTrimmedString(item)
      return text ? `镜头 ${index + 1}：${text}` : ''
    })
    .filter(Boolean)
  return lines.join('\n')
}

function extractNodeTextFragments(node: Node): string[] {
  const data = getNodeDataRecord(node)
  const kind = getNodeKind(node)
  const latestTextResult = readLatestTextResult(data)
  const storyboardDialogue = readStoryboardDialogue(data)
  const storyboardShotPrompts = readStoryboardShotPrompts(data)

  if (kind === 'text') {
    return dedupeTexts([
      getTrimmedString(data.text),
      getTrimmedString(data.content),
      latestTextResult,
      getTrimmedString(data.prompt),
    ])
  }

  if (kind === 'image' || kind === 'imageedit' || kind === 'storyboard') {
    return dedupeTexts([
      getTrimmedString(data.storyboardScript),
      storyboardDialogue,
      storyboardShotPrompts,
      getTrimmedString(data.prompt),
      latestTextResult,
    ])
  }

  if (kind === 'video' || kind === 'composevideo') {
    return dedupeTexts([
      getTrimmedString(data.prompt),
      storyboardDialogue,
    ])
  }

  return dedupeTexts([
    getTrimmedString(data.prompt),
    getTrimmedString(data.text),
    getTrimmedString(data.content),
    latestTextResult,
  ])
}

function buildNodeTextBlock(node: Node): string {
  const fragments = extractNodeTextFragments(node)
  if (!fragments.length) return ''
  return [`[${getNodeLabel(node)}]`, ...fragments].join('\n')
}

function buildIncomingEdgeMap(edges: Edge[]): Map<string, Edge[]> {
  const incoming = new Map<string, Edge[]>()
  edges.forEach((edge) => {
    const target = String(edge.target || '').trim()
    if (!target) return
    const current = incoming.get(target) || []
    current.push(edge)
    incoming.set(target, current)
  })
  return incoming
}

function collectOrderedUpstreamNodeIds(input: {
  targetId: string
  incomingByTarget: Map<string, Edge[]>
}): string[] {
  const ordered: string[] = []
  const visited = new Set<string>()

  const visit = (nodeId: string) => {
    const incoming = input.incomingByTarget.get(nodeId) || []
    incoming.forEach((edge) => {
      const sourceId = String(edge.source || '').trim()
      if (!sourceId || visited.has(sourceId) || sourceId === nodeId) return
      visit(sourceId)
      visited.add(sourceId)
      ordered.push(sourceId)
    })
  }

  visit(input.targetId)
  return ordered
}

function buildSignature(blocks: string[]): string {
  const raw = blocks.join('\n\n')
  let hash = 2166136261
  for (let index = 0; index < raw.length; index += 1) {
    hash ^= raw.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `upstream:${(hash >>> 0).toString(36)}`
}

export function collectUpstreamVideoTextContext(
  nodes: Node[],
  edges: Edge[],
  targetNodeId: string,
): UpstreamVideoTextContext {
  const incomingByTarget = buildIncomingEdgeMap(edges)
  const orderedNodeIds = collectOrderedUpstreamNodeIds({
    targetId: String(targetNodeId || '').trim(),
    incomingByTarget,
  })
  const nodeById = new Map(nodes.map((node) => [String(node.id), node]))

  const blocks: string[] = []
  const seenBlocks = new Set<string>()
  const sourceNodeIds: string[] = []

  for (const nodeId of orderedNodeIds) {
    const node = nodeById.get(nodeId)
    if (!node) continue
    const block = buildNodeTextBlock(node)
    if (!block) continue
    const key = normalizeTextKey(block)
    if (!key || seenBlocks.has(key)) continue
    seenBlocks.add(key)
    blocks.push(block)
    sourceNodeIds.push(nodeId)
    if (blocks.length >= MAX_UPSTREAM_TEXT_BLOCKS) break
  }

  const combinedTextRaw = blocks.join('\n\n')
  const combinedText =
    combinedTextRaw.length > MAX_UPSTREAM_TEXT_CHARS
      ? `${combinedTextRaw.slice(0, MAX_UPSTREAM_TEXT_CHARS)}...`
      : combinedTextRaw

  return {
    blocks,
    combinedText,
    signature: buildSignature(blocks),
    sourceNodeIds,
  }
}
