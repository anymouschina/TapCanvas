import React from 'react'
import './WorkflowNodeStatusBar.css'

export type WorkflowNodeStatus = 'idle' | 'queued' | 'running' | 'waiting_external' | 'partial' | 'succeeded' | 'failed' | 'cancelled' | 'skipped' | 'not_selected'

type Props = Readonly<{
  status: WorkflowNodeStatus
  label: string
  detail?: string
  progress?: string
  elapsed?: string
}>

export function WorkflowNodeStatusBar({ status, label, detail, progress, elapsed }: Props): React.JSX.Element {
  const suffix = [progress, elapsed].filter(Boolean).join(' · ')
  return (
    <span className={`workflow-node-status-bar workflow-node-status-bar--${status}`}>
      <span className="workflow-node-status-bar__dot" aria-hidden="true" />
      <strong className="workflow-node-status-bar__strong">{label}</strong>
      {detail ? <span className="workflow-node-status-bar__detail">{detail}</span> : null}
      {suffix ? <span className="workflow-node-status-bar__suffix">{suffix}</span> : null}
    </span>
  )
}
