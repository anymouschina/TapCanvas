import { describe, expect, it } from 'vitest'
import {
  getPublicFlowTaskNodeCoreType,
  listPublicFlowNodeHandles,
} from './flow.node-protocol'

describe('Codex public flow node protocol', () => {
  const node = {
    type: 'taskNode',
    data: { kind: 'codex' },
  }

  it('uses the text core while accepting arbitrary canvas context input', () => {
    expect(getPublicFlowTaskNodeCoreType('codex')).toBe('text')
    expect(listPublicFlowNodeHandles(node, 'target')).toEqual([
      'in-any',
      'in-any-wide',
    ])
    expect(listPublicFlowNodeHandles(node, 'source')).toEqual([
      'out-text',
      'out-text-wide',
    ])
  })

  it('derives typed handles from the editable workflow protocol', () => {
    const workflowNode = {
      type: 'taskNode',
      data: {
        kind: 'workflowOutput',
        workflowAtomicSpec: {
          inputPorts: ['result', '审计 回执'],
          outputPorts: ['result'],
        },
      },
    }

    expect(listPublicFlowNodeHandles(workflowNode, 'target')).toEqual([
      'in-workflow:result',
      'in-workflow:%E5%AE%A1%E8%AE%A1%20%E5%9B%9E%E6%89%A7',
    ])
    expect(listPublicFlowNodeHandles(workflowNode, 'source')).toEqual([
      'out-workflow:result',
    ])
  })
})
