import { describe, expect, it, vi } from 'vitest'
import { createCanvasSaveCoordinator, type CanvasSaveAttemptResult } from './createCanvasSaveCoordinator'

const deferred = <T,>() => {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

const successfulSave = (readRevision: (session: string) => number | null) => async (session: string): Promise<CanvasSaveAttemptResult> => ({
  success: true,
  savedRevision: readRevision(session) ?? 0,
})

describe('createCanvasSaveCoordinator', () => {
  it('coalesces concurrent requests for the same revision', async () => {
    let revision = 4
    const firstSave = deferred<CanvasSaveAttemptResult>()
    const saveCurrent = vi.fn(async () => firstSave.promise)
    const coordinator = createCanvasSaveCoordinator({
      readCurrentRevision: () => revision,
    })

    const first = coordinator.save('session-a', revision, saveCurrent)
    const second = coordinator.save('session-a', revision, saveCurrent)
    expect(saveCurrent).toHaveBeenCalledTimes(1)

    firstSave.resolve({ success: true, savedRevision: 4 })
    await expect(Promise.all([first, second])).resolves.toEqual([true, true])
    expect(saveCurrent).toHaveBeenCalledTimes(1)
  })

  it('keeps a newer concurrent caller waiting for its own revision', async () => {
    let revision = 1
    const firstSave = deferred<CanvasSaveAttemptResult>()
    const secondSave = deferred<CanvasSaveAttemptResult>()
    const secondSaveStarted = deferred<void>()
    const saveCurrent = vi.fn()
      .mockImplementationOnce(async () => firstSave.promise)
      .mockImplementationOnce(async () => {
        secondSaveStarted.resolve()
        return secondSave.promise
      })
    const coordinator = createCanvasSaveCoordinator({
      readCurrentRevision: () => revision,
    })

    const first = coordinator.save('session-a', 1, saveCurrent)
    revision = 2
    const second = coordinator.save('session-a', 2, saveCurrent)
    let firstSettled = false
    void first.then(() => { firstSettled = true })
    let secondSettled = false
    void second.then(() => { secondSettled = true })
    firstSave.resolve({ success: true, savedRevision: 1 })
    await secondSaveStarted.promise
    expect(saveCurrent).toHaveBeenCalledTimes(2)
    expect(firstSettled).toBe(false)
    expect(secondSettled).toBe(false)

    secondSave.resolve({ success: true, savedRevision: 2 })
    await expect(Promise.all([first, second])).resolves.toEqual([true, true])
  })

  it('flushes edits made during a save even without a second save request', async () => {
    let revision = 1
    const firstSave = deferred<CanvasSaveAttemptResult>()
    const saveCurrent = vi.fn()
      .mockImplementationOnce(async () => firstSave.promise)
      .mockImplementationOnce(successfulSave(() => revision))
    const coordinator = createCanvasSaveCoordinator({
      readCurrentRevision: () => revision,
    })

    const pending = coordinator.save('session-a', 1, saveCurrent)
    revision = 2
    firstSave.resolve({ success: true, savedRevision: 1 })

    await expect(pending).resolves.toBe(true)
    expect(saveCurrent).toHaveBeenCalledTimes(2)
  })

  it('isolates navigation sessions and never resumes the old session against the new canvas', async () => {
    let currentSession = 'old'
    const revisions = new Map<string, number>([['old', 3], ['new', 1]])
    const oldSave = deferred<CanvasSaveAttemptResult>()
    const saveCurrent = vi.fn()
      .mockImplementationOnce(async () => oldSave.promise)
      .mockImplementation(async (session: string) => ({
        success: true,
        savedRevision: revisions.get(session) ?? 0,
      }))
    const coordinator = createCanvasSaveCoordinator({
      readCurrentRevision: (session) => session === currentSession ? revisions.get(session) ?? null : null,
    })

    const oldPending = coordinator.save('old', 3, saveCurrent)
    currentSession = 'new'
    const newPending = coordinator.save('new', 1, saveCurrent)
    oldSave.resolve({ success: true, savedRevision: 3 })

    await expect(Promise.all([oldPending, newPending])).resolves.toEqual([true, true])
    expect(saveCurrent.mock.calls.map(([session]) => session)).toEqual(['old', 'new'])
  })

  it('returns failure to waiting callers when the active save fails', async () => {
    const coordinator = createCanvasSaveCoordinator({
      readCurrentRevision: () => 1,
    })
    const saveCurrent = vi.fn(async () => ({ success: false, savedRevision: 0 }))

    await expect(coordinator.save('session-a', 1, saveCurrent)).resolves.toBe(false)
    expect(saveCurrent).toHaveBeenCalledTimes(1)
  })
})
