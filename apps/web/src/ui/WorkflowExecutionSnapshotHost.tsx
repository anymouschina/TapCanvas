import React from 'react'
import {
  WORKFLOW_EXECUTION_SNAPSHOT_REQUEST_EVENT,
  type WorkflowExecutionSnapshotRequestDetail,
} from '../canvas/workflowExecutionRequest'
import { WorkflowExecutionSnapshotModal } from './WorkflowExecutionSnapshotModal'

export function WorkflowExecutionSnapshotHost(props: Readonly<{
  onOpenLog?: (executionId: string) => void
}>): React.JSX.Element {
  const [executionId, setExecutionId] = React.useState<string | null>(null)

  React.useEffect(() => {
    const handleSnapshotRequest = (event: Event): void => {
      const detail = (event as CustomEvent<WorkflowExecutionSnapshotRequestDetail>).detail
      const requestedExecutionId = detail?.executionId?.trim() ?? ''
      if (requestedExecutionId) setExecutionId(requestedExecutionId)
    }
    window.addEventListener(WORKFLOW_EXECUTION_SNAPSHOT_REQUEST_EVENT, handleSnapshotRequest)
    return () => {
      window.removeEventListener(WORKFLOW_EXECUTION_SNAPSHOT_REQUEST_EVENT, handleSnapshotRequest)
    }
  }, [])

  return (
    <WorkflowExecutionSnapshotModal
      opened={Boolean(executionId)}
      executionId={executionId}
      onClose={() => setExecutionId(null)}
      onOpenLog={props.onOpenLog}
    />
  )
}
