import { describe, expect, it } from 'vitest'
import type { Node } from '@xyflow/react'
import {
  collectAiChatAutoRunNodeIds,
  collectAiChatPatchedNodeIds,
  shouldAutoRunAiChatNode,
  shouldAutoRunAiChatPatchedNode,
} from '../../src/ui/chat/autoRunCanvasNodes'

function createNode(input: {
  id: string
  kind: string
  prompt?: string
  storyboardEditorGrid?: string
  storyboardEditorCells?: Array<{ id?: string; prompt?: string; imageUrl?: string | null }>
  imagePromptSpecV2?: Record<string, unknown>
  status?: string
  imageUrl?: string
  imageResults?: Array<{ url?: string }>
  taskId?: string
  aiChatAutoRun?: boolean
  skipDagRun?: boolean
}): Node {
  return {
    id: input.id,
    type: 'taskNode',
    position: { x: 0, y: 0 },
    data: {
      kind: input.kind,
      ...(input.prompt ? { prompt: input.prompt } : {}),
      ...(input.storyboardEditorGrid ? { storyboardEditorGrid: input.storyboardEditorGrid } : {}),
      ...(input.storyboardEditorCells ? { storyboardEditorCells: input.storyboardEditorCells } : {}),
      ...(input.imagePromptSpecV2 ? { imagePromptSpecV2: input.imagePromptSpecV2 } : {}),
      ...(input.status ? { status: input.status } : {}),
      ...(input.imageUrl ? { imageUrl: input.imageUrl } : {}),
      ...(input.imageResults ? { imageResults: input.imageResults } : {}),
      ...(input.taskId ? { taskId: input.taskId } : {}),
      ...(typeof input.aiChatAutoRun === 'boolean' ? { aiChatAutoRun: input.aiChatAutoRun } : {}),
      ...(typeof input.skipDagRun === 'boolean' ? { skipDagRun: input.skipDagRun } : {}),
    },
  } as Node
}

describe('ai chat canvas auto-run helpers', () => {
  const imagePromptSpecV2 = {
    version: 'v2',
    shotIntent: '雨夜窗前初醒关键帧',
    spatialLayout: ['前景是潮湿窗框', '中景是少年站在窗前', '背景是雨夜山寨'],
    cameraPlan: ['中近景', '轻微低机位'],
    lightingPlan: ['冷月光与室内暖灯交错'],
    continuityConstraints: ['保持方源外观一致'],
    negativeConstraints: ['不要切到白天'],
  }

  it('auto-runs fresh image nodes with prompts and no outputs', () => {
    expect(
      shouldAutoRunAiChatNode(
        createNode({
          id: 'img-1',
          kind: 'image',
          prompt: '生成一张图',
        }),
      ),
    ).toBe(true)
  })

  it('auto-runs fresh image nodes when only imagePromptSpecV2 is present', () => {
    expect(
      shouldAutoRunAiChatNode(
        createNode({
          id: 'img-spec-only',
          kind: 'image',
          imagePromptSpecV2,
        }),
      ),
    ).toBe(true)
  })

  it('skips nodes that already have outputs or active execution markers', () => {
    expect(
      shouldAutoRunAiChatNode(
        createNode({
          id: 'img-success',
          kind: 'image',
          prompt: '生成一张图',
          imageUrl: 'https://example.com/a.png',
        }),
      ),
    ).toBe(false)

    expect(
      shouldAutoRunAiChatNode(
        createNode({
          id: 'img-task',
          kind: 'image',
          prompt: '生成一张图',
          taskId: 'task-1',
        }),
      ),
    ).toBe(false)

    expect(
      shouldAutoRunAiChatNode(
        createNode({
          id: 'img-queued',
          kind: 'image',
          prompt: '生成一张图',
          status: 'queued',
        }),
      ),
    ).toBe(false)
  })

  it('does not auto-run video nodes or explicitly disabled nodes', () => {
    expect(
      shouldAutoRunAiChatNode(
        createNode({
          id: 'video-1',
          kind: 'composeVideo',
          prompt: '生成视频',
        }),
      ),
    ).toBe(false)

    expect(
      shouldAutoRunAiChatNode(
        createNode({
          id: 'img-disabled',
          kind: 'image',
          prompt: '生成一张图',
          aiChatAutoRun: false,
        }),
      ),
    ).toBe(false)
  })

  it('auto-runs storyboard nodes with a complete prompt grid, but not partial placeholder boards', () => {
    expect(
      shouldAutoRunAiChatNode(
        createNode({
          id: 'storyboard-1',
          kind: 'storyboard',
          storyboardEditorGrid: '3x2',
          storyboardEditorCells: Array.from({ length: 6 }, (_, index) => ({
            id: `cell-${index + 1}`,
            prompt: `镜头 ${index + 1}`,
            imageUrl: null,
          })),
        }),
      ),
    ).toBe(true)

    expect(
      shouldAutoRunAiChatNode(
        createNode({
          id: 'storyboard-partial',
          kind: 'storyboard',
          storyboardEditorGrid: '3x2',
          storyboardEditorCells: [{ id: 'cell-1', prompt: '只有一个格子' }],
        }),
      ),
    ).toBe(false)
  })

  it('collects only eligible candidate ids and deduplicates them', () => {
    const nodes = [
      createNode({ id: 'img-1', kind: 'image', prompt: '生成一张图' }),
      createNode({ id: 'img-2', kind: 'image', prompt: '生成第二张', imageResults: [{ url: 'https://example.com/b.png' }] }),
      createNode({ id: 'video-1', kind: 'composeVideo', prompt: '生成视频' }),
    ]

    expect(
      collectAiChatAutoRunNodeIds({
        nodes,
        candidateNodeIds: ['img-1', 'img-1', 'img-2', 'video-1', 'missing'],
      }),
    ).toEqual(['img-1'])
  })

  it('allows patched queued image nodes to be auto-run when they still have no task ids or outputs', () => {
    expect(
      shouldAutoRunAiChatPatchedNode(
        createNode({
          id: 'img-patched',
          kind: 'image',
          prompt: '重新生成这张图',
          status: 'queued',
        }),
      ),
    ).toBe(true)

    expect(
      shouldAutoRunAiChatPatchedNode(
        createNode({
          id: 'img-patched-task',
          kind: 'image',
          prompt: '重新生成这张图',
          status: 'queued',
          taskId: 'task-1',
        }),
      ),
    ).toBe(false)

    expect(
      collectAiChatPatchedNodeIds({
        nodes: [
          createNode({ id: 'img-patched', kind: 'image', prompt: '重新生成这张图', status: 'queued' }),
          createNode({ id: 'img-spec', kind: 'image', imagePromptSpecV2, status: 'queued' }),
          createNode({
            id: 'storyboard-patched',
            kind: 'storyboard',
            storyboardEditorGrid: '2x2',
            storyboardEditorCells: Array.from({ length: 4 }, (_, index) => ({
              id: `storyboard-cell-${index + 1}`,
              prompt: `分镜 ${index + 1}`,
            })),
            status: 'queued',
          }),
          createNode({ id: 'img-success', kind: 'image', prompt: '已有结果', imageUrl: 'https://example.com/done.png' }),
        ],
        candidateNodeIds: ['img-patched', 'img-success', 'img-spec', 'storyboard-patched', 'img-patched'],
      }),
    ).toEqual(['img-patched', 'img-spec', 'storyboard-patched'])
  })
})
