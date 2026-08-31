import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { objectStorageStreamUrl, fetchClip } from './reliableClipFetch'

function videoResponse(body = 'binary'): Response {
  return new Response(body, { status: 200, headers: { 'content-type': 'video/mp4' } })
}
function htmlResponse(status = 404): Response {
  return new Response('<!doctype html><title>Not Found</title>', {
    status,
    headers: { 'content-type': 'text/html' },
  })
}

const fastSleep = () => Promise.resolve()

describe('objectStorageStreamUrl', () => {
  it('builds a proxy url for http(s) clips', () => {
    const out = objectStorageStreamUrl('https://tanvas-ai.tos-cn-guangzhou.volces.com/tapcanvas/legacy/gen/videos/abc.mp4')
    expect(out).toContain('/assets/storage-stream?url=')
    expect(out).toContain(encodeURIComponent('https://tanvas-ai.tos-cn-guangzhou.volces.com/tapcanvas/legacy/gen/videos/abc.mp4'))
  })

  it('returns null for non-http urls (blob:, data:)', () => {
    expect(objectStorageStreamUrl('blob:http://x/123')).toBeNull()
    expect(objectStorageStreamUrl('data:video/mp4;base64,AAAA')).toBeNull()
  })
})

describe('fetchClip', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uses the S3 proxy first and returns it when it serves a video', async () => {
    fetchMock.mockResolvedValueOnce(videoResponse())
    const res = await fetchClip('https://tanvas-ai.tos-cn-guangzhou.volces.com/tapcanvas/legacy/gen/videos/a.mp4', { sleep: fastSleep })
    expect(res.ok).toBe(true)
    // first (and only) call must be the proxy, not the raw CDN url
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toContain('/assets/storage-stream?url=')
  })

  it('uses the direct url when the proxy says it is not an active storage asset (400)', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('{"error":"url is not an active object storage asset"}', { status: 400 }))
      .mockResolvedValueOnce(videoResponse())
    const res = await fetchClip('https://provider.example.com/x.mp4', { sleep: fastSleep })
    expect(res.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(String(fetchMock.mock.calls[1][0])).toBe('https://provider.example.com/x.mp4')
  })

  it('retries on a transient 404-HTML throttle page and then succeeds', async () => {
    fetchMock
      .mockResolvedValueOnce(htmlResponse(404)) // proxy hiccup -> retry
      .mockResolvedValueOnce(videoResponse())
    const res = await fetchClip('https://tanvas-ai.tos-cn-guangzhou.volces.com/tapcanvas/legacy/gen/videos/a.mp4', {
      attempts: 3,
      sleep: fastSleep,
    })
    expect(res.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('treats a 200 HTML body as a failure (throttle page masquerading as success)', async () => {
    fetchMock
      .mockResolvedValueOnce(htmlResponse(200))
      .mockResolvedValueOnce(videoResponse())
    const res = await fetchClip('https://tanvas-ai.tos-cn-guangzhou.volces.com/tapcanvas/legacy/gen/videos/a.mp4', {
      attempts: 2,
      sleep: fastSleep,
    })
    expect(res.ok).toBe(true)
    expect(String((await res.text()))).toBe('binary')
  })

  it('throws after exhausting attempts on both proxy and direct', async () => {
    fetchMock.mockResolvedValue(htmlResponse(404))
    await expect(
      fetchClip('https://tanvas-ai.tos-cn-guangzhou.volces.com/tapcanvas/legacy/gen/videos/a.mp4', { attempts: 2, sleep: fastSleep }),
    ).rejects.toThrow()
    // 2 attempts on proxy + 2 on direct fallback
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('aborts immediately when the signal is already aborted', async () => {
    const ctrl = new AbortController()
    ctrl.abort()
    await expect(
      fetchClip('https://tanvas-ai.tos-cn-guangzhou.volces.com/tapcanvas/legacy/gen/videos/a.mp4', { signal: ctrl.signal, sleep: fastSleep }),
    ).rejects.toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
