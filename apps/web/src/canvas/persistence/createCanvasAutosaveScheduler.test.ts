import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCanvasAutosaveScheduler, type CanvasAutosaveEligibility } from './createCanvasAutosaveScheduler'
import { createCanvasSaveCoordinator } from './createCanvasSaveCoordinator'

const deferred = <T,>() => {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

type SchedulerEvent = Parameters<Parameters<typeof createCanvasAutosaveScheduler<number>>[0]['report']>[0]

describe('createCanvasAutosaveScheduler', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('collapses a burst of revisions into one save after the quiet period', async () => {
    const save = vi.fn(async () => true)
    const scheduler = createCanvasAutosaveScheduler<number>({
      delayMs: 800,
      eligibility: () => 'ready',
      save,
      report: () => undefined,
    })

    scheduler.request(1, 1)
    await vi.advanceTimersByTimeAsync(500)
    scheduler.request(1, 2)
    await vi.advanceTimersByTimeAsync(500)
    expect(save).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(300)
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith(1)
  })

  it.each<CanvasAutosaveEligibility>(['clean', 'hydrating', 'session_changed'])(
    'does not save and reports why when the canvas is %s',
    async (reason) => {
      const save = vi.fn(async () => true)
      const events: SchedulerEvent[] = []
      const scheduler = createCanvasAutosaveScheduler<number>({
        delayMs: 800,
        eligibility: () => reason,
        save,
        report: (event) => events.push(event),
      })

      scheduler.request(3, 7)
      await vi.advanceTimersByTimeAsync(800)

      expect(save).not.toHaveBeenCalled()
      expect(events).toEqual([{ phase: 'skipped', session: 3, targetRevision: 7, reason }])
    },
  )

  it('reports a rejected save instead of leaving an unhandled rejection', async () => {
    const events: SchedulerEvent[] = []
    const scheduler = createCanvasAutosaveScheduler<number>({
      delayMs: 100,
      eligibility: () => 'ready',
      save: async () => { throw new Error('network down') },
      report: (event) => events.push(event),
    })

    scheduler.request(1, 1)
    await vi.advanceTimersByTimeAsync(100)

    expect(events.map((event) => event.phase)).toEqual(['started', 'failed'])
    expect(events[1]).toMatchObject({ error: 'network down' })
  })

  it('cancels a pending save and ignores later requests once disposed', async () => {
    const save = vi.fn(async () => true)
    const scheduler = createCanvasAutosaveScheduler<number>({
      delayMs: 800,
      eligibility: () => 'ready',
      save,
      report: () => undefined,
    })

    scheduler.request(1, 1)
    scheduler.dispose()
    scheduler.request(1, 2)
    await vi.advanceTimersByTimeAsync(2000)

    expect(save).not.toHaveBeenCalled()
  })
})

describe('autosave scheduler with the save coordinator', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  /** Mirrors App.tsx: dirty stays true when the canvas changed after the saved snapshot was read. */
  function mountCanvas() {
    let revision = 1
    let dirty = true
    let active = 0
    let maxActive = 0
    const savedRevisions: number[] = []
    const firstSaveGate = deferred<void>()
    const events: SchedulerEvent[] = []
    const coordinator = createCanvasSaveCoordinator<number>({ readCurrentRevision: () => revision })

    const saveOnce = async () => {
      const captured = revision
      active += 1
      maxActive = Math.max(maxActive, active)
      if (savedRevisions.length === 0) await firstSaveGate.promise
      savedRevisions.push(captured)
      dirty = revision !== captured
      active -= 1
      return { success: true, savedRevision: captured }
    }
    const scheduler = createCanvasAutosaveScheduler<number>({
      delayMs: 800,
      eligibility: () => (dirty ? 'ready' : 'clean'),
      save: (session) => coordinator.save(session, revision, saveOnce),
      report: (event) => events.push(event),
    })
    return {
      scheduler,
      coordinator,
      saveOnce,
      events,
      savedRevisions,
      firstSaveGate,
      edit: () => {
        revision += 1
        dirty = true
        scheduler.request(0, revision)
      },
      get maxActive() { return maxActive },
    }
  }

  it('saves an edit made during an in-flight save without waiting for another trigger', async () => {
    const canvas = mountCanvas()

    canvas.scheduler.request(0, 1)
    await vi.advanceTimersByTimeAsync(800)
    expect(canvas.savedRevisions).toEqual([])

    canvas.edit()
    canvas.firstSaveGate.resolve()
    // Only microtasks run here: the follow-up save comes from the coordinator, not from the 800ms timer.
    await vi.advanceTimersByTimeAsync(0)
    expect(canvas.savedRevisions).toEqual([1, 2])

    await vi.advanceTimersByTimeAsync(800)
    expect(canvas.savedRevisions).toEqual([1, 2])
    expect(canvas.events.at(-1)).toMatchObject({ phase: 'skipped', reason: 'clean' })
  })

  it('never runs two saves at once when an explicit save overlaps the autosave', async () => {
    const canvas = mountCanvas()

    canvas.scheduler.request(0, 1)
    await vi.advanceTimersByTimeAsync(800)
    const explicit = canvas.coordinator.save(0, 1, canvas.saveOnce)
    canvas.firstSaveGate.resolve()

    await expect(explicit).resolves.toBe(true)
    expect(canvas.maxActive).toBe(1)
  })
})
