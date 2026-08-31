// 【全局时间线 / 多镜头(shot)序列】导演台动画化的骨架层。
//
// 对标参考视频底部「镜头1-N」多轨时间线：把多个 shot 顺序排在一条全局时间线上，每个 shot 绑定
// 一个相机 + 一段相机运动 + 时长。播放时全局时钟推进 → sampleTimelineAt 找到当前 shot、算出该镜头
// 局部时间下的相机机位与所有角色状态。纯函数、无 IO、可单测；相机/角色采样复用已有 clipAnimation。
//
// 设计要点：shot 是「ClipAnimation 的一个顺序片段」——相机运动有三态（静态机位 / 环绕 orbit /
// 录制轨道 recorded），角色运动复用 scene.characters[].motion（在 shot 局部时间下采样）。

import type { CameraObj, DirectorScene, Vec3 } from '../types'
import {
  sampleOrbitCamera,
  sampleTrack,
  sampleAnimationAt,
  type CameraOrbit,
  type CameraTracks,
  type SampledCamera,
  type SampledCharacter,
  type ClipAnimation,
} from '../scene/clipAnimation'
import { samplePathAt } from './groundPath'
import { concatMotionPresets } from './motionPresets'

/** 一个镜头的相机运动：静态机位 / 环绕弧线 / 录制关键帧轨道 / 绘制的相机路径(读该镜头机位的 camera.path)。 */
export type ShotCameraMove =
  | { kind: 'static' }
  | { kind: 'orbit'; orbit: CameraOrbit }
  | { kind: 'recorded'; tracks: CameraTracks }
  | { kind: 'path' }

/** 一个镜头：时间线上的一段，绑定相机 + 相机运动 + 时长。 */
export type Shot = {
  id: string
  name: string
  /** 本镜头内容时长（秒）。全局时间线总长 = 各 shot 时长之和。 */
  durationSeconds: number
  /** 该镜头使用的场景相机 id（POV 来源）；缺省用 scene.activeCameraId / 第一个相机。 */
  cameraId?: string
  /** 相机运动；缺省视为 static。 */
  cameraMove?: ShotCameraMove
  /** 预览播放倍速（仅影响 wall-clock 推进速度，不改内容时长）；默认 1。 */
  speed?: number
}

export type SceneTimeline = {
  shots: Shot[]
}

export type ActiveShot = { shot: Shot; index: number; localT: number; shotStart: number }

export type SampledTimelineFrame = {
  shotId: string | null
  shotIndex: number
  /** 当前镜头局部时间（秒）。 */
  localT: number
  /** 当前激活相机的机位（无可用相机时为 null）。 */
  camera: SampledCamera | null
  /** 激活相机的 id。 */
  cameraId: string | null
  /** 所有角色在该帧的采样状态（复用 clipAnimation 的角色合成）。 */
  characters: Record<string, SampledCharacter>
}

const EMPTY_TIMELINE: SceneTimeline = { shots: [] }

export function ensureTimeline(tl: SceneTimeline | undefined | null): SceneTimeline {
  return tl && Array.isArray(tl.shots) ? tl : EMPTY_TIMELINE
}

/** 全局时间线总时长（各 shot 内容时长之和；至少 0）。 */
export function timelineDuration(tl: SceneTimeline | undefined | null): number {
  const t = ensureTimeline(tl)
  return t.shots.reduce((sum, s) => sum + Math.max(0, s.durationSeconds || 0), 0)
}

/** 定位全局时间 globalT 落在哪个 shot，返回该 shot + 局部时间。空时间线返回 null。 */
export function activeShotAt(tl: SceneTimeline | undefined | null, globalT: number): ActiveShot | null {
  const t = ensureTimeline(tl)
  if (!t.shots.length) return null
  const clamped = Math.max(0, globalT)
  let acc = 0
  for (let i = 0; i < t.shots.length; i++) {
    const shot = t.shots[i]
    const dur = Math.max(0, shot.durationSeconds || 0)
    if (clamped < acc + dur || i === t.shots.length - 1) {
      return { shot, index: i, localT: Math.min(dur, clamped - acc), shotStart: acc }
    }
    acc += dur
  }
  // 不会到这；兜底末镜
  const last = t.shots[t.shots.length - 1]
  return { shot: last, index: t.shots.length - 1, localT: Math.max(0, last.durationSeconds || 0), shotStart: acc }
}

function staticCameraSample(cam: CameraObj | undefined): SampledCamera | null {
  if (!cam) return null
  return { position: cam.position as Vec3, lookAt: cam.lookAt as Vec3, fovDeg: cam.fovDeg }
}

function resolveCameraId(scene: DirectorScene, shot: Shot): string | null {
  return shot.cameraId || scene.activeCameraId || scene.cameras[0]?.id || null
}

/** 场景质心（XZ，角色平均位置）作为相机路径默认注视点。 */
function sceneCenter(scene: DirectorScene): Vec3 {
  const cs = scene.characters
  if (!cs.length) return [0, 1.2, 0]
  const x = cs.reduce((a, c) => a + c.position[0], 0) / cs.length
  const z = cs.reduce((a, c) => a + c.position[2], 0) / cs.length
  return [x, 1.2, z]
}

