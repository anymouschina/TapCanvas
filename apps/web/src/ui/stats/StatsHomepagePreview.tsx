import React from 'react'
import { ActionIcon, SegmentedControl, Tooltip } from '@mantine/core'
import {
  IconArrowLeft,
  IconDeviceDesktop,
  IconDeviceMobile,
  IconHome,
  IconLogin,
  IconWorld,
} from '@tabler/icons-react'

import type {
  HomepageDecoration,
  HomepageVideoRankingConfigDto,
  CarouselSlide,
  PublicAssetDto,
} from '../../api/server'
import type { HomepagePreviewSnapshot } from '../../portal/homepagePreviewSnapshot'
import {
  HomepageShellPreview,
  type HomepagePreviewViewport,
} from './homepage-preview/HomepageShellPreview'
import { EmbeddedPagePreview } from './homepage-preview/EmbeddedPagePreview'
import {
  formatHomepagePreviewLocation,
  type HomepagePreviewLocation,
  resolveHomepagePreviewLocation,
} from './homepage-preview/homepagePreviewNavigation'
import { LoginPreviewSurface } from './homepage-preview/LoginPreviewSurface'
import { PreviewInteractionBoundary } from './homepage-preview/PreviewInteractionBoundary'
import { rankHomepageVideos } from './homepage-preview/rankHomepageVideos'
import './StatsHomepagePreview.css'

type StatsHomepagePreviewProps = {
  decoration: HomepageDecoration
  videos: PublicAssetDto[]
  videosLoading: boolean
  videoRankingError: string
  videoRankingConfig: HomepageVideoRankingConfigDto | null
  blockedVideoIds: readonly string[]
  slides: CarouselSlide[]
  templateWeights: Record<string, number>
}

export function StatsHomepagePreview({
  decoration,
  videos,
  videosLoading,
  videoRankingError,
  videoRankingConfig,
  blockedVideoIds,
  slides,
  templateWeights,
}: StatsHomepagePreviewProps): JSX.Element {
  const scrollContainerRef = React.useRef<HTMLDivElement | null>(null)
  const [location, setLocation] = React.useState<HomepagePreviewLocation>({ kind: 'homepage', href: '/' })
  const [viewport, setViewport] = React.useState<HomepagePreviewViewport>('desktop')
  const rankingTimestamp = React.useMemo(() => Date.now(), [videos])
  const blockedVideoIdSet = React.useMemo(() => new Set(blockedVideoIds), [blockedVideoIds])
  const rankedVideos = React.useMemo(
    () => rankHomepageVideos(videos, videoRankingConfig, rankingTimestamp, blockedVideoIdSet),
    [blockedVideoIdSet, rankingTimestamp, videoRankingConfig, videos],
  )
  const previewSnapshot = React.useMemo<HomepagePreviewSnapshot>(() => ({
    slides,
    decoration,
    showcase: rankedVideos.map(({ asset }) => asset),
    templateWeights,
  }), [decoration, rankedVideos, slides, templateWeights])

  const navigateWithinPreview = React.useCallback((href: string): void => {
    const nextLocation = resolveHomepagePreviewLocation(href)
    if (!nextLocation) return
    setLocation((current) => (
      current.kind === nextLocation.kind && current.href === nextLocation.href ? current : nextLocation
    ))
  }, [])

  const selectConfiguredSurface = React.useCallback((value: string): void => {
    navigateWithinPreview(value === 'login' ? '/login' : '/')
  }, [navigateWithinPreview])

  const previewStatus = location.kind === 'homepage'
    ? '按当前作品推荐草稿渲染真实首页'
    : location.kind === 'login'
      ? '按当前登录视频草稿渲染'
      : '目标页面在此预览窗口内运行'

  return (
    <aside className="stats-homepage-preview" aria-label="配置实时预览">
      <div className="stats-homepage-preview__toolbar">
        <div className="stats-homepage-preview__title-wrap">
          <strong className="stats-homepage-preview__title">实时预览</strong>
          <span className="stats-homepage-preview__status">
            {previewStatus}
          </span>
        </div>
        <div className="stats-homepage-preview__controls">
          <SegmentedControl
            className="stats-homepage-preview__surface-control"
            size="xs"
            value={location.kind === 'embedded' ? '' : location.kind}
            onChange={selectConfiguredSurface}
            data={[
              { value: 'homepage', label: '首页' },
              { value: 'login', label: '登录页' },
            ]}
          />
          <Tooltip label="桌面预览" withinPortal>
            <ActionIcon
              className="stats-homepage-preview__viewport-action"
              aria-label="桌面预览"
              variant={viewport === 'desktop' ? 'filled' : 'subtle'}
              size="sm"
              onClick={() => setViewport('desktop')}
            >
              <IconDeviceDesktop className="stats-homepage-preview__viewport-icon" size={15} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="移动端预览" withinPortal>
            <ActionIcon
              className="stats-homepage-preview__viewport-action"
              aria-label="移动端预览"
              variant={viewport === 'mobile' ? 'filled' : 'subtle'}
              size="sm"
              onClick={() => setViewport('mobile')}
            >
              <IconDeviceMobile className="stats-homepage-preview__viewport-icon" size={15} />
            </ActionIcon>
          </Tooltip>
        </div>
      </div>

      <div className="stats-homepage-preview__viewport-wrap">
        <PreviewInteractionBoundary className={`stats-homepage-preview__viewport is-${viewport}`}>
          <div className="stats-homepage-preview__browser-bar">
            {location.kind === 'embedded' ? (
              <button
                className="stats-homepage-preview__browser-back"
                type="button"
                aria-label="返回首页预览"
                onClick={() => navigateWithinPreview('/')}
              >
                <IconArrowLeft className="stats-homepage-preview__browser-back-icon" size={13} />
              </button>
            ) : null}
            {location.kind === 'homepage' ? <IconHome className="stats-homepage-preview__browser-icon" size={13} /> : null}
            {location.kind === 'login' ? <IconLogin className="stats-homepage-preview__browser-icon" size={13} /> : null}
            {location.kind === 'embedded' ? <IconWorld className="stats-homepage-preview__browser-icon" size={13} /> : null}
            <span className="stats-homepage-preview__browser-location">
              {formatHomepagePreviewLocation(location)}
            </span>
          </div>
          <div
            ref={scrollContainerRef}
            className={`stats-homepage-preview__scroll${location.kind === 'embedded' ? ' is-embedded' : ''}`}
          >
            <div className="stats-homepage-preview__page" key={`${location.kind}:${location.href}`}>
              {location.kind === 'homepage' ? (
                <HomepageShellPreview
                  viewport={viewport}
                  showcase={rankedVideos.map(({ asset }) => asset)}
                  showcaseLoading={videosLoading}
                  showcaseError={videoRankingError}
                  scrollContainerRef={scrollContainerRef}
                  onNavigate={navigateWithinPreview}
                  onRequestLogin={() => navigateWithinPreview('/login')}
                />
              ) : null}
              {location.kind === 'login' ? <LoginPreviewSurface decoration={decoration} /> : null}
              {location.kind === 'embedded' ? (
                <EmbeddedPagePreview
                  href={location.href}
                  viewport={viewport}
                  onLocationChange={navigateWithinPreview}
                  snapshot={previewSnapshot}
                />
              ) : null}
            </div>
          </div>
        </PreviewInteractionBoundary>
      </div>
    </aside>
  )
}
