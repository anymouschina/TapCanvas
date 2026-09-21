import { afterEach, describe, expect, it, vi } from 'vitest'
import { agentsChatStream, type AgentsChatStreamEvent } from './server'

const turnId = 'public-chat-turn:lifecycle'
const frame = (sequence: number, event: string, data: unknown) =>
  `id: ${turnId}#${sequence}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`
const headers = { 'Content-Type': 'text/event-stream', 'X-Trace-ID': turnId }
const initialFrame = frame(1, 'initial', { requestId: turnId, messageId: 'message-1' })
const terminalFrame = frame(2, 'done', { reason: 'logical_succeeded' })
const response = (body = '') => new Response(body, { headers })

describe('accepted chat transport lifecycle', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('backs off repeated empty or duplicate-only replay streams instead of spinning on HTTP 200', async () => {
    vi.useFakeTimers()
    const replies = [response(initialFrame), response(initialFrame), response(), response(terminalFrame)]
    const fetchMock = vi.fn(async (): Promise<Response> => {
      const next = replies.shift()
      if (!next) throw new Error('unexpected fetch')
      return next
    })
    vi.stubGlobal('fetch', fetchMock)
    const events: AgentsChatStreamEvent[] = []
    const abort = await agentsChatStream({ prompt: 'observe one accepted task', sessionKey: 'session-1' }, {
      onEvent: event => events.push(event),
    })
    try {
      await vi.advanceTimersByTimeAsync(0)
      expect(fetchMock).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(399)
      expect(fetchMock).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(1)
      expect(fetchMock).toHaveBeenCalledTimes(3)
      await vi.advanceTimersByTimeAsync(799)
      expect(fetchMock).toHaveBeenCalledTimes(3)
      await vi.advanceTimersByTimeAsync(1)
      expect(fetchMock).toHaveBeenCalledTimes(4)
      expect(events.map(event => event.event)).toEqual(['initial', 'done'])
    } finally {
      abort()
    }
  })

  it('honors Retry-After when admission is rate limited and does not hammer the endpoint', async () => {
    vi.useFakeTimers()
    const replies = [
      new Response(JSON.stringify({ message: 'busy' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Retry-After': '3' },
      }),
      response(`${initialFrame}${terminalFrame}`),
    ]
    const fetchMock = vi.fn(async (): Promise<Response> => {
      const next = replies.shift()
      if (!next) throw new Error('unexpected fetch')
      return next
    })
    vi.stubGlobal('fetch', fetchMock)
    const events: AgentsChatStreamEvent[] = []
    const abortPromise = agentsChatStream({
      prompt: 'rate limited admission',
      clientPendingId: 'pending-admission-1',
      sessionKey: 'session-1',
    }, { onEvent: event => events.push(event) })
    await vi.advanceTimersByTimeAsync(2_999)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    const abort = await abortPromise
    try {
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(events.map(event => event.event)).toEqual(['initial', 'done'])
    } finally {
      abort()
    }
  })

  it('stops admission retries when the caller aborts during Retry-After wait', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn(async (): Promise<Response> => new Response(JSON.stringify({ message: 'busy' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json', 'Retry-After': '30' },
    }))
    vi.stubGlobal('fetch', fetchMock)
    const externalController = new AbortController()
    const streamPromise = agentsChatStream({
      prompt: 'abort while rate limited',
      clientPendingId: 'pending-admission-abort',
      sessionKey: 'session-1',
    }, { onEvent: () => undefined, signal: externalController.signal })
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    externalController.abort()
    await expect(streamPromise).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('retries rate-limited replay while retaining the accepted turn and acknowledged cursor', async () => {
    vi.useFakeTimers()
    const replies = [
      response(initialFrame),
      new Response(JSON.stringify({ message: 'busy', code: 'rate_limited' }), {
        status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': '2' },
      }),
      response(terminalFrame),
    ]
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
      const next = replies.shift()
      if (!next) throw new Error('unexpected fetch')
      return next
    })
    vi.stubGlobal('fetch', fetchMock)
    const errors: Error[] = []
    const events: AgentsChatStreamEvent[] = []
    const abort = await agentsChatStream({ prompt: 'accepted task', sessionKey: 'session-1' }, {
      onEvent: event => events.push(event), onError: error => errors.push(error),
    })
    try {
      await vi.advanceTimersByTimeAsync(0)
      expect(errors).toEqual([])
      await vi.advanceTimersByTimeAsync(1_999)
      expect(fetchMock).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(1)
      expect(fetchMock).toHaveBeenCalledTimes(3)
      expect(String(fetchMock.mock.calls[2]?.[0])).toContain('/chat/status')
      expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toMatchObject({
        turnId, afterEventId: `${turnId}#1`, streamEvents: true,
      })
      expect(events.map(event => event.event)).toEqual(['initial', 'done'])
    } finally {
      abort()
    }
  })

  it('cancels an open response body immediately after terminal delivery without waiting for EOF or caller abort', async () => {
    const canceled = vi.fn()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode(terminalFrame)) },
      cancel: canceled,
    })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(stream, { headers })))
    const abort = await agentsChatStream({ prompt: 'complete' }, { onEvent: () => undefined })
    try {
      await vi.waitFor(() => expect(canceled).toHaveBeenCalledTimes(1))
    } finally {
      abort()
    }
  })

  it('surfaces consumer callback failures instead of replaying the accepted cursor', async () => {
    const fetchMock = vi.fn(async (): Promise<Response> => response(initialFrame))
    vi.stubGlobal('fetch', fetchMock)
    const callbackError = new Error('chat state update failed')
    const errors: Error[] = []
    const abort = await agentsChatStream({ prompt: 'consumer failure', sessionKey: 'session-1' }, {
      onEvent: () => { throw callbackError },
      onError: error => errors.push(error),
    })
    try {
      await vi.waitFor(() => expect(errors).toEqual([callbackError]))
      expect(fetchMock).toHaveBeenCalledTimes(1)
    } finally {
      abort()
    }
  })
})
