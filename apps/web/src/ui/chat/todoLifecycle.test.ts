import { describe, expect, it } from 'vitest'

import { terminalizeInterruptedTodos, terminalizeOpenTodos } from './todoLifecycle'

describe('terminalizeInterruptedTodos', () => {
  it('把中断时仍在 in_progress 的任务降级为 pending（停掉 spinner，不伪装完成）', () => {
    const result = terminalizeInterruptedTodos([
      { status: 'completed', content: '核对第10章起跑被拦的真实缺口' },
      { status: 'in_progress', content: '把第10章锚点与设计板真正落到当前画布' },
      { status: 'pending', content: '重新发起第10章后台起跑' },
    ])
    expect(result).toEqual([
      { status: 'completed', content: '核对第10章起跑被拦的真实缺口' },
      { status: 'pending', content: '把第10章锚点与设计板真正落到当前画布' },
      { status: 'pending', content: '重新发起第10章后台起跑' },
    ])
  })

  it('没有 in_progress 时原样返回（引用不变，避免无谓重渲染）', () => {
    const items: Array<{ status: 'completed' | 'pending' | 'in_progress'; content: string }> = [
      { status: 'completed', content: 'a' },
      { status: 'pending', content: 'b' },
    ]
    expect(terminalizeInterruptedTodos(items)).toBe(items)
  })

  it('空数组 / 缺省值安全', () => {
    expect(terminalizeInterruptedTodos([])).toEqual([])
    expect(terminalizeInterruptedTodos(undefined)).toBeUndefined()
    expect(terminalizeInterruptedTodos(null)).toBeNull()
  })

  it('正常收流也不能让缺少完成证据的 in_progress 永久转圈', () => {
    expect(terminalizeOpenTodos([
      { status: 'completed', content: '已完成步骤' },
      { status: 'in_progress', content: '未收到终态的步骤' },
    ])).toEqual([
      { status: 'completed', content: '已完成步骤' },
      { status: 'pending', content: '未收到终态的步骤' },
    ])
  })
})
