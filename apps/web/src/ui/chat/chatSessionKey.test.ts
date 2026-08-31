// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'

import {
  buildEffectiveChatSessionKey,
  getChatSessionConversationScope,
  isProjectOnlyChatSessionScope,
  isSameChatConversationScope,
  persistChatSessionBaseKey,
  persistScopedChatSessionBaseKey,
  readOrCreateChatSessionBaseKey,
  readScopedChatSessionBaseKey,
  resolveLiveChatSessionScope,
  resolveRestoredBaseKey,
  shouldPreserveOwnedChatScopeTransition,
} from './chatSessionKey'

const STORAGE_KEY = 'tapcanvas.aiChat.sessionBaseKey.v1'
const SCOPED_STORAGE_KEY = 'tapcanvas.aiChat.sessionBaseKeyByScope.v1'

describe('getChatSessionConversationScope', () => {
  it('strips the lane/skill suffix so only the conversation identity remains', () => {
    expect(
      getChatSessionConversationScope('project:P:flow:F:conversation:C:lane:general:skill:default'),
    ).toBe('project:P:flow:F:conversation:C')
  })

  it('handles keys without a conversation segment', () => {
    expect(getChatSessionConversationScope('project:P:flow:F:lane:general:skill:default')).toBe(
      'project:P:flow:F',
    )
  })

  it('returns empty for empty input', () => {
    expect(getChatSessionConversationScope('')).toBe('')
  })
})

describe('isSameChatConversationScope', () => {
  it('treats a skill-only change within the same conversation as the same scope', () => {
    const base = 'project:P:flow:F:conversation:C'
    expect(
      isSameChatConversationScope(
        `${base}:lane:general:skill:default`,
        `${base}:lane:general:skill:storyboard`,
      ),
    ).toBe(true)
  })

  it('treats a different project/flow/conversation as a different scope', () => {
    expect(
      isSameChatConversationScope(
        'project:P:flow:F:conversation:C:lane:general:skill:default',
        'project:P:flow:G:conversation:C:lane:general:skill:default',
      ),
    ).toBe(false)
    expect(
      isSameChatConversationScope(
        'project:P:flow:F:conversation:C1:lane:general:skill:default',
        'project:P:flow:F:conversation:C2:lane:general:skill:default',
      ),
    ).toBe(false)
  })
})

describe('isProjectOnlyChatSessionScope', () => {
  it('recognizes both default and named project-only intermediate scopes', () => {
    expect(isProjectOnlyChatSessionScope({
      sessionKey: 'project:P:lane:general:skill:default',
      projectId: 'P',
      flowId: '',
      chapterId: '',
    })).toBe(true)
    expect(isProjectOnlyChatSessionScope({
      sessionKey: 'project:P:conversation:C:lane:general:skill:default',
      projectId: 'P',
      flowId: '',
      chapterId: '',
    })).toBe(true)
  })

  it('does not classify resolved flow or chapter scopes as project-only', () => {
    expect(isProjectOnlyChatSessionScope({
      sessionKey: 'project:P:flow:F:lane:general:skill:default',
      projectId: 'P',
      flowId: 'F',
      chapterId: '',
    })).toBe(false)
    expect(isProjectOnlyChatSessionScope({
      sessionKey: 'project:P:chapter:C:lane:general:skill:default',
      projectId: 'P',
      flowId: '',
      chapterId: 'C',
    })).toBe(false)
  })
})

describe('shouldPreserveOwnedChatScopeTransition', () => {
  const previousSessionKey =
    'project:P:chapter:CH:conversation:canvas-old:lane:general:skill:default'
  const nextSessionKey =
    'project:P:chapter:CH:conversation:canvas-new:lane:general:skill:default'
  const nextScope = 'project:P:chapter:CH:conversation:canvas-new'

  it('preserves a fresh-conversation transition before the stream has attached', () => {
    expect(shouldPreserveOwnedChatScopeTransition({
      previousSessionKey,
      nextSessionKey,
      pendingOwnedScope: nextScope,
      activeStreamScope: '',
      hasActiveStream: false,
    })).toBe(true)
  })

  it('preserves the transition after the active stream has claimed the new scope', () => {
    expect(shouldPreserveOwnedChatScopeTransition({
      previousSessionKey,
      nextSessionKey,
      pendingOwnedScope: '',
      activeStreamScope: nextScope,
      hasActiveStream: true,
    })).toBe(true)
  })

  it('does not preserve a real navigation to another conversation', () => {
    expect(shouldPreserveOwnedChatScopeTransition({
      previousSessionKey,
      nextSessionKey:
        'project:P:chapter:OTHER:conversation:canvas-other:lane:general:skill:default',
      pendingOwnedScope: nextScope,
      activeStreamScope: nextScope,
      hasActiveStream: true,
    })).toBe(false)
  })

  it('does not treat lane or skill churn as a scope transition', () => {
    expect(shouldPreserveOwnedChatScopeTransition({
      previousSessionKey: nextSessionKey,
      nextSessionKey:
        'project:P:chapter:CH:conversation:canvas-new:lane:director:skill:storyboard',
      pendingOwnedScope: nextScope,
      activeStreamScope: nextScope,
      hasActiveStream: true,
    })).toBe(false)
  })

  it('ignores a stale stream scope after that stream has ended', () => {
    expect(shouldPreserveOwnedChatScopeTransition({
      previousSessionKey,
      nextSessionKey,
      pendingOwnedScope: '',
      activeStreamScope: nextScope,
      hasActiveStream: false,
    })).toBe(false)
  })
})

