import { afterEach, describe, expect, it, vi } from 'vitest'
import { getPublicProjectConversation } from './server'

describe('getPublicProjectConversation', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends the chapter scope to the public conversation endpoint', async () => {
    const fetchMock = vi.fn<[RequestInfo | URL, RequestInit?], Promise<Response>>(async () => new Response(JSON.stringify({ sessions: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await getPublicProjectConversation('project/1', {
      ownerType: 'chapter',
      ownerId: 'chapter/30',
    })

    const [requestUrl, requestInit] = fetchMock.mock.calls[0] ?? []
    expect(String(requestUrl)).toContain(
      '/projects/project%2F1/conversation?ownerType=chapter&ownerId=chapter%2F30',
    )
    expect(requestInit).toEqual(expect.objectContaining({
      headers: { 'Content-Type': 'application/json' },
    }))
  })

  it('keeps the project-level endpoint unscoped when no chapter is selected', async () => {
    const fetchMock = vi.fn<[RequestInfo | URL, RequestInit?], Promise<Response>>(async () => new Response(JSON.stringify({ sessions: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await getPublicProjectConversation('project-1')

    const [requestUrl, requestInit] = fetchMock.mock.calls[0] ?? []
    expect(String(requestUrl).endsWith('/projects/project-1/conversation')).toBe(true)
    expect(requestInit).toEqual(expect.objectContaining({
      headers: { 'Content-Type': 'application/json' },
    }))
  })
})
