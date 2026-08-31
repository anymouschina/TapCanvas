import { getChatSessionConversationScope } from './chatSessionKey'

const CHAT_SESSION_TITLE_STORE_KEY = 'tc-chat-session-titles-v1'
const CHAT_SESSION_LANGUAGE_MODEL_STORE_KEY = 'tc-chat-session-language-models-v2'
const CHAT_SESSION_STORE_LIMIT = 200

type StringStore = Record<string, string>

export type ChatSessionTitleGenerationState = {
  key: string
  state: 'idle' | 'generating' | 'succeeded' | 'failed' | 'unavailable'
}

export type SessionTitleLlmRequest = {
  purpose: 'conversation_title'
  model: string
  systemPrompt: string
  userPrompt: string
  temperature: number
  maxTokens: number
}

export function isSessionTitleEligibleAssistantMessage(message: {
  role: string
  content: string
  phase?: string
  kind?: string
  logicalTaskStatus?: string
}): boolean {
  return message.role === 'assistant' &&
    message.phase === 'final' &&
    message.kind === 'result' &&
    message.logicalTaskStatus === 'succeeded' &&
    message.content.trim().length > 0
}

function readStringStore(storageKey: string): StringStore {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const store: StringStore = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string' && value.trim()) store[key] = value.trim()
    }
    return store
  } catch {
    return {}
  }
}

function writeStringStoreValue(
  storageKey: string,
  entryKey: string,
  value: string,
  overwrite: boolean,
): void {
  if (typeof window === 'undefined') return
  const key = entryKey.trim()
  const normalizedValue = value.trim()
  if (!key || !normalizedValue) return
  try {
    const store = readStringStore(storageKey)
    if (!overwrite && store[key]) return
    store[key] = normalizedValue
    const keys = Object.keys(store)
    if (keys.length > CHAT_SESSION_STORE_LIMIT) {
      for (const drop of keys.slice(0, keys.length - CHAT_SESSION_STORE_LIMIT)) delete store[drop]
    }
    window.localStorage.setItem(storageKey, JSON.stringify(store))
  } catch {
    // Storage failure must not mutate the model request or generate a substitute title.
  }
}

export function readChatSessionTitle(key: string): string {
  const normalizedKey = key.trim()
  return normalizedKey ? readStringStore(CHAT_SESSION_TITLE_STORE_KEY)[normalizedKey] || '' : ''
}

export function writeChatSessionTitle(key: string, title: string): void {
  writeStringStoreValue(CHAT_SESSION_TITLE_STORE_KEY, key, title, true)
}

export function readChatSessionLanguageModel(key: string): string {
  const normalizedKey = getChatSessionConversationScope(key)
  return normalizedKey
    ? readStringStore(CHAT_SESSION_LANGUAGE_MODEL_STORE_KEY)[normalizedKey] || ''
    : ''
}

/**
 * Bind once to the stable conversation identity. Lane and skill suffixes may
 * change within one conversation and must not fork its first-turn provenance.
 */
export function bindChatSessionLanguageModel(key: string, model: string): void {
  writeStringStoreValue(
    CHAT_SESSION_LANGUAGE_MODEL_STORE_KEY,
    getChatSessionConversationScope(key),
    model,
    false,
  )
}

export function shouldBindChatSessionLanguageModel(
  messages: readonly { role: string; content: string }[],
): boolean {
  return !messages.some(
    (message) => message.role === 'user' && message.content.trim().length > 0,
  )
}

export function reconcileChatSessionTitleGenerationState(
  current: ChatSessionTitleGenerationState,
  nextKey: string,
): ChatSessionTitleGenerationState {
  const normalizedNextKey = nextKey.trim()
  const nextScope = getChatSessionConversationScope(normalizedNextKey)
  if (!nextScope || getChatSessionConversationScope(current.key) !== nextScope) {
    return { key: normalizedNextKey, state: 'idle' }
  }
  return { key: normalizedNextKey, state: current.state }
}

export function sanitizeSessionTitle(raw: string): string {
  const cleaned = raw
    .replace(/[\r\n]+/g, ' ')
    .replace(/^(标题|title)\s*[:：]\s*/i, '')
    .replace(/^["'「『《【\[(（\s]+/, '')
    .replace(/["'」』》】\])）\s]+$/, '')
    .trim()
  if (!cleaned) return ''
  return cleaned.length > 18 ? `${cleaned.slice(0, 18)}…` : cleaned
}

export function buildSessionTitleLlmRequest(input: {
  model: string
  userText: string
  assistantText: string
}): SessionTitleLlmRequest {
  const model = input.model.trim()
  if (!model) throw new Error('会话标题缺少首轮语言模型事实')
  return {
    purpose: 'conversation_title',
    model,
    systemPrompt:
      '你是会话标题助手。根据用户与助手的对话，用简体中文生成一个不超过12个字、能概括主题的短标题。只输出标题本身，禁止引号、标点、前缀或任何解释。',
    userPrompt: `用户：${input.userText.trim().slice(0, 400)}\n助手：${input.assistantText.trim().slice(0, 400)}`,
    temperature: 0.3,
    maxTokens: 32,
  }
}
