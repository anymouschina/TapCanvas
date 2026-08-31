type WindowCanvasSaveApi = {
  silentSaveProject?: () => Promise<boolean>
  __TAPCANVAS_CHAPTER_SAVE__?: () => Promise<void>
  __TAPCANVAS_CURRENT_CHAPTER__?: unknown
}

/** Persist the currently visible canvas before a server-side agent fresh-reads it. */
export async function saveCurrentCanvasSnapshot(
  saveApi: WindowCanvasSaveApi = window as unknown as WindowCanvasSaveApi,
): Promise<boolean> {
  if (saveApi.__TAPCANVAS_CURRENT_CHAPTER__) {
    if (!saveApi.__TAPCANVAS_CHAPTER_SAVE__) return false
    await saveApi.__TAPCANVAS_CHAPTER_SAVE__()
    return true
  }
  if (!saveApi.silentSaveProject) return false
  return saveApi.silentSaveProject()
}
