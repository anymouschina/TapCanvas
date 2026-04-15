import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MantineProvider } from '@mantine/core'
import type { Edge, Node } from '@xyflow/react'
import type { ReactNode } from 'react'

import NodeInspector from '../../src/inspector/NodeInspector'
import { useRFStore } from '../../src/canvas/store'
import { useUIStore } from '../../src/ui/uiStore'

type TestNodeData = Record<string, unknown>
type FocusWindow = Window & { __tcFocusNode?: (id: string) => void }

function renderWithMantine(node: ReactNode) {
  return render(<MantineProvider>{node}</MantineProvider>)
}

function createTaskNode(
  id: string,
  data: TestNodeData,
  options?: { selected?: boolean; parentId?: string },
): Node<TestNodeData, 'taskNode'> {
  return {
    id,
    type: 'taskNode',
    position: { x: 0, y: 0 },
    data,
    selected: options?.selected ?? false,
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

afterEach(() => {
  useRFStore.setState({ nodes: [], edges: [] })
  useUIStore.setState({ focusedNodeId: null })
  delete (window as FocusWindow).__tcFocusNode
})

describe('NodeInspector production metadata actions', () => {
  it('can locate and focus the upstream source node', () => {
    const baseFrameNode = createTaskNode('img-base-1', {
      kind: 'image',
      label: '第三章权威基底帧',
    })
    const sourceNode = createTaskNode('script-1', {
      kind: 'storyboardScript',
      label: '第三章锚点清单',
      productionMetadata: createProductionMetadata('confirmed'),
    })
    const selectedNode = createTaskNode(
      'video-1',
      {
        kind: 'composeVideo',
        label: '第三章视频1',
      },
      { selected: true },
    )

    useRFStore.setState({
      nodes: [baseFrameNode, sourceNode, selectedNode],
      edges: [createEdge('edge-1', 'script-1', 'video-1')],
    })

    const focusNodeSpy = vi.fn<(id: string) => void>()
    ;(window as FocusWindow).__tcFocusNode = focusNodeSpy

    renderWithMantine(<NodeInspector />)

    fireEvent.click(screen.getByRole('button', { name: '定位来源节点' }))
    expect(focusNodeSpy).toHaveBeenCalledWith('script-1')

    fireEvent.click(screen.getByRole('button', { name: '聚焦来源链' }))
    expect(focusNodeSpy).toHaveBeenLastCalledWith('script-1')
    expect(useUIStore.getState().focusedNodeId).toBe('script-1')

    fireEvent.click(screen.getByRole('button', { name: '定位基底帧' }))
    expect(focusNodeSpy).toHaveBeenLastCalledWith('img-base-1')

    fireEvent.click(screen.getByRole('button', { name: '聚焦基底链' }))
    expect(focusNodeSpy).toHaveBeenLastCalledWith('img-base-1')
    expect(useUIStore.getState().focusedNodeId).toBe('img-base-1')
  })

  it('does not show source actions when metadata belongs to the selected node itself', () => {
    const selectedNode = createTaskNode(
      'script-1',
      {
        kind: 'storyboardScript',
        label: '第三章锚点清单',
        productionMetadata: createProductionMetadata('planned'),
      },
      { selected: true },
    )

    useRFStore.setState({
      nodes: [selectedNode],
      edges: [],
    })

    renderWithMantine(<NodeInspector />)

    expect(screen.queryByRole('button', { name: '定位来源节点' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '聚焦来源链' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '定位基底帧' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '聚焦基底链' })).not.toBeInTheDocument()
  })

  it('can locate same-group metadata source when no upstream edge exists', () => {
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
      { selected: true, parentId: groupId },
    )

    useRFStore.setState({
      nodes: [sourceNode, selectedNode],
      edges: [],
    })

    const focusNodeSpy = vi.fn<(id: string) => void>()
    ;(window as FocusWindow).__tcFocusNode = focusNodeSpy

    renderWithMantine(<NodeInspector />)

    expect(screen.getByText('来自同组节点 第四章锚点清单')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '定位来源节点' }))
    expect(focusNodeSpy).toHaveBeenCalledWith('script-1')
    expect(screen.queryByRole('button', { name: '聚焦来源链' })).not.toBeInTheDocument()
  })
})