describe('resolveRestoredBaseKey', () => {
  it('extracts the base from a named (conversation-scoped) session key', () => {
    expect(
      resolveRestoredBaseKey('project:P:flow:F:conversation:canvas-abc:lane:general:skill:default'),
    ).toBe('canvas-abc')
  })

  it('returns empty for a default (no-conversation) session key', () => {
    // 旧格式默认会话——必须解析成空 base，恢复时才不会被塞回 :conversation: 段。
    expect(resolveRestoredBaseKey('project:P:flow:F:lane:general:skill:default')).toBe('')
  })

  it('returns empty for empty input', () => {
    expect(resolveRestoredBaseKey('')).toBe('')
    expect(resolveRestoredBaseKey(null)).toBe('')
  })

  it('canonicalizes legacy named project sessions to the one project source', () => {
    expect(buildEffectiveChatSessionKey({
      persistedBaseKey: 'canvas-legacy',
      projectId: 'P',
      flowId: 'F',
      chapterId: null,
      skillId: 'storyboard',
      lane: 'general',
    })).toBe('project:P:flow:F:lane:general:skill:default')
  })

  it('keeps skill changes inside the same project source', () => {
    const input = {
      persistedBaseKey: 'canvas-legacy',
      projectId: 'P',
      flowId: null,
      chapterId: 'CH',
      lane: 'general' as const,
    }
    expect(buildEffectiveChatSessionKey({ ...input, skillId: 'storyboard' })).toBe(
      'project:P:chapter:CH:lane:general:skill:default',
    )
    expect(buildEffectiveChatSessionKey({ ...input, skillId: null })).toBe(
      'project:P:chapter:CH:lane:general:skill:default',
    )
  })

  it('keeps director-node context inside the same project source', () => {
    expect(buildEffectiveChatSessionKey({
      persistedBaseKey: 'canvas-legacy',
      projectId: 'P',
      flowId: 'F',
      chapterId: null,
      lane: 'director:node-1' as const,
      skillId: 'director-console',
    })).toBe('project:P:flow:F:lane:general:skill:default')
  })

  it('partitions no-project chats by their stable canvas identity', () => {
    expect(buildEffectiveChatSessionKey({
      persistedBaseKey: 'canvas-browser-session',
      projectId: null,
      flowId: 'local-flow-1',
      canvasId: 'local-flow-1',
      chapterId: null,
      lane: 'general',
      skillId: null,
    })).toBe('canvas:local-flow-1:lane:general:skill:default')
    expect(buildEffectiveChatSessionKey({
      persistedBaseKey: 'canvas-browser-session',
      projectId: null,
      flowId: 'local-flow-2',
      canvasId: 'local-flow-2',
      chapterId: null,
      lane: 'general',
      skillId: null,
    })).not.toBe('canvas:local-flow-1:lane:general:skill:default')
  })
})

describe('persistChatSessionBaseKey', () => {
  afterEach(() => {
    window.localStorage.clear()
  })

  it('persists a non-empty base key verbatim', () => {
    expect(persistChatSessionBaseKey('canvas-xyz')).toBe('canvas-xyz')
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('canvas-xyz')
  })

  it('faithfully persists an empty base by clearing storage — never mints a new key', () => {
    window.localStorage.setItem(STORAGE_KEY, 'canvas-stale')
    // 关键回归：空 base 必须保持空（清除持久值），否则恢复默认会话时
    // 有效 key 会被塞回一个全新的 :conversation: 段，永远匹配不上库里历史。
    expect(persistChatSessionBaseKey('')).toBe('')
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull()
  })

  it('round-trips a restored default session to its original key (no conversation segment)', () => {
    const stored = 'project:P:flow:F:lane:general:skill:default'
    const baseKey = persistChatSessionBaseKey(resolveRestoredBaseKey(stored))
    const effective = buildEffectiveChatSessionKey({
      persistedBaseKey: baseKey,
      projectId: 'P',
      flowId: 'F',
      chapterId: null,
      skillId: 'default',
      lane: 'general',
    })
    expect(effective).toBe(stored)
  })
})

