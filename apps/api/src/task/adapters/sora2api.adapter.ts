import axios from 'axios'
import type {
  ProviderAdapter,
  ProviderContext,
  TaskAsset,
  TaskResult,
  TaskStatus,
  TextToVideoRequest,
} from '../task.types'

const DEFAULT_SORA2API_BASE_URL = 'http://localhost:8000'

function normalizeBaseUrl(baseUrl?: string): string {
  const raw = (baseUrl || DEFAULT_SORA2API_BASE_URL).trim()
  return raw.replace(/\/+$/, '')
}

function normalizeModelKey(
  modelKey?: string | null,
  orientation?: 'portrait' | 'landscape',
  durationSeconds?: number | null,
): string {
  const trimmed = (modelKey || '').trim()
  // 仅当显式使用 Sora2API 支持的模型 ID 时才直接透传；否则使用时长/方向智能映射
  if (trimmed && /^sora-(image|video)/i.test(trimmed)) {
    return trimmed
  }
  const duration = typeof durationSeconds === 'number' && Number.isFinite(durationSeconds) ? durationSeconds : 10
  const isShort = duration <= 10
  const orient = orientation === 'portrait' ? 'portrait' : 'landscape'
  if (orient === 'portrait') {
    return isShort ? 'sora-video-portrait-10s' : 'sora-video-portrait-15s'
  }
  return isShort ? 'sora-video-landscape-10s' : 'sora-video-landscape-15s'
}

function clampProgress(value?: number | null): number | undefined {
  if (typeof value !== 'number' || Number.isNaN(value)) return undefined
  return Math.max(0, Math.min(100, value))
}

function mapStatus(status?: string | null): TaskStatus {
  const normalized = typeof status === 'string' ? status.toLowerCase() : null
  if (normalized === 'failed') return 'failed'
  if (normalized === 'succeeded' || normalized === 'success') return 'succeeded'
  if (normalized === 'queued') return 'queued'
  return 'running'
}

function extractVideoUrlFromContent(content: string): string | null {
  if (!content || typeof content !== 'string') return null
  const match = content.match(/<video[^>]+src=['"]([^'"]+)['"][^>]*>/i)
  if (match && match[1] && match[1].trim()) {
    return match[1].trim()
  }
  return null
}

function extractImageUrlsFromContent(content: string): string[] {
  if (!content || typeof content !== 'string') return []
  const urls = new Set<string>()
  const regex = /!\[[^\]]*]\(([^)]+)\)/g
  let m: RegExpExecArray | null
  // eslint-disable-next-line no-cond-assign
  while ((m = regex.exec(content)) !== null) {
    const url = (m[1] || '').trim()
    if (url) urls.add(url)
  }
  return Array.from(urls)
}

function extractProgressFromReasoning(text: string | null | undefined): number | undefined {
  if (!text || typeof text !== 'string') return undefined
  // 典型格式：**Video Generation Progress**: 23% (processing)
  const match = text.match(/(\d+(?:\.\d+)?)\s*%/i)
  if (!match) return undefined
  const value = Number(match[1])
  if (!Number.isFinite(value)) return undefined
  return Math.max(0, Math.min(100, value))
}

async function createSora2ApiVideoTask(options: {
  ctx: ProviderContext
  model: string
  prompt: string
  durationSeconds: number
  orientation: 'portrait' | 'landscape'
}): Promise<{ id: string; status: TaskStatus; progress?: number | null }> {
  const { ctx, model, prompt, durationSeconds, orientation } = options
  const apiKey = (ctx.apiKey || '').trim()
  if (!apiKey) {
    throw new Error('未配置 sora2api API Key')
  }

  const baseUrl = normalizeBaseUrl(ctx.baseUrl)
  const url = `${baseUrl}/v1/video/tasks`

  const body = {
    model,
    prompt,
    durationSeconds,
    orientation,
  }

  try {
    const res = await axios.post(url, body, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      timeout: 30000,
      validateStatus: () => true,
    })

    if (res.status < 200 || res.status >= 300) {
      const msg =
        (res.data && (res.data.error?.message || res.data.message)) ||
        `sora2api 调用失败: ${res.status}`
      const err: any = new Error(msg)
      err.status = res.status
      throw err
    }

    const data = res.data || {}
    const id = typeof data.id === 'string' && data.id.trim() ? data.id.trim() : null
    if (!id) {
      throw new Error('sora2api 未返回任务 ID')
    }
    const status = mapStatus(data.status || 'queued')
    const progress = clampProgress(
      typeof data.progress === 'number'
        ? data.progress
        : typeof data.progress_pct === 'number'
          ? data.progress_pct * 100
          : undefined,
    )
    return { id, status, progress }
  } catch (error: any) {
    const msg = error?.message || 'sora2api 调用失败'
    const wrapped: any = new Error(msg)
    if (typeof error?.status === 'number') {
      wrapped.status = error.status
    } else if (typeof error?.response?.status === 'number') {
      wrapped.status = error.response.status
    }
    throw wrapped
  }
}

