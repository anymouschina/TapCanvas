import React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Paper, Title, Text, Button, Group, Stack, Transition, Tabs, Badge, ActionIcon, Tooltip, Loader, Popover } from '@mantine/core'
import { useUIStore } from './uiStore'
import { listProjects, upsertProject, saveProjectFlow, listPublicProjects, cloneProject, toggleProjectPublic, deleteProject, type ProjectDto } from '../api/server'
import { useRFStore } from '../canvas/store'
import { IconCopy, IconTrash, IconWorld, IconWorldOff, IconRefresh } from '@tabler/icons-react'
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
  const [deletingProjectId, setDeletingProjectId] = React.useState<string | null>(null)
  const [popoverProjectId, setPopoverProjectId] = React.useState<string | null>(null)
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
        id: 'refresh-success',
        withCloseButton: true,
        autoClose: 4000,
        title: $('成功'),
        message: $('公开项目已刷新'),
        color: 'green',
        icon: <motion.div
          initial={{ scale: 0, rotate: 0 }}
          animate={{ scale: 1, rotate: 360 }}
          transition={{ duration: 0.5, type: "spring" }}
        >
          ✅
        </motion.div>,
        style: {
          backdropFilter: 'blur(10px)',
          backgroundColor: 'rgba(34, 197, 94, 0.12)',
          border: '1px solid rgba(34, 197, 94, 0.2)',
        }
      })
    } catch (error) {
      console.error('刷新公开项目失败:', error)
      notifications.show({
        id: 'refresh-error',
        withCloseButton: true,
        autoClose: 4000,
        title: $('失败'),
        message: $('刷新公开项目失败'),
        color: 'red',
        icon: <motion.div
          initial={{ scale: 0, x: -20 }}
          animate={{ scale: 1, x: 0 }}
          transition={{ duration: 0.4, type: "spring" }}
        >
          ❌
        </motion.div>,
        style: {
          backdropFilter: 'blur(10px)',
          backgroundColor: 'rgba(239, 68, 68, 0.12)',
          border: '1px solid rgba(239, 68, 68, 0.2)',
        }
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
        id: `clone-success-${project.id}`,
        withCloseButton: true,
        autoClose: 4000,
        title: $('成功'),
        message: $t('项目「{{name}}」克隆成功', { name: project.name }),
        color: 'green',
        icon: <motion.div
          initial={{ scale: 0, rotate: 180 }}
          animate={{ scale: 1, rotate: 360 }}
          transition={{ duration: 0.6, type: "spring", stiffness: 200 }}
        >
          🚀
        </motion.div>,
        style: {
          backdropFilter: 'blur(10px)',
          backgroundColor: 'rgba(34, 197, 94, 0.12)',
          border: '1px solid rgba(34, 197, 94, 0.2)',
        }
      })
      // 加载克隆项目的工作流
      // 这里可以添加加载工作流的逻辑
    } catch (error) {
      console.error('克隆项目失败:', error)
      notifications.show({
        id: 'clone-error',
        withCloseButton: true,
        autoClose: 4000,
        title: $('失败'),
        message: $('克隆项目失败'),
        color: 'red',
        icon: <motion.div
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.4, type: "spring" }}
        >
          ⚠️
        </motion.div>,
        style: {
          backdropFilter: 'blur(10px)',
          backgroundColor: 'rgba(239, 68, 68, 0.12)',
          border: '1px solid rgba(239, 68, 68, 0.2)',
        }
      })
    }
  }

  const handleTogglePublic = async (project: ProjectDto, isPublic: boolean) => {
    try {
      await toggleProjectPublic(project.id, isPublic)
      setMyProjects(prev => prev.map(p => p.id === project.id ? { ...p, isPublic } : p))
      notifications.show({
        id: `toggle-${project.id}`,
        withCloseButton: true,
        autoClose: 3000,
        title: $('成功'),
        message: isPublic ? $('项目已设为公开') : $('项目已设为私有'),
        color: 'green',
        icon: <motion.div
          initial={{ scale: 0, rotate: -45 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ duration: 0.5, type: "spring", stiffness: 300 }}
        >
          {isPublic ? '🌐' : '🔒'}
        </motion.div>,
        style: {
          backdropFilter: 'blur(10px)',
          backgroundColor: isPublic ? 'rgba(34, 197, 94, 0.12)' : 'rgba(59, 130, 246, 0.12)',
          border: `1px solid ${isPublic ? 'rgba(34, 197, 94, 0.2)' : 'rgba(59, 130, 246, 0.2)'}`,
        }
      })
    } catch (error) {
      console.error('切换公开状态失败:', error)
      notifications.show({
        id: 'toggle-error',
        withCloseButton: true,
        autoClose: 4000,
        title: $('失败'),
        message: $('切换公开状态失败'),
        color: 'red',
        icon: <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          ⚠️
        </motion.div>,
        style: {
          backdropFilter: 'blur(10px)',
          backgroundColor: 'rgba(239, 68, 68, 0.12)',
          border: '1px solid rgba(239, 68, 68, 0.2)',
        }
      })
    }
  }

  const closePopover = () => setPopoverProjectId(null)
  const handleTabChange = (value: 'my' | 'public') => {
    setPopoverProjectId(null)
    setActiveTab(value)
  }

  const openDeletePopover = (projectId: string) => {
    setPopoverProjectId(projectId)
  }
  const confirmPopoverDelete = (project: ProjectDto) => {
    closePopover()
    handleDeleteProject(project)
  }
  const handleDeleteProject = async (project: ProjectDto) => {
    setDeletingProjectId(project.id)
    try {
      await deleteProject(project.id)
      setMyProjects(prev => prev.filter(p => p.id !== project.id))
      if (currentProject?.id === project.id) {
        setCurrentProject(null)
      }
      notifications.show({
        id: `delete-project-${project.id}`,
        withCloseButton: true,
        autoClose: 4000,
        title: $('成功'),
        message: $t('项目「{{name}}」已删除', { name: project.name }),
        color: 'green',
        icon: <motion.div
          initial={{ scale: 0, rotate: 0 }}
          animate={{ scale: 1, rotate: 360 }}
          transition={{ duration: 0.4, type: "spring" }}
        >
          ✅
        </motion.div>,
        style: {
          backdropFilter: 'blur(10px)',
          backgroundColor: 'rgba(34, 197, 94, 0.12)',
          border: '1px solid rgba(34, 197, 94, 0.2)',
        }
      })
    } catch (error) {
      console.error('删除项目失败:', error)
      notifications.show({
        id: `delete-project-error-${project.id}`,
        withCloseButton: true,
        autoClose: 4000,
        title: $('失败'),
        message: $t('删除项目失败'),
        color: 'red',
        icon: <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ duration: 0.4, type: "spring" }}
        >
          ❌
        </motion.div>,
        style: {
          backdropFilter: 'blur(10px)',
          backgroundColor: 'rgba(239, 68, 68, 0.12)',
          border: '1px solid rgba(239, 68, 68, 0.2)'
        }
      })
    } finally {
      setDeletingProjectId(null)
    }
  }

  if (!mounted) return null
  return (
    <div style={{ position: 'fixed', left: 82, top: (anchorY ? anchorY - 150 : 140), zIndex: 300 }} data-ux-panel>
      <Transition mounted={mounted} transition="pop" duration={140} timingFunction="ease">
        {(styles) => (
          <div style={styles}>
            <Paper withBorder shadow="md" radius="lg" className="glass" p="md" style={{ width: 500, maxHeight: '70vh', transformOrigin: 'left center' }} data-ux-panel>
              <div className="panel-arrow" />
              <motion.div
                initial={{ opacity: 0, y: -5 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.15 }}
                style={{ position: 'sticky', top: 0, zIndex: 1, background: 'transparent' }}
              >
                <Group justify="space-between" mb={8}>
                  <Title order={6}>{$('项目')}</Title>
                  <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
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
                    }}>
                      {$('新建项目')}
                    </Button>
                  </motion.div>
                </Group>
              </motion.div>

              <Tabs value={activeTab} onChange={(value) => value && handleTabChange(value as 'my' | 'public')} color="blue">
                <Tabs.List>
                  <motion.div
                    layout
                    style={{ display: 'flex', gap: '4px' }}
                  >
                    <Tabs.Tab
                      value="my"
                      leftSection={
                        <motion.div
                          layoutId="tab-icon-my"
                          initial={false}
                          transition={{ type: "spring", stiffness: 300, damping: 30 }}
                        >
                          <IconWorldOff size={14} />
                        </motion.div>
                      }
                    >
                      {$('我的项目')}
                    </Tabs.Tab>
                    <Tabs.Tab
                      value="public"
                      leftSection={
                        <motion.div
                          layoutId="tab-icon-public"
                          initial={false}
                          transition={{ type: "spring", stiffness: 300, damping: 30 }}
                        >
                          <IconWorld size={14} />
                        </motion.div>
                      }
                    >
                      {$('公开项目')}
                    </Tabs.Tab>
                  </motion.div>
                </Tabs.List>

                <Tabs.Panel value="my" pt="xs">
                  <div style={{ maxHeight: '50vh', overflowY: 'auto' }}>
                    <AnimatePresence mode="wait">
                      {myProjects.length === 0 && !loading && (
                        <motion.div
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -10 }}
                          transition={{ duration: 0.2 }}
                        >
                          <Text size="xs" c="dimmed" ta="center">{$('暂无项目')}</Text>
                        </motion.div>
                      )}
                    </AnimatePresence>
                    <Stack gap={6}>
                      {myProjects.map((p, index) => (
                        <motion.div
                          key={p.id}
                          initial={{ opacity: 0, x: -15 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: 15 }}
                          transition={{
                            duration: 0.15,
                            delay: index * 0.02,
                            type: "spring",
                            stiffness: 500,
                            damping: 25
                          }}
                          whileHover={{
                            scale: 1.005,
                            boxShadow: "0 4px 20px rgba(59, 130, 246, 0.15)",
                            borderColor: '#3b82f6',
                            backgroundColor: 'rgba(15, 23, 42, 0.8)'
                          }}
                          style={{
                            border: '1px solid rgba(59, 130, 246, 0.1)',
                            borderRadius: 8,
                            cursor: 'pointer',
                            transition: 'all 0.15s ease',
                            margin: '6px 12px',
                            padding: '2px 0',
                            backgroundColor: 'rgba(15, 23, 42, 0.6)'
                          }}
                        >
                          <Group justify="space-between" p="sm" gap="md">
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <Group gap={10} mb={6}>
                                <motion.div
                                  whileHover={{ scale: 1.02 }}
                                  transition={{ type: "spring", stiffness: 400 }}
                                >
                                  <Text
                                    size="sm"
                                    fw={currentProject?.id===p.id?600:500}
                                    c={currentProject?.id===p.id?'blue':undefined}
                                    style={{
                                      letterSpacing: '0.01em',
                                      lineHeight: 1.4
                                    }}
                                  >
                                    {p.name}
                                  </Text>
                                </motion.div>
                                {p.isPublic && (
                                  <motion.div
                                    initial={{ scale: 0, opacity: 0 }}
                                    animate={{ scale: 1, opacity: 1 }}
                                    transition={{
                                      type: "spring",
                                      stiffness: 600,
                                      damping: 25,
                                      delay: index * 0.02 + 0.08
                                    }}
                                    whileHover={{ scale: 1.1 }}
                                  >
                                    <Badge
                                      size="xs"
                                      color="green"
                                      variant="light"
                                      style={{
                                        boxShadow: '0 2px 8px rgba(34, 197, 94, 0.15)'
                                      }}
                                    >
                                      {$('公开')}
                                    </Badge>
                                  </motion.div>
                                )}
                              </Group>
                              {p.ownerName && (
                                <motion.div
                                  initial={{ opacity: 0 }}
                                  animate={{ opacity: 1 }}
                                  transition={{ delay: index * 0.02 + 0.15 }}
                                >
                                  <Text
                                    size="xs"
                                    c="dimmed"
                                    style={{
                                      letterSpacing: '0.02em',
                                      opacity: 0.8
                                    }}
                                  >
                                    {$('作者：{{name}}', { name: p.ownerName })}
                                  </Text>
                                </motion.div>
                              )}
                            </div>
                            <Group gap={6} align="center">
                              <motion.div
                                whileHover={{
                                  scale: 1.08,
                                  rotate: p.isPublic ? 15 : -15
                                }}
                                whileTap={{
                                  scale: 0.96,
                                  rotate: 0
                                }}
                                transition={{ type: "spring", stiffness: 400 }}
                              >
                                <Tooltip
                                  label={p.isPublic ? $('设为私有') : $('设为公开')}
                                  position="top"
                                  withArrow
                                >
                                  <ActionIcon
                                    size="sm"
                                    variant="subtle"
                                    color={p.isPublic ? 'green' : 'gray'}
                                    onClick={async () => handleTogglePublic(p, !p.isPublic)}
                                    style={{
                                      border: p.isPublic ? '1px solid rgba(34, 197, 94, 0.2)' : '1px solid rgba(107, 114, 128, 0.2)'
                                    }}
                                  >
                                    {p.isPublic ? <IconWorld size={14} /> : <IconWorldOff size={14} />}
                                  </ActionIcon>
                                </Tooltip>
                              </motion.div>
                              <motion.div
                                whileHover={{ scale: 1.04 }}
                                whileTap={{ scale: 0.96 }}
                                transition={{ type: "spring", stiffness: 400 }}
                              >
                                <Popover
                                  opened={popoverProjectId === p.id}
                                  onClose={closePopover}
                                  withArrow
                                  position="top"
                                  trapFocus
                                  shadow="md"
                                  radius="md"
                                  withinPortal
                                  dropdownProps={{ style: { zIndex: 9000 } }}
                                  closeOnClickOutside
                                >
                                  <Popover.Target>
                                    <Tooltip
                                      label={$t('删除项目')}
                                      position="top"
                                      withArrow
                                    >
                                      <ActionIcon
                                        size="sm"
                                        variant="subtle"
                                        color="red"
                                        onClick={() => openDeletePopover(p.id)}
                                        loading={deletingProjectId === p.id}
                                        style={{
                                          border: '1px solid rgba(239, 68, 68, 0.2)'
                                        }}
                                      >
                                        <IconTrash size={14} />
                                      </ActionIcon>
                                    </Tooltip>
                                  </Popover.Target>
                                  <Popover.Dropdown>
                                    <Text size="xs">{$t('确定要删除项目「{{name}}」吗？', { name: p.name })}</Text>
                                    <Group position="right" spacing="xs" mt="xs">
                                      <Button size="xs" variant="subtle" onClick={closePopover}>{$('取消')}</Button>
                                      <Button size="xs" color="red" loading={deletingProjectId === p.id} onClick={() => confirmPopoverDelete(p)}>{$('删除')}</Button>
                                    </Group>
                                  </Popover.Dropdown>
                                </Popover>
                              </motion.div>
                              <motion.div
                                whileHover={{
                                  scale: 1.04,
                                  x: 2
                                }}
                                whileTap={{
                                  scale: 0.98,
                                  x: 0
                                }}
                                transition={{ type: "spring", stiffness: 500 }}
                              >
                                <Button
                                  size="xs"
                                  variant="light"
                                  onClick={async () => {
                                    setCurrentProject({ id: p.id, name: p.name })
                                    setActivePanel(null)
                                  }}
                                  style={{
                                    fontWeight: 500,
                                    letterSpacing: '0.02em'
                                  }}
                                >
                                  {$('选择')}
                                </Button>
                              </motion.div>
                            </Group>
                          </Group>
                        </motion.div>
                      ))}
                    </Stack>
                  </div>
                </Tabs.Panel>

                <Tabs.Panel value="public" pt="xs">
                  <motion.div
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.15 }}
                  >
                    <Group justify="space-between" mb={8}>
                      <Text size="sm" fw={500}>{$('社区公开项目')}</Text>
                      <motion.div whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.96 }}>
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
                      </motion.div>
                    </Group>
                  </motion.div>

                  <div style={{ maxHeight: '50vh', overflowY: 'auto' }}>
                    <AnimatePresence mode="wait">
                      {loading && activeTab === 'public' && (
                        <motion.div
                          key="loading"
                          initial={{ opacity: 0, scale: 0.95 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.95 }}
                          transition={{ duration: 0.15 }}
                        >
                          <Group justify="center" py="xl">
                            <motion.div
                              animate={{ rotate: 360 }}
                              transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                            >
                              <Loader size="sm" />
                            </motion.div>
                            <Text size="sm" c="dimmed">{$('加载中...')}</Text>
                          </Group>
                        </motion.div>
                      )}

                      {!loading && publicProjects.length === 0 && (
                        <motion.div
                          key="empty"
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -10 }}
                          transition={{ duration: 0.2 }}
                        >
                          <Group justify="center" py="xl">
                            <Text size="sm" c="dimmed">{$('暂无公开项目')}</Text>
                          </Group>
                        </motion.div>
                      )}

                      {!loading && publicProjects.length > 0 && (
                        <motion.div
                          key="projects"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.2 }}
                        >
                          <Stack gap={6}>
                            {publicProjects.map((p, index) => (
                              <motion.div
                                key={p.id}
                                initial={{ opacity: 0, x: 15 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: -15 }}
                                transition={{
                                  duration: 0.15,
                                  delay: index * 0.02,
                                  type: "spring",
                                  stiffness: 500,
                                  damping: 25
                                }}
                                whileHover={{
                                  scale: 1.005,
                                  boxShadow: "0 4px 20px rgba(59, 130, 246, 0.15)",
                                  borderColor: '#3b82f6',
                                  backgroundColor: 'rgba(15, 23, 42, 0.8)'
                                }}
                                style={{
                                  border: '1px solid rgba(59, 130, 246, 0.1)',
                                  borderRadius: 8,
                                  cursor: 'pointer',
                                  transition: 'all 0.15s ease',
                                  margin: '6px 12px',
                                  padding: '2px 0',
                                  backgroundColor: 'rgba(15, 23, 42, 0.6)'
                                }}
                              >
                                <Group justify="space-between" p="xs">
                                  <div style={{ flex: 1 }}>
                                    <Group gap={8}>
                                      <Text size="sm">{p.name}</Text>
                                      <motion.div
                                        initial={{ scale: 0 }}
                                        animate={{ scale: 1 }}
                                        transition={{ type: "spring", stiffness: 600, delay: index * 0.02 + 0.05 }}
                                      >
                                        <Badge size="xs" color="blue" variant="light">{$('公开')}</Badge>
                                      </motion.div>
                                    </Group>
                                    {p.ownerName && (
                                      <Text size="xs" c="dimmed">{$('作者：{{name}}', { name: p.ownerName })}</Text>
                                    )}
                                  </div>
                                  <motion.div
                                    whileHover={{ scale: 1.05 }}
                                    whileTap={{ scale: 0.95 }}
                                  >
                                    <Button
                                      size="xs"
                                      variant="outline"
                                      leftSection={<IconCopy size={12} />}
                                      onClick={async () => handleCloneProject(p)}
                                    >
                                      {$('克隆')}
                                    </Button>
                                  </motion.div>
                                </Group>
                              </motion.div>
                            ))}
                          </Stack>
                        </motion.div>
                      )}
                    </AnimatePresence>
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
