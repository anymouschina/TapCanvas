// @vitest-environment jsdom
import React from 'react'
import '@testing-library/jest-dom/vitest'
import { MantineProvider } from '@mantine/core'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SnapshotNodeRunDetail } from './SnapshotNodeRunDetail'
import type { WorkflowExecutionSnapshotNode } from './workflowExecutionSnapshotGraph'

vi.mock('../domain/resource-runtime', () => ({
  ManagedImage: (props: Readonly<{ className: string; src: string; alt: string }>) => (
    <img className={props.className} src={props.src} alt={props.alt} />
  ),
}))

const node: WorkflowExecutionSnapshotNode = {
  id: 'video-node',
  type: 'taskNode',
  position: { x: 0, y: 0 },
  data: { label: '视频生成', kind: 'video', readOnly: true },
}

function run(partial: Record<string, unknown>): Parameters<typeof SnapshotNodeRunDetail>[0]['run'] {
  return {
    id: 'run-1',
    executionId: 'execution-1',
    nodeId: 'video-node',
    status: 'failed',
    attempt: 2,
    createdAt: '2026-08-14T09:00:01.000Z',
    startedAt: '2026-08-14T09:00:02.000Z',
    finishedAt: '2026-08-14T09:00:04.000Z',
    errorMessage: null,
    outputRefs: undefined,
    ...partial,
  } as Parameters<typeof SnapshotNodeRunDetail>[0]['run']
}

function renderDetail(props: Readonly<{
  node?: WorkflowExecutionSnapshotNode
  run: Parameters<typeof SnapshotNodeRunDetail>[0]['run']
  onOpenLog?: (executionId: string) => void
}>) {
  return render(
    <MantineProvider>
      <SnapshotNodeRunDetail
        node={props.node ?? node}
        run={props.run}
        executionId="execution-1"
        onClose={() => undefined}
        onOpenLog={props.onOpenLog}
      />
    </MantineProvider>,
  )
}

describe('SnapshotNodeRunDetail', () => {
  afterEach(() => cleanup())

  it('shows the run process facts and the persisted error for a failed run', () => {
    renderDetail({ run: run({ status: 'failed', errorMessage: 'provider task rejected' }) })

    expect(screen.getByText('运行过程')).toBeInTheDocument()
    expect(screen.getAllByText('失败').length).toBeGreaterThan(0)
    expect(screen.getByText('第 2 次')).toBeInTheDocument()
    expect(screen.getByText('2.0 秒')).toBeInTheDocument()
    expect(screen.getByText('provider task rejected')).toBeInTheDocument()
    expect(screen.getByText('快照节点数据')).toBeInTheDocument()
  })

  it('renders run output media assets through ManagedImage', () => {
    renderDetail({
      run: run({
        status: 'success',
        outputRefs: {
          protocolVersion: '1',
          executorRef: 'image/v1',
          nodeId: 'video-node',
          executionMode: 'once',
          ports: {},
          artifacts: [{
            type: 'tapcanvas.image/v1',
            identity: 'image-1',
            media: {
              protocolVersion: 'workflow.media-asset/v1',
              kind: 'image',
              url: 'https://cdn.example.com/result.webp',
              mimeType: 'image/webp',
            },
          }],
          evidence: { executorCompleted: true },
          itemRuns: [],
        },
      }),
    })

    expect(screen.getByRole('img', { name: '视频生成' })).toHaveAttribute('src', 'https://cdn.example.com/result.webp')
    expect(screen.getByText('运行结果')).toBeInTheDocument()
  })

  it('shows an honest empty-output note when a successful run declares nothing', () => {
    renderDetail({
      run: run({
        status: 'success',
        outputRefs: {
          protocolVersion: '1',
          executorRef: 'noop/v1',
          nodeId: 'video-node',
          executionMode: 'once',
          ports: {},
          artifacts: [],
          evidence: {},
          itemRuns: [],
        },
      }),
    })

    expect(screen.getByText('本次运行成功，但执行器没有声明输出端口。')).toBeInTheDocument()
  })

  it('marks an unrun node without inventing a run record', () => {
    renderDetail({ run: null })

    expect(screen.getByText('该节点在这次执行中没有运行记录')).toBeInTheDocument()
    expect(screen.getByText('未运行')).toBeInTheDocument()
  })

  it('shows aggregate knowledge retrieval evidence without pretending it is a DAG node run', () => {
    renderDetail({
      run: null,
      node: {
        id: 'knowledge-reference',
        type: 'taskNode',
        position: { x: 0, y: 0 },
        data: {
          label: '知识库 · 检索异常',
          workflowRuntimeReferenceAggregate: true,
          workflowRuntimeReferenceEvidenceState: 'search_failed',
          workflowRuntimeReferenceDescription: '12 次案例检索均失败 · 本轮未读取正文',
          workflowRuntimeReferenceSearchAttemptCount: 12,
          workflowRuntimeReferenceSearchFailureCount: 12,
          workflowRuntimeReferenceCandidateCount: 0,
          workflowRuntimeReferenceActualReadCount: 0,
        },
      },
    })

    expect(screen.getByText('检索异常')).toBeInTheDocument()
    expect(screen.getByText('12 次案例检索均失败 · 本轮未读取正文')).toBeInTheDocument()
    expect(screen.getByText('Agent 运行证据聚合视图，不是独立 DAG 执行节点')).toBeInTheDocument()
    expect(screen.getByText('12 次（12 次异常）')).toBeInTheDocument()
    expect(screen.queryByText('该节点在这次执行中没有运行记录')).not.toBeInTheDocument()
  })

  it('opens the full execution log from the footer action', () => {
    const onOpenLog = vi.fn()
    renderDetail({ run: null, onOpenLog })

    screen.getByRole('button', { name: '查看完整执行日志' }).click()
    expect(onOpenLog).toHaveBeenCalledWith('execution-1')
  })
})
