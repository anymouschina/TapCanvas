import axios from 'axios'
import { Buffer } from 'buffer'
import type {
  BaseTaskRequest,
  ImageToPromptRequest,
  ProviderAdapter,
  ProviderContext,
  TaskAsset,
  TaskResult,
  TextToImageRequest,
} from '../task.types'

const DEFAULT_BASE_URL = 'https://api.openai.com'
const DEFAULT_MODEL = 'gpt-5.1'
const DEFAULT_IMAGE_MODEL = 'gpt-image-1'
const DEFAULT_IMAGE_SIZE = '1024x1024'
const OPENAI_IMAGE_SIZE_REGEX = /^\d{2,4}x\d{2,4}$/i

type OpenAIContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } | string }

type OpenAIMessage = {
  role: string
  content: string | OpenAIContentPart[]
}

function buildResponsesUrl(baseUrl: string): string {
  const normalized = normalizeBaseUrl(baseUrl)
  const hasVersion = /\/v\d+(?:beta)?$/i.test(normalized)
  if (/\/responses$/i.test(normalized)) {
    return normalized
  }
  return `${normalized}${hasVersion ? '' : '/v1'}/responses`
}

function shouldUseResponsesEndpoint(baseUrl: string, preferred?: boolean): boolean {
  if (typeof preferred === 'boolean') return preferred
  // 默认统一走 /responses 端点，避免 codex 代理返回 400
  return true
}

function normalizeMessageContent(content: string | OpenAIContentPart[]): OpenAIContentPart[] {
  if (typeof content === 'string') {
    return [{ type: 'text', text: content }]
  }
  return content
}

function convertPartForResponses(part: OpenAIContentPart): OpenAIContentPart {
  if (part.type === 'text') {
    return { type: 'input_text', text: (part as any).text ?? '' } as any
  }
  if (part.type === 'image_url') {
    const source = typeof part.image_url === 'string' ? part.image_url : part.image_url?.url
    return { type: 'input_image', image_url: source || '' } as any
  }
  return part
}

function convertMessagesToResponseInput(messages: OpenAIMessage[]) {
  return messages.map((msg) => ({
    role: msg.role,
    content: normalizeMessageContent(msg.content).map(convertPartForResponses),
  }))
}

function extractTextFromResponse(raw: any): string {
  if (Array.isArray(raw?.choices)) {
    const choice = raw.choices[0]
    const message = choice?.message
    if (Array.isArray(message?.content)) {
      return message.content
        .map((part: any) => (typeof part?.text === 'string' ? part.text : part?.content || ''))
        .join('')
        .trim()
    }
    if (typeof message?.content === 'string') {
      return message.content.trim()
    }
  }

  const output = raw?.output
  if (Array.isArray(output)) {
    const buffer: string[] = []
    output.forEach((entry: any) => {
      if (Array.isArray(entry?.content)) {
        entry.content.forEach((part: any) => {
          if (typeof part?.text === 'string') {
            buffer.push(part.text)
          } else if (typeof part?.content === 'string') {
            buffer.push(part.content)
          } else if (typeof part?.output_text === 'string') {
            buffer.push(part.output_text)
          }
        })
      }
    })
    const merged = buffer.join('').trim()
    if (merged) return merged
  }

  if (Array.isArray(raw?.output_text)) {
    const merged = raw.output_text.filter((v: any) => typeof v === 'string').join('').trim()
    if (merged) return merged
  }

  if (typeof raw?.text === 'string') {
    return raw.text.trim()
  }

  return ''
}

function normalizeImagePromptOutput(text: string): string {
  if (!text) return ''
  let normalized = text.trim()

  // Strip common leading "Prompt" labels and Markdown headings.
  normalized = normalized.replace(/^\s*\*{0,2}\s*prompt\s*\*{0,2}\s*[-:]\s*/i, '')

  // Remove surrounding quotes if the entire output is quoted.
  if (
    (normalized.startsWith('"') && normalized.endsWith('"')) ||
    (normalized.startsWith("'") && normalized.endsWith("'"))
  ) {
    normalized = normalized.slice(1, -1).trim()
  }

  return normalized.trim()
}

