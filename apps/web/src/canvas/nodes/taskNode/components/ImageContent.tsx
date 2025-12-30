import React from 'react'
import { IconChevronRight, IconTexture, IconUpload, IconVideo } from '@tabler/icons-react'
import { useReactFlow } from '@xyflow/react'
import { useRFStore } from '../../../store'

type ImageResult = { url: string }

type ImageContentProps = {
  hasPrimaryImage: boolean
  imageResults: ImageResult[]
  imagePrimaryIndex: number
  primaryImageUrl: string | null
  imageExpanded: boolean
  fileRef: React.RefObject<HTMLInputElement | null>
  onUpload: (files: File[]) => Promise<void>
  connectToRight: (kind: string, label: string) => void
  onSelectPrimary: (index: number, url: string) => void
  showChrome: boolean
  compact: boolean
  showStateOverlay: boolean
  stateLabel: string | null
  hovered: number | null
  setHovered: (value: number | null) => void
  quickActionBackgroundActive: string
  quickActionIconActive: string
  quickActionIconColor: string
  quickActionHint: string
  nodeShellText: string
  darkContentBackground: string
  darkCardShadow: string
  mediaFallbackSurface: string
  mediaOverlayText: string
  subtleOverlayBackground: string
  soraFileId?: string | null
  imageUrl?: string | null
  themeWhite: string
  setImageExpanded: (value: boolean) => void
  upstreamText?: string | null
}

