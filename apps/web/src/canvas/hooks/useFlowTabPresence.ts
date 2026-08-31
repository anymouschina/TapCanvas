import { useEffect, useState } from 'react'

type PresenceMsg = { type: 'claim' | 'release' | 'ack'; tabId: string }

export type FlowTabPresenceScope = {
  projectId: string | null | undefined
  ownerType: 'project' | 'chapter' | 'shot' | null | undefined
  ownerId: string | null | undefined
  flowId: string | null | undefined
}

type FlowTabPresenceState = {
  presenceKey: string | null
  active: boolean
}

const normalizeIdentityPart = (value: string | null | undefined): string => String(value || '').trim()

/**
 * 多标签冲突的身份必须对应一个完整、已确认归属的持久画布资源。
 * 项目画布额外要求 ownerId === projectId；项目切换期间若 currentFlow 仍残留旧归属，
 * 直接返回 null，不允许用旧 flowId 建立频道并产生误报。
 */
export function buildFlowTabPresenceKey(scope: FlowTabPresenceScope | null | undefined): string | null {
  if (!scope) return null

  const projectId = normalizeIdentityPart(scope.projectId)
  const ownerType = scope.ownerType
  const ownerId = normalizeIdentityPart(scope.ownerId)
  const flowId = normalizeIdentityPart(scope.flowId)
  if (!projectId || !ownerType || !ownerId || !flowId) return null
  if (ownerType === 'project' && ownerId !== projectId) return null

  return [projectId, ownerType, ownerId, flowId]
    .map((part) => encodeURIComponent(part))
    .join(':')
}

/**
 * 可测试的纯 core：不依赖 React，供单测直接调用。
 * 通过已包含 project/owner/flow 的 presenceKey 检测同一浏览器内是否有
 * 其他 tab 打开了同一个持久画布资源。
 *
 * 协议：
 * - 打开时广播 claim；已存在的 tab 收到 claim 后回 ack（双方都能知道对方存在）。
 * - 收到 claim 或 ack（且非本 tab 自己发出）→ 回调 onOtherTab(true)。
 * - dispose 时尽力广播 release 并关闭 channel（best-effort，失败静默忽略）。
 */
export function createFlowTabPresence(
  presenceKey: string,
  onOtherTab: (present: boolean) => void,
): { dispose: () => void } {
  if (typeof BroadcastChannel === 'undefined') {
    return { dispose() {} }
  }
  const tabId = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  const ch = new BroadcastChannel(`tapcanvas-flow-tab:v2:${presenceKey}`)
  const otherTabIds = new Set<string>()
  let lastPresence = false
  let disposed = false
  const emitPresence = () => {
    const nextPresence = otherTabIds.size > 0
    if (nextPresence === lastPresence) return
    lastPresence = nextPresence
    onOtherTab(nextPresence)
  }
  const announceClaim = () => {
    if (!disposed) ch.postMessage({ type: 'claim', tabId } satisfies PresenceMsg)
  }
  const announceRelease = () => {
    if (!disposed) ch.postMessage({ type: 'release', tabId } satisfies PresenceMsg)
  }
  ch.onmessage = (e: MessageEvent<PresenceMsg>) => {
    const m = e.data
    if (!m || m.tabId === tabId) return
    if (m.type === 'claim') {
      otherTabIds.add(m.tabId)
      emitPresence()
      ch.postMessage({ type: 'ack', tabId } satisfies PresenceMsg)
    } else if (m.type === 'ack') {
      otherTabIds.add(m.tabId)
      emitPresence()
    } else if (m.type === 'release') {
      otherTabIds.delete(m.tabId)
      emitPresence()
    }
  }
  const handlePageHide = () => {
    announceRelease()
    otherTabIds.clear()
    emitPresence()
  }
  const handlePageShow = () => announceClaim()
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', handlePageHide)
    window.addEventListener('pageshow', handlePageShow)
  }
  announceClaim()
  return {
    dispose() {
      if (disposed) return
      try {
        announceRelease()
      } catch {
        // best-effort：tab 关闭时 channel 可能已不可用，继续完成本地清理。
      }
      disposed = true
      if (typeof window !== 'undefined') {
        window.removeEventListener('pagehide', handlePageHide)
        window.removeEventListener('pageshow', handlePageShow)
      }
      try {
        ch.close()
      } catch {
        // best-effort：tab 关闭时 channel 可能已不可用，忽略。
      }
    },
  }
}

/**
 * React hook：只在完整画布身份已确认时参与多标签检测。
 * 仅供上层显示软提醒横幅，不阻断编辑——硬性防覆盖由后端版本号 409 兜底。
 */
export function useFlowTabPresence(scope: FlowTabPresenceScope | null | undefined): boolean {
  const presenceKey = buildFlowTabPresenceKey(scope)
  const [presenceState, setPresenceState] = useState<FlowTabPresenceState>({
    presenceKey: null,
    active: false,
  })

  useEffect(() => {
    if (!presenceKey) {
      setPresenceState({ presenceKey: null, active: false })
      return
    }
    setPresenceState({ presenceKey, active: false })
    const presence = createFlowTabPresence(presenceKey, (active) => {
      setPresenceState({ presenceKey, active })
    })
    return () => presence.dispose()
  }, [presenceKey])

  // useEffect 在浏览器绘制后才清理旧频道；此处同步校验 key，
  // 确保切换项目的首帧也不会短暂显示上一画布的冲突状态。
  return Boolean(
    presenceKey &&
    presenceState.presenceKey === presenceKey &&
    presenceState.active,
  )
}
