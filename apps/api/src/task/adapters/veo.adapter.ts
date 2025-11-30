import axios from 'axios'
import type { ProviderAdapter, ProviderContext, TaskAsset, TaskResult, TaskStatus, TextToVideoRequest } from '../task.types'

const DEFAULT_VEO_BASE_URL = 'https://api.grsai.com'
const RESULT_POLL_INTERVAL_MS = 4000
const RESULT_POLL_TIMEOUT_MS = 480_000
const WAIT_FOR_RESULT_READY_MS = 1000

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function normalizeBaseUrl(baseUrl?: string): string {
  const raw = (baseUrl || DEFAULT_VEO_BASE_URL).trim()
  return raw.replace(/\/+$/, '')
}

function normalizeModelKey(modelKey?: string | null): string {
  if (!modelKey) return 'veo3.1-fast'
  const trimmed = modelKey.trim()
  if (!trimmed) return 'veo3.1-fast'
  return trimmed.startsWith('models/') ? trimmed.slice(7) : trimmed
}

function collectReferenceImages(extras: Record<string, any>): string[] {
  const urls: string[] = []
  const append = (value: any) => {
    if (typeof value === 'string' && value.trim()) {
      urls.push(value.trim())
    }
  }
  if (Array.isArray(extras.urls)) {
    extras.urls.forEach(append)
  }
  if (Array.isArray(extras.referenceImages)) {
    extras.referenceImages.forEach(append)
  }
  return Array.from(new Set(urls)).slice(0, 3)
}

function clampProgress(value?: number | null): number | undefined {
  if (typeof value !== 'number' || Number.isNaN(value)) return undefined
  return Math.max(0, Math.min(100, value))
}

function mapStatus(status?: string | null): TaskStatus {
  const normalized = typeof status === 'string' ? status.toLowerCase() : null
  if (normalized === 'failed') return 'failed'
  if (normalized === 'succeeded') return 'succeeded'
  return 'running'
}

function extractResultPayload(body: any): any {
  if (!body) return null
  if (typeof body === 'object' && body.data) return body.data
  return body
}

export async function pollVeoResult(options: {
  ctx: ProviderContext
  taskId: string
  explicitBaseUrl?: string
  explicitApiKey?: string
}): Promise<{ asset: TaskAsset; raw: any }> {
  const { ctx, taskId } = options
  const baseUrl = (options.explicitBaseUrl || ctx.baseUrl || DEFAULT_VEO_BASE_URL).replace(/\/+$/, '')
  const apiKey = (options.explicitApiKey || ctx.apiKey || '').trim()
  if (!apiKey) {
    throw new Error('未配置 Veo API Key')
  }
  const url = `${baseUrl}/v1/draw/result`
  const startedAt = Date.now()
  while (Date.now() - startedAt < RESULT_POLL_TIMEOUT_MS) {
    await wait(RESULT_POLL_INTERVAL_MS)
    const resp = await axios.post(
      url,
      { id: taskId },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        timeout: 30000,
        validateStatus: () => true,
      },
    )

    const responseBody = resp.data
    if (typeof responseBody?.code === 'number' && responseBody.code !== 0) {
      const msg = responseBody?.msg || responseBody?.message || 'Veo API 返回错误'
      throw new Error(msg)
    }

    if (resp.status < 200 || resp.status >= 300) {
      const msg =
        (resp.data && (resp.data.message || resp.data.error || resp.data.msg)) ||
        `Veo result poll failed: ${resp.status}`
      throw new Error(msg)
    }

    const payload = extractResultPayload(responseBody)
    if (!payload) {
      continue
    }

    const status = mapStatus(payload.status)
    const progress = clampProgress(payload.progress)
    ctx.onProgress?.({
      status,
      progress,
      message: payload.failure_reason || payload.error || undefined,
      data: payload,
    })

    if (status === 'failed') {
      const errMsg = payload.failure_reason || payload.error || 'Veo 视频生成失败'
      throw new Error(errMsg)
    }

    const videoUrl = typeof payload.url === 'string' && payload.url.trim() ? payload.url.trim() : null
    if (status === 'succeeded' && videoUrl) {
      return {
        asset: {
          type: 'video',
          url: videoUrl,
          thumbnailUrl: payload.thumbnail_url || payload.thumbnailUrl || null,
        },
        raw: payload,
      }
    }
  }

  throw new Error('Veo 视频生成超时，请稍后重试')
}

