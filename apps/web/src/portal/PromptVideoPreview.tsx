import React from 'react'
import { IconAlertTriangle, IconPlayerPlayFilled } from '@tabler/icons-react'
import type { PromptLibraryMedia } from '../api/promptLibrary'
import { ManagedImage } from '../domain/resource-runtime/components/ManagedImage'
import { createMediaPlaybackRequestController, isMediaPlaybackInterruption } from '../utils/mediaPlayback'

type PromptVideoPreviewProps = {
  media: PromptLibraryMedia
  title: string
  onReady?: () => void
}

export function PromptVideoPreview({ media, title, onReady }: PromptVideoPreviewProps): JSX.Element {
  const videoRef = React.useRef<HTMLVideoElement | null>(null)
  const playbackController = React.useMemo(() => createMediaPlaybackRequestController(), [])
  const hoveringRef = React.useRef(false)
  const [playing, setPlaying] = React.useState(false)
  const [failed, setFailed] = React.useState(false)
  const [posterFailed, setPosterFailed] = React.useState(false)
  const [ready, setReady] = React.useState(false)
  const readyRef = React.useRef(false)
  const hasPoster = Boolean(media.thumbnailUrl && !posterFailed)

  const markReady = React.useCallback((): void => {
    if (readyRef.current) return
    readyRef.current = true
    setReady(true)
    onReady?.()
  }, [onReady])

  React.useEffect(() => {
    if (posterFailed) videoRef.current?.load()
  }, [posterFailed])

  React.useEffect(() => () => {
    hoveringRef.current = false
    playbackController.cancelPending()
  }, [playbackController])

  const startPreview = (): void => {
    const video = videoRef.current
    if (!video || failed) return
    hoveringRef.current = true
    video.muted = true
    void playbackController.play(video).then((result) => {
      if (!hoveringRef.current || result.status !== 'failed' || isMediaPlaybackInterruption(result.error)) return
      setPlaying(false)
      setFailed(true)
      console.error('[prompt-library] video hover preview failed', { mediaId: media.id, error: result.error })
    })
  }

  const stopPreview = (): void => {
    hoveringRef.current = false
    playbackController.cancelPending()
    const video = videoRef.current
    if (!video) return
    video.pause()
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) video.currentTime = 0
    setPlaying(false)
  }

  return (
    <div className={`prompt-video-preview${ready ? ' is-ready' : ''}`} onMouseEnter={startPreview} onMouseLeave={stopPreview}>
      {hasPoster ? (
        <ManagedImage
          className={`prompt-video-preview__poster${playing ? ' is-hidden' : ''}`}
          src={media.thumbnailUrl}
          alt={`${title} 视频封面`}
          priority="visible"
          onLoad={markReady}
          onError={() => setPosterFailed(true)}
        />
      ) : null}
      <video
        className={`prompt-video-preview__video${playing || !hasPoster ? ' is-visible' : ''}`}
        ref={videoRef}
        src={media.url}
        muted
        loop
        playsInline
        preload={hasPoster ? 'metadata' : 'auto'}
        onLoadedData={markReady}
        onPlaying={() => {
          if (!hoveringRef.current) {
            videoRef.current?.pause()
            setPlaying(false)
            return
          }
          setPlaying(true)
          setFailed(false)
        }}
        onError={() => { setPlaying(false); setFailed(true); markReady() }}
      />
      {ready && !playing && !failed ? <IconPlayerPlayFilled className="prompt-video-preview__play" size={20} aria-hidden="true" /> : null}
      {failed ? <span className="prompt-video-preview__error"><IconAlertTriangle className="prompt-video-preview__error-icon" size={14} aria-hidden="true" />预览不可用</span> : null}
    </div>
  )
}
