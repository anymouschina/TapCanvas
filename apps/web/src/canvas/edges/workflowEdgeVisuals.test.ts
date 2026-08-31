import { describe, expect, it } from 'vitest'
import {
  WORKFLOW_EDGE_ACTIVE_STROKE_WIDTH,
  WORKFLOW_EDGE_IDLE_STROKE_WIDTH,
  resolveWorkflowEdgeExecutionState,
  resolveWorkflowEdgeVisualStyle,
} from './workflowEdgeVisuals'

describe('workflow edge visual hierarchy', () => {
  it('keeps idle workflow edges quiet on a dark canvas', () => {
    expect(resolveWorkflowEdgeVisualStyle({ isLight: false, active: false })).toEqual({
      stroke: 'rgba(255, 255, 255, 0.28)',
      strokeWidth: WORKFLOW_EDGE_IDLE_STROKE_WIDTH,
      opacity: 1,
      vectorEffect: 'non-scaling-stroke',
    })
    expect(WORKFLOW_EDGE_IDLE_STROKE_WIDTH).toBe(1.4)
  })

  it('raises emphasis only while the edge is active', () => {
    expect(resolveWorkflowEdgeVisualStyle({ isLight: true, active: true })).toEqual({
      stroke: 'rgba(17, 18, 21, 0.48)',
      strokeWidth: WORKFLOW_EDGE_ACTIVE_STROKE_WIDTH,
      opacity: 1,
      vectorEffect: 'non-scaling-stroke',
    })
    expect(WORKFLOW_EDGE_ACTIVE_STROKE_WIDTH).toBe(1.8)
  })

  it('projects the traversed execution path from source and target node facts', () => {
    expect(resolveWorkflowEdgeExecutionState(
      { workflowStatus: 'succeeded' },
      { workflowStatus: 'running' },
    )).toBe('running')
    expect(resolveWorkflowEdgeExecutionState(
      { workflowStatus: 'succeeded' },
      { workflowStatus: 'succeeded' },
    )).toBe('succeeded')
    expect(resolveWorkflowEdgeExecutionState(
      { workflowStatus: 'failed' },
      { workflowStatus: 'queued' },
    )).toBe('failed')
    expect(resolveWorkflowEdgeExecutionState(
      { workflowStatus: 'queued' },
      { workflowStatus: 'queued' },
    )).toBe('queued')
  })

  it('uses strong state colors and zoom-stable strokes for execution feedback', () => {
    expect(resolveWorkflowEdgeVisualStyle({
      isLight: false,
      active: false,
      executionState: 'running',
    })).toMatchObject({
      stroke: 'var(--tc-color-warning, #fbbf24)',
      strokeWidth: 2.4,
      strokeDasharray: '8 5',
      vectorEffect: 'non-scaling-stroke',
    })
    expect(resolveWorkflowEdgeVisualStyle({
      isLight: false,
      active: false,
      executionState: 'succeeded',
    })).toMatchObject({
      stroke: 'var(--tc-color-success, #34d399)',
      strokeWidth: 2.2,
      vectorEffect: 'non-scaling-stroke',
    })
  })
})
