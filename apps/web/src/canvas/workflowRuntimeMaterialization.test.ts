import { beforeEach, describe, expect, it } from 'vitest'
import { useRFStore } from './store'
import { materializeWorkflowTextItems, materializeWorkflowVideoItems } from './workflowRuntimeMaterialization'

describe('workflow runtime video materialization', () => {
  beforeEach(() => useRFStore.getState().reset())

  it('creates one editable connected video node per successful runtime item and is idempotent', () => {
    useRFStore.setState({
      nodes: [{
        id: 'video-template',
        type: 'taskNode',
        position: { x: 100, y: 120 },
        data: {
          kind: 'workflowStage',
          workflowItemRuns: [
            {
              itemId: 'segment-1',
              index: 0,
              status: 'success',
              runtimeNodeId: 'video-template::item::segment-1',
              ports: {},
              artifacts: [{ type: 'tapcanvas.video/v1', value: 'https://assets.example/video-1.mp4' }],
            },
            {
              itemId: 'segment-2',
              index: 1,
              status: 'success',
              runtimeNodeId: 'video-template::item::segment-2',
              ports: {},
              artifacts: [{ type: 'tapcanvas.video/v1', value: 'https://assets.example/video-2.mp4' }],
            },
          ],
        },
      }],
      edges: [],
    })

    expect(materializeWorkflowVideoItems('video-template')).toEqual({ created: 2, existing: 0, totalVideos: 2 })
    expect(useRFStore.getState().nodes.filter((node) => node.data.kind === 'video')).toHaveLength(2)
    expect(useRFStore.getState().edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'video-template', target: 'video-template:video:segment-1' }),
      expect.objectContaining({ source: 'video-template', target: 'video-template:video:segment-2' }),
    ]))
    expect(materializeWorkflowVideoItems('video-template')).toEqual({ created: 0, existing: 2, totalVideos: 2 })
  })

  it('links the provider-persisted canvas video node instead of duplicating its asset', () => {
    useRFStore.setState({
      nodes: [{
        id: 'video-template',
        type: 'taskNode',
        position: { x: 100, y: 120 },
        data: {
          kind: 'workflowStage',
          workflowItemRuns: [{
            itemId: 'segment-1',
            index: 0,
            status: 'success',
            runtimeNodeId: 'video-template::item::segment-1',
            ports: {},
            artifacts: [{ type: 'tapcanvas.video/v1', value: 'https://assets.example/video-1.mp4' }],
            evidence: { canvasNodeId: 'persisted-video-1' },
          }],
        },
      }, {
        id: 'persisted-video-1',
        type: 'taskNode',
        position: { x: 600, y: 120 },
        data: { kind: 'video', status: 'success', videoUrl: 'https://assets.example/video-1.mp4' },
      }],
      edges: [],
    })
    expect(materializeWorkflowVideoItems('video-template')).toEqual({ created: 0, existing: 1, totalVideos: 1 })
    expect(useRFStore.getState().nodes.filter((node) => node.data.kind === 'video')).toHaveLength(1)
    expect(useRFStore.getState().edges).toContainEqual(expect.objectContaining({ source: 'video-template', target: 'persisted-video-1' }))
  })

  it('creates one editable connected text node per dynamic Agent item and is idempotent', () => {
    useRFStore.setState({
      nodes: [{
        id: 'prompt-agent',
        type: 'taskNode',
        position: { x: 100, y: 120 },
        data: {
          kind: 'workflowStage',
          workflowExecutionId: 'execution-1',
          workflowItemRuns: [
            {
              itemId: 'clip-1',
              index: 0,
              status: 'success',
              runtimeNodeId: 'prompt-agent::item::clip-1',
              ports: { result: { text: '第一段 15 秒视频提示词' } },
              artifacts: [{ type: 'tapcanvas.video-prompt/v1', value: '第一段 15 秒视频提示词' }],
            },
            {
              itemId: 'clip-2',
              index: 1,
              status: 'success',
              runtimeNodeId: 'prompt-agent::item::clip-2',
              ports: { result: { text: '第二段 15 秒视频提示词' } },
              artifacts: [{ type: 'tapcanvas.video-prompt/v1', value: '第二段 15 秒视频提示词' }],
            },
          ],
        },
      }],
      edges: [],
    })

    expect(materializeWorkflowTextItems('prompt-agent')).toEqual({ created: 2, existing: 0, totalTexts: 2 })
    expect(useRFStore.getState().nodes.filter((node) => node.data.kind === 'text')).toEqual([
      expect.objectContaining({ data: expect.objectContaining({ prompt: '第一段 15 秒视频提示词', workflowMaterializedFromExecutionId: 'execution-1' }) }),
      expect.objectContaining({ data: expect.objectContaining({ prompt: '第二段 15 秒视频提示词', workflowMaterializedFromExecutionId: 'execution-1' }) }),
    ])
    expect(useRFStore.getState().edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'prompt-agent', target: 'prompt-agent:text:execution-1:clip-1' }),
      expect.objectContaining({ source: 'prompt-agent', target: 'prompt-agent:text:execution-1:clip-2' }),
    ]))
    expect(materializeWorkflowTextItems('prompt-agent')).toEqual({ created: 0, existing: 2, totalTexts: 2 })

    useRFStore.getState().updateNodeData('prompt-agent', {
      workflowExecutionId: 'execution-2',
      workflowItemRuns: [{
        itemId: 'clip-1',
        index: 0,
        status: 'success',
        runtimeNodeId: 'prompt-agent::item::clip-1',
        ports: { result: { text: '第二次运行的第一段提示词' } },
        artifacts: [{ type: 'tapcanvas.video-prompt/v1', value: '第二次运行的第一段提示词' }],
      }],
    })
    expect(materializeWorkflowTextItems('prompt-agent')).toEqual({ created: 1, existing: 0, totalTexts: 1 })
    expect(useRFStore.getState().nodes.find((node) => node.id === 'prompt-agent:text:execution-2:clip-1')?.data).toMatchObject({
      prompt: '第二次运行的第一段提示词',
      workflowMaterializedFromExecutionId: 'execution-2',
    })
  })
})
