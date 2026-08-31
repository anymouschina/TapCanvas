// apps/web/src/canvas/nodes/taskNode/MaskDrawingEditor.tsx
import React from 'react'
import { NodeToolbar, Position } from '@xyflow/react'
import { useFabricDrawEngine } from './useFabricDrawEngine'
import { ManagedImage } from '../../../domain/resource-runtime/components/ManagedImage'

export type MaskMode = 'repaint' | 'erase'

type MaskDrawingEditorProps = {
  imageUrl: string        // 原始图片 URL（用于显示背景）
  naturalWidth: number
  naturalHeight: number
  mode: MaskMode
  isDarkUi: boolean
  onClose: () => void
  /** 导出独立黑白蒙版 + prompt，原图由调用方作为 source 单独传输。 */
  onConfirm: (maskBlob: Blob, prompt: string) => Promise<void>
}


export function MaskDrawingEditor({
  imageUrl,
  naturalWidth,
  naturalHeight,
  mode,
  isDarkUi,
  onClose,
  onConfirm,
}: MaskDrawingEditorProps) {
  const engine = useFabricDrawEngine({ mode: 'mask' })
  const [prompt, setPrompt] = React.useState('')
  const [submitting, setSubmitting] = React.useState(false)

  const bg = isDarkUi ? 'rgba(18,20,26,0.97)' : 'rgba(240,242,248,0.97)'
  const border = isDarkUi ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)'
  const textColor = isDarkUi ? 'rgba(255,255,255,0.88)' : 'rgba(17,18,21,0.88)'
  const btnStyle = (active: boolean): React.CSSProperties => ({
    width: 32, height: 32, borderRadius: 8, border: `1px solid ${active ? 'rgba(255,255,255,0.4)' : border}`,
    background: active ? (isDarkUi ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.12)') : 'transparent',
    cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    color: textColor,
  })

  const handleSubmit = async () => {
    setSubmitting(true)
    try {
      const maskBlob = await engine.exportMaskBlob(imageUrl)
      const finalPrompt = mode === 'erase'
        ? 'remove the marked area and fill with natural background'
        : prompt
      await onConfirm(maskBlob, finalPrompt)
    } finally {
      setSubmitting(false)
    }
  }

  const label = mode === 'repaint' ? '重绘' : '擦除'

  return (
    <>
      {/* Toolbar */}
      <NodeToolbar isVisible position={Position.Top} align="center" offset={8} className="nodrag nopan">
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '6px 14px',
          borderRadius: 999, background: bg, boxShadow: '0 8px 32px rgba(0,0,0,0.36)',
          border: `1px solid ${border}`,
        }}>
          {/* Back */}
          <button onClick={onClose} style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'transparent', border: 'none', cursor: 'pointer', color: textColor, fontSize: 13 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
            {label}
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

          {/* Eraser */}
          <button style={btnStyle(engine.tool === 'eraser')} onClick={() => engine.setTool('eraser')} title="橡皮擦">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m20 20-8.5-8.5-5.6 5.6L2 13.5 10.5 5 22 16.5"/></svg>
          </button>

          {/* Brush size slider */}
          <input
            type="range" min={10} max={200} value={engine.brushSize}
            onChange={e => engine.setBrushSize(Number(e.target.value))}
            style={{ width: 80, accentColor: isDarkUi ? 'white' : '#131316' }}
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

          {/* Submit */}
          <button
            disabled={submitting}
            onClick={() => { void handleSubmit() }}
            style={{
              padding: '5px 16px', borderRadius: 8, border: 'none', cursor: 'pointer',
              background: isDarkUi ? 'rgba(255,255,255,0.88)' : 'rgba(17,18,21,0.88)',
              color: isDarkUi ? '#131316' : '#fff', fontSize: 13, fontWeight: 600,
            }}
          >
            {submitting ? '提交中…' : '生成'}
          </button>
        </div>
      </NodeToolbar>

      {/* Image + mask canvas overlay */}
      <div className="nodrag nopan" style={{ position: 'absolute', inset: 0, zIndex: 50, overflow: 'hidden' }}>
        {/* Original image */}
        <ManagedImage
          className="tc-mask-drawing-editor__image"
          src={imageUrl}
          alt=""
          priority="critical"
          ownerSurface="task-node-main-image"
          crossOrigin="anonymous"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'fill', display: 'block' }}
        />

        {/* Mask canvas：Fabric.js 绘图容器，DPR 自适应。zIndex 必须高于 ManagedImage
            内层图片，否则背景图会吃掉指针事件，导致画笔与矩形工具无法操作。 */}
        <div
          ref={engine.containerRef}
          style={{
            position: 'absolute', inset: 0, width: '100%', height: '100%', zIndex: 10,
            cursor: engine.tool === 'eraser' ? 'cell' : 'crosshair',
          }}
        />

        {/* Repaint mode: prompt input at bottom */}
        {mode === 'repaint' && (
          <div style={{
            position: 'absolute', left: 12, right: 12, bottom: 12,
            background: isDarkUi ? 'rgba(18,20,26,0.92)' : 'rgba(245,247,252,0.96)',
            border: `1px solid ${border}`, borderRadius: 12, padding: '8px 12px',
          }}>
            <input
              className="nodrag nopan"
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              placeholder="描述重绘内容（可留空）"
              style={{
                width: '100%', background: 'transparent', border: 'none', outline: 'none',
                color: textColor, fontSize: 13, fontFamily: 'inherit',
              }}
            />
          </div>
        )}
      </div>
    </>
  )
}
