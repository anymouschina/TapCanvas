import React from 'react'
import { ActionIcon, Tooltip } from '@mantine/core'
import {
  IconChevronLeft,
  IconChevronRight,
  IconLayoutGrid,
  IconPhoto,
  IconPlayerPlay,
  IconVideo,
  IconX,
} from '@tabler/icons-react'
import { WORKFLOW_ATOMIC_NODE_CATEGORIES, type WorkflowAtomicNodeCategory } from '@tapcanvas/workflow-kernel-protocol'
import { useIsAdmin } from '../../auth/isAdmin'
import BodyPortal from '../../ui/BodyPortal'
import { useRFStore } from '../store'
import { useWorkflowNodeInspectorStore, type WorkflowNodeInspectorTab } from '../workflowNodeInspectorStore'
import { useUIStore } from '../../ui/uiStore'
import { ConfigurationTab } from './WorkflowNodeConfigurationTab'
import { InputTab, OutputTab } from './WorkflowNodeDataTabs'
import { WorkflowNodeHistorySection } from './WorkflowNodeHistorySection'
import { RunTab } from './WorkflowNodeRunTab'
import { dataRecord, nodeLabel, nodeOperation, readString } from './workflowNodeInspectorShared'
import { workflowCategoryLabel, workflowOperationLabel } from '../workflowNodePresentation'
import { resolveWorkflowMediaPreview } from '../workflowMediaPreview'
import { WorkflowNodeIconConfiguration } from './WorkflowNodeIconConfiguration'
import { WorkflowNodeSaveAction } from './WorkflowNodeSaveAction'
import './WorkflowNodeInspectorPanel.css'

type WorkflowNodeInspectorPanelProps = Readonly<{
  readOnly: boolean
}>

const INSPECTOR_TABS: readonly Readonly<{ id: WorkflowNodeInspectorTab; label: string }>[] = [
  { id: 'configuration', label: '配置' },
  { id: 'input', label: '输入' },
  { id: 'output', label: '输出' },
  { id: 'history', label: '历史' },
  { id: 'run', label: '运行' },
]

const INSPECTOR_VIEWPORT_GAP_PX = 16
const INSPECTOR_HEADER_GAP_PX = 8

function useInspectorTop(): number {
  const [top, setTop] = React.useState(INSPECTOR_VIEWPORT_GAP_PX)

  React.useLayoutEffect(() => {
    const workspaceHeader = document.querySelector<HTMLElement>('.app-header-overlay')
    if (!workspaceHeader) return

    const headerElements = (): readonly HTMLElement[] => [
      workspaceHeader,
      ...workspaceHeader.querySelectorAll<HTMLElement>('*'),
    ]
    const updateTop = (): void => {
      const headerBottom = headerElements().reduce((currentBottom, element) => {
        const rect = element.getBoundingClientRect()
        if (rect.width <= 0 || rect.height <= 0) return currentBottom
        return Math.max(currentBottom, rect.bottom)
      }, workspaceHeader.getBoundingClientRect().bottom)
      const nextTop = Math.max(
        INSPECTOR_VIEWPORT_GAP_PX,
        Math.ceil(headerBottom + INSPECTOR_HEADER_GAP_PX),
      )
      setTop((currentTop) => currentTop === nextTop ? currentTop : nextTop)
    }

    const resizeObserver = new ResizeObserver(updateTop)
    const observeHeaderTree = (): void => {
      resizeObserver.disconnect()
      headerElements().forEach((element) => resizeObserver.observe(element))
      updateTop()
    }
    const mutationObserver = new MutationObserver(observeHeaderTree)
    mutationObserver.observe(workspaceHeader, { childList: true, subtree: true })
    observeHeaderTree()
    window.addEventListener('resize', updateTop)
    return () => {
      mutationObserver.disconnect()
      resizeObserver.disconnect()
      window.removeEventListener('resize', updateTop)
    }
  }, [])

  return top
}

