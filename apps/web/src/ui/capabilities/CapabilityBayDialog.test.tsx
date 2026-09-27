// @vitest-environment jsdom
import React from 'react'
import '@testing-library/jest-dom/vitest'
import { MantineProvider } from '@mantine/core'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CapabilityBayCandidateDto, CapabilityBayDto } from '../../api/server'
import type { ModelOption } from '../../config/models'
import { CapabilityBayDialog } from './CapabilityBayDialog'

const apiMocks = vi.hoisted(() => ({
  adoptProject: vi.fn(),
  createProject: vi.fn(),
  deleteProject: vi.fn(),
  equip: vi.fn(),
  getBay: vi.fn(),
  inspect: vi.fn(),
  launchWorkflow: vi.fn(),
  cancelWorkflow: vi.fn(),
  updateBuiltIn: vi.fn(),
  updateSkill: vi.fn(),
  updateWorkflow: vi.fn(),
  unequip: vi.fn(),
}))

const modelCatalogMocks = vi.hoisted(() => ({
  imageOptions: [] as ModelOption[],
  videoOptions: [] as ModelOption[],
  imageLoading: false,
  imageError: null as Error | null,
  videoLoading: false,
  videoError: null as Error | null,
}))

vi.mock('../../api/server', () => ({
  adoptAiWorkflowProject: apiMocks.adoptProject,
  createAiWorkflowProject: apiMocks.createProject,
  deleteAiWorkflowProject: apiMocks.deleteProject,
  equipWorkflowCapability: apiMocks.equip,
  getCapabilityBay: apiMocks.getBay,
  launchEquippedWorkflow: apiMocks.launchWorkflow,
  cancelWorkflowExecution: apiMocks.cancelWorkflow,
  inspectWorkflowCapability: apiMocks.inspect,
  updateBuiltInCapabilityState: apiMocks.updateBuiltIn,
  updateSkillCapabilityState: apiMocks.updateSkill,
  updateWorkflowCapabilityState: apiMocks.updateWorkflow,
  unequipWorkflowCapability: apiMocks.unequip,
}))

vi.mock('../chat/chatModelSelection', () => ({
  readStoredChatModelValue: () => 'selected-text-model',
  loadSelectedChatModel: vi.fn(async () => ({
    option: { value: 'selected-text-model' },
    request: { field: 'modelKey', model: 'selected-text-model' },
  })),
}))

vi.mock('../../config/useModelOptions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../config/useModelOptions')>()
  return {
    ...actual,
    useModelOptionsState: (kind?: string) => ({
      options: kind === 'image' ? modelCatalogMocks.imageOptions : modelCatalogMocks.videoOptions,
      loading: kind === 'image' ? modelCatalogMocks.imageLoading : modelCatalogMocks.videoLoading,
      error: kind === 'image' ? modelCatalogMocks.imageError : modelCatalogMocks.videoError,
      retry: vi.fn(),
    }),
  }
})

const descriptor = {
  protocolVersion: 'tapcanvas.agent-capability/v1' as const,
  capabilityId: 'workflow:one-click',
  kind: 'workflow' as const,
  name: '一键成片',
  summary: '从主题规划到真实视频交付',
  sourceId: 'flow-one-click',
  sourceVersionId: 'version-8',
  sourceRevision: 8,
  projectId: 'project-1',
  triggerNodeId: 'trigger-1',
  nodeCount: 16,
  invocation: {
    sourceMode: 'project_context' as const,
    requiredTriggerPayloadFields: [],
  },
  operations: ['agent', 'video_submission'],
  requiredSkills: [],
  requiredTools: ['tapcanvas_video_orchestrate'],
  inputArtifacts: ['topic'],
  outputArtifacts: ['video'],
  permissions: ['project:read', 'canvas:write', 'media:generate:paid'],
  sideEffects: ['external_mutation', 'paid_generation'] as Array<'external_mutation' | 'paid_generation'>,
  semanticEvidence: [{ label: 'BeatSheet Agent', description: '规划镜头节奏', operation: 'agent' }],
}

const warningReport = {
  protocolVersion: 'tapcanvas.capability-conflict-report/v1' as const,
  targetCapabilityId: descriptor.capabilityId,
  checkedAt: '2026-08-15T00:00:00.000Z',
  descriptorSha256: 'a'.repeat(64),
  semanticAnalysis: { status: 'succeeded' as const },
  conflicts: [{
    id: 'semantic:builtin-video',
    severity: 'warning' as const,
    category: 'semantic_overlap' as const,
    withCapabilityId: 'tapcanvas-video-workflow',
    resolutionMode: 'choose_primary' as const,
    title: '与内置成片能力职责重叠',
    rationale: '两者都能从主题生成完整视频。',
    resolution: '必须选择一个主能力。',
  }],
  blocking: false,
  requiresConfirmation: true,
}

