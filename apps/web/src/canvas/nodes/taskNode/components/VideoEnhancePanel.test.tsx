import { describe, expect, it, vi } from 'vitest'
import { render, fireEvent, screen } from '@testing-library/react'
import { MantineProvider } from '@mantine/core'
import { VideoEnhancePanel } from './VideoEnhancePanel'
import type { EnhanceParams } from './VideoEnhancePanel'

const renderP = (props: { onRun: (p: EnhanceParams) => void; onClose: () => void }) =>
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
})
