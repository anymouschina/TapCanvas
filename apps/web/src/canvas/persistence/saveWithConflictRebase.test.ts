import { describe, expect, it, vi } from 'vitest'
import { saveWithConflictRebase } from './saveWithConflictRebase'

function conflict(): Error & { status: number; code: string } {
  return Object.assign(new Error('conflict'), { status: 409, code: 'flow_revision_conflict' })
}

describe('saveWithConflictRebase', () => {
  it('loads latest, rebases local edits, and retries with the latest revision', async () => {
    const save = vi.fn()
      .mockRejectedValueOnce(conflict())
      .mockImplementationOnce(async (snapshot) => ({ canvasRevision: 8, data: snapshot }))
    const loadLatest = vi.fn().mockResolvedValue({
      canvasRevision: 7,
      data: { nodes: [{ id: 'base' }, { id: 'server' }], edges: [] },
    })

    const result = await saveWithConflictRebase({
      base: { nodes: [{ id: 'base' }], edges: [] },
      local: { nodes: [{ id: 'base' }, { id: 'local' }], edges: [] },
      expectedRevision: 6,
      save,
      loadLatest,
    })

    expect(result.rebased).toBe(true)
    expect(result.snapshot.nodes.map((node) => node.id).sort()).toEqual(['base', 'local', 'server'])
    expect(save).toHaveBeenNthCalledWith(1, expect.any(Object), 6)
    expect(save).toHaveBeenNthCalledWith(2, result.snapshot, 7)
  })

  it('adopts a server-adjusted snapshot even when the revision write succeeds immediately', async () => {
    const local = {
      nodes: [{ id: 'video-run-status', data: { productionState: 'scheduled' } }],
      edges: [],
    }
    const server = {
      nodes: [{ id: 'video-run-status', data: { productionState: 'failed' } }],
      edges: [],
    }
    const result = await saveWithConflictRebase({
      base: local,
      local,
      expectedRevision: 10,
      save: vi.fn().mockResolvedValue({ canvasRevision: 11, data: server }),
      loadLatest: vi.fn(),
    })

    expect(result.rebased).toBe(true)
    expect(result.snapshot).toEqual(server)
  })

  it('retains the submitted snapshot when a compact save receipt reports no adjustment', async () => {
    const local = { nodes: [{ id: 'local' }], edges: [] }
    const loadLatest = vi.fn()
    const result = await saveWithConflictRebase({
      base: local,
      local,
      expectedRevision: 3,
      save: vi.fn().mockResolvedValue({ canvasRevision: 4, dataAdjusted: false }),
      loadLatest,
    })

    expect(result.snapshot).toBe(local)
    expect(result.rebased).toBe(false)
    expect(loadLatest).not.toHaveBeenCalled()
  })

  it('re-reads only when a compact save receipt reports a server adjustment', async () => {
    const local = { nodes: [{ id: 'local' }], edges: [] }
    const server = { nodes: [{ id: 'server-managed' }], edges: [] }
    const loadLatest = vi.fn().mockResolvedValue({ canvasRevision: 5, data: server })
    const result = await saveWithConflictRebase({
      base: local,
      local,
      expectedRevision: 3,
      save: vi.fn().mockResolvedValue({ canvasRevision: 4, dataAdjusted: true }),
      loadLatest,
    })

    expect(result.snapshot).toEqual(server)
    expect(result.rebased).toBe(true)
    expect(loadLatest).toHaveBeenCalledTimes(1)
  })

  it('does not hide a non-conflict save failure', async () => {
    const failure = new Error('storage unavailable')
    await expect(saveWithConflictRebase({
      base: { nodes: [], edges: [] },
      local: { nodes: [], edges: [] },
      expectedRevision: 0,
      save: vi.fn().mockRejectedValue(failure),
      loadLatest: vi.fn(),
    })).rejects.toBe(failure)
  })
})
