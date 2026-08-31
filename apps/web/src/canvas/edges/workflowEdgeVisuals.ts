import type { CSSProperties } from 'react'

export const WORKFLOW_EDGE_IDLE_STROKE_WIDTH = 1.4
export const WORKFLOW_EDGE_ACTIVE_STROKE_WIDTH = 1.8

export type WorkflowEdgeExecutionState = 'idle' | 'queued' | 'running' | 'succeeded' | 'failed'

type WorkflowNodeExecutionState = 'idle' | 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  return typeof value === 'string' ? value.trim() : ''
}

export function workflowNodeExecutionState(data: unknown): WorkflowNodeExecutionState {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return 'idle'
  const record = data as Record<string, unknown>
  const status = readString(record, 'workflowStatus') || readString(record, 'triggerStatus')
  if (status === 'succeeded' || status === 'success') return 'succeeded'
  if (status === 'failed' || status === 'error') return 'failed'
  if (status === 'cancelled' || status === 'canceled') return 'cancelled'
  if (status === 'running' || status === 'waiting_external' || status === 'partial' || status === 'requested') {
    return 'running'
  }
  if (status === 'queued') return 'queued'
  return 'idle'
}

export function resolveWorkflowEdgeExecutionState(
  sourceData: unknown,
  targetData: unknown,
): WorkflowEdgeExecutionState {
  const source = workflowNodeExecutionState(sourceData)
  const target = workflowNodeExecutionState(targetData)
  if (source === 'failed') return 'failed'
  if (source === 'running') return 'running'
  if (source !== 'succeeded') return source === 'queued' ? 'queued' : 'idle'
  if (target === 'running') return 'running'
  if (target === 'succeeded' || target === 'failed' || target === 'cancelled') return 'succeeded'
  if (target === 'queued') return 'queued'
  return 'idle'
}

type WorkflowEdgeVisualStyleOptions = Readonly<{
  isLight: boolean
  active: boolean
  executionState?: WorkflowEdgeExecutionState
}>

export function resolveWorkflowEdgeVisualStyle(
  options: WorkflowEdgeVisualStyleOptions,
): CSSProperties {
  const executionState = options.executionState ?? 'idle'
  if (executionState === 'succeeded') {
    return {
      stroke: 'var(--tc-color-success, #34d399)',
      strokeWidth: 2.2,
      opacity: 0.94,
      vectorEffect: 'non-scaling-stroke',
    }
  }
  if (executionState === 'running') {
    return {
      stroke: 'var(--tc-color-warning, #fbbf24)',
      strokeWidth: 2.4,
      opacity: 1,
      strokeDasharray: '8 5',
      vectorEffect: 'non-scaling-stroke',
    }
  }
  if (executionState === 'failed') {
    return {
      stroke: 'var(--tc-color-danger, #f87171)',
      strokeWidth: 2.4,
      opacity: 0.96,
      vectorEffect: 'non-scaling-stroke',
    }
  }
  const alpha = options.active
    ? (options.isLight ? 0.48 : 0.46)
    : (options.isLight ? 0.32 : 0.28)

  return {
    stroke: options.isLight
      ? `rgba(17, 18, 21, ${alpha})`
      : `rgba(255, 255, 255, ${alpha})`,
    strokeWidth: options.active
      ? WORKFLOW_EDGE_ACTIVE_STROKE_WIDTH
      : WORKFLOW_EDGE_IDLE_STROKE_WIDTH,
    opacity: executionState === 'queued' ? 0.72 : 1,
    ...(executionState === 'queued' ? { strokeDasharray: '4 5' } : {}),
    vectorEffect: 'non-scaling-stroke',
  }
}
