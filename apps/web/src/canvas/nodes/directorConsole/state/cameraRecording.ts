// 飞行录制：把穿梭机视角逐帧采样(带时间戳)抽成相机关键帧轨道 + 轨迹线点。
import type { Vec3 } from '../types'
import type { CameraTracks } from '../scene/clipAnimation'

export type FlySample = { t: number; position: Vec3; lookAt: Vec3; fovDeg: number }
export type RecordedCamera = { tracks: CameraTracks; durationSeconds: number; points: Vec3[] }

/**
 * 采样 → 运镜。归一化时间到 [0,duration]，均匀抽样到 ≤maxKeyframes 帧(保首尾)生成 position/lookAt/fovDeg 轨道；
 * 轨迹线 points 用全采样(更平滑)。少于 2 帧或零时长返回 null。
 */
export function buildRecordedCamera(samples: FlySample[], maxKeyframes = 60): RecordedCamera | null {
  if (!samples || samples.length < 2) return null
  const t0 = samples[0].t
  const norm = samples.map((s) => ({ ...s, t: s.t - t0 }))
  const duration = norm[norm.length - 1].t
  if (!(duration > 0)) return null

  const n = norm.length
  let picked: FlySample[]
  if (n <= maxKeyframes) {
    picked = norm
  } else {
    const step = (n - 1) / (maxKeyframes - 1)
    const out: FlySample[] = []
    for (let i = 0; i < maxKeyframes; i++) out.push(norm[Math.min(n - 1, Math.round(i * step))])
    if (out[out.length - 1].t !== duration) out.push(norm[n - 1])
    picked = out
  }

  const tracks: CameraTracks = {
    position: picked.map((s) => ({ t: s.t, value: s.position })),
    lookAt: picked.map((s) => ({ t: s.t, value: s.lookAt })),
    fovDeg: picked.map((s) => ({ t: s.t, value: [s.fovDeg] as [number] })),
  }
  return { tracks, durationSeconds: duration, points: norm.map((s) => s.position) }
}
