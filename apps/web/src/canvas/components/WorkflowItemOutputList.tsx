import React from 'react'
import { workflowItemRunErrorSummary, type WorkflowItemRunView } from '../workflowItemRuns'
import { stringifyWorkflowValue } from '../workflowJavascriptSandbox'

function itemStatusLabel(status: WorkflowItemRunView['status']): string {
  if (status === 'queued') return '排队中'
  if (status === 'running') return '运行中'
  if (status === 'success') return '完成'
  if (status === 'waiting_external') return '等待外部结果'
  return '失败'
}

function itemOutput(item: WorkflowItemRunView): string {
  const errorSummary = workflowItemRunErrorSummary(item)
  if (item.status === 'failed' && errorSummary) return errorSummary
  if (item.textOutput) return item.textOutput
  if (Object.keys(item.output).length > 0) return stringifyWorkflowValue(item.output)
  return item.errorMessage || '当前数据项尚无输出'
}

export function WorkflowItemOutputList(props: Readonly<{
  items: readonly WorkflowItemRunView[]
  ariaLabel: string
}>): React.JSX.Element {
  return (
    <ol className="workflow-node-inspector__collection" aria-label={props.ariaLabel}>
      {props.items.map((item) => (
        <li className="workflow-node-inspector__collection-item" key={item.runtimeNodeId}>
          <details
            className={'workflow-node-inspector__collection-details workflow-node-inspector__collection-details--' + item.status}
            open={item.status !== 'success'}
          >
            <summary className="workflow-node-inspector__collection-summary">
              <span className="workflow-node-inspector__collection-index">#{item.index + 1}</span>
              <strong className="workflow-node-inspector__collection-id">{item.itemId}</strong>
              <span className="workflow-node-inspector__collection-lineage">
                {itemStatusLabel(item.status)}{item.artifactCount > 0 ? ` · ${item.artifactCount} 产物` : ''}
              </span>
            </summary>
            {item.videoUrl ? (
              <video
                className="workflow-node-inspector__collection-video"
                controls
                preload="metadata"
                src={item.videoUrl}
              />
            ) : (
              <div className="workflow-node-inspector__collection-output">
                <pre className="workflow-node-inspector__code-block workflow-node-inspector__code-block--collection">
                  {itemOutput(item)}
                </pre>
                {item.status === 'failed' && Object.keys(item.output).length > 0 ? (
                  <details className="workflow-node-inspector__raw-evidence">
                    <summary className="workflow-node-inspector__raw-evidence-summary">查看原始端口与交付证据</summary>
                    <pre className="workflow-node-inspector__code-block workflow-node-inspector__code-block--raw-evidence">
                      {stringifyWorkflowValue(item.output)}
                    </pre>
                  </details>
                ) : null}
              </div>
            )}
          </details>
        </li>
      ))}
    </ol>
  )
}
