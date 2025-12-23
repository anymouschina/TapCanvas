import React from 'react'
import { ActionIcon, Badge, Box, Button, Center, Container, Group, Loader, Modal, Paper, ScrollArea, Select, Stack, Text, Title, Tooltip, useMantineColorScheme } from '@mantine/core'
import { IconArrowLeft, IconCopy, IconCopyPlus, IconFileText, IconMessageCircle, IconRefresh } from '@tabler/icons-react'
import Canvas from '../canvas/Canvas'
import { cloneProject, getPublicProjectFlows, listPublicProjects, type FlowDto, type ProjectDto } from '../api/server'
import { useRFStore } from '../canvas/store'
import { useUIStore } from './uiStore'
import { toast } from './toast'

function sanitizeReadonlyGraph(payload: { nodes: any[]; edges: any[] }): { nodes: any[]; edges: any[] } {
  const nodes = (payload.nodes || []).map((n: any) => {
    const { selected: _selected, dragging: _dragging, positionAbsolute: _pa, ...rest } = n || {}
    return {
      ...rest,
      selected: false,
      draggable: false,
      selectable: false,
      focusable: false,
      connectable: false,
    }
  })
  const edges = (payload.edges || []).map((e: any) => {
    const { selected: _selected, ...rest } = e || {}
    return {
      ...rest,
      selected: false,
      selectable: false,
      focusable: false,
    }
  })
  return { nodes, edges }
}

function parseShareLocation(): { projectId: string | null; flowId: string | null } {
  if (typeof window === 'undefined') return { projectId: null, flowId: null }
  const parts = (window.location.pathname || '').split('/').filter(Boolean)
  const idx = parts.indexOf('share')
  const projectId = idx >= 0 ? (parts[idx + 1] ? decodeURIComponent(parts[idx + 1]) : null) : null
  const flowId = idx >= 0 ? (parts[idx + 2] ? decodeURIComponent(parts[idx + 2]) : null) : null
  return { projectId, flowId }
}

function buildShareUrl(projectId?: string | null, flowId?: string | null): string {
  if (typeof window === 'undefined') {
    const base = projectId ? `/share/${encodeURIComponent(projectId)}` : '/share'
    return flowId ? `${base}/${encodeURIComponent(flowId)}` : base
  }
  try {
    const url = new URL(window.location.href)
    url.search = ''
    url.hash = ''
    url.pathname = projectId
      ? flowId
        ? `/share/${encodeURIComponent(projectId)}/${encodeURIComponent(flowId)}`
        : `/share/${encodeURIComponent(projectId)}`
      : '/share'
    return url.toString()
  } catch {
    const base = projectId ? `/share/${encodeURIComponent(projectId)}` : '/share'
    return flowId ? `${base}/${encodeURIComponent(flowId)}` : base
  }
}

