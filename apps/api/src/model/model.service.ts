import { Injectable } from '@nestjs/common'
import { PrismaService } from 'nestjs-prisma'

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

  upsertProvider(input: { id?: string; name: string; vendor: string; baseUrl?: string | null }, userId: string) {
    if (input.id) {
      return this.prisma.modelProvider.update({
        where: { id: input.id },
        data: { name: input.name, vendor: input.vendor, baseUrl: input.baseUrl || null },
      })
    }
    return this.prisma.modelProvider.create({
      data: { name: input.name, vendor: input.vendor, baseUrl: input.baseUrl || null, ownerId: userId },
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
    return this.prisma.modelToken.delete({
      where: { id },
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
}
