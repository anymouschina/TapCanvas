/**
 * 计算安全的面板最大高度，确保不会超出视窗
 * @param anchorY 锚点Y坐标
 * @param offsetTop Y轴偏移量
 * @param padding 底部边距
 * @returns 最大高度值
 */
export function calculateSafeMaxHeight(anchorY?: number | null, offsetTop = 150, padding = 40) {
  const viewportHeight = window.innerHeight
  const topPosition = anchorY ? anchorY - offsetTop : 140
  const reservedBottomInset = getBottomDialogInset(viewportHeight)

  // 计算可用空间：视窗高度 - 面板顶部位置 - 底部边距 - 底部悬浮对话框占位
  const availableHeight = viewportHeight - topPosition - padding - reservedBottomInset
  const maxHeight = Math.min(availableHeight, 800)

  // 在空间受限时允许小于默认最小高度，避免被底部对话框遮挡
  return Math.max(maxHeight, 180)
}

function getBottomDialogInset(viewportHeight: number): number {
  if (typeof document === 'undefined') return 0
  const chat = document.querySelector('.tc-ai-chat') as HTMLElement | null
  if (!chat || chat.classList.contains('tc-ai-chat--maximized')) return 0

  const style = window.getComputedStyle(chat)
  if (style.display === 'none' || style.visibility === 'hidden') return 0

  const rect = chat.getBoundingClientRect()
  if (!Number.isFinite(rect.top) || rect.height <= 0) return 0

  const leftPanelLeft = 82
  const leftPanelMaxWidth = 720
  const leftPanelRight = leftPanelLeft + leftPanelMaxWidth
  const overlapsLeftPanelHorizontally = rect.left < leftPanelRight && rect.right > leftPanelLeft
  if (!overlapsLeftPanelHorizontally) return 0

  // 预留底部对话框顶部以上空间，避免面板滚动内容被遮住
  const inset = viewportHeight - rect.top + 12
  return Math.max(0, inset)
}
