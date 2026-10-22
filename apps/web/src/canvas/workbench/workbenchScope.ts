import { useUIStore } from '../../ui/uiStore'
import { useRFStore } from '../store'

export type WorkbenchScope = Readonly<{
  projectId: string
  flowId: string | null
  chapterId: string | null
  provenance: string
}>

export function requireWorkbenchScope(): WorkbenchScope {
  const ui = useUIStore.getState()
  if (ui.viewOnly) throw new Error('当前画布为只读，无法提交创作或生成任务')
  const projectId = ui.currentProject?.id?.trim()
  const chapterId = ui.currentChapter?.chapterId.trim() || null
  const flowId = chapterId ? null : ui.currentFlow.id?.trim() || null
  if (!projectId || (!flowId && !chapterId)) throw new Error('请先打开已保存的项目画布或章节画布')
  if (ui.currentChapter && ui.currentChapter.projectId !== projectId) {
    throw new Error('当前章节与项目作用域不一致，未提交任务')
  }
  const provenance = chapterId ? `chapter:${chapterId}` : `flow:${flowId}`
  if (useRFStore.getState().graphProvenanceKey !== provenance) {
    throw new Error('画布作用域尚未就绪，未提交任务')
  }
  return { projectId, flowId, chapterId, provenance }
}

export function isWorkbenchScopeCurrent(scope: WorkbenchScope): boolean {
  const ui = useUIStore.getState()
  return ui.currentProject?.id === scope.projectId
    && (ui.currentChapter?.chapterId || null) === scope.chapterId
    && (scope.chapterId !== null || (ui.currentFlow.id || null) === scope.flowId)
    && useRFStore.getState().graphProvenanceKey === scope.provenance
}

export function assertWorkbenchScope(scope: WorkbenchScope): void {
  if (!isWorkbenchScopeCurrent(scope)) throw new Error('准备期间已切换画布，未继续派发本次任务')
  requireWorkbenchScope()
}
