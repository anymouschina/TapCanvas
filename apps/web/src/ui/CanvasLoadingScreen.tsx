/** 统一的画布加载态：复用 Canvas 初载遮罩（tc-canvas-loading）的视觉与 0.4s 渐现淡出，
 *  让路由 fallback / 章节冷启动 / 画布揭幕呈现为同一种加载状态，消除多段异质加载闪烁。
 *  fixed：脱离定位父级铺满视口（路由级 fallback 用）；hidden：淡出（复用 --hidden 过渡）。 */
export function CanvasLoadingScreen({ fixed = false, hidden = false }: { fixed?: boolean; hidden?: boolean }): JSX.Element {
  return (
    <div
      className={`tc-canvas-loading${hidden ? ' tc-canvas-loading--hidden' : ''}`}
      style={fixed ? { position: 'fixed' } : undefined}
      aria-hidden
    >
      <div className="tc-canvas-loading__spinner" />
      <div className="tc-canvas-loading__text">加载中…</div>
    </div>
  )
}
