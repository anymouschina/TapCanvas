import { ManagedImage } from '../../../../domain/resource-runtime/components/ManagedImage'
import { SkeletonVideoFrame } from './SkeletonVideoFrame'
import { MediaEmptyState, type MediaEmptyAction } from './MediaEmptyState'

type VideoNodePreviewProps = {
  src: string
  poster?: string | null
  nodeId?: string
  focused?: boolean
  posterRequestedWidth?: number
  label: string
  overview: boolean
  onEmptyAction?: (action: MediaEmptyAction) => void
}

/** Static overview shells never create a video element or bind a media source. */
export function VideoNodePreview({
  src,
  poster,
  nodeId,
  focused = false,
  posterRequestedWidth,
  label,
  overview,
  onEmptyAction,
}: VideoNodePreviewProps): JSX.Element {
  const interactive = !overview && src.length > 0
  return (
    <div
      className="tc-task-node__video-preview"
      data-video-preview-mode={interactive ? 'interactive' : poster ? 'poster' : 'placeholder'}
      style={{ position: 'absolute', inset: 0, background: '#24272e' }}
    >
      {interactive ? (
        <SkeletonVideoFrame
          key={src}
          src={src}
          poster={poster}
          nodeId={nodeId}
          focused={focused}
          posterRequestedWidth={posterRequestedWidth}
        />
      ) : poster ? (
        <ManagedImage
          className="tc-task-node__skeleton-thumb"
          src={poster}
          alt={label || '预览'}
          priority={overview ? 'prefetch' : 'visible'}
          ownerNodeId={nodeId}
          ownerSurface="task-node-skeleton"
          ownerRequestKey={nodeId ? `task-node-skeleton:${nodeId}` : undefined}
          requestedSize={posterRequestedWidth ? { width: posterRequestedWidth } : undefined}
          draggable={false}
          decoding="async"
          referrerPolicy="no-referrer"
          style={{ width: '100%', height: '100%', display: 'block', objectFit: 'contain' }}
        />
      ) : (
        <MediaEmptyState kind="video" overview={overview} onAction={onEmptyAction} />
      )}
    </div>
  )
}
