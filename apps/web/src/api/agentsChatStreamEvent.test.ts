import { describe, expect, it } from 'vitest'

import {
  advanceAgentsChatEventCursor,
  parseAgentsChatStreamEvent,
  type AgentsChatEventCursor,
} from './server'

describe('parseAgentsChatStreamEvent', () => {
  it('accepts the explicit interrupted terminal reason', () => {
    expect(parseAgentsChatStreamEvent('done', { reason: 'interrupted' })).toEqual({
      event: 'done',
      data: { reason: 'interrupted' },
    })
  })

  it.each([
    'logical_succeeded',
    'logical_failed',
    'physical_suspended',
    'needs_input',
  ] as const)('accepts the explicit %s done projection', (reason) => {
    expect(parseAgentsChatStreamEvent('done', { reason })).toEqual({
      event: 'done',
      data: { reason },
    })
  })

  it('rejects the legacy ambiguous finished projection', () => {
    expect(() => parseAgentsChatStreamEvent('done', { reason: 'finished' })).toThrow()
  })

  it('rejects unknown event names instead of casting them into the protocol', () => {
    expect(() => parseAgentsChatStreamEvent('mystery', {})).toThrow(
      'agents_chat_stream_event_unknown:mystery',
    )
  })

  it('rejects a result without a complete response envelope', () => {
    expect(() => parseAgentsChatStreamEvent('result', { response: { text: 'missing identity' } })).toThrow()
  })

  it('parses ordinary content deltas', () => {
    expect(parseAgentsChatStreamEvent('content', { delta: 'hello' })).toEqual({
      event: 'content',
      data: { delta: 'hello' },
    })
  })

  it('requires the public failure envelope to preserve nonterminal recovery facts', () => {
    expect(parseAgentsChatStreamEvent('error', {
      message: '上游受理状态未知',
      code: 'agents_bridge_acceptance_unknown',
      terminal: false,
      scope: 'transport',
      retryability: 'unknown',
      acceptanceKnown: false,
      sideEffectOutcomeKnown: false,
      recovery: { kind: 'status_reconcile', referenceId: 'public-turn-1' },
    })).toEqual({
      event: 'error',
      data: {
        message: '上游受理状态未知',
        code: 'agents_bridge_acceptance_unknown',
        terminal: false,
        scope: 'transport',
        retryability: 'unknown',
        acceptanceKnown: false,
        sideEffectOutcomeKnown: false,
        recovery: { kind: 'status_reconcile', referenceId: 'public-turn-1' },
      },
    })
    expect(() => parseAgentsChatStreamEvent('error', {
      message: 'legacy ambiguous error',
    })).toThrow()
  })

  it('parses the model-turn status update emitted by agents-cli', () => {
    expect(parseAgentsChatStreamEvent('status-update', {
      threadId: 'thread-1',
      turnId: 'turn-1',
      phase: 'agent_continuation',
      llmTurn: 2,
      startedAt: '2026-08-11T04:06:00.000Z',
      timeoutMs: 120_000,
      afterToolCallId: 'call-1',
      afterToolName: 'tapcanvas_project_look_bible_get',
    })).toEqual({
      event: 'status-update',
      data: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        phase: 'agent_continuation',
        llmTurn: 2,
        startedAt: '2026-08-11T04:06:00.000Z',
        timeoutMs: 120_000,
        afterToolCallId: 'call-1',
        afterToolName: 'tapcanvas_project_look_bible_get',
      },
    })
  })

  it('parses artifact updates without weakening the event contract', () => {
    expect(parseAgentsChatStreamEvent('artifact-update', {
      kind: 'artifact-update',
      taskId: 'task-1',
      contextId: 'context-1',
      artifact: {
        artifactId: 'artifact-1',
        name: '成片',
        parts: [{ kind: 'file', file: { uri: 'https://cdn.example/video.mp4', mimeType: 'video/mp4' } }],
      },
    })).toMatchObject({
      event: 'artifact-update',
      data: { taskId: 'task-1', artifact: { artifactId: 'artifact-1' } },
    })
  })

  it('rejects structurally incomplete status updates', () => {
    expect(() => parseAgentsChatStreamEvent('status-update', {
      phase: 'agent_reasoning',
      llmTurn: 1,
    })).toThrow()
  })

  it('accepts only a monotonically newer event id from the same durable turn', () => {
    const initial: AgentsChatEventCursor = {
      publicTurnId: 'public-chat-turn:abc',
      eventId: null,
      sequence: 0,
    }
    const first = advanceAgentsChatEventCursor(initial, 'public-chat-turn:abc#7')
    expect(first).toEqual({
      status: 'accepted',
      cursor: {
        publicTurnId: 'public-chat-turn:abc',
        eventId: 'public-chat-turn:abc#7',
        sequence: 7,
      },
    })
    if (first.status !== 'accepted') throw new Error('cursor was not accepted')
    expect(advanceAgentsChatEventCursor(first.cursor, 'public-chat-turn:abc#7')).toEqual({
      status: 'duplicate',
      cursor: first.cursor,
    })
    expect(advanceAgentsChatEventCursor(first.cursor, 'public-chat-turn:other#8')).toMatchObject({
      status: 'invalid',
      reason: 'turn_mismatch',
    })
  })

  it('parses an explicit retention-gap resync instead of treating it as missing content', () => {
    expect(parseAgentsChatStreamEvent('resync', {
      publicTurnId: 'public-chat-turn:abc',
      reason: 'retention_gap',
      requestedAfterEventId: 'public-chat-turn:abc#4',
      earliestAvailableEventId: 'public-chat-turn:abc#7',
      latestEventId: 'public-chat-turn:abc#9',
      recovery: {
        kind: 'status_reconcile',
        referenceId: 'public-chat-turn:abc',
      },
    })).toEqual({
      event: 'resync',
      data: {
        publicTurnId: 'public-chat-turn:abc',
        reason: 'retention_gap',
        requestedAfterEventId: 'public-chat-turn:abc#4',
        earliestAvailableEventId: 'public-chat-turn:abc#7',
        latestEventId: 'public-chat-turn:abc#9',
        recovery: {
          kind: 'status_reconcile',
          referenceId: 'public-chat-turn:abc',
        },
      },
    })
  })
})
