import { describe, it, expect } from 'vitest'
import {
  applyServerPatchToAcknowledgedFlow,
} from './chapterFlowMerge'
import { rebaseCanvasFlowOnConflict } from '../canvas/persistence/flowConflictRebase'

// 409 冲突合并：必须能同时表达「保留 agent 服务端新增」与「尊重本地删除」。
// 旧实现是纯并集（local ∪ server-only），并集无法表达删除——任何「服务端有、本地没有」
// 的节点都会被捞回，于是用户删掉的节点在每次对话后复活（根因）。
// 修复点：引入墓碑集合 deletedNodeIds，合并时把墓碑里的服务端节点剔除。
describe('rebaseCanvasFlowOnConflict for chapter canvases', () => {
  it('保留 agent 服务端新增的节点（local 没有、且不在墓碑里）', () => {
    const out = rebaseCanvasFlowOnConflict({
      base: { nodes: [{ id: 'a' }], edges: [] },
      local: { nodes: [{ id: 'a' }], edges: [] },
      server: { nodes: [{ id: 'a' }, { id: 'agent-new' }], edges: [] },
    })
    expect(out.nodes.map((n) => n.id).sort()).toEqual(['a', 'agent-new'])
  })

  it('不把本地删除的节点从服务端捞回（墓碑生效）', () => {
    const out = rebaseCanvasFlowOnConflict({
      base: { nodes: [{ id: 'a' }, { id: 'X' }], edges: [] },
      local: { nodes: [{ id: 'a' }], edges: [] },
      server: { nodes: [{ id: 'a' }, { id: 'X' }, { id: 'agent-new' }], edges: [] },
    })
    const ids = out.nodes.map((n) => n.id).sort()
    expect(ids).toContain('agent-new') // agent 新增照常保留
    expect(ids).not.toContain('X') // 被删的 X 不复活
    expect(ids).toEqual(['a', 'agent-new'])
  })

  it('同 id 以本地为准（用户最新编辑不丢），不产生重复', () => {
    const out = rebaseCanvasFlowOnConflict({
      base: { nodes: [{ id: 'a', label: 'base' }], edges: [] },
      local: { nodes: [{ id: 'a', label: 'local' }], edges: [] },
      server: { nodes: [{ id: 'a', label: 'server' }], edges: [] },
    })
    expect(out.nodes).toHaveLength(1)
    expect((out.nodes[0] as { label?: string }).label).toBe('local')
  })

  it('丢弃指向已删节点的服务端悬空边', () => {
    const out = rebaseCanvasFlowOnConflict({
      base: { nodes: [{ id: 'a' }, { id: 'X' }], edges: [{ id: 'e1', source: 'a', target: 'X' }] },
      local: { nodes: [{ id: 'a' }], edges: [] },
      server: { nodes: [{ id: 'a' }, { id: 'X' }], edges: [{ id: 'e1', source: 'a', target: 'X' }] },
    })
    expect(out.nodes.map((n) => n.id)).not.toContain('X')
    expect(out.edges.map((e) => e.id)).not.toContain('e1') // 边指向被删的 X，必须一并丢弃
  })

  it('保留服务端新增且端点都存在的边', () => {
    const out = rebaseCanvasFlowOnConflict({
      base: { nodes: [{ id: 'a' }], edges: [] },
      local: { nodes: [{ id: 'a' }], edges: [] },
      server: { nodes: [{ id: 'a' }, { id: 'agent-new' }], edges: [{ id: 'e2', source: 'a', target: 'agent-new' }] },
    })
    expect(out.edges.map((e) => e.id)).toContain('e2')
  })

  it('服务端删除本地未修改的节点后，陈旧本地快照不会将其复活', () => {
    const out = rebaseCanvasFlowOnConflict({
      base: { nodes: [{ id: 'keep' }, { id: 'remote-deleted' }], edges: [] },
      local: { nodes: [{ id: 'keep' }, { id: 'remote-deleted' }], edges: [] },
      server: { nodes: [{ id: 'keep' }, { id: 'agent-new' }], edges: [] },
    })

    expect(out.nodes.map((node) => node.id).sort()).toEqual(['agent-new', 'keep'])
  })

  it('服务端删除与本地修改冲突时，只重放真实本地修改', () => {
    const out = rebaseCanvasFlowOnConflict({
      base: { nodes: [
        { id: 'remote-deleted', value: 'base' },
        { id: 'locally-edited', value: 'base' },
      ], edges: [] },
      local: { nodes: [
        { id: 'remote-deleted', value: 'base' },
        { id: 'locally-edited', value: 'local' },
      ], edges: [] },
      server: { nodes: [], edges: [] },
    })

    expect(out.nodes).toEqual([{ id: 'locally-edited', value: 'local' }])
  })
})

describe('applyServerPatchToAcknowledgedFlow', () => {
  it('把服务端删除同步到账本，并清理指向删除节点的边', () => {
    const out = applyServerPatchToAcknowledgedFlow({
      nodes: [{ id: 'keep' }, { id: 'removed' }],
      edges: [{ id: 'edge', source: 'keep', target: 'removed' }],
      patch: { removeNodeIds: ['removed'] },
    })

    expect(out.nodes).toEqual([{ id: 'keep' }])
    expect(out.edges).toEqual([])
  })

  it('按 id 应用服务端 upsert，不产生重复节点', () => {
    const out = applyServerPatchToAcknowledgedFlow({
      nodes: [{ id: 'same', value: 'old' }],
      edges: [],
      patch: {
        upsertNodes: [
          { id: 'same', value: 'new' },
          { id: 'added', value: 'server' },
        ],
      },
    })

    expect(out.nodes).toEqual([
      { id: 'same', value: 'new' },
      { id: 'added', value: 'server' },
    ])
  })
})
