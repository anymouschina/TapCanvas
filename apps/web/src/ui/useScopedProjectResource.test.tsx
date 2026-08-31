import React from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useScopedProjectResource } from './useScopedProjectResource'

type Item = {
  id: string
}

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason: unknown) => void
}

const deferred = <T,>(): Deferred<T> => {
  let resolvePromise: (value: T) => void = () => undefined
  let rejectPromise: (reason: unknown) => void = () => undefined
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })
  return {
    promise,
    resolve: resolvePromise,
    reject: rejectPromise,
  }
}

describe('useScopedProjectResource', () => {
  it('collapses the same in-flight load during StrictMode effect replay', async () => {
    const request = deferred<readonly Item[]>()
    const load = vi.fn(() => request.promise)
    const wrapper = ({ children }: React.PropsWithChildren): JSX.Element => (
      <React.StrictMode>{children}</React.StrictMode>
    )

    const { result } = renderHook(() => useScopedProjectResource<Item>({
      enabled: true,
      projectId: 'project-a',
      load,
      invalidResponseMessage: '目录响应无效',
    }), { wrapper })

    await waitFor(() => expect(load).toHaveBeenCalledTimes(1))
    await act(async () => {
      request.resolve([{ id: 'book-1' }])
      await request.promise
    })
    await waitFor(() => expect(result.current.items).toEqual([{ id: 'book-1' }]))
    expect(result.current.status).toBe('ready')
  })

  it('ignores an older project response that resolves after the current project', async () => {
    const projectA = deferred<readonly Item[]>()
    const projectB = deferred<readonly Item[]>()
    const load = vi.fn((projectId: string) => (
      projectId === 'project-a' ? projectA.promise : projectB.promise
    ))

    const { result, rerender } = renderHook(
      ({ projectId }: { projectId: string }) => useScopedProjectResource<Item>({
        enabled: true,
        projectId,
        load,
        invalidResponseMessage: '目录响应无效',
      }),
      { initialProps: { projectId: 'project-a' } },
    )

    await waitFor(() => expect(load).toHaveBeenCalledWith('project-a'))
    rerender({ projectId: 'project-b' })
    await waitFor(() => expect(load).toHaveBeenCalledWith('project-b'))

    await act(async () => {
      projectB.resolve([{ id: 'book-b' }])
      await projectB.promise
    })
    await waitFor(() => expect(result.current.items).toEqual([{ id: 'book-b' }]))

    await act(async () => {
      projectA.resolve([{ id: 'book-a' }])
      await projectA.promise
    })
    expect(result.current.items).toEqual([{ id: 'book-b' }])
    expect(result.current.status).toBe('ready')
  })

  it('keeps the last confirmed items when a same-project refresh fails', async () => {
    const load = vi.fn((_projectId: string): Promise<readonly Item[]> => Promise.resolve([]))
      .mockResolvedValueOnce([{ id: 'book-1' }])
      .mockRejectedValueOnce(new Error('network offline'))
      .mockResolvedValueOnce([{ id: 'book-1' }, { id: 'book-2' }])

    const { result } = renderHook(() => useScopedProjectResource<Item>({
      enabled: true,
      projectId: 'project-a',
      load,
      invalidResponseMessage: '目录响应无效',
    }))

    await waitFor(() => expect(result.current.items).toEqual([{ id: 'book-1' }]))

    await act(async () => {
      await result.current.reload().catch(() => undefined)
    })
    expect(result.current.status).toBe('error')
    expect(result.current.error).toBe('network offline')
    expect(result.current.items).toEqual([{ id: 'book-1' }])

    await act(async () => {
      await result.current.reload()
    })
    expect(result.current.status).toBe('ready')
    expect(result.current.error).toBeNull()
    expect(result.current.items).toEqual([{ id: 'book-1' }, { id: 'book-2' }])
  })

  it('treats an invalid response as an error instead of an empty directory', async () => {
    const load = vi.fn(() => Promise.resolve(null as unknown as readonly Item[]))
    const { result } = renderHook(() => useScopedProjectResource<Item>({
      enabled: true,
      projectId: 'project-a',
      load,
      invalidResponseMessage: '目录响应无效',
    }))

    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.error).toBe('目录响应无效')
    expect(result.current.items).toEqual([])
  })
})
