import type { WebSocket } from 'ws'
import { validateAuthSession } from './auth-session.service'

const DEFAULT_REVALIDATE_INTERVAL_MS = 30_000
const SESSION_REVOKED_CLOSE_CODE = 4001
const SESSION_VALIDATION_FAILED_CLOSE_CODE = 1011

type WebSocketSessionGuardInput = {
  userId: string
  sessionId: string
  intervalMs?: number
}

export function attachWebSocketSessionGuard(
  ws: WebSocket,
  input: WebSocketSessionGuardInput,
): () => void {
  const intervalMs = input.intervalMs ?? DEFAULT_REVALIDATE_INTERVAL_MS
  let stopped = false
  let validating = false

  const stop = (): void => {
    if (stopped) return
    stopped = true
    clearInterval(timer)
  }

  const close = (code: number, reason: string): void => {
    stop()
    try { ws.close(code, reason) } catch { /* socket is already closed */ }
  }

  const validate = async (): Promise<void> => {
    if (stopped || validating) return
    validating = true
    try {
      const result = await validateAuthSession(input.userId, input.sessionId)
      if (!stopped && !result.valid) close(SESSION_REVOKED_CLOSE_CODE, 'session_revoked')
    } catch (error: unknown) {
      if (!stopped) {
        console.error('[auth-session] WebSocket session revalidation failed', {
          userId: input.userId,
          sessionId: input.sessionId,
          error: error instanceof Error ? error.message : String(error),
        })
        close(SESSION_VALIDATION_FAILED_CLOSE_CODE, 'session_validation_failed')
      }
    } finally {
      validating = false
    }
  }

  const timer = setInterval(() => { void validate() }, intervalMs)
  timer.unref()
  ws.once('close', stop)
  ws.once('error', stop)
  return stop
}