export function WorkflowNodeInspectorPanel(props: WorkflowNodeInspectorPanelProps): React.JSX.Element | null {
  const isAdmin = useIsAdmin()
  const nodeId = useWorkflowNodeInspectorStore((state) => state.nodeId)
  const activeTab = useWorkflowNodeInspectorStore((state) => state.tab)
  const setTab = useWorkflowNodeInspectorStore((state) => state.setTab)
  const close = useWorkflowNodeInspectorStore((state) => state.close)
  const openNode = useWorkflowNodeInspectorStore((state) => state.openNode)
  const canvasNodes = useRFStore((state) => state.nodes)
  const node = useRFStore((state) => state.nodes.find((candidate) => candidate.id === nodeId))
  const flowId = useUIStore((state) => String(state.currentFlow.id || '').trim())
  const data = dataRecord(node?.data)
  const mediaPreview = resolveWorkflowMediaPreview(data)
  const inspectorTop = useInspectorTop()
  const panelRef = React.useRef<HTMLElement | null>(null)
  const tabRefs = React.useRef<Array<HTMLButtonElement | null>>([])
  const accessibilityId = React.useId()
  const isWorkflowNode = data.adminWorkflow === true
    && (data.kind === 'workflowStage' || data.kind === 'workflowTrigger')

  React.useEffect(() => {
    if (nodeId && !node) close()
  }, [close, node, nodeId])

  React.useEffect(() => {
    if (!nodeId || !node || !isWorkflowNode) return
    panelRef.current?.focus({ preventScroll: true })
  }, [isWorkflowNode, node, nodeId])

  if (!isAdmin || !nodeId || !node || !isWorkflowNode) return null
  const operation = nodeOperation(data)
  const showsMediaResult = mediaPreview.kind !== null && mediaPreview.displayMode === 'result'
  const hasMediaResult = mediaPreview.primaryAsset !== null
  const mediaDisplayTooltip = showsMediaResult
    ? '切换为图标外显'
    : hasMediaResult
      ? '切换为结果外显'
      : mediaPreview.kind === 'image'
        ? '尚无真实图片输出，生成完成后可切换'
        : '尚无真实视频输出，生成完成后可切换'
  const atomicCategoryValue = dataRecord(data.workflowAtomicSpec).category
  const category = WORKFLOW_ATOMIC_NODE_CATEGORIES.find((candidate) => candidate === atomicCategoryValue) as WorkflowAtomicNodeCategory | undefined
  const workflowInstanceId = readString(data, 'workflowInstanceId')
  const workflowNavigationNodes = canvasNodes
    .filter((candidate) => {
      const candidateData = dataRecord(candidate.data)
      return candidateData.adminWorkflow === true
        && readString(candidateData, 'workflowInstanceId') === workflowInstanceId
        && (candidateData.kind === 'workflowStage' || candidateData.kind === 'workflowTrigger')
    })
    .sort((left, right) => (
      left.position.x - right.position.x
      || left.position.y - right.position.y
      || left.id.localeCompare(right.id)
    ))
  const navigationIndex = workflowNavigationNodes.findIndex((candidate) => candidate.id === node.id)
  const previousNode = navigationIndex > 0 ? workflowNavigationNodes[navigationIndex - 1] ?? null : null
  const nextNode = navigationIndex >= 0 ? workflowNavigationNodes[navigationIndex + 1] ?? null : null
  const activeTabIndex = INSPECTOR_TABS.findIndex((tab) => tab.id === activeTab)
  const titleId = `${accessibilityId}-title`
  const panelId = `${accessibilityId}-tabpanel`
  const activateTabFromKeyboard = (event: React.KeyboardEvent<HTMLButtonElement>, tabIndex: number): void => {
    let nextIndex: number | null = null
    if (event.key === 'ArrowRight') nextIndex = (tabIndex + 1) % INSPECTOR_TABS.length
    if (event.key === 'ArrowLeft') nextIndex = (tabIndex - 1 + INSPECTOR_TABS.length) % INSPECTOR_TABS.length
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = INSPECTOR_TABS.length - 1
    if (nextIndex === null) return
    event.preventDefault()
    const nextTab = INSPECTOR_TABS[nextIndex]
    if (!nextTab) return
    setTab(nextTab.id)
    tabRefs.current[nextIndex]?.focus()
  }
  const navigateToWorkflowNode = (targetNodeId: string): void => {
    const store = useRFStore.getState()
    store.onNodesChange(store.nodes
      .filter((candidate) => candidate.selected || candidate.id === targetNodeId)
      .map((candidate) => ({
        id: candidate.id,
        type: 'select' as const,
        selected: candidate.id === targetNodeId,
      })))
    openNode(targetNodeId)
  }
  return (
    <BodyPortal>
      <aside
      ref={panelRef}
      className="workflow-node-inspector nodrag nopan"
      aria-labelledby={titleId}
      data-ux-panel
      style={{ top: inspectorTop }}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          close()
          return
        }
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
          event.preventDefault()
          setTab('run')
        }
      }}
    >
      <header className="workflow-node-inspector__header">
        <div className="workflow-node-inspector__identity">
          <span className="workflow-node-inspector__eyebrow">
            {data.kind === 'workflowTrigger'
              ? '触发器'
              : `${workflowCategoryLabel(category ?? null)} · ${workflowOperationLabel(operation)}`}
          </span>
          <h2 className="workflow-node-inspector__title" id={titleId}>{nodeLabel(data, node.id)}</h2>
          <span className="workflow-node-inspector__node-meta">
            <span className="workflow-node-inspector__node-id">{readString(data, 'workflowNodeId') || node.id}</span>
            <span className="workflow-node-inspector__node-position">{navigationIndex + 1}/{workflowNavigationNodes.length}</span>
          </span>
        </div>
        <div className="workflow-node-inspector__header-actions">
          <Tooltip className="workflow-node-inspector__navigation-tooltip" label="上一个画布节点" withArrow>
            <ActionIcon
              className="workflow-node-inspector__navigation"
              variant="subtle"
              aria-label="上一个工作流节点"
              disabled={!previousNode}
              onClick={() => { if (previousNode) navigateToWorkflowNode(previousNode.id) }}
            >
              <IconChevronLeft className="workflow-node-inspector__navigation-icon" size={16} aria-hidden="true" />
            </ActionIcon>
          </Tooltip>
          <Tooltip className="workflow-node-inspector__navigation-tooltip" label="下一个画布节点" withArrow>
            <ActionIcon
              className="workflow-node-inspector__navigation"
              variant="subtle"
              aria-label="下一个工作流节点"
              disabled={!nextNode}
              onClick={() => { if (nextNode) navigateToWorkflowNode(nextNode.id) }}
            >
              <IconChevronRight className="workflow-node-inspector__navigation-icon" size={16} aria-hidden="true" />
            </ActionIcon>
          </Tooltip>
          {mediaPreview.kind ? (
            <Tooltip className="workflow-node-inspector__navigation-tooltip" label={mediaDisplayTooltip} withArrow>
              <ActionIcon
                className="workflow-node-inspector__navigation workflow-node-inspector__media-display"
                variant="subtle"
                aria-label={mediaDisplayTooltip}
                disabled={props.readOnly || (!showsMediaResult && !hasMediaResult)}
                onClick={() => {
                  useRFStore.getState().updateNodeData(node.id, {
                    workflowCanvasDisplayMode: showsMediaResult ? 'icon' : 'result',
                  })
                }}
              >
                {showsMediaResult ? (
                  <IconLayoutGrid className="workflow-node-inspector__navigation-icon" size={16} aria-hidden="true" />
                ) : mediaPreview.kind === 'image' ? (
                  <IconPhoto className="workflow-node-inspector__navigation-icon" size={16} aria-hidden="true" />
                ) : (
                  <IconVideo className="workflow-node-inspector__navigation-icon" size={16} aria-hidden="true" />
                )}
              </ActionIcon>
            </Tooltip>
          ) : null}
          <Tooltip className="workflow-node-inspector__navigation-tooltip" label="打开测试与运行（⌘/Ctrl + Enter）" withArrow>
            <ActionIcon
              className="workflow-node-inspector__navigation"
              variant="subtle"
              aria-label="打开节点运行面板"
              onClick={() => setTab('run')}
            >
              <IconPlayerPlay className="workflow-node-inspector__navigation-icon" size={16} aria-hidden="true" />
            </ActionIcon>
          </Tooltip>
          <Tooltip className="workflow-node-inspector__close-tooltip" label="关闭节点配置" withArrow>
            <ActionIcon className="workflow-node-inspector__close" variant="subtle" aria-label="关闭节点配置" onClick={close}>
              <IconX className="workflow-node-inspector__close-icon" size={16} aria-hidden="true" />
            </ActionIcon>
          </Tooltip>
        </div>
      </header>
      <nav className="workflow-node-inspector__tabs" aria-label="节点详情标签" role="tablist">
        {INSPECTOR_TABS.map((tab, tabIndex) => (
          <button
            ref={(element) => { tabRefs.current[tabIndex] = element }}
            className={'workflow-node-inspector__tab' + (activeTab === tab.id ? ' workflow-node-inspector__tab--active' : '')}
            type="button"
            key={tab.id}
            id={`${accessibilityId}-tab-${tab.id}`}
            role="tab"
            aria-selected={activeTab === tab.id}
            aria-controls={panelId}
            tabIndex={activeTab === tab.id ? 0 : -1}
            onClick={() => setTab(tab.id)}
            onKeyDown={(event) => activateTabFromKeyboard(event, tabIndex)}
          >
            {tab.label}
          </button>
        ))}
      </nav>
      <div
        className="workflow-node-inspector__body"
        id={panelId}
        role="tabpanel"
        aria-labelledby={`${accessibilityId}-tab-${INSPECTOR_TABS[activeTabIndex]?.id ?? 'configuration'}`}
        tabIndex={0}
      >
        {activeTab === 'configuration' ? (
          <div className="workflow-node-inspector__configuration-content">
            <WorkflowNodeIconConfiguration nodeId={node.id} data={data} readOnly={props.readOnly} />
            <ConfigurationTab nodeId={node.id} data={data} readOnly={props.readOnly} />
            <WorkflowNodeSaveAction readOnly={props.readOnly} />
          </div>
        ) : null}
        {activeTab === 'input' ? <InputTab nodeId={node.id} data={data} readOnly={props.readOnly} /> : null}
        {activeTab === 'output' ? <OutputTab nodeId={node.id} data={data} /> : null}
        {activeTab === 'history' ? (
          <div className="workflow-node-inspector__tab-content">
            <WorkflowNodeHistorySection flowId={flowId} nodeId={node.id} data={data} readOnly={props.readOnly} />
          </div>
        ) : null}
        {activeTab === 'run' ? <RunTab nodeId={node.id} data={data} readOnly={props.readOnly} /> : null}
      </div>
      </aside>
    </BodyPortal>
  )
}
