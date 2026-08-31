import type { Edge, Node } from '@xyflow/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useRFStore } from './store'
import {
  WORKFLOW_ICON_NODE_FLOW_GAP_X,
  WORKFLOW_ICON_NODE_FLOW_GAP_Y,
  WORKFLOW_ICON_NODE_SIZE,
} from './workflowNodeGeometry'
import { computeWorkflowFlowLayout } from './workflowFlowLayout'
import { computeTidyByCategoryLayout } from './tidyByCategory'

type WorkflowTestData = Record<string, unknown> & {
  kind: 'workflowStage' | 'workflowTrigger'
}

function workflowNode(
  id: string,
  kind: WorkflowTestData['kind'],
  position: Readonly<{ x: number; y: number }>,
): Node<WorkflowTestData> {
  return {
    id,
    type: 'taskNode',
    parentId: 'workflow-group',
    position: { ...position },
    data: {
      kind,
      nodeWidth: WORKFLOW_ICON_NODE_SIZE,
      nodeHeight: WORKFLOW_ICON_NODE_SIZE,
    },
  }
}

function edge(id: string, source: string, target: string): Edge {
  return { id, source, target, type: 'typed' }
}

function arrangedNode(id: string): Node {
  const node = useRFStore.getState().nodes.find((candidate) => candidate.id === id)
  if (!node) throw new Error(`测试节点不存在: ${id}`)
  return node
}

