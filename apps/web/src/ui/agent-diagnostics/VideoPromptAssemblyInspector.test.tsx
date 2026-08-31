// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import type { ExecutionPromptAssembly } from './executionGraph.types'
import VideoPromptAssemblyInspector from './VideoPromptAssemblyInspector'

afterEach(cleanup)

const ASSEMBLY: ExecutionPromptAssembly = {
  version: 2,
  artifactKey: 'clip:0',
  clipIndex: 0,
  state: 'complete',
  assemblySummary: '用户合同 → Clip 事实 → Writer Skill → Shots → 编译器 → 资产绑定',
  steps: [{
    id: 'author-shots',
    order: 3,
    title: 'Writer 自主设计结构化 Shots',
    explanation: '只展示本轮实际使用的来源。',
    sourceIds: ['writer-reference'],
  }],
  sources: [{
    id: 'writer-reference',
    label: '本轮领域 Reference',
    kind: 'skill_reference',
    ref: 'apps/agents-cli/skills/tapcanvas-video-prompt-writer/references/dramatic-direction-contract.md',
    status: 'applied',
    summary: '本轮实际读取。',
  }],
  contractSnapshot: {
    sourceSpanText: '阿青听见门后脚步声。',
    dialogueScriptJson: '[]',
    temporalContextJson: '{"presentation":"current"}',
    sceneStateJson: '{"subscene":"门厅"}',
    characterStatesJson: null,
    characterStateVersionsJson: '{"阿青":{"visualState":"衣襟沾雨"}}',
    startKeyframe: '阿青背对门口。',
    endKeyframe: '阿青转身。',
    previousExitState: null,
    exitState: '阿青面向门口。',
    writerOutputJson: '{"shots":[]}',
  },
  finalPrompt: {
    label: '结构化 Shots 的执行提示词投影',
    characterCount: 12,
    text: '镜1｜阿青转身。',
    hash: `sha256:${'a'.repeat(64)}`,
  },
}

describe('VideoPromptAssemblyInspector', () => {
  it('shows the ordered source explanation and exact reference path', () => {
    render(<VideoPromptAssemblyInspector assemblies={[ASSEMBLY]} />)

    expect(screen.getByText('视频提示词如何组装')).toBeTruthy()
    expect(screen.getByText('Writer 自主设计结构化 Shots')).toBeTruthy()
    expect(screen.getByText('已使用')).toBeTruthy()
    expect(screen.getByText(ASSEMBLY.sources[0].ref)).toBeTruthy()
  })

  it('reveals the final deterministic prompt projection on demand', () => {
    render(<VideoPromptAssemblyInspector assemblies={[ASSEMBLY]} />)

    fireEvent.click(screen.getByText('查看完整编译提示词（资产绑定前）'))

    expect(screen.getByText('镜1｜阿青转身。')).toBeTruthy()
    expect(screen.getByText(`sha256:${'a'.repeat(64)}`)).toBeTruthy()
  })
})
