import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { TransformWrapper, TransformComponent, useControls, useTransformEffect } from 'react-zoom-pan-pinch'
import { ActionIcon, Group, Title } from '@mantine/core'
import { IconX, IconDownload, IconZoomIn, IconZoomOut, IconRefresh } from '@tabler/icons-react'
import { useUIStore } from './uiStore'
import { toast } from './toast'
import { appendDownloadSuffix, downloadUrl } from '../utils/download'
import { useImageResource } from '../domain/resource-runtime'

const LENS_DIAMETER = 180
const MAGNIFY = 2.8
const IMAGE_PREVIEW_WHEEL_ZOOM_STEP = 0.006
const IMAGE_PREVIEW_BUTTON_ZOOM_STEP = 0.18

type MagState = {
  visible: boolean
  clientX: number
  clientY: number
  imgX: number
  imgY: number
  displayW: number
  displayH: number
}

function ZoomToolbar({ onClose }: { onClose: () => void }) {
  const { zoomIn, zoomOut, resetTransform } = useControls()
  const [pct, setPct] = useState(100)
  useTransformEffect(({ state }) => { setPct(Math.round(state.scale * 100)) })
  return (
    <div
      style={{
        position: 'absolute',
        bottom: 20,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        background: 'rgba(20,20,30,0.86)',
        backdropFilter: 'blur(14px)',
        WebkitBackdropFilter: 'blur(14px)',
        borderRadius: 999,
        padding: '3px 6px',
        border: '1px solid rgba(255,255,255,0.1)',
        boxShadow: '0 6px 22px rgba(0,0,0,0.55)',
        zIndex: 10,
        userSelect: 'none',
      }}
      onMouseDown={e => e.stopPropagation()}
      onClick={e => e.stopPropagation()}
      onWheel={e => e.stopPropagation()}
    >
      <ActionIcon variant="subtle" color="gray" size={28} onClick={() => zoomOut(IMAGE_PREVIEW_BUTTON_ZOOM_STEP)} title="缩小">
        <IconZoomOut size={14} />
      </ActionIcon>
      <span style={{ minWidth: 46, textAlign: 'center', fontSize: 11, color: '#9ca3af', fontVariantNumeric: 'tabular-nums' }}>
        {pct}%
      </span>
      <ActionIcon variant="subtle" color="gray" size={28} onClick={() => zoomIn(IMAGE_PREVIEW_BUTTON_ZOOM_STEP)} title="放大">
        <IconZoomIn size={14} />
      </ActionIcon>
      <div style={{ width: 1, height: 14, background: 'rgba(255,255,255,0.1)', margin: '0 3px' }} />
      <ActionIcon variant="subtle" color="gray" size={28} onClick={() => resetTransform()} title="重置">
        <IconRefresh size={14} />
      </ActionIcon>
      <div style={{ width: 1, height: 14, background: 'rgba(255,255,255,0.1)', margin: '0 3px' }} />
      <ActionIcon variant="subtle" color="gray" size={28} onClick={onClose} title="关闭 (Esc)">
        <IconX size={14} />
      </ActionIcon>
    </div>
  )
}

