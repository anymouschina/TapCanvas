import { describe, expect, it } from 'vitest'
import { buildWorkflowExecutionSnapshotGraph } from './workflowExecutionSnapshotGraph'
import type { WorkflowExecutionSnapshotDto, WorkflowNodeRunDto } from '../api/server'

function snapshot(data: unknown): WorkflowExecutionSnapshotDto {
  return {
    executionId: 'execution-1',
    flowId: 'flow-1',
    flowVersionId: 'version-1',
    name: '一键成片',
    createdAt: '2026-08-14T09:00:00.000Z',
    data,
  }
}

function run(partial: Partial<WorkflowNodeRunDto> & { nodeId: string }): WorkflowNodeRunDto {
  return {
    id: `run-${partial.nodeId}`,
    executionId: 'execution-1',
    status: 'success',
    attempt: 1,
    createdAt: '2026-08-14T09:00:01.000Z',
    ...partial,
  }
}

describe('buildWorkflowExecutionSnapshotGraph', () => {
  it('keeps the immutable snapshot positions and renders with canvas node/edge types', () => {
    const graph = buildWorkflowExecutionSnapshotGraph(snapshot({
      nodes: [
        { id: 'video', type: 'taskNode', position: { x: 120, y: 240 }, data: { label: '视频生成', kind: 'video' } },
        { id: 'io', type: 'ioNode', position: { x: 10, y: 10 }, data: { label: '入口', kind: 'io-in' } },
        { id: 'group', type: 'groupNode', position: { x: 0, y: 0 }, data: { label: '组' } },
      ],
      edges: [
        { id: 'e1', source: 'io', target: 'video', type: 'typed', sourceHandle: 'out-any', targetHandle: 'in-any' },
      ],
      viewport: { x: 18, y: 36, zoom: 0.8 },
    }), [run({ nodeId: 'video', status: 'waiting_external' })])

    expect(graph.nodes).toHaveLength(3)
    expect(graph.nodes[0]).toMatchObject({
      id: 'video',
      type: 'taskNode',
      position: { x: 120, y: 240 },
      draggable: false,
      connectable: false,
    })
    // 节点必须保持可点击（selectable 不显式关闭），否则 React Flow 会给节点加
    // pointer-events: none，快照画布里点节点就看不到运行结果/过程。
    expect(graph.nodes[0]?.selectable).not.toBe(false)
    expect(graph.nodes[1]).toMatchObject({ id: 'io', type: 'ioNode' })
    expect(graph.nodes[2]).toMatchObject({ id: 'group', type: 'groupNode' })
    expect(graph.edges[0]).toMatchObject({
      id: 'e1',
      source: 'io',
      target: 'video',
      type: 'typed',
      sourceHandle: 'out-any',
      targetHandle: 'in-any',
      animated: true,
    })
    expect(graph.viewport).toEqual({ x: 18, y: 36, zoom: 0.8 })
  })

  it('marks snapshot nodes readOnly and overlays the canvas task-node pill status', () => {
    const graph = buildWorkflowExecutionSnapshotGraph(snapshot({
      nodes: [{ id: 'video', position: { x: 120, y: 240 }, data: { label: '视频生成', kind: 'video' } }],
      edges: [],
    }), [
      run({ nodeId: 'video', status: 'waiting_external', startedAt: '2026-08-14T09:00:02.000Z' }),
    ])

    expect(graph.nodes[0]?.data).toMatchObject({
      label: '视频生成',
      readOnly: true,
      status: 'running',
      workflowStatus: 'waiting_external',
      workflowExecutionStartedAt: '2026-08-14T09:00:02.000Z',
    })
  })

  it('maps failed to the canvas error pill and success to no pill', () => {
    const graph = buildWorkflowExecutionSnapshotGraph(snapshot({
      nodes: [
        { id: 'failed-node', position: { x: 0, y: 0 }, data: { label: '失败', kind: 'image' } },
        { id: 'ok-node', position: { x: 200, y: 0 }, data: { label: '成功', kind: 'image' } },
      ],
      edges: [],
    }), [
      run({ nodeId: 'failed-node', status: 'failed' }),
      run({ nodeId: 'ok-node', status: 'success' }),
    ])

    expect(graph.nodes[0]?.data.status).toBe('error')
    expect(graph.nodes[1]?.data.status).toBeUndefined()
  })

  it('projects workflow node runs into workflowStatus like the live canvas', () => {
    const graph = buildWorkflowExecutionSnapshotGraph(snapshot({
      nodes: [
        { id: 'trigger', position: { x: 0, y: 0 }, data: { label: '入口', kind: 'workflowTrigger' } },
        { id: 'stage', position: { x: 200, y: 0 }, data: { label: '出图', kind: 'workflowStage' } },
      ],
      edges: [],
    }), [
      run({ nodeId: 'trigger', status: 'success' }),
      run({ nodeId: 'stage', status: 'canceled' }),
    ])

    expect(graph.nodes[0]?.data.workflowStatus).toBe('succeeded')
    expect(graph.nodes[0]?.data.status).toBeUndefined()
    expect(graph.nodes[1]?.data.workflowStatus).toBe('cancelled')
  })

  it('merges run output artifacts so workflow result previews render', () => {
    const graph = buildWorkflowExecutionSnapshotGraph(snapshot({
      nodes: [{ id: 'stage', position: { x: 0, y: 0 }, data: { label: '出图', kind: 'workflowStage' } }],
      edges: [],
    }), [run({
      nodeId: 'stage',
      status: 'success',
      outputRefs: {
        artifacts: [{ identity: 'asset-1', media: { kind: 'image', url: 'https://cdn/1.png' } }],
      },
    })])

    expect(graph.nodes[0]?.data.workflowOutputArtifacts).toEqual([
      { identity: 'asset-1', media: { kind: 'image', url: 'https://cdn/1.png' } },
    ])
  })

  it('preserves group nesting and drops edges dangling to missing nodes', () => {
    const graph = buildWorkflowExecutionSnapshotGraph(snapshot({
      nodes: [
        { id: 'group', type: 'groupNode', position: { x: 0, y: 0 }, data: { label: '组' } },
        { id: 'child', type: 'taskNode', parentId: 'group', position: { x: 30, y: 40 }, data: { label: '子节点' } },
      ],
      edges: [
        { id: 'valid', source: 'group', target: 'child' },
        { id: 'dangling', source: 'missing', target: 'child' },
      ],
    }), [])

    expect(graph.nodes[1]?.parentId).toBe('group')
    expect(graph.edges.map((edge) => edge.id)).toEqual(['valid'])
  })

  it('uses the shared Agent reference projection for historical Skill and knowledge evidence', () => {
    const graph = buildWorkflowExecutionSnapshotGraph(snapshot({
      nodes: [{
        id: 'agent-node',
        type: 'taskNode',
        position: { x: 400, y: 160 },
        data: {
          label: '编剧 Agent',
          kind: 'workflowStage',
          workflowKey: 'agent-workflow',
          workflowInstanceId: 'workflow-instance',
          workflowAtomicSpec: {
            category: 'agent',
            operation: 'agent_task',
            executorRef: 'agents.logical-task/v2',
          },
        },
      }],
      edges: [],
    }), [run({
      nodeId: 'agent-node',
      outputRefs: {
        executionProvenance: {
          version: 1,
          executionId: 'physical-agent-run-1',
          depth: 0,
          model: 'deepseek-v4-flash',
          apiStyle: 'chat',
          requiredSkills: ['tapcanvas-screenwriter'],
          loadedSkills: ['tapcanvas-screenwriter'],
          loadedKnowledgeSources: [{
            cardId: 'knowledge-card-1',
            title: '动作镜头节奏',
            domain: 'anime-action',
            facet: 'pacing',
            sourceUrls: ['https://knowledge.example.com/action-pacing'],
            contentHash: `sha256:${'b'.repeat(64)}`,
            contentChars: 860,
          }],
          startedAt: '2026-08-14T09:00:01.000Z',
        },
      },
    })])

    expect(graph.nodes).toHaveLength(3)
    expect(graph.nodes.find((node) => node.data.workflowRuntimeReferenceKind === 'skill')?.data)
      .toMatchObject({
			label: 'Skills · 已读 1',
        readOnly: true,
        workflowRuntimeReferenceActualReadCount: 1,
        workflowRuntimeReferenceItems: [{ name: 'tapcanvas-screenwriter' }],
      })
    expect(graph.nodes.find((node) => node.data.workflowRuntimeReferenceKind === 'knowledge')?.data)
      .toMatchObject({
			label: '知识库 · 已读 1',
        readOnly: true,
        workflowRuntimeReferenceActualReadCount: 1,
        workflowRuntimeReferenceItems: [{ name: '动作镜头节奏' }],
      })
    expect(graph.edges).toHaveLength(2)
    expect(graph.edges.every((edge) => edge.target === 'agent-node')).toBe(true)
    expect(graph.edges.every((edge) => edge.data?.executionRole === 'reference_only')).toBe(true)
    expect(graph.edges.every((edge) => edge.data?.readOnly === true)).toBe(true)
  })
})
