const NAVIGATION_STATE_KEY = '__tapcanvasNavigation'
const NAVIGATION_SESSION_KEY = 'tapcanvas:navigation-session'

interface TapCanvasNavigationState {
  sessionId: string
  index: number
}

type BrowserHistoryState = Record<string, unknown>

function readHistoryState(): BrowserHistoryState {
  const state: unknown = window.history.state
  return state !== null && typeof state === 'object' && !Array.isArray(state)
    ? state as BrowserHistoryState
    : {}
}

function getNavigationSessionId(): string {
  const stored = window.sessionStorage.getItem(NAVIGATION_SESSION_KEY)
  if (stored) return stored
  const created = crypto.randomUUID()
  window.sessionStorage.setItem(NAVIGATION_SESSION_KEY, created)
  return created
}

function readNavigationState(): TapCanvasNavigationState | null {
  const value = readHistoryState()[NAVIGATION_STATE_KEY]
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const sessionId = Reflect.get(value, 'sessionId')
  const index = Reflect.get(value, 'index')
  if (typeof sessionId !== 'string' || typeof index !== 'number' || !Number.isInteger(index) || index < 0) return null
  if (sessionId !== getNavigationSessionId()) return null
  return { sessionId, index }
}

function ensureNavigationState(): TapCanvasNavigationState {
  const current = readNavigationState()
  if (current) return current
  const initial = { sessionId: getNavigationSessionId(), index: 0 }
  window.history.replaceState({ ...readHistoryState(), [NAVIGATION_STATE_KEY]: initial }, '', window.location.href)
  return initial
}

function historyStateAt(index: number): BrowserHistoryState {
  return {
    ...readHistoryState(),
    [NAVIGATION_STATE_KEY]: { sessionId: getNavigationSessionId(), index },
  }
}

export function spaNavigate(to: string) {
  if (typeof window === 'undefined') return
  const next = String(to || '').trim() || '/'
  try {
    const current = ensureNavigationState()
    window.history.pushState(historyStateAt(current.index + 1), '', next)
    // Ensure React re-renders listeners that rely on location.
    window.dispatchEvent(new PopStateEvent('popstate'))
  } catch {
    window.location.href = next
  }
}

export function spaReplace(to: string) {
  if (typeof window === 'undefined') return
  const next = String(to || '').trim() || '/'
  try {
    const current = ensureNavigationState()
    window.history.replaceState(historyStateAt(current.index), '', next)
    window.dispatchEvent(new PopStateEvent('popstate'))
  } catch {
    window.location.replace(next)
  }
}

export function navigateBackOr(to: string) {
  if (typeof window === 'undefined') return
  const current = ensureNavigationState()
  if (current.index > 0) {
    window.history.back()
    return
  }
  spaNavigate(to)
}
