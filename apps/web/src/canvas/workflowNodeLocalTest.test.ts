import { beforeEach, describe, expect, it } from 'vitest'
import { isWorkflowCollection } from '@tapcanvas/workflow-kernel-protocol'
import { useRFStore } from './store'
import { executeWorkflowNodeLocalTest, supportsWorkflowNodeLocalTest } from './workflowNodeLocalTest'

describe('workflow node deterministic local preview', () => {
  beforeEach(() => {
    useRFStore.getState().reset()
  })

  it('previews the exact persisted text without inventing workflow data', async () => {
    const data = {
      workflowAtomicSpec: { operation: 'text_input' },
      workflowTextInput: '章节正文',
    }
    const result = await executeWorkflowNodeLocalTest({ nodeId: 'text', data })

    expect(result.output).toEqual({ text: '章节正文' })
    expect(result.evidence).toEqual({
      executorCompleted: true,
      localPreview: true,
      characterCount: 4,
    })
  })

  it('turns an exact upstream array into a lineage-bearing workflow collection', async () => {
    useRFStore.setState({
      nodes: [
        {
          id: 'planner',
          type: 'taskNode',
          position: { x: 0, y: 0 },
          data: {
            workflowLocalTestOutput: {
              result: [
                { clipId: 'clip-1', text: '第一段' },
                { clipId: 'clip-2', text: '第二段' },
              ],
            },
          },
        },
        {
          id: 'split',
          type: 'taskNode',
          position: { x: 320, y: 0 },
          data: {},
        },
      ],
      edges: [{
        id: 'planner-to-split',
        source: 'planner',
        sourceHandle: 'out-workflow:result',
        target: 'split',
        targetHandle: 'in-workflow:value',
      }],
    })
    const result = await executeWorkflowNodeLocalTest({
      nodeId: 'split',
      data: {
        workflowAtomicSpec: { operation: 'collection_split' },
        workflowCollectionPath: '',
        workflowCollectionParseJson: false,
        workflowCollectionItemIdField: 'clipId',
      },
    })
    const output = result.output as Readonly<Record<string, unknown>>

    expect(isWorkflowCollection(output.items)).toBe(true)
    if (!isWorkflowCollection(output.items)) throw new Error('Expected a workflow collection')
    expect(output.items.items).toHaveLength(2)
    expect(output.items.items.map((item) => item.itemId)).toEqual(['clip-1', 'clip-2'])
    expect(output.items.items[1]?.value).toEqual({ clipId: 'clip-2', text: '第二段' })
    expect(result.evidence).toMatchObject({ itemCount: 2, localPreview: true })
  })

  it('rejects persistent executors instead of fabricating a local success', async () => {
    expect(supportsWorkflowNodeLocalTest('agent_task')).toBe(false)
    await expect(executeWorkflowNodeLocalTest({
      nodeId: 'agent',
      data: { workflowAtomicSpec: { operation: 'agent_task' } },
    })).rejects.toThrow('请从触发器运行工作流')
  })
})
