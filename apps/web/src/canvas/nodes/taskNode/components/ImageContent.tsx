import React from 'react'
import { setTapImageDragData } from '../../../dnd/setTapImageDragData'
import { useUIStore } from '../../../../ui/uiStore'

type ImageResult = { url: string }

type ImageContentProps = {
  nodeId: string
  nodeKind?: string
  nodeWidth: number
  nodeHeight: number
  variantsOpen: boolean
  variantsBaseWidth?: number | null
  variantsBaseHeight?: number | null
  hasPrimaryImage: boolean
  imageResults: ImageResult[]
  imagePrimaryIndex: number
  primaryImageUrl: string | null
  fileRef: React.RefObject<HTMLInputElement | null>
  onUpload: (files: File[]) => Promise<void>
  onSelectPrimary: (index: number, url: string) => void
  compact: boolean
  showStateOverlay: boolean
  stateLabel: string | null
  onUpdateNodeData: (patch: Record<string, any>) => void
  nodeShellText: string
  darkCardShadow: string
  mediaOverlayText: string
  subtleOverlayBackground: string
  imageUrl?: string | null
  themeWhite: string
}

export function ImageContent(props: ImageContentProps) {
  const {
    nodeId,
    nodeKind,
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
    onUpload,
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
  } = props

  const [imageError, setImageError] = React.useState(false)
  const activeImageUrl = primaryImageUrl || imageResults[imagePrimaryIndex]?.url || ''
  const isDarkUi = nodeShellText === themeWhite
  const hasVariants = imageResults.length > 1
  const isExpanded = hasVariants && !!variantsOpen

  const bindInputRef = React.useCallback(
    (el: HTMLInputElement | null) => {
      ;(fileRef as any).current = el
    },
    [fileRef],
  )

  const frameRadius = 18
  const frameBorderColor = isDarkUi
    ? 'rgba(255,255,255,0.12)'
    : 'rgba(15,23,42,0.12)'
  const frameBackground = isDarkUi
    ? 'linear-gradient(135deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))'
    : 'linear-gradient(135deg, rgba(255,255,255,0.88), rgba(255,255,255,0.72))'

  const stackedUrls = React.useMemo(() => {
    const urls: string[] = []
    const push = (value: unknown) => {
      const url = typeof value === 'string' ? value.trim() : ''
      if (!url) return
      if (urls.includes(url)) return
      urls.push(url)
    }
    push(activeImageUrl)
    imageResults.forEach((r) => push(r?.url))
    return urls.slice(0, 3)
  }, [activeImageUrl, imageResults])

  const tileWidth = variantsBaseWidth ?? nodeWidth
  const tileHeight = variantsBaseHeight ?? nodeHeight

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
    (e: React.SyntheticEvent<HTMLImageElement>) => {
      setImageError(false)
      if (variantsOpen) return
      const img = e.currentTarget
      const w0 = img.naturalWidth
      const h0 = img.naturalHeight
      if (!w0 || !h0) return
      const ratio = w0 / h0
      if (!Number.isFinite(ratio) || ratio <= 0) return

      const baseArea = Math.max(1, Math.round(nodeWidth * nodeHeight))
      const nextWidth = Math.max(110, Math.min(260, Math.round(Math.sqrt(baseArea * ratio))))
      const nextHeight = Math.max(110, Math.min(260, Math.round(Math.sqrt(baseArea / ratio))))

      if (Math.abs(nextWidth - nodeWidth) > 1 || Math.abs(nextHeight - nodeHeight) > 1) {
        onUpdateNodeData({ nodeWidth: nextWidth, nodeHeight: nextHeight })
      }
    },
    [nodeHeight, nodeWidth, onUpdateNodeData, variantsOpen],
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
          border: `1px solid ${frameBorderColor}`,
          background: frameBackground,
          backdropFilter: 'blur(18px)',
          WebkitBackdropFilter: 'blur(18px)',
          boxShadow: darkCardShadow,
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
          !isExpanded && hasVariants ? (
            <div className="task-node-image__stack" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
              {stackedUrls
                .slice(0, Math.min(3, stackedUrls.length))
                .reverse()
                .map((url, idx, arr) => {
                  const depth = arr.length - 1 - idx
                  const offset = depth * 10
                  const isTop = depth === 0
                  return (
                    <div
                      key={`${url}-${depth}`}
                      className="task-node-image__stack-layer"
                      style={{
                        position: 'absolute',
                        inset: 0,
                        transform: `translate(${offset}px, ${offset}px)`,
                        borderRadius: frameRadius,
                        overflow: 'hidden',
                        boxShadow: depth ? darkCardShadow : 'none',
                        border: depth ? `1px solid ${frameBorderColor}` : 'none',
                        background: frameBackground,
                      }}
                    >
                      <img
                        className="task-node-image__preview-image"
                        src={url}
                        alt={isTop ? '主图' : '候选'}
                        draggable={false}
                        style={{
                          width: '100%',
                          height: '100%',
                          display: 'block',
                          objectFit: 'cover',
                          opacity: isTop && imageError ? 0 : 1,
                        }}
                        onLoad={isTop ? handleMainImageLoad : undefined}
                        onError={isTop ? () => setImageError(true) : undefined}
                      />
                    </div>
                  )
                })}
            </div>
          ) : (
            <img
              className="task-node-image__preview-image"
              src={activeImageUrl}
              alt="主图"
              draggable={false}
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
          )
        ) : (
          <div
            className="task-node-image__placeholder"
            style={{
              position: 'absolute',
              inset: 10,
              borderRadius: frameRadius - 10,
              border: `1.5px dashed ${frameBorderColor}`,
              background: subtleOverlayBackground,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0 12px',
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
              {compact ? '拖拽/粘贴图片到画布' : '拖拽/粘贴图片到画布，或连接上游图片后运行'}
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

        {hasVariants && (
          <button
            className="task-node-image__variants-toggle nodrag"
            type="button"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              toggleVariants()
            }}
            title={variantsOpen ? '收起候选' : '展开候选'}
            style={{
              position: 'absolute',
              top: 10,
              right: 10,
              padding: '4px 10px',
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
            {imageResults.length}
          </button>
        )}

        {(showStateOverlay || imageError) && (
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
              {imageError ? '资源不可用' : (stateLabel || '加载中')}
            </div>
          </div>
        )}
      </div>

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
            gridTemplateColumns: `repeat(2, ${tileWidth}px)`,
          }}
        >
          <div className="task-node-image__variants-spacer" aria-hidden style={{ width: tileWidth, height: tileHeight }} />
          {imageResults
            .filter((r) => typeof r?.url === 'string' && r.url.trim())
            .filter((r) => r.url !== activeImageUrl)
            .slice(0, 12)
            .map((r) => (
              <button
                key={r.url}
                className="task-node-image__variant nodrag"
                type="button"
                draggable
                onDragStart={(evt) => {
                  evt.stopPropagation()
                  setTapImageDragData(evt, r.url)
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
                <img
                  className="task-node-image__variant-image"
                  src={r.url}
                  alt="候选"
                  draggable={false}
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                />
              </button>
            ))}
        </div>
      )}
    </div>
  )
}
