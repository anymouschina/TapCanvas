import type { AgentsChatResponseDto } from '../../api/server'
import type { AgentLogicalTaskStatusV1 } from '@tapcanvas/agent-observability'

export type ChatTurnVerdict = NonNullable<NonNullable<AgentsChatResponseDto['trace']>['turnVerdict']>
type ChatTurnVerdictCarrier = { trace?: { turnVerdict?: ChatTurnVerdict } }

type ChatTerminalCarrier = Pick<AgentsChatResponseDto, 'trace'>

export type ChatTerminalProjection = Readonly<{
  status: AgentLogicalTaskStatusV1
  reason: string
}>

/**
 * Consume the single Hono-committed logical-task state. The browser does not
 * re-arbitrate completion from delivery evidence, verdict prose, transport
 * completion or legacy request terminals.
 */
export function resolveChatTerminalProjection(
  response: ChatTerminalCarrier,
): ChatTerminalProjection {
  const state = response.trace?.logicalTaskState
  if (!state) return { status: 'failed', reason: 'logical_task_state_missing' }
  return {
    status: state.status,
    reason: String(state.reasonCode || '').trim() || 'logical_task_reason_missing',
  }
}

export function readChatTurnVerdict(
  response: ChatTurnVerdictCarrier,
): ChatTurnVerdict | null {
  const verdict = response.trace?.turnVerdict
  if (!verdict) return null
  const status = verdict.status
  if (status !== 'satisfied' && status !== 'partial' && status !== 'failed') return null
  const reasons = Array.isArray(verdict.reasons)
    ? verdict.reasons
      .map((item) => String(item || '').trim())
      .filter(Boolean)
    : []
  if (!reasons.length) return null
  return { status, reasons }
}

export function formatTurnVerdictSummary(
  verdict: ChatTurnVerdict | null | undefined,
): string | null {
  if (!verdict || verdict.status === 'satisfied') return null
  const labels = verdict.reasons.map((reason) => {
    switch (reason) {
      case 'invalid_canvas_plan':
        return '返回的画布计划无效'
      case 'parsed_plan_without_nodes':
        return '返回的画布计划没有可创建节点'
      case 'force_asset_generation_unmet':
        return '后端判定本轮未满足强制产资产约束'
      case 'empty_response_without_execution':
        return '后端判定本轮没有可用结果，也没有执行落点'
      case 'tool_execution_issues':
        return '存在工具执行异常'
      case 'diagnostic_flags_present':
        return '存在结构诊断标记'
      case 'todo_checklist_incomplete':
        return 'Checklist 仍有未完成关键项'
      case 'video_prompt_core_fields_missing':
        return '视频提示词缺少 storyBeatPlan 或 prompt'
      case 'video_prompt_contract_missing':
        return '视频提示词缺少结构化合同'
      case 'video_prompt_explicitness_missing':
        return '视频提示词缺少显式动作清单'
      case 'video_prompt_physics_constraints_missing':
        return '视频提示词缺少物理/空间约束'
      case 'video_prompt_cinematic_precedent_missing':
        return '未说明是否可借鉴经典镜头语法'
      case 'video_prompt_preproduction_decision_missing':
        return '未声明是否需要预生产资产'
      case 'video_prompt_preproduction_assets_missing':
        return '视频提示词依赖的预生产资产尚未补齐'
      default:
        return reason
    }
  })
  const prefix = verdict.status === 'failed' ? '结构失败' : '部分完成'
  return `${prefix}：${labels.join('；')}`
}

export function formatChatTurnVerdictSummary(
  response: ChatTurnVerdictCarrier,
): string | null {
  return formatTurnVerdictSummary(readChatTurnVerdict(response))
}

export function isFailedChatTurn(
  response: ChatTerminalCarrier,
): boolean {
  return resolveChatTerminalProjection(response).status === 'failed'
}

export function resolveTerminalReply(input: {
  response: ChatTerminalCarrier
  originalReply: string
  verdictSummary?: string | null
}): { text: string; failed: boolean } {
  const projection = resolveChatTerminalProjection(input.response)
  if (projection.status === 'failed' && projection.reason === 'logical_task_state_missing') {
    return {
      text: '本轮执行失败：服务端未返回逻辑任务状态（logical_task_state_missing）。',
      failed: true,
    }
  }
  if (projection.status !== 'failed') {
    return { text: input.originalReply, failed: false }
  }
  return {
    text: input.verdictSummary || `本轮执行失败：${projection.reason}`,
    failed: true,
  }
}

export function isAsyncSubmissionResponse(
  response: Pick<AgentsChatResponseDto, 'trace'>,
): boolean {
  const logicalState = response.trace?.logicalTaskState
  const terminalReason = String(logicalState?.reasonCode || '').trim()
  if (
    terminalReason === 'managed_async_submission' ||
    terminalReason === 'agents_bridge_request_accepted_pending'
  ) {
    return true
  }

  if (response.trace?.runtime?.deliveryReport?.satisfiedByAsyncSubmission === true) {
    return true
  }

  return response.trace?.deliveryEvidence?.artifacts.some(
    (artifact) => artifact.deliveryState === 'accepted_async',
  ) === true
}

export function resolveAssistantReplyText(input: {
  response: Pick<AgentsChatResponseDto, 'trace'>
  reply: string
}): string {
  const normalizedReply = String(input.reply || '').trim()
  if (normalizedReply) return normalizedReply
  const logicalState = input.response.trace?.logicalTaskState
  if (logicalState?.status === 'waiting_external' || logicalState?.status === 'active') {
    return isAsyncSubmissionResponse(input.response)
      ? '异步编排已持久受理；供应商是否受理与最终交付以真实任务和资产证据为准。'
      : '当前执行窗口已结束，任务已进入持久续跑。'
  }
  if (logicalState?.status === 'waiting_input') return '需要补充信息后才能继续执行。'
  return '（空响应）'
}

export function shouldShowMissingCanvasPlanError(input: {
  hasCanvasPlan: boolean
  hasWrongCanvasPlanTag: boolean
  response: Pick<AgentsChatResponseDto, 'trace'>
}): boolean {
  if (input.hasCanvasPlan) return false
  if (input.hasWrongCanvasPlanTag) return true
  const verification = input.response.trace?.deliveryVerification
	return verification?.status === 'unsatisfied' &&
		input.response.trace?.logicalTaskState?.status === 'failed'
}

export function shouldAutoAddAssistantAssetsToCanvas(input: {
  canvasPlanExecuted: boolean
  aiChatWatchAssetsEnabled: boolean
  assistantAssetCount: number
  response: Pick<AgentsChatResponseDto, 'trace'>
}): boolean {
  if (input.canvasPlanExecuted) return false
  if (!input.aiChatWatchAssetsEnabled) return false
  if (input.assistantAssetCount <= 0) return false

  const backendWroteCanvas = input.response.trace?.deliveryEvidence?.wroteCanvas === true

  if (backendWroteCanvas) return false
	if (input.response.trace?.deliveryVerification?.status === 'unsatisfied') return false
	if (input.response.trace?.logicalTaskState?.status === 'failed') return false

  return true
}
