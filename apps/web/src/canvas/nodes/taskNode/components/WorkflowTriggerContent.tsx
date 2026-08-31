import React from 'react'
import './WorkflowTriggerContent.css'
import { ActionIcon, Tooltip } from '@mantine/core'
import { IconHistory, IconPlayerPlay } from '@tabler/icons-react'
import { AGENT_WORKFLOW_KEY, parseWorkflowTriggerSpec } from '@tapcanvas/workflow-kernel-protocol'
import { VIDEO_PRODUCTION_WORKFLOW_KEY } from '@tapcanvas/video-orchestrator-protocol'
import { useIsAdmin } from '../../../../auth/isAdmin'
import { toast } from '../../../../ui/toast'
import { runAgentWorkflow } from '../../../agentWorkflowExecution'
import { runVideoWorkflow } from '../../../videoWorkflowExecution'
import { fetchAdminAgentDiagnostics } from '../../../../api/server'
import { useUIStore } from '../../../../ui/uiStore'
import { applyAgentWorkflowTrace, findLatestAgentWorkflowTrace } from '../../../agentWorkflowProjectionSync'
import { useWorkflowNodeInspectorStore } from '../../../workflowNodeInspectorStore'
import { resolveWorkflowNodePresentation } from '../../../workflowNodePresentation'
import { WorkflowNodeGlyph } from './WorkflowNodeGlyph'

type WorkflowTriggerContentProps = {
  nodeId: string
  data: Record<string, unknown>
  readOnly: boolean
}

function readString(data: Record<string, unknown>, key: string): string {
  const value = data[key]
  return typeof value === 'string' ? value.trim() : ''
}

function triggerDescription(spec: ReturnType<typeof parseWorkflowTriggerSpec>): string {
  if (!spec.success) return spec.error.message
  if (spec.data.kind === 'manual') return '启动整条工作流；正文数据由后续输入节点提供'
  if (spec.data.kind === 'schedule') return `${spec.data.enabled ? '已启用' : '未启用'} · ${spec.data.cron} · ${spec.data.timezone}`
  if (spec.data.kind === 'webhook') return `Webhook · ${spec.data.webhookId}`
  return `Event · ${spec.data.topic}`
}

function triggerKindLabel(kind: 'manual' | 'schedule' | 'webhook' | 'event' | 'invalid'): string {
  if (kind === 'manual') return '手动'
  if (kind === 'schedule') return '定时'
  if (kind === 'webhook') return 'Webhook'
  if (kind === 'event') return '事件'
  return '配置无效'
}

