/**
 * 模型配置 - 与TaskNode保持一致
 */
import { isAnthropicModel } from './modelSource'

export interface ModelOption {
  value: string
  label: string
}

export const TEXT_MODELS: ModelOption[] = [
  { value: 'glm-4.6', label: 'GLM-4.6 (Claude兼容)' },
  { value: 'glm-4.5', label: 'GLM-4.5' },
  { value: 'glm-4.5-air', label: 'GLM-4.5-Air' },
  { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
  { value: 'models/gemini-3-pro-preview', label: 'Gemini 3 Pro Preview' },
]

export const IMAGE_MODELS: ModelOption[] = [
  { value: 'qwen-image-plus', label: 'Qwen Image Plus' },
  { value: 'gemini-2.5-flash-image', label: 'Gemini 2.5 Flash Image' }
]

export const VIDEO_MODELS: ModelOption[] = [{ value: 'sora-2', label: 'Sora 2' }]

export type NodeKind =
  | 'text'
  | 'textToImage'
  | 'image'
  | 'coverImage'
  | 'video'
  | 'composeVideo'
  | 'storyboard'
  | 'audio'
  | 'subtitle'
  | 'character'

export function getAllowedModelsByKind(kind?: NodeKind): ModelOption[] {
  switch (kind) {
    case 'textToImage':
    case 'coverImage':
      return TEXT_MODELS
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
  const models = getAllowedModelsByKind(kind)
  return models[0]?.value || TEXT_MODELS[0].value
}

// Provider映射
export type AIProvider = 'openai' | 'anthropic' | 'google'

export const MODEL_PROVIDER_MAP: Record<string, AIProvider> = {
  'glm-4.6': 'anthropic',
  'glm-4.5': 'anthropic',
  'glm-4.5-air': 'anthropic',
  'gemini-2.5-flash': 'google',
  'gemini-2.5-pro': 'google',
  'models/gemini-3-pro-preview': 'google',
  'qwen-image-plus': 'openai', // 假设使用OpenAI
  'gemini-2.5-flash-image': 'google',
  'sora-2': 'openai', // 假设使用OpenAI
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
