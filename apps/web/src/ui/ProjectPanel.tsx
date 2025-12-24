import React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Paper, Title, Text, Button, Group, Stack, Transition, Tabs, Badge, ActionIcon, Tooltip, Loader, Popover, useMantineColorScheme } from '@mantine/core'
import { useUIStore } from './uiStore'
import { listProjects, upsertProject, saveProjectFlow, listPublicProjects, cloneProject, toggleProjectPublic, deleteProject, type ProjectDto } from '../api/server'
import { useRFStore } from '../canvas/store'
import { IconCopy, IconTrash, IconWorld, IconWorldOff, IconRefresh, IconLink } from '@tabler/icons-react'
import { $, $t } from '../canvas/i18n'
import { notifications } from '@mantine/notifications'
import { calculateSafeMaxHeight } from './utils/panelPosition'

export default function ProjectPanel(): JSX.Element | null {
  const active = useUIStore(s => s.activePanel)
  const setActivePanel = useUIStore(s => s.setActivePanel)
  const anchorY = useUIStore(s => s.panelAnchorY)
  const currentProject = useUIStore(s => s.currentProject)
  const setCurrentProject = useUIStore(s => s.setCurrentProject)
  const mounted = active === 'project'
  const { colorScheme } = useMantineColorScheme()
  const isDarkTheme = colorScheme === 'dark'
  const projectCardBorder = isDarkTheme ? '1px solid rgba(59, 130, 246, 0.1)' : '1px solid rgba(148, 163, 184, 0.35)'
  const projectCardBackground = isDarkTheme ? 'rgba(15, 23, 42, 0.6)' : 'rgba(255, 255, 255, 0.92)'
  const projectCardHoverBackground = isDarkTheme ? 'rgba(15, 23, 42, 0.8)' : '#f4f7ff'
  const projectCardHoverBorder = isDarkTheme ? '#3b82f6' : '#2563eb'
  const projectCardHoverShadow = isDarkTheme ? '0 4px 20px rgba(59, 130, 246, 0.15)' : '0 10px 24px rgba(15, 23, 42, 0.12)'
  const accentHoverColor = isDarkTheme ? '#60a5fa' : '#2563eb'
  const publicBadgeShadow = isDarkTheme ? '0 2px 8px rgba(34, 197, 94, 0.15)' : '0 2px 8px rgba(16, 185, 129, 0.3)'
  const togglePublicBorder = isDarkTheme ? '1px solid rgba(34, 197, 94, 0.2)' : '1px solid rgba(16, 185, 129, 0.35)'
  const togglePrivateBorder = isDarkTheme ? '1px solid rgba(107, 114, 128, 0.2)' : '1px solid rgba(148, 163, 184, 0.35)'
  const deleteActionBorder = isDarkTheme ? '1px solid rgba(239, 68, 68, 0.2)' : '1px solid rgba(248, 113, 113, 0.45)'
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

  const handleCopyShareLink = async (projectId: string) => {
    const url = (() => {
      try {
        const u = new URL(window.location.href)
        u.search = ''
        u.hash = ''
        u.pathname = `/share/${encodeURIComponent(projectId)}`
        return u.toString()
      } catch {
        return `/share/${encodeURIComponent(projectId)}`
      }
    })()

    try {
      await navigator.clipboard.writeText(url)
      notifications.show({ title: $('已复制'), message: $('分享链接已复制'), autoClose: 1500, color: 'green' })
    } catch (err) {
      console.error(err)
      notifications.show({ title: $('复制失败'), message: $('请手动复制地址栏链接'), autoClose: 2500, color: 'red' })
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

  // 计算安全的最大高度
  const maxHeight = calculateSafeMaxHeight(anchorY, 150)

  return (
    <div className="project-panel-anchor" style={{ position: 'fixed', left: 82, top: anchorY ? anchorY - 150 : 140, zIndex: 300 }} data-ux-panel>
      <Transition className="project-panel-transition" mounted={mounted} transition="pop" duration={140} timingFunction="ease">
        {(styles) => (
          <div className="project-panel-transition-inner" style={styles}>
            <Paper
              withBorder
              shadow="md"
              radius="lg"
              className="glass"
              p="md"
              style={{
                width: 500,
                maxHeight: `${maxHeight}px`,
                minHeight: 0,
                transformOrigin: 'left center',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
              }}
              data-ux-panel
            >
              <div className="project-panel-arrow panel-arrow" />
              <motion.div
                className="project-panel-header-motion"
                initial={{ opacity: 0, y: -5 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.15 }}
                style={{ position: 'sticky', top: 0, zIndex: 1, background: 'transparent' }}
              >
                <Group className="project-panel-header" justify="space-between" mb={8}>
                  <Title className="project-panel-title" order={6}>{$('项目')}</Title>
                  <motion.div className="project-panel-create-motion" whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                    <Button className="project-panel-create-button" size="xs" variant="light" onClick={async () => {
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

                <div className="project-panel-body" style={{ flex: 1, overflowY: 'auto', paddingRight: 4, minHeight: 0 }}>
                <Tabs className="project-panel-tabs" value={activeTab} onChange={(value) => value && handleTabChange(value as 'my' | 'public')} color="blue">
                  <Tabs.List className="project-panel-tab-list">
                    <motion.div
                      className="project-panel-tab-motion"
                      layout
                      style={{ display: 'flex', gap: '4px' }}
                    >
                      <Tabs.Tab
                        className="project-panel-tab"
                        value="my"
                        leftSection={
                        <motion.div
                          className="project-panel-tab-icon"
                          layoutId="tab-icon-my"
                          initial={false}
                          transition={{ type: "spring", stiffness: 300, damping: 30 }}
                        >
                          <IconWorldOff className="project-panel-tab-icon-svg" size={14} />
                        </motion.div>
                      }
                    >
                      <motion.span
                        className="project-panel-tab-label"
                        initial={{ opacity: 0.7 }}
                        animate={activeTab === 'my' ? { opacity: 1, scale: 1.02 } : { opacity: 0.85 }}
                        whileHover={{ scale: 1.05, color: accentHoverColor }}
                        transition={{ duration: 0.2 }}
                      >
                        {$('我的项目')}
                      </motion.span>
                    </Tabs.Tab>
                      <Tabs.Tab
                        className="project-panel-tab"
                        value="public"
                        leftSection={
                          <motion.div
                            className="project-panel-tab-icon"
                            layoutId="tab-icon-public"
                            initial={false}
                            transition={{ type: "spring", stiffness: 300, damping: 30 }}
                          >
                            <IconWorld className="project-panel-tab-icon-svg" size={14} />
                          </motion.div>
                        }
                      >
                        <motion.span
                          className="project-panel-tab-label"
                          initial={{ opacity: 0.7 }}
                          animate={activeTab === 'public' ? { opacity: 1, scale: 1.02 } : { opacity: 0.85 }}
                          whileHover={{ scale: 1.05, color: accentHoverColor }}
                          transition={{ duration: 0.2 }}
                        >
                          {$('公开项目')}
                        </motion.span>
                      </Tabs.Tab>
                    </motion.div>
                  </Tabs.List>

                  <Tabs.Panel className="project-panel-tab-panel" value="my" pt="xs">
                    <motion.div
                      className="project-panel-section-motion"
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.2 }}
                    >
                      <Group className="project-panel-section-header" mb="xs" spacing="xs">
                        <motion.div
                          className="project-panel-section-title-motion"
                          initial={{ scale: 0.98 }}
                          animate={{ scale: 1 }}
                          transition={{ duration: 0.3 }}
                        >
                          <Text className="project-panel-section-title" size="xs" c="dimmed">{$('我的项目')}</Text>
                        </motion.div>
                        <motion.div
                          className="project-panel-hot-badge-motion"
                          whileHover={{ scale: 1.03 }}
                          whileTap={{ scale: 0.97 }}
                        >
                          <Badge className="project-panel-hot-badge" color="blue" variant="outline">{$('热门')}</Badge>
                        </motion.div>
                      </Group>
                    </motion.div>
                    <div className="project-panel-my-list">
                    <AnimatePresence className="project-panel-my-list-presence" mode="wait">
                      {myProjects.length === 0 && !loading && (
                        <motion.div
                          className="project-panel-empty-motion"
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -10 }}
                          transition={{ duration: 0.2 }}
                        >
                          <Text className="project-panel-empty-text" size="xs" c="dimmed" ta="center">{$('暂无项目')}</Text>
                        </motion.div>
                      )}
                    </AnimatePresence>
                    <Stack className="project-panel-list" gap={6}>
                      {myProjects.map((p, index) => (
                        <motion.div
                          className="project-panel-card-motion"
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
                            boxShadow: projectCardHoverShadow,
                            borderColor: projectCardHoverBorder,
                            backgroundColor: projectCardHoverBackground
                          }}
                          style={{
                            border: projectCardBorder,
                            borderRadius: 8,
                            cursor: 'pointer',
                            transition: 'all 0.15s ease',
                            margin: '6px 12px',
                            padding: '2px 0',
                            backgroundColor: projectCardBackground
                          }}
                        >
                          <Group className="project-panel-card" justify="space-between" p="sm" gap="md">
                            <div className="project-panel-card-main" style={{ flex: 1, minWidth: 0 }}>
                              <Group className="project-panel-card-title-row" gap={10} mb={6}>
                                <motion.div
                                  className="project-panel-card-title-motion"
                                  whileHover={{ scale: 1.02 }}
                                  transition={{ type: "spring", stiffness: 400 }}
                                >
                                  <Text
                                    className="project-panel-card-title"
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
                                    className="project-panel-public-badge-motion"
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
                                      className="project-panel-public-badge"
                                      size="xs"
                                      color="green"
                                      variant="light"
                                      style={{
                                        boxShadow: publicBadgeShadow
                                      }}
                                    >
                                      {$('公开')}
                                    </Badge>
                                  </motion.div>
                                )}
                              </Group>
                              {p.ownerName && (
                                <motion.div
                                  className="project-panel-owner-motion"
                                  initial={{ opacity: 0 }}
                                  animate={{ opacity: 1 }}
                                  transition={{ delay: index * 0.02 + 0.15 }}
                                >
                                  <Text
                                    className="project-panel-owner"
                                    size="xs"
                                    c="dimmed"
                                    style={{
                                      letterSpacing: '0.02em',
                                      opacity: 0.8
                                    }}
                                  >
                                    {$t('作者：{{name}}', { name: p.ownerName })}
                                  </Text>
                                </motion.div>
                              )}
                            </div>
                            <Group className="project-panel-card-actions" gap={6} align="center">
                              <motion.div
                                className="project-panel-toggle-motion"
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
                                  className="project-panel-toggle-tooltip"
                                  label={p.isPublic ? $('设为私有') : $('设为公开')}
                                  position="top"
                                  withArrow
                                >
                                  <ActionIcon
                                    className="project-panel-toggle-action"
                                    size="sm"
                                    variant="subtle"
                                    color={p.isPublic ? 'green' : 'gray'}
                                    onClick={async () => handleTogglePublic(p, !p.isPublic)}
                                    style={{
                                      border: p.isPublic ? togglePublicBorder : togglePrivateBorder
                                    }}
                                  >
                                    {p.isPublic ? <IconWorld className="project-panel-toggle-icon" size={14} /> : <IconWorldOff className="project-panel-toggle-icon" size={14} />}
                                  </ActionIcon>
                                </Tooltip>
                              </motion.div>
                              {p.isPublic && (
                                <motion.div
                                  className="project-panel-share-motion"
                                  whileHover={{ scale: 1.08 }}
                                  whileTap={{ scale: 0.96 }}
                                  transition={{ type: "spring", stiffness: 400 }}
                                >
                                  <Tooltip
                                    className="project-panel-share-tooltip"
                                    label={$('复制分享链接')}
                                    position="top"
                                    withArrow
                                  >
                                    <ActionIcon
                                      className="project-panel-share-action"
                                      size="sm"
                                      variant="subtle"
                                      color="blue"
                                      onClick={async (e) => {
                                        e.preventDefault()
                                        e.stopPropagation()
                                        await handleCopyShareLink(p.id)
                                      }}
                                      style={{
                                        border: isDarkTheme ? '1px solid rgba(59, 130, 246, 0.18)' : '1px solid rgba(37, 99, 235, 0.25)'
                                      }}
                                    >
                                      <IconLink className="project-panel-share-icon" size={14} />
                                    </ActionIcon>
                                  </Tooltip>
                                </motion.div>
                              )}
                              <motion.div
                                className="project-panel-delete-motion"
                                whileHover={{ scale: 1.04 }}
                                whileTap={{ scale: 0.96 }}
                                transition={{ type: "spring", stiffness: 400 }}
                              >
                                <Popover
                                  className="project-panel-delete-popover"
                                  opened={popoverProjectId === p.id}
                                  onClose={closePopover}
                                  withArrow
                                  position="top"
                                  trapFocus
                                  shadow="md"
                                  radius="md"
                                  withinPortal
                                  dropdownProps={{ withinPortal: true, zIndex: 9000 }}
                                  closeOnClickOutside
                                >
                                  <Popover.Target className="project-panel-delete-target">
                                    <Tooltip
                                      className="project-panel-delete-tooltip"
                                      label={$t('删除项目')}
                                      position="top"
                                      withArrow
                                    >
                                      <ActionIcon
                                        className="project-panel-delete-action"
                                        size="sm"
                                        variant="subtle"
                                        color="red"
                                        onClick={() => openDeletePopover(p.id)}
                                        loading={deletingProjectId === p.id}
                                        style={{
                                          border: deleteActionBorder
                                        }}
                                      >
                                        <IconTrash className="project-panel-delete-icon" size={14} />
                                      </ActionIcon>
                                    </Tooltip>
                                  </Popover.Target>
                                  <Popover.Dropdown className="project-panel-delete-dropdown">
                                    <Text className="project-panel-delete-text" size="xs">{$t('确定要删除项目「{{name}}」吗？', { name: p.name })}</Text>
                                    <Group className="project-panel-delete-actions" position="right" spacing="xs" mt="xs">
                                      <Button className="project-panel-delete-cancel" size="xs" variant="subtle" onClick={closePopover}>{$('取消')}</Button>
                                      <Button className="project-panel-delete-confirm" size="xs" color="red" loading={deletingProjectId === p.id} onClick={() => confirmPopoverDelete(p)}>{$('删除')}</Button>
                                    </Group>
                                  </Popover.Dropdown>
                                </Popover>
                              </motion.div>
                              <motion.div
                                className="project-panel-select-motion"
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
                                  className="project-panel-select-button"
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

                <Tabs.Panel className="project-panel-tab-panel" value="public" pt="xs">
                  <motion.div
                    className="project-panel-section-motion"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    <Group className="project-panel-section-header" mb="xs" align="center" spacing="xs">
                      <motion.div
                        className="project-panel-section-title-motion"
                        whileHover={{ scale: 1.02 }}
                        transition={{ duration: 0.2 }}
                      >
                        <Text className="project-panel-section-title" size="xs" c="dimmed">{$('公开项目')}</Text>
                      </motion.div>
                      <motion.div
                        className="project-panel-public-icon-motion"
                        animate={{ rotate: activeTab === 'public' ? 0 : -5 }}
                        transition={{ duration: 0.3, type: 'spring', stiffness: 200 }}
                      >
                        <IconWorld className="project-panel-public-icon" size={12} />
                      </motion.div>
                    </Group>
                  </motion.div>
                  <motion.div
                    className="project-panel-public-header-motion"
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.15 }}
                  >
                    <Group className="project-panel-public-header" justify="space-between" mb={8}>
                      <Text className="project-panel-public-title" size="sm" fw={500}>{$('社区公开项目')}</Text>
                      <motion.div className="project-panel-public-refresh-motion" whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.96 }}>
                        <Tooltip className="project-panel-public-refresh-tooltip" label={$('刷新公开项目')}>
                          <ActionIcon
                            className="project-panel-public-refresh-action"
                            size="sm"
                            variant="subtle"
                            onClick={handleRefreshPublicProjects}
                            loading={loading && activeTab === 'public'}
                          >
                            <IconRefresh className="project-panel-public-refresh-icon" size={14} />
                          </ActionIcon>
                        </Tooltip>
                      </motion.div>
                    </Group>
                  </motion.div>

                  <div className="project-panel-public-body" style={{ maxHeight: '50vh', overflowY: 'auto' }}>
                    <AnimatePresence className="project-panel-public-presence" mode="wait">
                      {loading && activeTab === 'public' && (
                        <motion.div
                          className="project-panel-public-loading-motion"
                          key="loading"
                          initial={{ opacity: 0, scale: 0.95 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.95 }}
                          transition={{ duration: 0.15 }}
                        >
                          <Group className="project-panel-public-loading" justify="center" py="xl">
                            <motion.div
                              className="project-panel-public-loading-spinner"
                              animate={{ rotate: 360 }}
                              transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                            >
                              <Loader className="project-panel-public-loading-icon" size="sm" />
                            </motion.div>
                            <Text className="project-panel-public-loading-text" size="sm" c="dimmed">{$('加载中...')}</Text>
                          </Group>
                        </motion.div>
                      )}

                      {!loading && publicProjects.length === 0 && (
                        <motion.div
                          className="project-panel-public-empty-motion"
                          key="empty"
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -10 }}
                          transition={{ duration: 0.2 }}
                        >
                          <Group className="project-panel-public-empty" justify="center" py="xl">
                            <Text className="project-panel-public-empty-text" size="sm" c="dimmed">{$('暂无公开项目')}</Text>
                          </Group>
                        </motion.div>
                      )}

                      {!loading && publicProjects.length > 0 && (
                        <motion.div
                          className="project-panel-public-list-motion"
                          key="projects"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.2 }}
                        >
                          <Stack className="project-panel-public-list" gap={6}>
                            {publicProjects.map((p, index) => (
                              <motion.div
                                className="project-panel-public-card-motion"
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
                                  boxShadow: projectCardHoverShadow,
                                  borderColor: projectCardHoverBorder,
                                  backgroundColor: projectCardHoverBackground
                                }}
                                style={{
                                  border: projectCardBorder,
                                  borderRadius: 8,
                                  cursor: 'pointer',
                                  transition: 'all 0.15s ease',
                                  margin: '6px 12px',
                                  padding: '2px 0',
                                  backgroundColor: projectCardBackground
                                }}
                              >
                                <Group className="project-panel-public-card" justify="space-between" p="xs">
                                  <div className="project-panel-public-card-main" style={{ flex: 1 }}>
                                    <Group className="project-panel-public-card-title-row" gap={8}>
                                      <Text className="project-panel-public-card-title" size="sm">{p.name}</Text>
                                      <motion.div
                                        className="project-panel-public-badge-motion"
                                        initial={{ scale: 0 }}
                                        animate={{ scale: 1 }}
                                        transition={{ type: "spring", stiffness: 600, delay: index * 0.02 + 0.05 }}
                                      >
                                        <Badge className="project-panel-public-badge" size="xs" color="blue" variant="light">{$('公开')}</Badge>
                                      </motion.div>
                                    </Group>
                                    {p.ownerName && (
                                      <Text className="project-panel-public-card-owner" size="xs" c="dimmed">{$t('作者：{{name}}', { name: p.ownerName })}</Text>
                                    )}
                                  </div>
                                  <motion.div
                                    className="project-panel-public-clone-motion"
                                    whileHover={{ scale: 1.05 }}
                                    whileTap={{ scale: 0.95 }}
                                  >
                                    <Button
                                      className="project-panel-public-clone-button"
                                      size="xs"
                                      variant="outline"
                                      leftSection={<IconCopy className="project-panel-public-clone-icon" size={12} />}
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
                </div>
            </Paper>
          </div>
        )}
      </Transition>
    </div>
  )
}
