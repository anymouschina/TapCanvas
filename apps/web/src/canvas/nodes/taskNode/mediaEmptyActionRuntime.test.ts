import { describe, expect, it } from 'vitest'
import {
  clearMediaEmptyAction,
  consumeMediaEmptyAction,
  queueMediaEmptyAction,
} from './mediaEmptyActionRuntime'

describe('media empty action runtime', () => {
  it('hands an action from the lightweight shell to the focused node exactly once', () => {
    queueMediaEmptyAction('image-node-1', 'image-upscale')

    expect(consumeMediaEmptyAction('image-node-1')).toBe('image-upscale')
    expect(consumeMediaEmptyAction('image-node-1')).toBeNull()
  })

  it('keeps pending actions isolated per node and allows cancellation', () => {
    queueMediaEmptyAction('image-node-a', 'image-to-image')
    queueMediaEmptyAction('image-node-b', 'image-upscale')
    clearMediaEmptyAction('image-node-a')

    expect(consumeMediaEmptyAction('image-node-a')).toBeNull()
    expect(consumeMediaEmptyAction('image-node-b')).toBe('image-upscale')
  })
})
