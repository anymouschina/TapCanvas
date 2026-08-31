// Persists last-used model & config per node kind so new nodes get sensible defaults.
const STORAGE_KEY = 'tc_node_model_prefs'

export type NodeModelPrefs = {
  imageModel?: string
  imageSize?: string
  videoModel?: string
  videoResolution?: string
  videoAspect?: string
}

function read(): NodeModelPrefs {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed as NodeModelPrefs
  } catch {
    return {}
  }
}

export function readNodeModelPrefs(): NodeModelPrefs {
  return read()
}

export function saveNodeModelPrefs(patch: Partial<NodeModelPrefs>): void {
  if (typeof window === 'undefined') return
  try {
    const next: NodeModelPrefs = { ...read(), ...patch }
    for (const k of Object.keys(next) as (keyof NodeModelPrefs)[]) {
      if (!next[k]) delete next[k]
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // ignore
  }
}
