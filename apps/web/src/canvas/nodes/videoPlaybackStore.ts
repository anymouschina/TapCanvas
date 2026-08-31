// Shared, imperative recovery state for canvas video nodes, keyed by retained node+source identity.
// Focus transitions hand playback to a fresh native video surface because Chromium can lose the
// picture compositor when a source-bound element changes hosts. This record preserves time/play/frame
// state for that handoff as well as offscreen release and later virtualization recovery. Manual
// playback intent is retained separately from transient hover preview playback so pointer/focus
// changes do not unexpectedly stop an action the user explicitly started.
export type PlaybackState = {
  time: number
  playing: boolean
  hasFrame: boolean
  /** True when the current playback was explicitly started by the user. */
  manualPlayback: boolean
}

const store = new Map<string, PlaybackState>()

export function saveVideoPlayback(key: string | null | undefined, state: PlaybackState): void {
  if (!key) return
  store.set(key, state)
}

export function readVideoPlayback(key: string | null | undefined): PlaybackState | undefined {
  if (!key) return undefined
  return store.get(key)
}
