import React from 'react'
import { Canvas as FabricCanvas, PencilBrush, Rect, Path, IText, FabricImage } from 'fabric'
import { exportAtSourceResolution, exportMaskAtSourceResolution } from '../../fabric/fabricExportUtils'

export type DrawTool = 'brush' | 'rect' | 'line' | 'arrow' | 'text' | 'eraser'

export type DrawEngineOptions = {
  /** 'annotation': 不透明笔迹覆盖; 'mask': 半透明蓝色遮罩 */
  mode: 'annotation' | 'mask'
  color?: string
  brushSize?: number
}

export type DrawEngine = {
  containerRef: React.RefObject<HTMLDivElement>
  tool: DrawTool
  brushSize: number
  color: string
  canUndo: boolean
  canRedo: boolean
  setTool: (t: DrawTool) => void
  setBrushSize: (s: number) => void
  setColor: (c: string) => void
  undo: () => void
  redo: () => void
  clear: () => void
  exportAnnotationBlob: (sourceImageUrl: string) => Promise<Blob>
  exportVisibleCompositeBlob: (sourceImageUrl: string) => Promise<Blob>
  exportMaskBlob: (sourceImageUrl: string) => Promise<Blob>
}

const MASK_COLOR = 'rgba(154, 161, 172, 0.9)'

/** 直线/箭头的描边宽度：跟随笔刷粗细但按比例缩细，避免默认 20px 过粗 */
function shapeStrokeWidth(brushSize: number): number {
  return Math.max(2, Math.round(brushSize / 3))
}

/** 生成直线或带开放式箭头的 Path 数据 */
function linePathData(x1: number, y1: number, x2: number, y2: number, withArrowHead: boolean, strokeWidth: number): string {
  const base = `M ${x1} ${y1} L ${x2} ${y2}`
  if (!withArrowHead) return base
  const angle = Math.atan2(y2 - y1, x2 - x1)
  const headLen = Math.max(12, strokeWidth * 4)
  const a1 = angle - Math.PI / 6
  const a2 = angle + Math.PI / 6
  const hx1 = x2 - headLen * Math.cos(a1)
  const hy1 = y2 - headLen * Math.sin(a1)
  const hx2 = x2 - headLen * Math.cos(a2)
  const hy2 = y2 - headLen * Math.sin(a2)
  return `${base} M ${hx1} ${hy1} L ${x2} ${y2} L ${hx2} ${hy2}`
}

function configureBrush(
  fc: FabricCanvas,
  tool: DrawTool,
  size: number,
  color: string,
  mode: DrawEngineOptions['mode'],
) {
  const drawColor = mode === 'mask' ? MASK_COLOR : color
  if (tool === 'eraser') {
    // Fabric v6 has no EraserBrush: use a white PencilBrush; path:created bakes destination-out
    const brush = new PencilBrush(fc)
    brush.width = size
    brush.color = 'rgba(255,255,255,1)'
    fc.freeDrawingBrush = brush
    fc.isDrawingMode = true
  } else if (tool === 'brush') {
    const brush = new PencilBrush(fc)
    brush.width = size
    brush.color = drawColor
    fc.freeDrawingBrush = brush
    fc.isDrawingMode = true
  } else {
    fc.isDrawingMode = false
  }
  const cursor = tool === 'eraser' ? 'cell' : tool === 'text' ? 'text' : 'crosshair'
  fc.defaultCursor = cursor
  fc.freeDrawingCursor = cursor
}

