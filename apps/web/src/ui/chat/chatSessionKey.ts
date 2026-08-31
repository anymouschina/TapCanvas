type BuildEffectiveChatSessionKeyInput = {
  persistedBaseKey: string | null | undefined
  projectId: string | null | undefined
  flowId: string | null | undefined
  /** Stable local canvas/flow identity used when no project owns the chat. */
  canvasId?: string | null | undefined
  // 章节画布的权威作用域。存在时按 chapter 维度隔离会话，优先于 flow，
  // 避免「会话 key 无 chapterId + project/flow 取自滞后 uiStore」导致的跨项目/章节串台。
  chapterId?: string | null | undefined
  skillId: string | null | undefined
  lane: ChatSessionLane
}

// 'director:<nodeId>' = 导演台运行模式；在项目作用域下仍归一到同一 general
// 会话，节点 ID 作为本轮导演上下文传递，不再创建第二条历史源。
export type ChatSessionLane = 'general' | 'director' | `director:${string}`

function normalizeSegment(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function buildProjectScopedChatSessionBaseKey(input: {
  projectId: string | null | undefined
  flowId: string | null | undefined
  chapterId?: string | null | undefined
}): string {
  const projectId = normalizeSegment(input.projectId)
  if (!projectId) return ''
  // 章节画布：用 project + chapter 作为会话作用域（与 chapterContext 同源），不落 flow。
  const chapterId = normalizeSegment(input.chapterId)
  if (chapterId) return `project:${projectId}:chapter:${chapterId}`
  const flowId = normalizeSegment(input.flowId)
  return flowId ? `project:${projectId}:flow:${flowId}` : `project:${projectId}`
}

/**
 * 发送瞬间现读的最终会话作用域。首页挂起 prompt 经 setTimeout 触发、排队消息跨回合
 * 重发时，渲染闭包里的 sessionScope* 可能还停在 SPA 导航前的旧值（currentProject
 * 已切新项目、currentFlow 未重置），必须按「现读 store 快照」解析最终
 * project/flow/chapter 作用域与导演台锚点，再拼会话 key——否则消息落进旧作用域会话，
 * 前端 history 按新作用域加载时看不到刚发的消息。
 */
export interface LiveChatSessionScope {
  projectId: string
  flowId: string
  chapterId: string
  directorNodeId: string
  scopeKey: string
}

export function resolveLiveChatSessionScope(state: {
  currentChapter?: { projectId?: string | null; chapterId?: string | null } | null
  currentProject?: { id?: string | null } | null
  currentFlow?: {
    id?: string | null
    name?: string | null
    source?: 'local' | 'server' | string | null
    ownerType?: 'project' | 'chapter' | 'shot' | null
    ownerId?: string | null
  } | null
  directorChatScopeNodeId?: string | null
}): LiveChatSessionScope {
  const chapterId = normalizeSegment(state.currentChapter?.chapterId)
  // 章节画布用权威 project（currentChapter.projectId）；非章节回退 currentProject。
  const projectId =
    (chapterId ? normalizeSegment(state.currentChapter?.projectId) : '')
    || normalizeSegment(state.currentProject?.id)
  // 章节会话以 chapterId 为准，不落 flow 维度。
  const rawFlowId = chapterId ? '' : normalizeSegment(state.currentFlow?.id)
  // flow 归属与当前项目不符（项目切换窗口期的残留）时宁可不带 flowId，
  // 交给服务端按项目自动解析/创建。
  const flowOwnerId = normalizeSegment(state.currentFlow?.ownerId)
  const flowId =
    rawFlowId
    && state.currentFlow?.ownerType === 'project'
    && flowOwnerId
    && flowOwnerId !== projectId
      ? ''
      : rawFlowId
  const directorNodeId = normalizeSegment(state.directorChatScopeNodeId)
  const scopeKey = buildProjectScopedChatSessionBaseKey({ projectId, flowId, chapterId })
  return { projectId, flowId, chapterId, directorNodeId, scopeKey }
}

export function buildEffectiveChatSessionKey(input: BuildEffectiveChatSessionKeyInput): string {
  const projectScopedBaseKey = buildProjectScopedChatSessionBaseKey({
    projectId: input.projectId,
    flowId: input.flowId,
    chapterId: input.chapterId,
  })
  const persistedBaseKey = normalizeSegment(input.persistedBaseKey)
  // A project/flow/chapter chat has one durable conversation source. A random
  // client conversation base made the same canvas produce several physical
  // sessions, and the old restore path could then pick whichever one happened
  // to be most recent. Project canvases use their real project scope; local
  // canvases use their stable canvas identity, with the base key reserved for
  // the stateless/home surface.
  const canvasId = normalizeSegment(input.canvasId)
  const canvasScopedBaseKey = !projectScopedBaseKey && canvasId
    ? `canvas:${canvasId}`
    : persistedBaseKey
  const baseKey = projectScopedBaseKey || canvasScopedBaseKey
  if (!baseKey) return ''
  // Skills and director-node modes are capabilities inside the same canvas
  // conversation, not another source of conversation history. The durable
  // session key must therefore be stable while a skill or director context is
  // selected or cleared.
  const skillId = projectScopedBaseKey ? 'default' : normalizeSegment(input.skillId) || 'default'
  const lane = projectScopedBaseKey ? 'general' : normalizeSegment(input.lane) || 'general'
  return `${baseKey}:lane:${lane}:skill:${skillId}`
}

export function resolveChatSessionLane(input: {
  hasReplicateTarget: boolean
}): ChatSessionLane {
  void input.hasReplicateTarget
  return 'general'
}

// 会话 base key 在 localStorage 里是「全局单值」，跨项目复用，决定有效 key 里
// 是否带 `:conversation:<base>` 段。空 base = 该作用域的「默认会话」（无 conversation 段）。
const CHAT_SESSION_STORAGE_KEY = 'tapcanvas.aiChat.sessionBaseKey.v1'

export function createChatSessionBaseKey(): string {
  const seed = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  return `canvas-${seed}`
}

// 忠实持久化传入的 base：非空则写入，空则清除（而非当场铸造新 key）。
// 旧版「空→铸新 key」会让「恢复无 conversation 段的默认会话」时，有效 key 被塞回一个
// 全新的 `:conversation:` 段，永远匹配不上库里那条历史 → 恢复出来是空对话。
// 只有显式「新对话」路径会主动传入 createChatSessionBaseKey()，故此处不再兜底铸造。
export function persistChatSessionBaseKey(nextKey: string | null | undefined): string {
  const next = normalizeSegment(nextKey)
  try {
    if (typeof window !== 'undefined') {
      if (next) {
        window.localStorage.setItem(CHAT_SESSION_STORAGE_KEY, next)
      } else {
        window.localStorage.removeItem(CHAT_SESSION_STORAGE_KEY)
      }
    }
  } catch {
    // ignore
  }
  return next
}

export function readOrCreateChatSessionBaseKey(): string {
  try {
    if (typeof window === 'undefined') return createChatSessionBaseKey()
    const existing = normalizeSegment(window.localStorage.getItem(CHAT_SESSION_STORAGE_KEY))
    if (existing) return existing
    const created = createChatSessionBaseKey()
    window.localStorage.setItem(CHAT_SESSION_STORAGE_KEY, created)
    return created
  } catch {
    return createChatSessionBaseKey()
  }
}

// 按作用域记忆会话 base：scope（project / project:flow / project:chapter 的 base key）→
// 该作用域最近使用的 conversation base。根治「base 全局单值」的传染问题——
// 在 A 项目点「新对话/选 skill」旋转 base 后，点进 B 章节拼出的 key 带上新 base，
// 永远对不上 B 章节写入时的 conversation 段，历史看着像丢了（实际都在库里）。
const CHAT_SESSION_SCOPED_STORAGE_KEY = 'tapcanvas.aiChat.sessionBaseKeyByScope.v1'
const CHAT_SESSION_SCOPED_MAX_ENTRIES = 60

type ScopedBaseKeyEntry = { base: string; at: number }

function readScopedBaseKeyMap(): Record<string, ScopedBaseKeyEntry> {
  try {
    if (typeof window === 'undefined') return {}
    const raw = window.localStorage.getItem(CHAT_SESSION_SCOPED_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: Record<string, ScopedBaseKeyEntry> = {}
    for (const [scope, entry] of Object.entries(parsed as Record<string, unknown>)) {
      if (!scope || !entry || typeof entry !== 'object') continue
      const base = (entry as ScopedBaseKeyEntry).base
      const at = (entry as ScopedBaseKeyEntry).at
      if (typeof base !== 'string' || typeof at !== 'number') continue
      out[scope] = { base, at }
    }
    return out
  } catch {
    return {}
  }
}

// 读某作用域记住的 base。返回 null = 从没记过（调用方应去服务端解析该作用域最近会话）；
// 返回 '' = 显式记过「默认会话」（无 conversation 段），两者语义不同，不能混。
export function readScopedChatSessionBaseKey(scopeKey: string | null | undefined): string | null {
  const scope = normalizeSegment(scopeKey)
  if (!scope) return null
  const entry = readScopedBaseKeyMap()[scope]
  return entry ? entry.base : null
}

export function persistScopedChatSessionBaseKey(
  scopeKey: string | null | undefined,
  baseKey: string | null | undefined,
): string {
  const scope = normalizeSegment(scopeKey)
  const base = normalizeSegment(baseKey)
  if (!scope) return base
  try {
    if (typeof window === 'undefined') return base
    const map = readScopedBaseKeyMap()
    // 删后重插：用对象插入序表达新近度（同毫秒批量写入时 at 排序不稳），尾部=最新。
    delete map[scope]
    map[scope] = { base, at: Date.now() }
    const entries = Object.entries(map)
    if (entries.length > CHAT_SESSION_SCOPED_MAX_ENTRIES) {
      entries.splice(0, entries.length - CHAT_SESSION_SCOPED_MAX_ENTRIES)
    }
    window.localStorage.setItem(CHAT_SESSION_SCOPED_STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)))
  } catch {
    // ignore
  }
  return base
}

