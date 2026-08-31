import { beforeEach, describe, expect, it } from 'vitest'
import { takeHomePendingPrompt, writeHomePendingPrompt } from './homePendingPrompt'

describe('home pending prompts', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
  })

  it('keeps pending requests isolated by project', () => {
    writeHomePendingPrompt('project-a', 'request a', ['skill-a'])
    writeHomePendingPrompt('project-b', 'request b', ['skill-b'])

    expect(takeHomePendingPrompt('project-b')).toEqual({ text: 'request b', requiredSkills: ['skill-b'] })
    expect(takeHomePendingPrompt('project-a')).toEqual({ text: 'request a', requiredSkills: ['skill-a'] })
  })

  it('consumes each project request only once', () => {
    writeHomePendingPrompt('project-a', 'request a')

    expect(takeHomePendingPrompt('project-a')).toEqual({ text: 'request a', requiredSkills: [] })
    expect(takeHomePendingPrompt('project-a')).toBeNull()
  })

  it('does not let another project consume the request', () => {
    writeHomePendingPrompt('project-a', 'request a')

    expect(takeHomePendingPrompt('project-b')).toBeNull()
    expect(takeHomePendingPrompt('project-a')).toEqual({ text: 'request a', requiredSkills: [] })
  })
})
