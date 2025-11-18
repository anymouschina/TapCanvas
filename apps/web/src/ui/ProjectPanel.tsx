import React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
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
          backgroundColor: 'rgba(34, 197, 94, 0.1)',
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
          backgroundColor: 'rgba(239, 68, 68, 0.1)',
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
          backgroundColor: 'rgba(34, 197, 94, 0.1)',
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
          backgroundColor: 'rgba(239, 68, 68, 0.1)',
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
          backgroundColor: isPublic ? 'rgba(34, 197, 94, 0.1)' : 'rgba(59, 130, 246, 0.1)',
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
          backgroundColor: 'rgba(239, 68, 68, 0.1)',
          border: '1px solid rgba(239, 68, 68, 0.2)',
        }
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
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
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

              <Tabs value={activeTab} onChange={(value) => value && setActiveTab(value as 'my' | 'public')} color="blue">
                <Tabs.List>
                  <motion.div
                    layout
                    style={{ display: 'flex', gap: '4px' }}
                  >
                    <Tabs.Tab
                      value="my"
                      leftSection={
                        <motion.div
                          layoutId="tab-icon"
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
                          layoutId="tab-icon"
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
                          initial={{ opacity: 0, y: 20 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -20 }}
                          transition={{ duration: 0.3 }}
                        >
                          <Text size="xs" c="dimmed" ta="center">{$('暂无项目')}</Text>
                        </motion.div>
                      )}
                    </AnimatePresence>
                    <Stack gap={6}>
                      {myProjects.map((p, index) => (
                        <motion.div
                          key={p.id}
                          initial={{ opacity: 0, x: -20 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: 20 }}
                          transition={{
                            duration: 0.2,
                            delay: index * 0.05,
                            type: "spring",
                            stiffness: 300,
                            damping: 20
                          }}
                          whileHover={{
                            scale: 1.02,
                            boxShadow: "0 4px 20px rgba(0, 0, 0, 0.1)",
                            borderColor: '#3b82f6'
                          }}
                          style={{
                            border: '1px solid #eee',
                            borderRadius: 8,
                            cursor: 'pointer',
                            transition: 'all 0.2s ease'
                          }}
                        >
                          <Group justify="space-between" p="xs">
                            <div style={{ flex: 1 }}>
                              <Group gap={8}>
                                <Text
                                  size="sm"
                                  fw={currentProject?.id===p.id?600:400}
                                  c={currentProject?.id===p.id?undefined:'dimmed'}
                                >
                                  {p.name}
                                </Text>
                                {p.isPublic && (
                                  <motion.div
                                    initial={{ scale: 0 }}
                                    animate={{ scale: 1 }}
                                    transition={{ type: "spring", stiffness: 500, delay: index * 0.05 + 0.1 }}
                                  >
                                    <Badge size="xs" color="green" variant="light">{$('公开')}</Badge>
                                  </motion.div>
                                )}
                              </Group>
                              {p.ownerName && (
                                <Text size="xs" c="dimmed">{$('作者：{{name}}', { name: p.ownerName })}</Text>
                              )}
                            </div>
                            <Group gap={4}>
                              <motion.div whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}>
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
                              </motion.div>
                              <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                                <Button
                                  size="xs"
                                  variant="light"
                                  onClick={async () => {
                                    setCurrentProject({ id: p.id, name: p.name })
                                    setActivePanel(null)
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
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3 }}
                  >
                    <Group justify="space-between" mb={8}>
                      <Text size="sm" fw={500}>{$('社区公开项目')}</Text>
                      <motion.div whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}>
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
                          initial={{ opacity: 0, scale: 0.8 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.8 }}
                          transition={{ duration: 0.2 }}
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
                          initial={{ opacity: 0, y: 20 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -20 }}
                          transition={{ duration: 0.3 }}
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
                                initial={{ opacity: 0, x: 20 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: -20 }}
                                transition={{
                                  duration: 0.2,
                                  delay: index * 0.05,
                                  type: "spring",
                                  stiffness: 300,
                                  damping: 20
                                }}
                                whileHover={{
                                  scale: 1.02,
                                  boxShadow: "0 4px 20px rgba(0, 0, 0, 0.1)",
                                  borderColor: '#3b82f6',
                                  backgroundColor: 'rgba(59, 130, 246, 0.02)'
                                }}
                                style={{
                                  border: '1px solid #eee',
                                  borderRadius: 8,
                                  cursor: 'pointer',
                                  transition: 'all 0.2s ease'
                                }}
                              >
                                <Group justify="space-between" p="xs">
                                  <div style={{ flex: 1 }}>
                                    <Group gap={8}>
                                      <Text size="sm">{p.name}</Text>
                                      <motion.div
                                        initial={{ scale: 0 }}
                                        animate={{ scale: 1 }}
                                        transition={{ type: "spring", stiffness: 500, delay: index * 0.05 + 0.1 }}
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
