import type { Edge, Node } from '@xyflow/react'

type CharacterSummary = {
  nodeId: string
  label?: string
  username?: string
  description?: string
  avatarUrl?: string
}

type VideoBindingSummary = {
  nodeId: string
  label?: string
  promptPreview?: string
  characters: Array<{ nodeId: string; label?: string; username?: string }>
  remixSourceLabel?: string
}

type TimelineEntry = {
  nodeId: string
  label?: string
  kind?: string
  status?: string
  progress?: number
  duration?: number
  characters?: Array<{ nodeId: string; label?: string; username?: string }>
  upstreamHandles?: string[]
}

const MAX_NODES = 14
const MAX_EDGES = 16
const MAX_CHARACTERS = 6
const MAX_BINDINGS = 5
const MAX_TIMELINE = 8
const PROMPT_PREVIEW_LIMIT = 320

const VIDEO_KINDS = new Set(['composeVideo', 'video', 'storyboard'])
const CHARACTER_KIND = 'character'
const IMAGE_KINDS = new Set(['image', 'textToImage'])
const STORY_HINTS = ['分镜', '九宫格', '故事板', 'storyboard', '剧情', '续写', '15s视频']

const trimText = (value?: string | null, limit = PROMPT_PREVIEW_LIMIT) => {
  if (!value) return undefined
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (!normalized) return undefined
  return normalized.length > limit ? `${normalized.slice(0, limit)}...` : normalized
}

function extractCharacterSummaries(nodes: Node[]): CharacterSummary[] {
  return nodes
    .filter(node => ((node.data as any)?.kind || node.type) === CHARACTER_KIND)
    .slice(0, MAX_CHARACTERS)
    .map(node => {
      const data = (node.data || {}) as any
      return {
        nodeId: node.id,
        label: data.characterDisplayName || data.label || data.name || data.username,
        username: data.characterUsername || data.soraUsername || data.username,
        description: trimText(data.characterDescription || data.prompt || data.description, 200),
        avatarUrl: data.characterAvatarUrl || data.avatar || data.imageUrl
      }
    })
}

function mapCharacterRefs(nodes: Node[], characters: CharacterSummary[]) {
  const lookup = new Map<string, CharacterSummary>()
  characters.forEach(character => lookup.set(character.nodeId, character))
  nodes
    .filter(node => ((node.data as any)?.kind || node.type) === CHARACTER_KIND)
    .forEach(node => {
      if (!lookup.has(node.id)) {
        lookup.set(node.id, {
          nodeId: node.id,
          label: (node.data as any)?.label,
          username: (node.data as any)?.username
        })
      }
    })
  return lookup
}

function extractVideoBindings(nodes: Node[], edges: Edge[], characterLookup: Map<string, CharacterSummary>): VideoBindingSummary[] {
  if (!edges.length || !characterLookup.size) return []
  const characterIds = new Set(characterLookup.keys())
  const bindings: VideoBindingSummary[] = []

  nodes.forEach(node => {
    const kind = (node.data as any)?.kind || node.type
    if (!VIDEO_KINDS.has(kind)) return

    const boundCharacters = edges
      .filter(edge => edge.target === node.id && characterIds.has(edge.source))
      .map(edge => characterLookup.get(edge.source))
      .filter((summary): summary is CharacterSummary => Boolean(summary))
      .map(summary => ({
        nodeId: summary.nodeId,
        label: summary.label,
        username: summary.username
      }))

    if (!boundCharacters.length) return

    const data = (node.data || {}) as any
    bindings.push({
      nodeId: node.id,
      label: data.label || node.id,
      promptPreview: trimText(data.videoPrompt || data.prompt || ''),
      characters: boundCharacters,
      remixSourceLabel: data.remixSourceLabel || data.remixSourceId || data.remixTargetId
    })
  })

  return bindings.slice(0, MAX_BINDINGS)
}

function buildTimeline(nodes: Node[], edges: Edge[], characterLookup: Map<string, CharacterSummary>): TimelineEntry[] {
  const timeline: TimelineEntry[] = []
  const sorted = [...nodes].sort((a, b) => {
    const ay = a.position?.y ?? 0
    const by = b.position?.y ?? 0
    if (ay === by) {
      const ax = a.position?.x ?? 0
      const bx = b.position?.x ?? 0
      return ax - bx
    }
    return ay - by
  })

  sorted.forEach(node => {
    const kind = (node.data as any)?.kind || node.type
    if (!VIDEO_KINDS.has(kind) && !IMAGE_KINDS.has(kind)) return

    const data = (node.data || {}) as any
    const upstreamCharacters = edges
      .filter(edge => edge.target === node.id && characterLookup.has(edge.source))
      .map(edge => edge.source)
      .map(id => characterLookup.get(id)!)

    timeline.push({
      nodeId: node.id,
      label: data.label || node.id,
      kind,
      status: data.status,
      progress: data.progress,
      duration: data.videoDurationSeconds || data.duration,
      characters: upstreamCharacters.map(character => ({
        nodeId: character.nodeId,
        label: character.label,
        username: character.username
      })),
      upstreamHandles: edges.filter(edge => edge.target === node.id).map(edge => edge.source)
    })
  })

  return timeline.slice(0, MAX_TIMELINE)
}

function extractPendingNodes(nodes: Node[]) {
  const pending = nodes.filter(node => {
    const status = (node.data as any)?.status
    return status && status !== 'success' && status !== 'idle'
  })
  return pending.slice(0, 6).map(node => ({
    nodeId: node.id,
    label: (node.data as any)?.label,
    kind: (node.data as any)?.kind || node.type,
    status: (node.data as any)?.status
  }))
}

