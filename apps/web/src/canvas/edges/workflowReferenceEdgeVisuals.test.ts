import { describe, expect, it } from 'vitest'
import {
  resolveWorkflowReferenceEdgeStyle,
  resolveWorkflowReferenceVisualState,
} from './workflowReferenceEdgeVisuals'

describe('workflow reference edge visuals', () => {
  it('keeps universally available Skill access visible as a violet dashed relation', () => {
    const visualState = resolveWorkflowReferenceVisualState({
      actualReadCount: 0,
      referenceState: 'available',
      targetExecutionState: 'idle',
    })

    expect(visualState).toBe('available')
    expect(resolveWorkflowReferenceEdgeStyle({
      kind: 'skill',
      referenceState: 'available',
      visualState,
    })).toMatchObject({
      stroke: 'var(--tc-color-violet-4, #a78bfa)',
      strokeDasharray: '6 5',
      opacity: 0.9,
    })
  })

  it('uses cyan for knowledge and highlights a real read without a dash pattern', () => {
    const idleStyle = resolveWorkflowReferenceEdgeStyle({
      kind: 'knowledge',
      referenceState: 'available',
      visualState: 'available',
    })
    const actualStyle = resolveWorkflowReferenceEdgeStyle({
      kind: 'knowledge',
      referenceState: 'available',
      visualState: resolveWorkflowReferenceVisualState({
        actualReadCount: 2,
        referenceState: 'available',
        targetExecutionState: 'success',
      }),
    })

    expect(idleStyle.stroke).toBe('var(--tc-color-cyan-4, #38bdf8)')
    expect(actualStyle).toMatchObject({
      stroke: 'var(--tc-color-success, #34d399)',
      strokeDasharray: undefined,
      opacity: 1,
    })
  })
})
