import { BadRequestException, Injectable, Logger } from '@nestjs/common'
import { PrismaService } from 'nestjs-prisma'
import { convertToCoreMessages, generateObject, streamText, tool, type CoreMessage, type ToolChoice } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { z } from 'zod'
import { ACTION_TYPES, SYSTEM_PROMPT, MODEL_PROVIDER_MAP, PROVIDER_VENDOR_ALIASES, type SupportedProvider } from './constants'
import type { ChatRequestDto, ChatResponseDto, CanvasContextDto, ChatMessageDto, ToolResultDto } from './dto/chat.dto'
import { ToolEventsService } from './tool-events.service'
import type { ModelProvider, ModelToken } from '@prisma/client'

const actionEnum = z.enum(ACTION_TYPES)

const assistantSchema = z.object({
  reply: z.string().describe('面向用户的最终回复'),
  plan: z.array(z.string()).max(5).default([]).describe('可执行的计划要点'),
  actions: z.array(z.object({
    type: actionEnum,
    params: z.object({
      payload: z.any().optional().describe('占位字段，实际参数会扩展在该对象上')
    }).catchall(z.any()).default({}).describe('工具调用参数'),
    reasoning: z.string().optional(),
    storeResultAs: z.string().optional().describe('为该action输出注册引用名称')
  })).default([]),
})

// 基础画布工具定义（服务端仅回传占位结果，具体操作由前端执行）
// 基础画布工具定义（默认不在服务端执行，由前端通过 UI stream 接管）
const canvasToolSchemas = {
  getNodes: {
    description: '获取当前画布节点列表（由前端执行真正的读取逻辑）',
    inputSchema: z.object({})
  },
  createNode: {
    description: '创建节点（type/label/config 由模型决定；分镜节点必须使用 type=storyboard；实际创建在前端完成）',
    inputSchema: z.object({
      type: z.string(),
      label: z.string().optional(),
      config: z.record(z.any()).optional(),
      position: z.object({ x: z.number(), y: z.number() }).optional()
    })
  },
  connectNodes: {
    description: '连接两个节点（source/target），实际连接在前端完成',
    inputSchema: z.object({
      sourceNodeId: z.string(),
      targetNodeId: z.string()
    })
  },
  runDag: {
    description: '执行当前画布工作流，真实执行在前端/客户端完成',
    inputSchema: z.object({
      concurrency: z.number().optional()
    })
  },
  formatAll: {
    description: '全选并自动布局',
    inputSchema: z.object({})
  },
  findNodes: {
    description: '根据标签或类型查找节点（前端执行）',
    inputSchema: z.object({
      label: z.string().optional(),
      type: z.string().optional()
    })
  },
  deleteNode: {
    description: '删除指定节点（前端执行）',
    inputSchema: z.object({
      nodeId: z.string()
    })
  },
  updateNode: {
    description: '更新节点配置（前端执行）',
    inputSchema: z.object({
      nodeId: z.string(),
      label: z.string().optional(),
      config: z.record(z.any()).optional()
    })
  },
  disconnectNodes: {
    description: '断开节点连接（前端执行）',
    inputSchema: z.object({
      edgeId: z.string()
    })
  },
} as const

// 客户端执行模式：仅提供工具 schema，实际执行交由前端 useChat 工具调用
const canvasToolsForClient = canvasToolSchemas

