import { describe, expect, it, vi } from 'vitest'

import * as apiServer from '../api/server'
import {
  buildChapterIntentChatRequest,
  handleChapterIntentStreamEvent,
  streamChapterIntent,
  type StreamChapterIntentParams,
} from './streamChapterIntent'

function makeParams(): StreamChapterIntentParams {
  return {
    executionId: 'batch-01HZX',
    intent: 'generate_scene_references',
    sourceNodeId: 'source-1',
    chapterContext: {
      projectId: 'project-1',
      bookId: 'book-1',
      chapterId: 'chapter-1',
      flowSnapshot: {
        nodes: [
          {
            id: 'source-1',
            kind: 'text',
            data: { text: '完整章节正文', status: 'ready' },
          },
          {
            id: 'other-1',
            kind: 'image',
            data: { label: '参考图', status: 'success', privatePrompt: '不应常驻发送' },
          },
        ],
        edges: [],
      },
    },
    abortSignal: new AbortController().signal,
    onTool: vi.fn(),
    onTerminal: vi.fn(),
    onError: vi.fn(),
  }
}

function logicalTaskState(
  logicalTaskId: string,
  status: 'active' | 'waiting_input' | 'waiting_external' | 'succeeded' | 'failed' | 'cancelled',
  reasonCode: string,
) {
  return {
    version: 1 as const,
    logicalTaskId,
    status,
    reasonCode,
    physicalRunStatus: status === 'active'
      ? 'running' as const
      : status === 'waiting_external'
        ? 'handed_off' as const
        : status === 'failed' || status === 'cancelled'
          ? 'interrupted' as const
          : 'completed' as const,
    deliveryStatus: status === 'succeeded'
      ? 'satisfied' as const
      : status === 'failed' || status === 'cancelled'
        ? 'unsatisfied' as const
        : 'pending' as const,
    taskNodeId: 'root',
    taskRevision: 1,
    updatedAt: '2026-08-23T00:00:02.000Z',
    continuationTicket: null,
  }
}

