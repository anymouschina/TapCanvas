import { Injectable } from '@nestjs/common'
import { PrismaService } from 'nestjs-prisma'

@Injectable()
export class DraftService {
  constructor(private readonly prisma: PrismaService) {}

  async suggestPrompts(userId: string, query: string, provider: string, limit = 6) {
    const trimmed = query.trim()
    if (!trimmed) {
      return { prompts: [] }
    }

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
        useCount: true,
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
