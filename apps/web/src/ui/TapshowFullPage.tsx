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
  IconClock,
  IconExternalLink,
  IconFilter,
  IconPlayerPlay,
  IconPhoto,
  IconRefresh,
  IconSortDescending,
  IconUser,
} from '@tabler/icons-react'
import { listPublicAssets, type PublicAssetDto } from '../api/server'
import PreviewModal from './PreviewModal'
import { useUIStore } from './uiStore'
import { ToastHost, toast } from './toast'

type MediaFilter = 'all' | 'image' | 'video'
type SortKey = 'createdAt' | 'duration'
type SortOrder = 'desc' | 'asc'

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
}

function TapshowCard({ asset, onPreview }: TapshowCardProps): JSX.Element {
  const isVideo = asset.type === 'video'
  const cover = asset.thumbnailUrl || asset.url
  const label = asset.name || (isVideo ? '视频作品' : '图片作品')
  const subtitle =
    asset.prompt && asset.prompt.trim().length > 0
      ? asset.prompt.trim()
      : asset.projectName || asset.ownerName || asset.ownerLogin || ''
  const durationText = formatDuration(asset.duration)

  return (
    <Box
      className="tapshow-card"
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
          <img src={cover} alt={label} className="tapshow-card-image" loading="lazy" />
        ) : (
          <div className="tapshow-card-placeholder" />
        )}

        <div className="tapshow-card-overlay">
          <Group gap={8}>
            <Badge
              size="xs"
              radius="xl"
              variant="light"
              color={isVideo ? 'violet' : 'teal'}
              leftSection={isVideo ? <IconPlayerPlay size={12} /> : <IconPhoto size={12} />}
            >
              {isVideo ? '视频' : '图片'}
            </Badge>
            {asset.modelKey && (
              <Badge size="xs" radius="xl" variant="outline" color="gray">
                {asset.modelKey}
              </Badge>
            )}
            {durationText && (
              <Badge size="xs" radius="xl" variant="filled" color="dark">
                {durationText}
              </Badge>
            )}
          </Group>
          <ActionIcon
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
            <IconExternalLink size={14} />
          </ActionIcon>
        </div>
      </div>

      <Stack gap={6} mt={10}>
        <Text size="sm" fw={600} className="tapshow-card-title" lineClamp={1}>
          {label}
        </Text>
        {subtitle && (
          <Text size="xs" c="dimmed" lineClamp={2}>
            {subtitle}
          </Text>
        )}
        <Group justify="space-between" align="center" gap={6} mt={4}>
          <Group gap={6}>
            {(asset.ownerLogin || asset.ownerName) && (
              <Group gap={4}>
                <IconUser size={12} />
                <Text size="xs" c="dimmed">
                  {asset.ownerName || asset.ownerLogin}
                </Text>
              </Group>
            )}
          </Group>
          <Group gap={4}>
            <IconClock size={12} />
            <Text size="xs" c="dimmed">
              {formatDate(asset.createdAt)}
            </Text>
          </Group>
        </Group>
      </Stack>
    </Box>
  )
}

function TapshowFullPageInner(): JSX.Element {
  const openPreview = useUIStore((s) => s.openPreview)
  const { colorScheme } = useMantineColorScheme()
  const isDark = colorScheme === 'dark'

  const [assets, setAssets] = React.useState<PublicAssetDto[]>([])
  const [loading, setLoading] = React.useState(false)
  const [refreshing, setRefreshing] = React.useState(false)
  const [hasLoadedOnce, setHasLoadedOnce] = React.useState(false)
  const [mediaFilter, setMediaFilter] = React.useState<MediaFilter>('all')
  const [sortKey, setSortKey] = React.useState<SortKey>('createdAt')
  const [sortOrder, setSortOrder] = React.useState<SortOrder>('desc')
  const [visibleCount, setVisibleCount] = React.useState(30)
  const [pendingAssetId, setPendingAssetId] = React.useState<string | null>(() => getActiveAssetIdFromLocation())
  const loadMoreRef = React.useRef<HTMLDivElement | null>(null)

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

  return (
    <div className="tapshow-fullpage-root" style={{ background }}>
      <ToastHost />
      <PreviewModal />
      <Container size="xl" px="md">
        <Box pt="md" pb="sm">
          <Group justify="space-between" align="center" mb="md">
            <Group gap={10} align="center">
              <Button
                size="xs"
                variant="subtle"
                leftSection={<IconArrowLeft size={14} />}
                onClick={() => {
                  if (typeof window !== 'undefined') {
                    window.location.href = '/'
                  }
                }}
              >
                返回 TapCanvas
              </Button>
            </Group>
            <Group gap={6}>
              <Tooltip label="刷新" withArrow>
                <ActionIcon
                  size="sm"
                  variant="subtle"
                  aria-label="刷新 TapShow 作品"
                  onClick={() => {
                    if (!loading && !refreshing) reloadAssets()
                  }}
                  loading={refreshing || loading}
                >
                  <IconRefresh size={14} />
                </ActionIcon>
              </Tooltip>
            </Group>
          </Group>

          <Stack gap={6} mb="lg">
            <Title order={2} className="tapshow-fullpage-title">
              TapShow 作品展
            </Title>
            <Text size="sm" c="dimmed" maw={620}>
              展示社区里用户公开的图片与视频作品。后续会支持按时长、热度等条件筛选排序。
            </Text>
          </Stack>

          <Group justify="space-between" align="center" mb="md" wrap="wrap" gap={8}>
            <Group gap={8} wrap="wrap">
              <SegmentedControl
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
                size="sm"
                radius="xl"
                variant="light"
                aria-label="切换排序方向"
                onClick={() => setSortOrder((o) => (o === 'desc' ? 'asc' : 'desc'))}
              >
                {sortOrder === 'desc' ? <IconSortDescending size={14} /> : <IconFilter size={14} />}
              </ActionIcon>
            </Group>

            <Text size="xs" c="dimmed">
              共 {filteredAssets.length} 个公开作品
            </Text>
          </Group>
        </Box>

        <Box pb="xl">
          {loading && !hasLoadedOnce ? (
            <Center mih={260}>
              <Stack gap={8} align="center">
                <Loader size="sm" />
                <Text size="sm" c="dimmed">
                  正在加载作品…
                </Text>
              </Stack>
            </Center>
          ) : !filteredAssets.length ? (
            <Center mih={260}>
              <Stack gap={6} align="center">
                <Text size="sm" fw={500}>
                  暂无公开作品
                </Text>
                <Text size="xs" c="dimmed" ta="center" maw={420}>
                  公开上传到 OSS 的图片 / 视频会自动出现在这里。
                </Text>
              </Stack>
            </Center>
          ) : (
            <SimpleGrid
              cols={{ base: 1, sm: 2, md: 3, lg: 4 }}
              spacing={{ base: 'md', md: 'lg' }}
              className="tapshow-grid"
            >
              {visibleAssets.map((asset) => (
                <TapshowCard key={asset.id} asset={asset} onPreview={handlePreview} />
              ))}
            </SimpleGrid>
          )}

          {hasMore && (
            <Center mt="lg" ref={loadMoreRef}>
              <Button
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
  return <TapshowFullPageInner />
}

