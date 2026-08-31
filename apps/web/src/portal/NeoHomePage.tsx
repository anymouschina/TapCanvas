import React from 'react'
import {
  IconArrowDown,
  IconArrowRight,
  IconBrandGithub,
  IconFolders,
  IconMail,
  IconMaximize,
  IconMessages,
  IconPlayerPause,
  IconPlayerPlay,
  IconVideo,
  IconVolume,
  IconVolumeOff,
} from '@tabler/icons-react'
import type { PublicAssetDto } from '../api/server'
import { useAuth } from '../auth/store'
import { hostedAssetUrl } from '../config/objectStorageAssets'
import { ManagedImage } from '../domain/resource-runtime/components/ManagedImage'
import { createMediaPlaybackRequestController } from '../utils/mediaPlayback'
import { spaNavigate } from '../utils/spaNavigate'
import { PortalHeader } from './PortalHeader'
import { PortalFooter } from './PortalFooter'
import { loadPortalPublishedVideos } from './portalDataLoader'
import { buildPublicCreativeProcessPath } from './publicCreativeProcess'
import { buildNeoTvWatchPath } from './neoTvNavigation'
import { useHomepagePreviewSnapshot } from './homepagePreviewSnapshot'
import './portal.css'
import './NeoHomePage.css'

const HERO_VIDEO_URL = hostedAssetUrl('gen/videos/phone_11dd9f14a3c25ed8947cd76e12fdc0123ea17f972ad99cf25d4d4abcdfda2272/20260521/24ff1d29-89df-4e95-b4f5-c9e8e895c715.mp4')
const HERO_POSTER_URL = hostedAssetUrl('static/portal/tc-home-hero-v2-20260722.webp')

const PRODUCTION_VISUALS = [
  hostedAssetUrl('static/portal/tc-home-production-1-v2-20260722.webp'),
  hostedAssetUrl('static/portal/tc-home-production-2-v2-20260722.webp'),
  hostedAssetUrl('static/portal/tc-home-production-3-v2-20260722.webp'),
  hostedAssetUrl('static/portal/tc-home-production-4-v2-20260722.webp'),
] as const
const SHOWCASE_SKELETON_KEYS = ['showcase-a', 'showcase-b', 'showcase-c', 'showcase-d', 'showcase-e', 'showcase-f', 'showcase-g'] as const

type HeroWork = {
  id: string
  name: string
  author: string
  videoUrl: string
  posterUrl: string
  creativeProcessPath: string | null
}

export type NeoHomePageSurfaceProps = {
  showcase: PublicAssetDto[]
  showcaseLoading: boolean
  showcaseError: string
  onNavigate?: (href: string) => void
  onRequestLogin?: () => void
  scrollContainerRef?: React.RefObject<HTMLElement | null>
}

const PRODUCTION_STEPS = [
  { index: '01', title: '剧本创作', detail: '小T理解创意与真实项目上下文，完成故事结构、章节与可执行剧本。', visualUrl: PRODUCTION_VISUALS[0] },
  { index: '02', title: '美术设计', detail: '建立角色、场景、道具与风格资产，统一整部作品的视觉标准。', visualUrl: PRODUCTION_VISUALS[1] },
  { index: '03', title: '分镜设计', detail: '自动拆解景别、机位、动作、对白与连续性，组织成可生产镜头。', visualUrl: PRODUCTION_VISUALS[2] },
  { index: '04', title: '短片合成', detail: '逐镜生成并自动完成剪辑、声音与成片，人只负责审美判断和最终标准。', visualUrl: PRODUCTION_VISUALS[3] },
] as const

const CAPABILITY_GROUPS = [
  {
    title: '创作 Agent',
    detail: '理解内容并端到端执行',
    items: ['剧本续写', '章节拆解', '素材提取', '分镜生产', '连续性管理'],
    visualUrl: hostedAssetUrl('static/portal/tc-home-capability-creative-agent-v2-20260722.webp'),
  },
  {
    title: '图片能力',
    detail: '角色、场景与关键帧',
    items: ['文图生图', '智能修图', '高清放大', '扩图裁剪', '姿势编辑'],
    visualUrl: hostedAssetUrl('static/portal/tc-home-capability-image-craft-v2-20260722.webp'),
  },
  {
    title: '视频能力',
    detail: '镜头生成与整片合成',
    items: ['文生视频', '首尾帧视频', '多图参考', '视频超分', '镜头合成'],
    visualUrl: hostedAssetUrl('static/portal/tc-home-capability-video-craft-v2-20260722.webp'),
  },
  {
    title: '音频能力',
    detail: '对白、声音与成片音轨',
    items: ['预设音色', '声音定制', '对白配音', '环境音效', '音轨合成'],
    visualUrl: hostedAssetUrl('static/portal/tc-home-capability-sound-craft-v2-20260722.webp'),
  },
] as const

function resolveErrorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim() ? error.message.trim() : '作品加载失败'
}

function toHeroWork(asset: PublicAssetDto): HeroWork | null {
  const videoUrl = asset.url?.trim() || ''
  if (!videoUrl) return null
  return {
    id: asset.id,
    name: asset.name,
    author: asset.ownerName || asset.ownerLogin || 'TapCanvas',
    videoUrl,
    posterUrl: asset.thumbnailUrl?.trim() || '',
    creativeProcessPath: buildPublicCreativeProcessPath(asset),
  }
}

export default function NeoHomePage(): JSX.Element {
  const auth = useAuth()
  const previewSnapshot = useHomepagePreviewSnapshot()
  const [showcase, setShowcase] = React.useState<PublicAssetDto[]>([])
  const [showcaseLoading, setShowcaseLoading] = React.useState(true)
  const [showcaseError, setShowcaseError] = React.useState('')

  React.useEffect(() => {
    let active = true
    setShowcaseLoading(true)
    loadPortalPublishedVideos(auth.token, 12, 'homepage')
      .then((items) => {
        if (!active) return
        setShowcase(items)
        setShowcaseError('')
      })
      .catch((error: unknown) => {
        if (!active) return
        setShowcase([])
        setShowcaseError(resolveErrorMessage(error))
      })
      .finally(() => {
        if (active) setShowcaseLoading(false)
      })
    return () => { active = false }
  }, [auth.token])

  return (
    <NeoHomePageSurface
      showcase={previewSnapshot?.showcase ?? showcase}
      showcaseLoading={previewSnapshot ? false : showcaseLoading}
      showcaseError={previewSnapshot ? '' : showcaseError}
    />
  )
}

