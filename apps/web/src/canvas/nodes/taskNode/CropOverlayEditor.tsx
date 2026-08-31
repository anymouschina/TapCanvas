// apps/web/src/canvas/nodes/taskNode/CropOverlayEditor.tsx
import React from 'react'
import { NodeToolbar, Position } from '@xyflow/react'
import { loadEditableImageSource } from '../../../utils/editableImageSource'

export type AspectRatio = 'free' | '1:1' | '4:3' | '3:2' | '16:9' | '9:16'

const ASPECT_PRESETS: { key: AspectRatio; label: string; ratio: number | null }[] = [
  { key: 'free',  label: '原图比例', ratio: null },
  { key: '1:1',  label: '1:1',      ratio: 1 },
  { key: '4:3',  label: '4:3',      ratio: 4 / 3 },
  { key: '3:2',  label: '3:2',      ratio: 3 / 2 },
  { key: '16:9', label: '16:9',     ratio: 16 / 9 },
  { key: '9:16', label: '9:16',     ratio: 9 / 16 },
]

type CropRect = { x: number; y: number; w: number; h: number }

type CropOverlayEditorProps = {
  /** 原始图片 URL（用于显示和最终裁切）*/
  imageUrl: string
  /** 节点在画布内的显示宽高（px，已含 zoom 缩放的屏幕尺寸）*/
  displayWidth: number
  displayHeight: number
  /** 原始图片分辨率 */
  naturalWidth: number
  naturalHeight: number
  isDarkUi: boolean
  onClose: () => void
  /** 返回裁切后的图片 Blob，由调用方上传并写入节点 */
  onConfirm: (croppedBlob: Blob, cropW: number, cropH: number) => Promise<void>
}

type Handle = 'tl' | 'tr' | 'bl' | 'br' | 'move'

