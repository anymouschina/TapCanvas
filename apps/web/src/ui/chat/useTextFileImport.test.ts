import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { extractTextFromFile } from './textFileImport'
import { useTextFileImport } from './useTextFileImport'

vi.mock('./textFileImport', async (original) => ({
  ...await original<typeof import('./textFileImport')>(),
  extractTextFromFile: vi.fn(),
}))

describe('file attachments', () => {
  it('stores text separately, keeps selection order and excludes removed files from submission', async () => {
    vi.mocked(extractTextFromFile).mockResolvedValueOnce('第一份正文').mockResolvedValueOnce('第二份正文')
    const { result } = renderHook(() => useTextFileImport())
    act(() => result.current.importFiles([new File([], 'first.txt'), new File([], 'last.md')]))
    expect(result.current.canSend).toBe(false)
    await waitFor(() => expect(result.current.canSend).toBe(true))
    expect(result.current.attachments.map((file) => file.name)).toEqual(['first.txt', 'last.md'])
    expect(result.current.buildMessage('用户要求')).toBe('用户要求\n\n【first.txt】\n第一份正文\n\n【last.md】\n第二份正文')
    act(() => result.current.remove(result.current.attachments[0].id))
    expect(result.current.buildMessage('')).toBe('【last.md】\n第二份正文')
  })

  it('never restores an attachment removed while reading', async () => {
    let finish: (text: string) => void = () => { throw new Error('Not started') }
    vi.mocked(extractTextFromFile).mockImplementationOnce(() => new Promise<string>((resolve) => { finish = resolve }))
    const { result } = renderHook(() => useTextFileImport())
    act(() => result.current.importFiles([new File([], 'removed.txt')]))
    act(() => result.current.remove(result.current.attachments[0].id))
    await act(async () => finish('迟到正文'))
    expect(result.current.attachments).toEqual([])
    expect(result.current.buildMessage('用户要求')).toBe('用户要求')
  })

  it('retains failed and successful tags, requiring removal of a failed attachment before sending', async () => {
    const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(extractTextFromFile).mockRejectedValueOnce(new Error('损坏文件')).mockResolvedValueOnce('正常正文')
    const { result } = renderHook(() => useTextFileImport())
    act(() => result.current.importFiles([new File([], 'bad.doc'), new File([], 'good.txt')]))
    await waitFor(() => expect(result.current.importing).toBe(false))
    expect(result.current.attachments[0]).toMatchObject({ status: 'error', error: '损坏文件' })
    expect(result.current.canSend).toBe(false)
    expect(() => result.current.buildMessage('')).toThrow('bad.doc')
    act(() => result.current.remove(result.current.attachments[0].id))
    expect(result.current.canSend).toBe(true)
    expect(result.current.buildMessage('')).toContain('正常正文')
    diagnostic.mockRestore()
  })
})
