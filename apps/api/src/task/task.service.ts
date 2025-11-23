import { Injectable } from '@nestjs/common'
import { PrismaService } from 'nestjs-prisma'
import type { AnyTaskRequest, ProviderAdapter, ProviderContext, TaskResult } from './task.types'
import { soraAdapter } from './adapters/sora.adapter'
import { geminiAdapter } from './adapters/gemini.adapter'
import { qwenAdapter } from './adapters/qwen.adapter'
import { anthropicAdapter } from './adapters/anthropic.adapter'

@Injectable()
export class TaskService {
  private readonly adapters: ProviderAdapter[]

  constructor(private readonly prisma: PrismaService) {
    this.adapters = [soraAdapter, geminiAdapter, qwenAdapter, anthropicAdapter]
  }

  private async buildContextForProvider(
    userId: string,
    providerId: string,
    vendor: string,
    modelKey?: string | null,
  ): Promise<ProviderContext> {
    const provider = await this.prisma.modelProvider.findFirst({
      where: { id: providerId, ownerId: userId },
    })
    if (!provider) {
      throw new Error('provider not found')
    }

    const adapter = this.adapters.find((a) => a.name === vendor)
    if (!adapter) {
      throw new Error(`no adapter for provider: ${vendor}`)
    }

    let apiKey = ''

    if (adapter.name === 'gemini' || adapter.name === 'qwen') {
      // 优先使用当前用户自己的 Token，其次使用共享 Token（若存在）
      const owned = await this.prisma.modelToken.findFirst({
        where: {
          providerId,
          userId,
          enabled: true,
        },
        orderBy: { createdAt: 'asc' },
      })
      if (owned) {
        apiKey = owned.secretToken
      } else {
        const shared = await this.prisma.modelToken.findFirst({
          where: {
            providerId,
            shared: true,
            enabled: true,
          },
          orderBy: { createdAt: 'asc' },
        })
        if (shared) {
          apiKey = shared.secretToken
        }
      }
    }

    const ctx: ProviderContext = {
      baseUrl: provider.baseUrl || '',
      apiKey,
      userId,
      modelKey: modelKey || undefined,
    }
    return ctx
  }

  async execute(userId: string, profileId: string, req: AnyTaskRequest): Promise<TaskResult> {
    const profile = await this.prisma.modelProfile.findFirst({
      where: { id: profileId, ownerId: userId },
      include: {
        provider: true,
      },
    })
    if (!profile) {
      throw new Error('profile not found')
    }

    const ctx = await this.buildContextForProvider(
      userId,
      profile.providerId,
      profile.provider.vendor,
      profile.modelKey,
    )

    const adapter = this.adapters.find((a) => a.name === profile.provider.vendor)!

    switch (req.kind) {
      case 'text_to_video':
        if (!adapter.textToVideo) {
          throw new Error(`provider ${adapter.name} does not support text_to_video`)
        }
        return adapter.textToVideo(req as any, ctx)
      case 'text_to_image':
        if (!adapter.textToImage) {
          throw new Error(`provider ${adapter.name} does not support text_to_image`)
        }
        return adapter.textToImage(req as any, ctx)
      case 'chat':
      case 'prompt_refine':
        if (!adapter.runChat) {
          throw new Error(`provider ${adapter.name} does not support chat`)
        }
        return adapter.runChat(req, ctx)
      default:
        throw new Error(`unsupported task kind: ${req.kind}`)
    }
  }

  async executeWithVendor(userId: string, vendor: string, req: AnyTaskRequest): Promise<TaskResult> {
    const provider = await this.prisma.modelProvider.findFirst({
      where: { vendor, ownerId: userId },
      orderBy: { createdAt: 'asc' },
    })
    if (!provider) {
      throw new Error(`provider not found for vendor: ${vendor}`)
    }

    const ctx = await this.buildContextForProvider(userId, provider.id, vendor, null)
    const adapter = this.adapters.find((a) => a.name === vendor)
    if (!adapter) {
      throw new Error(`no adapter for provider: ${vendor}`)
    }

    switch (req.kind) {
      case 'text_to_video':
        if (!adapter.textToVideo) {
          throw new Error(`provider ${adapter.name} does not support text_to_video`)
        }
        return adapter.textToVideo(req as any, ctx)
      case 'text_to_image':
        if (!adapter.textToImage) {
          throw new Error(`provider ${adapter.name} does not support text_to_image`)
        }
        return adapter.textToImage(req as any, ctx)
      case 'chat':
      case 'prompt_refine':
        if (!adapter.runChat) {
          throw new Error(`provider ${adapter.name} does not support chat`)
        }
        return adapter.runChat(req as any, ctx)
      default:
        throw new Error(`unsupported task kind: ${req.kind}`)
    }
  }
}
