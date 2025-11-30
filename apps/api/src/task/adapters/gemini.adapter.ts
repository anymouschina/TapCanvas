import axios from 'axios'
import type {
  BaseTaskRequest,
  ProviderAdapter,
  ProviderContext,
  TaskResult,
  TextToImageRequest,
  TextToVideoRequest,
  TaskAsset,
  ImageEditRequest,
  TaskStatus,
} from '../task.types'

const DEFAULT_GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com'
const DEFAULT_BANANA_BASE_URL = 'https://api.grsai.com'
// 默认使用 2.5-flash；可通过 extras.modelKey 或 ModelProfile.modelKey 覆盖
const DEFAULT_TEXT_MODEL = 'models/gemini-2.5-flash'
const CHAT_SUPPORTED_MODELS = new Set([
  'models/gemini-2.5-flash',
  'models/gemini-2.5-pro',
  'models/gemini-3-pro-preview',
])
const BANANA_MODELS = new Set(['nano-banana', 'nano-banana-fast', 'nano-banana-pro'])

function normalizeBaseUrl(baseUrl?: string): string {
  const raw = (baseUrl || DEFAULT_GEMINI_BASE_URL).trim()
  // 去掉末尾多余 / 和版本段，避免出现 /v1beta/v1beta 这种路径
  let url = raw.replace(/\/+$/, '')
  url = url.replace(/\/v1beta$/i, '').replace(/\/v1$/i, '')
  return url
}

function normalizeModelKey(modelKey?: string | null): string | null {
  if (!modelKey) return null
  const trimmed = modelKey.trim()
  if (!trimmed) return null
  return trimmed.startsWith('models/') ? trimmed.slice(7) : trimmed
}

function resolveBananaItemUrl(item: any): string | null {
  if (!item) return null
  if (typeof item === 'string') {
    const trimmed = item.trim()
    return trimmed.length ? trimmed : null
  }
  if (typeof item !== 'object') return null

  const urlKeys = [
    'url',
    'uri',
    'href',
    'imageUrl',
    'image_url',
    'image',
    'image_path',
    'path',
    'resultUrl',
    'result_url',
    'fileUrl',
    'file_url',
    'cdn',
  ]
  for (const key of urlKeys) {
    const value = (item as any)[key]
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
  }

  const base64Keys = ['base64', 'b64_json', 'image_base64']
  for (const key of base64Keys) {
    const value = (item as any)[key]
    if (typeof value === 'string' && value.trim()) {
      return `data:image/png;base64,${value.trim()}`
    }
  }

  return null
}

function extractBananaImageUrls(payload: any): string[] {
  if (!payload || typeof payload !== 'object') return []
  const urls = new Set<string>()
  const enqueue = (value: any) => {
    if (!value) return
    const arr = Array.isArray(value) ? value : [value]
    for (const item of arr) {
      const url = resolveBananaItemUrl(item)
      if (url) {
        urls.add(url)
      }
    }
  }

  const candidates = [
    payload?.results,
    payload?.images,
    payload?.imageUrls,
    payload?.image_urls,
    payload?.image_paths,
    payload?.outputs,
    payload?.output?.results,
    payload?.output?.images,
    payload?.output?.imageUrls,
    payload?.output?.image_urls,
  ]
  candidates.forEach(enqueue)

  enqueue(payload)
  enqueue(payload?.output)

  const directValues = [
    payload?.url,
    payload?.imageUrl,
    payload?.image_url,
    payload?.resultUrl,
    payload?.result_url,
    payload?.fileUrl,
    payload?.file_url,
  ]
  directValues.forEach((value) => {
    if (typeof value === 'string' && value.trim()) {
      urls.add(value.trim())
    }
  })

  return Array.from(urls)
}

function parseBananaSseEvents(raw: string): any[] {
  if (!raw || typeof raw !== 'string') return []
  const normalized = raw.replace(/\r/g, '')
  const chunks = normalized.split(/\n\n+/)
  const events: any[] = []
  for (const chunk of chunks) {
    const trimmedChunk = chunk.trim()
    if (!trimmedChunk) continue
    const lines = trimmedChunk.split('\n')
    for (const line of lines) {
      const match = line.match(/^\s*data:\s*(.+)$/i)
      if (!match) continue
      const payload = match[1].trim()
      if (!payload || payload === '[DONE]') continue
      try {
        events.push(JSON.parse(payload))
      } catch {
        // ignore malformed lines
      }
    }
  }
  return events
}

