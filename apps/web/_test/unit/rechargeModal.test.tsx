import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MantineProvider } from '@mantine/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import RechargeModal from '../../src/ui/RechargeModal'

const listRechargePackagesMock = vi.fn()
const preloadModelOptionsMock = vi.fn()

vi.mock('../../src/api/server', () => ({
  listRechargePackages: (...args: unknown[]) => listRechargePackagesMock(...args),
  createCommerceOrder: vi.fn(),
  createWechatNativePayment: vi.fn(),
  reconcileWechatPayment: vi.fn(),
}))

vi.mock('../../src/config/useModelOptions', () => ({
  preloadModelOptions: (...args: unknown[]) => preloadModelOptionsMock(...args),
}))

vi.mock('../../src/ui/toast', () => ({
  toast: vi.fn(),
}))

function renderWithMantine(node: React.ReactNode) {
  return render(<MantineProvider>{node}</MantineProvider>)
}

describe('RechargeModal', () => {
  beforeEach(() => {
    listRechargePackagesMock.mockResolvedValue([])
    preloadModelOptionsMock.mockImplementation(async (kind?: string) => {
      if (kind === 'text') {
        return [
          {
            value: 'gpt-5.2',
            label: 'GPT-5.2',
            vendor: 'openai',
            pricing: {
              cost: 2,
              enabled: true,
              specCosts: [],
            },
          },
        ]
      }
      if (kind === 'image') {
        return [
          {
            value: 'nano-banana-pro',
            label: 'Nano Banana Pro',
            vendor: 'gemini',
            pricing: {
              cost: 6,
              enabled: true,
              specCosts: [
                { specKey: '720p', cost: 10, enabled: true },
                { specKey: '1080p', cost: 16, enabled: true },
              ],
            },
          },
          {
            value: 'qwen-image-plus',
            label: 'Qwen Image Plus',
            vendor: 'qwen',
          },
        ]
      }
      if (kind === 'video') {
        return [
          {
            value: 'veo3.1-fast',
            label: 'Veo 3.1 Fast',
            vendor: 'veo',
            pricing: {
              cost: 20,
              enabled: true,
              specCosts: [],
            },
          },
        ]
      }
      return []
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('opens model pricing drawer and keeps spec prices collapsed until expanded', async () => {
    renderWithMantine(
      <RechargeModal
        opened
        onClose={() => {}}
      />,
    )

    await waitFor(() => expect(listRechargePackagesMock).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByRole('button', { name: '模型价格' }))

    expect(await screen.findByText('当前启用模型价格')).toBeInTheDocument()
    const drawerRoot = document.querySelector('.recharge-model-pricing-drawer')
    expect(drawerRoot).not.toBeNull()
    expect(drawerRoot).toHaveAttribute('style', expect.stringContaining('--mb-z-index: 400;'))
    expect(screen.getByText('文本')).toBeInTheDocument()
    expect(screen.getByText('图片')).toBeInTheDocument()
    expect(screen.getByText('视频')).toBeInTheDocument()
    expect(screen.getByText('GPT-5.2')).toBeInTheDocument()
    expect(screen.getByText('Nano Banana Pro')).toBeInTheDocument()
    expect(screen.getByText('Veo 3.1 Fast')).toBeInTheDocument()
    expect(screen.getByText('720p 10 积分')).not.toBeVisible()
    expect(screen.getByText('1080p 16 积分')).not.toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '展开 Nano Banana Pro 规格价格' }))
    expect(screen.getByText('720p 10 积分')).toBeInTheDocument()
    expect(screen.getByText('1080p 16 积分')).toBeInTheDocument()
    expect(screen.getByText('未配置')).toBeInTheDocument()
  })
})
