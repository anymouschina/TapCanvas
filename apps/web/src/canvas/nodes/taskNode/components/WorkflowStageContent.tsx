import React from 'react'
import './WorkflowStageContent.css'
import { ActionIcon, Menu, Tooltip } from '@mantine/core'
import {
  IconBinaryTree,
  IconDots,
  IconHistory,
  IconPlayerPlay,
  IconRefresh,
  IconSettings,
} from '@tabler/icons-react'
import {
  VIDEO_PRODUCTION_WORKFLOW_KEY,
  VIDEO_PRODUCTION_WORKFLOW_NODE_STATUSES,
  type VideoProductionWorkflowNodeStatus,
} from '@tapcanvas/video-orchestrator-protocol'
import { fetchAdminAgentDiagnostics } from '../../../../api/server'
import { useIsAdmin } from '../../../../auth/isAdmin'
import { useUIStore } from '../../../../ui/uiStore'
import { useRFStore } from '../../../store'
import {
  applyVideoWorkflowSnapshot,
  findLatestVideoWorkflowSnapshot,
} from '../../../videoWorkflowProjectionSync'
import { readWorkflowItemRuns } from '../../../workflowItemRuns'
import { workflowAgentProgress } from '../../../workflowAgentProgress'
import { useWorkflowNodeInspectorStore, type WorkflowNodeInspectorTab } from '../../../workflowNodeInspectorStore'
import { resolveWorkflowNodePresentation } from '../../../workflowNodePresentation'
import { WorkflowRuntimeProjection } from './WorkflowRuntimeProjection'
import { WorkflowNodeGlyph } from './WorkflowNodeGlyph'
import { useWorkflowNodeElapsedTime } from './useWorkflowNodeElapsedTime'
import { WorkflowNodeStatusBar, type WorkflowNodeStatus } from './WorkflowNodeStatusBar'
import { WorkflowNodePorts } from './WorkflowNodePorts'

type WorkflowStageContentProps = {
  nodeId: string
  data: Record<string, unknown>
  readOnly: boolean
}

type ProjectionSyncState = 'idle' | 'polling' | 'connected' | 'failed'

const WORKFLOW_POLL_INTERVAL_MS = 5_000

function readString(data: Record<string, unknown>, key: string): string {
  const value = data[key]
  return typeof value === 'string' ? value.trim() : ''
}

function readStrings(data: Record<string, unknown>, key: string): string[] {
  const value = data[key]
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
}

