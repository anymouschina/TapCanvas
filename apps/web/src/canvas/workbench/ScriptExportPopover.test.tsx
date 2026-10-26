import React from 'react'
import { MantineProvider } from '@mantine/core'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ScriptExportPopover } from './ScriptExportPopover'
import type { ChapterScriptPlanSummary } from '../../api/chapterScripts'

const mocks = vi.hoisted(() => ({ list: vi.fn(), download: vi.fn(), toast: vi.fn() }))
vi.mock('../../api/chapterScripts', () => ({ fetchChapterScriptPlans: mocks.list, downloadChapterScripts: mocks.download }))
vi.mock('../../ui/toast', () => ({ toast: mocks.toast }))
const plans: ChapterScriptPlanSummary[] = Array.from({ length: 12 }, (_, index) => ({
  chapterId: `chapter-${index + 1}`, chapterIndex: index + 1, title: `章节 ${index + 1}`,
  executionId: `run-${index + 1}`, executionStatus: 'running', plannedAt: null, clipCount: 2, durationSeconds: 20,
}))

beforeEach(() => { vi.clearAllMocks(); mocks.list.mockResolvedValue(plans); mocks.download.mockResolvedValue('合集.txt') })
afterEach(cleanup)
const open = () => {
  render(<MantineProvider><ScriptExportPopover projectId="project" /></MantineProvider>)
  fireEvent.click(screen.getByRole('button', { name: '导出剧本' }))
}

describe('saved script export selection', () => {
  it('loads on demand and exports the first ten saved chapters in order', async () => {
    render(<MantineProvider><ScriptExportPopover projectId="project" /></MantineProvider>)
    expect(mocks.list).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '导出剧本' }))
    fireEvent.click(await screen.findByRole('button', { name: '导出 10 集' }))
    await waitFor(() => expect(mocks.download).toHaveBeenCalledWith('project', plans.slice(0, 10).map(plan => plan.chapterId)))
    expect(mocks.toast).toHaveBeenCalledWith('已导出 10 集剧本：合集.txt', 'success')
  })

  it('allows explicit chapter selection and disables export for an empty selection', async () => {
    open()
    fireEvent.click(await screen.findByRole('button', { name: '清空' }))
    expect((screen.getByRole('button', { name: '导出 0 集' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('checkbox', { name: '章节 12' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '章节 2' }))
    fireEvent.click(screen.getByRole('button', { name: '导出 2 集' }))
    await waitFor(() => expect(mocks.download).toHaveBeenCalledWith('project', ['chapter-2', 'chapter-12']))
  })

  it('shows source failure and missing content without downloading', async () => {
    mocks.list.mockRejectedValue(new Error('章节提示词无法读取'))
    open()
    expect(await screen.findByText('章节提示词无法读取')).toBeTruthy()
    expect(mocks.download).not.toHaveBeenCalled()
    cleanup()
    mocks.list.mockResolvedValue([])
    open()
    expect(await screen.findByText(/还没有生成出视频提示词的章节/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^导出 \d/ })).toBeNull()
  })

  it('retains the selection and reports an export error', async () => {
    mocks.download.mockRejectedValue(new Error('章节已保存的提示词损坏'))
    open()
    fireEvent.click(await screen.findByRole('button', { name: '导出 10 集' }))
    expect(await screen.findByText('章节已保存的提示词损坏')).toBeTruthy()
    expect(screen.getByRole('button', { name: '导出 10 集' })).toBeTruthy()
    expect(mocks.toast).not.toHaveBeenCalled()
  })
})


function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((accept, decline) => { resolve = accept; reject = decline })
  return { promise, resolve, reject }
}

describe('script export request lifetime', () => {
  it('clears the previous list immediately on reopen and ignores closed requests', async () => {
    open()
    await screen.findByRole('button', { name: '导出 10 集' })
    fireEvent.click(screen.getByRole('button', { name: '导出剧本' }))
    const pending = deferred<ChapterScriptPlanSummary[]>()
    mocks.list.mockReturnValueOnce(pending.promise)
    fireEvent.click(screen.getByRole('button', { name: '导出剧本' }))
    expect(screen.queryByRole('button', { name: '导出 10 集' })).toBeNull()
    expect(screen.getByText('正在读取已出提示词的章节…')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '导出剧本' }))
    await act(async () => { pending.resolve(plans) })
    expect(screen.queryByRole('button', { name: '导出 10 集' })).toBeNull()
  })

  it('accepts one export per pending request and freezes its selection', async () => {
    const pending = deferred<string>()
    mocks.download.mockReturnValue(pending.promise)
    open()
    const submit = await screen.findByRole('button', { name: '导出 10 集' })
    act(() => { submit.click(); submit.click() })
    expect(mocks.download).toHaveBeenCalledTimes(1)
    expect((screen.getByRole('checkbox', { name: '章节 1' }) as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: '清空' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '导出剧本' }))
    fireEvent.click(screen.getByRole('button', { name: '导出剧本' }))
    await screen.findByRole('button', { name: '导出 10 集' })
    await act(async () => { pending.resolve('旧下载.txt') })
    expect(mocks.toast).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '导出 10 集' })).toBeTruthy()
  })

  it('does not apply an old project export result after switching project', async () => {
    const pending = deferred<string>()
    mocks.download.mockReturnValueOnce(pending.promise)
    const { rerender } = render(<MantineProvider><ScriptExportPopover projectId="old" /></MantineProvider>)
    fireEvent.click(screen.getByRole('button', { name: '导出剧本' }))
    fireEvent.click(await screen.findByRole('button', { name: '导出 10 集' }))
    rerender(<MantineProvider><ScriptExportPopover projectId="new" /></MantineProvider>)
    fireEvent.click(screen.getByRole('button', { name: '导出剧本' }))
    await screen.findByRole('button', { name: '导出 10 集' })
    await act(async () => { pending.reject(new Error('旧项目失败')) })
    expect(screen.queryByText('旧项目失败')).toBeNull()
    expect(mocks.toast).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '导出 10 集' })).toBeTruthy()
  })
})
