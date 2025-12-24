import React from 'react'
import { IconChevronRight, IconTexture, IconUpload, IconVideo } from '@tabler/icons-react'

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
  const [imageError, setImageError] = React.useState(false)
  const activeImageUrl = primaryImageUrl || imageResults[imagePrimaryIndex]?.url || ''
  const bindInputRef = React.useCallback((el: HTMLInputElement | null) => {
    ;(fileRef as any).current = el
  }, [fileRef])

  React.useEffect(() => {
    setImageError(false)
  }, [activeImageUrl])

  return (
    <div
      className="task-node-image__root"
      style={{ position: 'relative', marginTop: compact ? 0 : 6, padding: compact ? 0 : '0 6px' }}
    >
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
              {imageResults.length > 1 && (
                <button
                  className="task-node-image__count-toggle"
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation()
                    setImageExpanded(!imageExpanded)
                  }}
                  style={{
                    position: 'absolute',
                    right: 12,
                    top: 12,
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
                  <span className="task-node-image__count-text">{imageResults.length}</span>
                  <IconChevronRight className="task-node-image__count-icon" size={12} />
                </button>
              )}
            </div>
            {imageResults.length > 1 && imageExpanded && (
              <div
                className="task-node-image__gallery"
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 'calc(100% + 12px)',
                  width: 240,
                  background: darkContentBackground,
                  borderRadius: 12,
                  boxShadow: '0 18px 36px rgba(0,0,0,0.45)',
                  padding: 10,
                  zIndex: 3,
                  border: '1px solid rgba(255,255,255,0.08)',
                }}
              >
                <div
                  className="task-node-image__gallery-grid"
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                    gap: 8,
                    maxHeight: 260,
                    overflowY: 'auto',
                  }}
                >
                  {imageResults.map((img, idx) => {
                    const isPrimary = idx === imagePrimaryIndex
                    return (
                      <button
                        className="task-node-image__gallery-item"
                        key={`${idx}-${img.url}`}
                        type="button"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation()
                          onSelectPrimary(idx, img.url)
                          setImageExpanded(false)
                        }}
                        style={{
                          padding: 0,
                          border: isPrimary ? '1px solid rgba(125, 211, 252, 0.7)' : '1px solid rgba(255,255,255,0.08)',
                          borderRadius: 8,
                          overflow: 'hidden',
                          background: mediaFallbackSurface,
                          cursor: 'pointer',
                        }}
                        title={isPrimary ? '主图' : '设为主图'}
                      >
                        <img
                          className="task-node-image__gallery-image"
                          src={img.url}
                          alt={`结果 ${idx + 1}`}
                          style={{ width: '100%', height: 96, objectFit: 'cover', display: 'block' }}
                        />
                      </button>
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
      `}</style>
    </div>
  )
}
