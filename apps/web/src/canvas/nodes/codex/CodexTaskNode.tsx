import * as React from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { isCodexTerminalTaskState, type CodexCanvasScope, type CodexTaskState } from '@tapcanvas/codex-task-protocol'
import {
  IconBrandOpenai,
  IconCheck,
  IconClipboard,
  IconExternalLink,
  IconRefresh,
  IconSend,
  IconX,
} from '@tabler/icons-react'
import type { TaskNodeType } from '../taskNode/taskNodeTypes'
import { useRFStore } from '../../store'
import { useUIStore } from '../../../ui/uiStore'
import { useCodexDispatch } from '../../../ui/chat/codex/useCodexDispatch'
import { buildCodexTimeline } from '../../../ui/chat/codex/codexConversation'
import { persistCodexCanvasBeforeDispatch } from '../../../ui/chat/codex/codexCanvasPersistence'
import {
  buildCodexTaskNodePatch,
  CODEX_CLI_BRIDGE_MIN_VERSION,
  collectCodexContextNodeIds,
  isCodexBridgeCliCompatible,
  readCodexTaskNodeData,
} from './codexTaskNodeRuntime'
import './CodexTaskNode.css'

const TASK_STATE_LABELS: Readonly<Record<CodexTaskState, string>> = {
  queued: '排队中',
  claimed: '已领取',
  codex_running: 'Codex 执行中',
  awaiting_user_input: '等待回复',
  codex_failed: 'Codex 失败',
  remote_build_queued: '等待验证',
  remote_build_running: '隔离验证中',
  remote_build_failed_code: '代码验证失败',
  remote_build_failed_infrastructure: '验证设施失败',
  fallback_waiting_approval: '等待本机审批',
  local_fallback_approved: '已批准本机验证',
  local_build_running: '本机隔离验证中',
  succeeded: '验收通过',
  failed: '失败',
  canceled: '已取消',
  unknown: '终态未知',
}

