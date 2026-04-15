import { describe, expect, it } from 'vitest'
import { resolveTextNodePlainText } from '../../src/canvas/nodes/taskNode/textNodeContent'

describe('text node content resolver', () => {
  it('uses content when prompt is missing', () => {
    expect(resolveTextNodePlainText({
      data: {
        content: '第一章文本提要',
      },
      latestTextResult: '',
    })).toBe('第一章文本提要')
  })

  it('keeps prompt as highest priority display source', () => {
    expect(resolveTextNodePlainText({
      data: {
        prompt: '用户编辑后的文本',
        content: '旧的 content 字段',
      },
      latestTextResult: '',
    })).toBe('用户编辑后的文本')
  })
})
