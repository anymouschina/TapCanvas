import { BadRequestException, Injectable, Logger } from '@nestjs/common'
import { PrismaService } from 'nestjs-prisma'
import { generateObject, type CoreMessage } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { z } from 'zod'
import { ACTION_TYPES, SYSTEM_PROMPT, MODEL_PROVIDER_MAP, PROVIDER_VENDOR_ALIASES, type SupportedProvider } from './constants'
import type { ChatRequestDto, ChatResponseDto, CanvasContextDto } from './dto/chat.dto'

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
  })).default([]),
})

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name)

  constructor(private readonly prisma: PrismaService) {}

  async chat(userId: string, payload: ChatRequestDto): Promise<ChatResponseDto> {
    if (!payload.messages?.length) {
      throw new BadRequestException('消息内容不能为空')
    }

    const provider = this.resolveProvider(payload.model)
    const { apiKey, baseUrl } = await this.resolveCredentials(userId, provider)
    const model = this.buildModel(provider, payload.model, apiKey, baseUrl)

    const systemPrompt = this.composeSystemPrompt(payload.context)
    const chatMessages = this.normalizeMessages(payload.messages)

    try {
      this.logger.debug('AI chat request', { provider, model: payload.model, userId, contextNodes: payload.context?.nodes?.length })
      const result = await generateObject({
        model,
        system: systemPrompt,
        messages: chatMessages,
        schema: assistantSchema,
        temperature: payload.temperature ?? 0.2,
        maxRetries: 1,
      })

      const { reply, plan, actions } = result.object
      return {
        reply,
        plan: plan || [],
        actions: actions || [],
      }
    } catch (error) {
      this.logger.error('AI chat失败', error as any)
      const message = error instanceof Error ? error.message : undefined
      throw new BadRequestException(message ? `AI助手不可用：${message}` : 'AI助手暂时不可用，请稍后再试')
    }
  }

  private resolveProvider(model: string): SupportedProvider {
    return MODEL_PROVIDER_MAP[model] || 'google'
  }

  private async resolveCredentials(userId: string, provider: SupportedProvider): Promise<{ apiKey: string; baseUrl?: string | null }> {
    const aliases = PROVIDER_VENDOR_ALIASES[provider] || [provider]
    const providerRecord = await this.prisma.modelProvider.findFirst({
      where: { ownerId: userId, vendor: { in: aliases } },
      orderBy: { createdAt: 'asc' },
    })

    if (!providerRecord) {
      throw new BadRequestException(`未配置${provider} Provider，请在模型面板中新增 vendor 为 ${aliases.join('/')} 的配置`) 
    }

    let token = await this.prisma.modelToken.findFirst({
      where: { providerId: providerRecord.id, userId, enabled: true },
      orderBy: { createdAt: 'asc' },
    })

    if (!token) {
      token = await this.prisma.modelToken.findFirst({
        where: { providerId: providerRecord.id, shared: true, enabled: true },
        orderBy: { createdAt: 'asc' },
      })
    }

    if (!token) {
      throw new BadRequestException(`未找到可用的${provider} API Key，请在模型面板中添加`) 
    }

    this.logger.debug('Resolved provider credentials', {
      userId,
      providerVendor: providerRecord.vendor,
      providerId: providerRecord.id,
      baseUrl: providerRecord.baseUrl,
      hasSharedToken: !!token.shared,
    })

    return { apiKey: token.secretToken, baseUrl: providerRecord.baseUrl }
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
    const options = normalizedBaseUrl ? { apiKey, baseURL: normalizedBaseUrl } : { apiKey }
    switch (provider) {
      case 'openai': {
        const client = createOpenAI(options)
        return client(normalizedModel)
      }
      case 'anthropic': {
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

    if (provider === 'google') {
      normalized = normalized.replace(/\/v1beta$/i, '').replace(/\/v1$/i, '')
      normalized = `${normalized}/v1beta`
    }

    return normalized
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
    return messages.map(msg => ({
      role: msg.role,
      content: msg.content,
    }))
  }
}