function formatTime(value: string): string {
  if (!value) return ''
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

type CodexTaskNodeProps = NodeProps<TaskNodeType> & {
  overview?: boolean
  focused?: boolean
}

function CodexTaskNodePreview(props: CodexTaskNodeProps): JSX.Element {
  const nodeData = readCodexTaskNodeData(props.data)
  return (
    <div className="tc-codex-node tc-codex-node--preview" data-state={nodeData.state || 'idle'}>
      <div className="tc-codex-node__preview-header">
        <div className="tc-codex-node__overview-header">
          <IconBrandOpenai className="tc-codex-node__overview-icon" size={18} aria-hidden="true" />
          <span className="tc-codex-node__overview-title">{nodeData.label}</span>
        </div>
        <span className="tc-codex-node__overview-state">
          {nodeData.state ? TASK_STATE_LABELS[nodeData.state] : '等待任务'}
        </span>
      </div>
      <div className="tc-codex-node__preview-body">
        <p className="tc-codex-node__preview-summary">
          {nodeData.summary || '选中节点后，可以像与子智能体对话一样持续给 Codex 分发任务。'}
        </p>
        <span className="tc-codex-node__preview-hint">
          {nodeData.sessionId ? '持久会话已建立' : 'TapCanvas CLI · 未开始会话'}
        </span>
      </div>
      <Handle className="tc-codex-node__handle" id="in-any" type="target" position={Position.Left} />
      <Handle className="tc-codex-node__handle" id="out-text" type="source" position={Position.Right} />
    </div>
  )
}

export function CodexTaskNode(props: CodexTaskNodeProps): JSX.Element {
  if (!props.focused || props.overview) {
    return <CodexTaskNodePreview {...props} />
  }
  return <CodexTaskNodeInteractive {...props} />
}

function CodexTaskNodeInteractive(props: CodexTaskNodeProps): JSX.Element {
  const nodeData = readCodexTaskNodeData(props.data)
  const updateNodeData = useRFStore((state) => state.updateNodeData)
  const edges = useRFStore((state) => state.edges)
  const currentProjectId = useUIStore((state) => String(state.currentProject?.id || '').trim())
  const currentFlowId = useUIStore((state) => String(state.currentFlow?.id || '').trim())
  const currentChapter = useUIStore((state) => state.currentChapter)
  const projectId = String(currentChapter?.projectId || currentProjectId).trim()
  const chapterId = String(currentChapter?.chapterId || '').trim()
  const flowId = chapterId ? '' : currentFlowId
  const controller = useCodexDispatch({
    projectId,
    sessionId: nodeData.sessionId || null,
    ownerNodeId: props.id,
    fixedTarget: 'codex',
  })
  const [draft, setDraft] = React.useState(nodeData.draft)
  const [submitting, setSubmitting] = React.useState(false)
  const timeline = React.useMemo(
    () => buildCodexTimeline({
      tasks: controller.sessionTasks,
      messages: controller.taskMessages,
    }),
    [controller.sessionTasks, controller.taskMessages],
  )
  const activeTask = controller.activeTask
  const currentState = activeTask?.state || nodeData.state
  const hasOnlineBridge = controller.bridges.some((bridge) => bridge.status === 'online')
  const selectedBridgeCliCompatible = Boolean(
    controller.selectedBridge &&
    isCodexBridgeCliCompatible(controller.selectedBridge.workerVersion),
  )
  const requiresBridgeUpgrade = Boolean(
    controller.selectedBridge && !selectedBridgeCliCompatible,
  )

  React.useEffect(() => {
    setDraft(nodeData.draft)
  }, [nodeData.draft])

  React.useEffect(() => {
    if (
      nodeData.bridgeId &&
      controller.selectedBridge?.bridgeId !== nodeData.bridgeId
    ) {
      controller.selectBridge(nodeData.bridgeId)
      return
    }
    if (
      nodeData.workspaceId &&
      controller.selectedWorkspace?.id !== nodeData.workspaceId
    ) {
      controller.selectWorkspace(nodeData.workspaceId)
    }
  }, [
    controller.selectBridge,
    controller.selectWorkspace,
    controller.selectedBridge?.bridgeId,
    controller.selectedWorkspace?.id,
    nodeData.bridgeId,
    nodeData.workspaceId,
  ])

  React.useEffect(() => {
    if (!activeTask) return
    if (
      activeTask.id === nodeData.taskId &&
      activeTask.updatedAt === nodeData.updatedAt &&
      activeTask.state === nodeData.state
    ) return
    updateNodeData(props.id, buildCodexTaskNodePatch(activeTask))
  }, [activeTask, nodeData.state, nodeData.taskId, nodeData.updatedAt, props.id, updateNodeData])

  const persistDraft = React.useCallback(() => {
    if (draft !== nodeData.draft) updateNodeData(props.id, { codexDraft: draft })
  }, [draft, nodeData.draft, props.id, updateNodeData])

  const selectBridge = React.useCallback((event: React.ChangeEvent<HTMLSelectElement>) => {
    const bridgeId = event.currentTarget.value
    controller.selectBridge(bridgeId)
    updateNodeData(props.id, { codexBridgeId: bridgeId, codexWorkspaceId: '' })
  }, [controller, props.id, updateNodeData])

  const selectWorkspace = React.useCallback((event: React.ChangeEvent<HTMLSelectElement>) => {
    const workspaceId = event.currentTarget.value
    controller.selectWorkspace(workspaceId)
    updateNodeData(props.id, { codexWorkspaceId: workspaceId })
  }, [controller, props.id, updateNodeData])

  const dispatch = React.useCallback(async () => {
    const goal = draft.trim()
    if (!goal || submitting) return
    if (!projectId) {
      updateNodeData(props.id, { codexSummary: '请先把 Codex 节点放在真实项目画布中。', status: 'error' })
      return
    }
    if (!selectedBridgeCliCompatible) {
      updateNodeData(props.id, {
        codexSummary: `当前 Codex Bridge 不满足 TapCanvas CLI 合同；请先升级到 ${CODEX_CLI_BRIDGE_MIN_VERSION} 或更高版本。`,
        status: 'error',
      })
      return
    }
    setSubmitting(true)
    try {
      let context: CodexCanvasScope
      if (activeTask && !isCodexTerminalTaskState(activeTask.state)) {
        context = {
          projectId: activeTask.context.projectId,
          flowId: activeTask.context.flowId,
          chapterId: activeTask.context.chapterId,
          canvasRevision: activeTask.context.canvasRevision,
          selectedNodeIds: [...activeTask.context.selectedNodeIds],
        }
      } else {
        const persisted = await persistCodexCanvasBeforeDispatch({
          flowId: flowId || null,
          chapterId: chapterId || null,
        })
        context = {
          projectId,
          flowId: persisted.flowId,
          chapterId: persisted.chapterId,
          canvasRevision: persisted.canvasRevision,
          selectedNodeIds: collectCodexContextNodeIds(props.id, edges),
        }
      }
      const submission = await controller.dispatch(goal, context)
      updateNodeData(props.id, {
        ...buildCodexTaskNodePatch(submission.task),
        codexDraft: '',
      })
      setDraft('')
    } catch (error: unknown) {
      updateNodeData(props.id, {
        codexSummary: error instanceof Error ? error.message : 'Codex 任务派发失败',
        status: 'error',
      })
    } finally {
      setSubmitting(false)
    }
  }, [activeTask, chapterId, controller, draft, edges, flowId, projectId, props.id, selectedBridgeCliCompatible, submitting, updateNodeData])

  const pairOrCopy = React.useCallback(async () => {
    if (controller.pairing) await controller.copyPairingPrompt()
    else await controller.beginPairing()
  }, [controller])

  return (
    <div className="tc-codex-node" data-state={currentState || 'idle'}>
      <header className="tc-codex-node__header">
        <div className="tc-codex-node__identity">
          <IconBrandOpenai className="tc-codex-node__brand" size={18} aria-hidden="true" />
          <div className="tc-codex-node__title-stack">
            <strong className="tc-codex-node__title">{nodeData.label}</strong>
            <span className="tc-codex-node__subtitle">TapCanvas CLI · 持久会话</span>
          </div>
        </div>
        <div className="tc-codex-node__connection" data-online={hasOnlineBridge ? 'true' : 'false'}>
          <span className="tc-codex-node__connection-dot" aria-hidden="true" />
          <span className="tc-codex-node__connection-label">{hasOnlineBridge ? '在线' : '离线'}</span>
        </div>
      </header>

      {hasOnlineBridge ? (
        <div className="tc-codex-node__selectors nodrag nopan">
          <select
            className="tc-codex-node__select"
            aria-label="选择 Codex Bridge"
            value={controller.selectedBridge?.bridgeId || ''}
            onChange={selectBridge}
          >
            {controller.bridges.map((bridge) => (
              <option className="tc-codex-node__select-option" key={bridge.bridgeId} value={bridge.bridgeId}>
                {bridge.name}{bridge.status === 'online' ? '' : ' · 离线'}
              </option>
            ))}
          </select>
          <select
            className="tc-codex-node__select tc-codex-node__select--workspace"
            aria-label="选择 Codex workspace"
            value={controller.selectedWorkspace?.id || ''}
            onChange={selectWorkspace}
          >
            {(controller.selectedBridge?.workspaces || []).map((workspace) => (
              <option className="tc-codex-node__select-option" key={workspace.id} value={workspace.id}>
                {workspace.label}
              </option>
            ))}
          </select>
          <button
            className="tc-codex-node__icon-button"
            type="button"
            aria-label="刷新 Codex Bridge 状态"
            title="刷新连接"
            onClick={() => void controller.refresh()}
          >
            <IconRefresh className="tc-codex-node__button-icon" size={14} aria-hidden="true" />
          </button>
        </div>
      ) : (
        <div className="tc-codex-node__pairing nodrag nopan">
          <div className="tc-codex-node__pairing-copy">
            <strong className="tc-codex-node__pairing-title">连接本机 Codex</strong>
            <span className="tc-codex-node__pairing-note">配对会安装 Bridge、TapCanvas CLI 与官方 Skill。</span>
          </div>
          <button
            className="tc-codex-node__secondary-button"
            type="button"
            disabled={controller.pairingBusy}
            onClick={() => void pairOrCopy()}
          >
            {controller.pairing?.copied
              ? <IconCheck className="tc-codex-node__button-icon" size={14} aria-hidden="true" />
              : <IconClipboard className="tc-codex-node__button-icon" size={14} aria-hidden="true" />}
            <span className="tc-codex-node__button-label">
              {controller.pairing ? '再次复制' : '复制配对任务'}
            </span>
          </button>
        </div>
      )}

      {requiresBridgeUpgrade ? (
        <div className="tc-codex-node__pairing tc-codex-node__pairing--upgrade nodrag nopan">
          <div className="tc-codex-node__pairing-copy">
            <strong className="tc-codex-node__pairing-title">Bridge 需要升级</strong>
            <span className="tc-codex-node__pairing-note">
              当前 {controller.selectedBridge?.workerVersion || '未知版本'}；Codex 节点要求 {CODEX_CLI_BRIDGE_MIN_VERSION}+，以保证 TapCanvas CLI 可用。
            </span>
          </div>
          <button
            className="tc-codex-node__secondary-button"
            type="button"
            disabled={controller.pairingBusy}
            onClick={() => void pairOrCopy()}
          >
            {controller.pairing?.copied
              ? <IconCheck className="tc-codex-node__button-icon" size={14} aria-hidden="true" />
              : <IconClipboard className="tc-codex-node__button-icon" size={14} aria-hidden="true" />}
            <span className="tc-codex-node__button-label">{controller.pairing ? '再次复制' : '复制升级任务'}</span>
          </button>
        </div>
      ) : null}

      <div className="tc-codex-node__timeline nodrag nopan nowheel">
        {timeline.length ? timeline.slice(-8).map((entry) => (
          <article className="tc-codex-node__message" data-role={entry.role} data-kind={entry.kind} key={entry.id}>
            <div className="tc-codex-node__message-meta">
              <span className="tc-codex-node__message-role">{entry.role === 'user' ? '你' : 'Codex'}</span>
              <time className="tc-codex-node__message-time">{entry.ts}</time>
            </div>
            <p className="tc-codex-node__message-content">{entry.content}</p>
          </article>
        )) : (
          <div className="tc-codex-node__empty">
            <IconBrandOpenai className="tc-codex-node__empty-icon" size={24} aria-hidden="true" />
            <strong className="tc-codex-node__empty-title">把任务交给 Codex</strong>
            <span className="tc-codex-node__empty-note">连入上游节点即可把相关画布内容一并交给它。</span>
          </div>
        )}
      </div>

      {currentState ? (
        <div className="tc-codex-node__status" data-state={currentState}>
          <span className="tc-codex-node__status-label">{TASK_STATE_LABELS[currentState]}</span>
          <span className="tc-codex-node__status-time">{formatTime(activeTask?.updatedAt || nodeData.updatedAt)}</span>
          {activeTask?.state === 'fallback_waiting_approval' ? (
            <div className="tc-codex-node__approval-actions nodrag nopan">
              <button className="tc-codex-node__approval-button" type="button" onClick={() => void controller.decideFallback('approve')}>
                批准本次
              </button>
              <button className="tc-codex-node__reject-button" type="button" aria-label="拒绝本机验证" onClick={() => void controller.decideFallback('decline')}>
                <IconX className="tc-codex-node__button-icon" size={13} aria-hidden="true" />
              </button>
            </div>
          ) : null}
          {activeTask?.state === 'succeeded' && activeTask.deliveryEvidence.preview ? (
            <a
              className="tc-codex-node__preview-link nodrag nopan"
              href={`/preview/${encodeURIComponent(activeTask.previewId)}`}
              target="_blank"
              rel="noreferrer"
              aria-label="打开 Codex 验收预览"
              title="打开验收预览"
            >
              <IconExternalLink className="tc-codex-node__button-icon" size={14} aria-hidden="true" />
            </a>
          ) : null}
        </div>
      ) : null}

      <div className="tc-codex-node__composer nodrag nopan">
        <textarea
          className="tc-codex-node__textarea nowheel"
          value={draft}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onBlur={persistDraft}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault()
              void dispatch()
            }
          }}
          placeholder={activeTask && !isCodexTerminalTaskState(activeTask.state) ? '补充当前回合…' : '描述要 Codex 完成的任务…'}
          aria-label="Codex 任务"
        />
        <button
          className="tc-codex-node__send-button"
          type="button"
          aria-label="发送给 Codex"
          title="发送（⌘/Ctrl + Enter）"
          disabled={!draft.trim() || !controller.canDispatch || !selectedBridgeCliCompatible || submitting}
          onClick={() => void dispatch()}
        >
          <IconSend className="tc-codex-node__send-icon" size={16} aria-hidden="true" />
        </button>
      </div>

      {controller.error || nodeData.summary && !timeline.length ? (
        <p className="tc-codex-node__error">{controller.error || nodeData.summary}</p>
      ) : null}

      <Handle className="tc-codex-node__handle" id="in-any" type="target" position={Position.Left} title="输入画布上下文" />
      <Handle className="tc-codex-node__handle" id="out-text" type="source" position={Position.Right} title="输出 Codex 结果" />
    </div>
  )
}
