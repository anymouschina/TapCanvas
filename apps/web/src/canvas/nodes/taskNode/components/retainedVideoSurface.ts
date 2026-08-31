const MAX_RETAINED_VIDEO_SURFACES = 6
const DEFAULT_VIDEO_PIXEL_COST = 1920 * 1080
const MAX_RETAINED_VIDEO_PIXELS = DEFAULT_VIDEO_PIXEL_COST * MAX_RETAINED_VIDEO_SURFACES

type RetainedVideoSurfaceEntry = {
  key: string
  element: HTMLVideoElement
  ownerToken: symbol | null
  releaseVersion: number
  hasFrame: boolean
  focused: boolean
  lastUsed: number
  pixelCost: number
  onEvicted: (() => void) | null
}

export type RetainedVideoSurfaceLease = {
  element: HTMLVideoElement
  hasFrame: boolean
  handoff: RetainedVideoPlaybackHandoff | null
  release: () => void
}

export type RetainedVideoPlaybackHandoff = {
  currentTime: number
  playing: boolean
  manualPlayback: boolean
}

const entriesByKey = new Map<string, RetainedVideoSurfaceEntry>()
const entriesByElement = new WeakMap<HTMLVideoElement, RetainedVideoSurfaceEntry>()
const decoderEntries = new Set<RetainedVideoSurfaceEntry>()
let usageSequence = 0

function createVideoElement(): HTMLVideoElement {
  const element = document.createElement('video')
  element.className = 'tc-task-node__skeleton-thumb tc-task-node__video-player'
  element.preload = 'metadata'
  element.loop = true
  element.playsInline = true
  element.setAttribute('aria-hidden', 'true')
  element.style.position = 'absolute'
  element.style.inset = '0'
  element.style.width = '100%'
  element.style.height = '100%'
  element.style.display = 'block'
  element.style.objectFit = 'contain'
  element.style.opacity = '0'
  element.style.pointerEvents = 'none'
  return element
}

function readCurrentTime(element: HTMLVideoElement): number {
  return Number.isFinite(element.currentTime) && element.currentTime > 0
    ? element.currentTime
    : 0
}

function replaceSourceBoundElementForHost(
  entry: RetainedVideoSurfaceEntry,
  host: HTMLElement,
): RetainedVideoPlaybackHandoff | null {
  const previous = entry.element
  if (previous.parentElement === host || !previous.hasAttribute('src')) return null

  const handoff = {
    currentTime: readCurrentTime(previous),
    playing: !previous.paused,
    manualPlayback: previous.dataset.tcManualPlayback === '1',
  }
  const source = previous.getAttribute('src')
  const replacement = createVideoElement()
  replacement.muted = previous.muted
  replacement.defaultMuted = previous.defaultMuted
  replacement.volume = previous.volume
  replacement.playbackRate = previous.playbackRate
  if (previous.dataset.tcUnmuted) replacement.dataset.tcUnmuted = previous.dataset.tcUnmuted
  if (previous.dataset.tcManualPlayback) replacement.dataset.tcManualPlayback = previous.dataset.tcManualPlayback
  if (source) replacement.setAttribute('src', source)

  try {
    previous.pause()
  } catch {
    // The detached compositor surface may already have stopped itself.
  }
  previous.remove()
  entriesByElement.delete(previous)
  decoderEntries.delete(entry)
  entry.element = replacement
  entry.hasFrame = false
  entriesByElement.set(replacement, entry)
  host.appendChild(replacement)
  return handoff
}

function requireEntry(element: HTMLVideoElement): RetainedVideoSurfaceEntry {
  const entry = entriesByElement.get(element)
  if (!entry) throw new Error('Retained video surface is not registered')
  return entry
}

function releaseEntrySource(
  entry: RetainedVideoSurfaceEntry,
  reload: boolean,
  notifyOwner: boolean,
): void {
  // Let the active owner persist currentTime before removeAttribute/load resets
  // the media timeline. The callback is still an eviction notification; source
  // release proceeds unconditionally after it returns.
  if (notifyOwner) entry.onEvicted?.()
  try {
    entry.element.pause()
  } catch {
    // A detached browser media element may already have disposed its decoder.
  }
  entry.element.removeAttribute('src')
  if (reload) {
    try {
      entry.element.load()
    } catch {
      // Removing src is sufficient once the browser has already disposed it.
    }
  }
  entry.hasFrame = false
  decoderEntries.delete(entry)
}

function disposeEntry(entry: RetainedVideoSurfaceEntry): void {
  entry.releaseVersion += 1
  releaseEntrySource(entry, true, false)
  entry.element.remove()
  entriesByElement.delete(entry.element)
  if (entriesByKey.get(entry.key) === entry) entriesByKey.delete(entry.key)
}