export async function fetchVeoResultSnapshot(options: {
  ctx: ProviderContext
  taskId: string
  explicitBaseUrl?: string
  explicitApiKey?: string
}): Promise<{ status: TaskStatus; progress?: number; asset?: TaskAsset; raw: any }> {
  const { ctx, taskId } = options
  const baseUrl = (options.explicitBaseUrl || ctx.baseUrl || DEFAULT_VEO_BASE_URL).replace(/\/+$/, '')
  const apiKey = (options.explicitApiKey || ctx.apiKey || '').trim()
  if (!apiKey) {
    throw new Error('未配置 Veo API Key')
  }
  const url = `${baseUrl}/v1/draw/result`
  const resp = await axios.post(
    url,
    { id: taskId },
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      timeout: 20000,
      validateStatus: () => true,
    },
  )

  if (resp.status < 200 || resp.status >= 300) {
    const msg =
      (resp.data && (resp.data.message || resp.data.error || resp.data.msg)) ||
      `Veo result poll failed: ${resp.status}`
    throw new Error(msg)
  }

  const payload = extractResultPayload(resp.data)
  if (!payload) {
    return { status: 'running', raw: resp.data }
  }

  const status = mapStatus(payload.status)
  const progress = clampProgress(payload.progress)

  if (status === 'failed') {
    const errMsg = payload.failure_reason || payload.error || 'Veo 视频生成失败'
    const err = new Error(errMsg)
    ;(err as any).response = payload
    throw err
  }

  if (status === 'succeeded') {
    const videoUrl = typeof payload.url === 'string' && payload.url.trim() ? payload.url.trim() : null
    if (!videoUrl) {
      return { status: 'running', progress, raw: payload }
    }
    return {
      status,
      progress: 100,
      asset: {
        type: 'video',
        url: videoUrl,
        thumbnailUrl: payload.thumbnailUrl || payload.thumbnail_url || null,
      },
      raw: payload,
    }
  }

  return { status, progress, raw: payload }
}

export const veoAdapter: ProviderAdapter = {
  name: 'veo',
  supports: ['text_to_video'],

  async textToVideo(req: TextToVideoRequest, ctx: ProviderContext): Promise<TaskResult> {
    const apiKey = ctx.apiKey?.trim()
    if (!apiKey) {
      throw new Error('未配置 Veo API Key')
    }

    const baseUrl = normalizeBaseUrl(ctx.baseUrl)
    const extras = (req.extras || {}) as Record<string, any>
    const model = normalizeModelKey(extras.modelKey || ctx.modelKey)
    const aspectRatio = typeof extras.aspectRatio === 'string' && extras.aspectRatio.trim()
      ? extras.aspectRatio.trim()
      : '16:9'
    const referenceImages = collectReferenceImages(extras)
    const firstFrameUrl = typeof extras.firstFrameUrl === 'string' && extras.firstFrameUrl.trim() ? extras.firstFrameUrl.trim() : undefined
    const lastFrameUrl = typeof extras.lastFrameUrl === 'string' && extras.lastFrameUrl.trim() ? extras.lastFrameUrl.trim() : undefined

    const body: Record<string, any> = {
      model,
      prompt: req.prompt,
      aspectRatio,
      webHook: '-1',
      shutProgress: extras.shutProgress === false ? false : true,
    }

    if (referenceImages.length) {
      body.urls = referenceImages
    }
    if (firstFrameUrl) {
      body.firstFrameUrl = firstFrameUrl
    }
    if (lastFrameUrl && firstFrameUrl) {
      body.lastFrameUrl = lastFrameUrl
    }

    const createResp = await axios.post(`${baseUrl}/v1/video/veo`, body, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      timeout: 30000,
      validateStatus: () => true,
    })

    if (createResp.status < 200 || createResp.status >= 300) {
      const msg =
        (createResp.data && (createResp.data.message || createResp.data.error || createResp.data.msg)) ||
        `Veo 视频任务创建失败：${createResp.status}`
      const err = new Error(msg)
      ;(err as any).response = createResp.data
      throw err
    }

    const responseBody = createResp.data
    if (typeof responseBody?.code === 'number' && responseBody.code !== 0) {
      const msg = responseBody?.msg || responseBody?.message || 'Veo 视频任务创建失败'
      throw new Error(msg)
    }
    const payload = typeof responseBody?.code === 'number' ? responseBody.data : responseBody
    if (payload && typeof payload.status === 'string') {
      ctx.onProgress?.({ status: mapStatus(payload.status), progress: clampProgress(payload.progress), data: payload })
    }
    const taskId = payload?.id
    if (!taskId) {
      throw new Error('Veo API 未返回任务 ID')
    }

    const awaitResult = Boolean((req.extras as any)?.awaitResult)
    if (!awaitResult) {
      return {
        id: taskId,
        kind: 'text_to_video',
        status: 'running',
        assets: [],
        raw: {
          provider: 'veo',
          model,
          taskId,
          response: payload,
        },
      }
    }

    const { asset, raw } = await pollVeoResult({
      ctx,
      taskId,
      explicitBaseUrl: baseUrl,
      explicitApiKey: apiKey,
    })

    return {
      id: raw?.id || taskId,
      kind: 'text_to_video',
      status: 'succeeded',
      assets: [asset],
      raw: {
        provider: 'veo',
        model,
        response: raw,
      },
    }
  },
}
