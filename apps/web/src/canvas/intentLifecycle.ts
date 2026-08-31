import { create } from 'zustand'
import type { ChapterCanvasIntent } from '@tapcanvas/chapter-canvas-intents'
import type { PendingUserInputRequest } from './streamChapterIntent'

export type PendingInputContext = {
  request: PendingUserInputRequest
  intent: ChapterCanvasIntent
  sourceNodeId: string
  chapterContext: {
    projectId: string
    bookId: string | null
    chapterId: string
    flowSnapshot: {
      nodes: Array<{ id: string; kind: string; preset?: string; data: Record<string, unknown> }>
      edges: Array<{ id: string; source: string; target: string; sourceHandle?: string; targetHandle?: string }>
    }
  }
  generationConfig?: { imageModel?: string; imageSize?: string }
  variantParams?: Record<string, unknown>
}

export type IntentProgressStage = 'waiting_upstream' | 'tool_completed'

type RunEntry = {
  intent: ChapterCanvasIntent
  sourceNodeId: string
  abortController: AbortController
  toolCallCount: number
  bufferedToolCalls: number
  upstreamErrors: number
  stage: IntentProgressStage | null
  lastToolName: string | null
}

// Module-level map so concurrent runs don't overwrite each other.
// Keyed by batchUlid (ULID — lexicographically sorted by creation time).
const _runs = new Map<string, RunEntry>()

function deriveFromRuns(): {
  activeIntent: ChapterCanvasIntent | null
  batchUlid: string | null
  toolCallCount: number
  bufferedToolCalls: number
  upstreamErrors: number
  stage: IntentProgressStage | null
  lastToolName: string | null
  abortController: AbortController | null
  activeRunCount: number
} {
  if (_runs.size === 0) {
    return {
      activeIntent: null, batchUlid: null,
      toolCallCount: 0, bufferedToolCalls: 0, upstreamErrors: 0,
      stage: null, lastToolName: null, abortController: null,
      activeRunCount: 0,
    }
  }
  // Latest entry = largest ULID key (lexicographic ≈ chronological)
  let latestKey = ''
  for (const k of _runs.keys()) {
    if (k > latestKey) latestKey = k
  }
  const e = _runs.get(latestKey)!
  return {
    activeIntent: e.intent,
    batchUlid: latestKey,
    toolCallCount: e.toolCallCount,
    bufferedToolCalls: e.bufferedToolCalls,
    upstreamErrors: e.upstreamErrors,
    stage: e.stage,
    lastToolName: e.lastToolName,
    abortController: e.abortController,
    activeRunCount: _runs.size,
  }
}

// Rebuilt only when runs are added/removed — stable reference during a run.
function buildRunningNodeIntents(): Map<string, Set<ChapterCanvasIntent>> {
  const map = new Map<string, Set<ChapterCanvasIntent>>()
  for (const entry of _runs.values()) {
    if (!entry.sourceNodeId) continue
    let set = map.get(entry.sourceNodeId)
    if (!set) { set = new Set(); map.set(entry.sourceNodeId, set) }
    set.add(entry.intent)
  }
  return map
}

export type IntentLifecycleState = {
  activeIntent: ChapterCanvasIntent | null
  batchUlid: string | null
  toolCallCount: number
  bufferedToolCalls: number
  upstreamErrors: number
  stage: IntentProgressStage | null
  lastToolName: string | null
  abortController: AbortController | null
  /** Number of concurrently running intents */
  activeRunCount: number
  /** nodeId → set of intents currently running on that node */
  runningNodeIntents: Map<string, Set<ChapterCanvasIntent>>
  start: (intent: ChapterCanvasIntent, batchUlid: string, abort: AbortController, sourceNodeId?: string) => void
  incrementCount: (batchUlid: string) => void
  applyProgress: (batchUlid: string, payload: {
    stage: IntentProgressStage
    bufferedToolCalls: number
    toolName?: string
    upstreamErrors?: number
  }) => void
  finish: (batchUlid: string) => void
  cancel: (batchUlid?: string) => void
  hasActiveAgent: () => boolean
  confirmAbandonAgent: () => boolean
  /** 等待用户选项的挂起上下文（request_user_input 时设置） */
  pendingUserInput: PendingInputContext | null
  setPendingUserInput: (ctx: PendingInputContext) => void
  clearPendingUserInput: () => void
}

