import * as React from 'react'
import type {
  CodexBridgeSummary,
  CodexCanvasScope,
  CodexTask,
  CodexTaskMessage,
  CodexWorkspaceSummary,
} from '@tapcanvas/codex-task-protocol'
import { isCodexTerminalTaskState } from '@tapcanvas/codex-task-protocol'
import {
  createCodexPairing,
  createCodexTask,
  createCodexTaskMessage,
  decideCodexFallback,
  getCodexTask,
  listCodexBridges,
  listCodexTaskMessages,
  listCodexTasks,
} from '../../../api/codex'
import { absoluteApiBase } from '../../../api/server'
import {
  BRIDGE_STORAGE_KEY,
  buildCodexPairingPrompt,
  codexDispatchErrorMessage,
  codexTaskSignature,
  copyCodexPairingPrompt,
  filterCodexTasksForTarget,
  hasSameCodexDispatchTarget,
  hasSameCodexTurnContext,
  readStoredTarget,
  readStoredValue,
  resolveCodexContinuationTask,
  shouldRetainCodexDispatchAttempt,
  STEERABLE_CODEX_TASK_STATES,
  TARGET_STORAGE_KEY,
  WORKSPACE_STORAGE_KEY,
  writeStoredValue,
  type ChatExecutionTarget,
  type DispatchAttempt,
  type PairingView,
} from './codexDispatchSupport'

export type { ChatExecutionTarget } from './codexDispatchSupport'

const BRIDGE_REFRESH_MS = 4_000
const TASK_REFRESH_MS = 2_000

export type CodexDispatchSubmission =
  | { kind: 'task'; task: CodexTask }
  | { kind: 'steering'; task: CodexTask; message: CodexTaskMessage }

export type CodexDispatchController = {
  target: ChatExecutionTarget
  setTarget: (target: ChatExecutionTarget) => void
  bridges: CodexBridgeSummary[]
  selectedBridge: CodexBridgeSummary | null
  selectedWorkspace: CodexWorkspaceSummary | null
  selectedBridgeId: string
  selectedWorkspaceId: string
  selectBridge: (bridgeId: string) => void
  selectWorkspace: (workspaceId: string) => void
  loadingBridges: boolean
  pairing: PairingView | null
  pairingBusy: boolean
  activeTask: CodexTask | null
  sessionTasks: CodexTask[]
  taskMessages: CodexTaskMessage[]
  dispatching: boolean
  fallbackBusy: boolean
  error: string
  canDispatch: boolean
  refresh: () => Promise<void>
  beginPairing: () => Promise<void>
  copyPairingPrompt: () => Promise<void>
  dispatch: (
    goal: string,
    context: CodexCanvasScope,
  ) => Promise<CodexDispatchSubmission>
  decideFallback: (decision: 'approve' | 'decline') => Promise<void>
}

