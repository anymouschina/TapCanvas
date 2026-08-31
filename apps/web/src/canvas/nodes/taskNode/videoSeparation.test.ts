import { describe, expect, it } from 'vitest'
import { resolveVideoSeparationPlan } from './videoSeparation'

describe('resolveVideoSeparationPlan', () => {
  it('requests both outputs only for the combined action', () => {
    expect(resolveVideoSeparationPlan('both')).toMatchObject({
      needsVideo: true,
      needsAudio: true,
    })
  })

  it('requests only the silent video for the video action', () => {
    expect(resolveVideoSeparationPlan('video')).toMatchObject({
      needsVideo: true,
      needsAudio: false,
    })
  })

  it('requests only the audio track for the audio action', () => {
    expect(resolveVideoSeparationPlan('audio')).toMatchObject({
      needsVideo: false,
      needsAudio: true,
    })
  })
})