// 从一条历史 sessionKey 反解出恢复时应使用的 base。
// 命名会话取 `:conversation:<base>:lane:` 段；项目/flow/章节的默认会话（不含该段，
// 例如辅助创作 API 用的 project:<id>:flow:<flowId>:lane:general:skill:default）返回 ''，
// 表示「回到该作用域的默认会话」，调用方据此清空 base 而非铸造新 key。
// 与 buildEffectiveChatSessionKey 互逆：build(resolveRestoredBaseKey(K), scope) === K。
export function resolveRestoredBaseKey(sessionKey: string | null | undefined): string {
  const key = normalizeSegment(sessionKey)
  const match = key.match(/:conversation:([^:]+):lane:/)
  return match?.[1] ?? ''
}

// The conversation identity = everything before the `:lane:` suffix
// (project/flow/chapter/conversation). The lane/skill suffix can churn within the
// same ongoing conversation (e.g. a skill auto-resolves for one send) without it
// being a genuine session switch, so we key the "should I wipe messages?" decision
// on this stable scope rather than the full session key.
export function getChatSessionConversationScope(sessionKey: string | null | undefined): string {
  const key = normalizeSegment(sessionKey)
  if (!key) return ''
  const laneIndex = key.indexOf(':lane:')
  return laneIndex === -1 ? key : key.slice(0, laneIndex)
}

