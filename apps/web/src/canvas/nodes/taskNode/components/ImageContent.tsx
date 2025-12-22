import React from 'react'
import { IconChevronRight, IconTexture, IconUpload, IconVideo } from '@tabler/icons-react'

type ImageResult = { url: string }

type ImageContentProps = {
  hasPrimaryImage: boolean
  imageResults: ImageResult[]
  imagePrimaryIndex: number
  primaryImageUrl: string | null
  fileRef: React.RefObject<HTMLInputElement | null>
  onUpload: (files: File[]) => Promise<void>
  connectToRight: (kind: string, label: string) => void
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
  fileRef,
  onUpload,
  connectToRight,
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
  const bindInputRef = React.useCallback((el: HTMLInputElement | null) => {
    ;(fileRef as any).current = el
  }, [fileRef])

  return (
    <div style={{ position: 'relative', marginTop: 6, padding: '0 6px' }}>
      {!hasPrimaryImage ? (
        <>
          <div
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
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ color: active ? quickActionIconActive : quickActionIconColor }}>{row.icon}</div>
                    <div style={{ flex: 1, color: nodeShellText, fontSize: 13 }}>{row.label}</div>
                    <div style={{ width: 12, height: 12 }} />
                  </div>
                  {active && idx === 0 && (
                    <div style={{ marginLeft: 36, marginTop: 4, color: quickActionHint, fontSize: 11 }}>图片大小不能超过30MB</div>
                  )}
                </div>
              )
            })}
            <input
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
        <div style={{ position: 'relative', width: '100%', display: 'flex', justifyContent: 'center' }}>
          <div style={{ position: 'relative', maxWidth: 300, maxHeight: 300, width: 'fit-content' }}>
            {imageResults.length > 1 && (
              <>
                <div
                  style={{
                    position: 'absolute',
                    left: 8,
                    top: 10,
                    width: '100%',
                    height: '100%',
                    borderRadius: 14,
                    background: darkContentBackground,
                    transform: 'translate(8px, 10px)',
                    opacity: 0.5,
                    zIndex: 0,
                  }}
                />
                <div
                  style={{
                    position: 'absolute',
                    left: 4,
                    top: 6,
                    width: '100%',
                    height: '100%',
                    borderRadius: 12,
                    background: darkContentBackground,
                    transform: 'translate(4px, 5px)',
                    opacity: 0.7,
                    zIndex: 0,
                  }}
                />
              </>
            )}
          <div
            style={{
              position: 'relative',
              borderRadius: 10,
              overflow: 'hidden',
              boxShadow: darkCardShadow,
              background: mediaFallbackSurface,
              display: 'inline-block',
              maxWidth: 300,
              maxHeight: 300,
            }}
          >
            <img
              src={primaryImageUrl || imageResults[imagePrimaryIndex]?.url || ''}
              alt="主图"
              style={{
                width: 'auto',
                height: 'auto',
                display: 'block',
                maxWidth: 300,
                maxHeight: 300,
                objectFit: 'contain',
              }}
            />
            {soraFileId && (
              <div
                style={{
                  position: 'absolute',
                  left: 8,
                  top: 8,
                  padding: '2px 6px',
                  borderRadius: 4,
                  background: 'rgba(34, 197, 94, 0.9)',
                  color: themeWhite,
                  fontSize: '10px',
                  fontWeight: 500,
                }}
                title={`Sora File ID: ${soraFileId}`}
              >
                ✓ Sora
              </div>
            )}
            {imageResults.length > 1 && (
              <button
                type="button"
                onClick={() => setImageExpanded(true)}
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
                  color: mediaOverlayText,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 11,
                  fontWeight: 500,
                  cursor: 'pointer',
                  outline: 'none',
                }}
              >
                <span>{imageResults.length}</span>
                <IconChevronRight size={12} />
              </button>
            )}
          </div>
          <input
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
    </div>
  )
}
