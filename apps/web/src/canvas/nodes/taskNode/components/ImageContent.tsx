import React from 'react'
import { ActionIcon, Tooltip } from '@mantine/core'
import { IconZoomIn, IconUpload, IconPanoramaHorizontal } from '@tabler/icons-react'
import { setTapImageDragData } from '../../../dnd/setTapImageDragData'
import { useUIStore } from '../../../../ui/uiStore'
import { useRFStore } from '../../../store'
import { ManagedImage } from '../../../../domain/resource-runtime'
import { PanoramicViewer } from '../PanoramicViewer'
import type { PanoramicCameraState, PanoramicViewerHandle } from '../PanoramicViewer'
import { MediaEmptyState } from './MediaEmptyState'
import type { MediaEmptyAction } from './MediaEmptyState'

type ImageResult = {
  url: string
  title?: string
  prompt?: string
  storyboardScript?: string
  storyboardShotPrompt?: string
  storyboardDialogue?: string
  shotNo?: number
}

type ImageContentProps = {
  nodeId: string
  nodeKind?: string
  selected: boolean
  nodeWidth: number
  nodeHeight: number
  variantsOpen: boolean
  variantsBaseWidth?: number | null
  variantsBaseHeight?: number | null
  hasPrimaryImage: boolean
  imageResults: ImageResult[]
  imagePrimaryIndex: number
  primaryImageUrl: string | null
  fileRef: React.MutableRefObject<HTMLInputElement | null>
  canUpload: boolean
  uploading: boolean
  onUpload: (files: File[]) => Promise<void>
  onEmptyAction: (action: MediaEmptyAction) => void
  onSelectPrimary: (index: number, url: string) => void
  compact: boolean
  showStateOverlay: boolean
  stateLabel: string | null
  onUpdateNodeData: (patch: Record<string, unknown>) => void
  nodeShellText: string
  darkCardShadow: string
  mediaOverlayText: string
  subtleOverlayBackground: string
  imageUrl?: string | null
  themeWhite: string
  onMediaNaturalSize?: (size: { width: number; height: number; url: string }) => void
  isPanoramic?: boolean
  panoramicSphereMode?: boolean
  panoramicCamera?: PanoramicCameraState
  panoramicGridVisible?: boolean
  panoramicViewerRef?: React.RefObject<PanoramicViewerHandle>
  onPanoramicCameraChange?: (camera: PanoramicCameraState) => void
  onEnterSphereMode?: () => void
  gridSplitMode?: boolean
  gridSplitRows?: number
  gridSplitCols?: number
  gridSplitSelected?: Set<string>
  gridSplitHovered?: string | null
  onGridCellHover?: (key: string | null) => void
  onGridCellClick?: (key: string, shift: boolean) => void
  isGridSplitCell?: boolean
  rotatePreview?: { angle: number; flipH: boolean; flipV: boolean }
  onRotateDragStart?: (e: React.PointerEvent<HTMLDivElement>) => void
  isGenerating?: boolean
}

type EmptyUploadGestureState = {
  pointerId: number
  startX: number
  startY: number
  startedAt: number
  moved: boolean
}

const EMPTY_UPLOAD_CLICK_MAX_DURATION_MS = 220
const EMPTY_UPLOAD_CLICK_MAX_MOVEMENT_PX = 6

