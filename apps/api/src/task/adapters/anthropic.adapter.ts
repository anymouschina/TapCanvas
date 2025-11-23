import axios from 'axios'
import type { BaseTaskRequest, ProviderAdapter, ProviderContext, TaskResult } from '../task.types'

const DEFAULT_BASE_URL = 'https://api.anthropic.com'
const DEFAULT_MODEL = 'claude-3.5-sonnet'
const ANTHROPIC_VERSION = '2023-06-01'

function normalizeBaseUrl(baseUrl?: string): string {
  const raw = (baseUrl || DEFAULT_BASE_URL).trim()
  return raw.replace(/\/+$/, '')
}

async function callAnthropicMessages(
  prompt: string,
  ctx: ProviderContext,
  options?: { systemPrompt?: string; modelKey?: string },
): Promise<{ text: string; raw: any }> {
  const apiKey = (ctx.apiKey || '').trim()
  if (!apiKey) {
    throw new Error('Anthropic API key not configured for current provider/user')
  }
  const base = normalizeBaseUrl(ctx.baseUrl)
  const path = /\/v\d+\/messages$/i.test(base)
    ? base
    : `${base}${/\/v\d+$/i.test(base) ? '' : '/v1'}/messages`
  const model = options?.modelKey?.trim() || ctx.modelKey?.trim() || DEFAULT_MODEL
  const body: any = {
    model,
    max_tokens: 800,
    messages: [
      {
        role: 'user',
        content: [{ type: 'text', text: prompt }],
      },
    ],
  }
  const systemPrompt = options?.systemPrompt?.trim()
  if (systemPrompt) {
    body.system = systemPrompt
  }
  const res = await axios.post(path, body, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    timeout: 30000,
    validateStatus: () => true,
  })
  if (res.status < 200 || res.status >= 300) {
    const msg =
      (res.data && (res.data.error?.message || res.data.message)) ||
      `Anthropic messages failed with status ${res.status}`
    const err = new Error(msg)
    ;(err as any).status = res.status
    ;(err as any).response = res.data
    throw err
  }
  const raw = res.data
  let textOut = ''
  const content = raw?.content
  if (Array.isArray(content)) {
    textOut = content
      .map((item: any) => (item?.type === 'text' && typeof item.text === 'string' ? item.text : ''))
      .join('\n')
      .trim()
  }
  return { text: textOut, raw }
}

export const anthropicAdapter: ProviderAdapter = {
  name: 'anthropic',
  supports: ['chat', 'prompt_refine'],

  async runChat(req: BaseTaskRequest, ctx: ProviderContext): Promise<TaskResult> {
    const systemPrompt =
      req.kind === 'prompt_refine'
        ? ((_reqExtras(req).systemPrompt as string) ||
            '你是一个提示词修订助手。请在保持原意的前提下优化并返回脚本正文。')
        : ((_reqExtras(req).systemPrompt as string) || '')
    const modelKeyOverride = (_reqExtras(req).modelKey as string) || ctx.modelKey || undefined
    const { text, raw } = await callAnthropicMessages(req.prompt, ctx, {
      systemPrompt,
      modelKey: modelKeyOverride,
    })
    const id = raw?.id || `anth-${Date.now().toString(36)}`
    return {
      id,
      kind: req.kind,
      status: 'succeeded',
      assets: [],
      raw: { provider: 'anthropic', response: raw, text },
    }
  },
}

function _reqExtras(req: BaseTaskRequest): Record<string, any> {
  return (req.extras as Record<string, any>) || {}
}