export async function fetchSora2ApiResultSnapshot(options: {
  ctx: ProviderContext
  taskId: string
}): Promise<{ status: TaskStatus; progress?: number; asset?: TaskAsset; raw: any }> {
  const { ctx, taskId } = options
  const apiKey = (ctx.apiKey || '').trim()
  if (!apiKey) {
    throw new Error('未配置 sora2api API Key')
  }

  const baseUrl = normalizeBaseUrl(ctx.baseUrl)
  const url = `${baseUrl}/v1/video/tasks/${encodeURIComponent(taskId)}`
  const res = await axios.get(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    timeout: 30000,
    validateStatus: () => true,
  })

  if (res.status < 200 || res.status >= 300) {
    const msg =
      (res.data && (res.data.error?.message || res.data.message || res.data.error)) ||
      `sora2api 任务查询失败: ${res.status}`
    throw new Error(msg)
  }

  const data = res.data || {}
  const status = mapStatus(data.status)
  const progress = clampProgress(
    typeof data.progress === 'number'
      ? data.progress
      : typeof data.progress_pct === 'number'
        ? data.progress_pct * 100
        : undefined,
  )

  let asset: TaskAsset | undefined

  if (status === 'succeeded') {
    const directUrl =
      (typeof data.video_url === 'string' && data.video_url.trim()) ||
      (typeof data.videoUrl === 'string' && data.videoUrl.trim()) ||
      null
    let videoUrl = directUrl
    if (!videoUrl && typeof data.content === 'string') {
      videoUrl = extractVideoUrlFromContent(data.content)
    }
    if (!videoUrl && typeof data.content === 'string') {
      const images = extractImageUrlsFromContent(data.content)
      if (images.length) {
        asset = { type: 'image', url: images[0], thumbnailUrl: null }
      }
    } else if (videoUrl) {
      const thumbnail =
        (typeof data.thumbnail_url === 'string' && data.thumbnail_url.trim()) ||
        (typeof data.thumbnailUrl === 'string' && data.thumbnailUrl.trim()) ||
        null
      asset = {
        type: 'video',
        url: videoUrl,
        thumbnailUrl: thumbnail,
      }
    }
  }

  return {
    status,
    progress,
    asset,
    raw: data,
  }
}

export const sora2apiAdapter: ProviderAdapter = {
  name: 'sora2api',
  supports: ['text_to_video'],

  async textToVideo(req: TextToVideoRequest, ctx: ProviderContext): Promise<TaskResult> {
    const extras = (req.extras || {}) as Record<string, any>
    const orientation =
      (typeof extras.orientation === 'string' && extras.orientation.trim()) ||
      (typeof req.extras?.orientation === 'string' && (req.extras as any).orientation) ||
      'landscape'
    const durationSeconds =
      typeof req.durationSeconds === 'number' && Number.isFinite(req.durationSeconds)
        ? req.durationSeconds
        : typeof extras.durationSeconds === 'number' && Number.isFinite(extras.durationSeconds)
          ? extras.durationSeconds
          : 10
    const model = normalizeModelKey(
      typeof extras.modelKey === 'string' ? extras.modelKey : ctx.modelKey,
      orientation === 'portrait' ? 'portrait' : 'landscape',
      durationSeconds,
    )

    const created = await createSora2ApiVideoTask({
      ctx,
      model,
      prompt: req.prompt,
      durationSeconds,
      orientation: orientation === 'portrait' ? 'portrait' : 'landscape',
    })

    return {
      id: created.id,
      kind: 'text_to_video',
      status: created.status,
      assets: [],
      raw: {
        provider: 'sora2api',
        model,
        taskId: created.id,
        status: created.status,
        progress: created.progress ?? null,
      },
    }
  },
}
