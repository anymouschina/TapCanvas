import { describe, expect, it } from 'vitest'
import {
  buildChatExecutionEventMessage,
  buildChatProgressMetadata,
} from '../../src/ui/chat/chatProgress'

describe('chat progress stages', () => {
  it('builds readable factual event messages', () => {
    const message = buildChatExecutionEventMessage({
      eventKey: 'canvas_plan_executed',
      detail: '已处理 3 个节点、2 条连线。',
    })
    expect(message).toContain('进度更新 · 已执行画布计划')
    expect(message).toContain('已处理 3 个节点、2 条连线。')
  })

  it('creates rerun-ready progress metadata', () => {
    const metadata = buildChatProgressMetadata({
      route: 'storyboard_workflow',
      sessionKey: 'session-1',
      eventKey: 'assets_attached',
      shotNodeId: 'node-shot-1',
    })
    expect(metadata.eventIndex).toBe(4)
    expect(metadata.totalEvents).toBe(6)
    expect(metadata.rerunTarget.eventKey).toBe('assets_attached')
    expect(metadata.rerunTarget.shotNodeId).toBe('node-shot-1')
  })
})
