import { BadRequestException, Injectable, Logger } from '@nestjs/common'
import { PrismaService } from 'nestjs-prisma'
import { convertToCoreMessages, generateObject, generateText, streamText, tool, type CoreMessage, type ToolChoice } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { z } from 'zod'
import { ACTION_TYPES, SYSTEM_PROMPT, MODEL_PROVIDER_MAP, PROVIDER_VENDOR_ALIASES, type SupportedProvider } from './constants'
import { VIDEO_REALISM_RULES } from './video-realism'
import { PROMPT_SAMPLES, formatPromptSample, matchPromptSamples, type PromptSample } from './prompt-samples'
import { splitNarrativeSections } from './utils/narrative'
import type { ChatRequestDto, ChatResponseDto, CanvasContextDto, ChatMessageDto, ToolResultDto } from './dto/chat.dto'
import type { PromptSamplePayloadDto, PromptSampleParseRequestDto, PromptSampleResponseDto, PromptSampleNodeKind } from './dto/prompt-sample.dto'
import { ToolEventsService } from './tool-events.service'
import type { ModelProvider, ModelToken, PromptSample as PrismaPromptSample } from '@prisma/client'
import { ProxyService } from '../proxy/proxy.service'

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
    description: '创建节点（type/label/config 由模型决定；分镜节点必须使用 type=storyboard；实际创建在前端完成），跟图片有关的节点就是image,视频就是video节点，提示词直接传入 prompt 就行，支持文生图，文生视频；当传入 remixFromNodeId 时，必须指向一个已成功的 composeVideo/video/storyboard 节点',
    inputSchema: z.object({
      type: z.string(),
      label: z.string().optional(),
      config: z.record(z.any()).optional(),
      remixFromNodeId: z.string().optional(),
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
  runNode: {
    description: '执行指定的单个节点，仅触发用户需要的动作，避免整图跑满',
    inputSchema: z.object({
      nodeId: z.string()
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

const CREATIVE_NODE_TYPES = new Set(['image', 'texttoimage', 'composevideo', 'video', 'storyboard', 'animation'])
const PROMPT_ENHANCEMENT_PLAN_HINT = '润色提示词，扩展镜头语言、光影与情绪细节'
const DEFAULT_NEGATIVE_PROMPT =
  'low quality, blurry, lowres, distorted faces, watermark, duplicate, overexposed, underexposed, noisy, bad composition, text overlay'

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly toolEvents: ToolEventsService,
    private readonly proxyService: ProxyService,
  ) {}

  async chat(userId: string, payload: ChatRequestDto): Promise<ChatResponseDto> {
    if (!payload.messages?.length) {
      throw new BadRequestException('消息内容不能为空')
    }

    const provider = this.resolveProvider(payload.model, payload.baseUrl, payload.provider)
    const { apiKey, baseUrl } = await this.resolveCredentials(userId, provider, payload.apiKey, payload.baseUrl)
    const model = this.buildModel(provider, payload.model, apiKey, baseUrl)

    const lastUserText = this.getLastUserMessageText(payload.messages)
    const systemPrompt = this.composeSystemPrompt(payload.context, lastUserText)
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
            const finalized = this.finalizeAssistantResponse(
              res.reply,
              res.plan,
              res.actions,
              { userInput: lastUserText, canvasContext: payload.context }
            )
            await this.appendChatHistory(userId, provider, payload, lastUserText, finalized.reply)
            return finalized
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
        const finalized = this.finalizeAssistantResponse(
          reply,
          plan,
          actions,
          { userInput: lastUserText, canvasContext: payload.context }
        )
        reply = finalized.reply
        plan = finalized.plan
        actions = finalized.actions
        lastResult = finalized

        if (actions && actions.length > 0) {
          await this.appendChatHistory(userId, provider, payload, lastUserText, finalized.reply)
          return finalized
        }

        conversation.push({
          role: 'user',
          content: `${reminder}\n用户原始意图：${lastUserText}`
        })
      }

      const fallbackActions = this.buildFallbackActions(payload.messages)
      const fallbackResult = this.finalizeAssistantResponse(
        lastResult?.reply || '已自动为你生成基础画布操作。',
        lastResult?.plan,
        (lastResult?.actions && lastResult.actions.length > 0) ? lastResult.actions : fallbackActions,
        { userInput: lastUserText, canvasContext: payload.context }
      )
      if (!fallbackResult.actions.length) {
        fallbackResult.actions = fallbackActions
      }
      await this.appendChatHistory(userId, provider, payload, lastUserText, fallbackResult.reply)
      return fallbackResult
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
            const finalized = this.finalizeAssistantResponse(
              fallback.reply,
              fallback.plan,
              ensured,
              { userInput: lastUserText, canvasContext: payload.context }
            )
            return finalized
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
    const lastUserText = this.getLastUserMessageText(payload.messages)
    const systemPrompt = this.composeSystemPrompt(payload.context, lastUserText)
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
      tools,
      baseUrl: baseUrl || '(default)',
      msgCount: payload.messages?.length || 0,
      hasApiKey: !!apiKey,
    })

    try {
      let finalText = ''
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
          finalText = info.text || ''
        },
        onError: (err) => {
          this.logger.error('[chatStream] onError', err as any)
        }
      })

      streamResult.pipeUIMessageStreamToResponse(res as any)
      await streamResult.consumeStream().catch(() => {})
      await this.appendChatHistory(userId, provider, payload, lastUserText, finalText)
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

  async listPromptSamples(userId: string, query?: string, nodeKind?: string, source?: string) {
    const normalizedKind = this.normalizePromptSampleKind(nodeKind)
    const normalizedQuery = (query || '').trim()
    const normalizedSource = this.normalizePromptSampleSource(source)
    const limit = 12

    const includeOfficial = normalizedSource !== 'custom'
    const includeCustom = normalizedSource !== 'official'

    const officialPool = includeOfficial
      ? (normalizedKind ? PROMPT_SAMPLES.filter((s) => s.nodeKind === normalizedKind) : PROMPT_SAMPLES)
      : []

    const customRecords = includeCustom
      ? await this.prisma.promptSample.findMany({
          where: {
            userId,
            ...(normalizedKind ? { nodeKind: normalizedKind } : {}),
          },
          orderBy: { updatedAt: 'desc' },
          take: normalizedQuery ? 50 : limit * 2,
        })
      : []

    const customSamples = customRecords.map((record) => this.mapCustomPromptSample(record))
    const officialSamples = officialPool.map((sample) => this.mapOfficialPromptSample(sample))

    let filteredCustom = customSamples
    if (normalizedQuery) {
      filteredCustom = this.filterCustomPromptSamples(customSamples, normalizedQuery)
    }

    let filteredOfficial = officialSamples
    if (normalizedQuery) {
      const matched = matchPromptSamples(normalizedQuery, limit * 2)
      const filteredMatched = normalizedKind ? matched.filter((s) => s.nodeKind === normalizedKind) : matched
      filteredOfficial = filteredMatched.map((sample) => this.mapOfficialPromptSample(sample))
    }

    const combined: PromptSampleResponseDto[] = []
    if (includeCustom) {
      combined.push(...filteredCustom)
    }
    if (combined.length < limit && includeOfficial) {
      combined.push(...filteredOfficial)
    }

    if (!normalizedQuery && includeOfficial && combined.length < limit) {
      combined.push(
        ...officialSamples.filter((sample) => !filteredOfficial.some((match) => match.id === sample.id)),
      )
    }

    return { samples: combined.slice(0, limit) }
  }

  async parsePromptSample(userId: string, payload: PromptSampleParseRequestDto) {
    const rawPrompt = (payload.rawPrompt || '').trim()
    if (!rawPrompt) {
      throw new BadRequestException('rawPrompt 不能为空')
    }
    const nodeKind = this.normalizePromptSampleKind(payload.nodeKind) || 'composeVideo'
    const modelName = payload.model || 'gpt-5.1'
    const provider = this.resolveProvider(modelName, payload.baseUrl, payload.provider)
    const { apiKey, baseUrl } = await this.resolveCredentials(userId, provider, undefined, payload.baseUrl)
    const model = this.buildModel(provider, modelName, apiKey, baseUrl)

    const schema = z.object({
      scene: z.string().min(2).max(60),
      commandType: z.string().min(2).max(60),
      title: z.string().min(2).max(80),
      prompt: z.string().min(40),
      description: z.string().max(200).optional().default(''),
      inputHint: z.string().max(160).optional().default(''),
      outputNote: z.string().max(160).optional().default(''),
      keywords: z.array(z.string()).min(3).max(12).default([]),
    })

    let objectResult: any = null
    let lastError: any = null

    try {
      objectResult = await generateObject({
        model,
        system: this.composePromptSampleParserSystem(),
        messages: [
          {
            role: 'user',
            content: this.composePromptSampleParserUserMessage(rawPrompt, nodeKind),
          },
        ],
        schema,
        temperature: 0.2,
        maxRetries: 1,
      })
    } catch (error: any) {
      lastError = error
      if (!this.isInvalidJsonResponseError(error)) throw error
      this.logger.warn('[PromptSampleParse] JSON schema 调用失败，尝试按文本解析', {
        provider,
        model: modelName,
        message: error?.message,
      })
    }

    if (objectResult?.object) {
      return this.normalizeParsedPromptSample(objectResult.object, nodeKind)
    }

    try {
      const fallback = await this.parsePromptSampleWithTextFallback({
        model,
        rawPrompt,
        nodeKind,
      })
      return this.normalizeParsedPromptSample(fallback, nodeKind)
    } catch (error: any) {
      this.logger.error('[PromptSampleParse] 文本解析仍然失败', {
        provider,
        model: modelName,
        message: error?.message,
        originalError: lastError?.message,
      })
      throw error
    }
  }

  async createPromptSample(userId: string, payload: PromptSamplePayloadDto) {
    const data = this.normalizePromptSamplePayload(payload)
    const saved = await this.prisma.promptSample.create({
      data: {
        ...data,
        userId,
      },
    })
    return this.mapCustomPromptSample(saved)
  }

  async updatePromptSample(userId: string, id: string, payload: PromptSamplePayloadDto) {
    const data = this.normalizePromptSamplePayload(payload)
    const existing = await this.prisma.promptSample.findFirst({ where: { id, userId } })
    if (!existing) {
      throw new BadRequestException('未找到该案例或无权编辑')
    }
    const saved = await this.prisma.promptSample.update({ where: { id }, data })
    return this.mapCustomPromptSample(saved)
  }

  async deletePromptSample(userId: string, id: string) {
    const existing = await this.prisma.promptSample.findFirst({ where: { id, userId } })
    if (!existing) {
      throw new BadRequestException('未找到该案例或无权删除')
    }
    await this.prisma.promptSample.delete({ where: { id } })
    return { success: true }
  }

  /**
   * 将当前对话轮次落库到 ChatSession / ChatMessage
   */
  private async appendChatHistory(
    userId: string,
    provider: string,
    payload: ChatRequestDto,
    lastUserText: string,
    assistantText?: string | null,
  ) {
    try {
      const sessionId = payload.sessionId?.trim()
      if (!sessionId) return

      const title = this.buildSessionTitle(lastUserText)

      const session = await this.prisma.chatSession.upsert({
        where: {
          userId_sessionId: {
            userId,
            sessionId,
          },
        },
        create: {
          userId,
          sessionId,
          title,
          model: payload.model,
          provider,
        },
        update: {
          title,
          model: payload.model,
          provider,
        },
      })

      const messages: { sessionId: string; role: string; content?: string | null; raw?: any }[] = []
      const trimmedUser = (lastUserText || '').trim()
      if (trimmedUser) {
        messages.push({
          sessionId: session.id,
          role: 'user',
          content: trimmedUser,
        })
      }
      const trimmedAssistant = (assistantText || '').trim()
      if (trimmedAssistant) {
        messages.push({
          sessionId: session.id,
          role: 'assistant',
          content: trimmedAssistant,
        })
      }
      if (messages.length) {
        await this.prisma.chatMessage.createMany({
          data: messages,
        })
      }
    } catch (error) {
      this.logger.error('[appendChatHistory] failed', error as any)
    }
  }

  private buildSessionTitle(userText: string): string {
    const trimmed = (userText || '').trim()
    if (!trimmed) return '未命名会话'
    return trimmed.length > 24 ? `${trimmed.slice(0, 24)}…` : trimmed
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

  private normalizePromptSampleKind(kind?: string | null): PromptSample['nodeKind'] | undefined {
    if (!kind) return undefined
    switch (kind) {
      case 'image':
        return 'image'
      case 'composeVideo':
      case 'video':
        return 'composeVideo'
      case 'storyboard':
        return 'storyboard'
      default:
        return undefined
    }
  }

  private normalizePromptSampleSource(source?: string | null): 'official' | 'custom' | 'all' {
    if (!source) return 'all'
    const lower = source.toLowerCase()
    if (lower === 'official') return 'official'
    if (lower === 'custom') return 'custom'
    return 'all'
  }

  private mapOfficialPromptSample(sample: PromptSample): PromptSampleResponseDto {
    return {
      ...sample,
      source: 'official',
    }
  }

  private mapCustomPromptSample(record: PrismaPromptSample): PromptSampleResponseDto {
    return {
      id: record.id,
      scene: record.scene,
      commandType: record.commandType,
      title: record.title,
      nodeKind: (this.normalizePromptSampleKind(record.nodeKind) ?? 'image'),
      prompt: record.prompt,
      description: record.description || undefined,
      inputHint: record.inputHint || undefined,
      outputNote: record.outputNote || undefined,
      keywords: record.keywords || [],
      source: 'custom',
    }
  }

  private filterCustomPromptSamples(samples: PromptSampleResponseDto[], query: string) {
    const haystack = query.toLowerCase()
    const scored = samples
      .map((sample) => ({ sample, score: this.computeCustomPromptSampleScore(sample, haystack) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((item) => item.sample)
    return scored.length ? scored : samples
  }

  private computeCustomPromptSampleScore(sample: PromptSampleResponseDto, query: string) {
    let score = 0
    const collect = [
      sample.title,
      sample.scene,
      sample.commandType,
      sample.prompt,
      sample.description,
      sample.inputHint,
      sample.outputNote,
    ]
    collect.forEach((field) => {
      if (field && field.toLowerCase().includes(query)) {
        score += field === sample.prompt ? 3 : 2
      }
    })
    sample.keywords?.forEach((keyword) => {
      if (keyword.toLowerCase().includes(query)) {
        score += 2
      }
    })
    return score
  }

  private normalizePromptSamplePayload(payload: PromptSamplePayloadDto) {
    const nodeKind = this.normalizePromptSampleKind(payload.nodeKind)
    if (!nodeKind) {
      throw new BadRequestException('nodeKind 必须是 image/composeVideo/storyboard')
    }
    const title = (payload.title || '').trim()
    const scene = (payload.scene || '').trim()
    const commandType = (payload.commandType || '').trim()
    const prompt = (payload.prompt || '').trim()
    if (!title || !scene || !commandType || !prompt) {
      throw new BadRequestException('标题、场景、指令类型与提示词不能为空')
    }
    const keywords = (payload.keywords || []).map((keyword) => keyword.trim()).filter(Boolean)
    return {
      nodeKind,
      title,
      scene,
      commandType,
      prompt,
      description: payload.description?.trim() || null,
      inputHint: payload.inputHint?.trim() || null,
      outputNote: payload.outputNote?.trim() || null,
      keywords,
    }
  }

  private composePromptSampleParserSystem() {
    return [
      'You are a prompt library curator. Read the raw description and extract clean metadata for the prompt collection.',
      'Return concise Chinese text for scene/commandType/title/description fields. Keep prompt field in its original language.',
      'Keywords should be 3~8 short tags without punctuation.',
    ].join('\n')
  }

  private composePromptSampleParserUserMessage(rawPrompt: string, nodeKind: PromptSampleNodeKind) {
    return [
      `目标节点类型: ${nodeKind}`,
      '请将下面的提示词拆解成结构化字段（scene、commandType、title、prompt、description、inputHint、outputNote、keywords）。',
      '原始提示词：',
      rawPrompt,
    ].join('\n\n')
  }

  private normalizeParsedPromptSample(payload: any, nodeKind: PromptSampleNodeKind): PromptSamplePayloadDto {
    const keywords = Array.isArray(payload?.keywords)
      ? payload.keywords.map((keyword: string) => (keyword || '').trim()).filter(Boolean)
      : []
    return {
      scene: (payload?.scene || '').trim(),
      commandType: (payload?.commandType || '').trim(),
      title: (payload?.title || '').trim(),
      nodeKind,
      prompt: (payload?.prompt || '').trim(),
      description: payload?.description?.trim() || undefined,
      inputHint: payload?.inputHint?.trim() || undefined,
      outputNote: payload?.outputNote?.trim() || undefined,
      keywords,
    }
  }

  private isInvalidJsonResponseError(error: any) {
    if (!error) return false
    const message = error?.message || error?.toString?.() || ''
    return message.includes('Invalid JSON response')
  }

  private async parsePromptSampleWithTextFallback(params: {
    model: ReturnType<AiService['buildModel']>
    rawPrompt: string
    nodeKind: PromptSampleNodeKind
  }) {
    this.logger.warn('[PromptSampleParse] JSON schema失败，自动降级为文本解析', {
      provider: params.model.provider,
    })
    const prompt = this.composePromptSampleTextFallbackPrompt(params.rawPrompt, params.nodeKind)
    const text = await this.generatePromptSampleTextResponse({
      model: params.model,
      systemPrompt: prompt.systemPrompt,
      userMessage: prompt.userMessage,
    })
    const parsed = this.extractJsonFromText(text)
    if (!parsed) {
      throw new BadRequestException('AI 返回的结果无法解析，请检查模型设置或稍后再试')
    }
    return parsed
  }

  private composePromptSampleTextFallbackPrompt(rawPrompt: string, nodeKind: PromptSampleNodeKind) {
    const systemPrompt = [
      this.composePromptSampleParserSystem(),
      '如果无法遵循 JSON schema，请仍以 JSON 字符串形式返回，禁止额外说明或前缀。',
    ].join('\n')
    const userMessage = [
      this.composePromptSampleParserUserMessage(rawPrompt, nodeKind),
      '',
      '输出格式：严格的 JSON 对象，包含 scene、commandType、title、prompt、description、inputHint、outputNote、keywords（字符串数组）。',
    ].join('\n')
    return { systemPrompt, userMessage }
  }

  private async generatePromptSampleTextResponse(params: {
    model: ReturnType<AiService['buildModel']>
    systemPrompt: string
    userMessage: string
  }) {
    try {
      const response = await generateText({
        model: params.model,
        system: params.systemPrompt,
        messages: [
          {
            role: 'user',
            content: params.userMessage,
          },
        ],
        temperature: 0.2,
        maxRetries: 1,
      })
      return response.text || ''
    } catch (error: any) {
      if (!this.isInvalidJsonResponseError(error)) throw error
      this.logger.warn('[PromptSampleParse] 文本解析 JSON 响应无效，尝试流式解析', {
        provider: params.model.provider,
        message: error?.message,
      })
      return this.generatePromptSampleTextViaStreaming(params)
    }
  }

  private async generatePromptSampleTextViaStreaming(params: {
    model: ReturnType<AiService['buildModel']>
    systemPrompt: string
    userMessage: string
  }) {
    const streamResult = await streamText({
      model: params.model,
      system: params.systemPrompt,
      messages: [
        {
          role: 'user',
          content: params.userMessage,
        },
      ],
      temperature: 0.2,
      maxRetries: 1,
    })
    const chunks: string[] = []
    for await (const delta of streamResult.textStream) {
      if (typeof delta === 'string' && delta.length) {
        chunks.push(delta)
      }
    }
    return chunks.join('')
  }

  private extractJsonFromText(text: string): any | null {
    const trimmed = text.trim()
    if (!trimmed) return null
    const fence = trimmed.match(/```(?:json)?\s*([\s\S]+?)```/i)
    const candidate = fence ? fence[1] : trimmed
    try {
      return JSON.parse(candidate)
    } catch {
      try {
        const start = candidate.indexOf('{')
        const end = candidate.lastIndexOf('}')
        if (start >= 0 && end > start) {
          return JSON.parse(candidate.slice(start, end + 1))
        }
      } catch {
        return null
      }
      return null
    }
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
          type: 'runNode',
          reasoning: '精准执行刚创建的生成节点，避免跑整个工作流',
          params: {
            nodeId: `{{ref:${wantsVideo ? 'fallback_video' : 'fallback_image'}}}`
          }
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

  private finalizeAssistantResponse(
    reply: string,
    plan: string[] | undefined,
    actions: any[] | undefined,
    options: { userInput?: string; canvasContext?: CanvasContextDto | null }
  ): { reply: string; plan: string[]; actions: any[] } {
    const enhancement = this.enhanceCreativeActions(actions, options)
    let finalPlan = Array.isArray(plan) ? [...plan] : []
    if (enhancement.addedPlanStep) {
      const planStep = this.buildPromptEnhancementPlanStep(options.userInput)
      const alreadyHasStep = finalPlan.some(step => step.includes('提示词') || step.includes('润色'))
      if (!alreadyHasStep) {
        finalPlan = [planStep, ...finalPlan]
      }
    }
    return {
      reply,
      plan: finalPlan,
      actions: enhancement.actions
    }
  }

  private enhanceCreativeActions(
    actions: any[] | undefined,
    options: { userInput?: string; canvasContext?: CanvasContextDto | null }
  ): { actions: any[]; addedPlanStep: boolean } {
    if (!Array.isArray(actions) || actions.length === 0) {
      return { actions: Array.isArray(actions) ? actions : [], addedPlanStep: false }
    }

    let applied = false
    const enriched = actions.map(action => {
      if (!action || action.type !== 'createNode') {
        return action
      }
      if (action.meta?.promptEnhanced) {
        return action
      }
      const nodeType: string | undefined = action.params?.type || action.params?.payload?.type || action.params?.config?.type
      if (!this.isCreativeNodeType(nodeType)) {
        return action
      }

      const basePrompt = this.getBasePromptFromAction(action, options.userInput)
      const enrichedPrompt = this.buildEnhancedPrompt(basePrompt, nodeType || '')
      if (!enrichedPrompt) {
        return action
      }

      const params = { ...(action.params || {}) }
      const config = { ...(params.config || {}) }
      config.prompt = enrichedPrompt.prompt
      if (!config.negativePrompt) {
        config.negativePrompt = enrichedPrompt.negativePrompt
      }
      if (!config.keywords && enrichedPrompt.keywords.length > 0) {
        config.keywords = enrichedPrompt.keywords
      }
      params.config = config

      applied = true
      return {
        ...action,
        params,
        meta: {
          ...(action.meta || {}),
          promptEnhanced: true,
          promptSeed: enrichedPrompt.brief
        },
        reasoning: action.reasoning
          ? `${action.reasoning}（提示词已润色，补充镜头语言与细节）`
          : '提示词已润色，补充镜头语言、光影与细节'
      }
    })

    return { actions: enriched, addedPlanStep: applied }
  }

  private buildPromptEnhancementPlanStep(userInput?: string) {
    if (userInput && userInput.trim()) {
      const brief = userInput.trim().slice(0, 24)
      return `润色提示词：围绕“${brief}”补全镜头语言、光影与情绪`
    }
    return PROMPT_ENHANCEMENT_PLAN_HINT
  }

  private isCreativeNodeType(nodeType?: string | null) {
    if (!nodeType) return false
    return CREATIVE_NODE_TYPES.has(nodeType.toLowerCase())
  }

  private isVideoNodeType(nodeType: string) {
    const normalized = nodeType.toLowerCase()
    return normalized.includes('compose') || normalized.includes('video')
  }

  private getBasePromptFromAction(action: any, fallback?: string) {
    const params = action?.params ?? {}
    const config = params.config ?? {}
    const candidates = [
      action?.meta?.promptSeed,
      config.prompt,
      params.prompt,
      params.label,
      config.label,
      fallback,
    ]
    const seed = candidates.find(value => typeof value === 'string' && value.trim())
    return this.normalizePromptSeed(seed as string | undefined)
  }

  private buildEnhancedPrompt(seed: string | undefined, nodeType: string) {
    const subject = this.normalizePromptSeed(seed) || 'an imaginative concept'
    const isVideo = this.isVideoNodeType(nodeType)

    if (isVideo) {
      const prompt = [
        `Cinematic short film shot about ${subject}`,
        'Show a complete beat with character motivation, environment scale, and evolving emotion',
        'Camera language: dynamic tracking shot mixed with low-angle close-ups, smooth gimbal motion, subtle handheld energy',
        'Lighting: volumetric shafts, moody rim lights, neon practicals wrapping the subject',
        'Mood & texture: high-contrast film grain, rich color separation, Dolby Vision grade, dramatic depth of field'
      ].join('. ')
      return {
        prompt,
        brief: subject,
        negativePrompt: DEFAULT_NEGATIVE_PROMPT,
        keywords: ['cinematic', 'story-driven', 'dynamic lighting', '4k', 'film grain']
      }
    }

    const prompt = [
      `Ultra detailed illustration of ${subject}`,
      'Rich material textures, layered foreground/midground/background storytelling',
      'Lighting: cinematic rim lights, volumetric glow, dramatic contrast',
      'Shot on 50mm prime, shallow depth of field, hyperreal focus',
      'Post-processing: 8K render, HDR toning, clean composition'
    ].join('. ')

    return {
      prompt,
      brief: subject,
      negativePrompt: DEFAULT_NEGATIVE_PROMPT,
      keywords: ['ultra detailed', '8k', 'dramatic lighting', 'photoreal', 'volumetric glow']
    }
  }

  private normalizePromptSeed(value?: string) {
    if (!value) return ''
    return value.replace(/\s+/g, ' ').trim()
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

  private async resolveCredentials(
    userId: string,
    provider: SupportedProvider,
    overrideKey?: string,
    overrideBaseUrl?: string | null,
  ): Promise<{ apiKey: string; baseUrl?: string | null }> {
    if (overrideKey) {
      return { apiKey: overrideKey, baseUrl: overrideBaseUrl }
    }
    const aliases = PROVIDER_VENDOR_ALIASES[provider] || [provider]

    for (const alias of aliases) {
      const proxy = await this.proxyService.findProxyConfig(userId, alias, 'grsai')
      if (proxy) {
        this.logger.debug('Resolved provider credentials via proxy', {
          userId,
          providerVendor: alias,
          proxyVendor: proxy.vendor,
          proxyBaseUrl: proxy.baseUrl,
        })
        return { apiKey: proxy.apiKey, baseUrl: overrideBaseUrl ?? proxy.baseUrl }
      }
    }

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

    if (provider === 'anthropic' || provider === 'openai') {
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

  private composeSystemPrompt(context?: CanvasContextDto, latestUserText?: string): string {
    const pieces: string[] = [SYSTEM_PROMPT]

    if (context) {
      const summary = context.summary ? JSON.stringify(context.summary) : ''

      if (summary) {
        pieces.push(`当前画布概要：${summary}`)
      }
      pieces.push('⚠️你已经获得上面的画布概要/节点列表，它们视为真实可见的画布状态；不要再声称自己无法看到画布或无法访问屏幕。')

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

      if (context.characters?.length) {
        const preview = context.characters.slice(0, 6).map((character, index) => {
          const name = character.label || character.username || character.nodeId
          const username = character.username ? ` (@${character.username})` : ''
          const desc = character.description ? ` - ${character.description}` : ''
          return `${index + 1}. ${name}${username}${desc}`
        })
        pieces.push(`角色资料：\n${preview.join('\n')}`)
      }

      if (context.videoBindings?.length) {
        const preview = context.videoBindings.slice(0, 4).map((binding, index) => {
          const chars = binding.characters?.map(char => char.label || char.username || char.nodeId).join(', ') || '无角色引用'
          const promptSnippet = binding.promptPreview ? ` | prompt: ${binding.promptPreview}` : ''
          const remix = binding.remixSourceLabel ? ` | remix自: ${binding.remixSourceLabel}` : ''
          return `${index + 1}. ${binding.label || binding.nodeId} -> 角色: ${chars}${remix}${promptSnippet}`
        })
        pieces.push(`镜头延续上下文：\n${preview.join('\n')}`)
      }

      if (!context.videoBindings?.length && context.nodes?.some?.((node: any) => node.kind === 'image')) {
        pieces.push('提示：当前仅存在图像节点供画风参考，除非用户要求剧情延续，否则不要强行复用图像中的人物或故事。')
      }

      if (context.timeline?.length) {
        const summaryTimeline = context.timeline
          .slice(0, 5)
          .map((entry: any, index: number) => {
            const chars = entry.characters?.map?.((c: any) => c.label || c.username)?.join(', ')
            const charText = chars ? ` | 角色: ${chars}` : ''
            return `${index + 1}. ${entry.label || entry.nodeId} (${entry.kind || 'node'} - ${entry.status || 'unknown'})${charText}`
          })
        if (summaryTimeline.length) {
          pieces.push(`镜头时间线：\n${summaryTimeline.join('\n')}`)
        }
      }

      if (context.pendingNodes?.length) {
        const pendings = context.pendingNodes
          .map((node: any) => `${node.label || node.nodeId}(${node.kind || 'node'}) -> ${node.status}`)
          .join('；')
        pieces.push(`待处理节点：${pendings}`)
      }

      if (context.currentRun) {
        pieces.push(
          `当前有节点正在运行：${context.currentRun.label || context.currentRun.nodeId}（状态 ${context.currentRun.status}，进度 ${context.currentRun.progress ?? 0}%）。请优先关注其结果或异常，再决定是否继续新的生成。`
        )
      }
      const existingVideos = context.nodes
        ?.filter(node => node.kind === 'composeVideo' || node.kind === 'video')
        ?.slice(0, 3)
        ?.map(node => `${node.label || node.id} (${node.status || 'unknown'})`)
      if (existingVideos && existingVideos.length) {
        pieces.push(`已有视频节点：${existingVideos.join('、')}。若用户要求续写，请读取这些节点的 prompt 与角色后再创作下一镜。`)
      }

      const existingImages = context.nodes
        ?.filter(node => node.kind === 'image' || node.kind === 'textToImage')
        ?.slice(0, 3)
        ?.map(node => node.label || node.id)
      if (existingImages && existingImages.length) {
        pieces.push(`参考图像：${existingImages.join('、')}。若无特别说明，请沿用这些节点的画风/色彩。`)
      }
    }

    if (latestUserText && latestUserText.trim()) {
      const samples = matchPromptSamples(latestUserText, 3)
      if (samples.length) {
        const formatted = samples.map(formatPromptSample).join('\n\n')
        pieces.push(`提示词案例匹配（根据用户意图自动挑选）：\n${formatted}`)
      }

      const scenes = this.extractNarrativeScenes(latestUserText)
      if (scenes.length > 1) {
        const sceneLines = scenes.map((scene, idx) => `镜头${idx + 1}：${scene}`)
        pieces.push(`检测到长篇剧情，请按以下镜头逐步生成 composeVideo：\n${sceneLines.join('\n')}\n注意：每个镜头需单独创建/更新节点，执行完一镜后再继续下一镜，保持人物/光影/情绪承接。`)
      }
    }

    return pieces.join('\n\n')
  }

  private normalizeMessages(messages: ChatRequestDto['messages']): CoreMessage[] {
    if (!messages?.length) return []
    const filtered = (messages as ChatMessageDto[]).filter((message): message is ChatMessageDto => {
      return !!message && typeof message.role === 'string'
    })
    if (!filtered.length) return []
    const uiMessages = filtered
      .map(message => this.mapToUiMessage(message))
      .filter((msg): msg is NonNullable<ReturnType<typeof AiService.prototype.mapToUiMessage>> => !!msg && msg.parts.length > 0)
    return convertToCoreMessages(uiMessages as any)
  }

  private extractNarrativeScenes(text: string): string[] {
    if (!text) return []
    const cleaned = text.replace(/\r/g, '\n').trim()
    if (cleaned.length < 320) return []

    const sections = splitNarrativeSections(cleaned, {
      maxScenes: 6,
      minLength: 60,
      targetLength: 240,
      maxChunkLength: 340
    })

    if (sections.length <= 1) return []

    return sections.slice(0, 6).map(section => {
      if (section.length <= 80) return section
      return `${section.slice(0, 80)}…`
    })
  }

  async generateScenePrompt(userId: string, request: ScenePromptRequest): Promise<ScenePromptResult> {
    const modelName = request.model || 'gemini-2.5-flash'
    const provider = this.resolveProvider(modelName, request.baseUrl, request.provider)
    const { apiKey, baseUrl } = await this.resolveCredentials(userId, provider, request.apiKey, request.baseUrl)
    const model = this.buildModel(provider, modelName, apiKey, baseUrl)

    const schema = z.object({
      title: z.string().min(4).max(120),
      prompt: z.string().min(80),
      negativePrompt: z.string().min(20).default(DEFAULT_NEGATIVE_PROMPT),
      keywords: z.array(z.string()).min(4).max(12),
      realismRules: z.array(z.string()).min(3).max(9),
      durationSeconds: z.number().min(5).max(10).default(10),
      orientation: z.enum(['landscape', 'portrait']).default('landscape'),
      cameraPlan: z.string().min(40),
      environmentNotes: z.string().min(10).optional(),
      microNarrative: z.string().min(10).optional(),
      beatOutline: z.array(z.string()).min(2).max(6),
      modelSuggestion: z.string().optional()
    })

    const result = await generateObject({
      model,
      system: this.composeScenePromptSystem(),
      messages: [
        {
          role: 'user',
          content: this.composeScenePromptUserMessage(request)
        }
      ],
      schema,
      temperature: request.temperature ?? 0.35,
      maxRetries: 1
    })

    const realismSet = new Set(VIDEO_REALISM_RULES.map(rule => rule.id))
    const filteredRules = (result.object.realismRules || []).filter(rule => realismSet.has(rule))

    return {
      title: result.object.title,
      prompt: result.object.prompt,
      negativePrompt: result.object.negativePrompt || DEFAULT_NEGATIVE_PROMPT,
      keywords: result.object.keywords,
      realismRules: filteredRules,
      durationSeconds: result.object.durationSeconds,
      orientation: result.object.orientation,
      cameraPlan: result.object.cameraPlan,
      environmentNotes: result.object.environmentNotes,
      microNarrative: result.object.microNarrative,
      beatOutline: result.object.beatOutline,
      modelSuggestion: result.object.modelSuggestion
    }
  }

  private composeScenePromptSystem() {
    const realismGuide = VIDEO_REALISM_RULES
      .map(rule => `${rule.id}: ${rule.promptLine}`)
      .join('\n')
    return [
      'You are TapCanvas\'s cinematic scene prompt architect.',
      'Convert the provided narrative into a concise 10-second video prompt with explicit camera moves, subjects, lighting logic, and emotional arc.',
      'Blend realism naturally—never dump checklists. Mention lighting temperature, camera stability, and micro actions as part of the prose.',
      'Respect continuity cues (characters, wardrobe, weather, props).',
      'Choose 3-6 relevant realism rules from the list below and weave them organically into the prompt text.',
      'Return structured JSON that matches the schema.',
      'Realism rulebook:',
      realismGuide
    ].join('\n')
  }

  private composeScenePromptUserMessage(request: ScenePromptRequest) {
    const excerpt = request.sceneText.length > 1600
      ? `${request.sceneText.slice(0, 1600)}…`
      : request.sceneText
    const contextLines = [
      request.contextSummary ? `Canvas context:\n${request.contextSummary}` : '',
      request.characterNotes?.length ? `Characters to keep: ${request.characterNotes.join('; ')}` : '',
      request.styleNotes?.length ? `Visual style refs: ${request.styleNotes.join('; ')}` : '',
      request.videoNotes?.length ? `Existing video beats: ${request.videoNotes.join(' | ')}` : ''
    ].filter(Boolean)
    const hintLine = request.hints?.length ? `Scene hints: ${request.hints.join(', ')}` : ''

    return [
      `Scene ${request.sceneIndex} / ${request.sceneCount}`,
      hintLine,
      contextLines.join('\n'),
      request.userIntent ? `User briefing: ${request.userIntent}` : '',
      `Summary: ${request.sceneSummary}`,
      'Source text:',
      excerpt,
      '',
      'Output requirements:',
      '- Prompt: cinematic English paragraph with subject, motion, lighting, material interactions, micro gestures.',
      '- Camera plan: describe exact movement timing (push, hold, occlusion).',
      '- Beat outline: 2-5 bullet beats summarizing moment-by-moment arc.',
      '- Mention realism touches (lighting logic, handheld jitter, DOF, lens flaws, micro motion) as prose, not bullet list.'
    ].filter(Boolean).join('\n')
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
    const parts = hasParts
      ? (message.parts as any[])
        .map(part => this.normalizePart(part))
        .filter(Boolean)
      : [{ type: 'text', text: fallbackText }]
    const metadata = (message as any)?.metadata
    return {
      role: (message.role || 'user') as 'system' | 'user' | 'assistant',
      parts,
      ...(metadata ? { metadata } : {})
    }
  }

  private normalizePart(part: any) {
    if (!part) return null
    if (part.type === 'item_reference') {
      return null
    }
    if (part.type === 'function_call_output') {
      const textPayload = typeof part.output === 'string'
        ? part.output
        : (() => {
            try {
              return JSON.stringify(part.output)
            } catch {
              return ''
            }
          })()
      return textPayload ? { type: 'text', text: textPayload } : null
    }
    if (part.type === 'text' || part.type === 'reasoning') {
      return {
        type: part.type,
        text: typeof part.text === 'string' ? part.text : ''
      }
    }
    if (part.type === 'step-start' || part.type === 'step-end') {
      return { type: part.type }
    }
    if (part.type?.startsWith('tool-')) {
      const { providerMetadata, callProviderMetadata, ...rest } = part
      return rest
    }
    if (typeof part === 'object') {
      const { providerMetadata, callProviderMetadata, ...rest } = part
      return rest
    }
    return null
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

export interface ScenePromptRequest {
  model: string
  baseUrl?: string | null
  provider?: string | null
  apiKey?: string
  sceneIndex: number
  sceneCount: number
  sceneSummary: string
  sceneText: string
  hints?: string[]
  contextSummary?: string
  characterNotes?: string[]
  styleNotes?: string[]
  videoNotes?: string[]
  userIntent?: string
  temperature?: number
}

export interface ScenePromptResult {
  title: string
  prompt: string
  negativePrompt: string
  keywords: string[]
  realismRules: string[]
  durationSeconds: number
  orientation: 'landscape' | 'portrait'
  cameraPlan: string
  environmentNotes?: string
  microNarrative?: string
  beatOutline: string[]
  modelSuggestion?: string
}
