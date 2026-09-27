import type { Node } from '@xyflow/react'
import { create } from 'zustand'
import { callPreparedMediaTool, readPreparedMediaNode, type PreparedMediaScope } from '../api/preparedWorkflowMedia'
import { getWorkflowExecutionFamily } from '../api/server'
import { useUIStore } from '../ui/uiStore'
import { persistCodexCanvasBeforeDispatch } from '../ui/chat/codex/codexCanvasPersistence'
import { rebaseValue } from '../canvas/persistence/flowConflictRebase'
import { isUnsubmittedWorkflowMedia } from './workflowMediaExecutionState'

type MediaState = { nodes: Node[]; graphProvenanceKey: string | null }
type Getter = () => MediaState
type Setter = (update: (state: MediaState) => Partial<MediaState>) => void
export const usePreparedMediaSubmissionStore = create<{ pending: ReadonlySet<string> }>(() => ({ pending: new Set() }))
const inFlight = new Map<string, Promise<void>>()
const text = (value: unknown) => typeof value === 'string' ? value.trim() : ''
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error)

function scopeFor(key: string | null): PreparedMediaScope {
  const projectId = useUIStore.getState().currentProject?.id
  if (!projectId || !key) throw new Error('缺少当前画布的项目归属，未提交媒体任务')
  if (key.startsWith('chapter:')) return { projectId, chapterId: key.slice('chapter:'.length) }
  if (key.startsWith('flow:')) return { projectId, flowId: key.slice('flow:'.length) }
  throw new Error('当前画布归属不支持媒体提交')
}

async function submitAndObserve(id: string, get: Getter, set: Setter): Promise<void> {
  const provenance = get().graphProvenanceKey
  const scope = scopeFor(provenance)
  const currentNodeData = () => {
    if (get().graphProvenanceKey !== provenance) throw new Error('画布已切换；已受理的媒体任务继续在原画布执行')
    const node = get().nodes.find(candidate => candidate.id === id)
    if (!node) throw new Error('媒体节点已移除')
    return node.data
  }
  // Use the existing acknowledged save path, including its concurrent-save wait.
  // A read before this boundary could replace a just-edited prompt/model with stale data.
  await persistCodexCanvasBeforeDispatch({ chapterId: scope.chapterId ?? null, flowId: scope.flowId ?? null })
  let readBaseline = currentNodeData()
  const savedSnapshot = JSON.stringify(readBaseline)
  const read = async () => {
    const data = await readPreparedMediaNode(scope, id)
    currentNodeData()
    set(state => ({ nodes: state.nodes.map(node => node.id === id
      ? { ...node, data: rebaseValue(readBaseline, node.data, data) as Node['data'] }
      : node) }))
    readBaseline = data
    return data
  }
  // Detect edits made while the initial read is in flight before merging or submitting.
  const initialData = await readPreparedMediaNode(scope, id)
  if (JSON.stringify(currentNodeData()) !== savedSnapshot) {
    throw new Error('媒体节点在保存后又发生了编辑，本次未提交；请完成编辑后生成')
  }
  set(state => ({ nodes: state.nodes.map(node => node.id === id ? { ...node, data: initialData } : node) }))
  readBaseline = initialData
  let data = initialData
  const node = get().nodes.find(candidate => candidate.id === id)
  if (!node) throw new Error('媒体节点已移除')
  if (isUnsubmittedWorkflowMedia(node)) {
    const submissionSnapshot = JSON.stringify(currentNodeData())
    const family = await getWorkflowExecutionFamily(text(data.workflowExecutionId), 1)
    if (family.activeExecutionCount > 0) throw new Error('原工作流仍在执行，当前节点由该执行负责；未重复提交')
    if (JSON.stringify(currentNodeData()) !== submissionSnapshot) {
      throw new Error('媒体节点在提交前又发生了编辑，本次未提交；请完成编辑后生成')
    }
    let submissionFailure: { cause: unknown } | null = null
    try {
      await callPreparedMediaTool(scope, data.kind === 'video' ? 'tapcanvas_video_generate_to_canvas' : 'tapcanvas_image_generate_to_canvas', { nodeId: id })
    } catch (cause) {
      submissionFailure = { cause }
      console.warn('[prepared-media-submission] response failed; verifying saved node', { nodeId: id, provenance, error: errorText(cause) })
    }
    // The POST can lose its response after a durable claim or provider acceptance.
    // Always read the same node before interpreting the request error; never resubmit.
    try {
      data = await read()
    } catch (cause) {
      if (submissionFailure) {
        throw new Error(`媒体提交请求失败：${errorText(submissionFailure.cause)}；原节点回读失败：${errorText(cause)}；受理状态未确认，未重复提交`)
      }
      throw cause
    }
    if (submissionFailure) {
      const taskId = text(data.videoTaskId) || text(data.imageTaskId) || text(data.taskId)
      const accepted = (data.status === 'running' || data.status === 'queued') && taskId
      if (data.status !== 'success' && !accepted) {
        const nodeError = text(data.lastError) || text(data.errorMessage)
        throw new Error(`媒体提交请求失败：${errorText(submissionFailure.cause)}${nodeError ? `；节点记录：${nodeError}` : ''}；未重复提交`)
      }
    }
  }
  while (true) {
    if (data.status === 'success') return
    if (data.status === 'error' || data.status === 'failed' || data.status === 'canceled') {
      throw new Error(text(data.lastError) || text(data.errorMessage) || `媒体任务状态：${String(data.status)}`)
    }
    if (data.status !== 'running' && data.status !== 'queued') throw new Error('节点尚无可对账的媒体任务；未提交重试')
    const taskId = text(data.videoTaskId) || text(data.imageTaskId) || text(data.taskId)
    if (!taskId) throw new Error('媒体提交结果尚无任务回执，请查看节点记录；未重复提交')
    await callPreparedMediaTool(scope, data.kind === 'video' ? 'tapcanvas_video_reconcile' : 'tapcanvas_image_reconcile',
      data.kind === 'video' ? { nodeId: id, taskId } : { nodeId: id, taskId, waitSeconds: 10 })
    data = await read()
    if (data.status === 'running' || data.status === 'queued') await new Promise(resolve => setTimeout(resolve, 3000))
  }
}

/** First submission keeps the saved node and its provider idempotency identity. */
export function runPreparedWorkflowMediaNode(id: string, get: Getter, set: Setter): Promise<void> {
  const key = `${get().graphProvenanceKey}:${id}`
  const existing = inFlight.get(key)
  if (existing) return existing
  usePreparedMediaSubmissionStore.setState(state => ({ pending: new Set([...state.pending, id]) }))
  const work = submitAndObserve(id, get, set).finally(() => {
    inFlight.delete(key)
    usePreparedMediaSubmissionStore.setState(state => ({ pending: new Set([...state.pending].filter(nodeId => nodeId !== id)) }))
  })
  inFlight.set(key, work)
  return work
}
