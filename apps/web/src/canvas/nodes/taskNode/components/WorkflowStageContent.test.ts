// @vitest-environment jsdom
import React from 'react'
import '@testing-library/jest-dom/vitest'
import { MantineProvider } from '@mantine/core'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AGENT_WORKFLOW_KEY } from '@tapcanvas/workflow-kernel-protocol'
import { useAuth } from '../../../../auth/store'
import { useRFStore } from '../../../store'
import { WorkflowStageContent } from './WorkflowStageContent'

describe('WorkflowStageContent', () => {
  it('shows a restored durable execution status even when the node has no legacy requested timestamp', () => {
    render(React.createElement(
      MantineProvider,
      null,
      React.createElement(WorkflowStageContent, {
        nodeId: 'source-chunks',
        data: {
          kind: 'adminWorkflowStage',
          workflowKey: 'document-prompts/v1',
          workflowNodeId: 'source-chunks',
          workflowExecutionId: 'execution-latest',
          workflowStatus: 'succeeded',
          workflowAtomicSpec: {
            category: 'control',
            operation: 'split_items',
            executionMode: 'once',
          },
        },
        readOnly: false,
      }),
    ))

    expect(screen.getByText('已完成')).toBeInTheDocument()
    expect(screen.queryByText('已配置')).not.toBeInTheDocument()
  })

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
    useAuth.setState({ user: { sub: 'admin-1', login: 'admin', role: 'admin' } })
    useRFStore.getState().reset()
  })

  it('makes each-mode and its concurrency visible on the canvas node', () => {
    render(React.createElement(
      MantineProvider,
      null,
      React.createElement(WorkflowStageContent, {
        nodeId: 'workflow-1:prompt-agent',
        readOnly: false,
        data: {
          workflowKey: AGENT_WORKFLOW_KEY,
          workflowNodeId: 'prompt-agent',
          workflowInstruction: '逐项生成 15 秒视频提示词',
          workflowAtomicSpec: {
            version: 1,
            category: 'agent',
            operation: 'agent_task',
            executorRef: 'agents.logical-task/v2',
            executionMode: 'each',
            itemConcurrency: 3,
            inputPorts: ['input'],
            outputPorts: ['result'],
          },
          workflowInputPorts: ['input'],
          workflowOutputPorts: ['result'],
        },
      }),
    ))

    expect(screen.getByText('智能体 · Agent 任务 · 逐项 · 并发上限 3')).toBeInTheDocument()
    expect(screen.getByText('逐项生成 15 秒视频提示词')).toBeInTheDocument()
  })

  it('distinguishes a data input node from the workflow execution trigger', () => {
    render(React.createElement(
      MantineProvider,
      null,
      React.createElement(WorkflowStageContent, {
        nodeId: 'workflow-1:document',
        readOnly: false,
        data: {
          workflowKey: AGENT_WORKFLOW_KEY,
          workflowNodeId: 'document',
          workflowTextInput: '第一章正文',
          workflowAtomicSpec: {
            version: 1,
            category: 'source',
            operation: 'text_input',
            executorRef: 'workflow.input.text/v1',
            executionMode: 'once',
            inputPorts: ['trigger'],
            outputPorts: ['text'],
          },
          workflowInputPorts: ['trigger'],
          workflowOutputPorts: ['text'],
        },
      }),
    ))

    expect(screen.getByText('数据输入 · 文本输入 · 单次')).toBeInTheDocument()
    expect(screen.getByText('trigger')).toBeInTheDocument()
    expect(screen.getByText('text')).toBeInTheDocument()
  })

  it('keeps a partially settled node running while making failed items explicit', () => {
    render(React.createElement(
      MantineProvider,
      null,
      React.createElement(WorkflowStageContent, {
        nodeId: 'workflow-1:prompt-agent',
        readOnly: false,
        data: {
          workflowKey: AGENT_WORKFLOW_KEY,
          workflowNodeId: 'prompt-agent',
          workflowExecutionId: 'execution-running',
          workflowStatus: 'running',
          workflowErrorCount: 1,
          workflowCompletedUnits: 0,
          workflowTotalUnits: 2,
          workflowAtomicSpec: {
            version: 1,
            category: 'agent',
            operation: 'agent_task',
            executorRef: 'agents.logical-task/v2',
            executionMode: 'each',
            itemConcurrency: 2,
            inputPorts: ['input'],
            outputPorts: ['result'],
          },
          workflowInputPorts: ['input'],
          workflowOutputPorts: ['result'],
        },
      }),
    ))

    expect(screen.getByText('执行中 · 已失败 1 项')).toBeInTheDocument()
    expect(screen.getByText('1 个错误 · 0/2')).toBeInTheDocument()
  })

  it('renders a completed node duration from persisted execution timestamps', () => {
    render(React.createElement(
      MantineProvider,
      null,
      React.createElement(WorkflowStageContent, {
        nodeId: 'workflow-1:beat-sheet',
        readOnly: false,
        data: {
          workflowKey: AGENT_WORKFLOW_KEY,
          workflowNodeId: 'beat-sheet',
          workflowExecutionId: 'execution-finished',
          workflowStatus: 'succeeded',
          workflowExecutionStartedAt: '2026-08-14T09:05:05.000Z',
          workflowExecutionFinishedAt: '2026-08-14T09:07:08.000Z',
          workflowAtomicSpec: {
            version: 1,
            category: 'agent',
            operation: 'agent_task',
            executorRef: 'agents.logical-task/v2',
            executionMode: 'once',
            inputPorts: ['input'],
            outputPorts: ['result'],
          },
          workflowInputPorts: ['input'],
          workflowOutputPorts: ['result'],
        },
      }),
    ))

    expect(screen.getByText('已完成 · 2分03秒')).toBeInTheDocument()
  })
})
