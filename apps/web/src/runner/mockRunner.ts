import type { StateCreator } from 'zustand'
import type { Node } from '@xyflow/react'

type Getter = () => any
type Setter = (fn: (s: any) => any) => void

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)) }

export async function runNodeMock(id: string, get: Getter, set: Setter) {
  const node: Node | undefined = get().nodes.find((n: Node) => n.id === id)
  if (!node) return
  const kind = (node.data as any)?.kind ?? 'task'
  const setNodeStatusRaw = get().setNodeStatus as (id: string, status: any, patch?: any) => void
  const appendLogRaw = get().appendLog as (id: string, line: string) => void
  const beginToken = get().beginRunToken as (id: string) => string
  const isCanceledRaw = get().isCanceled as (id: string, runToken?: string | null) => boolean
  const endRunToken = get().endRunToken as (id: string) => void

  const runToken = beginToken?.(id)
  const isRunTokenActive = () => {
    if (!runToken) return true
    const current: Node | undefined = get().nodes.find((n: Node) => n.id === id)
    const currentToken = (current?.data as any)?.runToken
    return typeof currentToken === 'string' && currentToken === runToken
  }
  const setNodeStatus = (nodeId: string, status: any, patch?: any) => {
    if (nodeId === id && !isRunTokenActive()) return
    setNodeStatusRaw(nodeId, status, patch)
  }
  const appendLog = (nodeId: string, line: string) => {
    if (nodeId === id && !isRunTokenActive()) return
    appendLogRaw(nodeId, line)
  }
  const isCanceled = (nodeId: string) => Boolean(isCanceledRaw?.(nodeId, runToken))

  if (kind === 'workflowInput' || kind === 'workflowOutput') {
    setNodeStatus(id, 'queued', { progress: 0 })
    appendLog(id, `[${new Date().toLocaleTimeString()}] queued`)
    await sleep(80)
    if (isCanceled?.(id)) {
      setNodeStatus(id, 'canceled', { progress: 0 })
      appendLog(id, `[${new Date().toLocaleTimeString()}] canceled before start`)
      endRunToken?.(id)
      return
    }
    setNodeStatus(id, 'running', { progress: 30 })
    appendLog(id, `[${new Date().toLocaleTimeString()}] running kind=${kind}`)
    await sleep(100)
    setNodeStatus(id, 'success', {
      progress: 100,
      lastResult: {
        id,
        at: Date.now(),
        kind,
        preview: { type: 'text', value: kind === 'workflowInput' ? 'workflow input ready' : 'workflow output captured' },
      },
    })
    appendLog(id, `[${new Date().toLocaleTimeString()}] success`)
    endRunToken?.(id)
    return
  }

  setNodeStatus(id, 'queued', { progress: 0 })
  appendLog(id, `[${new Date().toLocaleTimeString()}] queued`)
  await sleep(200 + Math.random() * 300)
  if (isCanceled?.(id)) {
    setNodeStatus(id, 'canceled', { progress: 0 })
    appendLog(id, `[${new Date().toLocaleTimeString()}] canceled before start`)
    endRunToken?.(id)
    return
  }
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
    const preview = makePreview(kind, (node.data as any)?.label || kind)
    setNodeStatus(id, 'success', { progress: 100, lastResult: { id, at: Date.now(), kind, preview } })
    appendLog(id, `[${new Date().toLocaleTimeString()}] success`)
  } else {
    setNodeStatus(id, 'error', { progress: 0, lastError: 'Mock error: transient failure' })
    appendLog(id, `[${new Date().toLocaleTimeString()}] error: transient failure`)
  }
  endRunToken?.(id)
}

function makePreview(kind: string, text: string) {
  if (kind === 'video') {
    const svg = encodeURIComponent(`<?xml version="1.0" encoding="UTF-8"?><svg xmlns='http://www.w3.org/2000/svg' width='480' height='270'><rect width='100%' height='100%' fill='#111827'/><text x='50%' y='50%' fill='#e5e7eb' dominant-baseline='middle' text-anchor='middle' font-size='16' font-family='system-ui'>${text}</text></svg>`)
    return { type: 'image', src: `data:image/svg+xml;charset=UTF-8,${svg}` }
  }
  if (kind === 'audio') {
    return { type: 'audio', src: '' }
  }
  if (kind === 'subtitle') {
    return { type: 'text', value: 'subtitle draft generated' }
  }
  return { type: 'text', value: 'ok' }
}
