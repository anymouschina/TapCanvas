import React from 'react'
import { NodeToolbar, Position } from '@xyflow/react'
import {
  IconBox,
  IconCheck,
  IconEdit,
  IconLoader2,
  IconMapPin,
  IconPencil,
  IconPointer,
  IconRestore,
  IconX,
} from '@tabler/icons-react'
import { fetchProxiedImageBlob } from '../../../api/server'
import { ManagedImage } from '../../../domain/resource-runtime'
import {
  detectObjectsInImage,
  preloadElementSegmentation,
  recognizeElementAtPoint,
  type RecognizedElementMask,
  type RecognizedObject,
} from './elementRecognition'

export type ElementEditAction = 'modify' | 'move'

export type ElementEditSubmit = Readonly<{
  action: ElementEditAction
  maskBlob: Blob
  label: string
  prompt: string
  selectionCount: number
  selections: readonly ElementEditSelection[]
  moveTarget: NormalizedPoint | null
}>

export type NormalizedPoint = Readonly<{ x: number; y: number }>
type RectSelection = Readonly<{ kind: 'rect'; start: NormalizedPoint; end: NormalizedPoint }>
type StrokeSelection = Readonly<{ kind: 'stroke'; points: readonly NormalizedPoint[] }>
type SegmentSelection = Readonly<{
  kind: 'segment'
  point: NormalizedPoint
  bounds: Readonly<{ x: number; y: number; width: number; height: number }>
  label: string
  score: number
}>
export type ElementEditSelection = RectSelection | StrokeSelection | SegmentSelection
type ElementSelection = ElementEditSelection
type SelectionTool = 'point' | 'rect' | 'brush'
type RecognitionStatus = 'loading' | 'ready' | 'recognizing' | 'error'

type ElementEditEditorProps = {
  imageUrl: string
  isDarkUi: boolean
  onClose: () => void
  onConfirm: (submit: ElementEditSubmit) => Promise<void>
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function pointerPosition(event: React.PointerEvent<SVGSVGElement>): NormalizedPoint {
  const rect = event.currentTarget.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 }
  return {
    x: clampUnit((event.clientX - rect.left) / rect.width),
    y: clampUnit((event.clientY - rect.top) / rect.height),
  }
}

function rectDimensions(selection: RectSelection): { x: number; y: number; width: number; height: number } {
  return {
    x: Math.min(selection.start.x, selection.end.x),
    y: Math.min(selection.start.y, selection.end.y),
    width: Math.abs(selection.end.x - selection.start.x),
    height: Math.abs(selection.end.y - selection.start.y),
  }
}

function selectionAnchor(selections: readonly ElementSelection[]): NormalizedPoint | null {
  const first = selections[0]
  if (!first) return null
  if (first.kind === 'segment') return first.point
  if (first.kind === 'rect') {
    return {
      x: (first.start.x + first.end.x) / 2,
      y: (first.start.y + first.end.y) / 2,
    }
  }
  return first.points[Math.floor(first.points.length / 2)] ?? null
}

export function buildElementEditPrompt(input: {
  action: ElementEditAction
  label: string
  instruction: string
}): string {
  const objectLabel = input.label.trim() || '已选对象'
  const instruction = input.instruction.trim()
  const shared = [
    '这是一次基于可见标记的精确图片元素编辑。',
    `青蓝色点、框或笔迹标出的区域是“${objectLabel}”，只允许编辑该对象及编辑后必须补全的遮挡区域。`,
    '最终结果必须移除所有青蓝色、橙色标记和辅助线，保持未选区域的构图、身份、材质、光线、色彩与清晰度不变。',
  ]
  if (input.action === 'move') {
    return [
      ...shared,
      '将已选对象移动到橙色目标点，保持对象外观、尺寸、朝向和透视关系不变，并自然补全原位置的背景与新位置的接触阴影。',
      instruction ? `补充要求：${instruction}` : '',
    ].filter(Boolean).join('\n')
  }
  return [
    ...shared,
    `修改要求：${instruction}`,
  ].join('\n')
}