function normalizeBananaResponse(data: any): { payload: any; events: any[]; raw: any } {
  if (data === null || data === undefined) {
    return { payload: null, events: [], raw: data }
  }

  const tryParseJson = (value: string) => {
    try {
      return JSON.parse(value)
    } catch {
      return null
    }
  }

  if (typeof data === 'string') {
    const events = parseBananaSseEvents(data)
    if (events.length) {
      return { payload: events[events.length - 1], events, raw: data }
    }
    const parsed = tryParseJson(data)
    return { payload: parsed, events: [], raw: data }
  }

  if (typeof data === 'object') {
    if (typeof data.data === 'string') {
      const events = parseBananaSseEvents(data.data)
      if (events.length) {
        return { payload: events[events.length - 1], events, raw: data.data }
      }
      const parsed = tryParseJson(data.data)
      return { payload: parsed, events: [], raw: data.data }
    }
    if (data.data && typeof data.data === 'object') {
      return { payload: data.data, events: [], raw: data }
    }
  }

  return { payload: data, events: [], raw: data }
}

function emitBananaEventProgress(event: any, ctx: ProviderContext) {
  if (!ctx.onProgress || !event) return
  const rawStatus = typeof event.status === 'string' ? event.status.toLowerCase() : null
  const status: TaskStatus = rawStatus === 'failed' || rawStatus === 'error'
    ? 'failed'
    : rawStatus === 'succeeded' || rawStatus === 'success' || rawStatus === 'completed'
      ? 'succeeded'
      : rawStatus === 'queued'
        ? 'queued'
        : 'running'
  const progressCandidates = [event.progress, event.progress_percent, event.progressPercent, event.progress_pct]
  let progress: number | undefined
  for (const value of progressCandidates) {
    if (typeof value === 'number' && !Number.isNaN(value)) {
      progress = value <= 1 ? value * 100 : value
      break
    }
  }
  const message =
    event.message ||
    event.status_desc ||
    event.statusDescription ||
    event.description ||
    event.desc ||
    event.stage ||
    null
  ctx.onProgress?.({
    status,
    progress,
    message: message || undefined,
    data: event,
  })
}

