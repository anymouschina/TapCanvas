// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { describe, expect, it, vi } from 'vitest'
import { render, fireEvent, screen, waitFor, cleanup } from '@testing-library/react'
import { MantineProvider } from '@mantine/core'
import { afterEach, beforeAll } from 'vitest'
import { VideoEnhancePanel } from './VideoEnhancePanel'
import type { EnhanceParams } from './VideoEnhancePanel'

beforeAll(() => {
  if (typeof globalThis.ResizeObserver !== 'function') {
    class ResizeObserverMock implements ResizeObserver {
      observe = vi.fn()
      unobserve = vi.fn()
      disconnect = vi.fn()
    }
    Object.defineProperty(globalThis, 'ResizeObserver', {
      configurable: true,
      value: ResizeObserverMock,
    })
  }
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(() => true),
    }),
  })
})

afterEach(cleanup)

const renderP = (props: { onRun: (p: EnhanceParams) => Promise<void> | void; onClose: () => void }) =>
  render(
    <MantineProvider>
      <VideoEnhancePanel {...props} />
    </MantineProvider>,
  )

describe('VideoEnhancePanel', () => {
  it('默认点击执行输出 {tool_version:"standard", scene:"aigc", resolution:"1080p"}，不含 resolution_limit', () => {
    const onRun = vi.fn()
    renderP({ onRun, onClose: vi.fn() })
    fireEvent.click(screen.getByText('开始增强'))
    expect(onRun).toHaveBeenCalledOnce()
    const arg: EnhanceParams = onRun.mock.calls[0][0]
    expect(arg.tool_version).toBe('standard')
    expect(arg.scene).toBe('aigc')
    expect(arg.resolution).toBe('1080p')
    expect(arg.resolution_limit).toBeUndefined()
  })

  it('切到短边像素模式后，输出 resolution_limit，不含 resolution', () => {
    const onRun = vi.fn()
    renderP({ onRun, onClose: vi.fn() })
    // 切到短边像素模式
    fireEvent.click(screen.getByText('短边像素'))
    fireEvent.click(screen.getByText('开始增强'))
    expect(onRun).toHaveBeenCalledOnce()
    const arg: EnhanceParams = onRun.mock.calls[0][0]
    expect(arg.resolution_limit).toBeDefined()
    expect(typeof arg.resolution_limit).toBe('number')
    expect(arg.resolution).toBeUndefined()
  })

  it('执行中防止重复提交，并在模型能力不可用时保留面板显示错误', async () => {
    const onRun = vi.fn().mockRejectedValue(new Error('视频增强模型未启用'))
    renderP({ onRun, onClose: vi.fn() })

    const submit = screen.getByRole('button', { name: '开始增强' })
    fireEvent.click(submit)
    fireEvent.click(submit)

    expect(onRun).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('视频增强模型未启用')).toBeVisible()
    await waitFor(() => expect(screen.getByRole('button', { name: '开始增强' })).toBeEnabled())
  })
})
