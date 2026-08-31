export type TodoLifecycleStatus = 'pending' | 'in_progress' | 'completed'

export interface TodoLifecycleItem {
  status: TodoLifecycleStatus
  content: string
}

/**
 * 对话流进入任意终态时，把仍停在 in_progress 的任务降级为 pending，停掉 spinner。
 *
 * 中断 ≠ 完成：不能像工具步骤那样乐观判成 succeeded(✓)，否则会谎报任务已做完。
 * completed / pending 原样保留。无 in_progress 时返回原引用（避免无谓重渲染）。
 *
 * 背景：SSE 中断、服务端报错，或最终 result 先于某个步骤终态到达时，若不收口快照，
 * in_progress 会永久转圈。终态缺失不能推断 completed，只能退回 pending 等待真实证据。
 */
export function terminalizeOpenTodos<T extends TodoLifecycleItem>(items: T[]): T[]
export function terminalizeOpenTodos<T extends TodoLifecycleItem>(
  items: T[] | undefined | null,
): T[] | undefined | null
export function terminalizeOpenTodos<T extends TodoLifecycleItem>(
  items: T[] | undefined | null,
): T[] | undefined | null {
  if (!Array.isArray(items) || items.length === 0) return items
  let changed = false
  const next = items.map((item) => {
    if (item.status === 'in_progress') {
      changed = true
      return { ...item, status: 'pending' as const }
    }
    return item
  })
  return changed ? next : items
}

export const terminalizeInterruptedTodos = terminalizeOpenTodos
