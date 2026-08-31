import React from 'react'
import { Title, Stack, Transition, Badge, TextInput, UnstyledButton } from '@mantine/core'
import {
  IconAlarm,
  IconApiApp,
  IconBinaryTree,
  IconBoxMultiple,
  IconBrain,
  IconBook2,
  IconBraces,
  IconCode,
  IconChecklist,
  IconCirclesRelation,
  IconEye,
  IconLayoutGrid,
  IconMovie,
  IconMusic,
  IconPhoto,
  IconScissors,
  IconTable,
  IconTypography,
  IconVideo,
  IconSearch,
  IconSparkles,
  IconTool,
  IconUserCheck,
  IconBrandOpenai,
} from '@tabler/icons-react'
import { useUIStore } from './uiStore'
import { useRFStore } from '../canvas/store'
import { $ } from '../canvas/i18n'
import {
  BOTTOM_BAR_PANEL_WIDTH,
  bottomBarPanelMetrics,
  bottomBarPanelStyle,
} from './utils/panelPosition'
import { PanelCard } from './PanelCard'
import { stopPanelWheelPropagation } from './utils/panelWheel'
import { useIsAdmin } from '../auth/isAdmin'
import {
  addAtomicWorkflowNode,
  addManualWorkflowTrigger,
  addScheduleWorkflowTrigger,
  addWebhookWorkflowTrigger,
  addEventWorkflowTrigger,
  createAgentWorkflowCanvasTemplate,
  type AtomicWorkflowPresetId,
} from '../canvas/agentWorkflowCanvasTemplate'
import {
  createDocumentToDynamicVideosWorkflowCanvasTemplate,
} from '../canvas/documentPromptWorkflowCanvasTemplate'
import {
  createVideoWorkflowCanvasTemplate,
  type VideoWorkflowExecutionVariant,
} from '../canvas/videoWorkflowCanvasTemplate'
import type { VideoWorkflowExecutionScope } from '../canvas/videoWorkflowExecution'
import { toast } from './toast'
import './AddNodePanel.css'

type AddNodeOption = Readonly<{
  id: string
  kind: string | null
  label: string
  Icon: typeof IconTypography
  badge: 'Beta' | 'Admin' | null
  group?: '模板' | '触发与输入' | '智能体' | '媒体' | '数据处理' | '能力' | '控制与交付'
  action: 'node' | 'videoWorkflow' | 'agentWorkflow' | 'documentVideosWorkflow' | 'manualTrigger' | 'scheduleTrigger' | 'webhookTrigger' | 'eventTrigger' | 'atomicWorkflowNode'
  atomicPreset?: AtomicWorkflowPresetId
  videoWorkflowScope?: VideoWorkflowExecutionScope
  videoWorkflowVariant?: VideoWorkflowExecutionVariant
}>

type AddNodeCategory = Readonly<{
  id: 'creation' | 'orchestration'
  label: string
  description: string
  Icon: typeof IconTypography
  adminOnly: boolean
  options: readonly AddNodeOption[]
}>

