import type { AgentsChatTurnInterruptReceiptDto } from '../../api/agentsChatTurn'

export type ChatInterruptLiveRunAction = 'cancel' | 'mark_inactive' | 'keep_pending'

export type ChatInterruptPresentation = Readonly<{
  liveRunAction: ChatInterruptLiveRunAction
  message: string
  color: 'green' | 'gray' | 'yellow' | 'red'
}>

function describeLocalTransport(
  receipt: AgentsChatTurnInterruptReceiptDto['localTransport'],
): string {
  switch (receipt.status) {
    case 'interrupted': return '已中断'
    case 'not_running': return '无在飞任务'
    case 'failed': return `失败（${receipt.error.code}）`
  }
}

function describeRuntime(receipt: AgentsChatTurnInterruptReceiptDto['runtime']): string {
  switch (receipt.status) {
    case 'interrupted': return '已中断'
    case 'already_inactive': return '已结束'
    case 'unknown': return `状态未知（${receipt.error.code}）`
    case 'failed': return `失败（${receipt.error.code}）`
  }
}

function describeContinuations(
  receipt: AgentsChatTurnInterruptReceiptDto['continuations'],
): string {
  switch (receipt.status) {
    case 'cancelled': return `已取消 ${receipt.cancelledCount} 个`
    case 'none': return '无等待任务'
    case 'failed': return `失败（${receipt.error.code}）`
  }
}

function describeWorkflows(
  receipt: AgentsChatTurnInterruptReceiptDto['workflowExecutions'],
): string {
  switch (receipt.status) {
    case 'cancelled': return `已取消 ${receipt.cancelledCount} 个`
    case 'none': return '无本轮在飞工作流'
    case 'failed': return `失败（${receipt.error.code}）`
  }
}

function operationSummary(receipt: AgentsChatTurnInterruptReceiptDto): string {
  return [
    `本地：${describeLocalTransport(receipt.localTransport)}`,
    `远端：${describeRuntime(receipt.runtime)}`,
    `续跑：${describeContinuations(receipt.continuations)}`,
    `工作流：${describeWorkflows(receipt.workflowExecutions)}`,
  ].join('；')
}

/**
 * Projects only machine receipt facts. It never infers remote completion from
 * local cancellation or from a missing status snapshot.
 */
export function resolveChatInterruptPresentation(
  receipt: AgentsChatTurnInterruptReceiptDto,
): ChatInterruptPresentation {
  const summary = operationSummary(receipt)
  if (receipt.fullyInterrupted) {
    if (receipt.interrupted) {
      return {
        liveRunAction: 'cancel',
        message: `已完全中断当前任务。${summary}`,
        color: 'green',
      }
    }
    return {
      liveRunAction: 'mark_inactive',
      message: `当前任务已不在运行。${summary}`,
      color: 'gray',
    }
  }
  if (receipt.runtime.status === 'unknown') {
    return {
      liveRunAction: 'keep_pending',
      message: `中断未完全确认，远端状态未知。${summary}`,
      color: 'yellow',
    }
  }
  return {
    liveRunAction: 'keep_pending',
    message: `中断仅部分完成。${summary}`,
    color: 'red',
  }
}
