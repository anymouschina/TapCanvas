// @vitest-environment jsdom
import React from 'react'
import '@testing-library/jest-dom/vitest'
import { MantineProvider } from '@mantine/core'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { listWorkflowNodeRunHistory } from '../../api/server'
import { useRFStore } from '../store'
import { WorkflowNodeHistorySection } from './WorkflowNodeHistorySection'

vi.mock('../../api/server', () => ({
  fetchAdminVideoAtomicNodeRunHistory: vi.fn(),
  listWorkflowNodeRunHistory: vi.fn(),
}))

const mockedListWorkflowNodeRunHistory = vi.mocked(listWorkflowNodeRunHistory)

describe('WorkflowNodeHistorySection', () => {
  afterEach(() => cleanup())

  beforeEach(() => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({
      matches: false,
      media: '',
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
    useRFStore.getState().reset()
    useRFStore.setState({
      nodes: [{
        id: 'workflow:video',
        type: 'taskNode',
        position: { x: 100, y: 120 },
        data: { kind: 'workflowStage' },
      }],
      edges: [],
    })
    mockedListWorkflowNodeRunHistory.mockResolvedValue([{
      id: 'node-run-1',
      executionId: 'execution-1',
      nodeId: 'workflow:video',
      status: 'success',
      executionStatus: 'success',
      attempt: 1,
      createdAt: '2026-08-11T08:00:01.000Z',
      executionCreatedAt: '2026-08-11T08:00:00.000Z',
      executionFinishedAt: '2026-08-11T08:01:00.000Z',
      outputRefs: {
        evidence: { completedItems: 2, settledItems: 2, totalItems: 36 },
        itemRuns: [
          {
            itemId: 'segment-1',
            index: 0,
            runtimeNodeId: 'workflow:video::item::segment-1',
            status: 'success',
            ports: { videoUrl: 'https://assets.example/1.mp4' },
            artifacts: [{ type: 'tapcanvas.video/v1', value: 'https://assets.example/1.mp4' }],
          },
          {
            itemId: 'segment-2',
            index: 1,
            runtimeNodeId: 'workflow:video::item::segment-2',
            status: 'success',
            ports: { videoUrl: 'https://assets.example/2.mp4' },
            artifacts: [{ type: 'tapcanvas.video/v1', value: 'https://assets.example/2.mp4' }],
          },
        ],
      },
    }])
  })

  it('materializes both historical videos as editable connected canvas nodes in one action', async () => {
    render(
      <MantineProvider>
        <WorkflowNodeHistorySection flowId="flow-1" nodeId="workflow:video" readOnly={false} />
      </MantineProvider>,
    )

    fireEvent.click(await screen.findByRole('button', { name: '铺开本次 2 个视频节点' }))

    const state = useRFStore.getState()
    expect(state.nodes.filter((node) => node.data.kind === 'video')).toHaveLength(2)
    expect(state.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'workflow:video', target: 'workflow:video:video:segment-1' }),
      expect.objectContaining({ source: 'workflow:video', target: 'workflow:video:video:segment-2' }),
    ]))
  })

  it('shows durable collection progress against the full item total', async () => {
    render(
      <MantineProvider>
        <WorkflowNodeHistorySection flowId="flow-1" nodeId="workflow:video" readOnly={false} />
      </MantineProvider>,
    )

    expect(await screen.findByText(/2\/36 项/u)).toBeInTheDocument()
  })

  it('keeps successful item output collapsed until the user opens that item', async () => {
    render(
      <MantineProvider>
        <WorkflowNodeHistorySection flowId="flow-1" nodeId="workflow:video" readOnly={false} />
      </MantineProvider>,
    )

    const itemList = await screen.findByRole('list', { name: /逐项运行输出/u })
    const details = itemList.querySelectorAll('details')
    expect(details).toHaveLength(2)
    expect(details[0]).not.toHaveAttribute('open')
    expect(details[1]).not.toHaveAttribute('open')
    fireEvent.click(details[0]?.querySelector('summary') as HTMLElement)
    expect(details[0]).toHaveAttribute('open')
  })

  it('materializes every historical Agent prompt as an editable connected text node', async () => {
    mockedListWorkflowNodeRunHistory.mockResolvedValueOnce([{
      id: 'node-run-text',
      executionId: 'execution-text',
      nodeId: 'workflow:video',
      status: 'success',
      executionStatus: 'success',
      attempt: 1,
      createdAt: '2026-08-11T09:00:01.000Z',
      executionCreatedAt: '2026-08-11T09:00:00.000Z',
      executionFinishedAt: '2026-08-11T09:01:00.000Z',
      outputRefs: {
        itemRuns: [
          {
            itemId: 'clip-1',
            index: 0,
            runtimeNodeId: 'workflow:video::item::clip-1',
            status: 'success',
            ports: { result: { text: '第一条 15 秒视频提示词' } },
            artifacts: [{ type: 'tapcanvas.video-prompt/v1', value: '第一条 15 秒视频提示词' }],
          },
          {
            itemId: 'clip-2',
            index: 1,
            runtimeNodeId: 'workflow:video::item::clip-2',
            status: 'success',
            ports: { result: { text: '第二条 15 秒视频提示词' } },
            artifacts: [{ type: 'tapcanvas.video-prompt/v1', value: '第二条 15 秒视频提示词' }],
          },
        ],
      },
    }])
    render(
      <MantineProvider>
        <WorkflowNodeHistorySection flowId="flow-1" nodeId="workflow:video" readOnly={false} />
      </MantineProvider>,
    )

    fireEvent.click(await screen.findByRole('button', { name: '铺开本次 2 个文本节点' }))

    const textNodes = useRFStore.getState().nodes.filter((node) => node.data.kind === 'text')
    expect(textNodes.map((node) => node.data.prompt)).toEqual([
      '第一条 15 秒视频提示词',
      '第二条 15 秒视频提示词',
    ])
    expect(useRFStore.getState().edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'workflow:video', target: 'workflow:video:text:execution-text:clip-1' }),
      expect.objectContaining({ source: 'workflow:video', target: 'workflow:video:text:execution-text:clip-2' }),
    ]))
  })

  it('shows the persisted ports for a non-collection node run', async () => {
    mockedListWorkflowNodeRunHistory.mockResolvedValueOnce([{
      id: 'node-run-once',
      executionId: 'execution-once',
      nodeId: 'workflow:video',
      status: 'success',
      executionStatus: 'success',
      attempt: 1,
      createdAt: '2026-08-11T10:00:01.000Z',
      executionCreatedAt: '2026-08-11T10:00:00.000Z',
      outputRefs: {
        ports: { result: { paragraphCount: 53 } },
        evidence: { executorCompleted: true },
        artifacts: [],
        itemRuns: [],
      },
    }])
    render(
      <MantineProvider>
        <WorkflowNodeHistorySection flowId="flow-1" nodeId="workflow:video" readOnly={false} />
      </MantineProvider>,
    )

    expect(await screen.findByText(/"paragraphCount": 53/u)).toBeInTheDocument()
  })

  it('pins only a successful durable output identity and can remove the pin', async () => {
    mockedListWorkflowNodeRunHistory.mockResolvedValueOnce([{
      id: 'node-run-pinnable',
      executionId: 'execution-pinnable',
      nodeId: 'workflow:video',
      status: 'success',
      executionStatus: 'success',
      attempt: 1,
      createdAt: '2026-08-11T11:00:01.000Z',
      executionCreatedAt: '2026-08-11T11:00:00.000Z',
      executionFinishedAt: '2026-08-11T11:01:00.000Z',
      outputRefs: {
        protocolVersion: '1',
        executorRef: 'agents.logical-task/v2',
        nodeId: 'workflow:video',
        executionMode: 'once',
        ports: { result: '真实持久输出' },
        evidence: { executorCompleted: true },
        artifacts: [],
        itemRuns: [],
      },
    }])
    const { rerender } = render(
      <MantineProvider>
        <WorkflowNodeHistorySection flowId="flow-1" nodeId="workflow:video" readOnly={false} data={{}} />
      </MantineProvider>,
    )

    fireEvent.click(await screen.findByRole('button', { name: '固定为测试数据' }))
    expect(useRFStore.getState().nodes[0]?.data.workflowPinnedOutputSource).toEqual({
      version: 1,
      sourceExecutionId: 'execution-pinnable',
      sourceNodeRunId: 'node-run-pinnable',
    })

    rerender(
      <MantineProvider>
        <WorkflowNodeHistorySection
          flowId="flow-1"
          nodeId="workflow:video"
          readOnly={false}
          data={{ workflowPinnedOutputSource: useRFStore.getState().nodes[0]?.data.workflowPinnedOutputSource }}
        />
      </MantineProvider>,
    )
    fireEvent.click(await screen.findByRole('button', { name: '取消固定输出' }))
    expect(useRFStore.getState().nodes[0]?.data.workflowPinnedOutputSource).toBeUndefined()
  })
})
