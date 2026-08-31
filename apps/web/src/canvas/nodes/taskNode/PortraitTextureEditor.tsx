import React from 'react'
import { NodeToolbar, Position } from '@xyflow/react'
import { IconBox, IconCheck, IconLoader2, IconUserCircle, IconX } from '@tabler/icons-react'
import { ManagedImage } from '../../../domain/resource-runtime'
import { recognizeElementAtPoint, type RecognizedElementMask } from './elementRecognition'
import {
  createPortraitEditMask,
  detectPeopleInImage,
  normalizedPointerPosition,
  normalizedRectFromPoints,
  type NormalizedPoint,
  type NormalizedRect,
} from './portraitSelection'

export type PortraitTextureSelection = Readonly<{
  maskBlob: Blob
  rect: NormalizedRect
  source: 'detected' | 'manual'
  imageWidth: number
  imageHeight: number
}>

type PortraitTextureEditorProps = {
  imageUrl: string
  isDarkUi: boolean
  purpose?: 'portrait-texture' | 'emotion'
  initialManualMode?: boolean
  onClose: () => void
  onConfirm: (selection: PortraitTextureSelection) => Promise<void>
}

type DetectionStatus = 'loading' | 'ready' | 'empty' | 'recognizing' | 'error'

function isUsableRect(rect: NormalizedRect): boolean {
  return rect.width >= 0.02 && rect.height >= 0.02
}

