import { getServerFlow } from '../../../api/server'
import { useUIStore } from '../../uiStore'

type CodexCanvasPersistenceScope = {
  flowId: string | null
  chapterId: string | null
}

export type CodexCanvasPersistenceDependencies = {
  isProjectDirty: () => boolean
  readCurrentFlowId: () => string
  saveProject: () => Promise<boolean>
  readFlowRevision: (flowId: string) => Promise<number | null>
  saveChapter: (chapterId: string) => Promise<number>
}

type CodexCanvasPersistenceWindow = Window & {
  silentSaveProject?: () => Promise<boolean>
  __TAPCANVAS_CODEX_CHAPTER_SAVE__?: (chapterId: string) => Promise<number>
}

export type PersistedCodexCanvasScope = {
  flowId: string | null
  chapterId: string | null
  canvasRevision: number | null
}

function requireCanvasRevision(value: number | null, scope: string): number {
  if (!Number.isInteger(value) || value === null || value < 0) {
    throw new Error(`${scope} 保存完成后没有返回可验证的画布版本`)
  }
  return value
}

const browserDependencies: CodexCanvasPersistenceDependencies = {
  isProjectDirty: () => useUIStore.getState().isDirty,
  readCurrentFlowId: () => String(useUIStore.getState().currentFlow.id || '').trim(),
  saveProject: async () => {
    const save = (window as CodexCanvasPersistenceWindow).silentSaveProject
    if (!save) {
      throw new Error('当前项目画布没有注册持久化能力，不能派发旧画布给 Codex')
    }
    return save()
  },
  readFlowRevision: async (flowId) => {
    const flow = await getServerFlow(flowId)
    return typeof flow.canvasRevision === 'number' ? flow.canvasRevision : null
  },
  saveChapter: async (chapterId) => {
    const save = (window as CodexCanvasPersistenceWindow)
      .__TAPCANVAS_CODEX_CHAPTER_SAVE__
    if (!save) {
      throw new Error('当前章节画布没有注册持久化能力，不能派发旧画布给 Codex')
    }
    return save(chapterId)
  },
}

export async function persistCodexCanvasBeforeDispatch(
  scope: CodexCanvasPersistenceScope,
  dependencies: CodexCanvasPersistenceDependencies = browserDependencies,
): Promise<PersistedCodexCanvasScope> {
  if (scope.flowId && scope.chapterId) {
    throw new Error('Codex 画布作用域不能同时包含 flowId 与 chapterId')
  }

  if (scope.chapterId) {
    const revision = await dependencies.saveChapter(scope.chapterId)
    return {
      flowId: null,
      chapterId: scope.chapterId,
      canvasRevision: requireCanvasRevision(revision, '章节画布'),
    }
  }

  let flowId = scope.flowId || dependencies.readCurrentFlowId() || null

  if (dependencies.isProjectDirty()) {
    const saved = await dependencies.saveProject()
    if (!saved) {
      throw new Error('当前项目画布尚未保存，Codex 派发已停止')
    }
    if (dependencies.isProjectDirty()) {
      throw new Error('项目画布保存期间又发生了编辑，请保存完成后重新派发 Codex')
    }
    flowId = dependencies.readCurrentFlowId() || flowId
  }

  if (!flowId) {
    return { flowId: null, chapterId: null, canvasRevision: null }
  }
  const currentFlowId = dependencies.readCurrentFlowId()
  if (currentFlowId && currentFlowId !== flowId) {
    throw new Error('保存期间当前 flow 已切换，请在目标画布上重新派发 Codex')
  }
  const revision = requireCanvasRevision(
    await dependencies.readFlowRevision(flowId),
    '项目画布',
  )
  if (dependencies.isProjectDirty()) {
    throw new Error('读取画布版本期间又发生了编辑，请保存完成后重新派发 Codex')
  }
  return { flowId, chapterId: null, canvasRevision: revision }
}
