import { describe, expect, it } from 'vitest'
import type { Node } from '@xyflow/react'

import { projectWorkflowMediaAttempts } from '../workflowMediaAttemptProjection'
import { collectGroupAssetsForDownload } from './groupAssetDownload'

function imageNode(id: string, x: number, y: number, imageUrl?: string, parentId?: string): Node {
  return {
    id,
    type: 'taskNode',
    position: { x, y },
    parentId,
    data: {
      kind: 'image',
      label: id,
      nodeWidth: 100,
      nodeHeight: 80,
      ...(imageUrl ? { imageUrl } : {}),
    },
  }
}

function groupNode(id: string, x: number, y: number, width: number, height: number): Node {
  return { id, type: 'groupNode', position: { x, y }, style: { width, height }, data: { label: id } }
}

describe('collectGroupAssetsForDownload', () => {
  it('downloads the displayed successful retry from a visual group without parent links', () => {
    const source = imageNode('source', 10, 10)
    source.data = {
      ...source.data,
      workflowExecutionId: 'execution-1',
      workflowExecutionFamilyId: 'family',
      workflowRuntimeNodeId: 'images::item::source',
      workflowEffectId: 'family:source:image-submit',
      status: 'failed',
    }
    const retry = imageNode('source-retry', 10, 10, 'https://assets.example/source.png')
    retry.data = {
      ...retry.data,
      workflowExecutionId: 'execution-2',
      workflowExecutionFamilyId: 'family',
      workflowRuntimeNodeId: 'images::item::source',
      workflowEffectId: 'family:source:image-submit::retry::one',
      workflowMediaRetry: { retryKey: 'one' },
      status: 'success',
    }
    const outside = imageNode('outside', 300, 10, 'https://assets.example/outside.png')
    const visible = projectWorkflowMediaAttempts([
      groupNode('group', 0, 0, 200, 150), source, retry, outside,
    ], []).nodes

    expect(collectGroupAssetsForDownload({ nodes: visible, groupId: 'group' })).toMatchObject([
      { nodeId: 'source', url: 'https://assets.example/source.png' },
    ])
  })

  it('uses structural members and does not capture unrelated overlapping nodes', () => {
    const nodes = [
      groupNode('group', 0, 0, 200, 150),
      imageNode('member', 10, 10, 'https://assets.example/member.png', 'group'),
      imageNode('overlap', 20, 20, 'https://assets.example/overlap.png'),
    ]

    expect(collectGroupAssetsForDownload({ nodes, groupId: 'group' }).map((asset) => asset.nodeId))
      .toEqual(['member'])
  })

  it('assigns unparented nodes to the smallest visual group', () => {
    const nodes = [
      groupNode('outer', 0, 0, 300, 300),
      groupNode('inner', 10, 10, 100, 100),
      imageNode('inner-image', 20, 20, 'https://assets.example/inner.png'),
    ]

    expect(collectGroupAssetsForDownload({ nodes, groupId: 'outer' })).toEqual([])
    expect(collectGroupAssetsForDownload({ nodes, groupId: 'inner' }).map((asset) => asset.nodeId))
      .toEqual(['inner-image'])
  })
})
