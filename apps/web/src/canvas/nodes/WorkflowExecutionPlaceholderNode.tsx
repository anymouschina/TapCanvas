import React from 'react'
import type { NodeProps } from '@xyflow/react'
import { IconBinaryTree2, IconPlayerStop, IconCircleCheck, IconCircleX, IconCircleDashed } from '@tabler/icons-react'
import { requestWorkflowExecutionSnapshot } from '../workflowExecutionRequest'
import { cancelWorkflowExecution } from '../../api/server'
import './WorkflowExecutionPlaceholderNode.css'

type PlaceholderData = {
  workflowExecutionId?: unknown
  workflowStatus?: unknown
  workflowCompletedUnits?: unknown
  workflowTotalUnits?: unknown
  workflowErrorCount?: unknown
  workflowErrorDetail?: unknown
  workflowWaitingReasonLabel?: unknown
  label?: unknown
  readOnly?: unknown
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

type StatusPresentation = Readonly<{
  key: 'queued' | 'running' | 'waiting' | 'partial' | 'succeeded' | 'failed' | 'cancelled' | 'idle'
  label: string
}>

function statusPresentation(raw: string): StatusPresentation {
  if (raw === 'running') return { key: 'running', label: '执行中' }
  if (raw === 'waiting_external') return { key: 'waiting', label: '等待外部结果' }
  if (raw === 'succeeded') return { key: 'succeeded', label: '已完成' }
  if (raw === 'partial') return { key: 'partial', label: '执行中 · 有步骤异常' }
  if (raw === 'failed') return { key: 'failed', label: '失败' }
  if (raw === 'cancelled' || raw === 'canceled') return { key: 'cancelled', label: '已停止' }
  if (raw === 'queued') return { key: 'queued', label: '等待执行' }
  return { key: 'idle', label: '未运行' }
}

/**
 * 工作流执行占位节点：小T 触发的一键成片等执行没有前端手动运行路径，
 * 本节点在画布上外显该执行的运行状态（running 转圈 / succeeded 绿 / failed 红），
 * 点击打开该执行的原始快照弹窗查看运行过程。新执行由服务端在派发前持久化；
 * 历史执行仍可由前端用 workflowRuntimeReference 恢复投影回显。
 */
export function WorkflowExecutionPlaceholderNode(props: NodeProps): React.JSX.Element {
  const data = (props.data || {}) as PlaceholderData
  const executionId = readString(data.workflowExecutionId)
  const readOnly = data.readOnly === true
  const [stopResult, setStopResult] = React.useState<{ executionId: string; status: string } | null>(null)
  const [stopping, setStopping] = React.useState(false)
  const [stopError, setStopError] = React.useState('')
  const stoppingRef = React.useRef(false)
  const presentation = statusPresentation(stopResult?.executionId === executionId
    ? stopResult.status : readString(data.workflowStatus))
  const canStop = !!executionId && !readOnly
    && ['queued', 'running', 'waiting', 'partial'].includes(presentation.key)
  const completed = readCount(data.workflowCompletedUnits)
  const total = readCount(data.workflowTotalUnits)
  const errorCount = readCount(data.workflowErrorCount)
  const detail = readString(data.workflowWaitingReasonLabel) || readString(data.workflowErrorDetail)
  const busy = presentation.key === 'running' || presentation.key === 'partial'
  const progressLabel = total > 0
    ? `${completed}/${total} 节点`
    : completed > 0 ? `${completed} 节点` : ''

  const openSnapshot = (event: React.MouseEvent): void => {
    if (readOnly) return
    event.stopPropagation()
    if (!executionId) return
    requestWorkflowExecutionSnapshot(executionId)
  }

  const stopExecution = async (event: React.MouseEvent): Promise<void> => {
    event.stopPropagation()
    if (!canStop || stoppingRef.current) return
    stoppingRef.current = true
    setStopping(true)
    setStopError('')
    try {
      const result = await cancelWorkflowExecution(executionId)
      setStopResult({ executionId, status: result.execution.status })
    } catch (error: unknown) {
      setStopError(error instanceof Error ? error.message : '停止失败，请重试')
    } finally {
      stoppingRef.current = false
      setStopping(false)
    }
  }

  return (
    <div className="tc-workflow-execution-placeholder-wrapper">
      <div
        className={'tc-workflow-execution-placeholder tc-workflow-execution-placeholder--' + presentation.key}
        data-workflow-execution-status={presentation.key}
      >
        {canStop ? (
          <button
            type="button"
            className="tc-workflow-execution-placeholder__icon tc-workflow-execution-placeholder__stop nodrag nopan"
            aria-label={stopping ? '正在停止…' : '停止执行'}
            disabled={stopping}
            title="停止后续执行，保留已有成果；已提交的图片或视频任务可能仍会完成"
            onClick={(event) => void stopExecution(event)}
          >
            {stopping ? <span className="tc-workflow-execution-placeholder__spinner" aria-hidden="true" /> : <IconPlayerStop className="workflow-execution-placeholder-node__iconplayerstop" size={15} aria-hidden="true" />}
          </button>
        ) : (
          <span className="tc-workflow-execution-placeholder__icon" aria-hidden="true">
            <IconBinaryTree2 className="workflow-execution-placeholder-node__iconbinarytree2" size={15} />
          </span>
        )}
        <button
          type="button"
          className="tc-workflow-execution-placeholder__snapshot nopan"
          title="单击查看过程，按住拖动节点"
          aria-label={`工作流执行 · ${presentation.label}${executionId ? ` · ${executionId.slice(0, 12)}` : ''}`}
          onClick={openSnapshot}
          disabled={readOnly || !executionId}
        >
          <span className="tc-workflow-execution-placeholder__body">
            <span className="tc-workflow-execution-placeholder__title">
              {readString(data.label) || '工作流执行'}
            </span>
            <span className="tc-workflow-execution-placeholder__meta">
              {progressLabel || '等待执行记录'} · 查看过程
            </span>
            {detail ? <span className="tc-workflow-execution-placeholder__detail" title={detail}>{detail}</span> : null}
          </span>
          <span className="tc-workflow-execution-placeholder__status" aria-hidden="true">
            {busy ? (
              <span className="tc-workflow-execution-placeholder__spinner" />
            ) : presentation.key === 'succeeded' ? (
              <IconCircleCheck className="workflow-execution-placeholder-node__iconcirclecheck" size={16} />
            ) : presentation.key === 'failed' ? (
              <IconCircleX className="workflow-execution-placeholder-node__iconcirclex" size={16} />
            ) : (
              <IconCircleDashed className="workflow-execution-placeholder-node__iconcircledashed" size={16} />
            )}
          </span>
          <span className="tc-workflow-execution-placeholder__status-label">
            {presentation.key === 'waiting' ? readString(data.workflowWaitingReasonLabel) || presentation.label : presentation.label}
            {errorCount > 0 && (presentation.key === 'failed' || presentation.key === 'partial') ? ` · ${errorCount} 处错误` : ''}
          </span>
        </button>
      </div>
      {stopError ? <div className="tc-workflow-execution-placeholder__stop-error" role="alert">停止失败：{stopError}</div> : null}
    </div>
  )
}
