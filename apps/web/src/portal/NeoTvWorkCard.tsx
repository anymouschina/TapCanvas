import React from 'react'
import { IconEye, IconHeart, IconHeartFilled, IconPlayerPlay } from '@tabler/icons-react'
import type { PublicAssetDto } from '../api/server'
import { ManagedImage } from '../domain/resource-runtime/components/ManagedImage'
import { spaNavigate } from '../utils/spaNavigate'
import { createMediaPlaybackRequestController } from '../utils/mediaPlayback'
import { buildPublicCreativeProcessPath } from './publicCreativeProcess'

type NeoTvWorkCardProps = {
  asset: PublicAssetDto
  onPreview: (asset: PublicAssetDto) => void
  favoriteBusy: boolean
  onToggleFavorite: (asset: PublicAssetDto) => void
}

export function NeoTvWorkCard({ asset, onPreview, favoriteBusy, onToggleFavorite }: NeoTvWorkCardProps): JSX.Element {
  const [hovering, setHovering] = React.useState(false)
  const [previewError, setPreviewError] = React.useState('')
  const videoRef = React.useRef<HTMLVideoElement | null>(null)
  const playbackController = React.useMemo(() => createMediaPlaybackRequestController(), [])
  const thumbnail = asset.thumbnailUrl?.trim() || ''
  const hasProject = Boolean(asset.sourceProjectId?.trim() || asset.projectId?.trim())
  const creativeProcessPath = buildPublicCreativeProcessPath(asset)
  const canViewProcess = Boolean(creativeProcessPath)
  const canFavorite = canViewProcess

  const preview = (): void => onPreview(asset)

  React.useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (hovering) {
      setPreviewError('')
      void playbackController.play(video).then((result) => {
        if (result.status !== 'failed') return
        const { error } = result
        setPreviewError(error instanceof Error && error.message.trim() ? error.message : '预览播放失败')
      })
      return
    }
    video.pause()
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) video.currentTime = Math.min(0.2, video.duration || 0.2)
  }, [hovering, playbackController])

  React.useEffect(() => {
    const video = videoRef.current
    return () => {
      playbackController.cancelPending()
      video?.pause()
    }
  }, [playbackController])

  return (
    <article
      className={`neo-tv-work-card${hovering ? ' is-hovering' : ''}`}
      role="button"
      tabIndex={0}
      aria-label={`预览 ${asset.name}`}
      onClick={preview}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          preview()
        }
      }}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => {
        playbackController.cancelPending()
        const video = videoRef.current
        if (video) video.pause()
        setHovering(false)
      }}
    >
      <div className="neo-tv-work-card__media">
        {thumbnail ? (
          <ManagedImage
            className="neo-tv-work-card__thumbnail"
            src={thumbnail}
            alt={asset.name}
            priority="visible"
          />
        ) : null}
        {hovering || !thumbnail ? (
          <video
            ref={videoRef}
            className="neo-tv-work-card__video"
            src={asset.url}
            muted
            loop
            playsInline
            preload="metadata"
            onLoadedData={(event) => {
              if (!hovering) event.currentTarget.currentTime = Math.min(0.2, event.currentTarget.duration || 0.2)
            }}
            onError={(event) => {
              const mediaError = event.currentTarget.error
              setPreviewError(mediaError?.message?.trim() || `预览加载失败${mediaError?.code ? `（错误码 ${mediaError.code}）` : ''}`)
            }}
          />
        ) : null}
        {previewError ? <span className="neo-tv-work-card__preview-error" role="alert">{previewError}</span> : null}
        <span className="neo-tv-work-card__play" aria-hidden="true">
          <IconPlayerPlay className="neo-tv-work-card__play-icon" size={22} fill="currentColor" />
        </span>
        <span className="neo-tv-work-card__kind">
          {asset.sourceOwnerType === 'chapter' ? '章节' : asset.canvasPublic || hasProject ? '项目' : '短片'}
        </span>
        {canViewProcess ? (
          <button
            className="neo-tv-work-card__process"
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              if (creativeProcessPath) spaNavigate(creativeProcessPath)
            }}
          >
            <IconEye className="neo-tv-work-card__process-icon" size={15} />
            <span className="neo-tv-work-card__process-text">查看制作过程</span>
          </button>
        ) : null}
        <div className="neo-tv-work-card__info">
          <div className="neo-tv-work-card__author-row">
            <span className="neo-tv-work-card__author">@{asset.ownerName || asset.ownerLogin || 'TapCanvas'}</span>
          </div>
          <div className="neo-tv-work-card__title-row">
            <h3 className="neo-tv-work-card__title">{asset.name}</h3>
            {canFavorite ? (
              <button
                className={`neo-tv-work-card__favorite${asset.favorited ? ' is-active' : ''}`}
                type="button"
                aria-label={asset.favorited ? '取消收藏' : '收藏'}
                aria-pressed={Boolean(asset.favorited)}
                disabled={favoriteBusy}
                onClick={(event) => {
                  event.stopPropagation()
                  onToggleFavorite(asset)
                }}
              >
                {asset.favorited
                  ? <IconHeartFilled className="neo-tv-work-card__favorite-icon" size={14} />
                  : <IconHeart className="neo-tv-work-card__favorite-icon" size={14} />}
                <span className="neo-tv-work-card__favorite-count">{asset.favoriteCount ?? 0}</span>
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  )
}
