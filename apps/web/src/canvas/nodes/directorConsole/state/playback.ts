// 【全局播放时钟】纯推进逻辑（rAF 在 Modal 里调用），可单测。
// 把 playhead 按 dt*speed 推进；到末尾按 loop 决定回绕或停在末尾。

export type PlayheadStep = { t: number; ended: boolean }

/**
 * 推进全局播放头。
 * @param current 当前时间（秒）
 * @param dt 帧间隔（秒）
 * @param speed 倍速（默认 1）
 * @param duration 时间线总时长（秒）
 * @param loop 到末尾是否回绕
 */
export function advancePlayhead(
  current: number,
  dt: number,
  speed: number,
  duration: number,
  loop: boolean,
): PlayheadStep {
  if (!(duration > 0)) return { t: 0, ended: true }
  const next = current + Math.max(0, dt) * (speed > 0 ? speed : 1)
  if (next >= duration) {
    return loop ? { t: next % duration, ended: false } : { t: duration, ended: true }
  }
  return { t: Math.max(0, next), ended: false }
}