function safeParseJson(data: string): any | null {
  try {
    return JSON.parse(data)
  } catch {
    return null
  }
}

function parseSseResponse(raw: string): any | null {
  if (typeof raw !== 'string' || !raw.trim()) return null
  const chunks = raw.split(/\n\n+/)
  let completedResponse: any = null
  let aggregatedText = ''

  chunks.forEach((chunk) => {
    const trimmed = chunk.trim()
    if (!trimmed) return
    const dataLines = trimmed
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .filter(Boolean)
    if (!dataLines.length) return
    const payload = safeParseJson(dataLines.join('\n'))
    if (!payload || typeof payload !== 'object') return
    if (payload.type === 'response.completed' && payload.response) {
      completedResponse = payload.response
      return
    }
    if (payload.type === 'response.output_text.delta' && typeof payload.delta === 'string') {
      aggregatedText += payload.delta
    }
    if (!aggregatedText) {
      if (payload.type === 'response.output_text.done' && typeof payload.text === 'string') {
        aggregatedText = payload.text
      } else if (
        payload.type === 'response.content_part.done' &&
        payload.part &&
        typeof payload.part.text === 'string'
      ) {
        aggregatedText = payload.part.text
      }
    }
  })

  if (completedResponse) return completedResponse
  if (aggregatedText) {
    return {
      text: aggregatedText,
      output_text: [aggregatedText],
    }
  }
  return null
}

function isValidImageSource(value?: string) {
  if (!value) return false
  const trimmed = value.trim()
  return /^https?:\/\//i.test(trimmed) || trimmed.startsWith('data:')
}

function resolveImageSource(url?: string, data?: string): string | null {
  if (isValidImageSource(url)) return url!.trim()
  if (isValidImageSource(data)) return data!.trim()
  return null
}

async function convertRemoteImageToDataUrl(url: string): Promise<string | null> {
  try {
    const res = await axios.get<ArrayBuffer>(url, {
      responseType: 'arraybuffer',
      timeout: 15000,
    })
    const contentType =
      (res.headers && (res.headers['content-type'] as string | undefined)) || 'image/png'
    const buffer = Buffer.from(res.data)
    const encoded = buffer.toString('base64')
    return `data:${contentType};base64,${encoded}`
  } catch (error) {
    console.error('convertRemoteImageToDataUrl failed', { url, error })
    return null
  }
}

function normalizeBaseUrl(baseUrl?: string): string {
  const raw = (baseUrl || DEFAULT_BASE_URL).trim()
  return raw.replace(/\/+$/, '')
}

function buildChatUrl(baseUrl: string): string {
  const normalized = normalizeBaseUrl(baseUrl)
  const hasVersion = /\/v\d+(?:beta)?$/i.test(normalized)
  if (/\/chat\/completions$/i.test(normalized)) {
    return normalized
  }
  return `${normalized}${hasVersion ? '' : '/v1'}/chat/completions`
}

function buildImageGenerationUrl(baseUrl: string): string {
  const normalized = normalizeBaseUrl(baseUrl)
  if (/\/images\/generations$/i.test(normalized)) {
    return normalized
  }
  const hasVersion = /\/v\d+(?:beta)?$/i.test(normalized)
  return `${normalized}${hasVersion ? '' : '/v1'}/images/generations`
}

function toDimension(value?: number | null): number | null {
  if (typeof value !== 'number' || Number.isNaN(value) || value <= 0) return null
  const clamped = Math.min(2048, Math.max(64, Math.round(value)))
  return clamped
}

