import axios from 'axios'
import type {
  BaseTaskRequest,
  ProviderAdapter,
  ProviderContext,
  TaskResult,
  TextToImageRequest,
  TextToVideoRequest,
  TaskAsset,
} from '../task.types'

const DEFAULT_GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com'
// 默认使用 2.5-flash；可通过 extras.modelKey 或 ModelProfile.modelKey 覆盖
const DEFAULT_TEXT_MODEL = 'models/gemini-2.5-flash'
const CHAT_SUPPORTED_MODELS = new Set([
  'models/gemini-2.5-flash',
  'models/gemini-2.5-pro',
  'models/gemini-3-pro-preview',
])

function normalizeBaseUrl(baseUrl?: string): string {
  const raw = (baseUrl || DEFAULT_GEMINI_BASE_URL).trim()
  // 去掉末尾多余 / 和版本段，避免出现 /v1beta/v1beta 这种路径
  let url = raw.replace(/\/+$/, '')
  url = url.replace(/\/v1beta$/i, '').replace(/\/v1$/i, '')
  return url
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
    const err = new Error(msg)
    ;(err as any).status = res.status
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
  // 默认对外暴露 gemini-2.5-flash-image-preview，但底层按需映射到实际图片模型
  let model = 'models/gemini-2.5-flash-image-preview'
  const override = modelKeyOverride && modelKeyOverride.trim()
  if (override) {
    const key = override.trim()
    model = key.startsWith('models/') ? key : `models/${key}`
  }
  // 当前 Gemini 图片生成实际使用 imagegeneration 模型；保持对外 modelKey 不变
  const apiModel = model === 'models/gemini-2.5-flash-image-preview' ? 'models/gemini-2.5-flash-image-preview' : model

  const url = `${baseUrl}/v1beta/${apiModel}:generateContent?key=${encodeURIComponent(ctx.apiKey)}`
  const body = {
    contents: [
      {
        role: 'user',
        parts: [{ text: prompt }],
      },
    ],
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
    const err = new Error(msg)
    ;(err as any).status = res.status
    throw err
  }

  const raw = res.data as any
  const imgs: any[] = Array.isArray(raw?.generatedImages)
    ? raw.generatedImages
    : Array.isArray(raw?.images)
      ? raw.images
      : []

  const assets: TaskAsset[] =
    imgs
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

export const geminiAdapter: ProviderAdapter = {
  name: 'gemini',
  supports: ['chat', 'prompt_refine', 'text_to_image', 'text_to_video'],

  async runChat(_req: BaseTaskRequest, _ctx: ProviderContext): Promise<TaskResult> {
    const sys = _req.kind === 'prompt_refine'
      ? ((_req.extras as any)?.systemPrompt as string) || '你是一个提示词优化助手。请在保持核心意图不变的前提下润色、缩短并结构化下面的提示词，用于后续多模态生成。'
      : undefined
    const modelKeyOverride = (_req.extras as any)?.modelKey as string | undefined
    return callGenerateContent('chat', _req.prompt, _ctx, sys, modelKeyOverride)
  },

  async textToImage(_req: TextToImageRequest, _ctx: ProviderContext): Promise<TaskResult> {
    const modelKeyOverride = (_req.extras as any)?.modelKey as string | undefined
    return callGenerateImage(_req.prompt, _ctx, modelKeyOverride)
  },

  async textToVideo(_req: TextToVideoRequest, _ctx: ProviderContext): Promise<TaskResult> {
    const sys =
      '你是一个视频分镜提示词助手。请将用户输入整理为一段适合文本转视频模型的英文描述，可以包含镜头、场景、运动信息。只输出描述文本本身。'
    const modelKeyOverride = (_req.extras as any)?.modelKey as string | undefined
    return callGenerateContent('text_to_video', _req.prompt, _ctx, sys, modelKeyOverride)
  },
}