function readCount(data: Record<string, unknown>, key: string): number {
  const value = data[key]
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

function readNullableCount(data: Record<string, unknown>, key: string): number | null {
  const value = data[key]
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function atomicSpec(data: Record<string, unknown>): Record<string, unknown> {
  const value = data.workflowAtomicSpec
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function statusLabel(status: string, operation: string, waitingReasonLabel: string): string {
  if (status === 'queued') return '等待执行'
  if (status === 'running') return '执行中'
  if (status === 'waiting_external') return waitingReasonLabel || (operation === 'video_generate' ? '等待成片' : '等待外部结果')
  if (status === 'succeeded') return '已完成'
  if (status === 'partial') return '部分完成'
  if (status === 'failed') return '失败'
  if (status === 'skipped') return '因上游失败已跳过'
  if (status === 'not_selected') return '分支未选择'
  if (status === 'cancelled') return '已取消'
  return '尚未运行'
}

function isTerminalStatus(status: string): status is VideoProductionWorkflowNodeStatus {
  return status === 'succeeded' || status === 'failed' || status === 'cancelled'
}

function configurationLabel(input: Readonly<{
  operation: string
  workflowKey: string
  requestedAt: string
  executionId: string
  data: Record<string, unknown>
  workflowStatus: string
  errorCount: number
  waitingReasonLabel: string
}>): string {
  if (input.requestedAt || input.executionId) {
    if (input.workflowKey !== VIDEO_PRODUCTION_WORKFLOW_KEY) {
      if (input.workflowStatus === 'running' && input.errorCount > 0) {
        return `执行中 · 已失败 ${input.errorCount} 项`
      }
      return statusLabel(input.workflowStatus, input.operation, input.waitingReasonLabel)
    }
    return statusLabel(input.workflowStatus, input.operation, input.waitingReasonLabel)
  }
  if (input.operation === 'text_input' && !readString(input.data, 'workflowTextInput')) return '待配置'
  if (input.operation === 'javascript' && !readString(input.data, 'workflowJavascriptCode')) return '待配置'
  if (input.operation === 'agent_task' && !readString(input.data, 'workflowInstruction') && input.workflowKey !== VIDEO_PRODUCTION_WORKFLOW_KEY) return '待配置'
  if (input.operation === 'knowledge_search' && !readString(input.data, 'workflowKnowledgeQuery')) return '可接查询输入'
  if (input.operation === 'knowledge_read' && !readString(input.data, 'workflowKnowledgeCardId')) return '待接卡片身份'
  if (input.operation === 'tool_invocation' && !readString(input.data, 'workflowToolInvocationName')) return '待选工具'
  if (input.operation === 'human_approval' && !readString(input.data, 'workflowHumanPrompt')) return '待填审批问题'
  if (input.operation === 'condition' && !readString(input.data, 'workflowConditionOperator')) return '待配置条件'
  if (input.operation === 'terminal' && !readString(input.data, 'workflowTerminalMessage')) return '待填终态说明'
  if (input.operation === 'subworkflow' && !readString(input.data, 'workflowSubflowVersionId')) return '待绑定版本'
  if (input.operation === 'video_generate') {
    if (!readString(input.data, 'workflowVideoModelKey')) return '待选模型'
    if (readCount(input.data, 'workflowVideoDurationSeconds') === 0 || !readString(input.data, 'workflowVideoResolution') || !readString(input.data, 'workflowVideoAspectRatio')) return '待配参数'
  }
  if (input.operation === 'image_generate') {
    if (!readString(input.data, 'workflowImageModelKey')) return '待选模型'
    if (!readString(input.data, 'workflowImageSize') || !readString(input.data, 'workflowImageAspectRatio')) return '待配参数'
  }
  if (input.operation === 'delivery_verify' && !readString(input.data, 'workflowDeliveryRequirement') && input.workflowKey !== VIDEO_PRODUCTION_WORKFLOW_KEY) return '待配置'
  if (input.operation === 'canvas_source') {
    const mode = readString(input.data, 'workflowSourceMode') || 'canvas_group'
    if (mode === 'inline_text' && !readString(input.data, 'workflowSourceText')) return '待配置'
    if (mode === 'canvas_group' && !readString(input.data, 'sourceGroupId')) return '待绑定'
  }
  return '已配置'
}

export function WorkflowStageContent(props: WorkflowStageContentProps): React.JSX.Element | null {
  const projectId = useUIStore((state) => state.currentProject?.id ?? '')
  const isAdmin = useIsAdmin()
  const [syncState, setSyncState] = React.useState<ProjectionSyncState>('idle')
  const [syncError, setSyncError] = React.useState('')
  const workflowKey = readString(props.data, 'workflowKey')
  const workflowNodeId = readString(props.data, 'workflowNodeId')
  const operation = readString(atomicSpec(props.data), 'operation') || readString(props.data, 'workflowNodeKind')
  const workflowInstanceId = readString(props.data, 'workflowInstanceId')
  const sourceGroupId = readString(props.data, 'sourceGroupId')
  const requestedAt = readString(props.data, 'workflowRequestedAt')
  const workflowRunId = readString(props.data, 'workflowRunId')
  const workflowExecutionId = readString(props.data, 'workflowExecutionId')
  const workflowTraceId = readString(props.data, 'workflowTraceId')
  const workflowTraceStatus = readString(props.data, 'workflowTraceStatus')
  const presentation = resolveWorkflowNodePresentation(props.data)
  const elapsed = useWorkflowNodeElapsedTime(props.data)
  const rawWorkflowStatus = readString(props.data, 'workflowStatus')
  const workflowStatus = workflowKey !== VIDEO_PRODUCTION_WORKFLOW_KEY
    ? rawWorkflowStatus || 'queued'
    : VIDEO_PRODUCTION_WORKFLOW_NODE_STATUSES.some((status) => status === rawWorkflowStatus)
      ? rawWorkflowStatus
      : 'queued'
  const category = presentation.category
  const inputPorts = readStrings(props.data, 'workflowInputPorts')
  const outputPorts = readStrings(props.data, 'workflowOutputPorts')
  const completedUnits = readCount(props.data, 'workflowCompletedUnits')
  const totalUnits = readNullableCount(props.data, 'workflowTotalUnits')
  const outputArtifactCount = readStrings(props.data, 'workflowOutputArtifactIds').length
  const errorCount = readCount(props.data, 'workflowErrorCount')
  const waitingReasonLabel = readString(props.data, 'workflowWaitingReasonLabel')
  const itemRuns = readWorkflowItemRuns(props.data.workflowItemRuns)
  const runtimeExpanded = props.data.workflowRuntimeExpanded === true
  const isRuntimeReference = props.data.workflowRuntimeReference === true
  const runtimeReferenceDisabled = props.data.runtimeReferenceDisabled === true
  const runtimeReferenceCount = readCount(props.data, 'workflowRuntimeReferenceCount')
  const inspectedNodeId = useWorkflowNodeInspectorStore((state) => state.nodeId)
  const isVideoCoordinator = workflowKey === VIDEO_PRODUCTION_WORKFLOW_KEY && workflowNodeId === 'delivery-contract'
  const agentProgress = workflowStatus === 'running' && category === 'agent'
    ? workflowAgentProgress(props.data.workflowExecutionEvidence)
    : null
  const configurationState = isRuntimeReference
    ? runtimeReferenceCount > 0
      ? `${runtimeReferenceCount} 项本轮实际读取`
      : '全库可检索 · 本轮未读取'
    : agentProgress?.label ?? configurationLabel({
    operation,
    workflowKey,
    requestedAt,
    executionId: workflowExecutionId,
    data: props.data,
    workflowStatus,
    errorCount,
    waitingReasonLabel,
  })
  const primaryActionLabel = workflowStatus === 'waiting_external'
    ? '查看等待中的外部结果'
    : workflowStatus === 'partial'
      ? '修复未完成项'
      : workflowStatus === 'succeeded'
        ? '查看本次结果'
        : '运行到此节点'

  const refreshProjection = React.useCallback(async (): Promise<void> => {
    if (!isAdmin || workflowKey !== VIDEO_PRODUCTION_WORKFLOW_KEY || !projectId || !sourceGroupId || !requestedAt || !workflowInstanceId) return
    setSyncState((current) => current === 'connected' ? current : 'polling')
    setSyncError('')
    try {
      const diagnostics = await fetchAdminAgentDiagnostics({
        projectId,
        workflowKey: VIDEO_PRODUCTION_WORKFLOW_KEY,
        limit: 50,
      })
      const snapshot = findLatestVideoWorkflowSnapshot(diagnostics.traces, sourceGroupId, requestedAt)
      if (!snapshot) return
      applyVideoWorkflowSnapshot(workflowInstanceId, snapshot)
      setSyncState('connected')
    } catch (error: unknown) {
      setSyncError(error instanceof Error && error.message ? error.message : '工作流状态同步失败')
      setSyncState('failed')
    }
  }, [isAdmin, projectId, requestedAt, sourceGroupId, workflowInstanceId, workflowKey])

  React.useEffect(() => {
    if (!isVideoCoordinator || !requestedAt || !isAdmin) return undefined
    void refreshProjection()
    const timer = window.setInterval(() => void refreshProjection(), WORKFLOW_POLL_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [isAdmin, isVideoCoordinator, refreshProjection, requestedAt])

  const progressLabel = totalUnits !== null && totalUnits > 0
    ? completedUnits + '/' + totalUnits
    : completedUnits > 0 ? String(completedUnits) : '—'
  const syncLabel = isRuntimeReference
    ? '来自本轮 Agent 真实读取证据'
    : syncState === 'connected'
    ? 'run ' + (workflowRunId ? workflowRunId.slice(0, 10) : '已识别')
    : syncState === 'failed'
      ? '状态同步失败'
      : workflowTraceId
        ? 'trace ' + workflowTraceId.slice(0, 10) + ' · ' + (workflowTraceStatus || '已记录')
        : requestedAt ? '已发起，等待运行证据' : '尚未发起'

  const openInspector = (tab: WorkflowNodeInspectorTab): void => {
    const inspector = useWorkflowNodeInspectorStore.getState()
    inspector.openNode(props.nodeId)
    inspector.setTab(tab)
  }

  return (
    <section
      className={'workflow-stage-content workflow-stage-content--category-' + presentation.variant + ' workflow-stage-content--' + workflowStatus + (inspectedNodeId === props.nodeId ? ' workflow-stage-content--inspected' : '') + (isRuntimeReference && runtimeReferenceDisabled ? ' workflow-stage-content--reference-disabled' : '')}
      aria-label={'工作流原子节点 ' + workflowNodeId}
      data-workflow-projection={workflowNodeId}
      onClick={(event) => {
        event.stopPropagation()
        openInspector('configuration')
      }}
    >
      <WorkflowRuntimeProjection
        visible={!isRuntimeReference && runtimeExpanded}
        operation={operation}
        itemRuns={props.data.workflowItemRuns}
        totalItems={totalUnits}
      />
      <header className="workflow-stage-content__header">
        <span className={'workflow-stage-content__category workflow-stage-content__category--' + (category ?? 'stage')}>
          <WorkflowNodeGlyph
            presentation={presentation}
            className="workflow-stage-content__category-icon"
            size={15}
            nodeId={props.nodeId}
          />
        </span>
        <div className="workflow-stage-content__identity">
          <span className="workflow-stage-content__kind">
            {presentation.categoryLabel + ' · ' + presentation.operationLabel + ' · ' + presentation.executionModeLabel}
          </span>
          <strong className="workflow-stage-content__node-id" title={workflowNodeId || props.nodeId}>
            {readString(props.data, 'label') || presentation.operationLabel}
          </strong>
        </div>
        <WorkflowNodeStatusBar
          status={workflowStatus as WorkflowNodeStatus}
          label={statusLabel(workflowStatus, operation, waitingReasonLabel)}
          detail={configurationState !== statusLabel(workflowStatus, operation, waitingReasonLabel) ? configurationState : undefined}
          progress={totalUnits !== null && totalUnits > 0 ? progressLabel : undefined}
          elapsed={elapsed?.duration}
        />
        {elapsed?.duration ? <span className="sr-only">{statusLabel(workflowStatus, operation, waitingReasonLabel)} · {elapsed.duration}</span> : null}
      </header>
      <WorkflowNodePorts inputPorts={inputPorts} outputPorts={outputPorts} />
      <p className="workflow-stage-content__summary">{presentation.summary}</p>
      <footer className="workflow-stage-content__footer">
        <span className={'workflow-stage-content__sync workflow-stage-content__sync--' + syncState} title={syncError || syncLabel}>
          {errorCount > 0
            ? errorCount + ' 个错误 · ' + progressLabel
            : totalUnits !== null && totalUnits > 0
              ? progressLabel + (outputArtifactCount > 0 ? ' · ' + outputArtifactCount + ' 个产物' : '')
              : outputArtifactCount > 0
                ? outputArtifactCount + ' 个产物'
                : agentProgress?.detail || syncError || syncLabel}
        </span>
        <div className="workflow-stage-content__actions">
          {!props.readOnly ? <Tooltip className="workflow-stage-content__tooltip" label="配置节点" withArrow>
            <ActionIcon
              className="workflow-stage-content__action nodrag nopan"
              variant="subtle"
              size="sm"
              aria-label={isRuntimeReference ? '查看 Agent 引用证据' : '配置工作流节点'}
              onClick={(event) => {
                event.stopPropagation()
                openInspector('configuration')
              }}
            >
              <IconSettings className="workflow-stage-content__action-icon" size={15} aria-hidden="true" />
            </ActionIcon>
          </Tooltip> : null}
          {!isRuntimeReference && !props.readOnly ? <Tooltip className="workflow-stage-content__tooltip" label={primaryActionLabel} withArrow>
            <ActionIcon
              className="workflow-stage-content__action workflow-stage-content__action--run nodrag nopan"
              variant="subtle"
              size="sm"
              aria-label={primaryActionLabel}
              onClick={(event) => {
                event.stopPropagation()
                openInspector('run')
              }}
            >
              <IconPlayerPlay className="workflow-stage-content__action-icon" size={15} aria-hidden="true" />
            </ActionIcon>
          </Tooltip> : null}
          {!isRuntimeReference ? <Tooltip className="workflow-stage-content__tooltip" label="查看该节点的全部执行历史" withArrow>
            <ActionIcon
              className="workflow-stage-content__action nodrag nopan"
              variant="subtle"
              size="sm"
              aria-label="查看节点执行历史"
              onClick={(event) => {
                event.stopPropagation()
                openInspector('history')
              }}
            >
              <IconHistory className="workflow-stage-content__action-icon" size={15} aria-hidden="true" />
            </ActionIcon>
          </Tooltip> : null}
          {!isRuntimeReference && itemRuns.length > 0 ? (
            <Tooltip className="workflow-stage-content__tooltip" label={runtimeExpanded ? '收起本次逐项运行' : '铺开本次逐项运行'} withArrow>
              <ActionIcon
                className="workflow-stage-content__action nodrag nopan"
                variant="subtle"
                size="sm"
                aria-label={runtimeExpanded ? '收起本次逐项运行' : '铺开本次逐项运行'}
                onClick={(event) => {
                  event.stopPropagation()
                  useRFStore.getState().updateNodeData(props.nodeId, { workflowRuntimeExpanded: !runtimeExpanded })
                }}
              >
                <IconBinaryTree className="workflow-stage-content__action-icon" size={15} aria-hidden="true" />
              </ActionIcon>
            </Tooltip>
          ) : null}
          <Menu withinPortal position="bottom-end" shadow="md">
            <Menu.Target>
              <ActionIcon className="workflow-stage-content__action nodrag nopan" variant="subtle" size="sm" aria-label="更多节点操作">
                <IconDots className="workflow-stage-content__icon-dots" size={15} aria-hidden="true" />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Label>节点操作</Menu.Label>
              <Menu.Item onClick={() => openInspector('configuration')}>查看配置与输入</Menu.Item>
              {!isRuntimeReference ? <Menu.Item onClick={() => openInspector('history')}>查看执行历史</Menu.Item> : null}
              {!isRuntimeReference && itemRuns.length > 0 ? <Menu.Item onClick={() => useRFStore.getState().updateNodeData(props.nodeId, { workflowRuntimeExpanded: !runtimeExpanded })}>{runtimeExpanded ? '收起逐项运行' : '展开逐项运行'}</Menu.Item> : null}
            </Menu.Dropdown>
          </Menu>
        </div>
        {isVideoCoordinator && requestedAt ? (
          <div className="workflow-stage-content__actions">
            <Tooltip className="workflow-stage-content__tooltip" label="立即读取后端持久状态" withArrow>
              <ActionIcon
                className="workflow-stage-content__action nodrag nopan"
                variant="subtle"
                size="sm"
                aria-label="刷新一键成片工作流状态"
                loading={syncState === 'polling'}
                disabled={props.readOnly || isTerminalStatus(workflowStatus)}
                onClick={() => void refreshProjection()}
              >
                <IconRefresh className="workflow-stage-content__action-icon" size={15} aria-hidden="true" />
              </ActionIcon>
            </Tooltip>
          </div>
        ) : null}
      </footer>
    </section>
  )
}
