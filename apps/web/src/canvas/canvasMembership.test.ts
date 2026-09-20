import { beforeEach, describe, expect, it } from 'vitest'
import type { Node } from '@xyflow/react'
import { useRFStore } from './store'
import { ensureWorkflowExecutionPlaceholderNode } from './workflowExecutionProjection'
import { applyRemotePatchToDeletionLedger, canvasMembershipChanges, filterCanvasMembershipPatch, prepareCanvasMembershipSave } from './persistence/canvasMembership'
import { rebaseCanvasFlowOnConflict } from './persistence/flowConflictRebase'

const card: Node = {
  id: 'execution-card', type: 'workflowExecutionNode', position: { x: 0, y: 0 }, selected: true,
  data: { kind: 'workflowExecution', managedProjection: 'workflow_execution', workflowExecutionId: 'run-1' },
}
const output: Node = {
  id: 'output', type: 'taskNode', position: { x: 300, y: 0 }, selected: true,
  data: { kind: 'video', workflowExecutionId: 'run-1', status: 'running' },
}

describe('explicit canvas deletion intent', () => {
  it('retains acknowledged videos when a drag snapshot lags remote results', () => {
    const base = { nodes: [card, output], edges: [{ id: 'edge', source: card.id, target: output.id }] }
    const moved = { ...card, position: { x: 80, y: 90 } }
    const prepared = prepareCanvasMembershipSave(base, { nodes: [moved], edges: [] }, [])
    expect(prepared.changes.deletedNodeIds).toEqual([])
    expect(prepared.snapshot.nodes).toEqual([moved, output])
    expect(prepared.snapshot.edges).toEqual(base.edges)
    expect(prepared.adjusted).toBe(true)
    const rebased = rebaseCanvasFlowOnConflict({ base, local: prepared.snapshot,
      server: { ...base, nodes: [card, { ...output, data: { ...output.data, status: 'success', videoUrl: 'https://owned.example/result.mp4' } }] } })
    expect(rebased.nodes.find(node => node.id === output.id)?.data.status).toBe('success')
    expect(rebased.nodes.find(node => node.id === card.id)?.position).toEqual(moved.position)
  })

  it('removes only explicitly deleted nodes while preserving other late results', () => {
    const second = { ...output, id: 'second' }
    const base = { nodes: [card, output, second], edges: [] }
    const prepared = prepareCanvasMembershipSave(base, { nodes: [card], edges: [] }, [output.id])
    expect(prepared.snapshot.nodes.map(node => node.id)).toEqual([card.id, second.id])
    expect(prepared.changes.deletedNodeIds).toEqual([output.id])
  })
  beforeEach(() => {
    useRFStore.getState().reset()
    useRFStore.setState({ nodes: [card, output], graphProvenanceKey: 'flow:one' })
  })

  it.each(['deleteNode', 'removeSelected', 'onNodesChange'] as const)('%s prevents execution recovery from recreating a deleted card', (action) => {
    if (action === 'deleteNode') useRFStore.getState().deleteNode(card.id)
    else if (action === 'removeSelected') useRFStore.getState().removeSelected()
    else useRFStore.getState().onNodesChange([{ type: 'remove', id: card.id }])
    expect(useRFStore.getState().locallyDeletedNodeIds).toContain(card.id)
    expect(useRFStore.getState().detachedWorkflowExecutionIds).toContain('run-1')
    ensureWorkflowExecutionPlaceholderNode('run-1', [], 'failed')
    expect(useRFStore.getState().nodes.some((node) => node.type === 'workflowExecutionNode')).toBe(false)
  })

  it('deleting a group records its execution card detachment', () => {
    useRFStore.setState({ nodes: [
      { id: 'group', type: 'groupNode', position: { x: 0, y: 0 }, data: {} },
      { ...card, parentId: 'group' },
      output,
    ] })
    useRFStore.getState().removeGroupById('group')
    expect(useRFStore.getState().locallyDeletedNodeIds).toEqual(expect.arrayContaining(['group', card.id]))
    expect(useRFStore.getState().detachedWorkflowExecutionIds).toContain('run-1')
    ensureWorkflowExecutionPlaceholderNode('run-1', [], 'failed')
    expect(useRFStore.getState().nodes.map(node => node.id)).toEqual([output.id])
  })

  it('undo restores membership and redo removes it again', () => {
    useRFStore.getState().removeSelected()
    useRFStore.getState().undo()
    expect(useRFStore.getState().locallyDeletedNodeIds).toEqual([])
    expect(useRFStore.getState().detachedWorkflowExecutionIds).toEqual([])
    expect(useRFStore.getState().nodes.map((node) => node.id)).toEqual([card.id, output.id])
    useRFStore.getState().redo()
    expect(useRFStore.getState().locallyDeletedNodeIds).toEqual([card.id, output.id])
    expect(useRFStore.getState().detachedWorkflowExecutionIds).toEqual(['run-1'])
  })

  it('hydrates persisted detachment and permits a different execution', () => {
    useRFStore.setState({ nodes: [], locallyDeletedNodeIds: [card.id], detachedWorkflowExecutionIds: ['run-1'] })
    ensureWorkflowExecutionPlaceholderNode('run-1', [], 'failed')
    expect(useRFStore.getState().nodes).toEqual([])
    ensureWorkflowExecutionPlaceholderNode('run-2', [], 'running')
    expect(useRFStore.getState().nodes).toHaveLength(1)
    expect(useRFStore.getState().nodes[0]?.data.workflowExecutionId).toBe('run-2')
  })

  it('does not carry deletion intent into another canvas', () => {
    useRFStore.getState().removeSelected()
    useRFStore.getState().setGraphProvenance('flow:two')
    expect(useRFStore.getState().locallyDeletedNodeIds).toEqual([])
    expect(useRFStore.getState().detachedWorkflowExecutionIds).toEqual([])
  })

  it('rejects late realtime additions and edges, but accepts an explicit restore', () => {
    useRFStore.getState().removeSelected()
    const patch = { upsertNodes: [output], upsertEdges: [{ id: 'edge', source: card.id, target: output.id }] }
    expect(filterCanvasMembershipPatch(useRFStore.getState(), patch)).toMatchObject({ upsertNodes: [], upsertEdges: [] })
    expect(filterCanvasMembershipPatch(useRFStore.getState(), { ...patch, restoredNodeIds: [output.id] }).upsertNodes).toEqual([output])
  })

  it('keeps a recovery of the deleted family detached after reload', () => {
    useRFStore.setState({ nodes: [], detachedWorkflowExecutionIds: ['family-1'] })
    ensureWorkflowExecutionPlaceholderNode('recovery-2', [], 'running', 'family-1')
    expect(useRFStore.getState().nodes).toEqual([])
    const recoveryOutput = { ...output, id: 'new-output', data: { workflowExecutionId: 'recovery-2', workflowExecutionFamilyId: 'family-1' } }
    expect(filterCanvasMembershipPatch(useRFStore.getState(), { upsertNodes: [recoveryOutput] }).upsertNodes).toEqual([])
  })

  it('preserves local deletion while keeping a concurrently created remote output', () => {
    const base = { nodes: [card, output], edges: [] }
    const local = { nodes: [card], edges: [] }
    const newOutput = { ...output, id: 'new-output' }
    const changes = canvasMembershipChanges(base.nodes, local.nodes)
    const rebased = rebaseCanvasFlowOnConflict({ base, local, server: { nodes: [card, output, newOutput], edges: [] } })
    expect(changes.deletedNodeIds).toEqual([output.id])
    expect(changes.restoredNodeIds).toEqual([])
    expect(rebased.nodes.map((node) => node.id)).toEqual([card.id, newOutput.id])
  })

  it('keeps the deletion ledger derived from local intent and explicit restores only', () => {
    // 服务端 patch 的 removeNodeIds（运行回收 / execution 去挂载 / 投影清理）是已落盘的
    // 权威结果，不是用户意图；它会变成永久 deletedNodeIds 并让节点在投影里彻底消失且无法恢复。
    // 该函数刻意不接受任何远端删除入参 —— 签名本身就是这道保证。
    expect(applyRemotePatchToDeletionLedger([], [])).toEqual([])
    expect(applyRemotePatchToDeletionLedger(['user-deleted'], [])).toEqual(['user-deleted'])
    expect(applyRemotePatchToDeletionLedger(['user-deleted'], ['user-deleted'])).toEqual([])
  })
});
