import React from 'react'
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Center,
  Container,
  Group,
  Loader,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Text,
  Title,
  Tooltip,
  useMantineColorScheme,
} from '@mantine/core'
import {
  IconArrowLeft,
  IconChartBar,
  IconClock,
  IconExternalLink,
  IconFilter,
  IconPlayerPlay,
  IconPhoto,
  IconRefresh,
  IconSortDescending,
  IconUser,
} from '@tabler/icons-react'
import { getPublicProjectFlows, listPublicAssets, listPublicProjects, type FlowDto, type ProjectDto, type PublicAssetDto } from '../api/server'
import PreviewModal from './PreviewModal'
import { useUIStore } from './uiStore'
import { ToastHost, toast } from './toast'
import { useAuth } from '../auth/store'
import { setTapImageDragData } from '../canvas/dnd/setTapImageDragData'

type MediaFilter = 'all' | 'image' | 'video'
type SortKey = 'createdAt' | 'duration'
type SortOrder = 'desc' | 'asc'

type ProjectCover = {
  type: 'video' | 'image'
  url: string
  thumbnailUrl?: string | null
  flowId: string
}

type PublicProjectShowcase = {
  project: ProjectDto
  cover: ProjectCover
}

function getActiveAssetIdFromLocation(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const path = window.location.pathname || ''
    const parts = path.split('/').filter(Boolean)
    const idx = parts.indexOf('tapshow')
    if (idx === -1) return null
    const maybeId = parts[idx + 1]
    return maybeId ? decodeURIComponent(maybeId) : null
  } catch {
    return null
  }
}

function buildTapshowUrl(assetId?: string | null): string | null {
  if (typeof window === 'undefined') return null
  try {
    const url = new URL(window.location.href)
    url.search = ''
    url.hash = ''
    url.pathname = assetId ? `/tapshow/${encodeURIComponent(assetId)}` : '/tapshow'
    return url.toString()
  } catch {
    return assetId ? `/tapshow/${encodeURIComponent(assetId)}` : '/tapshow'
  }
}

