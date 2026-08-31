import { describe, it, expect } from 'vitest'
import { createThrottledCursorSender } from './presence-throttle'

describe('createThrottledCursorSender', () => {
  it('300ms 内多次只发一次，超过后再发', () => {
    const sent: Array<[number, number]> = []
    let t = 1000
    const send = createThrottledCursorSender({
      throttleMs: 300,
      now: () => t,
      emit: (x, y) => sent.push([x, y]),
    })
    send(1, 1) // t=1000 发
    send(2, 2) // t=1000 节流丢
    t = 1200; send(3, 3) // 200ms < 300 丢
    t = 1350; send(4, 4) // 350ms 发
    expect(sent).toEqual([[1, 1], [4, 4]])
  })
})