function normalizeImageSize(req: TextToImageRequest, extras: Record<string, any>): string {
  const explicit = typeof extras.size === 'string' ? extras.size.trim().toLowerCase() : ''
  if (explicit && OPENAI_IMAGE_SIZE_REGEX.test(explicit)) {
    return explicit
  }
  const widthDim = toDimension(
    typeof extras.width === 'number'
      ? extras.width
      : typeof req.width === 'number'
        ? req.width
        : null,
  )
  const heightDim = toDimension(
    typeof extras.height === 'number'
      ? extras.height
      : typeof req.height === 'number'
        ? req.height
        : null,
  )
  if (widthDim && heightDim) return `${widthDim}x${heightDim}`
  if (widthDim) return `${widthDim}x${widthDim}`
  if (heightDim) return `${heightDim}x${heightDim}`
  return DEFAULT_IMAGE_SIZE
}

async function callOpenAIChat(
  prompt: string,
  ctx: ProviderContext,
  options?: {
    systemPrompt?: string
    modelKey?: string | null
    temperature?: number
    imageUrls?: string[]
    preferResponses?: boolean
  },
): Promise<{ text: string; raw: any }> {
  const apiKey = (ctx.apiKey || '').trim()
  if (!apiKey) {
    throw new Error('OpenAI API key not configured for current provider/user')
  }

  const useResponses = shouldUseResponsesEndpoint(ctx.baseUrl, options?.preferResponses)
  const url = useResponses ? buildResponsesUrl(ctx.baseUrl) : buildChatUrl(ctx.baseUrl)
  const model = (options?.modelKey && options.modelKey.trim()) || (ctx.modelKey && ctx.modelKey.trim()) || DEFAULT_MODEL
  const systemPrompt = options?.systemPrompt?.trim()
  const messages: OpenAIMessage[] = []
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt })
  }
  const normalizedImages = Array.isArray(options?.imageUrls)
    ? options!.imageUrls!.map((u) => (typeof u === 'string' ? u.trim() : '')).filter((u) => Boolean(u))
    : []

  if (normalizedImages.length > 0) {
    const content: OpenAIContentPart[] = [
      { type: 'text', text: prompt && prompt.trim().length > 0 ? prompt : '请分析这张图片并回答问题。' },
    ]
    normalizedImages.forEach((url) => {
      content.push({ type: 'image_url', image_url: url })
    })
    messages.push({ role: 'user', content })
  } else {
    messages.push({ role: 'user', content: prompt })
  }

  const temperature =
    typeof options?.temperature === 'number' && !Number.isNaN(options.temperature)
      ? Math.min(2, Math.max(0, options.temperature))
      : undefined

  const body: Record<string, any> = useResponses
    ? {
        model,
        input: convertMessagesToResponseInput(messages),
        max_output_tokens: 800,
        stream: false,
      }
    : {
        model,
        max_tokens: 800,
        messages,
      }
  if (typeof temperature === 'number') {
    body.temperature = temperature
  }

  const res = await axios.post(url, body, {
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    timeout: 30000,
    validateStatus: () => true,
  })

  if (res.status < 200 || res.status >= 300) {
    const msg =
      (res.data && (res.data.error?.message || res.data.message)) ||
      `OpenAI chat completion failed with status ${res.status}`
    // eslint-disable-next-line no-console
    console.error('callOpenAIChat error', {
      url,
      useResponses,
      status: res.status,
      response: res.data,
      body,
    })
    const err = new Error(msg)
    ;(err as any).status = res.status
    ;(err as any).response = res.data
    throw err
  }

  const raw = res.data
  const normalized =
    typeof raw === 'string' ? parseSseResponse(raw) || safeParseJson(raw) || raw : raw
  const text = extractTextFromResponse(normalized)

  return { text, raw: normalized }
}

