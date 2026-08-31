// @vitest-environment jsdom
import React from 'react'
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkflowNodeSkeleton } from './WorkflowNodeSkeleton'

vi.mock('../../../../domain/resource-runtime', () => ({
  ManagedImage: (props: Readonly<{ className: string; src: string; alt: string }>) => (
    <div className={props.className}>
      <img className="workflow-node-skeleton-test__managed-image" src={props.src} alt={props.alt} />
    </div>
  ),
}))

describe('WorkflowNodeSkeleton', () => {
  afterEach(() => cleanup())

  it('renders an image result through ManagedImage when result display is selected', () => {
    const { container } = render(
      <WorkflowNodeSkeleton
        nodeId="image-node"
        label="图片生成"
        overview={false}
        data={{
          workflowAtomicSpec: { category: 'media', operation: 'image_generate' },
          workflowCanvasDisplayMode: 'result',
          workflowOutputArtifacts: [{
            type: 'tapcanvas.image/v1',
            identity: 'image-1',
            value: 'https://cdn.example.com/image-1.webp',
          }],
        }}
      />,
    )

    expect(container.querySelector('[data-workflow-display="result"]')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: '图片生成输出结果' })).toHaveAttribute(
      'src',
      'https://cdn.example.com/image-1.webp',
    )
  })

  it('renders the real video URL with canvas-safe native controls', () => {
    const { container } = render(
      <WorkflowNodeSkeleton
        nodeId="video-node"
        label="视频生成"
        overview={false}
        data={{
          workflowAtomicSpec: { category: 'media', operation: 'video_generate' },
          workflowCanvasDisplayMode: 'result',
          workflowOutputArtifacts: [{
            type: 'tapcanvas.video/v1',
            identity: 'video-1',
            value: 'https://cdn.example.com/video-1.mp4',
          }],
        }}
      />,
    )

    const video = screen.getByLabelText('视频生成输出视频')
    expect(video).toHaveAttribute('src', 'https://cdn.example.com/video-1.mp4')
    expect(video).toHaveAttribute('controls')
    expect(container.querySelector('.tc-workflow-node-shell__preview-frame')).toBeInTheDocument()
  })

  it('keeps ordinary workflow nodes in compact icon mode', () => {
    const { container } = render(
      <WorkflowNodeSkeleton
        nodeId="agent-node"
        label="Agent"
        overview={false}
        data={{ workflowAtomicSpec: { category: 'agent', operation: 'agent_execute' } }}
      />,
    )

    expect(container.querySelector('[data-workflow-display="icon"]')).toBeInTheDocument()
    expect(container.querySelector('.tc-workflow-node-shell__preview-frame')).not.toBeInTheDocument()
  })

  it('renders a configured online icon through ManagedImage', () => {
    const { container } = render(
      <WorkflowNodeSkeleton
        nodeId="custom-icon-node"
        label="自定义图标节点"
        overview={false}
        data={{
          workflowIconUrl: 'https://cdn.example.com/workflow/custom-icon.png',
          workflowAtomicSpec: { category: 'tool', operation: 'estimate' },
        }}
      />,
    )

    expect(container.querySelector('.workflow-node-glyph--remote')).toBeInTheDocument()
    expect(container.querySelector('.workflow-node-skeleton-test__managed-image')).toHaveAttribute(
      'src',
      'https://cdn.example.com/workflow/custom-icon.png',
    )
  })

  it('shows the persisted node execution duration on the compact canvas node', () => {
    render(
      <WorkflowNodeSkeleton
        nodeId="finished-agent"
        label="BeatSheet Agent"
        overview={false}
        data={{
          workflowStatus: 'succeeded',
          workflowExecutionStartedAt: '2026-08-14T09:05:05.000Z',
          workflowExecutionFinishedAt: '2026-08-14T09:07:08.000Z',
          workflowAtomicSpec: { category: 'agent', operation: 'agent_task' },
        }}
      />,
    )

    expect(screen.getByLabelText('用时 2分03秒')).toHaveTextContent('2:03')
  })

  it('makes the current running node visible as a whole-node execution state', () => {
    const { container } = render(
      <WorkflowNodeSkeleton
        nodeId="running-agent"
        label="逐镜提示词 Agent"
        overview={false}
        data={{
          workflowStatus: 'running',
          workflowExecutionStartedAt: new Date(Date.now() - 12_000).toISOString(),
          workflowAtomicSpec: { category: 'agent', operation: 'agent_task' },
        }}
      />,
    )

    expect(container.querySelector('[data-workflow-status="running"]')).toBeInTheDocument()
    expect(container.querySelector('.tc-workflow-node-shell__execution-label--running'))
      .toHaveTextContent('执行中')
    expect(container.querySelector('.tc-workflow-node-shell__status--running')).toBeInTheDocument()
  })

  it('shows the structured balance wait directly on the canvas node', () => {
    const { container } = render(
      <WorkflowNodeSkeleton
        nodeId="waiting-agent"
        label="BeatSheet Agent"
        overview={false}
        data={{
          workflowStatus: 'waiting_external',
          workflowWaitingReasonLabel: '等待余额恢复',
          workflowExecutionStartedAt: new Date(Date.now() - 12_000).toISOString(),
          workflowAtomicSpec: { category: 'agent', operation: 'agent_task' },
        }}
      />,
    )

    expect(container.querySelector('.tc-workflow-node-shell__execution-label--waiting_external'))
      .toHaveTextContent('等待余额恢复')
  })

  it('shows the names of actually read Skills directly on the aggregate node', () => {
    render(
      <WorkflowNodeSkeleton
        nodeId="agent-skills"
        label="Skills · 2"
        overview={true}
        data={{
          workflowRuntimeReference: true,
          workflowRuntimeReferenceAggregate: true,
          workflowRuntimeReferenceKind: 'skill',
          workflowRuntimeReferenceCount: 2,
          workflowRuntimeReferenceActualReadCount: 2,
          workflowRuntimeReferenceItems: [
            { name: '动作连续性', enabled: true, evidenceState: 'actual_read' },
            { name: '镜头动势', enabled: true, evidenceState: 'actual_read' },
          ],
          workflowStatus: 'succeeded',
          workflowAtomicSpec: { category: 'skill', operation: 'skill_reference' },
        }}
      />,
    )

    expect(screen.getByText('本轮实际读取 2 · 动作连续性 +1')).toBeInTheDocument()
  })

  it('distinguishes universal catalog access from zero actual reads', () => {
    render(
      <WorkflowNodeSkeleton
        nodeId="agent-knowledge"
        label="知识库 · 全库"
        overview={true}
        data={{
          workflowRuntimeReference: true,
          workflowRuntimeReferenceAggregate: true,
          workflowRuntimeReferenceKind: 'knowledge',
          workflowRuntimeReferenceCount: 0,
          workflowRuntimeReferenceActualReadCount: 0,
          workflowRuntimeReferenceItems: [],
          workflowStatus: 'idle',
          workflowAtomicSpec: { category: 'tool', operation: 'knowledge_reference' },
        }}
      />,
    )

    expect(screen.getByText('全库可检索 · 本轮未读取')).toBeInTheDocument()
    expect(screen.getByText('全')).toBeInTheDocument()
  })
})
