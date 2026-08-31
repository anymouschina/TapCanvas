import type {
  AdminAgentSkillDto,
  AdminAgentSkillUpsertInput,
  AdminLlmNodePresetDto,
  AdminLlmNodePresetUpsertInput,
  LlmNodePresetStyleReference,
  LlmNodePresetType,
} from '../../../../api/server'

export type SkillEditorState = {
  id?: string
  originalKey?: string
  key: string
  name: string
  description: string
  content: string
  logoUrl: string
  category: string
  enabled: boolean
  visible: boolean
  sortOrder: string
}

export type NodePresetEditorState = {
  id?: string
  title: string
  type: LlmNodePresetType | null
  prompt: string
  description: string
  referenceImageUrl: string
  styleReference?: LlmNodePresetStyleReference
  enabled: boolean
  sortOrder: string
}

export type EditorParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; message: string }

type OptionalIntegerResult =
  | { ok: true; value: number | null }
  | { ok: false; message: string }

type OptionalHttpUrlResult =
  | { ok: true; value: string | null }
  | { ok: false; message: string }

function parseOptionalInteger(rawValue: string, label: string): OptionalIntegerResult {
  const value = rawValue.trim()
  if (!value) return { ok: true, value: null }

  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) {
    return { ok: false, message: `${label}必须是安全整数` }
  }
  return { ok: true, value: parsed }
}

function parseOptionalHttpUrl(rawValue: string, label: string): OptionalHttpUrlResult {
  const value = rawValue.trim()
  if (!value) return { ok: true, value: null }

  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { ok: false, message: `${label} 必须使用 HTTP(S) URL` }
    }
    return { ok: true, value }
  } catch {
    return { ok: false, message: `${label} 不是有效 URL` }
  }
}

export function createSkillEditor(skill?: AdminAgentSkillDto): SkillEditorState {
  if (!skill) {
    return {
      key: '',
      name: '',
      description: '',
      content: '',
      logoUrl: '',
      category: '',
      enabled: true,
      visible: true,
      sortOrder: '',
    }
  }

  return {
    id: skill.id,
    originalKey: skill.key,
    key: skill.key,
    name: skill.name,
    description: skill.description ?? '',
    content: skill.content,
    logoUrl: skill.logoUrl ?? '',
    category: skill.category,
    enabled: skill.enabled,
    visible: skill.visible,
    sortOrder: skill.sortOrder == null ? '' : String(skill.sortOrder),
  }
}

export function parseSkillEditor(state: SkillEditorState): EditorParseResult<AdminAgentSkillUpsertInput> {
  const key = state.key.trim()
  const name = state.name.trim()
  const content = state.content.trim()
  const category = state.category.trim()

  if (!key) return { ok: false, message: 'Skill key 不能为空' }
  if (state.id && state.originalKey && key !== state.originalKey) {
    return { ok: false, message: '已有 Skill 的 key 不允许修改' }
  }
  if (!name) return { ok: false, message: 'Skill 名称不能为空' }
  if (!category) return { ok: false, message: 'Skill 分类不能为空' }
  if (!content) return { ok: false, message: 'Skill 内容不能为空' }

  const logoUrl = parseOptionalHttpUrl(state.logoUrl, 'Logo URL')
  if (!logoUrl.ok) return logoUrl
  const sortOrder = parseOptionalInteger(state.sortOrder, '排序值')
  if (!sortOrder.ok) return sortOrder

  return {
    ok: true,
    value: {
      ...(state.id ? { id: state.id } : {}),
      key,
      name,
      description: state.description.trim() || null,
      content,
      logoUrl: logoUrl.value,
      category,
      enabled: state.enabled,
      visible: state.visible,
      sortOrder: sortOrder.value,
    },
  }
}

export function createNodePresetEditor(preset?: AdminLlmNodePresetDto): NodePresetEditorState {
  if (!preset) {
    return {
      title: '',
      type: null,
      prompt: '',
      description: '',
      referenceImageUrl: '',
      enabled: true,
      sortOrder: '',
    }
  }

  return {
    id: preset.id,
    title: preset.title,
    type: preset.type,
    prompt: preset.prompt,
    description: preset.description ?? '',
    referenceImageUrl: preset.referenceImageUrl ?? '',
    ...(preset.styleReference ? { styleReference: preset.styleReference } : {}),
    enabled: preset.enabled,
    sortOrder: preset.sortOrder == null ? '' : String(preset.sortOrder),
  }
}

export function parseNodePresetEditor(
  state: NodePresetEditorState,
): EditorParseResult<AdminLlmNodePresetUpsertInput> {
  const title = state.title.trim()
  const prompt = state.prompt.trim()

  if (!title) return { ok: false, message: '预设名称不能为空' }
  if (!state.type) return { ok: false, message: '必须选择节点类型' }
  if (!prompt) return { ok: false, message: '提示词不能为空' }

  const referenceImageUrl = parseOptionalHttpUrl(state.referenceImageUrl, '参考图 URL')
  if (!referenceImageUrl.ok) return referenceImageUrl
  const sortOrder = parseOptionalInteger(state.sortOrder, '排序值')
  if (!sortOrder.ok) return sortOrder

  return {
    ok: true,
    value: {
      ...(state.id ? { id: state.id } : {}),
      title,
      type: state.type,
      prompt,
      description: state.description.trim() || null,
      referenceImageUrl: referenceImageUrl.value,
      ...(state.styleReference ? { styleReference: state.styleReference } : {}),
      enabled: state.enabled,
      sortOrder: sortOrder.value,
    },
  }
}

export function replaceById<T extends { id: string }>(items: T[], updated: T): T[] {
  const index = items.findIndex((item) => item.id === updated.id)
  if (index < 0) return [updated, ...items]
  return items.map((item) => (item.id === updated.id ? updated : item))
}
