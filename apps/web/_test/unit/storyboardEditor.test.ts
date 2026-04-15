import { describe, expect, it } from 'vitest'

import {
  deriveStoryboardPromptDataFromCells,
  normalizeStoryboardNodeData,
} from '../../src/canvas/nodes/taskNode/storyboardEditor'

describe('storyboardEditor node normalization', () => {
  it('derives storyboard script and shot prompts from editor cells', () => {
    const normalized = normalizeStoryboardNodeData({
      kind: 'storyboard',
      storyboardEditorGrid: '3x2',
      storyboardEditorAspect: '16:9',
      storyboardEditorCells: [
        { id: 'shot-1', shotNo: 1, prompt: '方源抬手确认重生' },
        { id: 'shot-2', shotNo: 2, prompt: '雨夜窗边沉思' },
      ],
    })

    expect(normalized.storyboardShotPrompts).toEqual([
      '方源抬手确认重生',
      '雨夜窗边沉思',
    ])
    expect(normalized.storyboardScript).toBe([
      '镜头 1：方源抬手确认重生',
      '镜头 2：雨夜窗边沉思',
    ].join('\n'))
    expect(normalized.prompt).toBe(String(normalized.storyboardScript))
  })

  it('does not invent storyboard script when cells have no prompts', () => {
    const derived = deriveStoryboardPromptDataFromCells([
      { id: 'shot-1', imageUrl: null, label: '空镜头' },
      { id: 'shot-2', imageUrl: null },
    ])

    expect(derived).toBeNull()
  })
})
