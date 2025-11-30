/**
 * 模型配置 - 与TaskNode保持一致
 */
import { isAnthropicModel } from './modelSource'

export interface ModelOption {
  value: string
  label: string
  vendor?: string
}

export const TEXT_MODELS: ModelOption[] = [
  { value: 'gpt-5.1-codex', label: 'GPT-5.1 Codex', vendor: 'openai' },
  { value: 'glm-4.6', label: 'GLM-4.6 (Claude兼容)', vendor: 'anthropic' },
  { value: 'glm-4.5', label: 'GLM-4.5', vendor: 'anthropic' },
  { value: 'glm-4.5-air', label: 'GLM-4.5-Air', vendor: 'anthropic' },
  { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', vendor: 'gemini' },
  { value: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite', vendor: 'gemini' },
  { value: 'gemini-2.5-flash-think', label: 'Gemini 2.5 Flash Think', vendor: 'gemini' },
  { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', vendor: 'gemini' },
  { value: 'gemini-3-pro', label: 'Gemini 3 Pro', vendor: 'gemini' },
  { value: 'models/gemini-3-pro-preview', label: 'Gemini 3 Pro Preview', vendor: 'gemini' },
]

const DEFAULT_IMAGE_MODEL_VALUE = 'nano-banana-fast'

export const IMAGE_MODELS: ModelOption[] = [
  { value: 'nano-banana', label: 'Nano Banana', vendor: 'gemini' },
  { value: DEFAULT_IMAGE_MODEL_VALUE, label: 'Nano Banana Fast', vendor: 'gemini' },
  { value: 'nano-banana-pro', label: 'Nano Banana Pro', vendor: 'gemini' },
  { value: 'qwen-image-plus', label: 'Qwen Image Plus', vendor: 'qwen' },
  { value: 'gemini-2.5-flash-image', label: 'Gemini 2.5 Flash Image', vendor: 'gemini' },
  { value: 'sora-image', label: 'Sora Image (GPT Image 1)', vendor: 'openai' },
]

export const VIDEO_MODELS: ModelOption[] = [
  { value: 'sora-2', label: 'Sora 2', vendor: 'sora' },
  { value: 'veo3.1-pro', label: 'Veo 3.1 Pro', vendor: 'veo' },
  { value: 'veo3.1-fast', label: 'Veo 3.1 Fast', vendor: 'veo' },
]

export type NodeKind =
  | 'text'
  | 'image'
  | 'video'
  | 'composeVideo'
  | 'storyboard'
  | 'audio'
  | 'subtitle'
  | 'character'

export function getAllowedModelsByKind(kind?: NodeKind): ModelOption[] {
  switch (kind) {
    case 'image':
      return IMAGE_MODELS
    case 'composeVideo':
    case 'storyboard':
    case 'video':
      return VIDEO_MODELS
    case 'character':
      return TEXT_MODELS
    case 'text':
    default:
      return TEXT_MODELS
  }
}

export function getModelLabel(kind: NodeKind | undefined, modelValue: string): string {
  const models = getAllowedModelsByKind(kind)
  const model = models.find(m => m.value === modelValue)
  return model?.label || modelValue
}

export function getDefaultModel(kind?: NodeKind): string {
  if (kind === 'image') {
    return DEFAULT_IMAGE_MODEL_VALUE
  }
  const models = getAllowedModelsByKind(kind)
  return models[0]?.value || TEXT_MODELS[0].value
}

// Provider映射
export type AIProvider = 'openai' | 'anthropic' | 'google'

export const MODEL_PROVIDER_MAP: Record<string, AIProvider> = {
  'gpt-5.1-codex': 'openai',
  'glm-4.6': 'anthropic',
  'glm-4.5': 'anthropic',
  'glm-4.5-air': 'anthropic',
  'gemini-2.5-flash': 'google',
  'gemini-2.5-flash-lite': 'google',
  'gemini-2.5-flash-think': 'google',
  'gemini-2.5-pro': 'google',
  'gemini-3-pro': 'google',
  'models/gemini-3-pro-preview': 'google',
  'qwen-image-plus': 'openai', // 假设使用OpenAI
  'gemini-2.5-flash-image': 'google',
  'sora-image': 'openai',
  'nano-banana': 'google',
  'nano-banana-fast': 'google',
  'nano-banana-pro': 'google',
  'sora-2': 'openai', // 假设使用OpenAI
  'veo3.1-pro': 'google',
  'veo3.1-fast': 'google',
}

const IMAGE_EDIT_MODELS = new Set(['nano-banana', DEFAULT_IMAGE_MODEL_VALUE, 'nano-banana-pro'])

const normalizeModelId = (value: string | undefined | null): string => {
  if (!value) return ''
  return value.startsWith('models/') ? value.slice(7) : value
}

export function isImageEditModel(modelValue?: string | null): boolean {
  const normalized = normalizeModelId(modelValue || '')
  return normalized ? IMAGE_EDIT_MODELS.has(normalized) : false
}

export function getModelProvider(modelValue: string): AIProvider {
  if (MODEL_PROVIDER_MAP[modelValue]) return MODEL_PROVIDER_MAP[modelValue]
  const lower = modelValue.toLowerCase()
  // 动态列表（/v1/models）返回的ID会被标记
  if (isAnthropicModel(modelValue)) return 'anthropic'
  if (lower.includes('claude') || lower.includes('glm')) return 'anthropic'
  if (lower.includes('gemini')) return 'google'
  if (lower.includes('gpt') || lower.includes('openai') || lower.includes('o3-')) return 'openai'
  if (lower.includes('qwen')) return 'openai'
  return 'google'
}
