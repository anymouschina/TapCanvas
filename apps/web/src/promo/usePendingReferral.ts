import React from 'react'

const STORAGE_KEY = 'tapcanvas:pendingRef'

function readPendingRef(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const v = window.sessionStorage.getItem(STORAGE_KEY)
    return v && /^[A-HJ-NP-Z2-9]{6}$/.test(v) ? v : null
  } catch {
    return null
  }
}

// Lightweight reactive accessor for the captured ?ref=XXX code stashed by
// main.tsx. Subscribes to the session-storage key so consumers re-render when
// the code is captured (or cleared after registration).
export function usePendingReferral(): string | null {
  const [code, setCode] = React.useState<string | null>(() => readPendingRef())

  React.useEffect(() => {
    const refresh = () => setCode(readPendingRef())
    refresh()
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) refresh()
    }
    window.addEventListener('storage', onStorage)
    // sessionStorage doesn't fire 'storage' on the same tab, so also poll once
    // shortly after mount to catch the value written by main.tsx during boot.
    const t = window.setTimeout(refresh, 0)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.clearTimeout(t)
    }
  }, [])

  return code
}
