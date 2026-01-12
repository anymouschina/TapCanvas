import React from 'react'

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

export function ImageContent(props: ImageContentProps) {
  const {
    hasPrimaryImage,
    imageResults,
    imagePrimaryIndex,
    primaryImageUrl,
    fileRef,
    onUpload,
    compact,
    showStateOverlay,
    stateLabel,
    nodeShellText,
    darkCardShadow,
    mediaOverlayText,
    subtleOverlayBackground,
    imageUrl,
    themeWhite,
    upstreamText,
  } = props

  const mediaSize = 300
  const [imageError, setImageError] = React.useState(false)
  const activeImageUrl = primaryImageUrl || imageResults[imagePrimaryIndex]?.url || ''
  const isDarkUi = nodeShellText === themeWhite
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

  return (
    <div
      className="task-node-image__root"
      style={{
        position: 'relative',
        marginTop: compact ? 0 : 6,
        padding: compact ? 0 : '0 6px',
        userSelect: 'none',
        WebkitUserSelect: 'none',
      }}
    >
      <div className="task-node-image__preview" style={{ position: 'relative', width: '100%', display: 'flex', justifyContent: 'center' }}>
        <div className="task-node-image__preview-wrapper" style={{ position: 'relative', width: mediaSize, height: mediaSize, overflow: 'visible' }}>
          {hasPrimaryImage && stackedUrls.length > 1 ? (
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
                        boxShadow: darkCardShadow,
                        border: `1px solid ${frameBorderColor}`,
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
                        onError={isTop ? () => setImageError(true) : undefined}
                      />
                    </div>
                  )
                })}
            </div>
          ) : (
            <div
              className="task-node-image__glass-frame"
              style={{
                position: 'relative',
                borderRadius: frameRadius,
                overflow: 'hidden',
                boxShadow: darkCardShadow,
                width: '100%',
                height: '100%',
                border: `1px solid ${frameBorderColor}`,
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
                  onError={() => setImageError(true)}
                />
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
            </div>
          )}

          {imageResults.length > 1 && (
            <div
              className="task-node-image__count-badge"
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
                fontWeight: 600,
                pointerEvents: 'none',
              }}
              aria-hidden="true"
            >
              {imageResults.length}
            </div>
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
                  opacity: 0.8,
                  letterSpacing: 0.2,
                }}
              >
                {imageError ? '资源不可用' : (stateLabel || '加载中')}
              </div>
            </div>
          )}
        </div>
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
            userSelect: 'none',
            WebkitUserSelect: 'none',
          }}
        >
          {upstreamText}
        </div>
      )}
    </div>
  )
}
