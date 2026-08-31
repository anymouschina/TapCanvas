// @vitest-environment jsdom
import React from 'react'
import '@testing-library/jest-dom/vitest'
import { MantineProvider } from '@mantine/core'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuth } from '../auth/store'
import { useRFStore } from '../canvas/store'
import { VIDEO_ATOMIC_WORKFLOW_NODES } from '../canvas/videoWorkflowCanvasTemplate'
import { useUIStore } from './uiStore'
import AddNodePanel from './AddNodePanel'
import { BOTTOM_BAR_PANEL_WIDTH, bottomBarPanelMetrics } from './utils/panelPosition'

describe('AddNodePanel admin workflow catalog', () => {
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
    useAuth.setState({ user: { sub: 'admin-1', login: 'admin', role: 'admin' } })
    useUIStore.setState({ activePanel: 'add', panelAnchorX: 300 })
    useRFStore.getState().reset()
    vi.stubGlobal('crypto', { randomUUID: () => 'dynamic-workflow-test-id' })
  })

  it('expands templates and every atomic workflow node in the second-level category', () => {
    render(
      <MantineProvider>
        <AddNodePanel className="add-node-panel-test" />
      </MantineProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: /AI 编排/ }))

    expect(screen.getByRole('button', { name: /空白智能体工作流/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /文档 → 动态 15 秒视频/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /章节 → 多段视频/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /一键成片 · 完整成片/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /一键成片 · 只出到首个视频/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /一键成片 · 仅提示词/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /手动触发器/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /定时触发器/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /输入来源/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /文本输入/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /JavaScript 脚本/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /拆分为数据项/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Agent 任务/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Skill/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /工具调用/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /工具授权/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /控制节点/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /产物合同/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /交付验收/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /空白智能体工作流/ })).toHaveClass('add-node-panel-button')
  })

  it('merges creation and media nodes into one creation category', () => {
    render(<MantineProvider><AddNodePanel /></MantineProvider>)

    expect(screen.getByRole('button', { name: /^创作\s*9$/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /创作素材/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /媒体处理/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^(文本|Text)$/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^(图像|Image)$/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^(视频|Video)$/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^(音频|Audio) Beta$/ })).toBeInTheDocument()
  })

  it('keeps the shell size stable while category content scrolls internally', () => {
    const expectedMetrics = bottomBarPanelMetrics(BOTTOM_BAR_PANEL_WIDTH.regular)
    const { container } = render(
      <MantineProvider>
        <AddNodePanel className="add-node-panel-test" />
      </MantineProvider>,
    )
    const shell = container.querySelector<HTMLElement>('.add-node-panel-shell')
    const actions = container.querySelector<HTMLElement>('.add-node-panel-actions')

    expect(shell).not.toBeNull()
    expect(actions).not.toBeNull()
    expect(shell?.style.width).toBe(`${expectedMetrics.width}px`)
    expect(shell?.style.height).toBe(`${expectedMetrics.height}px`)
    expect(shell?.style.maxHeight).toBe(`${expectedMetrics.height}px`)
    expect(actions?.hasAttribute('data-panel-scroll')).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: /AI 编排/ }))

    expect(shell?.style.width).toBe(`${expectedMetrics.width}px`)
    expect(shell?.style.height).toBe(`${expectedMetrics.height}px`)
    expect(shell?.style.maxHeight).toBe(`${expectedMetrics.height}px`)
  })

  it('creates the unified dynamic document video workflow from the catalog action', () => {
    render(<MantineProvider><AddNodePanel /></MantineProvider>)
    fireEvent.click(screen.getByRole('button', { name: /AI 编排/ }))
    fireEvent.click(screen.getByRole('button', { name: /文档 → 动态 15 秒视频/ }))

    const workflowNodes = useRFStore.getState().nodes.filter((node) => (
      typeof node.data.workflowInstanceId === 'string'
      && node.data.workflowInstanceId.startsWith('document-prompts-workflow-')
    ))
    expect(workflowNodes).toHaveLength(10)
    expect(workflowNodes.filter((node) => node.type === 'taskNode')).toHaveLength(9)
    expect(workflowNodes.filter((node) => node.type === 'groupNode')).toHaveLength(1)
    expect(workflowNodes.some((node) => {
      const spec = node.data.workflowAtomicSpec
      return spec && typeof spec === 'object' && !Array.isArray(spec)
        && (spec as Record<string, unknown>).operation === 'video_generate'
    })).toBe(true)
  })

  it('creates the canonical one-click film workflow instead of the legacy document prompt graph', () => {
    render(<MantineProvider><AddNodePanel /></MantineProvider>)
    fireEvent.click(screen.getByRole('button', { name: /AI 编排/ }))
    fireEvent.click(screen.getByRole('button', { name: /一键成片 · 完整成片/ }))

    const workflowNodes = useRFStore.getState().nodes.filter((node) => (
      typeof node.data.workflowInstanceId === 'string'
      && node.data.workflowInstanceId.startsWith('video-workflow-')
    ))
    expect(workflowNodes.filter((node) => node.type === 'taskNode')).toHaveLength(VIDEO_ATOMIC_WORKFLOW_NODES.length + 1)
    expect(workflowNodes.filter((node) => node.type === 'groupNode')).toHaveLength(1)
    expect(workflowNodes.some((node) => node.data.workflowNodeId === 'concat')).toBe(true)
    expect(workflowNodes.some((node) => node.data.workflowNodeId === 'delivery-verify')).toBe(true)
  })

})
