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

  // 计算可用空间：视窗高度 - 面板顶部位置 - 底部边距
  const availableHeight = viewportHeight - topPosition - padding

  // 设置合理的最小和最大高度限制
  return Math.min(Math.max(availableHeight, 300), 800) // 最小300px，最大800px
}