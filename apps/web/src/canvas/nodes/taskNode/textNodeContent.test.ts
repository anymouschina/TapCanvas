import { describe, expect, it } from 'vitest'
import {
  convertPlainTextToHtml,
  resolveTextNodeDisplayHtml,
  resolveTextNodeLatestResult,
  withTextNodeAlpha,
} from './textNodeContent'

describe('text node display parity', () => {
  it('keeps persisted rich text as the unfocused preview source', () => {
    const data = {
      prompt: 'plain fallback',
      textHtml: '<h2>同一份富文本</h2><p>正文</p>',
    }

    expect(resolveTextNodeDisplayHtml({ data, latestTextResult: '' })).toBe(data.textHtml)
  })

  it('builds escaped preview HTML from the same plain-text fallback chain', () => {
    expect(resolveTextNodeDisplayHtml({
      data: { content: '第一行\n<script>不可执行</script>' },
      latestTextResult: '',
    })).toBe('<p>第一行</p><p>&lt;script&gt;不可执行&lt;/script&gt;</p>')
  })

  it('uses the latest generated text when there is no authored content', () => {
    const data = { textResults: [{ text: '旧结果' }, { text: '最新结果' }] }
    const latestTextResult = resolveTextNodeLatestResult(data)

    expect(latestTextResult).toBe('最新结果')
    expect(resolveTextNodeDisplayHtml({ data, latestTextResult })).toBe('<p>最新结果</p>')
  })

  it('shares text conversion and background tint calculations with the focused editor', () => {
    expect(convertPlainTextToHtml('A&B')).toBe('<p>A&amp;B</p>')
    expect(withTextNodeAlpha('#0c111c', 0.125)).toBe('rgba(12, 17, 28, 0.125)')
    expect(withTextNodeAlpha('rgba(248,250,255,0.95)', 0.125)).toBe('rgba(248, 250, 255, 0.125)')
  })
})
