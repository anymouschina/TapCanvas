import React from 'react'
import {
  Paper,
  Group,
  Title,
  Transition,
  Button,
  Stack,
  Text,
  ActionIcon,
  SimpleGrid,
  Card,
  Image,
  Loader,
  Center,
  Badge,
  Tooltip,
} from '@mantine/core'
import { IconPlayerPlay, IconPhoto, IconCopy, IconRefresh } from '@tabler/icons-react'
import { useUIStore } from './uiStore'
import { calculateSafeMaxHeight } from './utils/panelPosition'
import { listPublicAssets, type PublicAssetDto } from '../api/server'
import { toast } from './toast'

function formatDate(ts: string) {
  const date = new Date(ts)
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  const hh = String(date.getHours()).padStart(2, '0')
  const mi = String(date.getMinutes()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`
}

export default function TapshowPanel(): JSX.Element | null {
  const active = useUIStore((s) => s.activePanel)
  const setActivePanel = useUIStore((s) => s.setActivePanel)
  const anchorY = useUIStore((s) => s.panelAnchorY)
  const openPreview = useUIStore((s) => s.openPreview)

  const mounted = active === 'tapshow'
  const [assets, setAssets] = React.useState<PublicAssetDto[]>([])
  const [loading, setLoading] = React.useState(false)
  const [refreshing, setRefreshing] = React.useState(false)

  const maxHeight = calculateSafeMaxHeight(anchorY, 150)

  const reloadAssets = React.useCallback(async () => {
    setLoading(true)
    try {
      const data = await listPublicAssets(48)
      setAssets(data || [])
    } catch (err: any) {
      console.error(err)
      toast(err?.message || '加载资产失败', 'error')
      setAssets([])
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    if (!mounted) return
    reloadAssets().catch(() => {})
  }, [mounted, reloadAssets])

  const hostedAssets = assets

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast('已复制链接', 'success')
    } catch (err) {
      console.error(err)
      toast('复制失败，请手动复制', 'error')
    }
  }

  const handleRefresh = () => {
    setRefreshing(true)
    reloadAssets()
      .catch(() => {})
      .finally(() => setRefreshing(false))
  }

  if (!mounted) return null

  return (
    <div style={{ position: 'fixed', left: 82, top: anchorY ? anchorY - 150 : 140, zIndex: 200 }} data-ux-panel>
      <Transition mounted={mounted} transition="pop" duration={140} timingFunction="ease">
        {(styles) => (
          <div style={styles}>
            <Paper
              withBorder
              shadow="md"
              radius="lg"
              className="glass"
              p="md"
              style={{
                width: 660,
                maxHeight: `${maxHeight}px`,
                minHeight: 0,
                transformOrigin: 'left center',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
              }}
              data-ux-panel
            >
              <div className="panel-arrow" />
              <Group
                justify="space-between"
                mb={8}
                style={{ position: 'sticky', top: 0, zIndex: 1, background: 'transparent' }}
              >
                <Stack gap={2}>
                  <Title order={6}>TapShow</Title>
                  <Text size="xs" c="dimmed">
                    展示所有通过 TapCanvas OSS 托管的公开图片 / 视频作品
                  </Text>
                </Stack>
                <Group gap="xs">
                  <Tooltip label="刷新" withArrow>
                    <ActionIcon
                      size="sm"
                      variant="light"
                      onClick={handleRefresh}
                      loading={refreshing || loading}
                    >
                      <IconRefresh size={16} />
                    </ActionIcon>
                  </Tooltip>
                  <Button size="xs" variant="subtle" onClick={() => setActivePanel(null)}>
                    关闭
                  </Button>
                </Group>
              </Group>

              <div style={{ flex: 1, overflowY: 'auto', paddingRight: 4, minHeight: 0 }}>
                {loading && !hostedAssets.length ? (
                  <Center py="md">
                    <Group gap="xs">
                      <Loader size="sm" />
                      <Text size="xs" c="dimmed">
                        加载中…
                      </Text>
                    </Group>
                  </Center>
                ) : (
                  <>
                    {!hostedAssets.length && !loading && (
                      <Text size="xs" c="dimmed">
                        暂无公开作品。使用支持图片 / 视频生成的节点并启用 OSS 托管后，作品会自动出现在这里。
                      </Text>
                    )}
                    {hostedAssets.length > 0 && (
                      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
                        {hostedAssets.map((asset) => {
                          const isVideo = asset.type === 'video'
                          const cover = asset.thumbnailUrl || asset.url
                          const label = asset.name || (isVideo ? '视频资产' : '图片资产')
                          return (
                            <Card key={asset.id} withBorder radius="md" shadow="sm">
                              {isVideo ? (
                                asset.url ? (
                                  <div
                                    style={{
                                      borderRadius: 8,
                                      overflow: 'hidden',
                                      height: 160,
                                    }}
                                  >
                                    <video
                                      src={asset.url}
                                      poster={cover || undefined}
                                      style={{
                                        width: '100%',
                                        height: '100%',
                                        objectFit: 'cover',
                                        display: 'block',
                                      }}
                                      controls
                                      playsInline
                                    />
                                  </div>
                                ) : (
                                  <div
                                    style={{
                                      height: 160,
                                      borderRadius: 8,
                                      background:
                                        'linear-gradient(135deg, rgba(15,23,42,0.9), rgba(37,99,235,0.7))',
                                    }}
                                  />
                                )
                              ) : cover ? (
                                <Image src={cover} alt={label} radius="sm" height={160} fit="cover" />
                              ) : (
                                <div
                                  style={{
                                    height: 160,
                                    borderRadius: 8,
                                    background:
                                      'linear-gradient(135deg, rgba(15,23,42,0.9), rgba(37,99,235,0.7))',
                                  }}
                                />
                              )}
                              <Stack gap={6} mt="sm">
                                <Group gap="xs">
                                  <Badge
                                    size="xs"
                                    color={isVideo ? 'violet' : 'teal'}
                                    leftSection={
                                      isVideo ? <IconPlayerPlay size={12} /> : <IconPhoto size={12} />
                                    }
                                  >
                                    {isVideo ? '视频' : '图片'}
                                  </Badge>
                                  {asset.modelKey && (
                                    <Badge size="xs" variant="light">
                                      {asset.modelKey}
                                    </Badge>
                                  )}
                                  {asset.vendor && (
                                    <Badge size="xs" variant="outline">
                                      {asset.vendor}
                                    </Badge>
                                  )}
                                  {asset.ownerLogin && (
                                    <Badge size="xs" variant="outline">
                                      {asset.ownerLogin}
                                    </Badge>
                                  )}
                                </Group>
                                <Text size="sm" fw={600} lineClamp={1}>
                                  {label}
                                </Text>
                                {asset.prompt && (
                                  <Text size="xs" c="dimmed" lineClamp={2}>
                                    {asset.prompt}
                                  </Text>
                                )}
                                <Text size="xs" c="dimmed">
                                  {formatDate(asset.createdAt)}
                                </Text>
                                <Group justify="flex-end" gap={4}>
                                  {asset.url && (
                                    <Tooltip label="预览" withArrow>
                                      <ActionIcon
                                        size="sm"
                                        variant="subtle"
                                        onClick={() =>
                                          openPreview({
                                            url: asset.url || '',
                                            kind: isVideo ? 'video' : 'image',
                                            name: label,
                                          })
                                        }
                                      >
                                        {isVideo ? <IconPlayerPlay size={16} /> : <IconPhoto size={16} />}
                                      </ActionIcon>
                                    </Tooltip>
                                  )}
                                  {asset.url && (
                                    <Tooltip label="复制链接" withArrow>
                                      <ActionIcon
                                        size="sm"
                                        variant="subtle"
                                        onClick={() => handleCopy(asset.url || '')}
                                      >
                                        <IconCopy size={16} />
                                      </ActionIcon>
                                    </Tooltip>
                                  )}
                                </Group>
                              </Stack>
                            </Card>
                          )
                        })}
                      </SimpleGrid>
                    )}
                  </>
                )}
              </div>
            </Paper>
          </div>
        )}
      </Transition>
    </div>
  )
}
