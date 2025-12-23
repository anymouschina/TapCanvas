import React, { useEffect } from 'react'
import { ActionIcon, Group, Paper, Title, Portal } from '@mantine/core'
import { IconX, IconDownload } from '@tabler/icons-react'
import { useUIStore } from './uiStore'
import { downloadUrl } from '../utils/download'

export default function PreviewModal(): JSX.Element | null {
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

  return (
    <Portal zIndex={400}>
      <div
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
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: 10,
          }}
        >
          <Title order={5} style={{ color: '#e5e7eb' }}>
            {name || '预览'}
          </Title>
          <Group gap={6}>
            <ActionIcon variant="light" onClick={download} title="下载">
              <IconDownload size={16} />
            </ActionIcon>
            <ActionIcon variant="light" onClick={close} title="关闭">
              <IconX size={16} />
            </ActionIcon>
          </Group>
        </div>
        <div
          style={{ display: 'grid', placeItems: 'center', padding: 12 }}
          onClick={close}
        >
          <div
            onClick={(e) => e.stopPropagation()}
          >
            {kind === 'image' && (
              <img
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
              <audio src={url} controls style={{ width: '60vw' }} />
            )}
          </div>
        </div>
      </div>
    </Portal>
  )
}