export function useCodexDispatch(input: {
  projectId: string
  sessionId?: string | null
  ownerNodeId?: string | null
  fixedTarget?: ChatExecutionTarget
}): CodexDispatchController {
  const [target, setTargetState] = React.useState<ChatExecutionTarget>(() => (
    input.fixedTarget || readStoredTarget()
  ))
  const [bridges, setBridges] = React.useState<CodexBridgeSummary[]>([])
  const [selectedBridgeId, setSelectedBridgeId] = React.useState(
    () => readStoredValue(BRIDGE_STORAGE_KEY),
  )
  const [selectedWorkspaceId, setSelectedWorkspaceId] = React.useState(
    () => readStoredValue(WORKSPACE_STORAGE_KEY),
  )
  const [loadingBridges, setLoadingBridges] = React.useState(false)
  const [pairing, setPairing] = React.useState<PairingView | null>(null)
  const [pairingBusy, setPairingBusy] = React.useState(false)
  const [activeTask, setActiveTask] = React.useState<CodexTask | null>(null)
  const [sessionTasks, setSessionTasks] = React.useState<CodexTask[]>([])
  const [taskMessages, setTaskMessages] = React.useState<CodexTaskMessage[]>([])
  const [dispatching, setDispatching] = React.useState(false)
  const [fallbackBusy, setFallbackBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  const dispatchAttemptRef = React.useRef<DispatchAttempt | null>(null)

  const selectedBridge = React.useMemo(
    () =>
      bridges.find((bridge) => bridge.bridgeId === selectedBridgeId) ||
      bridges.find((bridge) => bridge.status === 'online') ||
      null,
    [bridges, selectedBridgeId],
  )
  const selectedWorkspace = React.useMemo(
    () =>
      selectedBridge?.workspaces.find(
        (workspace) => workspace.id === selectedWorkspaceId,
      ) ||
      selectedBridge?.workspaces[0] ||
      null,
    [selectedBridge, selectedWorkspaceId],
  )

  const setTarget = React.useCallback((next: ChatExecutionTarget) => {
    if (input.fixedTarget) return
    setTargetState(next)
    writeStoredValue(TARGET_STORAGE_KEY, next)
  }, [input.fixedTarget])

  React.useEffect(() => {
    if (input.fixedTarget) setTargetState(input.fixedTarget)
  }, [input.fixedTarget])

  const selectBridge = React.useCallback((bridgeId: string) => {
    setSelectedBridgeId(bridgeId)
    setSelectedWorkspaceId('')
    writeStoredValue(BRIDGE_STORAGE_KEY, bridgeId)
    writeStoredValue(WORKSPACE_STORAGE_KEY, '')
  }, [])

  const selectWorkspace = React.useCallback((workspaceId: string) => {
    setSelectedWorkspaceId(workspaceId)
    writeStoredValue(WORKSPACE_STORAGE_KEY, workspaceId)
  }, [])

  React.useEffect(() => {
    if (!selectedBridge) return
    if (selectedBridge.bridgeId !== selectedBridgeId) {
      setSelectedBridgeId(selectedBridge.bridgeId)
      writeStoredValue(BRIDGE_STORAGE_KEY, selectedBridge.bridgeId)
    }
    if (
      selectedWorkspace &&
      selectedWorkspace.id !== selectedWorkspaceId
    ) {
      setSelectedWorkspaceId(selectedWorkspace.id)
      writeStoredValue(WORKSPACE_STORAGE_KEY, selectedWorkspace.id)
    }
  }, [
    selectedBridge,
    selectedBridgeId,
    selectedWorkspace,
    selectedWorkspaceId,
  ])

  const refresh = React.useCallback(async () => {
    setLoadingBridges(true)
    try {
      const [bridgeResult, taskResult] = await Promise.all([
        listCodexBridges(),
        listCodexTasks(50),
      ])
      setBridges(bridgeResult.items)
      const taskBridge =
        bridgeResult.items.find((bridge) => bridge.bridgeId === selectedBridgeId) ||
        bridgeResult.items.find((bridge) => bridge.status === 'online') ||
        null
      const taskWorkspace =
        taskBridge?.workspaces.find(
          (workspace) => workspace.id === selectedWorkspaceId,
        ) || taskBridge?.workspaces[0] || null
      const projectTasks = filterCodexTasksForTarget({
        tasks: taskResult.items,
        projectId: input.projectId,
        bridgeId: taskBridge?.bridgeId || selectedBridgeId,
        workspaceId: taskWorkspace?.id || selectedWorkspaceId,
        sessionId: input.sessionId,
        ownerNodeId: input.ownerNodeId,
      })
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      const currentProjectTask = projectTasks.find(
        (task) => !isCodexTerminalTaskState(task.state),
      )
      const latestProjectTask = projectTasks[0] || null
      const latestSessionTasks = latestProjectTask
        ? projectTasks
            .filter((task) => task.sessionId === latestProjectTask.sessionId)
            .sort((left, right) => left.turnSequence - right.turnSequence)
        : []
      const messageResults = await Promise.all(
        latestSessionTasks.map((task) => listCodexTaskMessages(task.id)),
      )
      setSessionTasks(latestSessionTasks)
      setTaskMessages(
        messageResults
          .flatMap((result) => result.items)
          .sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
      )
      setActiveTask((current) => {
        if (
          current &&
          current.context.projectId === input.projectId &&
          !isCodexTerminalTaskState(current.state)
        ) {
          return (
            taskResult.items.find((task) => task.id === current.id) ||
            currentProjectTask ||
            current
          )
        }
        return currentProjectTask || latestProjectTask || null
      })
      if (bridgeResult.items.some((bridge) => bridge.status === 'online')) {
        setPairing(null)
      }
      setError('')
    } catch (refreshError) {
      setError(codexDispatchErrorMessage(refreshError, '读取 Codex Bridge 状态失败'))
    } finally {
      setLoadingBridges(false)
    }
  }, [
    input.ownerNodeId,
    input.projectId,
    input.sessionId,
    selectedBridgeId,
    selectedWorkspaceId,
  ])

  React.useEffect(() => {
    void refresh()
  }, [refresh])

  React.useEffect(() => {
    if (target !== 'codex' && !pairing) return
    const timer = window.setInterval(() => {
      void refresh()
    }, BRIDGE_REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [pairing, refresh, target])

  React.useEffect(() => {
    if (!activeTask || isCodexTerminalTaskState(activeTask.state)) return
    const timer = window.setInterval(() => {
      void Promise.all([
        getCodexTask(activeTask.id),
        listCodexTaskMessages(activeTask.id),
      ])
        .then(([task, messageResult]) => {
          setActiveTask(task)
          setSessionTasks((current) => {
            const remaining = current.filter((item) => item.id !== task.id)
            return [...remaining, task].sort(
              (left, right) => left.turnSequence - right.turnSequence,
            )
          })
          setTaskMessages((current) => [
            ...current.filter((message) => message.taskId !== task.id),
            ...messageResult.items,
          ].sort((left, right) => left.createdAt.localeCompare(right.createdAt)))
          setError('')
        })
        .catch((taskError: unknown) => {
          setError(codexDispatchErrorMessage(taskError, '读取 Codex 任务状态失败'))
        })
    }, TASK_REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [activeTask])

  const beginPairing = React.useCallback(async () => {
    if (pairingBusy) return
    setPairingBusy(true)
    setError('')
    try {
      const session = await createCodexPairing()
      const prompt = buildCodexPairingPrompt({
        pairingCode: session.pairingCode,
        apiBaseUrl: absoluteApiBase(),
        connectPackageUrl: `${window.location.origin}/connect.tgz`,
        expiresAt: session.expiresAt,
      })
      let copied = false
      try {
        await copyCodexPairingPrompt(prompt)
        copied = true
      } catch (copyError) {
        setError(
          codexDispatchErrorMessage(
            copyError,
            '安装任务已生成，但浏览器未允许写入剪贴板',
          ),
        )
      }
      setPairing({ session, prompt, copied })
    } catch (pairingError) {
      setError(codexDispatchErrorMessage(pairingError, '创建 Codex 一次性配对失败'))
    } finally {
      setPairingBusy(false)
    }
  }, [pairingBusy])

  const copyPairingPrompt = React.useCallback(async () => {
    if (!pairing) {
      await beginPairing()
      return
    }
    try {
      await copyCodexPairingPrompt(pairing.prompt)
      setPairing((current) => (current ? { ...current, copied: true } : null))
      setError('')
    } catch (copyError) {
      setError(codexDispatchErrorMessage(copyError, '复制安装任务失败'))
    }
  }, [beginPairing, pairing])

  const activeTaskMatchesTarget = Boolean(
    activeTask &&
      selectedBridge &&
      selectedWorkspace &&
      hasSameCodexDispatchTarget({
        task: activeTask,
        bridgeId: selectedBridge.bridgeId,
        workspaceId: selectedWorkspace.id,
      }),
  )
  const canSteerActiveTask = Boolean(
    activeTask &&
      activeTaskMatchesTarget &&
      STEERABLE_CODEX_TASK_STATES.has(activeTask.state),
  )
  const canStartTask = Boolean(
    (!activeTask || isCodexTerminalTaskState(activeTask.state)) &&
      !selectedBridge?.activeTaskId,
  )
  const canDispatch = Boolean(
    target === 'codex' &&
      selectedBridge?.status === 'online' &&
      selectedWorkspace &&
      !dispatching &&
      (canSteerActiveTask || canStartTask),
  )

  const dispatch = React.useCallback(async (
    rawGoal: string,
    context: CodexCanvasScope,
  ): Promise<CodexDispatchSubmission> => {
    const goal = rawGoal.trim()
    if (!goal) throw new Error('请先输入要交给 Codex 的真实产品目标')
    if (!selectedBridge || selectedBridge.status !== 'online') {
      throw new Error('本地 Codex Bridge 当前不在线')
    }
    if (!selectedWorkspace) {
      throw new Error('请选择 Codex 被允许编辑的 workspace')
    }
    if (!canDispatch) {
      throw new Error('当前 Codex 回合不接受补充，且 Bridge 尚未空闲')
    }
    const hasActiveTargetTurn = Boolean(
      activeTask &&
        activeTaskMatchesTarget &&
        STEERABLE_CODEX_TASK_STATES.has(activeTask.state),
    )
    if (
      hasActiveTargetTurn &&
      activeTask &&
      !hasSameCodexTurnContext({ task: activeTask, context })
    ) {
      throw new Error(
        '当前 Codex 回合绑定派发时的不可变画布快照；画布版本或选择已变化，请等待本回合结束后作为同一会话的下一轮发送',
      )
    }
    const shouldSteer = hasActiveTargetTurn
    const signature = codexTaskSignature({
      kind: shouldSteer ? 'steering' : 'task',
      goal,
      context,
      activeTaskId: shouldSteer && activeTask ? activeTask.id : null,
    })
    const existingAttempt = dispatchAttemptRef.current
    const attempt =
      existingAttempt?.signature === signature
        ? existingAttempt
        : {
            signature,
            idempotencyKey: crypto.randomUUID(),
          }
    dispatchAttemptRef.current = attempt
    setDispatching(true)
    setError('')
    try {
      if (shouldSteer && activeTask) {
        const result = await createCodexTaskMessage(activeTask.id, {
          text: goal,
          idempotencyKey: attempt.idempotencyKey,
        })
        dispatchAttemptRef.current = null
        setTaskMessages((current) => {
          const remaining = current.filter(
            (message) => message.id !== result.message.id,
          )
          return [...remaining, result.message].sort(
            (left, right) => left.createdAt.localeCompare(right.createdAt),
          )
        })
        return {
          kind: 'steering',
          task: activeTask,
          message: result.message,
        }
      }
      const continuation = resolveCodexContinuationTask({
        tasks: sessionTasks,
        context,
        bridgeId: selectedBridge.bridgeId,
        workspaceId: selectedWorkspace.id,
      })
      const result = await createCodexTask({
        bridgeId: selectedBridge.bridgeId,
        workspaceId: selectedWorkspace.id,
        sessionId: continuation?.sessionId || null,
        parentTaskId: continuation?.id || null,
        goal,
        context,
        fallbackPolicy: selectedWorkspace.localDockerConfigured
          ? 'ask'
          : 'disabled',
        idempotencyKey: attempt.idempotencyKey,
      })
      dispatchAttemptRef.current = null
      setActiveTask(result.task)
      setSessionTasks((current) => {
        if (!continuation) return [result.task]
        const remaining = current.filter((task) => task.id !== result.task.id)
        return [...remaining, result.task].sort(
          (left, right) => left.turnSequence - right.turnSequence,
        )
      })
      if (!continuation) setTaskMessages([])
      return { kind: 'task', task: result.task }
    } catch (dispatchError) {
      if (!shouldRetainCodexDispatchAttempt(dispatchError)) {
        dispatchAttemptRef.current = null
      }
      const message = codexDispatchErrorMessage(dispatchError, 'Codex 任务派发失败')
      setError(message)
      throw new Error(message)
    } finally {
      setDispatching(false)
    }
  }, [
    activeTask,
    activeTaskMatchesTarget,
    canDispatch,
    selectedBridge,
    selectedWorkspace,
    sessionTasks,
  ])

  const decideFallback = React.useCallback(async (
    decision: 'approve' | 'decline',
  ) => {
    if (!activeTask || activeTask.state !== 'fallback_waiting_approval') {
      setError('当前任务不在等待本机 fallback 审批状态')
      return
    }
    if (fallbackBusy) return
    setFallbackBusy(true)
    setError('')
    try {
      const task = await decideCodexFallback(activeTask.id, { decision })
      setActiveTask(task)
    } catch (fallbackError) {
      setError(codexDispatchErrorMessage(fallbackError, 'Fallback 决策提交失败'))
    } finally {
      setFallbackBusy(false)
    }
  }, [activeTask, fallbackBusy])

  return {
    target,
    setTarget,
    bridges,
    selectedBridge,
    selectedWorkspace,
    selectedBridgeId,
    selectedWorkspaceId,
    selectBridge,
    selectWorkspace,
    loadingBridges,
    pairing,
    pairingBusy,
    activeTask,
    sessionTasks,
    taskMessages,
    dispatching,
    fallbackBusy,
    error,
    canDispatch,
    refresh,
    beginPairing,
    copyPairingPrompt,
    dispatch,
    decideFallback,
  }
}
