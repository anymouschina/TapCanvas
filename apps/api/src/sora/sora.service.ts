import { HttpException, HttpStatus, Injectable } from '@nestjs/common'
import { PrismaService } from 'nestjs-prisma'
import axios from 'axios'

const SILICONFLOW_API_KEY = process.env.SILICONFLOW_API_KEY

@Injectable()
export class SoraService {
  constructor(private readonly prisma: PrismaService) {}

  async getDrafts(userId: string, tokenId: string, cursor?: string, limit?: number) {
    const token = await this.prisma.modelToken.findFirst({
      where: { id: tokenId, userId },
      include: {
        provider: {
          include: { endpoints: true },
        },
      },
    })
    if (!token || token.provider.vendor !== 'sora') {
      throw new Error('token not found or not a Sora token')
    }

    // 优先使用用户配置的自定义 sora 域名；若未配置，再退回官方域名
    const soraEndpoint = token.provider.endpoints.find((e) => e.key === 'sora')
    const baseUrl = soraEndpoint?.baseUrl || 'https://sora.chatgpt.com'
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
    const token = await this.prisma.modelToken.findFirst({
      where: { id: tokenId, userId },
      include: {
        provider: {
          include: { endpoints: true },
        },
      },
    })
    if (!token || token.provider.vendor !== 'sora') {
      throw new Error('token not found or not a Sora token')
    }

    const soraEndpoint = token.provider.endpoints.find((e) => e.key === 'sora')
    const baseUrl = soraEndpoint?.baseUrl || 'https://sora.chatgpt.com'
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
}
