import { Injectable } from '@nestjs/common'
import type { ModelProvider, ModelToken } from '@prisma/client'
import { PrismaService } from 'nestjs-prisma'
import { ProxyService } from '../proxy/proxy.service'
import type {
  AnyTaskRequest,
  ProviderAdapter,
  ProviderContext,
  ProviderProgressUpdate,
  TaskProgressEvent,
  TaskResult,
  TaskStatus,
} from './task.types'
import { soraAdapter } from './adapters/sora.adapter'
import { sora2apiAdapter } from './adapters/sora2api.adapter'
import { geminiAdapter } from './adapters/gemini.adapter'
import { qwenAdapter } from './adapters/qwen.adapter'
import { anthropicAdapter } from './adapters/anthropic.adapter'
import { openaiAdapter } from './adapters/openai.adapter'
import { fetchVeoResultSnapshot, pollVeoResult } from './adapters/veo.adapter'
import { fetchSora2ApiResultSnapshot } from './adapters/sora2api.adapter'
import { veoAdapter } from './adapters/veo.adapter'
import { TaskProgressService } from './task-progress.service'

@Injectable()
export class TaskService {
  private readonly adapters: ProviderAdapter[]

  constructor(
    private readonly prisma: PrismaService,
    private readonly proxyService: ProxyService,
    private readonly progress: TaskProgressService,
  ) {
    this.adapters = [soraAdapter, sora2apiAdapter, geminiAdapter, qwenAdapter, anthropicAdapter, openaiAdapter, veoAdapter]
  }

  private getAdapterByVendor(vendor: string): ProviderAdapter {
    const adapter = this.adapters.find((a) => a.name === vendor)
    if (!adapter) {
      throw new Error(`no adapter for provider: ${vendor}`)
    }
    return adapter
  }

  private async resolveVendorContext(
    userId: string,
    vendor: string,
    requestModelKey?: string | null,
  ): Promise<{ adapter: ProviderAdapter; ctx: ProviderContext }> {
    const adapter = this.getAdapterByVendor(vendor)
    const proxyCtx = await this.resolveProxyContext(userId, vendor, requestModelKey)
    if (proxyCtx) {
      if (requestModelKey) {
        proxyCtx.modelKey = requestModelKey
      }
      return { adapter, ctx: proxyCtx }
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
      modelKey: requestModelKey,
    }

    return { adapter, ctx }
  }

  private createProgressEmitter(userId: string, req: AnyTaskRequest, vendor: string) {
    const extras = (req?.extras ?? {}) as Record<string, any>
    const rawNodeId = typeof extras.nodeId === 'string' ? extras.nodeId.trim() : ''
    const nodeId = rawNodeId.length ? rawNodeId : null
    if (!nodeId) return null

    const nodeKind = typeof extras.nodeKind === 'string' ? extras.nodeKind : undefined
    const baseContext = {
      nodeId,
      nodeKind,
      taskKind: req.kind,
      vendor,
    }

    const clampProgress = (value?: number | null) => {
      if (typeof value !== 'number' || Number.isNaN(value)) return undefined
      const normalized = value <= 1 ? value * 100 : value
      return Math.max(0, Math.min(100, normalized))
    }

    const useStoreOnly = vendor === 'sora2api'

    const emit = (event: Omit<TaskProgressEvent, 'nodeId' | 'nodeKind' | 'taskKind' | 'vendor'>) => {
      if (!event || !event.status) return
      const payload: TaskProgressEvent = {
        ...baseContext,
        ...event,
        progress: clampProgress(event.progress),
        timestamp: event.timestamp ?? Date.now(),
      }
      if (useStoreOnly) {
        this.progress.emitStoreOnly(userId, payload)
      } else {
        this.progress.emit(userId, payload)
      }
    }

    const onProviderProgress = (update: ProviderProgressUpdate) => {
      const status: TaskStatus = update.status ?? 'running'
      emit({
        status,
        progress: clampProgress(update.progress),
        message: update.message,
        raw: update.data,
      })
    }

    return { emit, onProviderProgress }
  }

  private async runAdapterWithProgress(
    adapter: ProviderAdapter,
    req: AnyTaskRequest,
    ctx: ProviderContext,
    emit?: (event: Omit<TaskProgressEvent, 'nodeId' | 'nodeKind' | 'taskKind' | 'vendor'>) => void,
  ): Promise<TaskResult> {
    if (emit) {
      emit({ status: 'queued', progress: 0 })
      emit({ status: 'running', progress: 5 })
    }

    try {
      const result = await this.runAdapter(adapter, req, ctx)
      emit?.({
        status: result.status,
        progress: result.status === 'succeeded' ? 100 : undefined,
        taskId: result.id,
        assets: result.assets,
        raw: result.raw,
      })
      return result
    } catch (error: any) {
      emit?.({ status: 'failed', message: error?.message || '任务执行失败' })
      throw error
    }
  }

