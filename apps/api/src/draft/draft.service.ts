import { Injectable } from '@nestjs/common'
import { PrismaService } from 'nestjs-prisma'
import axios from 'axios'

const SILICONFLOW_API_KEY = process.env.SILICONFLOW_API_KEY

@Injectable()
export class DraftService {
  constructor(private readonly prisma: PrismaService) {}

  async suggestPrompts(userId: string, query: string, provider: string, limit = 6, mode?: string) {
    const trimmed = query.trim()
    if (!trimmed) {
      return { prompts: [] }
    }

    // Lexical / history-first mode (default or fallback)
    if (!SILICONFLOW_API_KEY || mode !== 'semantic') {
      const rows = await this.prisma.externalDraft.findMany({
        where: {
          userId,
          provider,
          prompt: {
            contains: trimmed,
            mode: 'insensitive',
          },
        },
        orderBy: {
          lastSeenAt: 'desc',
        },
        select: {
          prompt: true,
        },
        take: limit,
      })

      const prompts = Array.from(
        new Set(
          rows
            .map((r) => (r.prompt || '').trim())
            .filter((p) => p && p.length > 0),
        ),
      )

      return { prompts }
    }

    // Semantic mode using BGE-M3 via SiliconFlow embeddings + pgvector
    try {
      // 1) embed current query once
      const embRes = await axios.post(
        'https://api.siliconflow.cn/v1/embeddings',
        {
          model: 'BAAI/bge-m3',
          input: [trimmed],
        },
        {
          headers: {
            Authorization: `Bearer ${SILICONFLOW_API_KEY}`,
            'Content-Type': 'application/json',
          },
          timeout: 10000,
        },
      )

      const vec: number[] | undefined = embRes.data?.data?.[0]?.embedding
      if (!Array.isArray(vec) || !vec.length) {
        throw new Error('Invalid embedding for query')
      }
      const literal = '[' + vec.join(',') + ']'

      // 2) use pgvector to retrieve nearest prompts
      const rows = await this.prisma.$queryRawUnsafe<
        { prompt: string | null; useCount: number | null; dist: number | null }[]
      >(
        `
        SELECT "prompt",
               "useCount",
               ("embedding" <-> '${literal}') AS dist
        FROM "ExternalDraft"
        WHERE "userId" = '${userId}'
          AND "provider" = '${provider}'
          AND "embedding" IS NOT NULL
        ORDER BY "embedding" <-> '${literal}'
        LIMIT ${limit};
        `,
      )

      const ranked = (rows || [])
        .map((r) => {
          const dist = typeof r.dist === 'number' ? r.dist : 1
          const sim = 1 - dist
          const use = r.useCount ?? 0
          const useBoost = Math.log(1 + use)
          const score = sim + 0.1 * useBoost
          return { prompt: (r.prompt || '').trim(), score }
        })
        .filter((r) => r.prompt.length > 0)
        .sort((a, b) => b.score - a.score)

      return { prompts: ranked.map((r) => r.prompt) }
    } catch {
      // On any error, gracefully fall back to history-based suggestions
      const rows = await this.prisma.externalDraft.findMany({
        where: {
          userId,
          provider,
          prompt: {
            contains: trimmed,
            mode: 'insensitive',
          },
        },
        orderBy: {
          lastSeenAt: 'desc',
        },
        select: {
          prompt: true,
        },
        take: limit,
      })

      const prompts = Array.from(
        new Set(
          rows
            .map((r) => (r.prompt || '').trim())
            .filter((p) => p && p.length > 0),
        ),
      )

      return { prompts }
    }
  }

  async markPromptUsed(userId: string, provider: string, prompt: string) {
    const trimmed = prompt.trim()
    if (!trimmed) return { ok: true }
    await this.prisma.externalDraft.updateMany({
      where: {
        userId,
        provider,
        prompt: trimmed,
      },
      data: {
        useCount: {
          increment: 1,
        },
        lastSeenAt: new Date(),
      },
    })
    return { ok: true }
  }
}
