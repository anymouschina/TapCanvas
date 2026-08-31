import { jsonrepair } from 'jsonrepair'
import { parseSbaChoiceMetadata } from '@tapcanvas/storyboard-adventure-protocol'

import type { ChoicesCardPayload, ContentBlock, DataBlock } from './types'

// ```choices 围栏（root-persona 轻量选项约定，模型亦可能漏写围栏直接输出行首 {"question":...}）
// → DataBlock{name:"choices"}（与 apps/agents-cli/src/server/content-blocks-build.ts 同算法）。
// id 用 JSON 原文 djb2 哈希生成：同一卡在「流式累积全文」「收尾最后一轮文本」「历史恢复正文」
// 多个来源重复解析时 id 稳定，可按 id 与服务端下发/流式沉淀的 blocks 去重。
// 解析失败的围栏原样保留在文本里（渲染成代码块，暴露问题而不是吞掉）。
const CHOICES_FENCE_RE = /```choices[^\S\n]*\n([\s\S]*?)\n?```/g
const RAW_CHOICES_START_RE = /(?:^|\n)[^\S\n]*(\{"question"\s*:)/g
// 漏围栏且漏 question 的第三种滑落（2026-07-29 实测：小T 直接吐顶层裸数组
// `[{"label":"…","description":"…"}]` → 三道识别关口全不命中 → 整坨 JSON 按 markdown 裸显给用户）。
// 顶层数组没有 question 键可锚，故用「行首 `[` + 紧跟对象」起手，再由 parseChoicesPayload
// 按「每一项都是带 label 字符串的对象」严格收口——正文里合法的 JSON 数组示例不满足该形状，不会被误吃。
const RAW_CHOICES_ARRAY_START_RE = /(?:^|\n)[^\S\n]*(\[\s*\{)/g

function hashText(text: string): string {
  let h = 5381
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) >>> 0
  return h.toString(36)
}

/** 括号配平找 JSON 值（对象或数组）结束位（字符串/转义感知）。-1=未闭合。 */
function findJsonValueEnd(text: string, start: number): number {
  const open = text[start]
  if (open !== '{' && open !== '[') return -1
  let depth = 0
  let inString = false
  let escape = false
  for (let i = start; i < text.length; i++) {
    const c = text[i]!
    if (escape) { escape = false; continue }
    if (c === '\\' && inString) { escape = true; continue }
    if (c === '"') { inString = !inString; continue }
    if (inString) continue
    if (c === '{' || c === '[') depth++
    else if (c === '}' || c === ']') { depth--; if (depth === 0) return i }
  }
  return -1
}

// 模型手写 JSON 偶发坏格式（2026-07-16 实测：option 尾多一个 `}` → JSON.parse 挂 → 整卡裸显
// 成代码块用户没法点）。选项卡是交互组件不是审计对象——先严格 parse，失败走 jsonrepair 修复
// 重试（多/少括号、尾逗号、单引号等 LLM 常见坏法都能救）；修不回来才按「暴露问题」原样渲染。
function parseJsonLenient(jsonText: string): unknown {
  try {
    return JSON.parse(jsonText)
  } catch {
    try {
      return JSON.parse(jsonrepair(jsonText))
    } catch {
      return null
    }
  }
}

// 围栏内 JSON 前后的杂词容错（2026-07-16 实测多/少括号之外，2026-07-17 又实测围栏首行
// 多打一个 `choices` 杂词 → 整卡裸显）：从第一个 `{` 起按括号配平截出 JSON 对象再 parse。
function extractJsonObjectText(raw: string): string {
  const s = String(raw ?? '').trim()
  if (s.startsWith('{') || s.startsWith('[')) return s
  const objAt = s.indexOf('{')
  const arrAt = s.indexOf('[')
  // 顶层裸数组形态也要能从杂词里截出来；取更早出现的那个起点。
  const start = objAt === -1 ? arrAt : arrAt === -1 ? objAt : Math.min(objAt, arrAt)
  if (start === -1) return s
  const end = findJsonValueEnd(s, start)
  return end === -1 ? s.slice(start) : s.slice(start, end + 1)
}

/**
 * 顶层裸数组当选项卡的收口判据：非空，且**每一项**都是「带非空 label 字符串」的对象，
 * 键集合不超出 choices 的展示/值/身份字段。正文里合法的 JSON 数组示例
 * （如 `[{"id":1,"name":"x"}]`）不满足 → 不吃，仍按正文渲染。
 */
const OPTION_KEYS = new Set(['label', 'description', 'value', 'metadata'])
function isBareOptionsArray(value: unknown): value is Array<Record<string, unknown>> {
  if (!Array.isArray(value) || !value.length) return false
  return value.every((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false
    const o = item as Record<string, unknown>
    if (typeof o.label !== 'string' || !o.label.trim()) return false
    return Object.keys(o).every((k) => OPTION_KEYS.has(k))
  })
}

function parseChoicesPayload(jsonText: string): ChoicesCardPayload | null {
  try {
    const value = parseJsonLenient(extractJsonObjectText(jsonText))
    // 顶层裸数组（漏围栏又漏 question）：整个数组就是 options 本身，卡片无标题渲染。
    const parsed = (
      Array.isArray(value) ? (isBareOptionsArray(value) ? { options: value } : null) : value
    ) as { question?: unknown; options?: unknown } | null
    if (!parsed || typeof parsed !== 'object') return null
    const rawOpts = Array.isArray(parsed.options) ? (parsed.options as Array<Record<string, unknown>>) : []
    const options = rawOpts
      .filter((o) => o && typeof o.label === 'string' && (o.label as string).trim())
      .map((o) => {
        const metadata = parseSbaChoiceMetadata(o.metadata)
        return {
          label: (o.label as string).trim(),
          ...(typeof o.description === 'string' && (o.description as string).trim()
            ? { description: (o.description as string).trim() }
            : {}),
          ...(typeof o.value === 'string' && o.value.trim()
            ? { value: o.value.trim() }
            : {}),
          ...(metadata ? { metadata } : {}),
        }
      })
    if (!options.length) return null
    const rawQuestion = typeof parsed.question === 'string' ? (parsed.question as string).trim() : ''
    const hasLegacySbaPrefix = rawQuestion.startsWith('[SBA]')
    const question = hasLegacySbaPrefix ? rawQuestion.slice(5).trim() : rawQuestion
    const sba = options.every((option) => Boolean(option.metadata))
    return {
      ...(question ? { question } : {}),
      options,
      ...(sba ? { sba: true } : {}),
    }
  } catch {
    return null
  }
}

type Hit = { index: number; end: number; jsonText: string }

function collectChoicesHits(raw: string): Hit[] {
  const hits: Hit[] = []
  CHOICES_FENCE_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = CHOICES_FENCE_RE.exec(raw)) !== null) {
    hits.push({ index: m.index, end: m.index + m[0].length, jsonText: m[1]! })
  }
  for (const re of [RAW_CHOICES_START_RE, RAW_CHOICES_ARRAY_START_RE]) {
    re.lastIndex = 0
    while ((m = re.exec(raw)) !== null) {
      const start = raw.indexOf(m[1]![0]!, m.index)
      if (start === -1) continue
      const end = findJsonValueEnd(raw, start)
      if (end === -1) continue
      if (hits.some((h) => start >= h.index && start < h.end)) continue
      hits.push({ index: start, end: end + 1, jsonText: raw.slice(start, end + 1) })
    }
  }
  hits.sort((a, b) => a.index - b.index)
  return hits
}

