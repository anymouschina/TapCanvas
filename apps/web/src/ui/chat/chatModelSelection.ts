import type { ModelOption } from '../../config/models'
import { findModelOptionByIdentifier } from '../../config/useModelOptions'

export const CHAT_MODEL_STORAGE_KEY = 'tapcanvas-chat-model'

type ChatModelSelectionStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export type SelectedChatModelRequest = {
  field: 'modelKey' | 'modelAlias'
  model: string
}

function readModelIdentifier(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

function resolveBrowserStorage(): ChatModelSelectionStorage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export function readStoredChatModelValue(
  storage: ChatModelSelectionStorage | null = resolveBrowserStorage(),
): string | null {
  if (!storage) return null
  try {
    return readModelIdentifier(storage.getItem(CHAT_MODEL_STORAGE_KEY)) || null
  } catch {
    return null
  }
}

export function persistChatModelValue(
  value: string | null,
  storage: ChatModelSelectionStorage | null = resolveBrowserStorage(),
): void {
  if (!storage) return
  const normalized = readModelIdentifier(value)
  try {
    if (normalized) storage.setItem(CHAT_MODEL_STORAGE_KEY, normalized)
    else storage.removeItem(CHAT_MODEL_STORAGE_KEY)
  } catch {
    // Preference storage can be unavailable in restricted browser contexts.
  }
}

/**
 * Resolve one catalog selection into the exact model identifier used by every
 * language-model call belonging to the chat turn. There is intentionally no
 * local default model: an incomplete catalog row makes the selection invalid.
 */
export function resolveSelectedChatModelRequest(
  option: ModelOption | null,
): SelectedChatModelRequest | null {
  if (!option) return null

  const modelKey = readModelIdentifier(option.modelKey)
  if (modelKey) return { field: 'modelKey', model: modelKey }

  const modelAlias = readModelIdentifier(option.modelAlias)
  if (modelAlias) return { field: 'modelAlias', model: modelAlias }

  const catalogValue = readModelIdentifier(option.value)
  return catalogValue ? { field: 'modelAlias', model: catalogValue } : null
}

export function requireSelectedChatModelRequest(
  options: readonly ModelOption[],
  selectedValue: string | null,
): SelectedChatModelRequest {
  const normalizedValue = readModelIdentifier(selectedValue)
  if (!normalizedValue) {
    throw new Error('小T 主对话尚未选择语言模型，请先在小T对话中选择一个可用模型。')
  }
  const option = findModelOptionByIdentifier(options, normalizedValue)
  if (!option) {
    throw new Error(`小T 当前选择的语言模型“${normalizedValue}”不在可执行模型目录中，请在小T对话中重新选择。`)
  }
  const request = resolveSelectedChatModelRequest(option)
  if (!request) {
    throw new Error(`小T 当前选择的语言模型“${normalizedValue}”缺少可执行模型标识，请修正系统模型目录。`)
  }
  return request
}

export function toAgentsChatModelPayload(
  request: SelectedChatModelRequest,
): { modelKey: string } | { modelAlias: string } {
  const model = readModelIdentifier(request.model)
  if (!model) throw new Error('小T 主对话语言模型标识为空。')
  return request.field === 'modelKey'
    ? { modelKey: model }
    : { modelAlias: model }
}