  private async resolveProxyContext(
    userId: string,
    vendor: string,
    modelKey?: string | null,
  ): Promise<ProviderContext | null> {
    if (!vendor || vendor === 'sora') return null
    const proxy = await this.proxyService.findProxyConfig(userId, vendor)
    if (!proxy || !proxy.baseUrl || !proxy.apiKey) return null
    return {
      baseUrl: proxy.baseUrl,
      apiKey: proxy.apiKey,
      userId,
      modelKey: modelKey ?? undefined,
    }
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

    const proxyContext = await this.resolveProxyContext(userId, vendor, modelKey)
    if (proxyContext) {
      return proxyContext
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

    const progressEmitter = this.createProgressEmitter(userId, req, adapter.name)
    const ctxWithProgress = progressEmitter
      ? { ...ctx, onProgress: progressEmitter.onProviderProgress }
      : ctx

    return this.runAdapterWithProgress(adapter, req, ctxWithProgress, progressEmitter?.emit)
  }

  async executeWithVendor(userId: string, vendor: string, req: AnyTaskRequest): Promise<TaskResult> {
    const requestModelKey =
      (req?.extras && typeof (req.extras as any).modelKey === 'string'
        ? ((req.extras as any).modelKey as string)
        : null) || null

    const { adapter, ctx } = await this.resolveVendorContext(userId, vendor, requestModelKey)

    const progressEmitter = this.createProgressEmitter(userId, req, adapter.name)
    const ctxWithProgress = progressEmitter
      ? { ...ctx, onProgress: progressEmitter.onProviderProgress }
      : ctx

    return this.runAdapterWithProgress(adapter, req, ctxWithProgress, progressEmitter?.emit)
  }

  async fetchVeoResult(userId: string, taskId: string): Promise<TaskResult> {
    if (!taskId || !taskId.trim()) {
      throw new Error('taskId is required')
    }
    const { ctx } = await this.resolveVendorContext(userId, 'veo', null)
    const snapshot = await fetchVeoResultSnapshot({ ctx, taskId: taskId.trim() })
    if (snapshot.asset) {
      return {
        id: taskId,
        kind: 'text_to_video',
        status: 'succeeded',
        assets: [snapshot.asset],
        raw: {
          provider: 'veo',
          response: snapshot.raw,
        },
      }
    }
    return {
      id: taskId,
      kind: 'text_to_video',
      status: snapshot.status,
      assets: [],
      raw: {
        provider: 'veo',
        response: snapshot.raw,
        progress: snapshot.progress,
      },
    }
  }

  async fetchSora2ApiResult(userId: string, taskId: string): Promise<TaskResult> {
    if (!taskId || !taskId.trim()) {
      throw new Error('taskId is required')
    }
    const { ctx } = await this.resolveVendorContext(userId, 'sora2api', null)
    const snapshot = await fetchSora2ApiResultSnapshot({ ctx, taskId: taskId.trim() })
    if (snapshot.asset) {
      return {
        id: taskId,
        kind: 'text_to_video',
        status: 'succeeded',
        assets: [snapshot.asset],
        raw: {
          provider: 'sora2api',
          response: snapshot.raw,
        },
      }
    }
    return {
      id: taskId,
      kind: 'text_to_video',
      status: snapshot.status,
      assets: [],
      raw: {
        provider: 'sora2api',
        response: snapshot.raw,
        progress: snapshot.progress,
      },
    }
  }

  private runAdapter(adapter: ProviderAdapter, req: AnyTaskRequest, ctx: ProviderContext): Promise<TaskResult> {
    switch (req.kind) {
      case 'text_to_video':
        if (!adapter.textToVideo) {
          throw new Error(`provider ${adapter.name} does not support text_to_video`)
        }
        return adapter.textToVideo(req as any, ctx)
      case 'image_edit':
        if (!adapter.imageEdit) {
          throw new Error(`provider ${adapter.name} does not support image_edit`)
        }
        return adapter.imageEdit(req as any, ctx)
      case 'text_to_image':
        if (!adapter.textToImage) {
          throw new Error(`provider ${adapter.name} does not support text_to_image`)
        }
        return adapter.textToImage(req as any, ctx)
      case 'image_to_prompt':
        if (!adapter.imageToPrompt) {
          throw new Error(`provider ${adapter.name} does not support image_to_prompt`)
        }
        return adapter.imageToPrompt(req as any, ctx)
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
    return (
      vendor === 'gemini' ||
      vendor === 'qwen' ||
      vendor === 'anthropic' ||
      vendor === 'openai' ||
      vendor === 'veo' ||
      vendor === 'sora2api'
    )
  }
}
