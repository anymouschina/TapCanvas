import type { AgentsChatResponseDto } from '../../api/server'

export type ChatTurnVerdict = NonNullable<NonNullable<AgentsChatResponseDto['trace']>['turnVerdict']>
type ChatTurnVerdictCarrier = { trace?: { turnVerdict?: ChatTurnVerdict } }

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
  response: ChatTurnVerdictCarrier,
): boolean {
  return readChatTurnVerdict(response)?.status === 'failed'
}

export function shouldShowMissingCanvasPlanError(input: {
  hasCanvasPlan: boolean
  hasWrongCanvasPlanTag: boolean
  response: Pick<AgentsChatResponseDto, 'agentDecision' | 'trace'>
}): boolean {
  if (input.hasCanvasPlan) return false
  if (input.hasWrongCanvasPlanTag) return true

  const turnVerdict = readChatTurnVerdict(input.response)
  const verdictReasons = new Set(turnVerdict?.reasons ?? [])
  if (
    isFailedChatTurn(input.response) &&
    (verdictReasons.has('invalid_canvas_plan') || verdictReasons.has('parsed_plan_without_nodes'))
  ) {
    return true
  }

  const outputMode = input.response.trace?.outputMode
  const executionKind = input.response.agentDecision?.executionKind
  const canvasAction = input.response.agentDecision?.canvasAction
  const wroteCanvas = canvasAction === 'write_canvas'
  const isPlainAnswer =
    executionKind === 'answer' &&
    canvasAction !== 'create_canvas_workflow' &&
    canvasAction !== 'write_canvas'
  const backendExpectedCanvasPlan =
    outputMode === 'plan_only' ||
    outputMode === 'plan_with_assets' ||
    canvasAction === 'create_canvas_workflow'

  if (wroteCanvas || executionKind === 'execute') {
    return false
  }

  if (isPlainAnswer && outputMode === 'text_only') {
    return false
  }

  if (
    outputMode === 'text_only' &&
    executionKind === 'answer' &&
    canvasAction !== 'create_canvas_workflow'
  ) {
    return false
  }

  if (isPlainAnswer && !backendExpectedCanvasPlan) {
    return false
  }

  return backendExpectedCanvasPlan
}

export function shouldAutoAddAssistantAssetsToCanvas(input: {
  canvasPlanExecuted: boolean
  aiChatWatchAssetsEnabled: boolean
  assistantAssetCount: number
  response: Pick<AgentsChatResponseDto, 'agentDecision' | 'trace'>
}): boolean {
  if (input.canvasPlanExecuted) return false
  if (!input.aiChatWatchAssetsEnabled) return false
  if (input.assistantAssetCount <= 0) return false

  const backendWroteCanvas =
    input.response.agentDecision?.canvasAction === 'write_canvas' ||
    input.response.trace?.toolEvidence?.wroteCanvas === true

  if (backendWroteCanvas) return false
  if (isFailedChatTurn(input.response)) return false

  return true
}
