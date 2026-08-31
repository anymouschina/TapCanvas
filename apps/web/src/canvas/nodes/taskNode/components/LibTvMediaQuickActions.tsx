import React from 'react'
import {
  IconCamera,
  IconFocus2,
  IconFocusCentered,
  IconPhoto,
  IconSparkles,
  IconUser,
} from '@tabler/icons-react'

type LibTvMediaQuickActionsProps = {
  kind: 'image' | 'video'
  disabled?: boolean
  referenceActive?: boolean
  markerActive?: boolean
  onReference: () => void
  onMarker: () => void
  onStyle?: () => void
  onEffect?: () => void
  onCharacters?: () => void
  onCameraMovement?: () => void
  onFocus: () => void
}

export function LibTvMediaQuickActions({
  kind,
  disabled = false,
  referenceActive = false,
  markerActive = false,
  onReference,
  onMarker,
  onStyle,
  onEffect,
  onCharacters,
  onCameraMovement,
  onFocus,
}: LibTvMediaQuickActionsProps): JSX.Element {
  const actions = kind === 'image'
    ? [
        { key: 'reference', label: '参考', Icon: IconPhoto, onClick: onReference, active: referenceActive },
        { key: 'marker', label: '标记', Icon: IconFocusCentered, onClick: onMarker, active: markerActive },
        { key: 'style', label: '风格', Icon: IconSparkles, onClick: onStyle, active: false },
        { key: 'focus', label: '聚焦', Icon: IconFocus2, onClick: onFocus, active: false, allowWhenDisabled: true },
      ]
    : [
        { key: 'marker', label: '标记', Icon: IconFocusCentered, onClick: onMarker, active: markerActive },
        { key: 'reference', label: '参考', Icon: IconPhoto, onClick: onReference, active: referenceActive },
        { key: 'effect', label: '特效', Icon: IconSparkles, onClick: onEffect, active: false },
        { key: 'characters', label: '角色库', Icon: IconUser, onClick: onCharacters, active: false },
        { key: 'camera', label: '运镜', Icon: IconCamera, onClick: onCameraMovement, active: false },
        { key: 'focus', label: '聚焦', Icon: IconFocus2, onClick: onFocus, active: false, allowWhenDisabled: true },
      ]

  return (
    <div className="tc-libtv-media-actions" aria-label={`${kind === 'image' ? '图片' : '视频'}快捷能力`}>
      {actions.map(({ key, label, Icon, onClick, active, allowWhenDisabled }) => (
        <button
          className={`tc-libtv-media-actions__item${active ? ' tc-libtv-media-actions__item--active' : ''}`}
          type="button"
          key={key}
          disabled={(disabled && !allowWhenDisabled) || !onClick}
          aria-pressed={active}
          onClick={onClick}
        >
          <Icon className="tc-libtv-media-actions__icon" size={16} stroke={1.8} />
          <span className="tc-libtv-media-actions__label">{label}</span>
        </button>
      ))}
    </div>
  )
}
