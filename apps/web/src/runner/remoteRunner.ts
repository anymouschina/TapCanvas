import type { Node } from 'reactflow'
import type { TaskKind, TaskResultDto } from '../api/server'
import {
  runTaskByVendor,
  createSoraVideo,
  listSoraPendingVideos,
  getSoraVideoDraftByTask,
  listModelProviders,
  listModelTokens,
  fetchVeoTaskResult,
  fetchSora2ApiTaskResult,
} from '../api/server'
import { useUIStore } from '../ui/uiStore'
import { toast } from '../ui/toast'
import { notifyAssetRefresh } from '../ui/assetEvents'
import { isAnthropicModel } from '../config/modelSource'
import { getDefaultModel, isImageEditModel } from '../config/models'
import {
  normalizeStoryboardScenes,
  serializeStoryboardScenes,
  totalStoryboardDuration,
  STORYBOARD_MAX_TOTAL_DURATION,
} from '../canvas/nodes/storyboardUtils'

type Getter = () => any
type Setter = (fn: (s: any) => any) => void
type NodeStatusValue = 'idle' | 'queued' | 'running' | 'success' | 'error'

interface RunnerHandlers {
  setNodeStatus: (id: string, status: NodeStatusValue, patch?: Partial<any>) => void
  appendLog: (id: string, line: string) => void
  beginToken: (id: string) => void
  endRunToken: (id: string) => void
  isCanceled: (id: string) => boolean
}

interface RunnerContext extends RunnerHandlers {
  id: string
  state: any
  data: any
  kind: string
  taskKind: TaskKind
  prompt: string
  sampleCount: number
  supportsSamples: boolean
  isImageTask: boolean
  isVideoTask: boolean
  modelKey?: string
  getState: Getter
}

function nowLabel() {
  return new Date().toLocaleTimeString()
}

const SORA_VIDEO_MODEL_WHITELIST = new Set(['sora-2', 'sy-8', 'sy_8'])
const SORA_POLL_TIMEOUT_MS = 300_000
const MAX_VIDEO_DURATION_SECONDS = 15
const IMAGE_NODE_KINDS = new Set(['image', 'textToImage', 'mosaic'])
const VIDEO_RENDER_NODE_KINDS = new Set(['composeVideo', 'video'])
const ANTHROPIC_VERSION = '2023-06-01'
const VEO_RESULT_POLL_INTERVAL_MS = 4000
const VEO_RESULT_POLL_TIMEOUT_MS = 480_000
function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
const DEFAULT_IMAGE_MODEL = getDefaultModel('image')
async function runAnthropicTextTask(modelKey: string | undefined, prompt: string, systemPrompt?: string) {
  const providers = await listModelProviders()
  const provider = providers.find((p) => p.vendor === 'anthropic' || (p.baseUrl || '').toLowerCase().includes('anthropic'))
  if (!provider) throw new Error('未找到 Anthropic 提供商配置')

  const tokens = await listModelTokens(provider.id)
  const token = tokens.find((t) => t.enabled && t.secretToken)
  if (!token || !token.secretToken) throw new Error('未配置可用的 Anthropic 密钥')

  const base = (provider.baseUrl || 'https://api.anthropic.com').replace(/\/+$/, '')
  const url = /\/v\d+\/messages$/i.test(base)
    ? base
    : `${base}${/\/v\d+$/i.test(base) ? '' : '/v1'}/messages`

  const body: any = {
    model: modelKey || 'claude-3.5-sonnet',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 4096,
  }
  if (systemPrompt) body.system = systemPrompt

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token.secretToken}`,
      'x-api-key': token.secretToken,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify(body),
  })

  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(`Anthropic 调用失败: ${resp.status} ${text}`)
  }

  const json: any = await resp.json().catch(() => null)
  const parts: string[] = []
  if (json?.content && Array.isArray(json.content)) {
    for (const c of json.content) {
      if (c?.type === 'text' && typeof c.text === 'string') parts.push(c.text)
    }
  }
  const textOut = parts.join('\n').trim() || json?.output_text || ''

  return {
    id: json?.id || `anth-${Date.now()}`,
    status: 'succeeded',
    assets: [],
    raw: { text: textOut || 'Anthropic 调用成功', response: json },
  }
}

function getRemixTargetIdFromNodeData(data?: any): string | null {
  if (!data) return null
  const kind = String(data.kind || '').toLowerCase()
  const isVideoKind = kind === 'composevideo' || kind === 'video' || kind === 'storyboard'
  if (!isVideoKind) return null

  const sanitize = (val: any) => {
    if (typeof val !== 'string') return null
    const trimmed = val.trim()
    if (!trimmed) return null
    const lower = trimmed.toLowerCase()
    // 仅允许 postId / p/ 形态
    if (lower.startsWith('s_') || lower.startsWith('p/')) return trimmed
    return null
  }

  const videoResults = Array.isArray(data.videoResults) ? data.videoResults : []
  const primaryIndex =
    typeof data.videoPrimaryIndex === 'number' &&
    data.videoPrimaryIndex >= 0 &&
    data.videoPrimaryIndex < videoResults.length
      ? data.videoPrimaryIndex
      : videoResults.length > 0
        ? 0
        : -1
  const primaryResult = primaryIndex >= 0 ? videoResults[primaryIndex] : null

  const candidates = [
    sanitize(data.videoPostId),
    sanitize(primaryResult?.remixTargetId),
    sanitize(primaryResult?.pid),
    sanitize(primaryResult?.postId),
    sanitize(primaryResult?.post_id),
  ]

  return candidates.find(Boolean) || null
}

function rewriteSoraVideoResourceUrl(url?: string | null): string | null {
  if (!url) return null
  const base = useUIStore.getState().soraVideoBaseUrl
  if (!base) return url
  try {
    const parsed = new URL(url)
    const host = parsed.host.toLowerCase()
    const shouldRewrite = host.includes('openai.com') || host.startsWith('videos.') || (host.includes('sora') && host.includes('video'))
    if (!shouldRewrite) return url
    const baseParsed = new URL(base)
    parsed.protocol = baseParsed.protocol
    parsed.host = baseParsed.host
    parsed.port = baseParsed.port
    return parsed.toString()
  } catch {
    return url
  }
}

function buildSoraPublicPostUrl(postId?: string | null): string | null {
  if (!postId) return null
  const normalized = postId.trim()
  if (!normalized) return null
  const targetId = normalized.startsWith('p/') ? normalized.slice(2) : normalized
  const base = useUIStore.getState().soraVideoBaseUrl
  if (base) {
    try {
      const parsed = new URL(base)
      parsed.pathname = `/p/${targetId}`
      parsed.search = ''
      parsed.hash = ''
      return parsed.toString()
    } catch {
      // ignore malformed base URL
    }
  }
  return `https://sora.chatgpt.com/p/${targetId}`
}

function extractSoraDraftStatus(draft: any): string | null {
  if (!draft) return null
  const rawStatus = typeof draft.status === 'string'
    ? draft.status
    : typeof draft.raw?.status === 'string'
      ? draft.raw.status
      : null
  return rawStatus || null
}

function extractSoraDraftProgress(draft: any): number | null {
  if (!draft) return null
  const source = typeof draft.progress === 'number'
    ? draft.progress
    : typeof draft.raw?.progress === 'number'
      ? draft.raw.progress
      : null
  if (typeof source !== 'number' || Number.isNaN(source)) return null
  const normalized = source <= 1 ? source * 100 : source
  return Math.max(0, Math.min(100, normalized))
}

function collectReferenceImages(state: any, targetId: string): string[] {
  if (!state) return []
  const edges = Array.isArray(state.edges) ? state.edges : []
  const nodes = Array.isArray(state.nodes) ? (state.nodes as Node[]) : []
  const inbound = edges.filter((e: any) => e.target === targetId)
  if (!inbound.length) return []

  // 仅使用最近的上游图片节点，避免拿当前节点的图片作为参考
  const upstreamImageEdge = [...inbound].reverse().find((edge) => {
    const src = nodes.find((n: Node) => n.id === edge.source)
    const kind: string | undefined = (src?.data as any)?.kind
    return Boolean(kind && IMAGE_NODE_KINDS.has(kind))
  })
  if (!upstreamImageEdge) return []

  const src = nodes.find((n: Node) => n.id === upstreamImageEdge.source)
  const data: any = src?.data || {}
  const kind: string | undefined = data.kind
  if (!kind || !IMAGE_NODE_KINDS.has(kind)) return []

  const collected: string[] = []
  const results = Array.isArray(data.imageResults) ? data.imageResults : []
  const primaryIndex =
    typeof data.imagePrimaryIndex === 'number' &&
    data.imagePrimaryIndex >= 0 &&
    data.imagePrimaryIndex < results.length
      ? data.imagePrimaryIndex
      : 0
  const primaryFromResults =
    results[primaryIndex] && typeof results[primaryIndex].url === 'string'
      ? results[primaryIndex].url.trim()
      : ''
  const primaryFallback = typeof data.imageUrl === 'string' ? data.imageUrl.trim() : ''
  const primary = primaryFromResults || primaryFallback
  if (primary) collected.push(primary)

  const poseRefs = Array.isArray(data.poseReferenceImages) ? data.poseReferenceImages : []
  if (poseRefs.length) {
    poseRefs.forEach((url: any) => {
      if (typeof url === 'string' && url.trim()) collected.push(url.trim())
    })
  } else if (typeof data.poseStickmanUrl === 'string' && data.poseStickmanUrl.trim()) {
    collected.push(data.poseStickmanUrl.trim())
  }

  return Array.from(new Set(collected))
}

