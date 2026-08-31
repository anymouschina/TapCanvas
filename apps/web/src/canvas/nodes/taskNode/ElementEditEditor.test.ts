import { describe, expect, it } from 'vitest'
import { buildElementEditPrompt } from './ElementEditEditor'

describe('buildElementEditPrompt', () => {
  it('keeps a modification constrained to the visibly selected object', () => {
    const prompt = buildElementEditPrompt({
      action: 'modify',
      label: '红裙女人',
      instruction: '把裙子改成深蓝色丝绒材质',
    })

    expect(prompt).toContain('青蓝色点、框或笔迹')
    expect(prompt).toContain('红裙女人')
    expect(prompt).toContain('把裙子改成深蓝色丝绒材质')
    expect(prompt).toContain('保持未选区域')
  })

  it('describes source, destination and background repair for a move action', () => {
    const prompt = buildElementEditPrompt({
      action: 'move',
      label: '桌上的杯子',
      instruction: '',
    })

    expect(prompt).toContain('橙色目标点')
    expect(prompt).toContain('自然补全原位置的背景')
    expect(prompt).not.toContain('补充要求：')
  })
})
