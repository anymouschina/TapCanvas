import {
  getWorkflowExecution,
  getWorkflowExecutionFamily,
  listWorkflowExecutions,
  listWorkflowNodeRuns,
  type WorkflowNodeRunDto,
} from '../api/server'
import { useRFStore } from './store'
import { isWorkflowAgentNode } from './workflowAgentContext'
import {
  applyWorkflowAgentReferenceProjection,
  clearWorkflowAgentReferenceProjection,
} from './workflowAgentReferenceProjection'
import {
  isWorkflowRuntimeReferenceEdgeData,
  isWorkflowRuntimeReferenceNodeData,
  workflowExecutionProjectionGuard,
} from './workflowExecutionProjectionData'
import { computeContextAwarePosition } from './store'
import { resolveWorkflowWaitingReason, type WorkflowWaitingReason } from './workflowWaitingReason'

/**
 * 工作流执行占位节点（单个节点）：小T 触发的一键成片等执行没有前端手动运行路径，
 * SSE workflow-execution-event 到达时在本画布上放置一个执行占位节点，外显运行状态
 * （running 转圈 / succeeded 绿 / failed 红），点击打开执行快照弹窗查看运行过程。
 * Equipped workflow admission now persists a server-owned singleton first. This runtime node is
 * retained as a recovery projection for executions accepted before that contract or while loading
 * an older canvas snapshot.
 */
export const WORKFLOW_EXECUTION_PLACEHOLDER_NODE_TYPE = 'workflowExecutionNode'