export function useFabricDrawEngine(options: DrawEngineOptions): DrawEngine {
  const containerRef = React.useRef<HTMLDivElement>(null)
  const fcRef = React.useRef<FabricCanvas | null>(null)

  const [tool, setToolState] = React.useState<DrawTool>('brush')
  const [brushSize, setBrushSizeState] = React.useState(
    options.brushSize ?? (options.mode === 'mask' ? 60 : 20),
  )
  const [color, setColorState] = React.useState(options.color ?? '#ff0000')
  const [canUndo, setCanUndo] = React.useState(false)
  const [canRedo, setCanRedo] = React.useState(false)

  // Stable refs so Fabric event callbacks always see current values
  const toolRef = React.useRef(tool)
  const brushSizeRef = React.useRef(brushSize)
  const colorRef = React.useRef(color)
  const modeRef = React.useRef(options.mode)
  const undoStack = React.useRef<string[]>([])
  const redoStack = React.useRef<string[]>([])
  const rectStartRef = React.useRef<{ x: number; y: number } | null>(null)
  const activeRectRef = React.useRef<Rect | null>(null)
  const shapeStartRef = React.useRef<{ x: number; y: number } | null>(null)
  const activeShapeRef = React.useRef<Path | null>(null)
  const textExitedAtRef = React.useRef(0)

  const snapshot = React.useCallback(() => {
    const fc = fcRef.current
    if (!fc) return
    undoStack.current.push(fc.toDataURL({ format: 'png', multiplier: 1 }))
    redoStack.current = []
    setCanUndo(true)
    setCanRedo(false)
  }, [])

  const restoreDataUrl = React.useCallback(async (fc: FabricCanvas, dataUrl: string) => {
    const img = await FabricImage.fromURL(dataUrl)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    img.set({ left: 0, top: 0, selectable: false, evented: false, erasable: true } as any)
    fc.clear()
    fc.add(img)
    fc.renderAll()
  }, [])

  React.useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const canvasEl = document.createElement('canvas')
    container.appendChild(canvasEl)

    const fc = new FabricCanvas(canvasEl, {
      enableRetinaScaling: true,
      isDrawingMode: true,
      selection: false,
    })

    const w = container.clientWidth || 512
    const h = container.clientHeight || 512
    fc.setDimensions({ width: w, height: h })

    // Position Fabric's wrapper div to fill the container absolutely
    const wrapper = canvasEl.parentElement
    if (wrapper) {
      Object.assign(wrapper.style, { position: 'absolute', inset: '0', width: '100%', height: '100%' })
    }

    configureBrush(fc, toolRef.current, brushSizeRef.current, colorRef.current, modeRef.current)

    // Configure each committed path
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fc.on('path:created', ({ path }: any) => {
      if (toolRef.current === 'eraser') {
        // Bake eraser: render with destination-out, then collapse to flat FabricImage
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        path.set({ globalCompositeOperation: 'destination-out' as any, selectable: false, evented: false })
        fc.renderAll()
        const dataUrl = fc.toDataURL({ format: 'png', multiplier: 1 })
        void FabricImage.fromURL(dataUrl).then(img => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          img.set({ left: 0, top: 0, selectable: false, evented: false } as any)
          fc.clear()
          fc.add(img)
          fc.renderAll()
        })
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        path.set({ selectable: false, evented: false } as any)
        fc.renderAll()
      }
    })

    // Snapshot before each free-draw stroke commits
    fc.on('before:path:created', () => snapshot())

    // Shape tool mouse events (rect / line / arrow / text)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fc.on('mouse:down', (e: any) => {
      const tool = toolRef.current
      const isMask = modeRef.current === 'mask'
      const drawColor = isMask ? MASK_COLOR : colorRef.current

      if (tool === 'text') {
        // 点击正在编辑的文本 → 交给 Fabric 移动光标
        if (e.target && e.target.isEditing) return
        // 点击空白提交了正在编辑的文本 → 本次点击只做提交，不立刻新建
        if (performance.now() - textExitedAtRef.current < 150) return
        snapshot()
        const p = fc.getPointer(e.e)
        const it = new IText('', {
          left: p.x,
          top: p.y,
          fill: drawColor,
          fontSize: Math.min(96, Math.max(14, Math.round(brushSizeRef.current * 1.8))),
          fontFamily: 'system-ui, "PingFang SC", "Microsoft YaHei", sans-serif',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          erasable: true as any,
        })
        fc.add(it)
        fc.setActiveObject(it)
        it.enterEditing()
        fc.renderAll()
        return
      }

      if (tool === 'rect') {
        snapshot()
        const pointer = fc.getPointer(e.e)
        rectStartRef.current = { x: pointer.x, y: pointer.y }
        const rect = new Rect({
          left: pointer.x,
          top: pointer.y,
          width: 0,
          height: 0,
          fill: isMask ? MASK_COLOR : colorRef.current,
          stroke: isMask ? MASK_COLOR : undefined,
          strokeWidth: isMask ? 2 : 0,
          strokeDashArray: isMask ? [10, 5] : undefined,
          selectable: false,
          evented: false,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          erasable: true as any,
        })
        activeRectRef.current = rect
        fc.add(rect)
        return
      }

      if (tool === 'line' || tool === 'arrow') {
        snapshot()
        const p = fc.getPointer(e.e)
        shapeStartRef.current = { x: p.x, y: p.y }
        activeShapeRef.current = null
      }
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fc.on('mouse:move', (e: any) => {
      const tool = toolRef.current

      if (tool === 'rect') {
        const start = rectStartRef.current
        const rect = activeRectRef.current
        if (!start || !rect) return
        const p = fc.getPointer(e.e)
        rect.set({
          left: Math.min(p.x, start.x),
          top: Math.min(p.y, start.y),
          width: Math.abs(p.x - start.x),
          height: Math.abs(p.y - start.y),
        })
        fc.renderAll()
        return
      }

      if (tool === 'line' || tool === 'arrow') {
        const start = shapeStartRef.current
        if (!start) return
        const p = fc.getPointer(e.e)
        const strokeW = shapeStrokeWidth(brushSizeRef.current)
        const drawColor = modeRef.current === 'mask' ? MASK_COLOR : colorRef.current
        // Path 的几何在构造时解析，拖拽预览用移除重建
        if (activeShapeRef.current) fc.remove(activeShapeRef.current)
        const path = new Path(linePathData(start.x, start.y, p.x, p.y, tool === 'arrow', strokeW), {
          stroke: drawColor,
          strokeWidth: strokeW,
          fill: '',
          strokeLineCap: 'round',
          strokeLineJoin: 'round',
          selectable: false,
          evented: false,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          erasable: true as any,
        })
        activeShapeRef.current = path
        fc.add(path)
        fc.renderAll()
      }
    })

    fc.on('mouse:up', () => {
      const tool = toolRef.current
      // 原地点击未拖出线段 → 丢弃为其预留的 undo 快照
      if ((tool === 'line' || tool === 'arrow') && shapeStartRef.current && !activeShapeRef.current) {
        undoStack.current.pop()
        setCanUndo(undoStack.current.length > 0)
      }
      rectStartRef.current = null
      activeRectRef.current = null
      shapeStartRef.current = null
      activeShapeRef.current = null
    })

    // 文本提交/丢弃：退出编辑时空文本直接移除并回收 undo 快照
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fc.on('text:editing:exited', (e: any) => {
      textExitedAtRef.current = performance.now()
      const it = e.target as IText | undefined
      if (!it) return
      if (!it.text || !it.text.trim()) {
        fc.remove(it)
        undoStack.current.pop()
        setCanUndo(undoStack.current.length > 0)
      } else {
        it.set({ selectable: false, evented: false })
      }
      fc.discardActiveObject()
      fc.renderAll()
    })

    fcRef.current = fc

    return () => {
      fc.dispose()
      fcRef.current = null
      if (canvasEl.parentElement === container) container.removeChild(canvasEl)
    }
  }, [snapshot]) // eslint-disable-line react-hooks/exhaustive-deps

  // 提交正在编辑的文本（触发 text:editing:exited 完成落定或丢弃）
  const commitEditingText = React.useCallback(() => {
    const fc = fcRef.current
    if (!fc) return
    const active = fc.getActiveObject()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (active && (active as any).isEditing) (active as IText).exitEditing()
  }, [])

  const setTool = React.useCallback((t: DrawTool) => {
    commitEditingText()
    toolRef.current = t
    setToolState(t)
    const fc = fcRef.current
    if (fc) configureBrush(fc, t, brushSizeRef.current, colorRef.current, modeRef.current)
  }, [commitEditingText])

  const setBrushSize = React.useCallback((s: number) => {
    brushSizeRef.current = s
    setBrushSizeState(s)
    const fc = fcRef.current
    if (fc?.freeDrawingBrush) fc.freeDrawingBrush.width = s
  }, [])

  const setColor = React.useCallback((c: string) => {
    colorRef.current = c
    setColorState(c)
    const fc = fcRef.current
    if (fc?.freeDrawingBrush && modeRef.current !== 'mask' && toolRef.current === 'brush') {
      ;(fc.freeDrawingBrush as PencilBrush).color = c
    }
  }, [])

  const undo = React.useCallback(() => {
    const fc = fcRef.current
    if (!fc || !undoStack.current.length) return
    redoStack.current.push(fc.toDataURL({ format: 'png', multiplier: 1 }))
    const prev = undoStack.current.pop()!
    setCanUndo(undoStack.current.length > 0)
    setCanRedo(true)
    void restoreDataUrl(fc, prev)
  }, [restoreDataUrl])

  const redo = React.useCallback(() => {
    const fc = fcRef.current
    if (!fc || !redoStack.current.length) return
    undoStack.current.push(fc.toDataURL({ format: 'png', multiplier: 1 }))
    const next = redoStack.current.pop()!
    setCanUndo(true)
    setCanRedo(redoStack.current.length > 0)
    void restoreDataUrl(fc, next)
  }, [restoreDataUrl])

  const clear = React.useCallback(() => {
    const fc = fcRef.current
    if (!fc) return
    commitEditingText()
    snapshot()
    fc.clear()
    fc.renderAll()
  }, [snapshot, commitEditingText])

  const exportBlob = React.useCallback(
    (sourceImageUrl: string) => {
      const fc = fcRef.current
      if (!fc) return Promise.reject(new Error('fabric canvas not ready'))
      commitEditingText()
      return exportAtSourceResolution(fc, sourceImageUrl)
    },
    [commitEditingText],
  )

  const exportMaskBlob = React.useCallback(
    (sourceImageUrl: string) => {
      const fc = fcRef.current
      if (!fc) return Promise.reject(new Error('fabric canvas not ready'))
      commitEditingText()
      return exportMaskAtSourceResolution(fc, sourceImageUrl)
    },
    [commitEditingText],
  )

  return {
    containerRef,
    tool,
    brushSize,
    color,
    canUndo,
    canRedo,
    setTool,
    setBrushSize,
    setColor,
    undo,
    redo,
    clear,
    exportAnnotationBlob: exportBlob,
    exportVisibleCompositeBlob: exportBlob,
    exportMaskBlob,
  }
}
