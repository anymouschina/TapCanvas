// @vitest-environment jsdom
import React from 'react'
import '@testing-library/jest-dom/vitest'
import { MantineProvider } from '@mantine/core'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as apiServer from '../api/server'
import HistoryPanel from './HistoryPanel'
import { useUIStore } from './uiStore'

vi.mock('./WorkflowExecutionSnapshotModal', () => ({
  WorkflowExecutionSnapshotModal: (props: Readonly<{ opened: boolean; executionId: string | null }>) => props.opened
    ? <div className="snapshot-modal-test-projection">snapshot:{props.executionId}</div>
    : null,
}))

vi.mock('@mantine/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@mantine/core')>()
  return {
    ...actual,
    SegmentedControl: (props: Readonly<{
      className?: string
      data: ReadonlyArray<Readonly<{ value: string; label: string; disabled?: boolean }>>
      onChange: (value: string) => void
    }>) => <div className={props.className ?? 'segmented-control-test-projection'}>
      {props.data.map((item) => (
        <button
          className="segmented-control-test-button"
          type="button"
          key={item.value}
          disabled={item.disabled}
          onClick={() => props.onChange(item.value)}
        >
          {item.label}
        </button>
      ))}
    </div>,
    ScrollArea: (props: Readonly<{ children?: React.ReactNode }>) => (
      <div className="scroll-area-test-projection">{props.children ?? null}</div>
    ),
  }
})

const failedExecution: apiServer.WorkflowExecutionDto = {
  id: 'execution-1',
  flowId: 'flow-1',
  flowName: '一键成片工作流',
  flowVersionId: 'version-1',
  ownerId: 'owner-1',
  status: 'failed',
  concurrency: 1,
  trigger: 'manual',
  errorMessage: '供应商拒绝任务',
  createdAt: '2026-08-14T09:00:00.000Z',
  startedAt: '2026-08-14T09:00:01.000Z',
  finishedAt: '2026-08-14T09:00:06.000Z',
  nodeSummary: {
    total: 3,
    queued: 1,
    running: 0,
    waitingExternal: 0,
    success: 1,
    failed: 1,
    canceled: 0,
    skipped: 0,
    notSelected: 0,
  },
  focusNode: {
    nodeId: 'video-node',
    nodeLabel: '视频生成',
    status: 'failed',
    errorMessage: '供应商拒绝任务',
  },
}

