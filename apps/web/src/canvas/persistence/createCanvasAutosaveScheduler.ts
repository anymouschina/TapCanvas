export type CanvasAutosaveEligibility = 'ready' | 'clean' | 'hydrating' | 'session_changed'

/** Content revisions schedule saves independently of React's batched UI flags. */
export function createCanvasAutosaveScheduler<TSession>(options: Readonly<{
  eligibility: (session: TSession) => CanvasAutosaveEligibility
  save: (session: TSession) => Promise<boolean>
  delayMs: number
  report: (event: Readonly<{
    phase: 'started' | 'settled' | 'skipped' | 'failed'
    session: TSession
    targetRevision: number
    reason?: CanvasAutosaveEligibility
    success?: boolean
    error?: string
  }>) => void
}>) {
  let timer: ReturnType<typeof setTimeout> | null = null
  let disposed = false
  return {
    request(session: TSession, targetRevision: number): void {
      if (disposed) return
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        const reason = options.eligibility(session)
        if (reason !== 'ready') {
          options.report({ phase: 'skipped', session, targetRevision, reason })
          return
        }
        options.report({ phase: 'started', session, targetRevision })
        void options.save(session).then((success) => {
          options.report({ phase: 'settled', session, targetRevision, success })
        }).catch((error: unknown) => {
          options.report({ phase: 'failed', session, targetRevision, error: error instanceof Error ? error.message : String(error) })
        })
      }, options.delayMs)
    },
    dispose(): void {
      disposed = true
      if (timer !== null) clearTimeout(timer)
      timer = null
    },
  }
}
