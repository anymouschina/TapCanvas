import type { CanvasFlowSnapshot } from './flowConflictRebase'
import { rebaseCanvasFlowOnConflict } from './flowConflictRebase'

type IdentifiedNode = { id?: unknown }
type IdentifiedEdge = IdentifiedNode & { source?: unknown; target?: unknown }

export type RevisionedFlow<T> = {
  canvasRevision?: number
  data: T
}

export type RevisionedSaveReceipt<T> = {
  canvasRevision?: number
  data?: T
  dataAdjusted?: boolean
}

export function isFlowRevisionConflict(error: unknown): boolean {
  const candidate = error as { status?: unknown; code?: unknown } | null
  return candidate?.status === 409 || candidate?.code === 'flow_revision_conflict'
}

export async function saveWithConflictRebase<
  N extends IdentifiedNode,
  E extends IdentifiedEdge,
  S extends RevisionedSaveReceipt<CanvasFlowSnapshot<N, E>>,
  L extends RevisionedFlow<CanvasFlowSnapshot<N, E>>,
>(input: {
  base: CanvasFlowSnapshot<N, E>
  local: CanvasFlowSnapshot<N, E>
  expectedRevision: number
  save: (snapshot: CanvasFlowSnapshot<N, E>, expectedRevision: number) => Promise<S>
  loadLatest: () => Promise<L>
  maxAttempts?: number
}): Promise<{ flow: S; snapshot: CanvasFlowSnapshot<N, E>; rebased: boolean }> {
  const maxAttempts = Math.max(1, input.maxAttempts ?? 4)
  let snapshot = input.local
  let expectedRevision = input.expectedRevision
  let rebased = false
  let lastConflict: unknown = null

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const flow = await input.save(snapshot, expectedRevision)
      const serverSnapshot = typeof flow.data !== 'undefined'
        ? flow.data
        : flow.dataAdjusted
          ? (await input.loadLatest()).data
          : snapshot
      const serverAdjusted = JSON.stringify(serverSnapshot) !== JSON.stringify(snapshot)
      return { flow, snapshot: serverSnapshot, rebased: rebased || serverAdjusted }
    } catch (error: unknown) {
      if (!isFlowRevisionConflict(error)) throw error
      lastConflict = error
      if (attempt === maxAttempts - 1) break

      const latest = await input.loadLatest()
      snapshot = rebaseCanvasFlowOnConflict({
        base: input.base,
        local: input.local,
        server: latest.data,
      })
      expectedRevision = latest.canvasRevision ?? 0
      rebased = true
    }
  }

  const error = new Error(`Canvas save conflict did not converge after ${maxAttempts} attempts`)
  error.name = 'FlowConflictResolutionError'
  ;(error as Error & { cause?: unknown }).cause = lastConflict
  throw error
}
