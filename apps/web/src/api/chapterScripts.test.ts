import { afterEach, describe, expect, it, vi } from 'vitest'
import { downloadChapterScripts, fetchChapterScriptPlans } from './chapterScripts'

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }))
vi.mock('./server', () => ({ API_BASE: '/api', apiFetch: mocks.fetch, withAuth: (init: RequestInit = {}) => init,
  throwApiError: async (response: Response) => { throw new Error((await response.json() as { error: string }).error) },
}))
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllGlobals() })

describe('chapter script download protocol', () => {
  it('rejects malformed and cross-project lists without silently returning empty content', async () => {
    for (const body of [{}, { projectId: 'other', items: [] }, { projectId: 'project', items: [{}] }]) {
      mocks.fetch.mockResolvedValue(new Response(JSON.stringify(body)))
      await expect(fetchChapterScriptPlans('project')).rejects.toThrow('响应格式错误')
    }
  })

  it('validates every summary field and rejects duplicate chapter ids', async () => {
    const valid = { chapterId: 'one', chapterIndex: 1, title: '第一章', executionId: 'run', executionStatus: 'success',
      plannedAt: null, clipCount: 2, durationSeconds: 20 }
    const invalidFields = { chapterId: ' ', chapterIndex: Infinity, title: null, executionId: '',
      executionStatus: 4, plannedAt: false, clipCount: 1.5, durationSeconds: -2 }
    for (const [field, value] of Object.entries(invalidFields)) {
      mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ projectId: 'project', items: [{ ...valid, [field]: value }] })))
      await expect(fetchChapterScriptPlans('project')).rejects.toThrow('响应格式错误')
    }
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ projectId: 'project', items: [valid, valid] })))
    await expect(fetchChapterScriptPlans('project')).rejects.toThrow('响应格式错误')
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ projectId: 'project', items: [valid] })))
    expect(await fetchChapterScriptPlans('project')).toEqual([valid])
  })

  it('downloads the server TXT with a UTF-8 filename and revokes the object URL', async () => {
    const create = vi.fn().mockReturnValue('blob:script')
    const revoke = vi.fn()
    vi.stubGlobal('URL', Object.assign(class extends URL {}, { createObjectURL: create, revokeObjectURL: revoke }))
    let name = ''
    let href = ''
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { name = this.download; href = this.href })
    mocks.fetch.mockResolvedValue(new Response('原文', { headers: { 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent('原书-剧本.txt')}` } }))
    expect(await downloadChapterScripts('project/one', ['chapter'])).toBe('原书-剧本.txt')
    expect(mocks.fetch).toHaveBeenCalledWith('/api/projects/project%2Fone/script-export', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ chapterIds: ['chapter'] }),
    }))
    expect(name).toBe('原书-剧本.txt')
    expect(href).toBe('blob:script')
    expect(create).toHaveBeenCalledTimes(1)
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(revoke).toHaveBeenCalledWith('blob:script')
  })

  it('surfaces server failure and rejects invalid selections before a request', async () => {
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ error: '尚无提示词' }), { status: 409 }))
    await expect(downloadChapterScripts('project', ['chapter'])).rejects.toThrow('尚无提示词')
    mocks.fetch.mockClear()
    await expect(downloadChapterScripts('project', [])).rejects.toThrow()
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
})
