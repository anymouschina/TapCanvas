import { describe, expect, it, vi } from 'vitest'
import { buildMediaGenerationSettings } from './mediaGenerationSettings'

describe('buildMediaGenerationSettings', () => {
  it('compiles video catalog controls into the unified reference panel contract', () => {
    const onAspectChange = vi.fn()
    const onResolutionChange = vi.fn()
    const onDurationChange = vi.fn()
    const onAudioChange = vi.fn()
    const onQuantityChange = vi.fn()
    const settings = buildMediaGenerationSettings({
      kind: 'video',
      aspect: '16:9',
      videoSize: '1280x720',
      orientation: 'landscape',
      effectiveVideoResolution: '720p',
      imageResolution: '',
      imageSize: '',
      videoReferType: 'base',
      mappedControls: [
        {
          key: 'size',
          binding: 'size',
          title: '比例',
          summary: '16:9',
          options: [{ value: '1280x720', label: '16:9' }],
          onChange: onAspectChange,
        },
        {
          key: 'resolution',
          binding: 'resolution',
          title: '清晰度',
          summary: '720P',
          options: [{ value: '720p', label: '720P' }],
          onChange: onResolutionChange,
        },
      ],
      fallbackAspectOptions: [],
      onFallbackAspectChange: onAspectChange,
      duration: {
        value: 5,
        options: [{ value: '5', label: '5s' }],
        onChange: onDurationChange,
      },
      audio: {
        value: true,
        onChange: onAudioChange,
      },
      summaryAspect: '16:9',
      summaryResolution: '720P',
      summaryDuration: '5s',
      quantity: 1,
      onQuantityChange,
    })

    expect(settings.summary).toBe('16:9 · 720P · 5s · 1个')
    expect(settings.sections.map((section) => section.label)).toEqual(['比例', '清晰度'])
    expect(settings.duration?.value).toBe(5)
    expect(settings.audio?.value).toBe(true)
    expect(settings.quantity.options).toEqual([1, 2, 4])
  })

  it('retains a persisted non-standard quantity without removing reference choices', () => {
    const settings = buildMediaGenerationSettings({
      kind: 'image',
      aspect: '1:1',
      videoSize: '',
      orientation: 'landscape',
      effectiveVideoResolution: '',
      imageResolution: '2K',
      imageSize: '2K',
      videoReferType: 'base',
      mappedControls: [],
      fallbackAspectOptions: [{ value: '1:1', label: '1:1' }],
      onFallbackAspectChange: vi.fn(),
      duration: null,
      summaryAspect: '1:1',
      summaryResolution: '',
      summaryDuration: '',
      quantity: 3,
      onQuantityChange: vi.fn(),
    })

    expect(settings.quantity.options).toEqual([1, 2, 3, 4])
    expect(settings.summary).toBe('1:1 · 3张')
  })
})