describe('workflow group flow layout', () => {
  beforeEach(() => {
    useRFStore.setState({
      nodes: [
        {
          id: 'workflow-group',
          type: 'groupNode',
          position: { x: 400, y: 200 },
          style: { width: 320, height: 600 },
          data: { adminWorkflow: true },
        },
        workflowNode('trigger', 'workflowTrigger', { x: 220, y: 380 }),
        workflowNode('prepare', 'workflowStage', { x: 24, y: 32 }),
      workflowNode('branch-left', 'workflowStage', { x: 210, y: 40 }),
      workflowNode('branch-right', 'workflowStage', { x: 16, y: 240 }),
      workflowNode('merge', 'workflowStage', { x: 120, y: 360 }),
      ],
      edges: [
        edge('trigger-prepare', 'trigger', 'prepare'),
        edge('prepare-left', 'prepare', 'branch-left'),
        edge('prepare-right', 'prepare', 'branch-right'),
        edge('left-merge', 'branch-left', 'merge'),
        edge('right-merge', 'branch-right', 'merge'),
      ],
      historyPast: [],
      historyFuture: [],
    })
  })

  it('advances the main flow to the right and stacks branches vertically', () => {
    useRFStore.getState().arrangeGroupChildren('workflow-group', 'flow')

    const trigger = arrangedNode('trigger')
    const prepare = arrangedNode('prepare')
    const branchLeft = arrangedNode('branch-left')
    const branchRight = arrangedNode('branch-right')
    const merge = arrangedNode('merge')

    expect(trigger.position.y).toBe(prepare.position.y)
    expect(prepare.position.x - trigger.position.x).toBe(
      WORKFLOW_ICON_NODE_SIZE + WORKFLOW_ICON_NODE_FLOW_GAP_X,
    )
    expect(branchLeft.position.x).toBe(branchRight.position.x)
    expect(branchLeft.position.x - prepare.position.x).toBe(
      WORKFLOW_ICON_NODE_SIZE + WORKFLOW_ICON_NODE_FLOW_GAP_X,
    )
    expect(Math.abs(branchRight.position.y - branchLeft.position.y)).toBe(
      WORKFLOW_ICON_NODE_SIZE + WORKFLOW_ICON_NODE_FLOW_GAP_Y,
    )

    const branchCenterY = (branchLeft.position.y + branchRight.position.y + WORKFLOW_ICON_NODE_SIZE) / 2
    const prepareCenterY = prepare.position.y + WORKFLOW_ICON_NODE_SIZE / 2
    expect(prepareCenterY).toBe(branchCenterY)
    expect(merge.position.y).toBe(prepare.position.y)
    expect(merge.position.x - branchLeft.position.x).toBe(
      WORKFLOW_ICON_NODE_SIZE + WORKFLOW_ICON_NODE_FLOW_GAP_X,
    )
  })

  it('keeps the fitted group geometry synchronized so one-click tidy cannot overlap creation nodes', () => {
    useRFStore.setState((state) => ({
      nodes: state.nodes.map((node) => node.id === 'workflow-group'
        ? {
            ...node,
            width: 200,
            height: 120,
            measured: { width: 200, height: 120 },
            style: { width: 200, height: 120 },
          }
        : node),
    }))

    useRFStore.getState().arrangeGroupChildren('workflow-group', 'flow')

    const arrangedGroup = arrangedNode('workflow-group')
    expect(arrangedGroup.width).toBeGreaterThan(200)
    expect(arrangedGroup.measured?.width).toBe(arrangedGroup.width)
    expect(arrangedGroup.measured?.height).toBe(arrangedGroup.height)

    const imageNode: Node = {
      id: 'creation-image',
      type: 'taskNode',
      position: { x: 0, y: 0 },
      data: { kind: 'image' },
      measured: { width: 320, height: 180 },
    }
    const nodes = [...useRFStore.getState().nodes, imageNode]
    const { positions } = computeTidyByCategoryLayout(nodes, useRFStore.getState().edges)
    const groupPosition = positions.get(arrangedGroup.id)
    const imagePosition = positions.get(imageNode.id)
    if (!groupPosition || !imagePosition || typeof arrangedGroup.width !== 'number') {
      throw new Error('一键整理未返回完整的编排组与创作节点位置')
    }

    expect(imagePosition.x).toBeGreaterThanOrEqual(groupPosition.x + arrangedGroup.width + 120)
  })

  it('keeps Skill and knowledge references out of the left-to-right execution chain', () => {
    const referenceNode = (id: string, kind: 'skill' | 'knowledge'): Node => ({
      id,
      type: 'taskNode',
      parentId: 'workflow-group',
      position: { x: 0, y: 0 },
      data: {
        kind: 'workflowStage',
        adminWorkflow: true,
        workflowRuntimeReference: true,
        workflowRuntimeReferenceKind: kind,
        workflowRuntimeReferenceOwnerNodeId: 'prepare',
        nodeWidth: WORKFLOW_ICON_NODE_SIZE,
        nodeHeight: WORKFLOW_ICON_NODE_SIZE,
      },
    })
    useRFStore.setState((state) => ({
      nodes: [
        ...state.nodes,
        referenceNode('prepare-skill', 'skill'),
        referenceNode('prepare-knowledge', 'knowledge'),
      ],
      edges: [
        ...state.edges,
        edge('skill-prepare', 'prepare-skill', 'prepare'),
        edge('knowledge-prepare', 'prepare-knowledge', 'prepare'),
      ],
    }))

    useRFStore.getState().arrangeGroupChildren('workflow-group', 'flow')

    const trigger = arrangedNode('trigger')
    const prepare = arrangedNode('prepare')
    const branchLeft = arrangedNode('branch-left')
    const skill = arrangedNode('prepare-skill')
    const knowledge = arrangedNode('prepare-knowledge')

    expect(prepare.position.x).toBeGreaterThan(trigger.position.x)
    expect(branchLeft.position.x).toBeGreaterThan(prepare.position.x)
    expect(prepare.position.y).toBe(trigger.position.y)
    expect(skill.position.y).toBeGreaterThan(prepare.position.y)
    expect(knowledge.position.y).toBe(skill.position.y)
    expect(skill.position.x).toBeLessThan(prepare.position.x)
    expect(knowledge.position.x).toBeGreaterThan(prepare.position.x)
  })
})

