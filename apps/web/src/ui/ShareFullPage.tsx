import React from 'react'
import { ActionIcon, Badge, Box, Button, Center, Container, Group, Loader, Stack, Text, Title, Tooltip } from '@mantine/core'
import { IconCopy, IconCopyPlus, IconRefresh } from '@tabler/icons-react'
import Canvas from '../canvas/Canvas'
import { cloneProject, getPublicProjectConversation, getPublicProjectFlows, listPublicProjects, type FlowDto, type ProjectDto, type PublicConversationSessionDto, type PublicProjectFlowDto } from '../api/server'
import { useAuth } from '../auth/store'
import { useRFStore } from '../canvas/store'
import { buildStudioUrl } from '../utils/appRoutes'
import { spaNavigate } from '../utils/spaNavigate'
import { useRouteNavigationLease } from '../utils/useRouteNavigationLease'
import { PublicConversationPanel } from './PublicConversationPanel'
import { PublicProjectDirectory } from './PublicProjectDirectory'
import { buildSharePath, canCopySharedProject, pickInitialPublicFlowId, sanitizeReadonlyGraph } from './shareCanvasModel'
import { useUIStore } from './uiStore'
import { toast } from './toast'

type ShareLocation = {
  projectId: string | null
  flowId: string | null
}

function parseShareLocation(): ShareLocation {
  if (typeof window === 'undefined') return { projectId: null, flowId: null }
  const parts = (window.location.pathname || '').split('/').filter(Boolean)
  const idx = parts.indexOf('share')
  const pathProjectId = idx >= 0 ? (parts[idx + 1] ? decodeURIComponent(parts[idx + 1]) : null) : null
  const pathFlowId = idx >= 0 ? (parts[idx + 2] ? decodeURIComponent(parts[idx + 2]) : null) : null
  const params = new URLSearchParams(window.location.search)
  if (pathProjectId) return { projectId: pathProjectId, flowId: pathFlowId }
  // fallback: ?projectId=...&flowId=... query param format
  return {
    projectId: params.get('projectId'),
    flowId: params.get('flowId'),
  }
}

function buildShareUrl(
  projectId?: string | null,
  flowId?: string | null,
): string {
  const path = buildSharePath({ projectId, flowId })
  if (typeof window === 'undefined') {
    return path
  }
  try {
    const url = new URL(window.location.href)
    const [pathname, search = ''] = path.split('?')
    url.pathname = pathname
    url.search = search
    url.hash = ''
    return url.toString()
  } catch {
    return path
  }
}

function readErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback
}

