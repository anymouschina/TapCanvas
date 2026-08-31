// @vitest-environment jsdom
import React from 'react'
import '@testing-library/jest-dom/vitest'
import { MantineProvider } from '@mantine/core'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CapabilityBayDialog } from './CapabilityBayDialog'

const apiMocks = vi.hoisted(() => ({
  adoptProject: vi.fn(),
  createProject: vi.fn(),
  deleteProject: vi.fn(),
  equip: vi.fn(),
  getBay: vi.fn(),
  inspect: vi.fn(),
  updateBuiltIn: vi.fn(),
  updateSkill: vi.fn(),
  unequip: vi.fn(),
}))

vi.mock('../../api/server', () => ({
  adoptAiWorkflowProject: apiMocks.adoptProject,
  createAiWorkflowProject: apiMocks.createProject,
  deleteAiWorkflowProject: apiMocks.deleteProject,
  equipWorkflowCapability: apiMocks.equip,
  getCapabilityBay: apiMocks.getBay,
  inspectWorkflowCapability: apiMocks.inspect,
  updateBuiltInCapabilityState: apiMocks.updateBuiltIn,
  updateSkillCapabilityState: apiMocks.updateSkill,
  unequipWorkflowCapability: apiMocks.unequip,
}))

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
  operations: ['agent', 'video_submission'],
  requiredSkills: [],
  requiredTools: ['tapcanvas_video_orchestrate'],
  inputArtifacts: ['topic'],
  outputArtifacts: ['video'],
  permissions: ['project:read', 'canvas:write', 'media:generate:paid'],
  sideEffects: ['external_mutation', 'paid_generation'] as const,
  semanticEvidence: [{ label: 'BeatSheet Agent', description: '规划镜头节奏', operation: 'agent' }],
}

const warningReport = {
  protocolVersion: 'tapcanvas.capability-conflict-report/v1' as const,
  targetCapabilityId: descriptor.capabilityId,
  checkedAt: '2026-08-15T00:00:00.000Z',
  descriptorSha256: 'a'.repeat(64),
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

function bay(attached = false, stale = false, routingReady = attached, systemEnabled = true) {
  return {
    productName: 'Agent 配置' as const,
    candidates: [{
      descriptor,
      descriptorSha256: warningReport.descriptorSha256,
      projectName: '文艺短片项目',
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
): void {
  const dialog = (
    <MantineProvider>
      <CapabilityBayDialog opened projectId="project-1" focusRequest={focusRequest} onClose={vi.fn()} />
    </MantineProvider>
  )
  render(
    strict ? <React.StrictMode>{dialog}</React.StrictMode> : dialog,
  )
}

describe('CapabilityBayDialog', () => {
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
    apiMocks.getBay.mockResolvedValue(bay())
    apiMocks.inspect.mockResolvedValue({
      descriptor,
      descriptorSha256: warningReport.descriptorSha256,
      report: warningReport,
      inspectionToken: 'signed-inspection-token',
    })
    apiMocks.equip.mockResolvedValue(undefined)
    apiMocks.unequip.mockResolvedValue(undefined)
    apiMocks.updateBuiltIn.mockResolvedValue(undefined)
    apiMocks.updateSkill.mockResolvedValue(undefined)
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
    expect(apiMocks.getBay).toHaveBeenCalledWith('project-1')
    resolveBay(bay())
    expect(await screen.findByText('一键成片')).toBeInTheDocument()
    expect(apiMocks.getBay).toHaveBeenCalledTimes(1)
  })

  it('shows real side effects, explains semantic overlap, and requires explicit confirmation', async () => {
    renderDialog()

    expect(await screen.findByText('一键成片')).toBeInTheDocument()
	expect(apiMocks.getBay).toHaveBeenCalledWith('project-1')
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