/** 快速判定：文本里是否可能藏着选项卡（围栏 / 裸 question 对象 / 裸 options 数组）。 */
function mayContainChoices(raw: string): boolean {
  return raw.includes('```choices') || raw.includes('{"question"') || raw.includes('"label"')
}

export function extractChoicesCardBlocks(text: string): { cleanedText: string; dataBlocks: DataBlock[] } {
  const raw = typeof text === 'string' ? text : ''
  if (!mayContainChoices(raw)) {
    return { cleanedText: raw, dataBlocks: [] }
  }
  const hits = collectChoicesHits(raw)
  const dataBlocks: DataBlock[] = []
  let cleaned = ''
  let last = 0
  for (const hit of hits) {
    if (hit.index < last) continue
    const payload = parseChoicesPayload(hit.jsonText)
    if (!payload) continue
    cleaned += raw.slice(last, hit.index)
    dataBlocks.push({
      id: `choices-${hashText(hit.jsonText.trim())}`,
      type: 'data',
      name: 'choices',
      payload,
      state: 'complete',
    })
    last = hit.end
  }
  cleaned += raw.slice(last)
  return { cleanedText: cleaned.replace(/\n{3,}/g, '\n\n'), dataBlocks }
}

/**
 * 流式期间裁掉尾部「未闭合的 ```choices 围栏 / 未配平的行首 {"question": JSON」，
 * 避免选项 JSON 在流到一半时按 markdown 闪现。仅用于流式展示，final 后不再调用
 * （final 仍残留的残缺围栏按「暴露问题」原则原样渲染）。
 */
