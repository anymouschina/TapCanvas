import React from 'react'
import { Title, Tabs, SimpleGrid, Image, Text, Button, Group, Stack, Transition, TextInput, ActionIcon, Modal, ScrollArea, Textarea, useMantineColorScheme } from '@mantine/core'
import { IconArrowsMaximize, IconBrackets, IconChevronDown, IconChevronLeft, IconClock, IconEdit, IconFolder, IconSearch, IconX } from '@tabler/icons-react'
import { useUIStore } from './uiStore'
import { listProjects, listPublicProjects, listServerFlows, listProjectFlows, updateProjectTemplate, type FlowDto, type ProjectDto } from '../api/server'
import { $, $t } from '../canvas/i18n'
import { calculateSafeMaxHeight } from './utils/panelPosition'
import { toast } from './toast'
import { sanitizeGraphForCanvas, useRFStore } from '../canvas/store'
import { extractCanvasGraph, type CanvasImportData } from '../canvas/utils/serialization'
import { stopPanelWheelPropagation } from './utils/panelWheel'
import { PanelCard } from './PanelCard'

type TemplateCategoryKey = 'all' | 'recent' | 'mine' | 'public'

const TEMPLATE_CATEGORY_LABELS: Record<TemplateCategoryKey, string> = {
  all: '全部',
  recent: '最近使用',
  mine: '我的模板',
  public: '公开模板',
}

const TEMPLATE_PUBLIC_CATEGORY_ITEMS: ReadonlyArray<TemplateCategoryKey> = [
  'all',
  'public',
]

const TEMPLATE_RECENT_STORAGE_KEY = 'tapcanvas_template_recent_v1'
const TEMPLATE_RECENT_LIMIT = 24

function PlaceholderImage({ label }: { label: string }) {
  const { colorScheme } = useMantineColorScheme()
  const palette = colorScheme === 'light'
    ? {
        from: '#f8fafc',
        to: '#e2e8f0',
        text: '#334155',
      }
    : {
        from: '#1f2937',
        to: '#111827',
        text: '#e5e7eb',
      }
  const svg = encodeURIComponent(`<?xml version="1.0" encoding="UTF-8"?><svg xmlns='http://www.w3.org/2000/svg' width='480' height='270'><defs><linearGradient id='g' x1='0' x2='1'><stop offset='0%' stop-color='${palette.from}'/><stop offset='100%' stop-color='${palette.to}'/></linearGradient></defs><rect width='100%' height='100%' fill='url(#g)'/><text x='50%' y='50%' fill='${palette.text}' dominant-baseline='middle' text-anchor='middle' font-size='16' font-family='system-ui'>${label}</text></svg>`)
  return <Image className="template-panel-placeholder" src={`data:image/svg+xml;charset=UTF-8,${svg}`} alt={label} radius="sm" />
}

type TemplateLibraryCard = {
  id: string
  title: string
  description: string
  coverUrl: string | null
  source: 'public' | 'server'
  updatedAt: string
  actionLabel: string
  onAction: () => void
  editLabel?: string
  onEdit?: () => void
  metadataProject?: ProjectDto
}

