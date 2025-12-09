import React from 'react'
import { Button } from '@mantine/core'
import { IconChevronDown, IconTexture, IconUpload, IconVideo } from '@tabler/icons-react'

type ImageResult = { url: string }

type ImageContentProps = {
  hasPrimaryImage: boolean
  imageResults: ImageResult[]
  imagePrimaryIndex: number
  primaryImageUrl: string | null
  fileRef: React.RefObject<HTMLInputElement | null>
  onUpload: (file: File) => Promise<void>
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
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={async (e) => {
                const f = e.currentTarget.files?.[0]
                if (!f) return
                await onUpload(f)
              }}
            />
          </div>
        </>
      ) : (
        <div style={{ position: 'relative', width: '100%' }}>
          {imageResults.length > 1 && (
            <div
              style={{
                position: 'absolute',
                left: 8,
                top: 8,
                width: '100%',
                borderRadius: 10,
                height: '100%',
                background: darkContentBackground,
                transform: 'translate(4px, 4px)',
                zIndex: 0,
              }}
            />
          )}
          <div
            style={{
              position: 'relative',
              borderRadius: 10,
              overflow: 'hidden',
              boxShadow: darkCardShadow,
              background: mediaFallbackSurface,
            }}
          >
            <img
              src={primaryImageUrl || imageResults[imagePrimaryIndex]?.url || ''}
              alt="主图"
              style={{
                width: '100%',
                height: 'auto',
                display: 'block',
                objectFit: 'cover',
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
              <Button
                type="button"
                variant="transparent"
                radius={0}
                size="compact-xs"
                onClick={() => setImageExpanded(true)}
                style={{
                  position: 'absolute',
                  right: 8,
                  bottom: 8,
                  padding: 0,
                  borderRadius: 0,
                  border: 'none',
                  background: 'transparent',
                  color: mediaOverlayText,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  fontSize: 11,
                }}
              >
                <span>{imageResults.length}</span>
                <IconChevronDown size={12} />
              </Button>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={async (e) => {
              const f = e.currentTarget.files?.[0]
              if (!f) return
              await onUpload(f)
            }}
          />
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