function bay(attached = false, stale = false, routingReady = attached, systemEnabled = true): CapabilityBayDto {
  return {
    productName: 'Agent 配置' as const,
    candidates: [{
      descriptor,
      descriptorSha256: warningReport.descriptorSha256,
      nodeBreakdown: null,
      projectName: '文艺短片项目',
      canEdit: true,
      updatedAt: '2026-09-20T08:59:01.726Z',
      attachedAt: attached ? '2026-08-21T02:29:48.832Z' : null,
      attached,
      attachedVersionId: attached ? (stale ? 'version-7' : descriptor.sourceVersionId) : null,
      stale,
    }],
    attachments: attached ? [{
      id: 'attachment-1',
      kind: 'workflow' as const,
      sourceId: descriptor.sourceId,
      sourceVersionId: stale ? 'version-7' : descriptor.sourceVersionId,
      descriptorSha256: warningReport.descriptorSha256,
      descriptor,
      conflictReport: warningReport,
      routeDecisions: routingReady ? [{
        conflictId: warningReport.conflicts[0].id,
        withCapabilityId: warningReport.conflicts[0].withCapabilityId,
        action: 'replace_existing' as const,
      }] : [],
      routingReady,
      scope: 'current_user' as const,
      userEnabled: true,
      createdAt: '2026-08-15T00:00:00.000Z',
      updatedAt: '2026-08-15T00:00:00.000Z',
    }] : [],
    skills: [{
      id: 'skill-1',
      key: 'tapcanvas-video-workflow',
      name: '视频工作流',
      description: '小T原生视频生产方法',
      logoUrl: null,
      category: '视频',
      enabled: true,
      disabledReason: null,
      replacedByCapabilityId: null,
    }],
    builtInCapabilities: [{
		id: 'builtin:one_click_video',
		key: 'one_click_video',
		name: '一键成片',
		description: '从创作目标规划并交付完整成片',
		requiredTools: ['tapcanvas_video_orchestrate'],
		sideEffects: ['paid_generation'] as const,
		enabled: systemEnabled,
		systemEnabled,
		userEnabled: true,
		disabledReason: systemEnabled ? null : 'system' as const,
		replacedByCapabilityId: null,
		replaceable: true as const,
    }],
    currentProject: {
      id: 'project-1',
      name: '文艺短片项目',
      projectKind: 'creative' as const,
      flowCount: 1,
      updatedAt: '2026-08-15T01:00:00.000Z',
    },
    workflowProjects: [{
      id: 'ai-project-1',
      name: '一键成片编排',
      projectKind: 'ai_workflow' as const,
      flowCount: 2,
      updatedAt: '2026-08-15T01:00:00.000Z',
      canDelete: true,
      canEdit: true,
    }],
    invocations: [{
      id: 'invocation-1',
      attachmentId: 'attachment-1',
      capabilityId: descriptor.capabilityId,
      capabilityName: descriptor.name,
      sourceId: descriptor.sourceId,
      sourceVersionId: descriptor.sourceVersionId,
      descriptorSha256: warningReport.descriptorSha256,
      workflowExecutionId: 'execution-123456789',
      executionStatus: 'success' as const,
      executionErrorMessage: null,
      agentExecutionId: 'agent-execution-1',
      sessionId: 'session-1',
      toolCallId: 'tool-call-1',
      input: { concurrency: 2 },
      createdAt: '2026-08-15T01:01:00.000Z',
      startedAt: '2026-08-15T01:01:01.000Z',
      finishedAt: '2026-08-15T01:02:00.000Z',
    }],
  }
}

function renderDialog(
  focusRequest?: { requestKey: string; flowId: string },
  strict = false,
  launchScope?: { projectId: string; chapterId?: string; canvasFlowId?: string; selectedGroupIds: readonly string[] },
): void {
  const dialog = (
    <MantineProvider>
      <CapabilityBayDialog opened projectId="project-1" launchScope={launchScope} focusRequest={focusRequest} onClose={vi.fn()} />
    </MantineProvider>
  )
  render(
    strict ? <React.StrictMode>{dialog}</React.StrictMode> : dialog,
  )
}

