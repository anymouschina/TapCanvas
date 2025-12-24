import React, { useEffect } from 'react'
import { ActionIcon, Group, Paper, Title, Portal } from '@mantine/core'
import { IconX, IconDownload } from '@tabler/icons-react'
import { useUIStore } from './uiStore'
import { downloadUrl } from '../utils/download'

export default function PreviewModal({ className }: { className?: string }): JSX.Element | null {
  const preview = useUIStore(s => s.preview)
  const close = useUIStore(s => s.closePreview)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  if (!preview) return null
  const { url, kind, name } = preview
  const download = () => {
    void downloadUrl({
      url,
      filename: name || `tapcanvas-${kind}-${Date.now()}`,
      preferBlob: true,
      fallbackTarget: '_blank',
    })
  }

  const overlayClassName = ['preview-modal', className].filter(Boolean).join(' ')

  return (
    <Portal className="preview-modal-portal" zIndex={400}>
      <div
        className={overlayClassName}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,.85)',
          zIndex: 9999,
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
        >
          <Title className="preview-modal-title" order={5} style={{ color: '#e5e7eb' }}>
            {name || '预览'}
          </Title>
          <Group className="preview-modal-actions" gap={6}>
            <ActionIcon className="preview-modal-download" variant="light" onClick={download} title="下载">
              <IconDownload className="preview-modal-download-icon" size={16} />
            </ActionIcon>
            <ActionIcon className="preview-modal-close" variant="light" onClick={close} title="关闭">
              <IconX className="preview-modal-close-icon" size={16} />
            </ActionIcon>
          </Group>
        </div>
        <div
          className="preview-modal-body"
          style={{ display: 'grid', placeItems: 'center', padding: 12 }}
          onClick={close}
        >
          <div
            className="preview-modal-content"
            onClick={(e) => e.stopPropagation()}
          >
            {kind === 'image' && (
              <img
                className="preview-modal-image"
                src={url}
                alt={name || 'preview'}
                style={{
                  maxWidth: '92vw',
                  maxHeight: '82vh',
                  borderRadius: 8,
                  boxShadow: '0 12px 40px rgba(0,0,0,.45)',
                  border: '1px solid rgba(255,255,255,.12)',
                }}
              />
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
    </Portal>
  )
}
