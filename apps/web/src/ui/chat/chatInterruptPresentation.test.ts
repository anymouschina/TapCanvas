import { describe, expect, it } from 'vitest'
import type { AgentsChatTurnInterruptReceiptDto } from '../../api/agentsChatTurn'
import { resolveChatInterruptPresentation } from './chatInterruptPresentation'

function receipt(
  input: Pick<
    AgentsChatTurnInterruptReceiptDto,
    'interrupted' | 'fullyInterrupted' | 'localTransport' | 'runtime' | 'continuations'
  >,
): AgentsChatTurnInterruptReceiptDto {
  return {
    ok: true,
    sessionKey: 'session_1',
    turnId: 'turn_1',
    status: null,
    cancellationScope: 'logical_task',
    workflowExecutions: {
      status: 'none',
      matchedCount: 0,
      cancelledCount: 0,
      executionIds: [],
      fullyInterrupted: true,
    },
    ...input,
  }
}

describe('chat interrupt presentation', () => {
  it('only reports complete success when fullyInterrupted is true', () => {
    const presentation = resolveChatInterruptPresentation(receipt({
      interrupted: true,
      fullyInterrupted: true,
      localTransport: { status: 'interrupted' },
      runtime: { status: 'interrupted', turnId: 'turn_1' },
      continuations: { status: 'cancelled', cancelledCount: 2 },
    }))

    expect(presentation.liveRunAction).toBe('cancel')
    expect(presentation.color).toBe('green')
    expect(presentation.message).toContain('已完全中断当前任务')
    expect(presentation.message).toContain('本地：已中断')
    expect(presentation.message).toContain('远端：已中断')
    expect(presentation.message).toContain('续跑：已取消 2 个')
    expect(presentation.message).toContain('工作流：无本轮在飞工作流')
  })

  it('keeps the live run pending and names every branch when runtime is unknown', () => {
    const presentation = resolveChatInterruptPresentation(receipt({
      interrupted: true,
      fullyInterrupted: false,
      localTransport: { status: 'interrupted' },
      runtime: {
        status: 'unknown',
        error: {
          code: 'agents_chat_runtime_timeout',
          message: 'runtime interrupt timed out',
        },
      },
      continuations: { status: 'cancelled', cancelledCount: 1 },
    }))

    expect(presentation.liveRunAction).toBe('keep_pending')
    expect(presentation.color).toBe('yellow')
    expect(presentation.message).toContain('中断未完全确认，远端状态未知')
    expect(presentation.message).toContain('本地：已中断')
    expect(presentation.message).toContain('远端：状态未知（agents_chat_runtime_timeout）')
    expect(presentation.message).toContain('续跑：已取消 1 个')
    expect(presentation.message).not.toContain('已完全中断当前任务')
  })

  it('distinguishes an already inactive turn from an interrupted turn', () => {
    const presentation = resolveChatInterruptPresentation(receipt({
      interrupted: false,
      fullyInterrupted: true,
      localTransport: { status: 'not_running' },
      runtime: { status: 'already_inactive', turnId: 'turn_1' },
      continuations: { status: 'none', cancelledCount: 0 },
    }))

    expect(presentation.liveRunAction).toBe('mark_inactive')
    expect(presentation.color).toBe('gray')
    expect(presentation.message).toContain('当前任务已不在运行')
    expect(presentation.message).toContain('本地：无在飞任务')
    expect(presentation.message).toContain('远端：已结束')
    expect(presentation.message).toContain('续跑：无等待任务')
  })
})
