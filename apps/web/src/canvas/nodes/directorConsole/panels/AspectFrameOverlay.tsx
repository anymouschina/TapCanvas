import React from 'react'
import type { AspectFrameRect } from '../state/aspect'

/**
 * 画幅取景框叠加层（吸收 storyai-3d-director-desk 的画幅遮罩 + 九宫格）。
 * frame 给定时：框外半透明遮罩 + 白色描边，截图（captureView fovScale）只出框内内容——所见即所得；
 * frame 为 null（aspect=auto）：整个视口即画幅，仅按需画九宫格。整层 pointer-events:none，不挡 3D 交互。
 */
export function AspectFrameOverlay({ frame, showThirds }: { frame: AspectFrameRect | null; showThirds: boolean }) {
  if (!frame && !showThirds) return null
  const thirds = showThirds ? (
    <>
      <div style={{ ...lineStyle, left: '33.333%', top: 0, bottom: 0, width: 1 }} />
      <div style={{ ...lineStyle, left: '66.667%', top: 0, bottom: 0, width: 1 }} />
      <div style={{ ...lineStyle, top: '33.333%', left: 0, right: 0, height: 1 }} />
      <div style={{ ...lineStyle, top: '66.667%', left: 0, right: 0, height: 1 }} />
    </>
  ) : null
  if (!frame) {
    return <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 5 }}>{thirds}</div>
  }
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 5, overflow: 'hidden' }}>
      <div
        aria-label="画幅取景框"
        style={{
          position: 'absolute',
          left: frame.left,
          top: frame.top,
          width: frame.width,
          height: frame.height,
          border: '1px solid rgba(255,255,255,0.75)',
          boxShadow: '0 0 0 9999px rgba(6,8,13,0.62)',
          boxSizing: 'border-box',
        }}
      >
        {thirds}
      </div>
    </div>
  )
}

const lineStyle: React.CSSProperties = {
  position: 'absolute',
  background: 'rgba(255,255,255,0.28)',
  pointerEvents: 'none',
}
