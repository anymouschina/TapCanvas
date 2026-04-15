import { describe, expect, it } from 'vitest'
import type { Edge, Node } from '@xyflow/react'

import {
  readChapterGroundedProductionMetadata,
  resolveChapterGroundedProductionMetadataForNode,
} from '../../src/canvas/productionMeta'

type TestNodeData = Record<string, unknown>

function createTaskNode(
  id: string,
  data: TestNodeData,
  options?: { parentId?: string },
): Node<TestNodeData, 'taskNode'> {
  return {
    id,
    type: 'taskNode',
    position: { x: 0, y: 0 },
    data,
    ...(options?.parentId ? { parentId: options.parentId } : null),
  }
}

function createEdge(id: string, source: string, target: string): Edge<Record<string, unknown>> {
  return {
    id,
    source,
    target,
  }
}

function createProductionMetadata(status: 'planned' | 'confirmed') {
  return {
    chapterGrounded: true,
    lockedAnchors: {
      character: ['李长安角色卡已锁定'],
      scene: ['荒村夜路场景'],
      shot: ['9:16 竖屏中近景'],
      continuity: ['承接上一组 tail frame'],
      missing: status === 'planned' ? ['待确认权威基底帧'] : [],
    },
    authorityBaseFrame: {
      status,
      source: status === 'planned' ? 'generate_first' : 'existing_flow_anchor',
      reason: status === 'planned' ? '先建立基底帧' : '已有可复用基底帧',
      nodeId: status === 'confirmed' ? 'img-base-1' : null,
    },
  }
}

describe('productionMetadata helpers', () => {
  it('reads valid structured productionMetadata', () => {
    const metadata = readChapterGroundedProductionMetadata(createProductionMetadata('confirmed'))
    expect(metadata).not.toBeNull()
    expect(metadata?.authorityBaseFrame.status).toBe('confirmed')
    expect(metadata?.lockedAnchors.character).toEqual(['李长安角色卡已锁定'])
  })

  it('resolves productionMetadata from the selected node itself', () => {
    const selectedNode = createTaskNode('script-1', {
      kind: 'storyboardScript',
      label: '第三章锚点清单',
      productionMetadata: createProductionMetadata('planned'),
    })

    const resolved = resolveChapterGroundedProductionMetadataForNode({
      selectedNode,
      nodes: [selectedNode],
      edges: [],
    })

    expect(resolved).not.toBeNull()
    expect(resolved?.relation).toBe('self')
    expect(resolved?.sourceNodeId).toBe('script-1')
  })

  it('falls back to upstream script metadata when the selected visual node has none', () => {
    const upstreamNode = createTaskNode('script-1', {
      kind: 'storyboardScript',
      label: '第三章锚点清单',
      productionMetadata: createProductionMetadata('confirmed'),
    })
    const selectedNode = createTaskNode('img-1', {
      kind: 'image',
      label: '第三章关键帧1',
    })

    const resolved = resolveChapterGroundedProductionMetadataForNode({
      selectedNode,
      nodes: [upstreamNode, selectedNode],
      edges: [createEdge('edge-1', 'script-1', 'img-1')],
    })

    expect(resolved).not.toBeNull()
    expect(resolved?.relation).toBe('upstream')
    expect(resolved?.sourceNodeId).toBe('script-1')
    expect(resolved?.sourceNodeLabel).toBe('第三章锚点清单')
    expect(resolved?.metadata.authorityBaseFrame.status).toBe('confirmed')
  })

  it('prefers upstream text-like metadata over non-text upstream metadata', () => {
    const imageUpstreamNode = createTaskNode('img-anchor-1', {
      kind: 'image',
      label: '旧图像锚点',
      productionMetadata: createProductionMetadata('planned'),
    })
    const scriptUpstreamNode = createTaskNode('script-1', {
      kind: 'storyboardScript',
      label: '第三章锚点清单',
      productionMetadata: createProductionMetadata('confirmed'),
    })
    const selectedNode = createTaskNode('video-1', {
      kind: 'composeVideo',
      label: '第三章视频1',
    })

    const resolved = resolveChapterGroundedProductionMetadataForNode({
      selectedNode,
      nodes: [imageUpstreamNode, scriptUpstreamNode, selectedNode],
      edges: [
        createEdge('edge-1', 'img-anchor-1', 'video-1'),
        createEdge('edge-2', 'script-1', 'video-1'),
      ],
    })

    expect(resolved).not.toBeNull()
    expect(resolved?.relation).toBe('upstream')
    expect(resolved?.sourceNodeId).toBe('script-1')
    expect(resolved?.metadata.authorityBaseFrame.status).toBe('confirmed')
  })

  it('resolves metadata through transitive upstream visual chains', () => {
    const upstreamNode = createTaskNode('script-1', {
      kind: 'storyboardScript',
      label: '第四章锚点清单',
      productionMetadata: createProductionMetadata('planned'),
    })
    const middleNode = createTaskNode('video-1', {
      kind: 'composeVideo',
      label: '第四章视频1',
    })
    const selectedNode = createTaskNode('video-2', {
      kind: 'composeVideo',
      label: '第四章视频2',
    })

    const resolved = resolveChapterGroundedProductionMetadataForNode({
      selectedNode,
      nodes: [upstreamNode, middleNode, selectedNode],
      edges: [
        createEdge('edge-1', 'script-1', 'video-1'),
        createEdge('edge-2', 'video-1', 'video-2'),
      ],
    })

    expect(resolved).not.toBeNull()
    expect(resolved?.relation).toBe('upstream')
    expect(resolved?.sourceNodeId).toBe('script-1')
  })

  it('falls back to same-group metadata when the visual chain has no upstream script edge', () => {
    const groupId = 'chapter-4-group'
    const sourceNode = createTaskNode(
      'script-1',
      {
        kind: 'storyboardScript',
        label: '第四章锚点清单',
        productionMetadata: createProductionMetadata('planned'),
      },
      { parentId: groupId },
    )
    const selectedNode = createTaskNode(
      'img-1',
      {
        kind: 'image',
        label: '第四章关键帧1',
      },
      { parentId: groupId },
    )

    const resolved = resolveChapterGroundedProductionMetadataForNode({
      selectedNode,
      nodes: [sourceNode, selectedNode],
      edges: [],
    })

    expect(resolved).not.toBeNull()
    expect(resolved?.relation).toBe('group')
    expect(resolved?.sourceNodeId).toBe('script-1')
  })
})
