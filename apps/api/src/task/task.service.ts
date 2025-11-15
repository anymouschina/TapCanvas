import { Injectable } from '@nestjs/common'
import { PrismaService } from 'nestjs-prisma'
import type {
  AnyTaskRequest,
  ProviderAdapter,
  ProviderContext,
  TaskResult,
} from './task.types'
import { soraAdapter } from './adapters/sora.adapter'

@Injectable()
export class TaskService {
  private readonly adapters: ProviderAdapter[]

  constructor(private readonly prisma: PrismaService) {
    this.adapters = [soraAdapter]
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

    const adapter = this.adapters.find((a) => a.name === profile.provider.vendor)
    if (!adapter) {
      throw new Error(`no adapter for provider: ${profile.provider.vendor}`)
    }

    const ctx: ProviderContext = {
      baseUrl: profile.provider.baseUrl || '',
      apiKey: '', // 通过 Token 做鉴权时再补充
      userId,
      modelKey: profile.modelKey,
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
        return adapter.runChat(req, ctx)
      default:
        throw new Error(`unsupported task kind: ${req.kind}`)
    }
  }
}
