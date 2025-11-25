import { Injectable } from '@nestjs/common'
import type { ModelProvider, ModelToken } from '@prisma/client'
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

    let tokenProviderForBase: ModelProvider | null = null
    let resolvedBaseUrl = provider.baseUrl || (await this.resolveSharedBaseUrl(vendor)) || ''

    const adapter = this.adapters.find((a) => a.name === vendor)
    if (!adapter) {
      throw new Error(`no adapter for provider: ${vendor}`)
    }

    let apiKey = ''

    if (this.requiresApiKey(adapter.name)) {
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

        if (!shared) {
          const sharedToken = await this.findSharedTokenForVendor(vendor)
          if (sharedToken) {
            apiKey = sharedToken.secretToken
            tokenProviderForBase = sharedToken.provider
          }
        }
      }
    }

    if (!resolvedBaseUrl && tokenProviderForBase?.baseUrl) {
      resolvedBaseUrl = tokenProviderForBase.baseUrl
    }

    const ctx: ProviderContext = {
      baseUrl: resolvedBaseUrl,
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
    const adapter = this.adapters.find((a) => a.name === vendor)
    if (!adapter) {
      throw new Error(`no adapter for provider: ${vendor}`)
    }

    let provider = await this.prisma.modelProvider.findFirst({
      where: { vendor, ownerId: userId },
      orderBy: { createdAt: 'asc' },
    })

    let apiKey = ''
    let sharedTokenProvider: ModelProvider | null = null

    if (this.requiresApiKey(vendor)) {
      if (provider) {
        const owned = await this.prisma.modelToken.findFirst({
          where: { providerId: provider.id, userId, enabled: true },
          orderBy: { createdAt: 'asc' },
        })
        if (owned) {
          apiKey = owned.secretToken
        } else {
          const shared = await this.prisma.modelToken.findFirst({
            where: { providerId: provider.id, shared: true, enabled: true },
            orderBy: { createdAt: 'asc' },
          })
          if (shared) {
            apiKey = shared.secretToken
          }
        }
      }

      if (!apiKey) {
        const sharedToken = await this.findSharedTokenForVendor(vendor)
        if (sharedToken) {
          apiKey = sharedToken.secretToken
          sharedTokenProvider = sharedToken.provider
        }
      }

      if (!apiKey) {
        throw new Error(`未找到可用的${vendor} API Key`)
      }
    }

    if (!provider && sharedTokenProvider) {
      provider = sharedTokenProvider
    }

    if (!provider) {
      throw new Error(`provider not found for vendor: ${vendor}`)
    }

    let resolvedBaseUrl = provider.baseUrl || (await this.resolveSharedBaseUrl(vendor)) || ''
    if (!resolvedBaseUrl && sharedTokenProvider?.baseUrl) {
      resolvedBaseUrl = sharedTokenProvider.baseUrl
    }

    const ctx: ProviderContext = {
      baseUrl: resolvedBaseUrl,
      apiKey,
      userId,
      modelKey: null,
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

  private async resolveSharedBaseUrl(vendor: string): Promise<string | null> {
    const shared = await this.prisma.modelProvider.findFirst({
      where: {
        vendor,
        sharedBaseUrl: true,
        baseUrl: { not: null },
      },
      orderBy: { updatedAt: 'desc' },
    })
    return shared?.baseUrl ?? null
  }

  private async findSharedTokenForVendor(vendor: string): Promise<(ModelToken & { provider: ModelProvider }) | null> {
    const now = new Date()
    return this.prisma.modelToken.findFirst({
      where: {
        shared: true,
        enabled: true,
        provider: { vendor },
        OR: [
          { sharedDisabledUntil: null },
          { sharedDisabledUntil: { lt: now } },
        ],
      },
      include: { provider: true },
      orderBy: { updatedAt: 'asc' },
    })
  }

  private requiresApiKey(vendor: string) {
    return vendor === 'gemini' || vendor === 'qwen' || vendor === 'anthropic'
  }
}