async function exportSelectionMask(
  imageUrl: string,
  selections: readonly ElementSelection[],
  recognizedForegroundMask: Blob | null,
): Promise<Blob> {
  const sourceBlob = await fetchProxiedImageBlob(imageUrl)
  const bitmap = await createImageBitmap(sourceBlob)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('浏览器无法创建元素编辑蒙版')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, bitmap.width, bitmap.height)
    context.globalCompositeOperation = 'destination-out'
    context.fillStyle = '#000000'
    context.strokeStyle = '#000000'
    context.lineCap = 'round'
    context.lineJoin = 'round'
    const unit = Math.max(1, Math.min(bitmap.width, bitmap.height))
    if (recognizedForegroundMask) {
      const foregroundBitmap = await createImageBitmap(recognizedForegroundMask)
      try {
        context.drawImage(foregroundBitmap, 0, 0, bitmap.width, bitmap.height)
      } finally {
        foregroundBitmap.close()
      }
    }
    for (const selection of selections) {
      if (selection.kind === 'segment') {
        continue
      }
      if (selection.kind === 'rect') {
        const rect = rectDimensions(selection)
        context.clearRect(
          rect.x * bitmap.width,
          rect.y * bitmap.height,
          rect.width * bitmap.width,
          rect.height * bitmap.height,
        )
      } else if (selection.points.length >= 2) {
        context.beginPath()
        selection.points.forEach((point, index) => {
          const x = point.x * bitmap.width
          const y = point.y * bitmap.height
          if (index === 0) context.moveTo(x, y)
          else context.lineTo(x, y)
        })
        context.lineWidth = Math.max(12, unit * 0.045)
        context.stroke()
      }
    }
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('元素编辑蒙版导出失败'))),
        'image/png',
      )
    })
  } finally {
    bitmap.close()
  }
}

function ToolButton(props: {
  active?: boolean
  disabled?: boolean
  label: string
  onClick: () => void
  children: React.ReactNode
}): JSX.Element {
  return (
    <button
      type="button"
      className={`tc-element-edit__tool${props.active ? ' tc-element-edit__tool--active' : ''}`}
      aria-label={props.label}
      title={props.label}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.children}
      <span>{props.label}</span>
    </button>
  )
}

