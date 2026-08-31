import type { CharacterMotion, LocomotionTrack } from './characterMotion'
import type { GroundPath } from './groundPath'
import type { PoseMap } from './pose'
import type { Vec2 } from '../types'

const DEFAULT_DURATION = 2

export function ensureMotion(m: CharacterMotion | undefined): CharacterMotion {
  return m ?? { durationSeconds: DEFAULT_DURATION }
}
export function clearMotion(): undefined {
  return undefined
}
export function setDuration(m: CharacterMotion | undefined, seconds: number): CharacterMotion {
  const base = ensureMotion(m)
  return { ...base, durationSeconds: Math.max(0.5, seconds) }
}

function withLoco(m: CharacterMotion | undefined, patch: Partial<LocomotionTrack>): CharacterMotion {
  const base = ensureMotion(m)
  const loco: LocomotionTrack = { clip: 'walk', ...base.locomotion, ...patch }
  return { ...base, locomotion: loco }
}
export function setLocomotionClip(m: CharacterMotion | undefined, clip: LocomotionTrack['clip']): CharacterMotion {
  return withLoco(m, { clip })
}
export function setSpeed(m: CharacterMotion | undefined, speed: number): CharacterMotion {
  return withLoco(m, { speed })
}
export function clearLocomotion(m: CharacterMotion | undefined): CharacterMotion {
  const base = ensureMotion(m)
  const { locomotion: _drop, ...rest } = base
  void _drop
  return rest
}

function withPath(m: CharacterMotion | undefined, mutate: (p: GroundPath) => GroundPath | undefined): CharacterMotion {
  const base = withLoco(m, {})
  const loco = base.locomotion!
  const cur: GroundPath = loco.path ?? { waypoints: [], mode: 'linear' }
  const next = mutate(cur)
  if (!next || next.waypoints.length === 0) {
    const { path: _p, ...locoRest } = loco
    void _p
    return { ...base, locomotion: locoRest }
  }
  return { ...base, locomotion: { ...loco, path: next } }
}
export function addWaypoint(m: CharacterMotion | undefined, xz: Vec2): CharacterMotion {
  return withPath(m, (p) => ({ ...p, waypoints: [...p.waypoints, [xz[0], xz[1]]] }))
}
export function moveWaypoint(m: CharacterMotion | undefined, i: number, xz: Vec2): CharacterMotion {
  return withPath(m, (p) => ({ ...p, waypoints: p.waypoints.map((w, idx) => (idx === i ? [xz[0], xz[1]] : w)) }))
}
export function removeWaypoint(m: CharacterMotion | undefined, i: number): CharacterMotion {
  return withPath(m, (p) => ({ ...p, waypoints: p.waypoints.filter((_, idx) => idx !== i) }))
}
export function clearWaypoints(m: CharacterMotion | undefined): CharacterMotion {
  return withPath(m, () => undefined)
}
export function setPathMode(m: CharacterMotion | undefined, mode: GroundPath['mode']): CharacterMotion {
  const base = ensureMotion(m)
  if (!base.locomotion?.path) return base
  return { ...base, locomotion: { ...base.locomotion, path: { ...base.locomotion.path, mode } } }
}

export function putPoseKeyframe(m: CharacterMotion | undefined, t: number, pose: PoseMap): CharacterMotion {
  const base = ensureMotion(m)
  const rest = (base.poseTrack ?? []).filter((k) => Math.abs(k.t - t) > 1e-6)
  const next = [...rest, { t, pose: { ...pose } }].sort((a, b) => a.t - b.t)
  return { ...base, poseTrack: next }
}
export function removePoseKeyframeAt(m: CharacterMotion | undefined, t: number): CharacterMotion {
  const base = ensureMotion(m)
  const next = (base.poseTrack ?? []).filter((k) => Math.abs(k.t - t) > 1e-6)
  if (next.length === 0) {
    const { poseTrack: _d, ...r } = base
    void _d
    return r
  }
  return { ...base, poseTrack: next }
}
