import { Injectable } from '@nestjs/common'
import type { ModelProvider, ModelToken } from '@prisma/client'
import axios, { AxiosInstance } from 'axios'
import { PrismaService } from 'nestjs-prisma'

export interface ModelExportData {
  version: string
  exportedAt: string
  providers: Array<{
    id: string
    name: string
    vendor: string
    baseUrl?: string | null
    sharedBaseUrl?: boolean
    tokens: Array<{
      id: string
      label: string
      secretToken: string
      enabled: boolean
      userAgent?: string | null
      shared: boolean
    }>
    endpoints: Array<{
      id: string
      key: string
      label: string
      baseUrl: string
      shared: boolean
    }>
  }>
}

@Injectable()
export class ModelService {
  private readonly http: AxiosInstance

  constructor(private readonly prisma: PrismaService) {
    const proxyUrl = process.env.HTTP_PROXY || process.env.HTTPS_PROXY || process.env.DEV_PROXY
    if (proxyUrl) {
      try {
        const parsed = new URL(proxyUrl)
        this.http = axios.create({
          proxy: {
            host: parsed.hostname,
            port: Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80)),
            protocol: (parsed.protocol.replace(':', '') || 'http') as 'http' | 'https',
          },
        })
      } catch {
        this.http = axios
      }
    } else {
      this.http = axios
    }
  }

  listProviders(userId: string) {
    return this.prisma.modelProvider.findMany({
      where: { ownerId: userId },
      orderBy: { createdAt: 'asc' },
    })
  }

  listTokens(providerId: string, userId: string) {
    return this.prisma.modelToken.findMany({
      where: { providerId, userId },
      orderBy: { createdAt: 'asc' },
    })
  }

  upsertProvider(input: { id?: string; name: string; vendor: string; baseUrl?: string | null; sharedBaseUrl?: boolean }, userId: string) {
    if (input.id) {
      return this.prisma.modelProvider.update({
        where: { id: input.id },
        data: {
          name: input.name,
          vendor: input.vendor,
          baseUrl: input.baseUrl || null,
          sharedBaseUrl: input.sharedBaseUrl ?? false,
        },
      })
    }
    return this.prisma.modelProvider.create({
      data: {
        name: input.name,
        vendor: input.vendor,
        baseUrl: input.baseUrl || null,
        sharedBaseUrl: input.sharedBaseUrl ?? false,
        ownerId: userId,
      },
    })
  }

  upsertToken(
    input: {
      id?: string
      providerId: string
      label: string
      secretToken: string
      enabled?: boolean
      userAgent?: string | null
      shared?: boolean
    },
    userId: string,
  ) {
    if (input.id) {
      return this.prisma.modelToken.update({
        where: { id: input.id },
        data: {
          label: input.label,
          secretToken: input.secretToken,
          userAgent: input.userAgent ?? null,
          enabled: input.enabled ?? true,
          shared: input.shared ?? false,
        },
      })
    }
    return this.prisma.modelToken.create({
      data: {
        providerId: input.providerId,
        label: input.label,
        secretToken: input.secretToken,
        userAgent: input.userAgent ?? null,
        userId,
        enabled: input.enabled ?? true,
        shared: input.shared ?? false,
      },
    })
  }

  deleteToken(id: string, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.taskTokenMapping.deleteMany({ where: { tokenId: id } })
      return tx.modelToken.delete({
        where: { id },
      })
    })
  }

  listEndpoints(providerId: string, userId: string) {
    return this.prisma.modelEndpoint.findMany({
      where: {
        providerId,
        provider: { ownerId: userId },
      },
      orderBy: { createdAt: 'asc' },
    })
  }

  upsertEndpoint(
    input: { id?: string; providerId: string; key: string; label: string; baseUrl: string; shared?: boolean },
    userId: string,
  ) {
    // Ensure the provider belongs to current user
    return this.prisma.modelEndpoint.upsert({
      where: input.id ? { id: input.id } : { providerId_key: { providerId: input.providerId, key: input.key } },
      update: {
        label: input.label,
        baseUrl: input.baseUrl,
        shared: input.shared ?? false,
      },
      create: {
        providerId: input.providerId,
        key: input.key,
        label: input.label,
        baseUrl: input.baseUrl,
        shared: input.shared ?? false,
      },
    })
  }

  // 导出用户的所有模型配置
  async exportAll(userId: string): Promise<ModelExportData> {
    const providers = await this.prisma.modelProvider.findMany({
      where: { ownerId: userId },
      include: {
        tokens: {
          select: {
            id: true,
            label: true,
            secretToken: true,
            enabled: true,
            userAgent: true,
            shared: true,
          }
        },
        endpoints: {
          select: {
            id: true,
            key: true,
            label: true,
            baseUrl: true,
            shared: true,
          }
        }
      }
    })

    return {
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      providers: providers.map(provider => ({
        id: provider.id,
        name: provider.name,
        vendor: provider.vendor,
        baseUrl: provider.baseUrl,
        sharedBaseUrl: provider.sharedBaseUrl,
        tokens: provider.tokens,
        endpoints: provider.endpoints
      }))
    }
  }

  // 导入用户的所有模型配置
  async importAll(userId: string, data: ModelExportData) {
    const result = {
      imported: { providers: 0, tokens: 0, endpoints: 0 },
      skipped: { providers: 0, tokens: 0, endpoints: 0 },
      errors: [] as string[]
    }

    try {
      // 开始事务
      await this.prisma.$transaction(async (tx) => {
        for (const providerData of data.providers) {
          try {
            // 检查是否已存在相同的提供商
            const existingProvider = await tx.modelProvider.findFirst({
              where: {
                ownerId: userId,
                name: providerData.name,
                vendor: providerData.vendor
              }
            })

            let providerId: string

            if (existingProvider) {
              const nextBase = providerData.baseUrl || null
              const nextShared = providerData.sharedBaseUrl ?? false
              if (
                existingProvider.baseUrl !== nextBase ||
                existingProvider.sharedBaseUrl !== nextShared
              ) {
                await tx.modelProvider.update({
                  where: { id: existingProvider.id },
                  data: { baseUrl: nextBase, sharedBaseUrl: nextShared }
                })
                result.imported.providers++
              } else {
                result.skipped.providers++
              }
              providerId = existingProvider.id
            } else {
              // 创建新提供商（不使用原来的ID，避免冲突）
              const newProvider = await tx.modelProvider.create({
                data: {
                  name: providerData.name,
                  vendor: providerData.vendor,
                  baseUrl: providerData.baseUrl || null,
                  sharedBaseUrl: providerData.sharedBaseUrl ?? false,
                  ownerId: userId
                }
              })
              result.imported.providers++
              providerId = newProvider.id
            }

            // 导入tokens
            for (const tokenData of providerData.tokens) {
              try {
                const existingToken = await tx.modelToken.findFirst({
                  where: {
                    providerId,
                    userId,
                    label: tokenData.label
                  }
                })

                if (!existingToken) {
                  await tx.modelToken.create({
                    data: {
                      providerId,
                      label: tokenData.label,
                      secretToken: tokenData.secretToken,
                      enabled: tokenData.enabled,
                      userAgent: tokenData.userAgent || null,
                      userId,
                      shared: tokenData.shared
                    }
                  })
                  result.imported.tokens++
                } else {
                  result.skipped.tokens++
                }
              } catch (error) {
                result.errors.push(`Failed to import token "${tokenData.label}": ${error}`)
              }
            }

            // 导入endpoints
            for (const endpointData of providerData.endpoints) {
              try {
                await tx.modelEndpoint.upsert({
                  where: {
                    providerId_key: {
                      providerId,
                      key: endpointData.key
                    }
                  },
                  update: {
                    label: endpointData.label,
                    baseUrl: endpointData.baseUrl,
                    shared: endpointData.shared
                  },
                  create: {
                    providerId,
                    key: endpointData.key,
                    label: endpointData.label,
                    baseUrl: endpointData.baseUrl,
                    shared: endpointData.shared
                  }
                })
                result.imported.endpoints++
              } catch (error) {
                result.errors.push(`Failed to import endpoint "${endpointData.key}": ${error}`)
              }
            }
          } catch (error) {
            result.errors.push(`Failed to import provider "${providerData.name}": ${error}`)
          }
        }
      })
    } catch (error) {
      throw new Error(`Import failed: ${error}`)
    }

    return result
  }

  async listAvailableModels(userId: string, vendor?: string | null) {
    const supportedVendors = ['openai', 'anthropic']
    const normalizedVendor = vendor?.trim().toLowerCase()
    const targetVendors = normalizedVendor ? supportedVendors.filter((v) => v === normalizedVendor) : supportedVendors
    if (!targetVendors.length) {
      return { models: [] }
    }

    const providers = await this.prisma.modelProvider.findMany({
      where: { ownerId: userId, vendor: { in: targetVendors } },
      orderBy: { createdAt: 'asc' },
    })
    console.log('[ModelService] resolving models', {
      userId,
      vendor,
      providerCount: providers.length,
      targetVendors,
    })

    const contexts: Array<{ provider: ModelProvider; apiKey: string }> = []
    for (const provider of providers) {
      const token = await this.findBestTokenForProvider(provider.id, userId)
      const secret = token?.secretToken?.trim()
      if (!secret) continue
      contexts.push({ provider, apiKey: secret })
    }

    for (const vendorName of targetVendors) {
      const hasContext = contexts.some((ctx) => ctx.provider.vendor === vendorName)
      if (hasContext) continue
      const sharedToken = await this.findSharedTokenForVendor(vendorName)
      const secret = sharedToken?.secretToken?.trim()
      const provider = sharedToken?.provider
      if (!secret || !provider) continue
      contexts.push({ provider, apiKey: secret })
    }

    if (!contexts.length) {
      return { models: [] }
    }

    const sharedBaseCache = new Map<string, string | null>()
    const getBaseUrlForProvider = async (provider: ModelProvider) => {
      if (provider.baseUrl) return provider.baseUrl
      if (sharedBaseCache.has(provider.vendor)) {
        const cached = sharedBaseCache.get(provider.vendor)
        return typeof cached === 'string' ? cached : null
      }
      const resolved = await this.resolveSharedBaseUrl(provider.vendor)
      sharedBaseCache.set(provider.vendor, resolved)
      return resolved
    }

    const results = new Map<string, { value: string; label: string; vendor: string }>()
    const errors: { providerId: string; vendor: string; message: string }[] = []

    for (const context of contexts) {
      const provider = context.provider
      const baseUrl = await getBaseUrlForProvider(provider)
      console.log('[ModelService] fetching models for provider', {
        providerId: provider.id,
        vendor: provider.vendor,
        baseUrl: baseUrl || provider.baseUrl,
        sharedContext: provider.ownerId !== userId,
      })
      let models: { id: string; label?: string }[] = []
      try {
        if (provider.vendor === 'openai') {
          models = await this.fetchOpenAIModels(baseUrl, context.apiKey)
        } else if (provider.vendor === 'anthropic') {
          models = await this.fetchAnthropicModels(baseUrl, context.apiKey)
        } else {
          continue
        }
      } catch (err: any) {
        const message = err instanceof Error ? err.message : String(err)
        console.warn('[ModelService] failed to fetch models for provider', provider.id, message)
        errors.push({ providerId: provider.id, vendor: provider.vendor, message })
        if (provider.vendor === 'openai') {
          const fallbackId = 'gpt-5.1-codex'
          if (!results.has(fallbackId)) {
            results.set(fallbackId, {
              value: fallbackId,
              label: 'GPT-5.1 Codex (默认)',
              vendor: provider.vendor,
            })
          }
        }
        continue
      }
      models.forEach((entry) => {
        if (!entry?.id) return
        if (results.has(entry.id)) return
        results.set(entry.id, {
          value: entry.id,
          label: entry.label?.trim() || entry.id,
          vendor: provider.vendor,
        })
      })
    }

    return { models: Array.from(results.values()), errors }
  }

  private async findBestTokenForProvider(providerId: string, userId: string) {
    const owned = await this.prisma.modelToken.findFirst({
      where: { providerId, userId, enabled: true },
      orderBy: { createdAt: 'asc' },
    })
    if (owned) return owned
    const now = new Date()
    return this.prisma.modelToken.findFirst({
      where: {
        providerId,
        shared: true,
        enabled: true,
        OR: [
          { sharedDisabledUntil: null },
          { sharedDisabledUntil: { lt: now } },
        ],
      },
      orderBy: { updatedAt: 'asc' },
    })
  }

  private async findSharedTokenForVendor(
    vendor: string,
  ): Promise<(ModelToken & { provider: ModelProvider }) | null> {
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

  private buildAnthropicModelsUrl(baseUrl?: string | null) {
    const base = (baseUrl || 'https://api.anthropic.com').trim().replace(/\/+$/, '')
    if (/\/v\d+$/i.test(base)) return `${base}/models`
    if (/\/v\d+\/models$/i.test(base)) return base
    return `${base}/v1/models`
  }

  private async fetchAnthropicModels(baseUrl: string | null | undefined, apiKey: string) {
    const url = this.buildAnthropicModelsUrl(baseUrl)
    try {
      const resp = await this.http.get(url, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
      })
      const data = Array.isArray(resp.data?.data) ? resp.data.data : []
      return data
        .map((item: any) => {
          if (!item || typeof item.id !== 'string') return null
          const label = typeof item.display_name === 'string' && item.display_name.trim()
            ? item.display_name.trim()
            : item.id
          return { id: item.id, label }
        })
        .filter(Boolean) as { id: string; label?: string }[]
    } catch (err: any) {
      const message = err?.response?.data || err?.message || 'unknown'
      throw new Error(`anthropic models request failed: ${typeof message === 'string' ? message : JSON.stringify(message)}`)
    }
  }

  private buildOpenAIModelsUrl(baseUrl?: string | null) {
    const base = (baseUrl || 'https://api.openai.com').trim().replace(/\/+$/, '')
    if (/\/v\d+\/models$/i.test(base)) return base
    if (/\/v\d+$/i.test(base)) return `${base}/models`
    return `${base}/v1/models`
  }

  private async fetchOpenAIModels(baseUrl: string | null | undefined, apiKey: string) {
    const url = this.buildOpenAIModelsUrl(baseUrl)
    try {
      const resp = await this.http.get(url, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      })
      const data = Array.isArray(resp.data?.data) ? resp.data.data : Array.isArray(resp.data) ? resp.data : []
      return data
        .map((item: any) => {
          if (!item || typeof item.id !== 'string') return null
          const label = typeof item.display_name === 'string' && item.display_name.trim()
            ? item.display_name.trim()
            : item.id
          return { id: item.id, label }
        })
        .filter(Boolean) as { id: string; label?: string }[]
    } catch (err: any) {
      const message = err?.response?.data || err?.message || 'unknown'
      throw new Error(`openai models request failed: ${typeof message === 'string' ? message : JSON.stringify(message)}`)
    }
  }
}
