import React from 'react'
import {
  IconPhoto,
  IconPhotoPlus,
  IconPlayerPlayFilled,
  IconSparkles,
  IconStack2,
} from '@tabler/icons-react'

export type MediaEmptyAction =
  | 'image-to-image'
  | 'image-upscale'
  | 'long-video'
  | 'first-last-frame-video'
  | 'first-frame-video'

type MediaEmptyStateProps = {
  kind: 'image' | 'video'
  overview?: boolean
  disabled?: boolean
  stopNodePropagation?: boolean
  onAction?: (action: MediaEmptyAction) => void
}

const IMAGE_ACTIONS = [
  { action: 'image-to-image' as const, label: '图生图', Icon: IconPhotoPlus },
  { action: 'image-upscale' as const, label: '图片高清', Icon: IconSparkles },
]

const VIDEO_ACTIONS = [
  { action: 'long-video' as const, label: '5分钟超长视频', Icon: IconPlayerPlayFilled },
  { action: 'first-last-frame-video' as const, label: '首尾帧生成视频', Icon: IconStack2 },
  { action: 'first-frame-video' as const, label: '首帧生成视频', Icon: IconSparkles },
]

export function MediaEmptyState({
  kind,
  overview = false,
  disabled = false,
  stopNodePropagation = true,
  onAction,
}: MediaEmptyStateProps): JSX.Element {
  const actions = kind === 'image' ? IMAGE_ACTIONS : VIDEO_ACTIONS
  const EmptyIcon = kind === 'image' ? IconPhoto : IconPlayerPlayFilled

  return (
    <div
      className={`tc-media-empty tc-media-empty--${kind}${overview ? ' tc-media-empty--overview' : ''}`}
      data-media-empty-kind={kind}
    >
      <div className="tc-media-empty__hero" aria-hidden="true">
        <EmptyIcon className="tc-media-empty__hero-icon" stroke={kind === 'image' ? 1.45 : 0} />
      </div>
      {!overview ? (
        <div className="tc-media-empty__attempts">
          <span className="tc-media-empty__attempts-label">尝试：</span>
          <div className="tc-media-empty__attempt-list">
            {actions.map(({ action, label, Icon }) => (
              <button
                className="tc-media-empty__attempt"
                type="button"
                key={action}
                disabled={disabled}
                onPointerDown={(event) => {
                  if (stopNodePropagation) event.stopPropagation()
                }}
                onClick={(event) => {
                  if (stopNodePropagation) event.stopPropagation()
                  onAction?.(action)
                }}
              >
                <Icon className="tc-media-empty__attempt-icon" size={16} stroke={1.8} />
                <span className="tc-media-empty__attempt-label">{label}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
