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
    // 仅使用基于历史 / 关键词的推荐逻辑，完全停用向量检索
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
