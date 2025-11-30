import { Injectable } from '@nestjs/common'
import { PrismaService } from 'nestjs-prisma'

export type ResolvedProxyConfig = {
  id: string
  vendor: string
  baseUrl: string
  apiKey: string
}

@Injectable()
export class ProxyService {
  constructor(private readonly prisma: PrismaService) {}

  async findProxyConfig(
    userId: string,
    targetVendor: string,
    preferredProxyVendor?: string,
  ): Promise<ResolvedProxyConfig | null> {
    const configs = await this.prisma.proxyProvider.findMany({
      where: {
        ownerId: userId,
        enabled: true,
        enabledVendors: { has: targetVendor },
      },
      orderBy: { createdAt: 'asc' },
    })

    if (!configs.length) return null

    const filtered = configs.filter((cfg) => !!cfg.baseUrl && !!cfg.apiKey)
    if (!filtered.length) return null

    const sorted = [...filtered].sort((a, b) => {
      if (preferredProxyVendor) {
        const aPreferred = a.vendor === preferredProxyVendor
        const bPreferred = b.vendor === preferredProxyVendor
        if (aPreferred && !bPreferred) return -1
        if (!aPreferred && bPreferred) return 1
      }
      return a.createdAt.getTime() - b.createdAt.getTime()
    })

    const picked = sorted[0]
    return {
      id: picked.id,
      vendor: picked.vendor,
      baseUrl: picked.baseUrl!,
      apiKey: picked.apiKey!,
    }
  }
}
