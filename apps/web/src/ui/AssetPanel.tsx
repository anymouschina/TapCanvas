import React from 'react'
import {
  Paper,
  Title,
  SimpleGrid,
  Card,
  Image,
  Text,
  Button,
  Group,
  Stack,
  Transition,
  Tabs,
  ActionIcon,
  Tooltip,
  Loader,
  Center,
  SegmentedControl,
  Badge,
  useMantineColorScheme,
} from '@mantine/core'
import {
  IconPlayerPlay,
  IconTrash,
  IconPencil,
  IconCopy,
  IconRefresh,
  IconPlus,
  IconPhoto,
  IconVideo,
} from '@tabler/icons-react'
import { useRFStore } from '../canvas/store'
import { useUIStore } from './uiStore'
import { ASSET_REFRESH_EVENT } from './assetEvents'
import { calculateSafeMaxHeight } from './utils/panelPosition'
import { toast } from './toast'
import { listServerAssets, renameServerAsset, deleteServerAsset, type ServerAssetDto } from '../api/server'
import { extractFirstFrame } from './videoThumb'

type GenerationAssetData = {
  kind?: string
  type?: 'image' | 'video'
  url?: string
  thumbnailUrl?: string | null
  prompt?: string | null
  vendor?: string | null
  taskKind?: string | null
  modelKey?: string | null
}

function PlaceholderImage({ label }: { label: string }) {
  const { colorScheme } = useMantineColorScheme()
  const isDark = colorScheme === 'dark'
  const start = isDark ? '#1f2937' : '#cfd8e3'
  const end = isDark ? '#0b0b0d' : '#f8fafc'
  const textColor = isDark ? '#e5e7eb' : '#0f172a'
  const svg = encodeURIComponent(
    `<?xml version="1.0" encoding="UTF-8"?><svg xmlns='http://www.w3.org/2000/svg' width='480' height='270'><defs><linearGradient id='g' x1='0' x2='1'><stop offset='0%' stop-color='${start}'/><stop offset='100%' stop-color='${end}'/></linearGradient></defs><rect width='100%' height='100%' fill='url(#g)'/><text x='50%' y='50%' fill='${textColor}' dominant-baseline='middle' text-anchor='middle' font-size='16' font-family='system-ui'>${label}</text></svg>`,
  )
  return <Image src={`data:image/svg+xml;charset=UTF-8,${svg}`} alt={label} radius="sm" />
}

function getGenerationData(asset: ServerAssetDto): GenerationAssetData {
  const data = (asset.data || {}) as any
  const type = typeof data.type === 'string' ? (data.type.toLowerCase() as 'image' | 'video') : undefined
  return {
    kind: typeof data.kind === 'string' ? data.kind : undefined,
    type: type === 'image' || type === 'video' ? type : undefined,
    url: typeof data.url === 'string' ? data.url : undefined,
    thumbnailUrl: typeof data.thumbnailUrl === 'string' ? data.thumbnailUrl : null,
    prompt: typeof data.prompt === 'string' ? data.prompt : undefined,
    vendor: typeof data.vendor === 'string' ? data.vendor : undefined,
    taskKind: typeof data.taskKind === 'string' ? data.taskKind : undefined,
    modelKey: typeof data.modelKey === 'string' ? data.modelKey : undefined,
  }
}

function isGenerationAsset(asset: ServerAssetDto): boolean {
  const data = getGenerationData(asset)
  return !!data.url && (data.type === 'image' || data.type === 'video' || data.kind === 'generation')
}

function isWorkflowAsset(asset: ServerAssetDto): boolean {
  const data = asset.data || {}
  return Array.isArray((data as any).nodes) && Array.isArray((data as any).edges)
}