/** 解析相机路径的注视点：显式 lookAt > 注视角色(抬到胸高) > 场景中心。 */
function resolveCamPathLookAt(scene: DirectorScene, cam: CameraObj): Vec3 {
  const p = cam.path
  if (p?.lookAt) return p.lookAt
  if (p?.lookAtCharacterId) {
    const t = scene.characters.find((c) => c.id === p.lookAtCharacterId)
    if (t) return [t.position[0], t.position[1] + 1.2, t.position[2]]
  }
  return sceneCenter(scene)
}

/** 算某 shot 在局部时间 localT 下的相机机位（四态：static/orbit/recorded/path）。 */
export function sampleShotCamera(
  scene: DirectorScene,
  shot: Shot,
  localT: number,
): { cameraId: string | null; camera: SampledCamera | null } {
  const cameraId = resolveCameraId(scene, shot)
  const move = shot.cameraMove ?? { kind: 'static' as const }
  const cam = scene.cameras.find((c) => c.id === cameraId)
  if (move.kind === 'orbit') {
    return { cameraId, camera: sampleOrbitCamera(move.orbit, localT, Math.max(0.0001, shot.durationSeconds)) }
  }
  if (move.kind === 'recorded') {
    const pos = sampleTrack(move.tracks.position, localT)
    const look = sampleTrack(move.tracks.lookAt, localT)
    const fov = sampleTrack(move.tracks.fovDeg, localT)
    if (pos && look) {
      return { cameraId, camera: { position: pos as Vec3, lookAt: look as Vec3, fovDeg: (fov ?? [40])[0] } }
    }
    // 录制轨道不完整 → 退回静态机位
  }
  if (move.kind === 'path' && cam?.path && cam.path.waypoints.length >= 2) {
    const dur = Math.max(0.0001, shot.durationSeconds)
    const u = Math.min(1, Math.max(0, localT / dur))
    const s = samplePathAt({ waypoints: cam.path.waypoints, mode: cam.path.mode, closed: cam.path.closed }, u)
    const h = cam.path.height ?? 1.6
    return { cameraId, camera: { position: [s.pos[0], h, s.pos[1]], lookAt: resolveCamPathLookAt(scene, cam), fovDeg: cam.fovDeg } }
  }
  return { cameraId, camera: staticCameraSample(cam) }
}

/** 把 scene 的角色运动包成 ClipAnimation（仅 characters），复用 sampleAnimationAt 的分层合成。 */
function buildCharacterClip(scene: DirectorScene, durationSeconds: number): ClipAnimation {
  const characters: ClipAnimation['characters'] = {}
  for (const ch of scene.characters) {
    if (ch.motion) { characters[ch.id] = { motion: ch.motion }; continue }
    const mc = ch.motionSequence?.length ? concatMotionPresets(ch.motionSequence)?.id : ch.motionClip
    if (mc) characters[ch.id] = { motionClip: mc }
  }
  return { durationSeconds, fps: 30, cameras: {}, characters }
}

/**
 * 全局时间线采样：定位当前 shot → 算相机机位 + 所有角色状态。
 * 角色在 shot 局部时间下采样（走位/分层动画在每个镜头内推进）。
 */
export function sampleTimelineAt(
  tl: SceneTimeline | undefined | null,
  scene: DirectorScene,
  globalT: number,
): SampledTimelineFrame {
  const active = activeShotAt(tl, globalT)
  if (!active) {
    return { shotId: null, shotIndex: -1, localT: 0, camera: null, cameraId: null, characters: {} }
  }
  const { shot, index, localT } = active
  const { cameraId, camera } = sampleShotCamera(scene, shot, localT)
  const clip = buildCharacterClip(scene, Math.max(0.0001, shot.durationSeconds))
  const frame = sampleAnimationAt(clip, localT)
  return { shotId: shot.id, shotIndex: index, localT, camera, cameraId, characters: frame.characters }
}

// ── 变更 helpers（纯函数·不可变更新） ───────────────────────────────────────────

let shotSeq = 0
function newShotId(): string {
  shotSeq += 1
  return `shot_${shotSeq}_${Math.max(1, shotSeq * 7919 % 100000)}`
}

export function addShot(tl: SceneTimeline | undefined | null, shot: Partial<Shot> & { cameraId?: string }): SceneTimeline {
  const t = ensureTimeline(tl)
  const full: Shot = {
    id: shot.id || newShotId(),
    name: shot.name || `镜头 ${t.shots.length + 1}`,
    durationSeconds: shot.durationSeconds && shot.durationSeconds > 0 ? shot.durationSeconds : 4,
    cameraId: shot.cameraId,
    cameraMove: shot.cameraMove,
    speed: shot.speed,
  }
  return { shots: [...t.shots, full] }
}

export function patchShot(tl: SceneTimeline | undefined | null, id: string, patch: Partial<Shot>): SceneTimeline {
  const t = ensureTimeline(tl)
  return { shots: t.shots.map((s) => (s.id === id ? { ...s, ...patch, id: s.id } : s)) }
}

export function removeShot(tl: SceneTimeline | undefined | null, id: string): SceneTimeline {
  const t = ensureTimeline(tl)
  return { shots: t.shots.filter((s) => s.id !== id) }
}

export function moveShot(tl: SceneTimeline | undefined | null, id: string, toIndex: number): SceneTimeline {
  const t = ensureTimeline(tl)
  const from = t.shots.findIndex((s) => s.id === id)
  if (from < 0) return t
  const next = t.shots.slice()
  const [moved] = next.splice(from, 1)
  const clamped = Math.max(0, Math.min(next.length, toIndex))
  next.splice(clamped, 0, moved)
  return { shots: next }
}