function formatTemplateUpdatedAt(value: string): string {
  const stamp = Date.parse(value)
  if (!Number.isFinite(stamp)) return value || '未知时间'
  const date = new Date(stamp)
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  const hh = String(date.getHours()).padStart(2, '0')
  const mi = String(date.getMinutes()).padStart(2, '0')
  const ss = String(date.getSeconds()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`
}

function readRecentTemplateIds(): string[] {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(TEMPLATE_RECENT_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, TEMPLATE_RECENT_LIMIT)
  } catch {
    return []
  }
}

function writeRecentTemplateIds(nextIds: string[]): void {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') return
  try {
    window.localStorage.setItem(
      TEMPLATE_RECENT_STORAGE_KEY,
      JSON.stringify(nextIds.slice(0, TEMPLATE_RECENT_LIMIT)),
    )
  } catch {
    // ignore persistence failures
  }
}

export default function TemplatePanel({ className }: { className?: string }): JSX.Element | null {
  const active = useUIStore(s => s.activePanel)
  const setActivePanel = useUIStore(s => s.setActivePanel)
  const openLibraryFlow = useUIStore(s => s.openLibraryFlow)
  const anchorY = useUIStore(s => s.panelAnchorY)
  const addNode = useRFStore(s => s.addNode)
  const importWorkflow = useRFStore(s => s.importWorkflow)
  const currentProject = useUIStore(s => s.currentProject)
  const [myProjects, setMyProjects] = React.useState<ProjectDto[]|null>(null)
  const [serverFlows, setServerFlows] = React.useState<FlowDto[]|null>(null)
  const [publicProjects, setPublicProjects] = React.useState<ProjectDto[]|null>(null)
  const [expanded, setExpanded] = React.useState(false)
  const [search, setSearch] = React.useState('')
  const [compactTab, setCompactTab] = React.useState<'public' | 'server'>('public')
  const [expandedCategory, setExpandedCategory] = React.useState<TemplateCategoryKey>('all')
  const [selectedCard, setSelectedCard] = React.useState<TemplateLibraryCard | null>(null)
  const [recentTemplateIds, setRecentTemplateIds] = React.useState<string[]>(() => readRecentTemplateIds())
  const [jsonImportOpened, setJsonImportOpened] = React.useState(false)
  const [jsonImportValue, setJsonImportValue] = React.useState('')
  const [metadataEditorProject, setMetadataEditorProject] = React.useState<ProjectDto | null>(null)
  const [metadataEditorTitle, setMetadataEditorTitle] = React.useState('')
  const [metadataEditorDescription, setMetadataEditorDescription] = React.useState('')
  const [metadataEditorCoverUrl, setMetadataEditorCoverUrl] = React.useState('')
  const [metadataEditorSubmitting, setMetadataEditorSubmitting] = React.useState(false)
  React.useEffect(() => {
    let alive = true
    if (active === 'template') {
      listProjects().then(list => { if (alive) setMyProjects(list) }).catch(() => { if (alive) setMyProjects([]) })
      const loader = currentProject?.id ? listProjectFlows(currentProject.id) : listServerFlows()
      loader.then(list => { if (alive) setServerFlows(list) }).catch(()=>{ if (alive) setServerFlows([]) })
      listPublicProjects().then(list => { if (alive) setPublicProjects(list) }).catch(()=>{ if (alive) setPublicProjects([]) })
    }
    return () => { alive = false }
  }, [active, currentProject?.id])
  React.useEffect(() => {
    if (active !== 'template') {
      setExpanded(false)
      setSelectedCard(null)
      setMetadataEditorProject(null)
    }
  }, [active])

  const projectById = React.useMemo(() => {
    return new Map((myProjects || []).map((project) => [project.id, project] as const))
  }, [myProjects])

  const currentTemplateProject = React.useMemo(() => {
    const currentProjectId = String(currentProject?.id || '').trim()
    if (!currentProjectId) return null
    return projectById.get(currentProjectId) ?? null
  }, [currentProject?.id, projectById])

  const recordTemplateRecent = React.useCallback((cardId: string) => {
    const normalizedId = String(cardId || '').trim()
    if (!normalizedId) return
    setRecentTemplateIds((current) => {
      const next = [normalizedId, ...current.filter((item) => item !== normalizedId)].slice(0, TEMPLATE_RECENT_LIMIT)
      writeRecentTemplateIds(next)
      return next
    })
  }, [])

  const handleImportPublicTemplate = React.useCallback(async (project: ProjectDto) => {
    try {
      const flows = await listProjectFlows(project.id)
      const candidate = [...flows]
        .sort((a, b) => {
          const aTime = Date.parse(String(a.updatedAt || '')) || 0
          const bTime = Date.parse(String(b.updatedAt || '')) || 0
          return bTime - aTime
        })
        .find((flow) => Array.isArray(flow.data?.nodes) && flow.data.nodes.length > 0)
      if (!candidate) throw new Error('该模板没有可导入的工作流')
      recordTemplateRecent(`public-${project.id}`)
      importWorkflow(sanitizeGraphForCanvas(candidate.data))
      setActivePanel(null)
      toast(`已添加模板「${project.templateTitle || project.name}」到画布`, 'success')
    } catch (err: any) {
      console.error(err)
      toast(err?.message || '添加公共模板到画布失败', 'error')
    }
  }, [importWorkflow, recordTemplateRecent, setActivePanel])
  const handleReferenceServerFlow = React.useCallback((flow: FlowDto) => {
    recordTemplateRecent(`server-${flow.id}`)
    addNode('taskNode', flow.name, { kind: 'subflow', subflowRef: flow.id, autoLabel: false })
    setActivePanel(null)
    setExpanded(false)
  }, [addNode, recordTemplateRecent, setActivePanel])
  const handleEditServerFlow = React.useCallback((flow: FlowDto) => {
    recordTemplateRecent(`server-${flow.id}`)
    setSelectedCard(null)
    setExpanded(false)
    setActivePanel(null)
    openLibraryFlow(flow.id)
  }, [openLibraryFlow, recordTemplateRecent, setActivePanel])

  const openMetadataEditor = React.useCallback((project: ProjectDto) => {
    setMetadataEditorProject(project)
    setMetadataEditorTitle(String(project.templateTitle || project.name || '').trim())
    setMetadataEditorDescription(String(project.templateDescription || '').trim())
    setMetadataEditorCoverUrl(String(project.templateCoverUrl || '').trim())
  }, [])

  const applyProjectUpdate = React.useCallback((updated: ProjectDto) => {
    setMyProjects((current) => {
      if (!current) return current
      return current.map((project) => (project.id === updated.id ? updated : project))
    })
    setPublicProjects((current) => {
      if (!current) return current
      return current.map((project) => (project.id === updated.id ? updated : project))
    })
    setMetadataEditorProject(updated)
    setSelectedCard((current) => {
      if (!current?.metadataProject) return current
      if (current.metadataProject.id !== updated.id) return current
      return {
        ...current,
        title: updated.templateTitle || updated.name || current.title,
        description: updated.templateDescription || current.description,
        coverUrl: updated.templateCoverUrl || null,
        metadataProject: updated,
      }
    })
  }, [])

  const handleMetadataSubmit = React.useCallback(async () => {
    const project = metadataEditorProject
    if (!project) return
    if (metadataEditorSubmitting) return
    const templateTitle = metadataEditorTitle.trim()
    if (!templateTitle) {
      toast('请输入模板标题', 'error')
      return
    }
    setMetadataEditorSubmitting(true)
    try {
      const updated = await updateProjectTemplate(project.id, {
        templateTitle,
        templateDescription: metadataEditorDescription.trim(),
        templateCoverUrl: metadataEditorCoverUrl.trim(),
        isPublic: Boolean(project.isPublic),
      })
      applyProjectUpdate(updated)
      setMetadataEditorProject(updated)
      toast('模板信息已更新', 'success')
    } catch (error) {
      const message = error instanceof Error ? error.message : '更新模板信息失败'
      toast(message, 'error')
    } finally {
      setMetadataEditorSubmitting(false)
    }
  }, [applyProjectUpdate, metadataEditorCoverUrl, metadataEditorDescription, metadataEditorProject, metadataEditorSubmitting, metadataEditorTitle])

  const handleImportJsonSubmit = React.useCallback(() => {
    const raw = jsonImportValue.trim()
    if (!raw) {
      toast('请先粘贴画布 JSON', 'error')
      return
    }
    try {
      const parsed = JSON.parse(raw) as CanvasImportData
      const extracted = extractCanvasGraph(parsed)
      if (!extracted?.nodes.length) {
        throw new Error('JSON 缺少有效的 nodes / edges / connections')
      }
      importWorkflow(parsed)
      setJsonImportOpened(false)
      setJsonImportValue('')
      setActivePanel(null)
      setExpanded(false)
      toast('已把 JSON 添加进画布', 'success')
    } catch (error) {
      toast(error instanceof Error ? error.message : '导入 JSON 失败', 'error')
    }
  }, [importWorkflow, jsonImportValue, setActivePanel])

  const combinedCards = React.useMemo<TemplateLibraryCard[]>(() => {
    const publicCards = (publicProjects || []).map((project) => ({
      id: `public-${project.id}`,
      title: project.templateTitle || project.name,
      description: project.templateDescription || '公共模板，可直接导入到当前画布',
      coverUrl: project.templateCoverUrl || null,
      source: 'public' as const,
      updatedAt: project.updatedAt,
      actionLabel: '导入',
      onAction: () => { void handleImportPublicTemplate(project) },
      editLabel: projectById.has(project.id) ? '信息' : undefined,
      onEdit: projectById.has(project.id) ? () => { openMetadataEditor(projectById.get(project.id) || project) } : undefined,
      metadataProject: projectById.get(project.id) || project,
    }))
    const serverCards = (serverFlows || []).map((flow) => ({
      id: `server-${flow.id}`,
      title: currentTemplateProject?.templateTitle || flow.name,
      description: currentTemplateProject?.templateDescription
        ? `${currentTemplateProject.templateDescription} · 工作流：${flow.name}`
        : '当前项目或服务端工作流，可作为子流程引用',
      coverUrl: currentTemplateProject?.templateCoverUrl || null,
      source: 'server' as const,
      updatedAt: flow.updatedAt,
      actionLabel: '引用',
      onAction: () => { handleReferenceServerFlow(flow) },
      editLabel: currentTemplateProject ? '信息' : '编辑',
      onEdit: currentTemplateProject
        ? () => { openMetadataEditor(currentTemplateProject) }
        : () => { handleEditServerFlow(flow) },
      metadataProject: currentTemplateProject || undefined,
    }))
    return [...publicCards, ...serverCards]
      .sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0))
  }, [currentTemplateProject, handleEditServerFlow, handleImportPublicTemplate, handleReferenceServerFlow, openMetadataEditor, projectById, publicProjects, serverFlows])

  const filteredExpandedCards = React.useMemo(() => {
    const keyword = search.trim().toLowerCase()
    const recentIndexMap = new Map(recentTemplateIds.map((id, index) => [id, index]))
    const baseCards = expandedCategory === 'recent'
      ? combinedCards
          .filter((card) => recentIndexMap.has(card.id))
          .sort((a, b) => (recentIndexMap.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (recentIndexMap.get(b.id) ?? Number.MAX_SAFE_INTEGER))
      : combinedCards
    return combinedCards.filter((card) => {
      if (expandedCategory === 'recent') {
        return false
      }
      if (expandedCategory === 'mine' && card.source !== 'server') return false
      if (expandedCategory === 'public' && card.source !== 'public') return false
      if (!keyword) return true
      return [card.title, card.description].some((value) => value.toLowerCase().includes(keyword))
    })
    .concat(
      expandedCategory === 'recent'
        ? baseCards.filter((card) => {
            if (!keyword) return true
            return [card.title, card.description].some((value) => value.toLowerCase().includes(keyword))
          })
        : [],
    )
  }, [combinedCards, expandedCategory, recentTemplateIds, search])

  const expandedCategoryLabel = TEMPLATE_CATEGORY_LABELS[expandedCategory]

  const renderTemplateSidebar = React.useCallback((activeCategory: TemplateCategoryKey, onCategoryChange: (value: TemplateCategoryKey) => void) => (
    <>
      <button type="button" className="template-space-sidebar-entry" data-active={activeCategory === 'recent' ? 'true' : 'false'} onClick={() => onCategoryChange('recent')}>
        <IconClock size={16} />
        <span>{TEMPLATE_CATEGORY_LABELS.recent}</span>
      </button>
      <button type="button" className="template-space-sidebar-entry" data-active={activeCategory === 'mine' ? 'true' : 'false'} onClick={() => onCategoryChange('mine')}>
        <IconFolder size={16} />
        <span>{TEMPLATE_CATEGORY_LABELS.mine}</span>
      </button>
      <div className="template-space-sidebar-group">
        <div className="template-space-sidebar-group-header">
          <span>公开</span>
          <IconChevronDown size={14} />
        </div>
        {TEMPLATE_PUBLIC_CATEGORY_ITEMS.map((categoryKey) => (
          <button
            key={categoryKey}
            type="button"
            className="template-space-sidebar-entry template-space-sidebar-entry--nested"
            data-active={activeCategory === categoryKey ? 'true' : 'false'}
            onClick={() => onCategoryChange(categoryKey)}
          >
            <span>{TEMPLATE_CATEGORY_LABELS[categoryKey]}</span>
          </button>
        ))}
      </div>
    </>
  ), [])

  const handleViewCard = React.useCallback((card: TemplateLibraryCard) => {
    recordTemplateRecent(card.id)
    if (!expanded) {
      setExpandedCategory(card.source === 'public' ? 'public' : 'mine')
      setExpanded(true)
    }
    setSelectedCard(card)
  }, [expanded, recordTemplateRecent])

  const renderTemplateCard = React.useCallback((card: TemplateLibraryCard, dense: boolean) => (
    <PanelCard className={dense ? 'template-panel-card template-panel-card--compact' : 'template-panel-card template-panel-card--expanded'} key={card.id}>
      <div className="template-panel-card-media">
        {card.coverUrl ? (
          <Image className="template-panel-card-cover" src={card.coverUrl} alt={card.title} radius="sm" />
        ) : (
          <PlaceholderImage label={card.title} />
        )}
        <div className="template-panel-card-overlay">
          <Button className="template-panel-card-overlay-button" size="xs" variant="default" onClick={() => handleViewCard(card)}>查看</Button>
          {card.onEdit ? (
            <Button className="template-panel-card-overlay-button" size="xs" variant="default" onClick={card.onEdit}>
              {card.editLabel || '编辑'}
            </Button>
          ) : null}
          <Button className="template-panel-card-overlay-button template-panel-card-overlay-button--primary" size="xs" onClick={card.onAction}>{card.actionLabel}</Button>
        </div>
      </div>
      <Stack className="template-panel-card-meta" gap={dense ? 4 : 6} mt="sm">
        <Text className="template-panel-card-title" size={dense ? 'sm' : 'md'} lineClamp={1}>{card.title}</Text>
      </Stack>
    </PanelCard>
  ), [handleViewCard])

  const mounted = active === 'template'
  if (!mounted) return null

  // 计算安全的最大高度
  const maxHeight = calculateSafeMaxHeight(anchorY, 150)

  const panelClassName = ['template-panel', className].filter(Boolean).join(' ')

  return (
    <div className={panelClassName} style={{ position: 'fixed', left: 82, top: (anchorY ? anchorY - 150 : 140), zIndex: 200 }} data-ux-panel>
      <Transition className="template-panel-transition" mounted={mounted} transition="pop" duration={140} timingFunction="ease">
        {(styles) => (
          <div className="template-panel-transition-inner" style={styles}>
            <PanelCard
              className="template-panel-shell"
              padding="compact"
              style={{
                width: 664,
                maxHeight: `${maxHeight}px`,
                minHeight: 0,
                transformOrigin: 'left center',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
              }}
              onWheelCapture={stopPanelWheelPropagation}
              data-ux-panel
            >
              <div className="template-panel-arrow panel-arrow" />
              <Tabs className="template-panel-tabs" value={compactTab} onChange={(value) => setCompactTab(value === 'server' ? 'server' : 'public')} keepMounted={false}>
                <div className="template-panel-topbar">
                  <Tabs.List className="template-panel-tab-list">
                    <Tabs.Tab className="template-panel-tab" value="public">{$('公共模板')}</Tabs.Tab>
                    <Tabs.Tab className="template-panel-tab" value="server">{$('我的模板')}</Tabs.Tab>
                  </Tabs.List>
                  <Group className="template-panel-topbar-actions" gap="xs">
                    <Button
                      className="template-panel-import-json-button"
                      size="xs"
                      variant="light"
                      leftSection={<IconBrackets size={14} />}
                      onClick={() => setJsonImportOpened(true)}
                    >
                      导入 JSON
                    </Button>
                    <ActionIcon className="template-panel-expand-button" variant="subtle" radius="md" size={32} onClick={() => setExpanded(true)} aria-label="展开模板空间">
                      <IconArrowsMaximize size={16} />
                    </ActionIcon>
                  </Group>
                </div>
                <div className="template-panel-body">
                  <Tabs.Panel className="template-panel-tab-panel" value="public" pt="md">
                    {publicProjects === null ? <Text className="template-panel-empty" size="xs" c="dimmed">载入中...</Text> : null}
                    {publicProjects && publicProjects.length === 0 ? <Text className="template-panel-empty" size="xs" c="dimmed">暂无公共模板</Text> : null}
                    {publicProjects && publicProjects.length > 0 ? (
                      <ScrollArea className="template-panel-scroll" type="never" scrollbarSize={6}>
                        <SimpleGrid className="template-panel-grid" cols={{ base: 2, sm: 3 }} spacing="md">
                          {publicProjects.map((project) => renderTemplateCard({
                            id: `compact-public-${project.id}`,
                            title: project.templateTitle || project.name,
                            description: project.templateDescription || '公共模板，可直接导入到当前画布',
                            coverUrl: project.templateCoverUrl || null,
                            source: 'public',
                            updatedAt: project.updatedAt,
                            actionLabel: '导入',
                            onAction: () => { void handleImportPublicTemplate(project) },
                            editLabel: projectById.has(project.id) ? '信息' : undefined,
                            onEdit: projectById.has(project.id) ? () => { openMetadataEditor(projectById.get(project.id) || project) } : undefined,
                            metadataProject: projectById.get(project.id) || project,
                          }, true))}
                        </SimpleGrid>
                      </ScrollArea>
                    ) : null}
                  </Tabs.Panel>
                  <Tabs.Panel className="template-panel-tab-panel" value="server" pt="md">
                    {serverFlows === null ? <Text className="template-panel-empty" size="xs" c="dimmed">载入中...</Text> : null}
                    {serverFlows && serverFlows.length === 0 ? <Text className="template-panel-empty" size="xs" c="dimmed">服务端暂无工作流</Text> : null}
                    {serverFlows && serverFlows.length > 0 ? (
                      <ScrollArea className="template-panel-scroll" type="never" scrollbarSize={6}>
                        <SimpleGrid className="template-panel-grid" cols={{ base: 2, sm: 3 }} spacing="md">
                          {serverFlows.map((flow) => renderTemplateCard({
                            id: `compact-server-${flow.id}`,
                            title: currentTemplateProject?.templateTitle || flow.name,
                            description: currentTemplateProject?.templateDescription
                              ? `${currentTemplateProject.templateDescription} · 工作流：${flow.name}`
                              : '当前项目或服务端工作流，可作为子流程引用',
                            coverUrl: currentTemplateProject?.templateCoverUrl || null,
                            source: 'server',
                            updatedAt: flow.updatedAt,
                            actionLabel: '引用',
                            onAction: () => { handleReferenceServerFlow(flow) },
                            editLabel: currentTemplateProject ? '信息' : '编辑',
                            onEdit: currentTemplateProject
                              ? () => { openMetadataEditor(currentTemplateProject) }
                              : () => { handleEditServerFlow(flow) },
                            metadataProject: currentTemplateProject || undefined,
                          }, true))}
                        </SimpleGrid>
                      </ScrollArea>
                    ) : null}
                  </Tabs.Panel>
                </div>
              </Tabs>
            </PanelCard>
          </div>
        )}
      </Transition>
      <Modal
        className="template-space-modal"
        opened={expanded}
        onClose={() => {
          setSelectedCard(null)
          setExpanded(false)
        }}
        withCloseButton={false}
        centered
        size="min(1120px, calc(100vw - 96px))"
        padding={0}
        radius={24}
        overlayProps={{ backgroundOpacity: 0.62, blur: 2 }}
      >
        <div className="template-space">
          <aside className={selectedCard ? 'template-space-sidebar template-detail-sidebar' : 'template-space-sidebar'}>
            {renderTemplateSidebar(expandedCategory, setExpandedCategory)}
          </aside>
          {selectedCard ? (
            <section className="template-detail-main">
              <div className="template-detail-header">
                <Title className="template-detail-titlebar" order={2}>{expandedCategoryLabel}</Title>
                <ActionIcon className="template-space-close" variant="subtle" radius="md" onClick={() => setSelectedCard(null)} aria-label="关闭模板详情">
                  <IconX size={18} />
                </ActionIcon>
              </div>
              <div className="template-detail-content">
                <button type="button" className="template-detail-back" onClick={() => setSelectedCard(null)} aria-label="返回模板列表">
                  <IconChevronLeft size={18} />
                </button>
                <div className="template-detail-hero">
                  <div className="template-detail-cover-wrap">
                    {selectedCard.coverUrl ? (
                      <Image className="template-detail-cover" src={selectedCard.coverUrl} alt={selectedCard.title} radius="md" />
                    ) : (
                      <PlaceholderImage label={selectedCard.title} />
                    )}
                  </div>
                  <div className="template-detail-copy">
                    <Text className="template-detail-name">{selectedCard.title}</Text>
                    <Text className="template-detail-time">{formatTemplateUpdatedAt(selectedCard.updatedAt)}</Text>
                    <Group className="template-detail-tags" gap="xs">
                      <span className="template-detail-tag">{selectedCard.source === 'public' ? '公开模板' : '我的模板'}</span>
                      <span className="template-detail-tag">工作流</span>
                      <span className="template-detail-tag">{selectedCard.actionLabel}</span>
                    </Group>
                    <Text className="template-detail-description">
                      {selectedCard.description || '暂无描述'}
                    </Text>
                    <Group className="template-detail-actions" gap="sm">
                      {selectedCard.onEdit ? (
                        <Button
                          className="template-detail-edit"
                          variant="default"
                          leftSection={<IconEdit size={16} />}
                          onClick={selectedCard.onEdit}
                        >
                          {selectedCard.editLabel || '编辑'}
                        </Button>
                      ) : null}
                      <Button className="template-detail-apply" onClick={selectedCard.onAction}>
                        {selectedCard.actionLabel}
                      </Button>
                    </Group>
                  </div>
                </div>
                <div className="template-detail-strip">
                  {filteredExpandedCards.slice(0, 7).map((card) => (
                    <button key={`detail-strip-${card.id}`} type="button" className="template-detail-strip-card" onClick={() => setSelectedCard(card)}>
                      {card.coverUrl ? (
                        <img className="template-detail-strip-image" src={card.coverUrl} alt={card.title} />
                      ) : (
                        <div className="template-detail-strip-fallback">{card.title.slice(0, 2)}</div>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            </section>
          ) : (
            <section className="template-space-main">
              <div className="template-space-header">
                <Title className="template-space-title" order={2}>{expandedCategoryLabel}</Title>
                <ActionIcon className="template-space-close" variant="subtle" radius="md" onClick={() => setExpanded(false)} aria-label="关闭模板空间">
                  <IconX size={18} />
                </ActionIcon>
              </div>
              <div className="template-space-toolbar">
                <TextInput
                  className="template-space-search"
                  value={search}
                  onChange={(event) => setSearch(event.currentTarget.value)}
                  placeholder="搜索 场景/平台/模型..."
                  leftSection={<IconSearch size={16} />}
                />
                <Button className="template-space-search-button" variant="light" aria-label="搜索">
                  <IconSearch size={18} />
                </Button>
                <Button
                  className="template-space-import-json-button"
                  variant="light"
                  leftSection={<IconBrackets size={16} />}
                  onClick={() => setJsonImportOpened(true)}
                >
                  导入 JSON
                </Button>
                <Button
                  className="template-space-create-button"
                  onClick={() => {
                    setSelectedCard(null)
                    setExpanded(false)
                    setActivePanel('add')
                  }}
                >
                  创建
                </Button>
              </div>
              <ScrollArea className="template-space-scroll" type="never" scrollbarSize={8}>
                <SimpleGrid className="template-space-grid" cols={{ base: 2, sm: 3, lg: 5, xl: 6 }} spacing="lg">
                  {filteredExpandedCards.map((card) => renderTemplateCard(card, false))}
                </SimpleGrid>
              </ScrollArea>
            </section>
          )}
        </div>
      </Modal>
      <Modal
        className="template-metadata-editor-modal"
        opened={Boolean(metadataEditorProject)}
        onClose={() => {
          if (metadataEditorSubmitting) return
          setMetadataEditorProject(null)
        }}
        title="编辑模板信息"
        centered
        size="lg"
      >
        <Stack className="template-metadata-editor-modal-stack" gap="md">
          <TextInput
            className="template-metadata-editor-title"
            label="模板标题"
            value={metadataEditorTitle}
            onChange={(event) => setMetadataEditorTitle(event.currentTarget.value)}
            placeholder="输入模板标题"
          />
          <Textarea
            className="template-metadata-editor-description"
            label="模板描述"
            value={metadataEditorDescription}
            onChange={(event) => setMetadataEditorDescription(event.currentTarget.value)}
            placeholder="输入模板描述"
            autosize
            minRows={4}
            maxRows={8}
          />
          <TextInput
            className="template-metadata-editor-cover-url"
            label="封面 URL"
            value={metadataEditorCoverUrl}
            onChange={(event) => setMetadataEditorCoverUrl(event.currentTarget.value)}
            placeholder="https://..."
          />
          {metadataEditorCoverUrl.trim() ? (
            <Image
              className="template-metadata-editor-cover-preview"
              src={metadataEditorCoverUrl.trim()}
              alt={metadataEditorTitle.trim() || '模板封面预览'}
              radius="md"
              h={220}
              fit="cover"
            />
          ) : null}
          <Group className="template-metadata-editor-actions" justify="flex-end">
            <Button
              className="template-metadata-editor-cancel"
              variant="default"
              onClick={() => setMetadataEditorProject(null)}
              disabled={metadataEditorSubmitting}
            >
              取消
            </Button>
            <Button
              className="template-metadata-editor-submit"
              onClick={() => { void handleMetadataSubmit() }}
              loading={metadataEditorSubmitting}
            >
              保存信息
            </Button>
          </Group>
        </Stack>
      </Modal>
      <Modal
        className="template-json-import-modal"
        opened={jsonImportOpened}
        onClose={() => setJsonImportOpened(false)}
        title="导入画布 JSON"
        centered
        size="lg"
      >
        <Stack className="template-json-import-modal-stack" gap="md">
          <Text className="template-json-import-modal-copy" size="sm" c="dimmed">
            支持裸 nodes/edges、nodes/connections、data 包裹对象，以及完整接口返回体。
          </Text>
          <Textarea
            className="template-json-import-modal-textarea"
            value={jsonImportValue}
            onChange={(event) => setJsonImportValue(event.currentTarget.value)}
            placeholder="把画布 JSON 粘贴到这里"
            autosize
            minRows={12}
            maxRows={20}
          />
          <Group className="template-json-import-modal-actions" justify="flex-end">
            <Button className="template-json-import-modal-cancel" variant="default" onClick={() => setJsonImportOpened(false)}>
              取消
            </Button>
            <Button className="template-json-import-modal-submit" onClick={handleImportJsonSubmit}>
              导入到画布
            </Button>
          </Group>
        </Stack>
      </Modal>
    </div>
  )
}
