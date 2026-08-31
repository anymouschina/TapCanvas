// 【相机路径采样】把一个 shot 的相机运动采成 3D 折线点，供导演视角里画相机轨迹（对齐参考视频的
// 相机 spline 可视化）。纯函数：复用 buildShotClip + sampleAnimationAt 的 capture-cam 结果。

import type { DirectorScene, Vec3 } from '../types'
import type { Shot } from './timeline'
import { buildShotClip } from './previewClip'
import { sampleAnimationAt } from '../scene/clipAnimation'

/**
 * 采样 shot 相机路径为折线点。静态机位返回 []（无路径可画）。
 * @param samples 采样段数（点数 = samples+1）
 */
export function shotCameraPathPoints(scene: DirectorScene, shot: Shot, samples = 48): Vec3[] {
  const move = shot.cameraMove ?? { kind: 'static' as const }
  if (move.kind === 'static') return []
  const clip = buildShotClip(scene, shot)
  const dur = Math.max(0.1, clip.durationSeconds)
  const out: Vec3[] = []
  const n = Math.max(2, samples)
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * dur
    const f = sampleAnimationAt(clip, t)
    const cam = f.cameras['capture-cam'] ?? Object.values(f.cameras)[0]
    if (cam) out.push(cam.position)
  }
  return out
}