function exceedsDecoderBudget(): boolean {
  if (decoderEntries.size > MAX_RETAINED_VIDEO_SURFACES) return true
  let totalPixels = 0
  decoderEntries.forEach((entry) => {
    totalPixels += entry.pixelCost
  })
  return totalPixels > MAX_RETAINED_VIDEO_PIXELS
}

function enforceDecoderBudget(protectedEntry: RetainedVideoSurfaceEntry): void {
  if (!exceedsDecoderBudget()) return
  const candidates = Array.from(decoderEntries)
    .filter((entry) => entry !== protectedEntry && !entry.focused)
    .sort((left, right) => left.lastUsed - right.lastUsed)

  for (const candidate of candidates) {
    if (!exceedsDecoderBudget()) break
    releaseEntrySource(candidate, true, true)
  }
}

export function buildRetainedVideoSurfaceKey(nodeId: string | undefined, src: string): string {
  return `${nodeId?.trim() || 'source'}::${src}`
}

export function readRetainedVideoSurfaceFrame(key: string): boolean {
  return entriesByKey.get(key)?.hasFrame === true
}

export type RetainedVideoPlaybackSnapshot = {
  currentTime: number
  duration: number | null
}

export function readRetainedVideoPlaybackSnapshot(key: string): RetainedVideoPlaybackSnapshot | null {
  const element = entriesByKey.get(key)?.element
  if (!element) return null
  return {
    currentTime: Number.isFinite(element.currentTime) && element.currentTime >= 0 ? element.currentTime : 0,
    duration: Number.isFinite(element.duration) && element.duration > 0 ? element.duration : null,
  }
}

export function acquireRetainedVideoSurface(
  key: string,
  host: HTMLElement,
  onEvicted: () => void,
): RetainedVideoSurfaceLease {
  let entry = entriesByKey.get(key)
  if (!entry) {
    const element = createVideoElement()
    entry = {
      key,
      element,
      ownerToken: null,
      releaseVersion: 0,
      hasFrame: false,
      focused: false,
      lastUsed: ++usageSequence,
      pixelCost: DEFAULT_VIDEO_PIXEL_COST,
      onEvicted: null,
    }
    entriesByKey.set(key, entry)
    entriesByElement.set(element, entry)
  }

  // Moving a source-bound <video> between the lightweight shell and focused
  // editor keeps audio/timeline alive in Chromium, but its native compositor
  // layer can remain attached to the old tree and render permanently blank.
  // Preserve playback state, then give the new host a fresh media element so
  // audio and picture always belong to the same DOM surface.
  const handoff = replaceSourceBoundElementForHost(entry, host)
  const ownerToken = Symbol(key)
  entry.ownerToken = ownerToken
  entry.releaseVersion += 1
  entry.onEvicted = onEvicted
  host.appendChild(entry.element)

  return {
    element: entry.element,
    hasFrame: entry.hasFrame,
    handoff,
    release: () => {
      if (entry?.ownerToken !== ownerToken) return
      entry.ownerToken = null
      entry.onEvicted = null
      entry.focused = false
      const releaseVersion = ++entry.releaseVersion
      queueMicrotask(() => {
        if (!entry || entry.ownerToken !== null || entry.releaseVersion !== releaseVersion) return
        disposeEntry(entry)
      })
    },
  }
}

export function bindRetainedVideoSource(element: HTMLVideoElement, src: string): boolean {
  const entry = requireEntry(element)
  if (element.getAttribute('src') === src) return false
  if (element.hasAttribute('src')) releaseEntrySource(entry, true, true)
  entry.hasFrame = false
  element.setAttribute('src', src)
  return true
}

export function claimRetainedVideoDecoder(element: HTMLVideoElement): void {
  const entry = requireEntry(element)
  entry.lastUsed = ++usageSequence
  decoderEntries.add(entry)
  enforceDecoderBudget(entry)
}

export function touchRetainedVideoDecoder(element: HTMLVideoElement): void {
  const entry = requireEntry(element)
  if (!decoderEntries.has(entry)) return
  entry.lastUsed = ++usageSequence
}

export function setRetainedVideoSurfaceFocused(element: HTMLVideoElement, focused: boolean): void {
  requireEntry(element).focused = focused
}

export function setRetainedVideoSurfaceFrame(element: HTMLVideoElement, hasFrame: boolean): void {
  requireEntry(element).hasFrame = hasFrame
}

export function updateRetainedVideoSurfaceDimensions(
  element: HTMLVideoElement,
  width: number,
  height: number,
): void {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return
  const entry = requireEntry(element)
  entry.pixelCost = Math.max(1, Math.round(width) * Math.round(height))
  if (decoderEntries.has(entry)) enforceDecoderBudget(entry)
}

export function disposeAllRetainedVideoSurfaces(): void {
  Array.from(entriesByKey.values()).forEach(disposeEntry)
  decoderEntries.clear()
}
