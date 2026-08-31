import { describe, expect, it } from 'vitest'

import type { TaskRequestDto } from '../api/server'
import { withCanvasGenerationContext } from './generationAssetContext'

const request: TaskRequestDto = {
  kind: 'text_to_image',
  prompt: '雨夜霓虹',
  extras: { nodeId: 'node-1', workflowExecutionId: 'execution-1' },
}

describe('withCanvasGenerationContext', () => {
  it('binds a project flow generation to its project, flow, node, and execution', () => {
    expect(withCanvasGenerationContext(request, {
      currentProject: { id: 'project-1' },
      currentChapter: null,
      currentFlow: {
        id: 'flow-1',
        source: 'server',
        ownerType: 'project',
        ownerId: 'project-1',
      },
    })).toMatchObject({
      extras: {
        generationContext: {
          projectId: 'project-1',
          flowId: 'flow-1',
          nodeId: 'node-1',
          workflowExecutionId: 'execution-1',
        },
      },
    })
  })

  it('uses chapter authority and does not mislabel a chapter canvas as a flows row', () => {
    expect(withCanvasGenerationContext(request, {
      currentProject: { id: 'stale-project' },
      currentChapter: { projectId: 'project-2', chapterId: 'chapter-2' },
      currentFlow: {
        id: 'chapter-2',
        source: 'server',
        ownerType: 'chapter',
        ownerId: 'chapter-2',
      },
    }, 'node-2')).toMatchObject({
      extras: {
        generationContext: {
          projectId: 'project-2',
          chapterId: 'chapter-2',
          nodeId: 'node-2',
        },
      },
    })
    expect(withCanvasGenerationContext(request, {
      currentProject: { id: 'stale-project' },
      currentChapter: { projectId: 'project-2', chapterId: 'chapter-2' },
      currentFlow: {
        id: 'chapter-2',
        source: 'server',
        ownerType: 'chapter',
        ownerId: 'chapter-2',
      },
    }).extras?.generationContext).not.toHaveProperty('flowId')
  })

  it('leaves projectless task requests unchanged', () => {
    const projectlessRequest: TaskRequestDto = {
      kind: 'prompt_refine',
      prompt: 'refine',
      extras: { persistAssets: false },
    }
    expect(withCanvasGenerationContext(projectlessRequest, {
      currentProject: null,
      currentChapter: null,
      currentFlow: { source: 'local', ownerType: null, ownerId: null },
    })).toBe(projectlessRequest)
  })
})