export function CropOverlayEditor({
  imageUrl,
  displayWidth,
  displayHeight,
  naturalWidth,
  naturalHeight,
  isDarkUi,
  onClose,
  onConfirm,
}: CropOverlayEditorProps) {
  const [aspect, setAspect] = React.useState<AspectRatio>('free')
  const [showAspectMenu, setShowAspectMenu] = React.useState(false)
  const [saving, setSaving] = React.useState(false)

  // cropRect 以显示像素为单位（0..displayWidth, 0..displayHeight）
  const [cropRect, setCropRect] = React.useState<CropRect>(() => ({
    x: displayWidth * 0.1,
    y: displayHeight * 0.1,
    w: displayWidth * 0.8,
    h: displayHeight * 0.8,
  }))

  const dragRef = React.useRef<{
    handle: Handle
    startX: number
    startY: number
    startRect: CropRect
  } | null>(null)

  // 输出分辨率（基于原图比例）
  const scaleX = naturalWidth / displayWidth
  const scaleY = naturalHeight / displayHeight
  const outW = Math.round(cropRect.w * scaleX)
  const outH = Math.round(cropRect.h * scaleY)

  const clampRect = React.useCallback((r: CropRect, ratio: number | null): CropRect => {
    let { x, y, w, h } = r
    w = Math.max(40, Math.min(displayWidth - x, w))
    h = Math.max(40, Math.min(displayHeight - y, h))
    x = Math.max(0, Math.min(displayWidth - w, x))
    y = Math.max(0, Math.min(displayHeight - h, y))
    if (ratio !== null) {
      // 锁定宽高比：以宽为准调整高
      h = w / ratio
      if (y + h > displayHeight) { h = displayHeight - y; w = h * ratio }
      w = Math.max(40, w); h = Math.max(40, h)
    }
    return { x, y, w, h }
  }, [displayWidth, displayHeight])

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>, handle: Handle) => {
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { handle, startX: e.clientX, startY: e.clientY, startRect: { ...cropRect } }
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return
    e.preventDefault()
    const { handle, startX, startY, startRect } = dragRef.current
    const dx = e.clientX - startX
    const dy = e.clientY - startY
    const ratio = ASPECT_PRESETS.find(p => p.key === aspect)?.ratio ?? null
    let { x, y, w, h } = startRect
    if (handle === 'move') { x += dx; y += dy }
    else if (handle === 'tl') { x += dx; y += dy; w -= dx; h -= dy }
    else if (handle === 'tr') { w += dx; y += dy; h -= dy }
    else if (handle === 'bl') { x += dx; w -= dx; h += dy }
    else if (handle === 'br') { w += dx; h += dy }
    setCropRect(clampRect({ x, y, w, h }, ratio))
  }

  const onPointerUp = () => { dragRef.current = null }

  const handleConfirm = async () => {
    setSaving(true)
    let source: Awaited<ReturnType<typeof loadEditableImageSource>> | null = null
    try {
      source = await loadEditableImageSource(imageUrl)
      const canvas = document.createElement('canvas')
      canvas.width = outW
      canvas.height = outH
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('裁剪画布初始化失败')
      ctx.drawImage(source.image,
        cropRect.x * scaleX, cropRect.y * scaleY,
        cropRect.w * scaleX, cropRect.h * scaleY,
        0, 0, outW, outH,
      )
      const croppedBlob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (blobResult) => {
            if (blobResult) {
              resolve(blobResult)
              return
            }
            reject(new Error('裁剪图片导出失败'))
          },
          'image/jpeg',
          0.95,
        )
      })
      await onConfirm(croppedBlob, outW, outH)
    } finally {
      source?.release()
      setSaving(false)
    }
  }

  const bg = isDarkUi ? 'rgba(18,20,26,0.97)' : 'rgba(240,242,248,0.97)'
  const border = isDarkUi ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)'
  const textColor = isDarkUi ? 'rgba(255,255,255,0.88)' : 'rgba(17,18,21,0.88)'
  const gridLines = 'rgba(255,255,255,0.4)'

  return (
    <>
      {/* Floating toolbar */}
      <NodeToolbar isVisible position={Position.Top} align="center" offset={8} className="nodrag nopan">
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '6px 14px',
          borderRadius: 999, background: bg, boxShadow: '0 8px 32px rgba(0,0,0,0.36)',
          border: `1px solid ${border}`,
        }}>
          {/* Close */}
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: textColor, fontSize: 18, lineHeight: 1, padding: '0 4px' }}>×</button>
          <div style={{ width: 1, height: 20, background: border }} />

          {/* Aspect ratio */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setShowAspectMenu(o => !o)}
              style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'transparent', border: 'none', cursor: 'pointer', color: textColor, fontSize: 13 }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="4" width="20" height="16" rx="2"/></svg>
              {ASPECT_PRESETS.find(p => p.key === aspect)?.label}
              <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><path d="M2 3.5 5 7l3-3.5"/></svg>
            </button>
            {showAspectMenu && (
              <div style={{
                position: 'absolute', top: '100%', left: 0, marginTop: 4, zIndex: 10,
                background: bg, border: `1px solid ${border}`, borderRadius: 10,
                boxShadow: '0 8px 24px rgba(0,0,0,0.28)', padding: 4, minWidth: 100,
              }}>
                {ASPECT_PRESETS.map(p => (
                  <button
                    key={p.key}
                    onClick={() => {
                      setAspect(p.key)
                      setShowAspectMenu(false)
                      if (p.ratio !== null) setCropRect(r => clampRect(r, p.ratio))
                    }}
                    style={{
                      display: 'block', width: '100%', textAlign: 'left', padding: '6px 10px',
                      background: aspect === p.key ? (isDarkUi ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)') : 'transparent',
                      border: 'none', cursor: 'pointer', color: textColor, fontSize: 13, borderRadius: 7,
                    }}
                  >{p.label}</button>
                ))}
              </div>
            )}
          </div>

          {/* Size display */}
          <span style={{ fontSize: 12, color: textColor, opacity: 0.6, fontVariantNumeric: 'tabular-nums' }}>
            {outW} × {outH}
          </span>

          <div style={{ width: 1, height: 20, background: border }} />

          {/* Confirm */}
          <button
            disabled={saving}
            onClick={() => { void handleConfirm() }}
            style={{
              padding: '5px 16px', borderRadius: 8, border: 'none', cursor: 'pointer',
              background: isDarkUi ? 'rgba(255,255,255,0.88)' : 'rgba(17,18,21,0.88)',
              color: isDarkUi ? '#131316' : '#fff', fontSize: 13, fontWeight: 600,
            }}
          >
            {saving ? '保存中…' : '确认'}
          </button>
        </div>
      </NodeToolbar>

      {/* Overlay */}
      <div
        className="nodrag nopan"
        style={{ position: 'absolute', inset: 0, zIndex: 50, overflow: 'hidden', cursor: 'crosshair' }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {/* Dark mask */}
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.55)', pointerEvents: 'none' }} />

        {/* Crop cutout (bright area) */}
        <div
          style={{
            position: 'absolute',
            left: cropRect.x, top: cropRect.y,
            width: cropRect.w, height: cropRect.h,
            boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)',
            cursor: 'move',
          }}
          onPointerDown={e => onPointerDown(e, 'move')}
        >
          {/* Grid lines (rule of thirds) */}
          {[1/3, 2/3].map(f => (
            <React.Fragment key={f}>
              <div style={{ position: 'absolute', left: `${f * 100}%`, top: 0, bottom: 0, width: 1, background: gridLines, opacity: 0.6 }} />
              <div style={{ position: 'absolute', top: `${f * 100}%`, left: 0, right: 0, height: 1, background: gridLines, opacity: 0.6 }} />
            </React.Fragment>
          ))}
          {/* Border */}
          <div style={{ position: 'absolute', inset: 0, border: '2px solid rgba(255,255,255,0.9)', pointerEvents: 'none' }} />

          {/* Corner handles */}
          {(['tl', 'tr', 'bl', 'br'] as const).map(h => (
            <div
              key={h}
              onPointerDown={e => onPointerDown(e, h)}
              style={{
                position: 'absolute',
                ...(h.includes('t') ? { top: -6 } : { bottom: -6 }),
                ...(h.includes('l') ? { left: -6 } : { right: -6 }),
                width: 14, height: 14,
                border: '3px solid white',
                background: 'rgba(0,0,0,0.6)',
                cursor: h === 'tl' || h === 'br' ? 'nwse-resize' : 'nesw-resize',
                borderRadius: 2,
              }}
            />
          ))}
        </div>
      </div>
    </>
  )
}
