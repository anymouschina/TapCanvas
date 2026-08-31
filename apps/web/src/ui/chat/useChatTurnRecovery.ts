import React from 'react'
import { getAgentsChatTurnStatus, resumeAgentsChatTurn } from '../../api/server'
import type { AgentsChatTurnStatusDto } from '../../api/agentsChatTurn'
import { isContinuingChatTurn, isRecoverableInactiveChatTurn } from './chatTurnRecovery'
import type { ChatTurnRecoveryState } from './chatTurnRecovery'

const ACTIVE_TURN_POLL_INTERVAL_MS = 2_500
const STATUS_ERROR_RETRY_INTERVAL_MS = 5_000

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
  refresh: () => Promise<AgentsChatTurnStatusDto | null>
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
        let snapshot = await getAgentsChatTurnStatus({ sessionKey: normalizedSessionKey })
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
          && !orphanResumeAttemptsRef.current.has(orphanedTurn.turnId)
        ) {
          orphanResumeAttemptsRef.current.add(orphanedTurn.turnId)
          try {
            if (requestVersionRef.current !== requestVersion) return null
            const receipt = await resumeAgentsChatTurn({
              sessionKey: normalizedSessionKey,
              turnId: orphanedTurn.turnId,
            })
            pendingResumeClaimsRef.current.set(orphanedTurn.turnId, receipt.continuationId)
            if (requestVersionRef.current !== requestVersion) return null
            snapshot = await getAgentsChatTurnStatus({ sessionKey: normalizedSessionKey })
          } catch (error: unknown) {
            const message = error instanceof Error
              ? error.message
              : '当前任务自动续跑失败'
            orphanResumeErrorsRef.current.set(
              orphanedTurn.turnId,
              new ChatTurnResumeError(message),
            )
            // Keep the authoritative inactive snapshot. The UI never invents a
            // successful recovery or a new task when no exact continuation exists.
            // The attempt remains claimed so background polling cannot hammer the
            // same rejected checkpoint. An explicit refresh may retry it once.
          }
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
          && pendingResumeClaimsRef.current.has(pendingTurnId)
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

  const refresh = React.useCallback(() => {
    const turnId = state.snapshot?.turn?.turnId
    if (turnId && !pendingResumeClaimsRef.current.has(turnId)) {
      orphanResumeAttemptsRef.current.delete(turnId)
      orphanResumeErrorsRef.current.delete(turnId)
    }
    return query(true)
  }, [query, state.snapshot?.turn?.turnId])

  React.useEffect(() => {
    orphanResumeAttemptsRef.current.clear()
    orphanResumeErrorsRef.current.clear()
    pendingResumeClaimsRef.current.clear()
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
