import { useLocalStorage } from '@mantine/hooks'

export const THINKING_LEVELS = [
  { value: 'minimal', label: '极简' },
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
  { value: 'xhigh', label: '极高' },
] as const

export type ChatModelSettings = {
  reasoningEffort: typeof THINKING_LEVELS[number]['value']
  serviceTier: 'default' | 'priority'
}

export const DEFAULT_CHAT_MODEL_SETTINGS: ChatModelSettings = {
  reasoningEffort: 'medium',
  serviceTier: 'default',
}

export function useChatModelSettings() {
  const [settings, setSettings] = useLocalStorage<ChatModelSettings>({
    key: 'tapcanvas-chat-model-settings',
    defaultValue: DEFAULT_CHAT_MODEL_SETTINGS,
    getInitialValueInEffect: false,
  })
  return { settings, setSettings }
}