describe('computeWorkflowFlowLayout', () => {
  const compactNode = (id: string, x: number, y: number) => ({
    id,
    position: { x, y },
    size: { width: WORKFLOW_ICON_NODE_SIZE, height: WORKFLOW_ICON_NODE_SIZE },
  })

  it('does not collapse temporarily disconnected nodes into one vertical column', () => {
    const nodes = Array.from({ length: 8 }, (_, index) => compactNode(
      `node-${index}`,
      0,
      index * 100,
    ))

    const positions = computeWorkflowFlowLayout(
      nodes,
      [],
      WORKFLOW_ICON_NODE_FLOW_GAP_X,
      WORKFLOW_ICON_NODE_FLOW_GAP_Y,
    )
    const distinctColumns = new Set(Array.from(positions.values(), (position) => position.x))
    const nodesPerColumn = new Map<number, number>()
    positions.forEach((position) => {
      nodesPerColumn.set(position.x, (nodesPerColumn.get(position.x) ?? 0) + 1)
    })

    expect(distinctColumns.size).toBe(3)
    expect(Math.max(...nodesPerColumn.values())).toBeLessThanOrEqual(3)
  })

  it('is deterministic even when the previous canvas coordinates are scrambled', () => {
    const edges = [
      { source: 'start', target: 'top' },
      { source: 'start', target: 'bottom' },
      { source: 'top', target: 'finish' },
      { source: 'bottom', target: 'finish' },
    ]
    const first = [
      compactNode('start', 500, 900),
      compactNode('top', 100, 700),
      compactNode('bottom', 900, 50),
      compactNode('finish', 300, 400),
    ]
    const second = first.map((node, index) => ({
      ...node,
      position: { x: 1_000 - index * 231, y: index * 317 },
    })).reverse()

    const firstPositions = computeWorkflowFlowLayout(
      first,
      edges,
      WORKFLOW_ICON_NODE_FLOW_GAP_X,
      WORKFLOW_ICON_NODE_FLOW_GAP_Y,
    )
    const secondPositions = computeWorkflowFlowLayout(
      second,
      [...edges].reverse(),
      WORKFLOW_ICON_NODE_FLOW_GAP_X,
      WORKFLOW_ICON_NODE_FLOW_GAP_Y,
    )

    expect(Object.fromEntries(firstPositions)).toEqual(Object.fromEntries(secondPositions))
  })

  it('orders fan-in layers by their graph neighbors to remove an avoidable crossing', () => {
    const nodes = [
      compactNode('a', 0, 0),
      compactNode('b', 0, 100),
      compactNode('c', 100, 0),
      compactNode('d', 100, 100),
    ]
    const positions = computeWorkflowFlowLayout(
      nodes,
      [
        { source: 'a', target: 'd' },
        { source: 'b', target: 'c' },
      ],
      WORKFLOW_ICON_NODE_FLOW_GAP_X,
      WORKFLOW_ICON_NODE_FLOW_GAP_Y,
    )

    expect(positions.get('a')!.y).toBeLessThan(positions.get('b')!.y)
    expect(positions.get('d')!.y).toBeLessThan(positions.get('c')!.y)
  })
})

describe('workflow group membership repair', () => {
  it('reattaches workflow-instance nodes before arranging the complete graph', () => {
    useRFStore.setState({
      nodes: [
        {
          id: 'workflow-group',
          type: 'groupNode',
          position: { x: 100, y: 100 },
          style: { width: 200, height: 120 },
          data: {
            adminWorkflow: true,
            workflowKey: 'video-production',
            workflowInstanceId: 'workflow-1',
          },
        },
        {
          ...workflowNode('start', 'workflowTrigger', { x: 10, y: 10 }),
          data: {
            kind: 'workflowTrigger',
            adminWorkflow: true,
            workflowInstanceId: 'workflow-1',
            nodeWidth: WORKFLOW_ICON_NODE_SIZE,
            nodeHeight: WORKFLOW_ICON_NODE_SIZE,
          },
        },
        {
          ...workflowNode('finish', 'workflowStage', { x: 900, y: 700 }),
          parentId: undefined,
          data: {
            kind: 'workflowStage',
            adminWorkflow: true,
            workflowInstanceId: 'workflow-1',
            nodeWidth: WORKFLOW_ICON_NODE_SIZE,
            nodeHeight: WORKFLOW_ICON_NODE_SIZE,
          },
        },
      ],
      edges: [edge('start-finish', 'start', 'finish')],
      historyPast: [],
      historyFuture: [],
    })

    useRFStore.getState().arrangeGroupChildren('workflow-group', 'flow')

    const start = arrangedNode('start')
    const finish = arrangedNode('finish')
    expect(finish.parentId).toBe('workflow-group')
    expect(finish.position.x).toBeGreaterThan(start.position.x)
  })
})