export const useIntentLifecycle = create<IntentLifecycleState>((set, get) => ({
  ...deriveFromRuns(),
  runningNodeIntents: new Map(),
  pendingUserInput: null,
  setPendingUserInput: (ctx) => set({ pendingUserInput: ctx }),
  clearPendingUserInput: () => set({ pendingUserInput: null }),

  start: (intent, batchUlid, abort, sourceNodeId = '') => {
    _runs.set(batchUlid, {
      intent,
      sourceNodeId,
      abortController: abort,
      toolCallCount: 0,
      bufferedToolCalls: 0,
      upstreamErrors: 0,
      stage: null,
      lastToolName: null,
    })
    set({ ...deriveFromRuns(), runningNodeIntents: buildRunningNodeIntents() })
  },

  // progress updates do NOT rebuild runningNodeIntents — keeps its reference stable
  incrementCount: (batchUlid) => {
    const entry = _runs.get(batchUlid)
    if (!entry) return
    entry.toolCallCount++
    set(deriveFromRuns())
  },

  applyProgress: (batchUlid, payload) => {
    const entry = _runs.get(batchUlid)
    if (!entry) return
    entry.stage = payload.stage
    entry.bufferedToolCalls = Math.max(entry.bufferedToolCalls, payload.bufferedToolCalls)
    if (payload.toolName) entry.lastToolName = payload.toolName
    if (typeof payload.upstreamErrors === 'number') entry.upstreamErrors = payload.upstreamErrors
    set(deriveFromRuns())
  },

  finish: (batchUlid) => {
    _runs.delete(batchUlid)
    set({ ...deriveFromRuns(), runningNodeIntents: buildRunningNodeIntents() })
  },

  cancel: (batchUlid) => {
    if (batchUlid) {
      const entry = _runs.get(batchUlid)
      if (entry && !entry.abortController.signal.aborted) entry.abortController.abort()
      _runs.delete(batchUlid)
    } else {
      for (const entry of _runs.values()) {
        if (!entry.abortController.signal.aborted) entry.abortController.abort()
      }
      _runs.clear()
    }
    set({ ...deriveFromRuns(), runningNodeIntents: buildRunningNodeIntents() })
  },

  hasActiveAgent: () => _runs.size > 0,

  confirmAbandonAgent: () => {
    if (_runs.size === 0) return true
    const total = [..._runs.values()].reduce((s, e) => s + e.toolCallCount, 0)
    const detail = total > 0 ? `（已交付 ${total} 个工具调用）` : ''
    const subject = _runs.size > 1 ? `${_runs.size} 个 agent` : ([..._runs.values()][0]?.intent ?? 'agent')
    if (typeof window === 'undefined') return true
    const ok = window.confirm(
      `当前正在执行 ${subject}${detail}，离开本页会立即终止，未提交的成果会丢失。\n\n点"确定"继续离开并终止 agent，点"取消"留在本页。`,
    )
    if (ok) get().cancel()
    return ok
  },
}))

declare global {
  interface Window {
    __TC_INTENT_NAV_GUARD_INSTALLED__?: boolean
  }
}

if (typeof window !== 'undefined' && !window.__TC_INTENT_NAV_GUARD_INSTALLED__) {
  window.__TC_INTENT_NAV_GUARD_INSTALLED__ = true

  let lastKnownPath = window.location.pathname

  window.addEventListener(
    'popstate',
    () => {
      const s = useIntentLifecycle.getState()
      const newPath = window.location.pathname
      if (!s.hasActiveAgent() || newPath === lastKnownPath) {
        lastKnownPath = newPath
        return
      }
      const ok = s.confirmAbandonAgent()
      if (!ok) {
        window.history.pushState(null, '', lastKnownPath)
        return
      }
      lastKnownPath = newPath
    },
    true,
  )

  window.addEventListener('beforeunload', (e: BeforeUnloadEvent) => {
    const s = useIntentLifecycle.getState()
    if (!s.hasActiveAgent()) return
    e.preventDefault()
    e.returnValue = '当前 agent 仍在执行，关闭/刷新会终止任务。'
  })
}
