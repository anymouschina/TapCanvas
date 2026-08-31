import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  agentsChatStream,
  type AgentsChatStreamEvent,
} from './server'

function sseFrame(input: {
  id: string
  event: string
  data: unknown
}): string {
  return `id: ${input.id}\nevent: ${input.event}\ndata: ${JSON.stringify(input.data)}\n\n`
}

function eventStream(body: string, turnId: string): Response {
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'X-Trace-ID': turnId,
    },
  })
}

describe('agents chat durable event resubscription', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('uses Last-Event-ID and afterEventId without resending the chat task, then dedupes a repeated terminal cursor', async () => {
    const publicTurnId = 'public-chat-turn:abc'
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const initial = eventStream([
      sseFrame({
        id: `${publicTurnId}#2`,
        event: 'initial',
        data: { requestId: publicTurnId, messageId: 'message-1' },
      }),
      sseFrame({
        id: `${publicTurnId}#3`,
        event: 'content',
        data: { delta: 'durable ' },
      }),
      sseFrame({
        id: `${publicTurnId}#4`,
        event: 'error',
        data: {
          message: 'recoverable provider warning',
          terminal: false,
          scope: 'provider',
          retryability: 'retryable',
          acceptanceKnown: true,
          sideEffectOutcomeKnown: true,
        },
      }),
    ].join(''), publicTurnId)
    const replay = eventStream([
      // A retrying proxy may repeat the last acknowledged frame. Cursor-based
      // dispatch must make both progress and terminal application idempotent.
      sseFrame({
        id: `${publicTurnId}#3`,
        event: 'content',
        data: { delta: 'durable ' },
      }),
      sseFrame({
        id: `${publicTurnId}#5`,
        event: 'result',
        data: {
          response: {
            id: 'response-1',
            vendor: 'agents',
            text: 'durable result',
          },
        },
      }),
      sseFrame({
        id: `${publicTurnId}#5`,
        event: 'result',
        data: {
          response: {
            id: 'response-1',
            vendor: 'agents',
            text: 'durable result',
          },
        },
      }),
    ].join(''), publicTurnId)
    const responses = [initial, replay]
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      requests.push({ url: String(input), init })
      const response = responses.shift()
      if (!response) throw new Error('unexpected extra fetch')
      return response
    })
    vi.stubGlobal('fetch', fetchMock)

    const received: AgentsChatStreamEvent[] = []
    let resolveTerminal: (() => void) | null = null
    let rejectTerminal: ((error: Error) => void) | null = null
    const terminal = new Promise<void>((resolve, reject) => {
      resolveTerminal = resolve
      rejectTerminal = reject
    })
    const abort = await agentsChatStream({
      prompt: 'continue the accepted durable turn',
      clientPendingId: 'pending-1',
      sessionKey: 'session-1',
    }, {
      onEvent: (event) => {
        received.push(event)
        if (event.event === 'result') resolveTerminal?.()
      },
      onError: (error) => rejectTerminal?.(error),
    })

    await terminal
    abort()

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(requests[0]?.url).toContain('/public/agents/chat')
    expect(requests[1]?.url).toContain('/public/agents/chat/status')
    const replayHeaders = new Headers(requests[1]?.init?.headers)
    expect(replayHeaders.get('Last-Event-ID')).toBe(`${publicTurnId}#4`)
    expect(JSON.parse(String(requests[1]?.init?.body))).toMatchObject({
      streamEvents: true,
      turnId: publicTurnId,
      afterEventId: `${publicTurnId}#4`,
      sessionKey: 'session-1',
    })
    expect(received.filter((event) => event.event === 'content')).toHaveLength(1)
    expect(received.filter((event) => event.event === 'error')).toHaveLength(1)
    expect(received.filter((event) => event.event === 'result')).toHaveLength(1)
    expect(received[received.length - 1]).toMatchObject({
      event: 'result',
      eventId: `${publicTurnId}#5`,
      sequence: 5,
      replayed: true,
    })
  })

  it('reconnects an idle transport through status without terminating or resending the accepted task', async () => {
    vi.useFakeTimers()
    const publicTurnId = 'public-chat-turn:idle'
    let idleTransportCanceled = false
    const idleStream = new ReadableStream<Uint8Array>({
      cancel() {
        idleTransportCanceled = true
      },
    })
    const initial = new Response(idleStream, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'X-Trace-ID': publicTurnId,
      },
    })
    const replay = eventStream(sseFrame({
      id: `${publicTurnId}#9`,
      event: 'result',
      data: {
        response: {
          id: 'response-idle',
          vendor: 'agents',
          text: 'recovered after idle transport',
        },
      },
    }), publicTurnId)
    const requests: string[] = []
    const responses = [initial, replay]
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      requests.push(String(input))
      const response = responses.shift()
      if (!response) throw new Error('unexpected extra fetch')
      return response
    }))

    let resolveTerminal: (() => void) | null = null
    const terminal = new Promise<void>((resolve) => {
      resolveTerminal = resolve
    })
    const errors: Error[] = []
    const abort = await agentsChatStream({
      prompt: 'one accepted request',
      sessionKey: 'session-idle',
    }, {
      onEvent: (event) => {
        if (event.event === 'result') resolveTerminal?.()
      },
      onError: (error) => errors.push(error),
    })

    await vi.advanceTimersByTimeAsync(45_001)
    await terminal
    abort()

    expect(idleTransportCanceled).toBe(true)
    expect(errors).toEqual([])
    expect(requests).toHaveLength(2)
    expect(requests[0]).toContain('/public/agents/chat')
    expect(requests[1]).toContain('/public/agents/chat/status')
  })

  it('retries a transient admission failure with the exact same idempotent request', async () => {
    vi.useFakeTimers()
    const publicTurnId = 'public-chat-turn:admission-retry'
    const requests: Array<{ url: string; body: string }> = []
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      requests.push({ url: String(input), body: String(init?.body || '') })
      if (requests.length === 1) throw new TypeError('Failed to fetch')
      return eventStream(sseFrame({
        id: `${publicTurnId}#1`,
        event: 'result',
        data: { response: { id: 'response-admission', vendor: 'agents', text: '完成' } },
      }), publicTurnId)
    })
    vi.stubGlobal('fetch', fetchMock)

    const terminalEvents: AgentsChatStreamEvent[] = []
    const streamPromise = agentsChatStream({
      prompt: '生成成片',
      clientPendingId: 'pending-stable-1',
      sessionKey: 'session-stable-1',
    }, {
      onEvent: (event) => terminalEvents.push(event),
    })
    await vi.advanceTimersByTimeAsync(250)
    const abort = await streamPromise
    await vi.waitFor(() => expect(terminalEvents).toHaveLength(1))
    abort()

    expect(requests).toHaveLength(2)
    expect(requests[0]?.url).toContain('/public/agents/chat')
    expect(requests[1]?.url).toContain('/public/agents/chat')
    expect(requests[1]?.body).toBe(requests[0]?.body)
    expect(JSON.parse(requests[0]?.body || '{}')).toMatchObject({
      clientPendingId: 'pending-stable-1',
      sessionKey: 'session-stable-1',
    })
  })

  it('reconciles an already accepted duplicate admission instead of creating another task', async () => {
    vi.useFakeTimers()
    const publicTurnId = 'public-chat-turn:already-accepted'
    const requests: Array<{ url: string; body: string }> = []
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      requests.push({ url: String(input), body: String(init?.body || '') })
      if (requests.length === 1) {
        return new Response(JSON.stringify({
          message: 'temporary gateway failure',
          code: 'gateway_unavailable',
        }), { status: 503, headers: { 'Content-Type': 'application/json' } })
      }
      if (requests.length === 2) {
        return new Response(JSON.stringify({
          message: '同一聊天回合已被受理',
          code: 'agents_chat_turn_already_exists',
          details: {
            publicTurnId,
            acceptance: 'accepted',
            recovery: { kind: 'status_reconcile', referenceId: publicTurnId },
          },
        }), { status: 409, headers: { 'Content-Type': 'application/json' } })
      }
      return eventStream(sseFrame({
        id: `${publicTurnId}#3`,
        event: 'result',
        data: { response: { id: 'response-reconciled', vendor: 'agents', text: '原任务完成' } },
      }), publicTurnId)
    })
    vi.stubGlobal('fetch', fetchMock)

    const openedTurnIds: string[] = []
    const terminalEvents: AgentsChatStreamEvent[] = []
    const streamPromise = agentsChatStream({
      prompt: '生成三张图片',
      clientPendingId: 'pending-stable-2',
      sessionKey: 'session-stable-2',
    }, {
      onOpen: ({ turnId }) => openedTurnIds.push(turnId),
      onEvent: (event) => terminalEvents.push(event),
    })
    await vi.advanceTimersByTimeAsync(250)
    const abort = await streamPromise
    await vi.waitFor(() => expect(terminalEvents).toHaveLength(1))
    abort()

    expect(openedTurnIds).toEqual([publicTurnId])
    expect(requests).toHaveLength(3)
    expect(requests[0]?.body).toBe(requests[1]?.body)
    expect(requests[2]?.url).toContain('/public/agents/chat/status')
    expect(JSON.parse(requests[2]?.body || '{}')).toMatchObject({
      turnId: publicTurnId,
      sessionKey: 'session-stable-2',
      streamEvents: true,
    })
  })

  it('does not retry a deterministic admission rejection', async () => {
    const fetchMock = vi.fn(async (): Promise<Response> => new Response(JSON.stringify({
      message: '余额不足',
      code: 'insufficient_balance',
    }), { status: 402, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(agentsChatStream({
      prompt: '生成视频',
      clientPendingId: 'pending-balance',
      sessionKey: 'session-balance',
    }, { onEvent: () => undefined })).rejects.toMatchObject({
      status: 402,
      code: 'insufficient_balance',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
