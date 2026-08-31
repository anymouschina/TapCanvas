import { Position } from '@xyflow/react'
import { describe, expect, it } from 'vitest'
import { buildWorkflowAgentReferenceHandles } from './workflowAgentReferenceHandles'

describe('workflow agent reference handles', () => {
  it('exposes the matching source handle on a Skill reference node', () => {
    expect(buildWorkflowAgentReferenceHandles({
      workflowRuntimeReference: true,
      workflowRuntimeReferenceKind: 'skill',
    })).toEqual({
      targets: [],
      sources: [{
        id: 'out-workflow-reference:skill',
        type: 'workflow-reference',
        pos: Position.Top,
        label: 'Skills 挂载',
      }],
    })
  })

  it('exposes both attachment targets on an Agent node', () => {
    const result = buildWorkflowAgentReferenceHandles({
      adminWorkflow: true,
      workflowNodeKind: 'clip_writer',
    })

    expect(result.sources).toEqual([])
    expect(result.targets.map((handle) => handle.id)).toEqual([
      'in-workflow-reference:skill',
      'in-workflow-reference:knowledge',
    ])
    expect(result.targets.every((handle) => handle.pos === Position.Bottom)).toBe(true)
  })

  it('does not add reference ports to ordinary workflow nodes', () => {
    expect(buildWorkflowAgentReferenceHandles({
      adminWorkflow: true,
      workflowNodeKind: 'media_generate',
    })).toEqual({ targets: [], sources: [] })
  })
})
