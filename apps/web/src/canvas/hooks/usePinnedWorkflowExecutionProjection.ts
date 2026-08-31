import React from 'react'
import { toast } from '../../ui/toast'
import { useRFStore } from '../store'
import {
  ensureWorkflowExecutionPlaceholderNode,
  loadWorkflowExecutionProjection,
} from '../workflowExecutionProjection'
import { workflowExecutionProjectionGuard } from '../workflowExecutionProjectionData'
import { WORKFLOW_EXECUTION_SYNC_REQUEST_EVENT } from '../workflowExecutionRequest'
import { remoteApplyGuard } from '../sync/remoteApplyGuard'

const ACTIVE_EXECUTION_STATUSES = new Set([
  'queued',
  'running',
  'waiting_external',
  'partial',
])

const ACTIVE_EXECUTION_POLL_INTERVAL_MS = 2_000

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function selectPinnedExecutionField(field: 'workflowExecutionId' | 'workflowStatus'): string {
  const node = useRFStore.getState().nodes.find((candidate) => {
    const data = candidate.data
    return Boolean(data)
      && typeof data === 'object'
      && !Array.isArray(data)
      && (data as Record<string, unknown>).managedProjection === 'workflow_execution'
  })
  if (!node?.data || typeof node.data !== 'object' || Array.isArray(node.data)) return ''
  return readString((node.data as Record<string, unknown>)[field])
}

/**
 * Keeps the server-owned execution card on a chapter canvas aligned with the
 * durable execution rows. Chapter canvases do not have the workflow definition
 * flow id, so the exact execution id persisted on the card is the authority.
 */
export function usePinnedWorkflowExecutionProjection(scopeKey: string): void {
  const currentScopeKey = useRFStore((state) => state.graphProvenanceKey)
  const executionId = useRFStore((state) => {
    const node = state.nodes.find((candidate) => {
      const data = candidate.data
      return Boolean(data)
        && typeof data === 'object'
        && !Array.isArray(data)
        && (data as Record<string, unknown>).managedProjection === 'workflow_execution'
    })
    if (!node?.data || typeof node.data !== 'object' || Array.isArray(node.data)) return ''
    return readString((node.data as Record<string, unknown>).workflowExecutionId)
  })
  const executionStatus = useRFStore((state) => {
    const node = state.nodes.find((candidate) => {
      const data = candidate.data
      return Boolean(data)
        && typeof data === 'object'
        && !Array.isArray(data)
        && (data as Record<string, unknown>).managedProjection === 'workflow_execution'
    })
    if (!node?.data || typeof node.data !== 'object' || Array.isArray(node.data)) return ''
    return readString((node.data as Record<string, unknown>).workflowStatus)
  })
  const inFlightExecutionIdRef = React.useRef('')
  const reportedErrorRef = React.useRef('')

  const sync = React.useCallback(async (): Promise<void> => {
    if (!executionId || !scopeKey) return
    if (currentScopeKey !== scopeKey) return
    if (inFlightExecutionIdRef.current === executionId) return
    inFlightExecutionIdRef.current = executionId
    try {
      const projection = await loadWorkflowExecutionProjection(executionId)
      if (!projection) return
      if (useRFStore.getState().graphProvenanceKey !== scopeKey) return
      if (selectPinnedExecutionField('workflowExecutionId') !== executionId) return
      remoteApplyGuard.run(() => {
        workflowExecutionProjectionGuard.run(() => {
          ensureWorkflowExecutionPlaceholderNode(projection.executionId, projection.runs)
        })
      })
      reportedErrorRef.current = ''
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : '无法同步工作流执行状态'
      const errorKey = `${executionId}:${message}`
      if (reportedErrorRef.current !== errorKey) {
        reportedErrorRef.current = errorKey
        toast(`执行状态同步失败：${message}`, 'error')
      }
    } finally {
      if (inFlightExecutionIdRef.current === executionId) {
        inFlightExecutionIdRef.current = ''
      }
    }
  }, [currentScopeKey, executionId, scopeKey])

  React.useEffect(() => {
    if (!executionId || !scopeKey || currentScopeKey !== scopeKey) return
    void sync()
    const handleFocus = (): void => {
      void sync()
    }
    const handleVisibilityChange = (): void => {
      if (document.visibilityState === 'visible') void sync()
    }
    const pollTimer = ACTIVE_EXECUTION_STATUSES.has(executionStatus)
      ? window.setInterval(() => {
        void sync()
      }, ACTIVE_EXECUTION_POLL_INTERVAL_MS)
      : null
    window.addEventListener('focus', handleFocus)
    window.addEventListener(WORKFLOW_EXECUTION_SYNC_REQUEST_EVENT, handleFocus)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      if (pollTimer !== null) window.clearInterval(pollTimer)
      window.removeEventListener('focus', handleFocus)
      window.removeEventListener(WORKFLOW_EXECUTION_SYNC_REQUEST_EVENT, handleFocus)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [currentScopeKey, executionId, executionStatus, scopeKey, sync])
}
