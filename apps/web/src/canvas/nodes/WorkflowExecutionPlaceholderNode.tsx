import React from 'react'
import type { NodeProps } from '@xyflow/react'
import { IconBinaryTree2, IconPlayerPlay, IconCircleCheck, IconCircleX, IconCircleDashed } from '@tabler/icons-react'
import { requestWorkflowExecutionSnapshot } from '../workflowExecutionRequest'
import './WorkflowExecutionPlaceholderNode.css'

type PlaceholderData = {
  workflowExecutionId?: unknown
  workflowStatus?: unknown
  workflowCompletedUnits?: unknown
  workflowTotalUnits?: unknown
  workflowErrorCount?: unknown
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
  key: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'idle'
  label: string
}>

function statusPresentation(raw: string): StatusPresentation {
  if (raw === 'running') return { key: 'running', label: '执行中' }
  if (raw === 'waiting_external') return { key: 'running', label: '等待外部' }
  if (raw === 'succeeded') return { key: 'succeeded', label: '已完成' }
  if (raw === 'partial') return { key: 'running', label: '部分完成' }
  if (raw === 'failed') return { key: 'failed', label: '失败' }
  if (raw === 'cancelled') return { key: 'cancelled', label: '已取消' }
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
  const presentation = statusPresentation(readString(data.workflowStatus))
  const completed = readCount(data.workflowCompletedUnits)
  const total = readCount(data.workflowTotalUnits)
  const errorCount = readCount(data.workflowErrorCount)
  const progressLabel = total > 0
    ? `${completed}/${total} 节点`
    : completed > 0 ? `${completed} 节点` : ''

  const openSnapshot = (event: React.MouseEvent): void => {
    if (readOnly) return
    event.stopPropagation()
    if (!executionId) return
    try {
      requestWorkflowExecutionSnapshot(executionId)
    } catch {
      /* 缺执行身份时不弹窗 */
    }
  }

  return (
    <button
      type="button"
      className={'tc-workflow-execution-placeholder tc-workflow-execution-placeholder--' + presentation.key}
      data-workflow-execution-status={presentation.key}
      aria-label={`工作流执行 · ${presentation.label}${executionId ? ` · ${executionId.slice(0, 12)}` : ''}`}
      onClick={openSnapshot}
    >
      <span className="tc-workflow-execution-placeholder__icon" aria-hidden="true">
        {presentation.key === 'running' ? <IconPlayerPlay size={15} /> : <IconBinaryTree2 size={15} />}
      </span>
      <span className="tc-workflow-execution-placeholder__body">
        <span className="tc-workflow-execution-placeholder__title">
          {readString(data.label) || '工作流执行'}
        </span>
        <span className="tc-workflow-execution-placeholder__meta">
          {executionId ? executionId.slice(0, 12) : ''}{progressLabel ? ` · ${progressLabel}` : ''}
        </span>
      </span>
      <span className="tc-workflow-execution-placeholder__status" aria-hidden="true">
        {presentation.key === 'running' ? (
          <span className="tc-workflow-execution-placeholder__spinner" />
        ) : presentation.key === 'succeeded' ? (
          <IconCircleCheck size={16} />
        ) : presentation.key === 'failed' ? (
          <IconCircleX size={16} />
        ) : (
          <IconCircleDashed size={16} />
        )}
      </span>
      <span className="tc-workflow-execution-placeholder__status-label">
        {presentation.label}{errorCount > 0 && presentation.key === 'failed' ? ` · ${errorCount} 处错误` : ''}
      </span>
    </button>
  )
}
