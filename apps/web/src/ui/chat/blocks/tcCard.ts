import type { ContentBlock, DataBlock } from './types'

// ```tc-card 围栏 → DataBlock（与 apps/agents-cli/src/server/content-blocks-build.ts 同算法）。
// id 用「有效卡的全局序号」生成，与服务端对同一文本解析出的 id 一致，可按 id 去重。
// 解析失败的围栏原样保留（渲染成代码块，暴露问题而不是吞掉）。
const TC_CARD_FENCE_RE = /```tc-card[^\S\n]*\n([\s\S]*?)\n```/g

export function extractTcCardBlocks(text: string): { cleanedText: string; dataBlocks: DataBlock[] } {
  const raw = typeof text === 'string' ? text : ''
  if (!raw.includes('```tc-card')) return { cleanedText: raw, dataBlocks: [] }
  const dataBlocks: DataBlock[] = []
  let validIndex = 0
  TC_CARD_FENCE_RE.lastIndex = 0
  let cleanedText = raw.replace(TC_CARD_FENCE_RE, (whole, body: string) => {
    try {
      const parsed = JSON.parse(String(body || '').trim()) as { name?: unknown; payload?: unknown }
      const name = String(parsed?.name || '').trim()
      if (!name || typeof parsed?.payload !== 'object' || parsed.payload === null) return whole
      validIndex += 1
      dataBlocks.push({
        id: `data-card-${validIndex}`,
        type: 'data',
        name,
        payload: parsed.payload,
        state: 'complete',
      })
      return ''
    } catch {
      return whole
    }
  })
  // 流式期间末尾可能是未闭合的围栏，先截掉避免闪现原始 JSON。
  const danglingIndex = cleanedText.lastIndexOf('```tc-card')
  if (danglingIndex >= 0 && !/```tc-card[^\S\n]*\n[\s\S]*?\n```/.test(cleanedText.slice(danglingIndex))) {
    cleanedText = cleanedText.slice(0, danglingIndex)
  }
  return { cleanedText: cleanedText.replace(/\n{3,}/g, '\n\n'), dataBlocks }
}

/** 服务端下发 blocks 与正文内联解析/流式沉淀的块按 id 合并（服务端优先）。 */
export function mergeInlineCardBlocks(
  serverBlocks: ContentBlock[] | undefined,
  inlineCards: ContentBlock[],
): ContentBlock[] {
  const base = Array.isArray(serverBlocks) ? serverBlocks : []
  if (!inlineCards.length) return base
  const seen = new Set(base.map((b) => b.id))
  return [...base, ...inlineCards.filter((card) => !seen.has(card.id))]
}
