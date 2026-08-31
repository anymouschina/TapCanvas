import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ProjectDirectorySnapshotSchema,
  SaveProjectDirectoryRequestSchema,
  createDefaultProjectDirectoryState,
  type ProjectDirectorySnapshot,
} from '@tapcanvas/project-directory-protocol'

const { loadProjectDirectory, persistProjectDirectory } = vi.hoisted(() => ({
  loadProjectDirectory: vi.fn(),
  persistProjectDirectory: vi.fn(),
}))

vi.mock('./projectDirectoryRepository', () => ({
  loadProjectDirectory,
  persistProjectDirectory,
}))

import { useProjectDirectory } from './useProjectDirectory'

const EMPTY_PROJECTS: Array<{ id: string; name: string }> = []
const INITIAL_UPDATED_AT = '2026-08-01T00:00:00.000Z'

function persistedSnapshot(
  timestamp: number = 1_000,
  updatedAt: string = INITIAL_UPDATED_AT,
): ProjectDirectorySnapshot {
  return ProjectDirectorySnapshotSchema.parse({
    assetId: 'directory-asset-1',
    updatedAt,
    state: createDefaultProjectDirectoryState(timestamp),
  })
}

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolvePromise: ((value: T) => void) | null = null
  let rejectPromise: ((reason: unknown) => void) | null = null
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })
  return {
    promise,
    resolve: (value) => {
      if (!resolvePromise) throw new Error('deferred resolve function is unavailable')
      resolvePromise(value)
    },
    reject: (reason) => {
      if (!rejectPromise) throw new Error('deferred reject function is unavailable')
      rejectPromise(reason)
    },
  }
}

describe('useProjectDirectory', () => {
  const randomUUID = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('crypto', { randomUUID })
    randomUUID
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000001')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000002')
      .mockReturnValue('00000000-0000-4000-8000-000000000003')
    loadProjectDirectory.mockResolvedValue(persistedSnapshot())
    persistProjectDirectory.mockImplementation(async (input: unknown) => {
      const request = SaveProjectDirectoryRequestSchema.parse(input)
      const callNumber = persistProjectDirectory.mock.calls.length
      return ProjectDirectorySnapshotSchema.parse({
        assetId: 'directory-asset-1',
        updatedAt: `2026-08-01T00:00:0${callNumber}.000Z`,
        state: request.state,
      })
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('loads the server snapshot without issuing a fake no-op save', async () => {
    const { result } = renderHook(() => useProjectDirectory('auth-token', EMPTY_PROJECTS))

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.state?.rootId).toBe('root')
    expect(result.current.saving).toBe(false)
    expect(persistProjectDirectory).not.toHaveBeenCalled()
  })

  it('serializes writes and sends the revision returned by the preceding save', async () => {
    const { result } = renderHook(() => useProjectDirectory('auth-token', EMPTY_PROJECTS))
    await waitFor(() => expect(result.current.state).not.toBeNull())

    await act(async () => {
      await Promise.all([
        result.current.createFolder('root', '第一组'),
        result.current.createFolder('root', '第二组'),
      ])
    })

    expect(persistProjectDirectory).toHaveBeenCalledTimes(2)
    const firstRequest = SaveProjectDirectoryRequestSchema.parse(
      persistProjectDirectory.mock.calls[0]?.[0],
    )
    const secondRequest = SaveProjectDirectoryRequestSchema.parse(
      persistProjectDirectory.mock.calls[1]?.[0],
    )
    expect(firstRequest.expectedUpdatedAt).toBe(INITIAL_UPDATED_AT)
    expect(secondRequest.expectedUpdatedAt).toBe('2026-08-01T00:00:01.000Z')
    expect(Object.values(secondRequest.state.nodesById).map((node) => node.name)).toEqual(
      expect.arrayContaining(['第一组', '第二组']),
    )
    expect(result.current.saving).toBe(false)
  })

  it('preserves the optimistic state and blocks further writes after a CAS conflict', async () => {
    const conflict = Object.assign(new Error('另一标签页已更新'), {
      code: 'project_directory_revision_conflict',
    })
    persistProjectDirectory.mockRejectedValue(conflict)
    const { result } = renderHook(() => useProjectDirectory('auth-token', EMPTY_PROJECTS))
    await waitFor(() => expect(result.current.state).not.toBeNull())

    await act(async () => {
      await result.current.createFolder('root', '冲突中的分组').catch(() => undefined)
    })

    expect(result.current.conflicted).toBe(true)
    expect(result.current.error).toContain('另一标签页已更新')
    expect(Object.values(result.current.state?.nodesById ?? {}).some(
      (node) => node.name === '冲突中的分组',
    )).toBe(true)
    const callsBeforeBlockedWrite = persistProjectDirectory.mock.calls.length

    await act(async () => {
      await result.current.createFolder('root', '不应提交').catch(() => undefined)
    })
    expect(persistProjectDirectory).toHaveBeenCalledTimes(callsBeforeBlockedWrite)
  })

  it('reverts optimistic state after a non-conflict persistence failure', async () => {
    persistProjectDirectory.mockRejectedValue(new Error('network offline'))
    const { result } = renderHook(() => useProjectDirectory('auth-token', EMPTY_PROJECTS))
    await waitFor(() => expect(result.current.state).not.toBeNull())

    await act(async () => {
      await result.current.createFolder('root', '无法保存').catch(() => undefined)
    })

    expect(result.current.conflicted).toBe(false)
    expect(result.current.error).toContain('network offline')
    expect(Object.values(result.current.state?.nodesById ?? {}).some(
      (node) => node.name === '无法保存',
    )).toBe(false)
  })

  it('ignores a stale load that resolves after the authentication scope changes', async () => {
    const firstLoad = deferred<ProjectDirectorySnapshot>()
    const secondLoad = deferred<ProjectDirectorySnapshot>()
    loadProjectDirectory
      .mockReset()
      .mockReturnValueOnce(firstLoad.promise)
      .mockReturnValueOnce(secondLoad.promise)

    const { result, rerender } = renderHook(
      ({ token }: { token: string }) => useProjectDirectory(token, EMPTY_PROJECTS),
      { initialProps: { token: 'first-user-token' } },
    )
    rerender({ token: 'second-user-token' })

    await act(async () => {
      secondLoad.resolve(persistedSnapshot(2_000, '2026-08-01T00:00:02.000Z'))
      await secondLoad.promise
    })
    await waitFor(() => expect(result.current.state?.nodesById.root?.updatedAt).toBe(2_000))

    await act(async () => {
      firstLoad.resolve(persistedSnapshot(1_000, INITIAL_UPDATED_AT))
      await firstLoad.promise
    })
    expect(result.current.state?.nodesById.root?.updatedAt).toBe(2_000)
  })
})
