import React from 'react'
import { NodeToolbar, Position } from '@xyflow/react'

type RotatePanelProps = {
  isOpen: boolean
  isDarkUi: boolean
  angle: number
  flipH: boolean
  flipV: boolean
  saving: boolean
  onAngleChange: (a: number) => void
  onFlipHChange: (v: boolean) => void
  onFlipVChange: (v: boolean) => void
  onSave: () => void
  onClose: () => void
}

export function RotatePanel({ isOpen, isDarkUi, angle, flipH, flipV, saving, onAngleChange, onFlipHChange, onFlipVChange, onSave, onClose }: RotatePanelProps) {
  const isUnchanged = angle === 0 && !flipH && !flipV

  const bg = isDarkUi ? 'rgba(22,23,28,0.97)' : 'rgba(244,246,250,0.98)'
  const border = isDarkUi ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.10)'
  const text = isDarkUi ? 'rgba(255,255,255,0.88)' : 'rgba(17,18,21,0.88)'
  const muted = isDarkUi ? 'rgba(255,255,255,0.40)' : 'rgba(17,18,21,0.40)'
  const btnBg = isDarkUi ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)'
  const activeBg = isDarkUi ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.13)'

  const divider = (
    <div style={{ width: 1, height: 18, background: border, flexShrink: 0 }} />
  )

  return (
    <NodeToolbar isVisible={isOpen} position={Position.Top} offset={8} className="tc-rotate-toolbar nodrag nopan">
      <div style={{
        background: bg,
        border: `1px solid ${border}`,
        borderRadius: 14,
        boxShadow: '0 8px 32px rgba(0,0,0,0.28)',
        padding: '7px 12px',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        whiteSpace: 'nowrap',
      }}>
        {/* Title */}
        <span style={{ fontSize: 13, fontWeight: 600, color: text, paddingRight: 2 }}>
          旋转与镜像
        </span>

        {divider}

        {/* Angle input */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: 14, color: muted, lineHeight: 1 }}>↺</span>
          <input
            type="number"
            min={-180}
            max={180}
            step={1}
            value={angle}
            onChange={e => {
              const v = Number(e.target.value)
              if (!Number.isNaN(v)) onAngleChange(Math.max(-180, Math.min(180, v)))
            }}
            style={{
              width: 48,
              background: btnBg,
              border: `1px solid ${border}`,
              borderRadius: 7,
              color: text,
              fontSize: 13,
              fontWeight: 600,
              fontVariantNumeric: 'tabular-nums',
              padding: '4px 6px',
              textAlign: 'center',
              outline: 'none',
            }}
          />
          <span style={{ fontSize: 12, color: muted }}>°</span>
        </div>

        {divider}

        {/* Rotate CW 90° */}
        <IconButton
          title="顺时针旋转 90°"
          bg={btnBg}
          border={border}
          color={text}
          onClick={() => onAngleChange(((angle + 90 + 180) % 360) - 180)}
        >
          ↻ 90°
        </IconButton>

        {/* Flip H */}
        <IconButton
          title="水平翻转"
          bg={flipH ? activeBg : btnBg}
          border={border}
          color={text}
          onClick={() => onFlipHChange(!flipH)}
        >
          ↔
        </IconButton>

        {/* Flip V */}
        <IconButton
          title="垂直翻转"
          bg={flipV ? activeBg : btnBg}
          border={border}
          color={text}
          onClick={() => onFlipVChange(!flipV)}
        >
          ↕
        </IconButton>

        {divider}

        {/* Save */}
        <button
          disabled={saving || isUnchanged}
          onClick={onSave}
          style={{
            padding: '6px 16px',
            borderRadius: 9,
            border: 'none',
            cursor: saving || isUnchanged ? 'not-allowed' : 'pointer',
            background: saving
              ? (isDarkUi ? 'rgba(255,255,255,0.55)' : 'rgba(17,18,21,0.55)')
              : (isDarkUi ? 'rgba(255,255,255,0.90)' : 'rgba(17,18,21,0.88)'),
            color: isDarkUi ? '#131316' : '#fff',
            fontSize: 13,
            fontWeight: 600,
            opacity: isUnchanged ? 0.42 : 1,
            display: 'flex',
            alignItems: 'center',
            gap: 5,
          }}
        >
          {saving && (
            <span style={{
              display: 'inline-block',
              width: 11,
              height: 11,
              border: '2px solid currentColor',
              borderTopColor: 'transparent',
              borderRadius: '50%',
              animation: 'tc-spin 0.7s linear infinite',
            }} />
          )}
          {saving ? '保存中' : '保存'}
        </button>

        {/* Close */}
        <button
          onClick={onClose}
          title="关闭"
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: muted,
            fontSize: 16,
            lineHeight: 1,
            padding: '0 2px',
            marginLeft: 2,
          }}
        >
          ×
        </button>
      </div>
    </NodeToolbar>
  )
}

function IconButton({
  children, title, bg, border, color, onClick,
}: {
  children: React.ReactNode
  title: string
  bg: string
  border: string
  color: string
  onClick: () => void
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      style={{
        padding: '5px 10px',
        borderRadius: 8,
        border: `1px solid ${border}`,
        background: bg,
        color,
        fontSize: 13,
        fontWeight: 500,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </button>
  )
}
