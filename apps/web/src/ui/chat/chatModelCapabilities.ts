import type { ModelOption } from '../../config/models'
import { THINKING_LEVELS, type ChatModelSettings } from './useChatModelSettings'

export type ChatModelCapabilities = { reasoning: boolean; priority: boolean; reasoningLevels: ReadonlyArray<ChatModelSettings['reasoningEffort']> }

/** Deterministic transport capabilities, never a user-intent or model-selection rule. */
export function chatModelCapabilities(model: string | null): ChatModelCapabilities {
  const reasoning = model === 'gpt-6-astra' || model?.startsWith('gpt-5') === true
  const gemini = model?.startsWith('gemini-3') === true
  const grok = model === 'grok-4.6' || model === 'grok-4.5'
  return {
    reasoningLevels: model === 'grok-4.5' ? ['low', 'medium', 'high'] : gemini ? ['minimal', 'low', 'medium', 'high'] : ['low', 'medium', 'high', 'xhigh'],
    reasoning: grok || gemini || reasoning || model === 'deepseek-v4-flash' || model === 'deepseek-v4-pro' || model === 'deepseek-v4.1-flash',
    // The current Harness provider schema has no serviceTier request override.
    priority: false,
  }
}

export function chatModelSettingsPayload(model: string, settings: ChatModelSettings): Partial<ChatModelSettings> {
  const capabilities = chatModelCapabilities(model)
  if (capabilities.reasoning && !capabilities.reasoningLevels.includes(settings.reasoningEffort)) {
    throw new Error('当前模型不支持所选思考程度，请重新选择思考程度。')
  }
  if (settings.serviceTier === 'priority') {
    throw new Error('当前执行引擎不支持优先服务，请关闭优先服务设置后重试。')
  }
  return {
    ...(capabilities.reasoning && capabilities.reasoningLevels.includes(settings.reasoningEffort) ? { reasoningEffort: settings.reasoningEffort } : {}),
    ...(capabilities.priority ? { serviceTier: settings.serviceTier } : {}),
  }
}

export function selectedModelCapabilities(option: ModelOption | null): ChatModelCapabilities {
  return chatModelCapabilities(option?.modelKey ?? option?.modelAlias ?? option?.value ?? null)
}

export function availableThinkingLevels(capabilities: ChatModelCapabilities) {
  return THINKING_LEVELS.filter((level) => capabilities.reasoningLevels.includes(level.value))
}
