import { createPortal } from 'react-dom'
import { IconArrowNarrowUp, IconX } from '@tabler/icons-react'
import { useStore } from '@xyflow/react'
import { selectNodesById, useRFStore } from '../../../store'
import type { LibTvImagePreset } from '../libTvImagePresets'

type PortalPositionProps = {
  nodeId: string
  nodeWidth: number
  nodeHeight: number | undefined
  defaultHeight: number
}

function usePortalPosition({ nodeId, nodeWidth, nodeHeight, defaultHeight }: PortalPositionProps): {
  barLeft: number
  barTop: number
  barWidth: number
} {
  const [panX, panY, zoom] = useStore((state) => state.transform)
  const position = useRFStore((state) => selectNodesById(state).get(nodeId)?.position)
  const nodeX = position?.x ?? 0
  const nodeY = position?.y ?? 0
  const resolvedHeight = nodeHeight ?? defaultHeight
  const barWidth = Math.max(360, Math.min(nodeWidth * zoom, 600))

  return {
    barLeft: nodeX * zoom + panX + (nodeWidth * zoom - barWidth) / 2,
    barTop: nodeY * zoom + panY + resolvedHeight * zoom + 14,
    barWidth,
  }
}

type ConfirmBarProps = {
  label: string
  credits: number
  onClose: () => void
  onExecute: () => void
} & PortalPositionProps

function ConfirmBar({
  label,
  credits,
  onClose,
  onExecute,
  ...positionProps
}: ConfirmBarProps): JSX.Element {
  const { barLeft, barTop, barWidth } = usePortalPosition(positionProps)

  return createPortal(
    <>
      <div
        className="tc-task-node__image-preset-intercept nodrag nopan"
        style={{ position: 'fixed', inset: 0, zIndex: 6000, pointerEvents: 'all' }}
        onClick={onClose}
      />
      <div
        className="tc-task-node__image-preset-bar nodrag nopan"
        style={{
          position: 'fixed',
          left: barLeft,
          top: barTop,
          width: barWidth,
          zIndex: 6001,
          pointerEvents: 'all',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '10px 10px 10px 14px',
          borderRadius: 16,
          background: 'rgba(13, 16, 24, 0.98)',
          border: '1px solid rgba(255,255,255,0.1)',
          boxShadow: '0 24px 56px rgba(0,0,0,0.48)',
        }}
      >
        <button
          type="button"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 32,
            height: 32,
            borderRadius: 8,
            border: 'none',
            background: 'rgba(255,255,255,0.08)',
            color: 'rgba(255,255,255,0.55)',
            cursor: 'pointer',
            flexShrink: 0,
          }}
          onClick={onClose}
        >
          <IconX size={15} />
        </button>
        <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: 'rgba(255,255,255,0.92)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {label}
        </span>
        {credits > 0 ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
            <span style={{ fontSize: 14, color: '#fbbf24' }}>⚡</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#fbbf24' }}>{credits}</span>
          </div>
        ) : null}
        <button
          type="button"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 44,
            height: 44,
            borderRadius: 12,
            border: 'none',
            background: '#5c636e',
            color: '#fff',
            cursor: 'pointer',
            flexShrink: 0,
            boxShadow: '0 6px 20px rgba(92,99,110,0.45)',
          }}
          onClick={onExecute}
        >
          <IconArrowNarrowUp size={22} />
        </button>
      </div>
    </>,
    document.body,
  )
}

type ImagePresetConfirmPortalProps = PortalPositionProps & {
  preset: LibTvImagePreset
  requiredGenerationCredits: number
  onClose: () => void
  onExecute: (key: string) => void
}

export function ImagePresetConfirmPortal({
  preset,
  requiredGenerationCredits,
  onClose,
  onExecute,
  ...positionProps
}: ImagePresetConfirmPortalProps): JSX.Element {
  return (
    <ConfirmBar
      {...positionProps}
      label={preset.label}
      credits={requiredGenerationCredits}
      onClose={onClose}
      onExecute={() => onExecute(preset.key)}
    />
  )
}

type PanoramicConfirmPortalProps = PortalPositionProps & {
  panoramicCredits: number
  onClose: () => void
  onExecute: () => void
}

export function PanoramicConfirmPortal({
  panoramicCredits,
  onClose,
  onExecute,
  ...positionProps
}: PanoramicConfirmPortalProps): JSX.Element {
  return (
    <ConfirmBar
      {...positionProps}
      label="生成720°全景图"
      credits={panoramicCredits}
      onClose={onClose}
      onExecute={onExecute}
    />
  )
}
