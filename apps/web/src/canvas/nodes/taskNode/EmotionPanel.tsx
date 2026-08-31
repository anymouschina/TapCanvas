import React from 'react'
import { IconArrowUp, IconLoader2, IconPlus, IconX } from '@tabler/icons-react'
import { NodeToolbar, Position } from '@xyflow/react'
import { ManagedImage } from '../../../domain/resource-runtime/components/ManagedImage'
import {
  EMOTION_AXES,
  EMOTION_DEFAULT_XY,
  EMOTION_GRID_SIZE,
  emotionPreviewUrl,
  getEmotionCell,
  type EmotionCell,
} from './emotionModel'
import type { PortraitTextureSelection } from './PortraitTextureEditor'

export type EmotionApplyRequest = Readonly<{
  cell: EmotionCell
  resolution: '1K' | '2K'
  sampleCount: 1 | 2 | 3 | 4
}>

type EmotionPanelProps = {
  isOpen: boolean
  isDarkUi: boolean
  sourceImageUrl: string
  selection: PortraitTextureSelection
  onClose: () => void
  onReplacePerson: () => void
  onApply: (request: EmotionApplyRequest) => Promise<void>
  loading?: boolean
  error?: string | null
}

type GridCoordinate = { x: number; y: number }

function clampGridCoordinate(value: number): number {
  return Math.min(EMOTION_GRID_SIZE - 1, Math.max(0, Math.round(value)))
}

export function resolveEmotionCoordinateFromPointer(input: {
  clientX: number
  clientY: number
  bounds: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>
}): GridCoordinate {
  const usableWidth = Math.max(1, input.bounds.width)
  const usableHeight = Math.max(1, input.bounds.height)
  return {
    x: clampGridCoordinate(((input.clientX - input.bounds.left) / usableWidth) * (EMOTION_GRID_SIZE - 1)),
    y: clampGridCoordinate(((input.clientY - input.bounds.top) / usableHeight) * (EMOTION_GRID_SIZE - 1)),
  }
}