export function trimDanglingChoices(text: string): string {
  let out = typeof text === 'string' ? text : ''
  const fenceIdx = out.lastIndexOf('```choices')
  if (fenceIdx >= 0 && !/```choices[^\S\n]*\n[\s\S]*?\n?```/.test(out.slice(fenceIdx))) {
    out = out.slice(0, fenceIdx)
  }
  for (const re of [RAW_CHOICES_START_RE, RAW_CHOICES_ARRAY_START_RE]) {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    let lastStart = -1
    while ((m = re.exec(out)) !== null) {
      lastStart = out.indexOf(m[1]![0]!, m.index)
    }
    if (lastStart >= 0 && findJsonValueEnd(out, lastStart) === -1) {
      out = out.slice(0, lastStart)
    }
  }
  return out
}

/**
 * 回合异常收尾（报错/中断）时标记「已过期」选项卡：choices 是非阻塞提问，若其围栏后面
 * 还有正文（= 小T 没等回答就继续推进了），这张卡就不该在报错后仍以「待回答」姿态渲染在
 * 气泡末尾（残影会被误读成小T停下来在等选择）。只有位于全文末尾的提问才保持可点。
 * superseded 只是前端收尾期标注（写进 payload），不进 tc-card 双端协议、不落库。
 */
export function supersedeStaleChoices(blocks: ContentBlock[], streamedText: string): ContentBlock[] {
  const raw = typeof streamedText === 'string' ? streamedText : ''
  if (!blocks.length || !mayContainChoices(raw)) return blocks
  const hits = collectChoicesHits(raw)
  if (!hits.length) return blocks
  const staleIds = new Set<string>()
  for (let i = 0; i < hits.length; i++) {
    const hit = hits[i]!
    // 后面还有更晚的 choices 提问 → 这张已被新问题取代，判过期。
    if (i < hits.length - 1) {
      staleIds.add(`choices-${hashText(hit.jsonText.trim())}`)
      continue
    }
    // 最后一张提问：只有其后是「实质性续写」（长段/多段=小T 已继续推进干活）才判过期。
    // 短尾巴——重述问题或把决策交还用户的一句话（如「你定？」「等你选」）——不算继续推进，
    // 选项卡保持可点。根治「模型在 ```choices``` 围栏后随手带一句，导致用户合法待选卡被误灰无法点选」。
    const trailing = raw.slice(hit.end).trim()
    const substantial = trailing.length > 40 || /\n\s*\n/.test(trailing)
    if (substantial) staleIds.add(`choices-${hashText(hit.jsonText.trim())}`)
  }
  if (!staleIds.size) return blocks
  return blocks.map((block) => {
    if (block.type !== 'data' || block.name !== 'choices' || !staleIds.has(block.id)) return block
    const payload = (block.payload && typeof block.payload === 'object' ? block.payload : {}) as ChoicesCardPayload
    if (payload.superseded) return block
    return { ...block, payload: { ...payload, superseded: true } }
  })
}