const ADD_NODE_CATEGORIES: readonly AddNodeCategory[] = [
  {
    id: 'creation',
    label: '创作',
    description: '文本、图像、音视频与镜头设计',
    Icon: IconBoxMultiple,
    adminOnly: false,
    options: [
      { id: 'text', kind: 'text', label: '文本', Icon: IconTypography, badge: null, action: 'node' },
      { id: 'image', kind: 'image', label: '图像', Icon: IconPhoto, badge: null, action: 'node' },
      { id: 'storyboard', kind: 'storyboard', label: '分镜编辑', Icon: IconLayoutGrid, badge: null, action: 'node' },
      { id: 'shotTable', kind: 'shotTable', label: '分镜表', Icon: IconTable, badge: null, action: 'node' },
      { id: 'directorConsole', kind: 'directorConsole', label: '导演台', Icon: IconMovie, badge: 'Beta', action: 'node' },
      { id: 'video', kind: 'video', label: '视频', Icon: IconVideo, badge: null, action: 'node' },
      { id: 'audio', kind: 'audio', label: '音频', Icon: IconMusic, badge: 'Beta', action: 'node' },
      { id: 'videoAnalysis', kind: 'videoAnalysis', label: '视频分析', Icon: IconEye, badge: null, action: 'node' },
      { id: 'videoCompose', kind: 'videoCompose', label: '视频合成', Icon: IconScissors, badge: 'Beta', action: 'node' },
    ],
  },
  {
    id: 'orchestration',
    label: 'AI 编排',
    description: '触发器、Agent 与工作流',
    Icon: IconBinaryTree,
    adminOnly: false,
    options: [
      { id: 'codex', kind: 'codex', label: 'Codex', Icon: IconBrandOpenai, badge: 'Beta', group: '智能体', action: 'node' },
      { id: 'agentWorkflow', kind: null, label: '空白智能体工作流', Icon: IconSparkles, badge: 'Admin', group: '模板', action: 'agentWorkflow' },
      { id: 'documentVideosWorkflow', kind: null, label: '文档 → 动态 15 秒视频', Icon: IconMovie, badge: 'Admin', group: '模板', action: 'documentVideosWorkflow' },
      { id: 'oneClickFilmWorkflow', kind: null, label: '一键成片 · 完整成片', Icon: IconBinaryTree, badge: 'Admin', group: '模板', action: 'videoWorkflow', videoWorkflowScope: 'media_delivery', videoWorkflowVariant: 'full_video' },
      { id: 'manualTrigger', kind: null, label: '手动触发器', Icon: IconAlarm, badge: 'Admin', group: '触发与输入', action: 'manualTrigger' },
      { id: 'scheduleTrigger', kind: null, label: '定时触发器', Icon: IconAlarm, badge: 'Admin', group: '触发与输入', action: 'scheduleTrigger' },
      { id: 'webhookTrigger', kind: null, label: 'Webhook 触发器', Icon: IconApiApp, badge: 'Admin', group: '触发与输入', action: 'webhookTrigger' },
      { id: 'eventTrigger', kind: null, label: '事件触发器', Icon: IconCirclesRelation, badge: 'Admin', group: '触发与输入', action: 'eventTrigger' },
      { id: 'workflowSource', kind: null, label: '输入来源', Icon: IconApiApp, badge: 'Admin', group: '触发与输入', action: 'atomicWorkflowNode', atomicPreset: 'source' },
      { id: 'workflowTextInput', kind: null, label: '文本输入', Icon: IconTypography, badge: 'Admin', group: '触发与输入', action: 'atomicWorkflowNode', atomicPreset: 'textInput' },
      { id: 'workflowAgent', kind: null, label: 'Agent 任务', Icon: IconBrain, badge: 'Admin', group: '智能体', action: 'atomicWorkflowNode', atomicPreset: 'agent' },
      { id: 'workflowImageGeneration', kind: null, label: '图片生成', Icon: IconPhoto, badge: 'Admin', group: '媒体', action: 'atomicWorkflowNode', atomicPreset: 'imageGeneration' },
      { id: 'workflowVideoGeneration', kind: null, label: '视频生成', Icon: IconVideo, badge: 'Admin', group: '媒体', action: 'atomicWorkflowNode', atomicPreset: 'videoGeneration' },
      { id: 'workflowJavascript', kind: null, label: 'JavaScript 脚本', Icon: IconCode, badge: 'Admin', group: '数据处理', action: 'atomicWorkflowNode', atomicPreset: 'javascript' },
      { id: 'workflowCollectionSplit', kind: null, label: '拆分为数据项', Icon: IconBoxMultiple, badge: 'Admin', group: '数据处理', action: 'atomicWorkflowNode', atomicPreset: 'collectionSplit' },
      { id: 'workflowSkill', kind: null, label: 'Skill', Icon: IconSparkles, badge: 'Admin', group: '能力', action: 'atomicWorkflowNode', atomicPreset: 'skill' },
      { id: 'workflowKnowledgeSearch', kind: null, label: '知识检索', Icon: IconSearch, badge: 'Admin', group: '能力', action: 'atomicWorkflowNode', atomicPreset: 'knowledgeSearch' },
      { id: 'workflowKnowledgeRead', kind: null, label: '知识读取', Icon: IconBook2, badge: 'Admin', group: '能力', action: 'atomicWorkflowNode', atomicPreset: 'knowledgeRead' },
      { id: 'workflowToolInvocation', kind: null, label: '工具调用', Icon: IconTool, badge: 'Admin', group: '能力', action: 'atomicWorkflowNode', atomicPreset: 'toolInvocation' },
      { id: 'workflowTool', kind: null, label: '工具授权', Icon: IconTool, badge: 'Admin', group: '能力', action: 'atomicWorkflowNode', atomicPreset: 'tool' },
      { id: 'workflowControl', kind: null, label: '控制节点', Icon: IconCirclesRelation, badge: 'Admin', group: '控制与交付', action: 'atomicWorkflowNode', atomicPreset: 'control' },
      { id: 'workflowCondition', kind: null, label: '条件分支', Icon: IconBinaryTree, badge: 'Admin', group: '控制与交付', action: 'atomicWorkflowNode', atomicPreset: 'condition' },
      { id: 'workflowTerminal', kind: null, label: '明确终态', Icon: IconChecklist, badge: 'Admin', group: '控制与交付', action: 'atomicWorkflowNode', atomicPreset: 'terminal' },
      { id: 'workflowSubworkflow', kind: null, label: '子工作流', Icon: IconCirclesRelation, badge: 'Admin', group: '控制与交付', action: 'atomicWorkflowNode', atomicPreset: 'subworkflow' },
      { id: 'workflowHumanApproval', kind: null, label: '人工审批', Icon: IconUserCheck, badge: 'Admin', group: '控制与交付', action: 'atomicWorkflowNode', atomicPreset: 'humanApproval' },
      { id: 'workflowArtifact', kind: null, label: '产物合同', Icon: IconBraces, badge: 'Admin', group: '控制与交付', action: 'atomicWorkflowNode', atomicPreset: 'artifact' },
      { id: 'workflowDelivery', kind: null, label: '交付验收', Icon: IconChecklist, badge: 'Admin', group: '控制与交付', action: 'atomicWorkflowNode', atomicPreset: 'delivery' },
    ],
  },
]

