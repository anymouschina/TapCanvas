import React from 'react'
import { getAgentsChatTurnStatus, resumeAgentsChatTurn } from '../../api/server'
import type { AgentsChatTurnStatusDto } from '../../api/agentsChatTurn'
import { isContinuingChatTurn, isRecoverableInactiveChatTurn } from './chatTurnRecovery'
import type { ChatTurnRecoveryState } from './chatTurnRecovery'

const ACTIVE_TURN_POLL_INTERVAL_MS = 2_500
const STATUS_ERROR_RETRY_INTERVAL_MS = 5_000
const INTERRUPTED_TURN_STORAGE_PREFIX = 'tapcanvas-chat-interrupted-turn:'
const INTERRUPTED_TURN_SUPPRESSION_TTL_MS = 10 * 60 * 1000

type LocalTurnSuppression = {
  turnId: string
  expiresAt: number
}

function isTurnLocallySuppressed(sessionKey: string, turnId: string): boolean {
  if (typeof sessionStorage === 'undefined') return false
  try {
    const storageKey = `${INTERRUPTED_TURN_STORAGE_PREFIX}${sessionKey}`
    const raw = sessionStorage.getItem(storageKey)
    if (!raw) return false
    let value: unknown
    try {
      value = JSON.parse(raw)
    } catch {
      sessionStorage.removeItem(storageKey)
      return false
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      sessionStorage.removeItem(storageKey)
      return false
    }
    const suppression = value as Partial<LocalTurnSuppression>
    // Records without a concrete identity or expiry belong to the pre-TTL
    // format. Discard them so an old interruption cannot suppress recovery
    // forever for this session.
    if (
      typeof suppression.turnId !== 'string'
      || !suppression.turnId.trim()
      || typeof suppression.expiresAt !== 'number'
      || !Number.isFinite(suppression.expiresAt)
    ) {
      sessionStorage.removeItem(storageKey)
      return false
    }
    if (suppression.expiresAt <= Date.now()) {
      sessionStorage.removeItem(storageKey)
      return false
    }
    return suppression.turnId === turnId
  } catch {
    return false
  }
}

export function suppressChatTurnRecovery(sessionKey: string, turnId: string): void {
  if (typeof sessionStorage === 'undefined') return
  try {
    const value: LocalTurnSuppression = {
      turnId,
      expiresAt: Date.now() + INTERRUPTED_TURN_SUPPRESSION_TTL_MS,
    }
    sessionStorage.setItem(`${INTERRUPTED_TURN_STORAGE_PREFIX}${sessionKey}`, JSON.stringify(value))
  } catch { /* storage is optional */ }
}

export class ChatTurnResumeError extends Error {
  readonly code = 'chat_turn_resume_failed' as const

  constructor(message: string) {
    super(message)
    this.name = 'ChatTurnResumeError'
  }
}

export function isChatTurnResumeError(error: Error | null): error is ChatTurnResumeError {
  return error instanceof ChatTurnResumeError
}

export type ChatTurnRecovery = ChatTurnRecoveryState & {
  refresh: (options?: { retryRecovery?: boolean }) => Promise<AgentsChatTurnStatusDto | null>
  /**
   * Synchronously revoke every in-flight status/recovery request owned by the
   * current conversation identity. Call this before rotating to a new
   * conversation so a late status response cannot resume the previous turn.
   */
  invalidate: () => void
}

export type ChatTurnRecoveryOptions = {
  /** False while the project/chapter conversation identity is still resolving. */
  enabled?: boolean
  /** False when the caller wants status visibility without reclaiming an orphan. */
  autoResumeOrphan?: boolean
}

