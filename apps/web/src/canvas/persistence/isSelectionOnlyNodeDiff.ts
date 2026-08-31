/**
 * True when two node arrays differ ONLY in per-node `selected` flags.
 *
 * Selection is view state: it is not part of the persisted flow (the server round-trip drops it) and
 * it is not undoable. But selecting a node necessarily replaces that node's object, which changes the
 * `nodes` array identity — and the chapter autosave subscription keys off exactly that identity. So
 * without this guard, clicking a node schedules a whole-graph JSON.stringify + PUT plus an IndexedDB
 * snapshot write, two main-thread stalls landing right after the focused body mounts.
 *
 * Deliberately conservative: any other difference (length, ids, order, or a single non-`selected`
 * key) returns false so the change takes the normal save path. Comparison is shallow per node, which
 * is sound because every store update is immutable — an unchanged node keeps its reference and exits
 * on the first check.
 */
export function isSelectionOnlyNodeDiff(
  prev: readonly unknown[],
  next: readonly unknown[],
): boolean {
  if (prev === next) return true
  if (prev.length !== next.length) return false

  let sawSelectionFlip = false
  for (let index = 0; index < next.length; index += 1) {
    const a = prev[index]
    const b = next[index]
    if (a === b) continue
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false

    const prevNode = a as Record<string, unknown>
    const nextNode = b as Record<string, unknown>
    if (prevNode.id !== nextNode.id) return false

    const keys = new Set([...Object.keys(prevNode), ...Object.keys(nextNode)])
    for (const key of keys) {
      if (prevNode[key] === nextNode[key]) continue
      if (key !== 'selected') return false
      sawSelectionFlip = true
    }
  }

  return sawSelectionFlip
}
