// apps/web/src/canvas/nodes/taskNode/HdUpscalePanel.tsx
import React from 'react'
import { NodeToolbar, Position } from '@xyflow/react'

type HdUpscalePanelProps = {
  isOpen: boolean
  isDarkUi: boolean
  inlineDividerColor: string
  onClose: () => void
  onApply: (scale: 2 | 4) => void
  loading?: boolean
}

export function HdUpscalePanel({ isOpen, isDarkUi, inlineDividerColor, onClose, onApply, loading }: HdUpscalePanelProps) {
  const [scale, setScale] = React.useState<2 | 4>(2)
  const bg = isDarkUi ? 'rgba(22,23,28,0.97)' : 'rgba(244,246,250,0.98)'
  const border = isDarkUi ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.10)'
  const textPrimary = isDarkUi ? 'rgba(255,255,255,0.88)' : 'rgba(17,18,21,0.88)'
  const textMuted = isDarkUi ? 'rgba(255,255,255,0.42)' : 'rgba(17,18,21,0.42)'
  const btnActiveBg = isDarkUi ? 'rgba(255,255,255,0.14)' : 'rgba(17,18,21,0.12)'

  return (
    <NodeToolbar isVisible={isOpen} position={Position.Bottom} offset={8} className="tc-hd-panel nodrag nopan">
      <div style={{
        background: bg, border: `1px solid ${border}`, borderRadius: 16,
        boxShadow: '0 16px 48px rgba(0,0,0,0.32)', padding: '14px 18px',
        display: 'flex', flexDirection: 'column', gap: 12, minWidth: 220,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: textPrimary }}>高清放大</span>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: textMuted, fontSize: 18, lineHeight: 1 }}>×</button>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          {([2, 4] as const).map(s => (
            <button
              key={s}
              onClick={() => setScale(s)}
              style={{
                flex: 1, padding: '8px 0', borderRadius: 10,
                border: `1px solid ${scale === s ? (isDarkUi ? 'rgba(255,255,255,0.28)' : 'rgba(0,0,0,0.2)') : border}`,
                background: scale === s ? btnActiveBg : 'transparent',
                color: scale === s ? textPrimary : textMuted,
                fontSize: 14, fontWeight: scale === s ? 700 : 500, cursor: 'pointer',
              }}
            >
              {s}×
            </button>
          ))}
        </div>

        <button
          disabled={loading}
          onClick={() => onApply(scale)}
          style={{
            padding: '9px 0', borderRadius: 10, border: 'none', cursor: loading ? 'wait' : 'pointer',
            background: isDarkUi ? 'rgba(255,255,255,0.88)' : 'rgba(17,18,21,0.88)',
            color: isDarkUi ? '#131316' : '#fff', fontSize: 13, fontWeight: 600,
            opacity: loading ? 0.6 : 1,
          }}
        >
          {loading ? '生成中…' : '生成高清图'}
        </button>
      </div>
    </NodeToolbar>
  )
}
