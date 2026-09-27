import React from 'react'
import type { WorkflowMediaAttempt } from '../../../workflowMediaAttemptProjection'
import './WorkflowMediaAttemptHistory.css'

function statusLabel(status: string): string {
  if (status === 'success' || status === 'succeeded') return '成功'
  if (status === 'failed' || status === 'error') return '失败'
  if (status === 'running') return '运行中'
  if (status === 'queued') return '排队中'
  if (status === 'canceled' || status === 'cancelled') return '已取消'
  if (status === 'waiting_external') return '等待回执'
  return status
}

export function WorkflowMediaAttemptHistory(props: Readonly<{
  attempts: readonly WorkflowMediaAttempt[]
}>): React.JSX.Element | null {
  if (props.attempts.length < 2) return null
  return (
    <details
      className="tc-workflow-media-attempt-history nodrag nopan"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <summary className="tc-workflow-media-attempt-history__summary">
        工作流尝试历史 · {props.attempts.length} 次
      </summary>
      <ol className="tc-workflow-media-attempt-history__list">
        {props.attempts.map((attempt, index) => (
          <li className="tc-workflow-media-attempt-history__attempt" key={`${attempt.canvasNodeId}:${attempt.effectId ?? index}`}>
            <div className="tc-workflow-media-attempt-history__line">
              第 {index + 1} 次 · {statusLabel(attempt.status)} · {attempt.kind === 'video' ? '视频' : '图片'}
            </div>
            {attempt.errorMessage ? (
              <div className="tc-workflow-media-attempt-history__error">{attempt.errorMessage}</div>
            ) : null}
            {attempt.taskId ? (
              <div className="tc-workflow-media-attempt-history__metadata">任务回执：{attempt.taskId}</div>
            ) : null}
            {attempt.workflowTaskId ? (
              <div className="tc-workflow-media-attempt-history__metadata">工作流任务身份：{attempt.workflowTaskId}</div>
            ) : null}
            {attempt.assetUrls.map((url) => (
              <div className="tc-workflow-media-attempt-history__line" key={url}>
                <a className="tc-workflow-media-attempt-history__asset-link" href={url} target="_blank" rel="noreferrer">
                  查看已保存资产
                </a>
              </div>
            ))}
          </li>
        ))}
      </ol>
    </details>
  )
}
