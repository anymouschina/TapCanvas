import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import UpdateBanner from './UpdateBanner'

const pwaMock = vi.hoisted(() => ({
  updateServiceWorker: vi.fn((): Promise<void> => Promise.resolve()),
}))

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({
    needRefresh: [true, vi.fn()],
    offlineReady: [false, vi.fn()],
    updateServiceWorker: pwaMock.updateServiceWorker,
  }),
}))

describe('UpdateBanner', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    pwaMock.updateServiceWorker.mockReset()
    pwaMock.updateServiceWorker.mockResolvedValue()
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('shows the client-control wait state after requesting activation', async () => {
    render(<UpdateBanner />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '立即刷新' }))
      await Promise.resolve()
    })

    expect(pwaMock.updateServiceWorker).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: '切换中' }).getAttribute('disabled')).not.toBeNull()
    expect(screen.getByRole('status').textContent).toContain('正在切换到新版本')
  })

  it('reports an explicit failure when the worker does not take control', async () => {
    render(<UpdateBanner />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '立即刷新' }))
      await Promise.resolve()
    })

    act(() => {
      vi.advanceTimersByTime(10_000)
    })

    expect(screen.getByRole('alert').textContent).toContain('等待新版本接管超时')
    expect(screen.getByRole('button', { name: '重试' }).getAttribute('disabled')).toBeNull()
  })

  it('surfaces activation request errors', async () => {
    pwaMock.updateServiceWorker.mockRejectedValueOnce(new Error('worker message failed'))
    render(<UpdateBanner />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '立即刷新' }))
      await Promise.resolve()
    })

    expect(screen.getByRole('alert').textContent).toContain('worker message failed')
  })
})
