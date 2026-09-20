// @vitest-environment jsdom
import React from 'react'
import '@testing-library/jest-dom/vitest'
import { MantineProvider } from '@mantine/core'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
  MiniMap: () => null,
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
    vi.spyOn(apiServer, 'getWorkflowExecutionFamily').mockRejectedValue(new Error('执行族读取失败'))
    vi.spyOn(apiServer, 'getWorkflowEventHistory').mockResolvedValue({ items: [], nextCursor: 0 })
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

  it.each(['项目画布', '执行族', '耗时瀑布', '原始快照'])('preserves %s across polling, and resets for another execution', async (tabName) => {
    const snapshot = await apiServer.getWorkflowExecutionSnapshot('execution-1')
    vi.mocked(apiServer.getWorkflowExecutionSnapshot).mockResolvedValue({ ...snapshot, canvasData: snapshot.data })
    vi.mocked(apiServer.listWorkflowNodeRuns).mockResolvedValue([{
      id: 'run-1', executionId: 'execution-1', nodeId: 'asset-fan-out',
      status: 'running', attempt: 1, createdAt: '2026-09-08T03:00:00.000Z',
    }])
    vi.spyOn(apiServer, 'streamWorkflowExecutionEvents').mockImplementation(async (_executionId, options) => {
      await new Promise<void>((resolve) => options.signal?.addEventListener('abort', () => resolve(), { once: true }))
    })
    const interval = vi.spyOn(window, 'setInterval')
    const { rerender } = render(
      <MantineProvider>
        <WorkflowExecutionSnapshotModal opened executionId="execution-1" onClose={vi.fn()} />
      </MantineProvider>,
    )
    fireEvent.click(await screen.findByRole('tab', { name: tabName }))
    await waitFor(() => expect(interval).toHaveBeenCalledWith(expect.any(Function), 5_000))
    const poll = interval.mock.calls.find((call) => call[1] === 5_000)?.[0]
    if (typeof poll !== 'function') throw new Error('Missing snapshot refresh interval')
    for (let refresh = 0; refresh < 2; refresh += 1) {
      await act(async () => { poll() })
      expect(screen.getByRole('tab', { name: tabName })).toHaveAttribute('aria-selected', 'true')
    }

    rerender(
      <MantineProvider>
        <WorkflowExecutionSnapshotModal opened executionId="execution-2" onClose={vi.fn()} />
      </MantineProvider>,
    )
    await waitFor(() => expect(screen.getByRole('tab', { name: '执行图' })).toHaveAttribute('aria-selected', 'true'))
  })

  it('opens the workflow DAG by default and keeps the frozen caller project canvas in a separate tab', async () => {
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

    expect(await screen.findByRole('button', { name: '打开节点 internal-stage' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '打开节点 project-image' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: '项目画布' }))
    expect(await screen.findByRole('button', { name: '打开节点 project-image' })).toBeInTheDocument()
  })
})
