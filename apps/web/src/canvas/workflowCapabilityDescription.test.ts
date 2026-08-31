import { describe, expect, it } from 'vitest'
import type { Node } from '@xyflow/react'
import {
  buildWorkflowDescriptionContext,
  deriveWorkflowInvocationContract,
  parseWorkflowDescriptionResponse,
} from './workflowCapabilityDescription'

function sourceNode(sourceMode: 'inline_text' | 'canvas_group' | 'project_context'): Node {
  return {
    id: 'canvas-source',
    type: 'taskNode',
    position: { x: 0, y: 0 },
    data: {
      kind: 'workflowStage',
      label: '读取来源',
      workflowSourceMode: sourceMode,
      workflowAtomicSpec: {
        operation: 'canvas_read',
        executorRef: 'tapcanvas.canvas.group.read/v1',
      },
    },
  }
}

describe('workflow capability description', () => {
  it('derives inline source as a required per-run input', () => {
    expect(deriveWorkflowInvocationContract([sourceNode('inline_text')])).toEqual({
      sourceMode: 'inline_text',
      requiredTriggerPayloadFields: ['source'],
    })
  })

  it('derives caller canvas group binding as a required per-run input', () => {
    expect(deriveWorkflowInvocationContract([sourceNode('canvas_group')])).toEqual({
      sourceMode: 'canvas_group',
      requiredTriggerPayloadFields: ['sourceGroupId'],
    })
  })

	it('derives project context without requiring SmallT to invent a source group', () => {
		expect(deriveWorkflowInvocationContract([sourceNode('project_context')])).toEqual({
			sourceMode: 'project_context',
			requiredTriggerPayloadFields: [],
		})
	})

  it('builds AI context from factual workflow fields only', () => {
    const context = buildWorkflowDescriptionContext({
      name: '一键成片',
      nodes: [sourceNode('inline_text')],
      edges: [],
    })
    expect(context).toMatchObject({
      name: '一键成片',
      nodeCount: 1,
      invocation: { sourceMode: 'inline_text', requiredTriggerPayloadFields: ['source'] },
      stages: [{ label: '读取来源', operation: 'canvas_read' }],
    })
  })

  it('accepts only a non-empty structured description', () => {
    expect(parseWorkflowDescriptionResponse('{"description":"根据小T传入的本次源文本完成规划、素材生成、镜头装配并交付完整视频。"}'))
      .toBe('根据小T传入的本次源文本完成规划、素材生成、镜头装配并交付完整视频。')
    expect(() => parseWorkflowDescriptionResponse('not-json')).toThrow('不是合法 JSON')
    expect(() => parseWorkflowDescriptionResponse('{"description":""}')).toThrow('未返回有效内容')
  })
})
