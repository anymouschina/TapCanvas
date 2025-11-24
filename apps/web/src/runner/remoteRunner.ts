import type { Node } from 'reactflow'
import type { TaskKind } from '../api/server'
import {
  runTaskByVendor,
  createSoraVideo,
  listSoraPendingVideos,
  getSoraVideoDraftByTask,
  listModelProviders,
  listModelTokens,
} from '../api/server'
import { useUIStore } from '../ui/uiStore'
import { toast } from '../ui/toast'
import { isAnthropicModel } from '../config/modelSource'
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
  isTextTask: boolean
  modelKey?: string
  getState: Getter
}

function nowLabel() {
  return new Date().toLocaleTimeString()
}

const SORA_VIDEO_MODEL_WHITELIST = new Set(['sora-2', 'sy-8', 'sy_8'])
const ANTHROPIC_VERSION = '2023-06-01'
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
  const model = String(data.videoModel || '').toLowerCase()
  const normalized = model.replace('_', '-')
  if (
    normalized &&
    !SORA_VIDEO_MODEL_WHITELIST.has(model) &&
    !SORA_VIDEO_MODEL_WHITELIST.has(normalized)
  ) {
    return null
  }

  // 优先检查已知的 remix targets
  const knownCandidates = [
    data.videoPostId,      // s_ 开头的 postId (最高优先级)
    data.videoDraftId,     // draft ID
    data.videoTaskId,      // task_ 开头的 taskId
  ]
  for (const candidate of knownCandidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
  }

  // 检查生成任务的 generation_id
  const generationId = data.soraVideoTask?.generation_id
  if (typeof generationId === 'string' && generationId.trim() && generationId.startsWith('gen_')) {
    return generationId.trim()
  }

  // 检查任务本身的 ID
  const taskId = data.soraVideoTask?.id
  if (typeof taskId === 'string' && taskId.trim() && taskId.startsWith('gen_')) {
    return taskId.trim()
  }

  return null
}

function rewriteSoraVideoResourceUrl(url?: string | null): string | null {
  if (!url) return null
  const base = useUIStore.getState().soraVideoBaseUrl
  if (!base) return url
  try {
    const parsed = new URL(url)
    const baseParsed = new URL(base)
    parsed.protocol = baseParsed.protocol
    parsed.host = baseParsed.host
    parsed.port = baseParsed.port
    return parsed.toString()
  } catch {
    return url
  }
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
  const { sampleCount, supportsSamples, isImageTask, isVideoTask, isTextTask } =
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
  const modelKey = (kind === 'image' ? imageModelKey : textModelKey) || undefined

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
    isTextTask,
    modelKey,
    getState: get,
    ...handlers,
  }
}

function resolveTaskKind(kind: string): TaskKind {
  if (kind === 'image') return 'text_to_image'
  if (kind === 'composeVideo' || kind === 'storyboard' || kind === 'video') return 'text_to_video'
  return 'prompt_refine'
}

function buildPromptFromState(
  kind: string,
  data: any,
  state: any,
  id: string,
): string {
  if (kind === 'image' || kind === 'composeVideo' || kind === 'storyboard' || kind === 'video') {
    const edges = (state.edges || []) as any[]
    const inbound = edges.filter((e) => e.target === id)
    let upstreamPrompt = ''
    if (inbound.length) {
      const lastEdge = inbound[inbound.length - 1]
      const src = (state.nodes as Node[]).find((n: Node) => n.id === lastEdge.source)
      const sd: any = src?.data || {}
      const skind: string | undefined = sd.kind
      if (skind === 'textToImage' || skind === 'image') {
        upstreamPrompt =
          (sd.prompt as string | undefined) ||
          ''
      }
    }
    const own = (data.prompt as string) || ''
    if (upstreamPrompt && own) {
      return `${upstreamPrompt}\n${own}`
    }
    return upstreamPrompt || own || (data.label as string) || ''
  }

  return (data.prompt as string) || (data.label as string) || ''
}