async function readBananaEventStream(response: any, ctx: ProviderContext) {
  if (!response.body || typeof (response.body as any).getReader !== 'function') {
    const text = await response.text()
    return { text, events: [] as any[] }
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let collected = ''
  const events: any[] = []

  const flushBuffer = () => {
    let separatorIndex = buffer.indexOf('\n\n')
    while (separatorIndex !== -1) {
      const chunk = buffer.slice(0, separatorIndex)
      buffer = buffer.slice(separatorIndex + 2)
      const cleaned = chunk.replace(/\r/g, '').trim()
      if (cleaned) {
        const lines = cleaned.split('\n')
        lines.forEach((line) => {
          const match = line.match(/^\s*data:\s*(.+)$/i)
          if (!match) return
          const payload = match[1]?.trim()
          if (!payload || payload === '[DONE]') return
          try {
            const evt = JSON.parse(payload)
            events.push(evt)
            emitBananaEventProgress(evt, ctx)
          } catch {
            // ignore malformed events
          }
        })
      }
      separatorIndex = buffer.indexOf('\n\n')
    }
  }

  while (true) {
    const { done, value } = await reader.read()
    if (value) {
      const chunk = decoder.decode(value, { stream: true })
      collected += chunk
      buffer += chunk
      flushBuffer()
    }
    if (done) break
  }

  if (buffer.trim().length) {
    buffer += '\n\n'
    flushBuffer()
  }

  return { text: collected, events }
}

function isBananaModel(modelKey?: string | null): boolean {
  const normalized = normalizeModelKey(modelKey)
  if (!normalized) return false
  return BANANA_MODELS.has(normalized)
}

function resolveModelKey(ctx: ProviderContext, fallback: string): string {
  const key = ctx.modelKey && ctx.modelKey.trim().length > 0 ? ctx.modelKey.trim() : fallback
  return key.startsWith('models/') ? key : `models/${key}`
}

function extractText(data: any): string {
  const cand = data?.candidates?.[0]
  const parts = cand?.content?.parts
  if (!Array.isArray(parts)) return ''
  return parts
    .map((p: any) => (typeof p?.text === 'string' ? p.text : ''))
    .join('')
    .trim()
}

async function callGenerateContent(
  kind: TaskResult['kind'],
  prompt: string,
  ctx: ProviderContext,
  systemInstruction?: string,
  modelKeyOverride?: string,
): Promise<TaskResult> {
  if (!ctx.apiKey || !ctx.apiKey.trim()) {
    throw new Error('Gemini API key not configured for current provider/user')
  }

  const baseUrl = normalizeBaseUrl(ctx.baseUrl)
  let model = DEFAULT_TEXT_MODEL
  const override = modelKeyOverride && modelKeyOverride.trim()
  if (override) {
    const key = override.trim()
    model = key.startsWith('models/') ? key : `models/${key}`
  } else {
    model = resolveModelKey(ctx, DEFAULT_TEXT_MODEL)
  }
  // chat / prompt_refine 仅允许官方支持的 chat 模型，避免 404
  if ((kind === 'chat' || kind === 'prompt_refine') && !CHAT_SUPPORTED_MODELS.has(model)) {
    model = DEFAULT_TEXT_MODEL
  }
  // Gemini 官方路径形如：/v1beta/models/gemini-1.5-flash-latest:generateContent
  const url = `${baseUrl}/v1beta/${model}:generateContent?key=${encodeURIComponent(ctx.apiKey)}`

  const contents: any[] = []
  if (systemInstruction && systemInstruction.trim()) {
    contents.push({
      role: 'user',
      parts: [{ text: systemInstruction.trim() }],
    })
  }
  contents.push({
    role: 'user',
    parts: [{ text: prompt }],
  })

  const res = await axios.post(
    url,
    { contents },
    {
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: 30000,
      validateStatus: () => true,
    },
  )

  if (res.status < 200 || res.status >= 300) {
    const msg =
      (res.data && (res.data.error?.message || res.data.message)) ||
      `Gemini generateContent failed with status ${res.status}`
    const err = new Error(msg) as any
    err.status = res.status
    err.response = res.data

    // 如果是配额超限错误，提取更详细的信息
    if (res.status === 429 && res.data) {
      err.isQuotaExceeded = true
      err.retryAfter = res.data.retryAfter || null
    }

    throw err
  }

  const text = extractText(res.data)
  const id = `gemini-${Date.now().toString(36)}`
  const result: TaskResult = {
    id,
    kind,
    status: 'succeeded',
    assets: [],
    raw: {
      provider: 'gemini',
      response: res.data,
      text,
    },
  }
  return result
}

async function callGenerateImage(
  prompt: string,
  ctx: ProviderContext,
  modelKeyOverride?: string,
): Promise<TaskResult> {
  if (!ctx.apiKey || !ctx.apiKey.trim()) {
    throw new Error('Gemini API key not configured for current provider/user')
  }

  const baseUrl = normalizeBaseUrl(ctx.baseUrl)
  // 默认使用 gemini-2.5-flash-image 模型
  let model = 'models/gemini-2.5-flash-image'
  const override = modelKeyOverride && modelKeyOverride.trim()
  if (override) {
    const key = override.trim()
    model = key.startsWith('models/') ? key : `models/${key}`
  }
  const apiModel = model

  const url = `${baseUrl}/v1beta/${apiModel}:generateContent?key=${encodeURIComponent(ctx.apiKey)}`
  const body = {
    contents: [
      {
        role: 'user',
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: {
      responseModalities: ['IMAGE', 'TEXT'],
    },
  }

  const res = await axios.post(url, body, {
    headers: {
      'Content-Type': 'application/json',
    },
    timeout: 60000,
    validateStatus: () => true,
  })

  if (res.status < 200 || res.status >= 300) {
    const msg =
      (res.data && (res.data.error?.message || res.data.message)) ||
      `Gemini generateImages failed with status ${res.status}，${url}`
    const err = new Error(msg) as any
    err.status = res.status
    err.response = res.data

    // 如果是配额超限错误，提取更详细的信息
    if (res.status === 429 && res.data) {
      err.isQuotaExceeded = true
      err.retryAfter = res.data.retryAfter || null
    }

    throw err
  }

  const raw = res.data as any
  const candidates = raw?.candidates || []
  const parts = candidates[0]?.content?.parts || []

  // 从 Gemini 2.5 Flash Image 响应中提取图像
  const imgs: any[] = []
  parts.forEach((part: any) => {
    if (part.inlineData && part.inlineData.mimeType && part.inlineData.mimeType.startsWith('image/')) {
      // 处理 base64 编码的图像数据
      const base64Data = part.inlineData.data
      if (base64Data) {
        // 将 base64 转换为数据 URL
        const mimeType = part.inlineData.mimeType
        imgs.push({
          url: `data:${mimeType};base64,${base64Data}`,
          uri: `data:${mimeType};base64,${base64Data}`
        })
      }
    }
  })

  // 兼容旧格式的响应
  const legacyImgs: any[] = Array.isArray(raw?.generatedImages)
    ? raw.generatedImages
    : Array.isArray(raw?.images)
      ? raw.images
      : []

  const allImgs = [...imgs, ...legacyImgs]

  const assets: TaskAsset[] =
    allImgs
      .map((img: any): TaskAsset | null => {
        const url =
          img.uri ||
          img.url ||
          img.imageUri ||
          (img.media && img.media.url) ||
          ''
        if (!url) return null
        const thumb =
          img.thumbnailUri ||
          img.thumbnailUrl ||
          (img.thumbnail && img.thumbnail.url) ||
          null
        return {
          type: 'image' as const,
          url,
          thumbnailUrl: thumb,
        }
      })
      .filter((a): a is TaskAsset => a !== null)

  const id = `gemini-img-${Date.now().toString(36)}`
  const result: TaskResult = {
    id,
    kind: 'text_to_image',
    status: 'succeeded',
    assets,
    raw: {
      provider: 'gemini',
      response: raw,
    },
  }
  return result
}

async function callBananaDraw(
  req: TextToImageRequest | ImageEditRequest,
  ctx: ProviderContext,
  modelKeyOverride?: string | null,
): Promise<TaskResult> {
  const normalizedModel =
    normalizeModelKey(modelKeyOverride || ctx.modelKey) || 'nano-banana-fast'
  if (!isBananaModel(normalizedModel)) {
    throw new Error('当前模型不支持 Banana 图片接口')
  }
  if (!ctx.apiKey || !ctx.apiKey.trim()) {
    throw new Error('未配置 grsai API Key')
  }
  const baseUrl = (ctx.baseUrl && ctx.baseUrl.trim()) || DEFAULT_BANANA_BASE_URL
  const endpoint = `${baseUrl.replace(/\/+$/, '')}/v1/draw/nano-banana`
  const extras = (req.extras || {}) as Record<string, any>
  const referenceImages: string[] = Array.isArray(extras.referenceImages)
    ? extras.referenceImages
        .map((url: any) => (typeof url === 'string' ? url.trim() : ''))
        .filter((url: string) => url.length > 0)
    : []
  const aspectRatio =
    typeof extras.aspectRatio === 'string' && extras.aspectRatio.trim()
      ? extras.aspectRatio.trim()
      : 'auto'
  const imageSize =
    typeof extras.imageSize === 'string' && extras.imageSize.trim()
      ? extras.imageSize.trim()
      : undefined
  const shouldStreamProgress = extras.shutProgress === true ? false : true
  const body: any = {
    model: normalizedModel,
    prompt: req.prompt,
    aspectRatio,
    shutProgress: shouldStreamProgress ? false : true,
  }
  if (imageSize) {
    body.imageSize = imageSize
  }
  if (referenceImages.length) {
    body.urls = referenceImages
  }
  if (typeof extras.webHook === 'string' && extras.webHook.trim()) {
    body.webHook = extras.webHook.trim()
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: shouldStreamProgress ? 'text/event-stream,application/json' : 'application/json',
      Authorization: `Bearer ${ctx.apiKey.trim()}`,
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    let msg = `Banana draw failed with status ${response.status}`
    if (errorText) {
      try {
        const parsed = JSON.parse(errorText)
        msg = parsed?.msg || parsed?.message || parsed?.error || msg
      } catch {
        msg = errorText
      }
    }
    const err = new Error(msg)
    ;(err as any).status = response.status
    ;(err as any).response = errorText
    throw err
  }

  const contentType = (response.headers.get('content-type') || '').toLowerCase()
  let payloadSource: any = null
  let streamedEvents: any[] = []
  if (shouldStreamProgress && contentType.includes('text/event-stream')) {
    const streamed = await readBananaEventStream(response, ctx)
    payloadSource = streamed.text
    streamedEvents = streamed.events
  } else if (contentType.includes('application/json')) {
    payloadSource = await response.json().catch(() => null)
  } else {
    payloadSource = await response.text().catch(() => '')
  }

  const normalizedResponse = normalizeBananaResponse(payloadSource)
  const events = streamedEvents.length ? streamedEvents : normalizedResponse.events
  const payload = normalizedResponse.payload ?? {}
  const responsePayload = events.length ? { events, raw: normalizedResponse.raw } : normalizedResponse.raw
  const imageUrls = extractBananaImageUrls(payload)
  const assets: TaskAsset[] = imageUrls.map((url) => ({
    type: 'image',
    url,
    thumbnailUrl: null,
  }))

  if (!assets.length) {
    const failure =
      payload?.failure_reason ||
      payload?.error ||
      (typeof normalizedResponse.raw === 'string'
        ? normalizedResponse.raw
        : (normalizedResponse.raw &&
            (normalizedResponse.raw.msg || normalizedResponse.raw.message || normalizedResponse.raw.error))) ||
      (typeof payloadSource === 'string' ? payloadSource : null)
    const err = new Error(failure || 'Banana API 返回的结果为空')
    ;(err as any).response = responsePayload
    throw err
  }

  const statusValue = typeof payload?.status === 'string' ? payload.status.toLowerCase() : 'succeeded'
  const status = statusValue === 'failed' ? 'failed' : 'succeeded'

  return {
    id: payload?.id || `banana-${Date.now().toString(36)}`,
    kind: req.kind,
    status,
    assets,
    raw: {
      provider: 'gemini',
      vendor: 'grsai',
      model: normalizedModel,
      response: responsePayload,
    },
  }
}

export const geminiAdapter: ProviderAdapter = {
  name: 'gemini',
  supports: ['chat', 'prompt_refine', 'text_to_image', 'image_edit', 'text_to_video'],

  async runChat(_req: BaseTaskRequest, _ctx: ProviderContext): Promise<TaskResult> {
    const sys = _req.kind === 'prompt_refine'
      ? ((_req.extras as any)?.systemPrompt as string) || '你是一个提示词优化助手。请在保持核心意图不变的前提下润色、缩短并结构化下面的提示词，用于后续多模态生成。'
      : undefined
    const modelKeyOverride = (_req.extras as any)?.modelKey as string | undefined
    return callGenerateContent('chat', _req.prompt, _ctx, sys, modelKeyOverride)
  },

  async textToImage(_req: TextToImageRequest, _ctx: ProviderContext): Promise<TaskResult> {
    const modelKeyOverride = (_req.extras as any)?.modelKey as string | undefined
    if (isBananaModel(modelKeyOverride || _ctx.modelKey)) {
      return callBananaDraw(_req, _ctx, modelKeyOverride || _ctx.modelKey)
    }
    return callGenerateImage(_req.prompt, _ctx, modelKeyOverride)
  },

  async imageEdit(_req: ImageEditRequest, _ctx: ProviderContext): Promise<TaskResult> {
    const modelKeyOverride = (_req.extras as any)?.modelKey as string | undefined
    if (!isBananaModel(modelKeyOverride || _ctx.modelKey)) {
      throw new Error('当前 Gemini 提供商未配置支持图片编辑的 Banana 模型')
    }
    return callBananaDraw(_req, _ctx, modelKeyOverride || _ctx.modelKey)
  },

  async textToVideo(_req: TextToVideoRequest, _ctx: ProviderContext): Promise<TaskResult> {
    const sys =
      '你是一个视频分镜提示词助手。请将用户输入整理为一段适合文本转视频模型的英文描述，可以包含镜头、场景、运动信息。只输出描述文本本身。'
    const modelKeyOverride = (_req.extras as any)?.modelKey as string | undefined
    return callGenerateContent('text_to_video', _req.prompt, _ctx, sys, modelKeyOverride)
  },
}