export default function ShareFullPage(): JSX.Element {
  const { projectId, flowId } = React.useMemo(() => parseShareLocation(), [])
  const setViewOnly = useUIStore((s) => s.setViewOnly)
  const setCurrentProject = useUIStore((s) => s.setCurrentProject)
  const setCurrentFlow = useUIStore((s) => s.setCurrentFlow)
  const openLangGraphChat = useUIStore((s) => s.openLangGraphChat)
  const closeLangGraphChat = useUIStore((s) => s.closeLangGraphChat)
  const rfLoad = useRFStore((s) => s.load)
  const { colorScheme } = useMantineColorScheme()
  const isDark = colorScheme === 'dark'

  const [loading, setLoading] = React.useState(false)
  const [refreshing, setRefreshing] = React.useState(false)
  const [publicProjects, setPublicProjects] = React.useState<ProjectDto[]>([])
  const [project, setProject] = React.useState<ProjectDto | null>(null)
  const [flows, setFlows] = React.useState<FlowDto[]>([])
  const [selectedFlowId, setSelectedFlowId] = React.useState<string | null>(flowId)
  const [promptModalOpen, setPromptModalOpen] = React.useState(false)
  const [cloning, setCloning] = React.useState(false)

  React.useEffect(() => {
    setViewOnly(true)
    return () => {
      setViewOnly(false)
      closeLangGraphChat()
    }
  }, [closeLangGraphChat, setViewOnly])

  const reload = React.useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true)
    setRefreshing(true)
    try {
      if (!projectId) {
        const projects = await listPublicProjects()
        setPublicProjects(projects || [])
        return
      }

      const [projects, projectFlows] = await Promise.all([
        listPublicProjects().catch(() => []),
        getPublicProjectFlows(projectId),
      ])
      const p = (projects || []).find((it) => it.id === projectId) || null
      setProject(p)
      setFlows(projectFlows || [])
    } catch (err: any) {
      console.error(err)
      toast(err?.message || '加载分享项目失败', 'error')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [projectId])

  React.useEffect(() => {
    void reload()
  }, [reload])

  React.useEffect(() => {
    if (!projectId) return
    if (!flows.length) return
    const exists = selectedFlowId && flows.some((f) => f.id === selectedFlowId)
    if (exists) return
    setSelectedFlowId(flows[0]!.id)
  }, [flows, projectId, selectedFlowId])

  React.useEffect(() => {
    if (!projectId) return
    if (!selectedFlowId) return
    const f = flows.find((it) => it.id === selectedFlowId)
    if (!f) return
    const data: any = f.data || {}
    const nodes = Array.isArray(data.nodes) ? data.nodes : []
    const edges = Array.isArray(data.edges) ? data.edges : []
    const viewport = data?.viewport
    rfLoad(sanitizeReadonlyGraph({ nodes, edges }) as any)
    useUIStore.getState().setRestoreViewport(viewport && typeof viewport.zoom === 'number' ? viewport : null)
    setCurrentProject({ id: projectId, name: project?.name || 'Shared Project' })
    setCurrentFlow({ id: f.id, name: f.name, source: 'server' })
    openLangGraphChat()
  }, [flows, openLangGraphChat, project?.name, projectId, rfLoad, selectedFlowId, setCurrentFlow, setCurrentProject])

  const handleCopyLink = React.useCallback(async () => {
    const url = buildShareUrl(projectId, selectedFlowId)
    try {
      await navigator.clipboard.writeText(url)
      toast('已复制分享链接', 'success')
    } catch (err) {
      console.error(err)
      toast('复制失败，请手动复制地址栏链接', 'error')
    }
  }, [projectId, selectedFlowId])

  const handleCloneProject = React.useCallback(async () => {
    if (!projectId) return
    if (cloning) return
    setCloning(true)
    try {
      const baseName = project?.name ? `克隆 - ${project.name}` : '克隆项目'
      const cloned = await cloneProject(projectId, baseName)
      toast('已复制到我的项目', 'success')
      if (cloned?.id) {
        try {
          const url = new URL(window.location.href)
          url.pathname = '/'
          url.search = ''
          url.hash = ''
          url.searchParams.set('projectId', cloned.id)
          window.location.href = url.toString()
        } catch {
          window.location.href = `/?projectId=${encodeURIComponent(cloned.id)}`
        }
      }
    } catch (err: any) {
      console.error(err)
      toast(err?.message || '复制项目失败', 'error')
    } finally {
      setCloning(false)
    }
  }, [cloning, project?.name, projectId])

  if (!projectId) {
    return (
      <Container size="md" py={40}>
        <Stack gap="md">
          <Group justify="space-between">
            <Title order={3}>TapCanvas 分享</Title>
            <Button variant="subtle" component="a" href="/">
              返回
            </Button>
          </Group>
          <Text size="sm" c="dimmed">
            这是只读分享页：只能观看创作过程，不能编辑画布，也不能发送消息。
          </Text>
          <Group justify="space-between" align="center">
            <Title order={5}>公开项目</Title>
            <ActionIcon variant="light" onClick={() => reload()} loading={refreshing || loading} aria-label="刷新">
              <IconRefresh size={16} />
            </ActionIcon>
          </Group>
          {loading ? (
            <Center py="lg">
              <Group gap="xs">
                <Loader size="sm" />
                <Text size="sm" c="dimmed">加载中…</Text>
              </Group>
            </Center>
          ) : publicProjects.length === 0 ? (
            <Text size="sm" c="dimmed">暂无公开项目</Text>
          ) : (
            <Stack gap={8}>
              {publicProjects.map((p) => (
                <Button
                  key={p.id}
                  variant="light"
                  component="a"
                  href={buildShareUrl(p.id, null)}
                  styles={{ inner: { justifyContent: 'space-between' } }}
                >
                  <span>{p.name}</span>
                  <Badge variant="outline" color="green">公开</Badge>
                </Button>
              ))}
            </Stack>
          )}
        </Stack>
      </Container>
    )
  }

  const flowOptions = flows.map((f) => ({ value: f.id, label: f.name || f.id }))
  const selectedFlow = selectedFlowId ? flows.find((f) => f.id === selectedFlowId) : null
  const promptEntries = React.useMemo(() => {
    if (!selectedFlow) return []
    const data: any = selectedFlow.data || {}
    const nodes = Array.isArray(data.nodes) ? data.nodes : []
    return nodes
      .map((node: any) => {
        const nodeData = node?.data || {}
        const label = (nodeData.label || nodeData.name || node.id || '未命名节点') as string
        const items: { label: string; value: string }[] = []
        const prompt = typeof nodeData.prompt === 'string' ? nodeData.prompt.trim() : ''
        if (prompt) items.push({ label: '提示词', value: prompt })
        const videoPrompt = typeof nodeData.videoPrompt === 'string' ? nodeData.videoPrompt.trim() : ''
        if (videoPrompt && videoPrompt !== prompt) items.push({ label: '视频提示词', value: videoPrompt })
        const systemPrompt = typeof nodeData.systemPrompt === 'string' ? nodeData.systemPrompt.trim() : ''
        if (systemPrompt) items.push({ label: '系统提示词', value: systemPrompt })
        const storyboard = typeof nodeData.storyboard === 'string' ? nodeData.storyboard.trim() : ''
        if (storyboard && storyboard !== prompt) items.push({ label: '分镜脚本', value: storyboard })
        if (!items.length) return null
        return { id: String(node?.id || label), label, items }
      })
      .filter(Boolean) as { id: string; label: string; items: { label: string; value: string }[] }[]
  }, [selectedFlow])

  return (
    <Box className="tapcanvas-viewonly" style={{ height: '100vh', width: '100vw', display: 'flex', flexDirection: 'column' }}>
      <Box
        style={{
          flex: '0 0 auto',
          padding: 12,
          borderBottom: isDark ? '1px solid rgba(148, 163, 184, 0.15)' : '1px solid rgba(15, 23, 42, 0.08)',
          background: isDark ? 'rgba(2, 6, 23, 0.66)' : 'rgba(255, 255, 255, 0.9)',
          backdropFilter: 'blur(8px)',
        }}
      >
        <Group justify="space-between" align="center" gap="sm">
          <Group gap="sm" align="center">
            <Tooltip label="返回主页" withArrow>
              <ActionIcon variant="subtle" component="a" href="/" aria-label="返回">
                <IconArrowLeft size={18} />
              </ActionIcon>
            </Tooltip>
            <Stack gap={0}>
              <Group gap={8} align="center">
                <Title order={5}>TapCanvas 分享</Title>
                <Badge variant="light" color="gray">只读</Badge>
                {project?.ownerName && (
                  <Badge variant="outline" color="blue">{project.ownerName}</Badge>
                )}
              </Group>
              <Text size="xs" c="dimmed">
                只能观看创作过程，不能编辑画布，也不能发送消息。
              </Text>
            </Stack>
          </Group>

          <Group gap="xs" align="center">
            <Select
              size="xs"
              value={selectedFlowId}
              onChange={(v) => setSelectedFlowId(v)}
              data={flowOptions}
              placeholder="选择工作流"
              w={220}
              disabled={loading || !flowOptions.length}
            />
            <Tooltip label="复制到我的项目" withArrow>
              <Button
                size="xs"
                variant="light"
                leftSection={<IconCopyPlus size={14} />}
                onClick={handleCloneProject}
                loading={cloning}
                disabled={!projectId}
              >
                复制项目
              </Button>
            </Tooltip>
            <Tooltip label="查看提示词" withArrow>
              <ActionIcon
                variant="light"
                onClick={() => setPromptModalOpen(true)}
                aria-label="查看提示词"
                disabled={!selectedFlow}
              >
                <IconFileText size={16} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="打开创作过程（只读）" withArrow>
              <ActionIcon variant="light" onClick={() => openLangGraphChat()} aria-label="打开创作过程">
                <IconMessageCircle size={16} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="复制分享链接" withArrow>
              <ActionIcon variant="light" onClick={handleCopyLink} aria-label="复制链接">
                <IconCopy size={16} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="刷新" withArrow>
              <ActionIcon variant="light" onClick={() => reload({ silent: true })} loading={refreshing} aria-label="刷新">
                <IconRefresh size={16} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>
      </Box>

      <Box style={{ flex: 1, minHeight: 0 }}>
        {loading && !selectedFlow ? (
          <Center style={{ height: '100%' }}>
            <Group gap="xs">
              <Loader size="sm" />
              <Text size="sm" c="dimmed">加载中…</Text>
            </Group>
          </Center>
        ) : flows.length === 0 ? (
          <Center style={{ height: '100%' }}>
            <Text size="sm" c="dimmed">该项目暂无公开工作流</Text>
          </Center>
        ) : (
          <Canvas />
        )}
      </Box>
      <Modal
        opened={promptModalOpen}
        onClose={() => setPromptModalOpen(false)}
        title="提示词"
        size="lg"
        centered
      >
        <ScrollArea h={480} type="auto">
          <Stack gap="md">
            {promptEntries.length === 0 ? (
              <Text size="sm" c="dimmed">当前工作流暂无可展示的提示词。</Text>
            ) : (
              promptEntries.map((entry) => (
                <Paper key={entry.id} withBorder radius="md" p="md">
                  <Group justify="space-between" mb="xs" gap="xs">
                    <Text size="sm" fw={600}>{entry.label}</Text>
                    <Badge size="xs" variant="light" color="gray">
                      {entry.items.length} 条
                    </Badge>
                  </Group>
                  <Stack gap="xs">
                    {entry.items.map((item) => (
                      <div key={`${entry.id}-${item.label}`}>
                        <Text size="xs" c="dimmed">{item.label}</Text>
                        <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>{item.value}</Text>
                      </div>
                    ))}
                  </Stack>
                </Paper>
              ))
            )}
          </Stack>
        </ScrollArea>
      </Modal>
    </Box>
  )
}
