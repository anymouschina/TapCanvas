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

  upsertToken(input: { id?: string; providerId: string; label: string; secretToken: string; enabled?: boolean; userAgent?: string | null }, userId: string) {
    if (input.id) {
      return this.prisma.modelToken.update({
        where: { id: input.id },
        data: {
          label: input.label,
          secretToken: input.secretToken,
          userAgent: input.userAgent ?? null,
          enabled: input.enabled ?? true,
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
      },
    })
  }

  deleteToken(id: string, userId: string) {
    return this.prisma.modelToken.delete({
      where: { id },
    })
  }
}
