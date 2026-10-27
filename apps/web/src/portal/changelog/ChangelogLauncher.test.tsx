import React from 'react'
import { MantineProvider } from '@mantine/core'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installMantineDomMocks } from '../testMantineDomMocks'
import { CHANGELOG_READ_STORAGE_KEY, ChangelogLauncher } from './ChangelogLauncher'
import { LATEST_CHANGELOG_ID } from './entries'

installMantineDomMocks()

function renderLauncher(): ReturnType<typeof render> {
  return render(<MantineProvider><ChangelogLauncher /></MantineProvider>)
}

async function openChangelog(): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: /^更新日志/ }))
  await screen.findByRole('dialog', { name: '更新日志' })
  await screen.findByRole('heading', { name: '手动去噪、MCP 助手接入与剧本导出' })
}

describe('community changelog', () => {
  beforeEach(() => { window.localStorage.removeItem(CHANGELOG_READ_STORAGE_KEY) })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    window.localStorage.removeItem(CHANGELOG_READ_STORAGE_KEY)
  })

  it('opens only on request and records read state after content mounts', async () => {
    const view = renderLauncher()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('button', { name: '更新日志（有新内容）' })).toBeTruthy()
    expect(window.localStorage.getItem(CHANGELOG_READ_STORAGE_KEY)).toBeNull()

    await openChangelog()
    expect(window.localStorage.getItem(CHANGELOG_READ_STORAGE_KEY)).toBe(LATEST_CHANGELOG_ID)
    expect(screen.getByRole('heading', { name: '创作流水线与画布双视图' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '图片对比节点' })).toBeTruthy()
    expect(screen.getAllByText('最近更新')).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: '关闭更新日志' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.getByRole('button', { name: '更新日志' }).getAttribute('aria-expanded')).toBe('false')

    view.unmount()
    renderLauncher()
    expect(screen.getByRole('button', { name: '更新日志' })).toBeTruthy()
    await openChangelog()
  })

  it('shows new content again when the stored entry is older', async () => {
    window.localStorage.setItem(CHANGELOG_READ_STORAGE_KEY, '2026-10-20-image-compare')
    renderLauncher()
    expect(screen.getByRole('button', { name: '更新日志（有新内容）' })).toBeTruthy()
    await openChangelog()
    expect(window.localStorage.getItem(CHANGELOG_READ_STORAGE_KEY)).toBe(LATEST_CHANGELOG_ID)
  })

  it('reports blocked storage without preventing reading or closing, then retries on reopen', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('storage denied') })
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('storage denied') })
    renderLauncher()
    await openChangelog()
    expect(screen.getByRole('alert').textContent).toContain('无法保存更新日志已读状态：storage denied')
    expect(console.error).toHaveBeenCalledWith('[changelog] failed to read read state', expect.any(Error))
    expect(console.error).toHaveBeenCalledWith('[changelog] failed to write read state', expect.any(Error))

    fireEvent.click(screen.getByRole('button', { name: '关闭更新日志' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    read.mockRestore()
    write.mockRestore()
    expect(window.localStorage.getItem(CHANGELOG_READ_STORAGE_KEY)).toBeNull()
    await openChangelog()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(window.localStorage.getItem(CHANGELOG_READ_STORAGE_KEY)).toBe(LATEST_CHANGELOG_ID)
  })
})
