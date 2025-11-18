import React from 'react'
import { Paper, Title, Text, Button, Group, Stack, Transition, Tabs, Badge, Switch, ActionIcon, Tooltip, Loader } from '@mantine/core'
import { useUIStore } from './uiStore'
import { listProjects, upsertProject, saveProjectFlow, listPublicProjects, cloneProject, toggleProjectPublic, type ProjectDto } from '../api/server'
import { useRFStore } from '../canvas/store'
import { IconCopy, IconWorld, IconWorldOff, IconRefresh } from '@tabler/icons-react'
import { $, $t } from '../canvas/i18n'
import { notifications } from '@mantine/notifications'

export default function ProjectPanel(): JSX.Element | null {
  const active = useUIStore(s => s.activePanel)
  const setActivePanel = useUIStore(s => s.setActivePanel)
  const anchorY = useUIStore(s => s.panelAnchorY)
  const currentProject = useUIStore(s => s.currentProject)
  const setCurrentProject = useUIStore(s => s.setCurrentProject)
  const mounted = active === 'project'
  const [myProjects, setMyProjects] = React.useState<ProjectDto[]>([])
  const [publicProjects, setPublicProjects] = React.useState<ProjectDto[]>([])
  const [loading, setLoading] = React.useState(false)
  const [activeTab, setActiveTab] = React.useState<'my' | 'public'>('my')

  React.useEffect(() => {
    if (!mounted) return

    // 始终加载用户项目
    setLoading(true)
    listProjects().then(setMyProjects).catch(() => setMyProjects([]))
      .finally(() => setLoading(false))

    // 只在切换到公开项目时才加载公开项目
    if (activeTab === 'public' && publicProjects.length === 0) {
      setLoading(true)
      listPublicProjects()
        .then(setPublicProjects)
        .catch(() => setPublicProjects([]))
        .finally(() => setLoading(false))
    }
  }, [mounted, activeTab])

  const handleRefreshPublicProjects = async () => {
    setLoading(true)
    try {
      const projects = await listPublicProjects()
      setPublicProjects(projects)
      notifications.show({
        title: $('成功'),
        message: $('公开项目已刷新'),
        color: 'green'
      })
    } catch (error) {
      console.error('刷新公开项目失败:', error)
      notifications.show({
        title: $('失败'),
        message: $('刷新公开项目失败'),
        color: 'red'
      })
    } finally {
      setLoading(false)
    }
  }

  const handleCloneProject = async (project: ProjectDto) => {
    try {
      const clonedProject = await cloneProject(project.id, $t('克隆项目 - {{name}}', { name: project.name }))
      setMyProjects(prev => [clonedProject, ...prev])
      notifications.show({
        title: $('成功'),
        message: $t('项目「{{name}}」克隆成功', { name: project.name }),
        color: 'green'
      })
      // 加载克隆项目的工作流
      // 这里可以添加加载工作流的逻辑
    } catch (error) {
      console.error('克隆项目失败:', error)
      notifications.show({
        title: $('失败'),
        message: $('克隆项目失败'),
        color: 'red'
      })
    }
  }

  const handleTogglePublic = async (project: ProjectDto, isPublic: boolean) => {
    try {
      const updatedProject = await toggleProjectPublic(project.id, isPublic)
      setMyProjects(prev => prev.map(p => p.id === project.id ? { ...p, isPublic } : p))
      notifications.show({
        title: $('成功'),
        message: isPublic ? $('项目已设为公开') : $('项目已设为私有'),
        color: 'green'
      })
    } catch (error) {
      console.error('切换公开状态失败:', error)
      notifications.show({
        title: $('失败'),
        message: $('切换公开状态失败'),
        color: 'red'
      })
    }
  }

  if (!mounted) return null
  return (
    <div style={{ position: 'fixed', left: 82, top: (anchorY ? anchorY - 150 : 140), zIndex: 6001 }} data-ux-panel>
      <Transition mounted={mounted} transition="pop" duration={140} timingFunction="ease">
        {(styles) => (
          <div style={styles}>
            <Paper withBorder shadow="md" radius="lg" className="glass" p="md" style={{ width: 500, maxHeight: '70vh', transformOrigin: 'left center' }} data-ux-panel>
              <div className="panel-arrow" />
              <Group justify="space-between" mb={8} style={{ position: 'sticky', top: 0, zIndex: 1, background: 'transparent' }}>
                <Title order={6}>{$('项目')}</Title>
                <Button size="xs" variant="light" onClick={async () => {
                  const defaultName = $t('未命名项目 {{time}}', { time: new Date().toLocaleString() })
                  const p = await upsertProject({ name: defaultName })
                  setMyProjects(prev => [p, ...prev])
                  // 创建一个空白工作流并设为当前
                  const empty = await saveProjectFlow({ projectId: p.id, name: p.name, nodes: [], edges: [] })
                  useRFStore.setState({ nodes: [], edges: [], nextId: 1 })
                  setCurrentProject({ id: p.id, name: p.name })
                  // 关闭面板
                  setActivePanel(null)
                }}>{$('新建项目')}</Button>
              </Group>

              <Tabs value={activeTab} onChange={setActiveTab} color="blue">
                <Tabs.List>
                  <Tabs.Tab value="my" leftSection={<IconWorldOff size={14} />}>{$('我的项目')}</Tabs.Tab>
                  <Tabs.Tab value="public" leftSection={<IconWorld size={14} />}>{$('公开项目')}</Tabs.Tab>
                </Tabs.List>

                <Tabs.Panel value="my" pt="xs">
                  <div style={{ maxHeight: '50vh', overflowY: 'auto' }}>
                    {myProjects.length === 0 && !loading && (
                      <Text size="xs" c="dimmed">{$('暂无项目')}</Text>
                    )}
                    <Stack gap={6}>
                      {myProjects.map(p => (
                        <Group key={p.id} justify="space-between" p="xs" style={{ border: '1px solid #eee', borderRadius: 8 }}>
                          <div style={{ flex: 1 }}>
                            <Group gap={8}>
                              <Text size="sm" fw={currentProject?.id===p.id?600:400} c={currentProject?.id===p.id?undefined:'dimmed'}>
                                {p.name}
                              </Text>
                              {p.isPublic && (
                                <Badge size="xs" color="green" variant="light">{$('公开')}</Badge>
                              )}
                            </Group>
                            {p.ownerName && (
                              <Text size="xs" c="dimmed">{$('作者：{{name}}', { name: p.ownerName })}</Text>
                            )}
                          </div>
                          <Group gap={4}>
                            <Tooltip label={p.isPublic ? $('设为私有') : $('设为公开')}>
                              <ActionIcon
                                size="sm"
                                variant="subtle"
                                color={p.isPublic ? 'green' : 'gray'}
                                onClick={() => handleTogglePublic(p, !p.isPublic)}
                              >
                                {p.isPublic ? <IconWorld size={14} /> : <IconWorldOff size={14} />}
                              </ActionIcon>
                            </Tooltip>
                            <Button size="xs" variant="light" onClick={() => {
                              setCurrentProject({ id: p.id, name: p.name })
                              setActivePanel(null)
                            }}>
                              {$('选择')}
                            </Button>
                          </Group>
                        </Group>
                      ))}
                    </Stack>
                  </div>
                </Tabs.Panel>

                <Tabs.Panel value="public" pt="xs">
                  <Group justify="space-between" mb={8}>
                    <Text size="sm" fw={500}>{$('社区公开项目')}</Text>
                    <Tooltip label={$('刷新公开项目')}>
                      <ActionIcon
                        size="sm"
                        variant="subtle"
                        onClick={handleRefreshPublicProjects}
                        loading={loading && activeTab === 'public'}
                      >
                        <IconRefresh size={14} />
                      </ActionIcon>
                    </Tooltip>
                  </Group>

                  <div style={{ maxHeight: '50vh', overflowY: 'auto' }}>
                    {loading && activeTab === 'public' && (
                      <Group justify="center" py="xl">
                        <Loader size="sm" />
                        <Text size="sm" c="dimmed">{$('加载中...')}</Text>
                      </Group>
                    )}

                    {!loading && publicProjects.length === 0 && (
                      <Group justify="center" py="xl">
                        <Text size="sm" c="dimmed">{$('暂无公开项目')}</Text>
                      </Group>
                    )}

                    {!loading && publicProjects.length > 0 && (
                      <Stack gap={6}>
                        {publicProjects.map(p => (
                          <Group key={p.id} justify="space-between" p="xs" style={{ border: '1px solid #eee', borderRadius: 8 }}>
                            <div style={{ flex: 1 }}>
                              <Group gap={8}>
                                <Text size="sm">{p.name}</Text>
                                <Badge size="xs" color="blue" variant="light">{$('公开')}</Badge>
                              </Group>
                              {p.ownerName && (
                                <Text size="xs" c="dimmed">{$('作者：{{name}}', { name: p.ownerName })}</Text>
                              )}
                            </div>
                            <Button size="xs" variant="outline" leftSection={<IconCopy size={12} />} onClick={() => handleCloneProject(p)}>
                              {$('克隆')}
                            </Button>
                          </Group>
                        ))}
                      </Stack>
                    )}
                  </div>
                </Tabs.Panel>
              </Tabs>
            </Paper>
          </div>
        )}
      </Transition>
    </div>
  )
}
