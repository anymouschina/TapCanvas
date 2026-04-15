import type { Node } from '@xyflow/react'
import type { ProjectBookIndexDto } from '../api/server'
import { tryParseJsonLike } from '../canvas/nodes/taskNodeHelpers'

export type DerivedStyleHints = {
  styleName?: string
  visualDirectives?: string[]
  consistencyRules?: string[]
  negativeDirectives?: string[]
}

type PublicVisionResult = {
  text?: string
}

type PublicVisionFn = (input: {
  vendor: string
  modelKey: string
  imageUrl: string
  prompt: string
}) => Promise<PublicVisionResult | null | undefined>

type ConfirmProjectBookStyleFn = (
  projectId: string,
  bookId: string,
  payload: {
    styleName: string
    styleLocked: boolean
    visualDirectives: string[]
    consistencyRules: string[]
    negativeDirectives: string[]
    referenceImages: string[]
  },
) => Promise<ProjectBookIndexDto>

type CanvasStyleReferenceCandidate = {
  url: string
  label: string
}

function dedupeTrimmedList(values: readonly string[], limit: number): string[] {
  const seen = new Set<string>()
  const output: string[] = []
  for (const rawValue of values) {
    const value = String(rawValue || '').trim()
    if (!value || seen.has(value)) continue
    seen.add(value)
    output.push(value)
    if (output.length >= limit) break
  }
  return output
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

export function listCanvasStyleReferenceCandidates(nodes: readonly Node[]): CanvasStyleReferenceCandidate[] {
  const output: CanvasStyleReferenceCandidate[] = []
  const seen = new Set<string>()
  const pushCandidate = (url: string, label: string) => {
    const trimmedUrl = String(url || '').trim()
    if (!trimmedUrl || seen.has(trimmedUrl)) return
    seen.add(trimmedUrl)
    output.push({
      url: trimmedUrl,
      label: String(label || '').trim() || '画布图像',
    })
  }
  const pickNodeLabel = (node: Node): string => {
    const data = readRecord(node.data)
    const label = String(data?.label || data?.title || '').trim()
    if (label) return label
    const kind = String(data?.kind || '').trim()
    return kind ? `节点 ${kind}` : '画布图像'
  }
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index]
    if (!node) continue
    const data = readRecord(node.data) || {}
    const label = pickNodeLabel(node)
    const imageResults = Array.isArray(data.imageResults) ? data.imageResults : []
    for (const item of imageResults) {
      const itemRecord = readRecord(item)
      const resultUrl = String(itemRecord?.url || itemRecord?.imageUrl || '').trim()
      if (resultUrl) pushCandidate(resultUrl, label)
    }
    const lastResult = readRecord(data.lastResult)
    const preview = readRecord(lastResult?.preview)
    const previewType = String(preview?.type || '').trim().toLowerCase()
    const previewSrc = String(preview?.src || '').trim()
    if (previewType === 'image' && previewSrc) pushCandidate(previewSrc, label)
    const directUrl = String(data.imageUrl || data.url || '').trim()
    if (directUrl) pushCandidate(directUrl, label)
    if (output.length >= 24) break
  }
  return output
}

export async function deriveStyleHintsFromReferenceImage(
  imageUrl: string,
  publicVision: PublicVisionFn,
): Promise<DerivedStyleHints | null> {
  const normalizedUrl = String(imageUrl || '').trim()
  if (!normalizedUrl) return null
  const visionPrompt = [
    '请分析这张风格参考图，输出 JSON（不要 markdown）：',
    '{"styleName":"", "visualDirectives":[""], "consistencyRules":[""], "negativeDirectives":[""]}',
    '要求：',
    '1) visualDirectives 侧重画风与镜头视觉（构图、光影、色调、材质、笔触）。',
    '2) consistencyRules 侧重角色连续性（脸型、发型、服装、道具、时代）。',
    '3) negativeDirectives 写不应该出现的偏差（风格跑偏、错误时代元素、低质问题）。',
    '4) 每个数组 3-6 条，中文短句。',
  ].join('\n')
  try {
    const visionResult = await publicVision({
      vendor: 'auto',
      modelKey: 'gemini-3.1-flash-image-preview',
      imageUrl: normalizedUrl,
      prompt: visionPrompt,
    })
    const rawText = String(visionResult?.text || '').trim()
    if (!rawText) return null
    const parsed = tryParseJsonLike(rawText)
    const record = readRecord(parsed)
    if (!record) return null
    const styleName = String(record.styleName || '').trim()
    const visualDirectives = dedupeTrimmedList(Array.isArray(record.visualDirectives) ? record.visualDirectives.map(String) : [], 8)
    const consistencyRules = dedupeTrimmedList(Array.isArray(record.consistencyRules) ? record.consistencyRules.map(String) : [], 8)
    const negativeDirectives = dedupeTrimmedList(Array.isArray(record.negativeDirectives) ? record.negativeDirectives.map(String) : [], 8)
    if (!styleName && !visualDirectives.length && !consistencyRules.length && !negativeDirectives.length) {
      return null
    }
    return {
      ...(styleName ? { styleName } : null),
      ...(visualDirectives.length ? { visualDirectives } : null),
      ...(consistencyRules.length ? { consistencyRules } : null),
      ...(negativeDirectives.length ? { negativeDirectives } : null),
    }
  } catch (error) {
    console.warn('[styleReference] derive style hints failed', error)
    return null
  }
}

export async function persistStyleReferenceImage(input: {
  projectId: string
  bookId: string
  referenceUrl: string
  sourceLabel?: string
  deriveStyleHints: (url: string) => Promise<DerivedStyleHints | null>
  confirmProjectBookStyle: ConfirmProjectBookStyleFn
}): Promise<ProjectBookIndexDto> {
  const url = String(input.referenceUrl || '').trim()
  if (!url) {
    throw new Error('未找到可用参考图')
  }
  const derivedStyleHints = await input.deriveStyleHints(url)
  if (!derivedStyleHints) {
    throw new Error('风格参考图语义提炼失败：未返回可解析 JSON，请检查模型映射与 vision 输出后重试')
  }
  const payload = {
    styleName: String(derivedStyleHints.styleName || '').trim() || '参考图锁定风格',
    styleLocked: true,
    visualDirectives: dedupeTrimmedList(derivedStyleHints.visualDirectives || [], 12),
    consistencyRules: dedupeTrimmedList(derivedStyleHints.consistencyRules || [], 12),
    negativeDirectives: dedupeTrimmedList(derivedStyleHints.negativeDirectives || [], 12),
    referenceImages: [url],
  }
  const nextIndex = await input.confirmProjectBookStyle(input.projectId, input.bookId, payload)
  const nextAssets = readRecord(nextIndex.assets) || {}
  const nextStyleBible = readRecord(nextAssets.styleBible) || { styleName: '参考图锁定风格', styleLocked: true }
  const serverReferences = Array.isArray(nextStyleBible.referenceImages)
    ? dedupeTrimmedList(nextStyleBible.referenceImages.map(String), 1)
    : []
  return {
    ...nextIndex,
    assets: {
      ...nextAssets,
      styleBible: {
        ...nextStyleBible,
        referenceImages: serverReferences.length ? serverReferences : [url],
      },
    },
  }
}
