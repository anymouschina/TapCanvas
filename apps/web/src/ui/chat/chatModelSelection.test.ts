import { describe, expect, it } from 'vitest'

import type { ModelOption } from '../../config/models'
import {
  CHAT_MODEL_STORAGE_KEY,
  persistChatModelValue,
  readStoredChatModelValue,
  requireSelectedChatModelRequest,
  resolveSelectedChatModelRequest,
  toAgentsChatModelPayload,
} from './chatModelSelection'

describe('chat model selection', () => {
  it('uses the exact catalog request model for the main turn and its auxiliary language calls', () => {
    const option: ModelOption = {
      value: 'GPT-5.6 Terra',
      label: 'GPT-5.6 Terra',
      modelKey: 'gpt-5.6-terra',
      modelAlias: 'gpt-5.6',
    }

    const request = resolveSelectedChatModelRequest(option)

    expect(request).toEqual({ field: 'modelKey', model: 'gpt-5.6-terra' })
    expect(request && toAgentsChatModelPayload(request)).toEqual({ modelKey: 'gpt-5.6-terra' })
  })

  it('uses the catalog alias only when the catalog has no request model key', () => {
    const option: ModelOption = {
      value: 'claude-sonnet',
      label: 'Claude Sonnet',
      modelAlias: 'claude-sonnet-4-6',
    }

    const request = resolveSelectedChatModelRequest(option)

    expect(request).toEqual({ field: 'modelAlias', model: 'claude-sonnet-4-6' })
    expect(request && toAgentsChatModelPayload(request)).toEqual({ modelAlias: 'claude-sonnet-4-6' })
  })

  it('does not invent a default when no catalog model is selected', () => {
    expect(resolveSelectedChatModelRequest(null)).toBeNull()
    expect(() => requireSelectedChatModelRequest([], null)).toThrow('尚未选择语言模型')
  })

  it('shares the exact persisted main-chat selection with node-triggered Agents turns', () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string): string | null => values.get(key) ?? null,
      setItem: (key: string, value: string): void => { values.set(key, value) },
      removeItem: (key: string): void => { values.delete(key) },
    }
    const options: ModelOption[] = [{
      value: 'GPT-5.6 Terra',
      label: 'GPT-5.6 Terra',
      modelKey: 'gpt-5.6-terra',
      modelAlias: 'gpt-5.6',
    }]

    persistChatModelValue(' GPT-5.6 Terra ', storage)
    const selectedValue = readStoredChatModelValue(storage)

    expect(values.get(CHAT_MODEL_STORAGE_KEY)).toBe('GPT-5.6 Terra')
    expect(requireSelectedChatModelRequest(options, selectedValue)).toEqual({
      field: 'modelKey',
      model: 'gpt-5.6-terra',
    })
  })

  it('fails explicitly when the persisted selection is no longer executable', () => {
    expect(() => requireSelectedChatModelRequest([], 'disabled-model')).toThrow(
      '不在可执行模型目录中',
    )
    expect(() => toAgentsChatModelPayload({ field: 'modelKey', model: '   ' })).toThrow(
      '语言模型标识为空',
    )
  })

})
