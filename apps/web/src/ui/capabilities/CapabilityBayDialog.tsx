import React from 'react'
import { Modal, Tooltip } from '@mantine/core'
import {
  IconAlertTriangle,
  IconArrowRight,
  IconBolt,
  IconBrain,
  IconCheck,
  IconEdit,
  IconFileSearch,
  IconHistory,
  IconLoader2,
  IconPlus,
  IconPlugConnected,
  IconPlugConnectedX,
  IconRefresh,
  IconSearch,
  IconShieldCheck,
  IconSparkles,
  IconTopologyStar3,
  IconTrash,
} from '@tabler/icons-react'
import {
  adoptAiWorkflowProject,
  createAiWorkflowProject,
  deleteAiWorkflowProject,
  equipWorkflowCapability,
  getCapabilityBay,
  inspectWorkflowCapability,
  updateBuiltInCapabilityState,
  updateSkillCapabilityState,
  updateWorkflowCapabilityState,
  unequipWorkflowCapability,
  type CapabilityBayCandidateDto,
  type CapabilityBayDto,
  type CapabilityInspectionDto,
} from '../../api/server'
import { ManagedImage } from '../../domain/resource-runtime/components/ManagedImage'
import { ExecutionLogModal } from '../ExecutionLogModal'
import { WorkflowExecutionSnapshotModal } from '../WorkflowExecutionSnapshotModal'
import { isCurrentUserAdmin } from '../../auth/isAdmin'
import './CapabilityBayDialog.css'

type WorkflowEquipScope = 'current_user' | 'all_users'

type CapabilityBayDialogProps = {
  opened: boolean
  projectId?: string
  focusRequest?: { requestKey: string; flowId: string } | null
  onClose: () => void
}

type CapabilityBayTab = 'workflows' | 'equipped' | 'skills' | 'built_in' | 'invocations'
type PrimaryRouteDecision = 'replace_existing' | 'keep_existing' | 'edit_workflow'
type WorkflowCatalogItem = {
  key: string
  projectId: string | null
  projectName: string
  flowCount: number
  updatedAt: string | null
  candidate: CapabilityBayCandidateDto | null
  canDelete: boolean
}