function normalizeManualReferenceImages(value: any): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const result: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const trimmed = item.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    result.push(trimmed)
    if (result.length >= 3) break
  }
  return result
}

function buildRunnerContext(id: string, get: Getter): RunnerContext | null {
  const state = get()
  const nodes = (state.nodes || []) as Node[]
  const node = nodes.find((n: Node) => n.id === id)
  if (!node) return null

  const data: any = node.data || {}
  const kind: string = data.kind || 'task'
  const taskKind = resolveTaskKind(kind)
  const prompt = buildPromptFromState(kind, data, state, id)
  const { sampleCount, supportsSamples, isImageTask, isVideoTask } =
    computeSampleMeta(kind, data)
  const handlers: RunnerHandlers = {
    setNodeStatus: state.setNodeStatus as RunnerHandlers['setNodeStatus'],
    appendLog: state.appendLog as RunnerHandlers['appendLog'],
    beginToken: state.beginRunToken as RunnerHandlers['beginToken'],
    endRunToken: state.endRunToken as RunnerHandlers['endRunToken'],
    isCanceled: state.isCanceled as RunnerHandlers['isCanceled'],
  }

  const textModelKey =
    (data.geminiModel as string | undefined) ||
    (data.modelKey as string | undefined)
  const imageModelKey = data.imageModel as string | undefined
  const modelKey = (IMAGE_NODE_KINDS.has(kind) ? imageModelKey : textModelKey) || undefined

  return {
    id,
    state,
    data,
    kind,
    taskKind,
    prompt,
    sampleCount,
    supportsSamples,
    isImageTask,
    isVideoTask,
    modelKey,
    getState: get,
    ...handlers,
  }
}

function resolveTaskKind(kind: string): TaskKind {
  if (IMAGE_NODE_KINDS.has(kind)) return 'text_to_image'
  if (kind === 'composeVideo' || kind === 'storyboard' || kind === 'video') return 'text_to_video'
  return 'prompt_refine'
}

function buildPromptFromState(
  kind: string,
  data: any,
  state: any,
  id: string,
): string {
  if (IMAGE_NODE_KINDS.has(kind) || kind === 'composeVideo' || kind === 'storyboard' || kind === 'video') {
    const edges = (state.edges || []) as any[]
    const inbound = edges.filter((e) => e.target === id)
    const upstreamPrompts: string[] = []
    const inboundHasImage = inbound.some((edge) => {
      const src = (state.nodes as Node[]).find((n: Node) => n.id === edge.source)
      const skind: string | undefined = (src?.data as any)?.kind
      return skind ? IMAGE_NODE_KINDS.has(skind) : false
    })
    if (inbound.length) {
      inbound.forEach((edge) => {
        const src = (state.nodes as Node[]).find((n: Node) => n.id === edge.source)
        if (!src) return
        const sd: any = src.data || {}
        const skind: string | undefined = sd.kind
        if (!skind) return
        const targetIsVideoRender = VIDEO_RENDER_NODE_KINDS.has(kind)
        const sourceIsVideoRender = VIDEO_RENDER_NODE_KINDS.has(skind)
        if (targetIsVideoRender && sourceIsVideoRender) {
          // 当视频继续连接视频节点时，避免继承上游完整提示词以免重复堆叠
          return
        }
        const promptCandidates: string[] = []
        if (IMAGE_NODE_KINDS.has(skind) || skind === 'textToImage' || skind === 'image') {
          if (typeof sd.prompt === 'string') promptCandidates.push(sd.prompt)
        }
        if (skind === 'composeVideo' || skind === 'video' || skind === 'storyboard') {
          if (typeof sd.videoPrompt === 'string') promptCandidates.push(sd.videoPrompt)
          if (typeof sd.prompt === 'string') promptCandidates.push(sd.prompt)
        }
        if (skind === 'text') {
          if (typeof sd.prompt === 'string') promptCandidates.push(sd.prompt)
          if (typeof sd.text === 'string') promptCandidates.push(sd.text)
        }
        promptCandidates
          .map((p) => (typeof p === 'string' ? p.trim() : ''))
          .filter(Boolean)
          .forEach((p) => upstreamPrompts.push(p))
      })
    }
    // 优先保留节点自身已写入的 prompt/videoPrompt
    // 如果节点显式存在 prompt 字段（即使是空字符串），视为用户手动控制，不再从 videoPrompt 回填
    const hasOwnPromptField = Object.prototype.hasOwnProperty.call(data, 'prompt')
    const ownPrompt =
      hasOwnPromptField && typeof data.prompt === 'string'
        ? data.prompt
        : ''
    const ownVideoPrompt =
      !hasOwnPromptField && typeof data.videoPrompt === 'string'
        ? data.videoPrompt
        : ''
    const own = ownPrompt || ownVideoPrompt
    const combinedBase = inboundHasImage
      ? [own] // 参考图场景下，避免把上游图的提示词混入视频 prompt
      : [...upstreamPrompts, own]
    const combined = combinedBase.filter((p) => typeof p === 'string' && p.trim())
    if (!combined.length) {
      return (data.label as string) || ''
    }
    return combined.join('\n')
  }

  return (data.prompt as string) || (data.label as string) || ''
}

function computeSampleMeta(kind: string, data: any) {
  const isImageTask = IMAGE_NODE_KINDS.has(kind)
  const isVideoTask = kind === 'composeVideo' || kind === 'storyboard' || kind === 'video'
    const rawSampleCount = typeof data.sampleCount === 'number' ? data.sampleCount : 1
  const supportsSamples = isImageTask || isVideoTask
  const sampleCount = supportsSamples
    ? Math.max(1, Math.min(5, Math.floor(rawSampleCount || 1)))
    : 1

  return { sampleCount, supportsSamples, isImageTask, isVideoTask }
}

function ensurePrompt(ctx: RunnerContext): boolean {
  if (ctx.prompt.trim()) return true
  ctx.appendLog(ctx.id, `[${nowLabel()}] 缺少提示词，已跳过`)
  return false
}

function beginQueuedRun(ctx: RunnerContext) {
  ctx.beginToken(ctx.id)
  ctx.setNodeStatus(ctx.id, 'queued', { progress: 0 })
  ctx.appendLog(
    ctx.id,
    `[${nowLabel()}] queued (AI, ${ctx.taskKind}${
      ctx.supportsSamples && ctx.sampleCount > 1 ? `, x${ctx.sampleCount}` : ''
    })`,
  )
}

export async function runNodeRemote(id: string, get: Getter, set: Setter) {
  const ctx = buildRunnerContext(id, get)
  if (!ctx) return

  if (!ensurePrompt(ctx)) return

  beginQueuedRun(ctx)

  
  if (ctx.isVideoTask) {
    await runVideoTask(ctx)
    return
  }

  await runGenericTask(ctx)
}

