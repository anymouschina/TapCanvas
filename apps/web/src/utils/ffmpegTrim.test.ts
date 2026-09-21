import { beforeEach, describe, expect, it, vi } from 'vitest'

const ffmpeg = vi.hoisted(() => ({
  writeFile: vi.fn(),
  exec: vi.fn(),
  readFile: vi.fn(),
  deleteFile: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
}))

vi.mock('@ffmpeg/util', () => ({
  fetchFile: vi.fn(async () => new Uint8Array([1, 2, 3])),
}))

vi.mock('./ffmpegCore', () => ({
  getFFmpeg: vi.fn(async () => ffmpeg),
}))

import { sliceVideoRanges } from './ffmpegTrim'

describe('sliceVideoRanges', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ffmpeg.readFile.mockResolvedValue(new Uint8Array([4, 5, 6]))
    ffmpeg.deleteFile.mockResolvedValue(undefined)
  })

  it('cuts and concatenates every marked range into one executable reference asset', async () => {
    const result = await sliceVideoRanges('https://assets.example.com/source.mp4', [
      { start: 1, end: 2.5 },
      { start: 6, end: 8 },
    ])

    expect(result.type).toBe('video/mp4')
    expect(result.size).toBe(3)
    expect(ffmpeg.exec).toHaveBeenCalledTimes(3)
    expect(ffmpeg.exec.mock.calls[0]?.[0]).toEqual(expect.arrayContaining(['-ss', '1.000', '-t', '1.500']))
    expect(ffmpeg.exec.mock.calls[1]?.[0]).toEqual(expect.arrayContaining(['-ss', '6.000', '-t', '2.000']))
    expect(ffmpeg.exec.mock.calls[2]?.[0]).toEqual(expect.arrayContaining(['-f', 'concat', '-c', 'copy']))

    const concatWrite = ffmpeg.writeFile.mock.calls.find(([fileName]) => String(fileName).endsWith('.txt'))
    expect(concatWrite).toBeDefined()
    const concatBody = concatWrite?.[1]
    expect(ArrayBuffer.isView(concatBody)).toBe(true)
    expect(new TextDecoder().decode(concatBody as Uint8Array)).toMatch(/file 'remake-part-.+-0\.mp4'\nfile 'remake-part-.+-1\.mp4'/)
  })
})
