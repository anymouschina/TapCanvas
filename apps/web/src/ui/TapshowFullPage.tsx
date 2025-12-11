import React from 'react'
import { ActionIcon, Badge, Box, Button, Center, Container, Group, Loader, SegmentedControl, SimpleGrid, Stack, Text, Title, useMantineColorScheme } from '@mantine/core'
import {
  IconArrowLeft,
  IconClock,
  IconExternalLink,
  IconPhoto,
  IconPlayerPlay,
  IconRefresh,
  IconSparkles,
  IconUser,
} from '@tabler/icons-react'
import { listPublicAssets, type PublicAssetDto } from '../api/server'
import PreviewModal from './PreviewModal'
import { useUIStore } from './uiStore'
import { ToastHost, toast } from './toast'
import { ShowcaseSection } from '../components/ShowcaseSection'
import { useAuth } from '../auth/store'

type MediaFilter = 'all' | 'image' | 'video'
const VITE_WEBCUT_URL = import.meta.env.VITE_WEBCUT_URL
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
  const hh = String(date.getHours()).padStart(2, '0')
  const mi = String(date.getMinutes()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`
}

function resolveWebcutUrl(): string | null {
  const raw = VITE_WEBCUT_URL
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  return trimmed ? trimmed : null
}

type TapshowCardProps = {
  asset: PublicAssetDto
  onPreview: (asset: PublicAssetDto) => void
  style?: React.CSSProperties
}

function TapshowCard({ asset, onPreview, style }: TapshowCardProps) {
  const isVideo = asset.type === 'video'
  const cover = asset.thumbnailUrl || asset.url
  const label = asset.name || (isVideo ? '视频作品' : '图片作品')
  const subtitle =
    asset.prompt && asset.prompt.trim().length > 0
      ? asset.prompt.trim()
      : asset.projectName || asset.ownerName || asset.ownerLogin || ''

  return (
    <Box
      className="tapshow-card"
      style={style}
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
                const el = e.currentTarget
                el.pause()
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
        <Group justify="space-between" align="center">
          <Text size="sm" fw={600} className="tapshow-card-title" lineClamp={1}>
            {label}
          </Text>
        </Group>
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
            {asset.projectName && (
              <Badge size="xs" radius="xl" variant="light" color="gray">
                {asset.projectName}
              </Badge>
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
  const token = useAuth((s) => s.token)
  const webcutUrl = React.useMemo(() => {
    const base = resolveWebcutUrl()
    if (!base) return null
    if (!token) return base
    try {
      const url = new URL(base, typeof window !== 'undefined' ? window.location.origin : undefined)
      url.searchParams.set('tap_token', token)
      return url.toString()
    } catch {
      const [path, hash] = base.split('#')
      const sep = path.includes('?') ? '&' : '?'
      return `${path}${sep}tap_token=${encodeURIComponent(token)}${hash ? `#${hash}` : ''}`
    }
  }, [token])

  const [assets, setAssets] = React.useState<PublicAssetDto[]>([])
  const [loading, setLoading] = React.useState(false)
  const [refreshing, setRefreshing] = React.useState(false)
  const [hasLoadedOnce, setHasLoadedOnce] = React.useState(false)
  const [mediaFilter, setMediaFilter] = React.useState<MediaFilter>('all')
  const [visibleCount, setVisibleCount] = React.useState(24)
  const [pendingAssetId, setPendingAssetId] = React.useState<string | null>(() => getActiveAssetIdFromLocation())
  const loadMoreRef = React.useRef<HTMLDivElement | null>(null)

  const reloadAssets = React.useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!opts?.silent) {
        setLoading(true)
      }
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
    setVisibleCount(24)
  }, [mediaFilter, assets.length])

  const sortedAssets = React.useMemo(() => {
    const list = [...assets]
    list.sort((a, b) => {
      const ta = new Date(a.createdAt).getTime()
      const tb = new Date(b.createdAt).getTime()
      return Number.isNaN(tb) || Number.isNaN(ta) ? 0 : tb - ta
    })
    return list
  }, [assets])

  const filteredAssets = React.useMemo(() => {
    if (mediaFilter === 'all') return sortedAssets
    return sortedAssets.filter((asset) => asset.type === mediaFilter)
  }, [sortedAssets, mediaFilter])

  const featuredAssets = React.useMemo(() => filteredAssets.slice(0, 8), [filteredAssets])
  const secondaryAssets = React.useMemo(() => filteredAssets.slice(8, 16), [filteredAssets])
  const gridAssets = React.useMemo(() => filteredAssets.slice(16), [filteredAssets])

  const visibleGridAssets = React.useMemo(
    () => gridAssets.slice(0, Math.max(visibleCount, 24)),
    [gridAssets, visibleCount],
  )

  const hasMore = visibleGridAssets.length < gridAssets.length

  const handlePreview = React.useCallback(
    (asset: PublicAssetDto, opts?: { preserveUrl?: boolean }) => {
      if (!asset.url) return
      const isVideo = asset.type === 'video'
      const label = asset.name || (isVideo ? '视频作品' : '图片作品')
      openPreview({
        url: asset.url,
        kind: isVideo ? 'video' : 'image',
        name: label,
      })
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
    // 初次从 URL 打开时，保持当前 URL，仅触发预览
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
    return () => {
      unsub()
    }
  }, [])

  React.useEffect(() => {
    if (!hasMore) return
    if (typeof IntersectionObserver === 'undefined') return
    const el = loadMoreRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (!entry.isIntersecting) return
        setVisibleCount((count) => {
          const next = Math.min(count + 24, gridAssets.length)
          return next
        })
      },
      { root: null, rootMargin: '0px 0px 240px 0px', threshold: 0.1 },
    )
    observer.observe(el)
    return () => {
      observer.disconnect()
    }
  }, [hasMore, gridAssets.length])

  const background = isDark
    ? 'radial-gradient(circle at 0% 0%, rgba(56,189,248,0.18), transparent 60%), radial-gradient(circle at 100% 0%, rgba(37,99,235,0.22), transparent 60%), radial-gradient(circle at 0% 100%, rgba(168,85,247,0.18), transparent 55%), linear-gradient(180deg, #020617 0%, #020617 40%, #020617 100%)'
    : 'radial-gradient(circle at 0% 0%, rgba(59,130,246,0.16), transparent 60%), radial-gradient(circle at 100% 0%, rgba(59,130,246,0.1), transparent 60%), radial-gradient(circle at 0% 100%, rgba(56,189,248,0.1), transparent 55%), linear-gradient(180deg, #eef2ff 0%, #e5edff 40%, #e5edff 100%)'

  return (
    <div className="tapshow-fullpage-root" style={{ background }}>
      <ToastHost />
      <PreviewModal />
      <Container size="xl" px="md">
        <Box pt="md" pb="sm">
          <Group justify="space-between" align="center" mb="md">
            <Group gap={10} align="center">
              <Box className="tapshow-logo-pill">
                <span className="tapshow-logo-dot" />
                <Text size="xs" fw={600} span>
                  TapShow
                </Text>
              </Box>
              <Badge
                size="xs"
                radius="xl"
                variant="light"
                color={isDark ? 'gray' : 'dark'}
                leftSection={<IconSparkles size={12} />}
              >
                AI 作品实时廊
              </Badge>
            </Group>
            <Group gap="xs">
              <Button
                size="xs"
                variant="subtle"
                leftSection={<IconArrowLeft size={14} />}
                onClick={() => {
                  try {
                    window.location.href = '/'
                  } catch {
                    // ignore
                  }
                }}
              >
                返回 TapCanvas
              </Button>
              {webcutUrl && (
                <Button
                  size="xs"
                  variant="light"
                  leftSection={<IconExternalLink size={14} />}
                  component="a"
                  href={webcutUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  打开 WebCut
                </Button>
              )}
              <ActionIcon
                size="sm"
                variant="subtle"
                aria-label="刷新 TapShow 作品"
                onClick={() => {
                  if (!loading && !refreshing) {
                    reloadAssets()
                  }
                }}
                loading={refreshing || loading}
              >
                <IconRefresh size={14} />
              </ActionIcon>
            </Group>
          </Group>
          <Stack gap={6} mb="lg">
            <Title order={2} className="tapshow-fullpage-title">
              面向 2C 的 <span className="tapshow-title-gradient">TapShow 作品展厅</span>
            </Title>
            <Text size="sm" c="dimmed" maw={520}>
              将 TapCanvas 中生成的图片与视频，通过 TapShow 以更具科技感和展示力的方式呈现给团队、客户或社区。
            </Text>
          </Stack>
          <Group justify="space-between" align="center" mb="md">
            <Text size="xs" c="dimmed">
              实时从 TapCanvas 云端加载最新公开作品，按时间倒序展示。
            </Text>
            <SegmentedControl
              size="xs"
              radius="xl"
              value={mediaFilter}
              onChange={(v) => setMediaFilter(v as MediaFilter)}
              data={[
                { value: 'all', label: '全部作品' },
                { value: 'video', label: '仅视频' },
                { value: 'image', label: '仅图片' },
              ]}
            />
          </Group>
        </Box>

        <Box pb="xl">
          {loading && !hasLoadedOnce ? (
            <Center mih={260}>
              <Stack gap={8} align="center">
                <Loader size="sm" />
                <Text size="sm" c="dimmed">
                  正在为你唤起 TapShow 作品…
                </Text>
              </Stack>
            </Center>
          ) : !filteredAssets.length ? (
            <Center mih={260}>
              <Stack gap={6} align="center">
                <Text size="sm" fw={500}>
                  暂无 TapShow 公开作品
                </Text>
                <Text size="xs" c="dimmed" ta="center" maw={420}>
                  在 TapCanvas 中启用 OSS 托管并公开图片 / 视频后，这里会自动出现你的作品列表，适合作为 Demo 或分享页。
                </Text>
              </Stack>
            </Center>
          ) : (
            <>
              {featuredAssets.length > 0 && (
                <ShowcaseSection
                  title="编辑精选"
                  subtitle="从最新公开作品中自动挑选，适合作为封面轮播或分享页首屏。"
                >
                  {featuredAssets.map((asset) => (
                    <TapshowCard
                      key={asset.id}
                      asset={asset}
                      onPreview={handlePreview}
                      style={{ minWidth: 280, maxWidth: 320, flex: '0 0 280px' }}
                    />
                  ))}
                </ShowcaseSection>
              )}

              {secondaryAssets.length > 0 && (
                <ShowcaseSection title="推荐频道" subtitle="按时间与作品类型混排，轻松浏览不同风格的创作。">
                  {secondaryAssets.map((asset) => (
                    <TapshowCard
                      key={asset.id}
                      asset={asset}
                      onPreview={handlePreview}
                      style={{ minWidth: 240, maxWidth: 280, flex: '0 0 240px' }}
                    />
                  ))}
                </ShowcaseSection>
              )}

              {gridAssets.length > 0 && (
                <Stack gap="xs">
                  <Group justify="space-between" align="center">
                    <Text size="sm" fw={500}>
                      全部作品
                    </Text>
                    <Text size="xs" c="dimmed">
                      共 {gridAssets.length} 个公开作品
                    </Text>
                  </Group>
                  <SimpleGrid
                    cols={{ base: 1, sm: 2, md: 3 }}
                    spacing={{ base: 'md', md: 'lg' }}
                    className="tapshow-grid"
                  >
                    {visibleGridAssets.map((asset) => (
                      <TapshowCard key={asset.id} asset={asset} onPreview={handlePreview} />
                    ))}
                  </SimpleGrid>
                </Stack>
              )}
              {hasMore && (
                <Center mt="lg" ref={loadMoreRef}>
                  <Button
                    size="xs"
                    variant="light"
                    onClick={() => {
                      setVisibleCount((count) => Math.min(count + 24, gridAssets.length))
                    }}
                  >
                    加载更多作品
                  </Button>
                </Center>
              )}
            </>
          )}
        </Box>
      </Container>
    </div>
  )
}

export default function TapshowFullPage(): JSX.Element {
  return <TapshowFullPageInner />
}
