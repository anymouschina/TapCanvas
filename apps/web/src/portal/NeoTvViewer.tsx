import React from 'react'
import {
  IconArrowLeft,
  IconChevronLeft,
  IconChevronRight,
  IconEye,
  IconHeart,
  IconHeartFilled,
  IconMaximize,
  IconPlayerPause,
  IconPlayerPlay,
  IconShare3,
  IconVolume,
  IconVolumeOff,
} from '@tabler/icons-react'
import type { PublicAssetDto } from '../api/server'
import { ManagedImage } from '../domain/resource-runtime/components/ManagedImage'
import { toast } from '../ui/toast'
import { createMediaPlaybackRequestController } from '../utils/mediaPlayback'
import { spaNavigate } from '../utils/spaNavigate'
import { buildPublicCreativeProcessPath } from './publicCreativeProcess'
import './NeoTvViewer.css'

type NeoTvViewerProps = {
  assetId: string | null
  assets: PublicAssetDto[]
  favoriteBusyIds: ReadonlySet<string>
  onClose: () => void
  onToggleFavorite: (asset: PublicAssetDto) => void
}

function formatTime(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '00:00'
  const minutes = Math.floor(value / 60)
  const seconds = Math.floor(value % 60)
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export function NeoTvViewer({
  assetId,
  assets,
  favoriteBusyIds,
  onClose,
  onToggleFavorite,
}: NeoTvViewerProps): JSX.Element | null {
  const [activeId, setActiveId] = React.useState(assetId || '')
  const [playingMode, setPlayingMode] = React.useState(false)
  const [playing, setPlaying] = React.useState(false)
  const [muted, setMuted] = React.useState(true)
  const [ready, setReady] = React.useState(false)
  const [currentTime, setCurrentTime] = React.useState(0)
  const [duration, setDuration] = React.useState(0)
  const [aspectRatio, setAspectRatio] = React.useState<number | null>(null)
  const [error, setError] = React.useState('')
  const [playbackChromeVisible, setPlaybackChromeVisible] = React.useState(true)
  const videoRef = React.useRef<HTMLVideoElement | null>(null)
  const carouselRef = React.useRef<HTMLDivElement | null>(null)
  const chromeHideTimerRef = React.useRef<number | null>(null)
  const playbackController = React.useMemo(() => createMediaPlaybackRequestController(), [])

  const requestPlayback = React.useCallback((video: HTMLVideoElement, fallbackMessage: string): void => {
    void playbackController.play(video).then((result) => {
      if (result.status === 'cancelled') return
      if (result.status === 'started') {
        setError('')
        return
      }
      const { error: playbackError } = result
      setError(playbackError instanceof Error && playbackError.message.trim() ? playbackError.message : fallbackMessage)
    })
  }, [playbackController])

  const returnToDetails = React.useCallback((): void => {
    setPlayingMode(false)
    setMuted(true)
    setPlaybackChromeVisible(true)
    const video = videoRef.current
    if (!video) return
    video.muted = true
    requestPlayback(video, '视频预览播放失败')
  }, [requestPlayback])

  const revealPlaybackChrome = React.useCallback((): void => {
    if (!playingMode) return
    setPlaybackChromeVisible(true)
    if (chromeHideTimerRef.current !== null) window.clearTimeout(chromeHideTimerRef.current)
    chromeHideTimerRef.current = window.setTimeout(() => {
      setPlaybackChromeVisible(false)
      chromeHideTimerRef.current = null
    }, 1400)
  }, [playingMode])

  React.useEffect(() => {
    if (!assetId) return
    setActiveId(assetId)
    setPlayingMode(false)
    setPlaying(false)
    setMuted(true)
    setPlaybackChromeVisible(true)
    const video = videoRef.current
    return () => {
      playbackController.cancelPending()
      video?.pause()
    }
  }, [assetId, playbackController])

  const activeIndex = React.useMemo(
    () => Math.max(0, assets.findIndex((asset) => asset.id === activeId)),
    [activeId, assets],
  )
  const activeAsset = assets[activeIndex] || null
  const activeAssetId = activeAsset?.id || ''
  const activeAssetUrl = activeAsset?.url || ''
  const creativeProcessPath = activeAsset ? buildPublicCreativeProcessPath(activeAsset) : null
  const canViewProcess = Boolean(creativeProcessPath)
  const canFavorite = Boolean(activeAsset?.sourceProjectId?.trim() || activeAsset?.projectId?.trim())

  React.useEffect(() => {
    setReady(false)
    setCurrentTime(0)
    setDuration(0)
    setAspectRatio(null)
    setError('')
    setPlaying(false)
    setMuted(true)
    const video = videoRef.current
    if (!video || !activeAssetId || !activeAssetUrl) return
    playbackController.cancelPending()
    video.pause()
    video.muted = true
    video.src = activeAssetUrl
    video.load()
    requestPlayback(video, '视频预览播放失败')
    return () => playbackController.cancelPending()
  }, [activeAssetId, activeAssetUrl, playbackController, requestPlayback])

  const selectActiveAsset = React.useCallback((nextActiveId: string): void => {
    if (!nextActiveId || nextActiveId === activeId) return
    playbackController.cancelPending()
    videoRef.current?.pause()
    setActiveId(nextActiveId)
  }, [activeId, playbackController])

  React.useEffect(() => {
    if (!assetId || !activeId) return
    const activeItem = carouselRef.current?.querySelector<HTMLElement>('.neo-tv-viewer__carousel-item.is-active')
    activeItem?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
  }, [activeId, assetId])

  React.useEffect(() => {
    if (!playingMode) {
      if (chromeHideTimerRef.current !== null) window.clearTimeout(chromeHideTimerRef.current)
      chromeHideTimerRef.current = null
      setPlaybackChromeVisible(true)
      return
    }
    revealPlaybackChrome()
    return () => {
      if (chromeHideTimerRef.current !== null) window.clearTimeout(chromeHideTimerRef.current)
      chromeHideTimerRef.current = null
    }
  }, [playingMode, revealPlaybackChrome])

  React.useEffect(() => {
    if (!assetId) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        if (playingMode) returnToDetails()
        else onClose()
        return
      }
      if (event.key === 'ArrowLeft' && !playingMode) {
        event.preventDefault()
        selectActiveAsset(assets[Math.max(0, activeIndex - 1)]?.id || activeId)
        return
      }
      if (event.key === 'ArrowRight' && !playingMode) {
        event.preventDefault()
        selectActiveAsset(assets[Math.min(assets.length - 1, activeIndex + 1)]?.id || activeId)
        return
      }
      if (event.key === ' ' && playingMode) {
        event.preventDefault()
        const video = videoRef.current
        if (!video) return
        if (video.paused) {
          requestPlayback(video, '视频播放失败')
        }
        else {
          playbackController.cancelPending()
          video.pause()
        }
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [activeId, activeIndex, assetId, assets, onClose, playbackController, playingMode, requestPlayback, returnToDetails, selectActiveAsset])

  React.useEffect(() => {
    if (!assetId) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previousOverflow }
  }, [assetId])

  const beginWatching = React.useCallback((): void => {
    const video = videoRef.current
    if (!video) return
    setPlayingMode(true)
    setPlaybackChromeVisible(true)
    video.currentTime = 0
    video.muted = false
    setMuted(false)
    requestPlayback(video, '浏览器阻止了视频播放')
  }, [requestPlayback])

  const togglePlaying = React.useCallback((): void => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) {
      requestPlayback(video, '视频播放失败')
    }
    else {
      playbackController.cancelPending()
      video.pause()
    }
  }, [playbackController, requestPlayback])

  const toggleMuted = React.useCallback((): void => {
    const video = videoRef.current
    if (!video) return
    video.muted = !video.muted
    setMuted(video.muted)
  }, [])

  const openProcess = React.useCallback((): void => {
    if (!creativeProcessPath) return
    spaNavigate(creativeProcessPath)
  }, [creativeProcessPath])

  const share = React.useCallback(async (): Promise<void> => {
    if (!activeAsset) return
    const shareUrl = new URL(window.location.href)
    shareUrl.searchParams.set('watch', activeAsset.id)
    try {
      await navigator.clipboard.writeText(shareUrl.toString())
      toast('链接已复制到剪贴板', 'success')
    } catch (shareError: unknown) {
      toast(shareError instanceof Error && shareError.message.trim() ? shareError.message : '复制失败，请手动复制', 'error')
    }
  }, [activeAsset])

  const toggleFullscreen = React.useCallback(async (): Promise<void> => {
    const viewer = videoRef.current?.closest('.neo-tv-viewer')
    if (!(viewer instanceof HTMLElement)) return
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await viewer.requestFullscreen()
    } catch (fullscreenError: unknown) {
      toast(fullscreenError instanceof Error && fullscreenError.message.trim() ? fullscreenError.message : '无法进入全屏', 'error')
    }
  }, [])

  if (!assetId || !activeAsset) return null

  const posterUrl = activeAsset.thumbnailUrl?.trim() || ''
  const ownerAvatarUrl = activeAsset.ownerAvatarUrl?.trim() || ''
  const ownerName = activeAsset.ownerName || activeAsset.ownerLogin || 'TapCanvas'
  const progress = duration > 0 ? currentTime / duration : 0
  const frameStyle: React.CSSProperties & Record<'--neo-tv-viewer-aspect-ratio', number> = {
    '--neo-tv-viewer-aspect-ratio': aspectRatio || 16 / 9,
  }

  return (
    <section
      className={`neo-tv-viewer${playingMode ? ' is-playing' : ''}${playingMode && !playbackChromeVisible ? ' is-chrome-hidden' : ''}`}
      aria-label={`观看 ${activeAsset.name}`}
      onPointerMove={revealPlaybackChrome}
      onPointerDown={revealPlaybackChrome}
    >
      {!playingMode && posterUrl ? (
        <div className="neo-tv-viewer__background" aria-hidden="true">
          <ManagedImage className="neo-tv-viewer__background-image" src={posterUrl} alt="" priority="critical" />
        </div>
      ) : null}

      <header className="neo-tv-viewer__topbar">
        <button
          className="neo-tv-viewer__back"
          type="button"
          onClick={() => {
            if (playingMode) returnToDetails()
            else onClose()
          }}
        >
          <IconArrowLeft className="neo-tv-viewer__back-icon" size={18} />
          <span className="neo-tv-viewer__back-label">返回</span>
        </button>
        <div className="neo-tv-viewer__identity">
          <span className="neo-tv-viewer__avatar" aria-hidden="true">
            {ownerAvatarUrl ? (
              <ManagedImage className="neo-tv-viewer__avatar-image" src={ownerAvatarUrl} alt="" priority="critical" />
            ) : (
              <span className="neo-tv-viewer__avatar-fallback">{ownerName.slice(0, 1).toLocaleUpperCase('zh-CN')}</span>
            )}
          </span>
          <span className="neo-tv-viewer__author">{ownerName}</span>
          <span className="neo-tv-viewer__title">{activeAsset.name}</span>
        </div>
        {playingMode ? (
          <button
            className={`neo-tv-viewer__playing-process${canViewProcess ? '' : ' is-disabled'}`}
            type="button"
            disabled={!canViewProcess}
            onClick={openProcess}
          >
            <span className="neo-tv-viewer__playing-process-label">查看制作过程</span>
            <IconChevronRight className="neo-tv-viewer__playing-process-icon" size={14} />
          </button>
        ) : (
          <span className="neo-tv-viewer__topbar-spacer" />
        )}
      </header>

      <div className="neo-tv-viewer__stage">
        <div className={`neo-tv-viewer__frame${aspectRatio ? ' is-aspect-ready' : ''}`} style={frameStyle}>
          {posterUrl ? (
            <ManagedImage
              className={`neo-tv-viewer__poster${ready ? ' is-hidden' : ''}`}
              src={posterUrl}
              alt=""
              priority="critical"
              loading="eager"
              fetchPriority="high"
              onLoad={(event) => {
                const image = event.currentTarget
                if (image.naturalWidth > 0 && image.naturalHeight > 0) {
                  setAspectRatio(image.naturalWidth / image.naturalHeight)
                }
              }}
            />
          ) : null}
          <video
            ref={videoRef}
            className={`neo-tv-viewer__video${ready ? ' is-ready' : ''}`}
            muted={muted}
            loop={!playingMode}
            playsInline
            preload="metadata"
            onClick={playingMode ? togglePlaying : beginWatching}
            onLoadedMetadata={(event) => {
              const video = event.currentTarget
              setDuration(video.duration || 0)
              if (video.videoWidth > 0 && video.videoHeight > 0) {
                setAspectRatio(video.videoWidth / video.videoHeight)
              }
            }}
            onLoadedData={() => setReady(true)}
            onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onError={() => {
              setReady(false)
              setError('视频加载失败')
            }}
          />
          {error ? <div className="neo-tv-viewer__error" role="alert">{error}</div> : null}

          {playingMode ? (
            <div className="neo-tv-viewer__controls">
              <button className="neo-tv-viewer__control" type="button" aria-label={playing ? '暂停' : '播放'} onClick={togglePlaying}>
                {playing
                  ? <IconPlayerPause className="neo-tv-viewer__control-icon" size={19} />
                  : <IconPlayerPlay className="neo-tv-viewer__control-icon" size={19} fill="currentColor" />}
              </button>
              <span className="neo-tv-viewer__time">{formatTime(currentTime)} / {formatTime(duration)}</span>
              <label className="neo-tv-viewer__progress">
                <span className="neo-tv-viewer__progress-track" aria-hidden="true">
                  <span className="neo-tv-viewer__progress-fill" style={{ transform: `scaleX(${progress})` }} />
                </span>
                <input
                  className="neo-tv-viewer__progress-input"
                  type="range"
                  min={0}
                  max={Math.max(duration, 0.01)}
                  step={0.01}
                  value={Math.min(currentTime, Math.max(duration, 0.01))}
                  aria-label="播放进度"
                  onChange={(event) => {
                    const nextTime = Number(event.currentTarget.value)
                    if (!videoRef.current || !Number.isFinite(nextTime)) return
                    videoRef.current.currentTime = nextTime
                    setCurrentTime(nextTime)
                  }}
                />
              </label>
              <button className="neo-tv-viewer__control" type="button" aria-label={muted ? '打开声音' : '静音'} onClick={toggleMuted}>
                {muted
                  ? <IconVolumeOff className="neo-tv-viewer__control-icon" size={19} />
                  : <IconVolume className="neo-tv-viewer__control-icon" size={19} />}
              </button>
              <button className="neo-tv-viewer__control" type="button" aria-label="全屏" onClick={() => void toggleFullscreen()}>
                <IconMaximize className="neo-tv-viewer__control-icon" size={18} />
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {!playingMode ? (
        <div className="neo-tv-viewer__actions">
          <button className="neo-tv-viewer__action neo-tv-viewer__action--primary" type="button" onClick={beginWatching}>
            <IconPlayerPlay className="neo-tv-viewer__action-icon" size={16} fill="currentColor" />
            <span className="neo-tv-viewer__action-label">立即观看</span>
          </button>
          <button
            className={`neo-tv-viewer__action${canViewProcess ? '' : ' is-disabled'}`}
            type="button"
            disabled={!canViewProcess}
            onClick={openProcess}
          >
            <IconEye className="neo-tv-viewer__action-icon" size={16} />
            <span className="neo-tv-viewer__action-label">查看制作过程</span>
          </button>
          {canFavorite ? (
            <button
              className={`neo-tv-viewer__icon-action${activeAsset.favorited ? ' is-active' : ''}`}
              type="button"
              aria-label={activeAsset.favorited ? '取消收藏' : '收藏'}
              aria-pressed={Boolean(activeAsset.favorited)}
              disabled={favoriteBusyIds.has(activeAsset.id)}
              onClick={() => onToggleFavorite(activeAsset)}
            >
              {activeAsset.favorited
                ? <IconHeartFilled className="neo-tv-viewer__icon-action-icon" size={18} />
                : <IconHeart className="neo-tv-viewer__icon-action-icon" size={18} />}
            </button>
          ) : null}
          <button className="neo-tv-viewer__icon-action" type="button" aria-label="分享" onClick={() => void share()}>
            <IconShare3 className="neo-tv-viewer__icon-action-icon" size={18} />
          </button>
        </div>
      ) : null}

      {!playingMode && assets.length > 0 ? (
        <nav className="neo-tv-viewer__carousel" aria-label="其他 TcTv 作品">
          {assets.length > 1 ? (
            <button
              className="neo-tv-viewer__carousel-arrow"
              type="button"
              aria-label="向左滚动"
              onClick={() => carouselRef.current?.scrollBy({ left: -300, behavior: 'smooth' })}
            >
              <IconChevronLeft className="neo-tv-viewer__carousel-arrow-icon" size={16} />
            </button>
          ) : <span className="neo-tv-viewer__carousel-arrow-spacer" />}
          <div className="neo-tv-viewer__carousel-track" ref={carouselRef}>
            {assets.map((asset) => (
              <button
                className={`neo-tv-viewer__carousel-item${asset.id === activeAsset.id ? ' is-active' : ''}`}
                type="button"
                key={asset.id}
                aria-label={`切换到 ${asset.name}`}
                onClick={() => selectActiveAsset(asset.id)}
              >
                <span className="neo-tv-viewer__carousel-thumb">
                  {asset.thumbnailUrl ? (
                    <ManagedImage className="neo-tv-viewer__carousel-image" src={asset.thumbnailUrl} alt="" priority="visible" />
                  ) : (
                    <span className="neo-tv-viewer__carousel-placeholder" />
                  )}
                  <span className="neo-tv-viewer__carousel-title">{asset.name}</span>
                </span>
              </button>
            ))}
          </div>
          {assets.length > 1 ? (
            <button
              className="neo-tv-viewer__carousel-arrow"
              type="button"
              aria-label="向右滚动"
              onClick={() => carouselRef.current?.scrollBy({ left: 300, behavior: 'smooth' })}
            >
              <IconChevronRight className="neo-tv-viewer__carousel-arrow-icon" size={16} />
            </button>
          ) : <span className="neo-tv-viewer__carousel-arrow-spacer" />}
        </nav>
      ) : null}
    </section>
  )
}
