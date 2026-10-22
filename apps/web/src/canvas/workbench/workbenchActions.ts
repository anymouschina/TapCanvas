import { runNodeDagToTarget } from '../../runner/dag'
import { persistCodexCanvasBeforeDispatch } from '../../ui/chat/codex/codexCanvasPersistence'
import { useRFStore } from '../store'
import { normalizeTaskNodeKind } from '../nodes/taskNodeSchema'
import { assertWorkbenchScope, isWorkbenchScopeCurrent, requireWorkbenchScope } from './workbenchScope'

type CanvasState = ReturnType<typeof useRFStore.getState>
type CanvasUpdate = (state: CanvasState) => Partial<CanvasState>
const running = new Map<string, Promise<void>>()
const generatableKinds: ReadonlySet<string> = new Set(['image', 'imageEdit', 'storyboard', 'video', 'videoCompose', 'audio'])

function requireTarget(id: string): void {
  const node = useRFStore.getState().nodes.find(candidate => candidate.id === id)
  if (!node) throw new Error('目标节点已不存在，请重新选择')
  if (node.data.readOnly === true) throw new Error('目标节点为只读，无法生成')
  const kind = normalizeTaskNodeKind(typeof node.data.kind === 'string' ? node.data.kind : '')
  if (node.type !== 'taskNode' || !kind || !generatableKinds.has(kind)) {
    throw new Error('所选节点不支持直接生成，请通过创作要求提交给小T处理')
  }
}

/** Use the same dependency and accepted-receipt path as the canvas node's generate action. */
export async function generateWorkbenchTargets(ids: readonly string[], signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  const targetIds = [...new Set(ids)]
  if (!targetIds.length) throw new Error('请先选择要生成的节点')
  const scope = requireWorkbenchScope()
  targetIds.forEach(requireTarget)
  const persisted = await persistCodexCanvasBeforeDispatch({ flowId: scope.flowId, chapterId: scope.chapterId })
  assertWorkbenchScope(scope)
  signal?.throwIfAborted()
  if (persisted.flowId !== scope.flowId || persisted.chapterId !== scope.chapterId) {
    throw new Error('保存回执与当前画布作用域不一致，未提交任务')
  }
  targetIds.forEach(requireTarget)
  const get = (): CanvasState => {
    if (!isWorkbenchScopeCurrent(scope)) throw new Error('执行期间已切换画布，未继续访问原画布任务')
    const state = useRFStore.getState()
    // Remote/audio runners retain these handlers across awaits; bind their writes to this graph too.
    return {
      ...state,
      setNodeStatus: (...args: Parameters<CanvasState['setNodeStatus']>) => {
        if (isWorkbenchScopeCurrent(scope)) state.setNodeStatus(...args)
      },
      appendLog: (...args: Parameters<CanvasState['appendLog']>) => {
        if (isWorkbenchScopeCurrent(scope)) state.appendLog(...args)
      },
      updateNodeData: (...args: Parameters<CanvasState['updateNodeData']>) => {
        if (isWorkbenchScopeCurrent(scope)) state.updateNodeData(...args)
      },
      beginRunToken: (...args: Parameters<CanvasState['beginRunToken']>) => {
        assertWorkbenchScope(scope)
        return state.beginRunToken(...args)
      },
      endRunToken: (...args: Parameters<CanvasState['endRunToken']>) => {
        if (isWorkbenchScopeCurrent(scope)) state.endRunToken(...args)
      },
      isCanceled: (...args: Parameters<CanvasState['isCanceled']>) =>
        !isWorkbenchScopeCurrent(scope) || state.isCanceled(...args),
    }
  }
  const set = (update: CanvasUpdate): void => {
    useRFStore.setState(state => isWorkbenchScopeCurrent(scope) ? update(state) : {})
  }
  const failures: string[] = []
  // Run terminals in order so shared prerequisite assets are generated once.
  for (const id of targetIds) {
    signal?.throwIfAborted()
    assertWorkbenchScope(scope)
    get()
    requireTarget(id)
    const key = `${scope.provenance}:${id}`
    let work = running.get(key)
    if (!work) {
      work = runNodeDagToTarget(id, get, set, { concurrency: 1 }).finally(() => running.delete(key))
      running.set(key, work)
    }
    try {
      await work
    } catch (failure: unknown) {
      assertWorkbenchScope(scope)
      signal?.throwIfAborted()
      failures.push(`${id}：${failure instanceof Error ? failure.message : String(failure)}`)
    }
  }
  if (failures.length) throw new Error(failures.join('；'))
}
