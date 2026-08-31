import { describe, it, expect } from 'vitest'
import { markdownNodeHasImage } from './markdownNesting'

describe('markdownNodeHasImage', () => {
  it('含 img 子元素 → true', () => {
    expect(markdownNodeHasImage({ children: [{ type: 'element', tagName: 'img' }] })).toBe(true)
  })

  it('纯文本段落 → false', () => {
    expect(markdownNodeHasImage({ children: [{ type: 'text', value: 'hi' }] })).toBe(false)
  })

  it('img 混在文本子节点中 → true', () => {
    expect(
      markdownNodeHasImage({ children: [{ type: 'text', value: 'see' }, { type: 'element', tagName: 'img' }] }),
    ).toBe(true)
  })

  it('null / 无 children / 非数组 → false', () => {
    expect(markdownNodeHasImage(null)).toBe(false)
    expect(markdownNodeHasImage(undefined)).toBe(false)
    expect(markdownNodeHasImage({})).toBe(false)
    expect(markdownNodeHasImage({ children: 'x' })).toBe(false)
  })

  it('其它元素（非 img）→ false', () => {
    expect(markdownNodeHasImage({ children: [{ type: 'element', tagName: 'strong' }] })).toBe(false)
  })
})