// 兜底服务端模式：如果未开启客户端执行，则返回占位结果避免异常
const canvasToolsWithServerFallback = Object.fromEntries(
  Object.entries(canvasToolSchemas).map(([name, def]) => [
    name,
    tool({
      ...def,
      execute: async () => ({ success: false, message: '前端未连接，无法执行画布操作' })
    })
  ])
)

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly toolEvents: ToolEventsService,
  ) {}

  async chat(userId: string, payload: ChatRequestDto): Promise<ChatResponseDto> {
    if (!payload.messages?.length) {
      throw new BadRequestException('消息内容不能为空')
    }

    const provider = this.resolveProvider(payload.model, payload.baseUrl, payload.provider)
    const { apiKey, baseUrl } = await this.resolveCredentials(userId, provider, payload.apiKey, payload.baseUrl)
    const model = this.buildModel(provider, payload.model, apiKey, baseUrl)

    const systemPrompt = this.composeSystemPrompt(payload.context)
    const chatMessages = this.normalizeMessages(payload.messages)

    try {
      const maxAttempts = 3
      const reminder = '系统校验：你必须输出至少一个action。请选择最合适的createNode / connectNodes / get_canvas_info等工具，按步骤给出动作。'
      const conversation = [...chatMessages]
      let lastResult: { reply: string; plan?: string[]; actions?: any[] } | null = null

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        this.logger.debug('AI chat request', {
          provider,
          model: payload.model,
          userId,
          contextNodes: payload.context?.nodes?.length,
          attempt: attempt + 1
        })

        // 对非官方 Anthropic 代理（如 GLM），直接走简化调用，避免 ai-sdk 解析错误
        if (this.isAnthropic(provider) && this.isCustomAnthropicBase(baseUrl)) {
          const res = await this.callAnthropicRaw({
            model: payload.model,
            apiKey,
            baseUrl,
            systemPrompt,
            messages: conversation,
            temperature: payload.temperature ?? 0.2,
          })
          if (res) {
            return {
              reply: res.reply,
              plan: res.plan || [],
              actions: res.actions || [],
            }
          }
          throw new BadRequestException('AI助手不可用：Anthropic 代理返回无效响应')
        }

        const result = await generateObject({
          model,
          system: systemPrompt,
          messages: conversation,
          schema: assistantSchema,
          temperature: payload.temperature ?? 0.2,
          headers: payload.headers,
          maxRetries: 1,
        })

        let { reply, plan, actions } = result.object
        // 如果模型未按 schema 输出 actions，尝试从 reply 中提取
        if (!actions || actions.length === 0) {
          const extracted = this.extractAssistantPayload(reply)
          if (extracted?.actions?.length) {
            reply = extracted.reply || reply
            plan = extracted.plan || plan
            actions = extracted.actions
          }
        }
        lastResult = { reply, plan, actions }

        if (actions && actions.length > 0) {
          return {
            reply,
            plan: plan || [],
            actions
          }
        }

        conversation.push({
          role: 'user',
          content: `${reminder}\n用户原始意图：${this.getLastUserMessageText(payload.messages)}`
        })
      }

      const fallbackActions = this.buildFallbackActions(payload.messages)
      return {
        reply: lastResult?.reply || '已自动为你生成基础画布操作。',
        plan: lastResult?.plan || [],
        actions: (lastResult?.actions && lastResult.actions.length > 0) ? lastResult.actions : fallbackActions
      }
    } catch (error) {
      this.logger.error('AI chat失败', error as any)
      // Anthropic自定义域（如 GLM 代理）可能返回非标准JSON，尝试兜底请求
      if (this.isAnthropic(provider) && baseUrl && this.isCustomAnthropicBase(baseUrl)) {
        try {
          const fallback = await this.callAnthropicRaw({
            model: payload.model,
            apiKey,
            baseUrl: baseUrl || undefined,
            systemPrompt,
            messages: chatMessages,
            temperature: payload.temperature ?? 0.2,
          })
          if (fallback) {
            const ensured = (fallback.actions && fallback.actions.length > 0)
              ? fallback.actions
              : (this.extractAssistantPayload(fallback.reply || '')?.actions || this.buildFallbackActions(payload.messages))
            return { reply: fallback.reply, plan: fallback.plan || [], actions: ensured }
          }
        } catch (e) {
          this.logger.error('Anthropic fallback失败', e as any)
        }
      }
      const message = error instanceof Error ? error.message : undefined
      throw new BadRequestException(message ? `AI助手不可用：${message}` : 'AI助手暂时不可用，请稍后再试')
    }
  }

  /**
   * 流式聊天（SSE），兼容 useChat
   */
  async chatStream(userId: string, payload: ChatRequestDto, res: any) {
    if (!payload.messages?.length) {
      throw new BadRequestException('消息内容不能为空')
    }

    const provider = this.resolveProvider(payload.model, payload.baseUrl, payload.provider)
    const { apiKey, baseUrl } = await this.resolveCredentials(userId, provider, payload.apiKey, payload.baseUrl)
    const modelClient = this.buildModel(provider, payload.model, apiKey, baseUrl)
    const systemPrompt = this.composeSystemPrompt(payload.context)
    const tools = this.resolveTools(payload)
    const toolChoice = this.normalizeToolChoice(payload.toolChoice, tools)

    const chatMessages = this.normalizeMessages(payload.messages)
    const preparedMessages = [
      ...(systemPrompt ? [{ role: 'system' as const, content: systemPrompt }] : []),
      ...chatMessages
    ]

    this.logger.debug('[chatStream] start', {
      userId,
      provider,
      model: payload.model,
      baseUrl: baseUrl || '(default)',
      msgCount: payload.messages?.length || 0,
      hasApiKey: !!apiKey,
    })

    try {
      const streamResult = await streamText({
        model: modelClient,
        messages: preparedMessages,
        tools,
        toolChoice,
        // maxToolRoundtrips: payload.maxToolRoundtrips ?? 4,
        temperature: payload.temperature ?? 0.2,
        maxOutputTokens: payload.maxTokens ?? 2048,
        headers: payload.headers,
        onChunk: (chunk) => {
          try {
            const summary = { type: (chunk as any)?.type, text: (chunk as any)?.text?.slice?.(0, 120), toolCalls: (chunk as any)?.toolCalls?.length }
            this.logger.debug('[chatStream] chunk', summary)
            this.emitToolCallEvents(userId, chunk as any)
          } catch (e) {
            this.logger.debug('[chatStream] chunk (unlogged)', e as any)
          }
        },
        onFinish: (info) => {
          this.logger.debug('[chatStream] finish', {
            finishReason: info.finishReason,
            textLength: info.text?.length,
            textPreview: info.text?.slice?.(0, 200),
            stepCount: info.steps?.length
          }, info)
        },
        onError: (err) => {
          this.logger.error('[chatStream] onError', err as any)
        }
      })

      streamResult.pipeUIMessageStreamToResponse(res as any)
      await streamResult.consumeStream().catch(() => {})
    } catch (error) {
      const errObj = error as any
      const status = errObj?.statusCode || errObj?.cause?.statusCode || errObj?.cause?.response?.status
      const causeValue = errObj?.cause?.value || errObj?.responseBody || errObj?.requestBodyValues
      this.logger.error('chatStream failed', { message: errObj?.message, status, cause: causeValue, url: errObj?.url })
      res.status(status || 500).json({ error: 'chatStream failed', message: errObj?.message || 'unknown error', status })
    }
  }

  subscribeToolEvents(userId: string) {
    return this.toolEvents.stream(userId)
  }

  async handleToolResult(userId: string, payload: ToolResultDto) {
    this.logger.debug('[toolResult] received', {
      userId,
      toolCallId: payload.toolCallId,
      toolName: payload.toolName,
      hasOutput: payload.output !== undefined,
      hasError: !!payload.errorText,
    })
    this.toolEvents.emit(userId, {
      type: 'tool-result',
      toolCallId: payload.toolCallId,
      toolName: payload.toolName,
      output: payload.output,
      errorText: payload.errorText,
    })
  }

  /**
   * 根据请求决定使用的工具集：
   * - 客户端执行模式（clientToolExecution=true）：仅下发 schema，由前端 useChat 执行
   * - 默认模式：使用服务端兜底占位工具，避免缺少工具定义
   * - 自定义：如果 payload.tools 提供了对象映射，则优先使用
   */
  private resolveTools(payload: ChatRequestDto) {
    const provided = this.normalizeTools(payload.tools)
    if (provided) return provided
    return payload.clientToolExecution ? canvasToolsForClient : canvasToolsWithServerFallback
  }

  private normalizeToolChoice<TTools extends Record<string, any>>(choice: ChatRequestDto['toolChoice'], tools: TTools): ToolChoice<TTools> {
    if (!choice) return 'auto'
    if (choice === 'auto' || choice === 'none' || choice === 'required') return choice
    if (choice.type === 'tool') {
      const toolName = (choice as any).toolName ?? (choice as any).name
      if (toolName && toolName in tools) {
        return { type: 'tool', toolName: toolName as any }
      }
    }
    return 'auto'
  }

  private normalizeTools(tools: ChatRequestDto['tools']) {
    if (!tools) return null
    if (typeof tools === 'object' && !Array.isArray(tools) && Object.keys(tools).length > 0) {
      return tools
    }
    return null
  }

  private isAnthropic(provider: SupportedProvider) {
    return provider === 'anthropic'
  }

  private buildFallbackActions(messages: ChatRequestDto['messages']): any[] {
    const lastUser = [...(messages || [])].reverse().find(m => m.role === 'user')
    const lastUserText = this.extractMessageText(lastUser)
    const content = lastUserText.toLowerCase()
    const wantsImage = /文生图|图片|image|photo|帅哥|照片|图像/.test(content)
    const wantsVideo = /视频|video/.test(content)
    const wantsFormat = /格式化|排版|布局|整理|format|layout/.test(content)

    if (wantsImage || wantsVideo) {
      const actions: any[] = [
        {
          type: 'createNode',
          storeResultAs: 'fallback_text',
          reasoning: '创建文本节点以接收用户描述',
          params: {
            type: 'text',
            label: '提示词',
            config: { kind: 'text', prompt: lastUserText || '请输入描述' }
          }
        },
        {
          type: 'createNode',
          storeResultAs: wantsVideo ? 'fallback_video' : 'fallback_image',
          reasoning: wantsVideo ? '创建文生视频节点' : '创建文生图节点',
          params: {
            type: wantsVideo ? 'composeVideo' : 'image',
            label: wantsVideo ? '文生视频' : '文生图',
            config: { kind: wantsVideo ? 'composeVideo' : 'image', prompt: lastUserText || '内容' }
          }
        },
        {
          type: 'connectNodes',
          reasoning: '将文本输出连接到生成节点',
          params: {
            sourceNodeId: '{{ref:fallback_text}}',
            targetNodeId: `{{ref:${wantsVideo ? 'fallback_video' : 'fallback_image'}}}`
          }
        },
        {
          type: 'runDag',
          reasoning: '自动执行生成流程，触发图像/视频生成（顺序执行）',
          params: { concurrency: 1 }
        }
      ]
      return actions
    }

    if (wantsFormat) {
      return [{
        type: 'formatAll',
        reasoning: '用户希望自动格式化布局，执行全选并布局',
        params: {}
      }]
    }

    return [{
      type: 'getNodes',
      reasoning: '无动作输出时，默认查询画布状态',
      params: {}
    }]
  }

  private isCustomAnthropicBase(baseUrl?: string | null) {
    if (!baseUrl) return false
    return !baseUrl.toLowerCase().includes('api.anthropic.com')
  }

  private resolveProvider(model: string, baseUrl?: string | null, overrideProvider?: string | null): SupportedProvider {
    const normalizedOverride = (overrideProvider || '').toLowerCase()
    if (normalizedOverride === 'anthropic') return 'anthropic'
    if (normalizedOverride === 'openai') return 'openai'
    if (normalizedOverride === 'google' || normalizedOverride === 'gemini') return 'google'

    const lower = (model || '').toLowerCase()
    if (baseUrl && baseUrl.toLowerCase().includes('anthropic')) return 'anthropic'
    if (MODEL_PROVIDER_MAP[model]) return MODEL_PROVIDER_MAP[model]
    if (lower.includes('claude') || lower.includes('glm')) return 'anthropic'
    if (lower.includes('gemini')) return 'google'
    if (lower.includes('gpt')) return 'openai'
    return 'google'
  }

  private async resolveCredentials(userId: string, provider: SupportedProvider, overrideKey?: string, overrideBaseUrl?: string | null): Promise<{ apiKey: string; baseUrl?: string | null }> {
    if (overrideKey) {
      return { apiKey: overrideKey, baseUrl: overrideBaseUrl }
    }
    const aliases = PROVIDER_VENDOR_ALIASES[provider] || [provider]
    let providerRecord = await this.prisma.modelProvider.findFirst({
      where: { ownerId: userId, vendor: { in: aliases } },
      orderBy: { createdAt: 'asc' },
    })

    let token = providerRecord
      ? await this.prisma.modelToken.findFirst({
        where: { providerId: providerRecord.id, userId, enabled: true },
        orderBy: { createdAt: 'asc' },
      })
      : null

    if (!token && providerRecord) {
      token = await this.prisma.modelToken.findFirst({
        where: { providerId: providerRecord.id, shared: true, enabled: true },
        orderBy: { createdAt: 'asc' },
      })
    }

    if (!token) {
      const sharedToken = await this.findSharedTokenForVendor(aliases)
      if (sharedToken) {
        token = sharedToken
        providerRecord = sharedToken.provider
      }
    }

    if (!providerRecord) {
      throw new BadRequestException(`未配置${provider} Provider，请在模型面板中新增 vendor 为 ${aliases.join('/')} 的配置`) 
    }

    if (!token) {
      throw new BadRequestException(`未找到可用的${provider} API Key，请在模型面板中添加`) 
    }

    const resolvedBaseUrl = providerRecord.baseUrl || (await this.resolveSharedBaseUrl(provider))

    this.logger.debug('Resolved provider credentials', {
      userId,
      providerVendor: providerRecord.vendor,
      providerId: providerRecord.id,
      baseUrl: resolvedBaseUrl,
      hasSharedToken: !!token.shared,
    })

    return { apiKey: token.secretToken, baseUrl: overrideBaseUrl ?? resolvedBaseUrl }
  }

  private normalizeModelName(provider: SupportedProvider, model: string) {
    if (!model) return model
    switch (provider) {
      case 'google':
        return model.startsWith('models/') ? model : `models/${model}`
      default:
        return model
    }
  }

  private buildModel(provider: SupportedProvider, model: string, apiKey: string, baseUrl?: string | null) {
    const normalizedModel = this.normalizeModelName(provider, model)
    const normalizedBaseUrl = this.normalizeBaseUrl(provider, baseUrl)
    const extraHeaders =
      provider === 'anthropic'
        ? {
            Authorization: `Bearer ${apiKey}`,
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01'
          }
        : undefined

    const options = normalizedBaseUrl
      ? { apiKey, baseURL: normalizedBaseUrl, ...(extraHeaders ? { headers: extraHeaders } : {}) }
      : { apiKey, ...(extraHeaders ? { headers: extraHeaders } : {}) }
    switch (provider) {
      case 'openai': {
        const client = createOpenAI(options)
        return client(normalizedModel)
      }
      case 'anthropic': {
        this.logger.debug(JSON.stringify(options),'options')
        const client = createAnthropic(options)
        return client(normalizedModel)
      }
      case 'google':
      default: {
        const client = createGoogleGenerativeAI(options)
        return client(normalizedModel)
      }
    }
  }

  private normalizeBaseUrl(provider: SupportedProvider, baseUrl?: string | null): string | undefined {
    const trimmed = baseUrl?.trim()
    if (!trimmed || trimmed.length === 0) {
      if (provider === 'google') {
        return 'https://generativelanguage.googleapis.com/v1beta'
      }
      return undefined
    }

    let normalized = trimmed.replace(/\/+$/, '')

    if (provider === 'anthropic') {
      const hasVersion = /\/v\d+($|\/)/i.test(normalized)
      if (!hasVersion) normalized = `${normalized}/v1`
    }

    if (provider === 'google') {
      normalized = normalized.replace(/\/v1beta$/i, '').replace(/\/v1$/i, '')
      normalized = `${normalized}/v1beta`
    }

    return normalized
  }

  private async callAnthropicRaw(params: {
    model: string
    apiKey: string
    baseUrl?: string | null
    systemPrompt: string
    messages: CoreMessage[]
    temperature: number
  }): Promise<{ reply: string; plan?: string[]; actions?: any[] } | null> {
    const url = this.buildAnthropicUrl(params.baseUrl || undefined)
    const system = params.systemPrompt
    const messages = params.messages.map((m) => {
      // Anthropic 代理仅支持 user/assistant，将 system 归并为 user
      const role = m.role === 'assistant' ? 'assistant' : 'user'
      const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
      return {
        role,
        content: [{ type: 'text', text }],
      }
    })
    const body = {
      model: params.model,
      system,
      messages,
      max_tokens: 4096,
      temperature: params.temperature,
    }

    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.apiKey}`,
        'x-api-key': params.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    })

    const text = await resp.text()
    if (!resp.ok) {
      this.logger.error('Anthropic fallback error', { status: resp.status, body: text })
      return null
    }

    try {
      const json = JSON.parse(text)
      if (Array.isArray(json?.content)) {
        const combined = json.content
          .filter((c: any) => c?.type === 'text' && typeof c.text === 'string')
          .map((c: any) => c.text)
          .join('\n')
        const parsed = this.extractAssistantPayload(combined) || this.safeParseJson(combined)
        if (parsed) return parsed
        return { reply: combined || '' }
      }
      const parsed = this.extractAssistantPayload(json) || this.safeParseJson(json)
      if (parsed) return parsed
      return { reply: typeof json === 'string' ? json : JSON.stringify(json) }
    } catch {
      const parsed = this.extractAssistantPayload(text) || this.safeParseJson(text)
      if (parsed) return parsed
      return { reply: text || '' }
    }
  }

  private buildAnthropicUrl(baseUrl?: string | null) {
    const base = (baseUrl || 'https://api.anthropic.com').replace(/\/+$/, '')
    if (/\/v\d+\/messages$/i.test(base)) return base
    return `${base}${/\/v\d+$/i.test(base) ? '' : '/v1'}/messages`
  }

  private safeParseJson(input: any): { reply: string; plan?: string[]; actions?: any[] } | null {
    try {
      const obj = typeof input === 'string' ? JSON.parse(input) : input
      if (obj && typeof obj === 'object' && typeof obj.reply === 'string') {
        return { reply: obj.reply, plan: Array.isArray(obj.plan) ? obj.plan : [], actions: Array.isArray(obj.actions) ? obj.actions : [] }
      }
    } catch {
      return null
    }
    return null
  }

  private extractAssistantPayload(input: any): { reply: string; plan?: string[]; actions?: any[] } | null {
    const text = typeof input === 'string' ? input.trim() : ''
    if (text) {
      // 优先查找 ```json fenced block
      const fence = text.match(/```json\s*([\s\S]*?)\s*```/i)
      const candidate = fence ? fence[1] : text
      const parsed = this.safeParseJson(candidate)
      if (parsed) return parsed
    }

    // 如果已经是对象，尝试直接解析
    if (input && typeof input === 'object') {
      const parsed = this.safeParseJson(input)
      if (parsed) return parsed
    }

    return null
  }

  private composeSystemPrompt(context?: CanvasContextDto): string {
    if (!context) {
      return SYSTEM_PROMPT
    }

    const pieces: string[] = [SYSTEM_PROMPT]
    const summary = context.summary ? JSON.stringify(context.summary) : ''

    if (summary) {
      pieces.push(`当前画布概要：${summary}`)
    }

    if (context.nodes?.length) {
      const preview = context.nodes.slice(0, 8).map((node, index) => {
        const label = node.label || node.data?.label || node.id
        const kind = node.kind || node.data?.kind
        return `${index + 1}. ${label} (${kind || node.type || 'unknown'})`
      })
      pieces.push(`节点示例：\n${preview.join('\n')}`)
    }

    if (context.edges?.length) {
      const preview = context.edges.slice(0, 6).map(edge => `${edge.source} -> ${edge.target}`)
      pieces.push(`连接示例：${preview.join(', ')}`)
    }

    return pieces.join('\n\n')
  }

  private normalizeMessages(messages: ChatRequestDto['messages']): CoreMessage[] {
    if (!messages?.length) return []
    const uiMessages = messages.map(message => this.mapToUiMessage(message))
    return convertToCoreMessages(uiMessages as any)
  }

  private emitToolCallEvents(userId: string, chunk: any) {
    if (!chunk?.toolCalls?.length) return
    chunk.toolCalls
      .filter((call: any) => !call?.providerExecuted)
      .forEach((call: any) => {
        if (!call.toolCallId || !call.toolName) return
        this.toolEvents.emit(userId, {
          type: 'tool-call',
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          input: call.args || call.input || {},
          providerExecuted: !!call.providerExecuted,
        })
      })
  }

  private mapToUiMessage(message: ChatMessageDto) {
    const hasParts = Array.isArray((message as any)?.parts) && (message as any).parts.length > 0
    const fallbackText = typeof message.content === 'string' ? message.content : ''
    const parts = hasParts ? (message.parts as any[]) : [{ type: 'text', text: fallbackText }]
    const metadata = (message as any)?.metadata
    return {
      role: (message.role || 'user') as 'system' | 'user' | 'assistant',
      parts,
      ...(metadata ? { metadata } : {})
    }
  }

  private extractMessageText(message?: ChatMessageDto | null): string {
    if (!message) return ''
    if (typeof message.content === 'string' && message.content.length > 0) {
      return message.content
    }
    if (Array.isArray((message as any)?.parts)) {
      return (message.parts as any[])
        .map((part: any) => {
          if (part?.type === 'text' || part?.type === 'reasoning') {
            return part.text || ''
          }
          if (part?.type === 'tool-result') {
            if (typeof part.output === 'string') return part.output
            try {
              return JSON.stringify(part.output)
            } catch {
              return ''
            }
          }
          return ''
        })
        .filter(Boolean)
        .join('\n')
    }
    return ''
  }

  private getLastUserMessageText(messages?: ChatRequestDto['messages']): string {
    if (!messages || messages.length === 0) return ''
    const lastUser = [...messages].reverse().find(msg => msg.role === 'user')
    return this.extractMessageText(lastUser || messages[messages.length - 1])
  }

  private async findSharedTokenForVendor(aliases: string[]): Promise<(ModelToken & { provider: ModelProvider }) | null> {
    const now = new Date()
    return this.prisma.modelToken.findFirst({
      where: {
        shared: true,
        enabled: true,
        provider: { vendor: { in: aliases } },
        OR: [
          { sharedDisabledUntil: null },
          { sharedDisabledUntil: { lt: now } },
        ],
      },
      include: { provider: true },
      orderBy: { updatedAt: 'asc' },
    })
  }

  private async resolveSharedBaseUrl(provider: SupportedProvider): Promise<string | null> {
    const aliases = PROVIDER_VENDOR_ALIASES[provider] || [provider]
    const shared = await this.prisma.modelProvider.findFirst({
      where: {
        vendor: { in: aliases },
        sharedBaseUrl: true,
        baseUrl: { not: null },
      },
      orderBy: { updatedAt: 'desc' },
    })
    return shared?.baseUrl ?? null
  }
}
