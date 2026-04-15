import React from 'react'
import { ActionIcon, Badge, Box, Button, Center, Container, Group, Loader, Modal, ScrollArea, Select, Stack, Text, Title, Tooltip, useMantineColorScheme } from '@mantine/core'
import { IconArrowLeft, IconCopy, IconCopyPlus, IconFileText, IconRefresh } from '@tabler/icons-react'
import Canvas from '../canvas/Canvas'
import { cloneProject, getPublicProjectFlows, listPublicProjects, type FlowDto, type ProjectDto } from '../api/server'
import { useRFStore } from '../canvas/store'
import { buildStudioUrl } from '../utils/appRoutes'
import { navigateBackOr } from '../utils/spaNavigate'
import { PanelCard } from './PanelCard'
import { useUIStore } from './uiStore'
import { toast } from './toast'

const SHARE_GROUP_PADDING = 24
const SHARE_GROUP_MIN_WIDTH = 240
const SHARE_GROUP_MIN_HEIGHT = 160

function toFiniteNumber(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

function getReadonlyNodeSize(node: any): { w: number; h: number } {
  const width = toFiniteNumber(node?.width)
    ?? toFiniteNumber(node?.style?.width)
    ?? toFiniteNumber(node?.data?.nodeWidth)
  const height = toFiniteNumber(node?.height)
    ?? toFiniteNumber(node?.style?.height)
    ?? toFiniteNumber(node?.data?.nodeHeight)
  const fallback = node?.type === 'groupNode'
    ? { w: SHARE_GROUP_MIN_WIDTH, h: SHARE_GROUP_MIN_HEIGHT }
    : node?.type === 'ioNode'
      ? { w: 88, h: 40 }
      : { w: 120, h: 210 }
  return {
    w: Math.max(24, width ?? fallback.w),
    h: Math.max(24, height ?? fallback.h),
  }
}

function normalizeReadonlyGroupLayout(rawNodes: any[]): any[] {
  if (!Array.isArray(rawNodes) || rawNodes.length === 0) return []
  let nodes = rawNodes.map((node) => ({ ...node }))
  for (let pass = 0; pass < 6; pass += 1) {
    let changed = false
    const byId = new Map(nodes.map((node) => [String(node?.id || ''), node]))
    const groupIds = nodes
      .filter((node) => node?.type === 'groupNode' && node?.id)
      .map((node) => String(node.id))
    if (!groupIds.length) break

    // 先修正内层 group，再修正外层 group，避免嵌套场景反复抖动
    const depthOf = (groupId: string): number => {
      let depth = 0
      let current = byId.get(groupId)
      while (current) {
        const pid = typeof current?.parentId === 'string' ? current.parentId.trim() : ''
        if (!pid) break
        const parent = byId.get(pid)
        if (!parent || parent.type !== 'groupNode') break
        depth += 1
        current = parent
      }
      return depth
    }

    const sortedGroupIds = groupIds.sort((a, b) => depthOf(b) - depthOf(a))
    for (const groupId of sortedGroupIds) {
      const group = byId.get(groupId)
      if (!group) continue
      const children = nodes.filter((node) => String(node?.parentId || '').trim() === groupId)
      if (!children.length) continue

      let minX = Number.POSITIVE_INFINITY
      let minY = Number.POSITIVE_INFINITY
      let maxX = Number.NEGATIVE_INFINITY
      let maxY = Number.NEGATIVE_INFINITY
      for (const child of children) {
        const px = toFiniteNumber(child?.position?.x) ?? 0
        const py = toFiniteNumber(child?.position?.y) ?? 0
        const { w, h } = getReadonlyNodeSize(child)
        minX = Math.min(minX, px)
        minY = Math.min(minY, py)
        maxX = Math.max(maxX, px + w)
        maxY = Math.max(maxY, py + h)
      }
      if (![minX, minY, maxX, maxY].every(Number.isFinite)) continue

      const offsetX = minX < SHARE_GROUP_PADDING ? SHARE_GROUP_PADDING - minX : 0
      const offsetY = minY < SHARE_GROUP_PADDING ? SHARE_GROUP_PADDING - minY : 0
      const nextChildren = offsetX > 0 || offsetY > 0
        ? children.map((child) => ({
          ...child,
          position: {
            x: (toFiniteNumber(child?.position?.x) ?? 0) + offsetX,
            y: (toFiniteNumber(child?.position?.y) ?? 0) + offsetY,
          },
        }))
        : children

      if (nextChildren !== children) {
        const nextById = new Map(nextChildren.map((n) => [String(n.id), n]))
        nodes = nodes.map((node) => nextById.get(String(node?.id || '')) || node)
        changed = true
      }

      const nextMinX = minX + offsetX
      const nextMinY = minY + offsetY
      const nextMaxX = maxX + offsetX
      const nextMaxY = maxY + offsetY
      const desiredWidth = Math.max(
        SHARE_GROUP_MIN_WIDTH,
        Math.ceil(nextMaxX + SHARE_GROUP_PADDING),
      )
      const desiredHeight = Math.max(
        SHARE_GROUP_MIN_HEIGHT,
        Math.ceil(nextMaxY + SHARE_GROUP_PADDING),
      )
      const currentWidth = toFiniteNumber(group?.width)
        ?? toFiniteNumber(group?.style?.width)
        ?? toFiniteNumber(group?.data?.nodeWidth)
        ?? SHARE_GROUP_MIN_WIDTH
      const currentHeight = toFiniteNumber(group?.height)
        ?? toFiniteNumber(group?.style?.height)
        ?? toFiniteNumber(group?.data?.nodeHeight)
        ?? SHARE_GROUP_MIN_HEIGHT

      if (desiredWidth > currentWidth + 0.1 || desiredHeight > currentHeight + 0.1) {
        const nextGroup = {
          ...group,
          width: desiredWidth,
          height: desiredHeight,
          style: {
            ...(group?.style || {}),
            width: desiredWidth,
            height: desiredHeight,
          },
          data: {
            ...(group?.data || {}),
            nodeWidth: desiredWidth,
            nodeHeight: desiredHeight,
          },
        }
        nodes = nodes.map((node) => (String(node?.id || '') === groupId ? nextGroup : node))
        changed = true
      }
    }
    if (!changed) break
  }
  return nodes
}

function sanitizeReadonlyGraph(payload: { nodes: any[]; edges: any[] }): { nodes: any[]; edges: any[] } {
  const normalizedNodes = normalizeReadonlyGroupLayout(payload.nodes || [])
  const nodes = normalizedNodes.map((n: any) => {
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
    }
  }, [setViewOnly])

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
  }, [flows, project?.name, projectId, rfLoad, selectedFlowId, setCurrentFlow, setCurrentProject])

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
        window.location.href = buildStudioUrl(cloned.id)
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
      <Container className="tc-share" size="md" py={40}>
        <Stack className="tc-share__stack" gap="md">
          <Group className="tc-share__header" justify="space-between">
            <Title className="tc-share__title" order={3}>TapCanvas 分享</Title>
            <Button className="tc-share__action" variant="subtle" onClick={() => navigateBackOr('/')}>
              返回
            </Button>
          </Group>
          <Text className="tc-share__desc" size="sm" c="dimmed">
            这是只读分享页：只能观看创作过程，不能编辑画布，也不能发送消息。
          </Text>
          <Group className="tc-share__section-header" justify="space-between" align="center">
            <Title className="tc-share__section-title" order={5}>公开项目</Title>
            <ActionIcon className="tc-share__icon-button" variant="light" onClick={() => reload()} loading={refreshing || loading} aria-label="刷新">
              <IconRefresh className="tc-share__icon" size={16} />
            </ActionIcon>
          </Group>
          {loading ? (
            <Center className="tc-share__center" py="lg">
              <Group className="tc-share__loading" gap="xs">
                <Loader className="tc-share__loader" size="sm" />
                <Text className="tc-share__loading-text" size="sm" c="dimmed">加载中…</Text>
              </Group>
            </Center>
          ) : publicProjects.length === 0 ? (
            <Text className="tc-share__empty" size="sm" c="dimmed">暂无公开项目</Text>
          ) : (
            <Stack className="tc-share__list" gap={8}>
              {publicProjects.map((p) => (
                <Button
                  className="tc-share__list-item"
                  key={p.id}
                  variant="light"
                  component="a"
                  href={buildShareUrl(p.id, null)}
                  styles={{ inner: { justifyContent: 'space-between' } }}
                >
                  <span className="tc-share__list-name">{p.name}</span>
                  <Badge className="tc-share__list-badge" variant="outline" color="green">公开</Badge>
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
    <Box className="tapcanvas-viewonly tc-share" style={{ height: '100vh', width: '100vw', display: 'flex', flexDirection: 'column' }}>
      <Box
        className="tc-share__topbar"
        style={{
          flex: '0 0 auto',
          padding: 12,
          borderBottom: isDark ? '1px solid rgba(148, 163, 184, 0.15)' : '1px solid rgba(15, 23, 42, 0.08)',
          background: isDark ? 'rgba(2, 6, 23, 0.66)' : 'rgba(255, 255, 255, 0.9)',
          backdropFilter: 'blur(8px)',
        }}
      >
        <Group className="tc-share__topbar-row" justify="space-between" align="center" gap="sm">
          <Group className="tc-share__topbar-left" gap="sm" align="center">
            <Tooltip className="tc-share__tooltip" label="返回主页" withArrow>
              <ActionIcon className="tc-share__icon-button" variant="subtle" onClick={() => navigateBackOr('/')} aria-label="返回">
                <IconArrowLeft className="tc-share__icon" size={18} />
              </ActionIcon>
            </Tooltip>
            <Stack className="tc-share__topbar-title" gap={0}>
              <Group className="tc-share__topbar-title-row" gap={8} align="center">
                <Title className="tc-share__title" order={5}>TapCanvas 分享</Title>
                <Badge className="tc-share__badge" variant="light" color="gray">只读</Badge>
                {project?.ownerName && (
                  <Badge className="tc-share__badge" variant="outline" color="blue">{project.ownerName}</Badge>
                )}
              </Group>
              <Text className="tc-share__desc" size="xs" c="dimmed">
                只能观看创作过程，不能编辑画布，也不能发送消息。
              </Text>
            </Stack>
          </Group>

          <Group className="tc-share__topbar-actions" gap="xs" align="center">
            <Select
              className="tc-share__select"
              size="xs"
              value={selectedFlowId}
              onChange={(v) => setSelectedFlowId(v)}
              data={flowOptions}
              placeholder="选择工作流"
              w={220}
              disabled={loading || !flowOptions.length}
            />
            <Tooltip className="tc-share__tooltip" label="复制到我的项目" withArrow>
              <Button
                className="tc-share__action"
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
            <Tooltip className="tc-share__tooltip" label="查看提示词" withArrow>
              <ActionIcon
                className="tc-share__icon-button"
                variant="light"
                onClick={() => setPromptModalOpen(true)}
                aria-label="查看提示词"
                disabled={!selectedFlow}
              >
                <IconFileText className="tc-share__icon" size={16} />
              </ActionIcon>
            </Tooltip>
            <Tooltip className="tc-share__tooltip" label="复制分享链接" withArrow>
              <ActionIcon className="tc-share__icon-button" variant="light" onClick={handleCopyLink} aria-label="复制链接">
                <IconCopy className="tc-share__icon" size={16} />
              </ActionIcon>
            </Tooltip>
            <Tooltip className="tc-share__tooltip" label="刷新" withArrow>
              <ActionIcon className="tc-share__icon-button" variant="light" onClick={() => reload({ silent: true })} loading={refreshing} aria-label="刷新">
                <IconRefresh className="tc-share__icon" size={16} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>
      </Box>

      <Box className="tc-share__content" style={{ flex: 1, minHeight: 0 }}>
        {loading && !selectedFlow ? (
          <Center className="tc-share__center" style={{ height: '100%' }}>
            <Group className="tc-share__loading" gap="xs">
              <Loader className="tc-share__loader" size="sm" />
              <Text className="tc-share__loading-text" size="sm" c="dimmed">加载中…</Text>
            </Group>
          </Center>
        ) : flows.length === 0 ? (
          <Center className="tc-share__center" style={{ height: '100%' }}>
            <Text className="tc-share__empty" size="sm" c="dimmed">该项目暂无公开工作流</Text>
          </Center>
        ) : (
          <Canvas />
        )}
      </Box>
      <Modal
        className="tc-share__modal"
        opened={promptModalOpen}
        onClose={() => setPromptModalOpen(false)}
        title="提示词"
        size="lg"
        centered
      >
        <ScrollArea className="tc-share__scroll" h={480} type="auto">
          <Stack className="tc-share__modal-stack" gap="md">
            {promptEntries.length === 0 ? (
              <Text className="tc-share__empty" size="sm" c="dimmed">当前工作流暂无可展示的提示词。</Text>
            ) : (
              promptEntries.map((entry) => (
                <PanelCard className="tc-share__prompt-card" key={entry.id}>
                  <Group className="tc-share__prompt-header" justify="space-between" mb="xs" gap="xs">
                    <Text className="tc-share__prompt-title" size="sm" fw={600}>{entry.label}</Text>
                    <Badge className="tc-share__badge" size="xs" variant="light" color="gray">
                      {entry.items.length} 条
                    </Badge>
                  </Group>
                  <Stack className="tc-share__prompt-list" gap="xs">
                    {entry.items.map((item) => (
                      <div className="tc-share__prompt-item" key={`${entry.id}-${item.label}`}>
                        <Text className="tc-share__prompt-label" size="xs" c="dimmed">{item.label}</Text>
                        <Text className="tc-share__prompt-value" size="sm" style={{ whiteSpace: 'pre-wrap' }}>{item.value}</Text>
                      </div>
                    ))}
                  </Stack>
                </PanelCard>
              ))
            )}
          </Stack>
        </ScrollArea>
      </Modal>
    </Box>
  )
}
