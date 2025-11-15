import { HttpException, HttpStatus, Injectable } from '@nestjs/common'
import { PrismaService } from 'nestjs-prisma'
import axios from 'axios'

const SILICONFLOW_API_KEY = process.env.SILICONFLOW_API_KEY

@Injectable()
export class SoraService {
  constructor(private readonly prisma: PrismaService) {}

  async getDrafts(userId: string, tokenId?: string, cursor?: string, limit?: number) {
    const token = await this.resolveSoraToken(userId, tokenId)
    if (!token || token.provider.vendor !== 'sora') {
      throw new Error('token not found or not a Sora token')
    }

    // 优先使用用户配置 / 共享的自定义 sora 域名；若未配置，再退回官方域名
    const baseUrl = await this.resolveBaseUrl(token, 'sora', 'https://sora.chatgpt.com')
    const url = new URL('/backend/project_y/profile/drafts', baseUrl).toString()

    const userAgent = token.userAgent || 'TapCanvas/1.0'

    try {
      const params: Record<string, any> = {}
      if (cursor) params.cursor = cursor
      if (typeof limit === 'number' && !Number.isNaN(limit)) params.limit = limit

      const res = await axios.get(url, {
        headers: {
          Authorization: `Bearer ${token.secretToken}`,
          'User-Agent': userAgent,
          Accept: 'application/json',
        },
        params,
      })
      const data = res.data as any
      const rawItems: any[] = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : []
      const items = rawItems.map((item) => {
        const enc = item.encodings || {}
        const thumbnail =
          enc.thumbnail?.path ||
          item.preview_image_url ||
          item.thumbnail_url ||
          null
        const videoUrl =
          item.downloadable_url ||
          item.url ||
          enc.source?.path ||
          null
        return {
          id: item.id,
          kind: item.kind ?? 'sora_draft',
          title: item.title ?? null,
          prompt: item.prompt ?? item.creation_config?.prompt ?? null,
          width: item.width ?? null,
          height: item.height ?? null,
          generationType: item.generation_type ?? null,
          createdAt: item.created_at ?? null,
          thumbnailUrl: thumbnail,
          videoUrl,
          platform: 'sora' as const,
          raw: item,
        }
      })

      // persist/update a lightweight snapshot for later use
      await Promise.all(
        items.map((item) =>
          this.prisma.externalDraft.upsert({
            where: {
              userId_provider_remoteId: {
                userId,
                provider: 'sora',
                remoteId: item.id,
              },
            },
            update: {
              title: item.title,
              prompt: item.prompt,
              thumbnailUrl: item.thumbnailUrl,
              videoUrl: item.videoUrl,
              raw: item.raw as any,
              lastSeenAt: new Date(),
            },
            create: {
              userId,
              provider: 'sora',
              remoteId: item.id,
              title: item.title,
              prompt: item.prompt,
              thumbnailUrl: item.thumbnailUrl,
              videoUrl: item.videoUrl,
              raw: item.raw as any,
            },
          }),
        ),
      )

      // fill embeddings for new prompts using SiliconFlow + pgvector
      if (SILICONFLOW_API_KEY) {
        const ids = items.map((it) => it.id)
        if (ids.length) {
          const drafts = await this.prisma.externalDraft.findMany({
            where: {
              userId,
              provider: 'sora',
              remoteId: { in: ids },
            },
          })
          const needing = drafts.filter((d) => !(d as any).embedding && (d.prompt || '').trim().length > 0)
          if (needing.length) {
            try {
              const inputs = needing.map((d) => (d.prompt || '').trim())
              const embRes = await axios.post(
                'https://api.siliconflow.cn/v1/embeddings',
                {
                  model: 'BAAI/bge-m3',
                  input: inputs,
                },
                {
                  headers: {
                    Authorization: `Bearer ${SILICONFLOW_API_KEY}`,
                    'Content-Type': 'application/json',
                  },
                  timeout: 10000,
                },
              )
              const vectors: number[][] = (embRes.data?.data || []).map(
                (d: any) => d.embedding as number[],
              )
              // update each embedding via raw SQL
              await Promise.all(
                needing.map((draft, idx) => {
                  const vec = vectors[idx]
                  if (!Array.isArray(vec) || !vec.length) return Promise.resolve()
                  const literal = '[' + vec.join(',') + ']'
                  return this.prisma.$executeRawUnsafe(
                    `UPDATE "ExternalDraft" SET "embedding" = '${literal}'::vector WHERE "id" = '${draft.id}'`,
                  )
                }),
              )
            } catch {
              // ignore embedding errors; suggestions will fall back as needed
            }
          }
        }
      }

      return {
        items: items.map(({ raw, ...rest }) => rest),
        cursor: data?.cursor ?? null,
      }
    } catch (err: any) {
      // If this is a shared configuration, register the failure and soft-disable if needed.
      if (token.shared) {
        await this.registerSharedFailure(token.id)
        throw new HttpException(
          { message: '当前配置不可用，请稍后再试', upstreamStatus: err?.response?.status ?? null },
          HttpStatus.SERVICE_UNAVAILABLE,
        )
      }
      const status = err?.response?.status ?? HttpStatus.BAD_GATEWAY
      const message =
        err?.response?.data?.message ||
        err?.response?.statusText ||
        'Sora drafts request failed'
      throw new HttpException(
        { message, upstreamStatus: err?.response?.status ?? null },
        status,
      )
    }
  }

