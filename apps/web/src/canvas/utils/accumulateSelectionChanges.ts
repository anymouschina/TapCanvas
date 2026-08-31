import type { Node, NodeChange } from '@xyflow/react'

/**
 * 累积「纯选中」变更批次，供防抖提交到业务 store 时一次性写入。
 *
 * React Flow 的框选是增量下发的：每个指针帧只发这一帧里 selected 真的翻转的那些节点
 * （见 getSelectionChanges 对上一帧集合做 diff）。因此把缓冲区直接赋值成最新那批
 * （而不是累积）会只留下最后一帧的增量——框中的其他节点永远不会带着 selected:true
 * 进业务 store，画布视觉（React Flow 内部 store 是逐批累积的）与业务 store 就此分叉，
 * AI 对话面板等读业务 store 的消费方拿到的是残缺选中集。
 *
 * 同一节点后来的变更覆盖先前的（最后一次才是它的终态），首次出现的顺序保持不变。
 */
export function accumulateSelectionChanges(
  pending: readonly NodeChange<Node>[],
  incoming: readonly NodeChange<Node>[],
): NodeChange<Node>[] {
  if (!pending.length) return [...incoming]

  const merged = [...pending]
  const indexById = new Map<string, number>()
  merged.forEach((change, index) => {
    const id = (change as { id?: unknown }).id
    if (typeof id === 'string') indexById.set(id, index)
  })

  for (const change of incoming) {
    const id = (change as { id?: unknown }).id
    if (typeof id !== 'string') {
      merged.push(change)
      continue
    }
    const existing = indexById.get(id)
    if (existing === undefined) {
      indexById.set(id, merged.length)
      merged.push(change)
      continue
    }
    merged[existing] = change
  }

  return merged
}