export function workflowExecutionPlaceholderNodeId(executionId: string): string {
  return `wf-exec-${executionId.trim()}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isDurableWorkflowExecutionProjectionNode(value: unknown): boolean {
  return isRecord(value)
    && value.kind === 'workflowExecution'
    && value.managedProjection === 'workflow_execution'
    && value.workflowRuntimeReference === false
}

function artifactIdentities(outputRefs: unknown): string[] {
  if (!isRecord(outputRefs) || !Array.isArray(outputRefs.artifacts)) return []
  return outputRefs.artifacts.flatMap((artifact) => {
    if (!isRecord(artifact) || typeof artifact.identity !== 'string' || !artifact.identity.trim()) return []
    return [artifact.identity.trim()]
  })
}

function itemRunFacts(outputRefs: unknown): Readonly<{
  itemRuns: readonly unknown[]
  completed: number
  failed: number
  total: number
}> {
  if (!isRecord(outputRefs) || !Array.isArray(outputRefs.itemRuns)) {
    return { itemRuns: [], completed: 0, failed: 0, total: 0 }
  }
  const itemRuns = outputRefs.itemRuns
  const evidence = isRecord(outputRefs.evidence) ? outputRefs.evidence : null
  const count = (field: string, fallback: number): number => {
    const value = evidence?.[field]
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : fallback
  }
  const completed = itemRuns.filter((item) => isRecord(item) && item.status === 'success').length
  const failed = itemRuns.filter((item) => isRecord(item) && item.status === 'failed').length
  return {
    itemRuns,
    completed: count('completedItems', completed),
    failed: count('failedItems', failed),
    total: count('totalItems', itemRuns.length),
  }
}

function timestamp(value: unknown): number | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

function nodeAcceptsProjection(
  nodeId: string,
  executionId: string,
  executionCreatedAt: string,
): boolean {
  const node = useRFStore.getState().nodes.find((candidate) => candidate.id === nodeId)
  if (!node || !isRecord(node.data)) return true
  const currentExecutionId = readString(node.data.workflowExecutionId)
  if (!currentExecutionId || currentExecutionId === executionId) return true
  const currentCreatedAt = timestamp(node.data.workflowExecutionCreatedAt)
  const candidateCreatedAt = timestamp(executionCreatedAt)
  if (currentCreatedAt === null || candidateCreatedAt === null) return true
  return candidateCreatedAt >= currentCreatedAt
}

function earliestRunCreatedAt(runs: readonly WorkflowNodeRunDto[]): string {
  return runs.reduce((earliest, run) => {
    const candidate = timestamp(run.createdAt)
    const current = timestamp(earliest)
    return candidate !== null && (current === null || candidate < current) ? run.createdAt : earliest
  }, '')
}

type PlaceholderExecutionStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'

function aggregatePlaceholderStatus(runs: readonly WorkflowNodeRunDto[]): PlaceholderExecutionStatus {
  if (runs.length === 0) return 'queued'
  let failed = false
  let active = false
  let canceled = false
  for (const run of runs) {
    if (run.status === 'failed') failed = true
    else if (run.status === 'running' || run.status === 'queued' || run.status === 'waiting_external') active = true
    else if (run.status === 'canceled') canceled = true
  }
  if (failed) return 'failed'
  if (active) return 'running'
  return canceled ? 'cancelled' : 'succeeded'
}

function placeholderProgress(runs: readonly WorkflowNodeRunDto[]): Readonly<{
  completed: number
  total: number
  failed: number
}> {
  return {
    completed: runs.filter((run) => run.status === 'success').length,
    total: runs.length,
    failed: runs.filter((run) => run.status === 'failed').length,
  }
}

function placeholderWaitingReason(runs: readonly WorkflowNodeRunDto[]): WorkflowWaitingReason | null {
  const reasons = runs.flatMap((run) => {
    if (run.status !== 'waiting_external') return []
    const reason = resolveWorkflowWaitingReason(run.outputRefs)
    return reason ? [reason] : []
  })
  const uniqueCodes = [...new Set(reasons.map((reason) => reason.code))]
  return uniqueCodes.length === 1 ? reasons[0] ?? null : null
}

/**
 * 确保画布上存在该 execution 的单个工作流执行占位节点，并投影其聚合状态。
 * 同一画布只保留最新执行的一个占位节点（旧 execution 的占位节点被淘汰），
 * 避免多次小T 触发后画布堆满执行节点。优先更新 admission 已持久化的服务端节点；
 * 历史执行没有该节点时才创建不写回 flow 的 workflowRuntimeReference 恢复投影。
 */
export function ensureWorkflowExecutionPlaceholderNode(
  executionId: string,
  runs: readonly WorkflowNodeRunDto[],
): void {
  const normalizedExecutionId = executionId.trim()
  if (!normalizedExecutionId) return
  const nodeId = workflowExecutionPlaceholderNodeId(normalizedExecutionId)
  const status = aggregatePlaceholderStatus(runs)
  const progress = placeholderProgress(runs)
  const waitingReason = placeholderWaitingReason(runs)
  const executionCreatedAt = earliestRunCreatedAt(runs)
  const store = useRFStore.getState()
  const existing = store.nodes.find((node) => node.id === nodeId || (
    isDurableWorkflowExecutionProjectionNode(node.data)
    && nodeAcceptsProjection(node.id, normalizedExecutionId, executionCreatedAt)
  ))
  if (existing) {
    store.updateNodeData(existing.id, {
      workflowExecutionId: normalizedExecutionId,
      workflowExecutionCreatedAt: executionCreatedAt || undefined,
      workflowStatus: status,
      workflowCompletedUnits: progress.completed,
      workflowTotalUnits: progress.total > 0 ? progress.total : undefined,
      workflowErrorCount: progress.failed,
      workflowWaitingReasonCode: waitingReason?.code,
      workflowWaitingReasonLabel: waitingReason?.label,
    })
    return
  }
  // 只保留最新执行占位：若画布已有一个更晚启动的执行占位（并发/乱序事件），
  // 本次更旧的执行不替换它；反之移除所有旧执行占位，仅保留本次。
  const otherPlaceholders = store.nodes.filter((node) => (
    isWorkflowExecutionPlaceholderNode(node.data)
    && node.id !== nodeId
  ))
  const newerPlaceholderExists = otherPlaceholders.some((node) => {
    const currentCreatedAt = timestamp(
      isRecord(node.data) ? readString(node.data.workflowExecutionCreatedAt) : '',
    )
    const candidateCreatedAt = timestamp(executionCreatedAt)
    if (currentCreatedAt === null || candidateCreatedAt === null) return false
    return currentCreatedAt > candidateCreatedAt
  })
  if (newerPlaceholderExists) return
  const position = computeContextAwarePosition(store.nodes, { w: 260, h: 96 })
  useRFStore.setState((state) => {
    if (state.nodes.some((node) => node.id === nodeId)) return {}
    return {
      nodes: [
        ...state.nodes.filter((node) => !otherPlaceholders.some((previous) => previous.id === node.id)),
        {
          id: nodeId,
          type: WORKFLOW_EXECUTION_PLACEHOLDER_NODE_TYPE,
          position,
          data: {
            kind: 'workflowExecution',
            workflowRuntimeReference: true,
            workflowExecutionId: normalizedExecutionId,
            workflowExecutionCreatedAt: executionCreatedAt || undefined,
            workflowStatus: status,
            workflowCompletedUnits: progress.completed,
            workflowTotalUnits: progress.total > 0 ? progress.total : undefined,
            workflowErrorCount: progress.failed,
            workflowWaitingReasonCode: waitingReason?.code,
            workflowWaitingReasonLabel: waitingReason?.label,
            label: '工作流执行',
          },
          selectable: true,
          deletable: false,
        },
      ],
    }
  })
}

export function isWorkflowExecutionPlaceholderNode(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && value.kind === 'workflowExecution' && value.workflowRuntimeReference === true
}

function clearNodesOmittedFromProjection(
  executionId: string,
  executionCreatedAt: string,
  runs: readonly WorkflowNodeRunDto[],
): void {
  const state = useRFStore.getState()
  const runNodeIds = new Set(runs.map((run) => run.nodeId))
  const workflowInstanceId = runs
    .map((run) => workflowNodeInstanceId(run.nodeId))
    .find(Boolean) ?? ''
  if (!workflowInstanceId) return
  for (const node of state.nodes) {
    if (runNodeIds.has(node.id) || !isRecord(node.data)) continue
    if (isWorkflowRuntimeReferenceNodeData(node.data)) continue
    const isSameWorkflow = node.data.adminWorkflow === true
      && (node.data.kind === 'workflowTrigger' || node.data.kind === 'workflowStage')
      && readString(node.data.workflowInstanceId) === workflowInstanceId
    if (!isSameWorkflow || !nodeAcceptsProjection(node.id, executionId, executionCreatedAt)) continue
    if (isWorkflowAgentNode(node.data)) clearWorkflowAgentReferenceProjection(node.id)
    state.updateNodeData(node.id, {
      workflowExecutionId: executionId,
      workflowExecutionCreatedAt: executionCreatedAt,
      workflowStatus: 'queued',
      workflowLocalTestStatus: 'queued',
      workflowLocalTestOutput: undefined,
      workflowExecutionEvidence: undefined,
      workflowOutputArtifactIds: [],
      workflowOutputArtifacts: [],
      workflowItemRuns: [],
      workflowCompletedUnits: 0,
      workflowTotalUnits: undefined,
      workflowErrorCount: 0,
      workflowErrorDetail: undefined,
      workflowWaitingReasonCode: undefined,
      workflowWaitingReasonLabel: undefined,
      workflowExecutionStartedAt: undefined,
      workflowExecutionFinishedAt: undefined,
    })
  }
}

export function applyWorkflowNodeRuns(
  executionId: string,
  runs: readonly WorkflowNodeRunDto[],
): void {
  const store = useRFStore.getState()
  workflowExecutionProjectionGuard.run(() => {
    const executionCreatedAt = earliestRunCreatedAt(runs)
    if (executionCreatedAt) clearNodesOmittedFromProjection(executionId, executionCreatedAt, runs)
    for (const run of runs) {
      if (!nodeAcceptsProjection(run.nodeId, run.executionId, run.createdAt)) continue
      const projectedStatus = run.status === 'success'
        ? 'succeeded'
        : run.status === 'canceled'
          ? 'cancelled'
          : run.status
      const outputRefs = isRecord(run.outputRefs) ? run.outputRefs : null
      const waitingReason = run.status === 'waiting_external'
        ? resolveWorkflowWaitingReason(run.outputRefs)
        : null
      const items = itemRunFacts(outputRefs)
      store.updateNodeData(run.nodeId, {
        workflowExecutionId: executionId,
        workflowExecutionCreatedAt: run.createdAt,
        workflowStatus: projectedStatus,
        workflowLocalTestStatus: projectedStatus,
        workflowLocalTestOutput: outputRefs?.ports,
        workflowExecutionEvidence: outputRefs?.evidence,
        workflowOutputArtifactIds: artifactIdentities(outputRefs),
        workflowOutputArtifacts: outputRefs?.artifacts ?? [],
        workflowItemRuns: items.itemRuns,
        workflowCompletedUnits: items.completed,
        workflowTotalUnits: items.total > 0 ? items.total : undefined,
        workflowErrorCount: items.failed,
        workflowErrorDetail: run.errorMessage ?? undefined,
        workflowWaitingReasonCode: waitingReason?.code,
        workflowWaitingReasonLabel: waitingReason?.label,
        workflowExecutionStartedAt: run.startedAt ?? undefined,
        workflowExecutionFinishedAt: run.finishedAt ?? undefined,
      })
      const projectedNode = useRFStore.getState().nodes.find((node) => node.id === run.nodeId)
      if (projectedNode && isRecord(projectedNode.data) && isWorkflowAgentNode(projectedNode.data)) {
        applyWorkflowAgentReferenceProjection({
          agentNodeId: run.nodeId,
          workflowExecutionId: executionId,
          outputRefs: run.outputRefs,
        })
      }
    }
    // 单节点执行占位：小T 触发等无手动路径的执行也通过它实时回显状态（转圈/绿/红）。
    ensureWorkflowExecutionPlaceholderNode(executionId, runs)
  })
}

export type LatestWorkflowExecutionProjection = Readonly<{
  executionId: string
  runs: readonly WorkflowNodeRunDto[]
}>

export type WorkflowExecutionProjectionLoadOptions = Readonly<{
  activeOnly?: boolean
}>

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function workflowNodeInstanceId(nodeId: string): string {
  const node = useRFStore.getState().nodes.find((candidate) => candidate.id === nodeId)
  if (!node || !isRecord(node.data)) return ''
  return readString(node.data.workflowInstanceId)
}

function workflowNodeExecutorRef(nodeId: string): string {
  const node = useRFStore.getState().nodes.find((candidate) => candidate.id === nodeId)
  if (!node || !isRecord(node.data)) return ''
  if (node.data.kind === 'workflowTrigger' && isRecord(node.data.workflowTriggerSpec)) {
    return readString(node.data.workflowTriggerSpec.kind) ? 'workflow.trigger/v1' : ''
  }
  if (!isRecord(node.data.workflowAtomicSpec)) return ''
  return readString(node.data.workflowAtomicSpec.executorRef)
}

function runExecutorRef(run: WorkflowNodeRunDto): string {
  if (!isRecord(run.outputRefs)) return ''
  return readString(run.outputRefs.executorRef)
}

/**
 * A durable execution can only be projected onto the authoring canvas when its
 * frozen node set is still an upstream-closed subgraph of the current workflow.
 * This accepts legitimate "execute to this node" prefixes, while rejecting an
 * old full run after a new required node is inserted into its dependency path.
 */
export function workflowExecutionProjectionMatchesCanvas(
  runs: readonly WorkflowNodeRunDto[],
): boolean {
  if (runs.length === 0) return false
  const state = useRFStore.getState()
  const runNodeIds = new Set(runs.map((run) => run.nodeId))
  if (runNodeIds.size !== runs.length) return false

  const instanceIds = new Set<string>()
  for (const run of runs) {
    const instanceId = workflowNodeInstanceId(run.nodeId)
    if (!instanceId) return false
    instanceIds.add(instanceId)
    const expectedExecutorRef = runExecutorRef(run)
    const currentExecutorRef = workflowNodeExecutorRef(run.nodeId)
    if (expectedExecutorRef && expectedExecutorRef !== currentExecutorRef) return false
  }
  if (instanceIds.size !== 1) return false
  const instanceId = [...instanceIds][0]
  if (!instanceId) return false

  const workflowNodeIds = new Set(state.nodes.flatMap((node) => {
    if (!isRecord(node.data)) return []
    if (isWorkflowRuntimeReferenceNodeData(node.data)) return []
    const isWorkflowNode = node.data.adminWorkflow === true
      && (node.data.kind === 'workflowStage' || node.data.kind === 'workflowTrigger')
    return isWorkflowNode && readString(node.data.workflowInstanceId) === instanceId
      ? [node.id]
      : []
  }))
  if ([...runNodeIds].some((nodeId) => !workflowNodeIds.has(nodeId))) return false

  return state.edges.every((edge) => {
    if (isWorkflowRuntimeReferenceEdgeData(edge.data)) return true
    if (!runNodeIds.has(edge.target)) return true
    if (!workflowNodeIds.has(edge.source)) return true
    return runNodeIds.has(edge.source)
  })
}

/**
 * Flow data and execution history are fetched independently during Studio
 * hydration. If history wins that race, the first compatibility check sees an
 * incomplete node set and used to abandon restoration until a later focus
 * event. Subscribe to the real canvas store for a bounded window instead of
 * polling or projecting onto a partial graph.
 */
export async function waitForWorkflowExecutionProjectionMatch(
  runs: readonly WorkflowNodeRunDto[],
  timeoutMs = 5_000,
): Promise<boolean> {
  if (workflowExecutionProjectionMatchesCanvas(runs)) return true
  return new Promise<boolean>((resolve) => {
    let settled = false
    let unsubscribe: (() => void) | null = null
    let timer: ReturnType<typeof globalThis.setTimeout> | null = null
    const finish = (matches: boolean): void => {
      if (settled) return
      settled = true
      unsubscribe?.()
      if (timer !== null) globalThis.clearTimeout(timer)
      resolve(matches)
    }
    unsubscribe = useRFStore.subscribe(() => {
      if (workflowExecutionProjectionMatchesCanvas(runs)) finish(true)
    })
    timer = globalThis.setTimeout(() => finish(false), Math.max(0, timeoutMs))
    if (workflowExecutionProjectionMatchesCanvas(runs)) finish(true)
  })
}

export async function loadLatestWorkflowExecutionProjection(
  flowId: string,
  options: WorkflowExecutionProjectionLoadOptions = {},
): Promise<LatestWorkflowExecutionProjection | null> {
  const normalizedFlowId = flowId.trim()
  if (!normalizedFlowId) return null
  const executions = await listWorkflowExecutions({
    flowId: normalizedFlowId,
    limit: 1,
    ...(options.activeOnly === true ? { activeOnly: true } : {}),
  })
  const latest = options.activeOnly === true
    ? executions.find((execution) => execution.status === 'queued' || execution.status === 'running')
    : executions[0]
  if (!latest) return null
  return {
    executionId: latest.id,
    runs: await listWorkflowNodeRuns(latest.id),
  }
}

/**
 * Resolves the logical execution family already pinned by a durable chapter
 * projection, then reads its latest physical member. A recovery/rerun is still
 * the same user goal; keeping the card pinned to the root member would show a
 * stale canceled/failed state while a newer family member is genuinely active.
 */
export async function loadWorkflowExecutionProjection(
  executionId: string,
): Promise<LatestWorkflowExecutionProjection | null> {
  const normalizedExecutionId = executionId.trim()
  if (!normalizedExecutionId) return null
  const family = await getWorkflowExecutionFamily(normalizedExecutionId, 1)
  const latestExecutionId = family.latestExecutionId.trim()
  if (!latestExecutionId) throw new Error('工作流执行族缺少最新执行身份')
  return {
    executionId: latestExecutionId,
    runs: await listWorkflowNodeRuns(latestExecutionId),
  }
}

/**
 * Restores the newest durable execution onto a freshly loaded workflow canvas.
 * The flow snapshot stores authoring state; execution rows remain the authority
 * for status, ports, item checkpoints, artifacts and errors after a reload.
 * The single execution placeholder node is restored unconditionally (小T 触发等
 * 执行可能没有对应的画布模板节点可投影，但执行状态仍应回显在画布上)。
 */
export async function restoreLatestWorkflowExecutionProjection(flowId: string): Promise<string | null> {
  const projection = await loadLatestWorkflowExecutionProjection(flowId)
  if (!projection) return null
  ensureWorkflowExecutionPlaceholderNode(projection.executionId, projection.runs)
  // 画布没有工作流模板节点时没有可投影的节点级目标，直接返回（占位已恢复）。
  const hasAdminWorkflow = useRFStore.getState().nodes.some((node) => {
    if (!isRecord(node.data)) return false
    return node.data.adminWorkflow === true
      && (node.data.kind === 'workflowTrigger' || node.data.kind === 'workflowStage')
  })
  if (!hasAdminWorkflow) return projection.executionId
  if (!await waitForWorkflowExecutionProjectionMatch(projection.runs)) return projection.executionId
  applyWorkflowNodeRuns(projection.executionId, projection.runs)
  return projection.executionId
}

export async function watchWorkflowExecution(
  executionId: string,
  onFailure: (message: string) => void,
): Promise<void> {
  const syncFailureLimit = 60
  let consecutiveSyncFailures = 0
  let terminal = false
  while (!terminal) {
    try {
      const [execution, runs] = await Promise.all([
        getWorkflowExecution(executionId),
        listWorkflowNodeRuns(executionId),
      ])
      consecutiveSyncFailures = 0
      applyWorkflowNodeRuns(executionId, runs)
      terminal = execution.status === 'success' || execution.status === 'failed' || execution.status === 'canceled'
      if (execution.status === 'failed') {
        onFailure(execution.errorMessage || '工作流执行失败')
      }
    } catch (error: unknown) {
      consecutiveSyncFailures += 1
      if (consecutiveSyncFailures >= syncFailureLimit) {
        const detail = error instanceof Error ? error.message : '无法同步工作流节点状态'
        onFailure(`持久执行仍由服务端推进，但画布状态连续同步失败 ${syncFailureLimit} 次：${detail}`)
        return
      }
    }
    if (!terminal) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 1_200))
    }
  }
}