export function useChatTurnRecovery(
  sessionKey: string,
  options: ChatTurnRecoveryOptions = {},
): ChatTurnRecovery {
  const normalizedSessionKey = String(sessionKey || '').trim()
  const enabled = options.enabled ?? true
  const autoResumeOrphan = options.autoResumeOrphan ?? true
  const requestVersionRef = React.useRef(0)
  const inFlightQueryRef = React.useRef<{
    version: number
    token: symbol
    promise: Promise<AgentsChatTurnStatusDto | null>
  } | null>(null)
  const orphanResumeAttemptsRef = React.useRef(new Set<string>())
  const orphanResumeErrorsRef = React.useRef(new Map<string, ChatTurnResumeError>())
  const pendingResumeRequestsRef = React.useRef(new Set<string>())
  const [recoveryRevision, setRecoveryRevision] = React.useState(0)
  const pendingResumeClaimsRef = React.useRef(new Map<string, string>())
  const [state, setState] = React.useState<ChatTurnRecoveryState>({
    snapshot: null,
    checking: enabled && Boolean(normalizedSessionKey),
    error: null,
  })

  const invalidate = React.useCallback(() => {
    requestVersionRef.current += 1
    inFlightQueryRef.current = null
    orphanResumeAttemptsRef.current.clear()
    orphanResumeErrorsRef.current.clear()
    pendingResumeClaimsRef.current.clear()
    pendingResumeRequestsRef.current.clear()
    setState({ snapshot: null, checking: false, error: null })
  }, [])

  const query = React.useCallback((visibleCheck: boolean): Promise<AgentsChatTurnStatusDto | null> => {
    const requestVersion = requestVersionRef.current
    if (!enabled || !normalizedSessionKey) {
      setState({ snapshot: null, checking: false, error: null })
      return Promise.resolve(null)
    }
    const inFlight = inFlightQueryRef.current
    if (inFlight?.version === requestVersion) {
      return inFlight.promise
    }
    if (visibleCheck) {
      setState((current) => ({ ...current, checking: true, error: null }))
    }
    const requestToken = Symbol('chat-turn-status-query')
    const promise = (async (): Promise<AgentsChatTurnStatusDto | null> => {
      try {
        const snapshot = await getAgentsChatTurnStatus({ sessionKey: normalizedSessionKey })
        // A new conversation can be created while the old status request is in
        // flight. No recovery side effect is legal after its ownership version
        // has been revoked.
        if (requestVersionRef.current !== requestVersion) return null
        const orphanedTurn = isRecoverableInactiveChatTurn(snapshot)
          ? snapshot.turn
          : null
        if (!orphanedTurn) {
          orphanResumeAttemptsRef.current.clear()
          orphanResumeErrorsRef.current.clear()
        } else {
          for (const attemptedTurnId of orphanResumeAttemptsRef.current) {
            if (attemptedTurnId !== orphanedTurn.turnId) {
              orphanResumeAttemptsRef.current.delete(attemptedTurnId)
            }
          }
          for (const failedTurnId of orphanResumeErrorsRef.current.keys()) {
            if (failedTurnId !== orphanedTurn.turnId) {
              orphanResumeErrorsRef.current.delete(failedTurnId)
            }
          }
        }
        if (
          autoResumeOrphan
          && orphanedTurn
          && !isTurnLocallySuppressed(normalizedSessionKey, orphanedTurn.turnId)
          && !orphanResumeAttemptsRef.current.has(orphanedTurn.turnId)
          && !pendingResumeRequestsRef.current.has(orphanedTurn.turnId)
        ) {
          orphanResumeAttemptsRef.current.add(orphanedTurn.turnId)
          const turnId = orphanedTurn.turnId
          pendingResumeRequestsRef.current.add(turnId)
          // Recovery is a mutation, status is an independent observation. A
          // slow/lost resume response must never own the status query's lock.
          void resumeAgentsChatTurn({ sessionKey: normalizedSessionKey, turnId })
            .then((receipt) => {
              if (requestVersionRef.current !== requestVersion) return
              pendingResumeClaimsRef.current.set(turnId, receipt.continuationId)
            })
            .catch((error: unknown) => {
              if (requestVersionRef.current !== requestVersion) return
              const message = error instanceof Error ? error.message : '当前任务自动续跑失败'
              console.warn('[ai-chat][turn-recovery] resume failed', {
                sessionKey: normalizedSessionKey, turnId, message,
              })
              orphanResumeErrorsRef.current.set(turnId, new ChatTurnResumeError(message))
            })
            .finally(() => {
              if (requestVersionRef.current !== requestVersion) return
              pendingResumeRequestsRef.current.delete(turnId)
              setRecoveryRevision((revision) => revision + 1)
            })
        }
        if (requestVersionRef.current !== requestVersion) return null
        const pendingTurnId = snapshot.turn?.turnId ?? null
        if (
          !pendingTurnId
          || snapshot.activeTurn
          || !isRecoverableInactiveChatTurn(snapshot)
        ) {
          pendingResumeClaimsRef.current.clear()
        } else {
          for (const claimedTurnId of pendingResumeClaimsRef.current.keys()) {
            if (claimedTurnId !== pendingTurnId) pendingResumeClaimsRef.current.delete(claimedTurnId)
          }
        }
        const recoveryClaimPending = Boolean(
          pendingTurnId
          && (pendingResumeClaimsRef.current.has(pendingTurnId)
            || pendingResumeRequestsRef.current.has(pendingTurnId))
          && !snapshot.activeTurn
          && isRecoverableInactiveChatTurn(snapshot),
        )
        const recoveryError = autoResumeOrphan && orphanedTurn
          ? orphanResumeErrorsRef.current.get(orphanedTurn.turnId) ?? null
          : null
        // A successful resume receipt means the durable continuation was
        // claimed/scheduled, not that the physical agents process is already
        // visible. Keep admission closed until authoritative status observes
        // the active or terminal turn; a fixed sleep creates a send race.
        setState({ snapshot, checking: recoveryClaimPending, error: recoveryError })
        return snapshot
      } catch (error: unknown) {
        if (requestVersionRef.current !== requestVersion) return null
        setState((current) => ({
          snapshot: current.snapshot,
          checking: false,
          error: error instanceof Error ? error : new Error('聊天回合状态读取失败'),
        }))
        return null
      } finally {
        if (inFlightQueryRef.current?.token === requestToken) {
          inFlightQueryRef.current = null
        }
      }
    })()
    inFlightQueryRef.current = { version: requestVersion, token: requestToken, promise }
    return promise
  }, [autoResumeOrphan, enabled, normalizedSessionKey])

  const refresh = React.useCallback((options?: { retryRecovery?: boolean }) => {
    const turnId = state.snapshot?.turn?.turnId
    if (options?.retryRecovery && turnId
      && !pendingResumeClaimsRef.current.has(turnId)
      && !pendingResumeRequestsRef.current.has(turnId)) {
      orphanResumeAttemptsRef.current.delete(turnId)
      orphanResumeErrorsRef.current.delete(turnId)
    }
    return query(true)
  }, [query, state.snapshot?.turn?.turnId])

  React.useEffect(() => {
    orphanResumeAttemptsRef.current.clear()
    orphanResumeErrorsRef.current.clear()
    pendingResumeClaimsRef.current.clear()
    pendingResumeRequestsRef.current.clear()
    setState({
      snapshot: null,
      checking: enabled && Boolean(normalizedSessionKey),
      error: null,
    })
    if (enabled) void query(true)
    return () => {
      requestVersionRef.current += 1
    }
  }, [enabled, normalizedSessionKey, query])

  React.useEffect(() => {
    if (recoveryRevision > 0) void query(false)
  }, [query, recoveryRevision])

  React.useEffect(() => {
    const shouldPoll = state.error !== null
      || state.checking
      || state.snapshot?.activeTurn === true
      || isContinuingChatTurn(state.snapshot)
      || isRecoverableInactiveChatTurn(state.snapshot)
    if (!enabled || !normalizedSessionKey || !shouldPoll) return
    const timer = window.setInterval(() => {
      void query(false)
    }, state.error === null ? ACTIVE_TURN_POLL_INTERVAL_MS : STATUS_ERROR_RETRY_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [enabled, normalizedSessionKey, query, state.error, state.snapshot])

  React.useEffect(() => {
    if (!enabled || !normalizedSessionKey || typeof document === 'undefined') return
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void query(false)
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [enabled, normalizedSessionKey, query])

  return { ...state, refresh, invalidate }
}
