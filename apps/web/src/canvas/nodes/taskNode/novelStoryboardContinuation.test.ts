import { describe, expect, it } from 'vitest'
import {
  buildReplayStoryboardChunkId,
  buildStoryboardChunkScript,
  normalizeStoryboardSelectionProtocolGroupSize,
} from './novelStoryboardContinuation'

describe('novel storyboard continuation contracts', () => {
  it('accepts only protocol-supported group sizes', () => {
    expect(normalizeStoryboardSelectionProtocolGroupSize(1)).toBe(1)
    expect(normalizeStoryboardSelectionProtocolGroupSize('25')).toBe(25)
    expect(normalizeStoryboardSelectionProtocolGroupSize(16)).toBeUndefined()
  })

  it('preserves a persisted chunk id and otherwise derives a deterministic id', () => {
    expect(buildReplayStoryboardChunkId({ taskId: 'task-1', chunkId: ' persisted ', chunkIndex: 2 }))
      .toBe('persisted')
    expect(buildReplayStoryboardChunkId({ taskId: 'task-1', chunkIndex: 2 }))
      .toBe('task-task-1-chunk-2')
  })

  it('serializes reviewed shots without losing their shot numbers', () => {
    expect(buildStoryboardChunkScript([
      { shotNo: 26, script: '角色推门进入' },
      { shotNo: 27, script: '镜头切至角色近景' },
    ])).toBe('镜头 26：角色推门进入\n镜头 27：镜头切至角色近景')
  })
})