describe('CapabilityBayDialog', () => {
  beforeEach(() => {
    modelCatalogMocks.imageOptions = [{
      value: 'image-display-name',
      label: '系统图片模型',
      modelKey: 'request/image-model-v114',
      modelAlias: 'image-display-name',
      meta: {
        imageOptions: {
          aspectRatioOptions: [{ value: '9:16', label: '竖屏 9:16' }],
          imageSizeOptions: [{ value: '2K', label: '2K' }],
        },
      },
    }]
    modelCatalogMocks.videoOptions = [{
      value: 'video-display-name',
      label: '系统视频模型',
      modelKey: 'request/video-model-v114',
      modelAlias: 'video-display-name',
      meta: {
        videoOptions: {
          resolutionOptions: [{ value: '1080p', label: '1080p' }],
          sizeOptions: [{ value: '16:9', label: '横屏 16:9', aspectRatio: '16:9' }],
        },
      },
    }]
    modelCatalogMocks.imageLoading = false
    modelCatalogMocks.imageError = null
    modelCatalogMocks.videoLoading = false
    modelCatalogMocks.videoError = null
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
    apiMocks.getBay.mockResolvedValue(bay())
    apiMocks.inspect.mockResolvedValue({
      descriptor,
      descriptorSha256: warningReport.descriptorSha256,
      report: warningReport,
      inspectionToken: 'signed-inspection-token',
    })
    apiMocks.equip.mockResolvedValue(undefined)
    apiMocks.launchWorkflow.mockResolvedValue({
      created: true,
      execution: { id: 'execution-user-1', status: 'queued', createdAt: '2026-09-23T00:00:00.000Z' },
      invocationRecord: { status: 'recorded' },
    })
    apiMocks.cancelWorkflow.mockResolvedValue({
      execution: { id: 'execution-user-1', status: 'canceled' },
      receipt: {},
      localAbortedJobs: 0,
    })
    apiMocks.unequip.mockResolvedValue(undefined)
    apiMocks.updateBuiltIn.mockResolvedValue(undefined)
    apiMocks.updateSkill.mockResolvedValue(undefined)
    apiMocks.updateWorkflow.mockResolvedValue(undefined)
    apiMocks.createProject.mockResolvedValue(undefined)
    apiMocks.deleteProject.mockResolvedValue(undefined)
    apiMocks.adoptProject.mockResolvedValue({
      projectId: 'project-1',
      projectName: '文艺短片项目',
      projectKind: 'ai_workflow',
      flowCount: 1,
      eligibleFlowCount: 1,
      changed: true,
      updatedAt: '2026-08-15T02:00:00.000Z',
    })
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  it('separates visible workflow nodes from inline pipeline steps', async () => {
    const data = bay(true)
    data.candidates[0].descriptor = { ...descriptor, nodeCount: 23 }
    data.candidates[0].nodeBreakdown = { mainNodeCount: 12, inlineStepCount: 11 }
    apiMocks.getBay.mockResolvedValue(data)
    renderDialog()

    expect(await screen.findByText('12 主流程节点 · 11 内嵌步骤')).toBeInTheDocument()
    expect(screen.queryByText('23 节点')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: '已添加' }))
    expect(await screen.findByText('12 主流程节点 · 11 内嵌步骤')).toBeInTheDocument()
  })

  it('shows the workflow timestamp in both lists while preserving the original attachment date', async () => {
    const data = bay(true)
    data.workflowProjects[0].id = descriptor.projectId
    apiMocks.getBay.mockResolvedValue(data)
    renderDialog()

    const format = (value: string) => new Date(value).toLocaleString('zh-CN', { hour12: false })
    const updatedLabel = `更新于 ${format(data.candidates[0].updatedAt)}`
    const attachedLabel = `装载于 ${format('2026-08-21T02:29:48.832Z')}`
    expect(await screen.findByText(updatedLabel)).toBeInTheDocument()
    expect(screen.getByText(attachedLabel)).toBeInTheDocument()
    expect(screen.queryByText(`更新于 ${format(data.workflowProjects[0].updatedAt)}`)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: '已添加' }))
    expect(await screen.findByText(updatedLabel)).toBeInTheDocument()
    expect(screen.getByText(attachedLabel)).toBeInTheDocument()
  })

  it('does not run an equipped workflow when the dialog opens', async () => {
    apiMocks.getBay.mockResolvedValue(bay(true))
    renderDialog(undefined, false, { projectId: 'project-1', chapterId: 'chapter-1', selectedGroupIds: [] })

    expect(await screen.findByText('Agent 配置')).toBeInTheDocument()
    expect(apiMocks.launchWorkflow).not.toHaveBeenCalled()
  })

  it('shows busy immediately, launches the exact selected attachment and scope, then supports cancellation', async () => {
    apiMocks.getBay.mockResolvedValue(bay(true))
    let acceptLaunch: ((value: {
      created: boolean
      execution: { id: string; status: 'queued'; createdAt: string }
      invocationRecord: { status: 'recorded' }
    }) => void) | null = null
    apiMocks.launchWorkflow.mockImplementation(() => new Promise((resolve) => { acceptLaunch = resolve }))
    renderDialog(undefined, false, { projectId: 'project-1', chapterId: 'chapter-13', selectedGroupIds: [] })
    fireEvent.click(await screen.findByRole('tab', { name: '已添加' }))

    const runButton = await screen.findByRole('button', { name: '运行工作流' })
    expect(screen.queryByRole('combobox', { name: '一键成片 图片模型' })).not.toBeInTheDocument()
    fireEvent.click(runButton)
    expect(runButton).toBeDisabled()
    expect(screen.getByRole('button', { name: '启动中…' })).toBeInTheDocument()
    await waitFor(() => expect(apiMocks.launchWorkflow).toHaveBeenCalledWith(expect.objectContaining({
      intent: 'run_selected_equipped_workflow',
      attachmentId: 'attachment-1',
      executionVariant: null,
      projectId: 'project-1',
      chapterId: 'chapter-13',
      idempotencyKey: expect.any(String),
      agentModelKey: 'selected-text-model',
    })))

    await act(async () => {
      acceptLaunch?.({
        created: true,
        execution: { id: 'execution-user-1', status: 'queued', createdAt: '2026-09-23T00:00:00.000Z' },
        invocationRecord: { status: 'recorded' },
      })
    })
    expect(await screen.findByText(/工作流已受理，执行编号：execution-user-1/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '取消执行' }))
    expect(apiMocks.cancelWorkflow).toHaveBeenCalledWith('execution-user-1')
    expect(await screen.findByText('执行 execution-user-1 · canceled')).toBeInTheDocument()
  })

  it('shows only declared media fields and submits explicit catalog requestModelKeys', async () => {
    const data = bay(true)
    const requiredFields = [
      'imageModelKey',
      'imageAspectRatio',
      'imageSize',
      'videoModelKey',
      'videoResolution',
      'videoAspectRatio',
    ]
    const launchDescriptor = {
      ...descriptor,
      invocation: { sourceMode: 'project_context' as const, requiredTriggerPayloadFields: requiredFields },
    }
    data.candidates[0]!.descriptor = launchDescriptor
    data.attachments[0]!.descriptor = launchDescriptor
    apiMocks.getBay.mockResolvedValue(data)
    renderDialog(undefined, false, { projectId: 'project-1', chapterId: 'chapter-13', selectedGroupIds: [] })
    fireEvent.click(await screen.findByRole('tab', { name: '已添加' }))

    const imageModel = screen.getByRole('combobox', { name: '一键成片 图片模型' })
    const imageAspect = screen.getByRole('combobox', { name: '一键成片 图片比例' })
    const imageSize = screen.getByRole('combobox', { name: '一键成片 图片尺寸' })
    const videoModel = screen.getByRole('combobox', { name: '一键成片 视频模型' })
    const videoResolution = screen.getByRole('combobox', { name: '一键成片 视频分辨率' })
    const videoAspect = screen.getByRole('combobox', { name: '一键成片 视频比例' })
    expect(imageModel).toHaveValue('')
    expect(videoModel).toHaveValue('')

    fireEvent.change(imageModel, { target: { value: 'request/image-model-v114' } })
    fireEvent.change(videoModel, { target: { value: 'request/video-model-v114' } })
    expect(screen.getByRole('option', { name: '竖屏 9:16' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '2K' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '1080p' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '横屏 16:9' })).toBeInTheDocument()
    fireEvent.change(imageAspect, { target: { value: '9:16' } })
    fireEvent.change(imageSize, { target: { value: '2K' } })
    fireEvent.change(videoResolution, { target: { value: '1080p' } })
    fireEvent.change(videoAspect, { target: { value: '16:9' } })
    fireEvent.click(screen.getByRole('button', { name: '运行工作流' }))

    await waitFor(() => expect(apiMocks.launchWorkflow).toHaveBeenCalledWith(expect.objectContaining({
      triggerPayload: {
        imageModelKey: 'request/image-model-v114',
        imageAspectRatio: '9:16',
        imageSize: '2K',
        videoModelKey: 'request/video-model-v114',
        videoResolution: '1080p',
        videoAspectRatio: '16:9',
      },
    })))
  })

  it('does not launch when a required model has no system catalog option', async () => {
    const data = bay(true)
    const launchDescriptor = {
      ...descriptor,
      invocation: { sourceMode: 'project_context' as const, requiredTriggerPayloadFields: ['imageModelKey'] },
    }
    data.candidates[0]!.descriptor = launchDescriptor
    data.attachments[0]!.descriptor = launchDescriptor
    apiMocks.getBay.mockResolvedValue(data)
    modelCatalogMocks.imageOptions = []
    renderDialog(undefined, false, { projectId: 'project-1', chapterId: 'chapter-13', selectedGroupIds: [] })
    fireEvent.click(await screen.findByRole('tab', { name: '已添加' }))

    expect(screen.getByRole('combobox', { name: '一键成片 图片模型' })).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: '一键成片 图片比例' })).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: '一键成片 图片尺寸' })).not.toBeInTheDocument()
    expect(await screen.findByText('系统图片模型目录没有可用选项')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '运行工作流' }))
    expect(await screen.findByText('系统图片模型目录没有可用选项，工作流未启动')).toBeInTheDocument()
    expect(apiMocks.launchWorkflow).not.toHaveBeenCalled()
  })

  it('reports launch failure and clears the busy state so the user can retry', async () => {
    apiMocks.getBay.mockResolvedValue(bay(true))
    apiMocks.launchWorkflow.mockRejectedValue(new Error('workflow scope denied'))
    renderDialog(undefined, false, { projectId: 'project-1', canvasFlowId: 'canvas-1', selectedGroupIds: [] })
    fireEvent.click(await screen.findByRole('tab', { name: '已添加' }))

    fireEvent.click(await screen.findByRole('button', { name: '运行工作流' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('工作流启动失败：workflow scope denied')
    await waitFor(() => expect(screen.getByRole('button', { name: '运行工作流' })).toBeEnabled())
  })

  it('shows accepted execution separately when invocation history persistence failed', async () => {
    apiMocks.getBay.mockResolvedValue(bay(true))
    apiMocks.launchWorkflow.mockResolvedValue({
      created: true,
      execution: { id: 'execution-user-accepted', status: 'queued', createdAt: '2026-09-23T00:00:00.000Z' },
      invocationRecord: { status: 'failed', diagnosticId: 'diagnostic-123' },
    })
    renderDialog(undefined, false, { projectId: 'project-1', chapterId: 'chapter-13', selectedGroupIds: [] })
    fireEvent.click(await screen.findByRole('tab', { name: '已添加' }))

    fireEvent.click(await screen.findByRole('button', { name: '运行工作流' }))

    expect(await screen.findByText(
      '工作流已受理，执行编号：execution-user-accepted；使用记录保存失败，诊断编号：diagnostic-123',
    )).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('loads invocation history only after the usage tab is opened', async () => {
    const attached = bay(true)
    apiMocks.getBay.mockImplementation(async (_projectId: string | undefined, options: { includeInvocations?: boolean } | undefined) => ({
      ...attached,
      invocations: options?.includeInvocations ? attached.invocations : [],
    }))
    renderDialog()

    expect(await screen.findByText('Agent 配置')).toBeInTheDocument()
    expect(apiMocks.getBay).toHaveBeenCalledWith('project-1', { includeInvocations: false })
    expect(apiMocks.getBay).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('tab', { name: '使用记录' }))
    expect(await screen.findByText('执行 execution-12 · 固定版本 version-8')).toBeInTheDocument()
    expect(apiMocks.getBay).toHaveBeenLastCalledWith('project-1', { includeInvocations: true })
  })

  it('keeps disabled system workflows collapsed and lets the current user re-enable one', async () => {
    const data = bay(true)
    const baseCandidate = data.candidates[0]
    const baseAttachment = data.attachments[0]
    expect(baseCandidate).toBeDefined()
    expect(baseAttachment).toBeDefined()

    const disabledWorkflows: Array<{ sourceId: string; name: string; revision: number }> = [
      { sourceId: 'system-workflow-a', name: '归档流程 A', revision: 90 },
      { sourceId: 'system-workflow-b', name: '归档流程 B', revision: 1 },
    ]
    for (const workflow of disabledWorkflows) {
      const sourceVersionId = `version-${workflow.revision}`
      const candidate: CapabilityBayCandidateDto = {
        ...baseCandidate!,
        descriptor: {
          ...baseCandidate!.descriptor,
          capabilityId: `workflow:${workflow.sourceId}`,
          name: workflow.name,
          sourceId: workflow.sourceId,
          sourceVersionId,
          sourceRevision: workflow.revision,
        },
      }
      data.candidates.push(candidate)
      data.attachments.push({
        ...baseAttachment!,
        id: `attachment:${workflow.sourceId}`,
        sourceId: workflow.sourceId,
        sourceVersionId,
        descriptor: candidate.descriptor,
        scope: 'all_users',
        userEnabled: false,
      })
    }
    apiMocks.getBay.mockResolvedValue(data)
    renderDialog()

    expect(await screen.findByText('一键成片')).toBeInTheDocument()
    expect(screen.getByText('归档流程 A')).not.toBeVisible()
    expect(screen.getByText('归档流程 B')).not.toBeVisible()
    expect(screen.getByText('已添加 1 个工作流')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: '已添加' }))
    expect(screen.getByText('一键成片')).toBeVisible()
    expect(screen.queryByText('归档流程 A')).not.toBeInTheDocument()
    expect(screen.queryByText('归档流程 B')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: '工作流' }))

    const summary = screen.getByText('已关闭的系统工作流（2）')
    const section = summary.closest('details')
    expect(section).not.toHaveAttribute('open')
    fireEvent.click(summary)
    expect(section).toHaveAttribute('open')
    expect(within(section!).getByText('归档流程 A')).toBeInTheDocument()
    expect(within(section!).getByText('归档流程 B')).toBeInTheDocument()

    fireEvent.click(within(section!).getAllByRole('button', { name: '启用' })[0]!)
    await waitFor(() => expect(apiMocks.updateWorkflow).toHaveBeenCalledWith('system-workflow-a', true))
    expect(await screen.findByRole('status')).toHaveTextContent('系统级工作流“归档流程 A”已启用（仅对当前账号生效）')
  })

  it('leaves the loading state and exposes a retryable error when loading times out', async () => {
    apiMocks.getBay.mockRejectedValueOnce(new Error('加载 Agent 配置超时（15 秒），请重试；服务端不会继续无期限占用页面'))
    renderDialog()

    expect(await screen.findByRole('alert')).toHaveTextContent('加载 Agent 配置超时（15 秒）')
    expect(screen.queryByText('正在加载 Agent 配置…')).not.toBeInTheDocument()

    apiMocks.getBay.mockResolvedValueOnce(bay())
    fireEvent.click(screen.getByRole('button', { name: '刷新能力状态' }))

    expect(await screen.findByText('一键成片')).toBeInTheDocument()
    expect(apiMocks.getBay).toHaveBeenCalledTimes(2)
  })

  it('coalesces the StrictMode effect replay into one capability request', async () => {
    let resolveBay!: (value: ReturnType<typeof bay>) => void
    const pendingBay = new Promise<ReturnType<typeof bay>>((resolve) => {
      resolveBay = resolve
    })
    apiMocks.getBay.mockReturnValueOnce(pendingBay)

    renderDialog(undefined, true)

    await waitFor(() => expect(apiMocks.getBay).toHaveBeenCalledTimes(1))
    expect(apiMocks.getBay).toHaveBeenCalledWith('project-1', { includeInvocations: false })
    resolveBay(bay())
    expect(await screen.findByText('一键成片')).toBeInTheDocument()
    expect(apiMocks.getBay).toHaveBeenCalledTimes(1)
  })

  it('shows real side effects, explains semantic overlap, and requires explicit confirmation', async () => {
    renderDialog()

    expect(await screen.findByText('一键成片')).toBeInTheDocument()
  expect(apiMocks.getBay).toHaveBeenCalledWith('project-1', { includeInvocations: false })
    expect(screen.getByText('文艺短片项目')).toBeInTheDocument()
    expect(screen.getByText('会写入外部结果 · 可能产生媒体费用')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '检查并添加' }))

    expect(await screen.findByText('与内置成片能力职责重叠')).toBeInTheDocument()
    expect(screen.getByText('两者都能从主题生成完整视频。')).toBeInTheDocument()
    expect(screen.getByText('当前使用')).toBeInTheDocument()
    expect(screen.getByText('准备替换为')).toBeInTheDocument()
    expect(screen.getByText('发现 1 项检查结果，其中 1 项需要你选择处理方式；其余确认后自动采纳建议。')).toBeInTheDocument()
    // 未选择处理方式前，底部按钮禁用，并给出明确的“怎么确认”指引
    expect(screen.getByRole('button', { name: '添加给小T' })).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('请先为「与内置成片能力职责重叠」选择处理方式：用新工作流替换 / 保留当前，不添加 / 编辑为委托关系。')
    fireEvent.click(screen.getByRole('button', { name: '用新工作流替换' }))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '确认替换并添加' }))

    await waitFor(() => expect(apiMocks.equip).toHaveBeenCalledWith({
      flowId: descriptor.sourceId,
      sourceVersionId: descriptor.sourceVersionId,
      descriptorSha256: warningReport.descriptorSha256,
      inspectionToken: 'signed-inspection-token',
      resolutions: [{
        conflictId: 'semantic:builtin-video',
        withCapabilityId: 'tapcanvas-video-workflow',
        action: 'replace_existing',
      }],
      scope: 'current_user',
    }))
    expect(await screen.findByText('“一键成片”已添加，小T现在可以使用')).toBeInTheDocument()
  })

  it('marks acknowledge-only conflicts as auto-resolved and keeps only the primary route interactive', async () => {
    const mixedReport = {
      protocolVersion: 'tapcanvas.capability-conflict-report/v1' as const,
      targetCapabilityId: descriptor.capabilityId,
      checkedAt: '2026-08-15T00:00:00.000Z',
      descriptorSha256: warningReport.descriptorSha256,
      conflicts: [
        ...warningReport.conflicts,
        {
          id: 'info:skill-overlap',
          severity: 'info' as const,
          category: 'semantic_overlap' as const,
          withCapabilityId: 'skill-1',
          resolutionMode: 'acknowledge' as const,
          title: '方法论重叠',
          rationale: '仅作参考。',
          resolution: '忽略。',
        },
      ],
      blocking: false,
      requiresConfirmation: true,
    }
    apiMocks.inspect.mockResolvedValue({
      descriptor,
      descriptorSha256: mixedReport.descriptorSha256,
      report: mixedReport,
      inspectionToken: 'signed-inspection-token',
    })
    renderDialog()

    await screen.findByText('一键成片')
    fireEvent.click(screen.getByRole('button', { name: '检查并添加' }))

    expect(await screen.findByText('发现 2 项检查结果，其中 1 项需要你选择处理方式；其余确认后自动采纳建议。')).toBeInTheDocument()
    expect(screen.getAllByText('确认后自动采纳建议')).toHaveLength(1)
    // 只有 choose_primary 冲突提供处理方式按钮
    expect(screen.getAllByRole('button', { name: /用新工作流替换|保留当前，不添加|编辑为委托关系/ })).toHaveLength(3)
    expect(screen.getByRole('button', { name: '添加给小T' })).toBeDisabled()
  })

  it('offers update instead of reuse when the saved workflow version changed', async () => {
    apiMocks.getBay.mockResolvedValue(bay(true, true))
    renderDialog()

    expect(await screen.findByText('有新版本')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '检查并更新' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '移除' })).not.toBeInTheDocument()
  })

  it('does not count a historical attachment without single-track confirmation as equipped', async () => {
    apiMocks.getBay.mockResolvedValue(bay(true, true, false))
    renderDialog()

    expect(await screen.findByText('待重新确认')).toBeInTheDocument()
    expect(screen.getByText('已添加 0 个工作流')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重新检查' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: '已添加' }))
    expect(screen.getByText('还没有添加工作流')).toBeInTheDocument()
  })

  it('unequips without presenting workflow deletion as part of the action', async () => {
    apiMocks.getBay.mockResolvedValue(bay(true))
    renderDialog()

    fireEvent.click(await screen.findByRole('tab', { name: '已添加' }))
    fireEvent.click(await screen.findByRole('button', { name: '移除' }))
    await waitFor(() => expect(apiMocks.unequip).toHaveBeenCalledWith(descriptor.sourceId))
    expect(await screen.findByText('“一键成片”已从 Agent 配置中移除；工作流本身仍保留')).toBeInTheDocument()
  })

  it('deletes an owned workflow project only after explicit confirmation', async () => {
    const confirm = vi.fn().mockReturnValue(true)
    vi.stubGlobal('confirm', confirm)
    renderDialog()

    fireEvent.click(await screen.findByRole('tab', { name: '工作流' }))
    fireEvent.click(await screen.findByRole('button', { name: '删除' }))

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('一键成片编排'))
    await waitFor(() => expect(apiMocks.deleteProject).toHaveBeenCalledWith('ai-project-1'))
  })

  it('keeps the final action disabled for a blocking conflict', async () => {
    apiMocks.inspect.mockResolvedValue({
      descriptor,
      descriptorSha256: warningReport.descriptorSha256,
      inspectionToken: 'signed-inspection-token',
      report: {
        ...warningReport,
        conflicts: [{
          ...warningReport.conflicts[0],
          id: 'goal:exclusive-output',
          severity: 'blocking' as const,
          category: 'goal_contradiction' as const,
          title: '输出目标互相排斥',
        }],
        blocking: true,
        requiresConfirmation: false,
      },
    })
    renderDialog()

    fireEvent.click(await screen.findByRole('button', { name: '检查并添加' }))
    expect(await screen.findByText('输出目标互相排斥')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '添加给小T' })).toBeDisabled()
  })

  it('keeps the current primary capability without equipping a competing workflow', async () => {
    renderDialog()

    fireEvent.click(await screen.findByRole('button', { name: '检查并添加' }))
    fireEvent.click(await screen.findByRole('button', { name: '保留当前，不添加' }))
    fireEvent.click(screen.getByRole('button', { name: '保留当前设置' }))

    expect(apiMocks.equip).not.toHaveBeenCalled()
    expect(await screen.findByText('已保留当前设置；“一键成片”未添加')).toBeInTheDocument()
  })

  it('lets the user disable Skills and built-in capabilities explicitly', async () => {
    renderDialog()

    await screen.findByText('一键成片')
    fireEvent.click(screen.getByRole('tab', { name: '技能' }))
    expect(screen.getByText('视频工作流')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '停用' }))
    await waitFor(() => expect(apiMocks.updateSkill).toHaveBeenCalledWith('tapcanvas-video-workflow', false))

    fireEvent.click(screen.getByRole('tab', { name: '内置功能' }))
		expect(screen.getAllByText('一键成片').length).toBeGreaterThan(0)
    expect(screen.getByText('小T内置功能')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '停用' }))
		await waitFor(() => expect(apiMocks.updateBuiltIn).toHaveBeenCalledWith('one_click_video', false))
  })

  it('shows a system stop and prevents the user from overriding the administrator', async () => {
    apiMocks.getBay.mockResolvedValue(bay(false, false, false, false))
    renderDialog()

    await screen.findByText('一键成片')
    fireEvent.click(screen.getByRole('tab', { name: '内置功能' }))

    expect(screen.getByText('管理员已停用')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '系统停用' })).toBeDisabled()
    expect(apiMocks.updateBuiltIn).not.toHaveBeenCalled()
  })

  it('distinguishes AI workflow projects and exposes immutable invocation history', async () => {
    renderDialog()

    await screen.findByText('一键成片')
    fireEvent.click(screen.getByRole('tab', { name: '工作流' }))
    expect(screen.getAllByText('一键成片编排').length).toBeGreaterThan(0)
    expect(screen.getByText('2 个工作流画布')).toBeInTheDocument()
    expect(screen.getByText('从主题规划到真实视频交付')).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: '可添加' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: '使用记录' }))
    expect(screen.getByText('执行 execution-12 · 固定版本 version-8')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '原始快照' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '节点执行' })).toBeInTheDocument()
  })

  it('renders one workflow card with edit and add actions when the project and capability are the same workflow', async () => {
    const base = bay()
    const aligned = {
      ...base,
      workflowProjects: [{
        id: 'project-1',
        name: '文艺短片项目',
        projectKind: 'ai_workflow' as const,
        flowCount: 1,
        updatedAt: '2026-08-15T01:00:00.000Z',
        canDelete: true,
        canEdit: true,
      }],
      currentProject: { ...base.currentProject, projectKind: 'ai_workflow' as const },
    }
    apiMocks.getBay.mockResolvedValue(aligned)
    renderDialog()

    const workflowTitle = await screen.findByText('一键成片')
    const workflowCard = workflowTitle.closest('article')
    expect(workflowCard).not.toBeNull()
    const workflowActions = within(workflowCard as HTMLElement)
    expect(workflowActions.getByRole('button', { name: '编辑' })).toBeEnabled()
    expect(workflowActions.getByRole('button', { name: '检查并添加' })).toBeEnabled()
    expect(screen.getAllByText('一键成片')).toHaveLength(1)
  })

  it('shows a shared system workflow without offering project editing or publisher update', async () => {
    const data = bay(true, true)
    const sharedCandidate = data.candidates[0]!
    sharedCandidate.canEdit = false
    sharedCandidate.descriptor = { ...sharedCandidate.descriptor, projectId: 'system-project' }
    data.attachments[0]!.scope = 'all_users'
    data.attachments[0]!.descriptor = sharedCandidate.descriptor
    apiMocks.getBay.mockResolvedValue(data)
    renderDialog()

    const card = (await screen.findByText('一键成片')).closest('article')
    expect(card).not.toBeNull()
    const actions = within(card as HTMLElement)
    expect(actions.getByText('系统发布 · 全体用户')).toBeInTheDocument()
    expect(actions.queryByRole('button', { name: '编辑' })).not.toBeInTheDocument()
    expect(actions.queryByRole('button', { name: '检查并更新' })).not.toBeInTheDocument()
    fireEvent.click(actions.getByRole('button', { name: '关闭' }))
    await waitFor(() => expect(apiMocks.updateWorkflow).toHaveBeenCalledWith('flow-one-click', false))
  })

  it('offers source editing to an administrator who can manage the published workflow project', async () => {
    const data = bay(true, true)
    data.candidates[0]!.descriptor = { ...data.candidates[0]!.descriptor, projectId: 'system-project' }
    data.attachments[0]!.scope = 'all_users'
    data.workflowProjects[0] = {
      ...data.workflowProjects[0]!,
      id: 'system-project',
      canEdit: true,
      canDelete: false,
    }
    apiMocks.getBay.mockResolvedValue(data)
    renderDialog()

    const card = (await screen.findByText('一键成片')).closest('article')
    expect(card).not.toBeNull()
    const actions = within(card as HTMLElement)
    expect(actions.getByRole('button', { name: '编辑' })).toBeEnabled()
    expect(actions.queryByRole('button', { name: '删除' })).not.toBeInTheDocument()
  })

  it('explicitly adopts the current ordinary project without creating or copying a project', async () => {
    const initial = bay()
    const adopted = {
      ...initial,
      currentProject: { ...initial.currentProject, projectKind: 'ai_workflow' as const },
      workflowProjects: [{
        id: 'project-1',
        name: '文艺短片项目',
        projectKind: 'ai_workflow' as const,
        flowCount: 1,
        updatedAt: '2026-08-15T02:00:00.000Z',
      }],
    }
    apiMocks.getBay.mockResolvedValueOnce(initial).mockResolvedValueOnce(adopted)
    renderDialog()

    await screen.findByText('一键成片')
    fireEvent.click(screen.getByRole('tab', { name: '工作流' }))
    fireEvent.click(screen.getByRole('button', { name: '纳入工作流项目' }))

    await waitFor(() => expect(apiMocks.adoptProject).toHaveBeenCalledWith('project-1'))
    expect(apiMocks.createProject).not.toHaveBeenCalled()
    expect(await screen.findByText('“文艺短片项目”已纳入工作流项目；原画布和历史版本保持不变')).toBeInTheDocument()
  })

  it('shows an explicit load failure without also claiming the library is empty', async () => {
    apiMocks.getBay.mockRejectedValue(new Error('能力服务未部署'))
    renderDialog()

    expect(await screen.findByRole('alert')).toHaveTextContent('能力服务未部署')
    expect(screen.queryByText('还没有工作流项目')).not.toBeInTheDocument()
    expect(screen.queryByText('没有可添加或更新的已保存工作流')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '关闭 Agent 配置' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '搜索工作流或功能' })).toBeInTheDocument()
  })

  it('automatically inspects the exact saved Flow requested from the canvas', async () => {
    renderDialog({ requestKey: 'request-1', flowId: descriptor.sourceId })

    expect(await screen.findByText('添加前检查')).toBeInTheDocument()
    expect(apiMocks.inspect).toHaveBeenCalledTimes(1)
    expect(apiMocks.inspect).toHaveBeenCalledWith(descriptor.sourceId)
  })

  it('opens an already current attachment without repeating inspection', async () => {
    apiMocks.getBay.mockResolvedValue(bay(true))
    renderDialog({ requestKey: 'request-2', flowId: descriptor.sourceId })

    expect(await screen.findByText('“一键成片”已添加，小T可以直接使用')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '已添加' })).toHaveAttribute('aria-selected', 'true')
    expect(apiMocks.inspect).not.toHaveBeenCalled()
  })

  it('reports when the saved Flow is not a capability candidate', async () => {
    renderDialog({ requestKey: 'request-3', flowId: 'missing-flow' })

    expect(await screen.findByRole('alert')).toHaveTextContent('当前保存版本无法添加到 Agent 配置')
    expect(apiMocks.inspect).not.toHaveBeenCalled()
  })
})
