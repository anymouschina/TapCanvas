import { beforeEach, describe, expect, it } from 'vitest'
import { useRFStore } from './store'

// 撤销栈快照从整图 structuredClone 改为引用快照（store 全程不可变更新，二者语义等价，
// 但深克隆让 updateNodeData 等高频入口每次调用都要深拷全图——大画布上是主线程大头）。
// 这些用例锁住改动后 undo/redo 的行为正确性：快照不被后续编辑污染、多级撤销/重做可往返。

function textNode(id: string, label: string) {
  return {
    id,
    type: 'taskNode',
    position: { x: 0, y: 0 },
    data: { kind: 'text', label },
  }
}

describe('撤销栈引用快照', () => {
  beforeEach(() => {
    useRFStore.setState({
      nodes: [textNode('a', 'v0'), textNode('b', 'stay')] as any,
      edges: [],
      historyPast: [],
      historyFuture: [],
    })
  })

  it('多级编辑后逐级 undo 恢复各历史值（快照不被后续编辑污染）', () => {
    const { updateNodeData, undo } = useRFStore.getState()
    updateNodeData('a', { label: 'v1' })
    updateNodeData('a', { label: 'v2' })
    const labelOf = () => (useRFStore.getState().nodes.find((n) => n.id === 'a')?.data as any).label
    expect(labelOf()).toBe('v2')
    undo()
    expect(labelOf()).toBe('v1')
    undo()
    expect(labelOf()).toBe('v0')
  })

  it('undo 后 redo 往返，且未动的节点保持引用不变', () => {
    const { updateNodeData, undo, redo } = useRFStore.getState()
    const bBefore = useRFStore.getState().nodes.find((n) => n.id === 'b')
    updateNodeData('a', { label: 'v1' })
    undo()
    redo()
    const s = useRFStore.getState()
    expect((s.nodes.find((n) => n.id === 'a')?.data as any).label).toBe('v1')
    expect(s.nodes.find((n) => n.id === 'b')).toBe(bBefore)
  })

  it('undo 后再编辑清空 redo 栈', () => {
    const { updateNodeData, undo } = useRFStore.getState()
    updateNodeData('a', { label: 'v1' })
    undo()
    updateNodeData('a', { label: 'v1b' })
    expect(useRFStore.getState().historyFuture).toHaveLength(0)
  })

  it('历史快照与入栈时的图共享引用（不再深克隆）', () => {
    const before = useRFStore.getState().nodes
    useRFStore.getState().updateNodeData('a', { label: 'v1' })
    const past = useRFStore.getState().historyPast
    expect(past[past.length - 1].nodes).toBe(before)
  })
})
