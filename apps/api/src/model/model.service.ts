import { Injectable } from '@nestjs/common'
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
  constructor(private readonly prisma: PrismaService) {}

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
}