function formatDate(ts: string): string {
  const date = new Date(ts)
  if (Number.isNaN(date.getTime())) return ts
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function formatDuration(seconds?: number | null): string | null {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return null
  const s = Math.round(seconds)
  const m = Math.floor(s / 60)
  const r = s % 60
  return m > 0 ? `${m}m ${r}s` : `${r}s`
}

type TapshowCardProps = {
  asset: PublicAssetDto
  onPreview: (asset: PublicAssetDto) => void
  className?: string
}

function TapshowCard({ asset, onPreview, className }: TapshowCardProps): JSX.Element {
  const isVideo = asset.type === 'video'
  const cover = asset.thumbnailUrl || asset.url
  const label = asset.name || (isVideo ? '视频作品' : '图片作品')
  const subtitle =
    asset.prompt && asset.prompt.trim().length > 0
      ? asset.prompt.trim()
      : asset.projectName || asset.ownerName || asset.ownerLogin || ''
  const durationText = formatDuration(asset.duration)
  const cardClassName = ['tapshow-card', className].filter(Boolean).join(' ')

  return (
    <Box
      className={cardClassName}
      onClick={() => {
        onPreview(asset)
      }}
    >
      <div className="tapshow-card-media">
        {isVideo ? (
          <video
            src={asset.url}
            poster={cover || undefined}
            className="tapshow-card-video"
            muted
            playsInline
            preload="metadata"
            onMouseEnter={(e) => {
              try {
                const el = e.currentTarget
                el.currentTime = 0
                el.play().catch(() => {})
              } catch {
                // ignore preview error
              }
            }}
            onMouseLeave={(e) => {
              try {
                e.currentTarget.pause()
              } catch {
                // ignore
              }
            }}
          />
        ) : cover ? (
          <img
            src={cover}
            alt={label}
            className="tapshow-card-image"
            loading="lazy"
            draggable
            onDragStart={(evt) => setTapImageDragData(evt, cover)}
          />
        ) : (
          <div className="tapshow-card-placeholder" />
        )}

        <div className="tapshow-card-overlay">
          <Group className="tapshow-card-badges" gap={8}>
            <Badge
              className="tapshow-card-badge"
              size="xs"
              radius="xl"
              variant="light"
              color={isVideo ? 'violet' : 'teal'}
              leftSection={isVideo ? <IconPlayerPlay className="tapshow-card-badge-icon" size={12} /> : <IconPhoto className="tapshow-card-badge-icon" size={12} />}
            >
              {isVideo ? '视频' : '图片'}
            </Badge>
            {asset.modelKey && (
              <Badge className="tapshow-card-badge" size="xs" radius="xl" variant="outline" color="gray">
                {asset.modelKey}
              </Badge>
            )}
            {durationText && (
              <Badge className="tapshow-card-badge" size="xs" radius="xl" variant="filled" color="dark">
                {durationText}
              </Badge>
            )}
          </Group>
          <ActionIcon
            className="tapshow-card-open"
            size="sm"
            radius="xl"
            variant="subtle"
            aria-label="在新标签页打开"
            onClick={(e) => {
              e.stopPropagation()
              if (!asset.url) return
              try {
                window.open(asset.url, '_blank', 'noopener,noreferrer')
              } catch {
                window.location.href = asset.url
              }
            }}
          >
            <IconExternalLink className="tapshow-card-open-icon" size={14} />
          </ActionIcon>
        </div>
      </div>

      <Stack className="tapshow-card-meta" gap={6} mt={10}>
        <Text size="sm" fw={600} className="tapshow-card-title" lineClamp={1}>
          {label}
        </Text>
        {subtitle && (
          <Text className="tapshow-card-subtitle" size="xs" c="dimmed" lineClamp={2}>
            {subtitle}
          </Text>
        )}
        <Group className="tapshow-card-meta-row" justify="space-between" align="center" gap={6} mt={4}>
          <Group className="tapshow-card-owner" gap={6}>
            {(asset.ownerLogin || asset.ownerName) && (
              <Group className="tapshow-card-owner-info" gap={4}>
                <IconUser className="tapshow-card-owner-icon" size={12} />
                <Text className="tapshow-card-owner-text" size="xs" c="dimmed">
                  {asset.ownerName || asset.ownerLogin}
                </Text>
              </Group>
            )}
          </Group>
          <Group className="tapshow-card-date" gap={4}>
            <IconClock className="tapshow-card-date-icon" size={12} />
            <Text className="tapshow-card-date-text" size="xs" c="dimmed">
              {formatDate(asset.createdAt)}
            </Text>
          </Group>
        </Group>
      </Stack>
    </Box>
  )
}

function safeDateMs(value?: string | null): number {
  if (!value) return 0
  const t = new Date(value).getTime()
  return Number.isFinite(t) ? t : 0
}

function pickCoverFromFlows(flows: FlowDto[]): ProjectCover | null {
  const sorted = [...(flows || [])].sort((a, b) => safeDateMs(b.updatedAt) - safeDateMs(a.updatedAt))

  const scan = (kind: 'video' | 'image'): ProjectCover | null => {
    for (const f of sorted) {
      const data: any = (f as any)?.data || {}
      const nodes: any[] = Array.isArray(data.nodes) ? data.nodes : []
      for (let i = nodes.length - 1; i >= 0; i -= 1) {
        const node = nodes[i]
        const nd: any = node?.data || {}

        if (kind === 'video') {
          const results = Array.isArray(nd.videoResults) ? nd.videoResults : []
          const primaryIndex = typeof nd.videoPrimaryIndex === 'number' && Number.isFinite(nd.videoPrimaryIndex) ? nd.videoPrimaryIndex : 0
          const primary = results[primaryIndex] || null
          const fallback = results.find((r: any) => typeof r?.url === 'string' && r.url.trim().length > 0) || null
          const videoUrlRaw = (primary?.url || fallback?.url || nd.videoUrl) as any
          const videoUrl = typeof videoUrlRaw === 'string' ? videoUrlRaw.trim() : ''
          if (!videoUrl) continue
          const thumbRaw = (primary?.thumbnailUrl || fallback?.thumbnailUrl || nd.videoThumbnailUrl || nd.thumbnailUrl) as any
          const thumbnailUrl = typeof thumbRaw === 'string' && thumbRaw.trim().length ? thumbRaw.trim() : null
          return { type: 'video', url: videoUrl, thumbnailUrl, flowId: String(f.id) }
        }

        const imageResults = Array.isArray(nd.imageResults) ? nd.imageResults : []
        const imagePrimaryIndex = typeof nd.imagePrimaryIndex === 'number' && Number.isFinite(nd.imagePrimaryIndex) ? nd.imagePrimaryIndex : 0
        const primaryImg = imageResults[imagePrimaryIndex] || null
        const fallbackImg = imageResults.find((r: any) => typeof r?.url === 'string' && r.url.trim().length > 0) || null
        const imageUrlRaw = (nd.imageUrl || primaryImg?.url || fallbackImg?.url) as any
        const imageUrl = typeof imageUrlRaw === 'string' ? imageUrlRaw.trim() : ''
        if (!imageUrl) continue
        return { type: 'image', url: imageUrl, thumbnailUrl: null, flowId: String(f.id) }
      }
    }
    return null
  }

  // Prefer videos as cover, then images
  return scan('video') || scan('image')
}

type PublicProjectCardProps = {
  item: PublicProjectShowcase
  onOpen: (item: PublicProjectShowcase) => void
  className?: string
}

function PublicProjectCard({ item, onOpen, className }: PublicProjectCardProps): JSX.Element {
  const cover = item.cover
  const isVideo = cover.type === 'video'
  const label = item.project.name || '公开项目'
  const subtitle = item.project.ownerName || item.project.owner || ''
  const cardClassName = ['tapshow-card', className].filter(Boolean).join(' ')

  return (
    <Box className={cardClassName} onClick={() => onOpen(item)}>
      <div className="tapshow-card-media">
        {isVideo ? (
          <video
            src={cover.url}
            poster={cover.thumbnailUrl || undefined}
            className="tapshow-card-video"
            muted
            playsInline
            preload="metadata"
            onMouseEnter={(e) => {
              try {
                const el = e.currentTarget
                el.currentTime = 0
                el.play().catch(() => {})
              } catch {
                // ignore preview error
              }
            }}
            onMouseLeave={(e) => {
              try {
                e.currentTarget.pause()
              } catch {
                // ignore
              }
            }}
          />
        ) : (
          <img
            src={cover.url}
            alt={label}
            className="tapshow-card-image"
            loading="lazy"
            draggable
            onDragStart={(evt) => setTapImageDragData(evt, cover.url)}
          />
        )}

        <div className="tapshow-card-overlay">
          <Group className="tapshow-card-badges" gap={8}>
            <Badge
              className="tapshow-card-badge"
              size="xs"
              radius="xl"
              variant="light"
              color={isVideo ? 'violet' : 'teal'}
              leftSection={isVideo ? <IconPlayerPlay className="tapshow-card-badge-icon" size={12} /> : <IconPhoto className="tapshow-card-badge-icon" size={12} />}
            >
              {isVideo ? '项目视频' : '项目图片'}
            </Badge>
            <Badge className="tapshow-card-badge" size="xs" radius="xl" variant="outline" color="gray">
              公开项目
            </Badge>
          </Group>
          <ActionIcon
            className="tapshow-card-open"
            size="sm"
            radius="xl"
            variant="subtle"
            aria-label="打开分享页"
            onClick={(e) => {
              e.stopPropagation()
              onOpen(item)
            }}
          >
            <IconExternalLink className="tapshow-card-open-icon" size={14} />
          </ActionIcon>
        </div>
      </div>

      <Stack className="tapshow-card-meta" gap={6} mt={10}>
        <Text size="sm" fw={600} className="tapshow-card-title" lineClamp={1}>
          {label}
        </Text>
        {subtitle && (
          <Text className="tapshow-card-subtitle" size="xs" c="dimmed" lineClamp={1}>
            {subtitle}
          </Text>
        )}
        <Group className="tapshow-card-meta-row" justify="space-between" align="center" gap={6} mt={4}>
          <Group className="tapshow-card-owner" gap={6}>
            {(item.project.owner || item.project.ownerName) && (
              <Group className="tapshow-card-owner-info" gap={4}>
                <IconUser className="tapshow-card-owner-icon" size={12} />
                <Text className="tapshow-card-owner-text" size="xs" c="dimmed">
                  {item.project.ownerName || item.project.owner}
                </Text>
              </Group>
            )}
          </Group>
          <Group className="tapshow-card-date" gap={4}>
            <IconClock className="tapshow-card-date-icon" size={12} />
            <Text className="tapshow-card-date-text" size="xs" c="dimmed">
              {formatDate(item.project.updatedAt)}
            </Text>
          </Group>
        </Group>
      </Stack>
    </Box>
  )
}

function TapshowFullPageInner({ className }: { className?: string }): JSX.Element {
  const openPreview = useUIStore((s) => s.openPreview)
  const isAdmin = useAuth((s) => s.user?.role === 'admin')
  const { colorScheme } = useMantineColorScheme()
  const isDark = colorScheme === 'dark'

  const [assets, setAssets] = React.useState<PublicAssetDto[]>([])
  const [publicProjects, setPublicProjects] = React.useState<PublicProjectShowcase[]>([])
  const [projectsLoading, setProjectsLoading] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const [refreshing, setRefreshing] = React.useState(false)
  const [hasLoadedOnce, setHasLoadedOnce] = React.useState(false)
  const [mediaFilter, setMediaFilter] = React.useState<MediaFilter>('all')
  const [sortKey, setSortKey] = React.useState<SortKey>('createdAt')
  const [sortOrder, setSortOrder] = React.useState<SortOrder>('desc')
  const [visibleCount, setVisibleCount] = React.useState(30)
  const [pendingAssetId, setPendingAssetId] = React.useState<string | null>(() => getActiveAssetIdFromLocation())
  const loadMoreRef = React.useRef<HTMLDivElement | null>(null)

  const reloadProjects = React.useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setProjectsLoading(true)
    try {
      const projects = await listPublicProjects().catch(() => [])
      const sorted = [...(projects || [])].sort((a, b) => safeDateMs(b.updatedAt) - safeDateMs(a.updatedAt))
      const showcase: PublicProjectShowcase[] = []
      for (const project of sorted) {
        if (showcase.length >= 24) break
        try {
          const flows = await getPublicProjectFlows(project.id)
          const cover = pickCoverFromFlows(flows || [])
          if (!cover) continue
          showcase.push({ project, cover })
        } catch {
          // ignore per-project failures on showcase
        }
      }
      setPublicProjects(showcase)
    } catch (err: any) {
      console.error(err)
      toast(err?.message || '加载公开项目失败', 'error')
      setPublicProjects([])
    } finally {
      setProjectsLoading(false)
    }
  }, [])

  const reloadAssets = React.useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!opts?.silent) setLoading(true)
      setRefreshing(true)
      try {
        const data = await listPublicAssets(120, mediaFilter)
        setAssets(data || [])
        setHasLoadedOnce(true)
      } catch (err: any) {
        console.error(err)
        toast(err?.message || '加载 TapShow 作品失败', 'error')
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [mediaFilter],
  )

  React.useEffect(() => {
    reloadAssets().catch(() => {})
  }, [reloadAssets])

  React.useEffect(() => {
    reloadProjects({ silent: true }).catch(() => {})
  }, [reloadProjects])

  React.useEffect(() => {
    setVisibleCount(30)
  }, [mediaFilter, sortKey, sortOrder, assets.length])

  const sortedAssets = React.useMemo(() => {
    const list = [...assets]
    const dir = sortOrder === 'asc' ? 1 : -1
    list.sort((a, b) => {
      if (sortKey === 'duration') {
        const da = typeof a.duration === 'number' ? a.duration : null
        const db = typeof b.duration === 'number' ? b.duration : null
        if (da == null && db == null) return 0
        if (da == null) return 1
        if (db == null) return -1
        return (da - db) * dir
      }
      const ta = new Date(a.createdAt).getTime()
      const tb = new Date(b.createdAt).getTime()
      if (Number.isNaN(ta) || Number.isNaN(tb)) return 0
      return (ta - tb) * dir
    })
    return list
  }, [assets, sortKey, sortOrder])

  const filteredAssets = React.useMemo(() => {
    if (mediaFilter === 'all') return sortedAssets
    return sortedAssets.filter((asset) => asset.type === mediaFilter)
  }, [sortedAssets, mediaFilter])

  const visibleAssets = React.useMemo(
    () => filteredAssets.slice(0, Math.max(visibleCount, 30)),
    [filteredAssets, visibleCount],
  )

  const hasMore = visibleAssets.length < filteredAssets.length

  const handlePreview = React.useCallback(
    (asset: PublicAssetDto, opts?: { preserveUrl?: boolean }) => {
      if (!asset.url) return
      const isVideo = asset.type === 'video'
      const label = asset.name || (isVideo ? '视频作品' : '图片作品')
      openPreview({ url: asset.url, kind: isVideo ? 'video' : 'image', name: label })
      if (!opts?.preserveUrl) {
        const next = buildTapshowUrl(asset.id)
        if (next && typeof window !== 'undefined') {
          window.history.pushState(null, '', next)
        }
      }
    },
    [openPreview],
  )

  React.useEffect(() => {
    if (!pendingAssetId || !sortedAssets.length) return
    const asset = sortedAssets.find((a) => a.id === pendingAssetId)
    if (!asset) return
    handlePreview(asset, { preserveUrl: true })
    const canonical = buildTapshowUrl(asset.id)
    if (canonical && typeof window !== 'undefined') {
      window.history.replaceState(null, '', canonical)
    }
    setPendingAssetId(null)
  }, [pendingAssetId, sortedAssets, handlePreview])

  React.useEffect(() => {
    if (typeof window === 'undefined') return
    const unsub = useUIStore.subscribe(
      (state) => state.preview,
      (preview) => {
        if (preview) return
        const path = window.location.pathname || ''
        const parts = path.split('/').filter(Boolean)
        const idx = parts.indexOf('tapshow')
        if (idx === -1) return
        if (parts.length <= idx + 1) return
        const baseUrl = buildTapshowUrl(null)
        if (baseUrl) {
          window.history.replaceState(null, '', baseUrl)
        }
      },
    )
    return () => unsub()
  }, [])

  React.useEffect(() => {
    if (!hasMore || typeof IntersectionObserver === 'undefined') return
    const el = loadMoreRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (!entry.isIntersecting) return
        setVisibleCount((count) => Math.min(count + 30, filteredAssets.length))
      },
      { root: null, rootMargin: '0px 0px 240px 0px', threshold: 0.1 },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasMore, filteredAssets.length])

  const background = isDark
    ? 'radial-gradient(circle at 0% 0%, rgba(56,189,248,0.14), transparent 60%), radial-gradient(circle at 100% 0%, rgba(37,99,235,0.18), transparent 60%), radial-gradient(circle at 0% 100%, rgba(168,85,247,0.12), transparent 55%), linear-gradient(180deg, #020617 0%, #020617 100%)'
    : 'radial-gradient(circle at 0% 0%, rgba(59,130,246,0.12), transparent 60%), radial-gradient(circle at 100% 0%, rgba(59,130,246,0.08), transparent 60%), radial-gradient(circle at 0% 100%, rgba(56,189,248,0.08), transparent 55%), linear-gradient(180deg, #eef2ff 0%, #e9efff 100%)'

  const rootClassName = ['tapshow-fullpage-root', className].filter(Boolean).join(' ')

  return (
    <div className={rootClassName} style={{ background }}>
      <ToastHost className="tapshow-fullpage-toast" />
      <PreviewModal className="tapshow-fullpage-preview" />
      <Container className="tapshow-fullpage-container" size="xl" px="md">
        <Box className="tapshow-fullpage-header" pt="md" pb="sm">
          <Group className="tapshow-fullpage-header-row" justify="space-between" align="center" mb="md">
            <Group className="tapshow-fullpage-header-left" gap={10} align="center">
              <Button
                className="tapshow-fullpage-back"
                size="xs"
                variant="subtle"
                leftSection={<IconArrowLeft className="tapshow-fullpage-back-icon" size={14} />}
                onClick={() => {
                  if (typeof window !== 'undefined') {
                    window.location.href = '/'
                  }
                }}
              >
                返回 TapCanvas
              </Button>
            </Group>
            <Group className="tapshow-fullpage-header-right" gap={6}>
              {isAdmin && (
                <Tooltip className="tapshow-fullpage-admin-tooltip" label="看板（仅管理员）" withArrow>
                  <ActionIcon
                    className="tapshow-fullpage-admin-action"
                    size="sm"
                    variant="subtle"
                    aria-label="看板"
                    onClick={() => {
                      try {
                        const url = new URL(window.location.href)
                        url.search = ''
                        url.hash = ''
                        url.pathname = '/stats'
                        window.open(url.toString(), '_blank', 'noopener,noreferrer')
                      } catch {
                        window.open('/stats', '_blank', 'noopener,noreferrer')
                      }
                    }}
                  >
                    <IconChartBar className="tapshow-fullpage-admin-icon" size={14} />
                  </ActionIcon>
                </Tooltip>
              )}
              <Tooltip className="tapshow-fullpage-refresh-tooltip" label="刷新" withArrow>
                <ActionIcon
                  className="tapshow-fullpage-refresh-action"
                  size="sm"
                  variant="subtle"
                  aria-label="刷新 TapShow 作品"
                  onClick={() => {
                    if (loading || refreshing || projectsLoading) return
                    reloadAssets().catch(() => {})
                    reloadProjects({ silent: true }).catch(() => {})
                  }}
                  loading={refreshing || loading || projectsLoading}
                >
                  <IconRefresh className="tapshow-fullpage-refresh-icon" size={14} />
                </ActionIcon>
              </Tooltip>
            </Group>
          </Group>

          <Stack className="tapshow-fullpage-hero" gap={6} mb="lg">
            <Title order={2} className="tapshow-fullpage-title">
              TapShow 作品展
            </Title>
            <Text className="tapshow-fullpage-subtitle" size="sm" c="dimmed" maw={620}>
              展示社区里用户公开的图片与视频作品。后续会支持按时长、热度等条件筛选排序。
            </Text>
          </Stack>

          <Stack className="tapshow-fullpage-projects" gap={8} mb="lg">
            <Group className="tapshow-fullpage-projects-header" justify="space-between" align="center" wrap="wrap" gap={8}>
              <Group className="tapshow-fullpage-projects-title" gap={8} align="center">
                <Title className="tapshow-fullpage-projects-heading" order={4}>公开项目</Title>
                <Badge className="tapshow-fullpage-projects-count" variant="light" color="gray">
                  {publicProjects.length}
                </Badge>
              </Group>
              <Group className="tapshow-fullpage-projects-actions" gap={6}>
                <Button
                  className="tapshow-fullpage-projects-viewall"
                  size="xs"
                  variant="subtle"
                  onClick={() => {
                    if (typeof window === 'undefined') return
                    window.open('/share', '_blank', 'noopener,noreferrer')
                  }}
                >
                  查看全部
                </Button>
                <Tooltip className="tapshow-fullpage-projects-refresh-tooltip" label="刷新公开项目" withArrow>
                  <ActionIcon
                    className="tapshow-fullpage-projects-refresh-action"
                    size="sm"
                    variant="light"
                    aria-label="刷新公开项目"
                    onClick={() => {
                      if (!projectsLoading) reloadProjects()
                    }}
                    loading={projectsLoading}
                  >
                    <IconRefresh className="tapshow-fullpage-projects-refresh-icon" size={14} />
                  </ActionIcon>
                </Tooltip>
              </Group>
            </Group>
            <Text className="tapshow-fullpage-projects-desc" size="xs" c="dimmed">
              默认使用项目内的视频作为封面，其次图片；点击进入分享页，可查看画布与创作过程（只读）。
            </Text>

            {projectsLoading && publicProjects.length === 0 ? (
              <Center className="tapshow-fullpage-projects-loading" mih={140}>
                <Stack className="tapshow-fullpage-projects-loading-stack" gap={8} align="center">
                  <Loader className="tapshow-fullpage-projects-loading-icon" size="sm" />
                  <Text className="tapshow-fullpage-projects-loading-text" size="sm" c="dimmed">
                    正在加载公开项目…
                  </Text>
                </Stack>
              </Center>
            ) : publicProjects.length === 0 ? (
              <Text className="tapshow-fullpage-projects-empty" size="sm" c="dimmed">
                暂无可展示的公开项目（需要项目内至少有一个视频/图片结果作为封面）。
              </Text>
            ) : (
              <SimpleGrid cols={{ base: 1, sm: 2, md: 3, lg: 4 }} spacing={{ base: 'md', md: 'lg' }} className="tapshow-grid tapshow-fullpage-projects-grid">
                {publicProjects.map((item) => (
                  <PublicProjectCard
                    key={item.project.id}
                    className="tapshow-card--project"
                    item={item}
                    onOpen={(it) => {
                      const url = `/share/${encodeURIComponent(it.project.id)}/${encodeURIComponent(it.cover.flowId)}`
                      if (typeof window !== 'undefined') window.open(url, '_blank', 'noopener,noreferrer')
                    }}
                  />
                ))}
              </SimpleGrid>
            )}
          </Stack>

          <Group className="tapshow-fullpage-filters" justify="space-between" align="center" mb="md" wrap="wrap" gap={8}>
            <Group className="tapshow-fullpage-filters-left" gap={8} wrap="wrap">
              <SegmentedControl
                className="tapshow-fullpage-filter-media"
                size="xs"
                radius="xl"
                value={mediaFilter}
                onChange={(v) => setMediaFilter(v as MediaFilter)}
                data={[
                  { value: 'all', label: '全部' },
                  { value: 'video', label: '视频' },
                  { value: 'image', label: '图片' },
                ]}
              />

              <SegmentedControl
                className="tapshow-fullpage-filter-sort"
                size="xs"
                radius="xl"
                value={sortKey}
                onChange={(v) => setSortKey(v as SortKey)}
                data={[
                  { value: 'createdAt', label: '按时间' },
                  { value: 'duration', label: '按时长' },
                ]}
              />

              <ActionIcon
                className="tapshow-fullpage-filter-order"
                size="sm"
                radius="xl"
                variant="light"
                aria-label="切换排序方向"
                onClick={() => setSortOrder((o) => (o === 'desc' ? 'asc' : 'desc'))}
              >
                {sortOrder === 'desc' ? <IconSortDescending className="tapshow-fullpage-filter-order-icon" size={14} /> : <IconFilter className="tapshow-fullpage-filter-order-icon" size={14} />}
              </ActionIcon>
            </Group>

            <Text className="tapshow-fullpage-count" size="xs" c="dimmed">
              共 {filteredAssets.length} 个公开作品
            </Text>
          </Group>
        </Box>

        <Box className="tapshow-fullpage-list" pb="xl">
          {loading && !hasLoadedOnce ? (
            <Center className="tapshow-fullpage-loading" mih={260}>
              <Stack className="tapshow-fullpage-loading-stack" gap={8} align="center">
                <Loader className="tapshow-fullpage-loading-icon" size="sm" />
                <Text className="tapshow-fullpage-loading-text" size="sm" c="dimmed">
                  正在加载作品…
                </Text>
              </Stack>
            </Center>
          ) : !filteredAssets.length ? (
            <Center className="tapshow-fullpage-empty" mih={260}>
              <Stack className="tapshow-fullpage-empty-stack" gap={6} align="center">
                <Text className="tapshow-fullpage-empty-title" size="sm" fw={500}>
                  暂无公开作品
                </Text>
                <Text className="tapshow-fullpage-empty-desc" size="xs" c="dimmed" ta="center" maw={420}>
                  公开上传到 OSS 的图片 / 视频会自动出现在这里。
                </Text>
              </Stack>
            </Center>
          ) : (
            <SimpleGrid
              cols={{ base: 1, sm: 2, md: 3, lg: 4 }}
              spacing={{ base: 'md', md: 'lg' }}
              className="tapshow-grid tapshow-fullpage-grid"
            >
              {visibleAssets.map((asset) => (
                <TapshowCard key={asset.id} className="tapshow-card--asset" asset={asset} onPreview={handlePreview} />
              ))}
            </SimpleGrid>
          )}

          {hasMore && (
            <Center className="tapshow-fullpage-load-more" mt="lg" ref={loadMoreRef}>
              <Button
                className="tapshow-fullpage-load-more-button"
                size="xs"
                variant="light"
                onClick={() => {
                  setVisibleCount((count) => Math.min(count + 30, filteredAssets.length))
                }}
              >
                加载更多
              </Button>
            </Center>
          )}
        </Box>
      </Container>
    </div>
  )
}

export default function TapshowFullPage(): JSX.Element {
  return <TapshowFullPageInner className="tapshow-fullpage" />
}