function ImageContent(props: ImageContentProps) {
  const {
    nodeId,
    nodeKind,
    selected,
    nodeWidth,
    nodeHeight,
    variantsOpen,
    variantsBaseWidth,
    variantsBaseHeight,
    hasPrimaryImage,
    imageResults,
    imagePrimaryIndex,
    primaryImageUrl,
    fileRef,
    canUpload,
    uploading,
    onUpload,
    onEmptyAction,
    onSelectPrimary,
    compact,
    showStateOverlay,
    stateLabel,
    onUpdateNodeData,
    nodeShellText,
    darkCardShadow,
    mediaOverlayText,
    subtleOverlayBackground,
    imageUrl,
    themeWhite,
    onMediaNaturalSize,
    isPanoramic,
    panoramicSphereMode,
    panoramicCamera,
    panoramicGridVisible,
    panoramicViewerRef,
    onPanoramicCameraChange,
    onEnterSphereMode,
    gridSplitMode,
    gridSplitRows,
    gridSplitCols,
    gridSplitSelected,
    gridSplitHovered,
    onGridCellHover,
    onGridCellClick,
    isGridSplitCell,
    rotatePreview,
    onRotateDragStart,
    isGenerating,
  } = props

  const [imageError, setImageError] = React.useState(false)
  const [loadedImageUrl, setLoadedImageUrl] = React.useState<string | null>(null)
  // Sticky "we've shown real pixels for this src". ManagedImage keeps the
  // previous decoded layer visible while a genuinely new src loads. This ref
  // prevents the loading overlay from blinking back on during that handoff.
  const everShownForSrcRef = React.useRef<string | null>(null)
  const validImageResults = React.useMemo(
    () => imageResults.filter((result) => typeof result?.url === 'string' && result.url.trim()),
    [imageResults],
  )
  const activeImageUrl = primaryImageUrl || validImageResults[imagePrimaryIndex]?.url || ''

  const mainImageSrc = activeImageUrl
  const hasShownPixelsForActive = everShownForSrcRef.current === activeImageUrl
  const hasLoadedCurrentImage = loadedImageUrl === activeImageUrl || hasShownPixelsForActive
  const shouldShowRuntimeImagePending = Boolean(mainImageSrc) && !hasLoadedCurrentImage && !imageError
  const variantEntries = React.useMemo(
    () => imageResults
      .map((result, index) => ({ result, index }))
      .filter(({ result }) => typeof result?.url === 'string' && result.url.trim() && result.url !== activeImageUrl),
    [activeImageUrl, imageResults],
  )
  const isDarkUi = nodeShellText === themeWhite
  const hasVariants = validImageResults.length > 1
  const isExpanded = hasVariants && !!variantsOpen
  const emptyUploadGestureRef = React.useRef<EmptyUploadGestureState | null>(null)

  const frameRadius = 12
  const imageDecoding: 'async' = 'async'
  const previewLoading: 'eager' = 'eager'
  const previewFetchPriority: 'high' | 'low' = selected ? 'high' : 'low'
  const frameBorderColor = isDarkUi
    ? 'rgba(255,255,255,0.12)'
    : 'rgba(17,18,21,0.12)'
  const frameBackground = hasPrimaryImage
    ? 'transparent'
    : 'var(--tc-node-shell-bg, #262626)'

  const tileWidth = variantsBaseWidth ?? nodeWidth
  const tileHeight = variantsBaseHeight ?? nodeHeight
  const variantColumnCount = React.useMemo(
    () => Math.max(1, Math.ceil(Math.sqrt(variantEntries.length + 1))),
    [variantEntries.length],
  )

  const toggleVariants = React.useCallback(() => {
    if (!hasVariants) return
    if (variantsOpen) {
      onUpdateNodeData({ variantsOpen: false })
      return
    }
    onUpdateNodeData({
      variantsOpen: true,
      variantsBaseWidth: Math.max(72, Math.round(nodeWidth)),
      variantsBaseHeight: Math.max(54, Math.round(nodeHeight)),
    })
  }, [hasVariants, nodeHeight, nodeWidth, onUpdateNodeData, variantsOpen])

  const handleMainImageLoad = React.useCallback(
    (event: React.SyntheticEvent<HTMLImageElement>) => {
      setImageError(false)
      setLoadedImageUrl((current) => (activeImageUrl ? activeImageUrl : current))
      const currentSrc = event.currentTarget.currentSrc || event.currentTarget.src || ''
      if (currentSrc.startsWith('data:image/gif;base64,R0lGODlhAQABA')) return
      // Real (non-placeholder) pixels are on screen for this src — record it
      // so a future internal src-swap can't transient us back into a loading
      // state while the visible <img> keeps painting valid pixels.
      if (activeImageUrl) everShownForSrcRef.current = activeImageUrl
      const naturalWidth = event.currentTarget.naturalWidth
      const naturalHeight = event.currentTarget.naturalHeight
      if (naturalWidth > 0 && naturalHeight > 0 && activeImageUrl) {
        onMediaNaturalSize?.({ width: naturalWidth, height: naturalHeight, url: activeImageUrl })
      }
    },
    [activeImageUrl, onMediaNaturalSize],
  )

  React.useEffect(() => {
    setImageError(false)
    setLoadedImageUrl((current) => (current === activeImageUrl ? current : null))
    // When activeImageUrl genuinely changes (user replaced the image, switched
    // primary variant, etc.) wipe the sticky-shown flag so the new src has to
    // earn back the no-loading state.
    if (everShownForSrcRef.current !== activeImageUrl) {
      everShownForSrcRef.current = null
    }
  }, [activeImageUrl])

  const handleOpenUploadPicker = React.useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation()
      fileRef.current?.click()
    },
    [fileRef],
  )

  const resetEmptyUploadGesture = React.useCallback(() => {
    emptyUploadGestureRef.current = null
  }, [])

  const handleEmptyPlaceholderPointerDown = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!canUpload || hasPrimaryImage || uploading || !selected) return
      if (!event.isPrimary) return
      emptyUploadGestureRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startedAt: Date.now(),
        moved: false,
      }
    },
    [canUpload, hasPrimaryImage, selected, uploading],
  )

  const handleEmptyPlaceholderPointerMove = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const gesture = emptyUploadGestureRef.current
      if (!gesture || gesture.pointerId !== event.pointerId) return
      if (gesture.moved) return
      const deltaX = event.clientX - gesture.startX
      const deltaY = event.clientY - gesture.startY
      if (Math.hypot(deltaX, deltaY) >= EMPTY_UPLOAD_CLICK_MAX_MOVEMENT_PX) {
        gesture.moved = true
      }
    },
    [],
  )

  const handleEmptyPlaceholderClick = React.useCallback(
    () => {
      if (!canUpload || hasPrimaryImage || uploading || !selected) return
      const gesture = emptyUploadGestureRef.current
      emptyUploadGestureRef.current = null
      if (!gesture) return
      const pressedForMs = Date.now() - gesture.startedAt
      if (gesture.moved || pressedForMs > EMPTY_UPLOAD_CLICK_MAX_DURATION_MS) return
      fileRef.current?.click()
    },
    [canUpload, fileRef, hasPrimaryImage, selected, uploading],
  )

  return (
    <div
      className="task-node-image__root"
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: hasVariants ? 'visible' : 'hidden',
        userSelect: 'none',
        WebkitUserSelect: 'none',
      }}
    >
      <div
        className="task-node-image__frame"
        onDoubleClick={(e) => {
          e.stopPropagation()
          if (isGridSplitCell || rotatePreview) return
          const url = (activeImageUrl || '').trim()
          if (!url) return
          const rfNode = useRFStore.getState().nodes.find((n) => n.id === nodeId) as any
          const nodeLabel = rfNode ? String(rfNode?.data?.label || '').trim() : ''
          const mediaNaturalSize = rfNode?.data?.mediaNaturalSize as { width: number; height: number } | null | undefined
          const dimStr = mediaNaturalSize ? `${mediaNaturalSize.width} × ${mediaNaturalSize.height}` : null
          const previewName = [nodeLabel, dimStr].filter(Boolean).join('  ') || undefined
          useUIStore.getState().openPreview({ url, kind: 'image', name: previewName })
        }}
        style={{
          position: 'relative',
          borderRadius: frameRadius,
          overflow: rotatePreview ? 'visible' : (!isExpanded && hasVariants ? 'visible' : 'hidden'),
          width: '100%',
          height: '100%',
          border: hasPrimaryImage ? 'none' : `1px solid ${frameBorderColor}`,
          boxShadow: hasPrimaryImage ? 'none' : darkCardShadow,
          background: rotatePreview ? '#000' : frameBackground,
          backdropFilter: 'none',
          WebkitBackdropFilter: 'none',
        }}
      >
        {hasPrimaryImage ? (
          <>
            {!isExpanded && hasVariants && (
              <div
                className="task-node-image__collapsed-blur-underlay"
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  inset: 0,
                  transform: 'translate(8px, 8px)',
                  borderRadius: frameRadius,
                  background: isDarkUi
                    ? 'linear-gradient(140deg, rgba(255,255,255,0.18), rgba(255,255,255,0.04))'
                    : 'linear-gradient(140deg, rgba(17,18,21,0.16), rgba(17,18,21,0.04))',
                  filter: 'blur(10px)',
                  opacity: 0.7,
                  pointerEvents: 'none',
                }}
              />
            )}
            {activeImageUrl ? (
              isPanoramic && panoramicSphereMode && panoramicCamera && onPanoramicCameraChange ? (
                <PanoramicViewer
                  ref={panoramicViewerRef}
                  imageUrl={activeImageUrl}
                  camera={panoramicCamera}
                  showGrid={panoramicGridVisible ?? false}
                  onCameraChange={onPanoramicCameraChange}
                />
              ) : (
                <>
                  <ManagedImage
                    className="task-node-image__preview-image"
                    src={activeImageUrl}
                    alt="主图"
                    priority={selected ? 'critical' : 'visible'}
                    ownerNodeId={nodeId}
                    ownerSurface="task-node-main-image"
                    ownerRequestKey={`task-node-main:${nodeId}`}
                    crossOrigin="anonymous"
                    draggable={false}
                    loading={previewLoading}
                    decoding={imageDecoding}
                    fetchPriority={previewFetchPriority}
                    referrerPolicy="no-referrer"
                    style={{
                      width: '100%',
                      height: '100%',
                      display: 'block',
                      opacity: imageError ? 0 : 1,
                      ...(rotatePreview ? {
                        transform: `rotate(${rotatePreview.angle}deg) scaleX(${rotatePreview.flipH ? -1 : 1}) scaleY(${rotatePreview.flipV ? -1 : 1})`,
                        transformOrigin: 'center center',
                      } : null),
                    }}
                    onLoad={handleMainImageLoad}
                    onError={() => setImageError(true)}
                  />
                  {rotatePreview && onRotateDragStart && (
                    <div
                      className="task-node-image__rotate-handle nodrag nopan"
                      onPointerDown={onRotateDragStart}
                      title="拖动旋转"
                      style={{
                        position: 'absolute',
                        bottom: 6,
                        right: 6,
                        width: 28,
                        height: 28,
                        borderRadius: 8,
                        background: 'rgba(0,0,0,0.78)',
                        border: '1px solid rgba(255,255,255,0.25)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'grab',
                        zIndex: 10,
                        color: 'rgba(255,255,255,0.88)',
                        fontSize: 15,
                        userSelect: 'none',
                        WebkitUserSelect: 'none',
                      }}
                    >
                      ↻
                    </div>
                  )}
                </>
              )
            ) : null}
          </>
        ) : !isGenerating ? (
          <div
            className="task-node-image__placeholder"
            onPointerDown={handleEmptyPlaceholderPointerDown}
            onPointerMove={handleEmptyPlaceholderPointerMove}
            onPointerCancel={resetEmptyUploadGesture}
            onClick={handleEmptyPlaceholderClick}
            style={{
              position: 'absolute',
              inset: 0,
              borderRadius: frameRadius,
              border: 'none',
              background: subtleOverlayBackground,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0 12px',
              cursor: canUpload && !uploading ? (selected ? 'pointer' : 'grab') : 'default',
            }}
          >
            <MediaEmptyState
              kind="image"
              disabled={!canUpload || uploading}
              onAction={onEmptyAction}
            />
          </div>
        ) : null}

        {/* Grid split overlay */}
        {gridSplitMode && hasPrimaryImage && gridSplitRows && gridSplitCols && (
          <div
            className="task-node-image__grid-overlay nodrag nopan"
            style={{ position: 'absolute', inset: 0, zIndex: 6, borderRadius: frameRadius, overflow: 'hidden' }}
          >
            <svg
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
            >
              {Array.from({ length: gridSplitRows - 1 }, (_, i) => {
                const y = `${((i + 1) / gridSplitRows) * 100}%`
                return <line key={`h${i}`} x1="0%" y1={y} x2="100%" y2={y} stroke="rgba(255,255,255,0.55)" strokeWidth="1" />
              })}
              {Array.from({ length: gridSplitCols - 1 }, (_, j) => {
                const x = `${((j + 1) / gridSplitCols) * 100}%`
                return <line key={`v${j}`} x1={x} y1="0%" x2={x} y2="100%" stroke="rgba(255,255,255,0.55)" strokeWidth="1" />
              })}
            </svg>
            {Array.from({ length: gridSplitRows }, (_, r) =>
              Array.from({ length: gridSplitCols }, (_, c) => {
                const key = `${r}-${c}`
                const isSelected = gridSplitSelected?.has(key) ?? false
                const isHovered = gridSplitHovered === key
                return (
                  <div
                    key={key}
                    className="task-node-image__grid-cell"
                    onMouseEnter={() => onGridCellHover?.(key)}
                    onMouseLeave={() => onGridCellHover?.(null)}
                    onClick={(e) => { e.stopPropagation(); onGridCellClick?.(key, e.shiftKey) }}
                    style={{
                      position: 'absolute',
                      left: `${(c / gridSplitCols) * 100}%`,
                      top: `${(r / gridSplitRows) * 100}%`,
                      width: `${(1 / gridSplitCols) * 100}%`,
                      height: `${(1 / gridSplitRows) * 100}%`,
                      cursor: 'pointer',
                      boxSizing: 'border-box',
                      background: isSelected
                        ? 'rgba(122,129,140,0.28)'
                        : isHovered ? 'rgba(122,129,140,0.18)' : 'transparent',
                      border: isSelected ? '2px solid rgba(150,156,166,0.9)' : 'none',
                      transition: 'background 80ms ease',
                    }}
                  >
                    {(isHovered || isSelected) && (
                      <span
                        style={{
                          position: 'absolute',
                          bottom: 5,
                          left: 5,
                          fontSize: 10,
                          fontWeight: 600,
                          color: 'rgba(255,255,255,0.9)',
                          background: 'rgba(0,0,0,0.6)',
                          borderRadius: 3,
                          padding: '1px 5px',
                          pointerEvents: 'none',
                          letterSpacing: 0.2,
                        }}
                      >
                        {r + 1}-{c + 1}
                      </span>
                    )}
                  </div>
                )
              })
            )}
            {/* Shift hint — shown after first selection */}
            {(gridSplitSelected?.size ?? 0) === 1 && gridSplitHovered && (
              <div
                style={{
                  position: 'absolute',
                  bottom: 10,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  background: 'rgba(0,0,0,0.72)',
                  color: 'rgba(255,255,255,0.92)',
                  fontSize: 11,
                  borderRadius: 6,
                  padding: '5px 10px',
                  pointerEvents: 'none',
                  whiteSpace: 'nowrap',
                  fontWeight: 500,
                }}
              >
                按住 Shift 键可批量选择
              </div>
            )}
          </div>
        )}

        {isPanoramic && hasPrimaryImage && !isExpanded && (
          <div className="task-node-image__badge-row" style={{ position: 'absolute', top: 10, left: 10, zIndex: 8 }}>
            <div
              className="task-node-image__badge"
              style={{
                padding: '4px 10px',
                borderRadius: 999,
                background: 'rgba(122,129,140,0.85)',
                color: '#fff',
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: 0.2,
                boxShadow: '0 10px 20px rgba(0,0,0,0.25)',
              }}
            >
              720°全景
            </div>
          </div>
        )}

        {nodeKind === 'imageFission' && !isExpanded && (
          <div className="task-node-image__badge-row" style={{ position: 'absolute', top: 10, left: 10, zIndex: 8 }}>
            <div
              className="task-node-image__badge"
              style={{
                padding: '4px 10px',
                borderRadius: 999,
                background: 'rgba(14,165,233,0.85)',
                color: '#fff',
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: 0.2,
                boxShadow: '0 10px 20px rgba(0,0,0,0.25)',
              }}
            >
              裂变
            </div>
          </div>
        )}

        {isExpanded && hasPrimaryImage && (
          <div className="task-node-image__badge-row" style={{ position: 'absolute', top: 10, left: 10, zIndex: 8 }}>
            <div
              className="task-node-image__badge"
              style={{
                padding: '4px 10px',
                borderRadius: 999,
                background: 'rgba(122,129,140,0.85)',
                color: '#fff',
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: 0.2,
                boxShadow: '0 10px 20px rgba(0,0,0,0.25)',
              }}
            >
              主图
            </div>
          </div>
        )}

        {(canUpload || hasVariants || hasPrimaryImage) && (
          <div
            className="task-node-image__top-actions"
            style={{
              position: 'absolute',
              top: 10,
              right: 10,
              zIndex: 10,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            {hasPrimaryImage && !isPanoramic && !isGridSplitCell && !gridSplitMode && (
              <Tooltip label="放大查看" position="left" withArrow>
                <ActionIcon
                  className="task-node-image__zoom-trigger nodrag nopan"
                  variant="light"
                  color="gray"
                  radius={8}
                  size={26}
                  onMouseDown={(event) => event.stopPropagation()}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation()
                    event.preventDefault()
                    const url = (activeImageUrl || '').trim()
                    if (!url) return
                    const rfNode = useRFStore.getState().nodes.find((n) => n.id === nodeId) as any
                    const nodeLabel = rfNode ? String(rfNode?.data?.label || '').trim() : ''
                    const mediaNaturalSize = rfNode?.data?.mediaNaturalSize as { width: number; height: number } | null | undefined
                    const dimStr = mediaNaturalSize ? `${mediaNaturalSize.width} × ${mediaNaturalSize.height}` : null
                    const previewName = [nodeLabel, dimStr].filter(Boolean).join('  ') || undefined
                    useUIStore.getState().openPreview({ url, kind: 'image', name: previewName })
                  }}
                  aria-label="放大查看"
                >
                  <IconZoomIn size={14} stroke={1.9} />
                </ActionIcon>
              </Tooltip>
            )}
            {isPanoramic && !panoramicSphereMode && onEnterSphereMode && (
              <button
                className="task-node-image__sphere-trigger nodrag"
                type="button"
                onMouseDown={(event) => event.stopPropagation()}
                onClick={(event) => { event.stopPropagation(); onEnterSphereMode() }}
                title="球形预览"
                aria-label="球形预览"
                style={{
                  width: 26,
                  height: 26,
                  padding: 0,
                  borderRadius: 8,
                  border: `1px solid ${frameBorderColor}`,
                  background: isDarkUi ? 'rgba(0,0,0,0.72)' : 'rgba(255,255,255,0.92)',
                  color: mediaOverlayText,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  boxShadow: '0 8px 18px rgba(0,0,0,0.16)',
                }}
              >
                <IconPanoramaHorizontal size={13} stroke={1.9} />
              </button>
            )}
            {!isPanoramic && !isGridSplitCell && !gridSplitMode && canUpload && (
              <button
                className="task-node-image__upload-trigger nodrag"
                type="button"
                onMouseDown={(event) => event.stopPropagation()}
                onClick={handleOpenUploadPicker}
                disabled={uploading}
                title={hasPrimaryImage ? '替换/上传图片' : '上传图片'}
                aria-label={hasPrimaryImage ? '替换/上传图片' : '上传图片'}
                style={{
                  width: 26,
                  height: 26,
                  padding: 0,
                  borderRadius: 8,
                  border: `1px solid ${frameBorderColor}`,
                  background: isDarkUi ? 'rgba(0,0,0,0.72)' : 'rgba(255,255,255,0.92)',
                  color: mediaOverlayText,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: uploading ? 'progress' : 'pointer',
                  boxShadow: uploading ? '0 0 0 2px rgba(122,129,140,0.28)' : '0 8px 18px rgba(0,0,0,0.16)',
                  opacity: uploading ? 0.78 : 1,
                }}
              >
                <IconUpload size={13} stroke={1.9} />
              </button>
            )}
            {hasVariants && (
              <button
                className="task-node-image__variants-toggle nodrag"
                type="button"
                onMouseDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation()
                  toggleVariants()
                }}
                title={variantsOpen ? '收起候选' : '展开候选'}
                style={{
                  minWidth: 26,
                  height: 26,
                  padding: '0 8px',
                  borderRadius: 999,
                  border: `1px solid ${frameBorderColor}`,
                  background: isDarkUi ? 'rgba(0,0,0,0.72)' : 'rgba(255,255,255,0.92)',
                  color: mediaOverlayText,
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: 'pointer',
                  boxShadow: variantsOpen ? '0 0 0 2px rgba(122,129,140,0.35)' : undefined,
                }}
              >
                {variantEntries.length}
              </button>
            )}
          </div>
        )}

        {/*
          Runtime loading skeleton intentionally suppressed. ManagedImage's
          chain-layer model already shows old pixels while new buckets load,
          and a "loading"-styled overlay frequently lingered due to subtle
          race conditions between ManagedImage's internal src swaps and
          ImageContent's onLoad tracking. Only overlay for explicit owner
          states (upload-in-progress / expired) or hard onError.
        */}
        {(showStateOverlay || imageError) && (
          <div
            className="task-node-image__overlay"
            style={{
              position: 'absolute',
              inset: 0,
              borderRadius: frameRadius,
              background: 'rgba(10,12,20,0.72)',
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
                opacity: 0.85,
                letterSpacing: 0.2,
              }}
            >
              {imageError ? '资源不可用' : stateLabel || ''}
            </div>
          </div>
        )}
      </div>

      <input
        className="task-node-image__file-input"
        ref={fileRef}
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

      {isExpanded && hasVariants && (
        <div
          className="task-node-image__variants-grid"
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            zIndex: 20,
            display: 'grid',
            gap: 12,
            pointerEvents: 'none',
            gridTemplateColumns: `repeat(${variantColumnCount}, ${tileWidth}px)`,
          }}
        >
          <div className="task-node-image__variants-spacer" aria-hidden style={{ width: tileWidth, height: tileHeight }} />
          {variantEntries.map(({ result: r, index }) => (
            (() => {
              return (
              <button
                key={r.url}
                className="task-node-image__variant nodrag"
                type="button"
                draggable
                onDragStart={(evt) => {
                  evt.stopPropagation()
                  setTapImageDragData(evt, r.url, {
                    ...(r.title ? { label: r.title } : null),
                    ...(r.prompt ? { prompt: r.prompt } : null),
                    ...(r.storyboardScript ? { storyboardScript: r.storyboardScript } : null),
                    ...(r.storyboardShotPrompt ? { storyboardShotPrompt: r.storyboardShotPrompt } : null),
                    ...(r.storyboardDialogue ? { storyboardDialogue: r.storyboardDialogue } : null),
                    sourceKind: nodeKind,
                    sourceNodeId: nodeId,
                    sourceIndex: index,
                    ...(typeof r.shotNo === 'number' ? { shotNo: r.shotNo } : null),
                  })
                }}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation()
                  if (r.url) {
                    const idx = imageResults.findIndex((it) => it?.url === r.url)
                    onSelectPrimary(idx >= 0 ? idx : 0, r.url)
                  }
                  onUpdateNodeData({ variantsOpen: false })
                }}
                title="设为主图 / 拖拽生成新节点"
                style={{
                  position: 'relative',
                  width: tileWidth,
                  height: tileHeight,
                  borderRadius: frameRadius,
                  overflow: 'hidden',
                  border: `1px solid ${frameBorderColor}`,
                  background: frameBackground,
                  boxShadow: darkCardShadow,
                  pointerEvents: 'auto',
                  cursor: 'grab',
                }}
              >
                <ManagedImage
                  className="task-node-image__variant-image"
                  src={r.url}
                  alt="候选"
                  priority="prefetch"
                  ownerNodeId={nodeId}
                  ownerSurface="task-node-candidate"
                  ownerRequestKey={`task-node-variant:${nodeId}:${index}`}
                  crossOrigin="anonymous"
                  style={{ width: '100%', height: '100%', display: 'block', objectFit: 'contain' }}
                />
              </button>
              )
            })()
          ))}
        </div>
      )}
    </div>
  )
}

const _ImageContent = React.memo(ImageContent)
export { _ImageContent as ImageContent }
