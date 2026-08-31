import { describe, expect, it } from 'vitest'

import { readPromptAssembly } from './promptAssemblyEvidence'

describe('readPromptAssembly', () => {
  it('accepts a complete structural receipt and preserves source order', () => {
    const receipt = readPromptAssembly({
      version: 2,
      artifactKey: 'clip:2',
      clipIndex: 2,
      state: 'complete',
      assemblySummary: '真实组装链',
      steps: [
        { id: 'second', order: 2, title: '第二步', explanation: '编译', sourceIds: ['compiler'] },
        { id: 'first', order: 1, title: '第一步', explanation: '锁合同', sourceIds: ['intent'] },
      ],
      sources: [
        { id: 'intent', label: '用户合同', kind: 'user_contract', ref: 'BeatSheet.meta.userIntentContract', status: 'applied', summary: '已验签' },
        { id: 'compiler', label: '编译器', kind: 'compiler', ref: 'clip-shots.ts', status: 'applied', summary: '确定性投影' },
      ],
      contractSnapshot: {
        sourceSpanText: '原文', dialogueScriptJson: '[]', temporalContextJson: null,
        sceneStateJson: null, characterStatesJson: null, characterStateVersionsJson: null,
        startKeyframe: null, endKeyframe: null, previousExitState: null, exitState: null,
        writerOutputJson: '{}',
      },
      finalPrompt: { label: '执行提示词', characterCount: 20, text: '镜头提示词', hash: 'sha256:x' },
    })

    expect(receipt?.steps.map((step) => step.id)).toEqual(['first', 'second'])
    expect(receipt?.sources.map((source) => source.id)).toEqual(['intent', 'compiler'])
  })

  it('rejects malformed source contracts instead of guessing fields', () => {
    expect(readPromptAssembly({
      version: 2,
      artifactKey: 'clip:0',
      clipIndex: 0,
      state: 'complete',
      assemblySummary: 'invalid',
      steps: [],
      sources: [{ id: 'x', label: 'x', kind: 'unknown', ref: 'x', status: 'applied', summary: 'x' }],
      contractSnapshot: { dialogueScriptJson: '[]' },
      finalPrompt: null,
    })).toBeNull()
  })
})
