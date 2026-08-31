import { useEffect } from 'react'
import { usePresenceStore } from './presenceStore'
import { createThrottledCursorSender } from './presence-throttle'
// 与 useCanvasSync.ts 使用相同的来源：API_BASE 来自 ../../api/server，
// 鉴权由浏览器自动携带 HttpOnly Cookie。teamId 由 useCanvasSync 的响应式状态显式传入，
// 切换团队时本 effect 会关闭旧连接并按新团队重建。
import { API_BASE } from '../../api/server'

const CURSOR_THROTTLE_MS = 300
const RECONNECT_MS = 3000

function buildPresenceWsUrl(resourceId: string, teamId: string | null): string {
  let origin = API_BASE
  if (!origin || !/^https?:\/\//i.test(origin)) {
    origin = typeof window !== 'undefined' ? window.location.origin : ''
  }
  const wsOrigin = origin.replace(/^http/i, 'ws').replace(/\/$/, '')
  const qs = new URLSearchParams()
  if (teamId) qs.set('teamId', teamId)
  return `${wsOrigin}/canvas-presence/${encodeURIComponent(resourceId)}?${qs.toString()}`
}

export function useCanvasPresenceWs(input: {
  resourceId: string
  userId: string
  userName: string
  teamId: string | null
  enabled: boolean
}): void {
  const { resourceId, userId, userName, teamId, enabled } = input
  useEffect(() => {
    if (!enabled || !resourceId) return
    let ws: WebSocket | null = null
    let closed = false
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined
    // 服务端只对团队共享项目放行（否则握手 403）：从未成功 open 过就连续失败，
    // 视为该 resource 不在放行范围，停止重连，避免 3s 一次打成 403 循环。
    let everOpened = false
    let handshakeFails = 0
    const MAX_HANDSHAKE_FAILS = 3

    const sendCursor = createThrottledCursorSender({
      throttleMs: CURSOR_THROTTLE_MS,
      emit: (x, y) => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          try { ws.send(JSON.stringify({ type: 'cursor', userId, name: userName, x, y })) } catch { /* drop */ }
        }
      },
    })

    const scheduleReconnect = () => {
      if (closed) return
      reconnectTimer = setTimeout(connect, RECONNECT_MS)
    }

    function connect() {
      if (closed) return
      try { ws = new WebSocket(buildPresenceWsUrl(resourceId, teamId)) } catch { scheduleReconnect(); return }
      ws.onopen = () => { everOpened = true; handshakeFails = 0 }
      ws.onmessage = (e: MessageEvent) => {
        let m: { type?: string; userId?: string; name?: string; x?: number; y?: number }
        try { m = JSON.parse(String(e.data)) } catch { return }
        const ps = usePresenceStore.getState()
        if (m.type === 'cursor' && m.userId && m.userId !== userId && typeof m.x === 'number' && typeof m.y === 'number') {
          ps._setCursor(m.userId, String(m.name || ''), m.x, m.y)
        } else if (m.type === 'leave' && m.userId) {
          ps._removeCursor(m.userId)
        }
      }
      ws.onclose = () => {
        if (closed) return
        if (!everOpened && ++handshakeFails >= MAX_HANDSHAKE_FAILS) return
        scheduleReconnect()
      }
      ws.onerror = () => { try { ws?.close() } catch { /* noop */ } }
    }

    usePresenceStore.getState()._setSendCursor(sendCursor)
    connect()

    return () => {
      closed = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      try { ws?.close() } catch { /* noop */ }
      usePresenceStore.getState()._setSendCursor(null)
    }
  }, [resourceId, userId, userName, teamId, enabled])
}
