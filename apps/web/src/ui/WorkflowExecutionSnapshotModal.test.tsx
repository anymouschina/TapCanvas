// @vitest-environment jsdom
import React from 'react'
import '@testing-library/jest-dom/vitest'
import { MantineProvider } from '@mantine/core'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as apiServer from '../api/server'
import { WorkflowExecutionSnapshotModal } from './WorkflowExecutionSnapshotModal'

if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia
}

type MockFlowNode = Readonly<{ id: string }>

type MockReactFlowProps = Readonly<{
  children?: React.ReactNode
  elementsSelectable?: boolean
  nodes: MockFlowNode[]
  onNodeClick?: (event: React.MouseEvent<HTMLButtonElement>, node: MockFlowNode) => void
  onPaneClick?: () => void
}>

vi.mock('@xyflow/react', () => ({
  Background: () => null,
  Controls: () => null,
  Position: { Left: 'left', Right: 'right', Top: 'top', Bottom: 'bottom' },
  ReactFlowProvider: (props: Readonly<{ children?: React.ReactNode }>) => props.children ?? null,
  ReactFlow: (props: MockReactFlowProps) => (
    <div
      className="workflow-snapshot-flow-test-projection"
      data-elements-selectable={String(props.elementsSelectable)}
    >
      {props.nodes.map((node) => (
        <button
          className="workflow-snapshot-flow-test-node"
          type="button"
          key={node.id}
          onClick={(event) => props.onNodeClick?.(event, node)}
        >
          打开节点 {node.id}
        </button>
      ))}
      <button
        className="workflow-snapshot-flow-test-pane"
        type="button"
        onClick={() => props.onPaneClick?.()}
      >
        点击画布空白
      </button>
      {props.children}
    </div>
  ),
}))

vi.mock('../canvas/nodes/TaskNodeCard', () => ({
  default: () => null,
  TaskNodeSkeleton: () => null,
}))
vi.mock('../canvas/nodes/IONode', () => ({ default: () => null }))
vi.mock('../canvas/nodes/GroupNode', () => ({ default: () => null }))
vi.mock('../canvas/nodes/directorConsole/DirectorConsoleNode', () => ({ DirectorConsoleNode: () => null }))
vi.mock('../canvas/nodes/WorkflowExecutionPlaceholderNode', () => ({ WorkflowExecutionPlaceholderNode: () => null }))
vi.mock('../canvas/edges/TypedEdge', () => ({ default: () => null }))
vi.mock('../canvas/edges/OrthTypedEdge', () => ({ default: () => null }))
vi.mock('./SnapshotNodeRunDetail', () => ({
  SnapshotNodeRunDetail: (props: Readonly<{ node: MockFlowNode; onClose: () => void }>) => (
    <aside className="workflow-snapshot-detail-test-projection" aria-label="节点运行结果与过程">
      <span className="workflow-snapshot-detail-test-node-id">节点详情 {props.node.id}</span>
      <button className="workflow-snapshot-detail-test-close" type="button" onClick={props.onClose}>
        关闭节点详情
      </button>
    </aside>
  ),
}))

describe('WorkflowExecutionSnapshotModal', () => {
  beforeEach(() => {
    vi.spyOn(apiServer, 'getWorkflowExecutionSnapshot').mockResolvedValue({
      executionId: 'execution-1',
      flowId: 'flow-1',
      flowVersionId: 'workflow-version-1',
      name: '一键成片工作流',
      createdAt: '2026-08-18T07:34:50.000Z',
      data: {
        nodes: [{
          id: 'asset-fan-out',
          type: 'taskNode',
          position: { x: 0, y: 0 },
          data: { label: '逐资产展开', kind: 'workflowStage' },
        }],
        edges: [],
      },
    })
    vi.spyOn(apiServer, 'listWorkflowNodeRuns').mockResolvedValue([])
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('closes the detail without selection-state reopening and can open the same node again', async () => {
    render(
      <MantineProvider>
        <WorkflowExecutionSnapshotModal
          opened
          executionId="execution-1"
          onClose={vi.fn()}
        />
      </MantineProvider>,
    )

    const nodeButton = await screen.findByRole('button', { name: '打开节点 asset-fan-out' })
    const flow = nodeButton.closest('.workflow-snapshot-flow-test-projection')
    expect(flow).toHaveAttribute('data-elements-selectable', 'false')

    fireEvent.click(nodeButton)
    expect(screen.getByRole('complementary', { name: '节点运行结果与过程' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '关闭节点详情' }))
    await waitFor(() => {
      expect(screen.queryByRole('complementary', { name: '节点运行结果与过程' })).not.toBeInTheDocument()
    })

    fireEvent.click(nodeButton)
    expect(screen.getByText('节点详情 asset-fan-out')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '点击画布空白' }))
    await waitFor(() => {
      expect(screen.queryByRole('complementary', { name: '节点运行结果与过程' })).not.toBeInTheDocument()
    })
  })

  it('opens the frozen caller project canvas by default and keeps the workflow DAG in a separate tab', async () => {
    vi.mocked(apiServer.getWorkflowExecutionSnapshot).mockResolvedValueOnce({
      executionId: 'execution-1',
      flowId: 'flow-1',
      flowVersionId: 'workflow-version-1',
      name: '一键成片工作流',
      createdAt: '2026-08-18T07:34:50.000Z',
      data: {
        nodes: [{ id: 'internal-stage', type: 'taskNode', position: { x: 0, y: 0 }, data: { label: '内部阶段' } }],
        edges: [],
      },
      canvasData: {
        nodes: [{ id: 'project-image', type: 'taskNode', position: { x: 640, y: 480 }, data: { label: '项目图片', kind: 'image' } }],
        edges: [],
      },
    })

    render(
      <MantineProvider>
        <WorkflowExecutionSnapshotModal opened executionId="execution-1" onClose={vi.fn()} />
      </MantineProvider>,
    )

    expect(await screen.findByRole('button', { name: '打开节点 project-image' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '打开节点 internal-stage' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: '执行图' }))
    expect(await screen.findByRole('button', { name: '打开节点 internal-stage' })).toBeInTheDocument()
  })
})
