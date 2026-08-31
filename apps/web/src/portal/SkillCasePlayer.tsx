import React from 'react'
import { IconArrowsMaximize, IconChevronLeft, IconChevronRight, IconPlayerPause, IconPlayerPlay, IconVolume, IconVolumeOff, IconX } from '@tabler/icons-react'
import type { SkillMarketplaceItemDto } from '../api/server'
import { getOiioiiSkillCaseUrl } from './oiioiiSkillCatalog'

type SkillCasePlayerProps = {
  item: SkillMarketplaceItemDto
  previousDisabled: boolean
  nextDisabled: boolean
  onClose: () => void
  onOpenDetail: () => void
  onPrevious: () => void
  onNext: () => void
}

function formatTime(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '0:00'
  const minutes = Math.floor(value / 60)
  const seconds = Math.floor(value % 60)
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

export function SkillCasePlayer(props: SkillCasePlayerProps): JSX.Element | null {
  const { item, previousDisabled, nextDisabled, onClose, onOpenDetail, onPrevious, onNext } = props
  const videoRef = React.useRef<HTMLVideoElement | null>(null)
  const [playing, setPlaying] = React.useState(true)
  const [muted, setMuted] = React.useState(false)
  const [currentTime, setCurrentTime] = React.useState(0)
  const [duration, setDuration] = React.useState(0)
  const caseUrl = getOiioiiSkillCaseUrl(item)

  React.useEffect(() => {
    setCurrentTime(0)
    setDuration(0)
    setPlaying(true)
    const video = videoRef.current
    if (!video) return
    video.load()
    void video.play().catch(() => setPlaying(false))
  }, [caseUrl])

  if (!caseUrl) return null

  const togglePlayback = (): void => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) {
      void video.play().then(() => setPlaying(true)).catch(() => setPlaying(false))
    } else {
      video.pause()
      setPlaying(false)
    }
  }

  return (
    <section className="skill-case-player" role="region" aria-label="技能案例播放器">
      <header className="skill-case-player__header">
        <div className="skill-case-player__heading"><span className="skill-case-player__eyebrow">技能案例</span><strong className="skill-case-player__title">{item.skill.name}</strong></div>
        <div className="skill-case-player__header-actions">
          <button className="skill-case-player__icon-action" type="button" aria-label="打开详情" onClick={onOpenDetail}><IconArrowsMaximize className="skill-case-player__icon" size={16} /></button>
          <button className="skill-case-player__icon-action" type="button" aria-label="关闭迷你播放器" onClick={onClose}><IconX className="skill-case-player__icon" size={17} /></button>
        </div>
      </header>
      <video
        className="skill-case-player__video"
        ref={videoRef}
        src={caseUrl}
        playsInline
        autoPlay
        muted={muted}
        preload="metadata"
        onClick={togglePlayback}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onDurationChange={(event) => setDuration(event.currentTarget.duration)}
        onEnded={() => setPlaying(false)}
      />
      <div className="skill-case-player__timeline">
        <input className="skill-case-player__range" aria-label="Seek" type="range" min={0} max={duration || 0} step={0.05} value={Math.min(currentTime, duration || 0)} onChange={(event) => { const next = Number(event.currentTarget.value); setCurrentTime(next); if (videoRef.current) videoRef.current.currentTime = next }} />
        <span className="skill-case-player__time">{formatTime(currentTime)} / {formatTime(duration)}</span>
      </div>
      <footer className="skill-case-player__controls">
        <button className="skill-case-player__control" type="button" aria-label="上一个" disabled={previousDisabled} onClick={onPrevious}><IconChevronLeft className="skill-case-player__icon" size={18} /></button>
        <button className="skill-case-player__control is-primary" type="button" aria-label={playing ? '暂停' : '播放'} onClick={togglePlayback}>{playing ? <IconPlayerPause className="skill-case-player__icon" size={18} /> : <IconPlayerPlay className="skill-case-player__icon" size={18} />}</button>
        <button className="skill-case-player__control" type="button" aria-label={muted ? '取消静音' : '静音'} onClick={() => setMuted((value) => !value)}>{muted ? <IconVolumeOff className="skill-case-player__icon" size={18} /> : <IconVolume className="skill-case-player__icon" size={18} />}</button>
        <button className="skill-case-player__control" type="button" aria-label="下一个" disabled={nextDisabled} onClick={onNext}><IconChevronRight className="skill-case-player__icon" size={18} /></button>
      </footer>
    </section>
  )
}
