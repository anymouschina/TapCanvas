import { Injectable } from '@nestjs/common'
import { PrismaService } from 'nestjs-prisma'
import { InferenceClient } from '@huggingface/inference'

const hfClient = process.env.HF_TOKEN ? new InferenceClient(process.env.HF_TOKEN) : null

@Injectable()
export class DraftService {
  constructor(private readonly prisma: PrismaService) {}

  async suggestPrompts(userId: string, query: string, provider: string, limit = 6, mode?: string) {
    const trimmed = query.trim()
    if (!trimmed) {
      return { prompts: [] }
    }

    // Lexical / history-first mode (default or fallback)
    if (!hfClient || mode !== 'semantic') {
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

    // Semantic mode using BGE-M3 via HF Inference
    const candidates = await this.prisma.externalDraft.findMany({
      where: {
        userId,
        provider,
        prompt: { not: null },
      },
      orderBy: { lastSeenAt: 'desc' },
      select: {
        prompt: true,
        useCount: true,
      },
      take: 50,
    })

    const byPrompt = new Map<string, { prompt: string; useCount: number }>()
    for (const row of candidates) {
      const p = (row.prompt || '').trim()
      if (!p) continue
      const existing = byPrompt.get(p)
      if (existing) {
        existing.useCount += row.useCount
      } else {
        byPrompt.set(p, { prompt: p, useCount: row.useCount })
      }
    }

    const items = Array.from(byPrompt.values())
    if (!items.length) {
      return { prompts: [] }
    }

    const sentences = items.map((it) => it.prompt)

    const scores = await hfClient.sentenceSimilarity({
      model: 'BAAI/bge-m3',
      inputs: {
        source_sentence: trimmed,
        sentences,
      },
      provider: 'hf-inference',
    })

    const ranked = items
      .map((it, i) => {
        const sim = scores[i] ?? 0
        const useBoost = Math.log(1 + (it.useCount || 0))
        const score = sim + 0.1 * useBoost
        return { prompt: it.prompt, score }
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)

    return { prompts: ranked.map((r) => r.prompt) }
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
