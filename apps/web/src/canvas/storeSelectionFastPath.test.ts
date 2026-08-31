import { beforeEach, describe, expect, it } from 'vitest'
import { useRFStore } from './store'

// 纯选中变更走 onNodesChange 的快速路径：只换 selected 真的翻转了的那些节点，其余节点保持引用。
// 改动前选中一个节点会跑完整管道（applyNodeChanges + 逐节点 strip + 两遍 ensureParentFirstOrder
// + 压一份 history），把每个节点对象都换掉——一次点击即 O(N) 整图重建 + 下游存盘链路全被叫醒。
// 这些用例锁住：引用最小化、不压历史、无变化时数组引用不动。

function textNode(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    type: 'taskNode',
    position: { x: 0, y: 0 },
    data: { kind: 'text', label: id },
    ...extra,
  }
}

describe('onNodesChange 纯选中快速路径', () => {
  beforeEach(() => {
    useRFStore.setState({
      nodes: [textNode('a'), textNode('b'), textNode('c')] as any,
      edges: [],
      historyPast: [],
      historyFuture: [],
    })
  })

  it('只有 selected 翻转的节点换引用，其余节点引用不变', () => {
    const before = useRFStore.getState().nodes
    useRFStore.getState().onNodesChange([{ id: 'b', type: 'select', selected: true }] as any)
    const after = useRFStore.getState().nodes

    expect(after).not.toBe(before)
    expect(after[0]).toBe(before[0])
    expect(after[2]).toBe(before[2])
    expect(after[1]).not.toBe(before[1])
    expect(after[1].selected).toBe(true)
  })

  it('不压入撤销历史（选中不是可撤销的编辑）', () => {
    useRFStore.getState().onNodesChange([{ id: 'a', type: 'select', selected: true }] as any)
    expect(useRFStore.getState().historyPast).toHaveLength(0)
  })

  it('同一批里的取消选中 + 选中都生效', () => {
    useRFStore.setState({
      nodes: [textNode('a', { selected: true }), textNode('b'), textNode('c')] as any,
    })
    useRFStore.getState().onNodesChange([
      { id: 'a', type: 'select', selected: false },
      { id: 'c', type: 'select', selected: true },
    ] as any)
    const nodes = useRFStore.getState().nodes
    expect(nodes.find((n) => n.id === 'a')?.selected).toBe(false)
    expect(nodes.find((n) => n.id === 'c')?.selected).toBe(true)
  })

  it('选中态未实际改变时保持数组引用（下游存盘/脏标记不被叫醒）', () => {
    const before = useRFStore.getState().nodes
    useRFStore.getState().onNodesChange([{ id: 'a', type: 'select', selected: false }] as any)
    expect(useRFStore.getState().nodes).toBe(before)
  })

  it('select 与 position 混在一批时回落到完整管道（仍压历史、位置生效）', () => {
    useRFStore.getState().onNodesChange([
      { id: 'a', type: 'select', selected: true },
      { id: 'b', type: 'position', position: { x: 40, y: 12 } },
    ] as any)
    const nodes = useRFStore.getState().nodes
    expect(nodes.find((n) => n.id === 'a')?.selected).toBe(true)
    expect(nodes.find((n) => n.id === 'b')?.position).toEqual({ x: 40, y: 12 })
    expect(useRFStore.getState().historyPast).toHaveLength(1)
  })
})