function computeSampleMeta(kind: string, data: any) {
  const isImageTask = kind === 'image'
  const isVideoTask = kind === 'composeVideo' || kind === 'storyboard' || kind === 'video'
  const isTextTask = kind === 'textToImage'
  const rawSampleCount = typeof data.sampleCount === 'number' ? data.sampleCount : 1
  const supportsSamples = isImageTask || isVideoTask || isTextTask
  const sampleCount = supportsSamples
    ? Math.max(1, Math.min(5, Math.floor(rawSampleCount || 1)))
    : 1

  return { sampleCount, supportsSamples, isImageTask, isVideoTask, isTextTask }
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

  if (ctx.isTextTask) {
    await runTextTask(ctx)
    return
  }

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
    const vendor = isAnthropicModel(modelKey) || (modelKey && modelKey.toLowerCase().includes('claude')) ? 'anthropic' : 'gemini'
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
    if (isStoryboard) {
      const storyboardTotal = totalStoryboardDuration(storyboardScenesData || [])
      if (storyboardTotal > STORYBOARD_MAX_TOTAL_DURATION + 1e-6) {
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
    let remixTargetId = ((data as any)?.remixTargetId as string | undefined) || null
    let videoDurationSeconds: number = Number((data as any)?.videoDurationSeconds)
    if (Number.isNaN(videoDurationSeconds) || videoDurationSeconds <= 0) {
      videoDurationSeconds = isStoryboard ? STORYBOARD_MAX_TOTAL_DURATION : 10
    }
    if (isStoryboard) {
      videoDurationSeconds = Math.min(videoDurationSeconds, STORYBOARD_MAX_TOTAL_DURATION)
    } else {
      videoDurationSeconds = Math.min(videoDurationSeconds, 15)
    }
    const nFrames = Math.round(Math.max(videoDurationSeconds, 1) * 30)
    const getCurrentVideoTokenId = () =>
      (ctx.getState().nodes.find((n: Node) => n.id === id)?.data as any)
        ?.videoTokenId as string | undefined

    const edges = (state.edges || []) as any[]
    const nodes = (state.nodes || []) as Node[]
    const inbound = edges.filter((e) => e.target === id)
    if (!remixTargetId && inbound.length) {
      for (const edge of inbound) {
        const src = nodes.find((n: Node) => n.id === edge.source)
        const candidate = getRemixTargetIdFromNodeData(src?.data)
        if (candidate) {
          remixTargetId = candidate
          break
        }
      }
    }

    const initialPatch: any = { progress: 5 }
    if (remixTargetId) {
      initialPatch.remixTargetId = remixTargetId
    }
    setNodeStatus(id, 'running', initialPatch)
    appendLog(id, `[${nowLabel()}] 调用 Sora-2 生成视频任务…`)

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
            if (skind === 'image' || skind === 'textToImage') {
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

    const preferredTokenId = (data as any)?.videoTokenId as string | undefined
    const res = await createSoraVideo({
      prompt: effectivePrompt,
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
      soraVideoTask: res,
      videoTaskId: taskId || null,
      videoInpaintFileId: inpaintFileId || null,
      videoOrientation: orientation,
      videoPrompt: effectivePrompt,
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
        soraVideoTask: res,
        videoTaskId: null,
        videoInpaintFileId: inpaintFileId || null,
        videoOrientation: orientation,
        videoPrompt: effectivePrompt,
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

    let draftSynced = false
    let lastDraft: {
      id: string
      title: string | null
      prompt: string | null
      thumbnailUrl: string | null
      videoUrl: string | null
      postId?: string | null
      duration?: number
    } | null = null

    const syncDraftVideo = async (force = false) => {
      if (!force && draftSynced) return null
      draftSynced = true
      try {
        const draftTokenId = getCurrentVideoTokenId()
        const draft = await getSoraVideoDraftByTask(taskId, draftTokenId || null)
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
        setNodeStatus(id, 'running', patch)
        if (draft.videoUrl) {
          appendLog(
            id,
            `[${nowLabel()}] 已从草稿同步生成的视频（task_id=${taskId}），可预览。`,
          )
        }
        return draft
      } catch (err: any) {
        if (err?.upstreamStatus === 202 || err?.status === 202) {
          appendLog(id, `[${nowLabel()}] 草稿同步：任务仍在进行中，继续等待...`)
  return null
}

        if (err?.upstreamStatus === 404 || err?.status === 404) {
          appendLog(id, `[${nowLabel()}] 草稿同步：任务未找到（可能已失败），停止轮询`)
          throw new Error('任务未找到或已失败')
        }

        const msg = err?.message || '同步 Sora 草稿失败'
        appendLog(id, `[${nowLabel()}] error: ${msg}`)
        return null
      }
    }

    let progress = 10
    const pollIntervalMs = 3000
    let finishedFromPending = false

    while (true) {
      if (isCanceled(id)) {
        setNodeStatus(id, 'error', { progress: 0, lastError: '任务已取消' })
        appendLog(id, `[${nowLabel()}] 已取消 Sora 视频任务`)
        ctx.endRunToken(id)
        return
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
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
      }

      if (finishedFromPending) {
        break
      }
    }

    const finalDraft = lastDraft
    const videoUrl = finalDraft?.videoUrl
    const thumbnailUrl = finalDraft?.thumbnailUrl
    const title = finalDraft?.title
    const duration = finalDraft?.duration

    let updatedVideoResults = (data.videoResults as any[] | undefined) || []
    const previousPrimaryIndex =
      typeof (data as any)?.videoPrimaryIndex === 'number'
        ? Math.max(0, (data as any).videoPrimaryIndex as number)
        : null
    if (videoUrl) {
      const rewrittenUrl = rewriteSoraVideoResourceUrl(videoUrl)
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
    } else if (videoUrl) {
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
        preview: videoUrl
          ? { type: 'video', src: rewriteSoraVideoResourceUrl(videoUrl) }
          : preview,
      },
      soraVideoTask: res,
      videoTaskId: taskId,
      videoInpaintFileId: inpaintFileId || null,
      videoOrientation: orientation,
        videoPrompt: effectivePrompt,
      videoDurationSeconds,
      videoUrl: videoUrl ? rewriteSoraVideoResourceUrl(videoUrl) : (data as any)?.videoUrl || null,
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
    isTextTask,
    kind,
    prompt,
  } = ctx

  try {
    const selectedModel = taskKind === 'text_to_image'
      ? (data.imageModel as string) || 'qwen-image-plus'
      : (data.model as string) || 'gemini-2.5-flash'

    const vendor = taskKind === 'text_to_image'
      ? (selectedModel.toLowerCase().includes('gemini') ? 'gemini' : 'qwen')
      : isAnthropicModel(selectedModel) || selectedModel.toLowerCase().includes('claude')
        ? 'anthropic'
        : 'gemini'
    const allImageAssets: { url: string }[] = []
    const allTexts: string[] = []
    let lastRes: any = null

    for (let i = 0; i < sampleCount; i++) {
      if (isCanceled(id)) {
        setNodeStatus(id, 'error', { progress: 0, lastError: '任务已取消' })
        appendLog(id, `[${nowLabel()}] 已取消`)
        ctx.endRunToken(id)
        return
      }

      const progressBase = 5 + Math.floor((90 * i) / sampleCount)
      setNodeStatus(id, 'running', { progress: progressBase })
      const vendorName = vendor === 'qwen' ? 'Qwen' : vendor === 'anthropic' ? 'Claude' : 'Gemini'
      const modelType = taskKind === 'text_to_image' ? '图像' : '文案'
      appendLog(
        id,
        `[${nowLabel()}] 调用${vendorName} ${modelType}模型 ${sampleCount > 1 ? `(${i + 1}/${sampleCount})` : ''}…`,
      )

      const res = await runTaskByVendor(vendor, {
        kind: taskKind,
        prompt,
        extras: {
          nodeKind: kind,
          nodeId: id,
          modelKey: selectedModel,
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

      const textOut = (res.raw && (res.raw.text as string)) || ''
      if (isTextTask && textOut.trim()) {
        allTexts.push(textOut.trim())
      }

      const imageAssets = (res.assets || []).filter(
        (a: any) => a.type === 'image',
      )
      if (isImageTask && imageAssets.length) {
        allImageAssets.push(...imageAssets.map((a: any) => ({ url: a.url })))
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
      kind === 'image' && firstImage
        ? { type: 'image', src: firstImage.url }
        : text.trim().length > 0
          ? { type: 'text', value: text }
          : { type: 'text', value: 'AI 调用成功' }

    let patchExtra: any = {}
    if (isImageTask && allImageAssets.length) {
      const existing = (data.imageResults as { url: string }[] | undefined) || []
      const merged = [...existing, ...allImageAssets]
      patchExtra = {
        ...patchExtra,
        imageUrl: firstImage!.url,
        imageResults: merged,
      }
    }
    if (isTextTask && allTexts.length) {
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
