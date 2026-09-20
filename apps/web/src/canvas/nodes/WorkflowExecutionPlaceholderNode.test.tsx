import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NodeProps } from '@xyflow/react'
import { WorkflowExecutionPlaceholderNode } from './WorkflowExecutionPlaceholderNode'
import { cancelWorkflowExecution } from '../../api/server'
import { requestWorkflowExecutionSnapshot } from '../workflowExecutionRequest'

vi.mock('../../api/server', () => ({ cancelWorkflowExecution: vi.fn() }))
vi.mock('../workflowExecutionRequest', () => ({ requestWorkflowExecutionSnapshot: vi.fn() }))

const props = (status = 'running', readOnly = false): NodeProps => ({
  id: 'node', type: 'workflowexecution', data: { workflowExecutionId: 'execution-1', workflowStatus: status, readOnly },
  dragging: false, selected: false, isConnectable: false, zIndex: 0,
  selectable: true, deletable: false, draggable: true, positionAbsoluteX: 0, positionAbsoluteY: 0,
})

describe('workflow execution stop action', () => {
  beforeEach(() => { vi.resetAllMocks() })
  it('opens the snapshot from the card content without stopping execution', () => {
    render(<WorkflowExecutionPlaceholderNode {...props()} />)
    fireEvent.click(screen.getByText('工作流执行'))
    expect(requestWorkflowExecutionSnapshot).toHaveBeenCalledWith('execution-1')
    expect(cancelWorkflowExecution).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '停止执行' })).toHaveTextContent('')
    expect(screen.getByRole('button', { name: '停止执行' }).closest('button button')).toBeNull()
  })
  it('stops the exact execution once and waits for the server receipt without opening the snapshot', async () => {
    let finish: ((value: Awaited<ReturnType<typeof cancelWorkflowExecution>>) => void) | undefined
    vi.mocked(cancelWorkflowExecution).mockImplementation(() => new Promise(resolve => { finish = resolve }))
    render(<WorkflowExecutionPlaceholderNode {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: '停止执行' }))
    fireEvent.click(screen.getByRole('button', { name: '正在停止…' }))
    expect(cancelWorkflowExecution).toHaveBeenCalledTimes(1)
    expect(cancelWorkflowExecution).toHaveBeenCalledWith('execution-1')
    expect(requestWorkflowExecutionSnapshot).not.toHaveBeenCalled()
    expect(screen.queryByText('已停止')).not.toBeInTheDocument()
    finish?.({ execution: { status: 'canceled' } as Awaited<ReturnType<typeof cancelWorkflowExecution>>['execution'], receipt: {}, localAbortedJobs: 1 })
    await waitFor(() => expect(screen.getByText('已停止')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: '停止执行' })).not.toBeInTheDocument()
  })
  it('shows the actual failure and keeps retry available', async () => {
    vi.mocked(cancelWorkflowExecution).mockRejectedValue(new Error('中断回执未确认'))
    render(<WorkflowExecutionPlaceholderNode {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: '停止执行' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('中断回执未确认'))
    expect(screen.getByRole('button', { name: '停止执行' })).toBeEnabled()
    expect(screen.queryByText('已停止')).not.toBeInTheDocument()
  })
  it.each(['succeeded', 'failed', 'canceled', 'cancelled'])('hides stop for terminal %s', status => {
    render(<WorkflowExecutionPlaceholderNode {...props(status)} />)
    expect(screen.queryByRole('button', { name: '停止执行' })).not.toBeInTheDocument()
  })
  it('hides mutations in read-only views', () => {
    render(<WorkflowExecutionPlaceholderNode {...props('running', true)} />)
    expect(screen.queryByRole('button', { name: '停止执行' })).not.toBeInTheDocument()
  })
})