export function isSameChatConversationScope(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  return getChatSessionConversationScope(a) === getChatSessionConversationScope(b)
}

export function isProjectOnlyChatSessionScope(input: {
  sessionKey: string | null | undefined
  projectId: string | null | undefined
  flowId: string | null | undefined
  chapterId: string | null | undefined
}): boolean {
  const projectId = normalizeSegment(input.projectId)
  if (!projectId || normalizeSegment(input.flowId) || normalizeSegment(input.chapterId)) return false
  const conversationScope = getChatSessionConversationScope(input.sessionKey)
  const projectScope = `project:${projectId}`
  return conversationScope === projectScope
    || conversationScope.startsWith(`${projectScope}:conversation:`)
}

export function shouldPreserveOwnedChatScopeTransition(input: {
  previousSessionKey: string | null | undefined
  nextSessionKey: string | null | undefined
  pendingOwnedScope: string | null | undefined
  activeStreamScope: string | null | undefined
  hasActiveStream: boolean
}): boolean {
  if (isSameChatConversationScope(input.previousSessionKey, input.nextSessionKey)) return false
  const nextScope = getChatSessionConversationScope(input.nextSessionKey)
  if (!nextScope) return false
  return nextScope === normalizeSegment(input.pendingOwnedScope)
    || (input.hasActiveStream && nextScope === normalizeSegment(input.activeStreamScope))
}
