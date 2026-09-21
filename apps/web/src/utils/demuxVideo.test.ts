import { beforeEach, describe, expect, it, vi } from 'vitest'
import { demuxVideo } from './demuxVideo'

const ffmpeg = vi.hoisted(() => ({
  writeFile: vi.fn(), exec: vi.fn(), readFile: vi.fn(), deleteFile: vi.fn(),
}))
vi.mock('./ffmpegCore', () => ({ getFFmpeg: async () => ffmpeg }))
vi.mock('@ffmpeg/util', () => ({ fetchFile: async () => new Uint8Array([1, 2, 3]) }))

beforeEach(() => {
  vi.resetAllMocks()
  ffmpeg.exec.mockResolvedValue(0)
  ffmpeg.readFile.mockResolvedValue(new Uint8Array([4, 5, 6]))
})

describe('demuxVideo track delivery', () => {
  it('preserves the video when audio extraction fails and records the exit code', async () => {
    ffmpeg.exec.mockResolvedValueOnce(0).mockResolvedValueOnce(1)
    const result = await demuxVideo('https://assets.test/source.mp4')
    expect(result.silentVideo?.size).toBe(3)
    expect(result.audio).toBeNull()
    expect(result.errors.audio).toContain('退出码 1')
    expect(ffmpeg.readFile).toHaveBeenCalledTimes(1)
  })

  it('still extracts audio when video export throws', async () => {
    ffmpeg.exec.mockRejectedValueOnce(new Error('unsupported video codec')).mockResolvedValueOnce(0)
    const result = await demuxVideo('https://assets.test/source.webm')
    expect(result.silentVideo).toBeNull()
    expect(result.audio?.type).toBe('audio/mp4')
    expect(result.errors.video).toBe('unsupported video codec')
  })

  it('rejects empty output and does not request an unselected track', async () => {
    ffmpeg.readFile.mockResolvedValue(new Uint8Array())
    const result = await demuxVideo('https://assets.test/source.mp4', { video: false, audio: true })
    expect(result.audio).toBeNull()
    expect(result.errors.audio).toContain('有效的媒体文件')
    expect(ffmpeg.exec).toHaveBeenCalledTimes(1)
    expect(ffmpeg.exec.mock.calls[0][0]).toContain('0:a:0')
  })

  it('preserves both exports if temporary-file cleanup fails', async () => {
    ffmpeg.deleteFile.mockRejectedValue(new Error('cleanup unavailable'))
    const result = await demuxVideo('https://assets.test/source.mp4')
    expect(result.silentVideo?.size).toBe(3)
    expect(result.audio?.size).toBe(3)
    expect(result.errors).toEqual({})
  })
})