export function WorkflowTriggerContent(props: WorkflowTriggerContentProps): React.JSX.Element | null {
  const isAdmin = useIsAdmin()
  const projectId = useUIStore((state) => state.currentProject?.id ?? '')
  const [projectionError, setProjectionError] = React.useState('')
  const workflowInstanceId = readString(props.data, 'workflowInstanceId')
  const workflowKey = readString(props.data, 'workflowKey')
  const requestedAt = readString(props.data, 'workflowRequestedAt')
  const workflowRunId = readString(props.data, 'workflowRunId')
  const workflowTraceId = readString(props.data, 'workflowTraceId')
  const workflowTraceStatus = readString(props.data, 'workflowTraceStatus')
  const workflowExecutionId = readString(props.data, 'workflowExecutionId')
  const workflowStatus = readString(props.data, 'workflowStatus')
  const executionMode = readString(props.data, 'workflowExecutionMode')
  const configuredExecutionScope = readString(props.data, 'workflowExecutionScope')
  const effectiveExecutionScope = executionMode || configuredExecutionScope
  const shouldPollAgentTrace = workflowKey !== VIDEO_PRODUCTION_WORKFLOW_KEY && effectiveExecutionScope === 'prompt_only'
  const spec = parseWorkflowTriggerSpec(props.data.workflowTriggerSpec)
  const triggerKind = spec.success ? spec.data.kind : 'invalid'
  const presentation = resolveWorkflowNodePresentation(props.data)
  const canRunManually = isAdmin && spec.success && spec.data.kind === 'manual' && !props.readOnly

  const refreshAgentProjection = React.useCallback(async (): Promise<void> => {
    if (!isAdmin || !shouldPollAgentTrace || !projectId || !requestedAt || !workflowInstanceId) return
    setProjectionError('')
    try {
      const diagnostics = await fetchAdminAgentDiagnostics({
        projectId,
        nodeId: props.nodeId,
        workflowKey,
        limit: 20,
      })
      const trace = findLatestAgentWorkflowTrace(diagnostics.traces, requestedAt, workflowKey)
      if (trace) applyAgentWorkflowTrace(workflowInstanceId, trace)
    } catch (error: unknown) {
      setProjectionError(error instanceof Error ? error.message : '读取智能体运行状态失败')
    }
  }, [isAdmin, projectId, props.nodeId, requestedAt, shouldPollAgentTrace, workflowInstanceId, workflowKey])

  React.useEffect(() => {
    if (!shouldPollAgentTrace || !requestedAt || !isAdmin) return undefined
    void refreshAgentProjection()
    if (workflowTraceStatus === 'succeeded' || workflowTraceStatus === 'failed' || workflowTraceStatus === 'cancelled') return undefined
    const timer = window.setInterval(() => void refreshAgentProjection(), 5_000)
    return () => window.clearInterval(timer)
  }, [isAdmin, refreshAgentProjection, requestedAt, shouldPollAgentTrace, workflowTraceStatus])

  const startWorkflow = React.useCallback(() => {
    if (!canRunManually) return
    if (!workflowInstanceId || !workflowKey) {
      toast('触发器缺少工作流实例或工作流身份', 'error')
      return
    }
    if (workflowKey === AGENT_WORKFLOW_KEY) {
      try {
        runAgentWorkflow(props.nodeId)
      } catch (error: unknown) {
        toast(error instanceof Error ? error.message : '智能体工作流编译失败', 'error')
      }
      return
    }
    if (workflowKey !== VIDEO_PRODUCTION_WORKFLOW_KEY) {
      toast(`未注册工作流执行器：${workflowKey}`, 'error')
      return
    }
    try {
      runVideoWorkflow(props.nodeId)
    } catch (error: unknown) {
      toast(error instanceof Error ? error.message : '一键成片工作流编译失败', 'error')
    }
  }, [canRunManually, props.nodeId, workflowInstanceId, workflowKey])

  if (!isAdmin) return null

  return (
    <section className={`workflow-trigger-content workflow-trigger-content--${triggerKind}`} aria-label="工作流触发器">
      <header className="workflow-trigger-content__header">
        <span className="workflow-trigger-content__glyph-frame">
          <WorkflowNodeGlyph presentation={presentation} className="workflow-trigger-content__glyph" size={17} nodeId={props.nodeId} />
        </span>
        <div className="workflow-trigger-content__heading">
          <span className="workflow-trigger-content__eyebrow">执行入口</span>
          <strong className="workflow-trigger-content__kind">{triggerKindLabel(triggerKind)}</strong>
        </div>
      </header>
      <p className={`workflow-trigger-content__description${spec.success ? '' : ' workflow-trigger-content__description--error'}`}>
        {triggerDescription(spec)}
      </p>
      <dl className="workflow-trigger-content__facts">
        <div className="workflow-trigger-content__fact">
          <dt className="workflow-trigger-content__fact-label">发生次序</dt>
          <dd className="workflow-trigger-content__fact-value">{requestedAt ? requestedAt : '尚未创建'}</dd>
        </div>
        <div className="workflow-trigger-content__fact">
          <dt className="workflow-trigger-content__fact-label">运行身份</dt>
          <dd className="workflow-trigger-content__fact-value">{workflowExecutionId || workflowRunId || workflowTraceId || '等待触发'}</dd>
        </div>
      </dl>
      <footer className="workflow-trigger-content__footer">
        <span className="workflow-trigger-content__ownership">
          {projectionError
            ? projectionError
            : workflowKey === AGENT_WORKFLOW_KEY
              ? workflowStatus ? `ExecutionDO · ${workflowStatus}` : '等待逐节点执行'
              : workflowKey === VIDEO_PRODUCTION_WORKFLOW_KEY && effectiveExecutionScope !== 'prompt_only'
                ? '后端持久执行'
                : workflowTraceStatus ? `trace · ${workflowTraceStatus}` : 'agents-cli 逻辑任务'}
        </span>
        <div className="workflow-trigger-content__actions">
          {canRunManually ? (
            <Tooltip className="workflow-trigger-content__tooltip" label="按当前画布定义创建一次真实运行" withArrow>
              <ActionIcon
                className="workflow-trigger-content__run nodrag nopan"
                variant="subtle"
                size="sm"
                aria-label="手动触发工作流"
                onClick={(event) => {
                  event.stopPropagation()
                  startWorkflow()
                }}
              >
                <IconPlayerPlay className="workflow-trigger-content__run-icon" size={15} aria-hidden="true" />
              </ActionIcon>
            </Tooltip>
          ) : null}
          <Tooltip className="workflow-trigger-content__tooltip" label="查看触发器的全部执行历史" withArrow>
            <ActionIcon
              className="workflow-trigger-content__run nodrag nopan"
              variant="subtle"
              size="sm"
              aria-label="查看节点执行历史"
              onClick={(event) => {
                event.stopPropagation()
                const inspector = useWorkflowNodeInspectorStore.getState()
                inspector.openNode(props.nodeId)
                inspector.setTab('history')
              }}
            >
              <IconHistory className="workflow-trigger-content__run-icon" size={15} aria-hidden="true" />
            </ActionIcon>
          </Tooltip>
        </div>
      </footer>
    </section>
  )
}
