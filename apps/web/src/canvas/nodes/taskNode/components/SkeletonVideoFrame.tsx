import React from 'react'
import { IconMovie } from '@tabler/icons-react'
import { ManagedImage } from '../../../../domain/resource-runtime/components/ManagedImage'
import { useRetainedVideoPlayback } from './useRetainedVideoPlayback'

const SkeletonVideoHoverControls = React.lazy(async () => {
  const module = await import('./SkeletonVideoHoverControls')
  return { default: module.SkeletonVideoHoverControls }
})

type SkeletonVideoFrameProps = {
  src: string
  poster?: string | null
  nodeId?: string
  focused?: boolean
  posterRequestedWidth?: number
  onNaturalSize?: (width: number, height: number) => void
}

/**
 * Lightweight video-node surface. The playback hook owns the real retained
 * media element; this component only renders its poster, host and hover UI.
 */
export function SkeletonVideoFrame({
  src,
  poster,
  nodeId,
  focused = false,
  posterRequestedWidth,
  onNaturalSize,
}: SkeletonVideoFrameProps): JSX.Element {
  const {
    videoHostRef,
    videoRef,
    surfaceRequested,
    hovering,
    manualPlayback,
    hoverPlaybackFrameVisible,
    handleEnter,
    handleLeave,
    handleManualPlayback,
  } = useRetainedVideoPlayback({ src, nodeId, focused, onNaturalSize })

  return (
    <div
      className="tc-task-node__video-frame"
      onPointerEnter={handleEnter}
      onPointerLeave={handleLeave}
      style={{ position: 'absolute', inset: 0 }}
    >
      {poster ? (
        <ManagedImage
          className="tc-task-node__skeleton-thumb"
          src={poster}
          alt="预览"
          priority="visible"
          ownerNodeId={nodeId}
          ownerSurface="task-node-skeleton"
          ownerRequestKey={nodeId ? `task-node-skeleton-video:${nodeId}` : undefined}
          requestedSize={posterRequestedWidth ? { width: posterRequestedWidth } : undefined}
          draggable={false}
          decoding="async"
          referrerPolicy="no-referrer"
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 1,
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            background: '#24272e',
            // Idle video nodes must keep the persisted keyframe visible. The
            // The retained <video> surface is revealed for active hover preview
            // or explicit user playback; otherwise a decoded black opening
            // frame would cover the real poster and make a successful node look empty.
            opacity: manualPlayback || (hovering && hoverPlaybackFrameVisible) ? 0 : 1,
            pointerEvents: 'none',
          }}
        />
      ) : (
        <div
          className="tc-task-node__video-placeholder"
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 1,
            background: '#24272e',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: manualPlayback || (hovering && hoverPlaybackFrameVisible) ? 0 : 1,
            pointerEvents: 'none',
          }}
        >
          <IconMovie className="tc-task-node__video-placeholder-icon" size={26} stroke={1.5} color="rgba(255,255,255,0.32)" />
        </div>
      )}

      {surfaceRequested ? (
        <div
          ref={videoHostRef}
          className="tc-task-node__retained-video-host"
          style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
        />
      ) : null}

      {hovering && !manualPlayback && !hoverPlaybackFrameVisible ? (
        <div
          className="tc-task-node__video-ready-badge"
          style={{ position: 'absolute', inset: 0, zIndex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}
        >
          <div className="tc-task-node__video-ready-badge-surface" style={{ width: 46, height: 46, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.46)' }}>
            <div className="tc-task-node__video-buffer-spinner" />
          </div>
        </div>
      ) : null}

      {hovering ? (
        <React.Suspense fallback={null}>
          <SkeletonVideoHoverControls videoRef={videoRef} nodeId={nodeId} onManualPlayback={handleManualPlayback} />
        </React.Suspense>
      ) : null}
    </div>
  )
}
