import { afterEach, describe, expect, it, vi } from 'vitest'

import { runVisionTask } from './server'

const successResponse = (): Response => new Response(JSON.stringify({
  id: 'vision-1',
  vendor: 'newapi',
  text: 'A cinematic portrait',
}), {
  status: 200,
  headers: { 'Content-Type': 'application/json' },
})

describe('runVisionTask', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('lets the public vision endpoint choose its configured default model', async () => {
    const fetchMock = vi.fn<[RequestInfo | URL, RequestInit?], Promise<Response>>(async () => successResponse())
    vi.stubGlobal('fetch', fetchMock)

    await runVisionTask({
      imageUrl: 'https://example.com/reference.png',
      prompt: 'analyze this image',
    })

    const [, requestInit] = fetchMock.mock.calls[0] ?? []
    const payload = JSON.parse(String(requestInit?.body)) as Record<string, unknown>
    expect(payload.modelAlias).toBeUndefined()
    expect(payload.modelKey).toBeUndefined()
  })

  it('preserves an explicitly selected model', async () => {
    const fetchMock = vi.fn<[RequestInfo | URL, RequestInit?], Promise<Response>>(async () => successResponse())
    vi.stubGlobal('fetch', fetchMock)

    await runVisionTask(
      {
        imageUrl: 'https://example.com/reference.png',
        prompt: 'analyze this image',
      },
      { modelKey: 'explicit-model' },
    )

    const [, requestInit] = fetchMock.mock.calls[0] ?? []
    const payload = JSON.parse(String(requestInit?.body)) as Record<string, unknown>
    expect(payload.modelKey).toBe('explicit-model')
  })
})