export function PortraitTextureEditor({
  imageUrl,
  isDarkUi,
  purpose = 'portrait-texture',
  initialManualMode = false,
  onClose,
  onConfirm,
}: PortraitTextureEditorProps): JSX.Element {
  const [status, setStatus] = React.useState<DetectionStatus>('loading')
  const [detections, setDetections] = React.useState<NormalizedRect[]>([])
  const [selectedRect, setSelectedRect] = React.useState<NormalizedRect | null>(null)
  const [selectedDetectionIndex, setSelectedDetectionIndex] = React.useState<number | null>(null)
  const [selectionSource, setSelectionSource] = React.useState<'detected' | 'manual'>('detected')
  const [manualMode, setManualMode] = React.useState(initialManualMode)
  const [manualStart, setManualStart] = React.useState<NormalizedPoint | null>(null)
  const [manualDraft, setManualDraft] = React.useState<NormalizedRect | null>(null)
  const [imageElement, setImageElement] = React.useState<HTMLImageElement | null>(null)
  const [recognizedMask, setRecognizedMask] = React.useState<RecognizedElementMask | null>(null)
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const detectedImageRef = React.useRef<HTMLImageElement | null>(null)
  const recognitionSequenceRef = React.useRef(0)

  const recognizedOverlayUrl = React.useMemo(
    () => recognizedMask ? URL.createObjectURL(recognizedMask.overlayBlob) : null,
    [recognizedMask],
  )
  React.useEffect(() => () => {
    if (recognizedOverlayUrl) URL.revokeObjectURL(recognizedOverlayUrl)
  }, [recognizedOverlayUrl])

  const panelBackground = isDarkUi ? 'rgba(37, 37, 37, 0.97)' : 'rgba(248, 249, 251, 0.98)'
  const panelColor = isDarkUi ? 'rgba(255,255,255,.94)' : 'rgba(17,18,21,.94)'
  const panelBorder = isDarkUi ? 'rgba(255,255,255,.12)' : 'rgba(17,18,21,.12)'
  const purposeLabel = purpose === 'emotion' ? '情绪调节' : '人像质感调节'

  const runDetection = React.useCallback(async (image: HTMLImageElement) => {
    if (detectedImageRef.current === image) return
    detectedImageRef.current = image
    setStatus('loading')
    setError(null)
    try {
      const boxes = await detectPeopleInImage(image)
      setDetections(boxes)
      setStatus(boxes.length > 0 ? 'ready' : 'empty')
    } catch (detectionError: unknown) {
      setDetections([])
      setStatus('error')
      setError(detectionError instanceof Error ? detectionError.message : '人物识别失败')
    }
  }, [])

  const handleImageLoad = React.useCallback((event: React.SyntheticEvent<HTMLImageElement>) => {
    const image = event.currentTarget
    setImageElement(image)
    void runDetection(image)
  }, [runDetection])

  const submitRecognizedSelection = React.useCallback(async (selection: Readonly<{
    mask: RecognizedElementMask
    rect: NormalizedRect
    source: 'detected' | 'manual'
  }>) => {
    if (!imageElement || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const maskBlob = await createPortraitEditMask({
        foregroundMaskBlob: selection.mask.foregroundMaskBlob,
        width: imageElement.naturalWidth,
        height: imageElement.naturalHeight,
      })
      await onConfirm({
        maskBlob,
        rect: selection.rect,
        source: selection.source,
        imageWidth: imageElement.naturalWidth,
        imageHeight: imageElement.naturalHeight,
      })
    } catch (submitError: unknown) {
      setError(submitError instanceof Error ? submitError.message : '人像区域确认失败')
    } finally {
      setSubmitting(false)
    }
  }, [imageElement, onConfirm, submitting])

  const recognizePortrait = React.useCallback(async (
    rect: NormalizedRect,
    source: 'detected' | 'manual',
    detectionIndex: number | null,
  ) => {
    if (!imageElement) {
      setStatus('error')
      setError('人物识别需要等待原图加载完成')
      return
    }
    const sequence = recognitionSequenceRef.current + 1
    recognitionSequenceRef.current = sequence
    setSelectedRect(rect)
    setSelectedDetectionIndex(detectionIndex)
    setSelectionSource(source)
    setRecognizedMask(null)
    setStatus('recognizing')
    setError(null)
    try {
      const result = await recognizeElementAtPoint({
        image: imageElement,
        point: {
          x: rect.x + rect.width / 2,
          y: rect.y + rect.height / 2,
        },
        detectedObjects: [],
      })
      if (recognitionSequenceRef.current !== sequence) return
      setRecognizedMask(result)
      setSelectedRect(result.bounds)
      setStatus('ready')
      if (source === 'detected') {
        await submitRecognizedSelection({
          mask: result,
          rect: result.bounds,
          source,
        })
      }
    } catch (recognitionError: unknown) {
      if (recognitionSequenceRef.current !== sequence) return
      setRecognizedMask(null)
      setStatus('error')
      setError(recognitionError instanceof Error ? recognitionError.message : '人物分割失败')
    }
  }, [imageElement, submitRecognizedSelection])

  const handlePointerDown = React.useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    if (!manualMode || event.button !== 0 || submitting) return
    event.preventDefault()
    event.stopPropagation()
    const point = normalizedPointerPosition(event.nativeEvent, event.currentTarget.getBoundingClientRect())
    event.currentTarget.setPointerCapture(event.pointerId)
    setManualStart(point)
    setManualDraft({ x: point.x, y: point.y, width: 0, height: 0 })
  }, [manualMode, submitting])

  const handlePointerMove = React.useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    if (!manualMode || !manualStart || !event.currentTarget.hasPointerCapture(event.pointerId)) return
    event.preventDefault()
    const point = normalizedPointerPosition(event.nativeEvent, event.currentTarget.getBoundingClientRect())
    setManualDraft(normalizedRectFromPoints(manualStart, point))
  }, [manualMode, manualStart])

  const commitManualSelection = React.useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    if (!manualMode || !manualStart || !event.currentTarget.hasPointerCapture(event.pointerId)) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.releasePointerCapture(event.pointerId)
    const point = normalizedPointerPosition(event.nativeEvent, event.currentTarget.getBoundingClientRect())
    const rect = normalizedRectFromPoints(manualStart, point)
    setManualStart(null)
    setManualDraft(null)
    if (!isUsableRect(rect)) {
      setError('框选范围太小，请重新框选完整人物')
      return
    }
    void recognizePortrait(rect, 'manual', null)
  }, [manualMode, manualStart, recognizePortrait])

  const handleConfirm = React.useCallback(async () => {
    if (!selectedRect || !recognizedMask || submitting) return
    await submitRecognizedSelection({
      mask: recognizedMask,
      rect: selectedRect,
      source: selectionSource,
    })
  }, [recognizedMask, selectedRect, selectionSource, submitRecognizedSelection, submitting])

  const instruction = submitting
    ? '正在确认人物'
    : status === 'recognizing'
    ? '正在精确分割人物'
    : recognizedMask
      ? '已选择人物'
      : status === 'loading'
        ? '正在识别人像'
        : status === 'ready'
          ? '请选择人物进行操作'
          : '未识别到人物，请手动框选'

  const toggleManualMode = React.useCallback(() => {
    recognitionSequenceRef.current += 1
    setManualMode((current) => !current)
    setManualStart(null)
    setManualDraft(null)
    setSelectedRect(null)
    setSelectedDetectionIndex(null)
    setRecognizedMask(null)
    setSelectionSource('manual')
    setError(null)
    setStatus(detections.length > 0 ? 'ready' : 'empty')
  }, [detections.length])

  return (
    <>
      <NodeToolbar isVisible position={Position.Top} align="center" offset={-56} className="tc-portrait-select__toolbar nodrag nopan">
        <div
          className="tc-portrait-select__toolbar-panel"
          style={{ background: panelBackground, color: panelColor, borderColor: panelBorder }}
        >
          <button type="button" className="tc-portrait-select__icon-button" onClick={onClose} aria-label={`退出${purposeLabel}`}>
            <IconX size={21} />
          </button>
          <span className="tc-portrait-select__divider" style={{ background: panelBorder }} />
          <span className="tc-portrait-select__status-icon" aria-hidden="true">
            {status === 'loading' || status === 'recognizing'
              ? <IconLoader2 className="tc-portrait-select__spinner" size={20} />
              : <IconUserCircle size={21} />}
          </span>
          <span className="tc-portrait-select__instruction">{instruction}</span>
          <span className="tc-portrait-select__divider" style={{ background: panelBorder }} />
          <button
            type="button"
            className={`tc-portrait-select__mode-button${manualMode ? ' is-active' : ''}`}
            onClick={toggleManualMode}
          >
            <IconBox size={19} />
            手动框选
          </button>
          {recognizedMask && (selectionSource === 'manual' || Boolean(error)) ? (
            <button
              type="button"
              className="tc-portrait-select__confirm-button"
              disabled={submitting}
              onClick={() => { void handleConfirm() }}
            >
              <IconCheck size={18} />
              {submitting ? '处理中…' : error ? '重试确认' : '确认'}
            </button>
          ) : null}
        </div>
      </NodeToolbar>

      <div className="tc-portrait-select__surface nodrag nopan">
        <ManagedImage
          className="tc-portrait-select__image"
          src={imageUrl}
          alt="待选择人物的原图"
          priority="critical"
          ownerSurface="task-node-main-image"
          crossOrigin="anonymous"
          draggable={false}
          onLoad={handleImageLoad}
        />
        {recognizedOverlayUrl ? (
          <ManagedImage
            className="tc-portrait-select__recognized-overlay"
            src={recognizedOverlayUrl}
            alt="已识别人物蒙版"
            priority="critical"
            ownerSurface="task-node-main-image"
            draggable={false}
          />
        ) : null}
        <svg
          className={`tc-portrait-select__overlay${manualMode ? ' is-manual' : ''}`}
          viewBox="0 0 1 1"
          preserveAspectRatio="none"
          aria-label={manualMode ? `为${purposeLabel}手动框选人物` : `为${purposeLabel}选择识别到的人物`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={commitManualSelection}
          onPointerCancel={commitManualSelection}
        >
          {detections.map((rect, index) => {
            const selected = selectionSource === 'detected' && selectedDetectionIndex === index
            return (
              <g
                key={`${rect.x}-${rect.y}-${index}`}
                className={`tc-portrait-select__candidate${selected ? ' is-selected' : ''}`}
                role="button"
                aria-label={`人物 ${index + 1}`}
                onPointerDown={(event) => {
                  if (manualMode || submitting) return
                  event.preventDefault()
                  event.stopPropagation()
                  void recognizePortrait(rect, 'detected', index)
                }}
              >
                <rect x={rect.x} y={rect.y} width={rect.width} height={rect.height} />
                <path d={`M ${rect.x} ${rect.y + 0.035} V ${rect.y} H ${rect.x + 0.035}`} />
                <path d={`M ${rect.x + rect.width - 0.035} ${rect.y} H ${rect.x + rect.width} V ${rect.y + 0.035}`} />
                <path d={`M ${rect.x} ${rect.y + rect.height - 0.035} V ${rect.y + rect.height} H ${rect.x + 0.035}`} />
                <path d={`M ${rect.x + rect.width - 0.035} ${rect.y + rect.height} H ${rect.x + rect.width} V ${rect.y + rect.height - 0.035}`} />
              </g>
            )
          })}
          {manualDraft ? (
            <rect
              className="tc-portrait-select__manual-draft"
              x={manualDraft.x}
              y={manualDraft.y}
              width={manualDraft.width}
              height={manualDraft.height}
            />
          ) : null}
          {selectionSource === 'manual' && selectedRect ? (
            <rect
              className="tc-portrait-select__manual-selection"
              x={selectedRect.x}
              y={selectedRect.y}
              width={selectedRect.width}
              height={selectedRect.height}
            />
          ) : null}
        </svg>
        {error ? <div className="tc-portrait-select__error">{error}</div> : null}
      </div>
    </>
  )
}