describe('chapter intent unified public-chat contract', () => {
  it('binds a durable turn identity and real chapter canvas scope', () => {
    const params = makeParams()
    const request = buildChapterIntentChatRequest(params)

    expect(request.sessionKey).toBe('chapter-intent:project-1:chapter-1:batch-01HZX')
    expect(request.body).toMatchObject({
      sessionKey: request.sessionKey,
      clientPendingId: 'batch-01HZX',
      canvasProjectId: 'project-1',
      canvasNodeId: 'source-1',
      bookId: 'book-1',
      chapterId: 'chapter-1',
      intent: 'generate_scene_references',
      chapterIntentSourceNodeId: 'source-1',
    })
    const chapterContext = request.body.chapterContext as StreamChapterIntentParams['chapterContext']
    expect(chapterContext.flowSnapshot.nodes[0]?.data).toEqual({
      text: '完整章节正文',
      status: 'ready',
    })
    expect(chapterContext.flowSnapshot.nodes[1]?.data).toEqual({
      label: '参考图',
      status: 'success',
    })
  })

  it('consumes the canonical tool event without replaying a local flow patch', () => {
    const params = makeParams()
    handleChapterIntentStreamEvent('tool', JSON.stringify({
      toolCallId: 'tool-1',
      toolName: 'tapcanvas_flow_patch',
      phase: 'completed',
      status: 'succeeded',
      input: { patchNodeData: [{ id: 'source-1', patch: { status: 'done' } }] },
      startedAt: '2026-08-23T00:00:00.000Z',
      finishedAt: '2026-08-23T00:00:01.000Z',
      durationMs: 1000,
    }), params)

    expect(params.onTool).toHaveBeenCalledOnce()
    expect(params.onTool).toHaveBeenCalledWith(expect.objectContaining({
      toolCallId: 'tool-1',
      toolName: 'tapcanvas_flow_patch',
      phase: 'completed',
      status: 'succeeded',
    }))
  })

  it.each([
    ['succeeded', 'logical_succeeded'],
    ['active', 'root_physical_execution_budget_exhausted'],
    ['waiting_input', 'request_user_input_pending'],
    ['failed', 'delivery_verification_failed'],
  ] as const)('projects result logicalTaskState %s as the only completion authority', (status, reason) => {
    const params = makeParams()
    handleChapterIntentStreamEvent('result', JSON.stringify({
      response: {
        text: '结构化终态正文',
        trace: {
          logicalTaskState: { status, reasonCode: reason },
        },
      },
    }), params)

    expect(params.onTerminal).toHaveBeenCalledWith({
      status,
      reason,
      text: '结构化终态正文',
    })
    expect(params.onError).not.toHaveBeenCalled()
  })

  it('fails explicitly when result omits logicalTaskState', () => {
    const params = makeParams()
    handleChapterIntentStreamEvent('result', JSON.stringify({
      response: { text: '未经合同验证的乐观成功' },
    }), params)

    expect(params.onTerminal).not.toHaveBeenCalled()
    expect(params.onError).toHaveBeenCalledWith({
      code: 'chapter_intent_logical_task_state_missing',
      message: '章节画布 Agent result 缺少结构化 logicalTaskState',
    })
  })

  it('ignores the retired flow_patch and finalize event channels', () => {
    const params = makeParams()
    handleChapterIntentStreamEvent('flow_patch', JSON.stringify({ name: 'add_node' }), params)
    handleChapterIntentStreamEvent('finalize', JSON.stringify({ summary: 'legacy' }), params)

    expect(params.onTool).not.toHaveBeenCalled()
    expect(params.onTerminal).not.toHaveBeenCalled()
    expect(params.onError).not.toHaveBeenCalled()
  })

  it('uses the shared durable chat transport for the canonical terminal result', async () => {
    const params = makeParams()
    const stop = vi.fn()
    const streamSpy = vi.spyOn(apiServer, 'agentsChatStream').mockImplementation(async (payload, handlers) => {
      expect(payload).toMatchObject({
        clientPendingId: 'batch-01HZX',
        sessionKey: 'chapter-intent:project-1:chapter-1:batch-01HZX',
        canvasProjectId: 'project-1',
        chapterId: 'chapter-1',
      })
      handlers.onOpen?.({ turnId: 'public-chat-turn:chapter-1' })
      handlers.onEvent({
        event: 'result',
        data: {
          response: {
            id: 'response-1',
            vendor: 'agents',
            text: '真实资产已经写入画布',
            trace: {
              logicalTaskState: logicalTaskState(
                'public-chat-turn:chapter-1',
                'succeeded',
                'logical_succeeded',
              ),
            },
          },
        },
      })
      return stop
    })

    await streamChapterIntent(params)

    expect(params.onTerminal).toHaveBeenCalledWith({
      status: 'succeeded',
      reason: 'logical_succeeded',
      text: '真实资产已经写入画布',
    })
    expect(params.onError).not.toHaveBeenCalled()
    expect(stop).toHaveBeenCalledOnce()
    streamSpy.mockRestore()
  })

  it('reconciles an accepted transport failure through status instead of submitting a new intent', async () => {
    vi.useFakeTimers()
    try {
      const params = makeParams()
      const streamSpy = vi.spyOn(apiServer, 'agentsChatStream').mockImplementation(async (_payload, handlers) => {
        handlers.onOpen?.({ turnId: 'public-chat-turn:chapter-2' })
        handlers.onError?.(new Error('transport projection disconnected'))
        return vi.fn()
      })
      const statusSpy = vi.spyOn(apiServer, 'getAgentsChatTurnStatus').mockResolvedValue({
        sessionId: 'chapter-intent:project-1:chapter-1:batch-01HZX',
        durable: true,
        activeTurn: false,
        turn: {
          turnId: 'public-chat-turn:chapter-2',
          internalTurnId: 'turn-2',
          state: 'succeeded',
          logicalTaskState: logicalTaskState(
            'public-chat-turn:chapter-2',
            'succeeded',
            'logical_succeeded',
          ),
          phase: 'succeeded',
          startedAt: '2026-08-23T00:00:00.000Z',
          updatedAt: '2026-08-23T00:00:02.000Z',
          lastConfirmedAt: '2026-08-23T00:00:02.000Z',
          requestText: '生成场景参考',
          reasonCode: 'logical_succeeded',
          suspension: null,
          lastConfirmedSummary: '服务端已完成原任务',
          finalResponse: '服务端已完成原任务',
          pendingQueueCount: 0,
          recentEvents: [],
        },
      })

      const execution = streamChapterIntent(params)
      await Promise.resolve()
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(2_000)
      await execution

      expect(apiServer.agentsChatStream).toHaveBeenCalledTimes(1)
      expect(statusSpy).toHaveBeenCalledWith({
        sessionKey: 'chapter-intent:project-1:chapter-1:batch-01HZX',
      })
      expect(params.onTerminal).toHaveBeenNthCalledWith(1, {
        status: 'active',
        reason: 'chapter_intent_transport_reconcile',
        text: '',
      })
      expect(params.onTerminal).toHaveBeenNthCalledWith(2, {
        status: 'succeeded',
        reason: 'logical_succeeded',
        text: '服务端已完成原任务',
      })
      expect(params.onError).not.toHaveBeenCalled()
      streamSpy.mockRestore()
      statusSpy.mockRestore()
    } finally {
      vi.useRealTimers()
    }
  })
})
