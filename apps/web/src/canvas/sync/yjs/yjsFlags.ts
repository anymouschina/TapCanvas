import { API_BASE } from '../../../api/server'

export type YjsMode = 'off' | 'local' | 'ws'

const viteEnv = ((import.meta as any).env || {}) as Record<string, any>

/**
 * VITE_CANVAS_YJS 控制画布实时层：
 *   off   — 默认，完全走旧 SSE + POST 传输，Y.Doc 不参与（零行为变化）
 *   local — 仅本地把 store 镜像进 Y.Doc，用于验证绑定一致性，不联网
 *   ws    — 通过 y-websocket 长连接做协同 + awareness presence
 */
export function getYjsMode(): YjsMode {
  const raw = String(viteEnv.VITE_CANVAS_YJS || '').trim().toLowerCase()
  if (raw === 'local' || raw === 'ws') return raw
  return 'off'
}

/** 由 API_BASE 推导 y-websocket 服务端地址（ws/wss + /yjs 路径）。 */
export function getYjsWsBase(): string {
  let origin = API_BASE
  if (!origin || !/^https?:\/\//i.test(origin)) {
    // 同源部署：用当前页面 origin
    origin = typeof window !== 'undefined' ? window.location.origin : ''
  }
  const wsOrigin = origin.replace(/^http/i, 'ws')
  return `${wsOrigin.replace(/\/$/, '')}/yjs`
}