export default function AddNodePanel({ className }: { className?: string }): JSX.Element | null {
  const active = useUIStore(s => s.activePanel)
  const setActivePanel = useUIStore(s => s.setActivePanel)
  const anchorX = useUIStore(s => s.panelAnchorX)
  const addNode = useRFStore(s => s.addNode)
  const addDirectorConsoleNode = useRFStore(s => s.addDirectorConsoleNode)
  const isAdmin = useIsAdmin()
  const [activeCategoryId, setActiveCategoryId] = React.useState<AddNodeCategory['id']>('creation')
  const [query, setQuery] = React.useState('')
  const categories = React.useMemo(
    () => ADD_NODE_CATEGORIES
      .filter((category) => !category.adminOnly || isAdmin)
      .map((category) => ({
        ...category,
        options: category.options.filter((option) => isAdmin || option.badge !== 'Admin'),
      }))
      .filter((category) => category.options.length > 0),
    [isAdmin],
  )
  const activeCategory = categories.find((category) => category.id === activeCategoryId) ?? categories[0]
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const visibleOptions = normalizedQuery
    ? categories.flatMap((category) => category.options
      .filter((option) => $(option.label).toLocaleLowerCase().includes(normalizedQuery))
      .map((option) => ({ category, option })))
    : (activeCategory?.options ?? []).map((option) => ({ category: activeCategory, option }))

  const mounted = active === 'add'
  const panelMetrics = bottomBarPanelMetrics(BOTTOM_BAR_PANEL_WIDTH.regular)
  const panelClassName = ['add-node-panel', className].filter(Boolean).join(' ')
  const addTaskNode = React.useCallback((kind: string) => {
    if (kind === 'directorConsole') {
      addDirectorConsoleNode()
    } else {
      addNode('taskNode', undefined, { kind })
    }
    setActivePanel(null)
  }, [addNode, addDirectorConsoleNode, setActivePanel])

  React.useEffect(() => {
    if (!categories.some((category) => category.id === activeCategoryId)) {
      setActiveCategoryId(categories[0]?.id ?? 'creation')
    }
  }, [activeCategoryId, categories])

  const addOneClickFilmWorkflow = React.useCallback((
    executionScope: VideoWorkflowExecutionScope,
    executionVariant: VideoWorkflowExecutionVariant,
  ) => {
    try {
      createVideoWorkflowCanvasTemplate({ executionScope, executionVariant })
      setActivePanel(null)
      toast(
        executionVariant === 'first_video'
          ? '已创建首个视频验证工作流；只生成并交付首个真实视频，不继续生成其余视频或合成主片'
          : '已创建最终版完整成片工作流；绑定来源组并显式选择 Agent、图片和视频模型后可真实生成整章成片',
        'success',
      )
    } catch (error: unknown) {
      const message = error instanceof Error && error.message ? error.message : '创建一键成片工作流失败'
      toast(message, 'error')
    }
  }, [setActivePanel])

  const addAgentWorkflow = React.useCallback(() => {
    try {
      createAgentWorkflowCanvasTemplate()
      setActivePanel(null)
      toast('已创建空白智能体工作流；填写 Agent 目标与交付要求后即可运行', 'success')
    } catch (error: unknown) {
      toast(error instanceof Error ? error.message : '创建智能体工作流失败', 'error')
    }
  }, [setActivePanel])

  const addDocumentVideosWorkflow = React.useCallback(() => {
    try {
      createDocumentToDynamicVideosWorkflowCanvasTemplate()
      setActivePanel(null)
      toast('已创建动态视频工作流；执行到提示词节点可预览文本，完整运行会逐项生成视频', 'success')
    } catch (error: unknown) {
      toast(error instanceof Error ? error.message : '创建动态视频工作流失败', 'error')
    }
  }, [setActivePanel])

  const addWorkflowTrigger = React.useCallback(() => {
    try {
      addManualWorkflowTrigger()
      setActivePanel(null)
      toast('已添加手动触发器；选中现有工作流后添加会自动归入该工作流', 'success')
    } catch (error: unknown) {
      toast(error instanceof Error ? error.message : '创建触发器失败', 'error')
    }
  }, [setActivePanel])

  const addWorkflowScheduleTrigger = React.useCallback(() => {
    try {
      addScheduleWorkflowTrigger()
      setActivePanel(null)
      toast('已添加定时触发器；配置并验证后显式启用，保存画布后开始调度', 'success')
    } catch (error: unknown) {
      toast(error instanceof Error ? error.message : '创建定时触发器失败', 'error')
    }
  }, [setActivePanel])

  const addWorkflowWebhookTrigger = React.useCallback(() => {
    try {
      addWebhookWorkflowTrigger()
      setActivePanel(null)
      toast('已添加 Webhook 触发器；请配置 secretRef 对应的服务端环境变量并保存画布', 'success')
    } catch (error: unknown) {
      toast(error instanceof Error ? error.message : '创建 Webhook 触发器失败', 'error')
    }
  }, [setActivePanel])

  const addWorkflowEventTrigger = React.useCallback(() => {
    try {
      addEventWorkflowTrigger()
      setActivePanel(null)
      toast('已添加事件触发器；配置 topic 与结构过滤器后保存画布', 'success')
    } catch (error: unknown) {
      toast(error instanceof Error ? error.message : '创建事件触发器失败', 'error')
    }
  }, [setActivePanel])

  const addWorkflowAtomicNode = React.useCallback((presetId: AtomicWorkflowPresetId) => {
    try {
      addAtomicWorkflowNode(presetId)
      setActivePanel(null)
      toast('已添加原子工作流节点', 'success')
    } catch (error: unknown) {
      toast(error instanceof Error ? error.message : '创建原子工作流节点失败', 'error')
    }
  }, [setActivePanel])

  const activateOption = React.useCallback((option: AddNodeOption) => {
    if (option.action === 'videoWorkflow') {
      if (!option.videoWorkflowScope || !option.videoWorkflowVariant) {
        toast('一键成片模板缺少不可变视频模式，无法创建', 'error')
        return
      }
      addOneClickFilmWorkflow(option.videoWorkflowScope, option.videoWorkflowVariant)
      return
    }
    if (option.action === 'agentWorkflow') {
      addAgentWorkflow()
      return
    }
    if (option.action === 'documentVideosWorkflow') {
      addDocumentVideosWorkflow()
      return
    }
    if (option.action === 'manualTrigger') {
      addWorkflowTrigger()
      return
    }
    if (option.action === 'scheduleTrigger') {
      addWorkflowScheduleTrigger()
      return
    }
    if (option.action === 'webhookTrigger') {
      addWorkflowWebhookTrigger()
      return
    }
    if (option.action === 'eventTrigger') {
      addWorkflowEventTrigger()
      return
    }
    if (option.action === 'atomicWorkflowNode') {
      if (!option.atomicPreset) {
        toast('原子节点缺少 preset 身份，无法创建', 'error')
        return
      }
      addWorkflowAtomicNode(option.atomicPreset)
      return
    }
    if (!option.kind) {
      toast('节点定义缺少 kind，无法创建', 'error')
      return
    }
    addTaskNode(option.kind)
  }, [addAgentWorkflow, addDocumentVideosWorkflow, addOneClickFilmWorkflow, addTaskNode, addWorkflowAtomicNode, addWorkflowEventTrigger, addWorkflowScheduleTrigger, addWorkflowTrigger, addWorkflowWebhookTrigger])

  return (
    <div
      className={panelClassName}
      style={bottomBarPanelStyle(anchorX, { zIndex: 200, halfWidth: panelMetrics.width / 2 })}
      data-ux-panel
    >
      <Transition className="add-node-panel-transition" mounted={mounted} transition="pop" duration={140} timingFunction="ease">
        {(styles) => (
          <div className="add-node-panel-transition-inner" style={styles}>
            <PanelCard
              className="add-node-panel-shell glass"
              style={{
                width: panelMetrics.width,
                height: panelMetrics.height,
                maxHeight: panelMetrics.height,
                minHeight: 0,
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
                transformOrigin: 'left center',
              }}
              onWheelCapture={stopPanelWheelPropagation}
              data-ux-panel
            >
              <div className="add-node-panel-arrow panel-arrow" />
              <div className="add-node-panel-body">
                <div className="add-node-panel-heading">
                  <Title className="add-node-panel-title" order={6}>{$('添加节点')}</Title>
                  <TextInput
                    className="add-node-panel-search"
                    value={query}
                    onChange={(event) => setQuery(event.currentTarget.value)}
                    placeholder="搜索全部节点"
                    aria-label="搜索全部节点"
                    leftSection={<IconSearch className="add-node-panel-search-icon" size={14} aria-hidden="true" />}
                    size="xs"
                  />
                </div>
                <div className="add-node-panel-browser">
                  <nav className="add-node-panel-categories" aria-label="节点分类">
                    {categories.map((category) => (
                      <UnstyledButton
                        key={category.id}
                        className={`add-node-panel-category${!normalizedQuery && category.id === activeCategory?.id ? ' add-node-panel-category--active' : ''}`}
                        onClick={() => {
                          setActiveCategoryId(category.id)
                          setQuery('')
                        }}
                        aria-current={!normalizedQuery && category.id === activeCategory?.id ? 'page' : undefined}
                      >
                        <category.Icon className="add-node-panel-category-icon" size={15} aria-hidden="true" />
                        <span className="add-node-panel-category-copy">
                          <span className="add-node-panel-category-label">{category.label}</span>
                          <span className="add-node-panel-category-count">{category.options.length}</span>
                        </span>
                      </UnstyledButton>
                    ))}
                  </nav>
                  <section className="add-node-panel-options" aria-label={normalizedQuery ? '搜索结果' : activeCategory?.label}>
                    <div className="add-node-panel-options-heading">
                      <span className="add-node-panel-options-title">{normalizedQuery ? '搜索结果' : activeCategory?.label}</span>
                      <span className="add-node-panel-options-description">
                        {normalizedQuery ? `${visibleOptions.length} 个节点` : activeCategory?.description}
                      </span>
                    </div>
                    <Stack className="add-node-panel-actions" gap={4} data-panel-scroll>
                      {visibleOptions.map(({ category, option }, index) => {
                        const previous = visibleOptions[index - 1]?.option
                        const showGroup = !normalizedQuery && Boolean(option.group) && option.group !== previous?.group
                        return (
                          <React.Fragment key={`${category.id}:${option.id}`}>
                            {showGroup ? <span className="add-node-panel-option-group">{option.group}</span> : null}
                            <UnstyledButton
                              className={`add-node-panel-button${option.action === 'videoWorkflow' ? ' add-node-panel-button--workflow' : ''}`}
                              onClick={() => activateOption(option)}
                            >
                              <span className="add-node-panel-option-side add-node-panel-option-side--icon">
                                <option.Icon className="add-node-panel-icon" size={16} aria-hidden="true" />
                              </span>
                              <span className="add-node-panel-option-copy">
                                <span className="add-node-panel-option-label">{$(option.label)}</span>
                                {normalizedQuery ? <span className="add-node-panel-option-category">{category.label}{option.group ? ' · ' + option.group : ''}</span> : null}
                              </span>
                              <span className="add-node-panel-option-side add-node-panel-option-side--badge">
                                {option.badge ? (
                                  <Badge
                                    className="add-node-panel-option-badge"
                                    size="xs"
                                    variant="light"
                                    color={option.badge === 'Admin' ? 'gray' : 'orange'}
                                  >
                                    {option.badge}
                                  </Badge>
                                ) : null}
                              </span>
                            </UnstyledButton>
                          </React.Fragment>
                        )
                      })}
                      {visibleOptions.length === 0 ? (
                        <span className="add-node-panel-empty">没有匹配的节点</span>
                      ) : null}
                    </Stack>
                  </section>
                </div>
              </div>
            </PanelCard>
          </div>
        )}
      </Transition>
    </div>
  )
}
