type IdentifiedItem = { id?: unknown }

export type CanvasFlowSnapshot<N extends IdentifiedItem, E extends IdentifiedItem> = {
  nodes: N[]
  edges: E[]
  viewport?: { x: number; y: number; zoom: number } | null
  sceneCreationProgress?: unknown
}

function itemId(item: IdentifiedItem): string {
  return String(item.id ?? '')
}

function structurallyEqual(left: unknown, right: unknown): boolean {
  return left === right || JSON.stringify(left) === JSON.stringify(right)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Three-way value merge. Unchanged local fields accept the server value;
 * unchanged server fields accept the local value. Concurrent object edits are
 * resolved recursively, while a true same-leaf conflict keeps the current
 * user's local edit.
 */
export function rebaseValue(base: unknown, local: unknown, server: unknown): unknown {
  if (structurallyEqual(local, base)) return server
  if (structurallyEqual(server, base) || structurallyEqual(local, server)) return local

  if (!isRecord(base) || !isRecord(local) || !isRecord(server)) return local

  const keys = new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(server)])
  const merged: Record<string, unknown> = {}
  for (const key of keys) {
    const baseHas = Object.prototype.hasOwnProperty.call(base, key)
    const localHas = Object.prototype.hasOwnProperty.call(local, key)
    const serverHas = Object.prototype.hasOwnProperty.call(server, key)

    if (!localHas && baseHas) continue
    if (!serverHas && baseHas && localHas && structurallyEqual(local[key], base[key])) continue
    if (!baseHas && !localHas && serverHas) {
      merged[key] = server[key]
      continue
    }
    if (!baseHas && localHas && !serverHas) {
      merged[key] = local[key]
      continue
    }
    if (!baseHas && localHas && serverHas) {
      merged[key] = rebaseValue(undefined, local[key], server[key])
      continue
    }
    if (localHas && serverHas) merged[key] = rebaseValue(base[key], local[key], server[key])
  }
  return merged
}

function rebaseItems<T extends IdentifiedItem>(base: T[], local: T[], server: T[]): T[] {
  const baseById = new Map(base.map((item) => [itemId(item), item]))
  const localById = new Map(local.map((item) => [itemId(item), item]))
  const resultById = new Map(server.map((item) => [itemId(item), item]))

  for (const [id, baseItem] of baseById) {
    const localItem = localById.get(id)
    const serverItem = resultById.get(id)
    if (!localItem) {
      resultById.delete(id)
      continue
    }
    if (!serverItem) {
      if (!structurallyEqual(localItem, baseItem)) resultById.set(id, localItem)
      continue
    }
    resultById.set(id, rebaseValue(baseItem, localItem, serverItem) as T)
  }

  for (const [id, localItem] of localById) {
    if (!baseById.has(id)) {
      const serverItem = resultById.get(id)
      resultById.set(id, serverItem ? rebaseValue(undefined, localItem, serverItem) as T : localItem)
    }
  }

  return [...resultById.values()]
}

export function rebaseCanvasFlowOnConflict<
  N extends IdentifiedItem,
  E extends IdentifiedItem & { source?: unknown; target?: unknown },
>(input: {
  base: CanvasFlowSnapshot<N, E>
  local: CanvasFlowSnapshot<N, E>
  server: CanvasFlowSnapshot<N, E>
}): CanvasFlowSnapshot<N, E> {
  const nodes = rebaseItems(input.base.nodes, input.local.nodes, input.server.nodes)
  const survivingNodeIds = new Set(nodes.map(itemId))
  const edges = rebaseItems(input.base.edges, input.local.edges, input.server.edges)
    .filter((edge) => survivingNodeIds.has(String(edge.source ?? '')) && survivingNodeIds.has(String(edge.target ?? '')))

  return {
    nodes,
    edges,
    viewport: rebaseValue(input.base.viewport, input.local.viewport, input.server.viewport) as CanvasFlowSnapshot<N, E>['viewport'],
    sceneCreationProgress: rebaseValue(
      input.base.sceneCreationProgress,
      input.local.sceneCreationProgress,
      input.server.sceneCreationProgress,
    ),
  }
}

