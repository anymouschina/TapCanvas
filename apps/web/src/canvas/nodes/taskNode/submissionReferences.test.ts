import { describe, expect, it } from 'vitest'
import { buildSubmissionMentionRefs, readSubmissionInput } from './submissionReferences'

describe('submission reference identity', () => {
  it('keeps exact submitted numbering including duplicate images', () => {
    const value = { prompt: '@图1 @图2 @图3', referenceMediaManifest: { images: [
      { url: 'https://example.com/a', label: '张羽' },
      { url: 'https://example.com/b', label: '教室' },
      { url: 'https://example.com/a', label: '张羽背面' },
    ] } }
    const refs = buildSubmissionMentionRefs('video', value)
    expect(refs.map(ref => [ref.username, ref.displayName, ref.assetUrl])).toEqual([
      ['图1', '张羽', 'https://example.com/a'],
      ['图2', '教室', 'https://example.com/b'],
      ['图3', '张羽背面', 'https://example.com/a'],
    ])
    expect(value.prompt).toBe('@图1 @图2 @图3')
  })
  it('does not shift numbering around an invalid entry', () => {
    const input = { prompt: '@图2', referenceMediaManifest: { images: [
      { label: 'missing result' }, { url: 'https://example.com/b', label: '教室' },
    ] } }
    expect(readSubmissionInput(input)).toBeNull()
    expect(buildSubmissionMentionRefs('video', input)).toEqual([])
  })
})
