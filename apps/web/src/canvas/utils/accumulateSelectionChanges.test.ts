import { describe, expect, it } from 'vitest'
import type { Node, NodeChange } from '@xyflow/react'
import { accumulateSelectionChanges } from './accumulateSelectionChanges'

const select = (id: string, selected: boolean): NodeChange<Node> => ({ id, type: 'select', selected })

describe('accumulateSelectionChanges', () => {
  it('累积框选逐帧下发的增量批次，而不是只保留最后一批', () => {
    // React Flow 框选每帧只发本帧翻转的节点。覆盖式赋值会让 a/b 永远进不了业务 store。
    let pending: NodeChange<Node>[] = []
    pending = accumulateSelectionChanges(pending, [select('a', true)])
    pending = accumulateSelectionChanges(pending, [select('b', true)])
    pending = accumulateSelectionChanges(pending, [select('c', true)])

    expect(pending).toEqual([select('a', true), select('b', true), select('c', true)])
  })

  it('同一节点的后续变更覆盖先前的（缩小框选时取消选中生效）', () => {
    let pending = accumulateSelectionChanges([], [select('a', true), select('b', true)])
    pending = accumulateSelectionChanges(pending, [select('b', false)])

    expect(pending).toEqual([select('a', true), select('b', false)])
  })

  it('覆盖时保持节点首次出现的顺序，不重复追加', () => {
    let pending = accumulateSelectionChanges([], [select('a', true), select('b', true)])
    pending = accumulateSelectionChanges(pending, [select('a', false), select('c', true)])

    expect(pending.map((change) => (change as { id: string }).id)).toEqual(['a', 'b', 'c'])
    expect(pending[0]).toEqual(select('a', false))
  })

  it('缓冲区为空时返回新数组副本，不与入参共享引用', () => {
    const incoming = [select('a', true)]
    const result = accumulateSelectionChanges([], incoming)

    expect(result).toEqual(incoming)
    expect(result).not.toBe(incoming)
  })

  it('不改动传入的缓冲区数组（调用方持有的 ref 不被就地污染）', () => {
    const pending = [select('a', true)]
    accumulateSelectionChanges(pending, [select('b', true)])

    expect(pending).toEqual([select('a', true)])
  })
})