export function ElementEditEditor({ imageUrl, isDarkUi, onClose, onConfirm }: ElementEditEditorProps): JSX.Element {
  const [tool, setTool] = React.useState<SelectionTool>('point')
  const [selections, setSelections] = React.useState<ElementSelection[]>([])
  const [draftSelection, setDraftSelection] = React.useState<RectSelection | StrokeSelection | null>(null)
  const [pointerId, setPointerId] = React.useState<number | null>(null)
  const [action, setAction] = React.useState<ElementEditAction>('modify')
  const [placingTarget, setPlacingTarget] = React.useState(false)
  const [moveTarget, setMoveTarget] = React.useState<NormalizedPoint | null>(null)
  const [label, setLabel] = React.useState('已选对象')
  const [instruction, setInstruction] = React.useState('')
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [imageElement, setImageElement] = React.useState<HTMLImageElement | null>(null)
  const [recognitionStatus, setRecognitionStatus] = React.useState<RecognitionStatus>('loading')
  const [recognizedObjects, setRecognizedObjects] = React.useState<RecognizedObject[]>([])
  const [recognizedMask, setRecognizedMask] = React.useState<RecognizedElementMask | null>(null)
  const detectedImageRef = React.useRef<HTMLImageElement | null>(null)

  const recognizedOverlayUrl = React.useMemo(
    () => recognizedMask ? URL.createObjectURL(recognizedMask.overlayBlob) : null,
    [recognizedMask],
  )
  React.useEffect(() => () => {
    if (recognizedOverlayUrl) URL.revokeObjectURL(recognizedOverlayUrl)
  }, [recognizedOverlayUrl])

  const visibleSelections = React.useMemo(
    () => draftSelection ? [...selections, draftSelection] : selections,
    [draftSelection, selections],
  )
  const anchor = selectionAnchor(visibleSelections)
  const canSubmit = selections.length > 0 && (action === 'move' ? moveTarget !== null : instruction.trim().length > 0)
  const panelBackground = isDarkUi ? 'rgba(37, 37, 37, 0.97)' : 'rgba(248, 249, 251, 0.98)'
  const panelColor = isDarkUi ? 'rgba(255,255,255,.92)' : 'rgba(17,18,21,.92)'
  const panelBorder = isDarkUi ? 'rgba(255,255,255,.12)' : 'rgba(17,18,21,.12)'

  const runDetection = React.useCallback(async (image: HTMLImageElement) => {
    if (detectedImageRef.current === image) return
    detectedImageRef.current = image
    setRecognitionStatus('loading')
    setError(null)
    try {
      const [objects] = await Promise.all([
        detectObjectsInImage(image),
        preloadElementSegmentation(),
      ])
      setRecognizedObjects(objects)
      setRecognitionStatus('ready')
    } catch (recognitionError: unknown) {
      setRecognizedObjects([])
      setRecognitionStatus('error')
      setError(recognitionError instanceof Error ? recognitionError.message : '元素识别初始化失败')
    }
  }, [])

  const handleImageLoad = React.useCallback((event: React.SyntheticEvent<HTMLImageElement>) => {
    const image = event.currentTarget
    setImageElement(image)
    void runDetection(image)
  }, [runDetection])

  const recognizePoint = React.useCallback(async (point: NormalizedPoint) => {
    if (!imageElement) {
      setRecognitionStatus('error')
      setError('元素识别需要等待原图加载完成')
      return
    }
    setRecognitionStatus('recognizing')
    setError(null)
    try {
      const result = await recognizeElementAtPoint({ image: imageElement, point, detectedObjects: recognizedObjects })
      setRecognizedMask(result)
      setLabel(result.label)
      setSelections([{
        kind: 'segment',
        point: result.point,
        bounds: result.bounds,
        label: result.label,
        score: result.score,
      }])
      setMoveTarget(null)
      setRecognitionStatus('ready')
    } catch (recognitionError: unknown) {
      setRecognizedMask(null)
      setSelections([])
      setRecognitionStatus('error')
      setError(recognitionError instanceof Error ? recognitionError.message : '元素识别失败')
    }
  }, [imageElement, recognizedObjects])

  const handlePointerDown = React.useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0 || submitting || recognitionStatus === 'recognizing') return
    event.preventDefault()
    event.stopPropagation()
    const point = pointerPosition(event)
    if (placingTarget) {
      setMoveTarget(point)
      setPlacingTarget(false)
      return
    }
    if (tool === 'point') {
      void recognizePoint(point)
      return
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    setPointerId(event.pointerId)
    setDraftSelection(tool === 'rect'
      ? { kind: 'rect', start: point, end: point }
      : { kind: 'stroke', points: [point] })
  }, [placingTarget, recognitionStatus, recognizePoint, submitting, tool])

  const handlePointerMove = React.useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    if (pointerId !== event.pointerId || !draftSelection) return
    event.preventDefault()
    const point = pointerPosition(event)
    setDraftSelection((current) => {
      if (!current) return null
      if (current.kind === 'rect') return { ...current, end: point }
      return { ...current, points: [...current.points, point] }
    })
  }, [draftSelection, pointerId])

  const commitDraftSelection = React.useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    if (pointerId !== event.pointerId || !draftSelection) return
    event.preventDefault()
    event.stopPropagation()
    if (draftSelection.kind === 'rect') {
      const rect = rectDimensions(draftSelection)
      if (rect.width > 0.01 && rect.height > 0.01) {
        setSelections((current) => [...current, draftSelection])
      }
    } else if (draftSelection.points.length > 1) {
      setSelections((current) => [...current, draftSelection])
    }
    setDraftSelection(null)
    setPointerId(null)
  }, [draftSelection, pointerId])

  const handleUndo = React.useCallback(() => {
    if (moveTarget) {
      setMoveTarget(null)
      return
    }
    if (selections[selections.length - 1]?.kind === 'segment') setRecognizedMask(null)
    setSelections((current) => current.slice(0, -1))
  }, [moveTarget, selections])

  const handleActionChange = React.useCallback((nextAction: ElementEditAction) => {
    setAction(nextAction)
    setError(null)
    if (nextAction === 'move') {
      setPlacingTarget(true)
      return
    }
    setPlacingTarget(false)
    setMoveTarget(null)
  }, [])

  const handleSubmit = React.useCallback(async () => {
    if (!canSubmit || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const maskBlob = await exportSelectionMask(
        imageUrl,
        selections,
        recognizedMask?.foregroundMaskBlob ?? null,
      )
      await onConfirm({
        action,
        maskBlob,
        label: label.trim() || '已选对象',
        prompt: buildElementEditPrompt({ action, label, instruction }),
        selectionCount: selections.length,
        selections,
        moveTarget,
      })
    } catch (submitError: unknown) {
      setError(submitError instanceof Error ? submitError.message : '元素编辑提交失败')
    } finally {
      setSubmitting(false)
    }
  }, [action, canSubmit, imageUrl, instruction, label, moveTarget, onConfirm, recognizedMask, selections, submitting])

  return (
    <>
      <NodeToolbar isVisible position={Position.Top} align="center" offset={8} className="tc-element-edit__toolbar nodrag nopan">
        <div className="tc-element-edit__toolbar-panel" style={{ background: panelBackground, color: panelColor, borderColor: panelBorder }}>
          <button type="button" className="tc-element-edit__close" onClick={onClose} aria-label="关闭元素编辑">
            <IconX size={20} />
            <span>元素编辑</span>
          </button>
          <span className="tc-element-edit__divider" style={{ background: panelBorder }} />
          <ToolButton active={tool === 'point' && !placingTarget} label="点选" onClick={() => { setTool('point'); setPlacingTarget(false) }}>
            <IconPointer size={18} />
          </ToolButton>
          <ToolButton active={tool === 'rect' && !placingTarget} label="框选" onClick={() => { setTool('rect'); setPlacingTarget(false) }}>
            <IconBox size={18} />
          </ToolButton>
          <ToolButton active={tool === 'brush' && !placingTarget} label="画笔" onClick={() => { setTool('brush'); setPlacingTarget(false) }}>
            <IconPencil size={18} />
          </ToolButton>
          <span className="tc-element-edit__divider" style={{ background: panelBorder }} />
          <ToolButton disabled={!selections.length && !moveTarget} label="撤销" onClick={handleUndo}>
            <IconRestore size={18} />
          </ToolButton>
        </div>
      </NodeToolbar>

      <div className="tc-element-edit__surface nodrag nopan">
        <ManagedImage
          className="tc-element-edit__image"
          src={imageUrl}
          alt="元素编辑原图"
          priority="critical"
          ownerSurface="task-node-main-image"
          crossOrigin="anonymous"
          draggable={false}
          onLoad={handleImageLoad}
        />
        {recognizedOverlayUrl ? (
          <ManagedImage
            className="tc-element-edit__recognized-overlay"
            src={recognizedOverlayUrl}
            alt="已识别元素蒙版"
            priority="critical"
            ownerSurface="task-node-main-image"
            draggable={false}
          />
        ) : null}
        <svg
          className={`tc-element-edit__overlay${placingTarget ? ' tc-element-edit__overlay--target' : ''}`}
          viewBox="0 0 1 1"
          preserveAspectRatio="none"
          aria-label={placingTarget ? '点击设置移动目标位置' : '元素选择画布'}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={commitDraftSelection}
          onPointerCancel={commitDraftSelection}
        >
          {visibleSelections.map((selection, index) => {
            const key = `${selection.kind}-${index}`
            if (selection.kind === 'segment') return null
            if (selection.kind === 'rect') {
              const rect = rectDimensions(selection)
              return <rect key={key} x={rect.x} y={rect.y} width={rect.width} height={rect.height} className="tc-element-edit__selection" />
            }
            return (
              <polyline
                key={key}
                points={selection.points.map((point) => `${point.x},${point.y}`).join(' ')}
                className="tc-element-edit__selection tc-element-edit__selection--stroke"
              />
            )
          })}
          {anchor && moveTarget ? (
            <>
              <line x1={anchor.x} y1={anchor.y} x2={moveTarget.x} y2={moveTarget.y} className="tc-element-edit__move-line" />
              <circle cx={moveTarget.x} cy={moveTarget.y} r="0.04" className="tc-element-edit__move-target" />
            </>
          ) : null}
        </svg>

        {recognitionStatus === 'loading' || recognitionStatus === 'recognizing' ? (
          <div className="tc-element-edit__recognition-status" role="status">
            <IconLoader2 size={18} />
            <span>{recognitionStatus === 'loading' ? '加载识别模型…' : '识别中…'}</span>
          </div>
        ) : null}

        {selections.length > 0 ? (
          <div className="tc-element-edit__object-bar" style={{ background: panelBackground, color: panelColor, borderColor: panelBorder }}>
            <ManagedImage
              className="tc-element-edit__object-thumb"
              src={imageUrl}
              alt=""
              priority="critical"
              ownerSurface="task-node-main-image"
              crossOrigin="anonymous"
            />
            <input
              className="tc-element-edit__object-label"
              value={label}
              aria-label="对象名称"
              onChange={(event) => setLabel(event.currentTarget.value)}
            />
            <button type="button" className={action === 'modify' ? 'is-active' : ''} onClick={() => handleActionChange('modify')}>
              <IconEdit size={18} />修改
            </button>
            <button type="button" className={action === 'move' ? 'is-active' : ''} onClick={() => handleActionChange('move')}>
              <IconMapPin size={18} />移动
            </button>
          </div>
        ) : null}
      </div>

      <NodeToolbar isVisible position={Position.Bottom} align="center" offset={10} className="tc-element-edit__prompt-toolbar nodrag nopan">
        <div className="tc-element-edit__prompt-panel" style={{ background: panelBackground, color: panelColor, borderColor: panelBorder }}>
          <IconEdit size={18} />
          <input
            value={instruction}
            aria-label="编辑内容"
            placeholder={action === 'move' ? (placingTarget ? '请在图片中点击目标位置' : '补充移动要求（可选）') : '描述要如何修改已选对象'}
            onChange={(event) => setInstruction(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && canSubmit) {
                event.preventDefault()
                void handleSubmit()
              }
            }}
          />
          <button type="button" disabled={!canSubmit || submitting} onClick={() => { void handleSubmit() }}>
            {submitting ? '提交中…' : <><IconCheck size={16} />生成</>}
          </button>
          {error ? <span className="tc-element-edit__error">{error}</span> : null}
        </div>
      </NodeToolbar>
    </>
  )
}
