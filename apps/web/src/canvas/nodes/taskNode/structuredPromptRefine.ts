import { parseImagePromptSpecV2, type ImagePromptSpecV2 } from '@tapcanvas/image-prompt-spec'
import { runPublicTask } from '../../../api/server'
import { getAuthToken } from '../../../auth/store'
import { useUIStore } from '../../../ui/uiStore'
import { extractTextFromTaskResult } from '../taskNodeHelpers'

type RefineStructuredPromptInput = {
  prompt: string
  negativePrompt?: string
  systemPrompt?: string
  modelAlias?: string
  productionMetadata?: unknown
}

type UnknownRecord = Record<string, unknown>

function asRecord(value: unknown): UnknownRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as UnknownRecord
}

function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readStringList(value: unknown): string[] {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed ? [trimmed] : []
  }
  if (!Array.isArray(value)) return []
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
}

function extractJsonPayload(raw: string): unknown {
  const trimmed = raw.trim()
  if (!trimmed) throw new Error('模型未返回结构化 JSON')

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fencedMatch ? fencedMatch[1].trim() : trimmed
  return JSON.parse(candidate) as unknown
}

function buildLockedAnchorLines(productionMetadata: unknown): string[] {
  const metadata = asRecord(productionMetadata)
  const lockedAnchors = asRecord(metadata?.lockedAnchors)
  if (!lockedAnchors) return []

  const sections: Array<{ label: string; values: string[] }> = [
    { label: '角色锚点', values: readStringList(lockedAnchors.character) },
    { label: '场景锚点', values: readStringList(lockedAnchors.scene) },
    { label: '镜头锚点', values: readStringList(lockedAnchors.shot) },
    { label: '连续性锚点', values: readStringList(lockedAnchors.continuity) },
    { label: '缺失项', values: readStringList(lockedAnchors.missing) },
  ]

  return sections
    .filter((section) => section.values.length > 0)
    .map((section) => `${section.label}：${section.values.join('；')}`)
}

export async function refineStructuredImagePrompt(
  input: RefineStructuredPromptInput,
): Promise<ImagePromptSpecV2> {
  const prompt = readTrimmedString(input.prompt)
  if (!prompt) {
    throw new Error('缺少 prompt，无法生成结构化 JSON')
  }

  const ui = useUIStore.getState()
  const apiKey = (ui.publicApiKey || '').trim()
  const token = getAuthToken()
  if (!apiKey && !token) {
    throw new Error('请先登录后再试')
  }

  const vendorCandidates = Array.isArray(ui.publicVendorCandidates) ? ui.publicVendorCandidates : []
  const extraSystemPrompt = readTrimmedString(input.systemPrompt)
  const anchorLines = buildLockedAnchorLines(input.productionMetadata)
  const negativePrompt = readTrimmedString(input.negativePrompt)

  const systemPrompt = [
    '你是 TapCanvas 的结构化图片提示词整理助手。',
    '你的任务是把当前图片 prompt 变成与其等价、但更规整可执行的 JSON 结构。',
    '输出必须是单个 JSON 对象，不要 Markdown，不要代码块，不要解释。',
    '字段必须严格限制为：version, shotIntent, spatialLayout, subjectRelations, environmentObjects, cameraPlan, lightingPlan, styleConstraints, continuityConstraints, negativeConstraints。',
    'version 必须恒为 "v2"。',
    '除 shotIntent 外，其余字段都必须输出 string[]；没有内容时输出空数组，不要省略字段。',
    '在不改变核心意图的前提下去重、补齐空间关系、主体关系、镜头、光线、连续性和禁止项，使其更稳定。',
    '不要引入现代、科幻、卡通等与原 prompt 冲突的新设定。',
  ].join('\n')

  const promptText = [
    extraSystemPrompt ? `补充润色偏好：\n${extraSystemPrompt}` : null,
    '当前图片 prompt：',
    prompt,
    negativePrompt ? `negativePrompt：\n${negativePrompt}` : null,
    anchorLines.length > 0 ? `已确认锚点：\n${anchorLines.join('\n')}` : null,
    [
      '请直接返回 JSON，对当前 prompt 做结构化整理。',
      'JSON 字段说明：',
      '- shotIntent: 一句话锁定主体、场景、关键动作和画面目标。',
      '- spatialLayout: 明确前景/中景/背景和主体位置。',
      '- subjectRelations: 明确人物或主体之间关系。',
      '- environmentObjects: 场景关键物件。',
      '- cameraPlan: 画幅、景别、机位、视觉焦点。',
      '- lightingPlan: 时间、主光、补光、一致性等。',
      '- styleConstraints: 风格和材质限制。',
      '- continuityConstraints: 连续性、角色外观、物理规则等。',
      '- negativeConstraints: 禁止出现的内容。',
    ].join('\n'),
  ]
    .filter(Boolean)
    .join('\n\n')

  const taskRes = await runPublicTask(apiKey, {
    vendor: 'auto',
    ...(vendorCandidates.length > 0 ? { vendorCandidates } : {}),
    request: {
      kind: 'prompt_refine',
      prompt: promptText,
      extras: {
        systemPrompt,
        ...(input.modelAlias ? { modelAlias: input.modelAlias } : {}),
        persistAssets: false,
      },
    },
  })

  const rawText = extractTextFromTaskResult(taskRes.result).trim()
  const parsedPayload = extractJsonPayload(rawText)
  const parsedSpec = parseImagePromptSpecV2(parsedPayload)
  if (!parsedSpec.ok || !parsedSpec.value) {
    const reason = parsedSpec.ok ? '缺少有效结构化内容' : parsedSpec.error
    throw new Error(`结构化 JSON 非法：${reason}`)
  }

  return parsedSpec.value
}