function extractStoryContext(nodes: Node[]) {
  const pickExcerpt = (data: any) => {
    const raw = typeof data?.videoPrompt === 'string' && data.videoPrompt.trim()
      ? data.videoPrompt
      : typeof data?.prompt === 'string'
        ? data.prompt
        : ''
    const normalized = raw.replace(/\s+/g, ' ').trim()
    if (!normalized) return undefined
    const limit = 1200
    return normalized.length > limit ? `${normalized.slice(0, limit)}...` : normalized
  }

  const isStoryNode = (node: Node) => {
    const data = (node.data || {}) as any
    const label = typeof data?.label === 'string' ? data.label : ''
    const kind = (data as any)?.kind || node.type
    const hint = `${label}\n${kind}`.toLowerCase()
    return STORY_HINTS.some((k) => hint.includes(k.toLowerCase()))
  }

  const candidates = nodes
    .filter((node) => {
      const data = (node.data || {}) as any
      const kind = (data as any)?.kind || node.type
      return (kind === 'composeVideo' || IMAGE_KINDS.has(kind)) && isStoryNode(node)
    })
    .slice(-3)
    .reverse()
    .map((node) => {
      const data = (node.data || {}) as any
      return {
        nodeId: node.id,
        label: data.label || node.id,
        kind: data.kind || node.type,
        promptExcerpt: pickExcerpt(data),
      }
    })
    .filter((item) => Boolean(item.promptExcerpt))

  return candidates.slice(0, 2)
}

export function buildCanvasContext(nodes: Node[], edges: Edge[]) {
  if (!Array.isArray(nodes) || nodes.length === 0) {
    return undefined
  }

  const summarizePrompt = (data: any) => trimText(data?.videoPrompt || data?.prompt || '', PROMPT_PREVIEW_LIMIT)
  const summarizeNegativePrompt = (data: any) => trimText(data?.negativePrompt || data?.negative || '', 220)
  const pickPrimaryImageUrl = (data: any) => {
    const primary = typeof data?.imageUrl === 'string' ? data.imageUrl.trim() : ''
    if (primary) return primary
    const results = Array.isArray(data?.imageResults) ? data.imageResults : []
    const idx =
      typeof data?.imagePrimaryIndex === 'number' && data.imagePrimaryIndex >= 0 && data.imagePrimaryIndex < results.length
        ? data.imagePrimaryIndex
        : 0
    const fromResults = typeof results[idx]?.url === 'string' ? results[idx].url.trim() : ''
    return fromResults || undefined
  }
  const pickPrimaryVideoUrl = (data: any) => {
    const primary = typeof data?.videoUrl === 'string' ? data.videoUrl.trim() : ''
    if (primary) return primary
    const results = Array.isArray(data?.videoResults) ? data.videoResults : []
    const idx =
      typeof data?.videoPrimaryIndex === 'number' && data.videoPrimaryIndex >= 0 && data.videoPrimaryIndex < results.length
        ? data.videoPrimaryIndex
        : 0
    const fromResults = typeof results[idx]?.url === 'string' ? results[idx].url.trim() : ''
    return fromResults || undefined
  }

  const base: Record<string, any> = {
    summary: {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      kinds: Array.from(new Set(nodes.map(node => ((node.data as any)?.kind || node.type)))).slice(0, 8)
    },
    nodes: nodes.slice(0, MAX_NODES).map(node => ({
      id: node.id,
      label: (node.data as any)?.label,
      kind: (node.data as any)?.kind || node.type,
      type: node.type,
      status: (node.data as any)?.status,
      promptPreview: summarizePrompt(node.data),
      negativePromptPreview: summarizeNegativePrompt(node.data),
      imageUrl: pickPrimaryImageUrl(node.data),
      videoUrl: pickPrimaryVideoUrl(node.data),
      imageModel: (node.data as any)?.imageModel,
      videoModel: (node.data as any)?.videoModel,
    })),
    edges: edges.slice(0, MAX_EDGES).map(edge => ({
      source: edge.source,
      target: edge.target,
      sourceHandle: (edge as any).sourceHandle,
      targetHandle: (edge as any).targetHandle,
    }))
  }

  const characters = extractCharacterSummaries(nodes)
  if (characters.length) {
    base.characters = characters
  }

  const characterLookup = mapCharacterRefs(nodes, characters)
  const videoBindings = extractVideoBindings(nodes, edges, characterLookup)
  if (videoBindings.length) {
    base.videoBindings = videoBindings
  }

  const timeline = buildTimeline(nodes, edges, characterLookup)
  if (timeline.length) {
    base.timeline = timeline
  }

  const pendingNodes = extractPendingNodes(nodes)
  if (pendingNodes.length) {
    base.pendingNodes = pendingNodes
  }

  const storyContext = extractStoryContext(nodes)
  if (storyContext.length) {
    base.storyContext = storyContext
  }

  const runningCompose = pendingNodes.find(node => VIDEO_KINDS.has(node.kind || ''))
  if (runningCompose) {
    const current = nodes.find(node => node.id === runningCompose.nodeId)
    if (current) {
      const data = (current.data || {}) as any
      base.currentRun = {
        nodeId: current.id,
        label: data.label,
        kind: data.kind,
        status: data.status,
        progress: data.progress,
        promptPreview: trimText(data.videoPrompt || data.prompt || '', 320)
      }
    }
  }

  return base
}
