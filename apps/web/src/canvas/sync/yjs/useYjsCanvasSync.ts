import { useEffect, useRef } from 'react'
import type { Node, Edge } from '@xyflow/react'
import { WebsocketProvider } from 'y-websocket'
import { useRFStore } from '../../store'
import { derivedApplyGuard } from '../remoteApplyGuard'
import { useAuth } from '../../../auth/store'
import { usePresenceStore } from '../presenceStore'
import { removeDanglingCanvasEdges } from '../applyCanvasGraphPatch'
import {
  getCanvasDoc,
  destroyCanvasDoc,
  syncStoreToDoc,
  readNodesFromDoc,
  readEdgesFromDoc,
  isDocEmpty,
  LOCAL_ORIGIN,
} from './canvasDoc'
import { getYjsMode, getYjsWsBase, type YjsMode } from './yjsFlags'

const DEBOUNCE_MS = 150
const CURSOR_THROTTLE_MS = 150

function getActiveTeamId(): string | null {
  try { return localStorage.getItem('tapcanvas_active_team_id') } catch { return null }
}

/**
 * Yjs 版画布同步 hook —— useCanvasSync 的替代实现，仅在 VITE_CANVAS_YJS != off 时启用。
 *
 *   local：store ↔ Y.Doc 本地双向绑定（验证一致性，不联网）
 *   ws   ：再叠加 y-websocket provider 协同 + awareness presence
 *
 * 旧 SSE hook 与本 hook 互斥：Canvas 侧按 mode 决定调用哪个，避免双写。
 */
export function useYjsCanvasSync(flowId: string, enabled: boolean): YjsMode {
  const mode = getYjsMode()
  const user = useAuth((s) => s.user)
  const applyingRemoteRef = useRef(false)
  const lastCursorRef = useRef(0)

  useEffect(() => {
    if (!enabled || mode === 'off' || !flowId) return

    const doc = getCanvasDoc(flowId)

    // 幂等初始化：文档为空时用 store 当前态灌入（避免覆盖已同步的远端态）
    if (isDocEmpty(doc)) {
      const { nodes, edges } = useRFStore.getState()
      if (nodes.length || edges.length) syncStoreToDoc(doc, nodes, edges)
    } else {
      // 文档已有内容（来自 ws 远端或缓存）→ 先把远端态拉进 store
      applyRemoteToStore(doc, applyingRemoteRef)
    }

    // Y.Doc → store：监听非本地来源的变更
    const observer = (_events: unknown, txn: { origin: unknown }) => {
      if (txn.origin === LOCAL_ORIGIN) return
      applyRemoteToStore(doc, applyingRemoteRef)
    }
    doc.on('afterTransaction', observer as any)

    // store → Y.Doc：debounce 后 diff 写入
    let debounce: ReturnType<typeof setTimeout> | null = null
    const unsub = useRFStore.subscribe((state, prev) => {
      if (applyingRemoteRef.current || derivedApplyGuard.active) return
      if (state.nodes === prev.nodes && state.edges === prev.edges) return
      if (debounce) clearTimeout(debounce)
      debounce = setTimeout(() => {
        if (applyingRemoteRef.current) return
        const cur = useRFStore.getState()
        syncStoreToDoc(doc, cur.nodes as Node[], cur.edges as Edge[])
      }, DEBOUNCE_MS)
    })

    // ── ws 模式：长连接 + awareness presence ──────────────────────────────
    let provider: WebsocketProvider | null = null
    let detachAwareness: (() => void) | null = null
    if (mode === 'ws') {
      const teamId = getActiveTeamId() || ''
      provider = new WebsocketProvider(getYjsWsBase(), flowId, doc, {
        connect: true,
        params: { ...(teamId ? { teamId } : {}) },
      })

      const awareness = provider.awareness
      const userId = String(user?.sub ?? 'unknown')
      const userName = user?.name || user?.login || userId.slice(0, 8)

      // 注册光标发送器（写进 awareness，由协议广播）
      const sendCursor = (x: number, y: number) => {
        const now = Date.now()
        if (now - lastCursorRef.current < CURSOR_THROTTLE_MS) return
        lastCursorRef.current = now
        awareness.setLocalStateField('cursor', { userId, name: userName, x, y })
      }
      usePresenceStore.getState()._setSendCursor(sendCursor)

      // awareness → presenceStore
      const onAwareness = () => {
        const ps = usePresenceStore.getState()
        const states = awareness.getStates()
        const seen = new Set<string>()
        states.forEach((st, clientId) => {
          if (clientId === awareness.clientID) return
          const cur = (st as any)?.cursor
          if (!cur || typeof cur.x !== 'number') return
          seen.add(cur.userId)
          ps._setCursor(cur.userId, cur.name, cur.x, cur.y)
        })
        // 清理已离开的光标
        for (const id of Array.from(ps.cursors.keys())) {
          if (!seen.has(id)) ps._removeCursor(id)
        }
      }
      awareness.on('change', onAwareness)
      detachAwareness = () => awareness.off('change', onAwareness)
    }

    return () => {
      if (debounce) clearTimeout(debounce)
      unsub()
      doc.off('afterTransaction', observer as any)
      detachAwareness?.()
      if (provider) {
        provider.awareness.setLocalState(null)
        provider.destroy()
      }
      usePresenceStore.getState()._clearAll()
      // local 模式保留 doc 以便复用；ws 模式销毁连接但保留 doc 缓存
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flowId, enabled, mode, user])

  return mode
}

function applyRemoteToStore(
  doc: ReturnType<typeof getCanvasDoc>,
  applyingRemoteRef: { current: boolean },
): void {
  const nodes = readNodesFromDoc(doc)
  const edges = readEdgesFromDoc(doc)
  applyingRemoteRef.current = true
  try {
    useRFStore.setState((s) => {
      // 合并：保留 seed 节点（本地占位），其余以远端为准
      const seeds = s.nodes.filter((n) => n.id.startsWith('chapter-seed-'))
      const mergedNodes = [...seeds, ...nodes]
      return { ...s, nodes: mergedNodes, edges: removeDanglingCanvasEdges(mergedNodes, edges) }
    })
  } finally {
    // 让本次 setState 触发的 store.subscribe 回调先跳过，再解锁
    queueMicrotask(() => { applyingRemoteRef.current = false })
  }
}

export { destroyCanvasDoc }
