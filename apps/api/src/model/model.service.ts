import { Injectable } from '@nestjs/common'
import { PrismaService } from 'nestjs-prisma'

@Injectable()
export class ModelService {
  constructor(private readonly prisma: PrismaService) {}

  listProviders() {
    return this.prisma.modelProvider.findMany({
      orderBy: { createdAt: 'asc' },
    })
  }

  listTokens(providerId: string) {
    return this.prisma.modelToken.findMany({
      where: { providerId },
      orderBy: { createdAt: 'asc' },
    })
  }

  upsertProvider(input: { id?: string; name: string; vendor: string; baseUrl?: string | null }) {
    if (input.id) {
      return this.prisma.modelProvider.update({
        where: { id: input.id },
        data: { name: input.name, vendor: input.vendor, baseUrl: input.baseUrl || null },
      })
    }
    return this.prisma.modelProvider.create({
      data: { name: input.name, vendor: input.vendor, baseUrl: input.baseUrl || null },
    })
  }

  upsertToken(input: { id?: string; providerId: string; label: string; secretToken: string; enabled?: boolean }) {
    if (input.id) {
      return this.prisma.modelToken.update({
        where: { id: input.id },
        data: {
          label: input.label,
          secretToken: input.secretToken,
          enabled: input.enabled ?? true,
        },
      })
    }
    return this.prisma.modelToken.create({
      data: {
        providerId: input.providerId,
        label: input.label,
        secretToken: input.secretToken,
        enabled: input.enabled ?? true,
      },
    })
  }

  deleteToken(id: string) {
    return this.prisma.modelToken.delete({ where: { id } })
  }
}

