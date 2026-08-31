// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ArtifactCardView } from './DataCardViews'
import type { DataBlock } from './types'

const toastMock = vi.hoisted(() => vi.fn())

vi.mock('../../toast', () => ({ toast: toastMock }))

const block: DataBlock = {
  id: 'artifact-yangchun-noodle',
  type: 'data',
  name: 'artifact',
  payload: {
    title: '30秒阳春面宣传视频制作方案',
    markdown: '# 阳春面宣传片\n\n汤清、面滑、葱香。',
  },
}

describe('ArtifactCardView', () => {
  beforeEach(() => {
    toastMock.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('uses separate native buttons and copies the full document with visible success feedback', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })

    const { container } = render(<ArtifactCardView block={block} />)
    const copyButton = screen.getByRole('button', { name: '复制文档' })

    expect(copyButton.closest('button')?.parentElement?.tagName).not.toBe('BUTTON')
    expect(container.querySelector('button button')).toBeNull()

    fireEvent.click(copyButton)

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('# 阳春面宣传片\n\n汤清、面滑、葱香。'))
    expect(await screen.findByRole('button', { name: '文档已复制' })).toBeTruthy()
    expect(toastMock).toHaveBeenCalledWith('文档已复制', 'success')
  })

  it('shows an explicit error when clipboard writing fails', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('剪贴板权限被拒绝'))
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })

    render(<ArtifactCardView block={block} />)
    fireEvent.click(screen.getByRole('button', { name: '复制文档' }))

    expect(await screen.findByRole('button', { name: '重新复制文档' })).toBeTruthy()
    expect(toastMock).toHaveBeenCalledWith('剪贴板权限被拒绝', 'error')
  })

  it('fails explicitly when the browser leaves clipboard writing pending', async () => {
    vi.useFakeTimers()
    const writeText = vi.fn().mockReturnValue(new Promise<void>(() => undefined))
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })

    render(<ArtifactCardView block={block} />)
    fireEvent.click(screen.getByRole('button', { name: '复制文档' }))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500)
    })

    expect(screen.getByRole('button', { name: '重新复制文档' })).toBeTruthy()
    expect(toastMock).toHaveBeenCalledWith('剪贴板响应超时，请保持页面在前台后重试', 'error')
  })
})
