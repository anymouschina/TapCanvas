import { afterEach, describe, expect, it, vi } from 'vitest'

import { publicChatStream, type PublicChatStreamEvent } from '../../src/api/server'

function createSseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk))
      }
      controller.close()
    },
  })
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
  })
}

describe('publicChatStream', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('parses canonical named SSE events', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        createSseResponse([
          'event: initial\ndata: {"requestId":"req_1","messageId":"msg_1"}\n\n',
          'event: session\ndata: {"sessionId":"project:p1:flow:f1"}\n\n',
          'event: thinking\ndata: {"text":"已接收请求，开始执行"}\n\n',
          'event: tool\ndata: {"toolCallId":"tool_1","toolName":"TodoWrite","phase":"started","startedAt":"2026-03-19T10:00:00.000Z"}\n\n',
          'event: content\ndata: {"delta":"你好"}\n\n',
          'event: result\ndata: {"response":{"id":"resp_1","vendor":"agents","text":"最终结果"}}\n\n',
          'event: done\ndata: {"reason":"finished"}\n\n',
        ]),
      ),
    )

    const events: PublicChatStreamEvent[] = []
    await publicChatStream(
      {
        vendor: 'agents',
        prompt: '测试',
      },
      {
        onEvent: (event) => {
          events.push(event)
        },
      },
    )

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(events.map((event) => event.event)).toEqual([
      'initial',
      'session',
      'thinking',
      'tool',
      'content',
      'result',
      'done',
    ])
    expect(events[3]).toMatchObject({
      event: 'tool',
      data: {
        toolName: 'TodoWrite',
        phase: 'started',
      },
    })
    expect(events[5]).toMatchObject({
      event: 'result',
      data: {
        response: {
          text: '最终结果',
        },
      },
    })
  })
})
