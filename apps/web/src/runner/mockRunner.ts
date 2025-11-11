import type { StateCreator } from 'zustand'
import type { Node } from 'reactflow'

type Getter = () => any
type Setter = (fn: (s: any) => any) => void

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)) }

export async function runNodeMock(id: string, get: Getter, set: Setter) {
  const node: Node | undefined = get().nodes.find((n: Node) => n.id === id)
  if (!node) return
  const kind = (node.data as any)?.kind ?? 'task'
  const setNodeStatus = get().setNodeStatus
  const appendLog = get().appendLog
  const beginToken = get().beginRunToken as (id: string) => void
  const isCanceled = get().isCanceled as (id: string) => boolean
  const endRunToken = get().endRunToken as (id: string) => void

  setNodeStatus(id, 'queued', { progress: 0 })
  appendLog(id, `[${new Date().toLocaleTimeString()}] queued`)
  await sleep(200 + Math.random() * 300)
  if (isCanceled?.(id)) {
    setNodeStatus(id, 'canceled', { progress: 0 })
    appendLog(id, `[${new Date().toLocaleTimeString()}] canceled before start`)
    endRunToken?.(id)
    return
  }
  beginToken?.(id)
  setNodeStatus(id, 'running', { progress: 5 })
  appendLog(id, `[${new Date().toLocaleTimeString()}] running kind=${kind}`)

  const total = 5 + Math.floor(Math.random() * 6)
  for (let i = 1; i <= total; i++) {
    await sleep(200 + Math.random() * 400)
    if (isCanceled?.(id)) {
      setNodeStatus(id, 'canceled', { progress: 0, lastError: 'Canceled by user' })
      appendLog(id, `[${new Date().toLocaleTimeString()}] canceled at step ${i}/${total}`)
      endRunToken?.(id)
      return
    }
    const prog = Math.min(99, Math.round((i / total) * 100))
    setNodeStatus(id, 'running', { progress: prog })
    appendLog(id, `[${new Date().toLocaleTimeString()}] step ${i}/${total}`)
  }

  // simulate success rate 85%
  const ok = Math.random() < 0.85
  if (ok) {
    setNodeStatus(id, 'success', { progress: 100, lastResult: { id, at: Date.now(), kind } })
    appendLog(id, `[${new Date().toLocaleTimeString()}] success`)
  } else {
    setNodeStatus(id, 'error', { progress: 0, lastError: 'Mock error: transient failure' })
    appendLog(id, `[${new Date().toLocaleTimeString()}] error: transient failure`)
  }
  endRunToken?.(id)
}
