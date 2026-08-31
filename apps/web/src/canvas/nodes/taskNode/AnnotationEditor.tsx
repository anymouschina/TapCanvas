// apps/web/src/canvas/nodes/taskNode/AnnotationEditor.tsx
import React from 'react'
import { NodeToolbar, Position } from '@xyflow/react'
import { ManagedImage } from '../../../domain/resource-runtime/components/ManagedImage'
import { useFabricDrawEngine } from './useFabricDrawEngine'

type AnnotationEditorProps = {
  imageUrl: string
  naturalWidth: number
  naturalHeight: number
  isDarkUi: boolean
  onClose: () => void
  /** 返回标注后合并图片的 Blob */
  onSave: (annotatedBlob: Blob) => Promise<void>
}

const SWATCHES = ['#ff0000', '#ff9900', '#ffff00', '#00cc00', '#00aaff', '#ffffff', '#000000']

export function AnnotationEditor({
  imageUrl,
  naturalWidth,
  naturalHeight,
  isDarkUi,
  onClose,
  onSave,
}: AnnotationEditorProps) {
  const engine = useFabricDrawEngine({ mode: 'annotation', color: '#ff0000' })
  const [saving, setSaving] = React.useState(false)
  const [colorMenuOpen, setColorMenuOpen] = React.useState(false)

  React.useEffect(() => {
    window.dispatchEvent(new CustomEvent('tapcanvas:annotation-mode', { detail: { active: true } }))
    return () => {
      window.dispatchEvent(new CustomEvent('tapcanvas:annotation-mode', { detail: { active: false } }))
    }
  }, [])

  const bg = isDarkUi ? 'rgba(18,20,26,0.97)' : 'rgba(240,242,248,0.97)'
  const border = isDarkUi ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)'
  const textColor = isDarkUi ? 'rgba(255,255,255,0.88)' : 'rgba(17,18,21,0.88)'
  const btnStyle = (active: boolean): React.CSSProperties => ({
    width: 32, height: 32, borderRadius: 8,
    border: `1px solid ${active ? 'rgba(255,255,255,0.4)' : border}`,
    background: active ? (isDarkUi ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.12)') : 'transparent',
    cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    color: textColor,
  })

  const handleSave = async () => {
    setSaving(true)
    try {
      const blob = await engine.exportAnnotationBlob(imageUrl)
      await onSave(blob)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <NodeToolbar isVisible position={Position.Top} align="center" offset={8} className="nodrag nopan">
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '6px 14px',
          borderRadius: 999, background: bg, boxShadow: '0 8px 32px rgba(0,0,0,0.36)',
          border: `1px solid ${border}`,
        }}>
          {/* Back */}
          <button onClick={onClose} style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'transparent', border: 'none', cursor: 'pointer', color: textColor, fontSize: 13 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
            标注
          </button>

          <div style={{ width: 1, height: 20, background: border }} />

          {/* Brush */}
          <button style={btnStyle(engine.tool === 'brush')} onClick={() => engine.setTool('brush')} title="画笔">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75z"/></svg>
          </button>

          {/* Rect */}
          <button style={btnStyle(engine.tool === 'rect')} onClick={() => engine.setTool('rect')} title="矩形">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
          </button>

          {/* Line */}
          <button style={btnStyle(engine.tool === 'line')} onClick={() => engine.setTool('line')} title="直线">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="5" y1="19" x2="19" y2="5"/></svg>
          </button>

          {/* Arrow */}
          <button style={btnStyle(engine.tool === 'arrow')} onClick={() => engine.setTool('arrow')} title="箭头">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="5" y1="19" x2="19" y2="5"/><polyline points="9 5 19 5 19 15"/></svg>
          </button>

          {/* Text */}
          <button style={btnStyle(engine.tool === 'text')} onClick={() => engine.setTool('text')} title="文字">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>
          </button>

          {/* Eraser */}
          <button style={btnStyle(engine.tool === 'eraser')} onClick={() => engine.setTool('eraser')} title="橡皮擦">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m20 20-8.5-8.5-5.6 5.6L2 13.5 10.5 5 22 16.5"/></svg>
          </button>

          {/* Color picker */}
          <div style={{ position: 'relative' }}>
            <button
              style={{ ...btnStyle(false), background: engine.color, border: `2px solid ${border}` }}
              onClick={() => setColorMenuOpen(o => !o)}
              title="颜色"
            />
            {colorMenuOpen && (
              <div style={{
                position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)',
                marginTop: 4, background: bg, border: `1px solid ${border}`, borderRadius: 10,
                boxShadow: '0 8px 24px rgba(0,0,0,0.28)', padding: 8, zIndex: 20,
                display: 'flex', gap: 6, flexWrap: 'wrap', width: 140,
              }}>
                {SWATCHES.map(c => (
                  <button
                    key={c}
                    onClick={() => { engine.setColor(c); setColorMenuOpen(false) }}
                    style={{
                      width: 24, height: 24, borderRadius: '50%', background: c, border: 'none',
                      cursor: 'pointer', outline: engine.color === c ? `2px solid ${textColor}` : 'none',
                      outlineOffset: 2,
                    }}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Brush size */}
          <input
            type="range" min={2} max={60} value={engine.brushSize}
            onChange={e => engine.setBrushSize(Number(e.target.value))}
            style={{ width: 80, accentColor: engine.color }}
          />

          <div style={{ width: 1, height: 20, background: border }} />

          {/* Undo */}
          <button disabled={!engine.canUndo} onClick={engine.undo} style={{ ...btnStyle(false), opacity: engine.canUndo ? 1 : 0.3 }} title="撤销">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>
          </button>

          {/* Redo */}
          <button disabled={!engine.canRedo} onClick={engine.redo} style={{ ...btnStyle(false), opacity: engine.canRedo ? 1 : 0.3 }} title="重做">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/></svg>
          </button>

          <div style={{ width: 1, height: 20, background: border }} />

          {/* Save */}
          <button
            disabled={saving}
            onClick={() => { void handleSave() }}
            style={{
              padding: '5px 16px', borderRadius: 8, border: 'none', cursor: 'pointer',
              background: isDarkUi ? 'rgba(255,255,255,0.88)' : 'rgba(17,18,21,0.88)',
              color: isDarkUi ? '#131316' : '#fff', fontSize: 13, fontWeight: 600,
            }}
          >
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </NodeToolbar>

      {/* Drawing area */}
      <div className="nodrag nopan" style={{ position: 'absolute', inset: 0, zIndex: 50, overflow: 'hidden' }}>
        <ManagedImage
          className="tc-annotation-editor__image"
          priority="critical"
          ownerSurface="task-node-main-image"
          crossOrigin="anonymous"
          src={imageUrl}
          alt=""
          draggable={false}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'fill', display: 'block' }}
        />
        <div
          ref={engine.containerRef}
          style={{
            position: 'absolute', inset: 0, width: '100%', height: '100%',
            cursor: engine.tool === 'eraser' ? 'cell' : engine.tool === 'text' ? 'text' : 'crosshair',
          }}
        />
      </div>
    </>
  )
}
