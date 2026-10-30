export type CanvasSaveAttemptResult = Readonly<{
  savedRevision: number
  success: boolean
}>

export type CanvasSaveCoordinatorOptions<TSession> = Readonly<{
  readCurrentRevision: (session: TSession) => number | null
}>

export type CanvasSaveCurrent<TSession> = (session: TSession) => Promise<CanvasSaveAttemptResult>

type SaveWaiter = {
  targetRevision: number
  resolve: (saved: boolean) => void
}

type SessionQueue<TSession> = {
  session: TSession
  waiters: SaveWaiter[]
}

/**
 * Serializes canvas saves and keeps each caller waiting until its requested
 * revision has been persisted. A revision that changes during a save is read
 * again and saved before the session queue is released.
 */
export const createCanvasSaveCoordinator = <TSession>(
  options: CanvasSaveCoordinatorOptions<TSession>,
): Readonly<{
  save: (
    session: TSession,
    targetRevision: number,
    saveCurrent: CanvasSaveCurrent<TSession>,
  ) => Promise<boolean>
}> => {
  const queuedSessions = new Map<TSession, SaveWaiter[]>()
  let active: SessionQueue<TSession> | null = null

  const settleAll = (waiters: SaveWaiter[], saved: boolean): void => {
    while (waiters.length > 0) {
      const waiter = waiters.pop()
      waiter?.resolve(saved)
    }
  }

  const settleThroughRevision = (waiters: SaveWaiter[], savedRevision: number): void => {
    for (let index = waiters.length - 1; index >= 0; index -= 1) {
      const waiter = waiters[index]
      if (waiter && waiter.targetRevision <= savedRevision) {
        waiters.splice(index, 1)
        waiter.resolve(true)
      }
    }
  }

  const drain = async (
    session: TSession,
    waiters: SaveWaiter[],
    saveCurrent: CanvasSaveCurrent<TSession>,
  ): Promise<void> => {
    let lastSavedRevision = Number.NEGATIVE_INFINITY

    while (true) {
      const currentRevision = options.readCurrentRevision(session)
      if (currentRevision === null) {
        settleAll(waiters, false)
        return
      }

      if (lastSavedRevision >= currentRevision) {
        settleThroughRevision(waiters, lastSavedRevision)
        settleAll(waiters, false)
        return
      }

      let attempt: CanvasSaveAttemptResult
      try {
        attempt = await saveCurrent(session)
      } catch (error: unknown) {
        console.error('[canvas-save-coordinator] save attempt failed', {
          session,
          targetRevision: Math.max(currentRevision, ...waiters.map((waiter) => waiter.targetRevision)),
          error,
        })
        attempt = { savedRevision: lastSavedRevision, success: false }
      }

      if (!attempt.success) {
        settleAll(waiters, false)
        return
      }

      lastSavedRevision = Math.max(lastSavedRevision, attempt.savedRevision)

      const latestRevision = options.readCurrentRevision(session)
      if (latestRevision === null) {
        settleThroughRevision(waiters, lastSavedRevision)
        settleAll(waiters, false)
        return
      }

      if (latestRevision <= lastSavedRevision) {
        settleThroughRevision(waiters, lastSavedRevision)
        settleAll(waiters, false)
        return
      }
    }
  }

  let draining = false
  const queuedSaveCurrent = new Map<TSession, CanvasSaveCurrent<TSession>>()

  const drainQueue = async (): Promise<void> => {
    if (draining) return
    draining = true
    try {
      while (queuedSessions.size > 0) {
        const first = queuedSessions.entries().next().value as [TSession, SaveWaiter[]] | undefined
        if (!first) break
        const [session, waiters] = first
        queuedSessions.delete(session)
        const saveCurrent = queuedSaveCurrent.get(session)
        queuedSaveCurrent.delete(session)
        if (!saveCurrent) {
          settleAll(waiters, false)
          continue
        }
        active = { session, waiters }
        await drain(session, waiters, saveCurrent)
        active = null
      }
    } finally {
      active = null
      draining = false
      if (queuedSessions.size > 0) void drainQueue()
    }
  }

  const save = (
    session: TSession,
    targetRevision: number,
    saveCurrent: CanvasSaveCurrent<TSession>,
  ): Promise<boolean> => new Promise((resolve) => {
    const waiter = { targetRevision, resolve }
    if (active && Object.is(active.session, session)) {
      active.waiters.push(waiter)
      return
    }

    const sessionWaiters = queuedSessions.get(session)
    if (sessionWaiters) sessionWaiters.push(waiter)
    else {
      queuedSessions.set(session, [waiter])
      queuedSaveCurrent.set(session, saveCurrent)
    }
    void drainQueue()
  })

  return { save }
}
