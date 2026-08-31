import { describe, expect, it, vi } from 'vitest'
import {
  persistCodexCanvasBeforeDispatch,
  type CodexCanvasPersistenceDependencies,
} from './codexCanvasPersistence'

function dependencies(
  overrides: Partial<CodexCanvasPersistenceDependencies> = {},
): CodexCanvasPersistenceDependencies {
  return {
    isProjectDirty: () => false,
    readCurrentFlowId: () => 'flow-1',
    saveProject: vi.fn(async () => true),
    readFlowRevision: vi.fn(async () => 7),
    saveChapter: vi.fn(async () => 11),
    ...overrides,
  }
}

describe('persistCodexCanvasBeforeDispatch', () => {
  it('flushes a dirty project canvas before reading its authoritative revision', async () => {
    let dirty = true
    const saveProject = vi.fn(async () => {
      dirty = false
      return true
    })
    const readFlowRevision = vi.fn(async () => 8)

    await expect(persistCodexCanvasBeforeDispatch(
      { flowId: 'flow-1', chapterId: null },
      dependencies({
        isProjectDirty: () => dirty,
        saveProject,
        readFlowRevision,
      }),
    )).resolves.toEqual({
      flowId: 'flow-1',
      chapterId: null,
      canvasRevision: 8,
    })
    expect(saveProject).toHaveBeenCalledOnce()
    expect(readFlowRevision).toHaveBeenCalledWith('flow-1')
  })

  it('fails when edits remain dirty after the save barrier', async () => {
    await expect(persistCodexCanvasBeforeDispatch(
      { flowId: 'flow-1', chapterId: null },
      dependencies({ isProjectDirty: () => true }),
    )).rejects.toThrow('保存期间又发生了编辑')
  })

  it('flushes a chapter canvas and uses the returned chapter revision', async () => {
    const saveChapter = vi.fn(async () => 12)
    const readFlowRevision = vi.fn(async () => 99)

    await expect(persistCodexCanvasBeforeDispatch(
      { flowId: null, chapterId: 'chapter-1' },
      dependencies({ saveChapter, readFlowRevision }),
    )).resolves.toEqual({
      flowId: null,
      chapterId: 'chapter-1',
      canvasRevision: 12,
    })
    expect(saveChapter).toHaveBeenCalledWith('chapter-1')
    expect(readFlowRevision).not.toHaveBeenCalled()
  })

  it('rejects an unverifiable revision instead of dispatching stale context', async () => {
    await expect(persistCodexCanvasBeforeDispatch(
      { flowId: 'flow-1', chapterId: null },
      dependencies({ readFlowRevision: async () => null }),
    )).rejects.toThrow('没有返回可验证的画布版本')
  })

  it('uses the flow created by the persistence barrier for a first save', async () => {
    let dirty = true
    let currentFlowId = ''
    const saveProject = vi.fn(async () => {
      dirty = false
      currentFlowId = 'flow-created'
      return true
    })

    await expect(persistCodexCanvasBeforeDispatch(
      { flowId: null, chapterId: null },
      dependencies({
        isProjectDirty: () => dirty,
        readCurrentFlowId: () => currentFlowId,
        saveProject,
        readFlowRevision: async (flowId) => flowId === 'flow-created' ? 1 : null,
      }),
    )).resolves.toEqual({
      flowId: 'flow-created',
      chapterId: null,
      canvasRevision: 1,
    })
  })
})
