// @vitest-environment jsdom
import React from 'react'
import '@testing-library/jest-dom/vitest'
import { MantineProvider } from '@mantine/core'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AGENT_WORKFLOW_KEY } from '@tapcanvas/workflow-kernel-protocol'
import { VIDEO_PRODUCTION_WORKFLOW_KEY } from '@tapcanvas/video-orchestrator-protocol'
import { useAuth } from '../../auth/store'
import { useRFStore } from '../store'
import { workflowPortHandleId } from '../workflowCanvasPorts'
import {
  WORKFLOW_EXECUTION_REQUEST_EVENT,
  type WorkflowExecutionRequestDetail,
} from '../workflowExecutionRequest'
import { useWorkflowNodeInspectorStore } from '../workflowNodeInspectorStore'
import { WorkflowNodeInspectorPanel } from './WorkflowNodeInspectorPanel'
import * as apiServer from '../../api/server'
import { useUIStore } from '../../ui/uiStore'

vi.mock('../../config/useModelOptions', async () => {
  const actual = await vi.importActual<typeof import('../../config/useModelOptions')>('../../config/useModelOptions')
  return {
    ...actual,
    useModelOptionsState: (kind?: string) => ({
      options: kind === 'video'
        ? [{
            value: 'video-model-selection',
            label: '商业视频模型',
            modelKey: 'video-model-request-key',
            meta: {
              videoOptions: {
                durationOptions: [{ value: 5, label: '5 秒' }],
                resolutionOptions: [{ value: '1080p', label: '1080P' }],
                sizeOptions: [{ value: '16:9', label: '横屏 16:9' }],
              },
            },
          }]
        : [{
            value: 'text-model-selection',
            label: '商业文本模型',
            modelKey: 'text-model-request-key',
            meta: {},
          }],
      loading: false,
      error: null,
      retry: vi.fn(),
    }),
  }
})