export function EmotionPanel({
  isOpen,
  isDarkUi,
  sourceImageUrl,
  selection,
  onClose,
  onReplacePerson,
  onApply,
  loading = false,
  error,
}: EmotionPanelProps): JSX.Element {
  const [xy, setXy] = React.useState<GridCoordinate>({ ...EMOTION_DEFAULT_XY })
  const [resolution, setResolution] = React.useState<'1K' | '2K'>('2K')
  const [sampleCount, setSampleCount] = React.useState<1 | 2 | 3 | 4>(1)
  const [dragging, setDragging] = React.useState(false)
  const padRef = React.useRef<HTMLDivElement | null>(null)
  const cell = getEmotionCell(xy.x, xy.y)
  const previewUrl = emotionPreviewUrl(xy.x, xy.y)
  const panelBackground = isDarkUi ? '#212121' : '#f5f5f5'
  const contentBackground = isDarkUi ? '#262626' : '#ebebeb'
  const previewBackground = isDarkUi ? '#181818' : '#dedede'
  const border = isDarkUi ? 'rgba(255,255,255,.10)' : 'rgba(0,0,0,.12)'
  const textPrimary = isDarkUi ? 'rgba(255,255,255,.92)' : 'rgba(0,0,0,.88)'
  const textMuted = isDarkUi ? 'rgba(255,255,255,.48)' : 'rgba(0,0,0,.48)'

  const updatePointer = React.useCallback((clientX: number, clientY: number) => {
    const element = padRef.current
    if (!element) return
    const next = resolveEmotionCoordinateFromPointer({ clientX, clientY, bounds: element.getBoundingClientRect() })
    setXy((current) => current.x === next.x && current.y === next.y ? current : next)
  }, [])

  return (
    <NodeToolbar isVisible={isOpen} position={Position.Bottom} offset={8} className="tc-emotion-panel nodrag nopan">
      <section aria-label="情绪调节" style={{ width: 580, maxWidth: 'calc(100vw - 24px)', overflow: 'hidden', paddingBottom: 12, border: `0.5px solid ${border}`, borderRadius: 12, background: panelBackground, color: textPrimary, boxShadow: '0 16px 42px rgba(0,0,0,.32)' }}>
        <header style={{ height: 56, padding: 12, boxSizing: 'border-box', borderBottom: `0.5px solid ${border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button type="button" aria-label="关闭情绪调节" onClick={onClose} style={{ width: 32, height: 32, padding: 0, border: 0, borderRadius: 8, background: 'transparent', color: textPrimary, display: 'grid', placeItems: 'center', cursor: 'pointer' }}><IconX size={22} /></button>
            <span aria-hidden="true" style={{ width: 1, height: 24, background: border }} />
            <span style={{ height: 32, padding: '0 12px', borderRadius: 8, background: contentBackground, display: 'inline-flex', alignItems: 'center', fontSize: 13, fontWeight: 500 }}>情绪调节</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <select aria-label="情绪图分辨率" disabled={loading} value={resolution} onChange={(event) => setResolution(event.currentTarget.value === '1K' ? '1K' : '2K')} style={{ border: 0, background: 'transparent', color: textPrimary, fontSize: 13 }}><option value="1K">1K</option><option value="2K">2K</option></select>
            <select aria-label="情绪图生成数量" disabled={loading} value={sampleCount} onChange={(event) => setSampleCount(Number(event.currentTarget.value) as 1 | 2 | 3 | 4)} style={{ border: 0, background: 'transparent', color: textPrimary, fontSize: 13 }}><option value={1}>1张</option><option value={2}>2张</option><option value={3}>3张</option><option value={4}>4张</option></select>
            <button type="button" disabled={loading} aria-label={loading ? '情绪图生成中' : '生成情绪图'} onClick={() => { void onApply({ cell, resolution, sampleCount }) }} style={{ width: 32, height: 32, padding: 0, border: 0, borderRadius: 8, background: isDarkUi ? '#f5f5f5' : '#202020', color: isDarkUi ? '#171717' : '#fff', display: 'grid', placeItems: 'center', cursor: loading ? 'wait' : 'pointer', opacity: loading ? .62 : 1 }}>{loading ? <IconLoader2 className="tc-portrait-select__spinner" size={17} /> : <IconArrowUp size={20} />}</button>
          </div>
        </header>

        <div style={{ height: 32, padding: '4px 12px', boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ height: 24, padding: '0 8px 0 4px', border: `0.5px solid ${border}`, borderRadius: 8, display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
            <ManagedImage className="tc-emotion-person-chip__image" src={sourceImageUrl} alt="已选择人物" priority="visible" ownerSurface="task-node-candidate" draggable={false} style={{ width: 16, height: 16, borderRadius: 4, objectFit: 'cover' }} />角色1
          </span>
          <button type="button" disabled={loading} onClick={onReplacePerson} style={{ height: 24, padding: '0 8px', border: `0.5px solid ${border}`, borderRadius: 8, background: 'transparent', color: textMuted, display: 'inline-flex', alignItems: 'center', gap: 5, cursor: loading ? 'wait' : 'pointer', fontSize: 12 }}><IconPlus size={14} />{selection.source === 'manual' ? '重新框选' : '手动添加'}</button>
        </div>

        <div style={{ minHeight: 216, padding: '0 12px', boxSizing: 'border-box' }}>
          <div style={{ height: 216, padding: 8, boxSizing: 'border-box', borderRadius: 26, background: contentBackground, display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 316, height: 200, flexShrink: 0, overflow: 'hidden', borderRadius: 24, background: previewBackground, display: 'grid', placeItems: 'center' }}>
              {previewUrl ? <ManagedImage className="tc-emotion-preview__image" key={`${xy.y}-${xy.x}`} src={previewUrl} alt={cell.zh} priority="visible" ownerSurface="emotion-preview" ownerRequestKey={`emotion-preview:y${xy.y}x${xy.x}`} draggable={false} decoding="async" referrerPolicy="no-referrer" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} /> : <ManagedImage className="tc-emotion-preview__image" src={sourceImageUrl} alt="人物情绪预览" priority="visible" ownerSurface="emotion-preview" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
            </div>
            <span aria-hidden="true" style={{ width: 1, height: 110, background: border }} />
            <div style={{ width: 200, height: 200, flexShrink: 0, position: 'relative', color: textMuted, fontSize: 11, userSelect: 'none' }}>
              <span style={{ position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)' }}>{EMOTION_AXES.top}</span>
              <span style={{ position: 'absolute', bottom: 0, left: '50%', transform: 'translateX(-50%)' }}>{EMOTION_AXES.bottom}</span>
              <span style={{ position: 'absolute', left: 0, top: '50%', transform: 'translateY(-50%)', width: 22, lineHeight: 1.05, textAlign: 'center' }}>{EMOTION_AXES.left}</span>
              <span style={{ position: 'absolute', right: 0, top: '50%', transform: 'translateY(-50%)', width: 22, lineHeight: 1.05, textAlign: 'center' }}>{EMOTION_AXES.right}</span>
              <div ref={padRef} role="grid" aria-label="情绪定位网格" onPointerDown={(event) => { if (loading) return; setDragging(true); event.currentTarget.setPointerCapture(event.pointerId); updatePointer(event.clientX, event.clientY) }} onPointerMove={(event) => { if (dragging) updatePointer(event.clientX, event.clientY) }} onPointerUp={(event) => { setDragging(false); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) }} onPointerCancel={() => setDragging(false)} style={{ position: 'absolute', inset: 25, touchAction: 'none', cursor: loading ? 'wait' : 'pointer' }}>
                {Array.from({ length: EMOTION_GRID_SIZE }, (_, y) => Array.from({ length: EMOTION_GRID_SIZE }, (_, x) => {
                  const selected = x === xy.x && y === xy.y
                  const center = x === 2 && y === 2
                  const aligned = x === xy.x || y === xy.y
                  const distance = Math.hypot(x - xy.x, y - xy.y)
                  const activeOpacity = dragging ? Math.max(.24, 1 - distance * .24) : (aligned ? 1 : .25)
                  return <button type="button" role="gridcell" tabIndex={selected ? 0 : -1} aria-label={getEmotionCell(x, y).zh} aria-selected={selected} key={`${x}-${y}`} onClick={() => setXy({ x, y })} style={{ position: 'absolute', left: `${(x / 4) * 100}%`, top: `${(y / 4) * 100}%`, width: 24, height: 24, padding: 0, border: 0, background: 'transparent', transform: `translate(-50%, -50%) scale(${selected ? 1 : aligned ? 1.15 : 1})`, opacity: selected ? 1 : activeOpacity, cursor: 'pointer', transition: dragging ? 'none' : 'opacity .18s ease, transform .18s ease', display: 'grid', placeItems: 'center' }}><span style={{ width: selected ? 18 : 8, height: selected ? 18 : 8, borderRadius: '50%', background: selected ? '#fff' : 'rgba(255,255,255,.62)', border: center && !selected ? '2px solid rgba(255,255,255,.72)' : 'none', boxSizing: 'border-box', boxShadow: selected ? '0 0 14px rgba(255,255,255,.35)' : 'none', transition: dragging ? 'none' : 'width .32s ease, height .32s ease, box-shadow .32s ease' }} /></button>
                })).flat()}
              </div>
            </div>
          </div>
        </div>

        <footer style={{ minHeight: 28, padding: '7px 12px 0', display: 'flex', alignItems: 'center', gap: 14 }}>
          <span style={{ color: textMuted, fontSize: 12 }}>情绪定位</span><strong style={{ color: textPrimary, fontSize: 13, fontWeight: 500 }}>{cell.zh}</strong>
          {error ? <span role="alert" style={{ marginLeft: 'auto', maxWidth: 290, color: '#ff8f8f', fontSize: 11 }}>{error}</span> : null}
        </footer>
      </section>
    </NodeToolbar>
  )
}
