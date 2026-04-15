import React from 'react'
import { ActionIcon, Tooltip } from '@mantine/core'
import { IconCheck } from '@tabler/icons-react'
import { IconUpload } from '@tabler/icons-react'
import { setTapImageDragData } from '../../../dnd/setTapImageDragData'
import { useUIStore } from '../../../../ui/uiStore'
import { ManagedImage } from '../../../../domain/resource-runtime'

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
  onSelectPrimary: (index: number, url: string) => void
  onAdoptImage: (index: number) => void
  adoptedImageIndex: number | null
  isPrimaryImageAdopted: boolean
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
  imageEditPreview?: {
    label: string
    width: number
    height: number
  } | null
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

export function ImageContent(props: ImageContentProps) {
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
    onSelectPrimary,
    onAdoptImage,
    adoptedImageIndex,
    isPrimaryImageAdopted,
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
    imageEditPreview,
  } = props

  const [imageError, setImageError] = React.useState(false)
  const [loadedImageUrl, setLoadedImageUrl] = React.useState<string | null>(null)
  const validImageResults = React.useMemo(
    () => imageResults.filter((result) => typeof result?.url === 'string' && result.url.trim()),
    [imageResults],
  )
  const activeImageUrl = primaryImageUrl || validImageResults[imagePrimaryIndex]?.url || ''
  const mainImageSrc = activeImageUrl
  const hasLoadedCurrentImage = loadedImageUrl === activeImageUrl
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

  const frameRadius = 18
  const imageDecoding: 'async' = 'async'
  const previewLoading: 'eager' = 'eager'
  const previewFetchPriority: 'high' | 'low' = selected ? 'high' : 'low'
  const bindMainImageRef = React.useCallback(
    (node: HTMLImageElement | null) => {
      if (!node) return
      node.setAttribute('fetchpriority', previewFetchPriority)
    },
    [previewFetchPriority],
  )
  const frameBorderColor = isDarkUi
    ? 'rgba(255,255,255,0.12)'
    : 'rgba(15,23,42,0.12)'
  const frameBorderWidth = hasPrimaryImage ? 1 : 1.5
  const frameBorderStyle = hasPrimaryImage ? 'solid' : 'dashed'
  const frameBackground = isDarkUi
    ? 'linear-gradient(135deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))'
    : 'linear-gradient(135deg, rgba(255,255,255,0.88), rgba(255,255,255,0.72))'

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
    (_e: React.SyntheticEvent<HTMLImageElement>) => {
      setImageError(false)
      setLoadedImageUrl((current) => (activeImageUrl ? activeImageUrl : current))
    },
    [activeImageUrl],
  )

  React.useEffect(() => {
    setImageError(false)
    setLoadedImageUrl((current) => (current === activeImageUrl ? current : null))
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
        width: nodeWidth,
        height: nodeHeight,
        overflow: hasVariants ? 'visible' : 'hidden',
        userSelect: 'none',
        WebkitUserSelect: 'none',
      }}
    >
      <div
        className="task-node-image__frame"
        onDoubleClick={(e) => {
          e.stopPropagation()
          const url = (activeImageUrl || '').trim()
          if (!url) return
          useUIStore.getState().openPreview({ url, kind: 'image' })
        }}
        style={{
          position: 'relative',
          borderRadius: frameRadius,
          overflow: !isExpanded && hasVariants ? 'visible' : 'hidden',
          width: '100%',
          height: '100%',
          border: `${frameBorderWidth}px ${frameBorderStyle} ${frameBorderColor}`,
          boxShadow: isPrimaryImageAdopted
            ? `0 0 0 2px rgba(220,38,38,0.92), ${darkCardShadow}`
            : darkCardShadow,
          background: frameBackground,
          backdropFilter: 'blur(18px)',
          WebkitBackdropFilter: 'blur(18px)',
        }}
      >
        <div
          className="task-node-image__glass-sheen"
          style={{
            position: 'absolute',
            inset: 0,
            background: 'linear-gradient(135deg, rgba(255,255,255,0.12), rgba(255,255,255,0.02), rgba(255,255,255,0.10))',
            opacity: isDarkUi ? 0.18 : 0.12,
            pointerEvents: 'none',
          }}
          aria-hidden="true"
        />

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
                    : 'linear-gradient(140deg, rgba(15,23,42,0.16), rgba(15,23,42,0.04))',
                  filter: 'blur(10px)',
                  opacity: 0.7,
                  pointerEvents: 'none',
                }}
              />
            )}
            {mainImageSrc ? (
              <img
                ref={bindMainImageRef}
                className="task-node-image__preview-image"
                src={mainImageSrc}
                alt="主图"
                draggable={false}
                loading={previewLoading}
                decoding={imageDecoding}
                referrerPolicy="no-referrer"
                style={{
                  width: '100%',
                  height: '100%',
                  display: 'block',
                  objectFit: 'cover',
                  opacity: imageError ? 0 : 1,
                }}
                onLoad={handleMainImageLoad}
                onError={() => setImageError(true)}
              />
            ) : null}
          </>
        ) : (
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
            <div
              className="task-node-image__placeholder-text"
              style={{
                fontSize: 12,
                color: mediaOverlayText,
                opacity: 0.78,
                letterSpacing: 0.2,
                textAlign: 'center',
              }}
            >
              {selected
                ? (compact ? '单击上传，或拖拽/粘贴图片' : '单击上传，或拖拽/粘贴图片到画布')
                : (compact ? '单击聚焦，聚焦后上传' : '单击聚焦，聚焦后上传，或拖拽/粘贴图片到画布')}
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

        {imageEditPreview && !isExpanded && (
          <div
            className="task-node-image__edit-size-preview"
            style={{
              position: 'absolute',
              right: 10,
              bottom: 10,
              zIndex: 9,
              width: 84,
              padding: 6,
              borderRadius: 12,
              background: 'rgba(8,12,20,0.72)',
              border: '1px solid rgba(255,255,255,0.14)',
              boxShadow: '0 10px 24px rgba(0,0,0,0.28)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
            }}
          >
            <div
              className="task-node-image__edit-size-preview-title"
              style={{
                fontSize: 10,
                lineHeight: 1.2,
                color: 'rgba(255,255,255,0.78)',
                marginBottom: 6,
                letterSpacing: 0.2,
              }}
            >
              预览 · {imageEditPreview.label}
            </div>
            <div
              className="task-node-image__edit-size-preview-frame"
              style={{
                width: '100%',
                aspectRatio: `${imageEditPreview.width} / ${imageEditPreview.height}`,
                borderRadius: 10,
                overflow: 'hidden',
                background: '#000',
                border: '1px solid rgba(255,255,255,0.1)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {activeImageUrl ? (
                <ManagedImage
                  className="task-node-image__edit-size-preview-image"
                  src={activeImageUrl}
                  alt={imageEditPreview.label}
                  kind="preview"
                  variantKey="preview"
                  priority={selected ? 'visible' : 'prefetch'}
                  ownerNodeId={nodeId}
                  ownerSurface="task-node-main-image"
                  ownerRequestKey={`task-node-edit-preview:${nodeId}`}
                  draggable={false}
                  loading="lazy"
                  decoding={imageDecoding}
                  fetchPriority="low"
                  referrerPolicy="no-referrer"
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'contain',
                    display: 'block',
                  }}
                />
              ) : (
                <div
                  className="task-node-image__edit-size-preview-empty"
                  style={{
                    fontSize: 9,
                    color: 'rgba(255,255,255,0.46)',
                    textAlign: 'center',
                    padding: 6,
                  }}
                >
                  将按目标尺寸留边
                </div>
              )}
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
                background: 'rgba(59,130,246,0.85)',
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

        {(canUpload || hasVariants) && (
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
            {hasPrimaryImage && (
              <Tooltip label={isPrimaryImageAdopted ? '当前主图已采纳' : '采纳当前主图'} position="left" withArrow>
                <ActionIcon
                  className="task-node-image__adopt-trigger nodrag"
                  variant={isPrimaryImageAdopted ? 'filled' : 'light'}
                  color="red"
                  radius={8}
                  size={26}
                  onMouseDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation()
                    onAdoptImage(imagePrimaryIndex)
                  }}
                  aria-label={isPrimaryImageAdopted ? '当前主图已采纳' : '采纳当前主图'}
                >
                  <IconCheck size={14} stroke={2.1} />
                </ActionIcon>
              </Tooltip>
            )}
            {canUpload && (
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
                  background: isDarkUi ? 'rgba(0,0,0,0.36)' : 'rgba(255,255,255,0.66)',
                  backdropFilter: 'blur(14px)',
                  WebkitBackdropFilter: 'blur(14px)',
                  color: mediaOverlayText,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: uploading ? 'progress' : 'pointer',
                  boxShadow: uploading ? '0 0 0 2px rgba(59,130,246,0.28)' : '0 8px 18px rgba(0,0,0,0.16)',
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
                  background: isDarkUi ? 'rgba(0,0,0,0.28)' : 'rgba(255,255,255,0.55)',
                  backdropFilter: 'blur(14px)',
                  WebkitBackdropFilter: 'blur(14px)',
                  color: mediaOverlayText,
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: 'pointer',
                  boxShadow: variantsOpen ? '0 0 0 2px rgba(59,130,246,0.35)' : undefined,
                }}
              >
                {variantEntries.length}
              </button>
            )}
          </div>
        )}

        {(showStateOverlay || imageError || shouldShowRuntimeImagePending) && (
          <div
            className="task-node-image__overlay"
            style={{
              position: 'absolute',
              inset: 0,
              borderRadius: frameRadius,
              background: 'rgba(255,255,255,0.10)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
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
              {imageError
                ? '资源不可用'
                : stateLabel || '加载中'}
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
              const isAdopted = adoptedImageIndex !== null && adoptedImageIndex === index
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
                  boxShadow: isAdopted
                    ? `0 0 0 2px rgba(220,38,38,0.92), ${darkCardShadow}`
                    : darkCardShadow,
                  pointerEvents: 'auto',
                  cursor: 'grab',
                }}
              >
                <div
                  className="task-node-image__variant-actions"
                  style={{
                    position: 'absolute',
                    top: 8,
                    right: 8,
                    zIndex: 2,
                    display: 'flex',
                    gap: 6,
                  }}
                >
                  <Tooltip label={isAdopted ? '该图片已采纳' : '采纳该图片'} position="left" withArrow>
                    <ActionIcon
                      className="task-node-image__variant-adopt nodrag"
                      variant={isAdopted ? 'filled' : 'light'}
                      color="red"
                      radius={8}
                      size={24}
                      onMouseDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation()
                        onAdoptImage(index)
                      }}
                      aria-label={isAdopted ? '该图片已采纳' : '采纳该图片'}
                    >
                      <IconCheck size={13} stroke={2.1} />
                    </ActionIcon>
                  </Tooltip>
                </div>
                <ManagedImage
                  className="task-node-image__variant-image"
                  src={r.url}
                  alt="候选"
                  kind="thumbnail"
                  variantKey="thumbnail"
                  priority={selected ? 'prefetch' : 'background'}
                  ownerNodeId={nodeId}
                  ownerSurface="task-node-candidate"
                  ownerRequestKey={`task-node-candidate:${nodeId}:${index}`}
                  draggable={false}
                  loading="lazy"
                  decoding={imageDecoding}
                  fetchPriority="low"
                  referrerPolicy="no-referrer"
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
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