describe('HistoryPanel', () => {
  beforeEach(() => {
    vi.stubGlobal('confirm', vi.fn(() => true))
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
    useUIStore.setState({
      activePanel: 'history',
      panelAnchorX: 500,
      currentFlow: {
        id: 'flow-1',
        name: '一键成片工作流',
        source: 'server',
        ownerType: 'project',
        ownerId: 'project-1',
      },
    })
    vi.spyOn(apiServer, 'listFlowVersionsPage').mockResolvedValue({
      items: [{
        id: 'version-1',
        name: '一键成片工作流',
        createdAt: '2026-08-14T09:00:00.000Z',
      }],
      nextCursor: null,
    })
    vi.spyOn(apiServer, 'createFlowVersionSnapshot').mockResolvedValue({
      id: 'version-2',
      name: '一键成片工作流',
      createdAt: '2026-08-14T09:10:00.000Z',
    })
    vi.spyOn(apiServer, 'listWorkflowExecutionHistoryPage').mockResolvedValue({
      items: [failedExecution],
      nextCursor: null,
    })
    vi.spyOn(apiServer, 'getWorkflowExecutionMetrics').mockResolvedValue({
      sampleSize: 1,
      workflowSuccessRate: 0,
      nodeFailureRate: 1 / 3,
      recoverySuccessRate: 0,
      breakdowns: {},
    })
    vi.spyOn(apiServer, 'rerunWorkflowExecutionSnapshot').mockResolvedValue({
      id: 'execution-2',
      flowId: 'flow-1',
      flowVersionId: 'version-2',
      ownerId: 'owner-1',
      status: 'queued',
      concurrency: 1,
      trigger: 'manual',
      createdAt: '2026-08-14T09:05:00.000Z',
    })
    vi.spyOn(apiServer, 'rollbackFlow').mockResolvedValue({
      id: 'flow-1',
      name: '一键成片工作流',
      ownerType: 'project',
      ownerId: 'project-1',
      data: { nodes: [], edges: [] },
      createdAt: '2026-08-14T08:00:00.000Z',
      updatedAt: '2026-08-14T09:10:00.000Z',
      canvasRevision: 3,
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('loads the user-global execution history independently from flow versions', async () => {
    const openLog = vi.fn()
    const focusNode = vi.fn()
    render(
      <MantineProvider>
        <HistoryPanel onOpenLog={openLog} onFocusNode={focusNode} />
      </MantineProvider>,
    )

    expect(await screen.findByText('供应商拒绝任务')).toBeInTheDocument()
    expect(screen.getByText('一键成片工作流')).toBeInTheDocument()
    expect(screen.getByText('失败于')).toBeInTheDocument()
    expect(screen.getByText('视频生成')).toBeInTheDocument()
    expect(screen.getByText('1/3 节点完成')).toBeInTheDocument()
    expect(apiServer.listWorkflowExecutionHistoryPage).toHaveBeenCalledWith({ limit: 40 })
    expect(apiServer.listFlowVersionsPage).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '查看执行日志' }))
    expect(openLog).toHaveBeenCalledWith('execution-1')

    fireEvent.click(screen.getByRole('button', { name: '查看执行快照' }))
    expect(screen.getByText('snapshot:execution-1')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /失败于.*视频生成/ }))
    expect(focusNode).toHaveBeenCalledWith('video-node')
  })

  it('filters execution history to the current workflow on demand', async () => {
    render(
      <MantineProvider>
        <HistoryPanel onOpenLog={vi.fn()} />
      </MantineProvider>,
    )

    await screen.findByText('供应商拒绝任务')
    fireEvent.click(screen.getByRole('button', { name: '当前工作流' }))

    await waitFor(() => expect(apiServer.listWorkflowExecutionHistoryPage).toHaveBeenLastCalledWith({
      flowId: 'flow-1',
      limit: 40,
    }))
  })

  it('reruns the selected immutable snapshot as a new execution after explicit confirmation', async () => {
    const openLog = vi.fn()
    render(
      <MantineProvider>
        <HistoryPanel onOpenLog={openLog} />
      </MantineProvider>,
    )

    fireEvent.click(await screen.findByRole('button', { name: '使用当时快照重新运行' }))

    await waitFor(() => expect(apiServer.rerunWorkflowExecutionSnapshot).toHaveBeenCalledWith('execution-1'))
    expect(openLog).toHaveBeenCalledWith('execution-2')
  })

  it('loads versions lazily and restores the exact selected snapshot', async () => {
    const onVersionRestored = vi.fn().mockResolvedValue(undefined)
    render(
      <MantineProvider>
        <HistoryPanel onOpenLog={vi.fn()} onVersionRestored={onVersionRestored} />
      </MantineProvider>,
    )

    await screen.findByText('供应商拒绝任务')
    expect(apiServer.listFlowVersionsPage).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '保存版本 0' }))
    expect(await screen.findByRole('button', { name: /^恢复版本 / })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^恢复版本 / }))

    await waitFor(() => expect(apiServer.rollbackFlow).toHaveBeenCalledWith('flow-1', 'version-1'))
    expect(onVersionRestored).toHaveBeenCalledTimes(1)
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('version-1'))
  })

  it('creates an explicit version snapshot without coupling it to ordinary autosave', async () => {
    render(
      <MantineProvider>
        <HistoryPanel onOpenLog={vi.fn()} />
      </MantineProvider>,
    )

    await screen.findByText('供应商拒绝任务')
    fireEvent.click(screen.getByRole('button', { name: '保存版本 0' }))
    fireEvent.click(await screen.findByRole('button', { name: '保存当前工作流版本' }))

    await waitFor(() => expect(apiServer.createFlowVersionSnapshot).toHaveBeenCalledWith('flow-1'))
  })

  it('keeps execution history usable when version history fails', async () => {
    vi.mocked(apiServer.listFlowVersionsPage).mockRejectedValueOnce(new Error('版本库暂时不可用'))
    render(
      <MantineProvider>
        <HistoryPanel onOpenLog={vi.fn()} />
      </MantineProvider>,
    )

    expect(await screen.findByText('供应商拒绝任务')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '保存版本 0' }))
    expect(await screen.findByText('版本库暂时不可用')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '执行记录 1' }))
    expect(screen.getByText('供应商拒绝任务')).toBeInTheDocument()
  })
})
