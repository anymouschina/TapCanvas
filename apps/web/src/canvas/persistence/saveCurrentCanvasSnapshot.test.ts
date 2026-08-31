import { describe, expect, it, vi } from 'vitest'
import { saveCurrentCanvasSnapshot } from './saveCurrentCanvasSnapshot'

describe('saveCurrentCanvasSnapshot', () => {
  it('waits for the chapter flush when a chapter canvas is active', async () => {
    const saveChapter = vi.fn(async () => undefined)
    const saveProject = vi.fn(async () => true)

    await expect(saveCurrentCanvasSnapshot({
      __TAPCANVAS_CURRENT_CHAPTER__: { chapterId: 'chapter-1' },
      __TAPCANVAS_CHAPTER_SAVE__: saveChapter,
      silentSaveProject: saveProject,
    })).resolves.toBe(true)

    expect(saveChapter).toHaveBeenCalledTimes(1)
    expect(saveProject).not.toHaveBeenCalled()
  })

  it('uses the project save outside a chapter canvas', async () => {
    const saveProject = vi.fn(async () => true)

    await expect(saveCurrentCanvasSnapshot({
      silentSaveProject: saveProject,
    })).resolves.toBe(true)

    expect(saveProject).toHaveBeenCalledTimes(1)
  })

  it('fails explicitly when the active canvas has no matching save capability', async () => {
    await expect(saveCurrentCanvasSnapshot({
      __TAPCANVAS_CURRENT_CHAPTER__: { chapterId: 'chapter-1' },
    })).resolves.toBe(false)
    await expect(saveCurrentCanvasSnapshot({})).resolves.toBe(false)
  })
})