export default function ShareFullPage(): JSX.Element {
  const { projectId, flowId } = React.useMemo(() => parseShareLocation(), [])
  const acquireRouteNavigationLease = useRouteNavigationLease()
  const setViewOnly = useUIStore((s) => s.setViewOnly)
  const setCurrentProject = useUIStore((s) => s.setCurrentProject)
  const setCurrentFlow = useUIStore((s) => s.setCurrentFlow)
  const rfLoad = useRFStore((s) => s.load)
  const authToken = useAuth((state) => state.token)

  const [loading, setLoading] = React.useState(true)
  const [refreshing, setRefreshing] = React.useState(false)
  const [publicProjects, setPublicProjects] = React.useState<ProjectDto[]>([])
  const [project, setProject] = React.useState<ProjectDto | null>(null)
  const [flows, setFlows] = React.useState<PublicProjectFlowDto[]>([])
  const [selectedFlowDetail, setSelectedFlowDetail] = React.useState<FlowDto | null>(null)
  const [selectedFlowId, setSelectedFlowId] = React.useState<string | null>(flowId)
  const [conversation, setConversation] = React.useState<PublicConversationSessionDto[]>([])
  const [cloning, setCloning] = React.useState(false)
  const canCopyProject = canCopySharedProject(project, authToken)

  React.useEffect(() => {
    setViewOnly(true)
    return () => {
      setViewOnly(false)
    }
  }, [setViewOnly])

  React.useLayoutEffect(() => {
    const resetShareCanvasRuntime = (): void => {
      useRFStore.getState().reset()
      useUIStore.setState({
        currentFlow: { id: null, name: '未命名', source: 'local', ownerType: null, ownerId: null },
        currentProject: null,
        restoreViewport: null,
        canvasViewport: null,
        creationSession: null,
        isDirty: false,
      })
    }
    resetShareCanvasRuntime()
    return resetShareCanvasRuntime
  }, [])

  const reload = React.useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true)
    setRefreshing(true)
    try {
      if (!projectId) {
        const projects = await listPublicProjects()
        setPublicProjects(projects || [])
        return
      }

      const [projects, projectFlows, convData] = await Promise.all([
        listPublicProjects(),
        getPublicProjectFlows(projectId),
        getPublicProjectConversation(projectId),
      ])
      const p = (projects || []).find((it) => it.id === projectId) || null
      setProject(p)
      setFlows(projectFlows || [])
      setConversation(convData.sessions || [])
      setSelectedFlowDetail(null)
    } catch (error: unknown) {
      console.error('[share] load public project failed', error)
      toast(readErrorMessage(error, '加载分享项目失败'), 'error')
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
    setSelectedFlowId(pickInitialPublicFlowId(flows))
  }, [flows, projectId, selectedFlowId])

  React.useEffect(() => {
    if (!projectId) return
    if (!selectedFlowId) return
    const selectedFlow = flows.find((it) => it.id === selectedFlowId)
    if (!selectedFlow) return
    const flow = selectedFlow
    const { nodes, edges } = flow.data
    // 公开制作过程必须以完整画布为第一视图，不能恢复作者编辑时保存的局部 viewport。
    // 先写入真实节点再标记 detail ready，确保 Canvas 首次挂载时即可基于节点执行 fitView。
    useUIStore.getState().setRestoreViewport(null)
    rfLoad(sanitizeReadonlyGraph({ nodes, edges }))
    setCurrentProject({ id: projectId, name: project?.name || 'Shared Project', teamId: null })
    setCurrentFlow({ id: flow.id, name: flow.name, source: 'server' })
    setSelectedFlowDetail(flow)
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
    if (!projectId || !canCopyProject) return
    if (cloning) return
    const navigationLease = acquireRouteNavigationLease()
    setCloning(true)
    try {
      const baseName = project?.name ? `克隆 - ${project.name}` : '克隆项目'
      const cloned = await cloneProject(projectId, baseName)
      if (!navigationLease.isCurrent()) return
      toast('已复制到我的项目', 'success')
      if (cloned?.id) {
        spaNavigate(buildStudioUrl({
          projectId: cloned.id,
          ownerType: 'project',
          ownerId: cloned.id,
        }))
      }
    } catch (error: unknown) {
      console.error('[share] copy project failed', error)
      toast(readErrorMessage(error, '复制项目失败'), 'error')
    } finally {
      setCloning(false)
    }
  }, [acquireRouteNavigationLease, canCopyProject, cloning, project?.name, projectId])

  if (!projectId) {
    return (
      <Container className="tc-share" size="md" py={40}>
        <Stack className="tc-share__stack" gap="md">
          <Group className="tc-share__header" justify="space-between">
            <Title className="tc-share__title" order={3}>TapCanvas 分享</Title>
            <Button className="tc-share__action" variant="subtle" onClick={() => spaNavigate('/')}>
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

  const canvasReady = Boolean(selectedFlowId && selectedFlowDetail?.id === selectedFlowId)

  return (
    <Box className="tapcanvas-viewonly tc-share tc-public-workspace">
      <header className="app-header-overlay tc-public-workspace__topbar">
        <Group className="app-header tc-public-workspace__topbar-row" justify="space-between" align="center" gap="sm" wrap="nowrap">
          <Group className="tc-public-workspace__identity" gap={8} align="center" wrap="nowrap">
            <Title className="tc-public-workspace__title" order={5}>{project?.name || '未命名项目'}</Title>
            <Badge className="tc-public-workspace__readonly-badge" variant="light" color="gray">只读</Badge>
            {project?.ownerName ? (
              <Text className="tc-public-workspace__owner" size="xs" c="dimmed">{project.ownerName}</Text>
            ) : null}
          </Group>
          <Group className="tc-public-workspace__actions" gap="xs" align="center" wrap="nowrap">
            {canCopyProject ? (
              <Tooltip className="tc-public-workspace__tooltip" label="复制到我的项目" withArrow>
                <Button
                  className="tc-public-workspace__clone"
                  size="xs"
                  variant="light"
                  leftSection={<IconCopyPlus size={14} />}
                  onClick={handleCloneProject}
                  loading={cloning}
                >
                  复制项目
                </Button>
              </Tooltip>
            ) : null}
            <Tooltip className="tc-public-workspace__tooltip" label="复制分享链接" withArrow>
              <ActionIcon className="tc-public-workspace__icon-button" variant="subtle" onClick={handleCopyLink} aria-label="复制链接">
                <IconCopy className="tc-public-workspace__icon" size={17} />
              </ActionIcon>
            </Tooltip>
            <Tooltip className="tc-public-workspace__tooltip" label="刷新" withArrow>
              <ActionIcon className="tc-public-workspace__icon-button" variant="subtle" onClick={() => reload({ silent: true })} loading={refreshing} aria-label="刷新">
                <IconRefresh className="tc-public-workspace__icon" size={17} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>
      </header>

      <Box className="tc-public-workspace__content">
        <PublicProjectDirectory
          projectName={project?.name || '未命名项目'}
          flows={flows}
          selectedFlowId={selectedFlowId}
          onSelectFlow={setSelectedFlowId}
          onBack={() => spaNavigate('/')}
        />
        {loading || (flows.length > 0 && !canvasReady) ? (
          <Center className="tc-public-workspace__canvas-state">
            <Group className="tc-share__loading" gap="xs">
              <Loader className="tc-share__loader" size="sm" />
              <Text className="tc-share__loading-text" size="sm" c="dimmed">加载中…</Text>
            </Group>
          </Center>
        ) : flows.length === 0 ? (
          <Center className="tc-public-workspace__canvas-state">
            <Text className="tc-share__empty" size="sm" c="dimmed">该项目暂无画布</Text>
          </Center>
        ) : (
          <main className="tc-public-workspace__canvas" aria-label="只读项目画布">
            <Canvas className="tc-public-workspace__canvas-surface" />
          </main>
        )}
        <PublicConversationPanel sessions={conversation} />
      </Box>
    </Box>
  )
}
