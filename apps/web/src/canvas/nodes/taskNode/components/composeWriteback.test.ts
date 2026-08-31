import { describe, it, expect } from 'vitest'
import { buildComposeInitialPatch, buildComposeUrlSwapPatch } from './composeWriteback'

describe('buildComposeInitialPatch', () => {
  it('appends the blob url as a new primary video on an empty node', () => {
    const p = buildComposeInitialPatch(undefined, 'blob:abc', 'upload-1')
    expect(p.videoUrl).toBe('blob:abc')
    expect(p.status).toBe('success')
    expect(p.videoResults).toEqual([{ url: 'blob:abc', title: '合成视频', uploadToken: 'upload-1' }])
    expect(p.videoPrimaryIndex).toBe(0)
  })

  it('appends after existing results and points primary at the new one', () => {
    const existing = [{ url: 'https://x/old.mp4', title: 'old' }]
    const p = buildComposeInitialPatch(existing, 'blob:new', 'upload-2')
    expect(p.videoResults).toHaveLength(2)
    expect(p.videoResults[1]).toEqual({ url: 'blob:new', title: '合成视频', uploadToken: 'upload-2' })
    expect(p.videoPrimaryIndex).toBe(1)
  })
})

describe('buildComposeUrlSwapPatch', () => {
  it('swaps the temp blob url for the durable url in both videoUrl and videoResults', () => {
    const fresh = {
      videoUrl: 'blob:tmp',
      videoResults: [{ url: 'https://x/old.mp4' }, { url: 'blob:tmp', title: '合成视频', uploadToken: 'upload-3' }],
      videoPrimaryIndex: 1,
    }
    const patch = buildComposeUrlSwapPatch(fresh, 'blob:tmp', 'https://r2/final.mp4', 'upload-3')
    expect(patch).not.toBeNull()
    expect(patch!.videoUrl).toBe('https://r2/final.mp4')
    expect(patch!.videoResults![1].url).toBe('https://r2/final.mp4')
    expect(patch!.videoResults![1].uploadToken).toBeUndefined()
    expect(patch!.videoResults![0].url).toBe('https://x/old.mp4') // untouched
  })

  it('returns null when the blob url is no longer present (avoids clobbering newer state)', () => {
    const fresh = { videoUrl: 'https://r2/something-else.mp4', videoResults: [{ url: 'https://r2/x.mp4' }] }
    expect(buildComposeUrlSwapPatch(fresh, 'blob:gone', 'https://r2/final.mp4', 'upload-gone')).toBeNull()
  })

  it('only patches videoResults when videoUrl already points elsewhere', () => {
    const fresh = {
      videoUrl: 'https://r2/manual.mp4', // user re-selected primary meanwhile
      videoResults: [{ url: 'blob:tmp', title: '合成视频', uploadToken: 'upload-4' }],
      videoPrimaryIndex: 0,
    }
    const patch = buildComposeUrlSwapPatch(fresh, 'blob:tmp', 'https://r2/final.mp4', 'upload-4')
    expect(patch).toEqual({ videoResults: [{ url: 'https://r2/final.mp4', title: '合成视频' }] })
    expect(patch!.videoUrl).toBeUndefined()
  })

  it('recovers after persistence strips the blob URL before upload completes', () => {
    const fresh = {
      videoResults: [{ title: '合成视频', uploadToken: 'upload-5' }],
      videoPrimaryIndex: 0,
    }
    const patch = buildComposeUrlSwapPatch(fresh, 'blob:tmp', 'https://r2/final.mp4', 'upload-5')
    expect(patch).toEqual({
      videoUrl: 'https://r2/final.mp4',
      videoResults: [{ title: '合成视频', url: 'https://r2/final.mp4' }],
    })
  })

  it('does not make an older upload primary after a newer composition starts', () => {
    const fresh = {
      videoResults: [
        { title: '合成视频', uploadToken: 'upload-old' },
        { url: 'blob:new', title: '合成视频', uploadToken: 'upload-new' },
      ],
      videoPrimaryIndex: 1,
      videoUrl: 'blob:new',
    }
    const patch = buildComposeUrlSwapPatch(fresh, 'blob:old', 'https://r2/old.mp4', 'upload-old')
    expect(patch).toEqual({
      videoResults: [
        { title: '合成视频', url: 'https://r2/old.mp4' },
        { url: 'blob:new', title: '合成视频', uploadToken: 'upload-new' },
      ],
    })
  })

  it('returns null for nullish node data', () => {
    expect(buildComposeUrlSwapPatch(null, 'blob:x', 'https://r2/f.mp4', 'upload-x')).toBeNull()
    expect(buildComposeUrlSwapPatch(undefined, 'blob:x', 'https://r2/f.mp4', 'upload-x')).toBeNull()
  })
})
