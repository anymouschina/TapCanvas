// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import RuntimeKnowledgeInspector from './RuntimeKnowledgeInspector'

afterEach(cleanup)

describe('RuntimeKnowledgeInspector', () => {
  it('shows the exact Skill reference and the runtime user of that source', () => {
    render(<RuntimeKnowledgeInspector receipt={{
      version: 1,
      state: 'complete',
      rootExecutionId: 'execution-1',
      summary: 'Skill 1 · 实读 Reference 1',
      sources: [{
        id: 'reference-1',
        label: 'tapcanvas-video-workflow · Reference',
        kind: 'skill_reference',
        ref: 'apps/agents-cli/skills/tapcanvas-video-workflow/references/video-prompt-contract.md',
        status: 'applied',
        summary: '实际读取',
        usedBy: ['小T主代理'],
      }],
    }} />)

    expect(screen.getByText('小T本轮实际使用的上下文')).toBeTruthy()
    expect(screen.getByText('apps/agents-cli/skills/tapcanvas-video-workflow/references/video-prompt-contract.md')).toBeTruthy()
    expect(screen.getByText('使用者：小T主代理')).toBeTruthy()
  })
})
