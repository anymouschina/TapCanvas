// 光标节流发送器（纯逻辑，便于单测）。now 可注入以避免测试依赖真实时钟。
export function createThrottledCursorSender(opts: {
  throttleMs: number
  emit: (x: number, y: number) => void
  now?: () => number
}): (x: number, y: number) => void {
  const now = opts.now ?? (() => Date.now())
  let last = 0
  return (x: number, y: number) => {
    const t = now()
    if (t - last < opts.throttleMs) return
    last = t
    opts.emit(x, y)
  }
}