describe('WorkflowNodeInspectorPanel', () => {
  afterEach(() => {
    cleanup()
    delete (window as unknown as { silentSaveProject?: () => Promise<boolean> }).silentSaveProject
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
    if (typeof globalThis.ResizeObserver === 'undefined') {
      vi.stubGlobal('ResizeObserver', class ResizeObserverStub {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      })
    }
    useAuth.setState({ user: { sub: 'admin-1', login: 'admin', role: 'admin' } })
    useRFStore.getState().reset()
    useUIStore.setState({
      currentFlow: { id: null, name: '未命名', source: 'local', ownerType: 'project', ownerId: null },
    })
    useRFStore.setState({
      nodes: [{
        id: 'workflow-1:text-input',
        type: 'taskNode',
        position: { x: 0, y: 0 },
        data: {
          label: '文本输入',
          kind: 'workflowStage',
          adminWorkflow: true,
          workflowKey: AGENT_WORKFLOW_KEY,
          workflowInstanceId: 'workflow-1',
          workflowNodeId: 'text-input',
          workflowAtomicSpec: {
            version: 1,
            category: 'source',
            operation: 'text_input',
            executorRef: 'workflow.input.text/v1',
            executionMode: 'once',
            inputPorts: ['trigger'],
            outputPorts: ['text'],
          },
          workflowTextInput: '真实测试文本',
          workflowInputPorts: ['trigger'],
          workflowOutputPorts: ['text'],
        },
      }],
      edges: [],
    })
    useWorkflowNodeInspectorStore.getState().openNode('workflow-1:text-input')
  })

  it('opens node configuration and exposes separate input, output, history and run views', async () => {
    render(
      <MantineProvider>
        <WorkflowNodeInspectorPanel readOnly={false} />
      </MantineProvider>,
    )

    expect(screen.getByRole('complementary', { name: '文本输入' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '文本' })).toHaveValue('真实测试文本')

    fireEvent.click(screen.getByRole('tab', { name: '输入' }))
    expect(screen.getByText('当前节点没有上游连接。')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: '输出' }))
    expect(screen.getByText('这个节点还没有正式工作流执行记录。')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: '历史' }))
    expect(await screen.findByText('先保存当前画布，执行记录会按工作流和节点永久归档。')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: '运行' }))
    expect(screen.getByText('尚未运行')).toBeInTheDocument()
    expect(screen.getByText('workflow.input.text/v1')).toBeInTheDocument()
  })

  it('opens a projected Skill reference and shows its document name and description', async () => {
    useRFStore.setState({
      nodes: [{
        id: 'workflow-1:agent',
        type: 'taskNode',
        position: { x: 0, y: 0 },
        data: {
          label: 'BeatSheet Agent',
          kind: 'workflowStage',
          adminWorkflow: true,
          workflowInstanceId: 'workflow-1',
        },
      }, {
        id: 'workflow-1:agent:runtime-reference:skill',
        type: 'taskNode',
        position: { x: 0, y: 120 },
        data: {
          label: 'Skills · 1',
          kind: 'workflowStage',
          adminWorkflow: true,
          workflowInstanceId: 'workflow-1',
          workflowRuntimeReference: true,
          workflowRuntimeReferenceAggregate: true,
          workflowRuntimeReferenceKind: 'skill',
          workflowRuntimeReferenceName: 'Skills',
          workflowRuntimeReferenceCount: 1,
          workflowRuntimeReferenceOwnerNodeId: 'workflow-1:agent',
          workflowRuntimeReferenceItems: [{
            identity: 'tapcanvas-dramatic-adapter',
            referenceKey: 'tapcanvas-dramatic-adapter',
            name: '戏剧改编器',
            description: '把来源文本重构为可执行的整章视频 BeatSheet 戏剧合同。',
            evidenceState: 'actual_read',
            physicalExecutionIds: ['physical-execution-1'],
            evidence: [{
              source: 'skills/tapcanvas-dramatic-adapter/SKILL.md',
              contentHash: 'sha256:skill-dramatic-adapter',
            }],
          }],
          workflowAtomicSpec: {
            category: 'skill',
            operation: 'skill_reference',
            executorRef: null,
          },
        },
      }],
      edges: [],
    })
    useWorkflowNodeInspectorStore.getState().openNode('workflow-1:agent:runtime-reference:skill')

    render(<MantineProvider><WorkflowNodeInspectorPanel readOnly={false} /></MantineProvider>)

    expect(screen.getByRole('complementary', { name: 'Skills · 1' })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: '戏剧改编器', level: 3 })).toBeInTheDocument()
    expect(screen.getByText('把来源文本重构为可执行的整章视频 BeatSheet 戏剧合同。')).toBeInTheDocument()
    expect(screen.getByText('本轮 executionProvenance')).toBeInTheDocument()
  })

  it('opens a projected knowledge reference and shows its card name and description', async () => {
    useRFStore.setState({
      nodes: [{
        id: 'workflow-1:agent',
        type: 'taskNode',
        position: { x: 0, y: 0 },
        data: {
          label: '逐镜提示词 Agent',
          kind: 'workflowStage',
          adminWorkflow: true,
          workflowInstanceId: 'workflow-1',
        },
      }, {
        id: 'workflow-1:agent:runtime-reference:knowledge',
        type: 'taskNode',
        position: { x: 0, y: 120 },
        data: {
          label: '知识库 · 1',
          kind: 'workflowStage',
          adminWorkflow: true,
          workflowInstanceId: 'workflow-1',
          workflowRuntimeReference: true,
          workflowRuntimeReferenceAggregate: true,
          workflowRuntimeReferenceKind: 'knowledge',
          workflowRuntimeReferenceName: '知识库',
          workflowRuntimeReferenceCount: 1,
          workflowRuntimeReferenceOwnerNodeId: 'workflow-1:agent',
          workflowRuntimeReferenceItems: [{
            identity: 'knowledge-action-pacing:sha256:knowledge-action-pacing',
            referenceKey: 'knowledge-action-pacing',
            name: '高燃动作镜头节奏',
            description: '命中瞬间使用短暂停顿、速度变化和武器反作用；摄影机保持轴线稳定。',
            evidenceState: 'actual_read',
            physicalExecutionIds: ['physical-execution-2'],
            evidence: [{
              cardId: 'knowledge-action-pacing',
              contentHash: 'sha256:knowledge-action-pacing',
            }],
          }],
          workflowAtomicSpec: {
            category: 'tool',
            operation: 'knowledge_reference',
            executorRef: null,
          },
        },
      }],
      edges: [],
    })
    useWorkflowNodeInspectorStore.getState().openNode('workflow-1:agent:runtime-reference:knowledge')

    render(<MantineProvider><WorkflowNodeInspectorPanel readOnly={false} /></MantineProvider>)

    expect(screen.getByRole('complementary', { name: '知识库 · 1' })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: '高燃动作镜头节奏', level: 3 })).toBeInTheDocument()
    expect(screen.getByText('命中瞬间使用短暂停顿、速度变化和武器反作用；摄影机保持轴线稳定。')).toBeInTheDocument()
    expect(screen.getByText('本轮 executionProvenance')).toBeInTheDocument()
  })

  it('explicitly saves the complete canvas snapshot after node data is edited', async () => {
    const saveProject = vi.fn(async () => true)
    ;(window as unknown as { silentSaveProject?: () => Promise<boolean> }).silentSaveProject = saveProject

    render(
      <MantineProvider>
        <WorkflowNodeInspectorPanel readOnly={false} />
      </MantineProvider>,
    )

    const textInput = screen.getByRole('textbox', { name: '文本' })
    fireEvent.change(textInput, { target: { value: '保存后的真实节点数据' } })
    fireEvent.blur(textInput)
    expect(useRFStore.getState().nodes[0]?.data.workflowTextInput).toBe('保存后的真实节点数据')

    fireEvent.click(screen.getByRole('button', { name: '保存节点配置' }))
    await waitFor(() => expect(saveProject).toHaveBeenCalledTimes(1))
  })

  it('expands JavaScript into a wide editor and keeps the compact field in sync', async () => {
    useRFStore.setState({
      nodes: [{
        id: 'workflow-1:javascript',
        type: 'taskNode',
        position: { x: 0, y: 0 },
        data: {
          label: '协议编辑器',
          kind: 'workflowStage',
          adminWorkflow: true,
          workflowKey: AGENT_WORKFLOW_KEY,
          workflowInstanceId: 'workflow-1',
          workflowNodeId: 'javascript',
          workflowAtomicSpec: {
            version: 1,
            category: 'tool',
            operation: 'javascript',
            executorRef: 'workflow.tool.javascript/v1',
            executionMode: 'once',
            inputPorts: ['input'],
            outputPorts: ['output'],
          },
          workflowJavascriptCode: 'return { version: 1 }',
          workflowInputPorts: ['input'],
          workflowOutputPorts: ['output'],
        },
      }],
      edges: [],
    })
    useWorkflowNodeInspectorStore.getState().openNode('workflow-1:javascript')

    render(<MantineProvider><WorkflowNodeInspectorPanel readOnly={false} /></MantineProvider>)

    const compactEditor = screen.getByRole('textbox', { name: 'JavaScript' })
    expect(compactEditor).toHaveValue('return { version: 1 }')

    fireEvent.click(screen.getByRole('button', { name: '展开 JavaScript 编辑器' }))
    const expandedEditor = await screen.findByRole('textbox', { name: 'JavaScript 大编辑器' })
    expect(expandedEditor).toHaveValue('return { version: 1 }')

    fireEvent.change(expandedEditor, { target: { value: 'return { version: 2, incremental: true }' } })
    fireEvent.click(screen.getByRole('button', { name: '完成编辑' }))

    await waitFor(() => expect(useRFStore.getState().nodes[0]?.data.workflowJavascriptCode).toBe(
      'return { version: 2, incremental: true }',
    ))
    expect(compactEditor).toHaveValue('return { version: 2, incremental: true }')
  })

  it('persists a valid online icon URL and rejects an invalid address', () => {
    render(
      <MantineProvider>
        <WorkflowNodeInspectorPanel readOnly={false} />
      </MantineProvider>,
    )

    const iconUrlInput = screen.getByRole('textbox', { name: '在线图标 URL' })
    fireEvent.change(iconUrlInput, { target: { value: 'not-an-online-url' } })
    fireEvent.blur(iconUrlInput)

    expect(screen.getByText('必须是完整的 http:// 或 https:// 图片地址')).toBeInTheDocument()
    expect(useRFStore.getState().nodes[0]?.data.workflowIconUrl).toBeUndefined()

    fireEvent.change(iconUrlInput, { target: { value: 'https://cdn.example.com/workflow/text-input.png' } })
    fireEvent.blur(iconUrlInput)

    expect(useRFStore.getState().nodes[0]?.data.workflowIconUrl).toBe(
      'https://cdn.example.com/workflow/text-input.png',
    )
  })

  it('switches a media node between icon and real-result canvas display after selection', () => {
    useRFStore.setState({
      nodes: [{
        id: 'workflow-1:image-generator',
        type: 'taskNode',
        position: { x: 0, y: 0 },
        data: {
          label: '图片生成',
          kind: 'workflowStage',
          adminWorkflow: true,
          workflowKey: AGENT_WORKFLOW_KEY,
          workflowInstanceId: 'workflow-1',
          workflowNodeId: 'image-generator',
          workflowAtomicSpec: {
            version: 1,
            category: 'media',
            operation: 'image_generate',
            executorRef: 'workflow.media.image/v1',
            executionMode: 'once',
            inputPorts: ['prompt'],
            outputPorts: ['image'],
          },
          workflowOutputArtifacts: [{
            type: 'tapcanvas.image/v1',
            identity: 'image-1',
            value: 'https://cdn.example.com/image-1.webp',
          }],
        },
      }],
      edges: [],
    })
    useWorkflowNodeInspectorStore.getState().openNode('workflow-1:image-generator')

    render(<MantineProvider><WorkflowNodeInspectorPanel readOnly={false} /></MantineProvider>)

    fireEvent.click(screen.getByRole('button', { name: '切换为结果外显' }))
    expect(useRFStore.getState().nodes[0]?.data).toMatchObject({
      workflowCanvasDisplayMode: 'result',
    })

    fireEvent.click(screen.getByRole('button', { name: '切换为图标外显' }))
    expect(useRFStore.getState().nodes[0]?.data).toMatchObject({
      workflowCanvasDisplayMode: 'icon',
    })
  })

  it('does not offer a fabricated result mode before a media asset exists', () => {
    useRFStore.setState({
      nodes: [{
        id: 'workflow-1:video-generator',
        type: 'taskNode',
        position: { x: 0, y: 0 },
        data: {
          label: '视频生成',
          kind: 'workflowStage',
          adminWorkflow: true,
          workflowKey: AGENT_WORKFLOW_KEY,
          workflowInstanceId: 'workflow-1',
          workflowNodeId: 'video-generator',
          workflowAtomicSpec: {
            version: 1,
            category: 'media',
            operation: 'video_generate',
            executorRef: 'workflow.media.video/v1',
            executionMode: 'once',
            inputPorts: ['prompt'],
            outputPorts: ['video'],
          },
        },
      }],
      edges: [],
    })
    useWorkflowNodeInspectorStore.getState().openNode('workflow-1:video-generator')

    render(<MantineProvider><WorkflowNodeInspectorPanel readOnly={false} /></MantineProvider>)

    expect(screen.getByRole('button', {
      name: '尚无真实视频输出，生成完成后可切换',
    })).toBeDisabled()
  })

  it('keeps the node inspector below the measured workspace header', () => {
    const workspaceHeader = document.createElement('div')
    workspaceHeader.className = 'app-header-overlay'
    const secondaryControls = document.createElement('div')
    secondaryControls.className = 'app-header-secondary-controls'
    workspaceHeader.getBoundingClientRect = vi.fn(() => ({
      bottom: 72,
      height: 60,
      left: 14,
      right: 1456,
      top: 12,
      width: 1442,
      x: 14,
      y: 12,
      toJSON: () => ({}),
    }))
    secondaryControls.getBoundingClientRect = vi.fn(() => ({
      bottom: 124,
      height: 36,
      left: 1120,
      right: 1456,
      top: 88,
      width: 336,
      x: 1120,
      y: 88,
      toJSON: () => ({}),
    }))
    workspaceHeader.appendChild(secondaryControls)
    document.body.appendChild(workspaceHeader)

    try {
      render(<MantineProvider><WorkflowNodeInspectorPanel readOnly={false} /></MantineProvider>)
      expect(screen.getByRole('complementary', { name: '文本输入' })).toHaveStyle({ top: '132px' })
    } finally {
      workspaceHeader.remove()
    }
  })

  it('previews a deterministic text node and writes inspectable execution evidence', async () => {
    render(<MantineProvider><WorkflowNodeInspectorPanel readOnly={false} /></MantineProvider>)

    fireEvent.click(screen.getByRole('tab', { name: '运行' }))
    fireEvent.click(screen.getByRole('button', { name: '仅预览当前静态节点' }))

    await waitFor(() => expect(screen.getByRole('tab', { name: '输出' })).toHaveAttribute('aria-selected', 'true'))
    expect(screen.getByRole('region', { name: '节点输出' })).toHaveTextContent('真实测试文本')
    expect(screen.getByRole('region', { name: '执行证据' })).toHaveTextContent('"localPreview": true')
    expect(useRFStore.getState().nodes[0]?.data).toMatchObject({
      workflowLocalTestStatus: 'succeeded',
      workflowLocalTestOutput: { text: '真实测试文本' },
      workflowExecutionEvidence: {
        executorCompleted: true,
        localPreview: true,
        characterCount: 6,
      },
    })
  })

  it('loads the latest persisted node output after a Studio refresh', async () => {
    const history = vi.spyOn(apiServer, 'listWorkflowNodeRunHistory').mockResolvedValueOnce([{
      id: 'node-run-1',
      executionId: 'execution-1',
      nodeId: 'workflow-1:text-input',
      status: 'success',
      executionStatus: 'failed',
      attempt: 1,
      createdAt: '2026-08-12T00:03:32.061Z',
      executionCreatedAt: '2026-08-12T00:03:32.033Z',
      executionFinishedAt: '2026-08-12T00:13:58.440Z',
      outputRefs: {
        ports: { text: '来自持久执行历史的正文输出' },
        evidence: { executorCompleted: true },
        artifacts: [{ type: 'tapcanvas.text/v1', identity: 'artifact-text-1', value: '来自持久执行历史的正文输出' }],
        itemRuns: [],
      },
    }])
    useUIStore.setState({
      currentFlow: { id: 'flow-1', name: '工作流', source: 'server', ownerType: 'project', ownerId: 'project-1' },
    })
    useRFStore.getState().updateNodeData('workflow-1:text-input', {
      workflowErrorDetail: '旧画布失败状态不得污染最新成功输出',
      workflowResultSummary: '旧画布结果摘要',
      workflowOutputArtifactIds: ['stale-artifact'],
      workflowItemRuns: [{
        itemId: 'stale-item',
        index: 0,
        runtimeNodeId: 'workflow-1:text-input::item::stale-item',
        status: 'failed',
        ports: {},
        artifacts: [],
        evidence: {},
        errorMessage: '旧逐项错误',
      }],
    })
    render(<MantineProvider><WorkflowNodeInspectorPanel readOnly={false} /></MantineProvider>)

    fireEvent.click(screen.getByRole('tab', { name: '输出' }))

    expect(await screen.findByRole('region', { name: '最近持久执行' })).toHaveTextContent('完成')
    expect(screen.getByRole('region', { name: '节点输出' })).toHaveTextContent('来自持久执行历史的正文输出')
    expect(screen.getByRole('region', { name: '执行证据' })).toHaveTextContent('"executorCompleted": true')
    expect(screen.getByRole('region', { name: '交付证据' })).toHaveTextContent('artifact-text-1')
    expect(screen.queryByText('旧画布失败状态不得污染最新成功输出')).not.toBeInTheDocument()
    expect(screen.queryByText('旧画布结果摘要')).not.toBeInTheDocument()
    expect(screen.queryByText('旧逐项错误')).not.toBeInTheDocument()
    expect(screen.queryByText('stale-artifact')).not.toBeInTheDocument()
    expect(history).toHaveBeenCalledWith({ flowId: 'flow-1', nodeId: 'workflow-1:text-input', limit: 20 })
  })

  it('keeps the most recent successful output visible when a newer execution terminates without output', async () => {
    vi.spyOn(apiServer, 'listWorkflowNodeRunHistory').mockResolvedValueOnce([
      {
        id: 'node-run-failed',
        executionId: 'execution-failed',
        nodeId: 'workflow-1:text-input',
        status: 'failed',
        executionStatus: 'failed',
        attempt: 1,
        errorMessage: 'terminated',
        createdAt: '2026-08-12T01:00:00.000Z',
        executionCreatedAt: '2026-08-12T01:00:00.000Z',
        executionFinishedAt: '2026-08-12T01:01:00.000Z',
      },
      {
        id: 'node-run-success',
        executionId: 'execution-success',
        nodeId: 'workflow-1:text-input',
        status: 'success',
        executionStatus: 'success',
        attempt: 1,
        createdAt: '2026-08-12T00:00:00.000Z',
        executionCreatedAt: '2026-08-12T00:00:00.000Z',
        executionFinishedAt: '2026-08-12T00:01:00.000Z',
        outputRefs: {
          ports: { text: '上一轮真实持久产出' },
          evidence: { executorCompleted: true },
          artifacts: [{ type: 'tapcanvas.text/v1', identity: 'artifact-previous-output' }],
          itemRuns: [],
        },
      },
    ])
    useUIStore.setState({
      currentFlow: { id: 'flow-1', name: '工作流', source: 'server', ownerType: 'project', ownerId: 'project-1' },
    })
    render(<MantineProvider><WorkflowNodeInspectorPanel readOnly={false} /></MantineProvider>)

    fireEvent.click(screen.getByRole('tab', { name: '输出' }))

    expect(await screen.findByRole('region', { name: '最近持久执行' })).toHaveTextContent('失败')
    expect(screen.getByRole('region', { name: '历史有效产出' })).toHaveTextContent('最近一次有效结果')
    expect(screen.getByRole('region', { name: '节点输出' })).toHaveTextContent('上一轮真实持久产出')
    expect(screen.getByRole('region', { name: '运行错误' })).toHaveTextContent('terminated')
    expect(screen.getByRole('region', { name: '交付证据' })).toHaveTextContent('artifact-previous-output')
  })

  it('shows the complete item checkpoint before its aggregated successful ports', async () => {
    vi.spyOn(apiServer, 'listWorkflowNodeRunHistory').mockResolvedValueOnce([{
      id: 'node-run-items',
      executionId: 'execution-items',
      nodeId: 'workflow-1:text-input',
      status: 'failed',
      executionStatus: 'failed',
      attempt: 1,
      createdAt: '2026-08-12T00:03:32.061Z',
      executionCreatedAt: '2026-08-12T00:03:32.033Z',
      outputRefs: {
        ports: {
          result: {
            collectionId: 'collection-1',
            items: [{ itemId: 'clip-002', index: 1, value: '成功结果', lineage: [] }],
          },
        },
        evidence: { completedItems: 1, waitingItems: 1, totalItems: 2 },
        artifacts: [],
        itemRuns: [
          {
            itemId: 'clip-001',
            index: 0,
            runtimeNodeId: 'prompt-agent::item::clip-001',
            status: 'waiting_external',
            ports: {},
            artifacts: [],
            evidence: {},
          },
          {
            itemId: 'clip-002',
            index: 1,
            runtimeNodeId: 'prompt-agent::item::clip-002',
            status: 'success',
            ports: { result: { text: '成功提示词' } },
            artifacts: [{ type: 'tapcanvas.video-prompt/v1', value: '成功提示词' }],
            evidence: {},
          },
        ],
      },
    }])
    useUIStore.setState({
      currentFlow: { id: 'flow-1', name: '工作流', source: 'server', ownerType: 'project', ownerId: 'project-1' },
    })
    render(<MantineProvider><WorkflowNodeInspectorPanel readOnly={false} /></MantineProvider>)

    fireEvent.click(screen.getByRole('tab', { name: '输出' }))

    const list = await screen.findByRole('list', { name: '逐项运行输出' })
    expect(list).toHaveTextContent('clip-001')
    expect(list).toHaveTextContent('等待外部结果')
    expect(list).toHaveTextContent('clip-002')
    expect(list).toHaveTextContent('成功提示词')
  })

  it('shows the latest durable upstream item output when the current canvas has no active projection', async () => {
    const sourceNode = useRFStore.getState().nodes[0]
    if (!sourceNode) throw new Error('Expected the configured source workflow node')
    useRFStore.setState({
      nodes: [sourceNode, {
        id: 'workflow-1:video',
        type: 'taskNode',
        position: { x: 320, y: 0 },
        data: {
          label: '逐项生成视频',
          kind: 'workflowStage',
          adminWorkflow: true,
          workflowKey: AGENT_WORKFLOW_KEY,
          workflowInstanceId: 'workflow-1',
          workflowNodeId: 'video',
          workflowAtomicSpec: {
            version: 1,
            category: 'media',
            operation: 'video_generate',
            executorRef: 'tapcanvas.video.generate/v1',
            executionMode: 'each',
            inputPorts: ['prompt'],
            outputPorts: ['video'],
          },
          workflowInputPorts: ['prompt'],
          workflowOutputPorts: ['video'],
        },
      }],
      edges: [{
        id: 'workflow-1:source-to-video',
        source: 'workflow-1:text-input',
        target: 'workflow-1:video',
        sourceHandle: workflowPortHandleId('output', 'text'),
        targetHandle: workflowPortHandleId('input', 'prompt'),
      }],
    })
    useWorkflowNodeInspectorStore.getState().openNode('workflow-1:video')
    useUIStore.setState({
      currentFlow: { id: 'flow-1', name: '工作流', source: 'server', ownerType: 'project', ownerId: 'project-1' },
    })
    vi.spyOn(apiServer, 'listWorkflowNodeRunHistory').mockImplementation(async ({ nodeId }) => nodeId === 'workflow-1:text-input' ? [{
      id: 'node-run-upstream',
      executionId: 'execution-upstream',
      nodeId,
      status: 'success',
      executionStatus: 'success',
      attempt: 1,
      createdAt: '2026-08-12T04:24:13.000Z',
      executionCreatedAt: '2026-08-12T04:24:13.000Z',
      outputRefs: {
        ports: {},
        evidence: { completedItems: 2, totalItems: 2 },
        artifacts: [],
        itemRuns: [{
          itemId: 'clip-001',
          index: 0,
          runtimeNodeId: 'prompt-agent::item::clip-001',
          status: 'success',
          ports: { result: { text: '第一条 15 秒视频提示词' } },
          artifacts: [{ type: 'tapcanvas.video-prompt/v1', value: '第一条 15 秒视频提示词' }],
          evidence: {},
        }, {
          itemId: 'clip-002',
          index: 1,
          runtimeNodeId: 'prompt-agent::item::clip-002',
          status: 'success',
          ports: { result: { text: '第二条 15 秒视频提示词' } },
          artifacts: [{ type: 'tapcanvas.video-prompt/v1', value: '第二条 15 秒视频提示词' }],
          evidence: {},
        }],
      },
    }] : [])

    render(<MantineProvider><WorkflowNodeInspectorPanel readOnly={false} /></MantineProvider>)
    fireEvent.click(screen.getByRole('tab', { name: '输入' }))

    expect(screen.getByRole('region', { name: '当前画布输入' })).toHaveTextContent('真实测试文本')
    const durable = await screen.findByRole('region', { name: '上游持久输入' })
    expect(durable).toHaveTextContent('文本输入')
    expect(durable).toHaveTextContent('1/1 路')
    const itemList = screen.getByRole('list', { name: '文本输入 持久逐项输入' })
    expect(itemList).toHaveTextContent('clip-001')
    expect(itemList).toHaveTextContent('第一条 15 秒视频提示词')
    expect(itemList.querySelector('details')).not.toHaveAttribute('open')
  })

  it('runs the dependency prefix from the workflow trigger and stops after the inspected node', () => {
    const textNode = useRFStore.getState().nodes[0]
    if (!textNode) throw new Error('Expected the configured text workflow node')
    useRFStore.setState({
      nodes: [{
        id: 'workflow-1:manual-trigger',
        type: 'taskNode',
        position: { x: -320, y: 0 },
        data: {
          label: '执行入口',
          kind: 'workflowTrigger',
          adminWorkflow: true,
          workflowKey: AGENT_WORKFLOW_KEY,
          workflowInstanceId: 'workflow-1',
          workflowOutputPorts: ['trigger'],
        },
      }, textNode],
      edges: [{
        id: 'workflow-1:trigger-to-text',
        source: 'workflow-1:manual-trigger',
        target: 'workflow-1:text-input',
        sourceHandle: workflowPortHandleId('output', 'trigger'),
        targetHandle: workflowPortHandleId('input', 'trigger'),
      }],
    })
    let request: WorkflowExecutionRequestDetail | null = null
    const onRequest = (event: Event): void => {
      request = (event as CustomEvent<WorkflowExecutionRequestDetail>).detail
    }
    window.addEventListener(WORKFLOW_EXECUTION_REQUEST_EVENT, onRequest)
    try {
      render(<MantineProvider><WorkflowNodeInspectorPanel readOnly={false} /></MantineProvider>)
      fireEvent.click(screen.getByRole('tab', { name: '运行' }))
      fireEvent.click(screen.getByRole('button', { name: '执行到此节点' }))
      expect(request).toEqual({
        triggerNodeId: 'workflow-1:manual-trigger',
        stopAfterNodeId: 'workflow-1:text-input',
      })
      expect(useRFStore.getState().nodes.find((node) => node.id === 'workflow-1:text-input')?.data).toMatchObject({
        workflowStatus: 'queued',
      })
    } finally {
      window.removeEventListener(WORKFLOW_EXECUTION_REQUEST_EVENT, onRequest)
    }
  })

  it('imports a TXT document into the workflow text source without truncating it', async () => {
    render(<MantineProvider><WorkflowNodeInspectorPanel readOnly={false} /></MantineProvider>)
    const documentText = '第一章\n\n这是一段需要动态拆分的完整小说正文。'
    const file = new File([documentText], '小说第一章.txt', { type: 'text/plain' })
    Object.defineProperty(file, 'arrayBuffer', {
      value: async (): Promise<ArrayBuffer> => new TextEncoder().encode(documentText).buffer,
    })

    fireEvent.change(screen.getByLabelText('导入工作流文本文件'), {
      target: { files: [file] },
    })

    await waitFor(() => expect(useRFStore.getState().nodes[0]?.data).toMatchObject({
      workflowTextInput: documentText,
      workflowSourceFileName: '小说第一章.txt',
      workflowSourceFileSize: file.size,
    }))
    const textInput = screen.getByRole('textbox', { name: '文本' })
    expect(textInput).toHaveValue(documentText)

    fireEvent.change(textInput, { target: { value: `${documentText}\n人工修订。` } })
    fireEvent.blur(textInput)
    expect(useRFStore.getState().nodes[0]?.data).toMatchObject({
      workflowTextInput: `${documentText}\n人工修订。`,
      workflowSourceFileName: undefined,
      workflowSourceFileSize: undefined,
      workflowSourceImportedAt: undefined,
    })
    expect(screen.getByText(/当前文本 .* 字符/)).toBeInTheDocument()
  })

  it('supports commercial keyboard navigation, focus semantics, and Escape dismissal', () => {
    render(<MantineProvider><WorkflowNodeInspectorPanel readOnly={false} /></MantineProvider>)

    const configurationTab = screen.getByRole('tab', { name: '配置' })
    expect(configurationTab).toHaveAttribute('aria-selected', 'true')
    expect(configurationTab).toHaveAttribute('tabindex', '0')
    configurationTab.focus()
    fireEvent.keyDown(configurationTab, { key: 'ArrowRight' })

    const inputTab = screen.getByRole('tab', { name: '输入' })
    expect(inputTab).toHaveFocus()
    expect(inputTab).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName('输入')
    fireEvent.keyDown(inputTab, { key: 'End' })
    expect(screen.getByRole('tab', { name: '运行' })).toHaveFocus()

    fireEvent.keyDown(screen.getByRole('complementary', { name: '文本输入' }), { key: 'Escape' })
    expect(screen.queryByRole('complementary', { name: '文本输入' })).not.toBeInTheDocument()
  })

  it('navigates between workflow nodes in canvas order and keeps visual selection synchronized', () => {
    const currentNodes = useRFStore.getState().nodes
    useRFStore.setState({
      nodes: [
        ...currentNodes,
        {
          id: 'workflow-1:agent',
          type: 'taskNode',
          position: { x: 320, y: 0 },
          data: {
            label: 'Agent 任务',
            kind: 'workflowStage',
            adminWorkflow: true,
            workflowKey: AGENT_WORKFLOW_KEY,
            workflowInstanceId: 'workflow-1',
            workflowNodeId: 'agent',
            workflowAtomicSpec: {
              version: 1,
              category: 'agent',
              operation: 'agent_task',
              executorRef: 'agents.logical-task/v2',
              executionMode: 'once',
              inputPorts: ['input'],
              outputPorts: ['result'],
            },
          },
        },
      ],
      edges: [],
    })
    render(<MantineProvider><WorkflowNodeInspectorPanel readOnly={false} /></MantineProvider>)

    expect(screen.getByRole('button', { name: '上一个工作流节点' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '下一个工作流节点' }))

    expect(screen.getByRole('complementary', { name: 'Agent 任务' })).toBeInTheDocument()
    expect(useWorkflowNodeInspectorStore.getState().nodeId).toBe('workflow-1:agent')
    expect(useRFStore.getState().nodes.find((node) => node.id === 'workflow-1:agent')?.selected).toBe(true)
    expect(useRFStore.getState().nodes.find((node) => node.id === 'workflow-1:text-input')?.selected).not.toBe(true)
  })

  it('configures a video executor exclusively from the live catalog contract', () => {
    useRFStore.setState({
      nodes: [{
        id: 'workflow-1:video',
        type: 'taskNode',
        position: { x: 0, y: 0 },
        data: {
          label: '视频生成',
          kind: 'workflowStage',
          adminWorkflow: true,
          workflowKey: AGENT_WORKFLOW_KEY,
          workflowInstanceId: 'workflow-1',
          workflowNodeId: 'video',
          workflowAtomicSpec: {
            version: 1,
            category: 'media',
            operation: 'video_generate',
            executorRef: 'tapcanvas.video.generate/v1',
            executionMode: 'each',
            inputPorts: ['prompt'],
            outputPorts: ['video'],
          },
        },
      }],
      edges: [],
    })
    useWorkflowNodeInspectorStore.getState().openNode('workflow-1:video')
    render(<MantineProvider><WorkflowNodeInspectorPanel readOnly={false} /></MantineProvider>)

    const concurrencyInput = screen.getByRole('textbox', { name: '逐项并发上限' })
    expect(concurrencyInput).toHaveValue('1 · 顺序执行')
    fireEvent.click(concurrencyInput)
    fireEvent.click(screen.getByText('3 · 最多并行 3 项'))
    expect(useRFStore.getState().nodes[0]?.data.workflowAtomicSpec).toMatchObject({ itemConcurrency: 3 })

    fireEvent.click(screen.getByRole('textbox', { name: '视频模型' }))
    fireEvent.click(screen.getByText('商业视频模型'))
    expect(useRFStore.getState().nodes[0]?.data).toMatchObject({
      workflowVideoModelSelection: 'video-model-selection',
      workflowVideoModelKey: 'video-model-request-key',
    })
    fireEvent.click(screen.getByRole('textbox', { name: '视频时长' }))
    fireEvent.click(screen.getByText('5 秒'))
    fireEvent.click(screen.getByRole('textbox', { name: '视频分辨率' }))
    fireEvent.click(screen.getByText('1080P'))
    fireEvent.click(screen.getByRole('textbox', { name: '视频画面比例' }))
    fireEvent.click(screen.getByText('横屏 16:9'))
    expect(useRFStore.getState().nodes[0]?.data).toMatchObject({
      workflowVideoDurationSeconds: 5,
      workflowVideoResolution: '1080p',
      workflowVideoAspectRatio: '16:9',
    })
  })

  it('persists the one-click production Clip ceiling as a structural node setting', () => {
    useRFStore.setState({
      nodes: [{
        id: 'video-workflow-1:beat-sheet-format',
        type: 'taskNode',
        position: { x: 0, y: 0 },
        data: {
          label: 'Clip 上限',
          kind: 'workflowStage',
          adminWorkflow: true,
          workflowKey: VIDEO_PRODUCTION_WORKFLOW_KEY,
          workflowInstanceId: 'video-workflow-1',
          workflowNodeId: 'beat-sheet-format',
          workflowBeatSheetTakeCount: 24,
          workflowAtomicSpec: {
            version: 1,
            category: 'control',
            operation: 'max_clip',
            executorRef: 'video.beat-sheet.take/v1',
            executionMode: 'once',
            inputPorts: ['beat-sheet'],
            outputPorts: ['beat-sheet'],
          },
        },
      }],
      edges: [],
    })
    useWorkflowNodeInspectorStore.getState().openNode('video-workflow-1:beat-sheet-format')
    render(<MantineProvider><WorkflowNodeInspectorPanel readOnly={false} /></MantineProvider>)

    const maxClipInput = screen.getByRole('textbox', { name: '最大 Clip 数' })
    expect(maxClipInput).toHaveValue('24')
    fireEvent.change(maxClipInput, { target: { value: '8' } })
    expect(useRFStore.getState().nodes[0]?.data.workflowBeatSheetTakeCount).toBe(8)
    expect(screen.getByText(/全部完成后工作流成功/)).toBeInTheDocument()
  })

  it('persists an Agent model only from the live text catalog', () => {
    useRFStore.setState({
      nodes: [{
        id: 'workflow-1:agent',
        type: 'taskNode',
        position: { x: 0, y: 0 },
        data: {
          label: '提示词 Agent',
          kind: 'workflowStage',
          adminWorkflow: true,
          workflowKey: AGENT_WORKFLOW_KEY,
          workflowInstanceId: 'workflow-1',
          workflowNodeId: 'agent',
          workflowAtomicSpec: {
            version: 1,
            category: 'agent',
            operation: 'agent_task',
            executorRef: 'agents.logical-task/v2',
            executionMode: 'once',
            inputPorts: ['input'],
            outputPorts: ['result'],
          },
          workflowAgentDefinitionId: 'writer',
          workflowInstruction: '生成可执行提示词',
          workflowAgentDeliveryRequirement: '交付提示词文本',
          workflowAgentOutputArtifactType: 'tapcanvas.text/v1',
        },
      }],
      edges: [],
    })
    useWorkflowNodeInspectorStore.getState().openNode('workflow-1:agent')
    render(<MantineProvider><WorkflowNodeInspectorPanel readOnly={false} /></MantineProvider>)

    fireEvent.click(screen.getByRole('textbox', { name: 'Agent 文本模型' }))
    fireEvent.click(screen.getByText('商业文本模型'))

    expect(useRFStore.getState().nodes[0]?.data).toMatchObject({
      workflowAgentModelSelection: 'text-model-selection',
      workflowAgentModelKey: 'text-model-request-key',
    })
  })

  it('validates a schedule before enabling it and disables it when cron changes', async () => {
    const preview = vi.spyOn(apiServer, 'previewWorkflowSchedule').mockResolvedValue({
      valid: true,
      nextRuns: ['2026-08-12T01:00:00.000Z', '2026-08-13T01:00:00.000Z'],
    })
    useRFStore.setState({
      nodes: [{
        id: 'workflow-1:schedule',
        type: 'taskNode',
        position: { x: 0, y: 0 },
        data: {
          label: '定时触发',
          kind: 'workflowTrigger',
          adminWorkflow: true,
          workflowKey: AGENT_WORKFLOW_KEY,
          workflowDefinitionVersion: 1,
          workflowInstanceId: 'workflow-1',
          workflowTriggerSpec: {
            version: 1,
            kind: 'schedule',
            scheduleId: 'schedule-1',
            cron: '0 9 * * *',
            timezone: 'Asia/Taipei',
            enabled: false,
            misfirePolicy: 'skip',
            maxCatchUpRuns: 0,
          },
        },
      }],
      edges: [],
    })
    useWorkflowNodeInspectorStore.getState().openNode('workflow-1:schedule')
    render(<MantineProvider><WorkflowNodeInspectorPanel readOnly={false} /></MantineProvider>)

    fireEvent.click(screen.getByRole('switch', { name: '启用定时触发器' }))
    await waitFor(() => expect(preview).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(useRFStore.getState().nodes[0]?.data.workflowTriggerSpec).toMatchObject({ enabled: true }))
    expect(screen.getByText('2026-08-12T01:00:00.000Z')).toBeInTheDocument()

    fireEvent.change(screen.getByRole('textbox', { name: '定时触发 Cron 表达式' }), {
      target: { value: '30 9 * * *' },
    })
    expect(useRFStore.getState().nodes[0]?.data.workflowTriggerSpec).toMatchObject({
      cron: '30 9 * * *',
      enabled: false,
    })
  })
})
