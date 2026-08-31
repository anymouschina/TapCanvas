import { describe, expect, it } from 'vitest'
import { resolveChatExecutionStage } from './chatExecutionStage'

describe('resolveChatExecutionStage', () => {
  it('优先展示 agents 声明的当前阶段及其实时耗时', () => {
    expect(resolveChatExecutionStage({
      todoItems: [{ status: 'in_progress', content: '编写镜头合同', startedAt: 1_000 }],
      toolSteps: [{ startedAt: 500 }],
      active: true,
      observedAtMs: 6_000,
    })).toEqual({ label: '编写镜头合同', elapsedMs: 5_000 })
  })

  it('工具间隙仍保持动作执行阶段连续计时', () => {
    expect(resolveChatExecutionStage({
      todoItems: [],
      toolSteps: [{ startedAt: 1_000 }, { startedAt: 3_000 }],
      active: true,
      observedAtMs: 8_000,
    })).toEqual({ label: '动作执行', elapsedMs: 7_000 })
  })

  it('终态不再声称存在当前阶段', () => {
    expect(resolveChatExecutionStage({
      todoItems: [],
      toolSteps: [{ startedAt: 1_000 }],
      active: false,
      observedAtMs: 8_000,
    })).toBeNull()
  })
})
