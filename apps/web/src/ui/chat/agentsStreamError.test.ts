import { describe, expect, it } from 'vitest'
import { formatAgentsStreamErrorMessage } from './agentsStreamError'

type Payload = Parameters<typeof formatAgentsStreamErrorMessage>[0]

describe('formatAgentsStreamErrorMessage', () => {
  it('一般错误仍附上 code 与 details 摘要（排查需要）', () => {
    const text = formatAgentsStreamErrorMessage({
      message: '上游失败',
      code: 'provider_terminal_missing',
      details: { reason: 'empty stream' },
    } as Payload)
    expect(text).toContain('上游失败')
    expect(text).toContain('code=provider_terminal_missing')
    expect(text).toContain('empty stream')
  })

  it('成片回合保护的拒绝只显示可读文案，不泄漏 code/requestId（2026-07-29 ch1243）', () => {
    const text = formatAgentsStreamErrorMessage({
      message: '上一个成片回合仍在进行中，本条消息未发送。要先停下它请点「中断」，或另开一个对话提问。',
      code: 'chat_turn_protected_inflight',
      details: { priorRequestId: 'req-film', priorAgeMs: 53_000 },
    } as Payload)
    expect(text).toBe(
      '上一个成片回合仍在进行中，本条消息未发送。要先停下它请点「中断」，或另开一个对话提问。',
    )
    expect(text).not.toContain('code=')
    expect(text).not.toContain('req-film')
  })

  it('缺 message 时回落到通用文案', () => {
    expect(formatAgentsStreamErrorMessage({} as Payload)).toBe('对话流失败')
  })
})