async function runTextTask(ctx: RunnerContext) {
  const { id, sampleCount, taskKind, kind, data, modelKey, prompt, setNodeStatus, appendLog } = ctx
  ctx.beginToken(id)
  const runAnthropicTextTask = async (model: string | undefined, userPrompt: string, systemPrompt?: string) => {
    const providers = await listModelProviders()
    const provider = providers.find((p) => p.vendor === 'anthropic' || (p.baseUrl || '').toLowerCase().includes('anthropic'))
    if (!provider) throw new Error('未找到 Anthropic 提供商配置')

    const tokens = await listModelTokens(provider.id)
    const token = tokens.find((t) => t.enabled && t.secretToken)
    if (!token || !token.secretToken) throw new Error('未配置可用的 Anthropic 密钥')

    const base = (provider.baseUrl || 'https://api.anthropic.com').replace(/\/+$/, '')
    const url = /\/v\d+\/messages$/i.test(base)
      ? base
      : `${base}${/\/v\d+$/i.test(base) ? '' : '/v1'}/messages`

    const body: any = {
      model: model || 'claude-3.5-sonnet',
      messages: [{ role: 'user', content: userPrompt }],
      max_tokens: 4096,
    }
    if (systemPrompt) body.system = systemPrompt

    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token.secretToken}`,
        'x-api-key': token.secretToken,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify(body),
    })

    if (!resp.ok) {
      const text = await resp.text().catch(() => '')
      throw new Error(`Anthropic 调用失败: ${resp.status} ${text}`)
    }

    const json: any = await resp.json().catch(() => null)
    const parts: string[] = []
    if (json?.content && Array.isArray(json.content)) {
      for (const c of json.content) {
        if (c?.type === 'text' && typeof c.text === 'string') parts.push(c.text)
      }
    }
    const textOut = parts.join('\n').trim() || json?.output_text || ''

    return {
      id: json?.id || `anth-${Date.now()}`,
      status: 'succeeded',
      assets: [],
      raw: { text: textOut || 'Anthropic 调用成功', response: json },
    }
  }
  try {
    const explicitVendor = typeof (data as any)?.modelVendor === 'string' ? (data as any).modelVendor : null
    const vendor = explicitVendor || (isAnthropicModel(modelKey) || (modelKey && modelKey.toLowerCase().includes('claude')) ? 'anthropic' : 'gemini')
    appendLog(
      id,
      `[${nowLabel()}] 调用${vendor === 'anthropic' ? 'Anthropic/Claude' : 'Gemini'} 文案模型批量生成提示词 x${sampleCount}（并行）…`,
    )

    const indices = Array.from({ length: sampleCount }, (_, i) => i)
    const settled = await Promise.allSettled(
      indices.map(() =>
        vendor === 'anthropic'
          ? runAnthropicTextTask(modelKey, prompt, (data as any)?.systemPrompt)
          : runTaskByVendor(vendor, {
              kind: taskKind,
              prompt,
              extras: {
                nodeKind: kind,
                nodeId: id,
                modelKey,
                systemPrompt: (data as any)?.systemPrompt,
              },
            }),
      ),
    )

    const allTexts: string[] = []
    let lastRes: any = null
    for (const r of settled) {
      if (r.status === 'fulfilled') {
        const res = r.value as any
        lastRes = res
        const textOut = (res.raw && (res.raw.text as string)) || ''
        if (textOut.trim()) {
          allTexts.push(textOut.trim())
        }
      } else {
        const err = r.reason as any
        const msg = err?.message || '文案模型调用失败'
        appendLog(id, `[${nowLabel()}] error: ${msg}`)
      }
    }

    if (!lastRes || allTexts.length === 0) {
      const msg = '文案模型调用失败：无有效结果'
      setNodeStatus(id, 'error', { progress: 0, lastError: msg })
      appendLog(id, `[${nowLabel()}] error: ${msg}`)
      ctx.endRunToken(id)
      return
    }

    const text = (lastRes.raw && (lastRes.raw.text as string)) || ''
    const preview =
      text.trim().length > 0
        ? { type: 'text', value: text }
        : { type: 'text', value: 'AI 调用成功' }

    const existingTexts =
      (data.textResults as { text: string }[] | undefined) || []
    const mergedTexts = [
      ...existingTexts,
      ...allTexts.map((t) => ({ text: t })),
    ]

    setNodeStatus(id, 'success', {
      progress: 100,
      lastResult: {
        id: lastRes.id,
        at: Date.now(),
        kind,
        preview,
      },
      textResults: mergedTexts,
    })

    appendLog(
      id,
      `[${nowLabel()}] 文案模型调用完成，共生成 ${allTexts.length} 条候选提示词`,
    )
  } catch (err: any) {
    const msg = err?.message || '文案模型调用失败'
    const status = (err as any)?.status || 'unknown'
    const enhancedMsg = status === 429
      ? `${msg} (API配额已用尽，请稍后重试或升级计划)`
      : msg

    setNodeStatus(id, 'error', {
      progress: 0,
      lastError: enhancedMsg,
      httpStatus: status,
      isQuotaExceeded: status === 429,
    })
    appendLog(id, `[${nowLabel()}] error: ${enhancedMsg}`)
  } finally {
    ctx.endRunToken(id)
  }
}

async function runSora2ApiVideoTask(
  ctx: RunnerContext,
  options: {
    prompt: string
    durationSeconds: number
    orientation: 'portrait' | 'landscape'
    remixTargetId?: string | null
    referenceImageUrl?: string | null
  },
) {
  const { id, data, kind, setNodeStatus, appendLog, isCanceled, endRunToken } = ctx
  const { prompt, durationSeconds, orientation, referenceImageUrl } = options
  const remixTargetId =
    typeof options.remixTargetId === 'string' && options.remixTargetId.trim()
      ? options.remixTargetId.trim()
      : null
  try {
    const videoModelValue = (data as any)?.videoModel as string | undefined
    const modelKey = (videoModelValue || '').trim() || 'sora-2'
    const existingTaskId = (data as any)?.videoTaskId as string | undefined
    const existingStatus = (data as any)?.status as NodeStatusValue | undefined
    const canResumeExisting =
      typeof existingTaskId === 'string' &&
      existingTaskId.trim().startsWith('task_') &&
      (existingStatus === 'running' || existingStatus === 'queued')

    let taskId = existingTaskId || ''

    if (canResumeExisting) {
      // 已有未完成的 Sora2API 任务，优先续上，避免重复创建
      const initialProgress =
        typeof (data as any)?.progress === 'number' && Number.isFinite((data as any).progress)
          ? Math.max(5, Math.min(95, Math.round((data as any).progress)))
          : 10
      setNodeStatus(id, 'running', {
        progress: initialProgress,
        videoTaskId: existingTaskId,
        videoModel: modelKey,
        videoModelVendor: (data as any)?.videoModelVendor || 'sora2api',
      })
      appendLog(
        id,
        `[${nowLabel()}] 发现已有 Sora2API 视频任务（ID: ${existingTaskId}），继续查询进度…`,
      )
    } else {
      setNodeStatus(id, 'running', { progress: 5 })
      appendLog(
        id,
        `[${nowLabel()}] 调用 Sora2API 视频模型${remixTargetId ? `（Remix: ${remixTargetId}）` : ''}…`,
      )

      const persist = useUIStore.getState().assetPersistenceEnabled
      const res = await runTaskByVendor('sora2api', {
        kind: 'text_to_video',
        prompt,
        extras: {
          nodeKind: kind,
          nodeId: id,
          modelKey,
          durationSeconds,
          orientation,
          ...(remixTargetId ? { remixTargetId } : {}),
          ...(referenceImageUrl ? { url: referenceImageUrl } : {}),
          persistAssets: persist,
        },
      })

      taskId = res.id
      if (!taskId) {
        const msg = 'Sora2API 视频任务创建失败：未返回任务 ID'
        setNodeStatus(id, 'error', { progress: 0, lastError: msg })
        appendLog(id, `[${nowLabel()}] error: ${msg}`)
        return
      }

      setNodeStatus(id, 'running', {
        progress: 10,
        lastResult: {
          id: taskId,
          at: Date.now(),
          kind,
          preview: {
            type: 'text',
            value: `已创建 Sora2API 视频任务（ID: ${taskId}）`,
          },
        },
        videoTaskId: taskId,
        videoModel: modelKey,
        videoModelVendor: (data as any)?.videoModelVendor || 'sora2api',
      })

      // 任务创建成功后，立即静默保存一次项目，使 taskId 持久化，刷新后可以续上
      if (typeof window !== 'undefined' && typeof (window as any).silentSaveProject === 'function') {
        try {
          ;(window as any).silentSaveProject()
        } catch {
          // ignore save errors here
        }
      }
    }

    if (!taskId) {
      const msg = 'Sora2API 视频任务创建失败：未获取到有效任务 ID'
      setNodeStatus(id, 'error', { progress: 0, lastError: msg })
      appendLog(id, `[${nowLabel()}] error: ${msg}`)
      return
    }

    const pollIntervalMs = 3000
    // 超过 10 分钟仍未完成视为 bad case，前端直接标记为错误
    const pollTimeoutMs = 600_000
    const startedAt = Date.now()
    let lastProgress = 10

    while (Date.now() - startedAt < pollTimeoutMs) {
      if (isCanceled(id)) {
        setNodeStatus(id, 'error', { progress: 0, lastError: '任务已取消' })
        appendLog(id, `[${nowLabel()}] 已取消 Sora2API 视频任务`)
        return
      }

      await sleep(pollIntervalMs)
      let snapshot: TaskResultDto
      try {
        snapshot = await fetchSora2ApiTaskResult(taskId, prompt)
      } catch (err: any) {
        const msg = err?.message || '查询 Sora2API 任务进度失败'
        appendLog(id, `[${nowLabel()}] error: ${msg}`)
        continue
      }

      if (snapshot.status === 'running') {
        const rawProgress =
          (snapshot.raw && (snapshot.raw.progress as number | undefined)) ||
          (snapshot.raw && (snapshot.raw.response?.progress as number | undefined)) ||
          null
        if (typeof rawProgress === 'number') {
          const normalized = Math.min(95, Math.max(lastProgress, Math.max(5, Math.round(rawProgress))))
          lastProgress = normalized
          setNodeStatus(id, 'running', { progress: normalized })
        }
        continue
      }

      if (snapshot.status === 'failed') {
        const msg =
          (snapshot.raw && (snapshot.raw.response?.error || snapshot.raw.error || snapshot.raw.message)) ||
          'Sora2API 视频任务失败'
        setNodeStatus(id, 'error', { progress: 0, lastError: msg })
        appendLog(id, `[${nowLabel()}] error: ${msg}`)
        return
      }

      // succeeded
      const rawResponse = (snapshot.raw as any)?.response
      const pickText = (v: any) => (typeof v === 'string' && v.trim() ? v.trim() : null)
      const extractVideoFromRaw = (): { url: string; thumbnailUrl: string | null } | null => {
        if (!rawResponse) return null
        const fromVideoUrlField = rawResponse.video_url
        const fromVideoUrl =
          pickText(fromVideoUrlField?.url) ||
          pickText(fromVideoUrlField) ||
          pickText(rawResponse.videoUrl?.url) ||
          pickText(rawResponse.videoUrl) ||
          null
        const fromResults = Array.isArray(rawResponse.results) && rawResponse.results.length
          ? pickText(rawResponse.results[0]?.url) ||
            pickText(rawResponse.results[0]?.video_url) ||
            pickText(rawResponse.results[0]?.videoUrl)
          : null
        const fromDataResults =
          rawResponse.data && Array.isArray(rawResponse.data.results) && rawResponse.data.results.length
            ? pickText(rawResponse.data.results[0]?.url) ||
              pickText(rawResponse.data.results[0]?.video_url) ||
              pickText(rawResponse.data.results[0]?.videoUrl)
            : null
        let url = fromVideoUrl || fromResults || fromDataResults
        if (!url) {
          const content = pickText(rawResponse.content)
          if (content) {
            const match = content.match(/<video[^>]+src=['"]([^'"]+)['"][^>]*>/i)
            if (match && match[1] && match[1].trim()) {
              url = match[1].trim()
            }
          }
        }
        if (!url) return null
        const thumb =
          pickText(rawResponse.thumbnail_url) ||
          pickText(rawResponse.thumbnailUrl) ||
          (Array.isArray(rawResponse.results) && rawResponse.results.length
            ? pickText(rawResponse.results[0]?.thumbnailUrl) || pickText(rawResponse.results[0]?.thumbnail_url)
            : null) ||
          (rawResponse.data && Array.isArray(rawResponse.data.results) && rawResponse.data.results.length
            ? pickText(rawResponse.data.results[0]?.thumbnailUrl) || pickText(rawResponse.data.results[0]?.thumbnail_url)
            : null) ||
          null
        return { url, thumbnailUrl: thumb }
      }

      let asset = (snapshot.assets || []).find((a) => a.type === 'video') || (snapshot.assets || [])[0]
      if (!asset || !asset.url) {
        const fallback = extractVideoFromRaw()
        if (fallback?.url) {
          asset = { type: 'video', url: fallback.url, thumbnailUrl: fallback.thumbnailUrl }
        }
      }
      if (!asset || !asset.url) {
        const msg = 'Sora2API 视频任务执行失败：未返回有效视频地址'
        setNodeStatus(id, 'error', { progress: 0, lastError: msg })
        appendLog(id, `[${nowLabel()}] error: ${msg}`)
        return
      }

      const videoUrl = asset.url
      const thumbnailUrl = asset.thumbnailUrl || null
      const preview = { type: 'video' as const, src: videoUrl }
      const firstResultEntry =
        rawResponse && Array.isArray(rawResponse.results) && rawResponse.results.length
          ? rawResponse.results[0]
          : rawResponse &&
              rawResponse.data &&
              Array.isArray(rawResponse.data.results) &&
              rawResponse.data.results.length
            ? rawResponse.data.results[0]
            : null
      const pidCandidate =
        (firstResultEntry && typeof firstResultEntry.pid === 'string' && firstResultEntry.pid.trim()) ||
        (firstResultEntry && typeof firstResultEntry.postId === 'string' && firstResultEntry.postId.trim()) ||
        (firstResultEntry && typeof firstResultEntry.post_id === 'string' && firstResultEntry.post_id.trim()) ||
        (rawResponse && typeof rawResponse.pid === 'string' && rawResponse.pid.trim()) ||
        (rawResponse && typeof rawResponse.postId === 'string' && rawResponse.postId.trim()) ||
        (rawResponse && typeof rawResponse.post_id === 'string' && rawResponse.post_id.trim()) ||
        null

      const existingResults = ((data as any)?.videoResults as any[] | undefined) || []
      const newResult = {
        id: snapshot.id || taskId,
        url: videoUrl,
        thumbnailUrl,
        title: (data as any)?.videoTitle || null,
        duration: durationSeconds,
        model: modelKey,
        remixTargetId: pidCandidate,
      }
      const updatedVideoResults = [...existingResults, newResult]
      const nextPrimaryIndex = updatedVideoResults.length - 1

      setNodeStatus(id, 'success', {
        progress: 100,
        lastResult: {
          id: snapshot.id || taskId,
          at: Date.now(),
          kind,
          preview,
        },
        prompt,
        videoUrl,
        videoThumbnailUrl: thumbnailUrl || (data as any)?.videoThumbnailUrl || null,
        videoResults: updatedVideoResults,
        videoPrimaryIndex: nextPrimaryIndex,
        videoDurationSeconds: durationSeconds,
        videoModel: modelKey,
        videoModelVendor: (data as any)?.videoModelVendor || 'sora2api',
        videoTaskId: taskId,
        remixTargetId: pidCandidate || (data as any)?.remixTargetId || null,
        videoPostId: pidCandidate || (data as any)?.videoPostId || null,
      })
      appendLog(id, `[${nowLabel()}] Sora2API 视频生成完成。`)
      if (snapshot.assets && snapshot.assets.length) {
        notifyAssetRefresh()
      }
      return
    }

    const timeoutMsg = 'Sora2API 视频任务查询超时，请稍后在 Sora2API 控制台确认结果'
    setNodeStatus(id, 'error', { progress: 0, lastError: timeoutMsg })
    appendLog(id, `[${nowLabel()}] error: ${timeoutMsg}`)
  } catch (err: any) {
    const msg = err?.message || 'Sora2API 视频任务执行失败'
    setNodeStatus(id, 'error', { progress: 0, lastError: msg })
    appendLog(id, `[${nowLabel()}] error: ${msg}`)
  } finally {
    endRunToken(id)
  }
}

async function runVideoTask(ctx: RunnerContext) {
  const { id, data, state, prompt, kind, setNodeStatus, appendLog, isCanceled } = ctx
  try {
    const isStoryboard = kind === 'storyboard'
    const storyboardRawText = isStoryboard
      ? ((data as any)?.storyboard as string) || prompt
      : ''
    const storyboardScenesData = isStoryboard
      ? normalizeStoryboardScenes((data as any)?.storyboardScenes, storyboardRawText)
      : null
    const storyboardNotes = isStoryboard ? (data as any)?.storyboardNotes || '' : ''
    const storyboardTitle = isStoryboard ? (data as any)?.storyboardTitle || (data as any)?.label || '' : ''
    const storyboardTotalDuration = isStoryboard ? totalStoryboardDuration(storyboardScenesData || []) : 0
    if (isStoryboard) {
      if (storyboardTotalDuration > STORYBOARD_MAX_TOTAL_DURATION + 1e-6) {
        const msg = '分镜总时长不能超过 25 秒，请调整各镜头时长'
        setNodeStatus(id, 'error', { progress: 0, lastError: msg })
        appendLog(id, `[${nowLabel()}] error: ${msg}`)
        ctx.endRunToken(id)
        return
      }
    }
    const effectivePrompt = isStoryboard
      ? serializeStoryboardScenes(storyboardScenesData || [], { title: storyboardTitle, notes: storyboardNotes })
      : prompt
    const orientation: 'portrait' | 'landscape' = ((data as any)?.orientation as 'portrait' | 'landscape') || 'landscape'
    // Remix 目标：仅在存在上游视频节点时，使用其 postId
    let remixTargetId: string | null = null
    const aspectRatioSetting =
      typeof (data as any)?.aspect === 'string' && (data as any).aspect.trim()
        ? (data as any).aspect.trim()
        : '16:9'
    const videoModelValue = (data as any)?.videoModel as string | undefined
    const videoModelVendorRaw = ((data as any)?.videoModelVendor as string | undefined) || null
    const videoModelVendor =
      videoModelVendorRaw && videoModelVendorRaw.toLowerCase() === 'sora'
        ? 'sora2api'
        : videoModelVendorRaw
    const fallbackVideoVendor =
      videoModelValue && videoModelValue.toLowerCase().includes('veo') ? 'veo' : 'sora2api'
    const videoVendor = videoModelVendor || fallbackVideoVendor
    let videoDurationSeconds: number = Number((data as any)?.videoDurationSeconds)
    if (Number.isNaN(videoDurationSeconds) || videoDurationSeconds <= 0) {
      if (isStoryboard) {
        videoDurationSeconds = storyboardTotalDuration > 0 ? storyboardTotalDuration : 10
      } else {
        videoDurationSeconds = 10
      }
    }
    if (isStoryboard && storyboardTotalDuration > 0) {
      videoDurationSeconds = Math.min(videoDurationSeconds, storyboardTotalDuration)
    }
    const maxDurationSeconds = isStoryboard ? STORYBOARD_MAX_TOTAL_DURATION : MAX_VIDEO_DURATION_SECONDS
    videoDurationSeconds = Math.max(2, Math.min(videoDurationSeconds, maxDurationSeconds))
    const nFrames = Math.round(Math.max(videoDurationSeconds, 1) * 30)
    const getCurrentVideoTokenId = () =>
      (ctx.getState().nodes.find((n: Node) => n.id === id)?.data as any)
        ?.videoTokenId as string | undefined

    const edges = (state.edges || []) as any[]
    const nodes = (state.nodes || []) as Node[]
    const inbound = edges.filter((e) => e.target === id)
    const autoReferenceImages = collectReferenceImages(state, id)
    const manualVeoReferenceImages = normalizeManualReferenceImages((data as any)?.veoReferenceImages)
    const firstFrameUrlValue = typeof (data as any)?.veoFirstFrameUrl === 'string'
      ? (data as any).veoFirstFrameUrl.trim()
      : ''
    const lastFrameUrlValue = typeof (data as any)?.veoLastFrameUrl === 'string'
      ? (data as any).veoLastFrameUrl.trim()
      : ''
    const allowReferenceImages = !firstFrameUrlValue
    let referenceImagesForVideo = autoReferenceImages
    if (videoVendor === 'veo') {
      referenceImagesForVideo = allowReferenceImages
        ? manualVeoReferenceImages.length
          ? manualVeoReferenceImages
          : autoReferenceImages
        : []
      if (referenceImagesForVideo.length > 3) {
        referenceImagesForVideo = referenceImagesForVideo.slice(0, 3)
      }
    }
    if (inbound.length) {
      for (const edge of inbound) {
        const src = nodes.find((n: Node) => n.id === edge.source)
        const candidate = getRemixTargetIdFromNodeData(src?.data)
        if (candidate) {
          remixTargetId = candidate
          break
        }
      }
    }

    let inpaintFileId: string | null = null
    let imageUrlForUpload: string | null = null
    if (!remixTargetId) {
      try {
        if (inbound.length) {
          const lastEdge = inbound[inbound.length - 1]
          const src = nodes.find((n: Node) => n.id === lastEdge.source)
          if (src) {
            const sd: any = src.data || {}
            const skind: string | undefined = sd.kind

            let primaryMediaUrl = null
            if (skind && IMAGE_NODE_KINDS.has(skind)) {
              primaryMediaUrl = (sd.imageUrl as string | undefined) || null
            } else if (skind === 'video' || skind === 'composeVideo' || skind === 'storyboard') {
              if (
                sd.videoResults &&
                sd.videoResults.length > 0 &&
                sd.videoPrimaryIndex !== undefined
              ) {
                primaryMediaUrl = sd.videoResults[sd.videoPrimaryIndex]?.url || sd.videoResults[0]?.url
              } else {
                primaryMediaUrl = (sd.videoUrl as string | undefined) || null
              }
            }

            inpaintFileId =
              (sd.soraFileId as string | undefined) ||
              (sd.file_id as string | undefined) ||
              null
            imageUrlForUpload = primaryMediaUrl
          }
        }
      } catch {
        inpaintFileId = null
        imageUrlForUpload = null
      }
    }

    // 如果有上游图片，删除上游图的 prompt 片段，保留自身 prompt，并追加参考说明
    let finalPrompt = effectivePrompt
    if (imageUrlForUpload) {
      const inboundImages = inbound
        .map((edge) => nodes.find((n: Node) => n.id === edge.source))
        .filter((n): n is Node => Boolean(n && IMAGE_NODE_KINDS.has((n.data as any)?.kind)))
      const upstreamPrompts = inboundImages
        .map((n) => (n.data as any)?.prompt as string | undefined)
        .filter((p): p is string => Boolean(p && p.trim().length > 0))
      const refNote = '参考上游图片风格。'
      if (!finalPrompt) {
        finalPrompt = refNote
      } else if (!finalPrompt.includes(refNote)) {
        finalPrompt = `${finalPrompt}\n${refNote}`
      }
    }

    if (videoVendor === 'veo') {
      await runVeoVideoTask(ctx, {
        prompt: finalPrompt,
        model: videoModelValue || 'veo3.1-fast',
        aspectRatio: aspectRatioSetting,
        referenceImages: referenceImagesForVideo,
        durationSeconds: videoDurationSeconds,
        firstFrameUrl: firstFrameUrlValue,
        lastFrameUrl: firstFrameUrlValue ? lastFrameUrlValue : '',
      })
      return
    }

    if (videoVendor === 'sora2api') {
      await runSora2ApiVideoTask(ctx, {
        prompt: finalPrompt,
        durationSeconds: videoDurationSeconds,
        orientation,
        remixTargetId,
        referenceImageUrl: autoReferenceImages[0] || null,
      })
      return
    }

    const initialPatch: any = { progress: 5 }
    if (remixTargetId) {
      initialPatch.remixTargetId = remixTargetId
    }
    setNodeStatus(id, 'running', initialPatch)
    appendLog(id, `[${nowLabel()}] 调用 Sora-2 生成视频任务…`)

    const preferredTokenId = (data as any)?.videoTokenId as string | undefined
    const res = await createSoraVideo({
      prompt: finalPrompt,
      orientation,
      size: 'small',
      n_frames: nFrames,
      inpaintFileId,
      imageUrl: imageUrlForUpload,
      remixTargetId,
      tokenId: preferredTokenId || undefined,
      operation: isStoryboard ? 'storyboard' : undefined,
      title: storyboardTitle || undefined,
    })
    const usedTokenId = (res as any).__usedTokenId as string | undefined
    const switchedTokenIds = (res as any).__switchedFromTokenIds as string[] | undefined
    if (switchedTokenIds?.length) {
      toast('当前 Sora Token 限额已耗尽，已切换备用 Token 继续执行', 'warning')
      appendLog(
        id,
        `[${nowLabel()}] 当前 Token 限额已耗尽，已自动切换备用 Token 继续执行`,
      )
    }
    const generatedModel = (res?.model as string | undefined) || 'sy_8'

    const taskId = res?.id as string | undefined
    const preview = {
      type: 'text',
      value: taskId
        ? `已创建 Sora 视频任务（ID: ${taskId}）`
        : '已创建 Sora 视频任务',
    }

    setNodeStatus(id, 'running', {
      progress: 10,
      lastResult: {
        id: taskId || '',
        at: Date.now(),
        kind,
        preview,
      },
      prompt: finalPrompt,
      soraVideoTask: res,
      videoTaskId: taskId || null,
      videoInpaintFileId: inpaintFileId || null,
      videoOrientation: orientation,
      videoPrompt: finalPrompt,
      videoDurationSeconds,
      videoTokenId: usedTokenId || null,
      videoModel: generatedModel,
    })

    appendLog(
      id,
      `[${nowLabel()}] Sora 视频任务创建完成${taskId ? `（ID: ${taskId}）` : ''}，开始轮询进度…`,
    )

    if (!taskId) {
      setNodeStatus(id, 'success', {
        progress: 100,
        lastResult: {
          id: '',
          at: Date.now(),
          kind,
          preview,
        },
        prompt: finalPrompt,
        soraVideoTask: res,
        videoTaskId: null,
        videoInpaintFileId: inpaintFileId || null,
        videoOrientation: orientation,
        videoPrompt: finalPrompt,
        videoDurationSeconds,
        videoTokenId: usedTokenId || null,
      })
      appendLog(
        id,
        `[${nowLabel()}] 未返回任务 ID，已结束跟踪，请在 Sora 中查看生成结果。`,
      )
      ctx.endRunToken(id)
      return
    }

    const pollStartedAt = Date.now()
    const pollTimeoutMs = SORA_POLL_TIMEOUT_MS
    let pollTimedOut = false
    let lastSyncError: any = null
    let draftSynced = false
    let lastDraft: {
      id: string
      title: string | null
      prompt: string | null
      thumbnailUrl: string | null
      videoUrl: string | null
      postId?: string | null
      duration?: number
      status?: string | null
      progress?: number | null
      raw?: any
    } | null = null
    let progress = 10

    const syncDraftVideo = async (force = false) => {
      if (!force && draftSynced) return null
      draftSynced = true
      try {
        const draftTokenId = getCurrentVideoTokenId()
        const draft = await getSoraVideoDraftByTask(taskId, draftTokenId || null)
        lastSyncError = null
        lastDraft = draft
        const patch: any = {
          videoDraftId: draft.id,
          videoPostId: draft.postId || null,
          videoTokenId: draftTokenId || null,
        }
        if (draft.videoUrl) {
          patch.videoUrl = rewriteSoraVideoResourceUrl(draft.videoUrl)
        }
        if (draft.thumbnailUrl) {
          patch.videoThumbnailUrl = rewriteSoraVideoResourceUrl(draft.thumbnailUrl)
        }
        if (draft.title) {
          patch.videoTitle = draft.title
        }
        const draftProgress = extractSoraDraftProgress(draft)
        const draftStatus = extractSoraDraftStatus(draft)
        if (draftStatus) {
          patch.videoDraftStatus = draftStatus
        }
        if (draft.videoUrl) {
          patch.progress = 100
        } else if (draftProgress !== null) {
          const normalized = Math.max(progress, Math.max(5, Math.round(draftProgress)))
          patch.progress = Math.min(95, normalized)
        }
        setNodeStatus(id, 'running', patch)
        if (typeof patch.progress === 'number') {
          progress = patch.progress
        }
        if (draft.videoUrl) {
          appendLog(
            id,
            `[${nowLabel()}] 已从草稿同步生成的视频（task_id=${taskId}），可预览。`,
          )
        }
        return draft
      } catch (err: any) {
        const status = err?.status ?? err?.upstreamStatus ?? null
        if (status === 202) {
          lastSyncError = null
          appendLog(id, `[${nowLabel()}] 草稿同步：任务仍在进行中，继续等待...`)
          return null
        }

        if (status === 404) {
          appendLog(id, `[${nowLabel()}] 草稿同步：任务未找到（可能已失败），停止轮询`)
          const notFound: any = new Error('任务未找到或已失败')
          notFound.status = status
          notFound.cause = err
          lastSyncError = notFound
          throw notFound
        }

        const msg = err?.message || '同步 Sora 草稿失败'
        appendLog(id, `[${nowLabel()}] error: ${msg}`)
        lastSyncError = err
        return null
      }
    }

    const pollIntervalMs = 3000
    let finishedFromPending = false

    while (true) {
      if (isCanceled(id)) {
        setNodeStatus(id, 'error', { progress: 0, lastError: '任务已取消' })
        appendLog(id, `[${nowLabel()}] 已取消 Sora 视频任务`)
        ctx.endRunToken(id)
        return
      }

      if (Date.now() - pollStartedAt >= pollTimeoutMs) {
        pollTimedOut = true
        appendLog(id, `[${nowLabel()}] Sora 视频任务等待超过 300 秒，自动停止轮询`)
        break
      }

      try {
        const pending = await listSoraPendingVideos(null)

        if (!pending.length) {
          appendLog(id, `[${nowLabel()}] pending列表为空，尝试同步草稿检查任务状态...`)
          try {
            const draftResult = await syncDraftVideo(true)
            if (draftResult && draftResult.videoUrl) {
              finishedFromPending = true
              appendLog(id, `[${nowLabel()}] 草稿同步成功，任务已完成！`)
              break
            }

            appendLog(id, `[${nowLabel()}] pending为空且草稿未就绪，继续等待...`)
            await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
            continue
          } catch (syncError: any) {
            lastSyncError = syncError
            appendLog(id, `[${nowLabel()}] 草稿同步失败，任务可能已结束: ${syncError.message}`)
            break
          }
        }

        const found = pending.find((t: any) => t.id === taskId)
        if (!found) {
          try {
            const draftResult = await syncDraftVideo(true)
            if (draftResult && draftResult.videoUrl) {
              finishedFromPending = true
              appendLog(id, `[${nowLabel()}] 任务不在pending中，但草稿同步成功，任务已完成！`)
              break
            }
          } catch (syncError: any) {
            lastSyncError = syncError
            appendLog(id, `[${nowLabel()}] 任务不在pending中且草稿同步失败: ${syncError.message}`)
            break
          }

          appendLog(id, `[${nowLabel()}] 任务不在pending中且草稿未就绪，继续等待...`)
          await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
          continue
        }

        const serverProgress =
          typeof found.progress_pct === 'number'
            ? Math.round(Number(found.progress_pct) * 100)
            : null
        const normalizedStatus = typeof found.status === 'string' ? found.status.toLowerCase() : null
        const normalizedState = typeof (found.state ?? found.generator_status) === 'string'
          ? String(found.state ?? found.generator_status).toLowerCase()
          : null
        const didError =
          !!found.did_error ||
          normalizedStatus === 'error' ||
          normalizedStatus === 'failed' ||
          normalizedStatus === 'cancelled' ||
          normalizedStatus === 'canceled' ||
          normalizedState === 'error' ||
          normalizedState === 'failed'

        if (didError) {
          const failMessage =
            found.error_message ||
            found.failure_reason ||
            found.errorReason ||
            'Sora 视频任务在官方控制台标记为失败，请在 Sora 控制台查看详情'
          lastSyncError = new Error(failMessage)
          appendLog(id, `[${nowLabel()}] Sora 视频任务失败：${failMessage}`)
          break
        }

        const nextProgress =
          serverProgress !== null
            ? Math.min(95, Math.max(progress, Math.max(5, serverProgress)))
            : Math.min(90, progress + 5)
        progress = nextProgress
        setNodeStatus(id, 'running', { progress })
        appendLog(
          id,
          `[${nowLabel()}] Sora 视频任务排队中（位置：${found.queue_position ?? '未知'}${
            serverProgress !== null ? `，进度：${Math.round(serverProgress)}%` : ''
          }）`,
        )

        await syncDraftVideo(false)
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
      } catch (err: any) {
        const msg = err?.message || '轮询 Sora 视频进度失败'
        appendLog(id, `[${nowLabel()}] error: ${msg}`)
        lastSyncError = err
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
      }

      if (finishedFromPending) {
        break
      }
    }

    const finalDraft = lastDraft
    const videoUrl = finalDraft?.videoUrl || null
    const thumbnailUrl = finalDraft?.thumbnailUrl
    const title = finalDraft?.title
    const duration = finalDraft?.duration
    const fallbackPostUrl = buildSoraPublicPostUrl(finalDraft?.postId || (data as any)?.videoPostId || null)
    const resolvedVideoUrl = videoUrl || fallbackPostUrl

    if (pollTimedOut || !resolvedVideoUrl) {
      const errorMessage = pollTimedOut
        ? 'Sora 视频生成超时（已等待超过 300 秒），请稍后在 Sora 控制台确认任务状态'
        : (lastSyncError?.message || '未能获取 Sora 草稿，任务可能已失败，请稍后再试')
      setNodeStatus(id, 'error', { progress: 0, lastError: errorMessage })
      appendLog(id, `[${nowLabel()}] error: ${errorMessage}`)
      ctx.endRunToken(id)
      return
    }

    let updatedVideoResults = (data.videoResults as any[] | undefined) || []
    const previousPrimaryIndex =
      typeof (data as any)?.videoPrimaryIndex === 'number'
        ? Math.max(0, (data as any).videoPrimaryIndex as number)
        : null
    if (resolvedVideoUrl) {
      const rewrittenUrl = rewriteSoraVideoResourceUrl(resolvedVideoUrl)
      const rewrittenThumb = rewriteSoraVideoResourceUrl(thumbnailUrl)
      updatedVideoResults = [
        ...updatedVideoResults,
        {
          id: finalDraft?.id || taskId,
          url: rewrittenUrl,
          thumbnailUrl: rewrittenThumb,
          title: title || null,
          duration: duration || videoDurationSeconds,
          model: generatedModel,
        },
      ]
    }
    let nextPrimaryIndex = previousPrimaryIndex ?? 0
    if (updatedVideoResults.length === 0) {
      nextPrimaryIndex = 0
    } else if (resolvedVideoUrl) {
      nextPrimaryIndex = updatedVideoResults.length - 1
    } else if (previousPrimaryIndex !== null) {
      nextPrimaryIndex = Math.min(updatedVideoResults.length - 1, previousPrimaryIndex)
    }

    setNodeStatus(id, 'success', {
      progress: 100,
      lastResult: {
        id: taskId || '',
        at: Date.now(),
        kind,
        preview: resolvedVideoUrl
          ? { type: 'video', src: rewriteSoraVideoResourceUrl(resolvedVideoUrl) }
          : preview,
      },
      prompt: finalPrompt,
      soraVideoTask: res,
      videoTaskId: taskId,
      videoInpaintFileId: inpaintFileId || null,
      videoOrientation: orientation,
      videoPrompt: finalPrompt,
      videoDurationSeconds,
      videoUrl: resolvedVideoUrl ? rewriteSoraVideoResourceUrl(resolvedVideoUrl) : (data as any)?.videoUrl || null,
      videoThumbnailUrl: thumbnailUrl ? rewriteSoraVideoResourceUrl(thumbnailUrl) : (data as any)?.videoThumbnailUrl || null,
      videoTitle: title,
      videoDuration: duration,
      videoDraftId: finalDraft?.id || (data as any)?.videoDraftId || null,
      videoPostId: finalDraft?.postId || (data as any)?.videoPostId || null,
      videoModel: generatedModel,
      videoTokenId: usedTokenId || null,
      videoResults: updatedVideoResults,
      videoPrimaryIndex: nextPrimaryIndex,
    })

    appendLog(
      id,
      `[${nowLabel()}] 已停止轮询 Sora 视频任务进度，请在 Sora 控制台继续查看后续状态。`,
    )
    ctx.endRunToken(id)
  } catch (err: any) {
    const msg = err?.message || 'Sora 视频任务创建失败'
    setNodeStatus(id, 'error', { progress: 0, lastError: msg })
    appendLog(id, `[${nowLabel()}] error: ${msg}`)
    ctx.endRunToken(id)
  }
}

interface VeoVideoTaskOptions {
  prompt: string
  model: string
  aspectRatio: string
  referenceImages: string[]
  durationSeconds: number
  firstFrameUrl?: string | null
  lastFrameUrl?: string | null
}

async function runVeoVideoTask(ctx: RunnerContext, options: VeoVideoTaskOptions) {
  const { id, data, kind, setNodeStatus, appendLog } = ctx
  const { prompt, model, aspectRatio, referenceImages, durationSeconds, firstFrameUrl, lastFrameUrl } = options
  try {
    setNodeStatus(id, 'running', { progress: 5 })
    appendLog(id, `[${nowLabel()}] 调用 Veo3 视频模型 ${model}…`)

    const extras: Record<string, any> = {
      nodeKind: kind,
      nodeId: id,
      modelKey: model,
      aspectRatio,
      awaitResult: false,
    }
    if (firstFrameUrl) {
      extras.firstFrameUrl = firstFrameUrl
      if (lastFrameUrl) {
        extras.lastFrameUrl = lastFrameUrl
      }
    }
    if (referenceImages.length && !firstFrameUrl) {
      extras.referenceImages = referenceImages
    }

    const res = await runTaskByVendor('veo', {
      kind: 'text_to_video',
      prompt,
      extras,
    })

    const pendingTaskId = (res.raw && ((res.raw as any).taskId as string | undefined)) || res.id || null

    if (res.status === 'running' && pendingTaskId) {
      await pollVeoResultClient(ctx, {
        taskId: pendingTaskId,
        prompt,
        model,
        durationSeconds,
      })
      // Veo 任务经由 grsai 代理扣费，轮询结束后静默刷新积分
      if (typeof window !== 'undefined' && typeof (window as any).refreshGrsaiCredits === 'function') {
        ;(window as any).refreshGrsaiCredits({ silent: true })
      }
      return
    }

    applyVeoTaskResult(ctx, res, { prompt, model, durationSeconds })
  } catch (err: any) {
    const msg = err?.message || 'Veo 视频任务执行失败'
    setNodeStatus(id, 'error', { progress: 0, lastError: msg })
    appendLog(id, `[${nowLabel()}] error: ${msg}`)
  } finally {
    ctx.endRunToken(id)
    // 非轮询模式下，直接在任务结束后尝试刷新积分
    if (typeof window !== 'undefined' && typeof (window as any).refreshGrsaiCredits === 'function') {
      ;(window as any).refreshGrsaiCredits({ silent: true })
    }
  }
}

interface VeoResultPollOptions {
  taskId: string
  prompt: string
  model: string
  durationSeconds: number
}

async function pollVeoResultClient(ctx: RunnerContext, options: VeoResultPollOptions) {
  const { id, setNodeStatus, appendLog, isCanceled } = ctx
  const { taskId, prompt, model, durationSeconds } = options
  const startedAt = Date.now()
  while (Date.now() - startedAt < VEO_RESULT_POLL_TIMEOUT_MS) {
    if (isCanceled(id)) {
      setNodeStatus(id, 'error', { progress: 0, lastError: '任务已取消' })
      appendLog(id, `[${nowLabel()}] Veo3 视频任务已取消`)
      return
    }
    await sleep(VEO_RESULT_POLL_INTERVAL_MS)
    try {
      const snapshot = await fetchVeoTaskResult(taskId)
      if (snapshot.status === 'running') {
        const rawProgress =
          (snapshot.raw && (snapshot.raw.progress as number | undefined)) ||
          (snapshot.raw?.response && (snapshot.raw.response.progress as number | undefined)) ||
          null
        if (typeof rawProgress === 'number') {
          const normalized = Math.min(99, Math.max(5, Math.round(rawProgress)))
          setNodeStatus(id, 'running', { progress: normalized })
        }
        continue
      }
      if (snapshot.status === 'failed') {
        const msg =
          (snapshot.raw?.response && (snapshot.raw.response.failure_reason || snapshot.raw.response.error)) ||
          (snapshot.raw && (snapshot.raw.failure_reason || snapshot.raw.error)) ||
          'Veo 视频任务失败'
        setNodeStatus(id, 'error', { progress: 0, lastError: msg })
        appendLog(id, `[${nowLabel()}] error: ${msg}`)
        return
      }
      applyVeoTaskResult(ctx, snapshot, { prompt, model, durationSeconds })
      return
    } catch (err: any) {
      const msg = err?.message || '查询 Veo 结果失败'
      appendLog(id, `[${nowLabel()}] error: ${msg}`)
    }
  }
  const timeoutMsg = 'Veo 视频任务查询超时，请稍后在控制台确认结果'
  setNodeStatus(id, 'error', { progress: 0, lastError: timeoutMsg })
  appendLog(id, `[${nowLabel()}] error: ${timeoutMsg}`)
}

function applyVeoTaskResult(
  ctx: RunnerContext,
  result: TaskResultDto,
  options: { prompt: string; model: string; durationSeconds: number },
) {
  const { id, data, kind, setNodeStatus, appendLog } = ctx
  const { prompt, model, durationSeconds } = options
  const videoAssets = (result.assets || []).filter((asset) => asset.type === 'video')
  if (!videoAssets.length) {
    throw new Error('Veo 未返回视频结果')
  }

  const existing = (data.videoResults as any[] | undefined) || []
  const appended = [
    ...existing,
    ...videoAssets.map((asset, idx) => ({
      id: result.id ? `${result.id}-${idx}` : `${Date.now()}-${idx}`,
      url: asset.url,
      thumbnailUrl: asset.thumbnailUrl || null,
      model,
    })),
  ]
  const primary = videoAssets[0]
  const nextPrimaryIndex = appended.length - 1

  const existingPrompt =
    typeof (data as any)?.prompt === 'string'
      ? (data as any).prompt.trim()
      : ''
  const usedPrompt = prompt.trim()
  const shouldWritePromptBack = !existingPrompt || existingPrompt === usedPrompt

  setNodeStatus(id, 'success', {
    progress: 100,
    lastResult: {
      id: result.id || '',
      at: Date.now(),
      kind,
      preview: { type: 'video', src: primary.url },
    },
    ...(shouldWritePromptBack ? { prompt: usedPrompt } : {}),
    videoModel: model,
    videoTaskId: result.id || null,
    videoResults: appended,
    videoPrimaryIndex: nextPrimaryIndex,
    videoUrl: primary.url,
    videoThumbnailUrl: primary.thumbnailUrl || null,
    videoPrompt: prompt,
    videoDurationSeconds: durationSeconds,
    videoDuration: (data as any)?.videoDuration || durationSeconds,
    videoPostId: (data as any)?.videoPostId || null,
    videoTokenId: (data as any)?.videoTokenId || null,
  })

  appendLog(id, `[${nowLabel()}] Veo3 视频生成完成，已写入当前节点。`)

  if (result.assets && result.assets.length) {
    notifyAssetRefresh()
  }
}

async function runGenericTask(ctx: RunnerContext) {
  const {
    id,
    data,
    taskKind,
    sampleCount,
    setNodeStatus,
    appendLog,
    isCanceled,
    isImageTask,
    kind,
    prompt,
    state,
  } = ctx

  try {
    const selectedModel = taskKind === 'text_to_image'
      ? (data.imageModel as string) || DEFAULT_IMAGE_MODEL
      : (data.geminiModel as string) || (data.model as string) || 'gemini-2.5-flash'
    const modelLower = selectedModel.toLowerCase()

    const explicitVendor = taskKind === 'text_to_image'
      ? ((data as any)?.imageModelVendor as string | undefined)
      : ((data as any)?.modelVendor as string | undefined)
    const vendor = explicitVendor || (taskKind === 'text_to_image'
      ? modelLower.includes('gemini')
        ? 'gemini'
        : modelLower.includes('gpt') ||
            modelLower.includes('openai') ||
            modelLower.includes('dall') ||
            modelLower.includes('o3-')
          ? 'openai'
          : 'qwen'
      : isAnthropicModel(selectedModel) ||
        modelLower.includes('claude') ||
        modelLower.includes('glm')
        ? 'anthropic'
        : modelLower.includes('gpt') ||
          modelLower.includes('openai') ||
          modelLower.includes('o3-') ||
          modelLower.includes('codex')
          ? 'openai'
          : 'gemini')
    const maskUrl =
      typeof (data as any)?.poseMaskUrl === 'string' && (data as any)?.poseMaskUrl.trim()
        ? (data as any).poseMaskUrl.trim()
        : null
    const systemPromptOpt =
      (data as any)?.showSystemPrompt && typeof (data as any)?.systemPrompt === 'string'
        ? (data as any).systemPrompt
        : undefined
    const referenceImagesRaw = isImageTask
      ? collectReferenceImages(state, id)
      : []
    const deduped = Array.from(new Set(referenceImagesRaw.filter((u) => typeof u === 'string' && u.trim())))
    const prioritized: string[] = []
    if (maskUrl) prioritized.push(maskUrl)
    deduped.forEach((url) => {
      if (prioritized.length >= 3) return
      if (url === maskUrl) return
      prioritized.push(url)
    })
    const referenceImages = prioritized.slice(0, 3)
    const wantsImageEdit = isImageTask && referenceImages.length > 0
    if (wantsImageEdit && !isImageEditModel(selectedModel)) {
      const msg = '当前模型不支持图片编辑，请切换到支持图片编辑的模型（如 Nano Banana 系列）'
      setNodeStatus(id, 'error', { progress: 0, lastError: msg })
      appendLog(id, `[${nowLabel()}] error: ${msg}`)
      toast(msg, 'warning')
      ctx.endRunToken(id)
      return
    }
    const effectiveTaskKind: TaskKind = wantsImageEdit ? 'image_edit' : taskKind
    const aspectRatio =
      typeof (data as any)?.aspect === 'string' && (data as any)?.aspect.trim()
        ? (data as any).aspect.trim()
        : 'auto'
    const imageSizeSetting =
      typeof (data as any)?.imageSize === 'string' && (data as any)?.imageSize.trim()
        ? (data as any).imageSize.trim()
        : undefined

    const allImageAssets: { url: string }[] = []
    const allTexts: string[] = []
    let lastRes: any = null

    const promptForModel =
      isImageTask && systemPromptOpt
        ? `${systemPromptOpt}\n\n${prompt}`
        : prompt

    for (let i = 0; i < sampleCount; i++) {
      if (isCanceled(id)) {
        setNodeStatus(id, 'error', { progress: 0, lastError: '任务已取消' })
        appendLog(id, `[${nowLabel()}] 已取消`)
        ctx.endRunToken(id)
        return
      }

      const progressBase = 5 + Math.floor((90 * i) / sampleCount)
      setNodeStatus(id, 'running', { progress: progressBase })
      const vendorName =
        vendor === 'qwen'
          ? 'Qwen'
          : vendor === 'anthropic'
            ? 'Claude'
            : vendor === 'openai'
              ? 'OpenAI'
              : 'Gemini'
      const modelType =
        effectiveTaskKind === 'image_edit'
          ? '图像编辑'
          : effectiveTaskKind === 'text_to_image'
            ? '图像'
            : '文案'
      appendLog(
        id,
        `[${nowLabel()}] 调用${vendorName} ${modelType}模型 ${sampleCount > 1 ? `(${i + 1}/${sampleCount})` : ''}…`,
      )

      const res = await runTaskByVendor(vendor, {
        kind: effectiveTaskKind,
        prompt: promptForModel,
        extras: {
          nodeKind: kind,
          nodeId: id,
          modelKey: selectedModel,
          ...(isImageTask
            ? {
                aspectRatio,
                ...(selectedModel === 'nano-banana-pro' && imageSizeSetting
                  ? { imageSize: imageSizeSetting }
                  : {}),
              }
            : {}),
          ...(wantsImageEdit ? { referenceImages, ...(maskUrl ? { maskUrl } : {}) } : {}),
          ...(systemPromptOpt ? { systemPrompt: systemPromptOpt } : {}),
        },
      })

      lastRes = res

      if (vendor === 'qwen' && res.status === 'failed') {
        const rawResponse = res.raw?.response
        const errMsg =
          rawResponse?.output?.error_message ||
          rawResponse?.error_message ||
          rawResponse?.message ||
          res.raw?.message ||
          'Qwen 图像生成失败'
        throw new Error(errMsg)
      }

      if (vendor === 'gemini' && res.status === 'failed') {
        const rawResponse = (res.raw as any)?.response || res.raw
        const errMsg =
          rawResponse?.failure_reason ||
          rawResponse?.error ||
          rawResponse?.message ||
          'Banana 图像生成失败'
        throw new Error(errMsg)
      }

      const textOut = (res.raw && (res.raw.text as string)) || ''
      if (textOut.trim()) {
        allTexts.push(textOut.trim())
      }

      const imageAssets = (res.assets || [])
        .filter((a: any) => a?.type === 'image' && typeof a.url === 'string' && a.url.trim().length > 0)
        .map((a: any) => ({ url: a.url }))
      if (imageAssets.length) {
        allImageAssets.push(...imageAssets)
      }

      if (isCanceled(id)) {
        setNodeStatus(id, 'error', { progress: 0, lastError: '任务已取消' })
        appendLog(id, `[${nowLabel()}] 已取消`)
        ctx.endRunToken(id)
        return
      }
    }

    const res = lastRes
    const text = (res?.raw && (res.raw.text as string)) || ''
    const firstImage =
      isImageTask && allImageAssets.length ? allImageAssets[0] : null
    const preview =
      IMAGE_NODE_KINDS.has(kind) && firstImage
        ? { type: 'image', src: firstImage.url }
        : text.trim().length > 0
          ? { type: 'text', value: text }
          : { type: 'text', value: 'AI 调用成功' }

    let patchExtra: any = {}
    const existingPrompt =
      typeof (data as any)?.prompt === 'string'
        ? (data as any).prompt.trim()
        : ''
    if (isImageTask && allImageAssets.length) {
      const existing = (data.imageResults as { url: string }[] | undefined) || []
      const merged = [...existing, ...allImageAssets]
      const newPrimaryIndex = existing.length
      patchExtra = {
        ...patchExtra,
        imageUrl: firstImage!.url,
        imageResults: merged,
        imagePrimaryIndex: newPrimaryIndex,
      }
    }
    if (allTexts.length) {
      const existingTexts =
        (data.textResults as { text: string }[] | undefined) || []
      const mergedTexts = [
        ...existingTexts,
        ...allTexts.map((t) => ({ text: t })),
      ]
      patchExtra = {
        ...patchExtra,
        textResults: mergedTexts,
      }
    }

    // 将本次使用的提示词写回节点数据（仅在节点原本没有提示词，或本次使用的提示词与原值一致时）
    if (typeof prompt === 'string' && prompt.trim().length > 0) {
      const usedPrompt = prompt.trim()
      const shouldWritePromptBack = !existingPrompt || existingPrompt === usedPrompt
      if (shouldWritePromptBack) {
        patchExtra = {
          ...patchExtra,
          prompt: usedPrompt,
        }
      }
    }

    setNodeStatus(id, 'success', {
      progress: 100,
      lastResult: {
        id: res?.id,
        at: Date.now(),
        kind,
        preview,
      },
      ...patchExtra,
    })

    if (res?.assets && res.assets.length) {
      notifyAssetRefresh()
    }

    if (text.trim()) {
      appendLog(id, `[${nowLabel()}] AI: ${text.slice(0, 120)}`)
    } else {
      appendLog(id, `[${nowLabel()}] 文案模型调用成功`)
    }
  } catch (err: any) {
    const msg = err?.message || '图像模型调用失败'
    const status = (err as any)?.status || 'unknown'
    const enhancedMsg = status === 429
      ? `${msg} (API配额已用尽，请稍后重试或升级计划)`
      : msg

    toast(enhancedMsg, status === 429 ? 'warning' : 'error')

    setNodeStatus(id, 'error', {
      progress: 0,
      lastError: enhancedMsg,
      httpStatus: status,
      isQuotaExceeded: status === 429,
    })
    appendLog(id, `[${nowLabel()}] error: ${enhancedMsg}`)
  } finally {
    ctx.endRunToken(id)
  }
}