export function ImageContent({
  hasPrimaryImage,
  imageResults,
  imagePrimaryIndex,
  primaryImageUrl,
  imageExpanded,
  fileRef,
  onUpload,
  connectToRight,
  onSelectPrimary,
  showChrome,
  compact,
  showStateOverlay,
  stateLabel,
  hovered,
  setHovered,
  quickActionBackgroundActive,
  quickActionIconActive,
  quickActionIconColor,
  quickActionHint,
  nodeShellText,
  darkContentBackground,
  darkCardShadow,
  mediaFallbackSurface,
  mediaOverlayText,
  subtleOverlayBackground,
  soraFileId,
  imageUrl,
  themeWhite,
  setImageExpanded,
  upstreamText,
}: ImageContentProps) {
  const mediaSize = 300
  const pickerGap = 8
  const pickerMaxVisibleRows = 2
  const pickerPanelWidth = mediaSize * 2 + pickerGap
  const pickerPanelHeight = mediaSize * pickerMaxVisibleRows + pickerGap
  const [imageError, setImageError] = React.useState(false)
  const activeImageUrl = primaryImageUrl || imageResults[imagePrimaryIndex]?.url || ''
  const rf = useReactFlow()
  const [dragPreviewUrl, setDragPreviewUrl] = React.useState<string | null>(null)
  const [dragPreviewVisible, setDragPreviewVisible] = React.useState(false)
  const dragPreviewElRef = React.useRef<HTMLDivElement | null>(null)
  const dragPreviewFrameRef = React.useRef<number | null>(null)
  const dragPreviewPendingRef = React.useRef<null | { x: number; y: number; visible: boolean; url: string }>(null)
  const dragPreviewStateRef = React.useRef<{ visible: boolean; url: string | null }>({ visible: false, url: null })
  const bindInputRef = React.useCallback((el: HTMLInputElement | null) => {
    ;(fileRef as any).current = el
  }, [fileRef])
  const capsuleRef = React.useRef<HTMLButtonElement | null>(null)
  const pickerRef = React.useRef<HTMLDivElement | null>(null)
  const suppressClickRef = React.useRef(false)
  const pointerDragRef = React.useRef<{
    pointerId: number
    startX: number
    startY: number
    leftPicker: boolean
    pickerRect: { left: number; top: number; right: number; bottom: number }
    url: string
  } | null>(null)
  const dragCleanupRef = React.useRef<null | (() => void)>(null)

  const createImageNodeAt = React.useCallback((client: { x: number; y: number }, url: string) => {
    const pos = rf.screenToFlowPosition({ x: client.x, y: client.y })
    const newId =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? (crypto as any).randomUUID()
        : `n-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    useRFStore.setState((s: any) => {
      const node = {
        id: newId,
        type: 'taskNode' as const,
        position: pos,
        data: {
          label: 'Image',
          kind: 'image',
          imageUrl: url,
          imageResults: [{ url }],
          imagePrimaryIndex: 0,
        },
      }
      return { nodes: [...s.nodes, node], nextId: (s.nextId ?? 1) + 1 }
    })
  }, [rf])

  const cleanupPointerDrag = React.useCallback(() => {
    pointerDragRef.current = null
    if (dragCleanupRef.current) {
      dragCleanupRef.current()
      dragCleanupRef.current = null
    }
    if (dragPreviewFrameRef.current !== null) {
      window.cancelAnimationFrame(dragPreviewFrameRef.current)
      dragPreviewFrameRef.current = null
    }
    dragPreviewPendingRef.current = null
    dragPreviewStateRef.current = { visible: false, url: null }
    setDragPreviewVisible(false)
    setDragPreviewUrl(null)
  }, [])

  const startPointerDrag = React.useCallback((evt: React.PointerEvent, url: string) => {
    evt.stopPropagation()
    evt.preventDefault()
    suppressClickRef.current = false
    cleanupPointerDrag()
    const pickerEl = pickerRef.current
    const rect = pickerEl?.getBoundingClientRect()
      ?? (evt.currentTarget as HTMLElement | null)?.getBoundingClientRect()
    if (!rect) return
    const cur = {
      pointerId: evt.pointerId,
      startX: evt.clientX,
      startY: evt.clientY,
      leftPicker: false,
      pickerRect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
      url,
    }
    pointerDragRef.current = cur

    const onMove = (e: PointerEvent) => {
      const state = pointerDragRef.current
      if (!state) return
      if (e.pointerId !== state.pointerId) return
      e.preventDefault()
      const dx = e.clientX - state.startX
      const dy = e.clientY - state.startY
      if (!suppressClickRef.current && Math.hypot(dx, dy) > 3) suppressClickRef.current = true
      const inside =
        e.clientX >= state.pickerRect.left &&
        e.clientX <= state.pickerRect.right &&
        e.clientY >= state.pickerRect.top &&
        e.clientY <= state.pickerRect.bottom
      if (!inside && !state.leftPicker) {
        state.leftPicker = true
        suppressClickRef.current = true
      }

      // Shadow preview follows pointer, only visible after leaving picker.
      dragPreviewPendingRef.current = { url: state.url, x: e.clientX, y: e.clientY, visible: state.leftPicker }
      if (dragPreviewFrameRef.current !== null) return
      const tick = () => {
        const dragState = pointerDragRef.current
        if (!dragState) {
          dragPreviewFrameRef.current = null
          return
        }
        const pending = dragPreviewPendingRef.current
        if (pending) {
          const current = dragPreviewStateRef.current
          if (pending.visible) {
            if (!current.visible || current.url !== pending.url) {
              dragPreviewStateRef.current = { visible: true, url: pending.url }
              setDragPreviewUrl(pending.url)
              setDragPreviewVisible(true)
            }
            const el = dragPreviewElRef.current
            if (el) {
              el.style.setProperty('--tc-drag-x', `${pending.x}px`)
              el.style.setProperty('--tc-drag-y', `${pending.y}px`)
            }
          } else if (current.visible) {
            dragPreviewStateRef.current = { visible: false, url: current.url }
            setDragPreviewVisible(false)
          }
        }
        dragPreviewFrameRef.current = window.requestAnimationFrame(tick)
      }
      dragPreviewFrameRef.current = window.requestAnimationFrame(tick)
    }

    const onEnd = (e: PointerEvent) => {
      const state = pointerDragRef.current
      if (!state) return
      if (e.pointerId !== state.pointerId) return
      e.preventDefault()
      const shouldCreate = state.leftPicker
      const draggedUrl = state.url
      cleanupPointerDrag()
      if (shouldCreate) {
        const trimmed = typeof draggedUrl === 'string' ? draggedUrl.trim() : ''
        if (trimmed) createImageNodeAt({ x: e.clientX, y: e.clientY }, trimmed)
        setImageExpanded(false)
      }
      window.setTimeout(() => {
        suppressClickRef.current = false
      }, 0)
    }

    window.addEventListener('pointermove', onMove, true)
    window.addEventListener('pointerup', onEnd, true)
    window.addEventListener('pointercancel', onEnd, true)
    dragCleanupRef.current = () => {
      window.removeEventListener('pointermove', onMove, true)
      window.removeEventListener('pointerup', onEnd, true)
      window.removeEventListener('pointercancel', onEnd, true)
    }
  }, [cleanupPointerDrag, createImageNodeAt, setImageExpanded])

  React.useEffect(() => () => cleanupPointerDrag(), [cleanupPointerDrag])

  React.useEffect(() => {
    setImageError(false)
  }, [activeImageUrl])

  React.useEffect(() => {
    if (!compact && imageExpanded) setImageExpanded(false)
  }, [compact, imageExpanded, setImageExpanded])

  React.useEffect(() => {
    if (!imageExpanded) return
    const onPointerDown = (evt: PointerEvent) => {
      const target = evt.target as Node | null
      if (!target) return
      if (capsuleRef.current?.contains(target)) return
      if (pickerRef.current?.contains(target)) return
      setImageExpanded(false)
    }
    const onKeyDown = (evt: KeyboardEvent) => {
      if (evt.key === 'Escape') setImageExpanded(false)
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [imageExpanded, setImageExpanded])

  return (
    <div
      className="task-node-image__root"
      style={{ position: 'relative', marginTop: compact ? 0 : 6, padding: compact ? 0 : '0 6px' }}
    >
      {dragPreviewVisible && dragPreviewUrl && (
        <div
          className="task-node-image__drag-preview"
          ref={dragPreviewElRef}
          style={{
            position: 'fixed',
            left: 0,
            top: 0,
            width: mediaSize,
            height: mediaSize,
            transform:
              'translate3d(var(--tc-drag-x, 0px), var(--tc-drag-y, 0px), 0) translate3d(-50%, -50%, 0) scale(0.98)',
            borderRadius: 10,
            overflow: 'hidden',
            zIndex: 9999,
            pointerEvents: 'none',
            boxShadow: '0 18px 46px rgba(0,0,0,0.5)',
            border: '1px solid rgba(255,255,255,0.14)',
            background: 'rgba(0,0,0,0.18)',
            animation: 'tc-image-drag-preview-in 120ms cubic-bezier(.2,.9,.2,1) both',
            willChange: 'transform',
          }}
          aria-hidden="true"
        >
          <img
            className="task-node-image__drag-preview-image"
            src={dragPreviewUrl}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', opacity: 0.88 }}
          />
        </div>
      )}
      {!hasPrimaryImage ? (
        <>
          <div
            className="task-node-image__empty-actions"
            style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 4, padding: '6px 2px' }}
            onMouseLeave={() => setHovered(null)}
          >
            {[
              { label: '上传图片并编辑', icon: <IconUpload size={16} />, onClick: () => fileRef.current?.click(), hint: '图片大小不能超过30MB' },
              { label: '图片换背景', icon: <IconTexture size={16} />, onClick: () => connectToRight('image', 'Image') },
              { label: '图生视频', icon: <IconVideo size={16} />, onClick: () => connectToRight('video', 'Video') },
            ].map((row, idx) => {
              const active = hovered === idx
              const dimOthers = hovered !== null && hovered !== idx
              return (
                <div
                  className="task-node-image__empty-action"
                  key={row.label}
                  onMouseEnter={() => setHovered(idx)}
                  onClick={row.onClick}
                  style={{
                    cursor: 'pointer',
                    padding: '8px 10px',
                    borderRadius: 6,
                    background: active ? quickActionBackgroundActive : 'transparent',
                    transition: 'background .12s ease, opacity .12s ease',
                    opacity: dimOthers ? 0.8 : 1,
                  }}
                >
                  <div className="task-node-image__empty-action-row" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div className="task-node-image__empty-action-icon" style={{ color: active ? quickActionIconActive : quickActionIconColor }}>
                      {row.icon}
                    </div>
                    <div className="task-node-image__empty-action-label" style={{ flex: 1, color: nodeShellText, fontSize: 13 }}>
                      {row.label}
                    </div>
                    <div className="task-node-image__empty-action-spacer" style={{ width: 12, height: 12 }} />
                  </div>
                  {active && idx === 0 && (
                    <div
                      className="task-node-image__empty-action-hint"
                      style={{ marginLeft: 36, marginTop: 4, color: quickActionHint, fontSize: 11 }}
                    >
                      图片大小不能超过30MB
                    </div>
                  )}
                </div>
              )
            })}
            <input
              className="task-node-image__file-input"
              ref={bindInputRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={async (e) => {
                const files = Array.from(e.currentTarget.files || [])
                e.currentTarget.value = ''
                if (!files.length) return
                await onUpload(files)
              }}
            />
          </div>
        </>
      ) : (
        <div className="task-node-image__preview" style={{ position: 'relative', width: '100%', display: 'flex', justifyContent: 'center' }}>
          <div className="task-node-image__preview-wrapper" style={{ position: 'relative', width: mediaSize, height: mediaSize }}>
            <div
              className="task-node-image__preview-frame"
              style={{
                position: 'relative',
                borderRadius: 10,
                overflow: 'hidden',
                boxShadow: darkCardShadow,
                background: mediaFallbackSurface,
                width: '100%',
                height: '100%',
              }}
            >
              <img
                className="task-node-image__preview-image"
                src={activeImageUrl}
                alt="主图"
                style={{
                  width: '100%',
                  height: '100%',
                  display: 'block',
                  objectFit: 'contain',
                  opacity: imageError ? 0 : 1,
                }}
                onError={() => setImageError(true)}
              />
              {(showStateOverlay || imageError) && (
                <div
                  className="task-node-image__overlay"
                  style={{
                    position: 'absolute',
                    inset: 0,
                    borderRadius: 10,
                    background:
                      'linear-gradient(135deg, rgba(255,255,255,0.06), rgba(255,255,255,0.18))',
                    animation: 'soft-pulse 1.8s ease-in-out infinite',
                    backdropFilter: 'blur(10px)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    pointerEvents: 'none',
                  }}
                  aria-hidden="true"
                >
                  <div
                    className="task-node-image__overlay-text"
                    style={{
                      fontSize: 12,
                      color: mediaOverlayText,
                      opacity: 0.8,
                      letterSpacing: 0.2,
                    }}
                  >
                    {imageError ? '资源不可用' : (stateLabel || '加载中')}
                  </div>
                </div>
              )}
              {imageResults.length > 1 && compact && (
                <button
                  className="task-node-image__count-toggle nodrag nopan"
                  ref={capsuleRef}
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation()
                    setImageExpanded(!imageExpanded)
                  }}
                  style={{
                    position: 'absolute',
                    right: 12,
                    bottom: 12,
                    padding: '4px 10px',
                    borderRadius: 999,
                    border: '1px solid rgba(15,23,42,0.6)',
                    background:
                      'linear-gradient(135deg, rgba(15,23,42,0.92), rgba(15,23,42,0.86))',
                    boxShadow:
                      '0 12px 32px rgba(0,0,0,0.65)',
                    color: themeWhite,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: 11,
                    fontWeight: 500,
                    cursor: 'pointer',
                    outline: 'none',
                  }}
                >
                  <span className="task-node-image__count-text">主图 {imageResults.length}</span>
                  <IconChevronRight className="task-node-image__count-icon" size={12} />
                </button>
              )}
            </div>
            {imageResults.length > 1 && imageExpanded && compact && (
              <div
                className="task-node-image__gallery nodrag nopan"
                style={{
                  position: 'absolute',
                  top: '50%',
                  left: '50%',
                  width: pickerPanelWidth,
                  maxHeight: pickerPanelHeight,
                  transform: 'translate(-50%, -50%)',
                  background: 'transparent',
                  borderRadius: 0,
                  boxShadow: 'none',
                  padding: 0,
                  zIndex: 3,
                  border: 'none',
                  animation: 'tc-image-picker-panel-in 170ms cubic-bezier(.2,.9,.2,1) both',
                  willChange: 'transform, opacity',
                }}
                ref={pickerRef}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <div
                  className="task-node-image__gallery-grid nodrag nopan"
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                    gap: pickerGap,
                    maxHeight: pickerPanelHeight,
                    overflowY: 'auto',
                    overscrollBehavior: 'contain',
                  }}
                >
                  {imageResults.map((img, idx) => {
                    const isPrimary = idx === imagePrimaryIndex
                    const dealDelayMs = Math.min(idx, 12) * 24
                    const dealRotate = (idx % 2 === 0 ? -1 : 1) * Math.min(10, 3 + idx * 0.4)
                    return (
                      <div
                        className="task-node-image__gallery-item nodrag nopan"
                        key={`${idx}-${img.url}`}
                        style={{
                          position: 'relative',
                          padding: 0,
                          border: isPrimary ? '1px solid rgba(125, 211, 252, 0.7)' : '1px solid rgba(255,255,255,0.08)',
                          borderRadius: 8,
                          overflow: 'hidden',
                          background: mediaFallbackSurface,
                          cursor: 'default',
                          width: mediaSize,
                          height: mediaSize,
                          animation: 'tc-image-picker-deal-in 260ms cubic-bezier(.2,.9,.2,1) both',
                          animationDelay: `${dealDelayMs}ms`,
                          transformOrigin: 'center center',
                          ['--tc-image-picker-deal-rotate' as any]: `${dealRotate}deg`,
                        }}
                      >
                        <img
                          className="task-node-image__gallery-image nodrag nopan"
                          src={img.url}
                          alt={`结果 ${idx + 1}`}
                          onPointerDown={(e) => startPointerDrag(e, img.url)}
                          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                        />
                        <div
                          className="task-node-image__gallery-actions"
                          style={{
                            position: 'absolute',
                            right: 8,
                            bottom: 8,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            pointerEvents: 'none',
                          }}
                        >
                          {isPrimary && (
                            <div
                              className="task-node-image__gallery-primary-tag"
                              style={{
                                padding: '4px 8px',
                                borderRadius: 999,
                                background: 'rgba(15,23,42,0.78)',
                                border: '1px solid rgba(125, 211, 252, 0.45)',
                                color: themeWhite,
                                fontSize: 11,
                                fontWeight: 600,
                                letterSpacing: 0.2,
                              }}
                            >
                              主图
                            </div>
                          )}
                          <button
                            className="task-node-image__gallery-set-primary nodrag nopan"
                            type="button"
                            onPointerDown={(e) => {
                              e.stopPropagation()
                            }}
                            onClick={(e) => {
                              e.stopPropagation()
                              onSelectPrimary(idx, img.url)
                              setImageExpanded(false)
                            }}
                            style={{
                              pointerEvents: 'auto',
                              padding: '4px 10px',
                              borderRadius: 999,
                              border: '1px solid rgba(15,23,42,0.65)',
                              background: 'rgba(15,23,42,0.82)',
                              color: themeWhite,
                              fontSize: 11,
                              fontWeight: 600,
                              cursor: 'pointer',
                            }}
                            title="设为主图"
                          >
                            设主图
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
            <input
              className="task-node-image__file-input"
              ref={bindInputRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={async (e) => {
                const files = Array.from(e.currentTarget.files || [])
                e.currentTarget.value = ''
                if (!files.length) return
                await onUpload(files)
              }}
            />
          </div>
        </div>
      )}
      {!imageUrl && upstreamText && (
        <div
          className="task-node-image__upstream-text"
          style={{
            marginTop: 6,
            width: '100%',
            maxHeight: 80,
            borderRadius: 8,
            border: 'none',
            background: subtleOverlayBackground,
            padding: '6px 8px',
            color: mediaOverlayText,
            fontSize: 12,
            whiteSpace: 'pre-wrap',
            overflowY: 'auto',
          }}
        >
          {upstreamText}
        </div>
      )}
	      <style className="task-node-image__style">{`
	        @keyframes soft-pulse {
	          0%, 100% { opacity: 0.7; }
	          50% { opacity: 1; }
	        }
          @keyframes tc-image-picker-deal-in {
            from {
              opacity: 0;
              transform: translate3d(-18px, 12px, 0) rotate(var(--tc-image-picker-deal-rotate, -6deg)) scale(0.965);
              filter: blur(1px);
            }
            to {
              opacity: 1;
              transform: translate3d(0, 0, 0) rotate(0deg) scale(1);
              filter: blur(0);
            }
          }
          @keyframes tc-image-picker-panel-in {
            from {
              opacity: 0;
              transform: translate(-50%, -50%) scale(0.98);
            }
            to {
              opacity: 1;
              transform: translate(-50%, -50%) scale(1);
            }
          }
          @keyframes tc-image-drag-preview-in {
            from {
              opacity: 0;
              transform: translate(-50%, -50%) scale(0.96);
            }
            to {
              opacity: 1;
              transform: translate(-50%, -50%) scale(0.98);
            }
          }
	      `}</style>
	    </div>
	  )
}