function formatDate(ts: string) {
  const date = new Date(ts)
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  const hh = String(date.getHours()).padStart(2, '0')
  const mi = String(date.getMinutes()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`
}

export default function AssetPanel(): JSX.Element | null {
  const active = useUIStore((s) => s.activePanel)
  const setActivePanel = useUIStore((s) => s.setActivePanel)
  const anchorY = useUIStore((s) => s.panelAnchorY)
  const openPreview = useUIStore((s) => s.openPreview)
  const { colorScheme } = useMantineColorScheme()
  const isDark = colorScheme === 'dark'
  const addNode = useRFStore((s) => s.addNode)
  const mounted = active === 'assets'
  const [assets, setAssets] = React.useState<ServerAssetDto[]>([])
  const [tab, setTab] = React.useState<'generated' | 'workflow'>('generated')
  const [mediaFilter, setMediaFilter] = React.useState<'all' | 'image' | 'video'>('all')
  const [loading, setLoading] = React.useState(false)
  const [refreshing, setRefreshing] = React.useState(false)
  const [generatedThumbs, setGeneratedThumbs] = React.useState<Record<string, string | null>>({})
  const thumbStatusRef = React.useRef<Record<string, 'pending' | 'running' | 'done'>>({})
  const activeThumbJobsRef = React.useRef(0)

  const reloadAssets = React.useCallback(async () => {
    setLoading(true)
    try {
      const data = await listServerAssets()
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

  React.useEffect(() => {
    if (typeof window === 'undefined') return
    const handler = () => {
      if (!mounted) return
      reloadAssets().catch(() => {})
    }
    window.addEventListener(ASSET_REFRESH_EVENT, handler)
    return () => window.removeEventListener(ASSET_REFRESH_EVENT, handler)
  }, [mounted, reloadAssets])

  const generationAssets = React.useMemo(() => assets.filter(isGenerationAsset), [assets])
  const workflowAssets = React.useMemo(() => assets.filter(isWorkflowAsset), [assets])

  const filteredGenerationAssets = React.useMemo(() => {
    if (mediaFilter === 'all') return generationAssets
    return generationAssets.filter((a) => getGenerationData(a).type === mediaFilter)
  }, [generationAssets, mediaFilter])

  const MAX_THUMB_JOBS = 2

  const runNextThumbJob = React.useCallback(() => {
    if (activeThumbJobsRef.current >= MAX_THUMB_JOBS) return
    const entries = Object.entries(thumbStatusRef.current)
    const nextEntry = entries.find(([, status]) => status === 'pending')
    if (!nextEntry) return
    const [assetId] = nextEntry
    const asset = generationAssets.find((a) => a.id === assetId)
    if (!asset) {
      thumbStatusRef.current[assetId] = 'done'
      return
    }
    const data = getGenerationData(asset)
    if (data.type !== 'video' || !data.url) {
      thumbStatusRef.current[assetId] = 'done'
      return
    }
    thumbStatusRef.current[assetId] = 'running'
    activeThumbJobsRef.current += 1

    extractFirstFrame(data.url)
      .then((thumb) => {
        if (thumb) {
          setGeneratedThumbs((prev) => {
            if (prev[assetId]) return prev
            return { ...prev, [assetId]: thumb }
          })
        } else {
          setGeneratedThumbs((prev) => (prev[assetId] ? prev : { ...prev, [assetId]: null }))
        }
      })
      .catch(() => {
        setGeneratedThumbs((prev) => (prev[assetId] ? prev : { ...prev, [assetId]: null }))
      })
      .finally(() => {
        activeThumbJobsRef.current -= 1
        thumbStatusRef.current[assetId] = 'done'
        // 尝试继续处理队列中的下一个任务
        runNextThumbJob()
      })
  }, [generationAssets])

  React.useEffect(() => {
    if (!mounted) return
    // 收集需要生成缩略图的视频资产
    generationAssets.forEach((asset) => {
      const data = getGenerationData(asset)
      if (data.type !== 'video') return
      if (!data.url) return
      if (data.thumbnailUrl) return
      if (generatedThumbs[asset.id] !== undefined) return
      if (!thumbStatusRef.current[asset.id]) {
        thumbStatusRef.current[asset.id] = 'pending'
      }
    })
    runNextThumbJob()
  }, [mounted, generationAssets, generatedThumbs, runNextThumbJob])

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast('已复制链接', 'success')
    } catch (err) {
      console.error(err)
      toast('复制失败，请手动复制', 'error')
    }
  }

  const handleDelete = async (asset: ServerAssetDto) => {
    if (!confirm(`确定删除「${asset.name}」吗？`)) return
    try {
      await deleteServerAsset(asset.id)
      setAssets((prev) => prev.filter((a) => a.id !== asset.id))
    } catch (err: any) {
      console.error(err)
      toast(err?.message || '删除失败', 'error')
    }
  }

  const handleRename = async (asset: ServerAssetDto) => {
    const next = prompt('重命名：', asset.name)?.trim()
    if (!next || next === asset.name) return
    try {
      await renameServerAsset(asset.id, next)
      setAssets((prev) => prev.map((a) => (a.id === asset.id ? { ...a, name: next } : a)))
    } catch (err: any) {
      console.error(err)
      toast(err?.message || '重命名失败', 'error')
    }
  }

  const applyAssetAt = (assetId: string, pos: { x: number; y: number }) => {
    const rec = assets.find((a) => a.id === assetId)
    if (!rec) return

    const data: any = rec.data || { nodes: [], edges: [] }
    if (!data.nodes || data.nodes.length === 0) return

    const validNodes = data.nodes.filter((n: any) => {
      return (
        n &&
        n.id &&
        n.type &&
        n.position &&
        typeof n.position.x === 'number' &&
        typeof n.position.y === 'number'
      )
    })

    const validEdges = (data.edges || []).filter((e: any) => {
      return (
        e &&
        e.id &&
        e.source &&
        e.target &&
        validNodes.some((n: any) => n.id === e.source) &&
        validNodes.some((n: any) => n.id === e.target)
      )
    })

    if (validNodes.length === 0) return

    const minX = Math.min(...validNodes.map((n: any) => n.position.x))
    const minY = Math.min(...validNodes.map((n: any) => n.position.y))
    const dx = pos.x - minX
    const dy = pos.y - minY

    const idMap: { [oldId: string]: string } = {}

    const nodes = validNodes.map((n: any) => {
      const timestamp = Date.now()
      const random = Math.random().toString(36).slice(2, 10)
      const newId = `n${timestamp}_${random}`
      idMap[n.id] = newId

      return {
        id: newId,
        type: n.type,
        position: { x: n.position.x + dx, y: n.position.y + dy },
        data: {
          ...(n.data || {}),
          status: undefined,
          taskId: undefined,
          imageResults: undefined,
          videoResults: undefined,
          audioUrl: undefined,
          imageUrl: undefined,
          videoUrl: undefined,
          videoThumbnailUrl: undefined,
          videoTitle: undefined,
          videoDurationSeconds: undefined,
          lastText: undefined,
          textResults: undefined,
          lastError: undefined,
          progress: undefined,
          parentId: undefined,
        },
        selected: false,
        dragging: false,
        hidden: false,
        deletable: true,
        selectable: true,
        dragHandle: undefined,
        zIndex: 1,
        focusable: true,
        connectable: true,
      }
    })

    const edges = validEdges.map((e: any) => {
      const timestamp = Date.now()
      const random = Math.random().toString(36).slice(2, 10)
      const newEdgeId = `e${timestamp}_${random}`

      return {
        id: newEdgeId,
        source: idMap[e.source] || e.source,
        target: idMap[e.target] || e.target,
        type: e.type || 'default',
        sourceHandle: e.sourceHandle,
        targetHandle: e.targetHandle,
        animated: false,
        selected: false,
        hidden: false,
        data: e.data || {},
        deletable: true,
        selectable: true,
        focusable: true,
        updatable: true,
      }
    })

    const currentNodes = useRFStore.getState().nodes
    const currentEdges = useRFStore.getState().edges

    const validCurrentNodes = currentNodes.filter((n: any) => {
      if (n.parentNode) {
        return currentNodes.some((parent: any) => parent.id === n.parentNode)
      }
      return true
    })

    const validCurrentEdges = currentEdges.filter((e: any) => {
      return currentNodes.some((n: any) => n.id === e.source) && currentNodes.some((n: any) => n.id === e.target)
    })

    const newNodes = [...validCurrentNodes, ...nodes]
    const newEdges = [...validCurrentEdges, ...edges]

    const maxId = Math.max(
      ...newNodes.map((n: any) => {
        const match = n.id.match(/\d+/)
        return match ? parseInt(match[0], 10) : 0
      }),
    )

    useRFStore.setState({
      nodes: newNodes,
      edges: newEdges,
      nextId: maxId + 1,
    })
  }

  if (!mounted) return null

  const maxHeight = calculateSafeMaxHeight(anchorY, 150)

  const renderGenerationCard = (asset: ServerAssetDto) => {
    const data = getGenerationData(asset)
    const isVideo = data.type === 'video'
    const generated = generatedThumbs[asset.id] || null
    const cover = isVideo ? generated || data.thumbnailUrl || null : data.thumbnailUrl || data.url
    const label = asset.name || (isVideo ? '视频' : '图片')
    return (
      <Card key={asset.id} withBorder radius="md" shadow="sm">
        {isVideo ? (
          data.url ? (
            <div
              style={{
                borderRadius: 8,
                overflow: 'hidden',
                height: 160,
              }}
            >
              <video
                src={data.url}
                poster={cover || undefined}
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                controls
                playsInline
              />
            </div>
          ) : (
            <PlaceholderImage label="视频" />
          )
        ) : cover ? (
          <Image
            src={cover}
            alt={label}
            radius="sm"
            height={160}
            fit="cover"
          />
        ) : (
          <PlaceholderImage label={label} />
        )}
        <Stack gap={6} mt="sm">
          <Group gap="xs">
            <Badge size="xs" color={isVideo ? 'violet' : 'teal'} leftSection={isVideo ? <IconVideo size={12} /> : <IconPhoto size={12} />}>
              {isVideo ? '视频' : '图片'}
            </Badge>
            {data.vendor && (
              <Badge size="xs" variant="light">
                {data.vendor}
              </Badge>
            )}
            {data.modelKey && (
              <Badge size="xs" variant="outline">
                {data.modelKey}
              </Badge>
            )}
          </Group>
          <Text size="sm" fw={600} lineClamp={1}>
            {label}
          </Text>
          {data.prompt && (
            <Text size="xs" c="dimmed" lineClamp={2}>
              {data.prompt}
            </Text>
          )}
          <Text size="xs" c="dimmed">
            {formatDate(asset.createdAt)}
          </Text>
          <Group justify="flex-end" gap={4}>
            <Tooltip label="预览" withArrow>
              <ActionIcon
                size="sm"
                variant="subtle"
                onClick={() => {
                  if (!data.url) return
                  openPreview({ url: data.url, kind: isVideo ? 'video' : 'image', name: asset.name })
                }}
              >
                {isVideo ? <IconPlayerPlay size={16} /> : <IconPhoto size={16} />}
              </ActionIcon>
            </Tooltip>
            {data.url && (
              <Tooltip label="加入画布" withArrow>
                <ActionIcon
                  size="sm"
                  variant="light"
                  onClick={() => {
                    const kind = isVideo ? 'video' : 'image'
                    addNode('taskNode', label, {
                      kind,
                      autoLabel: false,
                      prompt: data.prompt || '',
                      imageUrl: !isVideo ? data.url : undefined,
                      videoUrl: isVideo ? data.url : undefined,
                      videoThumbnailUrl: isVideo ? data.thumbnailUrl || undefined : undefined,
                      imageResults: !isVideo && data.url ? [{ url: data.url }] : undefined,
                      videoResults: isVideo && data.url ? [{ url: data.url, thumbnailUrl: data.thumbnailUrl || undefined }] : undefined,
                      modelKey: data.modelKey,
                      source: data.vendor || 'asset',
                    })
                    setActivePanel(null)
                  }}
                >
                  <IconPlus size={16} />
                </ActionIcon>
              </Tooltip>
            )}
            {data.url && (
              <Tooltip label="复制链接" withArrow>
                <ActionIcon size="sm" variant="subtle" onClick={() => handleCopy(data.url || '')}>
                  <IconCopy size={16} />
                </ActionIcon>
              </Tooltip>
            )}
            <Tooltip label="重命名" withArrow>
              <ActionIcon size="sm" variant="subtle" onClick={() => handleRename(asset)}>
                <IconPencil size={16} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="删除" withArrow>
              <ActionIcon size="sm" variant="subtle" color="red" onClick={() => handleDelete(asset)}>
                <IconTrash size={16} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Stack>
      </Card>
    )
  }

  const renderWorkflowCard = (asset: ServerAssetDto) => (
    <Card key={asset.id} withBorder radius="md" shadow="sm">
      <PlaceholderImage label={asset.name} />
      <Stack gap={6} mt="sm">
        <Text size="sm" fw={600} lineClamp={1}>
          {asset.name}
        </Text>
        <Text size="xs" c="dimmed">
          {formatDate(asset.updatedAt)}
        </Text>
        <Group justify="flex-end" gap={4}>
          <Tooltip label="添加到画布" withArrow>
            <ActionIcon
              size="sm"
              variant="light"
              onClick={() => {
                const pos = { x: 200, y: anchorY || 200 }
                applyAssetAt(asset.id, pos)
                setActivePanel(null)
              }}
            >
              <IconPlus size={16} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="重命名" withArrow>
            <ActionIcon size="sm" variant="subtle" onClick={() => handleRename(asset)}>
              <IconPencil size={16} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="删除" withArrow>
            <ActionIcon size="sm" variant="subtle" color="red" onClick={() => handleDelete(asset)}>
              <IconTrash size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Stack>
    </Card>
  )

  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      await reloadAssets()
    } finally {
      setRefreshing(false)
    }
  }

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
              <Group justify="space-between" mb={8} style={{ position: 'sticky', top: 0, zIndex: 1, background: 'transparent' }}>
                <Title order={6}>我的资产</Title>
                <Group gap="xs">
                  <Tooltip label="刷新" withArrow>
                    <ActionIcon size="sm" variant="light" onClick={handleRefresh} loading={refreshing || loading}>
                      <IconRefresh size={16} />
                    </ActionIcon>
                  </Tooltip>
                  <Button size="xs" variant="subtle" onClick={() => setActivePanel(null)}>
                    关闭
                  </Button>
                </Group>
              </Group>
              <div style={{ flex: 1, overflowY: 'auto', paddingRight: 4, minHeight: 0 }}>
                <Tabs value={tab} onChange={(v) => setTab((v as any) || 'generated')}>
                  <Tabs.List>
                    <Tabs.Tab value="generated">生成内容</Tabs.Tab>
                    <Tabs.Tab value="workflow">工作流片段</Tabs.Tab>
                  </Tabs.List>
                  <Tabs.Panel value="generated" pt="xs">
                    <Stack gap="sm">
                      <Group justify="space-between" align="center">
                        <Text size="sm" c="dimmed">
                          已自动保存的生成结果（图片 / 视频）
                        </Text>
                        <SegmentedControl
                          size="xs"
                          radius="xl"
                          variant="filled"
                          color={isDark ? 'blue' : 'dark'}
                          value={mediaFilter}
                          onChange={(v) => setMediaFilter(v as any)}
                          data={[
                            { value: 'all', label: '全部' },
                            { value: 'image', label: '图片' },
                            { value: 'video', label: '视频' },
                          ]}
                        />
                      </Group>
                      {loading ? (
                        <Center py="md">
                          <Group gap="xs">
                            <Loader size="sm" />
                            <Text size="xs" c="dimmed">
                              加载中…
                            </Text>
                          </Group>
                        </Center>
                      ) : filteredGenerationAssets.length === 0 ? (
                        <Text size="xs" c="dimmed">
                          暂无生成内容
                        </Text>
                      ) : (
                        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
                          {filteredGenerationAssets.map((asset) => renderGenerationCard(asset))}
                        </SimpleGrid>
                      )}
                    </Stack>
                  </Tabs.Panel>
                  <Tabs.Panel value="workflow" pt="xs">
                    <Stack gap="sm">
                      <Text size="sm" c="dimmed">
                        保存的工作流片段（节点组合）
                      </Text>
                      {loading ? (
                        <Center py="md">
                          <Group gap="xs">
                            <Loader size="sm" />
                            <Text size="xs" c="dimmed">
                              加载中…
                            </Text>
                          </Group>
                        </Center>
                      ) : workflowAssets.length === 0 ? (
                        <Text size="xs" c="dimmed">
                          暂无工作流片段
                        </Text>
                      ) : (
                        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
                          {workflowAssets.map((asset) => renderWorkflowCard(asset))}
                        </SimpleGrid>
                      )}
                    </Stack>
                  </Tabs.Panel>
                </Tabs>
              </div>
            </Paper>
          </div>
        )}
      </Transition>
    </div>
  )
}
