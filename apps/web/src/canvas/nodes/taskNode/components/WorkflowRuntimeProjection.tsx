import React from 'react'
import { NodeToolbar, Position } from '@xyflow/react'
import { readWorkflowItemRuns } from '../../../workflowItemRuns'

export function WorkflowRuntimeProjection(props: Readonly<{
  visible: boolean
  operation: string
  itemRuns: unknown
  totalItems: number | null
}>): React.JSX.Element | null {
  const itemRuns = readWorkflowItemRuns(props.itemRuns)
  if (itemRuns.length === 0) return null
  return (
    <NodeToolbar
      className="workflow-runtime-projection nodrag nopan"
      isVisible={props.visible}
      position={Position.Right}
      offset={28}
    >
      <div className="workflow-runtime-projection__header">
        <strong className="workflow-runtime-projection__title">本次运行 · {itemRuns.length}/{props.totalItems ?? itemRuns.length} 项已落库</strong>
        <span className="workflow-runtime-projection__mode">只读投影</span>
      </div>
      <div className="workflow-runtime-projection__items">
        {itemRuns.map((item, index) => (
          <React.Fragment key={item.runtimeNodeId}>
            {index > 0 ? <span className="workflow-runtime-projection__connector" aria-hidden="true" /> : null}
            <article className={'workflow-runtime-projection__item workflow-runtime-projection__item--' + item.status}>
              <header className="workflow-runtime-projection__item-header">
                <span className="workflow-runtime-projection__item-index">#{item.index + 1}</span>
                <strong className="workflow-runtime-projection__item-operation">{props.operation || 'item run'}</strong>
                <span className="workflow-runtime-projection__item-status">{item.status === 'success' ? '完成' : item.status === 'waiting_external' ? '等待结果' : '失败'}</span>
              </header>
              {item.videoUrl ? (
                <video className="workflow-runtime-projection__video" src={item.videoUrl} controls preload="metadata" />
              ) : (
                <pre className="workflow-runtime-projection__output">{JSON.stringify(item.output, null, 2)}</pre>
              )}
              <footer className="workflow-runtime-projection__item-footer">
                <span className="workflow-runtime-projection__item-id">{item.itemId}</span>
                <span className="workflow-runtime-projection__artifact-count">{item.artifactCount} 产物</span>
              </footer>
              {item.errorMessage ? <p className="workflow-runtime-projection__error">{item.errorMessage}</p> : null}
            </article>
          </React.Fragment>
        ))}
      </div>
    </NodeToolbar>
  )
}