export default function PreviewModal({ className }: { className?: string }): React.ReactPortal {
  const preview = useUIStore(s => s.preview)
  const close = useUIStore(s => s.closePreview)
  const previewUrl = preview?.url ?? null
  const previewKind = preview?.kind ?? null

  const url = preview?.url ?? ''
  const kind = preview?.kind ?? 'image'
  const name = preview?.name

  const imgRef = useRef<HTMLImageElement>(null)
  const [mag, setMag] = useState<MagState>({
    visible: false, clientX: 0, clientY: 0, imgX: 0, imgY: 0, displayW: 0, displayH: 0,
  })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  useEffect(() => {
    setMag(m => ({ ...m, visible: false }))
  }, [previewUrl])

  // Document-level capture so React Flow / browser never sees wheel events while modal is open
  useEffect(() => {
    if (previewKind !== 'image') return
    const block = (e: WheelEvent) => { e.preventDefault() }
    document.addEventListener('wheel', block, { capture: true, passive: false })
    return () => document.removeEventListener('wheel', block, { capture: true })
  }, [previewKind])

  const previewImageResource = useImageResource({
    url: previewKind === 'image' ? previewUrl : null,
    kind: 'preview',
    variantKey: 'original',
    priority: 'critical',
    ownerSurface: 'preview-modal',
    ownerRequestKey: `preview-modal:${previewUrl ?? 'none'}`,
    enabled: previewKind === 'image' && Boolean(previewUrl),
  })

  const renderedSrc = previewImageResource.renderUrl || url

  const [downloading, setDownloading] = useState(false)
  const download = async () => {
    if (downloading) return
    setDownloading(true)
    try {
      await downloadUrl({
        url,
        filename: name ? appendDownloadSuffix(name, Date.now()) : `tapcanvas-${kind}-${Date.now()}`,
      })
    } catch (e) {
      toast(e instanceof Error ? e.message : '下载失败，请稍后重试', 'error')
    } finally {
      setDownloading(false)
    }
  }

  const handleImgMouseMove = (e: React.MouseEvent<HTMLImageElement>) => {
    const img = imgRef.current
    if (!img) return
    const rect = img.getBoundingClientRect()
    setMag({
      visible: true,
      clientX: e.clientX,
      clientY: e.clientY,
      imgX: e.clientX - rect.left,
      imgY: e.clientY - rect.top,
      displayW: rect.width,
      displayH: rect.height,
    })
  }

  const overlayClassName = ['preview-modal', className].filter(Boolean).join(' ')

  if (preview) {
    console.log('[preview] PreviewModal rendering with preview:', preview)
  }
  return createPortal(
    preview ? (
    <>
      {kind === 'image' && mag.visible && renderedSrc && (
            <div
              className="preview-modal-lens"
              style={{
                position: 'fixed',
                left: mag.clientX - LENS_DIAMETER / 2,
                top: mag.clientY - LENS_DIAMETER / 2,
                width: LENS_DIAMETER,
                height: LENS_DIAMETER,
                borderRadius: '50%',
                border: '2px solid rgba(255,255,255,0.72)',
                boxShadow: '0 6px 28px rgba(0,0,0,0.6), inset 0 0 0 1px rgba(255,255,255,0.1)',
                backgroundImage: `url(${renderedSrc})`,
                backgroundRepeat: 'no-repeat',
                backgroundSize: `${mag.displayW * MAGNIFY}px ${mag.displayH * MAGNIFY}px`,
                backgroundPosition: `-${mag.imgX * MAGNIFY - LENS_DIAMETER / 2}px -${mag.imgY * MAGNIFY - LENS_DIAMETER / 2}px`,
                pointerEvents: 'none',
                zIndex: 100001,
              }}
            />
          )}
          <div
            className={overlayClassName}
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,.85)',
              zIndex: 100000,
              display: 'grid',
              gridTemplateRows: 'auto 1fr',
              color: '#e5e7eb',
            }}
          >
            <div
              className="preview-modal-header"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: 10,
              }}
              onMouseEnter={() => setMag(m => ({ ...m, visible: false }))}
            >
              <Title className="preview-modal-title" order={5} style={{ color: '#e5e7eb' }}>
                {name || '预览'}
              </Title>
              <Group className="preview-modal-actions" gap={6}>
                <ActionIcon className="preview-modal-download" variant="light" loading={downloading} onClick={() => { void download() }} title="下载">
                  <IconDownload className="preview-modal-download-icon" size={16} />
                </ActionIcon>
                <ActionIcon className="preview-modal-close" variant="light" onClick={close} title="关闭">
                  <IconX className="preview-modal-close-icon" size={16} />
                </ActionIcon>
              </Group>
            </div>
            <div
              className="preview-modal-body"
              style={{ display: 'grid', placeItems: 'center', padding: 12, overflow: 'hidden' }}
              onClick={close}
            >
              <div
                className="preview-modal-content"
                onClick={e => e.stopPropagation()}
                style={{ display: 'contents' }}
              >
                {kind === 'image' && (
                  <TransformWrapper
                    minScale={0.25}
                    maxScale={10}
                    initialScale={1}
                    centerOnInit
                    wheel={{ step: IMAGE_PREVIEW_WHEEL_ZOOM_STEP }}
                    doubleClick={{ mode: 'reset' }}
                    panning={{ velocityDisabled: true }}
                  >
                    <div style={{ position: 'relative', width: '92vw', height: '82vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <TransformComponent
                        wrapperStyle={{ width: '100%', height: '100%' }}
                        contentStyle={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%' }}
                      >
                        <img
                          ref={imgRef}
                          className="preview-modal-image"
                          src={renderedSrc}
                          alt={name || 'preview'}
                          draggable={false}
                          onMouseMove={handleImgMouseMove}
                          onMouseLeave={() => setMag(m => ({ ...m, visible: false }))}
                          style={{
                            maxWidth: '100%',
                            maxHeight: '100%',
                            borderRadius: 8,
                            boxShadow: '0 12px 40px rgba(0,0,0,.45)',
                            border: '1px solid rgba(255,255,255,.12)',
                            cursor: 'none',
                            userSelect: 'none',
                            display: 'block',
                          }}
                        />
                      </TransformComponent>
                      <ZoomToolbar onClose={close} />
                    </div>
                  </TransformWrapper>
                )}
                {kind === 'video' && (
                  <video
                    className="preview-modal-video"
                    src={url}
                    controls
                    autoPlay
                    style={{
                      maxWidth: '92vw',
                      maxHeight: '82vh',
                      borderRadius: 8,
                      boxShadow: '0 12px 40px rgba(0,0,0,.45)',
                      border: '1px solid rgba(255,255,255,.12)',
                    }}
                  />
                )}
                {kind === 'audio' && (
                  <audio className="preview-modal-audio" src={url} controls style={{ width: '60vw' }} />
                )}
              </div>
            </div>
          </div>
    </>
    ) : null,
    document.body,
  )
}
