const CLICK_BURST_SPARK_COUNT = 12

export type ClickBurstSpark = {
  angle: number
  distance: number
  delay: number
}

export function buildClickBurstSparks(count: number = CLICK_BURST_SPARK_COUNT): ClickBurstSpark[] {
  return Array.from({ length: count }, (_, index) => ({
    angle: (360 / count) * index,
    distance: 20 + (index % 3) * 5,
    delay: (index % 2) * 18,
  }))
}

type ClickBurstEvent = Pick<MouseEvent, 'button' | 'detail'> & {
  target?: EventTarget | null
}

export function shouldCreateClickBurst(event: ClickBurstEvent): boolean {
  if (event.button !== 0 || event.detail <= 0) return false
  return !(event.target instanceof Element && event.target.closest('[data-click-feedback-scope="local"]'))
}
