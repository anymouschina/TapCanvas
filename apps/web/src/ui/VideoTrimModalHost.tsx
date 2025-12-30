import React from 'react'
import { VideoTrimModal } from './VideoTrimModal'
import { useUIStore } from './uiStore'

export function VideoTrimModalHost(): JSX.Element | null {
  const { open, payload } = useUIStore((s) => s.videoTrimModal)
  const close = useUIStore((s) => s.closeVideoTrimModal)

  if (!open || !payload) return null

  const handleConfirm = async (range: { start: number; end: number }) => {
    try {
      await payload.onConfirm(range)
    } catch (err) {
      console.error('video trim confirm failed', err)
    } finally {
      close()
      payload.onClose?.()
    }
  }

  return (
    <VideoTrimModal
      opened={open}
      videoUrl={payload.videoUrl}
      originalDuration={payload.originalDuration}
      thumbnails={payload.thumbnails}
      loading={payload.loading}
      progressPct={payload.progressPct}
      defaultRange={payload.defaultRange}
      onClose={() => {
        payload.onClose?.()
        close()
      }}
      onConfirm={handleConfirm}
    />
  )
}
