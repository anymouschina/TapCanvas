// 【时间线 Shot → ClipAnimation 桥】把一个 shot 转成既有预览/渲染管线吃的 ClipAnimation
// （相机统一落到 'capture-cam' 轨道 或 cameraOrbit；角色取 scene 的 motion/motionClip）。
//
// 这是「时间线模型」与「既有相机视角实时预览(ActiveCameraView previewAnim) + 灰模渲染(onRenderClip)」
// 之间的纯函数桥——让 shot 既能预览也能导出，不重写任何 3D 代码。纯函数、可单测。

import type { DirectorScene } from '../types'
import type { ClipAnimation, CameraTracks } from '../scene/clipAnimation'
import type { Shot, SceneTimeline } from './timeline'
import { ensureTimeline, sampleShotCamera } from './timeline'
import { concatMotionPresets } from './motionPresets'

/** scene 角色 → ClipAnimation.characters（motion > 连招序列 > motionClip）。连招合成 clip 的 id 与
 *  CharacterObject 同源（concatMotionPresets），由角色的 effectiveCustomMotions 在出片/预览时解析。 */
function charactersOf(scene: DirectorScene): ClipAnimation['characters'] {
  const characters: ClipAnimation['characters'] = {}
  for (const ch of scene.characters) {
    if (ch.motion) { characters[ch.id] = { motion: ch.motion }; continue }
    const mc = ch.motionSequence?.length ? concatMotionPresets(ch.motionSequence)?.id : ch.motionClip
    if (mc) characters[ch.id] = { motionClip: mc }
  }
  return characters
}

/** 静态机位 → 单关键帧 capture-cam 轨道（让预览/渲染在该 shot 内保持该机位）。 */
function staticTracks(scene: DirectorScene, shot: Shot): CameraTracks | null {
  const camId = shot.cameraId || scene.activeCameraId || scene.cameras[0]?.id
  const cam = scene.cameras.find((c) => c.id === camId)
  if (!cam) return null
  return {
    position: [{ t: 0, value: cam.position }],
    lookAt: [{ t: 0, value: cam.lookAt }],
    fovDeg: [{ t: 0, value: [cam.fovDeg] }],
  }
}

/**
 * 把一个 shot 转成 ClipAnimation（capture-cam 约定，直接喂既有 previewAnim / onRenderClip）。
 * 相机三态：orbit → cameraOrbit；recorded → capture-cam 轨道；static → 单帧 capture-cam 轨道。
 */
export function buildShotClip(scene: DirectorScene, shot: Shot, fps = 30): ClipAnimation {
  const durationSeconds = Math.max(0.1, shot.durationSeconds || 4)
  const characters = charactersOf(scene)
  const move = shot.cameraMove ?? { kind: 'static' as const }
  if (move.kind === 'orbit') {
    return { durationSeconds, fps, cameras: {}, characters, cameraOrbit: move.orbit }
  }
  if (move.kind === 'recorded') {
    return { durationSeconds, fps, cameras: { 'capture-cam': move.tracks }, characters }
  }
  if (move.kind === 'path') {
    // 绘制的相机路径 → 采样成 capture-cam 关键帧轨道（复用 sampleShotCamera）
    const N = 48
    const position: CameraTracks['position'] = []
    const lookAt: CameraTracks['lookAt'] = []
    const fovDeg: CameraTracks['fovDeg'] = []
    for (let i = 0; i <= N; i++) {
      const t = (i / N) * durationSeconds
      const { camera } = sampleShotCamera(scene, shot, t)
      if (!camera) continue
      position.push({ t, value: camera.position })
      lookAt.push({ t, value: camera.lookAt })
      fovDeg.push({ t, value: [camera.fovDeg] })
    }
    if (position.length >= 2) {
      return { durationSeconds, fps, cameras: { 'capture-cam': { position, lookAt, fovDeg } }, characters }
    }
    // 无有效路径 → 退回静态
  }
  const tracks = staticTracks(scene, shot)
  return { durationSeconds, fps, cameras: tracks ? { 'capture-cam': tracks } : {}, characters }
}

/** 整条时间线 → 每个 shot 一段 ClipAnimation（供逐镜预览/导出/拼接）。 */
export function buildTimelineClips(
  scene: DirectorScene,
  tl: SceneTimeline | undefined | null,
  fps = 30,
): { shot: Shot; clip: ClipAnimation }[] {
  return ensureTimeline(tl).shots.map((shot) => ({ shot, clip: buildShotClip(scene, shot, fps) }))
}
