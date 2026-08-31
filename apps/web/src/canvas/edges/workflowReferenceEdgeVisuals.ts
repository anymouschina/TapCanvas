export type WorkflowReferenceKind = 'skill' | 'knowledge'

export type WorkflowReferenceState = 'available'

export type WorkflowReferenceVisualState = WorkflowReferenceState | 'actual' | 'running'

export const resolveWorkflowReferenceVisualState = ({
  actualReadCount,
  referenceState,
  targetExecutionState,
}: {
  actualReadCount: number
  referenceState: WorkflowReferenceState
  targetExecutionState: string
}): WorkflowReferenceVisualState => {
  if (actualReadCount > 0) return 'actual'
  if (referenceState === 'available' && targetExecutionState === 'running') {
    return 'running'
  }
  return referenceState
}

export const resolveWorkflowReferenceEdgeStyle = ({
  kind,
  referenceState,
  visualState,
}: {
  kind: WorkflowReferenceKind
  referenceState: WorkflowReferenceState
  visualState: WorkflowReferenceVisualState
}) => {
  const configuredColor = kind === 'skill'
    ? 'var(--tc-color-violet-4, #a78bfa)'
    : 'var(--tc-color-cyan-4, #38bdf8)'
  const stroke = visualState === 'actual'
    ? 'var(--tc-color-success, #34d399)'
    : visualState === 'running'
      ? 'var(--tc-color-warning, #fbbf24)'
      : configuredColor

  return {
    stroke,
    strokeWidth: visualState === 'actual' || visualState === 'running'
      ? 2.4
      : 2.1,
    opacity: visualState === 'actual' || visualState === 'running'
      ? 1
      : 0.9,
    strokeDasharray: visualState === 'actual'
      ? undefined
      : visualState === 'running'
        ? '8 5'
        : '6 5',
    vectorEffect: 'non-scaling-stroke' as const,
  }
}
