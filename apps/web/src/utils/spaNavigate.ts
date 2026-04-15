export function spaNavigate(to: string) {
  if (typeof window === 'undefined') return
  const next = String(to || '').trim() || '/'
  try {
    window.history.pushState({}, '', next)
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
    window.history.replaceState({}, '', next)
    window.dispatchEvent(new PopStateEvent('popstate'))
  } catch {
    window.location.replace(next)
  }
}

export function navigateBackOr(to: string) {
  if (typeof window === 'undefined') return
  if (window.history.length > 1) {
    window.history.back()
    return
  }
  spaNavigate(to)
}
