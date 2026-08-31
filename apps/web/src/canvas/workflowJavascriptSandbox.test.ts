import { describe, expect, it } from 'vitest'
import { parseWorkflowTestInput, stringifyWorkflowValue } from './workflowJavascriptSandbox'

describe('workflow JavaScript sandbox value contract', () => {
  it('accepts JSON test values without inventing default data', () => {
    expect(parseWorkflowTestInput('{ "text": "hello", "count": 2 }')).toEqual({
      text: 'hello',
      count: 2,
    })
    expect(parseWorkflowTestInput('')).toBeNull()
  })

  it('reports malformed test input explicitly', () => {
    expect(() => parseWorkflowTestInput('{ broken }')).toThrow('测试输入不是有效 JSON')
  })

  it('renders JSON output for the inspector', () => {
    expect(stringifyWorkflowValue({ ok: true })).toContain('"ok": true')
  })
})
