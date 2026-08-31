import { describe, expect, it } from 'vitest'
import { listTaskNodeSchemas, normalizeTaskNodeKind } from './taskNodeSchema'

describe('task node legacy feature cleanup', () => {
  it('does not expose the removed hidden system prompt feature', () => {
    for (const schema of listTaskNodeSchemas()) {
      expect(schema.features).not.toContain('systemPrompt')
    }
  })

  it('does not normalize the retired mosaic node kind', () => {
    expect(normalizeTaskNodeKind('mosaic')).toBeUndefined()
  })
})
