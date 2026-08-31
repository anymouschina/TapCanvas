import type { CSSProperties } from 'react'

// ── 底部居中工具栏（FloatingNav 横向化）上方弹出面板的定位 ──────────────
// 面板锚定在触发项的水平中心 anchorX 正上方，向上生长；底边固定在工具栏之上。
export const FLOATING_BAR_BOTTOM = 18   // 工具栏距视窗底部
export const FLOATING_BAR_HEIGHT = 58   // 工具栏自身高度（pill）
export const FLOATING_BAR_GAP = 12      // 面板底边与工具栏顶部的间隙
export const BOTTOM_BAR_PANEL_HEIGHT_SCALE = 2 / 3
export const BOTTOM_BAR_PANEL_VIEWPORT_MARGIN = 24

/**
 * 底部工具栏在可用画布区域内的实时中心。
 *
 * 左侧素材抽屉与右侧 AI 对话都会改变画布的可用宽度，因此不能在点击时把
 * 某个按钮的 viewport 坐标快照当成长生命周期面板的定位依据。
 */
export const BOTTOM_BAR_LAYOUT_CENTER =
  'calc(50% + var(--tc-asset-drawer-width, 0px) / 2 - var(--tc-ai-chat-reserved-width, 0px) / 2)'

/**
 * 底部工具栏面板的固定最大宽度。
 * 新面板必须选择其中一种规格，禁止由当前 Tab / 列表内容自然撑开外框。
 */
export const BOTTOM_BAR_PANEL_WIDTH = {
  compact: 300,
  regular: 440,
  wide: 664,
} as const

export type BottomBarPanelMetrics = Readonly<{
  width: number
  height: number
}>

/** 面板底边距视窗底部的距离 */
export function bottomBarPanelOffset(): number {
  return FLOATING_BAR_BOTTOM + FLOATING_BAR_HEIGHT + FLOATING_BAR_GAP
}

/** 底部工具栏上方面板的安全最大高度（不超出视窗顶部） */
export function bottomBarSafeMaxHeight(padding = 24): number {
  if (typeof window === 'undefined') return 480
  return Math.max(220, window.innerHeight - bottomBarPanelOffset() - padding)
}

/** 面板使用安全最大高度的指定比例，小视窗下仍保留最低可操作高度。 */
export function bottomBarScaledPanelHeight(scale: number, padding = 24): number {
  const safeMaxHeight = bottomBarSafeMaxHeight(padding)
  const normalizedScale = Math.min(1, Math.max(0, scale))
  return Math.min(safeMaxHeight, Math.max(220, Math.round(safeMaxHeight * normalizedScale)))
}

/**
 * 返回稳定的底部面板外框尺寸：宽度只受视窗边距约束，高度固定为安全高度的 2/3。
 * Tab、分类、加载态和空状态只能在外框内部滚动，不得改变这两个尺寸。
 */
export function bottomBarPanelMetrics(
  maxWidth: number,
  padding = BOTTOM_BAR_PANEL_VIEWPORT_MARGIN,
): BottomBarPanelMetrics {
  const viewportWidth = typeof window === 'undefined' ? 1280 : window.innerWidth
  return {
    width: Math.min(maxWidth, Math.max(0, viewportWidth - BOTTOM_BAR_PANEL_VIEWPORT_MARGIN)),
    height: bottomBarScaledPanelHeight(BOTTOM_BAR_PANEL_HEIGHT_SCALE, padding),
  }
}

/** 返回锚定在 anchorX 正上方、向上生长的 fixed 定位样式 */
export function bottomBarPanelStyle(
  anchorX?: number | null,
  opts?: { zIndex?: number; halfWidth?: number },
): CSSProperties {
  const half = typeof opts?.halfWidth === 'number' ? opts.halfWidth : 180
  const viewportW = typeof window !== 'undefined' ? window.innerWidth : 1280
  let left = typeof anchorX === 'number' && Number.isFinite(anchorX) ? anchorX : viewportW / 2
  const margin = 12
  left = Math.min(Math.max(left, half + margin), viewportW - half - margin)
  return {
    position: 'fixed',
    left,
    bottom: bottomBarPanelOffset(),
    transform: 'translateX(-50%)',
    zIndex: opts?.zIndex ?? 200,
  }
}

/**
 * 返回持续跟随底部工具栏中心的 fixed 定位样式。
 *
 * 适用于风格库、角色库等宽面板：它们是工具栏级工作区，不应围绕某一个
 * 图标定位。CSS 变量变化时面板会与工具栏同步移动，关闭后重开也不会因为
 * 点击时机不同而横向漂移。
 */
export function bottomBarCenteredPanelStyle(
  opts?: { zIndex?: number; halfWidth?: number },
): CSSProperties {
  const half = typeof opts?.halfWidth === 'number' ? opts.halfWidth : 180
  const margin = 12
  const safeInset = `min(${half + margin}px, 50vw)`

  return {
    position: 'fixed',
    left: `clamp(${safeInset}, ${BOTTOM_BAR_LAYOUT_CENTER}, calc(100vw - ${safeInset}))`,
    bottom: bottomBarPanelOffset(),
    transform: 'translateX(-50%)',
    transition: 'left 220ms ease',
    zIndex: opts?.zIndex ?? 200,
  }
}

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

  // 在空间受限时允许小于默认最小高度，避免被底部对话框遮挡
  return Math.max(availableHeight, 180)
}

function getBottomDialogInset(viewportHeight: number): number {
  if (typeof document === 'undefined') return 0
  const chat = document.querySelector('.tc-ai-chat') as HTMLElement | null
  if (!chat || chat.classList.contains('tc-ai-chat--maximized') || chat.classList.contains('tc-ai-chat--expanded')) return 0

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
