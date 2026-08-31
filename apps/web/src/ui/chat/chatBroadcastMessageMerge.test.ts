import { describe, expect, it } from 'vitest'
import { selectNewBroadcastChatMessages } from './chatBroadcastMessageMerge'

describe('selectNewBroadcastChatMessages', () => {
  it('keeps one local question/answer pair when the same turn is broadcast', () => {
    expect(selectNewBroadcastChatMessages([
      { id: 'm_user_recovered_fe-root-1' },
      { id: 'm_ai_recovered_fe-root-1' },
    ], [
      {
        id: 'sse-user-response-1',
        turnId: 'fe-root-1',
        role: 'user',
        content: '你的工作流是什么？',
        ts: '2026-08-15T08:48:25.505Z',
      },
      {
        id: 'sse-asst-response-1',
        turnId: 'fe-root-1',
        role: 'assistant',
        content: '工作流说明',
        ts: '2026-08-15T08:48:25.505Z',
      },
    ])).toEqual([])
  })

  it('keeps the existing rich card and drops the plain projection of the same root turn', () => {
    expect(selectNewBroadcastChatMessages([
      {
        id: 'm_ai_recovered_fe-root-1',
      },
    ], [
      {
        id: 'sse-asst-response-1',
        turnId: 'fe-root-1',
        role: 'assistant',
        content: '相同终态正文',
        ts: '2026-08-11T10:07:43.693Z',
      },
    ])).toEqual([])
  })

  it('keeps equal prose from independent root turns', () => {
    const selected = selectNewBroadcastChatMessages([], [
      {
        id: 'sse-asst-response-1',
        turnId: 'fe-root-1',
        role: 'assistant',
        content: '相同终态正文',
        ts: '2026-08-11T10:07:43.693Z',
      },
      {
        id: 'sse-asst-response-2',
        turnId: 'fe-root-2',
        role: 'assistant',
        content: '相同终态正文',
        ts: '2026-08-11T10:08:43.693Z',
      },
    ])

    expect(selected.map((message) => message.id)).toEqual([
      'm_ai_recovered_fe-root-1',
      'm_ai_recovered_fe-root-2',
    ])
    expect(selected.every((message) => /^\d{2}:\d{2}$/.test(message.ts))).toBe(true)
  })

  it('collapses repeated broadcasts of one turn before they enter the list', () => {
    const selected = selectNewBroadcastChatMessages([], [
      {
        id: 'sse-asst-response-1',
        turnId: 'fe-root-1',
        role: 'assistant',
        content: '第一份投影',
        ts: '2026-08-11T10:07:43.693Z',
      },
      {
        id: 'sse-asst-response-2',
        turnId: 'fe-root-1',
        role: 'assistant',
        content: '第二份投影',
        ts: '2026-08-11T10:07:44.693Z',
      },
    ])

    expect(selected).toHaveLength(1)
    expect(selected[0]?.content).toBe('第一份投影')
  })

  it('rejects ordinary legacy projections without a stable root turn identity', () => {
    expect(selectNewBroadcastChatMessages([], [
      {
        id: 'sse-user-legacy-response',
        role: 'user',
        content: '你的工作流是什么？',
        ts: '2026-08-15T08:48:25.505Z',
      },
      {
        id: 'sse-asst-legacy-response',
        role: 'assistant',
        content: '这是一个没有 turnId 的旧投影',
        ts: '2026-08-15T08:48:25.505Z',
      },
    ])).toEqual([])
  })

  it('keeps an unbound durable request_user_input action by its request identity', () => {
    const selected = selectNewBroadcastChatMessages([], [{
      id: 'canvas-action-node-1-confirm-1',
      role: 'assistant',
      content: '后台编排已进入需要你确认的阶段。',
      ts: '2026-08-15T08:48:25.505Z',
      pendingUserInput: {
        status: 'needs_input',
        requestId: 'confirm-1',
        questions: [{
          id: 'confirm-question',
          header: '确认',
          question: '是否继续？',
          options: [{ label: '继续' }, { label: '停止' }],
        }],
      },
    }])

    expect(selected).toHaveLength(1)
    expect(selected[0]?.id).toBe('canvas-action-node-1-confirm-1')
    expect(selected[0]?.ts).toMatch(/^\d{2}:\d{2}$/)
  })
})