type PendingCapabilityBayLoad = {
  projectKey: string
  promise: Promise<void>
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function effectLabel(effect: CapabilityBayCandidateDto['descriptor']['sideEffects'][number]): string {
  if (effect === 'paid_generation') return '可能产生媒体费用'
  if (effect === 'external_mutation') return '会写入外部结果'
  if (effect === 'local_mutation') return '会修改画布'
  return '只读或纯计算'
}

export function CapabilityBayDialog({ opened, projectId, focusRequest = null, onClose }: CapabilityBayDialogProps): JSX.Element {
  const [data, setData] = React.useState<CapabilityBayDto | null>(null)
  const [activeTab, setActiveTab] = React.useState<CapabilityBayTab>('workflows')
  const [query, setQuery] = React.useState('')
  const [loading, setLoading] = React.useState(false)
  const [busyFlowId, setBusyFlowId] = React.useState('')
  const [error, setError] = React.useState('')
  const [notice, setNotice] = React.useState('')
  const [inspection, setInspection] = React.useState<CapabilityInspectionDto | null>(null)
  const [routeDecisions, setRouteDecisions] = React.useState<Record<string, PrimaryRouteDecision>>({})
  // 工作流装配给小T的作用范围：管理员可选全体用户/当前用户；普通用户保持 current_user。
  const [equipScope, setEquipScope] = React.useState<WorkflowEquipScope>('current_user')
  const adminUser = React.useMemo(() => isCurrentUserAdmin(), [])
  const [newProjectName, setNewProjectName] = React.useState('')
  const [creatingProject, setCreatingProject] = React.useState(false)
  const [adoptingProject, setAdoptingProject] = React.useState(false)
  const [snapshotExecutionId, setSnapshotExecutionId] = React.useState<string | null>(null)
  const [logExecutionId, setLogExecutionId] = React.useState<string | null>(null)
  const handledFocusRequestRef = React.useRef('')
  const pendingLoadRef = React.useRef<PendingCapabilityBayLoad | null>(null)

  const load = React.useCallback(async (): Promise<void> => {
    const projectKey = projectId?.trim() ?? ''
    const pending = pendingLoadRef.current
    if (pending?.projectKey === projectKey) return pending.promise

    setLoading(true)
    setError('')
    const entry: PendingCapabilityBayLoad = {
      projectKey,
      promise: Promise.resolve(),
    }
    pendingLoadRef.current = entry
    entry.promise = (async (): Promise<void> => {
      try {
        const nextData = await getCapabilityBay(projectKey || undefined)
        if (pendingLoadRef.current === entry) setData(nextData)
      } catch (nextError: unknown) {
        if (pendingLoadRef.current === entry) setError(errorMessage(nextError))
      } finally {
        if (pendingLoadRef.current === entry) {
          pendingLoadRef.current = null
          setLoading(false)
        }
      }
    })()
    return entry.promise
  }, [projectId])

  React.useEffect(() => {
    if (!opened) return
    setData(null)
    setNotice('')
    setInspection(null)
    setRouteDecisions({})
    void load()
  }, [load, opened])

  const equippedCandidates = React.useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    const source = data?.candidates ?? []
    const routingReadySourceIds = new Set((data?.attachments ?? [])
      .filter((attachment) => attachment.routingReady)
      .map((attachment) => attachment.sourceId))
    return source.filter((candidate) => {      const routingReady = routingReadySourceIds.has(candidate.descriptor.sourceId)
      if (!routingReady) return false
      if (!normalized) return true
      return [candidate.descriptor.name, candidate.descriptor.summary, candidate.projectName ?? '', ...candidate.descriptor.operations]
        .join(' ')
        .toLocaleLowerCase()
        .includes(normalized)
    })
  }, [data?.attachments, data?.candidates, query])

  const routingReadySourceIds = React.useMemo(() => new Set((data?.attachments ?? [])
    .filter((attachment) => attachment.routingReady)
    .map((attachment) => attachment.sourceId)), [data?.attachments])

  const attachmentScopeBySourceId = React.useMemo(() => new Map((data?.attachments ?? [])
    .map((attachment) => [attachment.sourceId, attachment.scope] as const)), [data?.attachments])

  const userEnabledBySourceId = React.useMemo(() => new Map((data?.attachments ?? [])
    .map((attachment) => [attachment.sourceId, attachment.userEnabled] as const)), [data?.attachments])

  const inspect = React.useCallback(async (candidate: CapabilityBayCandidateDto): Promise<void> => {
    setBusyFlowId(candidate.descriptor.sourceId)
    setError('')
    setNotice('')
    setInspection(null)
    setRouteDecisions({})
    try {
      setInspection(await inspectWorkflowCapability(candidate.descriptor.sourceId))
    } catch (nextError: unknown) {
      setError(errorMessage(nextError))
    } finally {
      setBusyFlowId('')
    }
  }, [])

  React.useEffect(() => {
    if (!opened || !data || !focusRequest) return
    if (handledFocusRequestRef.current === focusRequest.requestKey) return
    handledFocusRequestRef.current = focusRequest.requestKey
    setQuery('')

    const candidate = data.candidates.find(
      (item) => item.descriptor.sourceId === focusRequest.flowId,
    )
    if (!candidate) {
      setError('当前保存版本无法添加到 Agent 配置；请确认整张工作流只有一个触发器，且至少包含一个执行步骤')
      return
    }
    if (routingReadySourceIds.has(candidate.descriptor.sourceId) && !candidate.stale) {
      setActiveTab('equipped')
      setNotice(`“${candidate.descriptor.name}”已添加，小T可以直接使用`)
      return
    }
    setActiveTab('workflows')
    void inspect(candidate)
  }, [data, focusRequest, inspect, opened, routingReadySourceIds])

  const equip = React.useCallback(async (): Promise<void> => {
    if (!inspection) return
    const flowId = inspection.descriptor.sourceId
    setBusyFlowId(flowId)
    setError('')
    try {
      await equipWorkflowCapability({
        flowId,
        sourceVersionId: inspection.descriptor.sourceVersionId,
        descriptorSha256: inspection.descriptorSha256,
        inspectionToken: inspection.inspectionToken,
        resolutions: inspection.report.conflicts.map((conflict) => ({
          conflictId: conflict.id,
          withCapabilityId: conflict.withCapabilityId,
          action: conflict.resolutionMode === 'choose_primary' ? 'replace_existing' : 'acknowledge',
        })),
        scope: equipScope,
      })
      setInspection(null)
      setNotice(`“${inspection.descriptor.name}”已添加，小T现在可以使用${equipScope === 'all_users' ? '（全体用户）' : ''}`)
      await load()
    } catch (nextError: unknown) {
      setError(errorMessage(nextError))
    } finally {
      setBusyFlowId('')
    }
  }, [inspection, load, equipScope])

  const unequip = React.useCallback(async (candidate: CapabilityBayCandidateDto): Promise<void> => {
    setBusyFlowId(candidate.descriptor.sourceId)
    setError('')
    setInspection(null)
    try {
      await unequipWorkflowCapability(candidate.descriptor.sourceId)
      setNotice(`“${candidate.descriptor.name}”已从 Agent 配置中移除；工作流本身仍保留`)
      await load()
    } catch (nextError: unknown) {
      setError(errorMessage(nextError))
    } finally {
      setBusyFlowId('')
    }
  }, [load])

  // 系统级工作流：普通用户可手动关闭/重新启用（针对自己），不影响其他用户。
  const toggleWorkflow = React.useCallback(async (candidate: CapabilityBayCandidateDto, enabled: boolean): Promise<void> => {
    setBusyFlowId(candidate.descriptor.sourceId)
    setError('')
    setInspection(null)
    try {
      await updateWorkflowCapabilityState(candidate.descriptor.sourceId, enabled)
      setNotice(`系统级工作流“${candidate.descriptor.name}”已${enabled ? '启用' : '关闭'}（仅对当前账号生效）`)
      await load()
    } catch (nextError: unknown) {
      setError(errorMessage(nextError))
    } finally {
      setBusyFlowId('')
    }
  }, [load])

  const toggleSkill = React.useCallback(async (skillKey: string, enabled: boolean): Promise<void> => {
    setBusyFlowId(`skill:${skillKey}`)
    setError('')
    setInspection(null)
    setRouteDecisions({})
    try {
      await updateSkillCapabilityState(skillKey, enabled)
      setNotice(`Skill “${skillKey}”已${enabled ? '启用' : '停用'}`)
      await load()
    } catch (nextError: unknown) {
      setError(errorMessage(nextError))
    } finally {
      setBusyFlowId('')
    }
  }, [load])

  const toggleBuiltInCapability = React.useCallback(async (capabilityKey: string, enabled: boolean): Promise<void> => {
    setBusyFlowId(`built_in:${capabilityKey}`)
    setError('')
    setInspection(null)
    setRouteDecisions({})
    try {
      await updateBuiltInCapabilityState(capabilityKey, enabled)
      const capabilityName = data?.builtInCapabilities.find((item) => item.key === capabilityKey)?.name ?? capabilityKey
      setNotice(`内置功能“${capabilityName}”已${enabled ? '启用' : '停用'}`)
      await load()
    } catch (nextError: unknown) {
      setError(errorMessage(nextError))
    } finally {
      setBusyFlowId('')
    }
  }, [data?.builtInCapabilities, load])

  const skillItems = React.useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    return (data?.skills ?? []).filter((skill) => !normalized || [skill.name, skill.key, skill.description ?? '', skill.category]
      .join(' ')
      .toLocaleLowerCase()
      .includes(normalized))
  }, [data?.skills, query])

  const builtInItems = React.useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    return (data?.builtInCapabilities ?? []).filter((capability) => !normalized || [capability.name, capability.key, capability.description]
      .join(' ')
      .toLocaleLowerCase()
      .includes(normalized))
  }, [data?.builtInCapabilities, query])

  const workflowCatalogItems = React.useMemo<WorkflowCatalogItem[]>(() => {
    const normalized = query.trim().toLocaleLowerCase()
    const projects = data?.workflowProjects ?? []
    const sourceCandidates = data?.candidates ?? []
    const candidatesByProjectId = new Map<string, CapabilityBayCandidateDto[]>()
    for (const candidate of sourceCandidates) {
      const candidateProjectId = candidate.descriptor.projectId?.trim()
      if (!candidateProjectId) continue
      const projectCandidates = candidatesByProjectId.get(candidateProjectId) ?? []
      projectCandidates.push(candidate)
      candidatesByProjectId.set(candidateProjectId, projectCandidates)
    }

    const managedProjectIds = new Set(projects.map((project) => project.id))
    const items: WorkflowCatalogItem[] = []
    for (const project of projects) {
      const projectCandidates = candidatesByProjectId.get(project.id) ?? []
      if (projectCandidates.length === 0) {
        items.push({
          key: `project:${project.id}`,
          projectId: project.id,
          projectName: project.name,
          flowCount: project.flowCount,
          updatedAt: project.updatedAt,
          candidate: null,
          canDelete: project.canDelete,
        })
        continue
      }
      for (const candidate of projectCandidates) {
        items.push({
          key: `flow:${candidate.descriptor.sourceId}`,
          projectId: project.id,
          projectName: project.name,
          flowCount: project.flowCount,
          updatedAt: project.updatedAt,
          candidate,
          canDelete: project.canDelete,
        })
      }
    }
    for (const candidate of sourceCandidates) {
      const candidateProjectId = candidate.descriptor.projectId?.trim() || null
      if (candidateProjectId && managedProjectIds.has(candidateProjectId)) continue
      items.push({
        key: `flow:${candidate.descriptor.sourceId}`,
        projectId: candidateProjectId,
        projectName: candidate.projectName || '个人工作流',
        flowCount: 1,
        updatedAt: null,
        candidate,
        canDelete: false,
      })
    }

    if (!normalized) return items
    return items.filter((item) => {
      const candidate = item.candidate
      return [
        item.projectName,
        candidate?.descriptor.name ?? '',
        candidate?.descriptor.summary ?? '',
        ...(candidate?.descriptor.operations ?? []),
      ].join(' ').toLocaleLowerCase().includes(normalized)
    })
  }, [data?.candidates, data?.workflowProjects, query])

  const deleteProject = React.useCallback(async (item: WorkflowCatalogItem): Promise<void> => {
    if (!item.projectId || !item.canDelete) return
    const confirmed = window.confirm(`确定删除工作流项目“${item.projectName}”吗？\n\n这会删除项目内的工作流、版本、执行记录和项目素材，且不可恢复。`)
    if (!confirmed) return
    setBusyFlowId(`project:${item.projectId}`)
    setError('')
    setNotice('')
    setInspection(null)
    try {
      await deleteAiWorkflowProject(item.projectId)
      setNotice(`工作流项目“${item.projectName}”已删除`)
      await load()
    } catch (nextError: unknown) {
      setError(errorMessage(nextError))
    } finally {
      setBusyFlowId('')
    }
  }, [load])

  const invocationItems = React.useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    return (data?.invocations ?? []).filter((invocation) => !normalized || [
      invocation.capabilityName,
      invocation.capabilityId,
      invocation.workflowExecutionId,
      invocation.executionStatus,
    ].join(' ').toLocaleLowerCase().includes(normalized))
  }, [data?.invocations, query])

  const openWorkflowEditor = React.useCallback((targetProjectId: string, flowId?: string): void => {
    const params = new URLSearchParams({
      projectId: targetProjectId,
      ownerType: 'project',
      ownerId: targetProjectId,
    })
    if (flowId) params.set('flowId', flowId)
    window.location.assign(`/studio?${params.toString()}`)
  }, [])

  const createProject = React.useCallback(async (): Promise<void> => {
    const name = newProjectName.trim()
    if (!name) {
      setError('请先输入工作流项目名称')
      return
    }
    setCreatingProject(true)
    setError('')
    try {
      const created = await createAiWorkflowProject(name)
      openWorkflowEditor(created.projectId, created.flowId)
    } catch (nextError: unknown) {
      setError(errorMessage(nextError))
      setCreatingProject(false)
    }
  }, [newProjectName, openWorkflowEditor])

  const adoptCurrentProject = React.useCallback(async (): Promise<void> => {
    const currentProject = data?.currentProject
    if (!currentProject || currentProject.projectKind === 'ai_workflow') return
    setAdoptingProject(true)
    setError('')
    setNotice('')
    try {
      const result = await adoptAiWorkflowProject(currentProject.id)
      setNotice(`“${result.projectName}”已纳入工作流项目；原画布和历史版本保持不变`)
      await load()
    } catch (nextError: unknown) {
      setError(errorMessage(nextError))
    } finally {
      setAdoptingProject(false)
    }
  }, [data?.currentProject, load])

  const selectedCandidate = data?.candidates.find((candidate) => (
    candidate.descriptor.sourceId === (
      inspection?.descriptor.sourceId ?? focusRequest?.flowId
    )
  )) ?? null

  const primaryRouteConflicts = inspection?.report.conflicts.filter(
    (conflict) => conflict.resolutionMode === 'choose_primary',
  ) ?? []
  const allPrimaryRoutesDecided = primaryRouteConflicts.every(
    (conflict) => Boolean(routeDecisions[conflict.id]),
  )
  const hasKeepDecision = primaryRouteConflicts.some(
    (conflict) => routeDecisions[conflict.id] === 'keep_existing',
  )
  const hasEditDecision = primaryRouteConflicts.some(
    (conflict) => routeDecisions[conflict.id] === 'edit_workflow',
  )
  const canEquip = Boolean(inspection) && !inspection?.report.blocking && allPrimaryRoutesDecided && !hasKeepDecision && !hasEditDecision
  // 尚未做出选择的主路由冲突：确认按钮被禁用时用它给出明确指引（为什么不能点、要去哪里选）。
  const pendingPrimaryRoute = primaryRouteConflicts.find(
    (conflict) => !routeDecisions[conflict.id],
  ) ?? null

  const capabilityName = React.useCallback((capabilityId: string | null): string => {
    if (!capabilityId) return '未命名能力'
    const attached = data?.attachments.find((attachment) => attachment.descriptor.capabilityId === capabilityId)
    if (attached) return attached.descriptor.name
    const skill = data?.skills.find((item) => item.key === capabilityId)
    if (skill) return skill.name
    const builtIn = data?.builtInCapabilities.find((item) => item.id === capabilityId || item.key === capabilityId)
    if (builtIn) return builtIn.name
    return capabilityId
  }, [data?.attachments, data?.builtInCapabilities, data?.skills])

  const editInspectedWorkflow = React.useCallback((): void => {
    if (!inspection?.descriptor.projectId) {
      setError('该工作流没有所属项目，无法跳转编辑')
      return
    }
    openWorkflowEditor(inspection.descriptor.projectId, inspection.descriptor.sourceId)
  }, [inspection, openWorkflowEditor])

  const finishPrimaryRouteDecision = React.useCallback((): void => {
    if (!inspection) return
    if (hasEditDecision) {
      editInspectedWorkflow()
      return
    }
    if (hasKeepDecision) {
      setNotice(`已保留当前设置；“${inspection.descriptor.name}”未添加`)
      setInspection(null)
      setRouteDecisions({})
      return
    }
    void equip()
  }, [editInspectedWorkflow, equip, hasEditDecision, hasKeepDecision, inspection])

  return (
    <>
    <Modal
      className="capability-bay-modal"
      opened={opened}
      onClose={onClose}
      centered
      size={1040}
      title={null}
      withCloseButton
      closeButtonProps={{ 'aria-label': '关闭 Agent 配置' }}
      overlayProps={{ backgroundOpacity: 0.7, blur: 8 }}
      zIndex={10100}
    >
      <section className="capability-bay" aria-labelledby="capability-bay-title">
        <header className="capability-bay__header">
          <span className="capability-bay__identity-icon" aria-hidden="true"><IconSparkles className="capability-bay__identity-svg" size={19} /></span>
          <span className="capability-bay__heading-copy">
            <h2 className="capability-bay__title" id="capability-bay-title">Agent 配置</h2>
            <span className="capability-bay__subtitle">设置小T可以使用的工作流、技能和内置功能</span>
          </span>
          <span className="capability-bay__count">已添加 {routingReadySourceIds.size} 个工作流</span>
          <Tooltip className="capability-bay__tooltip" label="刷新能力状态" withArrow>
            <button className="capability-bay__icon-action" type="button" aria-label="刷新能力状态" disabled={loading} onClick={() => void load()}>
              <IconRefresh className={loading ? 'capability-bay__refresh-svg is-loading' : 'capability-bay__refresh-svg'} size={17} />
            </button>
          </Tooltip>
        </header>

        <div className="capability-bay__controls">
          <div className="capability-bay__tabs" role="tablist" aria-label="Agent 配置分类">
            <button className={`capability-bay__tab${activeTab === 'workflows' ? ' is-active' : ''}`} type="button" role="tab" aria-selected={activeTab === 'workflows'} onClick={() => { setActiveTab('workflows'); setInspection(null) }}>工作流</button>
            <button className={`capability-bay__tab${activeTab === 'equipped' ? ' is-active' : ''}`} type="button" role="tab" aria-selected={activeTab === 'equipped'} onClick={() => setActiveTab('equipped')}>已添加</button>
            <button className={`capability-bay__tab${activeTab === 'skills' ? ' is-active' : ''}`} type="button" role="tab" aria-selected={activeTab === 'skills'} onClick={() => { setActiveTab('skills'); setInspection(null) }}>技能</button>
            <button className={`capability-bay__tab${activeTab === 'built_in' ? ' is-active' : ''}`} type="button" role="tab" aria-selected={activeTab === 'built_in'} onClick={() => { setActiveTab('built_in'); setInspection(null) }}>内置功能</button>
            <button className={`capability-bay__tab${activeTab === 'invocations' ? ' is-active' : ''}`} type="button" role="tab" aria-selected={activeTab === 'invocations'} onClick={() => { setActiveTab('invocations'); setInspection(null) }}>使用记录</button>
          </div>
          <label className="capability-bay__search">
            <IconSearch className="capability-bay__search-icon" size={16} aria-hidden="true" />
            <input className="capability-bay__search-input" aria-label="搜索工作流或功能" value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="搜索工作流或功能" />
          </label>
        </div>

        {error ? <div className="capability-bay__message is-error" role="alert">{error}</div> : null}
        {notice ? <div className="capability-bay__message is-success" role="status">{notice}</div> : null}

        <div className={`capability-bay__body${inspection ? ' has-inspection' : ''}`}>
          <div className="capability-bay__list" aria-busy={loading}>
            {loading && !data ? <div className="capability-bay__empty"><IconLoader2 className="capability-bay__empty-loader" size={21} />正在加载 Agent 配置…</div> : null}
            {activeTab === 'workflows' ? (
              <section className="capability-bay__create-project" aria-label="创建工作流项目">
                <span className="capability-bay__create-copy">
                  <strong className="capability-bay__create-title">新建工作流项目</strong>
                  <span className="capability-bay__create-description">创建后进入独立画布搭建；保存并添加后，小T就能使用。</span>
                </span>
                <span className="capability-bay__create-form">
                  <input className="capability-bay__create-input" value={newProjectName} onChange={(event) => setNewProjectName(event.currentTarget.value)} placeholder="例如：一键成片工作流" aria-label="工作流项目名称" />
                  <button className="capability-bay__primary-action" type="button" disabled={creatingProject} onClick={() => void createProject()}>
                    {creatingProject ? <IconLoader2 className="capability-bay__button-loader" size={15} /> : <IconPlus className="capability-bay__button-icon" size={15} />}
                    <span className="capability-bay__button-label">创建并编辑</span>
                  </button>
                </span>
              </section>
            ) : null}
            {activeTab === 'workflows' && data?.currentProject?.projectKind === 'creative' ? (
              <section className="capability-bay__create-project" aria-label="将当前项目纳入工作流项目">
                <span className="capability-bay__create-copy">
                  <strong className="capability-bay__create-title">当前项目：{data.currentProject.name}</strong>
                  <span className="capability-bay__create-description">当前仍是普通创作项目。纳入后会出现在工作流项目列表，画布和历史版本不会改变。</span>
                </span>
                <span className="capability-bay__create-form">
                  <button className="capability-bay__primary-action" type="button" disabled={adoptingProject} onClick={() => void adoptCurrentProject()}>
                    {adoptingProject ? <IconLoader2 className="capability-bay__button-loader" size={15} /> : <IconTopologyStar3 className="capability-bay__button-icon" size={15} />}
                    <span className="capability-bay__button-label">纳入工作流项目</span>
                  </button>
                </span>
              </section>
            ) : null}
            {activeTab === 'workflows' ? (
              <section className="capability-bay__section" aria-labelledby="capability-bay-projects-title">
                <header className="capability-bay__section-header">
                  <strong className="capability-bay__section-title" id="capability-bay-projects-title">工作流项目</strong>
                  <span className="capability-bay__section-count">{workflowCatalogItems.length} 个工作流</span>
                </header>
                {!loading && !error && workflowCatalogItems.length === 0 ? <div className="capability-bay__section-empty">还没有工作流项目</div> : null}
                {workflowCatalogItems.map((item) => {
                  const candidate = item.candidate
                  const busy = candidate ? busyFlowId === candidate.descriptor.sourceId : false
                  const projectBusy = busyFlowId === `project:${item.projectId}`
                  const routingReady = candidate ? routingReadySourceIds.has(candidate.descriptor.sourceId) : false
                  const routeConfirmationRequired = candidate ? candidate.attached && !routingReady : false
                  const versionChanged = candidate ? candidate.attached && candidate.attachedVersionId !== candidate.descriptor.sourceVersionId : false
                  return (
                    <article className={`capability-bay__item${candidate && selectedCandidate?.descriptor.sourceId === candidate.descriptor.sourceId ? ' is-selected' : ''}`} key={item.key}>
                      <span className="capability-bay__item-icon" aria-hidden="true"><IconTopologyStar3 className="capability-bay__item-svg" size={19} /></span>
                      <span className="capability-bay__item-copy">
                        <span className="capability-bay__item-title-row">
                          <strong className="capability-bay__item-title">{candidate?.descriptor.name || item.projectName}</strong>
                          <span className="capability-bay__state is-equipped">工作流</span>
                          {routingReady ? <span className="capability-bay__state is-equipped"><IconCheck className="capability-bay__state-icon" size={12} />已添加</span> : null}
                          {routeConfirmationRequired ? <span className="capability-bay__state is-stale"><IconAlertTriangle className="capability-bay__state-icon" size={12} />待重新确认</span> : null}
                          {versionChanged ? <span className="capability-bay__state is-stale"><IconAlertTriangle className="capability-bay__state-icon" size={12} />有新版本</span> : null}
                        </span>
                        <span className="capability-bay__item-summary">{candidate?.descriptor.summary || (candidate ? `${candidate.descriptor.nodeCount} 个工作流节点` : `${item.flowCount} 个工作流画布`)}</span>
                        <span className="capability-bay__item-meta">
                          <span className="capability-bay__meta-item">{item.projectName}</span>
                          {candidate ? <span className="capability-bay__meta-item">{candidate.descriptor.nodeCount} 节点</span> : null}
                          {candidate ? <span className="capability-bay__meta-item">版本 {candidate.descriptor.sourceRevision}</span> : null}
                          {candidate ? <span className="capability-bay__meta-item">{candidate.descriptor.sideEffects.map(effectLabel).join(' · ')}</span> : null}
                          {!candidate && item.updatedAt ? <span className="capability-bay__meta-item">更新于 {new Date(item.updatedAt).toLocaleString('zh-CN', { hour12: false })}</span> : null}
                          {!candidate ? <span className="capability-bay__meta-item">尚无可添加的已保存工作流</span> : null}
                        </span>
                      </span>
                      <span className="capability-bay__item-actions">
                        <button className="capability-bay__secondary-action" type="button" disabled={!item.projectId || projectBusy} onClick={() => item.projectId && openWorkflowEditor(item.projectId, candidate?.descriptor.sourceId)}><IconEdit className="capability-bay__button-icon" size={15} /><span className="capability-bay__button-label">编辑</span></button>
                        {item.canDelete ? <button className="capability-bay__secondary-action" type="button" disabled={projectBusy} onClick={() => void deleteProject(item)}><IconTrash className="capability-bay__button-icon" size={15} /><span className="capability-bay__button-label">{projectBusy ? '删除中…' : '删除'}</span></button> : null}
                        {candidate ? (
                          routingReady && !candidate.stale ? (
                            <button className="capability-bay__secondary-action" type="button" disabled><IconCheck className="capability-bay__button-icon" size={15} /><span className="capability-bay__button-label">已添加</span></button>
                          ) : (
                            <button className="capability-bay__primary-action" type="button" disabled={busy} onClick={() => void inspect(candidate)}>
                              {busy ? <IconLoader2 className="capability-bay__button-loader" size={15} /> : <IconPlugConnected className="capability-bay__button-icon" size={15} />}
                              <span className="capability-bay__button-label">{routeConfirmationRequired ? '重新检查' : versionChanged ? '检查并更新' : '检查并添加'}</span>
                            </button>
                          )
                        ) : (
                          <button className="capability-bay__secondary-action" type="button" disabled><IconPlugConnectedX className="capability-bay__button-icon" size={15} /><span className="capability-bay__button-label">暂不可添加</span></button>
                        )}
                      </span>
                    </article>
                  )
                })}
              </section>
            ) : null}
            {!loading && !error && activeTab === 'equipped' && equippedCandidates.length === 0 ? <div className="capability-bay__section-empty">还没有添加工作流</div> : null}
            {activeTab === 'equipped' ? equippedCandidates.map((candidate) => {
              const busy = busyFlowId === candidate.descriptor.sourceId
              const routingReady = routingReadySourceIds.has(candidate.descriptor.sourceId)
              const routeConfirmationRequired = candidate.attached && !routingReady
              const versionChanged = candidate.attached && candidate.attachedVersionId !== candidate.descriptor.sourceVersionId
              const isSystemWorkflow = attachmentScopeBySourceId.get(candidate.descriptor.sourceId) === 'all_users'
              const userEnabled = userEnabledBySourceId.get(candidate.descriptor.sourceId) ?? true
              return (
                <article className={`capability-bay__item${selectedCandidate?.descriptor.sourceId === candidate.descriptor.sourceId ? ' is-selected' : ''}`} key={candidate.descriptor.sourceId}>
                  <span className="capability-bay__item-icon" aria-hidden="true"><IconTopologyStar3 className="capability-bay__item-svg" size={19} /></span>
                  <span className="capability-bay__item-copy">
                    <span className="capability-bay__item-title-row">
                      <strong className="capability-bay__item-title">{candidate.descriptor.name}</strong>
                      {isSystemWorkflow ? <span className="capability-bay__state is-system">全体用户</span> : null}
                      {isSystemWorkflow && !userEnabled ? <span className="capability-bay__state is-stale"><IconAlertTriangle className="capability-bay__state-icon" size={12} />已关闭</span> : null}
                      {routingReady && !isSystemWorkflow ? <span className="capability-bay__state is-equipped"><IconCheck className="capability-bay__state-icon" size={12} />已添加</span> : null}
                      {routeConfirmationRequired ? <span className="capability-bay__state is-stale"><IconAlertTriangle className="capability-bay__state-icon" size={12} />待重新确认</span> : null}
                      {versionChanged ? <span className="capability-bay__state is-stale"><IconAlertTriangle className="capability-bay__state-icon" size={12} />有新版本</span> : null}
                    </span>
                    <span className="capability-bay__item-summary">{candidate.descriptor.summary || `${candidate.descriptor.nodeCount} 个工作流节点`}</span>
                    <span className="capability-bay__item-meta">
                      <span className="capability-bay__meta-item">{candidate.projectName || '个人工作流'}</span>
                      <span className="capability-bay__meta-item">{candidate.descriptor.nodeCount} 节点</span>
                      <span className="capability-bay__meta-item">版本 {candidate.descriptor.sourceRevision}</span>
                      <span className="capability-bay__meta-item">{candidate.descriptor.sideEffects.map(effectLabel).join(' · ')}</span>
                    </span>
                  </span>
                  <span className="capability-bay__item-actions">
                    {isSystemWorkflow ? (
                      <Tooltip className="capability-bay__tooltip" label={userEnabled ? '关闭后该工作流不会出现在你的小T中（仅对当前账号生效）' : '重新启用该系统级工作流'} withArrow>
                        <button className={userEnabled ? 'capability-bay__secondary-action' : 'capability-bay__primary-action'} type="button" disabled={busy} onClick={() => void toggleWorkflow(candidate, !userEnabled)}>
                          {busy ? <IconLoader2 className="capability-bay__button-loader" size={15} /> : userEnabled ? <IconPlugConnectedX className="capability-bay__button-icon" size={15} /> : <IconPlugConnected className="capability-bay__button-icon" size={15} />}
                          <span className="capability-bay__button-label">{userEnabled ? '关闭' : '启用'}</span>
                        </button>
                      </Tooltip>
                    ) : routingReady && !candidate.stale ? (
                      <Tooltip className="capability-bay__tooltip" label="从 Agent 配置中移除，不会删除工作流" withArrow>
                        <button className="capability-bay__secondary-action" type="button" disabled={busy} onClick={() => void unequip(candidate)}>
                          {busy ? <IconLoader2 className="capability-bay__button-loader" size={15} /> : <IconPlugConnectedX className="capability-bay__button-icon" size={15} />}
                          <span className="capability-bay__button-label">移除</span>
                        </button>
                      </Tooltip>
                    ) : (
                      <button className="capability-bay__primary-action" type="button" disabled={busy} onClick={() => void inspect(candidate)}>
                        {busy ? <IconLoader2 className="capability-bay__button-loader" size={15} /> : <IconPlugConnected className="capability-bay__button-icon" size={15} />}
                        <span className="capability-bay__button-label">{routeConfirmationRequired ? '重新检查' : versionChanged ? '检查并更新' : '检查并添加'}</span>
                      </button>
                    )}
                  </span>
                </article>
              )
            }) : null}
            {activeTab === 'skills' && !loading && skillItems.length === 0 ? <div className="capability-bay__empty">没有可管理的技能</div> : null}
            {activeTab === 'skills' ? skillItems.map((skill) => {
              const busy = busyFlowId === `skill:${skill.key}`
              return (
                <article className="capability-bay__item" key={skill.id}>
                  <span className="capability-bay__item-icon" aria-hidden="true">
                    {skill.logoUrl ? <ManagedImage className="capability-bay__skill-logo" src={skill.logoUrl} alt="" priority="visible" /> : <IconBrain className="capability-bay__item-svg" size={19} />}
                  </span>
                  <span className="capability-bay__item-copy">
                    <span className="capability-bay__item-title-row">
                      <strong className="capability-bay__item-title">{skill.name}</strong>
                      <span className={`capability-bay__state ${skill.enabled ? 'is-equipped' : 'is-disabled'}`}>{skill.enabled ? '已启用' : '已停用'}</span>
                      {skill.disabledReason === 'replaced' ? <span className="capability-bay__state is-stale">被工作流替换</span> : null}
                    </span>
                    <span className="capability-bay__item-summary">{skill.description || skill.key}</span>
                    <span className="capability-bay__item-meta">
                      <span className="capability-bay__meta-item">{skill.category}</span>
                      <span className="capability-bay__meta-item">{skill.key}</span>
                      {skill.replacedByCapabilityId ? <span className="capability-bay__meta-item">主路径：{skill.replacedByCapabilityId}</span> : null}
                    </span>
                  </span>
                  <span className="capability-bay__item-actions">
                    <button className={skill.enabled ? 'capability-bay__secondary-action' : 'capability-bay__primary-action'} type="button" disabled={busy} onClick={() => void toggleSkill(skill.key, !skill.enabled)}>
                      {busy ? <IconLoader2 className="capability-bay__button-loader" size={15} /> : null}
                      <span className="capability-bay__button-label">{skill.enabled ? '停用' : '启用'}</span>
                    </button>
                  </span>
                </article>
              )
            }) : null}
            {activeTab === 'built_in' && !loading && builtInItems.length === 0 ? <div className="capability-bay__empty">没有内置功能</div> : null}
            {activeTab === 'built_in' ? builtInItems.map((capability) => {
              const busy = busyFlowId === `built_in:${capability.key}`
              return (
                <article className="capability-bay__item" key={capability.id}>
                  <span className="capability-bay__item-icon is-built-in" aria-hidden="true"><IconBolt className="capability-bay__item-svg" size={19} /></span>
                  <span className="capability-bay__item-copy">
                    <span className="capability-bay__item-title-row">
                      <strong className="capability-bay__item-title">{capability.name}</strong>
                      <span className={`capability-bay__state ${capability.enabled ? 'is-equipped' : 'is-disabled'}`}>{capability.enabled ? '已启用' : '已停用'}</span>
                      {!capability.systemEnabled ? <span className="capability-bay__state is-disabled">管理员已停用</span> : null}
                      {capability.disabledReason === 'replaced' ? <span className="capability-bay__state is-stale">被工作流替换</span> : null}
                    </span>
                    <span className="capability-bay__item-summary">{capability.description}</span>
                    <span className="capability-bay__item-meta">
                      <span className="capability-bay__meta-item">{capability.requiredTools.length} 个执行工具</span>
                      <span className="capability-bay__meta-item">小T内置功能</span>
                      {capability.replacedByCapabilityId ? <span className="capability-bay__meta-item">主路径：{capability.replacedByCapabilityId}</span> : null}
                    </span>
                  </span>
                  <span className="capability-bay__item-actions">
                    <button className={capability.userEnabled ? 'capability-bay__secondary-action' : 'capability-bay__primary-action'} type="button" disabled={busy || !capability.systemEnabled} onClick={() => void toggleBuiltInCapability(capability.key, !capability.userEnabled)}>
                      {busy ? <IconLoader2 className="capability-bay__button-loader" size={15} /> : null}
                      <span className="capability-bay__button-label">{capability.systemEnabled ? (capability.userEnabled ? '停用' : '启用') : '系统停用'}</span>
                    </button>
                  </span>
                </article>
              )
            }) : null}
            {activeTab === 'invocations' && !loading && invocationItems.length === 0 ? <div className="capability-bay__empty">小T还没有运行过已添加的工作流</div> : null}
            {activeTab === 'invocations' ? invocationItems.map((invocation) => (
              <article className="capability-bay__item" key={invocation.id}>
                <span className="capability-bay__item-icon is-built-in" aria-hidden="true"><IconHistory className="capability-bay__item-svg" size={19} /></span>
                <span className="capability-bay__item-copy">
                  <span className="capability-bay__item-title-row">
                    <strong className="capability-bay__item-title">{invocation.capabilityName}</strong>
                    <span className={`capability-bay__state is-${invocation.executionStatus}`}>{invocation.executionStatus === 'success' ? '成功' : invocation.executionStatus === 'failed' ? '失败' : invocation.executionStatus === 'canceled' ? '已取消' : invocation.executionStatus === 'running' ? '运行中' : '排队中'}</span>
                  </span>
                  <span className="capability-bay__item-summary">执行 {invocation.workflowExecutionId.slice(0, 12)} · 固定版本 {invocation.sourceVersionId.slice(0, 12)}</span>
                  <span className="capability-bay__item-meta">
                    <span className="capability-bay__meta-item">{new Date(invocation.createdAt).toLocaleString('zh-CN', { hour12: false })}</span>
                    {invocation.agentExecutionId ? <span className="capability-bay__meta-item">代理执行 {invocation.agentExecutionId.slice(0, 12)}</span> : null}
                    {invocation.executionErrorMessage ? <span className="capability-bay__meta-item is-error">{invocation.executionErrorMessage}</span> : null}
                  </span>
                </span>
                <span className="capability-bay__item-actions">
                  <Tooltip className="capability-bay__tooltip" label="查看工作流执行时的不可变原始快照" withArrow>
                    <button className="capability-bay__secondary-action" type="button" onClick={() => setSnapshotExecutionId(invocation.workflowExecutionId)}><IconFileSearch className="capability-bay__button-icon" size={15} /><span className="capability-bay__button-label">原始快照</span></button>
                  </Tooltip>
                  <Tooltip className="capability-bay__tooltip" label="查看每个节点的输入、状态、耗时和输出证据" withArrow>
                    <button className="capability-bay__primary-action" type="button" onClick={() => setLogExecutionId(invocation.workflowExecutionId)}><IconHistory className="capability-bay__button-icon" size={15} /><span className="capability-bay__button-label">节点执行</span></button>
                  </Tooltip>
                </span>
              </article>
            )) : null}
          </div>

          {inspection ? (
            <aside className="capability-bay__inspection" aria-label="添加前检查结果">
              <header className="capability-bay__inspection-header">
                <span className="capability-bay__inspection-icon" aria-hidden="true"><IconShieldCheck className="capability-bay__inspection-svg" size={18} /></span>
                <span className="capability-bay__inspection-copy">
                  <strong className="capability-bay__inspection-title">添加前检查</strong>
                  <span className="capability-bay__inspection-subtitle">检查工作流冲突和使用权限</span>
                </span>
              </header>
              <div className="capability-bay__inspection-summary">
                {inspection.report.semanticAnalysis?.status === 'unavailable'
                  ? `结构、权限与已知能力关系已完成确定性检查；语义冲突分析暂时不可用（${inspection.report.semanticAnalysis.errorCode}），该辅助检查不会阻断版本更新。`
                  : inspection.report.conflicts.length === 0
                  ? '没有发现冲突，可以直接添加。'
                  : primaryRouteConflicts.length > 0
                    ? `发现 ${inspection.report.conflicts.length} 项检查结果，其中 ${primaryRouteConflicts.length} 项需要你选择处理方式；其余确认后自动采纳建议。`
                    : `发现 ${inspection.report.conflicts.length} 项检查结果，均自动采纳建议，可直接添加。`}
              </div>
              <div className="capability-bay__conflicts">
                {inspection.report.conflicts.map((conflict) => (
                  <section className={`capability-bay__conflict is-${conflict.severity}`} key={conflict.id}>
                    <span className="capability-bay__conflict-heading">
                      <strong className="capability-bay__conflict-title">{conflict.title}</strong>
                      <span className="capability-bay__conflict-tags">
                        <span className="capability-bay__conflict-level">{conflict.severity === 'blocking' ? '阻断' : conflict.severity === 'warning' ? '需确认' : '提示'}</span>
                        {conflict.resolutionMode !== 'choose_primary' ? (
                          <span className="capability-bay__conflict-auto">确认后自动采纳建议</span>
                        ) : null}
                      </span>
                    </span>
                    <span className="capability-bay__conflict-rationale">{conflict.rationale}</span>
                    <span className="capability-bay__conflict-resolution">建议：{conflict.resolution}</span>
                    {conflict.resolutionMode === 'choose_primary' ? (
                      <div className="capability-bay__route-decision">
                        <div className="capability-bay__route-change" aria-label="功能替换关系">
                          <span className="capability-bay__route-side">
                            <span className="capability-bay__route-label">当前使用</span>
                            <strong className="capability-bay__route-name">{capabilityName(conflict.withCapabilityId)}</strong>
                          </span>
                          <IconArrowRight className="capability-bay__route-arrow" size={15} aria-hidden="true" />
                          <span className="capability-bay__route-side">
                            <span className="capability-bay__route-label">准备替换为</span>
                            <strong className="capability-bay__route-name">{inspection.descriptor.name}</strong>
                          </span>
                        </div>
                        <div className="capability-bay__route-options" role="group" aria-label={`${conflict.title}的处理方式`}>
                          <button
                            className={`capability-bay__route-option${routeDecisions[conflict.id] === 'replace_existing' ? ' is-selected' : ''}`}
                            type="button"
                            aria-pressed={routeDecisions[conflict.id] === 'replace_existing'}
                            onClick={() => setRouteDecisions((current) => ({ ...current, [conflict.id]: 'replace_existing' }))}
                          >用新工作流替换</button>
                          <button
                            className={`capability-bay__route-option${routeDecisions[conflict.id] === 'keep_existing' ? ' is-selected' : ''}`}
                            type="button"
                            aria-pressed={routeDecisions[conflict.id] === 'keep_existing'}
                            onClick={() => setRouteDecisions((current) => ({ ...current, [conflict.id]: 'keep_existing' }))}
                          >保留当前，不添加</button>
                          <button
                            className={`capability-bay__route-option${routeDecisions[conflict.id] === 'edit_workflow' ? ' is-selected' : ''}`}
                            type="button"
                            aria-pressed={routeDecisions[conflict.id] === 'edit_workflow'}
                            onClick={() => setRouteDecisions((current) => ({ ...current, [conflict.id]: 'edit_workflow' }))}
                          ><IconEdit className="capability-bay__route-option-icon" size={13} aria-hidden="true" />编辑为委托关系</button>
                        </div>
                      </div>
                    ) : null}
                  </section>
                ))}
              </div>
              <footer className="capability-bay__inspection-actions">
                {adminUser ? (
                  <div className="capability-bay__scope-picker" role="group" aria-label="工作流作用范围">
                    <span className="capability-bay__scope-label">作用范围</span>
                    <button
                      className={`capability-bay__scope-option${equipScope === 'current_user' ? ' is-selected' : ''}`}
                      type="button"
                      aria-pressed={equipScope === 'current_user'}
                      onClick={() => setEquipScope('current_user')}
                    >仅当前用户</button>
                    <button
                      className={`capability-bay__scope-option${equipScope === 'all_users' ? ' is-selected' : ''}`}
                      type="button"
                      aria-pressed={equipScope === 'all_users'}
                      onClick={() => setEquipScope('all_users')}
                    >全体用户</button>
                    <span className="capability-bay__scope-hint">{equipScope === 'all_users' ? '发布为系统级工作流，所有用户的小T都可使用；执行按调用者身份计费并写回调用者画布。' : '只有你自己可见和使用。'}</span>
                  </div>
                ) : null}
                {pendingPrimaryRoute ? (
                  <p className="capability-bay__inspection-hint" role="status">
                    请先为「{pendingPrimaryRoute.title}」选择处理方式：用新工作流替换 / 保留当前，不添加 / 编辑为委托关系。
                  </p>
                ) : null}
                <button className="capability-bay__cancel-action" type="button" onClick={() => setInspection(null)}>取消</button>
                <button className="capability-bay__confirm-action" type="button" disabled={inspection.report.blocking || !allPrimaryRoutesDecided || busyFlowId === inspection.descriptor.sourceId} onClick={finishPrimaryRouteDecision}>
                  {busyFlowId === inspection.descriptor.sourceId ? <IconLoader2 className="capability-bay__button-loader" size={15} /> : <IconPlugConnected className="capability-bay__button-icon" size={15} />}
                  <span className="capability-bay__button-label">{hasEditDecision ? '去编辑工作流' : hasKeepDecision ? '保留当前设置' : canEquip && primaryRouteConflicts.length > 0 ? '确认替换并添加' : '添加给小T'}</span>
                </button>
              </footer>
            </aside>
          ) : null}
        </div>
      </section>
    </Modal>
    <WorkflowExecutionSnapshotModal opened={Boolean(snapshotExecutionId)} executionId={snapshotExecutionId} onClose={() => setSnapshotExecutionId(null)} />
    <ExecutionLogModal className="capability-bay__execution-log-modal" opened={Boolean(logExecutionId)} executionId={logExecutionId} onClose={() => setLogExecutionId(null)} />
    </>
  )
}