  async deleteDraft(userId: string, tokenId: string, draftId: string) {
    const token = await this.resolveSoraToken(userId, tokenId)
    if (!token || token.provider.vendor !== 'sora') {
      throw new Error('token not found or not a Sora token')
    }

    const baseUrl = await this.resolveBaseUrl(token, 'sora', 'https://sora.chatgpt.com')
    const url = new URL(`/backend/project_y/profile/drafts/${draftId}`, baseUrl).toString()

    const userAgent = token.userAgent || 'TapCanvas/1.0'

    try {
      const res = await axios.delete(url, {
        headers: {
          Authorization: `Bearer ${token.secretToken}`,
          'User-Agent': userAgent,
          Accept: '*/*',
        },
      })
      return { ok: true, status: res.status }
    } catch (err: any) {
      if (token.shared) {
        await this.registerSharedFailure(token.id)
        throw new HttpException(
          { message: '当前配置不可用，请稍后再试', upstreamStatus: err?.response?.status ?? null },
          HttpStatus.SERVICE_UNAVAILABLE,
        )
      }
      const status = err?.response?.status ?? HttpStatus.BAD_GATEWAY
      const message =
        err?.response?.data?.message ||
        err?.response?.statusText ||
        'Sora delete draft request failed'
      throw new HttpException(
        { message, upstreamStatus: err?.response?.status ?? null },
        status,
      )
    }
  }

  private async resolveSoraToken(userId: string, tokenId?: string) {
    const includeConfig = {
      provider: {
        include: { endpoints: true },
      },
    } as const

    // If tokenId is provided, prefer the caller's own token, but allow falling back to a shared token with the same id.
    if (tokenId) {
      let token = await this.prisma.modelToken.findFirst({
        where: { id: tokenId, userId },
        include: includeConfig,
      })
      if (!token) {
        token = await this.prisma.modelToken.findFirst({
          where: { id: tokenId, shared: true },
          include: includeConfig,
        })
      }
      return token
    }

    // No tokenId: try a user-owned Sora token first.
    const owned = await this.prisma.modelToken.findFirst({
      where: { userId, enabled: true, provider: { vendor: 'sora' } },
      include: includeConfig,
      orderBy: { createdAt: 'asc' },
    })
    if (owned) return owned

    // Then fall back to a shared Sora token, if any.
    const now = new Date()
    let shared = await this.prisma.modelToken.findFirst({
      where: {
        shared: true,
        enabled: true,
        provider: { vendor: 'sora' },
        OR: [
          { sharedDisabledUntil: null },
          { sharedDisabledUntil: { lt: now } },
        ],
      },
      include: includeConfig,
      orderBy: { createdAt: 'asc' },
    })
    if (!shared) return null

    // If it was disabled until some time in the past, reset its counters for a new day.
    if (shared.sharedDisabledUntil && shared.sharedDisabledUntil < now) {
      shared = await this.prisma.modelToken.update({
        where: { id: shared.id },
        data: { sharedDisabledUntil: null, sharedFailureCount: 0 },
        include: includeConfig,
      })
    }
    return shared
  }

  private async resolveBaseUrl(
    token: {
      provider: {
        id: string
        vendor: string
        endpoints: { key: string; baseUrl: string | null | undefined }[]
      }
    },
    key: string,
    fallback: string,
  ): Promise<string> {
    // 1. 优先使用当前 provider 上配置的域名
    const own = token.provider.endpoints.find((e) => e.key === key && e.baseUrl)
    if (own?.baseUrl) return own.baseUrl

    // 2. 退回到任意共享的同 key 域名（通常由管理员配置）
    const shared = await this.prisma.modelEndpoint.findFirst({
      where: {
        key,
        shared: true,
        provider: { vendor: 'sora' },
      },
      orderBy: { createdAt: 'asc' },
    })
    if (shared?.baseUrl) return shared.baseUrl

    // 3. 最后使用内置默认
    return fallback
  }

  private async registerSharedFailure(tokenId: string) {
    const existing = await this.prisma.modelToken.findUnique({ where: { id: tokenId } })
    if (!existing || !existing.shared) return

    const now = new Date()
    const last = existing.sharedLastFailureAt
    const isSameDay =
      last &&
      last.getFullYear() === now.getFullYear() &&
      last.getMonth() === now.getMonth() &&
      last.getDate() === now.getDate()

    let failureCount = existing.sharedFailureCount || 0
    if (isSameDay) {
      failureCount += 1
    } else {
      failureCount = 1
    }

    let disabledUntil = existing.sharedDisabledUntil || null
    if (failureCount >= 3) {
      const endOfDay = new Date(now)
      endOfDay.setHours(23, 59, 59, 999)
      disabledUntil = endOfDay
    }

    await this.prisma.modelToken.update({
      where: { id: tokenId },
      data: {
        sharedFailureCount: failureCount,
        sharedLastFailureAt: now,
        sharedDisabledUntil: disabledUntil,
      },
    })
  }
}