export const openaiAdapter: ProviderAdapter = {
  name: 'openai',
  supports: ['chat', 'prompt_refine', 'text_to_image', 'image_to_prompt'],

  async runChat(req: BaseTaskRequest, ctx: ProviderContext): Promise<TaskResult> {
    const extras = _reqExtras(req)
    const systemPrompt =
      req.kind === 'prompt_refine'
        ? (typeof extras.systemPrompt === 'string'
            ? extras.systemPrompt
            : '你是一个提示词修订助手。请在保持原意的前提下优化并返回脚本正文。')
        : (typeof extras.systemPrompt === 'string' ? extras.systemPrompt : '')
    const modelKeyOverride = typeof extras.modelKey === 'string' ? extras.modelKey : ctx.modelKey || undefined
    const temperature =
      typeof extras.temperature === 'number' && !Number.isNaN(extras.temperature) ? extras.temperature : undefined

    const { text, raw } = await callOpenAIChat(req.prompt, ctx, {
      systemPrompt,
      modelKey: modelKeyOverride,
      temperature,
    })
    const id = raw?.id || `openai-${Date.now().toString(36)}`
    return {
      id,
      kind: req.kind,
      status: 'succeeded',
      assets: [],
      raw: {
        provider: 'openai',
        response: raw,
        text,
      },
    }
  },

  async textToImage(req: TextToImageRequest, ctx: ProviderContext): Promise<TaskResult> {
    const apiKey = (ctx.apiKey || '').trim()
    if (!apiKey) {
      throw new Error('OpenAI API key not configured for current provider/user')
    }

    const extras = _reqExtras(req)
    const url = buildImageGenerationUrl(ctx.baseUrl)
    const model =
      (typeof extras.modelKey === 'string' && extras.modelKey.trim()) ||
      (ctx.modelKey && ctx.modelKey.trim()) ||
      DEFAULT_IMAGE_MODEL

    const responseFormat =
      typeof extras.responseFormat === 'string' && extras.responseFormat.trim().toLowerCase() === 'url'
        ? 'url'
        : 'b64_json'
    const imageFormat =
      (typeof extras.imageFormat === 'string' && extras.imageFormat.trim().toLowerCase()) || 'png'
    const size = normalizeImageSize(req, extras)
    const background =
      typeof extras.background === 'string' && extras.background.trim()
        ? extras.background.trim()
        : undefined
    const quality =
      typeof extras.quality === 'string' && extras.quality.trim()
        ? extras.quality.trim()
        : undefined
    const style =
      typeof extras.style === 'string' && extras.style.trim() ? extras.style.trim() : undefined
    const user = ctx.userId
    const negativePrompt =
      typeof extras.negativePrompt === 'string' && extras.negativePrompt.trim()
        ? extras.negativePrompt.trim()
        : req.negativePrompt?.trim()
    const prompt =
      negativePrompt && negativePrompt.length
        ? `${req.prompt}\n\nNegative prompt: ${negativePrompt}`
        : req.prompt
    const countRaw =
      typeof extras.n === 'number'
        ? extras.n
        : typeof extras.samples === 'number'
          ? extras.samples
          : 1
    const n = Math.min(4, Math.max(1, Math.floor(countRaw)))

    const body: Record<string, any> = {
      model,
      prompt,
      size,
      n,
      response_format: responseFormat,
    }
    if (typeof req.seed === 'number' && Number.isFinite(req.seed)) {
      body.seed = req.seed
    } else if (typeof extras.seed === 'number' && Number.isFinite(extras.seed)) {
      body.seed = extras.seed
    }
    if (background) body.background = background
    if (quality) body.quality = quality
    if (style) body.style = style
    if (user) body.user = user

    const res = await axios.post(url, body, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      timeout: 60000,
      validateStatus: () => true,
    })

    if (res.status < 200 || res.status >= 300) {
      const msg =
        (res.data && (res.data.error?.message || res.data.message)) ||
        `OpenAI image generation failed with status ${res.status}`
      const err = new Error(msg)
      ;(err as any).status = res.status
      ;(err as any).response = res.data
      throw err
    }

    const raw = res.data
    const dataEntries = Array.isArray(raw?.data) ? raw.data : []
    const assets: TaskAsset[] = dataEntries
      .map((entry: any): TaskAsset | null => {
        if (responseFormat === 'url') {
          const imageUrl = typeof entry?.url === 'string' ? entry.url.trim() : ''
          if (!imageUrl) return null
          return { type: 'image', url: imageUrl, thumbnailUrl: null }
        }
        const encoded = typeof entry?.b64_json === 'string' ? entry.b64_json.trim() : ''
        if (!encoded) return null
        const sanitized = encoded.replace(/\s+/g, '')
        const dataUrl = `data:image/${imageFormat};base64,${sanitized}`
        return { type: 'image', url: dataUrl, thumbnailUrl: null }
      })
      .filter((asset: TaskAsset | null): asset is TaskAsset => Boolean(asset))

    const revisedPrompt =
      dataEntries
        .map((entry: any) =>
          typeof entry?.revised_prompt === 'string' ? entry.revised_prompt.trim() : '',
        )
        .filter(Boolean)
        .join('\n') || undefined
    const id = raw?.id || `openai-img-${Date.now().toString(36)}`
    const result: TaskResult = {
      id,
      kind: 'text_to_image',
      status: assets.length ? 'succeeded' : 'failed',
      assets,
      raw: {
        provider: 'openai',
        response: raw,
        text: revisedPrompt,
      },
    }
    return result
  },

  async imageToPrompt(req: ImageToPromptRequest, ctx: ProviderContext): Promise<TaskResult> {
    const extras = _reqExtras(req)
    const rawImageUrl = typeof extras.imageUrl === 'string' ? extras.imageUrl.trim() : ''
    const rawImageData = typeof extras.imageData === 'string' ? extras.imageData.trim() : ''
    const imageSource = resolveImageSource(rawImageUrl, rawImageData)
    if (!imageSource) {
      throw new Error('imageUrl 或 imageData 必须提供一个用于 image_to_prompt')
    }

    const userPrompt =
      req.prompt?.trim() ||
      'Describe this image in rich detail and output a single, well-structured English prompt that can be used to recreate it. Do not add any explanations, headings, markdown formatting, or non-English text.'
    const systemPrompt =
      typeof extras.systemPrompt === 'string' && extras.systemPrompt.trim()
        ? extras.systemPrompt.trim()
        : 'You are an expert prompt engineer. When a user provides an image, you must return a single detailed English prompt that can be used to recreate it. Describe subjects, environment, composition, camera, lighting, and style cues. Do not add explanations, headings, markdown, or any non-English text; output only the final English prompt.'
    const modelKeyOverride = typeof extras.modelKey === 'string' ? extras.modelKey : ctx.modelKey || undefined
    const temperature =
      typeof extras.temperature === 'number' && !Number.isNaN(extras.temperature) ? extras.temperature : 0.2

    let preparedImageSource = imageSource
    if (/^https?:\/\//i.test(imageSource)) {
      const converted = await convertRemoteImageToDataUrl(imageSource)
      preparedImageSource = converted || imageSource
    }

    const { text: rawText, raw } = await callOpenAIChat(userPrompt, ctx, {
      systemPrompt,
      modelKey: modelKeyOverride,
      temperature,
      imageUrls: [preparedImageSource],
      preferResponses: typeof extras.preferResponses === 'boolean' ? extras.preferResponses : undefined,
    })

    const text = normalizeImagePromptOutput(rawText)

    const id = raw?.id || `openai-${Date.now().toString(36)}`
    return {
      id,
      kind: req.kind,
      status: 'succeeded',
      assets: [],
      raw: {
        provider: 'openai',
        response: raw,
        text,
        imageSource: preparedImageSource,
      },
    }
  },
}

function _reqExtras(req: BaseTaskRequest): Record<string, any> {
  return (req.extras as Record<string, any>) || {}
}