describe('scoped chat session base key storage', () => {
  afterEach(() => {
    window.localStorage.clear()
  })

  const SCOPE_CH7 = 'project:P:chapter:book-x-ch7'
  const SCOPE_CH6 = 'project:P:chapter:book-x-ch6'

  it('round-trips a base per scope without cross-scope bleed', () => {
    persistScopedChatSessionBaseKey(SCOPE_CH7, 'canvas-aaa')
    persistScopedChatSessionBaseKey(SCOPE_CH6, 'canvas-bbb')
    expect(readScopedChatSessionBaseKey(SCOPE_CH7)).toBe('canvas-aaa')
    expect(readScopedChatSessionBaseKey(SCOPE_CH6)).toBe('canvas-bbb')
  })

  it('rotating one scope leaves other scopes untouched', () => {
    // 核心回归：「新对话/选 skill」旋转 base 只影响当前作用域，
    // 不再像全局单值那样把所有项目/章节的默认会话一起孤儿化。
    persistScopedChatSessionBaseKey(SCOPE_CH7, 'canvas-aaa')
    persistScopedChatSessionBaseKey(SCOPE_CH6, 'canvas-new')
    expect(readScopedChatSessionBaseKey(SCOPE_CH7)).toBe('canvas-aaa')
  })

  it('distinguishes "explicitly default session" (empty base) from "never recorded" (null)', () => {
    expect(readScopedChatSessionBaseKey(SCOPE_CH7)).toBeNull()
    persistScopedChatSessionBaseKey(SCOPE_CH7, '')
    expect(readScopedChatSessionBaseKey(SCOPE_CH7)).toBe('')
  })

  it('returns null for empty scope and survives corrupted storage', () => {
    expect(readScopedChatSessionBaseKey('')).toBeNull()
    window.localStorage.setItem(SCOPED_STORAGE_KEY, '{not json')
    expect(readScopedChatSessionBaseKey(SCOPE_CH7)).toBeNull()
    persistScopedChatSessionBaseKey(SCOPE_CH7, 'canvas-recover')
    expect(readScopedChatSessionBaseKey(SCOPE_CH7)).toBe('canvas-recover')
  })

  it('caps stored scopes by evicting the least recently written', () => {
    for (let i = 0; i < 70; i += 1) {
      persistScopedChatSessionBaseKey(`project:P:chapter:ch${i}`, `canvas-${i}`)
    }
    expect(readScopedChatSessionBaseKey('project:P:chapter:ch0')).toBeNull()
    expect(readScopedChatSessionBaseKey('project:P:chapter:ch69')).toBe('canvas-69')
  })
})

describe('readOrCreateChatSessionBaseKey', () => {
  afterEach(() => {
    window.localStorage.clear()
  })

  it('reuses an existing persisted key', () => {
    window.localStorage.setItem(STORAGE_KEY, 'canvas-persisted')
    expect(readOrCreateChatSessionBaseKey()).toBe('canvas-persisted')
  })

  it('mints and persists a fresh key when none exists', () => {
    const created = readOrCreateChatSessionBaseKey()
    expect(created).toMatch(/^canvas-/)
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(created)
  })
})

describe('resolveLiveChatSessionScope', () => {
  it('falls back to the global scope without any project context', () => {
    expect(resolveLiveChatSessionScope({})).toEqual({
      projectId: '',
      flowId: '',
      chapterId: '',
      directorNodeId: '',
      scopeKey: '',
    })
  })

  it('resolves the project scope from the live currentProject', () => {
    const scope = resolveLiveChatSessionScope({ currentProject: { id: 'P' } })
    expect(scope).toEqual({
      projectId: 'P',
      flowId: '',
      chapterId: '',
      directorNodeId: '',
      scopeKey: 'project:P',
    })
  })

  it('resolves the flow scope and mirrors the flow-load advance on project entry', () => {
    const scope = resolveLiveChatSessionScope({
      currentProject: { id: 'P' },
      currentFlow: { id: 'F', source: 'server', ownerType: 'project', ownerId: 'P' },
    })
    expect(scope).toEqual({
      projectId: 'P',
      flowId: 'F',
      chapterId: '',
      directorNodeId: '',
      scopeKey: 'project:P:flow:F',
    })
  })

  it('drops a residual flow whose owner does not match the live project', () => {
    const scope = resolveLiveChatSessionScope({
      currentProject: { id: 'P2' },
      currentFlow: { id: 'F', source: 'server', ownerType: 'project', ownerId: 'P1' },
    })
    expect(scope.flowId).toBe('')
    expect(scope.scopeKey).toBe('project:P2')
  })

  it('prefers the chapter scope (project+chapter) and drops the flow dimension', () => {
    const scope = resolveLiveChatSessionScope({
      currentProject: { id: 'P' },
      currentFlow: { id: 'F', source: 'server', ownerType: 'project', ownerId: 'P' },
      currentChapter: { projectId: 'P', chapterId: 'ch1' },
    })
    expect(scope).toEqual({
      projectId: 'P',
      flowId: '',
      chapterId: 'ch1',
      directorNodeId: '',
      scopeKey: 'project:P:chapter:ch1',
    })
  })

  it('carries the director console anchor into the scope', () => {
    const scope = resolveLiveChatSessionScope({
      currentProject: { id: 'P' },
      directorChatScopeNodeId: 'node-9',
    })
    expect(scope.directorNodeId).toBe('node-9')
    expect(scope.scopeKey).toBe('project:P')
  })
})