export function NeoHomePageSurface({
  showcase,
  showcaseLoading,
  showcaseError,
  onNavigate,
  onRequestLogin,
  scrollContainerRef,
}: NeoHomePageSurfaceProps): JSX.Element {
  const rootRef = React.useRef<HTMLDivElement | null>(null)
  const videoRef = React.useRef<HTMLVideoElement | null>(null)
  const shouldPlayRef = React.useRef(true)
  const playbackController = React.useMemo(() => createMediaPlaybackRequestController(), [])
  const [immersive, setImmersive] = React.useState(false)
  const [playing, setPlaying] = React.useState(true)
  const [muted, setMuted] = React.useState(true)
  const [videoReady, setVideoReady] = React.useState(false)
  const [videoError, setVideoError] = React.useState('')
  const [activeVideoIndex, setActiveVideoIndex] = React.useState(0)
  const [progress, setProgress] = React.useState(0)
  const heroWorks = React.useMemo<HeroWork[]>(() => {
    const published = showcase.map(toHeroWork).filter((item): item is HeroWork => Boolean(item))
    if (published.length > 0) return published.slice(0, 7)
    return [{
      id: 'tapcanvas-feature',
      name: '一键成片，由小T完成',
      author: 'TapCanvas',
      videoUrl: HERO_VIDEO_URL,
      posterUrl: HERO_POSTER_URL,
      creativeProcessPath: null,
    }]
  }, [showcase])

  const activeWork = heroWorks[activeVideoIndex] || heroWorks[0]
  const activeCreativeProcessPath = activeWork.creativeProcessPath

  React.useEffect(() => {
    if (activeVideoIndex >= heroWorks.length) setActiveVideoIndex(0)
  }, [activeVideoIndex, heroWorks.length])

  const playHeroVideo = React.useCallback((video: HTMLVideoElement): void => {
    void playbackController.play(video).then((result) => {
      if (result.status === 'cancelled') return
      if (result.status === 'started') {
        setVideoError('')
        setPlaying(true)
        return
      }
      shouldPlayRef.current = false
      setPlaying(false)
      const { error } = result
      setVideoError(error instanceof Error && error.message.trim() ? error.message : '首屏视频播放失败')
    })
  }, [playbackController])

  React.useEffect(() => {
    setProgress(0)
    setVideoReady(false)
    setVideoError('')
    const video = videoRef.current
    if (!video) return
    playbackController.cancelPending()
    video.pause()
    video.src = activeWork.videoUrl
    video.load()
    if (shouldPlayRef.current) playHeroVideo(video)
    return () => {
      playbackController.cancelPending()
      video.pause()
    }
  }, [activeWork.videoUrl, playHeroVideo, playbackController])

  const navigate = React.useCallback((href: string): void => {
    if (onNavigate) {
      onNavigate(href)
      return
    }
    spaNavigate(href)
  }, [onNavigate])

  const scrollToSection = React.useCallback((sectionId: string): void => {
    const root = rootRef.current
    const target = root?.querySelector<HTMLElement>(`#${sectionId}`)
    const scrollContainer = scrollContainerRef?.current
      ?? root?.querySelector<HTMLElement>('.tc-portal-scroll-area')
    if (!target || !scrollContainer) return

    const targetRect = target.getBoundingClientRect()
    const containerRect = scrollContainer.getBoundingClientRect()
    scrollContainer.scrollTo({
      top: scrollContainer.scrollTop + targetRect.top - containerRect.top,
      behavior: 'smooth',
    })
  }, [scrollContainerRef])

  const scrollToWorkflow = React.useCallback(() => {
    scrollToSection('neo-home-workflow')
  }, [scrollToSection])

  const togglePlaying = React.useCallback(() => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) {
      shouldPlayRef.current = true
      playHeroVideo(video)
      return
    }
    shouldPlayRef.current = false
    playbackController.cancelPending()
    video.pause()
    setPlaying(false)
  }, [playHeroVideo, playbackController])

  const selectHeroVideo = React.useCallback((index: number): void => {
    if (index === activeVideoIndex) return
    playbackController.cancelPending()
    videoRef.current?.pause()
    setActiveVideoIndex(index)
  }, [activeVideoIndex, playbackController])

  const toggleMuted = React.useCallback(() => {
    const video = videoRef.current
    if (!video) return
    video.muted = !video.muted
    setMuted(video.muted)
  }, [])

  return (
    <div ref={rootRef} className={`neo-home${immersive ? ' is-immersive' : ''}`}>
      {!immersive ? (
        <PortalHeader
          active="home"
          onNavigate={onNavigate}
          onRequestLogin={onRequestLogin}
        />
      ) : null}
      <div className="tc-portal-scroll-area">
        <main className="neo-home__main">
        <section className="neo-home-hero" aria-labelledby="neo-home-title">
          <div className="neo-home-hero__background">
            <video
              ref={videoRef}
              className={`neo-home-hero__video${videoReady ? ' is-ready' : ''}`}
              muted={muted}
              loop
              playsInline
              preload="metadata"
              onLoadedData={() => setVideoReady(true)}
              onError={(event) => {
                setVideoReady(false)
                shouldPlayRef.current = false
                setPlaying(false)
                const mediaError = event.currentTarget.error
                setVideoError(mediaError?.message?.trim() || `首屏视频加载失败${mediaError?.code ? `（错误码 ${mediaError.code}）` : ''}`)
              }}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onTimeUpdate={(event) => {
                const video = event.currentTarget
                setProgress(video.duration > 0 ? video.currentTime / video.duration : 0)
              }}
            />
            {videoError ? <div className="neo-home-hero__media-error" role="alert">{videoError}</div> : null}
            <ManagedImage
              className="neo-home-hero__poster"
              src={activeWork.posterUrl || HERO_POSTER_URL}
              alt=""
              priority="critical"
              loading="eager"
              fetchPriority="high"
            />
            <div className="neo-home-hero__scrim" />
          </div>

          <div className="neo-home-hero__controls" aria-label="首屏视频控制">
            <div className="neo-home-hero__dots">
              {heroWorks.map((work, index) => (
                <button
                  className={`neo-home-hero__dot${index === activeVideoIndex ? ' is-active' : ''}`}
                  type="button"
                  aria-label={`播放 ${work.name}`}
                  key={work.id}
                  onClick={() => selectHeroVideo(index)}
                >
                  <span className="neo-home-hero__dot-progress" style={{ transform: `scaleY(${index === activeVideoIndex ? progress : 0})` }} />
                </button>
              ))}
            </div>
            <span className="neo-home-hero__control-divider" />
            <button className="neo-home-hero__control" type="button" aria-label={playing ? '暂停视频' : '播放视频'} onClick={togglePlaying}>
              {playing ? <IconPlayerPause className="neo-home-hero__control-icon" size={16} /> : <IconPlayerPlay className="neo-home-hero__control-icon" size={16} />}
            </button>
            <button className="neo-home-hero__control" type="button" aria-label={muted ? '打开声音' : '关闭声音'} onClick={toggleMuted}>
              {muted ? <IconVolumeOff className="neo-home-hero__control-icon" size={16} /> : <IconVolume className="neo-home-hero__control-icon" size={16} />}
            </button>
          </div>

          <button
            className="neo-home-hero__immersive"
            type="button"
            aria-label={immersive ? '退出沉浸模式' : '进入沉浸模式'}
            onClick={() => setImmersive((value) => !value)}
          >
            <IconMaximize className="neo-home-hero__immersive-icon" size={17} />
          </button>

          <div className="neo-home-hero__content">
            <h1 className="neo-home-hero__title" id="neo-home-title">超创视频工作站</h1>
            <p className="neo-home-hero__statement">
              <button className="neo-home-hero__statement-link" type="button" onClick={() => scrollToSection('neo-home-capabilities')}>底层能力</button>
              <span className="neo-home-hero__statement-text">覆盖</span>
              <button className="neo-home-hero__statement-link" type="button" onClick={scrollToWorkflow}>全链路</button>
            </p>
            <div className="neo-home-hero__actions">
              {activeCreativeProcessPath ? (
                <button
                  className="neo-home-hero__secondary"
                  type="button"
                  onClick={() => navigate(activeCreativeProcessPath)}
                >
                  查看创作过程
                </button>
              ) : null}
              <button className="neo-home-hero__primary" type="button" onClick={() => navigate('/projects')}>
                立即创作
                <IconArrowRight className="neo-home-hero__button-icon" size={22} />
              </button>
            </div>
          </div>

          <div className="neo-home-hero__credit" aria-live="polite">
            <span className="neo-home-hero__credit-name">{activeWork.name}</span>
            <span className="neo-home-hero__credit-author">@{activeWork.author}</span>
          </div>
          <button className="neo-home-hero__scroll" type="button" aria-label="查看下一部分" onClick={scrollToWorkflow}>
            <IconArrowDown className="neo-home-hero__scroll-icon" size={22} />
          </button>
        </section>

        <section className="neo-home-workflow" id="neo-home-workflow">
          <div className="neo-home-section-heading">
            <span className="neo-home-section-heading__index">Production</span>
            <h2 className="neo-home-section-heading__title">短片全链路生产</h2>
            <p className="neo-home-section-heading__subtitle">小T负责从创意到成片的自动化执行，人负责传递美学和标准。</p>
          </div>
          <div className="neo-home-workflow__timeline">
            {PRODUCTION_STEPS.map((step, index) => (
              <article className={`neo-home-workflow__step${index % 2 === 0 ? ' is-left' : ' is-right'}`} key={step.index}>
                <div className="neo-home-workflow__copy">
                  <span className="neo-home-workflow__index">STEP {step.index}</span>
                  <h3 className="neo-home-workflow__title">{step.title}</h3>
                  <p className="neo-home-workflow__detail">{step.detail}</p>
                </div>
                <div className="neo-home-workflow__media">
                  <ManagedImage
                    className="neo-home-workflow__image"
                    src={step.visualUrl}
                    alt={`${step.title}生产场景`}
                    priority="background"
                  />
                </div>
                <span className="neo-home-workflow__node" aria-hidden="true" />
              </article>
            ))}
          </div>
        </section>

        <section className="neo-home-capabilities" id="neo-home-capabilities">
          <div className="neo-home-section-heading neo-home-section-heading--light">
            <span className="neo-home-section-heading__index">Foundation</span>
            <h2 className="neo-home-section-heading__title">底层原子能力</h2>
            <p className="neo-home-section-heading__subtitle">主流多模态生成能力统一进入一块画布，由小T按真实项目上下文调用。</p>
          </div>
          <div className="neo-home-capabilities__groups">
            {CAPABILITY_GROUPS.map((group, index) => (
              <article className="neo-home-capability-poster" key={group.title}>
                <ManagedImage
                  className="neo-home-capability-poster__image"
                  src={group.visualUrl}
                  alt={`${group.title}：${group.detail}。${group.items.join('、')}`}
                  priority={index < 2 ? 'visible' : 'prefetch'}
                />
                <h3 className="neo-home-capability-poster__accessible-title">{group.title}</h3>
              </article>
            ))}
          </div>
        </section>

        <section className="neo-home-showcase" aria-label="TcTv 精选作品">
          <div className="neo-home-showcase__header">
            <div className="neo-home-showcase__heading">
              <span className="neo-home-showcase__eyebrow">TcTv</span>
              <h2 className="neo-home-showcase__title">正在发生的作品</h2>
            </div>
            <button className="neo-home-showcase__more" type="button" onClick={() => navigate('/neo-tv')}>
              查看全部
              <IconArrowRight className="neo-home-showcase__more-icon" size={16} />
            </button>
          </div>
          {showcaseError ? <div className="neo-home-showcase__error" role="alert">{showcaseError}</div> : null}
          <div className="neo-home-showcase__rail" aria-busy={showcaseLoading}>
            {showcaseLoading ? SHOWCASE_SKELETON_KEYS.map((key) => (
              <div className="neo-home-showcase__item neo-home-showcase__item--skeleton tc-portal-skeleton" aria-hidden="true" key={key} />
            )) : null}
            {showcase.filter((asset) => Boolean(asset.thumbnailUrl?.trim() || asset.url?.trim())).slice(0, 7).map((asset) => (
              <button
                className="neo-home-showcase__item"
                type="button"
                key={asset.id}
                aria-label={`观看 ${asset.name}`}
                onClick={() => navigate(buildNeoTvWatchPath(asset.id))}
              >
                <span className="neo-home-showcase__media">
                  {asset.thumbnailUrl ? (
                    <ManagedImage className="neo-home-showcase__image" src={asset.thumbnailUrl} alt={asset.name} priority="prefetch" />
                  ) : (
                    <video
                      className="neo-home-showcase__video"
                      src={asset.url}
                      muted
                      playsInline
                      preload="metadata"
                      onLoadedData={(event) => { event.currentTarget.currentTime = Math.min(0.2, event.currentTarget.duration || 0.2) }}
                    />
                  )}
                  <span className="neo-home-showcase__play">
                    <IconPlayerPlay className="neo-home-showcase__play-icon" size={16} fill="currentColor" />
                  </span>
                  <span className="neo-home-showcase__copy">
                    <strong className="neo-home-showcase__item-title">{asset.name}</strong>
                    <span className="neo-home-showcase__author">@{asset.ownerName || asset.ownerLogin || 'TapCanvas'}</span>
                  </span>
                </span>
              </button>
            ))}
            {!showcaseLoading && !showcaseError && showcase.length === 0 ? (
              <div className="neo-home-showcase__empty">还没有公开作品</div>
            ) : null}
          </div>
        </section>

        <section className="neo-home-community" aria-labelledby="neo-home-community-title">
          <div className="neo-home-section-heading">
            <span className="neo-home-section-heading__index">Community</span>
            <h2 className="neo-home-section-heading__title" id="neo-home-community-title">和创作者保持连接</h2>
          </div>
          <div className="neo-home-community__grid">
            <a className="neo-home-community__item" href="https://github.com/anymouschina/TapCanvas" target="_blank" rel="noreferrer">
              <IconBrandGithub className="neo-home-community__icon" size={25} stroke={1.5} />
              <strong className="neo-home-community__title">开源社区</strong>
              <span className="neo-home-community__detail">GitHub</span>
            </a>
            <a className="neo-home-community__item" href="https://github.com/anymouschina/TapCanvas#-联系与反馈" target="_blank" rel="noreferrer">
              <IconMessages className="neo-home-community__icon" size={25} stroke={1.5} />
              <strong className="neo-home-community__title">创作交流群</strong>
              <span className="neo-home-community__detail">交流反馈与共创</span>
            </a>
            <button className="neo-home-community__item" type="button" onClick={() => navigate('/projects')}>
              <IconVideo className="neo-home-community__icon" size={25} stroke={1.5} />
              <strong className="neo-home-community__title">TcTv</strong>
              <span className="neo-home-community__detail">公开作品与创作过程</span>
            </button>
            <button className="neo-home-community__item" type="button" onClick={() => navigate('/canvas')}>
              <IconFolders className="neo-home-community__icon" size={25} stroke={1.5} />
              <strong className="neo-home-community__title">我的画布</strong>
              <span className="neo-home-community__detail">继续创作</span>
            </button>
            <a className="neo-home-community__item" href="mailto:beq.li@qq.com">
              <IconMail className="neo-home-community__icon" size={25} stroke={1.5} />
              <strong className="neo-home-community__title">商务合作</strong>
              <span className="neo-home-community__detail">beq.li@qq.com</span>
            </a>
          </div>
          </section>
        </main>
        <PortalFooter />
      </div>
    </div>
  )
}
